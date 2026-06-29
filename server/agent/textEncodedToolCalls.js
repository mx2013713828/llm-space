function normalizeDsmlText(text) {
  return String(text || '').replaceAll('｜', '|').trim();
}

function parseParameterValue(rawValue, stringFlag) {
  const value = String(rawValue ?? '').trim();
  if (stringFlag !== 'false') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && value !== '') {
    return numeric;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseTextEncodedToolCalls(text) {
  const normalized = normalizeDsmlText(text);
  const envelope = /^<\|\|DSML\|\|tool_calls>\s*([\s\S]*?)\s*<\/\|\|DSML\|\|tool_calls>$/u.exec(normalized);
  if (!envelope) return null;

  const body = envelope[1];
  const calls = [];
  const invokeRegex = /<\|\|DSML\|\|invoke\s+name="([^"]+)">\s*([\s\S]*?)\s*<\/\|\|DSML\|\|invoke>/gu;
  let invokeMatch;
  while ((invokeMatch = invokeRegex.exec(body)) !== null) {
    const [, name, invokeBody] = invokeMatch;
    const input = {};
    const parameterRegex = /<\|\|DSML\|\|parameter\s+name="([^"]+)"(?:\s+string="([^"]+)")?\s*>([\s\S]*?)<\/\|\|DSML\|\|parameter>/gu;
    let parameterMatch;
    while ((parameterMatch = parameterRegex.exec(invokeBody)) !== null) {
      const [, parameterName, stringFlag, rawValue] = parameterMatch;
      input[parameterName] = parseParameterValue(rawValue, stringFlag);
    }

    calls.push({ name, input });
  }

  return calls.length > 0 ? calls : null;
}

export function isToolEnabled(tools = [], toolName) {
  return tools.some(tool => {
    if (typeof tool === 'string') return tool === toolName;
    return tool?.name === toolName;
  });
}
