/**
 * MET Locationforecast client. The User-Agent identifies this module.
 * Responses are kept until the Expires header, and a repeat sends If-Modified-Since.
 */

export const USER_AGENT = 'yuvomi-met-weather/1.0 https://github.com/experiment-no/yuvomi-modules';
const FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const SEARCH_URL = 'https://ws.geonorge.no/stedsnavn/v1/navn';
const PLACE_URL = 'https://ws.geonorge.no/stedsnavn/v1/sted';

export class UpstreamError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
  }
}

function header(response, name) {
  const headers = response?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

function expiresAt(response, now) {
  const parsed = Date.parse(header(response, 'expires'));
  if (Number.isFinite(parsed) && parsed > now) return parsed;
  return now + 10 * 60 * 1000;
}

export function forecastUrl(lat, lon) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return `${FORECAST_URL}?${params}`;
}

export function createMetClient(fetchImpl = globalThis.fetch) {
  const cache = new Map();

  async function forecast(lat, lon, now = Date.now()) {
    const key = `${lat},${lon}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now) return { body: hit.body, cached: true };
    const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
    if (hit?.lastModified) headers['if-modified-since'] = hit.lastModified;
    let response;
    try {
      response = await fetchImpl(forecastUrl(lat, lon), { headers });
    } catch {
      throw new UpstreamError('upstream', 0);
    }
    if (response.status === 304 && hit) {
      hit.expires = expiresAt(response, now);
      return { body: hit.body, cached: true };
    }
    if (!response.ok) throw new UpstreamError('upstream', response.status);
    const body = await response.json();
    cache.set(key, {
      body,
      expires: expiresAt(response, now),
      lastModified: header(response, 'last-modified'),
    });
    return { body, cached: false };
  }

  async function search(query) {
    const text = String(query || '').trim();
    if (text.length < 2 || text.length > 80) return { navn: [] };
    const url = new URL(SEARCH_URL);
    url.searchParams.set('sok', text);
    url.searchParams.set('fuzzy', 'true');
    url.searchParams.set('treffPerSide', '8');
    url.searchParams.set('utkoordsys', '4258');
    let response;
    try {
      response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch {
      throw new UpstreamError('upstream', 0);
    }
    if (!response.ok) throw new UpstreamError('upstream', response.status);
    return response.json();
  }

  async function place(id) {
    const url = new URL(PLACE_URL);
    url.searchParams.set('stedsnummer', String(id));
    let response;
    try {
      response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch {
      throw new UpstreamError('upstream', 0);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new UpstreamError('upstream', response.status);
    return response.json();
  }

  return { forecast, search, place };
}
