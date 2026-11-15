import { weatherApi } from '../browser.js';
import {
  graphHours,
  symbolIcon,
  symbolKey,
  tempSpans,
  todayRecord,
  upcomingDays,
  weekdayShort,
} from '../lib/forecast.js';
import {
  ensureStyle,
  errorBody,
  graphFrame,
  icon,
  listen,
  locale,
  paintIcons,
  showEmpty,
  tr,
} from '../lib/ui.js';

const ACCENT = '#0369A1';

function degrees(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value)}°`;
}

function condition(symbol) {
  const text = tr(`symbol.${symbolKey(symbol)}`);
  return text.startsWith('extensions.') ? symbolKey(symbol) : text;
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
  showWidget(container, data, {
    signal,
    reload: () => { void renderWidget(container, context); },
  });
}

export function showWidget(container, data, options = {}) {
  const signal = options.signal;
  container.style.setProperty('--seal-accent', ACCENT);
  container.style.setProperty('--widget-accent', ACCENT);
  const open = Boolean(container._mwOpen) && Boolean(data?.hours?.length);
  container.replaceChildren(header(signal, options.reload), body(container, data, signal, open));
  fitTile(container, open);
  paintIcons(container);
}

function fitTile(container, expanded) {
  const wrapper = container.closest?.('.widget-wrapper');
  if (!wrapper) return;
  wrapper.style.setProperty('--tile-rows', expanded ? '172' : '78');
}

function header(signal, reload) {
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
  text.textContent = tr('widgets.forecast');
  title.append(seal, text);
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'mw-refresh';
  refresh.setAttribute('aria-label', tr('widget.refresh'));
  refresh.title = tr('widget.refresh');
  refresh.append(icon('refresh-cw'));
  listen(refresh, 'click', (event) => {
    event.stopPropagation();
    if (typeof reload === 'function') reload();
  }, signal);
  bar.append(title, refresh);
  return bar;
}

function body(container, data, signal, open) {
  const wrap = document.createElement('div');
  wrap.className = 'widget__body mw-widget';
  if (!data?.configured || !data.current) {
    const empty = document.createElement('p');
    empty.className = 'mw-now__place';
    empty.textContent = tr('page.placeMissing');
    wrap.append(empty);
    return wrap;
  }
  const hours = Array.isArray(data.hours) ? data.hours : [];
  const face = document.createElement(hours.length ? 'button' : 'div');
  face.className = 'mw-face';
  if (hours.length) {
    face.type = 'button';
    face.setAttribute('aria-expanded', open ? 'true' : 'false');
    face.setAttribute('aria-controls', 'mw-widget-graph');
  }
  face.append(strip(data, locale()));
  wrap.append(face);
  if (hours.length) {
    const graph = graphFrame(graphHours(hours), locale(), { updated: data.updated });
    graph.id = 'mw-widget-graph';
    graph.hidden = !open;
    listen(face, 'click', () => {
      const next = face.getAttribute('aria-expanded') !== 'true';
      face.setAttribute('aria-expanded', next ? 'true' : 'false');
      graph.hidden = !next;
      container._mwOpen = next;
      fitTile(container, next);
      paintIcons(graph);
    }, signal);
    wrap.append(graph);
  }
  return wrap;
}

function strip(data, lang) {
  const today = todayRecord(data.days);
  const columns = upcomingDays(data.days);
  const spans = tempSpans(columns);
  const row = document.createElement('div');
  row.className = 'mw-strip';
  row.append(nowBlock(data, today), rule(), columnsBlock(columns, spans, lang));
  return row;
}

function nowBlock(data, today) {
  const block = document.createElement('div');
  block.className = 'mw-now';
  const temp = document.createElement('p');
  temp.className = 'mw-now__temp';
  temp.textContent = `${Math.round(data.current.temp)}°C`;
  const range = document.createElement('div');
  range.className = 'mw-now__range';
  if (Number.isFinite(today?.high)) {
    const high = document.createElement('span');
    high.className = 'mw-now__high';
    high.textContent = degrees(today.high);
    range.append(high);
  }
  if (Number.isFinite(today?.low)) {
    const low = document.createElement('span');
    low.className = 'mw-now__low';
    low.textContent = degrees(today.low);
    range.append(low);
  }
  const text = document.createElement('div');
  text.className = 'mw-now__text';
  const desc = document.createElement('p');
  desc.className = 'mw-now__desc';
  desc.textContent = condition(data.current.symbol);
  const place = document.createElement('p');
  place.className = 'mw-now__place';
  place.textContent = data.place?.name || '';
  text.append(desc, place);
  const glyph = document.createElement('div');
  glyph.className = 'mw-now__icon';
  glyph.append(icon(symbolIcon(data.current.symbol)));
  block.append(temp, range, text, glyph);
  return block;
}

function rule() {
  const line = document.createElement('div');
  line.className = 'mw-rule';
  line.setAttribute('aria-hidden', 'true');
  return line;
}

function columnsBlock(columns, spans, lang) {
  const forecast = document.createElement('div');
  forecast.className = 'mw-days';
  columns.forEach((day, index) => {
    const col = document.createElement('div');
    col.className = 'mw-daycol';
    const label = document.createElement('div');
    label.className = 'mw-daycol__label';
    label.textContent = weekdayShort(day.date, lang);
    const symbol = document.createElement('div');
    symbol.className = 'mw-daycol__icon';
    symbol.append(icon(symbolIcon(day.symbol)));
    const temps = document.createElement('div');
    temps.className = 'mw-daycol__temps';
    const high = document.createElement('span');
    high.textContent = degrees(day.high);
    const low = document.createElement('span');
    low.className = 'mw-daycol__low';
    low.textContent = degrees(day.low);
    temps.append(high, low);
    col.append(label, symbol, temps);
    const span = spans[index];
    if (span) {
      const bar = document.createElement('div');
      bar.className = `mw-span${span.cold ? ' mw-span--cold' : ''}`;
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('i');
      fill.style.setProperty('--from', span.from.toFixed(4));
      fill.style.setProperty('--to', span.to.toFixed(4));
      bar.append(fill);
      col.append(bar);
    }
    forecast.append(col);
  });
  return forecast;
}
