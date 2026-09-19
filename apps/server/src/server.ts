import { createServer, type IncomingMessage } from 'node:http';
import { realpath } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { clientMessageSchema, launchSchema, type QuizSubmission, type ServerMessage } from '@classroom/shared';
import { AgentManager } from './agent-manager.js';
import { inspectRepository } from './git.js';
import path from 'node:path';
import { ReviewService } from './review-service.js';
import { ReviewError } from './review-git.js';
import { createLearningStore, type LearningStore } from './learning-store.js';
import { DemoQuizProvider, QuizService, type QuizProvider } from './quiz-service.js';
import { MergeService } from './merge-service.js';
import { errorBody, ServiceError } from './service-error.js';
export interface AppOptions { store?: LearningStore; groqProvider?: QuizProvider; validationExecutable?: string; validationArgs?: string[] }
export async function createApp(manager: AgentManager, origins: string[], options: AppOptions = {}) {
  const store = options.store ?? createLearningStore({ mode: 'local', directory: manager.config.dataRoot ?? path.join(manager.config.worktreeRoot, '..', 'data') });
  if (!options.store) await store.init();
  const reviews = new ReviewService(id => manager.get(id).record, store);
  const quizzes = new QuizService(id => manager.get(id).record, reviews, store, new DemoQuizProvider(), options.groqProvider);
  const merges = new MergeService(id => manager.get(id).record, reviews, quizzes, store, { repository: manager.config.repo, worktreeRoot: manager.config.worktreeRoot, validationExecutable: options.validationExecutable, validationArgs: options.validationArgs });
  const allowed = new Set(origins);
  const validOrigin = (req: IncomingMessage) => !!req.headers.origin && allowed.has(req.headers.origin);
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health' && !req.headers.origin) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: 'ok', service: 'agent-classroom', pid: process.pid })); return; }
    if (!validOrigin(req)) { res.writeHead(403); res.end('Origin not allowed.'); return; }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin!); res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204); res.end(); return; }
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/health') { reply(200, { status: 'ok', service: 'agent-classroom', pid: process.pid }); return; }
      if (req.method === 'GET' && req.url === '/api/dependencies') { reply(200, { database: await store.health(), quizProvider: quizzes.providerStatus() }); return; }
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
      const learningRoute = url.pathname.match(/^\/api\/agents\/([\w-]+)\/(quiz(?:\/attempts)?|merge(?:\/eligibility)?)$/);
      if (learningRoute) {
        const [, id, route] = learningRoute;
        if (req.method === 'GET' && route === 'quiz') { reply(200, { quiz: await quizzes.get(id) }); return; }
        if (req.method === 'POST' && route === 'quiz') { reply(200, { quiz: await quizzes.generate(id) }); return; }
        if (req.method === 'POST' && route === 'quiz/attempts') { reply(200, { attempt: await quizzes.submit(id, await readJson(req, 64 * 1024) as QuizSubmission) }); return; }
        if (req.method === 'GET' && route === 'merge/eligibility') { reply(200, await merges.eligibility(id)); return; }
        if (req.method === 'GET' && route === 'merge') { reply(200, { operation: await merges.operation(id) }); return; }
        if (req.method === 'POST' && route === 'merge') { reply(200, { operation: await merges.merge(id) }); return; }
      }
      const stop = req.url?.match(/^\/api\/agents\/([\w-]+)\/stop$/);
      if (req.method === 'POST' && stop) { manager.stop(stop[1]); reply(200, { agent: manager.get(stop[1]).record }); return; }
      reply(404, { error: 'Not found.' });
    } catch (e) {
      const status = e instanceof ServiceError || e instanceof ReviewError ? e.status : (e as Error).message.includes('already active') ? 409 : 400;
      if (e instanceof ServiceError) reply(status, errorBody(e));
      else if (e instanceof ReviewError) { const message = e.message; const code = /still running|process to exit/i.test(message) ? 'AGENT_RUNNING' : /worktree is missing/i.test(message) ? 'WORKTREE_MISSING' : /changed|version|refresh/i.test(message) ? 'REVIEW_OUTDATED' : 'INVALID_REQUEST'; reply(status, { error: message, code }); }
      else reply(status, { error: (e as Error).message, code: 'INVALID_REQUEST' });
    }
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
  return { server, reviews, quizzes, merges, store, async close() { await manager.shutdown(); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

async function readJson(req: IncomingMessage, limit: number) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ServiceError('INVALID_REQUEST', 'Expected application/json.', 415);
  req.setEncoding('utf8'); let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > limit) throw new ServiceError('INVALID_REQUEST', 'Request is too large.', 413); }
  try { return JSON.parse(body); } catch { throw new ServiceError('INVALID_REQUEST', 'Request body must be valid JSON.'); }
}
