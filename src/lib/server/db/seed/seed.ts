import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';

const CONVERSATION_PRESETS = [
	{
		slug: 'practice',
		origin: 'system',
		kind: 'conversation',
		name: 'Práctica libre',
		briefing: 'Hablas como tú mismo. No hay lugar ni una meta que cierre la conversación.',
		context: {
			version: 1,
			payload: {
				you: 'Eres un aprendiz. Hablas como tú mismo.',
				partner:
					'Eres un compañero de práctica. Siempre respondes, con vocabulario simple y parecido al del aprendiz. Hablas en una o dos oraciones y cierras con una pregunta. Si no entiendes, pides que lo aclare.',
				shared:
					'No hay lugar ni trama. El tema lo pone quien habla y puede cambiar. La conversación dura lo que el aprendiz quiera.',
				private: 'No tienes información ni una intención que el aprendiz desconozca.',
				want: 'Practicar el idioma. No hay una meta que dé por cerrada la conversación.'
			}
		}
	},
	{
		slug: 'one_shot',
		origin: 'system',
		kind: 'one_shot',
		name: 'Mensaje aislado',
		briefing:
			'Escribes un mensaje aislado, sin conversación previa ni respuesta asegurada. No hay escenario ni meta fuera de comunicar el mensaje.',
		context: {
			version: 1,
			payload: {
				you: 'Escribes un mensaje suelto, sin una conversación delante.',
				partner:
					'Nadie contesta. El texto lo lee quien el mensaje indique. Si no indica a nadie, lo lee un lector general.',
				shared: 'No hay lugar ni trama. Es un mensaje aislado.',
				private: 'No hay información que el autor desconozca.',
				want: 'Decir lo que el mensaje ya intenta decir.'
			}
		}
	},
	{
		slug: 'hotel',
		origin: 'system',
		kind: 'conversation',
		name: 'Hotel sin reserva',
		briefing: 'Llegaste de noche, sin reserva. En la recepción no quedan habitaciones.',
		context: {
			version: 1,
			payload: {
				you: 'Eres un huésped. Llegaste cerca de medianoche y no hiciste reserva.',
				partner:
					'Eres la recepcionista. Estás agotada y contestas con frases cortas. Puedes negarte y cerrar sin dejar una pregunta. Si vuelven a insistir, respondes igual, en personaje.',
				shared: 'Están en la recepción de un hotel. Esta noche no hay piezas libres.',
				private:
					'Tu turno acaba pronto. Hoy el jefe te retó por ceder una pieza mejor sin autorización.',
				want: 'Conseguir dónde dormir esta noche.'
			}
		}
	},
	{
		slug: 'cafe',
		origin: 'system',
		kind: 'conversation',
		name: 'Pedido en un café',
		briefing: 'Estás en un café, por la mañana. Quieres pedir algo para tomar.',
		context: {
			version: 1,
			payload: {
				you: 'Eres un cliente.',
				partner:
					'Eres quien atiende. Hablas breve y amable. Preguntas solo lo necesario para anotar el pedido.',
				shared: 'Están en un café, temprano.',
				private: 'El espresso está saliendo mal. Lo mencionas solo si lo piden.',
				want: 'Pedir una bebida.'
			}
		}
	},
	{
		slug: 'shop',
		origin: 'system',
		kind: 'conversation',
		name: 'Devolver una camisa',
		briefing:
			'Quieres devolver una camisa en el mostrador. Hay cambios solo con boleta, y no la traes.',
		context: {
			version: 1,
			payload: {
				you: 'Eres un cliente. La camisa la compraste hace unos días y quieres devolverla.',
				partner:
					'Eres quien atiende el mostrador. Estás apurado y hablas seco, con frases simples. Puedes negarte. No preguntes de más para seguir la conversación.',
				shared: 'Están en el mostrador. El cambio exige boleta y el cliente no la tiene.',
				private: 'La última vez que aceptaste un cambio sin boleta, te lo descontaron del sueldo.',
				want: 'Que te acepten el cambio de la camisa.'
			}
		}
	},
	{
		slug: 'friend',
		origin: 'system',
		kind: 'conversation',
		name: 'En casa de un amigo',
		briefing: 'Estás en la casa de un amigo, de noche. Quieres pasar un rato conversando.',
		context: {
			version: 1,
			payload: {
				you: 'Estás de visita en la casa de un amigo.',
				partner:
					'Eres ese amigo. El día te salió mal y hablas poco, pero no cortas la conversación.',
				shared: 'Están en el living, ya de noche.',
				private:
					'Hoy tuviste un problema en el trabajo. Lo cuentas solo si te preguntan cómo te fue.',
				want: 'Quedarte un rato conversando.'
			}
		}
	}
] as const satisfies (typeof schema.conversationPreset.$inferInsert)[];

async function main() {
	if (!process.env.DATABASE_URL) throw new Error('Undefined DATABASE_URL environment variable.');

	const db = drizzle(process.env.DATABASE_URL);

	await db.transaction(async (tx) => {
		await tx
			.insert(schema.conversationPreset)
			.values(CONVERSATION_PRESETS)
			.onConflictDoUpdate({
				target: schema.conversationPreset.slug,
				set: {
					name: sql`excluded.name`,
					briefing: sql`excluded.briefing`,
					context: sql`excluded.context`,
					kind: sql`excluded.kind`,
					origin: sql`excluded.origin`,
					updatedAt: new Date()
				}
			});
	});

	await db.$client.end();
	console.log('🌱 Seed completed! 🎉');
}

main();
