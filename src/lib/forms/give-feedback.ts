import * as z from 'zod';
import { defineFailure, defineSuccess } from './contract';

export const GIVE_FEEDBACK_ID = 'giveFeedback' as const;

export const giveFeedbackSuccess = defineSuccess(z.null());

export const giveFeedbackFailure = defineFailure(
	z.object({ code: z.enum(['unexpected', 'invalid_input']) })
);
