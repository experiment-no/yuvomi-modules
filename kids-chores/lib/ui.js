/**
 * DOM helpers shared by the page, the overview widget, and household settings.
 * Yuvomi's bundle only keeps three import paths, so the style, empty-state,
 * and sortable helpers are loaded if they exist and filled in locally if not.
 */

import { t } from '/i18n.js';

const NS = 'http://www.w3.org/2000/svg';

export const STYLE_HREF = '/api/v1/modules/assets/kids-chores/style.css';

export function key(name) {
  return `extensions.kids-chores.${name}`;
}

export function tr(name, params) {
  return t(key(name), params);
}

export async function ensureStyle(href = STYLE_HREF) {
  try {
    const mod = await import('/utils/component-style.js');
    if (typeof mod.ensureStyle === 'function') {
      mod.ensureStyle(href);
      return;
    }
  } catch {
    // Stock Yuvomi bundles this helper. The link below is the same load.
  }
  if (document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

export async function showEmpty(target, opts) {
  try {
    const mod = await import('/utils/empty-state.js');
    if (typeof mod.mountEmptyState === 'function') {
      return mod.mountEmptyState(target, opts);
    }
  } catch {
    // Same fallback as ensureStyle: draw the empty state ourselves.
  }
  return mountEmptyState(target, opts);
}

function mountEmptyState(target, opts = {}) {
  if (!target) return null;
  const box = document.createElement('div');
  box.className = `empty-state${opts.compact ? ' empty-state--compact' : ''}`;
  if (opts.variant === 'error') box.setAttribute('role', 'alert');
  if (opts.variant === 'no-results') box.setAttribute('role', 'status');
  if (opts.title) {
    const title = document.createElement('h2');
    title.className = 'empty-state__title';
    title.textContent = opts.title;
    box.append(title);
  }
  if (opts.description) {
    const description = document.createElement('p');
    description.className = 'empty-state__description';
    description.textContent = opts.description;
    box.append(description);
  }
  if (opts.action?.label) {
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

export function showToast(message, type = 'success') {
  const fn = window.yuvomi?.showToast || window.oikos?.showToast;
  if (typeof fn === 'function') fn(message, type);
}

export function errorBody(err) {
  if (!err) return '';
  const reason = typeof err.reason === 'string' ? err.reason : '';
  const translated = reason ? t(key(`reasons.${reason}`)) : '';
  const named = translated && translated !== key(`reasons.${reason}`) ? translated : '';
  const raw = typeof err.message === 'string' ? err.message : '';
  if (named && raw && raw !== reason && raw !== named) return `${named}: ${raw}`;
  return named || raw || String(err);
}

export function listen(target, type, fn, signal) {
  target.addEventListener(type, fn, signal ? { signal } : undefined);
}

export function progressMark(percent, icon, size) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const id = `kc-fill-${Math.random().toString(36).slice(2, 10)}`;
  const svg = svgEl('svg', {
    viewBox: '0 0 64 64',
    width: String(size),
    height: String(size),
    class: 'kc-mark',
    role: 'img',
    'aria-label': `${value}%`,
  });
  const height = (value / 100) * 64;
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  clip.append(svgEl('rect', {
    x: '0',
    y: String(64 - height),
    width: '64',
    height: String(height),
  }));
  defs.append(clip);
  svg.append(defs);
  const color = value >= 100 ? '#EA580C' : '#FBBF24';
  for (const part of [
    { fill: 'currentColor', opacity: '0.18' },
    { fill: color, 'clip-path': `url(#${id})` },
  ]) {
    const group = svgEl('g', part);
    group.append(...iconShapes(icon));
    svg.append(group);
  }
  return svg;
}

function iconShapes(icon) {
  if (icon === 'star') return [starShape()];
  if (icon === 'heart') return [shape('path', { d: 'M32 54C32 54 10 40 10 26 10 16 17 10 25 13 29 14.6 31 18 32 22 33 18 35 14.6 39 13 47 10 54 16 54 26 54 40 32 54 32 54Z' })];
  if (icon === 'moon') {
    return [shape('path', {
      'fill-rule': 'evenodd',
      d: 'M42 12A22 22 0 1 0 42 52A18 18 0 0 1 42 12Z',
    })];
  }
  if (icon === 'flower') return flowerShapes();
  if (icon === 'trophy') return trophyShapes();
  if (icon === 'rocket') return rocketShapes();
  if (icon === 'house') {
    return [shape('path', {
      'fill-rule': 'evenodd',
      d: 'M32 6 58 30H50V56H14V30H6ZM26 56V40H38V56Z',
    })];
  }
  if (icon === 'tree') return treeShapes();
  if (icon === 'smile') {
    return [shape('path', {
      'fill-rule': 'evenodd',
      d: 'M32 6A26 26 0 1 0 32 58 26 26 0 1 0 32 6M21 26A3 3 0 1 0 27 26 3 3 0 1 0 21 26M37 26A3 3 0 1 0 43 26 3 3 0 1 0 37 26M20 36Q32 52 44 36 32 46 20 36Z',
    })];
  }
  if (icon === 'cloud') return cloudShapes();
  if (icon === 'crown') return crownShapes();
  if (icon === 'diamond') return [shape('polygon', { points: '32,4 58,32 32,60 6,32' })];
  return sunShapes();
}

function sunShapes() {
  const nodes = [svgEl('circle', { cx: '32', cy: '32', r: '11' })];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index * Math.PI) / 4;
    const cx = 32 + Math.cos(angle) * 22;
    const cy = 32 + Math.sin(angle) * 22;
    nodes.push(svgEl('rect', {
      x: String(cx - 2),
      y: String(cy - 5),
      width: '4',
      height: '10',
      rx: '2',
      transform: `rotate(${index * 45} ${cx} ${cy})`,
    }));
  }
  return nodes;
}

function starShape() {
  return svgEl('polygon', {
    points: '32,6 39.2,24.2 59,26.2 44.2,38.8 48.4,58 32,48.2 15.6,58 19.8,38.8 5,26.2 24.8,24.2',
  });
}

function flowerShapes() {
  const nodes = [];
  for (let index = 0; index < 6; index += 1) {
    nodes.push(shape('ellipse', {
      cx: '32',
      cy: '18',
      rx: '7',
      ry: '11',
      transform: `rotate(${index * 60} 32 32)`,
    }));
  }
  nodes.push(shape('circle', { cx: '32', cy: '32', r: '7' }));
  return nodes;
}

function trophyShapes() {
  return [
    shape('path', { d: 'M18 18C8 18 8 32 18 32V26C12 26 12 22 18 22Z' }),
    shape('path', { d: 'M46 18C56 18 56 32 46 32V26C52 26 52 22 46 22Z' }),
    shape('path', { d: 'M18 12H46V26C46 38 40 44 32 46 24 44 18 38 18 26Z' }),
    shape('rect', { x: '28', y: '45', width: '8', height: '7' }),
    shape('rect', { x: '20', y: '52', width: '24', height: '6', rx: '2' }),
  ];
}

function rocketShapes() {
  return [
    shape('path', {
      'fill-rule': 'evenodd',
      d: 'M32 6 42 22V46H22V22ZM32 26m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
    }),
    shape('polygon', { points: '22,30 8,48 22,44' }),
    shape('polygon', { points: '42,30 56,48 42,44' }),
  ];
}

function treeShapes() {
  return [
    shape('polygon', { points: '32,6 50,28 14,28' }),
    shape('polygon', { points: '32,20 56,46 8,46' }),
    shape('rect', { x: '28', y: '44', width: '8', height: '14', rx: '1' }),
  ];
}

function cloudShapes() {
  return [
    shape('circle', { cx: '22', cy: '38', r: '12' }),
    shape('circle', { cx: '34', cy: '30', r: '14' }),
    shape('circle', { cx: '48', cy: '38', r: '10' }),
    shape('ellipse', { cx: '34', cy: '44', rx: '22', ry: '8' }),
  ];
}

function crownShapes() {
  return [
    shape('polygon', { points: '8,48 12,22 24,34 32,12 40,34 52,22 56,48' }),
    shape('circle', { cx: '12', cy: '20', r: '3.5' }),
    shape('circle', { cx: '32', cy: '12', r: '3.5' }),
    shape('circle', { cx: '52', cy: '20', r: '3.5' }),
  ];
}

function shape(name, attrs) {
  return svgEl(name, attrs);
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [attr, value] of Object.entries(attrs)) node.setAttribute(attr, value);
  return node;
}

export function field(label, control, hint) {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const text = document.createElement('label');
  text.className = 'form-label';
  text.textContent = label;
  if (control instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) {
    if (!control.id) control.id = `kc-${Math.random().toString(36).slice(2, 9)}`;
    text.htmlFor = control.id;
  }
  wrap.append(text, control);
  if (hint) {
    const note = document.createElement('span');
    note.className = 'form-hint';
    note.textContent = hint;
    wrap.append(note);
  }
  return wrap;
}

export function toggleField(label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'form-field kc-toggle';
  const text = document.createElement('span');
  text.className = 'form-label';
  text.textContent = label;
  const toggle = document.createElement('span');
  toggle.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.role = 'switch';
  input.checked = checked;
  const track = document.createElement('span');
  track.className = 'toggle__track';
  track.setAttribute('aria-hidden', 'true');
  toggle.append(input, track);
  wrap.append(text, toggle);
  return { wrap, input };
}

export function button(label, className, signal, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  if (onClick) listen(el, 'click', onClick, signal);
  return el;
}
