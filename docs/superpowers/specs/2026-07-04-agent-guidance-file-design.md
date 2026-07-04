# AGENTS.md Guidance File Design

## Goal

Move the editable base system prompt out of harness JSON and into a first-class Explicit Guidance file named `AGENTS.md`.

## Scope

MVP supports one guidance file per harness:

```text
guidance/<harnessId>/AGENTS.md
```

The UI may continue to exchange a `systemPrompt` field for compatibility, but the backend treats that field as editable guidance content and persists it to `AGENTS.md`, not to `harnesses/*.json`.

## Behavior

- `GET /api/harnesses/:id` returns `systemPrompt` loaded from `guidance/<harnessId>/AGENTS.md`.
- If the guidance file does not exist, it is initialized from the legacy `harness.systemPrompt` value.
- `POST /api/harnesses/:id` writes `body.systemPrompt` to `guidance/<harnessId>/AGENTS.md`.
- The saved harness JSON excludes `systemPrompt` so large prompt text no longer lives in JSON.
- Runtime request assembly still receives `systemPrompt`, preserving the current AgentExecutor contract.
- The UI labels the editor as `AGENTS.md` / Agent Guidance and shows the file path.

## Naming

Use guidance-oriented names for new code:

- `loadAgentGuidance`
- `saveAgentGuidance`
- `hydrateHarnessGuidance`
- `guidanceRoot`
- `guidance.file`

Legacy `systemPrompt` remains only at API boundaries and existing executor interfaces.

## Out Of Scope

- Multi-file guidance composition.
- Root project `AGENTS.md` auto-discovery.
- User/global guidance inheritance.
- Removing `systemPrompt` from all internal runtime interfaces.

Those belong to later Explicit Guidance stages.
