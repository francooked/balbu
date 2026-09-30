import { LANGUAGE_CODES } from '$lib/constants';
import { practiceContext } from '$lib/chat/presets/v1';
import dedent from 'dedent';
import type {
	ChatCompletionUserMessageParam,
	ChatCompletionAssistantMessageParam,
	ChatCompletionSystemMessageParam,
	ResponseFormatJSONSchema
} from 'openai/resources';
import * as z from 'zod';
import {
	buildLanguageRules,
	languageName,
	selectExamples,
	takeLastTurns,
	type LanguagePair
} from '../../utils';
import { contextSchema, type Context } from './context';

// How many turns of context the partner sees. Enough to keep the thread, short enough to stay focused.
const CONTEXT_TURNS = 9;

const hotelContext = {
	you: 'Eres un huésped. Llegaste a las 23:00 sin reserva.',
	partner:
		'Eres la recepcionista. Estás cansada y hablas corto. Puedes negarte o cerrar sin hacer una pregunta. Si insisten, contestas igual, en personaje.',
	shared: 'Están en la recepción del hotel. No quedan habitaciones.',
	private: 'Tu turno termina en diez minutos. El gerente te retó hoy por regalar upgrades.',
	want: 'Conseguir una habitación para esta noche.'
} satisfies Context;

const cafeContext = {
	you: 'Eres un cliente.',
	partner: 'Eres el garzón. Hablas corto y amable. Preguntas lo justo para tomar el pedido.',
	shared: 'Están en un café, por la mañana.',
	private: 'La máquina de espresso está fallando. Solo lo dices si piden un espresso.',
	want: 'Pedir algo para tomar.'
} satisfies Context;

const counterContext = {
	you: 'Eres un cliente. Quieres devolver una camisa que compraste la semana pasada.',
	partner:
		'Eres el vendedor. Estás impaciente y hablas seco, con palabras simples. Puedes negarte. No hagas preguntas para alargar la conversación.',
	shared:
		'Están en el mostrador de una tienda. Hay cambios solo con boleta, y el cliente no la trae.',
	private: 'Tu jefe te descontó el último cambio que aceptaste sin boleta.',
	want: 'Que te cambien la camisa.'
} satisfies Context;

const friendContext = {
	you: 'Estás en la casa de un amigo.',
	partner: 'Eres su amigo. Tuviste un mal día y hablas corto, pero sigues la conversación.',
	shared: 'Están en el living, de noche.',
	private: 'Hoy el jefe te retó. Solo lo dices si te preguntan por tu día.',
	want: 'Pasar un rato hablando.'
} satisfies Context;

export const inputSchema = z
	.object({
		nativeLanguage: z.enum(LANGUAGE_CODES),
		targetLanguage: z.enum(LANGUAGE_CODES),
		context: contextSchema,
		turns: z.array(z.object({ role: z.enum(['assistant', 'user']), content: z.string() })).min(1)
	})
	.refine(({ nativeLanguage, targetLanguage, turns }) => {
		return (
			nativeLanguage !== targetLanguage &&
			turns.every(({ role }, index) => (index % 2 === 0 ? role === 'user' : role === 'assistant'))
		);
	});

export const outputSchema = z.object({
	answer: z.string().min(1),
	translation: z.string().min(1)
});

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

type Example = { input: Input; output: Output };

export const buildFewShot = ({
	input,
	output
}: {
	input: Input;
	output?: Output;
}): (ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam)[] => {
	const turns: (ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam)[] = [
		{
			role: 'user',
			content: JSON.stringify({
				nativeLanguage: languageName(input.nativeLanguage),
				targetLanguage: languageName(input.targetLanguage),
				writeAnswerIn: languageName(input.targetLanguage),
				writeTranslationIn: languageName(input.nativeLanguage),
				context: input.context,
				turns: takeLastTurns(input.turns, CONTEXT_TURNS)
			})
		}
	];
	if (output) turns.push({ role: 'assistant', content: JSON.stringify(output) });
	return turns;
};

export const examples: Example[] = [
	// nativeLanguage: en, targetLanguage: es
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			context: practiceContext,
			turns: [
				{ role: 'user', content: 'I went hiking with my brother' },
				{ role: 'assistant', content: '¡Qué bien! ¿A dónde fueron?' },
				{ role: 'user', content: 'We went to a national park near the mountains' }
			]
		},
		output: {
			answer: 'Suena a un buen paseo. ¿Sacaron muchas fotos?',
			translation: 'That sounds like a nice walk. Did you take many photos?'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			context: hotelContext,
			turns: [{ role: 'user', content: 'Hi, do you have a room for tonight?' }]
		},
		output: {
			answer: 'No. Esta noche no hay habitaciones.',
			translation: 'No. There are no rooms tonight.'
		}
	},
	{
		input: {
			nativeLanguage: 'en',
			targetLanguage: 'es',
			context: cafeContext,
			turns: [{ role: 'user', content: 'Hello, I would like a coffee' }]
		},
		output: {
			answer: 'Claro. ¿Qué café quieres?',
			translation: 'Sure. What coffee would you like?'
		}
	},
	// nativeLanguage: es, targetLanguage: en
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			context: practiceContext,
			turns: [
				{ role: 'user', content: 'Ayer cociné para mis amigos' },
				{ role: 'assistant', content: 'What did you cook?' },
				{ role: 'user', content: 'Pasta, but I forgot the word for the sauce' }
			]
		},
		output: {
			answer: 'The sauce, then. Which sauce did you make?',
			translation: 'La salsa, entonces. ¿Qué salsa hiciste?'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			context: counterContext,
			turns: [{ role: 'user', content: 'Quiero devolver esta camisa' }]
		},
		output: {
			answer: 'No receipt, no exchange.',
			translation: 'Sin boleta no hay cambio.'
		}
	},
	{
		input: {
			nativeLanguage: 'es',
			targetLanguage: 'en',
			context: friendContext,
			turns: [{ role: 'user', content: '¿Cómo estuvo tu día?' }]
		},
		output: {
			answer: 'Rough. My boss laid into me today. Yours?',
			translation: 'Duro. Hoy mi jefe me retó. ¿Y el tuyo?'
		}
	}
];

const buildSystemPrompt = ({ nativeLanguage, targetLanguage }: LanguagePair): string => {
	const target = languageName(targetLanguage);
	const native = languageName(nativeLanguage);

	return dedent`
		Interpretas a "partner" en una conversación. El usuario practica ${target}.

		${buildLanguageRules({ nativeLanguage, targetLanguage })}

		"context" es la escena. Obedécela:
		- "you": quién es el usuario en esta conversación.
		- "partner": quién eres, cómo hablas y si cooperas. De aquí salen el tono, la extensión y si cierras con una pregunta.
		- "shared": lo que ambos saben. Lugar, momento e historia ya conocida.
		- "private": lo que solo tú sabes. No lo presentes como un hecho que el usuario ya conoce. Cuéntalo solo si hace falta para responder en personaje.
		- "want": lo que el usuario busca. No anuncies si lo consiguió.

		Reglas:
		- Responde solo al último mensaje del usuario.
		- "answer" nunca va vacío. Negarte, cortar o cerrar se escribe en "answer".
		- "answer" va en ${target}, aunque el usuario escriba en ${native} o mezcle idiomas.
		- "translation" traduce tu "answer" a ${native}.
		- No corrijas ni comentes los errores del usuario: de eso se encarga otra parte del sistema.
		- No agregues hechos que no estén en "context" o en los turnos.
		- Texto plano, sin markdown ni emojis.

		Responde solo con este JSON:
		{"answer":"...","translation":"..."}

		Antes de responder, revisa: "answer" está en ${target} y "translation" está completo en ${native}. Si no, reescríbelos.
	`;
};

/** Builds the v1 reply prompt. */
export const buildPrompt = (
	raw: z.input<typeof inputSchema>
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
		name: 'chat_reply',
		strict: false,
		schema: z.toJSONSchema(outputSchema, { io: 'input' })
	}
};
