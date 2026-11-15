/**
 * Wall panel. The overview imports renderWallPanel when the module is
 * enabled. The panel stays hidden until show on wall is on and today
 * has a scheduled chore.
 */

import { choresApi, moduleDisplayTitle, shouldShowOnWall } from './browser.js';
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
      data = await choresApi('/today', { signal });
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
    const open = Array.isArray(data.open) ? data.open : [];
    const section = document.createElement('section');
    section.className = 'kc-wall';
    section.style.setProperty('--seal-accent', ACCENT);
    section.style.setProperty('--widget-accent', ACCENT);

    const heading = document.createElement('h2');
    heading.className = 'wall__section-title';
    heading.textContent = title;

    const progress = document.createElement('div');
    progress.className = 'kc-wall__progress';
    progress.append(progressMark(data.percent, data.progressIcon || data.settings?.progressIcon, 36));
    const score = document.createElement('p');
    score.className = 'kc-wall__score';
    score.textContent = tr('page.score', { earned: data.earned ?? 0, goal: data.goal ?? 0 });
    progress.append(score);
    section.append(heading, progress);

    if (data.allDone) {
      const done = document.createElement('p');
      done.className = 'kc-congrats';
      done.textContent = data.congratsMessage || tr('page.congrats');
      section.append(done);
    } else {
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
              const next = await choresApi('/complete', { method: 'POST', body: { id: item.id }, signal });
              if (gone) return;
              if (next.goalReached) showToast(tr('goal.toast'));
              await load();
            } catch (err) {
              if (err?.name === 'AbortError' || gone) return;
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
      section.append(list);
    }

    host.replaceChildren(section);
    host.hidden = false;
    window.lucide?.createIcons({ el: host });
  }

  await load();
}
