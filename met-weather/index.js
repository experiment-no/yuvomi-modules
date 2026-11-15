import { weatherApi } from './browser.js';
import {
  PERIODS,
  compass,
  dayHeading,
  symbolIcon,
  symbolKey,
} from './lib/forecast.js';
import {
  ensureStyle,
  errorBody,
  hourLabel,
  icon,
  locale,
  paintIcons,
  showEmpty,
  stopped,
  tr,
} from './lib/ui.js';

const ACCENT = '#0369A1';

export async function render(container, context = {}) {
  const signal = context.signal;
  await ensureStyle();
  if (signal?.aborted) return;
  const token = {};
  container._mwToken = token;
  container.style.setProperty('--widget-accent', ACCENT);
  await paint(container, signal, token);
}

async function paint(container, signal, token) {
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
      action: { label: tr('error.retry'), onClick: () => { void paint(container, signal, token); } },
    });
    return;
  }
  if (stopped(container, signal, token)) return;
  showPage(container, data);
}

export function showPage(container, data) {
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

  body.append(hero(data, lang));
  const days = Array.isArray(data.days) ? data.days : [];
  if (days.length) {
    body.append(columnHead());
    const list = document.createElement('div');
    list.className = 'mw-forecasts';
    for (const day of days) list.append(dayRow(day, lang));
    list.addEventListener('click', (event) => {
      const head = event.target.closest?.('button.mw-forecast__row');
      if (!head || !list.contains(head)) return;
      const panel = head.nextElementSibling;
      if (!panel?.classList.contains('mw-forecast__hours')) return;
      const next = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
      panel.hidden = !next;
      if (next) paintIcons(panel);
    });
    body.append(list);
  }
  body.append(credit(data));
  root.append(body);
  container.replaceChildren(root);
  paintIcons(container);
}

function degrees(value) {
  if (!Number.isFinite(value)) return '–';
  return `${Math.round(value)}°`;
}

function measure(value, unit, digits, lang) {
  if (!Number.isFinite(value)) return '–';
  const formatted = new Intl.NumberFormat(lang === 'nb' ? 'nb-NO' : 'en-GB', {
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted} ${unit}`;
}

function condition(symbol) {
  const text = tr(`symbol.${symbolKey(symbol)}`);
  return text.startsWith('extensions.') ? symbolKey(symbol) : text;
}

function hero(data, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'mw-hero';
  const badge = document.createElement('div');
  badge.className = 'mw-hero__icon';
  badge.append(icon(symbolIcon(data.current?.symbol)));
  const text = document.createElement('div');
  const temp = document.createElement('p');
  temp.className = 'mw-temp';
  temp.textContent = Number.isFinite(data.current?.temp) ? `${Math.round(data.current.temp)}°C` : '–';
  const where = document.createElement('p');
  where.className = 'mw-place';
  where.textContent = [data.place?.name, data.place?.municipality && data.place.municipality !== data.place.name ? data.place.municipality : '', data.place?.county].filter(Boolean).join(' · ');
  const summary = document.createElement('p');
  summary.className = 'mw-summary';
  const wind = [measure(data.current?.wind, 'm/s', 0, lang), compass(data.current?.direction, lang)].filter((part) => part && part !== '–').join(' ');
  summary.textContent = [condition(data.current?.symbol), wind].filter(Boolean).join(' · ');
  text.append(temp, where, summary);
  wrap.append(badge, text);
  return wrap;
}

function columnHead() {
  const row = document.createElement('div');
  row.className = 'mw-forecast__head';
  row.append(document.createElement('span'));
  const periods = document.createElement('span');
  periods.className = 'mw-forecast__periods';
  for (const id of PERIODS) {
    const cell = document.createElement('span');
    cell.textContent = tr(`page.${id}`);
    periods.append(cell);
  }
  row.append(periods);
  for (const key of ['page.temp', 'page.precip', 'page.wind']) {
    const cell = document.createElement('span');
    cell.className = 'mw-forecast__measure';
    cell.textContent = tr(key);
    row.append(cell);
  }
  return row;
}

function dayRow(day, lang) {
  const article = document.createElement('article');
  article.className = 'mw-forecast';
  const hours = Array.isArray(day.hours) ? day.hours : [];
  const panelId = `mw-hours-${day.date}`;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'mw-forecast__row';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', panelId);
  const date = document.createElement('span');
  date.className = 'mw-forecast__date';
  date.textContent = dayHeading(day.date, lang);
  const periods = document.createElement('span');
  periods.className = 'mw-forecast__periods';
  for (const id of PERIODS) {
    const cell = document.createElement('span');
    cell.className = 'mw-forecast__period';
    cell.title = tr(`page.${id}`);
    const symbol = day.periods?.[id]?.symbol;
    if (symbol) cell.append(icon(symbolIcon(symbol)));
    periods.append(cell);
  }
  const temps = document.createElement('span');
  temps.className = 'mw-forecast__temps';
  const high = document.createElement('span');
  high.className = 'mw-forecast__high';
  high.textContent = degrees(day.high);
  const slash = document.createElement('span');
  slash.className = 'mw-forecast__slash';
  slash.textContent = '/';
  const low = document.createElement('span');
  low.className = 'mw-forecast__low';
  low.textContent = degrees(day.low);
  temps.append(high, slash, low);
  const precip = document.createElement('span');
  precip.className = 'mw-forecast__precip';
  precip.textContent = measure(day.precip, 'mm', 1, lang);
  const wind = document.createElement('span');
  wind.className = 'mw-forecast__wind';
  wind.textContent = measure(day.wind, 'm/s', 0, lang);
  head.append(date, periods, temps, precip, wind);
  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'mw-forecast__hours';
  panel.hidden = true;
  panel.append(hours.length ? hourTable(hours, lang) : periodDetail(day));
  article.append(head, panel);
  return article;
}

function periodDetail(day) {
  const list = document.createElement('div');
  list.className = 'mw-periods';
  for (const id of PERIODS) {
    const item = document.createElement('div');
    item.className = 'mw-periods__item';
    const symbol = day.periods?.[id]?.symbol;
    if (symbol) item.append(icon(symbolIcon(symbol)));
    const name = document.createElement('span');
    name.textContent = tr(`page.${id}`);
    item.append(name);
    list.append(item);
  }
  return list;
}

function hourTable(hours, lang) {
  const wrap = document.createElement('div');
  wrap.className = 'mw-table-wrap';
  const table = document.createElement('table');
  table.className = 'mw-table';
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  for (const name of ['page.time', 'page.weather', 'page.temp', 'page.precip', 'page.wind']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = tr(name);
    row.append(cell);
  }
  head.append(row);
  const body = document.createElement('tbody');
  for (const point of hours) {
    const line = document.createElement('tr');
    const time = document.createElement('td');
    time.textContent = hourLabel(point.time, false, lang);
    const weather = document.createElement('td');
    weather.className = 'mw-hour__weather';
    weather.append(icon(symbolIcon(point.symbol)));
    const label = document.createElement('span');
    label.textContent = condition(point.symbol);
    weather.append(label);
    const temp = document.createElement('td');
    temp.textContent = degrees(point.temp);
    const precip = document.createElement('td');
    precip.textContent = measure(point.precip, 'mm', 1, lang);
    const wind = document.createElement('td');
    const speed = measure(point.wind, 'm/s', 1, lang);
    const direction = compass(point.direction, lang);
    wind.textContent = [speed === '–' ? '' : speed, direction].filter(Boolean).join(' ') || '–';
    line.append(time, weather, temp, precip, wind);
    body.append(line);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function credit(data) {
  const note = document.createElement('p');
  note.className = 'mw-credit';
  const met = document.createElement('a');
  met.href = data?.attribution?.met || 'https://www.met.no/';
  met.textContent = 'Meteorologisk institutt';
  if (data?.source === 'host' || data?.source === 'open-meteo') {
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
