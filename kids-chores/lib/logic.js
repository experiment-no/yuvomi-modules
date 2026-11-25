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
    shareAcrossUsers: true,
    rolledOn: '',
  };
}

export function defaultState() {
  return {
    version: 1,
    settings: defaultSettings(),
    chores: [],
    completions: {},
    goals: {},
    unlocks: {},
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
    unlockDelayMinutes: cleanDelayMinutes(chore.unlockDelayMinutes),
    requireWebhookUnlock: Boolean(chore.requireWebhookUnlock),
    unlockToken: cleanUnlockToken(chore.unlockToken),
    webhookUrl: chore.webhookUrl || null,
    resetWebhookUrl: chore.resetWebhookUrl || null,
    assigneeIds: copyAssigneeIds(chore.assigneeIds),
    excludedMemberIds: cleanMemberIds(chore.excludedMemberIds),
  };
}

function cleanDelayMinutes(value) {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, 24 * 60);
}

function cleanUnlockToken(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (!/^kc_[A-Za-z0-9]{8,32}$/.test(token)) return null;
  return token;
}

export function newUnlockToken() {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `kc_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;
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
    shareAcrossUsers: settings.shareAcrossUsers !== false,
    rolledOn: /^\d{4}-\d{2}-\d{2}$/.test(settings.rolledOn) ? settings.rolledOn : '',
  };
  state.followingIds = cleanMemberIds(raw.followingIds);
  if (Array.isArray(raw.chores)) {
    state.chores = raw.chores.slice(0, MAX_CHORES).map((chore, index) => normalizeChore(chore, index)).filter(Boolean);
  }
  if (raw.completions && typeof raw.completions === 'object') {
    for (const [date, map] of Object.entries(raw.completions)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !map || typeof map !== 'object') continue;
      const day = {};
      for (const [id, entry] of Object.entries(map)) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.at === 'string') {
          day[id] = {
            at: entry.at,
            by: typeof entry.by === 'string' ? entry.by.slice(0, 80) : '',
          };
          continue;
        }
        const people = {};
        for (const [userId, row] of Object.entries(entry)) {
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(userId) || !row || typeof row !== 'object' || typeof row.at !== 'string') continue;
          people[userId] = {
            at: row.at,
            by: typeof row.by === 'string' ? row.by.slice(0, 80) : '',
          };
        }
        if (Object.keys(people).length) day[id] = people;
      }
      state.completions[date] = day;
    }
  }
  if (raw.goals && typeof raw.goals === 'object') {
    for (const [date, entry] of Object.entries(raw.goals)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || typeof entry !== 'object') continue;
      if (typeof entry.at === 'string' || typeof entry.notified === 'boolean') {
        state.goals[date] = {
          at: typeof entry.at === 'string' ? entry.at : '',
          earned: Number.isFinite(entry.earned) ? entry.earned : 0,
          notified: entry.notified === true,
        };
        continue;
      }
      const people = {};
      for (const [userId, row] of Object.entries(entry)) {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(userId) || !row || typeof row !== 'object') continue;
        if (typeof row.at !== 'string' && typeof row.notified !== 'boolean') continue;
        people[userId] = {
          at: typeof row.at === 'string' ? row.at : '',
          earned: Number.isFinite(row.earned) ? row.earned : 0,
          notified: row.notified === true,
        };
      }
      if (Object.keys(people).length) state.goals[date] = people;
    }
  }
  if (raw.unlocks && typeof raw.unlocks === 'object') {
    for (const [date, day] of Object.entries(raw.unlocks)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object') continue;
      const cleaned = {};
      for (const [choreId, entry] of Object.entries(day)) {
        const people = cleanUnlockDayEntry(entry);
        if (people) cleaned[choreId] = people;
      }
      if (Object.keys(cleaned).length) state.unlocks[date] = cleaned;
    }
  }
  return state;
}

function cleanUnlockDayEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.at === 'string') {
    return { at: entry.at.slice(0, 40), by: typeof entry.by === 'string' ? entry.by.slice(0, 80) : 'webhook' };
  }
  const people = {};
  for (const [userId, row] of Object.entries(entry)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(userId) || !row || typeof row !== 'object') continue;
    if (typeof row.at !== 'string') continue;
    people[userId] = {
      at: row.at.slice(0, 40),
      by: typeof row.by === 'string' ? row.by.slice(0, 80) : 'webhook',
    };
  }
  return Object.keys(people).length ? people : null;
}

function normalizeChore(raw, index) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const title = cleanText(raw.title, 80);
  if (!title) return null;
  const requireWebhookUnlock = raw.requireWebhookUnlock === true;
  return {
    id: raw.id.slice(0, 80),
    title,
    points: cleanPoints(raw.points),
    days: cleanDays(raw.days),
    active: raw.active !== false,
    sort: Number.isFinite(raw.sort) ? raw.sort : index,
    requireAboveDone: raw.requireAboveDone === true,
    unlockDelayMinutes: cleanDelayMinutes(raw.unlockDelayMinutes),
    requireWebhookUnlock,
    unlockToken: requireWebhookUnlock ? cleanUnlockToken(raw.unlockToken) : null,
    webhookUrl: typeof raw.webhookUrl === 'string' && raw.webhookUrl ? raw.webhookUrl : null,
    resetWebhookUrl: typeof raw.resetWebhookUrl === 'string' && raw.resetWebhookUrl ? raw.resetWebhookUrl : null,
    assigneeIds: assigneeList(raw),
    excludedMemberIds: cleanMemberIds(raw.excludedMemberIds),
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

function cleanMemberIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 64) break;
  }
  return ids;
}

/** `null` means a chore saved before assignees: it still shows for everyone except exclusions. */
function assigneeList(raw) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(raw, 'assigneeIds')) return null;
  if (!Array.isArray(raw.assigneeIds)) return null;
  return cleanMemberIds(raw.assigneeIds);
}

function copyAssigneeIds(value) {
  if (value == null) return null;
  return cleanMemberIds(value);
}

/** A completion stored as `{ at, by }` counts for every member. Newer rows are per user id. */
export function doneFor(entry, userId) {
  return Boolean(doneEntry(entry, userId));
}

export function doneEntry(entry, userId) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.at === 'string') return entry;
  const id = String(userId ?? '');
  if (id && entry[id] && typeof entry[id] === 'object') return entry[id];
  if (entry['*'] && typeof entry['*'] === 'object') return entry['*'];
  return null;
}

export function unlockedFor(entry, userId) {
  return Boolean(doneEntry(entry, userId));
}

/**
 * Who has this chore on their own list. Sharing off shows the account's list.
 * No assignee list means a generic chore: it is not tied to a child, and every
 * member sees it on their own list. An older chore with a missing list does the
 * same, except ids in `excludedMemberIds`. A non-empty list is only those people.
 * Follow boards skip generic chores so a parent does not see them twice.
 */
export function choreFor(chore, settings, userId, options = {}) {
  if (settings?.shareAcrossUsers === false) return true;
  const assigned = copyAssigneeIds(chore?.assigneeIds);
  const id = userId == null || userId === '' ? '' : String(userId);
  if (assigned == null || assigned.length === 0) {
    if (options.legacy === 'skip') return false;
    if (assigned == null) {
      const excluded = cleanMemberIds(chore?.excludedMemberIds);
      if (!excluded.length || !id) return true;
      return !excluded.includes(id);
    }
    return true;
  }
  if (!id) return false;
  return assigned.includes(id);
}

function isFlatGoal(entry) {
  return Boolean(entry && (typeof entry.at === 'string' || typeof entry.notified === 'boolean'));
}

function goalNotified(entry, userId) {
  if (!entry) return false;
  if (isFlatGoal(entry)) return entry.notified !== false;
  const id = String(userId ?? '');
  return entry['*']?.notified === true || (id && entry[id]?.notified === true);
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
    shareAcrossUsers: settings.shareAcrossUsers !== false,
  };
  if (includeWebhook) out.webhookUrl = settings.webhookUrl;
  return out;
}

/** Wall stays hidden until an admin opts in and today has a scheduled chore. */
export function shouldShowOnWall(data) {
  if (!data || data.settings?.showOnWall !== true) return false;
  return Array.isArray(data.items) && data.items.length > 0;
}

export function buildToday(state, now = new Date(), actor = null, targetUserId) {
  const viewerId = actor?.id == null || actor.id === '' ? '' : String(actor.id);
  const targetId = targetUserId === undefined ? viewerId : String(targetUserId);
  const { date, weekday } = zonedCalendar(now, state.settings.timezone);
  const doneMap = state.completions[date] || {};
  const scheduled = state.chores
    .filter((chore) => chore.active && chore.days.includes(weekday) && choreFor(chore, state.settings, targetId, {
      legacy: targetId === viewerId ? 'own' : 'skip',
    }))
    .slice()
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

  const unlockDay = state.unlocks?.[date] || {};
  const items = scheduled.map((chore, index) => {
    const done = doneFor(doneMap[chore.id], targetId);
    const gate = choreGate(chore, index, scheduled, doneMap, unlockDay, targetId, now, date, state.settings.timezone);
    return {
      id: chore.id,
      title: chore.title,
      points: chore.points,
      days: [...chore.days],
      sort: chore.sort,
      requireAboveDone: chore.requireAboveDone === true,
      unlockDelayMinutes: chore.unlockDelayMinutes || 0,
      requireWebhookUnlock: chore.requireWebhookUnlock === true,
      done,
      locked: !done && gate.locked,
      lockReason: !done && gate.locked ? gate.reason : null,
      availableAt: !done && gate.availableAt ? gate.availableAt : null,
      forUserId: targetId || 'local',
    };
  });

  const earned = items.reduce((sum, item) => (item.done ? sum + item.points : sum), 0);
  const goal = state.settings.pointGoal;
  const percent = goal > 0 ? Math.min(100, Math.round((earned / goal) * 100)) : 0;
  const open = items.filter((item) => !item.locked && !item.done);
  return {
    date,
    weekday,
    userId: targetId || 'local',
    items,
    open,
    earned,
    goal,
    percent,
    goalReached: goal > 0 && earned >= goal,
    allDone: items.length > 0 && items.every((item) => item.done),
  };
}

/** One board per person: the viewer's own chores, then each child they follow. */
export function buildBoards(state, now = new Date(), actor = null) {
  const viewerId = actor?.id == null || actor.id === '' ? 'local' : String(actor.id);
  const share = state.settings?.shareAcrossUsers !== false;
  const following = share
    ? cleanMemberIds(state.followingIds).filter((id) => id !== viewerId)
    : [];
  const own = buildToday(state, now, actor, viewerId);
  const boards = [];
  const followed = [];
  for (const id of following) {
    const board = buildToday(state, now, actor, id);
    if (board.items.length) followed.push(board);
  }
  if (own.items.length || followed.length === 0) boards.push(own);
  boards.push(...followed);
  return boards;
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

export function todayBody(state, actor, now, focusUserId) {
  const boards = buildBoards(state, now, actor);
  const focus = focusUserId ? boards.find((board) => board.userId === String(focusUserId)) : null;
  const single = boards.length === 1 ? boards[0] : null;
  const score = focus || single;
  const items = score ? score.items : boards.flatMap((board) => board.items);
  const open = score ? score.open : boards.flatMap((board) => board.open);
  const earned = score
    ? score.earned
    : items.reduce((sum, item) => (item.done ? sum + item.points : sum), 0);
  const goal = state.settings.pointGoal;
  const percent = score ? score.percent : (goal > 0 ? Math.min(100, Math.round((earned / goal) * 100)) : 0);
  return {
    date: (score || boards[0]).date,
    weekday: (score || boards[0]).weekday,
    settings: publicSettings(state.settings, false),
    viewerId: actor?.id == null || actor.id === '' ? 'local' : String(actor.id),
    followingIds: cleanMemberIds(state.followingIds),
    boards: boards.map((board) => ({
      userId: board.userId,
      items: board.items,
      open: board.open,
      earned: board.earned,
      goal: board.goal,
      percent: board.percent,
      goalReached: board.goalReached,
      allDone: board.allDone,
    })),
    items,
    open,
    earned,
    goal,
    percent,
    goalReached: score ? score.goalReached : boards.some((board) => board.goalReached),
    allDone: score ? score.allDone : (items.length > 0 && items.every((item) => item.done)),
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
  for (const date of Object.keys(state.unlocks || {})) {
    if (date < cutoff) delete state.unlocks[date];
  }
}

/**
 * When a chore waits on the ones above, on a delay, and/or on a Homey unlock.
 * Delay starts when every earlier chore is done (with requireAboveDone), else
 * at the start of the household calendar day.
 */
export function choreGate(chore, index, scheduled, doneMap, unlockDay, userId, now, date, timeZone) {
  if (chore.requireAboveDone === true) {
    const earlierOpen = scheduled.slice(0, index).some((earlier) => !doneFor(doneMap[earlier.id], userId));
    if (earlierOpen) return { locked: true, reason: 'above', availableAt: null };
  }

  const delayMinutes = cleanDelayMinutes(chore.unlockDelayMinutes);
  let availableAt = null;
  if (delayMinutes > 0) {
    let startMs = null;
    if (chore.requireAboveDone === true && index > 0) {
      startMs = latestDoneAt(scheduled.slice(0, index), doneMap, userId);
      if (startMs == null) return { locked: true, reason: 'above', availableAt: null };
    } else {
      startMs = zonedDayStartMs(date, timeZone);
    }
    const readyMs = startMs + delayMinutes * 60_000;
    availableAt = new Date(readyMs).toISOString();
    if (now.getTime() < readyMs) return { locked: true, reason: 'delay', availableAt };
  }

  if (chore.requireWebhookUnlock === true) {
    if (!unlockedFor(unlockDay?.[chore.id], userId)) {
      return { locked: true, reason: 'webhook', availableAt };
    }
  }

  return { locked: false, reason: null, availableAt };
}

function latestDoneAt(chores, doneMap, userId) {
  let latest = 0;
  for (const chore of chores) {
    const entry = doneEntry(doneMap[chore.id], userId);
    if (!entry) return null;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) return null;
    if (at > latest) latest = at;
  }
  return latest;
}

/** UTC millis for 00:00 on `YYYY-MM-DD` in the household time zone. */
export function zonedDayStartMs(isoDate, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return Date.parse(`${isoDate}T00:00:00Z`) || Date.now();
  const zone = isValidTimeZone(timeZone) ? timeZone : 'Europe/Oslo';
  let lo = Date.parse(`${isoDate}T00:00:00.000Z`) - 36 * 60 * 60 * 1000;
  let hi = Date.parse(`${isoDate}T00:00:00.000Z`) + 36 * 60 * 60 * 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (zonedCalendar(new Date(mid), zone).date < isoDate) lo = mid;
    else hi = mid;
  }
  return hi;
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

/**
 * Reward webhook. A Homey address with ?event= uses the same shape as a chore:
 * yes when the goal is reached, no when the day resets. Other addresses keep
 * the longer event name and carry the same yes or no.
 */
export function rewardPayload(url, high, context) {
  const event = webhookEvent(url, '');
  const earned = Number.isInteger(context?.earned) ? context.earned : 0;
  if (event) {
    return {
      event,
      state: high ? 'yes' : 'no',
      done: Boolean(high),
      points: high ? earned : 0,
    };
  }
  if (high) {
    return {
      state: 'yes',
      done: true,
      event: 'kids_chores.goal_reached',
      module: 'kids-chores',
      date: context?.date,
      earned,
      goal: context?.goal,
      percent: 100,
      timezone: context?.timezone,
      triggeredBy: context?.triggeredBy,
    };
  }
  return {
    state: 'no',
    done: false,
    event: 'kids_chores.points_reset',
    module: 'kids-chores',
    date: context?.date,
    earned: 0,
    goal: context?.goal,
    timezone: context?.timezone,
  };
}

function lowTogglePayload(url) {
  const event = webhookEvent(url, '');
  const payload = { state: 'no', done: false };
  if (event) payload.event = event;
  return payload;
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
  if (body.shareAcrossUsers !== undefined) {
    if (typeof body.shareAcrossUsers !== 'boolean') return { error: 'invalid' };
    next.shareAcrossUsers = body.shareAcrossUsers;
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
  let unlockDelayMinutes = previous ? cleanDelayMinutes(previous.unlockDelayMinutes) : 0;
  if (body.unlockDelayMinutes !== undefined) {
    if (!Number.isInteger(body.unlockDelayMinutes) || body.unlockDelayMinutes < 0 || body.unlockDelayMinutes > 24 * 60) {
      return { error: 'invalid' };
    }
    unlockDelayMinutes = body.unlockDelayMinutes;
  }
  const requireWebhookUnlock = body.requireWebhookUnlock !== undefined
    ? body.requireWebhookUnlock
    : (previous ? previous.requireWebhookUnlock === true : false);
  if (typeof requireWebhookUnlock !== 'boolean') return { error: 'invalid' };
  let unlockToken = previous ? cleanUnlockToken(previous.unlockToken) : null;
  if (requireWebhookUnlock) {
    if (body.unlockToken !== undefined) {
      unlockToken = cleanUnlockToken(body.unlockToken);
      if (body.unlockToken && !unlockToken) return { error: 'invalid' };
    }
    if (!unlockToken) unlockToken = newUnlockToken();
  } else {
    unlockToken = null;
  }
  const webhookSource = body.webhookUrl !== undefined ? body.webhookUrl : previous?.webhookUrl ?? null;
  const resetSource = body.resetWebhookUrl !== undefined ? body.resetWebhookUrl : previous?.resetWebhookUrl ?? null;
  const webhook = parseWebhookUrl(webhookSource);
  if (webhook.error) return { error: webhook.error };
  const reset = parseWebhookUrl(resetSource);
  if (reset.error) return { error: reset.error };
  let assigneeIds;
  if (body.assigneeIds !== undefined) {
    if (!Array.isArray(body.assigneeIds)) return { error: 'invalid' };
    assigneeIds = cleanMemberIds(body.assigneeIds);
    if (assigneeIds.length !== body.assigneeIds.length) return { error: 'invalid' };
  } else if (previous) {
    assigneeIds = copyAssigneeIds(previous.assigneeIds);
  } else {
    assigneeIds = null;
  }
  let excludedMemberIds;
  if (body.assigneeIds !== undefined) {
    excludedMemberIds = [];
  } else if (body.excludedMemberIds !== undefined) {
    if (!Array.isArray(body.excludedMemberIds)) return { error: 'invalid' };
    excludedMemberIds = cleanMemberIds(body.excludedMemberIds);
    if (excludedMemberIds.length !== body.excludedMemberIds.length) return { error: 'invalid' };
  } else {
    excludedMemberIds = previous ? cleanMemberIds(previous.excludedMemberIds) : [];
  }
  return {
    chore: {
      id: previous?.id || newId(),
      title,
      points: pointsSource,
      days,
      active,
      sort: previous?.sort ?? 0,
      requireAboveDone,
      unlockDelayMinutes,
      requireWebhookUnlock,
      unlockToken,
      webhookUrl: webhook.url,
      resetWebhookUrl: reset.url,
      assigneeIds,
      excludedMemberIds,
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
    followingIds: cleanMemberIds(state.followingIds),
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
    return { denied: true };
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
  let dayRolled = false;
  async function rollToday() {
    if (dayRolled || (method === 'POST' && path === '/reset-today')) return;
    dayRolled = true;
    await rollOverDay(next, request, actor, today);
  }

  if (method === 'GET' && path === '/today') {
    await rollToday();
    return { status: 200, state: next, body: todayBody(next, actor, now) };
  }
  if (method === 'GET' && path === '/chores') {
    await rollToday();
    return { status: 200, state: next, body: choresBody(next, actor) };
  }
  if (method === 'PUT' && path === '/settings') {
    const applied = applySettings(next, request.body);
    if (applied.error) return fail(400, applied.error, actor, state);
    if (request.body?.followingIds !== undefined) {
      if (!Array.isArray(request.body.followingIds)) return fail(400, 'invalid', actor, state);
      const followingIds = cleanMemberIds(request.body.followingIds);
      if (followingIds.length !== request.body.followingIds.length) return fail(400, 'invalid', actor, state);
      next.followingIds = followingIds;
    }
    next.settings = applied.settings;
    await rollToday();
    return {
      status: 200,
      state: next,
      body: {
        settings: publicSettings(next.settings, true),
        followingIds: cleanMemberIds(next.followingIds),
        ...meta(actor),
      },
    };
  }
  if (method === 'POST' && path === '/chores') {
    if (next.chores.length >= MAX_CHORES) return fail(409, 'limit', actor, state);
    const built = choreFromBody(request.body, null);
    if (built.error) return fail(400, built.error, actor, state);
    const maxSort = next.chores.reduce((max, chore) => Math.max(max, chore.sort), -1);
    built.chore.sort = maxSort + 1;
    next.chores.push(built.chore);
    await rollToday();
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
    await rollToday();
    return { status: 200, state: next, body: choresBody(next, actor) };
  }
  const choreMatch = path.match(/^\/chores\/([^/]+)$/);
  if (choreMatch && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(choreMatch[1]);
    const index = next.chores.findIndex((chore) => chore.id === id);
    if (index < 0) return fail(404, 'missing', actor, state);
    if (method === 'DELETE') {
      next.chores.splice(index, 1);
      await rollToday();
      return { status: 200, state: next, body: { deleted: id, ...meta(actor) } };
    }
    const built = choreFromBody(request.body, next.chores[index]);
    if (built.error) return fail(400, built.error, actor, state);
    next.chores[index] = built.chore;
    await rollToday();
    return { status: 200, state: next, body: { chore: cloneChore(built.chore), ...meta(actor) } };
  }
  if (method === 'POST' && path === '/complete') {
    return complete(next, state, request, actor, now, rollToday);
  }
  if (method === 'POST' && path === '/unlock') {
    return unlockChore(next, state, request, actor, now, rollToday);
  }
  if (method === 'POST' && path === '/reset-today') {
    return resetToday(next, request, actor, now);
  }
  if (method === 'POST' && path === '/test-webhook') {
    return testWebhook(next, state, request, actor, now);
  }
  if (method === 'POST' && path === '/import') {
    const imported = importState(next, request, actor);
    if (imported.status < 400) await rollToday();
    return imported;
  }
  return fail(404, 'missing', actor, state);
}

function needFor(method, path) {
  if (method === 'GET' && path === '/today') return 'read';
  if (method === 'POST' && path === '/complete') return 'write';
  if (method === 'POST' && path === '/unlock') return 'write';
  return 'admin';
}

async function complete(next, original, request, actor, now, rollToday) {
  const id = request.body?.id;
  if (typeof id !== 'string' || !id) return fail(400, 'invalid', actor, original);
  const viewerId = String(actor.id || 'local');
  let userId = viewerId;
  if (request.body?.forUserId !== undefined) {
    if (typeof request.body.forUserId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(request.body.forUserId)) {
      return fail(400, 'invalid', actor, original);
    }
    userId = request.body.forUserId;
  }
  const following = cleanMemberIds(next.followingIds);
  const mayAct = userId === viewerId || (next.settings.shareAcrossUsers !== false && following.includes(userId));
  if (!mayAct) return fail(404, 'missing', actor, original);
  const { date, weekday } = zonedCalendar(now, next.settings.timezone);
  const scheduled = next.chores
    .filter((chore) => chore.active && chore.days.includes(weekday) && choreFor(chore, next.settings, userId, {
      legacy: userId === viewerId ? 'own' : 'skip',
    }))
    .slice()
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  const chore = scheduled.find((item) => item.id === id);
  if (!chore) {
    const stored = next.chores.find((item) => item.id === id);
    const visible = stored && choreFor(stored, next.settings, userId, {
      legacy: userId === viewerId ? 'own' : 'skip',
    });
    if (!visible) return fail(404, 'missing', actor, original);
    return fail(400, 'day', actor, original);
  }
  const doneMap = { ...(next.completions[date] || {}) };
  if (doneFor(doneMap[id], userId)) {
    if (typeof rollToday === 'function') await rollToday();
    return { status: 200, state: next, body: todayBody(next, actor, now, userId) };
  }
  const index = scheduled.findIndex((item) => item.id === id);
  const gate = choreGate(
    chore,
    index,
    scheduled,
    doneMap,
    next.unlocks?.[date] || {},
    userId,
    now,
    date,
    next.settings.timezone,
  );
  if (gate.locked) return fail(409, 'locked', actor, original);
  if (typeof rollToday === 'function') await rollToday();

  if (chore.webhookUrl) {
    const reply = await callWebhook(request.postWebhook, chore.webhookUrl, choreWebhookPayload(chore, {
      date,
      timezone: next.settings.timezone,
      triggeredBy: actor.name || String(actor.id || ''),
    }));
    if (reply.denied) return fail(409, 'webhook_denied', actor, original);
  }

  const previous = doneMap[id];
  const slot = previous && typeof previous === 'object' && typeof previous.at === 'string'
    ? { '*': previous }
    : (previous && typeof previous === 'object' ? { ...previous } : {});
  slot[userId] = { at: now.toISOString(), by: actor.name || userId };
  doneMap[id] = slot;
  next.completions[date] = doneMap;
  const view = buildToday(next, now, actor, userId);
  const crossed = view.goalReached && !goalNotified(next.goals[date], userId);
  if (crossed) {
    const existing = next.goals[date];
    const map = isFlatGoal(existing) ? { '*': existing } : { ...(existing || {}) };
    map[userId] = { at: now.toISOString(), earned: view.earned, notified: true };
    next.goals[date] = map;
  }
  if (crossed && next.settings.webhookUrl) {
    await callWebhook(request.postWebhook, next.settings.webhookUrl, rewardPayload(next.settings.webhookUrl, true, {
      date,
      earned: view.earned,
      goal: view.goal,
      timezone: next.settings.timezone,
      triggeredBy: actor.name || String(actor.id || ''),
    }));
  }
  return { status: 200, state: next, body: todayBody(next, actor, now, userId) };
}

async function rollOverDay(next, request, actor, today) {
  if (actor?.role !== 'admin') return;
  const stamp = next.settings.rolledOn;
  if (!stamp) {
    next.settings.rolledOn = today;
    return;
  }
  if (stamp >= today) return;
  if (await sendDayLow(next, request, today)) next.settings.rolledOn = today;
}

async function sendDayLow(next, request, date) {
  let delivered = true;
  for (const chore of next.chores) {
    if (!chore.resetWebhookUrl) continue;
    const reply = await callWebhook(request.postWebhook, chore.resetWebhookUrl, lowTogglePayload(chore.resetWebhookUrl));
    if (reply.denied) delivered = false;
  }
  if (next.settings.webhookUrl) {
    const reply = await callWebhook(request.postWebhook, next.settings.webhookUrl, rewardPayload(next.settings.webhookUrl, false, {
      date,
      earned: 0,
      goal: next.settings.pointGoal,
      timezone: next.settings.timezone,
    }));
    if (reply.denied) delivered = false;
  }
  return delivered;
}

async function resetToday(next, request, actor, now) {
  const { date } = zonedCalendar(now, next.settings.timezone);
  delete next.completions[date];
  delete next.goals[date];
  if (next.unlocks) delete next.unlocks[date];
  if (await sendDayLow(next, request, date)) next.settings.rolledOn = date;
  return { status: 200, state: next, body: todayBody(next, actor, now) };
}

/**
 * Homey (or an admin test) unlocks a chore that waits on requireWebhookUnlock.
 * Body: { token } or { id }, optional forUserId, state must be yes when present.
 */
async function unlockChore(next, original, request, actor, now, rollToday) {
  const stateValue = request.body?.state;
  if (stateValue !== undefined && stateValue !== 'yes' && stateValue !== true) {
    return fail(400, 'invalid', actor, original);
  }
  const viewerId = String(actor.id || 'local');
  let userId = viewerId;
  if (request.body?.forUserId !== undefined) {
    if (typeof request.body.forUserId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(request.body.forUserId)) {
      return fail(400, 'invalid', actor, original);
    }
    userId = request.body.forUserId;
  }
  const following = cleanMemberIds(next.followingIds);
  const mayAct = userId === viewerId
    || actor.role === 'admin'
    || (next.settings.shareAcrossUsers !== false && following.includes(userId));
  if (!mayAct) return fail(404, 'missing', actor, original);

  let chore = null;
  const token = cleanUnlockToken(request.body?.token);
  if (token) {
    chore = next.chores.find((item) => item.requireWebhookUnlock && item.unlockToken === token) || null;
  } else if (typeof request.body?.id === 'string' && request.body.id) {
    chore = next.chores.find((item) => item.id === request.body.id) || null;
  }
  if (!chore || !chore.requireWebhookUnlock) return fail(404, 'missing', actor, original);

  const { date } = zonedCalendar(now, next.settings.timezone);
  if (!next.unlocks || typeof next.unlocks !== 'object') next.unlocks = {};
  const day = { ...(next.unlocks[date] || {}) };
  const previous = day[chore.id];
  const slot = previous && typeof previous === 'object' && typeof previous.at === 'string'
    ? { '*': previous }
    : (previous && typeof previous === 'object' ? { ...previous } : {});
  slot[userId] = {
    at: now.toISOString(),
    by: actor.name || String(actor.id || 'webhook'),
  };
  day[chore.id] = slot;
  next.unlocks[date] = day;
  if (typeof rollToday === 'function') await rollToday();
  return { status: 200, state: next, body: todayBody(next, actor, now, userId) };
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

function importState(next, request, actor) {
  if (next.chores.length) {
    return { status: 200, state: next, body: { imported: false, ...choresBody(next, actor) } };
  }
  const incoming = normalizeState({
    settings: next.settings,
    chores: request.body?.chores,
    completions: request.body?.completions,
    goals: request.body?.goals,
  });
  next.chores = incoming.chores;
  next.completions = incoming.completions;
  next.goals = incoming.goals;
  return { status: 200, state: next, body: { imported: true, ...choresBody(next, actor) } };
}

function emptyBucket() {
  return { chores: [], completions: {}, goals: {}, unlocks: {} };
}

function bucketFrom(raw) {
  const flat = normalizeState({
    chores: raw?.chores,
    completions: raw?.completions,
    goals: raw?.goals,
    unlocks: raw?.unlocks,
  });
  return { chores: flat.chores, completions: flat.completions, goals: flat.goals, unlocks: flat.unlocks };
}

function copyBucket(bucket) {
  return JSON.parse(JSON.stringify(bucket));
}

/**
 * One file holds the shared list and, when sharing is off, a list per user.
 * A file written by an older version is the shared list.
 */
export function openDocument(raw) {
  const doc = {
    version: 2,
    settings: defaultSettings(),
    shared: emptyBucket(),
    private: {},
    subscriptions: {},
  };
  if (!raw || typeof raw !== 'object') return doc;
  const legacy = Array.isArray(raw.chores) || (raw.settings && !raw.shared && !raw.private);
  if (legacy) {
    const flat = normalizeState(raw);
    doc.settings = flat.settings;
    doc.shared = {
      chores: flat.chores,
      completions: flat.completions,
      goals: flat.goals,
      unlocks: flat.unlocks,
    };
    return doc;
  }
  doc.settings = normalizeState({ settings: raw.settings }).settings;
  doc.shared = bucketFrom(raw.shared);
  if (raw.private && typeof raw.private === 'object') {
    for (const [id, bucket] of Object.entries(raw.private)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
      doc.private[id] = bucketFrom(bucket);
    }
  }
  if (!legacy && raw.subscriptions && typeof raw.subscriptions === 'object') {
    for (const [id, list] of Object.entries(raw.subscriptions)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
      doc.subscriptions[id] = cleanMemberIds(list);
    }
  }
  return doc;
}

/** The list this person reads and writes. */
export function project(doc, actor) {
  const shared = doc.settings.shareAcrossUsers !== false;
  const id = String(actor?.id || 'local');
  const bucket = shared ? doc.shared : (doc.private[id] || emptyBucket());
  return {
    version: 2,
    settings: { ...doc.settings },
    ...copyBucket(bucket),
    followingIds: cleanMemberIds(doc.subscriptions?.[id]),
  };
}

/**
 * Write a handled list back. Turning sharing off keeps the list on that
 * account. Turning it on uses that account's list when the household list
 * is empty.
 */
export function commit(doc, actor, state) {
  const id = String(actor?.id || 'local');
  const wasShared = doc.settings.shareAcrossUsers !== false;
  const nowShared = state.settings.shareAcrossUsers !== false;
  const bucket = {
    chores: state.chores.map(cloneChore),
    completions: copyBucket({ chores: [], completions: state.completions, goals: {}, unlocks: {} }).completions,
    goals: copyBucket({ chores: [], completions: {}, goals: state.goals, unlocks: {} }).goals,
    unlocks: copyBucket({ chores: [], completions: {}, goals: {}, unlocks: state.unlocks || {} }).unlocks,
  };
  doc.settings = { ...state.settings };
  if (!doc.subscriptions || typeof doc.subscriptions !== 'object') doc.subscriptions = {};
  doc.subscriptions[id] = cleanMemberIds(state.followingIds);
  if (wasShared === nowShared) {
    if (nowShared) doc.shared = bucket;
    else doc.private[id] = bucket;
    return doc;
  }
  if (!nowShared) {
    doc.private[id] = bucket;
    doc.shared = emptyBucket();
    return doc;
  }
  if (!doc.shared.chores.length) doc.shared = bucket;
  return doc;
}
