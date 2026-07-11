function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function slugifyHarnessId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeHarnessDisplayName(value) {
  return String(value || '').trim().replace(/\.json$/i, '').trim();
}

export function getHarnessStorageFilename(id) {
  return `${String(id || '').trim()}.json`;
}

export function createHarnessSummary(harness = {}, filename = '') {
  return {
    id: String(harness.id || ''),
    name: normalizeHarnessDisplayName(harness.name) || String(harness.id || ''),
    filename: String(filename || ''),
    description: String(harness.description || ''),
    category: harness.category || 'basic',
  };
}

function hasHarnessId(existingHarnesses, id) {
  return existingHarnesses.some(harness => harness?.id === id);
}

function assertValidHarnessId(id) {
  if (!id) {
    throw createHttpError(400, 'Harness name must produce a valid Harness ID.');
  }
}

function assertHarnessIdAvailable(existingHarnesses, id) {
  if (hasHarnessId(existingHarnesses, id)) {
    throw createHttpError(409, `Harness ID already exists: ${id}`);
  }
}

export function createHarnessDraft({ name, description = '', existingHarnesses = [] }) {
  const displayName = normalizeHarnessDisplayName(name);
  const id = slugifyHarnessId(displayName);
  assertValidHarnessId(id);
  assertHarnessIdAvailable(existingHarnesses, id);

  return {
    filename: getHarnessStorageFilename(id),
    harness: {
      id,
      name: displayName,
      description,
      category: 'basic',
      model: {
        name: '',
        response_format: 'text',
        temperature: 1,
        max_tokens: 4096,
        top_p: 1,
      },
      tools: [],
      systemPrompt: '',
      skills: [],
    },
  };
}

export function createCopiedHarnessDraft({ source, existingHarnesses = [] }) {
  if (!source?.id || !source?.name) {
    throw createHttpError(400, 'Source harness is invalid.');
  }

  const baseId = `${source.id}-copy`;
  const baseName = normalizeHarnessDisplayName(source.name) || source.id;

  let suffix = '';
  let index = 1;
  let id = baseId;

  while (hasHarnessId(existingHarnesses, id)) {
    index += 1;
    suffix = `-${index}`;
    id = `${baseId}${suffix}`;
  }

  return {
    filename: getHarnessStorageFilename(id),
    harness: {
      ...source,
      id,
      name: `${baseName} Copy${index > 1 ? ` ${index}` : ''}`,
      description: `${source.description || ''} (副本)`,
    },
  };
}
