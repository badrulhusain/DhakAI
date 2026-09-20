import path from 'node:path';
import type { NextConfig } from 'next';
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:4000';
const backend = new URL(backendUrl);
const websocket = `${backend.protocol === 'https:' ? 'wss:' : 'ws:'}//${backend.host}`;
const developmentScriptPolicy = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";
const contentSecurityPolicy = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${developmentScriptPolicy}`, "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  `img-src 'self' data: blob: ${backend.origin}`, `connect-src 'self' ${backend.origin} ${websocket}`,
  "worker-src 'self' blob:", "manifest-src 'self'",
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next', outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false, compress: true,
  async headers() { return [{ source: '/(.*)', headers: securityHeaders }]; },
};
export default config;
