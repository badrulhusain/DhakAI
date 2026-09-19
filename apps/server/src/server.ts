import { createServer, type IncomingMessage } from 'node:http';
import { realpath } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { clientMessageSchema, launchSchema, type ServerMessage } from '@classroom/shared';
import { AgentManager } from './agent-manager.js';
import { inspectRepository } from './git.js';
import path from 'node:path';
import { ReviewService } from './review-service.js';
import { ExplanationStore } from './explanation-store.js';
import { ReviewError } from './review-git.js';
export function createApp(manager: AgentManager, origins: string[]) {
  const reviews = new ReviewService(id => manager.get(id).record, new ExplanationStore(manager.config.dataRoot ?? path.join(manager.config.worktreeRoot, '..', 'data', 'explanations')));
  const allowed = new Set(origins);
  const validOrigin = (req: IncomingMessage) => !!req.headers.origin && allowed.has(req.headers.origin);
  const server = createServer(async (req, res) => {
    if (!validOrigin(req)) { res.writeHead(403); res.end('Origin not allowed.'); return; }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin!); res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204); res.end(); return; }
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/api/state') {
        let repository = null, repositoryError = null;
        try { repository = { ...await inspectRepository(manager.config.repo), demoAllowed: await realpath(manager.config.repo) === await realpath(manager.config.demoRepo).catch(() => '') }; } catch (e) { repositoryError = (e as Error).message; }
        reply(200, { repository, repositoryError, agents: manager.list() }); return;
      }
      if (req.method === 'POST' && req.url === '/api/agents') {
        if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'Expected application/json.' }); return; }
        req.setEncoding('utf8'); let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32768) { reply(413, { error: 'Request too large.' }); return; } }
        const parsed = launchSchema.safeParse(JSON.parse(body));
        if (!parsed.success) { reply(400, { error: 'Choose Demo or Codex and enter a task of 1–8000 characters.' }); return; }
        reply(201, { agent: await manager.launch(parsed.data) }); return;
      }
      const url = new URL(req.url || '/', 'http://localhost');
      const reviewRoute = url.pathname.match(/^\/api\/agents\/([\w-]+)\/(review(?:\/refresh|\/files\/([a-f0-9]{64}))?|explanation)$/);
      if (reviewRoute) {
        const [, id, route, fileId] = reviewRoute;
        const version = url.searchParams.get('version') || '';
        if (req.method === 'GET' && route === 'review') { reply(200, await reviews.review(id)); return; }
        if (req.method === 'POST' && route === 'review/refresh') { reply(200, await reviews.review(id, true)); return; }
        if (req.method === 'GET' && fileId) { reply(200, reviews.file(id, version, fileId)); return; }
        if (req.method === 'GET' && route === 'explanation') { reply(200, { explanation: await reviews.explanation(id, version) }); return; }
        if (req.method === 'PUT' && route === 'explanation') {
          if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'Expected application/json.' }); return; }
          req.setEncoding('utf8'); let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 128 * 1024) { reply(413, { error: 'Explanation request too large.' }); return; } }
          reply(200, { explanation: await reviews.save(id, JSON.parse(body)) }); return;
        }
      }
      const stop = req.url?.match(/^\/api\/agents\/([\w-]+)\/stop$/);
      if (req.method === 'POST' && stop) { manager.stop(stop[1]); reply(200, { agent: manager.get(stop[1]).record }); return; }
      reply(404, { error: 'Not found.' });
    } catch (e) { reply(e instanceof ReviewError ? e.status : (e as Error).message.includes('already active') ? 409 : 400, { error: (e as Error).message }); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const send = (socket: WebSocket, message: ServerMessage) => { if (socket.readyState !== WebSocket.OPEN) return; if (socket.bufferedAmount > 256 * 1024) { socket.terminate(); return; } socket.send(JSON.stringify(message)); };
  server.on('upgrade', (req, socket, head) => {
    const match = req.url?.match(/^\/terminal\/([\w-]+)$/);
    if (!validOrigin(req) || !match || wss.clients.size >= 8) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    try { manager.get(match[1]); } catch { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const id = match[1]; const session = manager.get(id);
      send(ws, { type: 'replay', data: session.output }); send(ws, { type: 'status', agent: { ...session.record } });
      const listener = (agentId: string, message: ServerMessage) => { if (id === agentId) send(ws, message); };
      manager.on('message', listener);
      let bytes = 0; const rateTimer = setInterval(() => { bytes = 0; }, 1000);
      let alive = true;
      const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 15000);
      ws.on('pong', () => { alive = true; });
      ws.on('message', (raw, binary) => {
        bytes += Array.isArray(raw) ? raw.reduce((sum, chunk) => sum + chunk.length, 0) : raw.byteLength; if (binary || bytes > 65536) { ws.close(1008, 'Input limit exceeded'); return; }
        try { const message = clientMessageSchema.parse(JSON.parse(raw.toString())); if (message.type === 'input') manager.input(id, message.data); else manager.resize(id, message.cols, message.rows); }
        catch { send(ws, { type: 'error', message: 'Invalid terminal message or agent is no longer running.' }); }
      });
      ws.on('error', () => ws.terminate());
      ws.on('close', () => { clearInterval(rateTimer); clearInterval(heartbeat); manager.off('message', listener); });
    });
  });
  return { server, reviews, async close() { await manager.shutdown(); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
