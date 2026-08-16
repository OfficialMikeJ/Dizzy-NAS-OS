import { Router } from 'express';
import * as shares from '../shares/index.js';

export const sharesRouter = Router();

sharesRouter.get('/', (_req, res) => {
  res.json(shares.listShares());
});

sharesRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await shares.createShare(req.body || {}));
  } catch (err) { next(err); }
});

sharesRouter.delete('/:name', async (req, res, next) => {
  try {
    res.json(await shares.deleteShare(req.params.name));
  } catch (err) { next(err); }
});
