import { buildPrompt, responseFormat } from '../../src/lib/prompts/chat-reply/v1/prompt';
import type { Input } from '../../src/lib/prompts/chat-reply/v1/prompt';

export default async function ({ vars }: { vars: Input }) {
	return {
		prompt: buildPrompt(vars),
		config: {
			response_format: responseFormat
		}
	};
}
