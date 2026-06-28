export function getSpawnCardTeammate(teamStatus, toolInput = {}) {
  const teammates = Array.isArray(teamStatus?.teammates) ? teamStatus.teammates : [];
  const requestedName = toolInput?.name;
  if (!requestedName) return null;

  return teammates.find(teammate =>
    teammate?.name === requestedName
    || teammate?.agentId === `teammate_${requestedName}`
    || teammate?.agentId === requestedName
  ) || null;
}
