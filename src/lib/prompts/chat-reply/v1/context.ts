import * as z from 'zod';

/** Scene a v1 reply reads. Stored on the chat as payload version 1. */
export const contextSchema = z.object({
	you: z.string().trim().min(1),
	partner: z.string().trim().min(1),
	shared: z.string().trim().min(1),
	private: z.string().trim().min(1),
	want: z.string().trim().min(1)
});

export type Context = z.infer<typeof contextSchema>;
