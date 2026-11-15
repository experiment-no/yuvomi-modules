import { t } from '/i18n.js';

import { choresApi, moduleDisplayTitle } from '../browser.js';
import { STYLE_HREF, ensureStyle, errorBody, listen, progressMark, showEmpty, showToast, tr } from '../lib/ui.js';

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
    data = await choresApi('/today', { signal });
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
}

function applyAccent(container) {
  container.style.setProperty('--seal-accent', ACCENT);
  container.style.setProperty('--widget-accent', ACCENT);
  container.style.setProperty('--active-module-accent', ACCENT);
}

function draw(container, data, signal, token) {
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

  const progress = document.createElement('div');
  progress.className = 'kc-widget__progress';
  progress.append(progressMark(view.percent, view.progressIcon || settings.progressIcon, 28));
  const score = document.createElement('span');
  score.textContent = tr('page.score', { earned: view.earned ?? 0, goal: view.goal ?? settings.pointGoal ?? 0 });
  progress.append(score);

  const list = document.createElement('div');
  list.className = 'kc-widget__list';
  if (view.allDone) {
    const message = document.createElement('p');
    message.className = 'kc-congrats';
    message.textContent = view.congratsMessage || tr('page.congrats');
    list.append(message);
  } else {
    const canWrite = view.access === 'write';
    for (const item of open) {
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
  container.replaceChildren(header(view, signal), body);
  window.lucide?.createIcons({ el: container });
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

async function complete(container, id, signal, token) {
  try {
    const next = await choresApi('/complete', { method: 'POST', body: { id }, signal });
    if (signal?.aborted || container._kcToken !== token) return;
    if (next.goalReached) showToast(tr('goal.toast'));
    draw(container, next, signal, token);
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return;
    showToast(errorBody(err), 'error');
  }
}
