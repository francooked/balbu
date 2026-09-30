import { contextSchema as contextV1 } from '$lib/prompts/chat-reply/v1/context';
import * as z from 'zod';

export const chatPayloadSchema = z.discriminatedUnion('version', [
	z.object({
		version: z.literal(1),
		payload: contextV1
	})
]);

export type ChatPayload = z.infer<typeof chatPayloadSchema>;
