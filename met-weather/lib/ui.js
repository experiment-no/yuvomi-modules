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

function tempLines(marks) {
  const lines = [];
  let current = null;
  const emit = (sign, x, y) => {
    if (!current || current.sign !== sign) {
      current = { sign, points: [] };
      lines.push(current);
    }
    const text = `${x},${y}`;
    if (current.points[current.points.length - 1] !== text) current.points.push(text);
  };
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    if (!Number.isFinite(mark.temp)) continue;
    const prev = index > 0 ? marks[index - 1] : null;
    if (prev && Number.isFinite(prev.temp) && (prev.temp >= 0) !== (mark.temp >= 0) && prev.temp !== mark.temp) {
      const ratio = (0 - prev.temp) / (mark.temp - prev.temp);
      const x = prev.x + (mark.x - prev.x) * ratio;
      const y = prev.tempY + (mark.tempY - prev.tempY) * ratio;
      emit(prev.temp >= 0 ? 'warm' : 'cold', x, y);
      emit(mark.temp >= 0 ? 'warm' : 'cold', x, y);
    }
    emit(mark.temp >= 0 ? 'warm' : 'cold', mark.x, mark.tempY);
  }
  return lines.filter((line) => line.points.length > 1);
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
  const hours = document.createElement('div');
  hours.className = 'mw-graph__hours';
  for (const [date, indexes] of seen) {
    const mid = indexes[Math.floor(indexes.length / 2)];
    const label = document.createElement('span');
    label.className = 'mw-graph__day';
    label.style.left = `${(layout.marks[mid].x / layout.width) * 100}%`;
    const day = date.slice(8).replace(/^0/, '');
    const name = weekdayShort(date, lang).replace(/\.$/, '').slice(0, 2);
    label.textContent = `${name}.${day}.${monthShort(date, lang)}.`;
    days.append(label);
  }
  const dense = list.length > 18;
  list.forEach((point, index) => {
    const parts = osloParts(point.time);
    if (!parts) return;
    const marked = !dense || parts.hour % 2 === 0;
    if (!marked) return;
    const left = `${(layout.marks[index].x / layout.width) * 100}%`;
    if (parts.minute === 0) {
      const hour = document.createElement('span');
      hour.className = 'mw-graph__hour';
      hour.style.left = left;
      hour.textContent = String(parts.hour).padStart(2, '0');
      hours.append(hour);
    }
    const holder = document.createElement('span');
    holder.className = 'mw-graph__icon';
    holder.style.left = left;
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
  const hLine = (y, kind) => {
    svg.append(svgEl('line', {
      x1: layout.pad.l,
      x2: plotRight,
      y1: y,
      y2: y,
      class: kind,
    }));
  };
  for (const tick of layout.tempTicks) {
    hLine(tick.y, tick.value === 0 ? 'mw-graph__zero' : 'mw-graph__grid');
  }
  hLine(layout.topBase, 'mw-graph__grid');
  for (const tick of layout.windTicks) hLine(tick.y, 'mw-graph__grid');
  hLine(layout.windBase, 'mw-graph__grid');
  list.forEach((point, index) => {
    const parts = osloParts(point.time);
    if (!parts || parts.minute !== 0) return;
    if (dense && parts.hour % 2 !== 0) return;
    svg.append(svgEl('line', {
      x1: layout.marks[index].x,
      x2: layout.marks[index].x,
      y1: layout.pad.t,
      y2: layout.windBase,
      class: 'mw-graph__grid',
    }));
  });

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

  for (const line of tempLines(layout.marks)) {
    svg.append(svgEl('polyline', {
      points: line.points.join(' '),
      class: line.sign === 'warm' ? 'mw-graph__temp mw-graph__temp--warm' : 'mw-graph__temp mw-graph__temp--cold',
    }));
  }
  const windLine = linePoints(layout.marks, 'windY');
  if (windLine) svg.append(svgEl('polyline', { points: windLine, class: 'mw-graph__wind' }));
  const windMarks = layout.marks.filter((mark) => Number.isFinite(mark.windY));
  if (windMarks.length === 1) {
    svg.append(svgEl('circle', {
      cx: windMarks[0].x,
      cy: windMarks[0].windY,
      r: 3,
      class: 'mw-graph__wind-dot',
    }));
  }
  const gustLine = linePoints(layout.marks, 'gustY');
  if (gustLine) svg.append(svgEl('polyline', { points: gustLine, class: 'mw-graph__gust' }));

  layout.marks.forEach((mark, index) => {
    if (mark.direction == null) return;
    const parts = osloParts(list[index].time);
    if (dense && parts && (parts.minute !== 0 || parts.hour % 2 !== 0)) return;
    svg.append(svgEl('polygon', {
      points: '0,-5.5 3.6,4.5 -3.6,4.5',
      transform: `translate(${mark.x} ${layout.arrowY}) rotate(${mark.direction})`,
      class: 'mw-graph__arrow',
    }));
  });

  const left = (text, y) => {
    const node = svgEl('text', { x: 2, y, 'dominant-baseline': 'middle', class: 'mw-graph__tick' });
    node.textContent = text;
    svg.append(node);
  };
  const right = (text, y) => {
    const node = svgEl('text', { x: layout.width - 2, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'mw-graph__tick' });
    node.textContent = text;
    svg.append(node);
  };
  for (const tick of layout.tempTicks) left(`${formatNumber(tick.value, 0)}°`, tick.y);
  for (const tick of layout.precipTicks) right(formatNumber(tick.value, 0), tick.y);
  for (const tick of layout.windTicks) left(formatNumber(tick.value, 0), tick.y);

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

  root.append(days, hours, icons, svg, legend);
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
