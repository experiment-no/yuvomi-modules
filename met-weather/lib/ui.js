/**
 * DOM helpers for the weather page, the overview widget, and settings.
 */

import { t } from '/i18n.js';

import { TIME_ZONE, formatNumber, layoutChart } from './forecast.js';

const NS = 'http://www.w3.org/2000/svg';

export const STYLE_HREF = '/api/v1/modules/assets/met-weather/style.css';

export function key(name) {
  return `extensions.met-weather.${name}`;
}

export function tr(name, params) {
  return t(key(name), params);
}

export function locale() {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return lang && lang.toLowerCase().startsWith('nb') ? 'nb' : (lang && lang.toLowerCase().startsWith('en') ? 'en' : 'nb');
}

export function dayLabel(date, lang = locale()) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return String(date || '');
  const tag = lang === 'nb' ? 'nb-NO' : 'en-GB';
  return new Intl.DateTimeFormat(tag, {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}

export function hourLabel(iso, withDay, lang = locale()) {
  const date = new Date(iso);
  const tag = lang === 'nb' ? 'nb-NO' : 'en-GB';
  const hour = new Intl.DateTimeFormat(tag, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  if (!withDay) return hour;
  const day = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
  return `${day} ${hour}`;
}

export async function ensureStyle(href = STYLE_HREF) {
  try {
    const mod = await import('/utils/component-style.js');
    if (typeof mod.ensureStyle === 'function') {
      mod.ensureStyle(href);
      return;
    }
  } catch {
    // The link below is the same load when the helper is not on this page.
  }
  if (typeof document === 'undefined') return;
  if (document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

export async function showEmpty(target, opts) {
  try {
    const mod = await import('/utils/empty-state.js');
    if (typeof mod.mountEmptyState === 'function') return mod.mountEmptyState(target, opts);
  } catch {
    // Draw the empty state here when the host helper is absent.
  }
  if (!target) return null;
  const box = document.createElement('div');
  box.className = `empty-state${opts?.compact ? ' empty-state--compact' : ''}`;
  if (opts?.variant === 'error') box.setAttribute('role', 'alert');
  if (opts?.title) {
    const title = document.createElement('h2');
    title.className = 'empty-state__title';
    title.textContent = opts.title;
    box.append(title);
  }
  if (opts?.description) {
    const description = document.createElement('p');
    description.className = 'empty-state__description';
    description.textContent = opts.description;
    box.append(description);
  }
  if (opts?.action?.label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = opts.action.label;
    if (typeof opts.action.onClick === 'function') button.addEventListener('click', opts.action.onClick);
    box.append(button);
  }
  target.replaceChildren(box);
  return box;
}

export function errorBody(err) {
  const reason = typeof err?.reason === 'string' ? err.reason : '';
  if (!reason) return err?.message || '';
  const translated = t(key(`reasons.${reason}`));
  return translated !== key(`reasons.${reason}`) ? translated : reason;
}

export function listen(target, type, fn, signal) {
  target.addEventListener(type, fn, signal ? { signal } : undefined);
}

export function icon(name) {
  const el = document.createElement('i');
  el.dataset.lucide = name || 'cloud';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function paintIcons(root) {
  window.lucide?.createIcons({ el: root });
}

function svgEl(name, attrs) {
  const el = document.createElementNS(NS, name);
  for (const [attr, value] of Object.entries(attrs)) el.setAttribute(attr, String(value));
  return el;
}

export function drawChart(points, lang) {
  const withDay = points.length > 30;
  const layout = layoutChart(points, { width: 720, height: 260 });
  const svg = svgEl('svg', {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    class: 'mw-chart__svg',
    role: 'img',
    'aria-label': tr(withDay ? 'page.twoDays' : 'page.day'),
  });
  const grid = svgEl('line', {
    x1: layout.pad.l,
    x2: layout.width - layout.pad.r,
    y1: layout.base,
    y2: layout.base,
    class: 'mw-chart__axis',
  });
  svg.append(grid);
  for (const mark of layout.marks) {
    if (mark.barH <= 0) continue;
    svg.append(svgEl('rect', {
      x: mark.barX,
      y: mark.barY,
      width: mark.barW,
      height: mark.barH,
      class: 'mw-chart__precip',
    }));
  }
  if (layout.marks.length) {
    const line = svgEl('polyline', {
      points: layout.marks.map((mark) => `${mark.x},${mark.tempY}`).join(' '),
      class: 'mw-chart__temp',
    });
    svg.append(line);
    for (const mark of layout.marks) {
      svg.append(svgEl('circle', { cx: mark.x, cy: mark.tempY, r: 2.2, class: 'mw-chart__dot' }));
    }
  }
  const step = points.length > 30 ? 6 : 3;
  points.forEach((point, index) => {
    if (index % step !== 0 && index !== points.length - 1) return;
    const mark = layout.marks[index];
    const text = svgEl('text', {
      x: mark.x,
      y: layout.height - 8,
      'text-anchor': 'middle',
      class: 'mw-chart__label',
    });
    text.textContent = hourLabel(point.time, withDay, lang);
    svg.append(text);
  });
  const high = svgEl('text', { x: 4, y: layout.pad.t + 10, class: 'mw-chart__label' });
  high.textContent = `${formatNumber(layout.tMax, 0)}°`;
  const low = svgEl('text', { x: 4, y: layout.base, class: 'mw-chart__label' });
  low.textContent = `${formatNumber(layout.tMin, 0)}°`;
  svg.append(high, low);
  return svg;
}

export function stopped(container, signal, token) {
  return signal?.aborted || container._mwToken !== token;
}
