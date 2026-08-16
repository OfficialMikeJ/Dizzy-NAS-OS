import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { PORT, SIM, WEBUI_DIST } from './config.js';
import * as monitor from './monitor/index.js';
import * as update from './update/manager.js';
import { systemRouter } from './api/system.js';
import { sharesRouter } from './api/shares.js';
import { storageRouter } from './api/storage.js';
import { dockerRouter } from './api/docker.js';
import { updateRouter } from './api/update.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api/system', systemRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/storage', storageRouter);
app.use('/api/docker', dockerRouter);
app.use('/api/update', updateRouter);

// Serve the built web UI when present (production / ISO deployment)
if (fs.existsSync(WEBUI_DIST)) {
  app.use(express.static(WEBUI_DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(WEBUI_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.json({ dizzyos: 'server running', hint: 'webui/dist not built yet — use the Vite dev server on :5173' }));
}

// API error handler — keep messages, drop stacks
app.use((err, _req, res, _next) => {
  res.status(err.status || 400).json({ error: err.message });
});

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true } });
monitor.start(io);
update.startAutoCheck(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DizzyOS server on http://0.0.0.0:${PORT} — mode: ${SIM ? 'SIMULATION' : 'LINUX (live hardware)'}`);
});
