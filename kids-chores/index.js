import { createClient } from './lib/client.js';
import { msUntilNextDate } from './lib/logic.js';
import { STYLE_HREF, button, ensureStyle, errorBody, listen, progressMark, showEmpty, showToast, tr } from './lib/ui.js';

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
    data = await client.today(signal);
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
}

function draw(container, data, signal, token) {
  clearTimeout(container._kcMidnight);
  const root = document.createElement('div');
  root.className = 'kc-page';

  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar';
  const title = document.createElement('h1');
  title.className = 'page-toolbar__title';
  title.textContent = data.settings.displayTitle || tr('module');
  toolbar.append(title);
  if (data.role === 'admin' && data.access === 'write') {
    toolbar.append(button(tr('page.reset'), 'btn', signal, () => {
      void run(container, signal, token, () => client.resetToday(signal), false);
    }));
  }

  const body = document.createElement('div');
  body.className = 'app-page__body';
  const hero = document.createElement('div');
  hero.className = 'kc-hero';
  hero.append(progressMark(data.percent, data.progressIcon, 96));
  const score = document.createElement('p');
  score.className = 'kc-score';
  score.textContent = tr('page.score', { earned: data.earned, goal: data.goal });
  hero.append(score);

  const section = document.createElement('section');
  section.className = 'page-section kc-list';
  if (!data.items.length) {
    const empty = document.createElement('div');
    section.append(empty);
    void showEmpty(empty, {
      variant: 'empty',
      compact: true,
      title: tr('page.empty'),
    });
  } else if (data.allDone) {
    const message = document.createElement('p');
    message.className = 'kc-congrats';
    message.textContent = data.congratsMessage || tr('page.congrats');
    section.append(message);
  } else {
    const canWrite = data.access === 'write';
    for (const item of data.open) section.append(choreRow(item, canWrite, signal, () => {
      void run(container, signal, token, () => client.complete(item.id, signal), true);
    }));
  }

  body.append(hero, section);
  root.append(toolbar, body);
  container.replaceChildren(root);
  armMidnight(container, signal, token, data.settings.timezone);
}

function choreRow(item, canWrite, signal, onClick) {
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
  if (canWrite) row.setAttribute('aria-label', tr('page.markDone', { title: item.title }));
  return row;
}

async function run(container, signal, token, action, toastGoal) {
  try {
    const next = await action();
    if (stopped(container, signal, token)) return;
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
