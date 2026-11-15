/**
 * The overview already imports this file. It does not know about the
 * page client: the today sheet calls choresApi('/today'), and completing
 * a chore from that sheet calls choresApi('/complete').
 */

import { t } from '/i18n.js';

import { createClient, KidsChoresError } from './lib/client.js';
import { shouldShowOnWall } from './lib/logic.js';

export { shouldShowOnWall };

const client = createClient();

function reasonMessage(reason) {
  if (reason) {
    const name = `extensions.kids-chores.reasons.${reason}`;
    const text = t(name);
    if (text !== name) return text;
  }
  return t('extensions.kids-chores.reasons.invalid');
}

/** Custom title, or the translated overview label. */
export function moduleDisplayTitle(settings, fallbackKey = 'extensions.kids-chores.widgets.today') {
  const custom = String(settings?.displayTitle || '').trim();
  if (custom) return custom;
  const text = t(fallbackKey);
  return text === fallbackKey ? t('extensions.kids-chores.module') : text;
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: object, signal?: AbortSignal, csrf?: string }} [options]
 */
export async function choresApi(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const route = String(path || '/today').startsWith('/') ? String(path || '/today') : `/${path}`;
  client.adoptCsrf(options.csrf);
  const body = method === 'GET' || method === 'DELETE' ? undefined : (options.body ?? {});
  try {
    return await client.call(method, route, body, options.signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const error = new Error(err instanceof KidsChoresError ? reasonMessage(err.reason) : (err?.message || reasonMessage()));
    error.reason = err?.reason;
    error.status = err?.status;
    throw error;
  }
}
