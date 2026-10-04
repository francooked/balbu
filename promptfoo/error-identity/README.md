# Eval: error identity

Runs the prompt in `src/lib/prompts/error-identity.ts` against OpenAI. The yaml does not duplicate the system prompt: `prompt.ts` calls `buildPrompt` with each test's `vars` and sets the JSON schema.

## Setup

Set `OPENAI_API_KEY` and `LLM_MODEL` in `.env` (see `.env.example`). Do not put them in the yaml.

## Run

From any directory in the repo:

```sh
npm run eval:identity
```

Same as `promptfoo eval -c promptfoo/error-identity/promptfooconfig.yaml --env-file .env`.

To browse the history of every eval (not just this one):

```sh
npm run eval:view
```

## Add a case

In `promptfooconfig.yaml`, a test is the same `Input` that `buildPrompt` expects. Assert the id that was reused, or that a new identity was opened. Do not assert the exact wording of `label` or `appliesWhen`.

Edit the prompt (rules, few-shot, schema) in `src/lib/prompts/error-identity.ts`. If the eval fails, change that file, not the yaml, unless the case itself is wrong.
