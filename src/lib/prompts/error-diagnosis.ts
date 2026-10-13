import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionSystemMessageParam,
	ChatCompletionUserMessageParam,
	ResponseFormatJSONSchema
} from 'openai/resources';
import { LANGUAGE_CODES } from '$lib/constants';
import dedent from 'dedent';
import * as z from 'zod';
import { buildLanguageRules, languageName, selectExamples, type LanguagePair } from './utils';

const sampleSchema = z.object({
	text: z.string().min(1),
	reason: z.string().min(1)
});

export const inputSchema = z
	.object({
		nativeLanguage: z.enum(LANGUAGE_CODES),
		targetLanguage: z.enum(LANGUAGE_CODES),
		label: z.string().min(1),
		appliesWhen: z.string().min(1),
		samples: z.array(sampleSchema).min(1)
	})
	.refine(({ nativeLanguage, targetLanguage }) => nativeLanguage !== targetLanguage);

export const outputSchema = z.object({
	diagnosis: z.string().trim().min(1).nullable()
});

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

type Example = { input: Input; output: Output };

export const buildFewShot = ({
	input,
	output
}: {
	input: z.infer<typeof inputSchema>;
	output?: z.infer<typeof outputSchema>;
}): (ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam)[] => {
	const turns: (ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam)[] = [
		{
			role: 'user',
			content: JSON.stringify({
				nativeLanguage: languageName(input.nativeLanguage),
				targetLanguage: languageName(input.targetLanguage),
				writeDiagnosisIn: languageName(input.nativeLanguage),
				label: input.label,
				appliesWhen: input.appliesWhen,
				samples: input.samples
			})
		}
	];

	if (output) turns.push({ role: 'assistant', content: JSON.stringify(output) });
	return turns;
};

export const examples: Example[] = [
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			label: 'Te comes el "to" después de "want"',
			appliesWhen: 'Falta "to" entre "want", en cualquier forma, y el verbo que sigue.',
			samples: [
				{
					text: 'I want go to the park',
					reason: 'Después de "want" el verbo lleva "to".'
				},
				{
					text: 'I want eat now',
					reason: 'Falta "to" después de "want".'
				},
				{
					text: 'She wants visit tomorrow',
					reason: 'Después de "wants" el verbo lleva "to".'
				}
			]
		},
		output: {
			diagnosis: 'Calcas «quiero ir»: en español no va nada entre los dos verbos.'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			label: 'Te comes el "to" después de "want"',
			appliesWhen: 'Falta "to" entre "want", en cualquier forma, y el verbo que sigue.',
			samples: [
				{
					text: 'I want go and she work on Sundays',
					reason: 'Después de "want" el verbo lleva "to".'
				},
				{
					text: 'I want eat but he work at night',
					reason: 'Falta "to" después de "want".'
				}
			]
		},
		output: {
			diagnosis: 'Calcas «quiero ir»: en español no va nada entre los dos verbos.'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			label: 'Doblas una letra',
			appliesWhen: 'Una palabra lleva una letra repetida que no va.',
			samples: [
				{
					text: 'I reallly like coffee',
					reason: '"really" lleva dos eles, no tres.'
				},
				{
					text: 'The book is heere',
					reason: '"here" lleva una e, no dos.'
				}
			]
		},
		output: { diagnosis: null }
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			label: 'You use "estar" for a job',
			appliesWhen: 'Un oficio va con "estar" en vez de "ser".',
			samples: [
				{
					text: 'Ella está abogada',
					reason: 'A job takes "ser": "es abogada".'
				},
				{
					text: 'Mi hermano está médico',
					reason: 'A job takes "ser": "es médico".'
				}
			]
		},
		output: {
			diagnosis:
				'You start from "she is a lawyer": English uses one "is" for a job and for a state.'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			label: 'You double a letter',
			appliesWhen: 'Una palabra lleva una letra repetida que no va.',
			samples: [
				{
					text: 'La caasa es grande',
					reason: '"casa" has one s, not two.'
				},
				{
					text: 'Quiero caafé',
					reason: '"café" has one a, not two.'
				}
			]
		},
		output: { diagnosis: null }
	}
];

const buildSystemPrompt = ({ nativeLanguage, targetLanguage }: LanguagePair): string => {
	const native = languageName(nativeLanguage);
	const target = languageName(targetLanguage);

	return dedent`
		Eres un tutor que ya tiene el hábito nombrado. No das una clase y no descubres hábitos nuevos. Escribes la causa, o te callas.

		${buildLanguageRules({ nativeLanguage, targetLanguage })}

		El hábito es el hueco en ${target}. La causa es la frase de ${native} de la que partió el aprendiz. Son dos frases distintas.
		- Mal, porque repite el hábito: "Te falta el to después de want."
		- Bien, porque nombra de dónde salió: "Calcas «quiero ir»: en español no va nada entre los dos verbos."
		Si borras ${native} y la oración sigue describiendo el hueco, es el hábito otra vez.

		Entrada: un solo hábito.
		- label, en ${native}. appliesWhen es la regla interna: no la reescribas.
		- samples: cada una tiene text y reason.
		- text es la oración mientras ESE hueco sigue presente. Puede traer errores de otras partículas. Puede estar incompleta. No es una versión corregida.
		- reason dice cuál es el hueco de este hábito. No expliques el resto de text.
		- No hay una frase corregida al lado. No inventes una.

		diagnosis:
		- Una oración en ${native}. La causa, no el label ni el appliesWhen ni un resumen de reason.
		- Palabras de ${target} solo entre comillas.
		- null si lo único que puedes escribir describe el hueco. null no afirma que la causa no exista: afirma que ibas a parafrasear el hábito.
		- No des un truco para corregirlo. No digas cómo lo oye un nativo. No hables de cantidades ni de si mejoró.

		No cambies el label.

		Texto plano: sin markdown, sin emojis.

		Responde SOLO con este JSON:
		{"diagnosis":"..."}

		Antes de responder, revisa:
		- diagnosis está en ${native}, o es null.
		- diagnosis no repite el label ni el appliesWhen.
		- diagnosis no explica un error de text que reason no nombró.
		Si algo falla, reescribe. Si la causa no se sostiene, pon null.
	`;
};

export const buildPrompt = (
	raw: z.infer<typeof inputSchema>
): (
	| ChatCompletionSystemMessageParam
	| ChatCompletionUserMessageParam
	| ChatCompletionAssistantMessageParam
)[] => {
	const input = inputSchema.parse(raw);

	return [
		{ role: 'system', content: buildSystemPrompt(input) },
		...selectExamples(examples, input).flatMap((example) => buildFewShot(example)),
		...buildFewShot({ input })
	];
};

export const responseFormat: ResponseFormatJSONSchema = {
	type: 'json_schema' as const,
	json_schema: {
		name: 'error_diagnosis',
		strict: false,
		schema: z.toJSONSchema(outputSchema, { io: 'input' })
	}
};
