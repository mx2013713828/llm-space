import { promises as fs } from 'fs';
import path from 'path';
import { parseModelsConfig } from '../../modelConfig.js';

const cwd = globalThis.process?.cwd?.() || '.';

export async function resolveModelConfig(modelRef = null, envPath = path.join(cwd, '.env')) {
  const envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
  const models = parseModelsConfig(envStr);
  if (models.length === 0) {
    throw new Error('No model config found. Please add a model before running scheduled tasks.');
  }

  const model = modelRef
    ? models.find(item => String(item.id) === String(modelRef) || String(item.modelId) === String(modelRef))
    : models[0];

  if (!model) {
    throw new Error(`Model config not found for scheduled task modelRef: ${modelRef}`);
  }

  return model;
}
