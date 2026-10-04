import { buildPrompt, responseFormat } from '../../src/lib/prompts/error-identity';
import type { Input } from '../../src/lib/prompts/error-identity';

export default async function ({ vars }: { vars: Input }) {
	return {
		prompt: buildPrompt(vars),
		config: {
			response_format: responseFormat
		}
	};
}
