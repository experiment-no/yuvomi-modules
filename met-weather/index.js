import { sliceHours, symbolIcon, symbolKey, compass, extent, formatNumber } from './lib/forecast.js';
import {
  dayLabel,
  drawChart,
  ensureStyle,
  errorBody,
  hourLabel,
  icon,
  listen,
  locale,
  paintIcons,
  showEmpty,
  stopped,
  tr,
} from './lib/ui.js';
import { weatherApi } from './browser.js';

const ACCENT = '#0369A1';

export async function render(container, context = {}) {
  const signal = context.signal;
  await ensureStyle();
  if (signal?.aborted) return;
  const token = {};
  container._mwToken = token;
  container.style.setProperty('--widget-accent', ACCENT);
  await paint(container, signal, token, 1);
}

async function paint(container, signal, token, days) {
  if (stopped(container, signal, token)) return;
  let data;
  try {
    data = await weatherApi('forecast', { signal });
  } catch (err) {
    if (stopped(container, signal, token) || err?.name === 'AbortError') return;
    await showEmpty(container, {
      variant: 'error',
      title: tr('error.loadTitle'),
      description: errorBody(err),
      action: { label: tr('error.retry'), onClick: () => { void paint(container, signal, token, days); } },
    });
    return;
  }
  if (stopped(container, signal, token)) return;
  draw(container, data, signal, token, days);
}

function draw(container, data, signal, token, days) {
  const lang = locale();
  const root = document.createElement('div');
  root.className = 'mw-page';
  const toolbar = document.createElement('div');
  toolbar.className = 'page-toolbar';
  const title = document.createElement('h1');
  title.className = 'page-toolbar__title';
  title.textContent = tr('module');
  toolbar.append(title);
  root.append(toolbar);

  const body = document.createElement('div');
  body.className = 'app-page__body';
  if (!data?.configured) {
    root.append(body);
    container.replaceChildren(root);
    void showEmpty(body, {
      variant: 'empty',
      title: tr('page.placeMissing'),
      description: tr('page.placeHint'),
    });
    return;
  }

  const hours = sliceHours(data.hours, days);
  const current = data.current || hours[0];
  if (hours.length) {
    body.append(hero(data.place, current, extent(hours), lang));
    body.append(tabs(days, signal, (next) => {
      draw(container, data, signal, token, next);
    }));
    body.append(chartBlock(hours, lang));
    body.append(credit(data));
    body.append(table(hours, lang));
  } else {
    const shown = (Array.isArray(data.days) ? data.days : []).slice(0, days === 1 ? 1 : 2);
    body.append(hero(data.place, current, dayExtent(shown), lang));
    if (data.days?.length > 1) {
      body.append(tabs(days, signal, (next) => {
        draw(container, data, signal, token, next);
      }));
    }
    if (shown.length) body.append(dayTable(shown, lang));
    body.append(credit(data));
  }
  root.append(body);
  container.replaceChildren(root);
  paintIcons(container);
}

function dayExtent(days) {
  const temps = days.flatMap((day) => [day.low, day.high]).filter(Number.isFinite);
  if (!temps.length) return { low: null, high: null };
  return { low: Math.min(...temps), high: Math.max(...temps) };
}

function hero(place, current, span, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'mw-hero';
  const badge = document.createElement('div');
  badge.className = 'mw-hero__icon';
  badge.append(icon(symbolIcon(current?.symbol)));
  const text = document.createElement('div');
  const temp = document.createElement('p');
  temp.className = 'mw-temp';
  temp.textContent = `${formatNumber(current?.temp, 1)}°`;
  const where = document.createElement('p');
  where.className = 'mw-place';
  where.textContent = placeLine(place);
  const summary = document.createElement('p');
  summary.className = 'mw-summary';
  const condition = tr(`symbol.${symbolKey(current?.symbol)}`);
  const wind = [formatNumber(current?.wind, 1), compass(current?.direction, lang)].filter(Boolean).join(' ');
  const highLow = Number.isFinite(span?.low) && Number.isFinite(span?.high)
    ? tr('page.highLow', { low: formatNumber(span.low, 1), high: formatNumber(span.high, 1) })
    : '';
  summary.textContent = [
    condition.startsWith('extensions.') ? symbolKey(current?.symbol) : condition,
    highLow,
    wind ? `${tr('page.wind')} ${wind} m/s` : '',
  ].filter(Boolean).join(' · ');
  text.append(temp, where, summary);
  wrap.append(badge, text);
  return wrap;
}

function placeLine(place) {
  const bits = [place?.name, place?.municipality && place.municipality !== place.name ? place.municipality : '', place?.county];
  return bits.filter(Boolean).join(' · ');
}

function tabs(days, signal, select) {
  const bar = document.createElement('div');
  bar.className = 'mw-tabs';
  bar.setAttribute('role', 'tablist');
  for (const value of [1, 2]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mw-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', value === days ? 'true' : 'false');
    button.textContent = tr(value === 1 ? 'page.day' : 'page.twoDays');
    listen(button, 'click', () => select(value), signal);
    bar.append(button);
  }
  return bar;
}

function chartBlock(hours, lang) {
  const block = document.createElement('div');
  const chart = document.createElement('div');
  chart.className = 'mw-chart';
  chart.append(drawChart(hours, lang));
  const legend = document.createElement('p');
  legend.className = 'mw-legend';
  const temp = document.createElement('span');
  const tempSwatch = document.createElement('i');
  tempSwatch.className = 'mw-swatch mw-swatch--temp';
  temp.append(tempSwatch, document.createTextNode(tr('page.temp')));
  const precip = document.createElement('span');
  const precipSwatch = document.createElement('i');
  precipSwatch.className = 'mw-swatch';
  precip.append(precipSwatch, document.createTextNode(tr('page.precip')));
  legend.append(temp, precip);
  block.append(chart, legend);
  return block;
}

function table(hours, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'mw-table-wrap';
  const tableEl = document.createElement('table');
  tableEl.className = 'mw-table';
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  for (const name of ['page.time', 'page.temp', 'page.precip', 'page.wind', 'page.weather']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = tr(name);
    row.append(cell);
  }
  head.append(row);
  const body = document.createElement('tbody');
  const withDay = hours.length > 30;
  for (const point of hours) {
    const line = document.createElement('tr');
    const condition = tr(`symbol.${symbolKey(point.symbol)}`);
    const values = [
      hourLabel(point.time, withDay, lang),
      `${formatNumber(point.temp, 1)}°`,
      `${formatNumber(point.precip, 1)} mm`,
      `${formatNumber(point.wind, 1)} ${compass(point.direction, lang)}`.trim(),
      condition.startsWith('extensions.') ? symbolKey(point.symbol) : condition,
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      line.append(cell);
    }
    body.append(line);
  }
  tableEl.append(head, body);
  wrap.append(tableEl);
  return wrap;
}

function dayTable(days, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'mw-table-wrap';
  const tableEl = document.createElement('table');
  tableEl.className = 'mw-table';
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  for (const name of ['page.time', 'page.temp', 'page.weather']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = tr(name);
    row.append(cell);
  }
  head.append(row);
  const body = document.createElement('tbody');
  for (const day of days) {
    const line = document.createElement('tr');
    const condition = tr(`symbol.${symbolKey(day.symbol)}`);
    const range = Number.isFinite(day.low) && Number.isFinite(day.high)
      ? tr('page.highLow', { low: formatNumber(day.low, 1), high: formatNumber(day.high, 1) })
      : '';
    const values = [
      dayLabel(day.date, lang),
      range,
      condition.startsWith('extensions.') ? symbolKey(day.symbol) : condition,
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      line.append(cell);
    }
    body.append(line);
  }
  tableEl.append(head, body);
  wrap.append(tableEl);
  return wrap;
}

function credit(data) {
  const note = document.createElement('p');
  note.className = 'mw-credit';
  const met = document.createElement('a');
  met.href = data?.attribution?.met || 'https://www.met.no/';
  met.textContent = 'Meteorologisk institutt';
  if (data?.source === 'host') {
    const openMeteo = document.createElement('a');
    openMeteo.href = data.attribution?.openMeteo || 'https://open-meteo.com/';
    openMeteo.textContent = 'Open-Meteo';
    note.append(tr('page.creditHostBefore'), met, tr('page.creditHostMid'), openMeteo, tr('page.creditHostAfter'));
    return note;
  }
  const kartverket = document.createElement('a');
  kartverket.href = 'https://www.kartverket.no/';
  kartverket.textContent = 'Kartverket';
  note.append(tr('page.creditBefore'), met, tr('page.creditMid'), kartverket, tr('page.creditAfter'));
  return note;
}
