/**
 * DOM helpers for the weather page, the overview widget, and settings.
 */

import { t } from '/i18n.js';

import { TIME_ZONE, clockLabel, formatNumber, layoutChart, layoutGraph, osloParts, symbolIcon, weekdayShort } from './forecast.js';

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

let hatchSerial = 0;

function linePoints(marks, key) {
  return marks
    .filter((mark) => Number.isFinite(mark[key]))
    .map((mark) => `${mark.x},${mark[key]}`)
    .join(' ');
}

/**
 * The expanded graph: weather icons, temperature, precipitation, wind, gust
 * and the direction the wind is blowing.
 */
export function graphFrame(points, lang, options = {}) {
  const list = Array.isArray(points) ? points : [];
  const layout = layoutGraph(list);
  const root = document.createElement('div');
  root.className = 'mw-graph';

  const days = document.createElement('div');
  days.className = 'mw-graph__days';
  const icons = document.createElement('div');
  icons.className = 'mw-graph__icons';
  const seen = new Map();
  list.forEach((point, index) => {
    const date = osloParts(point.time)?.date;
    if (!date) return;
    const bucket = seen.get(date) || [];
    bucket.push(index);
    seen.set(date, bucket);
  });
  for (const [date, indexes] of seen) {
    const mid = indexes[Math.floor(indexes.length / 2)];
    const label = document.createElement('span');
    label.className = 'mw-graph__day';
    label.style.left = `${(layout.marks[mid].x / layout.width) * 100}%`;
    label.textContent = `${weekdayShort(date, lang)} ${date.slice(8).replace(/^0/, '')}. ${monthShort(date, lang)}.`;
    days.append(label);
  }
  const iconStep = list.length > 36 ? 2 : 1;
  list.forEach((point, index) => {
    if (index % iconStep !== 0) return;
    const holder = document.createElement('span');
    holder.className = 'mw-graph__icon';
    holder.style.left = `${(layout.marks[index].x / layout.width) * 100}%`;
    holder.append(icon(symbolIcon(point.symbol)));
    icons.append(holder);
  });

  const hatch = `mw-hatch-${hatchSerial += 1}`;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    class: 'mw-graph__svg',
    role: 'img',
    'aria-label': tr('page.twoDays'),
  });
  const defs = svgEl('defs', {});
  const pattern = svgEl('pattern', {
    id: hatch,
    width: '6',
    height: '6',
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  pattern.append(svgEl('line', { x1: '0', y1: '0', x2: '0', y2: '6', class: 'mw-graph__hatch' }));
  defs.append(pattern);
  svg.append(defs);

  const plotRight = layout.width - layout.pad.r;
  for (const y of [layout.pad.t, layout.zeroY, layout.topBase]) {
    svg.append(svgEl('line', {
      x1: layout.pad.l,
      x2: plotRight,
      y1: y,
      y2: y,
      class: y === layout.zeroY ? 'mw-graph__zero' : 'mw-graph__grid',
    }));
  }
  svg.append(svgEl('line', {
    x1: layout.pad.l,
    x2: plotRight,
    y1: layout.windBase,
    y2: layout.windBase,
    class: 'mw-graph__grid',
  }));

  for (const mark of layout.marks) {
    if (mark.maxH > 0) {
      svg.append(svgEl('rect', {
        x: mark.barX,
        y: mark.maxY,
        width: mark.barW,
        height: mark.maxH,
        fill: `url(#${hatch})`,
        class: 'mw-graph__max',
      }));
    }
    if (mark.barH > 0) {
      svg.append(svgEl('rect', {
        x: mark.barX,
        y: mark.barY,
        width: mark.barW,
        height: mark.barH,
        class: 'mw-graph__precip',
      }));
    }
  }

  const tempLine = linePoints(layout.marks, 'tempY');
  if (tempLine) svg.append(svgEl('polyline', { points: tempLine, class: 'mw-graph__temp' }));
  const windLine = linePoints(layout.marks, 'windY');
  if (windLine) svg.append(svgEl('polyline', { points: windLine, class: 'mw-graph__wind' }));
  const gustLine = linePoints(layout.marks, 'gustY');
  if (gustLine) svg.append(svgEl('polyline', { points: gustLine, class: 'mw-graph__gust' }));

  const arrowStep = list.length > 24 ? 3 : 1;
  layout.marks.forEach((mark, index) => {
    if (mark.direction == null || index % arrowStep !== 0) return;
    svg.append(svgEl('polygon', {
      points: '0,-4 3,3.5 -3,3.5',
      transform: `translate(${mark.x} ${layout.windBase - 8}) rotate(${mark.direction})`,
      class: 'mw-graph__arrow',
    }));
  });

  const left = (text, y) => {
    const node = svgEl('text', { x: 4, y, class: 'mw-graph__tick' });
    node.textContent = text;
    svg.append(node);
  };
  const right = (text, y) => {
    const node = svgEl('text', { x: layout.width - 4, y, 'text-anchor': 'end', class: 'mw-graph__tick' });
    node.textContent = text;
    svg.append(node);
  };
  left(`${formatNumber(layout.tMax, 0)}°`, layout.pad.t + 10);
  left(`${formatNumber(layout.tMin, 0)}°`, layout.topBase);
  right(`${formatNumber(layout.pMax, 0)}`, layout.pad.t + 10);
  right('0', layout.topBase);
  left(`${formatNumber(layout.wMax, 0)}`, layout.windTop + 12);
  left('0', layout.windBase);

  const legend = document.createElement('div');
  legend.className = 'mw-graph__legend';
  const items = [
    ['temp', 'graph.temp'],
    ['precip', 'graph.precip'],
  ];
  if (list.some((point) => Number.isFinite(point.precipMax))) items.push(['max', 'graph.precipMax']);
  if (list.some((point) => Number.isFinite(point.wind))) items.push(['wind', 'graph.wind']);
  if (list.some((point) => Number.isFinite(point.gust))) items.push(['gust', 'graph.gust']);
  for (const [name, label] of items) {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.className = `mw-graph__swatch mw-graph__swatch--${name}`;
    item.append(swatch, document.createTextNode(tr(label)));
    legend.append(item);
  }

  root.append(days, icons, svg, legend);
  if (options.updated) {
    const note = document.createElement('p');
    note.className = 'mw-graph__updated';
    note.textContent = tr('widget.updated', { time: clockLabel(options.updated) });
    root.append(note);
  }
  return root;
}

function monthShort(date, lang) {
  const when = new Date(`${date}T12:00:00Z`);
  const tag = lang === 'nb' ? 'nb-NO' : 'en-GB';
  return new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, month: 'short' }).format(when).replace(/\.$/, '');
}
