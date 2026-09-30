import * as schema from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { eq, and, inArray } from 'drizzle-orm';
import {
	buildPrompt as buildMessageReplyPrompt,
	outputSchema as messageReplyOutputSchema,
	responseFormat as messageReplyResponseFormat
} from '$lib/prompts/chat-reply/v1/prompt';
import {
	buildPrompt as buildMessageCorrectionPrompt,
	outputSchema as messageCorrectionOutputSchema,
	responseFormat as messageCorrectionResponseFormat
} from '$lib/prompts/message-correction';
import { retry } from './retry';
import { openai, parseLlmResponse, LLM_MODEL } from './llm';
import { chatPayloadSchema } from '$lib/chat/payload';

/** Operational chat-turn failure. `code` is for logs; actions map any throw to `unexpected`. */
export class ChatTurnError extends Error {
	constructor(
		public code:
			| 'chat_not_found'
			| 'messages_not_found'
			| 'persist_failed'
			| 'unsupported_chat_payload_version'
	) {
		super(code);
	}
}

async function updateMessageStatus({
	chatId,
	messageId,
	status
}: {
	chatId: number;
	messageId: number;
	status: typeof schema.message.$inferInsert.status;
}) {
	await db
		.update(schema.message)
		.set({ status })
		.where(and(eq(schema.message.chatId, chatId), eq(schema.message.id, messageId)));
}

async function claimMessage({
	chatId,
	messageId,
	status
}: {
	chatId: number;
	messageId: number;
	status: typeof schema.message.$inferInsert.status;
}) {
	const updatedMessage = (
		await db
			.update(schema.message)
			.set({ status })
			.where(
				and(
					eq(schema.message.chatId, chatId),
					eq(schema.message.id, messageId),
					inArray(schema.message.status, ['pending', 'failed'])
				)
			)
			.returning({ id: schema.message.id, status: schema.message.status })
	).at(0);

	return updatedMessage !== undefined;
}

async function loadChat({ userId, chatId }: { userId: string; chatId: number }) {
	const chat = (
		await db
			.select({
				id: schema.chat.id,
				userId: schema.user.id,
				nativeLanguage: schema.user.nativeLanguage,
				targetLanguage: schema.chat.targetLanguage,
				kind: schema.chat.kind,
				payload: schema.chat.payload
			})
			.from(schema.chat)
			.innerJoin(schema.message, eq(schema.chat.id, schema.message.chatId))
			.innerJoin(schema.user, eq(schema.chat.userId, schema.user.id))
			.where(and(eq(schema.chat.userId, userId), eq(schema.chat.id, chatId)))
			.limit(1)
	).at(0);

	if (!chat) throw new ChatTurnError('chat_not_found');

	const messages = await db
		.select({
			id: schema.message.id,
			content: schema.message.content,
			intent: schema.message.intent,
			role: schema.message.role,
			status: schema.message.status
		})
		.from(schema.message)
		.innerJoin(schema.chat, eq(schema.message.chatId, schema.chat.id))
		.where(and(eq(schema.chat.userId, userId), eq(schema.chat.id, chatId)))
		.orderBy(schema.message.id);

	return { chat, messages };
}

async function replyUserMessage({
	chat,
	messages,
	userMessageId,
	assistantMessageId
}: { userMessageId: number; assistantMessageId: number } & Awaited<ReturnType<typeof loadChat>>) {
	const userMessage = messages.find(
		(message) => message.id === userMessageId && message.role === 'user'
	);

	const assistantMessage = messages.find(
		(message) => message.id === assistantMessageId && message.role === 'assistant'
	);

	if (!userMessage || !assistantMessage) {
		throw new ChatTurnError('messages_not_found');
	}

	const claimed = await claimMessage({
		chatId: chat.id,
		messageId: assistantMessage.id,
		status: 'generating'
	});

	// Another task has already claimed this message.
	if (!claimed) return;

	const scene = chatPayloadSchema.parse(chat.payload);

	if (scene.version !== 1) {
		throw new ChatTurnError('unsupported_chat_payload_version');
	}

	const llmResponse = await retry({
		fn: async () => {
			const chatCompletion = await openai.chat.completions.create({
				messages: buildMessageReplyPrompt({
					nativeLanguage: chat.nativeLanguage,
					targetLanguage: chat.targetLanguage,
					context: scene.payload,
					turns: messages
						.filter((message) => message.id <= userMessage.id)
						.map(({ role, content }) => ({ role, content }))
				}),
				model: LLM_MODEL,
				response_format: messageReplyResponseFormat,
				reasoning_effort: 'none',
				temperature: 0.5,
				max_completion_tokens: 2048
			});

			return parseLlmResponse(
				chatCompletion.choices.at(0)?.message.content,
				messageReplyOutputSchema
			);
		}
	});

	await db
		.update(schema.message)
		.set({ content: llmResponse.answer, status: 'complete' })
		.where(and(eq(schema.message.chatId, chat.id), eq(schema.message.id, assistantMessage.id)));
}

async function correctUserMessage({
	chat,
	messages,
	userMessageId
}: { userMessageId: number } & Awaited<ReturnType<typeof loadChat>>) {
	const userMessage = messages.find(
		(message) => message.id === userMessageId && message.role === 'user'
	);

	if (!userMessage) {
		throw new ChatTurnError('messages_not_found');
	}

	const claimed = await claimMessage({
		chatId: chat.id,
		messageId: userMessage.id,
		status: 'correcting'
	});

	// Another task has already claimed this message.
	if (!claimed) return;

	const llmResponse = await retry({
		fn: async () => {
			const chatCompletion = await openai.chat.completions.create({
				messages: buildMessageCorrectionPrompt({
					nativeLanguage: chat.nativeLanguage,
					targetLanguage: chat.targetLanguage,
					intent: userMessage.intent ?? undefined,
					turns: messages
						.filter((message) => message.id <= userMessage.id)
						.map(({ role, content }) => ({ role, content }))
				}),
				response_format: messageCorrectionResponseFormat,
				model: LLM_MODEL,
				reasoning_effort: 'low',
				max_completion_tokens: 2048
			});

			return parseLlmResponse(
				chatCompletion.choices.at(0)?.message.content,
				messageCorrectionOutputSchema
			);
		}
	});

	if (llmResponse.steps.length === 0) {
		await updateMessageStatus({
			chatId: chat.id,
			messageId: userMessage.id,
			status: 'complete'
		});
		return;
	}

	await db.transaction(async (tx) => {
		const messageRewrites = await tx
			.insert(schema.messageRewrite)
			.values(
				llmResponse.steps.map(({ sentence, reason }, index) => ({
					messageId: userMessageId,
					text: sentence,
					index,
					reason
				}))
			)
			.returning({ id: schema.messageRewrite.id, text: schema.messageRewrite.text });

		const lastMessageRewrite = messageRewrites.at(-1);
		if (!lastMessageRewrite) throw new ChatTurnError('persist_failed');

		const front = userMessage.content;
		const back = lastMessageRewrite.text;
		const extra = llmResponse.translation;

		const exercise = (
			await tx
				.insert(schema.exercise)
				.values({
					userId: chat.userId,
					targetLanguage: chat.targetLanguage,
					payload: { type: 'full_answer', version: 1, payload: { front, back, extra } }
				})
				.returning({ id: schema.exercise.id })
		).at(0);

		if (!exercise) throw new ChatTurnError('persist_failed');

		await tx
			.insert(schema.exerciseMessageRewrite)
			.values({ exerciseId: exercise.id, messageRewriteId: lastMessageRewrite.id });

		await tx
			.update(schema.message)
			.set({ status: 'complete' })
			.where(and(eq(schema.message.chatId, chat.id), eq(schema.message.id, userMessage.id)));
	});
}

async function runMessageTask({
	chatId,
	messageId,
	task
}: {
	chatId: number;
	messageId: number;
	task: () => Promise<void>;
}) {
	try {
		await task();
	} catch (error) {
		console.error('chat task failed:', error);
		await updateMessageStatus({ chatId, messageId, status: 'failed' });
		throw error;
	}
}

export async function processConversationTurn({
	userId,
	chatId,
	userMessageId,
	assistantMessageId
}: {
	userId: string;
	chatId: number;
	userMessageId: number;
	assistantMessageId: number;
}) {
	const { chat, messages } = await loadChat({ userId, chatId });

	if (chat.kind !== 'conversation') {
		throw new ChatTurnError('chat_not_found');
	}

	// Even if the chat is new, there should be at least two messages: one user message and one assistant message.
	// They are both pending.
	const userMessageIndex = messages.findIndex(
		({ id, role }) => id === userMessageId && role === 'user'
	);

	if (userMessageIndex === -1) {
		throw new ChatTurnError('messages_not_found');
	}

	const assistantMessage = messages.at(userMessageIndex + 1);

	if (assistantMessage?.id !== assistantMessageId || assistantMessage.role !== 'assistant') {
		throw new ChatTurnError('messages_not_found');
	}

	await Promise.allSettled([
		runMessageTask({
			chatId,
			messageId: assistantMessageId,
			task: () => replyUserMessage({ chat, messages, assistantMessageId, userMessageId })
		}),
		runMessageTask({
			chatId,
			messageId: userMessageId,
			task: () => correctUserMessage({ chat, messages, userMessageId })
		})
	]);
}

export async function processOneShot({
	userId,
	chatId,
	userMessageId
}: {
	userId: string;
	chatId: number;
	userMessageId: number;
}) {
	const { chat, messages } = await loadChat({ userId, chatId });

	if (chat.kind !== 'one_shot') {
		throw new ChatTurnError('chat_not_found');
	}

	const userMessage = messages.find(({ id, role }) => id === userMessageId && role === 'user');

	if (!userMessage || messages.length !== 1) {
		throw new ChatTurnError('messages_not_found');
	}

	await runMessageTask({
		chatId,
		messageId: userMessageId,
		task: () => correctUserMessage({ chat, messages, userMessageId })
	});
}

export async function retryReply({
	userId,
	chatId,
	assistantMessageId
}: {
	userId: string;
	chatId: number;
	assistantMessageId: number;
}) {
	const { chat, messages } = await loadChat({ userId, chatId });
	const assistantMessageIndex = messages.findIndex(({ id }) => id === assistantMessageId);

	if (assistantMessageIndex === -1) {
		throw new ChatTurnError('messages_not_found');
	}

	const userMessage = messages.at(assistantMessageIndex - 1);

	if (userMessage?.role !== 'user') {
		throw new ChatTurnError('messages_not_found');
	}

	await runMessageTask({
		chatId,
		messageId: assistantMessageId,
		task: () =>
			replyUserMessage({ chat, messages, assistantMessageId, userMessageId: userMessage.id })
	});
}

export async function retryCorrection({
	userId,
	chatId,
	userMessageId
}: {
	userId: string;
	chatId: number;
	userMessageId: number;
}) {
	const { chat, messages } = await loadChat({ userId, chatId });
	const userMessage = messages.find(({ id, role }) => id === userMessageId && role === 'user');

	if (!userMessage) {
		throw new ChatTurnError('messages_not_found');
	}

	await runMessageTask({
		chatId,
		messageId: userMessageId,
		task: () =>
			correctUserMessage({
				chat,
				messages,
				userMessageId
			})
	});
}
