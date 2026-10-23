import {pushConfigured} from './chat-push.mjs';
import {handleApi, handleDownload, cleanup, discoverReleaseNotifications, dispatchChatPush} from './api.mjs';
import {publicPagePaths, renderPublicPage, sitemap} from '../public-pages.mjs';

const assetsVersion = '20261022-chat-146';
const aliases = {
  '/downloads': '/#downloads', '/downloads/': '/#downloads',
  '/recursos': '/#recursos', '/recursos/': '/#recursos',
  '/comunidade': '/#comunidade', '/comunidade/': '/#comunidade',
  '/privacidade': '/privacidade/', '/termos': '/termos/', '/index.html': '/'
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}

function allowedOrigin(requestOrigin, publicOrigin, requestUrl) {
  return requestOrigin === publicOrigin || requestOrigin === new URL(requestUrl).origin || requestOrigin === 'capacitor://localhost' ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(requestOrigin);
}

function protect(response, request, env) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigin(origin, env.PUBLIC_ORIGIN, request.url)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ZapDMR-Platform, X-ZapDMR-Version-Code');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers
  });
}

async function route(request, env) {
  const url = new URL(request.url), pathname = url.pathname;
  if (url.hostname === 'zapdmr.com.br' && ['GET', 'HEAD'].includes(request.method)) {
    url.protocol = 'https:';
    url.hostname = 'www.zapdmr.com.br';
    return new Response(null, {status: 308, headers: {Location: url.href}});
  }
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(origin, env.PUBLIC_ORIGIN, request.url)) return json(403, {message: 'Origem não autorizada.'});
  if (request.method === 'OPTIONS') return new Response(null, {status: 204});
  if (pathname.startsWith('/v1/') || pathname === '/admin' || pathname.startsWith('/admin/')) {
    return handleApi(request, env, url);
  }
  if (pathname.startsWith('/download/') || pathname === '/source') {
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, {message: 'Método não permitido.'});
    return handleDownload(request, env, url);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return json(405, {message: 'Método não permitido.'});
  if (pathname === '/healthz') {
    if (!env.DB) return json(503, {ok: false, message: 'Banco ainda não configurado.'});
    await env.DB.prepare('SELECT 1').first();
    return json(200, {ok: true, version: '1.4.8'});
  }
  if (aliases[pathname]) return new Response(null, {status: 308, headers: {Location: aliases[pathname]}});
  const production = Boolean(env.OWNER_NAME && env.PRIVACY_EMAIL);
  const publicOrigin = env.PUBLIC_ORIGIN || url.origin;
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') {
    const map = pathname.endsWith('.xml');
    const content = map ? sitemap(publicOrigin) : production
      ? `User-agent: *\nDisallow: /v1/\nDisallow: /admin\nDisallow: /download/\nSitemap: ${publicOrigin}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n';
    return new Response(content, {headers: {'Content-Type': map ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8'}});
  }
  if (publicPagePaths.includes(pathname)) {
    const assetUrl = new URL('/index.html', request.url);
    const asset = await env.ASSETS.fetch(new Request(assetUrl));
    if (!asset.ok) return json(503, {message: 'Páginas do portal ainda não publicadas.'});
    const html = renderPublicPage(await asset.text(), pathname, {
      origin: publicOrigin, owner: env.OWNER_NAME, privacyEmail: env.PRIVACY_EMAIL, production, assetsVersion
    });
    return new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}});
  }
  if (['/site.js', '/site.css', '/ZapDMR.png'].includes(pathname)) return env.ASSETS.fetch(request);
  return json(404, {message: 'Página não encontrada.'});
}

export default {
  scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.allSettled([...(new Date(event.scheduledTime).getUTCMinutes()===0?[cleanup(env),discoverReleaseNotifications(env)]:[]),...(pushConfigured(env)?[dispatchChatPush(env)]:[])]));
  },
  async fetch(request, env, ctx) {
    let response;
    try { response = await route(request, env); }
    catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 503;
      response = json(status, {message: error.status ? error.message : 'O serviço ainda não está disponível. Tente novamente mais tarde.'});
    }
    if(ctx&&pushConfigured(env)&&request.method==='POST'&&new URL(request.url).pathname==='/v1/messages'&&response.ok)ctx.waitUntil(dispatchChatPush(env));
    return protect(response, request, env);
  }
};
