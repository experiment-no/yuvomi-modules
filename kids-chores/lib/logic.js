/**
 * Kids Chores domain rules. Shared by the browser fallback and the sidecar.
 * No DOM and no Node builtins, so a module page can import it.
 */

export const MAX_CHORES = 48;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_DAYS = [1, 2, 3, 4, 5];
export const PREFIX = '/api/extensions/kids-chores';
export const PROGRESS_ICONS = [
  'sun',
  'star',
  'heart',
  'moon',
  'flower',
  'trophy',
  'rocket',
  'house',
  'tree',
  'smile',
  'cloud',
  'crown',
  'diamond',
];

const WEEKDAY_SHORT = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function defaultSettings() {
  return {
    pointGoal: 10,
    congratsMessage: '',
    displayTitle: '',
    webhookUrl: null,
    notifyAdmin: true,
    showOnWall: false,
    timezone: 'Europe/Oslo',
    progressIcon: 'sun',
  };
}

export function defaultState() {
  return {
    version: 1,
    settings: defaultSettings(),
    chores: [],
    completions: {},
    goals: {},
  };
}

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function zonedCalendar(date, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'Europe/Oslo';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.create(null);
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  const weekday = WEEKDAY_SHORT[parts.weekday];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekday || 1,
  };
}

/** Milliseconds until the calendar date changes in `timeZone`. */
export function msUntilNextDate(now, timeZone) {
  const current = zonedCalendar(now, timeZone).date;
  let lo = now.getTime();
  let hi = lo + 36 * 60 * 60 * 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedCalendar(new Date(mid), timeZone).date === current) lo = mid;
    else hi = mid;
  }
  return Math.max(1000, hi - now.getTime() + 1500);
}

export function isProgressIcon(value) {
  return PROGRESS_ICONS.includes(value);
}

function cloneChore(chore) {
  return {
    id: chore.id,
    title: chore.title,
    points: chore.points,
    days: [...chore.days],
    active: chore.active !== false,
    sort: chore.sort,
    requireAboveDone: Boolean(chore.requireAboveDone),
    webhookUrl: chore.webhookUrl || null,
    resetWebhookUrl: chore.resetWebhookUrl || null,
  };
}

export function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  state.settings = {
    ...defaultSettings(),
    pointGoal: cleanGoal(settings.pointGoal, 10),
    congratsMessage: cleanText(settings.congratsMessage, 240),
    displayTitle: cleanText(settings.displayTitle, 80),
    webhookUrl: typeof settings.webhookUrl === 'string' && settings.webhookUrl ? settings.webhookUrl : null,
    notifyAdmin: settings.notifyAdmin !== false,
    showOnWall: settings.showOnWall === true,
    timezone: isValidTimeZone(settings.timezone) ? settings.timezone : 'Europe/Oslo',
    progressIcon: isProgressIcon(settings.progressIcon) ? settings.progressIcon : 'sun',
  };
  if (Array.isArray(raw.chores)) {
    state.chores = raw.chores.slice(0, MAX_CHORES).map((chore, index) => normalizeChore(chore, index)).filter(Boolean);
  }
  if (raw.completions && typeof raw.completions === 'object') {
    for (const [date, map] of Object.entries(raw.completions)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !map || typeof map !== 'object') continue;
      const day = {};
      for (const [id, entry] of Object.entries(map)) {
        if (!entry || typeof entry !== 'object') continue;
        day[id] = {
          at: typeof entry.at === 'string' ? entry.at : new Date(0).toISOString(),
          by: typeof entry.by === 'string' ? entry.by.slice(0, 80) : '',
        };
      }
      state.completions[date] = day;
    }
  }
  if (raw.goals && typeof raw.goals === 'object') {
    for (const [date, entry] of Object.entries(raw.goals)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || typeof entry !== 'object') continue;
      state.goals[date] = {
        at: typeof entry.at === 'string' ? entry.at : '',
        earned: Number.isFinite(entry.earned) ? entry.earned : 0,
        notified: entry.notified === true,
      };
    }
  }
  return state;
}

function normalizeChore(raw, index) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const title = cleanText(raw.title, 80);
  if (!title) return null;
  return {
    id: raw.id.slice(0, 80),
    title,
    points: cleanPoints(raw.points),
    days: cleanDays(raw.days),
    active: raw.active !== false,
    sort: Number.isFinite(raw.sort) ? raw.sort : index,
    requireAboveDone: raw.requireAboveDone === true,
    webhookUrl: typeof raw.webhookUrl === 'string' && raw.webhookUrl ? raw.webhookUrl : null,
    resetWebhookUrl: typeof raw.resetWebhookUrl === 'string' && raw.resetWebhookUrl ? raw.resetWebhookUrl : null,
  };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function cleanGoal(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 1000000 ? value : fallback;
}

function cleanPoints(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : 0;
}

function cleanDays(value) {
  if (!Array.isArray(value)) return [...DEFAULT_DAYS];
  const days = [...new Set(value.filter((day) => WEEKDAYS.includes(day)))].sort((a, b) => a - b);
  return days;
}

export function cloneState(state) {
  return normalizeState(JSON.parse(JSON.stringify(state)));
}

export function publicSettings(settings, includeWebhook) {
  const out = {
    pointGoal: settings.pointGoal,
    congratsMessage: settings.congratsMessage,
    displayTitle: settings.displayTitle,
    notifyAdmin: settings.notifyAdmin,
    showOnWall: settings.showOnWall,
    timezone: settings.timezone,
    progressIcon: settings.progressIcon,
  };
  if (includeWebhook) out.webhookUrl = settings.webhookUrl;
  return out;
}

/** Wall stays hidden until an admin opts in and today has a scheduled chore. */
export function shouldShowOnWall(data) {
  if (!data || data.settings?.showOnWall !== true) return false;
  return Array.isArray(data.items) && data.items.length > 0;
}

export function buildToday(state, now = new Date()) {
  const { date, weekday } = zonedCalendar(now, state.settings.timezone);
  const doneMap = state.completions[date] || {};
  const scheduled = state.chores
    .filter((chore) => chore.active && chore.days.includes(weekday))
    .slice()
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  const items = scheduled.map((chore, index) => {
    const done = Boolean(doneMap[chore.id]);
    const earlierOpen = scheduled.slice(0, index).some((earlier) => !doneMap[earlier.id]);
    const locked = !done && chore.requireAboveDone === true && earlierOpen;
    return {
      id: chore.id,
      title: chore.title,
      points: chore.points,
      days: [...chore.days],
      sort: chore.sort,
      requireAboveDone: chore.requireAboveDone === true,
      done,
      locked,
    };
  });

  const earned = items.reduce((sum, item) => (item.done ? sum + item.points : sum), 0);
  const goal = state.settings.pointGoal;
  const percent = goal > 0 ? Math.min(100, Math.round((earned / goal) * 100)) : 0;
  const open = items.filter((item) => !item.locked && !item.done);
  return {
    date,
    weekday,
    items,
    open,
    earned,
    goal,
    percent,
    goalReached: goal > 0 && earned >= goal,
    allDone: items.length > 0 && items.every((item) => item.done),
  };
}

function meta(actor, extra = {}) {
  return {
    access: actor.access,
    role: actor.role,
    csrfToken: actor.csrfToken,
    ...(actor.local ? { local: true } : {}),
    ...extra,
  };
}

function fail(status, reason, actor, state) {
  return {
    status,
    state,
    body: {
      error: reason,
      reason,
      ...meta(actor),
    },
  };
}

export function todayBody(state, actor, now) {
  const view = buildToday(state, now);
  return {
    date: view.date,
    weekday: view.weekday,
    settings: publicSettings(state.settings, false),
    items: view.items,
    open: view.open,
    earned: view.earned,
    goal: view.goal,
    percent: view.percent,
    goalReached: view.goalReached,
    allDone: view.allDone,
    congratsMessage: state.settings.congratsMessage,
    progressIcon: state.settings.progressIcon,
    ...meta(actor),
  };
}

function gate(actor, need) {
  if (!actor || actor.access == null) return { status: 401, reason: 'auth' };
  if (actor.access === 'none') return { status: 403, reason: 'forbidden' };
  if (need === 'read') return null;
  if (actor.access !== 'write') return { status: 403, reason: 'forbidden' };
  if (need === 'admin' && actor.role !== 'admin') return { status: 403, reason: 'forbidden' };
  return null;
}

function prune(state, today) {
  const cutoff = shiftDate(today, -14);
  for (const date of Object.keys(state.completions)) {
    if (date < cutoff) delete state.completions[date];
  }
  for (const date of Object.keys(state.goals)) {
    if (date < cutoff) delete state.goals[date];
  }
}

function shiftDate(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Use `?event=` from the saved address, so a Homey trigger name is the event we POST. */
export function webhookEvent(url, fallback) {
  try {
    const value = new URL(url).searchParams.get('event');
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  } catch {
    // A stored address that does not parse keeps the built-in event name.
  }
  return fallback;
}

export function isAthomWebhook(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'webhooks.athom.com' || host === 'webhook.homey.app' || host.endsWith('.connect.athom.com');
  } catch {
    return false;
  }
}

/** Body that matched a working Homey call: event, state, done, points. */
export function choreWebhookPayload(chore, context) {
  const event = webhookEvent(chore.webhookUrl, '');
  if (event) {
    return {
      event,
      state: 'yes',
      done: true,
      points: chore.points,
    };
  }
  return {
    state: 'yes',
    done: true,
    event: 'kids_chores.chore_completed',
    module: 'kids-chores',
    date: context.date,
    choreId: chore.id,
    title: chore.title,
    points: chore.points,
    timezone: context.timezone,
    triggeredBy: context.triggeredBy,
  };
}

export function parseWebhookUrl(value) {
  if (value == null) return { url: null };
  if (typeof value !== 'string') return { error: 'webhook' };
  const trimmed = value.trim();
  if (!trimmed) return { url: null };
  if (trimmed.length > 2048) return { error: 'webhook' };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'webhook' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'webhook' };
  if (parsed.username || parsed.password) return { error: 'webhook' };
  return { url: parsed.toString() };
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function applySettings(state, body) {
  if (!body || typeof body !== 'object') return { error: 'invalid' };
  const next = { ...state.settings };
  if (body.displayTitle !== undefined) {
    if (typeof body.displayTitle !== 'string') return { error: 'invalid' };
    const title = cleanText(body.displayTitle, 80);
    if (title.length !== body.displayTitle.trim().length) return { error: 'invalid' };
    next.displayTitle = title;
  }
  if (body.pointGoal !== undefined) {
    if (!Number.isInteger(body.pointGoal) || body.pointGoal < 0 || body.pointGoal > 1000000) {
      return { error: 'invalid' };
    }
    next.pointGoal = body.pointGoal;
  }
  if (body.congratsMessage !== undefined) {
    if (typeof body.congratsMessage !== 'string' || body.congratsMessage.length > 240) return { error: 'invalid' };
    next.congratsMessage = cleanText(body.congratsMessage, 240);
  }
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) return { error: 'invalid' };
    next.timezone = body.timezone;
  }
  if (body.progressIcon !== undefined) {
    if (!isProgressIcon(body.progressIcon)) return { error: 'invalid' };
    next.progressIcon = body.progressIcon;
  }
  if (body.notifyAdmin !== undefined) {
    if (typeof body.notifyAdmin !== 'boolean') return { error: 'invalid' };
    next.notifyAdmin = body.notifyAdmin;
  }
  if (body.showOnWall !== undefined) {
    if (typeof body.showOnWall !== 'boolean') return { error: 'invalid' };
    next.showOnWall = body.showOnWall;
  }
  if (body.webhookUrl !== undefined) {
    const parsed = parseWebhookUrl(body.webhookUrl);
    if (parsed.error) return { error: parsed.error };
    next.webhookUrl = parsed.url;
  }
  return { settings: next };
}

function choreFromBody(body, previous) {
  if (!body || typeof body !== 'object') return { error: 'invalid' };
  const titleSource = body.title !== undefined ? body.title : previous?.title;
  if (typeof titleSource !== 'string') return { error: 'invalid' };
  const title = cleanText(titleSource, 80);
  if (!title || title.length !== String(titleSource).trim().length) return { error: 'invalid' };
  const pointsSource = body.points !== undefined ? body.points : previous?.points ?? 1;
  if (!Number.isInteger(pointsSource) || pointsSource < 0 || pointsSource > 1000) return { error: 'invalid' };
  let days;
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || body.days.some((day) => !WEEKDAYS.includes(day))) return { error: 'invalid' };
    days = [...new Set(body.days)].sort((a, b) => a - b);
  } else {
    days = previous ? [...previous.days] : [...DEFAULT_DAYS];
  }
  const active = body.active !== undefined ? body.active : (previous ? previous.active : true);
  if (typeof active !== 'boolean') return { error: 'invalid' };
  const requireAboveDone = body.requireAboveDone !== undefined
    ? body.requireAboveDone
    : (previous ? previous.requireAboveDone : false);
  if (typeof requireAboveDone !== 'boolean') return { error: 'invalid' };
  const webhookSource = body.webhookUrl !== undefined ? body.webhookUrl : previous?.webhookUrl ?? null;
  const resetSource = body.resetWebhookUrl !== undefined ? body.resetWebhookUrl : previous?.resetWebhookUrl ?? null;
  const webhook = parseWebhookUrl(webhookSource);
  if (webhook.error) return { error: webhook.error };
  const reset = parseWebhookUrl(resetSource);
  if (reset.error) return { error: reset.error };
  return {
    chore: {
      id: previous?.id || newId(),
      title,
      points: pointsSource,
      days,
      active,
      sort: previous?.sort ?? 0,
      requireAboveDone,
      webhookUrl: webhook.url,
      resetWebhookUrl: reset.url,
    },
  };
}

function sortChores(chores) {
  return chores.slice().sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function choresBody(state, actor) {
  return {
    chores: sortChores(state.chores).map(cloneChore),
    settings: publicSettings(state.settings, true),
    ...meta(actor),
  };
}

/**
 * A webhook reply blocks completion when the HTTP status is outside 2xx,
 * the JSON says ok:false or state:"no", or the body is a negative number.
 */
export function webhookDenied(status, body) {
  if (!Number.isInteger(status) || status < 200 || status >= 300) return true;
  if (typeof body === 'number') return body < 0;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return false;
    const numeric = Number(trimmed);
    return trimmed === String(numeric) && numeric < 0;
  }
  if (body && typeof body === 'object') {
    if (body.ok === false) return true;
    if (body.state === 'no') return true;
    if (typeof body.state === 'number' && body.state < 0) return true;
  }
  return false;
}

function explicitWebhookDenial(body) {
  if (typeof body === 'number') return body < 0;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return false;
    const numeric = Number(trimmed);
    return trimmed === String(numeric) && numeric < 0;
  }
  if (body && typeof body === 'object') {
    if (body.ok === false) return true;
    if (body.state === 'no') return true;
    if (typeof body.state === 'number' && body.state < 0) return true;
  }
  return false;
}

async function callWebhook(postWebhook, url, payload) {
  if (!url) return { denied: false };
  if (typeof postWebhook !== 'function') return { denied: true };
  try {
    const result = await postWebhook(url, payload);
    // Homey answers a delivered trigger with plain "ok", and sometimes with a
    // status the browser can read as a failure. Only an explicit no blocks it.
    if (isAthomWebhook(url)) return { denied: explicitWebhookDenial(result?.body) };
    return { denied: webhookDenied(result?.status, result?.body) };
  } catch {
    return { denied: !isAthomWebhook(url) };
  }
}

export async function handle(state, request) {
  const actor = request.actor;
  const now = request.now instanceof Date ? request.now : new Date();
  const method = request.method;
  const path = request.path || '/';
  const denied = gate(actor, request.need || needFor(method, path));
  if (denied) return fail(denied.status, denied.reason, actor, state);

  const next = cloneState(state);
  const today = zonedCalendar(now, next.settings.timezone).date;
  prune(next, today);

  if (method === 'GET' && path === '/today') {
    return { status: 200, state: next, body: todayBody(next, actor, now) };
  }
  if (method === 'GET' && path === '/chores') {
    return { status: 200, state: next, body: choresBody(next, actor) };
  }
  if (method === 'PUT' && path === '/settings') {
    const applied = applySettings(next, request.body);
    if (applied.error) return fail(400, applied.error, actor, state);
    next.settings = applied.settings;
    return { status: 200, state: next, body: { settings: publicSettings(next.settings, true), ...meta(actor) } };
  }
  if (method === 'POST' && path === '/chores') {
    if (next.chores.length >= MAX_CHORES) return fail(409, 'limit', actor, state);
    const built = choreFromBody(request.body, null);
    if (built.error) return fail(400, built.error, actor, state);
    const maxSort = next.chores.reduce((max, chore) => Math.max(max, chore.sort), -1);
    built.chore.sort = maxSort + 1;
    next.chores.push(built.chore);
    return { status: 201, state: next, body: { chore: cloneChore(built.chore), ...meta(actor) } };
  }
  if (method === 'PUT' && path === '/chores/reorder') {
    const ids = request.body?.ids;
    if (!Array.isArray(ids)) return fail(400, 'invalid', actor, state);
    const current = next.chores.map((chore) => chore.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length) return fail(400, 'invalid', actor, state);
    if (current.some((id) => !ids.includes(id))) return fail(400, 'invalid', actor, state);
    const byId = new Map(next.chores.map((chore) => [chore.id, chore]));
    next.chores = ids.map((id, index) => ({ ...byId.get(id), sort: index }));
    return { status: 200, state: next, body: choresBody(next, actor) };
  }
  const choreMatch = path.match(/^\/chores\/([^/]+)$/);
  if (choreMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(choreMatch[1]);
    const index = next.chores.findIndex((chore) => chore.id === id);
    if (index < 0) return fail(404, 'missing', actor, state);
    if (method === 'DELETE') {
      next.chores.splice(index, 1);
      return { status: 200, state: next, body: { deleted: id, ...meta(actor) } };
    }
    const built = choreFromBody(request.body, next.chores[index]);
    if (built.error) return fail(400, built.error, actor, state);
    next.chores[index] = built.chore;
    return { status: 200, state: next, body: { chore: cloneChore(built.chore), ...meta(actor) } };
  }
  if (method === 'POST' && path === '/complete') {
    return complete(next, state, request, actor, now);
  }
  if (method === 'POST' && path === '/reset-today') {
    return resetToday(next, request, actor, now);
  }
  if (method === 'POST' && path === '/test-webhook') {
    return testWebhook(next, state, request, actor, now);
  }
  return fail(404, 'missing', actor, state);
}

function needFor(method, path) {
  if (method === 'GET' && path === '/today') return 'read';
  if (method === 'POST' && path === '/complete') return 'write';
  return 'admin';
}

async function complete(next, original, request, actor, now) {
  const id = request.body?.id;
  if (typeof id !== 'string' || !id) return fail(400, 'invalid', actor, original);
  const { date, weekday } = zonedCalendar(now, next.settings.timezone);
  const scheduled = next.chores
    .filter((chore) => chore.active && chore.days.includes(weekday))
    .slice()
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const chore = scheduled.find((item) => item.id === id);
  if (!chore) {
    const exists = next.chores.some((item) => item.id === id);
    return fail(exists ? 400 : 404, exists ? 'day' : 'missing', actor, original);
  }
  const doneMap = { ...(next.completions[date] || {}) };
  if (doneMap[id]) {
    return { status: 200, state: next, body: todayBody(next, actor, now) };
  }
  const index = scheduled.findIndex((item) => item.id === id);
  const locked = chore.requireAboveDone === true
    && scheduled.slice(0, index).some((earlier) => !doneMap[earlier.id]);
  if (locked) return fail(409, 'locked', actor, original);

  if (chore.webhookUrl) {
    const reply = await callWebhook(request.postWebhook, chore.webhookUrl, choreWebhookPayload(chore, {
      date,
      timezone: next.settings.timezone,
      triggeredBy: actor.name || String(actor.id || ''),
    }));
    if (reply.denied) return fail(409, 'webhook_denied', actor, original);
  }

  doneMap[id] = { at: now.toISOString(), by: actor.name || String(actor.id || '') };
  next.completions[date] = doneMap;
  const view = buildToday(next, now);
  const goal = next.goals[date];
  const crossed = view.goalReached && !goal?.notified;
  if (crossed) {
    next.goals[date] = { at: now.toISOString(), earned: view.earned, notified: true };
  }
  if (crossed && next.settings.webhookUrl) {
    await callWebhook(request.postWebhook, next.settings.webhookUrl, {
      event: 'kids_chores.goal_reached',
      module: 'kids-chores',
      date,
      earned: view.earned,
      goal: view.goal,
      percent: 100,
      timezone: next.settings.timezone,
      triggeredBy: actor.name || String(actor.id || ''),
    });
  }
  return { status: 200, state: next, body: todayBody(next, actor, now) };
}

async function resetToday(next, request, actor, now) {
  const { date } = zonedCalendar(now, next.settings.timezone);
  const resets = next.chores.filter((chore) => chore.resetWebhookUrl);
  delete next.completions[date];
  delete next.goals[date];
  for (const chore of resets) {
    await callWebhook(request.postWebhook, chore.resetWebhookUrl, { state: 'no', done: false });
  }
  if (next.settings.webhookUrl) {
    await callWebhook(request.postWebhook, next.settings.webhookUrl, {
      event: 'kids_chores.points_reset',
      module: 'kids-chores',
      date,
      earned: 0,
      goal: next.settings.pointGoal,
      timezone: next.settings.timezone,
    });
  }
  return { status: 200, state: next, body: todayBody(next, actor, now) };
}

async function testWebhook(next, original, request, actor) {
  if (actor.local) {
    return {
      status: 200,
      state: original,
      body: {
        ok: false,
        needsService: true,
        reason: 'unreachable',
        ...meta(actor),
      },
    };
  }
  const state = request.body?.state;
  if (state !== 'yes' && state !== 'no') return fail(400, 'invalid', actor, original);
  if (!next.settings.webhookUrl) return fail(400, 'webhook', actor, original);
  const reply = await callWebhook(request.postWebhook, next.settings.webhookUrl, {
    state,
    done: state === 'yes',
  });
  if (reply.denied) return fail(502, 'webhook', actor, original);
  return { status: 200, state: original, body: { ok: true, ...meta(actor) } };
}
