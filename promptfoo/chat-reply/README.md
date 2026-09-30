# Eval: chat reply

Runs the prompt in `src/lib/prompts/chat-reply/v1/prompt.ts` against OpenAI. The yaml does not duplicate the system prompt: `prompt.ts` calls `buildPrompt` with each test's `vars` and sets the JSON schema.

The scene shape is `contextSchema` in `src/lib/prompts/chat-reply/v1/context.ts`. Correction prompts can import that same schema when they need the scene.

## Setup

Set `OPENAI_API_KEY` and `LLM_MODEL` in `.env` (see `.env.example`). Do not put them in the yaml.

## Run

From any directory in the repo:

```sh
npm run eval:chat-reply
```

Same as `promptfoo eval -c promptfoo/chat-reply/promptfooconfig.yaml --env-file .env`.

To browse the history of every eval (not just this one):

```sh
npm run eval:view
```

## Add a case

In `promptfooconfig.yaml`, a test is the same `Input` that `buildPrompt` expects. `context` is the scene (`you`, `partner`, `shared`, `private`, `want`).

```yaml
tests:
  - vars:
      nativeLanguage: en
      targetLanguage: es
      context:
        you: Eres un aprendiz. Hablas como tú mismo.
        partner: Eres un compañero de práctica. Siempre respondes y cierras con una pregunta.
        shared: No hay lugar ni trama.
        private: No tienes información que el aprendiz desconozca.
        want: Practicar el idioma.
      turns:
        - role: user
          content: Hi, I want to practice for my trip
```

Edit the prompt (rules, few-shot) in `src/lib/prompts/chat-reply/v1/prompt.ts`. The scene shape lives in `v1/context.ts`. If the eval fails, change the prompt, not the yaml, unless the case itself is wrong.
