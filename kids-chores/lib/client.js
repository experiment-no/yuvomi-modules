/**
 * Talks to /api/extensions/kids-chores. When that service is not there
 * (network error, 404/502/503, or an error body with no reason), the same
 * calls run against localStorage. A real 401/403 from the service is shown.
 */

import { PREFIX, commit, handle, openDocument, project } from './logic.js';
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

function readDocument() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return openDocument(null);
  try {
    return openDocument(JSON.parse(raw));
  } catch {
    return openDocument(null);
  }
}

function writeDocument(doc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

/**
 * Yuvomi's page may only call its own origin. A Homey address is refused
 * by the browser before the POST exists, which used to look like a finished
 * chore with no trigger. Ask Yuvomi to POST the same JSON, then drop the
 * temporary channel.
 */
async function relayWebhook(url, payload) {
  if (typeof document === 'undefined') return false;
  let notifications;
  try {
    ({ notifications } = await import('/api.js'));
  } catch {
    return false;
  }
  let id;
  try {
    const created = await notifications.createChannel({
      provider: 'webhook',
      name: 'Kids Chores',
      enabled: true,
      config: {
        baseUrl: url,
        payloadTemplate: JSON.stringify(payload),
      },
    });
    id = created?.data?.id ?? created?.id;
    if (!id) return false;
    await notifications.testChannel(id);
    return true;
  } catch {
    return false;
  } finally {
    if (id) {
      try {
        await notifications.deleteChannel(id);
      } catch {
        try { await notifications.updateChannel(id, { enabled: false }); } catch { /* A leftover channel must not keep calling Homey. */ }
      }
    }
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
  if (ABSENT_STATUS.has(status)) return !body || typeof body.reason !== 'string';
  if (status >= 400 && (!body || typeof body !== 'object' || typeof body.reason !== 'string')) return true;
  return false;
}

export function createClient() {
  let csrfToken = '';
  let seeded = false;

  async function deliverWebhook(url, payload, signal) {
    try {
      return await postWebhook(url, payload, signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (await relayWebhook(url, payload)) return { status: 204, body: '' };
      throw err;
    }
  }

  async function localRequest(method, path, body, signal) {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const actor = localActor();
    const doc = readDocument();
    const result = await handle(project(doc, actor), {
      method,
      path,
      body,
      now: new Date(),
      actor,
      postWebhook: (url, payload) => deliverWebhook(url, payload, signal),
    });
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (result.status < 400) {
      commit(doc, actor, result.state);
      writeDocument(doc);
    }
    return result;
  }

  async function seed(signal) {
    if (seeded) return;
    const list = await remote('GET', '/chores', undefined, signal, false);
    if (!list) return;
    seeded = true;
    const local = project(readDocument(), localActor());
    if (!local.chores.length || (list.chores || []).length) return;
    await remote('POST', '/import', {
      chores: local.chores,
      completions: local.completions,
      goals: local.goals,
    }, signal, false);
  }

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
    try {
      await seed(signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
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
    complete(id, signal, forUserId) {
      const body = { id };
      if (forUserId) body.forUserId = forUserId;
      return request('POST', '/complete', body, signal);
    },
    resetToday(signal) {
      return request('POST', '/reset-today', {}, signal);
    },
    testWebhook(state, signal) {
      return request('POST', '/test-webhook', { state }, signal);
    },
  };
}
