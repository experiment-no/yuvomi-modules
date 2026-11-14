import { createClient } from '../lib/client.js';
import { STYLE_HREF, ensureStyle, errorBody, listen, progressMark, showEmpty, showToast, tr } from '../lib/ui.js';

const client = createClient();

export async function renderWidget(container, context = {}) {
  const signal = context.signal;
  await ensureStyle(STYLE_HREF);
  const token = {};
  container._kcToken = token;
  let data;
  try {
    data = await client.today(signal);
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
  if (signal?.aborted || container._kcToken !== token || !container.isConnected) return;
  draw(container, data, signal, token);
}

function draw(container, data, signal, token) {
  const root = document.createElement('div');
  root.className = 'kc-widget';
  root.append(header(data, signal));

  const body = document.createElement('div');
  body.className = 'kc-widget__body';
  if (!data.items.length) {
    root.append(body);
    container.replaceChildren(root);
    void showEmpty(body, {
      variant: 'empty',
      compact: true,
      title: tr('page.empty'),
    });
    window.lucide?.createIcons({ el: root });
    return;
  }

  const progress = document.createElement('div');
  progress.className = 'kc-widget__progress';
  progress.append(progressMark(data.percent, data.progressIcon, 28));
  const score = document.createElement('span');
  score.textContent = tr('page.score', { earned: data.earned, goal: data.goal });
  progress.append(score);

  const list = document.createElement('div');
  list.className = 'kc-widget__list';
  if (data.allDone) {
    const message = document.createElement('p');
    message.className = 'kc-congrats';
    message.textContent = data.congratsMessage || tr('page.congrats');
    list.append(message);
  } else {
    const canWrite = data.access === 'write';
    for (const item of data.open) {
      const row = document.createElement(canWrite ? 'button' : 'div');
      row.className = 'kc-chore kc-chore--compact';
      if (canWrite) {
        row.type = 'button';
        listen(row, 'click', () => {
          void complete(container, item.id, signal, token);
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
  body.append(progress, list);
  root.append(body);
  container.replaceChildren(root);
  window.lucide?.createIcons({ el: root });
}

function header(data, signal) {
  const bar = document.createElement('div');
  bar.className = 'widget__header';
  const title = document.createElement('h3');
  title.className = 'widget__title';
  const seal = document.createElement('span');
  seal.className = 'module-seal module-seal--sm';
  seal.style.setProperty('--seal-accent', '#EA580C');
  const icon = document.createElement('i');
  icon.dataset.lucide = 'sparkles';
  icon.setAttribute('aria-hidden', 'true');
  seal.append(icon);
  const text = document.createElement('span');
  text.className = 'widget__title-text';
  text.textContent = data.settings.displayTitle || tr('module');
  title.append(seal, text);
  if (data.open.length > 0) {
    const badge = document.createElement('span');
    badge.className = 'widget__badge';
    badge.textContent = String(data.open.length);
    title.append(badge);
  }
  const link = document.createElement('a');
  link.className = 'widget__link';
  link.href = '/m/kids-chores';
  link.dataset.route = '/m/kids-chores';
  link.textContent = tr('widget.open');
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

async function complete(container, id, signal, token) {
  try {
    const next = await client.complete(id, signal);
    if (signal?.aborted || container._kcToken !== token || !container.isConnected) return;
    if (next.goalReached) showToast(tr('goal.toast'));
    draw(container, next, signal, token);
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return;
    showToast(errorBody(err), 'error');
  }
}
