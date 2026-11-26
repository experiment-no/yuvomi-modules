import { t } from '/i18n.js';

import { choresApi, moduleDisplayTitle } from '../browser.js';
import { msUntilNextDate } from '../lib/logic.js';
import { loadMembers, memberName } from '../lib/members.js';
import { STYLE_HREF, boardSignature, ensureStyle, errorBody, listen, progressMark, showEmpty, showToast, tr, watchAdmin } from '../lib/ui.js';

const ACCENT = '#EA580C';

function hostLabel(name, fallback, params) {
  const value = t(name, params);
  return value === name ? fallback : value;
}

/**
 * Overview tile. The dashboard calls renderWidget(container, { size, options, user })
 * and does not pass a signal. Header and body are direct children of the tile
 * so the overview layout can size them.
 */
export async function renderWidget(container, context = {}) {
  const signal = context?.signal;
  const token = {};
  container._kcToken = token;
  await ensureStyle(STYLE_HREF);
  if (signal?.aborted || container._kcToken !== token) return;
  let data;
  try {
    const [today, members] = await Promise.all([choresApi('/today', { signal }), loadMembers(signal)]);
    data = today;
    data.members = members;
    container._kcMembers = members;
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted || container._kcToken !== token) return;
    await showEmpty(container, {
      variant: 'error',
      compact: true,
      title: tr('error.loadTitle'),
      description: errorBody(err),
    });
    return;
  }
  if (signal?.aborted || container._kcToken !== token) return;
  draw(container, data, signal, token);
  watchAdmin(container, token, data.role, signal, async () => {
    try {
      const next = await choresApi('/today', { signal });
      if (signal?.aborted || container._kcToken !== token) return;
      if (boardSignature(next) === container._kcSig) return;
      next.members = container._kcMembers;
      draw(container, next, signal, token);
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  });
}

function applyAccent(container) {
  container.style.setProperty('--seal-accent', ACCENT);
  container.style.setProperty('--widget-accent', ACCENT);
  container.style.setProperty('--active-module-accent', ACCENT);
}

function draw(container, data, signal, token) {
  container._kcSig = boardSignature(data);
  armMidnight(container, signal, token, data?.settings?.timezone);
  const settings = data?.settings && typeof data.settings === 'object' ? data.settings : {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const open = Array.isArray(data?.open) ? data.open : items.filter((item) => item && !item.done && !item.locked);
  const view = { ...data, settings, items, open };
  applyAccent(container);
  const body = document.createElement('div');
  body.className = 'widget__body kc-widget';

  if (!items.length) {
    container.replaceChildren(header(view, signal), body);
    void showEmpty(body, {
      variant: 'empty',
      compact: true,
      title: tr('page.empty'),
    });
    window.lucide?.createIcons({ el: container });
    return;
  }

  const boards = Array.isArray(view.boards) && view.boards.length
    ? view.boards
    : [{
      userId: view.viewerId,
      items,
      open,
      earned: view.earned,
      goal: view.goal,
      percent: view.percent,
      allDone: view.allDone,
    }];
  for (const board of boards) body.append(widgetBoard(board, view, signal, token, container));
  container.replaceChildren(header(view, signal), body);
  window.lucide?.createIcons({ el: container });
}

function armMidnight(container, signal, token, timezone) {
  clearTimeout(container._kcMidnight);
  const delay = msUntilNextDate(new Date(), timezone || 'Europe/Oslo');
  container._kcMidnight = setTimeout(() => {
    if (signal?.aborted || container._kcToken !== token) return;
    void refreshToday(container, signal, token);
  }, delay);
  if (signal && !container._kcMidnightAbort) {
    container._kcMidnightAbort = true;
    signal.addEventListener('abort', () => clearTimeout(container._kcMidnight), { once: true });
  }
}

async function refreshToday(container, signal, token) {
  try {
    const next = await choresApi('/today', { signal });
    if (signal?.aborted || container._kcToken !== token) return;
    next.members = container._kcMembers;
    draw(container, next, signal, token);
  } catch (err) {
    if (err?.name !== 'AbortError' && !signal?.aborted && container._kcToken === token) {
      armMidnight(container, signal, token, 'Europe/Oslo');
    }
  }
}

function widgetBoard(board, view, signal, token, container) {
  const block = document.createElement('div');
  block.className = 'kc-board';
  const settings = view.settings || {};
  const showName = board.userId && view.viewerId && board.userId !== view.viewerId;
  if (showName) {
    const name = document.createElement('p');
    name.className = 'kc-board__name';
    name.textContent = memberName(view.members, board.userId) || board.userId;
    block.append(name);
  }
  const progress = document.createElement('div');
  progress.className = 'kc-widget__progress';
  progress.append(progressMark(board.percent, view.progressIcon || settings.progressIcon, 28));
  const score = document.createElement('span');
  score.textContent = tr('page.score', { earned: board.earned ?? 0, goal: board.goal ?? settings.pointGoal ?? 0 });
  progress.append(score);
  const list = document.createElement('div');
  list.className = 'kc-widget__list';
  const boardItems = Array.isArray(board.items) ? board.items : [];
  const boardOpen = Array.isArray(board.open) ? board.open : boardItems.filter((item) => item && !item.done && !item.locked);
  if (!boardItems.length) {
    const empty = document.createElement('p');
    empty.className = 'kc-board__empty';
    empty.textContent = tr('page.empty');
    list.append(empty);
  } else if (board.allDone) {
    const message = document.createElement('p');
    message.className = 'kc-congrats';
    message.textContent = view.congratsMessage || tr('page.congrats');
    list.append(message);
  } else {
    const canWrite = view.access === 'write';
    for (const item of boardOpen) {
      const row = document.createElement(canWrite ? 'button' : 'div');
      row.className = 'kc-chore kc-chore--compact';
      // Inline so a stale stylesheet cannot keep the old compact height.
      row.style.minHeight = 'calc(2.125rem + 15px)';
      row.style.boxSizing = 'border-box';
      if (canWrite) {
        row.type = 'button';
        listen(row, 'click', () => {
          void complete(container, item, signal, token);
        }, signal);
      }
      const name = document.createElement('span');
      name.className = 'kc-chore__title';
      name.textContent = item.title;
      const points = document.createElement('span');
      points.className = 'kc-chore__points';
      points.textContent = String(item.points);
      row.append(name, points);
      list.append(row);
    }
  }
  block.append(progress, list);
  return block;
}

function header(data, signal) {
  const titleText = moduleDisplayTitle(data.settings, 'extensions.kids-chores.widgets.today');
  const bar = document.createElement('div');
  bar.className = 'widget__header';
  const title = document.createElement('h3');
  title.className = 'widget__title';
  const seal = document.createElement('span');
  seal.className = 'module-seal module-seal--sm';
  seal.style.setProperty('--seal-accent', ACCENT);
  const icon = document.createElement('i');
  icon.dataset.lucide = 'sparkles';
  icon.setAttribute('aria-hidden', 'true');
  seal.append(icon);
  const text = document.createElement('span');
  text.className = 'widget__title-text';
  text.textContent = titleText;
  title.append(seal, text);
  const openCount = Array.isArray(data.boards) && data.boards.length
    ? data.boards.reduce((sum, board) => sum + (Array.isArray(board.open) ? board.open.length : 0), 0)
    : data.open.length;
  if (openCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'widget__badge';
    badge.textContent = String(openCount);
    title.append(badge);
  }
  const link = document.createElement('a');
  link.className = 'widget__link';
  link.href = '/m/kids-chores';
  link.dataset.route = '/m/kids-chores';
  link.textContent = hostLabel('dashboard.allLink', tr('widget.open'));
  link.setAttribute('aria-label', hostLabel('dashboard.allLinkFor', link.textContent, { module: titleText }));
  listen(link, 'click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (typeof window.yuvomi?.navigate === 'function') {
      event.preventDefault();
      window.yuvomi.navigate('/m/kids-chores');
    }
  }, signal);
  bar.append(title, link);
  return bar;
}

async function complete(container, item, signal, token) {
  try {
    const body = { id: item.id };
    if (item.forUserId) body.forUserId = item.forUserId;
    const next = await choresApi('/complete', { method: 'POST', body, signal });
    if (signal?.aborted || container._kcToken !== token) return;
    next.members = container._kcMembers;
    const board = Array.isArray(next.boards)
      ? next.boards.find((entry) => entry.userId === item.forUserId)
      : null;
    if (board ? board.goalReached : next.goalReached) showToast(tr('goal.toast'));
    draw(container, next, signal, token);
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return;
    showToast(errorBody(err), 'error');
  }
}
