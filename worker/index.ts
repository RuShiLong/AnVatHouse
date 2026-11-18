import handler from 'vinext/server/fetch-handler';
import shopHtml from '../public/store.html?raw';
import adminHtml from '../public/admin.html?raw';
import { apiFetch, importData } from './api.js';

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === '/api/internal/import' && request.method === 'POST') return importData(request, env);
    if (path.startsWith('/api/')) return apiFetch(request, env);
    if (path === '/uploads' || path.startsWith('/uploads/')) {
      const key = path.slice('/uploads/'.length);
      if (!/^[a-f0-9]{32}\.(jpg|png)$/.test(key)) return new Response('Not found', { status: 404 });
      const obj = await env.BUCKET.get(key);
      if (!obj) return handler.fetch(request, env, ctx);
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
    }
    if (path === '/' || /^\/san-pham\/[^/]+$/.test(path) || /^\/don-hang\/AVH-[A-F0-9]{16}$/.test(path)) return new Response(shopHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    if (path === '/admin') return new Response(adminHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    return handler.fetch(request, env, ctx);
  },
};
