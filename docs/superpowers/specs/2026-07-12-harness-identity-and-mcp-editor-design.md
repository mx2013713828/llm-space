# Harness Identity And MCP Editor UX Design

## Goal

Make Harness identity consistent across Harness Explorer, Knowledge, and MCP Studio, and make MCP create/edit a focused workspace rather than stacking a form above the selected server detail.

## Scope

- Define stable Harness identity semantics for `id`, `name`, and physical filename.
- Normalize Harness list/create/copy API behavior without renaming existing files.
- Add one shared frontend presentation model for Harness labels.
- Use that presentation in Harness Explorer, Knowledge, and MCP Studio.
- Replace MCP detail with the editor while create/edit is active.

Out of scope:

- Renaming physical Harness JSON files.
- Changing Harness IDs after creation.
- Migrating session, memory, task, knowledge, or MCP mount directory names.
- A general Harness settings redesign.

## Identity Model

### `id`

`id` is the immutable machine identity. It remains the key for routes, sessions, guidance, memory, task data, Knowledge mounts, and MCP mounts. It is generated at creation and cannot be edited later.

### `name`

`name` is the user-facing display name. It may be edited and is the primary label in every UI surface. It must not include storage-only `.json` semantics.

### `filename`

`filename` is physical storage metadata. The Harness list API may expose it for diagnostics, but ordinary UI does not use it as the display label. Existing physical filenames remain unchanged.

## Compatibility

Some previously created Harness records may have a `name` ending in `.json` because creation mixed display identity with storage. Reads normalize only that legacy shape by removing one trailing `.json` for presentation and API responses. The next explicit Harness save persists the normalized display name.

Existing meaningful names such as `Basic Chatbot` remain unchanged. No file is renamed, so all ID-keyed runtime data and existing paths remain valid.

## Backend Changes

The Harness list response becomes:

```js
{
  id: 'chat-bot',
  name: 'Basic Chatbot',
  filename: '01-chat-bot.json',
  description: '...',
  category: 'basic'
}
```

Creation stores a display name in `harness.name` and chooses a storage filename independently from the stable ID. The default filename is `<id>.json`; collisions remain explicit errors.

Copying creates a unique immutable ID and a readable display name such as `Basic Chatbot Copy`. Its filename is derived from the new ID rather than stored in `name`.

A small identity normalization module owns these rules so routes and UI do not duplicate filename stripping or fallbacks.

## Shared Frontend Presentation

A pure helper produces:

```js
{
  id: 'chat-bot',
  name: 'Basic Chatbot',
  primary: 'Basic Chatbot',
  secondary: 'chat-bot'
}
```

Fallback order is `name -> id -> "No harness selected"`. Long primary labels remain one line with ellipsis and expose the complete value through `title`.

Surfaces use it consistently:

- Harness Explorer: primary `name`, secondary `id`, then description.
- Knowledge header: compact Harness identity with `name` and `id`, separated from the numeric metrics.
- MCP header: the same compact Harness identity component and typography as Knowledge.

## MCP Editor State

MCP Studio has three mutually exclusive detail states:

- `detail`: selected server runtime, tools, mount, policies, and call history.
- `create`: blank server editor.
- `edit`: selected server editor populated from configuration.

Entering `create` or `edit` replaces the complete right detail pane. The existing server detail is not rendered underneath it. `Cancel` returns to the previous selected server detail. Saving selects the saved server and returns to `detail`. Deleting remains available only from `detail`.

The left server list remains visible for orientation. Selecting another server while editing cancels the draft and opens the selected server detail; unsaved form state is discarded because the current editor has no draft persistence contract.

## UI Direction

Keep the existing restrained, workbench-like dark interface. The editor gets a compact title bar with mode, server identity, Save, and Cancel. It uses the full right pane width and does not appear as a card stacked inside another detail view.

Harness identity chips use a stable two-line layout:

- small uppercase `Current Harness` label;
- display name with ellipsis;
- monospace ID below.

The chip has fixed minimum/maximum width so long names cannot reflow neighboring metrics.

## Error Handling

- Invalid or duplicate generated IDs remain server-side validation errors.
- Missing display names fail creation rather than falling back to a filename.
- UI save failures keep the editor and draft visible.
- A missing current Harness renders the shared empty identity state without layout movement.

## Testing

- Identity unit tests cover display-name normalization, immutable ID generation, storage filename generation, and copy naming.
- Harness route tests verify list responses contain distinct `name` and `filename` values and creation persists display names.
- Frontend presentation tests cover normal, legacy `.json`, missing, and long-name cases.
- MCP editor state tests cover create/edit/detail transitions and cancel/save behavior through extracted pure state helpers.
- Production build and browser screenshots verify MCP editor replacement and consistent Harness identity across Explorer, Knowledge, and MCP.

## Acceptance Criteria

1. MCP Add/Edit never displays the previous server detail beneath the editor.
2. Save and Cancel return to the correct selected server detail.
3. Harness Explorer, Knowledge, and MCP display the same Harness name and ID.
4. Harness display names never expose `.json` because of storage implementation.
5. IDs remain stable when names change.
6. Existing filenames and ID-keyed runtime resources are not renamed or migrated.
7. Long Harness names do not wrap or move neighboring layout elements.
