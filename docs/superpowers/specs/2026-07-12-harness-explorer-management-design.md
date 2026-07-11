# Harness Explorer Management UX Design

**Status:** Implemented on 2026-07-12. Automated verification is complete; final browser interaction acceptance remains with the user because localhost browser automation is blocked by the host policy.

## Goal

Turn Harness Explorer into a focused local Harness manager with clear creation, metadata editing, duplication, deletion, and scan-friendly presentation while keeping full runtime configuration in Prompt Lab.

## Scope

- Extract Harness Explorer from `App.jsx` into focused components.
- Improve list density, hierarchy, selection, and action discoverability.
- Add shared Create, Edit, and Duplicate dialogs.
- Replace native delete confirmation with an application dialog.
- Add narrow backend APIs for metadata updates and configurable duplication.

Out of scope:

- Editing model, tools, prompts, features, skills, or execution strategy from Explorer.
- Changing an existing Harness ID.
- Renaming physical Harness JSON files.
- Adding folders, tags, search, drag sorting, or remote synchronization.
- Creating a separate Harness management page.

## Responsibility Boundary

Harness Explorer owns identity-level management:

- display name;
- description;
- immutable ID visibility;
- create, duplicate, and delete actions;
- active Harness selection.

Prompt Lab remains the owner of runtime behavior and full Harness configuration.

## Layout

The Explorer becomes a fixed `272px` desktop sidebar. It contains three stable regions:

1. Header with title, refresh icon button, and create icon button.
2. Scrollable Harness list.
3. Compact footer showing `<count> harnesses` and `local workspace`.

The existing User Guide footer is removed. The sidebar remains hidden at the existing narrow-screen breakpoint; this work does not add mobile optimization.

## Harness Row

Each row uses a stable three-line hierarchy:

- display name as the primary line;
- immutable ID in small monospace text;
- description as a single ellipsized line.

Rows do not show the physical filename. A selected row uses a subtle blue background, a one-pixel left accent, and stronger primary text. Hover reveals one icon-only overflow button. There is no separate inline delete button.

Clicking the row selects the Harness. Clicking the overflow button opens the action menu without changing selection. Right-clicking a row opens the same menu at the pointer position.

## Action Menu

The shared menu contains:

- Edit details
- Duplicate
- Delete

Delete is visually separated and uses the danger tone. The menu closes after an action, outside click, Escape, or route change.

## Shared Harness Dialog

One controlled dialog supports three modes:

### Create

- Empty name and description.
- Generated ID preview updates from the name.
- Primary action: `Create Harness`.

### Edit

- Existing name and description.
- Immutable ID shown as read-only metadata, not an editable input.
- Primary action: `Save Changes`.

### Duplicate

- Name defaults to `<source name> Copy`.
- Description defaults to the source description.
- Generated target ID preview updates from the edited name.
- Primary action: `Duplicate Harness`.

The dialog preserves entered values after a server validation error. Cancel, backdrop click, and Escape close it only when a request is not in flight.

## Delete Confirmation

Delete uses a focused confirmation dialog showing the display name and immutable ID. It states that the Harness configuration and its persisted session will be removed. The destructive button is disabled while the request is running.

After deleting the active Harness, the application selects the next available Harness using the post-delete list order. If none remain, it returns to the empty route.

## Backend API

### Update metadata

```http
PATCH /api/harnesses/:id/metadata
Content-Type: application/json

{
  "name": "Research Harness",
  "description": "Focused research workflow"
}
```

The route locates the existing file by immutable ID, validates a non-empty normalized display name, updates only `name` and `description`, preserves every other field, and does not rename the file.

Response:

```js
{
  success: true,
  harness: { id, name, description },
  filename
}
```

### Duplicate

The existing endpoint remains:

```http
POST /api/harnesses/:id/copy
```

It accepts optional `name` and `description`. When `name` is supplied, the target immutable ID and filename are generated from that name and must be unique. When omitted, the existing automatic `<source> Copy` behavior remains compatible.

The duplicate copies the complete source Harness configuration, then replaces only `id`, `name`, and `description`. Runtime data such as sessions, memory, tasks, Knowledge mounts, and MCP mounts is not copied.

## Frontend Architecture

`HarnessExplorer` receives data and event callbacks rather than owning application routing:

```js
<HarnessExplorer
  harnesses={harnessFiles}
  activeHarnessId={activeHarnessId}
  busy={harnessMutationBusy}
  onSelect={selectHarness}
  onRefresh={loadHarnessList}
  onCreate={createHarness}
  onEdit={updateHarnessMetadata}
  onDuplicate={duplicateHarness}
  onDelete={deleteHarness}
/>
```

Supporting pure modules own dialog state and presentation rules. `App.jsx` remains responsible for API calls, active route transitions, and refreshing the loaded Harness after metadata changes.

## Error Handling

- Empty names are rejected in the dialog and server route.
- Generated ID collisions return HTTP 409 and keep the dialog open.
- Metadata updates for missing Harnesses return HTTP 404.
- Failed mutations display an inline dialog error instead of `alert()`.
- Refresh failures preserve the current visible list and show a compact Explorer error state.
- All mutation controls are disabled while their request is in flight.

## Accessibility And Interaction

- Icon-only controls have accessible names and tooltips.
- The action menu and dialogs use semantic buttons and headings.
- Escape closes menus and idle dialogs.
- Focus enters the name field when a Create/Edit/Duplicate dialog opens.
- Long names and descriptions expose full values through `title`.

## Testing

- Harness identity tests cover custom duplicate names and ID collisions.
- Harness route tests verify metadata updates preserve full configuration and files are not renamed.
- Pure Explorer state tests cover Create/Edit/Duplicate/Delete transitions and draft initialization.
- Presentation tests cover count labels and generated ID previews.
- Full test suite and production build remain green.
- Manual desktop verification covers list scanning, menu placement, all dialogs, active deletion, and long text truncation.

## Acceptance Criteria

1. Explorer no longer renders an inline creation form or User Guide footer.
2. Create, Edit, and Duplicate use one consistent dialog experience.
3. Edit changes only name and description; ID and filename remain stable.
4. Duplicate supports a user-selected name and copies full Harness configuration only.
5. Every Harness row exposes Edit, Duplicate, and Delete through one overflow menu and right-click menu.
6. Delete uses an application confirmation dialog, not native `confirm()`.
7. Names, IDs, and descriptions remain readable without changing row dimensions.
8. App routing and active Harness selection remain correct after every mutation.

## Implementation Notes

- `HarnessExplorer` is now a standalone component; `App.jsx` owns only data loading, mutations, and navigation.
- Create, Edit, Duplicate, and Delete share the same controlled dialog system and preserve failed drafts.
- The metadata endpoint preserves immutable IDs, physical filenames, and all runtime configuration.
- The duplicate endpoint supports custom display metadata while keeping the original automatic-copy behavior.
- The list supports overflow and right-click menus, Escape dismissal, long-text truncation, refresh errors, and a compact local-workspace footer.
