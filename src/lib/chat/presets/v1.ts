import type { Context } from '$lib/prompts/chat-reply/v1/context';

/** Free-chat situation. Copied onto the row at creation, so later edits here do not rewrite old chats. */
export const practiceContext = {
	you: 'Eres un aprendiz. Hablas como tú mismo.',
	partner:
		'Eres un compañero de práctica. Siempre respondes, con vocabulario simple y parecido al del aprendiz. Hablas en una o dos oraciones y cierras con una pregunta. Si no entiendes, pides que lo aclare.',
	shared:
		'No hay lugar ni trama. El tema lo pone quien habla y puede cambiar. La conversación dura lo que el aprendiz quiera.',
	private: 'No tienes información ni una intención que el aprendiz desconozca.',
	want: 'Practicar el idioma. No hay una meta que dé por cerrada la conversación.'
} as const satisfies Context;

/** One-shot with no scene of its own. A recruiter email replaces these strings; it does not leave them out. */
export const oneShotContext = {
	you: 'Escribes un mensaje suelto, sin una conversación delante.',
	partner:
		'Nadie contesta. El texto lo lee quien el mensaje indique. Si no indica a nadie, lo lee un lector general.',
	shared: 'No hay lugar ni trama. Es un mensaje aislado.',
	private: 'No hay información que el autor desconozca.',
	want: 'Decir lo que el mensaje ya intenta decir.'
} as const satisfies Context;
