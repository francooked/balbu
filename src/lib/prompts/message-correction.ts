import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionUserMessageParam,
	ChatCompletionSystemMessageParam,
	ResponseFormatJSONSchema
} from 'openai/resources';
import { LANGUAGE_CODES } from '$lib/constants';
import dedent from 'dedent';
import * as z from 'zod';
import { normalizeText } from '$lib/correction/normalize-text';
import {
	buildLanguageRules,
	languageName,
	selectExamples,
	takeLastTurns,
	type LanguageCode,
	type LanguagePair
} from './utils';

// How many turns of context the corrector sees. Only the last user message is corrected.
const CONTEXT_TURNS = 3;

/** Free practice. The catalog preset says the same: the learner's own tone is the correction's tone. */
export const practiceScene = {
	you: 'Eres un aprendiz. Te expresas como tú mismo, en el tono que elijas.',
	shared:
		'No hay lugar ni trama. El tema lo pone quien habla y puede cambiar. La conversación dura lo que el aprendiz quiera.',
	want: 'Practicar el idioma. No hay una meta que dé por cerrada la conversación.'
};

// Forms the target language accepts side by side. Without these the model treats a valid
// variant as an error, cannot produce a rewrite that differs from the original, and loops.
const FREE_VARIANTS: Record<LanguageCode, string> = {
	es: '"a donde" y "adonde", "quizá" y "quizás", "hubiera" y "hubiese", "lo quiero hacer" y "quiero hacerlo"',
	en: '"toward" y "towards", "learned" y "learnt", "cannot" y "can not", el "that" opcional en "I think (that) she left"'
};

export const inputSchema = z
	.object({
		nativeLanguage: z.enum(LANGUAGE_CODES),
		targetLanguage: z.enum(LANGUAGE_CODES),
		// What the user meant to say, written in their native language. Optional: only some
		// messages carry it, and it exists to disambiguate the last user message.
		intent: z.string().trim().min(1).optional(),
		// Who the user is, where they are, and what they want. The tone lives in `you`.
		scene: z.object({
			you: z.string().trim().min(1),
			shared: z.string().trim().min(1),
			want: z.string().trim().min(1)
		}),
		turns: z.array(z.object({ role: z.enum(['assistant', 'user']), content: z.string() }))
	})
	.refine(({ nativeLanguage, targetLanguage, turns }) => {
		const alternating = turns.every(({ role }, index) =>
			index % 2 === 0 ? role === 'user' : role === 'assistant'
		);
		// A one-shot thread has no partner, so every turn is the user.
		const onlyUser = turns.length > 0 && turns.every(({ role }) => role === 'user');
		return nativeLanguage !== targetLanguage && (alternating || onlyUser);
	});

export const outputSchema = z
	.object({
		steps: z.array(
			z.object({
				sentence: z
					.string()
					.trim()
					.min(1)
					.transform((sentence) => normalizeText(sentence)),
				reason: z.string().min(1)
			})
		),
		translation: z.string().min(1)
	})
	// A step that repeats the previous sentence fixed nothing. It means the model insisted on
	// finding an error it could not name instead of answering with an empty list.
	.refine(
		({ steps }) =>
			steps.every((step, index) => index === 0 || step.sentence !== steps[index - 1].sentence),
		{ error: 'every step must change the sentence it comes from' }
	);

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
				writeSentencesIn: languageName(input.targetLanguage),
				writeReasonsAndTranslationIn: languageName(input.nativeLanguage),
				...(input.intent ? { intent: input.intent } : {}),
				scene: input.scene,
				turns: takeLastTurns(input.turns, CONTEXT_TURNS)
			})
		}
	];
	if (output) turns.push({ role: 'assistant', content: JSON.stringify(output) });
	return turns;
};

const drafted: Array<{
	input: Omit<Input, 'scene'> & { scene?: Input['scene'] };
	output: Output;
}> = [
	// nativeLanguage: en, targetLanguage: es
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Hola, quiero practicar mi español' },
				{ role: 'assistant', content: '¡Perfecto! ¿Planeaste tu viaje con tiempo?' },
				{ role: 'user', content: 'Sí, haberlo planear la año pasada' }
			]
		},
		output: {
			steps: [
				{
					sentence: 'Sí, lo planeé la año pasada',
					reason:
						'to say it already happened you need the past tense "lo planeé", not "haberlo planear"'
				},
				{
					sentence: 'Sí, lo planeé el año pasado',
					reason: '"año" is masculine, so it takes "el" and "pasado"'
				}
			],
			translation: 'Yes, I planned it last year'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Te aviso cuando llegue' },
				{ role: 'assistant', content: '¿No es muy tarde para llamarte?' },
				{ role: 'user', content: 'llámame cuando sea, no hay problema' }
			]
		},
		output: {
			steps: [],
			translation: 'Call me whenever, it is not a problem'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Quiero hablar de viajes' },
				{ role: 'assistant', content: '¿A dónde te gustaría viajar?' },
				{ role: 'user', content: 'Yo gustaría ir chile este verano' }
			]
		},
		output: {
			steps: [
				{
					sentence: 'Me gustaría ir chile este verano',
					reason: '"gustar" takes an indirect pronoun: "me gustaría", not "yo gustaría"'
				},
				{
					sentence: 'Me gustaría ir a chile este verano',
					reason: '"ir" needs the preposition "a" before a destination'
				},
				{
					sentence: 'Me gustaría ir a Chile este verano',
					reason: 'in Spanish, country names always start with a capital letter'
				}
			],
			translation: 'I would like to go to Chile this summer'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Tengo una hermana' },
				{ role: 'assistant', content: '¿Cómo es ella?' },
				{ role: 'user', content: 'Mis hermana son muy alto y trabaja en un hospital' }
			]
		},
		output: {
			steps: [
				{
					sentence: 'Mi hermana es muy alto y trabaja en un hospital',
					reason: 'one sister is singular, so it is "mi hermana es", not "mis hermana son"'
				},
				{
					sentence: 'Mi hermana es muy alta y trabaja en un hospital',
					reason: '"alta" is the feminine form, needed for "hermana"'
				}
			],
			translation: 'My sister is very tall and works at a hospital'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Hola' },
				{ role: 'assistant', content: '¡Hola! ¿Conoces a alguien en la fiesta?' },
				{ role: 'user', content: 'No, soy muy aburrido a esta fiesta, no conozco nadie' }
			]
		},
		output: {
			steps: [
				{
					sentence: 'No, estoy muy aburrido a esta fiesta, no conozco nadie',
					reason: 'use "estoy" for how you feel now; "soy aburrido" means you are a boring person'
				},
				{
					sentence: 'No, estoy muy aburrido en esta fiesta, no conozco nadie',
					reason: 'use "en" for being inside a place, not "a"'
				},
				{
					sentence: 'No, estoy muy aburrido en esta fiesta, no conozco a nadie',
					reason: '"conocer" needs "a" before a person, also with "nadie"'
				}
			],
			translation: "No, I am very bored at this party, I don't know anyone"
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			turns: [
				{ role: 'user', content: 'Fui a la playa con mi familia' },
				{ role: 'assistant', content: '¿Qué tal el clima?' },
				{ role: 'user', content: 'Estuvo despejado casi todo el día' }
			]
		},
		output: {
			steps: [],
			translation: 'It was clear almost all day'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			intent: 'I want to say I feel ashamed about what I said at dinner',
			turns: [{ role: 'user', content: 'Estoy embarazada por lo que dije en la cena' }]
		},
		output: {
			steps: [
				{
					sentence: 'Estoy avergonzada por lo que dije en la cena',
					reason: '"embarazada" means pregnant; for feeling ashamed Spanish uses "avergonzada"'
				}
			],
			translation: 'I am ashamed about what I said at dinner'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			intent:
				'I want to tell my landlord the heating has not worked since Monday and someone has to come fix it',
			turns: [{ role: 'user', content: 'La calefacción no funciona desde el lunes' }]
		},
		output: {
			steps: [],
			translation: 'The heating has not worked since Monday'
		}
	},
	// nativeLanguage: es, targetLanguage: en
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [
				{ role: 'user', content: 'Hi, I want to practice English' },
				{ role: 'assistant', content: 'Sure! Did you plan your trip in advance?' },
				{ role: 'user', content: 'Yes, I have plan it the last year' }
			]
		},
		output: {
			steps: [
				{
					sentence: 'Yes, I planned it the last year',
					reason: 'con "last year" va pasado simple: "planned", no "have plan"'
				},
				{
					sentence: 'Yes, I planned it last year',
					reason: 'la expresión "last year" va sin "the" delante'
				}
			],
			translation: 'Sí, lo planeé el año pasado'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [
				{ role: 'user', content: 'I had a rough week at work' },
				{ role: 'assistant', content: 'Any plans to unwind this weekend?' },
				{ role: 'user', content: "i'd rather stay in and watch something" }
			]
		},
		output: {
			steps: [],
			translation: 'Prefiero quedarme en casa y ver algo'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [
				{ role: 'user', content: 'I live with my brother' },
				{ role: 'assistant', content: 'Does he work or study?' },
				{ role: 'user', content: "He don't works, he study at university" }
			]
		},
		output: {
			steps: [
				{
					sentence: "He doesn't work, he study at university",
					reason: 'con "he" el auxiliar es "doesn\'t" y el verbo queda sin "s"'
				},
				{
					sentence: "He doesn't work, he studies at university",
					reason: 'en presente, con "he" el verbo lleva "s": "studies"'
				}
			],
			translation: 'Él no trabaja, estudia en la universidad'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [{ role: 'user', content: 'Yesterday I go to the store and buy two bread' }]
		},
		output: {
			steps: [
				{
					sentence: 'Yesterday I went to the store and bought two bread',
					reason: '"yesterday" obliga a pasado en los dos verbos: "went" y "bought"'
				},
				{
					sentence: 'Yesterday I went to the store and bought two loaves of bread',
					reason: '"bread" es incontable: se cuenta como "loaves of bread"'
				}
			],
			translation: 'Ayer fui a la tienda y compré dos panes'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [
				{ role: 'user', content: 'What do you think about the plan?' },
				{ role: 'assistant', content: 'It looks solid to me. Are you happy with it?' },
				{ role: 'user', content: 'i dont know what to say honestly what do you think' }
			]
		},
		output: {
			steps: [
				{
					sentence: "i don't know what to say honestly what do you think",
					reason: 'las contracciones llevan apóstrofo: "dont" se escribe "don\'t"'
				},
				{
					sentence: "i don't know what to say, honestly. What do you think?",
					reason: 'sin coma ni punto las dos ideas quedan pegadas y cuesta leerlas'
				}
			],
			translation: 'No sé qué decir, honestamente. ¿Tú qué piensas?'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			turns: [
				{ role: 'user', content: 'I had a long day at work' },
				{ role: 'assistant', content: 'What kept you so busy?' },
				{ role: 'user', content: 'I spent the whole morning in meetings' }
			]
		},
		output: {
			steps: [],
			translation: 'Pasé toda la mañana en reuniones'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			intent: 'Quiero avisarle a mi jefe que iré a la reunión más tarde',
			turns: [{ role: 'user', content: 'I will assist to the meeting later' }]
		},
		output: {
			steps: [
				{
					sentence: 'I will attend the meeting later',
					reason: '"assist" significa ayudar; ir a una reunión es "attend" y va sin "to"'
				}
			],
			translation: 'Iré a la reunión más tarde'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			intent:
				'Quiero decirle a un amigo que estoy cansado y que prefiero quedarme en casa esta noche en vez de salir',
			turns: [{ role: 'user', content: "i'm tired, i'd rather stay in tonight" }]
		},
		output: {
			steps: [],
			translation: 'Estoy cansado, prefiero quedarme en casa esta noche'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			scene: {
				you: 'Escribes el mensaje de un commit. Hablas técnico y semi-formal, en una línea y en imperativo.',
				shared: 'Es un repositorio de software. No hay conversación.',
				want: 'Decir qué cambió el commit.'
			},
			turns: [{ role: 'user', content: 'I fixed the login bug' }]
		},
		output: {
			steps: [
				{
					sentence: 'Fix the login bug',
					reason: 'En un mensaje de commit el verbo va en imperativo, no en pasado.'
				}
			],
			translation: 'Arregla el bug del inicio de sesión'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			scene: {
				you: 'Escribes el mensaje de un commit. Hablas técnico y semi-formal, en una línea y en imperativo.',
				shared: 'Es un repositorio de software. No hay conversación.',
				want: 'Decir qué cambió el commit.'
			},
			turns: [{ role: 'user', content: 'Fix the login bug' }]
		},
		output: {
			steps: [],
			translation: 'Arregla el bug del inicio de sesión'
		}
	}
];

export const examples: Example[] = drafted.map((example) => ({
	output: example.output,
	input: { ...example.input, scene: example.input.scene ?? practiceScene }
}));

const buildSystemPrompt = ({ nativeLanguage, targetLanguage }: LanguagePair): string => {
	const target = languageName(targetLanguage);
	const native = languageName(nativeLanguage);

	return dedent`
		Eres un corrector de idiomas en un chat de práctica. Corriges SOLO el último mensaje del usuario.

		${buildLanguageRules({ nativeLanguage, targetLanguage })}

		Tu primera decisión es si hay algo que corregir.
		- Si el mensaje no rompe ninguna regla de ${target} ni el tono que describe "you", "steps" es una lista vacía y terminaste. Es el caso más común: la mayoría de los mensajes ya están bien.
		- Si rompe alguna, "steps" son las reescrituras que la arreglan, cambiando lo mínimo necesario.

		Ante la duda, "steps" va vacío. Corregir algo que ya estaba bien confunde al usuario más que dejar pasar un error.

		"intent" es lo que el usuario quería expresar, escrito en ${native}. A veces no viene; entonces te guías solo por el mensaje y los turnos anteriores.
		- Sirve para desambiguar: cuando el mensaje admite dos lecturas, elige la corrección que coincide con esa intención.
		- Si una palabra o una estructura hace que el mensaje diga otra cosa (un falso amigo, un verbo equivocado), eso SÍ es un error: arréglalo y explica en "reason" qué significa de verdad lo que escribió y qué palabra dice lo que quería, sin mencionar la intención.
		- Eso vale aunque la palabra exista y la frase sea correcta en ${target}: una frase impecable que dice otra cosa igual falla.
		- No es un texto para traducir. Nunca copies sus palabras ni agregues datos que estén en la intención pero no en el mensaje.
		- Que el mensaje diga la intención con otras palabras, más corto o más simple, no es un error. El tono lo marca "you": si el mensaje ya suena así, déjalo.

		"scene" siempre viene. Es la situación de este hilo.
		- "you": quién escribe y en qué tono. La corrección queda en ese tono.
		- "shared": dónde está y qué está pasando.
		- "want": qué busca con el mensaje.
		- Si el mensaje no suena como dice "you", eso sí se corrige, en un paso.
		- No reescribas la frase entera para que suene más elegante. El paso toca solo lo que no cumple el tono que "you" describe.

		Nada de esto es un error, y con esto "steps" va vacío:
		- ${target} admite varias formas y el usuario eligió una: ${FREE_VARIANTS[targetLanguage]}. Si la forma que escribió existe, déjala.
		- Una expresión hecha o coloquial que en ${target} se dice así, aunque palabra por palabra suene raro.
		- Algo que tú dirías de otra manera. Tu preferencia no es un error.
		- El punto final, la mayúscula inicial y las comas opcionales: en un chat no se exigen. No los agregues ni los quites.
		- Un mensaje corto o sin sujeto explícito, si se entiende con los turnos anteriores y suena como dice "you".

		Sí corrige lo que cambia la lectura: ¿?, ¡!, tildes que distinguen dos palabras, apóstrofos, y la separación cuando dos ideas independientes quedan pegadas sin coma ni punto. Si separas con punto, la palabra que sigue va con mayúscula; la primera del mensaje no.

		Qué es un paso:
		- Un paso arregla UN problema del mensaje, nada más.
		- Un problema puede necesitar varios cambios a la vez: si corregir una palabra OBLIGA a cambiar otra (concordancia de género o número, conjugación, pronombre, auxiliar o preposición que pide ese verbo), esos cambios van juntos en el MISMO paso.
		- Una cadena de concordancia es UN solo problema: si el número o el género de una palabra obliga a ajustar su artículo, su verbo o su adjetivo, todo eso va en el mismo paso. Por ejemplo, pasar de "dos libro nuevo" a "dos libros nuevos" es un solo paso.
		- Dos problemas independientes van en pasos distintos, aunque estén en palabras vecinas y aunque sean del mismo tipo.
		- Nunca juntes en un paso un problema de verbo con uno de concordancia. Si el mensaje tiene tres problemas, entrega tres pasos.
		- Un paso toca UNA sola frase: el grupo de palabras alrededor de un mismo sustantivo o de un mismo verbo. Si los cambios de un paso caen en dos frases distintas, divídelo en dos pasos.
		- "sentence" es el texto del paso anterior con ese único problema arreglado. Todo lo demás queda EXACTAMENTE igual, incluidos los errores que corriges en pasos siguientes.
		- Cada paso cambia algo: su "sentence" nunca puede ser idéntica al texto del que viene. Si ibas a escribir un paso y te queda igual que el mensaje original, es que no había error: devuelve "steps" vacío.
		- Los pasos intermedios pueden seguir teniendo errores. Solo el último paso debe estar correcto.

		Orden de los pasos, de mayor a menor impacto:
		1. Lo que impide entender la idea: verbo, tiempo verbal, estructura, palabra equivocada.
		2. Lo que se entiende pero está mal: concordancia, artículos, preposiciones, pronombres.
		3. Lo cosmético: tildes, apóstrofos, mayúsculas, puntuación.

		"reason":
		- Una oración completa en ${native}, entre 6 y 15 palabras, sobre el cambio de ESE paso.
		- Explica la regla del idioma, no la operación: nunca escribas "cambiar X por Y" ni "corregir X", y nunca uses etiquetas sueltas como "concordancia de plural".
		- Los términos gramaticales van en ${native}. Lo único que puede estar en ${target} son las palabras citadas entre comillas.
		- Si el paso existe por el tono que describe "you", nombra esa situación.
		- Texto plano: sin markdown, sin numeración.

		Límites:
		- No cambies el significado, y no agregues información que el usuario no escribió. Cambia una palabra cuando, según "intent", dice algo distinto de lo que el usuario quería. El tono de la versión final es el que describe "you".
		- Los mensajes anteriores son solo contexto: nunca los corrijas.
		- Máximo 5 pasos. Si hay más problemas, junta todos los cosméticos en un solo paso final.
		- Cada "sentence" está en ${target}. Cada "reason" y la "translation" están en ${native}, sin una sola palabra del otro idioma fuera de comillas.

		"translation": traducción a ${native} de la versión final corregida (o del mensaje original si no hubo cambios).

		Responde con este JSON y nada más. Escríbelo una sola vez, de corrido, sin volver atrás:
		{"steps":[{"sentence":"...","reason":"..."}],"translation":"..."}
	`;
};

export const buildPrompt = (
	input: z.infer<typeof inputSchema>
): (
	| ChatCompletionSystemMessageParam
	| ChatCompletionUserMessageParam
	| ChatCompletionAssistantMessageParam
)[] => [
	{ role: 'system', content: buildSystemPrompt(input) },
	...selectExamples(examples, input).flatMap((example) => buildFewShot(example)),
	...buildFewShot({ input })
];

export const responseFormat: ResponseFormatJSONSchema = {
	type: 'json_schema' as const,
	json_schema: {
		name: 'message_correction',
		strict: false,
		schema: z.toJSONSchema(outputSchema, { io: 'input' })
	}
};
