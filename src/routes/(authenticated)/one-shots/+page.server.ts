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
import { processOneShot } from '$lib/server/chat-turn';
import { and, eq } from 'drizzle-orm';
import { DELETE_CHAT_ID, deleteChatFailure, deleteChatSuccess } from '$lib/forms/delete-chat';
import { contextSchema } from '$lib/prompts/chat-reply/v1/context';

const correctOneShotResponders = createFormResponders({
	id: CORRECT_ONE_SHOT_ID,
	success: correctOneShotSuccess,
	failure: correctOneShotFailure
});

const deleteChatResponders = createFormResponders({
	id: DELETE_CHAT_ID,
	success: deleteChatSuccess,
	failure: deleteChatFailure
});

/** Empty intention is the same as omitting it. */
function optionalIntent(value: string | undefined) {
	const normalized = normalizeText(value ?? '');
	return normalized.length > 0 ? normalized : undefined;
}

export const load: PageServerLoad = async ({ locals }) => {
	const signedInUser = requireUserSession(locals);
	if (!signedInUser) return redirect(302, '/login');

	const chats = await db
		.select({ id: schema.chat.id, title: schema.chat.title })
		.from(schema.chat)
		.where(and(eq(schema.chat.userId, signedInUser.id), eq(schema.chat.kind, 'one_shot')));

	const presets = await db
		.select({
			id: schema.conversationPreset.id,
			slug: schema.conversationPreset.slug,
			origin: schema.conversationPreset.origin,
			kind: schema.conversationPreset.kind,
			name: schema.conversationPreset.name,
			briefing: schema.conversationPreset.briefing,
			context: schema.conversationPreset.context,
			authorId: schema.conversationPreset.authorId
		})
		.from(schema.conversationPreset);

	return { chats, presets };
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
					.transform((intent) => optionalIntent(intent))
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
					}),
				version: z.literal(1),
				context: contextSchema
			})
			.safeParse({
				intent: formData.get('intent')?.toString() ?? undefined,
				content: formData.get('content')?.toString() ?? '',
				targetLanguage: formData.get('target_language')?.toString() ?? '',
				version: parseInt(formData.get('version')?.toString() ?? '-1'),
				context: {
					you: formData.get('you')?.toString() ?? '',
					partner: formData.get('partner')?.toString() ?? '',
					shared: formData.get('shared')?.toString() ?? '',
					private: formData.get('private')?.toString() ?? '',
					want: formData.get('want')?.toString() ?? ''
				}
			});

		if (!formDataParse.success) {
			return correctOneShotResponders.fail({
				error: { code: 'invalid_input' },
				status: 400
			});
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
						payload: { version: formDataParse.data.version, payload: formDataParse.data.context }
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

		return redirect(303, `/one-shots/${chat.id}`);
	},
	deleteChat: async ({ request, locals }) => {
		const signedInUser = requireUserSession(locals);
		if (!signedInUser) return redirect(303, '/login');

		const formData = await request.formData();
		const formDataParse = z
			.object({ chatId: z.coerce.number().positive() })
			.safeParse({ chatId: formData.get('chat_id')?.toString() });

		if (!formDataParse.success) {
			return deleteChatResponders.fail({ error: { code: 'invalid_input' }, status: 400 });
		}

		await db
			.delete(schema.chat)
			.where(
				and(
					eq(schema.chat.id, formDataParse.data.chatId),
					eq(schema.chat.userId, signedInUser.id),
					eq(schema.chat.kind, 'one_shot')
				)
			);

		return deleteChatResponders.ok({ data: null });
	}
} satisfies Actions;
