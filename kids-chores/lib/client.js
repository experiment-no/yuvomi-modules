/**
 * Talks to /api/extensions/kids-chores. When that service is not there
 * (network error, 404/502/503, or an error body with no reason), the same
 * calls use a household note every signed-in member can read. localStorage
 * is only the last resort, and it stays on this browser. A real 401/403
 * from the service is shown.
 */

import { HouseholdError, actorFromMe, deliveryPrint, runHousehold } from './household.js';
import { PREFIX, commit, handle, openDocument, project } from './logic.js';
import { postWebhook } from './webhook.js';

const STORAGE_KEY = 'kids-chores.state.v1';
const DELIVERED_KEY = 'kids-chores.webhook-delivered.v1';
const CSRF_HEADER = 'X-Kids-Chores-CSRF';
const DELIVERED_TTL_MS = 2 * 60 * 1000;
const DELIVERED_MAX = 40;

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
 * Same-origin Homey relay for every member with Kids Chores write. Needs a
 * Yuvomi build that mounts POST /api/v1/kids-chores/webhook. Stock Yuvomi
 * answers 404 here; the call then waits in the outbox.
 */
async function memberRelay(url, payload, loadApi) {
  let api;
  try {
    ({ api } = await loadApi());
  } catch {
    return null;
  }
  if (!api || typeof api.post !== 'function') return null;
  try {
    const body = await api.post('/kids-chores/webhook', { url, payload });
    // A resolved post means Homey was already contacted. Treat any shape as
    // delivered so we never queue a second copy of the same JSON.
    const result = body?.data && typeof body.data === 'object' ? body.data : body;
    if (result && typeof result.status === 'number') {
      return { status: result.status, body: result.body ?? '' };
    }
    return { status: 204, body: '' };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

function readDeliveredLedger() {
  try {
    const raw = localStorage.getItem(DELIVERED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDeliveredLedger(ledger) {
  try {
    localStorage.setItem(DELIVERED_KEY, JSON.stringify(ledger));
  } catch {
    /* private mode still leaves the in-memory path */
  }
}

function pruneDeliveredLedger(ledger, now = Date.now()) {
  const keep = {};
  for (const [print, at] of Object.entries(ledger)) {
    const stamp = Number(at);
    if (!Number.isFinite(stamp)) continue;
    if (now - stamp > DELIVERED_TTL_MS) continue;
    if (typeof print !== 'string' || !print || print.length > 2200) continue;
    keep[print] = stamp;
  }
  const entries = Object.entries(keep).sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(entries.slice(-DELIVERED_MAX));
}

/** True when this browser already posted the same Homey JSON recently. */
export function wasDeliveredLocally(url, payload, now = Date.now()) {
  const print = deliveryPrint(url, payload);
  if (!print) return false;
  const ledger = pruneDeliveredLedger(readDeliveredLedger(), now);
  return Number.isFinite(Number(ledger[print]));
}

export function markDeliveredLocally(url, payload, now = Date.now()) {
  const print = deliveryPrint(url, payload);
  if (!print) return;
  const ledger = pruneDeliveredLedger(readDeliveredLedger(), now);
  ledger[print] = now;
  writeDeliveredLedger(pruneDeliveredLedger(ledger, now));
}

/**
 * Yuvomi's page may only fetch its own origin. Ask Yuvomi to POST the same
 * JSON, then drop the temporary channel. Only an administrator can create
 * that channel. Members use the Kids Chores relay above instead.
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

export function createClient(options = {}) {
  const loadApi = options.loadApi || (() => import('/api.js'));
  const clock = options.now || (() => new Date());
  const relay = typeof options.relay === 'function' ? options.relay : relayWebhook;
  const memberSend = typeof options.memberRelay === 'function'
    ? options.memberRelay
    : (url, payload) => memberRelay(url, payload, loadApi);
  let csrfToken = '';
  let seeded = false;

  async function deliverWebhook(url, payload, signal) {
    if (wasDeliveredLocally(url, payload)) return { status: 204, body: '' };
    try {
      const sent = await postWebhook(url, payload, signal);
      markDeliveredLocally(url, payload);
      return sent;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      try {
        const sent = await memberSend(url, payload);
        if (sent) {
          markDeliveredLocally(url, payload);
          return sent;
        }
      } catch (relayError) {
        if (relayError?.name === 'AbortError') throw relayError;
      }
      if (await relayWebhook(url, payload)) {
        markDeliveredLocally(url, payload);
        return { status: 204, body: '' };
      }
      throw err;
    }
  }

  /**
   * One leave only. Prefer the Kids Chores relay (admin and member). The
   * notification-channel path is admin-only and can throw after Homey already
   * accepted the POST; trying it first then falling through sent the same
   * JSON twice. A local ledger blocks the same JSON from leaving again when
   * a click is retried or an outbox item is flushed after a live send.
   */
  async function sendForHousehold(url, payload, signal) {
    if (wasDeliveredLocally(url, payload)) return { status: 204, body: '' };
    try {
      const sent = await postWebhook(url, payload, signal);
      markDeliveredLocally(url, payload);
      return sent;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      try {
        const sent = await memberSend(url, payload);
        if (sent) {
          markDeliveredLocally(url, payload);
          return sent;
        }
      } catch (relayError) {
        if (relayError?.name === 'AbortError') throw relayError;
      }
      if (await relay(url, payload)) {
        markDeliveredLocally(url, payload);
        return { status: 204, body: '' };
      }
      return null;
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
      now: clock(),
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
    const shared = await householdRequest(method, path, body, signal);
    if (shared) return shared;
    const local = await localRequest(method, path, body, signal);
    if (local.status >= 400) {
      throw new KidsChoresError(local.body.reason || 'internal', local.status, local.body.error);
    }
    return local.body;
  }

  async function householdRequest(method, path, body, signal) {
    let api;
    try {
      ({ api } = await loadApi());
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    }
    if (!api || typeof api.get !== 'function') return null;
    try {
      const actor = actorFromMe(await api.get('/auth/me', { signal }));
      if (!actor) return null;
      const result = await runHousehold({
        api,
        method,
        path,
        body,
        signal,
        actor,
        now: clock(),
        trySend: (url, payload) => sendForHousehold(url, payload, signal),
        readLocal: readDocument,
        writeLocal: writeDocument,
      });
      if (result.status >= 400) {
        throw new KidsChoresError(result.body?.reason || 'internal', result.status, result.body?.error);
      }
      return result.body;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err instanceof KidsChoresError) throw err;
      if (err instanceof HouseholdError) throw new KidsChoresError(err.reason, err.status, err.message);
      const status = Number(err?.status) || 0;
      if (status === 401) throw new KidsChoresError('auth', status, err.message);
      if (status === 403) throw new KidsChoresError('forbidden', status, err.message);
      if (status === 404) return null;
      if (status) throw new KidsChoresError('notes', status, err.message);
      return null;
    }
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
