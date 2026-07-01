import { promises as fs } from 'fs';
import path from 'path';

import { parseModelsConfig, upsertModelsConfig } from '../modelConfig.js';

const DEFAULT_ENV_PATH = path.join(process.cwd(), '.env');

export function registerModelRoutes(app, {
  envPath = DEFAULT_ENV_PATH,
  env = process.env,
  fsImpl = fs,
  now = () => Date.now(),
} = {}) {
  app.get('/api/models', async (req, res) => {
    try {
      const envStr = await fsImpl.readFile(envPath, 'utf-8').catch(() => '');
      const models = parseModelsConfig(envStr);
      env.MODELS_CONFIG = JSON.stringify(models);
      return res.json(models);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/models', async (req, res) => {
    try {
      const newModel = req.body;
      let envStr = await fsImpl.readFile(envPath, 'utf-8').catch(() => '');
      const models = parseModelsConfig(envStr);

      if (!newModel.id) newModel.id = now().toString();

      models.push(newModel);
      envStr = upsertModelsConfig(envStr, models);

      await fsImpl.writeFile(envPath, envStr, 'utf-8');
      env.MODELS_CONFIG = JSON.stringify(models);
      res.json(models);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/models/:id', async (req, res) => {
    try {
      let envStr = await fsImpl.readFile(envPath, 'utf-8').catch(() => '');
      const models = parseModelsConfig(envStr);
      const idx = models.findIndex(m => String(m.id) === String(req.params.id));

      if (idx === -1) {
        return res.status(404).json({ error: 'Model not found' });
      }

      const updatedModel = {
        ...models[idx],
        ...req.body,
        id: models[idx].id,
      };
      models[idx] = updatedModel;
      envStr = upsertModelsConfig(envStr, models);

      await fsImpl.writeFile(envPath, envStr, 'utf-8');
      env.MODELS_CONFIG = JSON.stringify(models);
      res.json(models);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
