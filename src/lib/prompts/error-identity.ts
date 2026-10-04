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

export const inputSchema = z
	.object({
		nativeLanguage: z.enum(LANGUAGE_CODES),
		targetLanguage: z.enum(LANGUAGE_CODES),
		identities: z.array(
			z.object({
				id: z.number().int().positive(),
				appliesWhen: z.string().min(1)
			})
		),
		steps: z
			.array(
				z.object({
					index: z.number().int().nonnegative(),
					before: z.string().min(1),
					after: z.string().min(1),
					reason: z.string().min(1)
				})
			)
			.min(1)
	})
	.refine(({ nativeLanguage, targetLanguage, identities, steps }) => {
		const stepIndexes = new Set(steps.map((step) => step.index));
		const identityIds = new Set(identities.map((identity) => identity.id));

		return (
			nativeLanguage !== targetLanguage &&
			stepIndexes.size === steps.length &&
			identityIds.size === identities.length &&
			steps.every((step) => step.before !== step.after)
		);
	});

export const outputSchema = z
	.object({
		created: z.array(
			z.object({
				label: z.string().trim().min(1),
				appliesWhen: z.string().trim().min(1)
			})
		),
		assignments: z
			.array(
				z.object({
					index: z.number().int().nonnegative(),
					identityId: z.number().int().positive().nullable(),
					createdIndex: z.number().int().nonnegative().nullable()
				})
			)
			.min(1)
	})
	// One pointer per step. A new identity that nothing points at would be stored unused.
	.refine(
		({ created, assignments }) => {
			const indexes = new Set(assignments.map((assignment) => assignment.index));
			const used = new Set(
				assignments.map((assignment) => assignment.createdIndex).filter((index) => index !== null)
			);

			return (
				indexes.size === assignments.length &&
				assignments.every(
					(assignment) =>
						(assignment.identityId === null) !== (assignment.createdIndex === null) &&
						(assignment.createdIndex === null || assignment.createdIndex < created.length)
				) &&
				used.size === created.length
			);
		},
		{ error: 'each step points at one identity, and every new identity is used' }
	);

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

/** Throws if a step is missing or an id is not one of the identities passed in. */
export function bindAssignment(input: Input, output: Output): Output {
	const stepIndexes = new Set(input.steps.map((step) => step.index));
	const identityIds = new Set(input.identities.map((identity) => identity.id));

	if (output.assignments.length !== input.steps.length) {
		throw new Error('assignment count does not match steps');
	}

	for (const assignment of output.assignments) {
		if (!stepIndexes.has(assignment.index)) {
			throw new Error('assignment index is not a step');
		}

		if (assignment.identityId !== null && !identityIds.has(assignment.identityId)) {
			throw new Error('assignment points at an unknown identity');
		}
	}

	return output;
}

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
				writeLabelIn: languageName(input.nativeLanguage),
				writeAppliesWhenIn: languageName('es'),
				identities: input.identities,
				steps: input.steps
			})
		}
	];

	if (output) turns.push({ role: 'assistant', content: JSON.stringify(output) });
	return turns;
};

export const examples: Example[] = [
	// nativeLanguage: es, targetLanguage: en
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			identities: [
				{
					id: 2,
					appliesWhen: 'Con "he", "she" o "it", el presente no va en la forma base del verbo.'
				}
			],
			steps: [
				{
					index: 0,
					before: 'He work on Sundays',
					after: 'He works on Sundays',
					reason: 'Con "he" el presente lleva "works".'
				}
			]
		},
		output: {
			created: [],
			assignments: [{ index: 0, identityId: 2, createdIndex: null }]
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			identities: [
				{
					id: 5,
					appliesWhen: 'Falta "to" entre "want", en cualquier forma, y el verbo que sigue.'
				}
			],
			steps: [
				{
					index: 0,
					before: 'I need go now',
					after: 'I need to go now',
					reason: 'Después de "need" el verbo lleva "to".'
				}
			]
		},
		output: {
			created: [
				{
					label: 'Te comes el "to" después de "need"',
					appliesWhen: 'Falta "to" entre "need", en cualquier forma, y el verbo que sigue.'
				}
			],
			assignments: [{ index: 0, identityId: null, createdIndex: 0 }]
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			identities: [],
			steps: [
				{
					index: 0,
					before: 'I want go and she wants eat',
					after: 'I want to go and she wants eat',
					reason: 'Después de "want" el verbo lleva "to".'
				},
				{
					index: 1,
					before: 'I want to go and she wants eat',
					after: 'I want to go and she wants to eat',
					reason: 'Después de "wants" el verbo lleva "to".'
				}
			]
		},
		output: {
			created: [
				{
					label: 'Te comes el "to" después de "want"',
					appliesWhen: 'Falta "to" entre "want", en cualquier forma, y el verbo que sigue.'
				}
			],
			assignments: [
				{ index: 0, identityId: null, createdIndex: 0 },
				{ index: 1, identityId: null, createdIndex: 0 }
			]
		}
	},
	// nativeLanguage: en, targetLanguage: es
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			identities: [
				{
					id: 8,
					appliesWhen: 'Para un oficio o una característica permanente se usa "ser", no "estar".'
				}
			],
			steps: [
				{
					index: 0,
					before: 'Ella está abogada',
					after: 'Ella es abogada',
					reason: 'A job takes "ser": "es abogada".'
				}
			]
		},
		output: {
			created: [],
			assignments: [{ index: 0, identityId: 8, createdIndex: null }]
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			identities: [
				{
					id: 8,
					appliesWhen: 'Para un oficio o una característica permanente se usa "ser", no "estar".'
				}
			],
			steps: [
				{
					index: 0,
					before: 'Vi la mapa',
					after: 'Vi el mapa',
					reason: '"mapa" is masculine, so the article is "el".'
				}
			]
		},
		output: {
			created: [
				{
					label: 'You use "la" with a masculine noun',
					appliesWhen: 'Un sustantivo masculino, aunque termine en "-a", lleva "el", no "la".'
				}
			],
			assignments: [{ index: 0, identityId: null, createdIndex: 0 }]
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			identities: [],
			steps: [
				{
					index: 0,
					before: 'La casa blanco',
					after: 'La casa blanca',
					reason: '"casa" is feminine, so the adjective ends in "-a".'
				}
			]
		},
		output: {
			created: [
				{
					label: 'You leave the adjective in the other gender',
					appliesWhen: 'El adjetivo queda en otro género que el sustantivo al que modifica.'
				}
			],
			assignments: [{ index: 0, identityId: null, createdIndex: 0 }]
		}
	}
];

const buildSystemPrompt = ({ nativeLanguage, targetLanguage }: LanguagePair): string => {
	const native = languageName(nativeLanguage);
	const target = languageName(targetLanguage);

	return dedent`
		Eres un clasificador de errores de un aprendiz. No das una clase. Para cada step decides si cae en una identidad ya existente o si abre una nueva.

		${buildLanguageRules({ nativeLanguage, targetLanguage })}

		Excepción: "appliesWhen" NO es una explicación para el usuario. Es una instrucción para un prompt futuro y va SIEMPRE en español, aunque nativeLanguage sea otro. Lo único de ${target} ahí son palabras entre comillas.

		Entrada:
		- identities: hábitos ya guardados. Cada uno tiene id y appliesWhen. No los reescribas. Puede venir vacía.
		- steps: los errores de UN mensaje, ya partidos. Cada step tiene index, before (la frase anterior), after (la frase con ese único problema arreglado) y reason (la pista de este step, en ${native}).
		- reason describe ESA frase. No la copies como appliesWhen: el appliesWhen es el hueco que seguiría siendo cierto en otra frase.

		Reutilizar un id:
		- Solo si appliesWhen se cumple entero en ese step.
		- Que cambien las demás palabras no importa. Otra conjugación sigue siendo el mismo hábito si la regla dice "cualquier forma".
		- Si para decir que sí hay que ampliar el appliesWhen, no reutilices.
		- Ante la duda, crea una identidad nueva.

		Al crear:
		- appliesWhen: una oración en español. Nombra el hueco, no los sustantivos de esta frase. La pieza ancla va en lema, con "cualquier forma" si las conjugaciones son el mismo hábito. Incluye el gobernador cuando dos piezas parecidas son hábitos distintos ("want" entra, "need" no). Cita entre comillas la pieza de ${target}.
		- Si la única redacción es una categoría suelta ("artículos", "tiempos", "preposiciones"), está ancha: nombra la pieza de este step.
		- label: lo que ve el usuario, en ${native}, máximo 12 palabras. El hábito, no el nombre de la regla. Mal: "infinitive complement". Bien: el hueco, con la palabra de ${target} entre comillas.

		Dos steps de este mensaje que son el mismo hueco comparten una sola entrada de created y el mismo createdIndex. Dos huecos distintos son dos entradas.

		Salida:
		- created: solo las identidades nuevas, en orden. Vacío si todos los steps reutilizan.
		- assignments: un ítem por step, con el mismo index. identityId es un id de la entrada, o null. createdIndex es la posición en created, o null. Exactamente uno de los dos es null. No inventes ids.

		Texto plano: sin markdown, sin emojis.

		Responde SOLO con este JSON:
		{"created":[{"label":"...","appliesWhen":"..."}],"assignments":[{"index":0,"identityId":null,"createdIndex":0}]}

		Antes de responder, revisa:
		- Cada step de la entrada tiene un assignment con su index.
		- Ningún assignment tiene identityId y createdIndex a la vez, ni los dos null.
		- Cada identityId existe en identities.
		- Cada createdIndex apunta a created, y cada entrada de created se usa.
		- appliesWhen está en español; label está en ${native}.
		Si algo falla, reescribe.
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
		name: 'error_identity',
		strict: false,
		schema: z.toJSONSchema(outputSchema, { io: 'input' })
	}
};
