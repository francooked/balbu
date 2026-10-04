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
npm run eval:identity
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

## FSRS

Recursos:

- https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS
- https://expertium.github.io/Algorithm.html

## No considerados al inicio

- [x] creaba las corecciones sin saber lo que realmente quiso comunicar el usuario - me faltó poner la traducción del mensaje erróneo
- [ ] si no se entiende el mensaje del usuario, no crear un ejercicio al tiro, sino preguntar qué quiso decir y recién ahí corregir (si aplica) pero añadiendo la traducción
- [ ] A veces la oración que dice un usuario es parcialmente correcta y podría clarificarse cuando sí se dice de su manera. Ejemplo, "voy en el gimnasio" en realidad se dice "voy al gimnasio", pero decir "voy en el" se podría completar como "voy en el auto".
- [ ] Agregar lo que realmente se entiende con lo que dijo vs lo que realmente quiso decir, ejemplo, "la comida es fría" da a entender que la comida fuera una persona con sentimientos, que es diferente a decir "la comida ESTÁ fría"

# Curioso

Por algún extraño motivo, la oración `quiero ir a donde sea` en el one-shot hace que falle SIEMPRE el prompt. ¿Cuál será la causa? ¿Asumir que hay una respuesta del LLM?

# Mejoras

1. Cualquier error es transformado inmediatamente en un ejercicio. Mejor agregar múltiples errores en un único ejercicio.
2. El usuario NO tiene control de los ejercicios que quiere ver en la plataforma. Mejor agregar una confirmación en cada chat (o en una vista dedicada).
3. Se pueden guardar ejercicios idénticos (no hay comprobación de duplicados).
4. Hace más sentido mostrar el `soundsLike` en los chats.
5. No hay formas de incrementar el vocabulario del usuario. Si en un chat contextualizado quiere hablar de autos, sería ideal partir con un vocabulario adhoc.
6. Las retroalimentaciones también podrían sugerir nuevas palabras a aprender o frases para ampliar el vocabulario.
