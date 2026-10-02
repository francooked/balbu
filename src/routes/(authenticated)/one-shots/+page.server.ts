import * as z from 'zod';
import { requireUserSession } from '$lib/server/session-user';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createFormResponders } from '$lib/forms/result.server';
import {
	CORRECT_ONE_SHOT_ID,
	correctOneShotFailure,
	correctOneShotSuccess
} from '$lib/forms/correct-one-shot';
import { normalizeText } from '$lib/correction/normalize-text';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { LANGUAGE_CODES } from '$lib/constants';
import { processOneShot, retryCorrection } from '$lib/server/chat-turn';
import { eq, and } from 'drizzle-orm';
import { buildBlame } from '$lib/correction/build-blame';
import { traceRewriteHistory } from '$lib/correction/segments';
import {
	RETRY_ONE_SHOT_CORRECTION_ID,
	retryOneShotCorrectionFailure,
	retryOneShotCorrectionSuccess
} from '$lib/forms/retry-one-shot-correction';

const correctOneShotResponders = createFormResponders({
	id: CORRECT_ONE_SHOT_ID,
	success: correctOneShotSuccess,
	failure: correctOneShotFailure
});

const retryOneShotCorrectionResponders = createFormResponders({
	id: RETRY_ONE_SHOT_CORRECTION_ID,
	success: retryOneShotCorrectionSuccess,
	failure: retryOneShotCorrectionFailure
});

export const load: PageServerLoad = async ({ locals }) => {
	const signedInUser = requireUserSession(locals);
	if (!signedInUser) return redirect(302, '/login');

	const chats = Array.from(
		Map.groupBy(
			await db
				.select({
					id: schema.chat.id,
					targetLanguage: schema.chat.targetLanguage,
					message: {
						id: schema.message.id,
						content: schema.message.content,
						role: schema.message.role,
						status: schema.message.status
					},
					messageRewrite: {
						id: schema.messageRewrite.id,
						text: schema.messageRewrite.text,
						reason: schema.messageRewrite.reason,
						index: schema.messageRewrite.index
					}
				})
				.from(schema.chat)
				.innerJoin(schema.message, eq(schema.chat.id, schema.message.chatId))
				.leftJoin(schema.messageRewrite, eq(schema.message.id, schema.messageRewrite.messageId))
				.where(and(eq(schema.chat.userId, signedInUser.id), eq(schema.chat.kind, 'one_shot')))
				.orderBy(schema.chat.id),
			({ id }) => id
		),
		([_, records]) => {
			const firstRecord = records.at(0);

			// This should never happen, but just in case, throw an error.
			if (!firstRecord) throw new Error('No record found');

			if (firstRecord.message.role !== 'user') throw new Error('Unexpected message role');

			const rewrites = records
				.reduce((accumulator, { messageRewrite }) => {
					if (messageRewrite === null) return accumulator;
					accumulator.push({
						index: messageRewrite.index,
						reason: messageRewrite.reason,
						sentence: messageRewrite.text
					});
					return accumulator;
				}, new Array<{ index: number; reason: string; sentence: string }>())
				.toSorted((a, b) => a.index - b.index);

			const cells = buildBlame(firstRecord.message.content, rewrites, firstRecord.targetLanguage);
			const rewriteHistory = traceRewriteHistory(cells, rewrites);

			return {
				id: firstRecord.id,
				targetLanguage: firstRecord.targetLanguage,
				message: {
					id: firstRecord.message.id,
					content: firstRecord.message.content,
					status: firstRecord.message.status,
					rewriteHistory
				}
			};
		}
	);

	return { chats };
};

export const actions = {
	correct: async ({ request, locals }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const formData = await request.formData();
		const formDataParse = z
			.object({
				intent: z
					.string()
					.transform((intent) => {
						const normalized = normalizeText(intent);
						return normalized.length > 0 ? normalized : undefined;
					})
					.optional(),
				content: z
					.string()
					.trim()
					.min(1)
					.transform((content) => normalizeText(content)),
				targetLanguage: z
					.enum(LANGUAGE_CODES)
					.refine((code) => code !== signedInUser.nativeLanguage, {
						error: 'You cannot chat in your native language'
					})
			})
			.safeParse({
				intent: formData.get('intent')?.toString() ?? undefined,
				content: formData.get('content')?.toString() ?? '',
				targetLanguage: formData.get('target_language')?.toString() ?? ''
			});

		if (!formDataParse.success) {
			return correctOneShotResponders.fail({
				error: { code: 'invalid_input' },
				status: 400
			});
		}

		const oneShotPreset = (
			await db
				.select({ context: schema.conversationPreset.context })
				.from(schema.conversationPreset)
				.where(eq(schema.conversationPreset.slug, 'one_shot'))
				.limit(1)
		).at(0);

		if (!oneShotPreset || oneShotPreset.context.version !== 1) {
			console.error('Missing one-shot preset.');
			return correctOneShotResponders.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		const { chat, message } = await db.transaction(async (tx) => {
			const chat = (
				await tx
					.insert(schema.chat)
					.values({
						userId: signedInUser.id,
						kind: 'one_shot',
						targetLanguage: formDataParse.data.targetLanguage,
						title: formDataParse.data.content.slice(0, 64),
						payload: oneShotPreset.context
					})
					.returning({ id: schema.chat.id })
			).at(0);

			if (!chat) {
				throw new Error('Failed to create new chat');
			}

			const message = (
				await tx
					.insert(schema.message)
					.values({
						chatId: chat.id,
						content: formDataParse.data.content,
						intent: formDataParse.data.intent,
						role: 'user',
						status: 'pending'
					})
					.returning({ id: schema.message.id })
			).at(0);

			if (!message) {
				throw new Error('Failed to create new message');
			}

			return { chat, message };
		});

		try {
			await processOneShot({ userId: signedInUser.id, chatId: chat.id, userMessageId: message.id });
		} catch (error) {
			console.error(error);
			return correctOneShotResponders.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return correctOneShotResponders.ok({ data: null });
	},
	retryCorrection: async ({ locals, request }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const formData = await request.formData();
		const formDataParse = z
			.object({ chatId: z.coerce.number().positive(), messageId: z.coerce.number().positive() })
			.safeParse({
				chatId: formData.get('chat_id')?.toString(),
				messageId: formData.get('message_id')?.toString()
			});

		if (!formDataParse.success) {
			return retryOneShotCorrectionResponders.fail({
				error: { code: 'invalid_input' },
				status: 400
			});
		}

		try {
			await retryCorrection({
				userId: signedInUser.id,
				chatId: formDataParse.data.chatId,
				userMessageId: formDataParse.data.messageId
			});
		} catch (error) {
			console.error(error);
			return retryOneShotCorrectionResponders.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return retryOneShotCorrectionResponders.ok({ data: null });
	}
} satisfies Actions;
