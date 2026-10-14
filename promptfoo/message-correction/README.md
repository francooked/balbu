# Eval: message correction

Runs the prompt in `src/lib/prompts/message-correction.ts` against OpenAI. The yaml does not duplicate the system prompt: `prompt.ts` calls `buildPrompt` with each test's `vars` and sets the JSON schema.

## Setup

Set `OPENAI_API_KEY` and `LLM_MODEL` in `.env` (see `.env.example`). Do not put them in the yaml.

## Run

From any directory in the repo:

```sh
npm run eval:correction
```

Same as `promptfoo eval -c promptfoo/message-correction/promptfooconfig.yaml --env-file .env`.

To browse the history of every eval (not just this one):

```sh
npm run eval:view
```

## Add a case

In `promptfooconfig.yaml`, a test is the same `Input` that `buildPrompt` expects:

```yaml
tests:
  - vars:
      nativeLanguage: es
      targetLanguage: en
      scene:
        you: Escribes un mensaje suelto, sin una conversación delante. Te expresas como tú mismo, en el tono que elijas.
        shared: No hay lugar ni trama. Es un mensaje aislado.
        want: Decir lo que el mensaje ya intenta decir.
      turns:
        - role: user
          content: Yesterday I go to the store
```

Edit the prompt (rules, few-shot, schema) in `src/lib/prompts/message-correction.ts`. If the eval fails, change that file, not the yaml, unless the case itself is wrong.
