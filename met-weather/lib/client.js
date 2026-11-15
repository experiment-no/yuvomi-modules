/**
 * Talks to /api/extensions/met-weather when that service is running.
 * Yuvomi does not start it, and the page is not allowed to call MET itself.
 * A missing service is not an error: the same screen then reads
 * /api/v1/weather, which Yuvomi already fetches.
 */

import { PREFIX, forecastFromHost } from './forecast.js';
import { placeFromPreferences, placeRecord, placesFromGeocode } from './places.js';

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

function language() {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return lang && lang.toLowerCase().startsWith('en') ? 'en' : 'nb';
}

export function createClient(options = {}) {
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
  let csrfToken = '';
  let sidecarDown = false;
  let hostApi;

  function loadHost() {
    if (options.hostApi !== undefined) return Promise.resolve(options.hostApi);
    if (hostApi !== undefined) return Promise.resolve(hostApi);
    return import('/api.js')
      .then((mod) => {
        hostApi = mod.api || null;
        return hostApi;
      })
      .catch(() => {
        hostApi = null;
        return null;
      });
  }

  async function remote(method, path, body, signal, retry) {
    if (sidecarDown) return null;
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;
    let response;
    try {
      response = await fetchImpl(`${PREFIX}${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    }
    const parsed = parseJson(await response.text());
    if (isAbsent(response.status, parsed)) {
      sidecarDown = true;
      return null;
    }
    if (parsed && typeof parsed.csrfToken === 'string') csrfToken = parsed.csrfToken;
    if (
      !retry
      && method !== 'GET'
      && response.status === 403
      && parsed?.reason === 'csrf'
      && typeof parsed.csrfToken === 'string'
    ) {
      return remote(method, path, body, signal, true);
    }
    if (!response.ok) throw new WeatherError(parsed?.reason || 'invalid', response.status);
    return parsed;
  }

  async function hostGet(path, signal) {
    const api = await loadHost();
    if (!api?.get) throw new WeatherError('upstream', 0);
    try {
      return await api.get(path, { signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const status = Number(err?.status) || 0;
      if (status === 401) throw new WeatherError('auth', status);
      if (status === 403) throw new WeatherError('forbidden', status);
      throw new WeatherError('upstream', status);
    }
  }

  async function hostForecast(signal) {
    const settings = await hostGet('/preferences', signal);
    const place = placeFromPreferences(settings?.data);
    if (!place) return { configured: false, place: null, current: null, hours: [], days: [] };
    const weather = await hostGet('/weather', signal);
    if (weather?.reason === 'upstream_error' || weather?.reason === 'not_configured') {
      throw new WeatherError('upstream', 502);
    }
    const view = forecastFromHost(weather);
    if (view.error || !view.configured) throw new WeatherError(view.error || 'upstream', 502);
    return {
      ...view,
      place: { ...place, name: place.name || view.place.name },
    };
  }

  async function hostPlaces(query, signal) {
    const text = String(query || '').trim();
    if (text.length < 2) return { places: [] };
    const payload = await hostGet(`/weather/geocode?name=${encodeURIComponent(text)}&lang=${language()}`, signal);
    if (payload?.reason === 'upstream_error' || payload?.data == null) throw new WeatherError('upstream', 502);
    return { places: placesFromGeocode(payload.data) };
  }

  async function hostSave(place, signal) {
    const record = placeRecord(place);
    if (!record) throw new WeatherError('norway', 400);
    const api = await loadHost();
    if (!api?.put) throw new WeatherError('upstream', 0);
    try {
      await api.put('/preferences', {
        weather_provider: 'open-meteo',
        weather_lat: record.lat,
        weather_lon: record.lon,
        weather_city: record.name,
        weather_user: {
          lat: record.lat,
          lon: record.lon,
          city: record.name,
        },
      }, { signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const status = Number(err?.status) || 0;
      if (status === 401) throw new WeatherError('auth', status);
      if (status === 403) throw new WeatherError('forbidden', status);
      throw new WeatherError('invalid', status);
    }
    return { place: record };
  }

  return {
    async forecast(signal) {
      const live = await remote('GET', '/forecast', undefined, signal, false);
      if (live) return live;
      return hostForecast(signal);
    },
    async places(query, signal) {
      const live = await remote('GET', `/places?q=${encodeURIComponent(query)}`, undefined, signal, false);
      if (live) return live;
      return hostPlaces(query, signal);
    },
    async savePlace(place, signal) {
      const id = Number(place?.id);
      if (Number.isInteger(id) && id > 0) {
        const live = await remote('PUT', '/place', { id }, signal, false);
        if (live) return live;
      }
      return hostSave(place, signal);
    },
  };
}
