/**
 * Talks to /api/extensions/kids-chores. When that service is not there
 * (network error, 404/502/503, or an error body with no reason), the same
 * calls use a household note every signed-in member can read. localStorage
 * is only the last resort, and it stays on this browser. A real 401/403
 * from the service is shown.
 */

import { HouseholdError, actorFromMe, runHousehold } from './household.js';
import { PREFIX, commit, handle, openDocument, project } from './logic.js';
import { plainFormBody, postWebhook } from './webhook.js';

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

const WEBHOOK_WINDOW = 'kc-webhook';
let formChain = Promise.resolve();
let closeTimer = 0;
let windowUsed = false;

/**
 * Opens the one window a member check-off can navigate. Call this in the
 * click, before any await: a later open is blocked, and fetch to Homey is
 * blocked too. The form then posts the JSON into this window.
 */
export function armWebhookWindow() {
  if (typeof window === 'undefined') return false;
  const current = window.__kcWebhookWindow;
  if (current && current.closed !== true) return true;
  let opened;
  try {
    opened = window.open('about:blank', WEBHOOK_WINDOW, 'popup=yes,width=80,height=40,left=0,top=0');
  } catch {
    return false;
  }
  if (!opened) return false;
  windowUsed = false;
  window.__kcWebhookWindow = opened;
  scheduleWebhookClose(opened, 12000);
  return true;
}

/** Closes an armed window that never posted. A window that posted stays up long enough to send. */
export function releaseWebhookWindow() {
  if (windowUsed) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = 0;
  }
  const win = typeof window === 'undefined' ? null : window.__kcWebhookWindow;
  if (typeof window !== 'undefined') window.__kcWebhookWindow = null;
  if (!win || win.closed === true) return;
  try { win.close(); } catch { /* already closed */ }
}

function liveWebhookWindow() {
  if (typeof window === 'undefined') return null;
  const current = window.__kcWebhookWindow;
  if (!current || current.closed === true) return null;
  return current;
}

function scheduleWebhookClose(win, wait) {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = 0;
    try { win.close(); } catch { /* already closed */ }
    if (typeof window !== 'undefined' && window.__kcWebhookWindow === win) window.__kcWebhookWindow = null;
  }, wait);
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function httpUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Posts the JSON from the page. Yuvomi's connect rule blocks fetch, and only
 * an administrator can create the notification channel below. A form is
 * allowed to leave the origin. The window must already be open from the click.
 * Two calls share that window, with a gap so the first POST is not cancelled.
 */
async function relayViaForm(url, payload) {
  const fields = plainFormBody(payload);
  if (!fields || !httpUrl(url) || typeof document === 'undefined' || !document.body) return false;
  const run = formChain.then(() => {
    const win = liveWebhookWindow();
    if (!win) return false;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.enctype = 'text/plain';
    form.acceptCharset = 'UTF-8';
    form.target = WEBHOOK_WINDOW;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = fields.name;
    input.value = fields.value;
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
    windowUsed = true;
    scheduleWebhookClose(win, 2000);
    return true;
  });
  formChain = run.then(() => delay(800), () => delay(800));
  return run;
}

/**
 * Yuvomi's page may only fetch its own origin. Ask Yuvomi to POST the same
 * JSON, then drop the temporary channel. Only an administrator can create
 * that channel. A member check-off uses the form above instead.
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
  const formSend = typeof options.form === 'function' ? options.form : relayViaForm;
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

  async function sendForHousehold(url, payload, signal) {
    try {
      return await postWebhook(url, payload, signal);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (await relay(url, payload)) return { status: 204, body: '' };
      try {
        if (await formSend(url, payload)) return { status: 204, body: '' };
      } catch (formError) {
        if (formError?.name === 'AbortError') throw formError;
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
