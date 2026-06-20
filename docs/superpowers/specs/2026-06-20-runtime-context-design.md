# Runtime Context Design

## Goal

Give every agent run a small, reliable description of its execution environment while keeping exact time dynamic and available only when needed.

## Runtime Metadata

Each `AgentExecutor` builds one immutable runtime-context snapshot when it is constructed. The snapshot is appended to the configured system prompt and reused by every LLM call in that executor run.

```xml
<runtime_context>
  <date>2026-06-20</date>
  <timezone>Asia/Shanghai</timezone>
  <operating_system>macOS</operating_system>
  <architecture>arm64</architecture>
  <working_directory>/absolute/project/path</working_directory>
</runtime_context>
```

The values come only from Node.js standard APIs:

- `date`: calendar date in the detected system timezone, formatted as `YYYY-MM-DD`.
- `timezone`: IANA timezone reported by `Intl.DateTimeFormat().resolvedOptions().timeZone`, with `UTC` as a fallback.
- `operating_system`: user-facing mapping of `process.platform` to `macOS`, `Linux`, or `Windows`; unknown values remain unchanged.
- `architecture`: `process.arch`.
- `working_directory`: `process.cwd()`.

XML-sensitive values are escaped before interpolation. If the configured system prompt is empty, the runtime block becomes the complete system prompt; otherwise it is separated from the configured prompt by a blank line. The configured Harness prompt and persisted session data are not modified.

## Lifecycle

Runtime metadata is generated once per `AgentExecutor`, which currently means once per user message or scheduled execution. It is not regenerated during tool loops. A new executor refreshes the date and any changed environment values automatically.

This deliberately treats the date as run-level context rather than conversation-level state. It prevents stale dates in conversations that span multiple days without adding session metadata.

## Exact-Time Tool

Add a parameterless `get_current_time` tool. It returns a structured JSON-compatible object containing:

```json
{
  "date": "2026-06-20",
  "time": "14:30:45",
  "timezone": "Asia/Shanghai",
  "iso": "2026-06-20T06:30:45.000Z"
}
```

The local date and time use the same detected timezone as runtime metadata. `iso` is the unambiguous UTC representation of the same instant. The tool reads the clock on every invocation.

`get_current_time` is a foundational built-in capability and is automatically added to every executor tool list. Harness files do not need to opt in, and duplicate registration is prevented.

## Boundaries

- Do not inject hours, minutes, or seconds into the system prompt.
- Do not persist runtime metadata in session JSON.
- Do not expose hostname, username, hardware model, or CPU details beyond architecture.
- Do not add a feature flag or third-party dependency.
- Do not change existing plugin-based system-prompt assembly.

## Verification

Unit tests cover platform naming, timezone-aware date formatting, XML escaping, system-prompt composition, one-time executor composition, current-time output, and automatic tool registration. The complete server test suite, lint, and production build must remain green.
