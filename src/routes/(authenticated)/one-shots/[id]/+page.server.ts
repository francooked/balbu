import type { Actions, PageServerLoad } from './$types';
import * as schema from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { and, eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import * as z from 'zod';
import { requireUserSession } from '$lib/server/session-user';
import { processOneShot, retryCorrection } from '$lib/server/chat-turn';
import { normalizeText } from '$lib/correction/normalize-text';
import { buildBlame } from '$lib/correction/build-blame';
import { traceRewriteHistory, type Segment } from '$lib/correction/segments';
import { createFormResponders } from '$lib/forms/result.server';
import {
	ADD_ONE_SHOT_MESSAGE_ID,
	addOneShotMessageFailure,
	addOneShotMessageSuccess
} from '$lib/forms/add-one-shot-message';
import {
	RETRY_ONE_SHOT_CORRECTION_ID,
	retryOneShotCorrectionFailure,
	retryOneShotCorrectionSuccess
} from '$lib/forms/retry-one-shot-correction';
import { chatPayloadSchema } from '$lib/chat/payload';
import { paramsSchema } from './lib/params';

type OneShotMessage = {
	id: number;
	content: string;
	status: 'pending' | 'generating' | 'correcting' | 'complete' | 'failed';
	rewriteHistory: Segment[];
};

const addOneShotMessageResponders = createFormResponders({
	id: ADD_ONE_SHOT_MESSAGE_ID,
	success: addOneShotMessageSuccess,
	failure: addOneShotMessageFailure
});

const retryOneShotCorrectionResponders = createFormResponders({
	id: RETRY_ONE_SHOT_CORRECTION_ID,
	success: retryOneShotCorrectionSuccess,
	failure: retryOneShotCorrectionFailure
});

/** Empty intention is the same as omitting it. */
function optionalIntent(value: string | undefined) {
	const normalized = normalizeText(value ?? '');
	return normalized.length > 0 ? normalized : undefined;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const signedInUser = requireUserSession(locals);
	if (!signedInUser) return redirect(302, '/login');

	const paramsParse = paramsSchema.safeParse(params);
	if (!paramsParse.success) return redirect(302, '/one-shots');
	const { id: chatId } = paramsParse.data;

	const chat = (
		await db
			.select({
				id: schema.chat.id,
				title: schema.chat.title,
				targetLanguage: schema.chat.targetLanguage,
				payload: schema.chat.payload
			})
			.from(schema.chat)
			.where(
				and(
					eq(schema.chat.id, chatId),
					eq(schema.chat.userId, signedInUser.id),
					eq(schema.chat.kind, 'one_shot')
				)
			)
	).at(0);

	if (!chat) return redirect(302, '/one-shots');

	const payload = chatPayloadSchema.safeParse(chat.payload);
	if (!payload.success || payload.data.version !== 1) return redirect(302, '/one-shots');

	const messages: OneShotMessage[] = Array.from(
		Map.groupBy(
			await db
				.select({
					id: schema.message.id,
					role: schema.message.role,
					content: schema.message.content,
					status: schema.message.status,
					messageRewrite: {
						text: schema.messageRewrite.text,
						reason: schema.messageRewrite.reason,
						index: schema.messageRewrite.index
					}
				})
				.from(schema.message)
				.leftJoin(schema.messageRewrite, eq(schema.message.id, schema.messageRewrite.messageId))
				.where(eq(schema.message.chatId, chat.id))
				.orderBy(schema.message.id),
			({ id }) => id
		)
	).map(([id, records]) => {
		const firstRecord = records.at(0);
		if (!firstRecord) throw new Error('No record found');
		if (firstRecord.role !== 'user') throw new Error('Unexpected message role');

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

		const cells = buildBlame(firstRecord.content, rewrites, chat.targetLanguage);
		const rewriteHistory = traceRewriteHistory(cells, rewrites);

		return {
			id,
			content: firstRecord.content,
			status: firstRecord.status,
			rewriteHistory
		};
	});

	return { title: chat.title, you: payload.data.payload.you, messages };
};

export const actions = {
	addMessage: async ({ request, locals, params }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const paramsParse = paramsSchema.safeParse(params);
		if (!paramsParse.success) {
			return addOneShotMessageResponders.fail({ error: { code: 'chat_not_found' }, status: 400 });
		}
		const { id: chatId } = paramsParse.data;

		const formData = await request.formData();
		const formDataParse = z
			.object({
				intent: z
					.string()
					.transform((intent) => optionalIntent(intent))
					.optional(),
				content: z
					.string()
					.trim()
					.min(1)
					.transform((content) => normalizeText(content))
			})
			.safeParse({
				intent: formData.get('intent')?.toString() ?? undefined,
				content: formData.get('content')?.toString() ?? ''
			});

		if (!formDataParse.success) {
			return addOneShotMessageResponders.fail({ error: { code: 'invalid_input' }, status: 400 });
		}

		const chat = (
			await db
				.select({ id: schema.chat.id })
				.from(schema.chat)
				.where(
					and(
						eq(schema.chat.id, chatId),
						eq(schema.chat.userId, signedInUser.id),
						eq(schema.chat.kind, 'one_shot')
					)
				)
		).at(0);

		if (!chat) {
			return addOneShotMessageResponders.fail({ error: { code: 'chat_not_found' }, status: 400 });
		}

		const message = (
			await db
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

		if (!message) throw new Error('Failed to create new message');

		try {
			await processOneShot({
				userId: signedInUser.id,
				chatId: chat.id,
				userMessageId: message.id
			});
		} catch (error) {
			console.error(error);
			return addOneShotMessageResponders.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return addOneShotMessageResponders.ok({ data: null });
	},
	retryCorrection: async ({ locals, request, params }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const paramsParse = paramsSchema.safeParse(params);
		if (!paramsParse.success) {
			return retryOneShotCorrectionResponders.fail({
				error: { code: 'invalid_input' },
				status: 400
			});
		}

		const formData = await request.formData();
		const formDataParse = z
			.object({ messageId: z.coerce.number().positive() })
			.safeParse({ messageId: formData.get('message_id')?.toString() });

		if (!formDataParse.success) {
			return retryOneShotCorrectionResponders.fail({
				error: { code: 'invalid_input' },
				status: 400
			});
		}

		try {
			await retryCorrection({
				userId: signedInUser.id,
				chatId: paramsParse.data.id,
				userMessageId: formDataParse.data.messageId
			});
		} catch (error) {
			console.error(error);
			return retryOneShotCorrectionResponders.fail({ error: { code: 'unexpected' }, status: 500 });
		}

		return retryOneShotCorrectionResponders.ok({ data: null });
	}
} satisfies Actions;
