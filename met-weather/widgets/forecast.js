import { t } from '/i18n.js';

import { weatherApi } from '../browser.js';
import { symbolIcon, symbolKey, formatNumber, sliceHours, layoutChart } from '../lib/forecast.js';
import {
  ensureStyle,
  errorBody,
  icon,
  listen,
  paintIcons,
  showEmpty,
  tr,
} from '../lib/ui.js';

const ACCENT = '#0369A1';
const NS = 'http://www.w3.org/2000/svg';

function hostLabel(name, fallback) {
  const value = t(name);
  return value === name ? fallback : value;
}

export async function renderWidget(container, context = {}) {
  const signal = context?.signal;
  const token = {};
  container._mwToken = token;
  await ensureStyle();
  if (signal?.aborted || container._mwToken !== token) return;
  let data;
  try {
    data = await weatherApi('forecast', { signal });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted || container._mwToken !== token) return;
    await showEmpty(container, {
      variant: 'error',
      compact: true,
      title: tr('error.loadTitle'),
      description: errorBody(err),
    });
    return;
  }
  if (signal?.aborted || container._mwToken !== token) return;
  draw(container, data, signal);
}

function draw(container, data, signal) {
  container.style.setProperty('--seal-accent', ACCENT);
  container.style.setProperty('--widget-accent', ACCENT);
  const body = document.createElement('a');
  body.className = 'widget__body mw-widget';
  body.href = '/m/met-weather';
  body.dataset.route = '/m/met-weather';
  listen(body, 'click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (typeof window.yuvomi?.navigate === 'function') {
      event.preventDefault();
      window.yuvomi.navigate('/m/met-weather');
    }
  }, signal);

  if (!data?.configured || !data.current) {
    const empty = document.createElement('p');
    empty.className = 'mw-widget__meta';
    empty.textContent = tr('page.placeMissing');
    body.append(empty);
  } else {
    const row = document.createElement('div');
    row.className = 'mw-widget__row';
    const symbol = document.createElement('div');
    symbol.className = 'mw-widget__symbol';
    symbol.append(icon(symbolIcon(data.current.symbol)));
    const text = document.createElement('div');
    const temp = document.createElement('p');
    temp.className = 'mw-widget__temp';
    temp.textContent = `${formatNumber(data.current.temp, 1)}°`;
    const meta = document.createElement('p');
    meta.className = 'mw-widget__meta';
    const condition = tr(`symbol.${symbolKey(data.current.symbol)}`);
    meta.textContent = [
      data.place?.name,
      condition.startsWith('extensions.') ? '' : condition,
    ].filter(Boolean).join(' · ');
    text.append(temp, meta);
    row.append(symbol, text);
    body.append(row, spark(sliceHours(data.hours, 1)));
  }

  container.replaceChildren(header(data, signal), body);
  paintIcons(container);
}

function spark(points) {
  const layout = layoutChart(points, { width: 320, height: 64, pad: { l: 4, r: 4, t: 6, b: 6 } });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('class', 'mw-spark');
  svg.setAttribute('aria-hidden', 'true');
  if (layout.marks.length) {
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', layout.marks.map((mark) => `${mark.x},${mark.tempY}`).join(' '));
    line.setAttribute('class', 'mw-chart__temp');
    svg.append(line);
  }
  return svg;
}

function header(data, signal) {
  const titleText = data?.place?.name || tr('widgets.forecast');
  const bar = document.createElement('div');
  bar.className = 'widget__header';
  const title = document.createElement('h3');
  title.className = 'widget__title';
  const seal = document.createElement('span');
  seal.className = 'module-seal module-seal--sm';
  seal.style.setProperty('--seal-accent', ACCENT);
  seal.append(icon('cloud-sun'));
  const text = document.createElement('span');
  text.className = 'widget__title-text';
  text.textContent = titleText;
  title.append(seal, text);
  const link = document.createElement('a');
  link.className = 'widget__link';
  link.href = '/m/met-weather';
  link.dataset.route = '/m/met-weather';
  link.textContent = hostLabel('dashboard.allLink', tr('widget.open'));
  listen(link, 'click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (typeof window.yuvomi?.navigate === 'function') {
      event.preventDefault();
      window.yuvomi.navigate('/m/met-weather');
    }
  }, signal);
  bar.append(title, link);
  return bar;
}
