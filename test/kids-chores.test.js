import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { register } from 'node:module';

import { createClient, KidsChoresError } from '../kids-chores/lib/client.js';
import { STATE_MARK } from '../kids-chores/lib/household.js';
import { postWebhook } from '../kids-chores/lib/webhook.js';
import {
  PREFIX,
  PROGRESS_ICONS,
  buildToday,
  commit,
  defaultState,
  handle,
  normalizeState,
  openDocument,
  project,
  shouldShowOnWall,
  webhookDenied,
  webhookEvent,
  zonedCalendar,
} from '../kids-chores/lib/logic.js';
import { createServer } from '../kids-chores/service/server.js';

const FRIDAY = new Date('2026-11-13T12:00:00Z');
const admin = { id: 'a', name: 'Ada', access: 'write', role: 'admin', csrfToken: 't' };
const member = { id: 'b', name: 'Bea', access: 'write', role: 'member', csrfToken: 't' };
const reader = { id: 'c', name: 'Cy', access: 'read', role: 'member', csrfToken: 't' };
const nobody = { id: 'd', name: 'Dee', access: 'none', role: 'admin', csrfToken: 't' };

function calls() {
  const box = { log: [], rule: null };
  box.post = async (url, payload) => {
    const rule = box.rule || { status: 200, body: { ok: true } };
    box.log.push({ url, payload });
    return rule;
  };
  return box;
}

function ask(state, method, route, body, actor = admin, hooks = calls(), now = FRIDAY) {
  return handle(state, {
    method,
    path: route,
    body,
    actor,
    now,
    postWebhook: hooks.post,
  });
}

test('calendar date rolls over at midnight in Europe/Oslo', () => {
  const saturday = zonedCalendar(new Date('2026-11-14T22:30:00Z'), 'Europe/Oslo');
  assert.deepEqual(saturday, { date: '2026-11-14', weekday: 6 });
  const sunday = zonedCalendar(new Date('2026-11-14T23:30:00Z'), 'Europe/Oslo');
  assert.deepEqual(sunday, { date: '2026-11-15', weekday: 7 });
});

test('today view sorts, locks, scores, and hides the webhook', async () => {
  let state = defaultState();
  state.settings.pointGoal = 10;
  state.settings.webhookUrl = 'https://hooks.example/secret';
  const created = {};
  for (const title of ['Zebra', 'Alpha', 'Bravo']) {
    const result = await ask(state, 'POST', '/chores', { title, points: title === 'Zebra' ? 2 : 4, days: [5] });
    state = result.state;
    created[title] = result.body.chore.id;
  }
  for (const chore of state.chores) chore.sort = 1;
  state.chores.find((chore) => chore.title === 'Zebra').sort = 0;
  state.chores.find((chore) => chore.title === 'Bravo').requireAboveDone = true;
  state.chores.find((chore) => chore.title === 'Bravo').webhookUrl = 'https://hooks.example/secret';
  const view = buildToday(state, FRIDAY);
  assert.deepEqual(view.items.map((item) => item.title), ['Zebra', 'Alpha', 'Bravo']);
  assert.equal(view.items.find((item) => item.title === 'Bravo').locked, true);
  state.completions[view.date] = { [created.Zebra]: { at: FRIDAY.toISOString(), by: 'Ada' } };
  const scored = buildToday(state, FRIDAY);
  const bravo = scored.items.find((item) => item.title === 'Bravo');
  assert.equal(bravo.locked, true);
  assert.equal(scored.earned, 2);
  assert.equal(scored.percent, 20);
  assert.equal(scored.open.some((item) => item.title === 'Bravo'), false);
  assert.equal(scored.open.some((item) => item.title === 'Alpha'), true);

  state.completions[scored.date][created.Bravo] = { at: FRIDAY.toISOString(), by: 'Ada' };
  const doneHidden = buildToday(state, FRIDAY);
  const doneBravo = doneHidden.items.find((item) => item.title === 'Bravo');
  assert.equal(doneBravo.locked, false);
  assert.equal(doneHidden.earned, 6);

  const today = await ask(state, 'GET', '/today');
  const packed = JSON.stringify(today.body);
  assert.equal(packed.includes('hooks.example'), false);
  assert.equal(today.body.settings.webhookUrl, undefined);
  const chores = await ask(state, 'GET', '/chores');
  assert.equal(chores.body.settings.webhookUrl, 'https://hooks.example/secret');
  assert.equal(chores.body.chores.find((chore) => chore.title === 'Bravo').webhookUrl, 'https://hooks.example/secret');
});

test('goal, percent, and an empty list', () => {
  const state = defaultState();
  state.settings.pointGoal = 0;
  state.chores.push({
    id: 'c', title: 'Beds', points: 5, days: [5], active: true, sort: 0,
    requireAboveDone: false, webhookUrl: null, resetWebhookUrl: null,
  });
  const zero = buildToday(state, FRIDAY);
  assert.equal(zero.percent, 0);
  assert.equal(zero.goalReached, false);
  assert.equal(zero.allDone, false);
  state.settings.pointGoal = 3;
  state.completions[zero.date] = { c: { at: FRIDAY.toISOString(), by: 'Ada' } };
  const reached = buildToday(state, FRIDAY);
  assert.equal(reached.percent, 100);
  assert.equal(reached.goalReached, true);
  assert.equal(reached.allDone, true);
  assert.deepEqual(reached.open, []);
  state.chores = [];
  assert.equal(buildToday(state, FRIDAY).allDone, false);
});

test('settings keep the previous timezone and accept the progress icons', async () => {
  let state = defaultState();
  const badZone = await ask(state, 'PUT', '/settings', { timezone: 'Mars/Base', pointGoal: 4 });
  assert.equal(badZone.status, 400);
  assert.equal(badZone.body.reason, 'invalid');
  assert.equal(badZone.state.settings.timezone, 'Europe/Oslo');
  assert.equal(badZone.state.settings.pointGoal, 10);
  const badIcon = await ask(state, 'PUT', '/settings', { progressIcon: 'comet' });
  assert.equal(badIcon.status, 400);
  assert.equal(badIcon.state.settings.progressIcon, 'sun');
  for (const icon of PROGRESS_ICONS) {
    const picked = await ask(state, 'PUT', '/settings', { progressIcon: icon });
    assert.equal(picked.status, 200);
    assert.equal(picked.state.settings.progressIcon, icon);
    state = picked.state;
  }
  assert.equal(normalizeState({ settings: { progressIcon: 'comet' } }).settings.progressIcon, 'sun');
  const saved = await ask(state, 'PUT', '/settings', {
    displayTitle: 'Saturday jobs',
    pointGoal: 4,
    congratsMessage: 'Yes',
    timezone: 'Europe/Oslo',
    progressIcon: 'star',
    notifyAdmin: false,
    showOnWall: true,
    webhookUrl: '',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.state.settings.progressIcon, 'star');
  assert.equal(saved.state.settings.webhookUrl, null);
  assert.equal(saved.state.settings.showOnWall, true);
  assert.equal(saved.state.settings.notifyAdmin, false);
  state = saved.state;
  state.settings.webhookUrl = 'https://hooks.example/reward';
  const cleared = await ask(state, 'PUT', '/settings', { webhookUrl: '' });
  assert.equal(cleared.state.settings.webhookUrl, null);
  assert.equal(cleared.state.settings.pointGoal, 4);
});

test('a Homey address keeps its event name when the chore is completed', async () => {
  let state = defaultState();
  const created = await ask(state, 'POST', '/chores', {
    title: 'ella_checkin',
    points: 1,
    days: [5],
    webhookUrl: 'https://webhooks.athom.com/webhook/abc?homey=HOMEYID&event=ella_checkin',
  });
  state = created.state;
  const hooks = calls();
  hooks.rule = { status: 404, body: 'Webhook Not Found' };
  const done = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(done.status, 200);
  assert.equal(done.body.open.length, 0);
  assert.deepEqual(hooks.log[0].payload, {
    event: 'ella_checkin',
    state: 'yes',
    done: true,
    points: 1,
  });
  hooks.rule = { status: 200, body: { ok: false } };
  state = done.state;
  state.completions = {};
  const blocked = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.reason, 'webhook_denied');
});

test('chore rules: limit, reorder, day, lock, webhook, goal once, reset, prune', async () => {
  let state = defaultState();
  state.settings.pointGoal = 5;
  state.settings.webhookUrl = 'https://hooks.example/reward';
  for (let index = 0; index < 48; index += 1) {
    const result = await ask(state, 'POST', '/chores', { title: `Chore ${index}`, points: 1, days: [1] });
    assert.equal(result.status, 201);
    state = result.state;
  }
  const limited = await ask(state, 'POST', '/chores', { title: 'One more', points: 1 });
  assert.equal(limited.status, 409);
  assert.equal(limited.body.reason, 'limit');
  state = defaultState();
  state.settings.pointGoal = 5;
  state.settings.webhookUrl = 'https://hooks.example/reward';

  const first = await ask(state, 'POST', '/chores', { title: 'Make beds', points: 3, days: [5] });
  state = first.state;
  const second = await ask(state, 'POST', '/chores', {
    title: 'Dishes',
    points: 3,
    days: [5],
    requireAboveDone: true,
    webhookUrl: 'https://hooks.example/chore',
    resetWebhookUrl: 'https://hooks.example/reset',
  });
  state = second.state;
  const beds = first.body.chore.id;
  const dishes = second.body.chore.id;
  const backwards = await ask(state, 'PUT', '/chores/reorder', { ids: [dishes, beds] });
  assert.equal(backwards.status, 200);
  assert.deepEqual(backwards.body.chores.map((chore) => chore.id), [dishes, beds]);
  state = backwards.state;
  const restored = await ask(state, 'PUT', '/chores/reorder', { ids: [beds, dishes] });
  state = restored.state;
  const duplicate = await ask(state, 'PUT', '/chores/reorder', { ids: [beds, beds] });
  assert.equal(duplicate.status, 400);

  const hooks = calls();
  const wrongDay = await ask(state, 'POST', '/complete', { id: beds }, admin, hooks, new Date('2026-11-14T12:00:00Z'));
  assert.equal(wrongDay.status, 400);
  assert.equal(wrongDay.body.reason, 'day');
  assert.equal(hooks.log.length, 0);

  const locked = await ask(state, 'POST', '/complete', { id: dishes }, admin, hooks);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.reason, 'locked');
  assert.equal(Object.keys(locked.state.completions).length, 0);

  hooks.rule = { status: 200, body: { ok: false } };
  state.chores.find((chore) => chore.id === dishes).requireAboveDone = false;
  const denied = await ask(state, 'POST', '/complete', { id: dishes }, admin, hooks);
  assert.equal(denied.status, 409);
  assert.equal(denied.body.reason, 'webhook_denied');
  assert.equal(hooks.log[0].payload.event, 'kids_chores.chore_completed');
  assert.equal(hooks.log[0].payload.state, 'yes');
  assert.equal(webhookDenied(200, 'ok'), false);
  assert.equal(webhookDenied(200, 'OK'), false);
  assert.equal(webhookDenied(404, 'Webhook Not Found'), true);
  assert.equal(webhookEvent('https://webhooks.athom.com/webhook/abc?homey=HOMEYID&event=ella_checkin', 'kids_chores.chore_completed'), 'ella_checkin');
  assert.equal(Object.keys(denied.state.completions).length, 0);

  hooks.log.length = 0;
  hooks.rule = { status: 500, body: {} };
  const httpDenied = await ask(state, 'POST', '/complete', { id: dishes }, admin, hooks);
  assert.equal(httpDenied.status, 409);

  hooks.log.length = 0;
  hooks.rule = { status: 200, body: { ok: true } };
  const bedsDone = await ask(state, 'POST', '/complete', { id: beds }, admin, hooks);
  assert.equal(bedsDone.status, 200);
  assert.equal(bedsDone.body.earned, 3);
  assert.equal(bedsDone.body.goalReached, false);
  assert.equal(hooks.log.some((entry) => entry.payload.event === 'kids_chores.goal_reached'), false);
  state = bedsDone.state;

  hooks.log.length = 0;
  const dishesDone = await ask(state, 'POST', '/complete', { id: dishes }, admin, hooks);
  assert.equal(dishesDone.status, 200);
  assert.equal(dishesDone.body.goalReached, true);
  assert.equal(dishesDone.body.percent, 100);
  const goal = hooks.log.filter((entry) => entry.payload.event === 'kids_chores.goal_reached');
  assert.equal(goal.length, 1);
  assert.equal(goal[0].url, 'https://hooks.example/reward');
  assert.equal(goal[0].payload.percent, 100);
  assert.equal(goal[0].payload.triggeredBy, 'Ada');
  state = dishesDone.state;

  hooks.log.length = 0;
  const again = await ask(state, 'POST', '/complete', { id: dishes }, admin, hooks);
  assert.equal(again.status, 200);
  assert.equal(hooks.log.length, 0);

  const old = '2026-10-01';
  const yesterday = '2026-11-12';
  state.completions[old] = { [beds]: { at: FRIDAY.toISOString(), by: 'Ada' } };
  state.completions[yesterday] = { [beds]: { at: FRIDAY.toISOString(), by: 'Ada' } };
  state.goals[old] = { at: FRIDAY.toISOString(), earned: 1, notified: true };
  const resetHooks = calls();
  const reset = await ask(state, 'POST', '/reset-today', {}, admin, resetHooks);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.earned, 0);
  assert.equal(reset.state.completions[reset.body.date], undefined);
  assert.equal(reset.state.goals[reset.body.date], undefined);
  assert.equal(reset.state.completions[old], undefined);
  assert.ok(reset.state.completions[yesterday]);
  assert.equal(reset.state.goals[old], undefined);
  const resetCalls = resetHooks.log.map((entry) => entry.payload);
  assert.ok(resetCalls.some((payload) => payload.state === 'no' && payload.done === false));
  assert.ok(resetCalls.some((payload) => payload.event === 'kids_chores.points_reset' && payload.earned === 0));

  const memberCreate = await ask(reset.state, 'POST', '/chores', { title: 'Nope', points: 1 }, member);
  assert.equal(memberCreate.status, 403);
  assert.equal(memberCreate.body.reason, 'forbidden');
  const memberComplete = await ask(reset.state, 'POST', '/complete', { id: beds }, member);
  assert.equal(memberComplete.status, 200);
  assert.equal(memberComplete.body.earned, 3);
  const readerComplete = await ask(reset.state, 'POST', '/complete', { id: beds }, reader);
  assert.equal(readerComplete.status, 403);
  const hidden = await ask(reset.state, 'GET', '/today', undefined, nobody);
  assert.equal(hidden.status, 403);
  const missing = await ask(reset.state, 'POST', '/complete', { id: 'nope' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.reason, 'missing');
});

test('a negative webhook number blocks, and a later goal can fire again after reset', async () => {
  let state = defaultState();
  state.settings.pointGoal = 1;
  state.settings.webhookUrl = 'https://hooks.example/reward';
  const created = await ask(state, 'POST', '/chores', {
    title: 'Read',
    points: 1,
    days: [5],
    webhookUrl: 'https://hooks.example/chore',
  });
  state = created.state;
  const hooks = calls();
  hooks.rule = { status: 200, body: -1 };
  const blocked = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(blocked.status, 409);
  hooks.rule = { status: 200, body: { state: 'no' } };
  const blockedState = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(blockedState.status, 409);

  hooks.rule = { status: 200, body: { state: 'yes' } };
  hooks.log.length = 0;
  const done = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(done.body.goalReached, true);
  assert.equal(done.state.goals[done.body.date][admin.id].notified, true);
  const reset = await ask(done.state, 'POST', '/reset-today', {}, admin, calls());
  hooks.log.length = 0;
  const again = await ask(reset.state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(again.body.goalReached, true);
  assert.equal(hooks.log.filter((entry) => entry.payload.event === 'kids_chores.goal_reached').length, 1);
});

test('local test webhook does not call out', async () => {
  const state = defaultState();
  state.settings.webhookUrl = 'https://hooks.example/reward';
  const hooks = calls();
  const result = await ask(state, 'POST', '/test-webhook', { state: 'yes' }, { ...admin, local: true }, hooks);
  assert.equal(result.body.needsService, true);
  assert.equal(hooks.log.length, 0);
  const live = await ask(state, 'POST', '/test-webhook', { state: 'yes' }, admin, hooks);
  assert.equal(live.status, 200);
  assert.deepEqual(hooks.log[0].payload, { state: 'yes', done: true });
});

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

test('a Homey call that never leaves does not mark the chore done', async () => {
  let state = defaultState();
  const created = await ask(state, 'POST', '/chores', {
    title: 'Ella',
    points: 1,
    days: [1, 2, 3, 4, 5, 6, 7],
    webhookUrl: 'https://webhooks.athom.com/webhook/abc?homey=HOMEYID&event=ella_checkin',
  });
  state = created.state;
  const hooks = calls();
  hooks.post = async () => {
    throw new TypeError('Failed to fetch');
  };
  const blocked = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, admin, hooks);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.reason, 'webhook_denied');
  assert.equal(Object.keys(blocked.state.completions).length, 0);

  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    await assert.rejects(
      () => postWebhook('https://webhooks.athom.com/webhook/abc?homey=HOMEYID&event=ella_checkin', {
        event: 'ella_checkin',
        state: 'yes',
        done: true,
        points: 1,
      }),
      (err) => err instanceof TypeError,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test('the browser falls back only when the service is absent', async () => {
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  try {
    globalThis.fetch = async () => { throw new TypeError('network'); };
    const offline = createClient();
    const created = await offline.createChore({ title: 'Local only', points: 2, days: [1, 2, 3, 4, 5, 6, 7] });
    assert.equal(created.local, true);
    assert.equal(created.access, 'write');
    assert.equal(created.role, 'admin');
    assert.equal(created.csrfToken, 'local');
    const today = await offline.today();
    assert.equal(today.items[0].title, 'Local only');
    assert.equal(storage.getItem('kids-chores.state.v1').includes('Local only'), true);

    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => '<html>missing</html>',
    });
    const stillLocal = await createClient().today();
    assert.equal(stillLocal.local, true);

    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ reason: 'auth', error: 'auth' }),
    });
    await assert.rejects(createClient().today(), (err) => err instanceof KidsChoresError && err.reason === 'auth');
    assert.equal(storage.getItem('kids-chores.state.v1').includes('Local only'), true);

    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ reason: 'locked', error: 'locked' }),
    });
    await assert.rejects(createClient().complete('x'), (err) => err.reason === 'locked');

    let tries = 0;
    globalThis.fetch = async (_url, init) => {
      tries += 1;
      const token = init.headers['X-Kids-Chores-CSRF'];
      if (tries === 1) {
        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ reason: 'csrf', csrfToken: 'fresh' }),
        };
      }
      assert.equal(token, 'fresh');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          date: '2026-11-13',
          items: [],
          open: [],
          earned: 0,
          goal: 10,
          percent: 0,
          goalReached: false,
          allDone: false,
          settings: { displayTitle: 'From service' },
          csrfToken: 'fresh',
        }),
      };
    };
    const retried = await createClient().saveSettings({ displayTitle: 'From service' });
    assert.equal(retried.settings.displayTitle, 'From service');
    assert.equal(retried.local, undefined);
    assert.equal(storage.getItem('kids-chores.state.v1').includes('Local only'), true);
    assert.equal(tries, 2);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('the sidecar checks the session, csrf, origin, and file mode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kids-chores-'));
  const statePath = path.join(dir, 'state.json');
  const seen = [];
  const webhooks = [];
  let webhookStatus = 200;
  let webhookBody = { ok: true };
  const auth = await listen((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie || '' });
    const cookie = req.headers.cookie || '';
    const role = cookie.includes('admin') ? 'admin' : 'member';
    const level = cookie.includes('none') ? 'none' : (cookie.includes('read') ? 'read' : 'write');
    const modules = cookie.includes('open') ? {} : { 'ext:kids-chores': level };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      user: { id: cookie, display_name: role === 'admin' ? 'Ada' : 'Bea', role },
      permissions: { admin: role === 'admin', modules },
    }));
  });
  const hooks = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      webhooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      res.writeHead(webhookStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(webhookBody));
    });
  });
  const authPort = auth.address().port;
  const hookPort = hooks.address().port;
  const server = createServer({ statePath, authUrl: `http://127.0.0.1:${authPort}` });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  async function api(method, route, { cookie = 'session=admin', token, origin, body } = {}) {
    const headers = { accept: 'application/json', cookie };
    if (token) headers['x-kids-chores-csrf'] = token;
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${port}${PREFIX}${route}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    const first = await api('GET', '/today');
    assert.equal(first.status, 200);
    assert.equal(seen[0].cookie, 'session=admin');
    assert.equal(seen[0].url, '/api/v1/auth/me');
    const token = first.body.csrfToken;
    assert.equal(typeof token, 'string');

    const missingToken = await api('POST', '/chores', { body: { title: 'Beds', points: 2, days: [1, 2, 3, 4, 5, 6, 7] } });
    assert.equal(missingToken.status, 403);
    assert.equal(missingToken.body.reason, 'csrf');
    const retry = await api('POST', '/chores', {
      token: missingToken.body.csrfToken,
      body: { title: 'Beds', points: 2, days: [1, 2, 3, 4, 5, 6, 7], webhookUrl: `http://127.0.0.1:${hookPort}/chore` },
    });
    assert.equal(retry.status, 201);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);

    const foreign = await api('POST', '/chores', {
      token: missingToken.body.csrfToken,
      origin: 'https://evil.example',
      body: { title: 'Nope', points: 1 },
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.reason, 'origin');

    const memberCall = await api('POST', '/chores', {
      cookie: 'session=member',
      body: { title: 'Nope', points: 1 },
    });
    assert.equal(memberCall.body.reason, 'csrf');
    const memberDenied = await api('POST', '/chores', {
      cookie: 'session=member',
      token: memberCall.body.csrfToken,
      body: { title: 'Nope', points: 1 },
    });
    assert.equal(memberDenied.status, 403);
    assert.equal(memberDenied.body.reason, 'forbidden');

    const memberToday = await api('GET', '/today', { cookie: 'session=member' });
    const memberDone = await api('POST', '/complete', {
      cookie: 'session=member',
      token: memberToday.body.csrfToken,
      body: { id: retry.body.chore.id },
    });
    assert.equal(memberDone.status, 200);
    assert.equal(memberDone.body.earned, 2);
    assert.equal(webhooks.some((payload) => payload.event === 'kids_chores.chore_completed'), true);
    assert.equal(JSON.stringify(memberDone.body).includes(String(hookPort)), false);

    const none = await api('GET', '/today', { cookie: 'session=none' });
    assert.equal(none.status, 403);
    assert.equal(none.body.reason, 'forbidden');

    const open = await api('GET', '/today', { cookie: 'session=open' });
    assert.equal(open.status, 200);
    assert.equal(open.body.access, 'write');

    const reader = await api('POST', '/complete', {
      cookie: 'session=read',
      body: { id: retry.body.chore.id },
    });
    assert.equal(reader.body.reason, 'csrf');
    const readerDenied = await api('POST', '/complete', {
      cookie: 'session=read',
      token: reader.body.csrfToken,
      body: { id: retry.body.chore.id },
    });
    assert.equal(readerDenied.status, 403);

    fs.writeFileSync(statePath, '{', { mode: 0o600 });
    const broken = await api('GET', '/today');
    assert.equal(broken.status, 500);
    assert.equal(broken.body.reason, 'internal');
    assert.equal(fs.readFileSync(statePath, 'utf8'), '{');
  } finally {
    server.close();
    auth.close();
    hooks.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the overview catalog gets a Kids Chores widget', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../kids-chores/module.json', import.meta.url), 'utf8'));
  const widget = manifest.capabilities.widgets[0];
  assert.equal(widget.id, 'today');
  assert.equal(widget.entry, 'widgets/today.js');
  assert.equal(widget.label, 'Kids Chores');
  assert.equal(widget.labelKey, 'widgets.today');
  assert.equal(widget.defaultVisible, true);
  assert.equal(manifest.capabilities.permissions.widgets[0].id, 'today');
  assert.equal(manifest.capabilities.permissions.widgets[0].label, 'Kids Chores');
  for (const locale of ['en', 'nb']) {
    const strings = JSON.parse(fs.readFileSync(new URL(`../kids-chores/locales/${locale}.json`, import.meta.url), 'utf8'));
    assert.equal(strings['widgets.today'], 'Kids Chores');
    if (locale === 'nb') assert.equal(strings['page.congrats'], 'Alt ferdig i dag — Bra jobba!');
    for (const icon of PROGRESS_ICONS) {
      assert.equal(typeof strings[`icon.${icon}`], 'string');
      assert.ok(strings[`icon.${icon}`].length > 1);
    }
  }
});

test('overview choresApi returns today and completes a chore without the service', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  register(new URL('./i18n-hook.mjs', import.meta.url));
  const { choresApi, moduleDisplayTitle } = await import('../kids-chores/browser.js');
  const created = await choresApi('/chores', {
    method: 'POST',
    body: { title: 'Seng', points: 3, days: [1, 2, 3, 4, 5, 6, 7] },
  });
  const today = await choresApi('/today');
  assert.equal(today.items.some((item) => item.title === 'Seng'), true);
  assert.equal(today.open.some((item) => item.title === 'Seng'), true);
  assert.equal(today.settings.showOnWall, false);
  assert.equal(Object.hasOwn(today.settings, 'webhookUrl'), false);
  assert.equal(moduleDisplayTitle(today.settings), 'Today');
  assert.equal(moduleDisplayTitle({ displayTitle: 'Morgenstell' }), 'Morgenstell');
  assert.equal(shouldShowOnWall(today), false);
  const done = await choresApi('/complete', { method: 'POST', body: { id: created.chore.id } });
  assert.equal(done.earned, 3);
  assert.equal(done.open.some((item) => item.title === 'Seng'), false);
  assert.equal(shouldShowOnWall({ settings: { showOnWall: true }, items: done.items }), true);
  await assert.rejects(
    () => choresApi('/complete', { method: 'POST', body: { id: 'missing' } }),
    (err) => err.reason === 'missing' && err.status === 404,
  );
});

test('a child only sees their own chores, and a parent follows the children they choose', async () => {
  let state = defaultState();
  const created = await ask(state, 'POST', '/chores', {
    title: 'Seng',
    points: 2,
    days: [5],
    assigneeIds: ['b'],
  });
  state = created.state;
  assert.deepEqual(created.body.chore.assigneeIds, ['b']);
  const ada = await ask(state, 'GET', '/today');
  const bea = await ask(state, 'GET', '/today', undefined, member);
  assert.equal(ada.body.items.some((item) => item.title === 'Seng'), false);
  assert.equal(bea.body.items.some((item) => item.title === 'Seng'), true);
  const hidden = await ask(state, 'POST', '/complete', { id: created.body.chore.id });
  assert.equal(hidden.status, 404);
  const sibling = await ask(state, 'POST', '/complete', { id: created.body.chore.id, forUserId: 'b' }, {
    id: 'c', name: 'Noa', access: 'write', role: 'member', csrfToken: 't',
  });
  assert.equal(sibling.status, 404);

  const followed = await ask(state, 'PUT', '/settings', { followingIds: ['b'] });
  state = followed.state;
  assert.deepEqual(followed.body.followingIds, ['b']);
  const adaFollows = await ask(state, 'GET', '/today');
  assert.equal(adaFollows.body.boards.some((board) => board.userId === 'b' && board.items[0].title === 'Seng'), true);
  assert.equal(adaFollows.body.viewerId, 'a');
  const done = await ask(state, 'POST', '/complete', { id: created.body.chore.id, forUserId: 'b' });
  assert.equal(done.status, 200);
  assert.equal(done.body.boards.find((board) => board.userId === 'b').earned, 2);
  const beaAfter = await ask(done.state, 'GET', '/today', undefined, member);
  assert.equal(beaAfter.body.items[0].done, true);
  assert.equal(beaAfter.body.earned, 2);

  const legacy = defaultState();
  legacy.chores = [{ ...created.state.chores[0], assigneeIds: null, excludedMemberIds: ['b'] }];
  assert.equal(buildToday(legacy, FRIDAY, member).items.length, 0);
  legacy.completions[done.body.date] = { [created.body.chore.id]: { at: FRIDAY.toISOString(), by: 'Ada' } };
  const adaLegacy = buildToday({
    ...legacy,
    chores: [{ ...legacy.chores[0], excludedMemberIds: [] }],
  }, FRIDAY, admin);
  assert.equal(adaLegacy.items[0].done, true);
});

test('a chore with nobody checked is generic and shows for every member', async () => {
  let state = defaultState();
  const created = await ask(state, 'POST', '/chores', {
    title: 'Søppel',
    points: 1,
    days: [5],
    assigneeIds: [],
  });
  state = created.state;
  assert.deepEqual(created.body.chore.assigneeIds, []);
  const ada = await ask(state, 'GET', '/today');
  const bea = await ask(state, 'GET', '/today', undefined, member);
  assert.equal(ada.body.items.some((item) => item.title === 'Søppel'), true);
  assert.equal(bea.body.items.some((item) => item.title === 'Søppel'), true);
  const done = await ask(state, 'POST', '/complete', { id: created.body.chore.id }, member);
  assert.equal(done.body.items[0].done, true);
  const adaAfter = await ask(done.state, 'GET', '/today');
  assert.equal(adaAfter.body.items[0].done, false);
  const follow = await ask(done.state, 'PUT', '/settings', { followingIds: ['b'] });
  const boards = (await ask(follow.state, 'GET', '/today')).body.boards;
  const shown = boards.filter((board) => board.items.some((item) => item.title === 'Søppel'));
  assert.deepEqual(shown.map((board) => board.userId), ['a']);
});

test('sharing off keeps one list per account, and the same account is one list', async () => {
  const doc = openDocument({
    settings: { shareAcrossUsers: false },
    shared: { chores: [], completions: {}, goals: {} },
    private: {},
  });
  let view = project(doc, admin);
  const created = await ask(view, 'POST', '/chores', { title: 'PC', points: 1, days: [5] });
  commit(doc, admin, created.state);
  const ipad = project(doc, admin);
  assert.equal(ipad.chores[0].title, 'PC');
  const other = project(doc, member);
  assert.equal(other.chores.length, 0);

  const shared = openDocument(null);
  let household = project(shared, admin);
  const chore = await ask(household, 'POST', '/chores', { title: 'Felles', points: 1, days: [5] });
  commit(shared, admin, chore.state);
  const turnedOff = await ask(project(shared, admin), 'PUT', '/settings', { shareAcrossUsers: false });
  commit(shared, admin, turnedOff.state);
  assert.equal(project(shared, admin).chores[0].title, 'Felles');
  assert.equal(project(shared, member).chores.length, 0);
  assert.equal(shared.shared.chores.length, 0);

  const again = openDocument(JSON.parse(JSON.stringify(shared)));
  const follow = await ask(project(again, admin), 'PUT', '/settings', { followingIds: ['b'] });
  commit(again, admin, follow.state);
  assert.deepEqual(project(again, admin).followingIds, ['b']);
  assert.deepEqual(project(again, member).followingIds, []);
});

const HOMEY = 'https://webhooks.athom.com/webhook/648d9cdc3e7ea90bb080ab45?homey=HOMEYID&event=ella_checkin';

test('a generic chore saved by an administrator is visible to other members through household notes', async () => {
  const notes = [];
  const writes = [];
  const webhooks = [];
  let who = { id: 1, role: 'admin', name: 'Ada' };
  const api = fakeNotes(notes, writes, () => who);
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://webhooks.athom.com/')) {
      webhooks.push({ url: href, body: JSON.parse(init.body) });
      return { ok: true, status: 204, text: async () => '' };
    }
    throw new TypeError('network');
  };
  const clientFor = () => createClient({
    loadApi: async () => ({ api }),
    now: () => FRIDAY,
  });
  try {
    who = { id: 2, role: 'member', name: 'Bea' };
    const before = await clientFor().today();
    assert.equal(before.items.length, 0);
    assert.equal(before.local, undefined);
    assert.equal(notes.length, 0);

    who = { id: 1, role: 'admin', name: 'Ada' };
    const admin = clientFor();
    const generic = await admin.createChore({
      title: 'Tømme sekken',
      points: 5,
      days: [5],
      assigneeIds: [],
      webhookUrl: HOMEY,
    });
    assert.equal(generic.local, undefined);
    assert.equal(generic.role, 'admin');
    const linked = await admin.createChore({
      title: 'Ryggsekk',
      points: 1,
      days: [5],
      assigneeIds: ['2'],
    });
    const again = await admin.today();
    assert.equal(again.items.some((item) => item.title === 'Tømme sekken'), true);
    assert.equal(writes.filter((write) => write.userId === 1 && write.content.includes(STATE_MARK)).length, 2);

    who = { id: 3, role: 'member', name: 'Cy' };
    const sibling = await clientFor().today();
    assert.equal(sibling.role, 'member');
    assert.deepEqual(sibling.items.map((item) => item.title), ['Tømme sekken']);

    who = { id: 2, role: 'member', name: 'Bea' };
    const child = clientFor();
    const seen = await child.today();
    assert.deepEqual(seen.items.map((item) => item.title).sort(), ['Ryggsekk', 'Tømme sekken']);
    const done = await child.complete(generic.chore.id);
    assert.equal(done.items.find((item) => item.title === 'Tømme sekken').done, true);
    assert.equal(done.items.find((item) => item.title === 'Ryggsekk').done, false);
    await child.complete(linked.chore.id);
    assert.deepEqual(webhooks, [{
      url: HOMEY,
      body: { event: 'ella_checkin', state: 'yes', done: true, points: 5 },
    }]);
    assert.equal(writes.some((write) => write.userId === 2 && write.content.includes(STATE_MARK)), false);

    who = { id: 1, role: 'admin', name: 'Ada' };
    const stillOpen = await admin.today();
    assert.equal(stillOpen.items.find((item) => item.title === 'Tømme sekken').done, false);
    await admin.saveSettings({ followingIds: ['2'] });
    const followed = await admin.today();
    const board = followed.boards.find((item) => item.userId === '2');
    assert.equal(board.items.find((item) => item.title === 'Ryggsekk').done, true);
    assert.equal(board.items.some((item) => item.title === 'Tømme sekken'), false);
    const state = notes.find((note) => note.content.includes(STATE_MARK));
    assert.equal(state.visibility, 'all');
    assert.equal(state.content.includes(HOMEY), true);
    assert.equal(state.content.includes('"assigneeIds":[]'), true);
    const log = notes.find((note) => String(note.created_by) === '2');
    assert.equal(log.content.includes('"pending"'), false);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

test('chores already stored in this browser are copied into the household note', async () => {
  const notes = [];
  const writes = [];
  let who = { id: 1, role: 'admin', name: 'Ada' };
  const api = fakeNotes(notes, writes, () => who);
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  globalThis.fetch = async () => { throw new TypeError('network'); };
  const doc = openDocument(null);
  const local = { id: 'local', name: 'local', access: 'write', role: 'admin', csrfToken: 'local', local: true };
  const created = await handle(project(doc, local), {
    method: 'POST',
    path: '/chores',
    body: { title: 'Tømme sekken', points: 5, days: [5], assigneeIds: [] },
    actor: local,
    now: FRIDAY,
    postWebhook: async () => ({ status: 204, body: '' }),
  });
  commit(doc, local, created.state);
  const finished = await handle(project(doc, local), {
    method: 'POST',
    path: '/complete',
    body: { id: created.body.chore.id },
    actor: local,
    now: FRIDAY,
    postWebhook: async () => ({ status: 204, body: '' }),
  });
  commit(doc, local, finished.state);
  storage.setItem('kids-chores.state.v1', JSON.stringify(doc));
  const clientFor = () => createClient({
    loadApi: async () => ({ api }),
    now: () => FRIDAY,
  });
  try {
    const admin = await clientFor().today();
    assert.equal(admin.local, undefined);
    assert.equal(admin.items[0].title, 'Tømme sekken');
    assert.equal(admin.items[0].done, true);
    who = { id: 2, role: 'member', name: 'Bea' };
    const member = await clientFor().today();
    assert.equal(member.items[0].title, 'Tømme sekken');
    assert.equal(member.items[0].done, false);
    assert.equal(notes.some((note) => note.content.includes(STATE_MARK)), true);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

test('a member check-off is saved and an administrator session sends the same webhook', async () => {
  const notes = [];
  const writes = [];
  const sent = [];
  let who = { id: 1, role: 'admin', name: 'Ada' };
  const api = fakeNotes(notes, writes, () => who);
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  globalThis.fetch = async () => { throw new TypeError('network'); };
  const clientFor = (relay) => createClient({
    loadApi: async () => ({ api }),
    now: () => FRIDAY,
    relay,
  });
  const payload = { event: 'ella_checkin', state: 'yes', done: true, points: 5 };
  try {
    const admin = clientFor(async (url, body) => {
      sent.push({ url, payload: body });
      return true;
    });
    const generic = await admin.createChore({
      title: 'Tømme sekken',
      points: 5,
      days: [5],
      assigneeIds: [],
      webhookUrl: HOMEY,
    });
    const own = await admin.complete(generic.chore.id);
    assert.equal(own.items.find((item) => item.title === 'Tømme sekken').done, true);
    assert.deepEqual(sent, [{ url: HOMEY, payload }]);
    const adminLog = notes.find((note) => String(note.created_by) === '1');
    assert.equal(adminLog.content.includes('"pending"'), false);

    who = { id: 2, role: 'member', name: 'Bea' };
    let memberTries = 0;
    const child = clientFor(async () => {
      memberTries += 1;
      return false;
    });
    const done = await child.complete(generic.chore.id);
    assert.equal(done.items.find((item) => item.title === 'Tømme sekken').done, true);
    assert.equal(memberTries, 1);
    assert.equal(sent.length, 1);
    const childLog = notes.find((note) => String(note.created_by) === '2');
    const stored = JSON.parse(childLog.content.split('\n').slice(2).join('\n'));
    assert.equal(stored.pending.length, 1);
    assert.equal(stored.pending[0].url, HOMEY);
    assert.deepEqual(stored.pending[0].payload, payload);
    assert.equal(writes.some((write) => write.userId === 2 && write.content.includes(STATE_MARK)), false);

    who = { id: 1, role: 'admin', name: 'Ada' };
    await admin.today();
    assert.deepEqual(sent, [{ url: HOMEY, payload }, { url: HOMEY, payload }]);
    const cleared = JSON.parse(notes.find((note) => String(note.created_by) === '2').content.split('\n').slice(2).join('\n'));
    assert.equal(cleared.pending, undefined);
    await admin.today();
    assert.equal(sent.length, 2);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

test('an explicit Homey refusal still blocks a member check-off', async () => {
  const notes = [];
  const writes = [];
  let who = { id: 1, role: 'admin', name: 'Ada' };
  const api = fakeNotes(notes, writes, () => who);
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://webhooks.athom.com/')) {
      return { ok: true, status: 200, text: async () => '{"state":"no"}' };
    }
    throw new TypeError('network');
  };
  const clientFor = () => createClient({
    loadApi: async () => ({ api }),
    now: () => FRIDAY,
    relay: async () => false,
  });
  try {
    const created = await clientFor().createChore({
      title: 'Tømme sekken',
      points: 5,
      days: [5],
      assigneeIds: [],
      webhookUrl: HOMEY,
    });
    who = { id: 2, role: 'member', name: 'Bea' };
    await assert.rejects(
      () => clientFor().complete(created.chore.id),
      (err) => err instanceof KidsChoresError && err.reason === 'webhook_denied',
    );
    const log = notes.find((note) => String(note.created_by) === '2');
    assert.equal(log, undefined);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

function fakeNotes(notes, writes, session) {
  let nextId = 1;
  const me = () => session();
  const canEdit = (note) => {
    const person = me();
    if (String(note.created_by) === String(person.id)) return true;
    if (person.role === 'admin') return true;
    return false;
  };
  const visible = (note) => {
    const person = me();
    if (note.visibility !== 'private') return true;
    return String(note.created_by) === String(person.id);
  };
  return {
    async get(path) {
      const person = me();
      if (path === '/auth/me') {
        return {
          user: { id: person.id, role: person.role, display_name: person.name },
          permissions: person.role === 'admin'
            ? { admin: true }
            : { capabilities: { notes_edit_others: 'none' } },
        };
      }
      if (path === '/notes') return { data: notes.filter(visible).map((note) => ({ ...note })) };
      throw Object.assign(new Error('missing'), { status: 404 });
    },
    async post(path, body) {
      if (path !== '/notes') throw Object.assign(new Error('missing'), { status: 404 });
      const person = me();
      const note = {
        id: nextId,
        content: body.content,
        title: body.title,
        color: body.color,
        visibility: body.visibility || 'all',
        created_by: person.id,
      };
      nextId += 1;
      notes.push(note);
      writes.push({ userId: person.id, method: 'POST', content: body.content });
      return { data: { ...note } };
    },
    async put(path, body) {
      const id = Number(String(path).split('/')[2]);
      const note = notes.find((item) => item.id === id);
      if (!note) throw Object.assign(new Error('missing'), { status: 404 });
      if (!canEdit(note)) throw Object.assign(new Error('not owner'), { status: 403 });
      if (body.visibility && body.visibility !== note.visibility && String(note.created_by) !== String(me().id)) {
        throw Object.assign(new Error('not owner'), { status: 403 });
      }
      if (body.content != null) note.content = body.content;
      if (body.title !== undefined) note.title = body.title;
      if (body.visibility) note.visibility = body.visibility;
      writes.push({ userId: me().id, method: 'PUT', content: body.content });
      return { data: { ...note } };
    },
  };
}
