/**
 * Wall panel. The overview imports renderWallPanel when the module is
 * enabled. The panel stays hidden until show on wall is on and today
 * has a scheduled chore.
 */

import { choresApi, moduleDisplayTitle, shouldShowOnWall } from './browser.js';
import { loadMembers, memberName } from './lib/members.js';
import { STYLE_HREF, ensureStyle, progressMark, showToast, tr } from './lib/ui.js';

const ACCENT = '#EA580C';

export async function renderWallPanel(host, context = {}) {
  if (!host) return;
  const signal = context.signal;
  await ensureStyle(STYLE_HREF);
  host.replaceChildren();
  host.hidden = true;

  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  async function load() {
    let data;
    try {
      const [today, members] = await Promise.all([choresApi('/today', { signal }), loadMembers(signal)]);
      data = today;
      data.members = members;
    } catch {
      if (!gone) {
        host.replaceChildren();
        host.hidden = true;
      }
      return;
    }
    if (gone) return;
    if (!shouldShowOnWall(data)) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }

    const title = moduleDisplayTitle(data.settings, 'extensions.kids-chores.widgets.today');
    const section = document.createElement('section');
    section.className = 'kc-wall';
    section.style.setProperty('--seal-accent', ACCENT);
    section.style.setProperty('--widget-accent', ACCENT);

    const heading = document.createElement('h2');
    heading.className = 'wall__section-title';
    heading.textContent = title;
    section.append(heading);

    const boards = Array.isArray(data.boards) && data.boards.length
      ? data.boards
      : [{
        userId: data.viewerId,
        items: data.items,
        open: data.open,
        earned: data.earned,
        goal: data.goal,
        percent: data.percent,
        allDone: data.allDone,
      }];
    for (const board of boards) section.append(wallBoard(board, data, signal, () => load(), () => gone));

    host.replaceChildren(section);
    host.hidden = false;
    window.lucide?.createIcons({ el: host });
  }

  await load();
}

function wallBoard(board, data, signal, reload, isGone) {
  const block = document.createElement('div');
  block.className = 'kc-board';
  const showName = board.userId && data.viewerId && board.userId !== data.viewerId;
  if (showName) {
    const name = document.createElement('p');
    name.className = 'kc-board__name';
    name.textContent = memberName(data.members, board.userId) || board.userId;
    block.append(name);
  }
  const progress = document.createElement('div');
  progress.className = 'kc-wall__progress';
  progress.append(progressMark(board.percent, data.progressIcon || data.settings?.progressIcon, 36));
  const score = document.createElement('p');
  score.className = 'kc-wall__score';
  score.textContent = tr('page.score', { earned: board.earned ?? 0, goal: board.goal ?? 0 });
  progress.append(score);
  block.append(progress);
  const open = Array.isArray(board.open) ? board.open : [];
  const items = Array.isArray(board.items) ? board.items : [];
  if (items.length && board.allDone) {
    const done = document.createElement('p');
    done.className = 'kc-congrats';
    done.textContent = data.congratsMessage || tr('page.congrats');
    block.append(done);
    return block;
  }
  const list = document.createElement('ul');
  list.className = 'kc-wall__list';
  for (const item of open) {
    const li = document.createElement('li');
    const row = document.createElement(data.access === 'write' ? 'button' : 'div');
    row.className = 'kc-wall__chore';
    if (data.access === 'write') {
      row.type = 'button';
      row.addEventListener('click', async () => {
        row.disabled = true;
        try {
          const body = { id: item.id };
          if (item.forUserId) body.forUserId = item.forUserId;
          const next = await choresApi('/complete', { method: 'POST', body, signal });
          if (isGone()) return;
          const updated = Array.isArray(next.boards)
            ? next.boards.find((entry) => entry.userId === item.forUserId)
            : null;
          if (updated ? updated.goalReached : next.goalReached) showToast(tr('goal.toast'));
          await reload();
        } catch (err) {
          if (err?.name === 'AbortError' || isGone()) return;
          row.disabled = false;
          showToast(err.message || tr('reasons.invalid'), 'error');
        }
      }, signal ? { signal } : undefined);
    }
    const name = document.createElement('span');
    name.textContent = item.title;
    const points = document.createElement('span');
    points.textContent = tr('chores.points', { points: item.points });
    row.append(name, points);
    li.append(row);
    list.append(li);
  }
  block.append(list);
  return block;
}
