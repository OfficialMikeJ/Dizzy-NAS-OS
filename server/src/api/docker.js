import { Router } from 'express';
import * as station from '../docker/index.js';

export const dockerRouter = Router();

dockerRouter.get('/status', async (_req, res) => {
  res.json({ available: await station.available() });
});

dockerRouter.get('/containers', async (_req, res, next) => {
  try {
    res.json(await station.listContainers());
  } catch (err) { next(err); }
});

dockerRouter.post('/containers/:id/start', async (req, res, next) => {
  try {
    res.json(await station.startContainer(req.params.id));
  } catch (err) { next(err); }
});

dockerRouter.post('/containers/:id/stop', async (req, res, next) => {
  try {
    res.json(await station.stopContainer(req.params.id));
  } catch (err) { next(err); }
});

dockerRouter.delete('/containers/:id', async (req, res, next) => {
  try {
    res.json(await station.removeContainer(req.params.id));
  } catch (err) { next(err); }
});

dockerRouter.post('/apps', async (req, res, next) => {
  try {
    res.status(201).json(await station.deployApp(req.body || {}));
  } catch (err) { next(err); }
});

dockerRouter.delete('/apps/:name', async (req, res, next) => {
  try {
    res.json(await station.removeApp(req.params.name));
  } catch (err) { next(err); }
});
