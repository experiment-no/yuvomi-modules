/**
 * Talks to /api/extensions/kids-chores. When that service is not there
 * (network error, 404/502/503, or an error body with no reason), the same
 * calls run against localStorage. A real 401/403 from the service is shown.
 */

import { PREFIX, defaultState, handle, normalizeState } from './logic.js';
import { postWebhook } from './webhook.js';

const STORAGE_KEY = 'kids-chores.state.v1';
const CSRF_HEADER = 'X-Kids-Chores-CSRF';

const ABSENT_STATUS = new Set([404, 502, 503]);

export class KidsChoresError extends Error {
  constructor(reason, status, detail) {
    super(detail || reason);
    this.name = 'KidsChoresError';
    this.reason = reason;
    this.status = status;
  }
}

function localActor(token = 'local') {
  return {
    id: 'local',
    name: 'local',
    access: 'write',
    role: 'admin',
    csrfToken: token,
    local: true,
  };
}

function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  return normalizeState(JSON.parse(raw));
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function localRequest(method, path, body, signal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const state = readState();
  const result = await handle(state, {
    method,
    path,
    body,
    now: new Date(),
    actor: localActor(),
    postWebhook: (url, payload) => postWebhook(url, payload, signal),
  });
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  if (result.status < 400) writeState(result.state);
  return result;
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
  if (ABSENT_STATUS.has(status)) return !body || typeof body.reason !== 'string';
  if (status >= 400 && (!body || typeof body !== 'object' || typeof body.reason !== 'string')) return true;
  return false;
}

export function createClient() {
  let csrfToken = '';

  async function remote(method, path, body, signal, retry) {
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
      return null;
    }
    const parsed = parseJson(await response.text());
    if (isAbsent(response.status, parsed)) return null;
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
    if (!response.ok) {
      throw new KidsChoresError(parsed?.reason || 'internal', response.status, parsed?.error);
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  }

  async function request(method, path, body, signal) {
    const live = await remote(method, path, body, signal, false);
    if (live) return live;
    const local = await localRequest(method, path, body, signal);
    if (local.status >= 400) {
      throw new KidsChoresError(local.body.reason || 'internal', local.status, local.body.error);
    }
    return local.body;
  }

  return {
    adoptCsrf(token) {
      if (typeof token === 'string' && token && token !== 'local') csrfToken = token;
    },
    call(method, path, body, signal) {
      return request(method, path, body, signal);
    },
    today(signal) {
      return request('GET', '/today', undefined, signal);
    },
    chores(signal) {
      return request('GET', '/chores', undefined, signal);
    },
    saveSettings(body, signal) {
      return request('PUT', '/settings', body, signal);
    },
    createChore(body, signal) {
      return request('POST', '/chores', body, signal);
    },
    updateChore(id, body, signal) {
      return request('PUT', `/chores/${encodeURIComponent(id)}`, body, signal);
    },
    deleteChore(id, signal) {
      return request('DELETE', `/chores/${encodeURIComponent(id)}`, undefined, signal);
    },
    reorder(ids, signal) {
      return request('PUT', '/chores/reorder', { ids }, signal);
    },
    complete(id, signal) {
      return request('POST', '/complete', { id }, signal);
    },
    resetToday(signal) {
      return request('POST', '/reset-today', {}, signal);
    },
    testWebhook(state, signal) {
      return request('POST', '/test-webhook', { state }, signal);
    },
  };
}
