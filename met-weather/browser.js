/**
 * Shared by the overview widget and the weather page.
 */

import { t } from '/i18n.js';

import { createClient, WeatherError } from './lib/client.js';
import { key } from './lib/ui.js';

const client = createClient();

export function reasonMessage(reason) {
  if (reason) {
    const name = key(`reasons.${reason}`);
    const text = t(name);
    if (text !== name) return text;
  }
  return t(key('reasons.invalid'));
}

export async function weatherApi(path, options = {}) {
  const signal = options.signal;
  try {
    if (path === 'forecast') return await client.forecast(signal);
    if (path === 'places') return await client.places(options.query || '', signal);
    if (path === 'place') return await client.savePlace(options.id, signal);
    throw new WeatherError('invalid', 404);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const error = new Error(err instanceof WeatherError ? reasonMessage(err.reason) : (err?.message || reasonMessage()));
    error.reason = err?.reason;
    error.status = err?.status;
    throw error;
  }
}
