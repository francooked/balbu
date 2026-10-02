// ISO 639-1 language codes.
export const LANGUAGE_CODES = ['es', 'en'] as const;
export const LANGUAGE_CODE_LABELS = {
	es: {
		es: 'Español',
		en: 'Inglés'
	},
	en: {
		es: 'Spanish',
		en: 'English'
	}
} as const satisfies Record<
	(typeof LANGUAGE_CODES)[number],
	Record<(typeof LANGUAGE_CODES)[number], string>
>;
export const ROLES = ['assistant', 'user'] as const;
export const MESSAGE_STATUS = [
	'pending',
	'generating',
	'correcting',
	'complete',
	'failed'
] as const;
export const SRS_ALGORITHMS = ['fsrs'] as const;
export const FSRS_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export const CHAT_KIND = ['conversation', 'one_shot'] as const;
export const PRESET_ORIGINS = ['system', 'community', 'user'] as const;
