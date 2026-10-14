import z from 'zod';

/** Params for `/one-shots/[id]`. */
export const paramsSchema = z.object({
	id: z.coerce.number().int().positive()
});
