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

function hasHarnessId(existingHarnesses, id) {
  return existingHarnesses.some(harness => harness?.id === id);
}

function hasHarnessName(existingHarnesses, name) {
  return existingHarnesses.some(harness => harness?.name === name);
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
  const id = slugifyHarnessId(name);
  assertValidHarnessId(id);
  assertHarnessIdAvailable(existingHarnesses, id);

  const filename = `${name}.json`;
  if (hasHarnessName(existingHarnesses, filename)) {
    throw createHttpError(409, 'Harness filename already exists.');
  }

  return {
    id,
    name: filename,
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
  };
}

export function createCopiedHarnessDraft({ source, existingHarnesses = [] }) {
  if (!source?.id || !source?.name) {
    throw createHttpError(400, 'Source harness is invalid.');
  }

  const baseId = `${source.id}-copy`;
  const baseName = source.name.replace(/\.json$/, '');

  let suffix = '';
  let index = 1;
  let id = baseId;
  let name = `${baseName}-copy.json`;

  while (hasHarnessId(existingHarnesses, id) || hasHarnessName(existingHarnesses, name)) {
    index += 1;
    suffix = `-${index}`;
    id = `${baseId}${suffix}`;
    name = `${baseName}-copy${suffix}.json`;
  }

  return {
    ...source,
    id,
    name,
    description: `${source.description || ''} (副本)`,
  };
}
