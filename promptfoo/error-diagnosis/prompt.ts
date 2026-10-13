import { buildPrompt, responseFormat } from '../../src/lib/prompts/error-diagnosis';
import type { Input } from '../../src/lib/prompts/error-diagnosis';

export default async function ({ vars }: { vars: Input }) {
	return {
		prompt: buildPrompt(vars),
		config: {
			response_format: responseFormat
		}
	};
}
