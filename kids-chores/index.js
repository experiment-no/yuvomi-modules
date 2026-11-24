import { armWebhookWindow, createClient, releaseWebhookWindow } from './lib/client.js';
import { loadMembers, memberName } from './lib/members.js';
import { msUntilNextDate } from './lib/logic.js';
import { STYLE_HREF, boardSignature, ensureStyle, errorBody, listen, progressMark, showEmpty, showToast, tr, watchAdmin } from './lib/ui.js';

const client = createClient();

export async function render(container, context = {}) {
  const signal = context.signal;
  clearTimeout(container._kcMidnight);
  await ensureStyle(STYLE_HREF);
  if (signal?.aborted) return;
  const token = {};
  container._kcToken = token;
  await paint(container, signal, token);
}

async function paint(container, signal, token) {
  if (stopped(container, signal, token)) return;
  let data;
  try {
    const [today, members] = await Promise.all([client.today(signal), loadMembers(signal)]);
    data = today;
    data.members = members;
    container._kcMembers = members;
  } catch (err) {
    if (stopped(container, signal, token) || err?.name === 'AbortError') return;
    await showEmpty(container, {
      variant: 'error',
      title: tr('error.loadTitle'),
      description: errorBody(err),
      action: {
        label: tr('error.retry'),
        onClick: () => { void paint(container, signal, token); },
      },
    });
    return;
  }
  if (stopped(container, signal, token)) return;
  draw(container, data, signal, token);
  watchAdmin(container, token, data.role, signal, async () => {
    try {
      const next = await client.today(signal);
      if (stopped(container, signal, token)) return;
      if (boardSignature(next) === container._kcSig) return;
      next.members = container._kcMembers;
      draw(container, next, signal, token);
    } catch (err) {
      if (err?.name === 'AbortError' || stopped(container, signal, token)) return;
    }
  });
}

function draw(container, data, signal, token) {
  container._kcSig = boardSignature(data);
  clearTimeout(container._kcMidnight);
  const root = document.createElement('div');
  root.className = 'kc-page';

  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar';
  const title = document.createElement('h1');
  title.className = 'page-toolbar__title';
  title.textContent = data.settings.displayTitle || tr('module');
  toolbar.append(title);

  const body = document.createElement('div');
  body.className = 'app-page__body';
  for (const board of boardsOf(data)) body.append(boardBlock(board, data, signal, token, container));
  root.append(toolbar, body);
  container.replaceChildren(root);
  armMidnight(container, signal, token, data.settings.timezone);
}

function boardsOf(data) {
  if (Array.isArray(data.boards) && data.boards.length) return data.boards;
  return [{
    userId: data.viewerId,
    items: Array.isArray(data.items) ? data.items : [],
    open: Array.isArray(data.open) ? data.open : [],
    earned: data.earned,
    goal: data.goal,
    percent: data.percent,
    allDone: data.allDone,
  }];
}

function boardBlock(board, data, signal, token, container) {
  const block = document.createElement('section');
  block.className = 'kc-board page-section';
  const showName = board.userId && data.viewerId && board.userId !== data.viewerId;
  if (showName) {
    const name = document.createElement('h2');
    name.className = 'kc-board__name';
    name.textContent = memberName(data.members, board.userId) || tr('page.board', { name: board.userId });
    block.append(name);
  }
  const hero = document.createElement('div');
  hero.className = 'kc-hero';
  hero.append(progressMark(board.percent, data.progressIcon, 96));
  const score = document.createElement('p');
  score.className = 'kc-score';
  score.textContent = tr('page.score', { earned: board.earned ?? 0, goal: board.goal ?? data.goal ?? 0 });
  hero.append(score);
  const list = document.createElement('div');
  list.className = 'kc-list';
  const items = Array.isArray(board.items) ? board.items : [];
  const open = Array.isArray(board.open) ? board.open : items.filter((item) => item && !item.done && !item.locked);
  if (!items.length) {
    const empty = document.createElement('div');
    list.append(empty);
    void showEmpty(empty, { variant: 'empty', compact: true, title: tr('page.empty') });
  } else if (board.allDone) {
    const message = document.createElement('p');
    message.className = 'kc-congrats';
    message.textContent = data.congratsMessage || tr('page.congrats');
    list.append(message);
  } else {
    const canWrite = data.access === 'write';
    const person = showName ? (memberName(data.members, board.userId) || board.userId) : '';
    for (const item of open) {
      list.append(choreRow(item, canWrite, person, signal, () => {
        if (data.role !== 'admin') armWebhookWindow();
        void run(container, signal, token, () => client.complete(item.id, signal, item.forUserId), true)
          .finally(() => releaseWebhookWindow());
      }));
    }
  }
  block.append(hero, list);
  return block;
}

function choreRow(item, canWrite, person, signal, onClick) {
  const row = document.createElement(canWrite ? 'button' : 'div');
  row.className = 'kc-chore';
  if (canWrite) {
    row.type = 'button';
    listen(row, 'click', onClick, signal);
  }
  const name = document.createElement('span');
  name.className = 'kc-chore__title';
  name.textContent = item.title;
  const points = document.createElement('span');
  points.className = 'kc-chore__points';
  points.textContent = String(item.points);
  row.append(name, points);
  if (canWrite) {
    row.setAttribute('aria-label', person
      ? tr('page.markDoneFor', { title: item.title, name: person })
      : tr('page.markDone', { title: item.title }));
  }
  return row;
}

async function run(container, signal, token, action, toastGoal) {
  try {
    const next = await action();
    if (stopped(container, signal, token)) return;
    if (next) next.members = container._kcMembers;
    if (toastGoal && next.goalReached) showToast(tr('goal.toast'));
    draw(container, next, signal, token);
  } catch (err) {
    if (err?.name === 'AbortError' || stopped(container, signal, token)) return;
    showToast(errorBody(err), 'error');
  }
}

function armMidnight(container, signal, token, timezone) {
  const delay = msUntilNextDate(new Date(), timezone);
  container._kcMidnight = setTimeout(() => {
    if (!stopped(container, signal, token)) void paint(container, signal, token);
  }, delay);
  if (signal) {
    signal.addEventListener('abort', () => clearTimeout(container._kcMidnight), { once: true });
  }
}

function stopped(container, signal, token) {
  return signal?.aborted || container._kcToken !== token;
}
