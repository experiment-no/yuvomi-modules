/**
 * Household copy of the chore list, stored in Yuvomi notes.
 *
 * The sidecar is optional. Without it, each browser used to keep its own
 * localStorage document, so a list created by an administrator never reached
 * anyone else. Notes are already shared with every signed-in member. The
 * chore list lives in one note named "Kids Chores". Completions live in a
 * second note per person ("Kids Chores log") so a member can record their
 * own check-off without permission to edit someone else's note.
 */

import { commit, handle, openDocument, project } from './logic.js';

export const STATE_MARK = 'kids-chores-state:v1';
export const DONE_MARK = 'kids-chores-done:v1';

const PREFACE = 'Kids Chores. Ikke rediger dette notatet. Do not edit this note.';
const LIMIT = 5000;
const STATE_TITLE = 'Kids Chores';
const DONE_TITLE = 'Kids Chores log';
const STATE_COLOR = '#EA580C';
const DONE_COLOR = '#64748B';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export class HouseholdError extends Error {
  constructor(reason, status) {
    super(reason);
    this.name = 'HouseholdError';
    this.reason = reason;
    this.status = status;
  }
}

export function actorFromMe(body) {
  const root = body?.user ? body : (body?.data?.user ? body.data : null);
  const user = root?.user;
  if (!user || user.id == null || user.id === '') return null;
  const permissions = root.permissions && typeof root.permissions === 'object' ? root.permissions : {};
  const level = permissions.modules?.['ext:kids-chores'];
  const access = level == null || level === '' ? 'write' : level;
  return {
    id: String(user.id),
    name: typeof user.display_name === 'string' && user.display_name
      ? user.display_name
      : (typeof user.username === 'string' ? user.username : ''),
    access: access === 'none' || access === 'read' || access === 'write' ? access : 'none',
    role: user.role === 'admin' || permissions.admin === true ? 'admin' : 'member',
    csrfToken: '',
  };
}

export async function runHousehold(options) {
  const actor = options.actor;
  const signal = options.signal;
  const notes = await listNotes(options.api, signal);
  const stateNote = notes.find((note) => markOf(note?.content, STATE_MARK));
  const doneNotes = notes.filter((note) => markOf(note?.content, DONE_MARK));
  if (stateNote && markOf(stateNote.content, STATE_MARK).broken) {
    throw new HouseholdError('notes', 400);
  }
  if (doneNotes.some((note) => markOf(note.content, DONE_MARK).broken)) {
    throw new HouseholdError('notes', 400);
  }

  let doc = stateNote
    ? documentFrom(markOf(stateNote.content, STATE_MARK).data, doneNotes)
    : openDocument(null);
  if (!stateNote) {
    const local = readLocal(options.readLocal);
    if (countChores(local) > 0) doc = adoptLocal(local, actor.id);
  }

  const before = pack(doc, notes, actor.id);
  const result = await handle(project(doc, actor), {
    method: options.method,
    path: options.path,
    body: options.body,
    now: options.now instanceof Date ? options.now : new Date(),
    actor,
    postWebhook: options.postWebhook,
  });
  if (result.status >= 400) return result;
  commit(doc, actor, result.state);
  await persist(options, doc, before, notes);
  try { options.writeLocal?.(doc); } catch { /* the note is the shared copy */ }
  return result;
}

function readLocal(read) {
  try {
    const doc = read?.();
    if (doc && typeof doc === 'object') return doc;
  } catch { /* a blocked browser store still leaves the note */ }
  return openDocument(null);
}

async function listNotes(api, signal) {
  const body = await api.get('/notes', { signal });
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body)) return body;
  throw new HouseholdError('notes', 502);
}

async function persist(options, doc, before, notes) {
  const actor = options.actor;
  const signal = options.signal;
  const stateNote = notes.find((note) => markOf(note?.content, STATE_MARK));
  const after = pack(doc, notes, actor.id);
  const carried = {};
  const share = doc.settings.shareAcrossUsers !== false;

  for (const [userId, slice] of after.dones) {
    const previous = before.dones.get(userId);
    if (same(previous, slice)) continue;
    const existing = doneNote(notes, userId);
    if (!existing && emptySlice(slice)) continue;
    const required = options.method !== 'GET';
    const content = encodeDone(userId, slice);
    if (!content) {
      if (required) throw new HouseholdError('too_large', 400);
      continue;
    }
    try {
      await writeNote(options.api, signal, actor, existing, content, {
        title: DONE_TITLE,
        color: DONE_COLOR,
        visibility: share ? 'all' : 'private',
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (statusOf(err) === 403 && userId !== actor.id) {
        carried[userId] = slice;
        continue;
      }
      if (required) throw asHousehold(err);
    }
  }

  const state = Object.keys(carried).length
    ? { ...after.state, carried: { ...(after.state.carried || {}), ...carried } }
    : after.state;
  const stateChanged = !same(before.state, state);
  const creating = !stateNote && countChores(doc) > 0;
  if (!creating && !stateChanged) {
    if (Object.keys(carried).length) throw new HouseholdError('forbidden', 403);
    return;
  }
  const canWriteState = !stateNote
    || actor.role === 'admin'
    || String(stateNote.created_by) === actor.id;
  const required = creating || (stateChanged && options.method !== 'GET') || Object.keys(carried).length > 0;
  if (!canWriteState) {
    if (required) throw new HouseholdError('forbidden', 403);
    return;
  }
  const content = encodeState(state);
  if (!content) {
    if (required) throw new HouseholdError('too_large', 400);
    return;
  }
  try {
    await writeNote(options.api, signal, actor, stateNote, content, {
      title: STATE_TITLE,
      color: STATE_COLOR,
      visibility: 'all',
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (required) throw asHousehold(err);
  }
}

async function writeNote(api, signal, actor, existing, content, fields) {
  const body = { content, title: fields.title };
  if (!existing || String(existing.created_by) === actor.id) {
    body.visibility = fields.visibility;
    body.color = fields.color;
  }
  if (!existing) return api.post('/notes', body, { signal });
  return api.put(`/notes/${existing.id}`, body, { signal });
}

function asHousehold(err) {
  if (err instanceof HouseholdError) return err;
  const status = statusOf(err) || 502;
  const reason = status === 403 ? 'forbidden' : (status === 400 ? 'notes' : 'notes');
  return new HouseholdError(reason, status);
}

function statusOf(err) {
  return Number(err?.status) || 0;
}

function adoptLocal(doc, actorId) {
  const next = openDocument(JSON.parse(JSON.stringify(doc)));
  if (!actorId || actorId === 'local') return next;
  moveUser(next, 'local', actorId);
  return next;
}

function moveUser(doc, from, to) {
  if (doc.subscriptions?.[from] && !doc.subscriptions[to]) {
    doc.subscriptions[to] = doc.subscriptions[from];
    delete doc.subscriptions[from];
  }
  moveBucket(doc.shared, from, to);
  for (const bucket of Object.values(doc.private || {})) moveBucket(bucket, from, to);
  if (doc.private?.[from] && !doc.private[to]) {
    doc.private[to] = doc.private[from];
    delete doc.private[from];
  }
}

function moveBucket(bucket, from, to) {
  if (!bucket) return;
  for (const day of Object.values(bucket.completions || {})) {
    for (const entry of Object.values(day || {})) moveEntry(entry, from, to);
  }
  for (const entry of Object.values(bucket.goals || {})) moveEntry(entry, from, to);
}

function moveEntry(entry, from, to) {
  if (!entry || typeof entry !== 'object' || typeof entry.at === 'string') return;
  if (entry[from] && !entry[to]) {
    entry[to] = entry[from];
    delete entry[from];
  }
}

function countChores(doc) {
  const shared = doc?.shared?.chores?.length || 0;
  const personal = Object.values(doc?.private || {}).reduce((sum, bucket) => sum + (bucket?.chores?.length || 0), 0);
  return shared + personal;
}

function documentFrom(data, doneNotes) {
  const doc = openDocument({
    version: 2,
    settings: data?.settings,
    shared: {
      chores: data?.chores || [],
      completions: data?.legacyCompletions || {},
      goals: data?.legacyGoals || {},
    },
    subscriptions: data?.subscriptions || {},
  });
  for (const [userId, slice] of Object.entries(data?.carried || {})) {
    if (ID_RE.test(userId)) applySlice(doc, userId, slice);
  }
  for (const note of doneNotes) {
    const decoded = markOf(note.content, DONE_MARK);
    if (!decoded || decoded.broken || !ID_RE.test(decoded.extra)) continue;
    applySlice(doc, decoded.extra, decoded.data);
  }
  return doc;
}

function applySlice(doc, userId, slice) {
  if (!slice || typeof slice !== 'object') return;
  if (slice.private) {
    const wrapped = openDocument({ version: 2, private: { [userId]: slice.private } });
    if (wrapped.private[userId]) doc.private[userId] = wrapped.private[userId];
    return;
  }
  for (const [date, map] of Object.entries(slice.completions || {})) {
    if (!map || typeof map !== 'object') continue;
    const day = { ...(doc.shared.completions[date] || {}) };
    for (const [choreId, entry] of Object.entries(map)) {
      const current = day[choreId];
      if (current && typeof current.at === 'string') {
        day[choreId] = { '*': { at: current.at, by: current.by }, [userId]: entry };
      } else {
        day[choreId] = { ...(current && typeof current === 'object' ? current : {}), [userId]: entry };
      }
    }
    doc.shared.completions[date] = day;
  }
  for (const [date, entry] of Object.entries(slice.goals || {})) {
    const current = doc.shared.goals[date];
    if (current && typeof current.at === 'string') {
      doc.shared.goals[date] = { '*': current, [userId]: entry };
    } else {
      doc.shared.goals[date] = {
        ...(current && typeof current === 'object' && typeof current.at !== 'string' ? current : {}),
        [userId]: entry,
      };
    }
  }
}

function pack(doc, notes, actorId) {
  const share = doc.settings.shareAcrossUsers !== false;
  const existing = new Map();
  for (const note of notes) {
    const decoded = markOf(note?.content, DONE_MARK);
    if (!decoded || decoded.broken || !ID_RE.test(decoded.extra)) continue;
    existing.set(decoded.extra, note);
  }
  const ids = new Set([...userIds(doc, share), ...existing.keys()]);
  const dones = new Map();
  const carried = {};
  for (const userId of [...ids].filter((id) => ID_RE.test(id)).sort()) {
    const slice = sliceFor(doc, userId, share);
    const known = existing.has(userId);
    if (!known && emptySlice(slice)) continue;
    if (known || userId === actorId) dones.set(userId, slice);
    else if (!emptySlice(slice)) carried[userId] = slice;
  }
  const state = {
    version: 2,
    settings: doc.settings,
    chores: (doc.shared.chores || []).map(compactChore),
  };
  const subscriptions = compactSubs(doc.subscriptions);
  if (Object.keys(subscriptions).length) state.subscriptions = subscriptions;
  const legacy = legacyOf(doc, share);
  if (Object.keys(legacy.completions).length) state.legacyCompletions = legacy.completions;
  if (Object.keys(legacy.goals).length) state.legacyGoals = legacy.goals;
  if (Object.keys(carried).length) state.carried = carried;
  return { state, dones };
}

function userIds(doc, share) {
  if (!share) return Object.keys(doc.private || {});
  const ids = new Set();
  for (const map of Object.values(doc.shared.completions || {})) {
    for (const entry of Object.values(map || {})) collectIds(entry, ids);
  }
  for (const entry of Object.values(doc.shared.goals || {})) collectIds(entry, ids);
  return [...ids];
}

function collectIds(entry, ids) {
  if (!entry || typeof entry !== 'object' || typeof entry.at === 'string') return;
  for (const id of Object.keys(entry)) {
    if (id !== '*' && ID_RE.test(id)) ids.add(id);
  }
}

function sliceFor(doc, userId, share) {
  if (!share) {
    const bucket = doc.private?.[userId] || { chores: [], completions: {}, goals: {} };
    return {
      private: {
        chores: (bucket.chores || []).map(compactChore),
        completions: bucket.completions || {},
        goals: bucket.goals || {},
      },
    };
  }
  const completions = {};
  const goals = {};
  for (const [date, map] of Object.entries(doc.shared.completions || {})) {
    for (const [choreId, entry] of Object.entries(map || {})) {
      if (!entry || typeof entry !== 'object' || typeof entry.at === 'string') continue;
      if (!entry[userId]) continue;
      if (!completions[date]) completions[date] = {};
      completions[date][choreId] = entry[userId];
    }
  }
  for (const [date, entry] of Object.entries(doc.shared.goals || {})) {
    if (!entry || typeof entry !== 'object' || typeof entry.at === 'string') continue;
    if (entry[userId]) goals[date] = entry[userId];
  }
  return { completions, goals };
}

function legacyOf(doc, share) {
  const completions = {};
  const goals = {};
  if (!share) return { completions, goals };
  for (const [date, map] of Object.entries(doc.shared.completions || {})) {
    for (const [choreId, entry] of Object.entries(map || {})) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.at === 'string') {
        if (!completions[date]) completions[date] = {};
        completions[date][choreId] = { at: entry.at, by: entry.by };
      } else if (entry['*']) {
        if (!completions[date]) completions[date] = {};
        completions[date][choreId] = { '*': entry['*'] };
      }
    }
  }
  for (const [date, entry] of Object.entries(doc.shared.goals || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.at === 'string') goals[date] = { at: entry.at, earned: entry.earned, notified: entry.notified === true };
    else if (entry['*']) goals[date] = { '*': entry['*'] };
  }
  return { completions, goals };
}

function compactChore(chore) {
  const out = {
    id: chore.id,
    title: chore.title,
    points: chore.points,
    days: [...chore.days],
    sort: chore.sort,
  };
  if (chore.active === false) out.active = false;
  if (chore.requireAboveDone) out.requireAboveDone = true;
  if (chore.webhookUrl) out.webhookUrl = chore.webhookUrl;
  if (chore.resetWebhookUrl) out.resetWebhookUrl = chore.resetWebhookUrl;
  if (Array.isArray(chore.assigneeIds)) out.assigneeIds = [...chore.assigneeIds];
  if (chore.excludedMemberIds?.length) out.excludedMemberIds = [...chore.excludedMemberIds];
  return out;
}

function compactSubs(subscriptions) {
  const out = {};
  for (const [id, list] of Object.entries(subscriptions || {})) {
    if (ID_RE.test(id) && Array.isArray(list) && list.length) out[id] = [...list];
  }
  return out;
}

function emptySlice(slice) {
  if (!slice) return true;
  if (slice.private) {
    const bucket = slice.private;
    return !bucket.chores?.length
      && !Object.keys(bucket.completions || {}).length
      && !Object.keys(bucket.goals || {}).length;
  }
  return !Object.keys(slice.completions || {}).length && !Object.keys(slice.goals || {}).length;
}

function doneNote(notes, userId) {
  return notes.find((note) => markOf(note?.content, DONE_MARK)?.extra === userId) || null;
}

function encodeState(data) {
  return encode(STATE_MARK, data);
}

function encodeDone(userId, data) {
  return encode(`${DONE_MARK} ${userId}`, data);
}

function encode(markLine, data) {
  const content = `${PREFACE}\n${markLine}\n${JSON.stringify(data)}`;
  return content.length > LIMIT ? null : content;
}

function markOf(content, mark) {
  if (typeof content !== 'string') return null;
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line === mark || line.startsWith(`${mark} `));
  if (index < 0) return null;
  const extra = lines[index].slice(mark.length).trim();
  try {
    return { extra, data: JSON.parse(lines.slice(index + 1).join('\n').trim()), broken: false };
  } catch {
    return { extra, data: null, broken: true };
  }
}

function same(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
