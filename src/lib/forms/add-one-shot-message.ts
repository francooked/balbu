import * as z from 'zod';
import { defineFailure, defineSuccess } from './contract';

export const ADD_ONE_SHOT_MESSAGE_ID = 'addOneShotMessage' as const;

export const addOneShotMessageSuccess = defineSuccess(z.null());

export const addOneShotMessageFailure = defineFailure(
	z.object({ code: z.enum(['invalid_input', 'unexpected', 'chat_not_found']) })
);
