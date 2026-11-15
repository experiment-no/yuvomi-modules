/**
 * Talks to /api/extensions/met-weather. The forecast is never fetched from
 * the page: MET requires a User-Agent the browser will not send.
 */

import { PREFIX } from './forecast.js';

const CSRF_HEADER = 'X-Met-Weather-CSRF';

export class WeatherError extends Error {
  constructor(reason, status) {
    super(reason);
    this.name = 'WeatherError';
    this.reason = reason;
    this.status = status;
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isAbsent(status, body) {
  if (status === 404 || status === 502 || status === 503) return !body || typeof body.reason !== 'string';
  return false;
}

export function createClient() {
  let csrfToken = '';

  async function request(method, path, body, signal, retry) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;
    let response;
    try {
      response = await fetch(`${PREFIX}${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new WeatherError('service', 0);
    }
    const parsed = parseJson(await response.text());
    if (isAbsent(response.status, parsed)) throw new WeatherError('service', response.status);
    if (parsed && typeof parsed.csrfToken === 'string') csrfToken = parsed.csrfToken;
    if (
      !retry
      && method !== 'GET'
      && response.status === 403
      && parsed?.reason === 'csrf'
      && typeof parsed.csrfToken === 'string'
    ) {
      return request(method, path, body, signal, true);
    }
    if (!response.ok) throw new WeatherError(parsed?.reason || 'invalid', response.status);
    return parsed;
  }

  return {
    forecast(signal) {
      return request('GET', '/forecast', undefined, signal, false);
    },
    places(query, signal) {
      return request('GET', `/places?q=${encodeURIComponent(query)}`, undefined, signal, false);
    },
    savePlace(id, signal) {
      return request('PUT', '/place', { id }, signal, false);
    },
  };
}
