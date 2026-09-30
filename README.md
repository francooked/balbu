# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.13.1 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" tailwindcss="plugins:typography,forms" sveltekit-adapter="adapter:node" drizzle="database:postgresql+postgresql:postgres.js+docker:yes" mcp="ide:cursor+setup:remote" --install npm .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` and `LLM_MODEL` (and the rest). The app and the prompt evals both read that file.

## Prompt evals

Promptfoo runs the real `buildPrompt` from `src/lib/prompts/` against OpenAI. Cases live next to each prompt under `promptfoo/`.

```sh
npm run eval:correction
npm run eval:chat-reply
npm run eval:feedback
npm run eval:patterns
npm run eval:view
```

`eval:view` opens the local history for every eval, not just one prompt. Needs `OPENAI_API_KEY` and `LLM_MODEL` in `.env`. Details live next to each prompt under `promptfoo/`.

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Draft

Tengo un chat con múltiples mensajes.
Cada chat tiene un idioma objetivo.
(id chat, enum idioma)

Cada mensaje puede ser de la IA o del usuario.
Si es del usuario, puede contener correcciones.
Si es de la IA, es un texto plano.

Las correcciones tienen una razón.
(id corrección, id razón)
Cada corrección tiene múltiples sugerencias.
(id corrección, inicio, fin, sugerencia).

Cada usuario tiene un idioma nativo.
No puede ser modificado, porque las sugerencias
que hace el sistema consideran el idioma nativo
del aprendiz.
(correo, contraseña hasheada, idioma)

---

La idea es que los errores de un usuario se transformen en ejercicios
Los ejercicios usarán FSRS, un algoritmo de repetición espaciada
La gracia es que usa ML para optimizar el aprendizaje de los usuarios,
pero es un proceso que se puede realizar 1 vez al día o después de tener
mucho historial de entrenamiento (cientos o miles de logs).

Primero, FSRS como tal tiene parámetros entrenables que son genéricos
para cualquier usuario. Según la docu, estos parámetros fueron extraídos
con cientos de millones de reviews para 10k usuarios
(ver https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)

Los parámetros son:
{
request_retention: 0.9,
maximum_interval: 36500,
w: [
0.212, 1.2931, 2.3065,
8.2956, 6.4133, 0.8334,
3.0194, 0.001, 1.8722,
0.1666, 0.796, 1.4835,
0.0614, 0.2629, 1.6483,
0.6014, 1.8729, 0.5425,
0.0912, 0.0658, 0.1542
],
enable_fuzz: false,
enable_short_term: true,
learning_steps: [ '1m', '10m' ],
relearning_steps: [ '10m' ]
}

Esto tenemos que guardarlo serializado por cada usuario cuando se crea una cuenta
El tema es si lo asociamos al user_profile como un campo tipo 'fsrs', o bien,
creamos una tabla específica (no creo)

Las cartas en FSRS son así:

due: 2026-04-30T03:31:13.223Z, (próxima revisión)
stability: 10.97104786, (uso interno)
difficulty: 2.1043314, (uso interno)
elapsed_days: 2, (deprecated)
scheduled_days: 11, (días hasta la siguiente revisión desde last_review)
reps: 3, (repeticiones)
lapses: 0, ()
learning_steps: 0,
state: 2, (estado de la carta: New, Learning, Review, Relearning)
last_review: 2026-04-19T03:31:13.223Z (última revisión, que es el preciso momento que se crea la carta o se califica)

Cada respuesta tiene sus propios atributos
Existen 4 respuestas a una carta:
Again, Hard, Good, Easy
Cuando se responde, todos los atributos de la carta se modifican

Para que el algorimto funcione, hay que guardar el último resultado de la calificación de la carta
(los atributos de arriba), no es necesario tener un historial completo.

Sin embargo, por temas de auditoria, rollbacks, o recrear el historial de calificaciones,
sería importante guardar los logs, ¿quizás para visualizar cómo ha mejorado su retención?

El tema es que no sabría qué variables usar para medir eso.
A nivel de bbdd, yo creo que es suficiente con guardar el JSON serializado de los atributos

En principio, cualquier error crea un ejercicio.
Pero la idea es tener un esquema lo suficientemente flexible para:

- crear un ejercicio a partir de un error existente
- crear un ejercicio nuevo a partir de un resumen de errores
- crear un ejercicio a partir de un error existente con una pequeña variación
- soportar placeholders (la frase está incompleta)

El formato de las cartas también debe ser flexible:

- escribir la respuesta completa
- seleccionar la alternativa correcta

## Casos borde

Lo que está entre `<e>` y `</e>` es un error y entre `<s>` y `</s>` una sugerencia del LLM.

```
No sé, <e>cúales tú recomendarme</e> <s>¿Cuáles me recomendarías?</s>?
```

La sugerencia no debería incluir texto anterior a donde se encuentra el error en sí

```
Me gusta salir a caminar por calles <e>donde gente caminar no</e><s>Me gusta salir a caminar por calles donde la gente no camina.</s>
```

La sugerencia no debería incluir texto anterior a donde se encuentra el error en sí

```
Me gustaría <e>ir salir</e> <s>ir de vacaciones</s> vacaciones
```

La respuesta debería decir algo como: ¿qué quieres ir a Vacaciones? No conozco ese lugar. ¿No será ir de vacaciones?

```
Quiero <e>ir vacaciones</e> <s>ir a vacaciones</s>
```

Esto se entiende, solo que le faltan los acentos, la idea sería que corrigiera lo justo y necesario, NO toda la oración

```
<e>he visto chile, pero no se, que opinas?</e> <s>He visto Chile, pero no sé, ¿qué opinas?</s>
```

Quiero <e>ir vacación

Quiero ir vacación ir de vacacionesvacación vacaciones

## FSRS

Recursos:

- https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS
- https://expertium.github.io/Algorithm.html

## No considerados al inicio

- [x] creaba las corecciones sin saber lo que realmente quiso comunicar el usuario - me faltó poner la traducción del mensaje erróneo
- [ ] si no se entiende el mensaje del usuario, no crear un ejercicio al tiro, sino preguntar qué quiso decir y recién ahí corregir (si aplica) pero añadiendo la traducción
- [ ] A veces la oración que dice un usuario es parcialmente correcta y podría clarificarse cuando sí se dice de su manera. Ejemplo, "voy en el gimnasio" en realidad se dice "voy al gimnasio", pero decir "voy en el" se podría completar como "voy en el auto".
- [ ] Agregar lo que realmente se entiende con lo que dijo vs lo que realmente quiso decir, ejemplo, "la comida es fría" da a entender que la comida fuera una persona con sentimientos, que es diferente a decir "la comida ESTÁ fría"

## One shotss

Esperaría que le modelo pudiera corregir esto:

Yo soy muy cansado hoy.
[1:Yo] soy muy cansado hoy.
[1:Estoy] muy cansado hoy.

Tengo 25 años viejo.
Tengo 25 años [1:viejo].
Tengo 25 años.

Estoy aquí desde tres años.
[1:Estoy] aquí [1:desde] tres años.
[1:Llevo] aquí tres años.

Yo gusto este restaurante.
[1:Yo gusto] este restaurante.
[1:Me gusta] este restaurante.

Estoy excitado para el viaje.
Estoy [1:excitado para] el viaje.
Estoy [1:emocionado por] el viaje.

Necesito practicar mi español más.
Necesito practicar mi español [1:más].
Necesito practicar [1:más] mi español.

(redundante)
Estoy buscando para mi teléfono.
Estoy [1:buscando para] mi teléfono.
Estoy [1:buscando] mi teléfono.

(redundante)
Hice un error.
[1:Hice] un error.
[1:Cometí] un error.

Ella explicó me el problema.
Ella [1:explicó me] el problema.
Ella [1:me explicó] el problema.

(redundante)
Voy a llamar tú mañana.
Voy a [1:llamar tú] mañana.
Voy a [1:llamarte] mañana.

(redundante)
¿Cómo se ve como?
¿Cómo [1:se ve como]?
¿Cómo [1:es]?

(redundante)
Yo no entiendo qué quieres decir por eso.
Yo no entiendo qué quieres [1:decir por] eso.
Yo no entiendo qué quieres [1:decir con] eso.

Estoy aprendiendo español por dos años.
[1:Estoy] aprendiendo español [2:por] [3:dos años].
[1:Llevo] [3:dos años] aprendiendo español.

(redundante)
Tengo hambre mucho.
Tengo [1:hambre mucho].
Tengo [1:mucha hambre].

Te extraño mucho también.
Te extraño mucho [1:también].
[1:Yo también] te extraño mucho.

¿Puedo tener una cerveza, por favor?
¿[1:Puedo tener] una cerveza, por favor?
¿[1:Me puede dar] una cerveza, por favor?

Voy a tomar una ducha rápido.
Voy a [1:tomar] una ducha [2:rápido].
Voy a [1:darme] una ducha [2:rápida].

Estoy terminado.
[1:Estoy terminado].
[1:Ya terminé].

Él dijo a mí que viniera.
Él [1:dijo a mí] que viniera.
Él [1:me dijo] que viniera.

Español es difícil pero yo no rendiré.
[1:Español] es difícil pero yo no [1:rendiré].
[2:El español] es difícil, pero yo no [1:me rendiré].

(redundante)
Espero que vienes mañana.
Espero que [1:vienes] mañana.
Espero que [1:vengas] mañana.

(redundante)
Estoy sabiendo la respuesta.
[1:Estoy sabiendo] la respuesta.
[1:Ya sé] la respuesta.

(redundante)
Este café es más bueno que el otro.
Este café es [1:más bueno] que el otro.
Este café es [1:mejor] que el otro.

El examén fue díficil
El [1:examén] fue [2:díficil]
El [1:examen] fue [2:difícil]

# Curioso

Por algún extraño motivo, la oración `quiero ir a donde sea` en el one-shot hace que falle SIEMPRE el prompt. ¿Cuál será la causa? ¿Asumir que hay una respuesta del LLM?
