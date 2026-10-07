import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { buildStaticSecurityHeaders, buildContentSecurityPolicy, isLoopbackHost } from '@/lib/securityHeaders';

// No sessions or persistent HTML cache. Article bodies are sanitized before rendering.
export const onRequest = defineMiddleware(async (context, next) => {
  const nonce = btoa(crypto.randomUUID());
  context.locals.nonce = nonce;
  const response = await next();
  const headers = new Headers(response.headers);
  const production = env.DEPLOYMENT_ENV === 'production';
  const development = import.meta.env.DEV;
  const skipUpgradeInsecureRequests = !production && isLoopbackHost(context.url.hostname);
  const csp = buildContentSecurityPolicy(nonce, development, { skipUpgradeInsecureRequests });
  headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(buildStaticSecurityHeaders(production))) headers.set(name, value);
  headers.set('Cache-Control', 'no-store');
  const secured = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (!headers.get('Content-Type')?.includes('text/html')) return secured;
  // Nonce only framework-owned scripts; CMS HTML permits no script tags.
  return new HTMLRewriter().on('script', { element(element) { element.setAttribute('nonce', nonce); } }).transform(secured);
});
