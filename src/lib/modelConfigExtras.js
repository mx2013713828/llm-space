export function formatExtraBodyForEditor(modelConfig = {}) {
  if (typeof modelConfig._extraBodyText === 'string') {
    return modelConfig._extraBodyText;
  }

  const extraBody = modelConfig.extraBody || modelConfig.protocolOptions?.body || {};
  return JSON.stringify(extraBody, null, 2);
}

export function updateExtraBodyDraft(modelConfig = {}, text = '') {
  const next = {
    ...modelConfig,
    _extraBodyText: text,
  };

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    delete next.extraBody;
    delete next._extraBodyError;
    return next;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ...next,
        _extraBodyError: 'Extra Body must be a JSON object.',
      };
    }

    if (Object.keys(parsed).length === 0) {
      delete next.extraBody;
    } else {
      next.extraBody = parsed;
    }
    delete next._extraBodyError;
    return next;
  } catch {
    return {
      ...next,
      _extraBodyError: 'Extra Body must be valid JSON.',
    };
  }
}

export function sanitizeModelConfigForSave(modelConfig = {}) {
  const clean = { ...modelConfig };
  delete clean._extraBodyText;
  delete clean._extraBodyError;

  if (
    clean.extraBody &&
    typeof clean.extraBody === 'object' &&
    !Array.isArray(clean.extraBody) &&
    Object.keys(clean.extraBody).length === 0
  ) {
    delete clean.extraBody;
  }

  return clean;
}
