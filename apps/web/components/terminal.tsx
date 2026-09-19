'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentRecord, ServerMessage } from '@classroom/shared';
import '@xterm/xterm/css/xterm.css';
export default function LiveTerminal({ id, backend, onStatus }: { id: string; backend: string; onStatus: (agent: AgentRecord) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onStatus); callback.current = onStatus;
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  useEffect(() => {
    let failures = 0;
    let disposed = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout>, cleanup = () => {};
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed || !host.current) return;
      const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'Menlo, Consolas, monospace', scrollback: 3000, theme: { background: '#151c29', foreground: '#d5deed', cursor: '#a7b6ff', selectionBackground: '#3c486a' } });
      const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
      const resize = () => { if (disposed) return; fit.fit(); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: Math.min(300, Math.max(20, term.cols)), rows: Math.min(120, Math.max(5, term.rows)) })); };
      const observer = new ResizeObserver(resize); observer.observe(host.current);
      const input = term.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })); });
      const connect = () => {
        if (disposed) return;
        socket = new WebSocket(`${backend.replace(/^http/, 'ws')}/terminal/${id}`);
        socket.onopen = () => { failures = 0; setConnection('Connected'); setError(''); resize(); };
        socket.onmessage = event => { const message = JSON.parse(event.data) as ServerMessage; if (message.type === 'replay') { term.reset(); term.write(message.data); } else if (message.type === 'output') term.write(message.data); else if (message.type === 'status') callback.current(message.agent); else setError(message.message); };
        socket.onclose = () => { if (!disposed) { setConnection('Reconnecting'); retry = setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(failures++, 5))); } };
        socket.onerror = () => setConnection('Connection interrupted');
      };
      connect();
      cleanup = () => { observer.disconnect(); input.dispose(); term.dispose(); };
    }).catch(() => setError('Terminal could not load. Reload the page.'));
    return () => { disposed = true; clearTimeout(retry); if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); } cleanup(); };
  }, [id, backend]);
  return <><div className="terminal-connection"><span className={`dot ${connection === 'Connected' ? 'green' : ''}`} />{connection}<span className="connection-hint">Keyboard input enabled</span></div><div className="xterm-host" ref={host} />{error && <div role="alert" className="terminal-error">{error}</div>}</>;
}
