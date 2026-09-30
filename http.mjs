import { Agent, interceptors, request } from 'undici';

const agent = new Agent({
  connections: Number(process.env.HTTP_POOL_CONNECTIONS || 50),
  pipelining: 1,
  keepAliveTimeout: 20_000,
  keepAliveMaxTimeout: 60_000,
  headersTimeout: Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 12_000),
  bodyTimeout: Number(process.env.HTTP_BODY_TIMEOUT_MS || 20_000),
}).compose(interceptors.redirect({ maxRedirections: 3 }));

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 12_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw httpError(500, 'Outbound requests must use HTTPS');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(target, {
      method,
      headers: { accept: 'application/json', ...headers },
      body,
      dispatcher: agent,
      signal: controller.signal,
    });
    const text = await response.body.text();
    const parsed = text ? safeParse(text) : { valid: true, value: {} };
    const payload = parsed.value;
    const nonJsonMessage = parsed.valid ? '' : nonJsonResponseMessage(text, response.headers['content-type']);
    if (response.statusCode >= 400) {
      const retryAfter = response.headers['retry-after'];
      // An upstream 4xx/5xx is a provider failure from this API's point of
      // view. Never pass an HTML error or bot-challenge document to the UI.
      if (nonJsonMessage) throw httpError(502, nonJsonMessage);
      throw httpError(response.statusCode, messageFrom(payload, response.statusCode, retryAfter));
    }
    if (nonJsonMessage) throw httpError(502, nonJsonMessage);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'UND_ERR_HEADERS_TIMEOUT' || error.code === 'UND_ERR_BODY_TIMEOUT') {
      throw httpError(504, 'Upstream request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(text) {
  try { return { valid: true, value: JSON.parse(text) }; }
  catch { return { valid: false, value: null }; }
}

function nonJsonResponseMessage(text, contentType = '') {
  const sample = text.slice(0, 2_000).toLowerCase();
  const isHtml = /text\/html/i.test(String(contentType)) || /^\s*<!doctype html|^\s*<html/i.test(text);
  if (!isHtml) return 'Upstream service returned an invalid response. Please try again later.';
  const isChallenge = sample.includes('just a moment')
    || sample.includes('cf-chl-')
    || sample.includes('challenge-platform')
    || sample.includes('cloudflare');
  if (isChallenge) return 'The playback provider blocked this server request with a browser verification challenge. Try another server or contact the provider administrator.';
  return 'Upstream service returned an HTML page instead of JSON. Please try again later.';
}

function messageFrom(payload, status, retryAfter) {
  if (status === 429) return `Upstream rate limit reached${retryAfter ? `, retry in ${retryAfter}s` : ''}`;
  return payload?.errors?.[0]?.message || payload?.message || `Upstream returned ${status}`;
}

/** Small TTL cache so repeated discovery calls do not re-hit upstream on every page view. */
export function createCache({ ttlMs = 300_000, max = 300 } = {}) {
  const store = new Map();
  const inflight = new Map();
  return async function cached(key, producer, overrideTtl) {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const promise = Promise.resolve(producer())
      .then((value) => {
        if (store.size >= max) store.delete(store.keys().next().value);
        store.set(key, { value, expires: Date.now() + (overrideTtl ?? ttlMs) });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}

export const closePool = () => agent.close();
