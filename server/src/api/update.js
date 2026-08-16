import { Router } from 'express';
import * as update from '../update/manager.js';

export const updateRouter = Router();

updateRouter.get('/status', (_req, res) => {
  res.json(update.getStatus());
});

updateRouter.get('/check', async (req, res, next) => {
  try {
    res.json(await update.checkForUpdate({ url: req.query.url, repo: req.query.repo }));
  } catch (err) { next(err); }
});

updateRouter.post('/config', (req, res, next) => {
  try {
    const { repo, autoCheck, manifestUrl } = req.body || {};
    const patch = {};
    if (repo !== undefined) patch.repo = repo ? String(repo).trim() : null;
    if (autoCheck !== undefined) patch.autoCheck = Boolean(autoCheck);
    if (manifestUrl !== undefined) patch.manifestUrl = manifestUrl || null;
    update.writeConfig(patch);
    res.json(update.getStatus());
  } catch (err) { next(err); }
});

updateRouter.post('/apply', async (req, res, next) => {
  try {
    const { url, file, sha256, confirm = false } = req.body || {};
    res.json(await update.applyUpdate({ url, file, sha256, confirm }));
  } catch (err) { next(err); }
});

updateRouter.post('/rollback', async (req, res, next) => {
  try {
    const { version, confirm = false } = req.body || {};
    res.json(await update.rollback({ version, confirm }));
  } catch (err) { next(err); }
});
