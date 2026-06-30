export function summarizeTeamState(state) {
  const teammates = Object.values(state?.teammates ?? {})
    .map(teammate => {
      const summary = {
        agentId: teammate.agentId,
        name: teammate.name ?? teammate.agentId,
        role: teammate.role ?? null,
        state: teammate.state ?? 'unknown',
        prompt: teammate.prompt,
        brief: teammate.brief,
        startedAt: teammate.startedAt,
        completedAt: teammate.completedAt,
        lastResult: teammate.lastResult,
        error: teammate.error,
        phase: teammate.phase,
        currentAction: teammate.currentAction,
        currentTool: teammate.currentTool,
        toolCount: teammate.toolCount,
        previewTruncated: teammate.previewTruncated,
        traceRef: teammate.traceRef,
      };

      return Object.fromEntries(
        Object.entries(summary).filter(([, value]) => value !== undefined),
      );
    })
    .sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));

  return {
    teamId: state?.teamId,
    teammates,
  };
}

export async function emitTeamUpdate({ executor, stateStore, harnessId, teamId, fallbackTeammate }) {
  if (typeof executor?.onEvent !== 'function') return;

  let summary = null;
  if (typeof stateStore?.loadState === 'function') {
    const state = await stateStore.loadState({ harnessId, teamId });
    if (state) {
      summary = summarizeTeamState(state);
    }
  }

  if (!summary) {
    summary = summarizeTeamState({
      teamId,
      teammates: fallbackTeammate ? { [fallbackTeammate.agentId]: fallbackTeammate } : {},
    });
  }

  executor.onEvent('team_update', summary);
}
