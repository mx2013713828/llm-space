# Agent Teams MVP Implementation Plan

## Goal

Implement a lightweight Agent Teams MVP that lets the Lead agent spawn finite asynchronous teammates, exchange structured messages, and consume teammate results through the existing Task Orchestration surface.

The MVP must stay small enough for an experiment platform, while leaving clear extension points for future Team Protocols, autonomous idle loops, and worktree isolation.

## Architecture

Agent Teams builds on the existing Task Orchestration system instead of becoming a separate top-level feature.

- UI/config: `task_orchestration.enable_agent_teams`
- Lead tools: `spawn_teammate`, `send_team_message`, `check_team_inbox`
- Teammate tools: `send_team_message` plus ordinary atomic tools inherited from the parent
- Storage: local file-backed TeamBus under `server/sessions/<harnessId>_teams/<teamId>/`
- Runtime: finite async teammate runner using `AgentExecutor`
- Context injection: Team inbox messages are injected through a dedicated plugin in `preLLM`

The key design constraint is that Lead and Teammate need different orchestration tool profiles. The existing resolver only knows "orchestration enabled/disabled", so MVP adds an explicit runtime role:

```js
resolveOrchestrationTools(requestedTools, orchestration, {
  runtimeRole: 'lead' | 'teammate'
})
```

This prevents recursive delegation while still allowing teammates to call `send_team_message`.

## Tech Stack

- Node.js ESM
- Existing `AgentExecutor`, HookManager, tool registry, feature schema
- File-backed JSON/JSONL persistence with `fs.promises`
- Node test runner: `node --test`
- Existing React frontend feature schema rendering

## Global Constraints

- Keep the MVP local and finite: no infinite idle loop, no worktree creation, no permission protocol.
- Reuse Task Orchestration policy and UI grouping.
- Hide Teams-managed tools from Tools Mounting.
- Do not allow teammates to spawn teammates or use `sub_agent`, cron, task-system/todo planning, background task tools, or memory.
- Teammates must not mutate parent message history directly.
- All file writes must be scoped under `server/sessions`.
- Each implementation phase ends with tests and a git commit.

## Task 1: Add Agent Teams Feature Flag And Role-Aware Orchestration Policy

### Files

- `src/lib/FeatureSchema.js`
- `src/lib/FeatureSchema.test.js`
- `src/lib/taskOrchestration.js`
- `src/lib/taskOrchestration.test.js`
- `server/agent/AgentExecutor.js`
- `server/agent/AgentExecutor.orchestration.test.js`

### Tests First

Add tests that fail before implementation:

```js
test('lead gets team tools only when agent teams is enabled', () => {
  assert.deepEqual(
    resolveOrchestrationTools(['bash'], {
      enabled: true,
      mode: 'todo',
      enable_agent_teams: true,
    }),
    ['bash', 'write_todos', 'spawn_teammate', 'send_team_message', 'check_team_inbox']
  );
});

test('teammate only keeps team communication from orchestration tools', () => {
  assert.deepEqual(
    resolveOrchestrationTools([
      'bash',
      'write_todos',
      'spawn_teammate',
      'send_team_message',
      'check_team_inbox',
      'sub_agent',
    ], {
      enabled: true,
      mode: 'todo',
      enable_agent_teams: true,
    }, {
      runtimeRole: 'teammate',
    }),
    ['bash', 'send_team_message']
  );
});
```

Add an `AgentExecutor` test that constructs a teammate-role executor and verifies `this.tools` excludes planning/delegation tools while preserving `send_team_message`.

### Implementation

1. Add a `Delegation` child flag:

```js
enable_agent_teams: {
  type: 'boolean',
  section: 'Delegation',
  label: 'Enable Agent Teams',
  description: 'Allow the lead agent to spawn finite asynchronous teammates and exchange structured team messages.',
  defaultValue: false,
  failSafeValue: false,
}
```

2. In `taskOrchestration.js`, define explicit Teams groups:

```js
const TEAM_LEAD_TOOLS = ['spawn_teammate', 'check_team_inbox'];
const TEAM_COMMUNICATION_TOOLS = ['send_team_message'];
const TEAM_TOOLS = [...TEAM_LEAD_TOOLS, ...TEAM_COMMUNICATION_TOOLS];
```

3. Export a hidden/managed list that the UI can use to hide all Teams tools:

```js
export const TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES = [
  ...ORCHESTRATION_MANAGED_TOOL_NAMES,
  ...TEAM_TOOLS,
];
```

4. Update `resolveOrchestrationTools(requestedTools, orchestration, options)`:

- default `runtimeRole` is `'lead'`
- always remove hidden orchestration tools from user-requested tools first
- for `runtimeRole === 'teammate'`, return cleaned atomic tools plus `send_team_message` when requested
- for Lead, preserve current planning behavior and append Teams tools when `enable_agent_teams` is true

5. Extend `AgentExecutor` constructor:

```js
constructor({
  runtimeRole = 'lead',
  teamContext = null,
  ...
}) {
  this.runtimeRole = runtimeRole;
  this.teamContext = teamContext;
  this.tools = resolveOrchestrationTools(tools, orchestration, { runtimeRole });
}
```

### Verification

Run:

```bash
node --test src/lib/taskOrchestration.test.js src/lib/FeatureSchema.test.js server/agent/AgentExecutor.orchestration.test.js
```

### Commit

```bash
git add src/lib/FeatureSchema.js src/lib/FeatureSchema.test.js src/lib/taskOrchestration.js src/lib/taskOrchestration.test.js server/agent/AgentExecutor.js server/agent/AgentExecutor.orchestration.test.js
git commit -m "feat: add agent teams orchestration policy"
```

## Task 2: Add Team Message Envelope, Bus, And State Store

### Files

- `server/agent/teams/teamEnvelope.js`
- `server/agent/teams/teamEnvelope.test.js`
- `server/agent/teams/teamBus.js`
- `server/agent/teams/teamBus.test.js`
- `server/agent/teams/teamStateStore.js`
- `server/agent/teams/teamStateStore.test.js`

### Tests First

Cover:

- valid teammate names: `[A-Za-z0-9_-]{1,40}`
- invalid teammate names throw readable errors
- envelopes get `id`, `createdAt`, `teamId`, `from`, `to`, `type`, `payload`
- `sendMessage()` appends JSONL into the receiver inbox
- `readInbox()` consumes messages
- `peekInbox()` does not consume
- malformed JSONL lines are skipped and copied to `.bad`
- state store can create/update teammate status

Example test shape:

```js
test('readInbox consumes valid messages and preserves malformed lines in .bad', async () => {
  const bus = createTeamBus({ rootDir });
  await bus.sendMessage({
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });

  const messages = await bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(await bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'reviewer' }), []);
});
```

### Implementation

1. `teamEnvelope.js` exports:

```js
export const TEAM_MESSAGE_TYPES = new Set([
  'message',
  'result',
  'error',
  'status',
]);

export function validateAgentName(name) {}
export function createTeamId() {}
export function createTeammateId(name) {}
export function createMessageEnvelope(input) {}
```

2. `teamBus.js` exports:

```js
export function createTeamBus({ rootDir = path.join(process.cwd(), 'server', 'sessions') } = {}) {
  return {
    sendMessage,
    readInbox,
    peekInbox,
  };
}
```

3. `teamStateStore.js` exports:

```js
export function createTeamStateStore({ rootDir = path.join(process.cwd(), 'server', 'sessions') } = {}) {
  return {
    loadState,
    saveState,
    createTeam,
    upsertTeammate,
    updateTeammate,
  };
}
```

4. Store paths are centralized:

```js
server/sessions/${harnessId}_teams/${teamId}/inboxes/${agentId}.jsonl
server/sessions/${harnessId}_teams/${teamId}/state.json
```

### Verification

Run:

```bash
node --test server/agent/teams/*.test.js
```

### Commit

```bash
git add server/agent/teams
git commit -m "feat: add file backed team bus"
```

## Task 3: Add Teammate Profile And Finite Runner

### Files

- `server/agent/teams/teammateProfile.js`
- `server/agent/teams/teammateProfile.test.js`
- `server/agent/teams/teammateRunner.js`
- `server/agent/teams/teammateRunner.test.js`
- `server/agent/AgentExecutor.js`

### Tests First

Cover:

- teammate features disable memory and non-team orchestration features
- teammate tools remove all orchestration tools except `send_team_message`
- runner creates a child executor with `runtimeRole: 'teammate'`
- runner marks state `running` then `completed`
- runner sends a `result` message to Lead
- runner catches errors, marks `failed`, and sends an `error` message

Use a fake `ExecutorClass` to avoid real model calls:

```js
class FakeExecutor {
  constructor(args) {
    FakeExecutor.lastArgs = args;
    this.messages = [{ role: 'assistant', content: 'done' }];
  }

  async run() {}
}
```

### Implementation

1. `teammateProfile.js` mirrors the proven sub-agent profile but keeps team communication:

```js
export function createTeammateFeatures(parentFeatures) {
  const childFeatures = structuredClone(parentFeatures ?? {});
  childFeatures.task_orchestration = {
    ...(childFeatures.task_orchestration ?? {}),
    enabled: true,
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: true,
    enable_cron_scheduler: false,
  };
  childFeatures.enable_memory = {
    ...(childFeatures.enable_memory ?? {}),
    enabled: false,
  };
  return childFeatures;
}

export function selectTeammateTools(parentTools) {
  return [
    ...atomicParentTools,
    'send_team_message',
  ];
}
```

The role-aware resolver from Task 1 is what prevents `write_todos` from being mounted despite `task_orchestration.enabled: true`.

2. Add teammate system prompt:

```js
export function createTeammateSystemPrompt({ name, role }) {
  return [
    `You are teammate ${name}.`,
    role ? `Role: ${role}` : '',
    'You are an asynchronous teammate helping the Lead agent.',
    'Do not spawn agents, create scheduled jobs, or manage the Lead task board.',
    'Send important progress or final results to the Lead with send_team_message.',
    'When done, return a concise final answer.',
  ].filter(Boolean).join('\n');
}
```

3. `teammateRunner.js` exports:

```js
export async function runTeammate({
  parentExecutor,
  teamId,
  teammateId,
  name,
  role,
  initialPrompt,
  cwd = process.cwd(),
  maxTurns = 6,
  ExecutorClass = AgentExecutor,
  bus = defaultTeamBus,
  stateStore = defaultTeamStateStore,
}) {}
```

4. `runTeammate()` should:

- update teammate state to `running`
- instantiate `AgentExecutor` with `runtimeRole: 'teammate'`
- pass `teamContext: { teamId, agentId: teammateId, leadId: 'lead' }`
- pass selected tools and teammate features
- cap execution with existing loop parameters if available; if `AgentExecutor.run()` does not accept `maxTurns`, add a minimal optional `maxTurns` parameter in `AgentExecutor`
- send `result` or `error` envelope to Lead
- update teammate state to `completed` or `failed`

### Verification

Run:

```bash
node --test server/agent/teams/teammateProfile.test.js server/agent/teams/teammateRunner.test.js server/agent/AgentExecutor.orchestration.test.js
```

### Commit

```bash
git add server/agent/teams server/agent/AgentExecutor.js server/agent/AgentExecutor.orchestration.test.js
git commit -m "feat: add finite teammate runner"
```

## Task 4: Add Agent Teams Tools And Plugin

### Files

- `server/tools/spawn_teammate.js`
- `server/tools/send_team_message.js`
- `server/tools/check_team_inbox.js`
- `server/tools/ToolRegistry.js`
- `server/agent/plugins/TeamPlugin.js`
- `server/agent/plugins/TeamPlugin.test.js`
- `server/agent/AgentExecutor.js`

### Tests First

Cover plugin behavior:

- `spawn_teammate` validates name and starts `runTeammate()` without blocking the main loop
- `spawn_teammate` creates/updates team state
- `send_team_message` writes from Lead when no teammate context exists
- `send_team_message` writes from teammate when `executor.teamContext.agentId` exists
- `check_team_inbox` consumes Lead inbox and formats messages
- `preLLM` injects unread Team messages into context once, then consumes them
- Teams plugin is only active when `enable_agent_teams` is true for Lead, but remains active for `runtimeRole: 'teammate'` so teammates can send messages

### Implementation

1. Tool schemas are lightweight native tool definitions:

```js
export default {
  name: 'spawn_teammate',
  description: 'Spawn a finite asynchronous teammate for scoped work.',
  parameters: {
    name: { type: 'string', required: true, description: 'Stable teammate name.' },
    role: { type: 'string', required: false, description: 'Short role description.' },
    prompt: { type: 'string', required: true, description: 'Task prompt for the teammate.' },
    maxTurns: { type: 'number', required: false, description: 'Maximum teammate turns. Defaults to 6.' },
  },
  async execute() {
    throw new Error('spawn_teammate is handled by TeamPlugin');
  },
};
```

2. Register tools in `ToolRegistry`.

3. `TeamPlugin` handles these tools in `preToolUse`:

```js
const TEAM_TOOLS = new Set(['spawn_teammate', 'send_team_message', 'check_team_inbox']);

export function createTeamPlugin({ bus = defaultTeamBus, stateStore = defaultTeamStateStore, runTeammateFn = runTeammate } = {}) {
  return {
    name: 'TeamPlugin',
    async preLLM(context) {},
    async preToolUse(context) {},
  };
}

export const TeamPlugin = createTeamPlugin();
```

4. `spawn_teammate`:

- derive or create `teamId` from executor team context/session state
- create teammate id from validated name
- persist teammate state
- fire-and-forget `runTeammateFn(...).catch(...)`
- return immediately with `teamId`, `teammateId`, `status: running`

5. `send_team_message`:

- require `to` and `message`
- infer `from` from `executor.teamContext?.agentId ?? 'lead'`
- write envelope type `message`

6. `check_team_inbox`:

- reads and consumes Lead inbox
- returns a concise formatted list, or "No team messages."

7. `preLLM`:

- for Lead, consume unread inbox and push a system/context message such as:

```text
<team_inbox>
...
</team_inbox>
```

- Keep it short and structured; do not inject raw state.json.

8. Register plugin in `AgentExecutor`:

```js
if (this.runtimeRole === 'teammate' || isOrchestrationEnabled(orchestration, 'enable_agent_teams')) {
  this.hooks.register(TeamPlugin);
}
```

### Verification

Run:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/teams/*.test.js server/tools/*.test.js
```

If `server/tools/*.test.js` does not exist or is too broad, run only the added tests plus existing relevant tests.

### Commit

```bash
git add server/tools server/agent/plugins/TeamPlugin.js server/agent/plugins/TeamPlugin.test.js server/agent/AgentExecutor.js
git commit -m "feat: add agent teams tools"
```

## Task 5: Wire UI Visibility And Harness Defaults

### Files

- `src/pages/PromptLabPage.jsx`
- `src/lib/taskOrchestration.js`
- `src/lib/taskOrchestration.test.js`
- harness/config files touched by feature defaults, if any

### Tests First

Add or update tests that assert:

- Teams tools do not appear in Tools Mounting
- `enable_agent_teams` appears under Task Orchestration / Delegation
- disabling parent `task_orchestration.enabled` disables Teams child controls in UI while preserving child state

### Implementation

1. Replace UI hiding imports/usages from `ORCHESTRATION_MANAGED_TOOL_NAMES` to `TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES` where the Tools Mounting list is filtered.

2. Keep Teams as a child item under Task Orchestration, section `Delegation`, near Sub-agent Delegation.

3. Do not build a full dashboard in MVP. Existing trajectory/status events are enough.

4. If harness defaults are stored in JSON, add `enable_agent_teams: false` only where explicit defaults are already represented. Otherwise rely on schema parsing defaults.

### Verification

Run:

```bash
node --test src/lib/taskOrchestration.test.js src/lib/FeatureSchema.test.js
npm run build
```

Optionally start the dev server and inspect:

```bash
npm run dev
```

### Commit

```bash
git add src/pages/PromptLabPage.jsx src/lib/taskOrchestration.js src/lib/taskOrchestration.test.js src/lib/FeatureSchema.js src/lib/FeatureSchema.test.js
git commit -m "feat: expose agent teams orchestration option"
```

## Task 6: End-To-End Regression And Manual MVP Check

### Files

- Update docs only if the behavior needs a user-facing note:
  - `docs/superpowers/specs/2026-06-23-agent-teams-mvp-design.md`
  - optional short project doc if an existing experiment-feature doc exists

### Automated Verification

Run the full verification suite:

```bash
node --test server/**/*.test.js src/lib/*.test.js
npm run build
git diff --check
```

Run the policy scans used in previous phases:

```bash
rg -n "enable_sub_agents|enable_cron_scheduler|task_orchestration" server src
rg -n "spawn_teammate|send_team_message|check_team_inbox" server src
```

### Manual MVP Scenario

Use a harness with Task Orchestration enabled and Agent Teams enabled.

Prompt:

```text
请启动一个 teammate，名字叫 reviewer，角色是代码审查员。让它检查当前项目的 Task Orchestration 相关实现是否有明显风险。你自己继续等待并查询 team inbox，然后汇总 teammate 的结论。
```

Expected behavior:

- Lead calls `spawn_teammate`
- `spawn_teammate` returns immediately with running status
- teammate runs finite async work
- teammate can call ordinary read/search tools and `send_team_message`
- Lead can call `check_team_inbox`
- final Lead answer includes teammate result
- no recursive `spawn_teammate`, `sub_agent`, cron, or todo/task-system tools appear in teammate execution

### Commit

Only commit docs or small fixes discovered by verification:

```bash
git add <verified-files>
git commit -m "test: verify agent teams mvp"
```

If there are no code/doc changes after verification, do not create an empty commit.

## Future Evolution Map

### v2: Execution Strategy Layer

Add a higher-level strategy selector while preserving primitive-level experimentation.

Principle:

```text
Execution Strategy = explainable preset
Advanced Primitives = editable experimental components
Runtime Policy = final effective tool mounting
```

Initial presets:

- `Inline Execution`
- `Sequential Sub-agent Workflow`
- `Async Agent Teams`
- `Custom / Manual`

The presets should compose existing primitives instead of hiding them:

- `write_todo` / Task System for planning and tracking
- `sub_agent` for synchronous one-off delegation
- Agent Teams for async teammate collaboration
- reviewer roles as a reusable role pattern
- cron for scheduling when explicitly enabled

Selecting a preset writes recommended `task_orchestration` feature values. Users can still open the advanced primitive controls and modify the underlying switches. If a user edits any primitive after selecting a preset, the UI should show `modified` or `custom` rather than forcing the preset back into shape.

This keeps the platform experimental: users can start from a known-good orchestration pattern, then deliberately break it apart to test their own mode.

### v3: Team Protocols

Add message protocol semantics without changing TeamBus storage:

- `requestId` correlation
- `shutdown_request`, `shutdown_approved`, `shutdown_rejected`
- `permission_request`, `permission_response`
- `plan_approval_request`, `plan_approval_response`
- stricter formatting helpers for protocol messages

### v4: Autonomous Teams

Extend runner lifecycle:

- idle status
- teammate inbox polling
- `idle_notification`
- task auto-claim from task-system DAG
- bounded wakeups instead of infinite loops

### v5: Worktree Isolation

Extend teammate state:

- `cwd`
- `worktreePath`
- `branch`
- cleanup status

Then add worktree lifecycle tools around spawn/completion, without changing Lead-facing team message APIs.

## Execution Order

1. Feature flag and role-aware orchestration policy
2. File-backed TeamBus and state store
3. Teammate profile and finite runner
4. Teams tools and TeamPlugin
5. UI visibility and harness defaults
6. Full regression and manual MVP check

This order keeps the risky runtime pieces behind tested primitives and lets each phase produce a useful commit.
