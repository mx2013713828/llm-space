function getActualType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function isTypeMatch(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expectedType;
}

export function validateToolInput(tool, input = {}) {
  if (!tool) {
    return {
      ok: false,
      code: 'unknown_tool',
      message: 'Unknown tool.',
      details: {},
    };
  }

  const params = tool.parameters || {};
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  for (const [name, spec] of Object.entries(params)) {
    const expectedType = spec.type || 'string';
    const hasValue = Object.hasOwn(value, name) && value[name] !== undefined && value[name] !== null;

    if (spec.required && !hasValue) {
      return {
        ok: false,
        code: 'missing_required_parameter',
        message: `${tool.name} requires parameter "${name}".`,
        details: { parameter: name, expectedType },
      };
    }

    if (hasValue && !isTypeMatch(value[name], expectedType)) {
      return {
        ok: false,
        code: 'invalid_parameter_type',
        message: `${tool.name} parameter "${name}" must be ${expectedType}.`,
        details: {
          parameter: name,
          expectedType,
          actualType: getActualType(value[name]),
        },
      };
    }
  }

  return { ok: true };
}
