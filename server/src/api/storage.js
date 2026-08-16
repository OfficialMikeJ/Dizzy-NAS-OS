import { Router } from 'express';
import * as storage from '../storage/manager.js';

export const storageRouter = Router();

storageRouter.get('/drives', async (_req, res, next) => {
  try {
    res.json(await storage.listDrives());
  } catch (err) { next(err); }
});

storageRouter.get('/pool', async (_req, res, next) => {
  try {
    res.json(await storage.getPool());
  } catch (err) { next(err); }
});

storageRouter.get('/preview', async (_req, res, next) => {
  try {
    res.json(await storage.previewPool());
  } catch (err) { next(err); }
});

storageRouter.post('/pool', async (req, res, next) => {
  try {
    res.json(await storage.createPool({ confirm: req.body?.confirm ?? false }));
  } catch (err) { next(err); }
});

storageRouter.delete('/pool', async (req, res, next) => {
  try {
    res.json(await storage.destroyPool({ confirm: req.body?.confirm ?? false }));
  } catch (err) { next(err); }
});

storageRouter.post('/sync', async (_req, res, next) => {
  try {
    res.json(await storage.syncNow());
  } catch (err) { next(err); }
});

storageRouter.post('/scrub', async (_req, res, next) => {
  try {
    res.json(await storage.scrubNow());
  } catch (err) { next(err); }
});
