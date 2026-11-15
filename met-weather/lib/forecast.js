/**
 * Pure forecast rules for the MET Locationforecast compact document.
 * Norway only. Hours are counted from the timeseries step at or just before now.
 */

export const PREFIX = '/api/extensions/met-weather';
export const TIME_ZONE = 'Europe/Oslo';
export const HOUR_MS = 60 * 60 * 1000;
/** Ten local days. MET steps past the first two days, and the page still keeps them. */
export const FORECAST_HOURS = 240;
export const PERIODS = ['night', 'morning', 'afternoon', 'evening'];
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

const COMPASS_NB = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const ICONS = {
  clearsky: 'sun',
  fair: 'cloud-sun',
  partlycloudy: 'cloud-sun',
  cloudy: 'cloud',
  fog: 'cloud',
  lightrain: 'cloud-drizzle',
  rain: 'cloud-rain',
  heavyrain: 'cloud-rain',
  lightrainshowers: 'cloud-drizzle',
  rainshowers: 'cloud-rain',
  heavyrainshowers: 'cloud-rain',
  lightsleet: 'cloud-rain',
  sleet: 'cloud-rain',
  heavysleet: 'cloud-rain',
  lightsleetshowers: 'cloud-rain',
  sleetshowers: 'cloud-rain',
  heavysleetshowers: 'cloud-rain',
  lightsnow: 'cloud-snow',
  snow: 'cloud-snow',
  heavysnow: 'cloud-snow',
  lightsnowshowers: 'cloud-snow',
  snowshowers: 'cloud-snow',
  heavysnowshowers: 'cloud-snow',
};

export function roundCoord(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 10000) / 10000;
}

/** Mainland, Svalbard, Bjørnøya and Jan Mayen. A backstop behind the place register. */
export function inNorway(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const mainland = lat >= 57.9 && lat <= 71.4 && lon >= 4.4 && lon <= 31.3;
  const svalbard = lat >= 74 && lat <= 81 && lon >= 10 && lon <= 35;
  const janMayen = lat >= 70.8 && lat <= 71.2 && lon >= -9.2 && lon <= -7.8;
  return mainland || svalbard || janMayen;
}

export function symbolKey(code) {
  return String(code || '').replace(/_(day|night|polartwilight)$/, '') || 'unknown';
}

export function symbolIcon(code) {
  const night = /_night$/.test(String(code || ''));
  const key = symbolKey(code);
  if (night && (key === 'clearsky' || key === 'fair')) return 'moon';
  if (night && key === 'partlycloudy') return 'cloud-moon';
  if (key.includes('thunder')) return 'cloud-lightning';
  return ICONS[key] || 'cloud';
}

/** WMO codes from Yuvomi's weather proxy, spoken with the same symbol names as MET. */
const WMO_SYMBOL = {
  0: 'clearsky',
  1: 'fair',
  2: 'partlycloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'lightrain',
  53: 'rain',
  55: 'heavyrain',
  56: 'lightrain',
  57: 'heavyrain',
  61: 'lightrain',
  63: 'rain',
  65: 'heavyrain',
  66: 'lightrain',
  67: 'heavyrain',
  71: 'lightsnow',
  73: 'snow',
  75: 'heavysnow',
  77: 'snow',
  80: 'lightrainshowers',
  81: 'rainshowers',
  82: 'heavyrainshowers',
  85: 'lightsnowshowers',
  86: 'heavysnowshowers',
  95: 'rainandthunder',
  96: 'heavyrainandthunder',
  99: 'heavyrainandthunder',
};

export function symbolFromWmo(desc, icon) {
  const code = Number(String(desc || '').replace(/^wmo\./, ''));
  const base = WMO_SYMBOL[code] || 'unknown';
  const night = icon === 'moon' || icon === 'cloud-moon';
  return night ? `${base}_night` : base;
}

function windMs(speed, units) {
  const value = Number(speed);
  if (!Number.isFinite(value)) return null;
  if (units === 'imperial') return value / 2.236936;
  return value / 3.6;
}

function hostDay(day) {
  if (!day || typeof day.date !== 'string') return null;
  const low = Number(day.temp_min);
  const high = Number(day.temp_max);
  return {
    date: day.date,
    low: Number.isFinite(low) ? low : null,
    high: Number.isFinite(high) ? high : null,
    symbol: symbolFromWmo(day.desc, day.icon),
  };
}

/**
 * Yuvomi's /api/v1/weather document. Hours are not in that response, so the
 * page draws the days instead. Wind arrives as km/h (or mph) and is stored as m/s.
 */
export function forecastFromHost(payload) {
  const empty = { configured: false, place: null, current: null, hours: [], days: [] };
  if (!payload) return empty;
  if (payload.reason === 'upstream_error') return { error: 'upstream' };
  if (payload.reason === 'not_configured' || payload.data == null) return empty;
  const data = payload.data;
  const temp = Number(data.current?.temp);
  if (!Number.isFinite(temp)) return empty;
  const days = [hostDay(data.today), ...(Array.isArray(data.forecast) ? data.forecast.map(hostDay) : [])].filter(Boolean);
  return {
    configured: true,
    source: 'host',
    place: {
      name: typeof data.city === 'string' ? data.city : '',
      municipality: '',
      county: '',
    },
    current: {
      temp,
      symbol: symbolFromWmo(data.current.desc, data.current.icon),
      wind: windMs(data.current.wind_speed, data.units),
      direction: null,
      precip: null,
    },
    hours: [],
    days,
    attribution: {
      met: 'https://www.met.no/',
      openMeteo: 'https://open-meteo.com/',
    },
  };
}

export function compass(degrees, locale) {
  if (!Number.isFinite(degrees)) return '';
  const dirs = locale === 'nb' ? COMPASS_NB : COMPASS_EN;
  const index = ((Math.round(Number(degrees) / 45) % 8) + 8) % 8;
  return dirs[index];
}

export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * (10 ** digits)) / (10 ** digits);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(digits);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function precipitation(entry) {
  const hour = entry?.data?.next_1_hours?.details;
  const six = entry?.data?.next_6_hours?.details;
  const details = hour || six || {};
  const amount = Number(details.precipitation_amount);
  const max = Number(details.precipitation_amount_max);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    span: hour ? 1 : (six ? 6 : 1),
    max: Number.isFinite(max) ? max : null,
  };
}

function parseEntry(entry) {
  const time = entry?.time;
  const instant = entry?.data?.instant?.details || {};
  const stamp = Date.parse(time);
  if (!Number.isFinite(stamp) || !Number.isFinite(instant.air_temperature)) return null;
  const precip = precipitation(entry);
  const symbol = entry?.data?.next_1_hours?.summary?.symbol_code
    || entry?.data?.next_6_hours?.summary?.symbol_code
    || entry?.data?.next_12_hours?.summary?.symbol_code
    || '';
  return {
    time,
    temp: instant.air_temperature,
    precip: precip.amount,
    precipSpan: precip.span,
    precipMax: precip.max,
    wind: Number.isFinite(instant.wind_speed) ? instant.wind_speed : null,
    gust: finiteOrNull(instant.wind_speed_of_gust),
    direction: Number.isFinite(instant.wind_from_direction) ? instant.wind_from_direction : null,
    humidity: Number.isFinite(instant.relative_humidity) ? instant.relative_humidity : null,
    symbol,
  };
}

/** Up to `hours` of forecast beginning at the step that covers `now`. */
export function forecastFromMet(doc, now = new Date(), hours = 48) {
  const series = Array.isArray(doc?.properties?.timeseries) ? doc.properties.timeseries : [];
  const parsed = series.map(parseEntry).filter(Boolean);
  if (!parsed.length) return { current: null, hours: [] };
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  let anchorIndex = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    if (Date.parse(parsed[index].time) <= nowMs) anchorIndex = index;
    else break;
  }
  const anchor = Date.parse(parsed[anchorIndex].time);
  const end = anchor + hours * HOUR_MS;
  const window = parsed.filter((point) => {
    const stamp = Date.parse(point.time);
    return stamp >= anchor && stamp < end;
  });
  return { current: window[0] || null, hours: window };
}

export function sliceHours(hours, days) {
  const list = Array.isArray(hours) ? hours : [];
  if (!list.length) return [];
  const span = days === 1 ? 24 : 48;
  const anchor = Date.parse(list[0].time);
  const end = anchor + span * HOUR_MS;
  return list.filter((point) => Date.parse(point.time) < end);
}

export function extent(hours) {
  const temps = hours.map((point) => point.temp).filter(Number.isFinite);
  const precips = hours.map((point) => point.precip).filter(Number.isFinite);
  if (!temps.length) return { low: null, high: null, precip: 0 };
  return {
    low: Math.min(...temps),
    high: Math.max(...temps),
    precip: precips.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * Positions for the temperature line and precipitation bars.
 * Temperature uses the left side of the plot. Precipitation grows up from the base.
 */
export function layoutChart(points, box = {}) {
  const width = box.width || 640;
  const height = box.height || 240;
  const pad = { l: 40, r: 16, t: 16, b: 32, ...box.pad };
  const temps = points.map((point) => point.temp).filter(Number.isFinite);
  let tMin = temps.length ? Math.min(...temps) : 0;
  let tMax = temps.length ? Math.max(...temps) : 1;
  if (tMax - tMin < 1) {
    tMin -= 1;
    tMax += 1;
  }
  const pMax = Math.max(1, ...points.map((point) => (Number.isFinite(point.precip) ? point.precip : 0)));
  const innerW = Math.max(1, width - pad.l - pad.r);
  const innerH = Math.max(1, height - pad.t - pad.b);
  const slot = points.length > 0 ? innerW / points.length : innerW;
  const barW = Math.max(1, slot * 0.62);
  const xAt = (index) => pad.l + slot * index + slot / 2;
  const yTemp = (temp) => pad.t + (1 - (temp - tMin) / (tMax - tMin)) * innerH;
  const base = pad.t + innerH;
  const marks = points.map((point, index) => {
    const precip = Number.isFinite(point.precip) ? point.precip : 0;
    const precipH = (precip / pMax) * innerH;
    return {
      x: xAt(index),
      tempY: yTemp(point.temp),
      barX: xAt(index) - barW / 2,
      barY: base - precipH,
      barW,
      barH: precipH,
    };
  });
  return { width, height, pad, tMin, tMax, pMax, base, slot, marks };
}

function zoneParts(date, timeZone) {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const bag = {};
  for (const part of formatted) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    hour,
    minute: Number(bag.minute),
  };
}

/** Calendar parts of an instant in Europe/Oslo. */
export function osloParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return zoneParts(date, TIME_ZONE);
}

/** An Open-Meteo local time (`2026-11-15T18:00`) becomes a UTC instant. */
export function osloLocalToIso(local) {
  const text = String(local || '');
  if (!text) return '';
  if (/[zZ]$/.test(text) || /[+-]\d\d:\d\d$/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!match) return '';
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let pass = 0; pass < 2; pass += 1) {
    const got = zoneParts(new Date(utc), TIME_ZONE);
    const shown = Date.UTC(Number(got.date.slice(0, 4)), Number(got.date.slice(5, 7)) - 1, Number(got.date.slice(8, 10)), got.hour, got.minute);
    utc += desired - shown;
  }
  return new Date(utc).toISOString();
}

function periodId(hour) {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function describeDay(day) {
  const symbol = day?.symbol || '';
  const periods = {};
  for (const id of PERIODS) {
    const known = day?.periods?.[id];
    periods[id] = known?.symbol ? known : (symbol ? { symbol } : null);
  }
  return {
    date: day?.date || '',
    low: finiteOrNull(day?.low),
    high: finiteOrNull(day?.high),
    precip: finiteOrNull(day?.precip),
    wind: finiteOrNull(day?.wind),
    direction: finiteOrNull(day?.direction),
    gust: finiteOrNull(day?.gust),
    symbol,
    periods,
    hours: Array.isArray(day?.hours) ? day.hours : [],
  };
}

/**
 * One row per Oslo date. Night, morning, afternoon and evening take the first
 * hour in that span. Precipitation is the sum of the steps, and wind is the
 * strongest step.
 */
export function daysFromHours(hours) {
  const groups = new Map();
  for (const point of Array.isArray(hours) ? hours : []) {
    const parts = osloParts(point?.time);
    if (!parts || !Number.isFinite(point?.temp)) continue;
    let group = groups.get(parts.date);
    if (!group) {
      group = [];
      groups.set(parts.date, group);
    }
    group.push(point);
  }
  return [...groups.entries()].map(([date, points]) => {
    points.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const temps = points.map((point) => point.temp).filter(Number.isFinite);
    const winds = points.filter((point) => Number.isFinite(point.wind));
    const gusts = points.map((point) => point.gust).filter(Number.isFinite);
    const windiest = winds.reduce((best, point) => (!best || point.wind > best.wind ? point : best), null);
    const periods = {};
    for (const id of PERIODS) {
      const pick = points.find((point) => periodId(osloParts(point.time).hour) === id);
      periods[id] = pick ? { symbol: pick.symbol || '', temp: pick.temp } : null;
    }
    return {
      date,
      low: temps.length ? Math.min(...temps) : null,
      high: temps.length ? Math.max(...temps) : null,
      precip: points.reduce((sum, point) => sum + (Number.isFinite(point.precip) ? point.precip : 0), 0),
      wind: windiest ? windiest.wind : null,
      direction: windiest && Number.isFinite(windiest.direction) ? windiest.direction : null,
      gust: gusts.length ? Math.max(...gusts) : null,
      symbol: periods.afternoon?.symbol || points.find((point) => point.symbol)?.symbol || '',
      periods,
      hours: points,
    };
  });
}

/** Days that follow today, four of them, for the overview strip. */
export function upcomingDays(days, now = new Date(), count = 4) {
  const today = osloParts(now)?.date;
  const list = Array.isArray(days) ? days : [];
  const later = list.filter((day) => day.date > today);
  return (later.length ? later : list).slice(0, count);
}

export function todayRecord(days, now = new Date()) {
  const today = osloParts(now)?.date;
  return (Array.isArray(days) ? days : []).find((day) => day.date === today) || null;
}

/** Where each day's high and low sit inside the strip, so the bars can be compared. */
export function tempSpans(days) {
  const list = Array.isArray(days) ? days : [];
  const values = list.flatMap((day) => [day.low, day.high]).filter(Number.isFinite);
  if (values.length < 2) return list.map(() => null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const minShare = 0.18;
  return list.map((day) => {
    if (!Number.isFinite(day.low) || !Number.isFinite(day.high)) return null;
    let from = span > 0 ? (day.low - lo) / span : 0;
    let to = span > 0 ? (day.high - lo) / span : 1;
    if (to - from < minShare) {
      const mid = (from + to) / 2;
      from = Math.max(0, Math.min(1 - minShare, mid - minShare / 2));
      to = from + minShare;
    }
    return { from, to, cold: day.high < 1 };
  });
}

/** Hours drawn on the expanded graph: the step that covers now, then two days. */
export function graphHours(hours, now = new Date(), span = 48) {
  const list = (Array.isArray(hours) ? hours : [])
    .filter((point) => Number.isFinite(Date.parse(point?.time)))
    .slice()
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!list.length) return [];
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (Date.parse(list[index].time) <= nowMs) start = index;
    else break;
  }
  const begin = Date.parse(list[start].time);
  const end = begin + span * HOUR_MS;
  return list.filter((point) => {
    const stamp = Date.parse(point.time);
    return stamp >= begin && stamp < end;
  });
}

/** One point per day, used when the hourly series is not available. */
export function graphFromDays(days) {
  return (Array.isArray(days) ? days : []).flatMap((day) => {
    if (!day?.date || !Number.isFinite(day.high)) return [];
    const time = osloLocalToIso(`${day.date}T12:00`);
    if (!time) return [];
    return [{
      time,
      temp: day.high,
      precip: Number.isFinite(day.precip) ? day.precip : 0,
      precipMax: null,
      wind: Number.isFinite(day.wind) ? day.wind : null,
      gust: Number.isFinite(day.gust) ? day.gust : null,
      direction: Number.isFinite(day.direction) ? day.direction : null,
      symbol: day.symbol || day.periods?.afternoon?.symbol || '',
    }];
  });
}

export function weekdayShort(date, lang = 'nb') {
  const when = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(when.getTime())) return '';
  const tag = lang === 'nb' ? 'nb-NO' : 'en-GB';
  const name = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: 'short' }).format(when).replace(/\.$/, '');
  return `${name.charAt(0).toLocaleUpperCase(tag)}${name.slice(1)}.`;
}

/** `Tirsdag 17. nov.` */
export function dayHeading(date, lang = 'nb') {
  const when = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(when.getTime())) return String(date || '');
  const tag = lang === 'nb' ? 'nb-NO' : 'en-GB';
  const weekday = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: 'long' }).format(when);
  const day = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: 'numeric' }).format(when).replace(/\.$/, '');
  const month = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, month: 'short' }).format(when).replace(/\.$/, '');
  const titled = weekday.charAt(0).toLocaleUpperCase(tag) + weekday.slice(1);
  return `${titled} ${day}. ${month}.`;
}

export function clockLabel(value) {
  const parts = osloParts(value);
  if (!parts) return '';
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/**
 * Attach the day rows when the payload is only an hour list, and give a daily
 * payload the four period symbols it can honestly show.
 */
export function presentForecast(view, now = new Date()) {
  if (!view?.configured) return view;
  const hours = Array.isArray(view.hours) ? view.hours : [];
  if (!hours.length) {
    return { ...view, days: (Array.isArray(view.days) ? view.days : []).map(describeDay) };
  }
  return {
    ...view,
    days: daysFromHours(hours),
    updated: view.updated || new Date(now).toISOString(),
  };
}

export function symbolFromCode(code, night) {
  const base = WMO_SYMBOL[Number(code)] || 'unknown';
  return night ? `${base}_night` : base;
}

export function openMeteoUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,is_day',
    timezone: TIME_ZONE,
    forecast_days: '10',
    models: 'metno_nordic',
    wind_speed_unit: 'ms',
  });
  return `${OPEN_METEO_URL}?${params}`;
}

/**
 * Hourly MET Nordic forecast from Open-Meteo. Ten days, every hour, with gusts.
 * Times in the document are Europe/Oslo wall times.
 */
export function forecastFromOpenMeteo(doc, place, now = new Date()) {
  const empty = { configured: false, place: null, current: null, hours: [], days: [] };
  const hourly = doc?.hourly;
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  if (!times.length) return empty;
  const hours = [];
  for (let index = 0; index < times.length; index += 1) {
    const temp = Number(hourly.temperature_2m?.[index]);
    const time = osloLocalToIso(times[index]);
    if (!Number.isFinite(temp) || !time) continue;
    const night = Number(hourly.is_day?.[index]) !== 1;
    hours.push({
      time,
      temp,
      precip: Number.isFinite(Number(hourly.precipitation?.[index])) ? Number(hourly.precipitation[index]) : 0,
      precipSpan: 1,
      precipMax: null,
      wind: finiteOrNull(hourly.wind_speed_10m?.[index]),
      gust: finiteOrNull(hourly.wind_gusts_10m?.[index]),
      direction: finiteOrNull(hourly.wind_direction_10m?.[index]),
      symbol: symbolFromCode(hourly.weather_code?.[index], night),
    });
  }
  if (!hours.length) return empty;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const currentBlock = doc.current;
  const currentTemp = Number(currentBlock?.temperature_2m);
  const current = Number.isFinite(currentTemp)
    ? {
      time: osloLocalToIso(currentBlock.time) || hours[0].time,
      temp: currentTemp,
      symbol: symbolFromCode(currentBlock.weather_code, Number(currentBlock.is_day) !== 1),
      wind: finiteOrNull(currentBlock.wind_speed_10m),
      direction: finiteOrNull(currentBlock.wind_direction_10m),
      precip: null,
    }
    : hours.find((point) => Date.parse(point.time) <= nowMs) || hours[0];
  return presentForecast({
    configured: true,
    source: 'open-meteo',
    place: {
      name: place?.name || '',
      municipality: place?.municipality || '',
      county: place?.county || '',
    },
    current,
    hours,
    updated: new Date(now).toISOString(),
    attribution: {
      met: 'https://www.met.no/',
      openMeteo: 'https://open-meteo.com/',
    },
  }, now);
}

/**
 * Temperature on the upper plot, precipitation from the same base, wind and
 * gust on the lower plot. Arrow rotation points where the wind is going.
 */
export function layoutGraph(points, box = {}) {
  const list = Array.isArray(points) ? points : [];
  const width = box.width || 960;
  const height = box.height || 292;
  const pad = { l: 40, r: 36, t: 12, b: 8, ...box.pad };
  const temps = list.map((point) => point.temp).filter(Number.isFinite);
  let tMin = temps.length ? Math.min(...temps, 0) : 0;
  let tMax = temps.length ? Math.max(...temps, 0) : 1;
  if (tMax - tMin < 1) {
    tMin -= 1;
    tMax += 1;
  }
  const precips = list.flatMap((point) => [point.precip, point.precipMax]).filter(Number.isFinite);
  const pMax = Math.max(1, ...precips, 0);
  const winds = list.flatMap((point) => [point.wind, point.gust]).filter(Number.isFinite);
  const wMax = Math.max(1, ...winds, 0);
  const gap = 28;
  const innerW = Math.max(1, width - pad.l - pad.r);
  const plotH = Math.max(40, Math.round((height - pad.t - pad.b - gap) * 0.62));
  const topBase = pad.t + plotH;
  const windTop = topBase + gap;
  const windBase = height - pad.b;
  const windH = Math.max(1, windBase - windTop);
  const slot = list.length > 0 ? innerW / list.length : innerW;
  const barW = Math.max(1, slot * 0.55);
  const xAt = (index) => pad.l + slot * index + slot / 2;
  const yTemp = (temp) => pad.t + (1 - (temp - tMin) / (tMax - tMin)) * plotH;
  const yPrecip = (amount) => topBase - (Math.max(0, amount) / pMax) * plotH;
  const yWind = (speed) => windBase - (Math.max(0, speed) / wMax) * windH;
  const marks = list.map((point, index) => {
    const precip = Number.isFinite(point.precip) ? point.precip : 0;
    const max = Number.isFinite(point.precipMax) ? point.precipMax : null;
    const precipY = yPrecip(precip);
    const maxY = max == null ? null : yPrecip(max);
    return {
      x: xAt(index),
      tempY: yTemp(point.temp),
      barX: xAt(index) - barW / 2,
      barY: precipY,
      barW,
      barH: topBase - precipY,
      maxY,
      maxH: maxY == null ? 0 : topBase - maxY,
      windY: Number.isFinite(point.wind) ? yWind(point.wind) : null,
      gustY: Number.isFinite(point.gust) ? yWind(point.gust) : null,
      direction: Number.isFinite(point.direction) ? (point.direction + 180) % 360 : null,
    };
  });
  return {
    width,
    height,
    pad,
    tMin,
    tMax,
    pMax,
    wMax,
    topBase,
    windTop,
    windBase,
    zeroY: yTemp(0),
    slot,
    marks,
  };
}
