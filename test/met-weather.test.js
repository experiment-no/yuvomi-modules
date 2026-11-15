import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createClient, WeatherError } from '../met-weather/lib/client.js';
import {
  PREFIX,
  compass,
  extent,
  forecastFromMet,
  inNorway,
  layoutChart,
  roundCoord,
  sliceHours,
  symbolIcon,
  symbolKey,
} from '../met-weather/lib/forecast.js';
import { USER_AGENT, createMetClient, forecastUrl } from '../met-weather/lib/met.js';
import { placeFromLookup, placesFromSearch } from '../met-weather/lib/places.js';
import { createServer } from '../met-weather/service/server.js';

const NOW = new Date('2026-11-15T12:30:00Z');

function step(iso, temp, precip = 0, symbol = 'clearsky_day', span = 1) {
  const data = {
    instant: {
      details: {
        air_temperature: temp,
        wind_speed: 4.2,
        wind_from_direction: 45,
        relative_humidity: 70,
      },
    },
  };
  const period = span === 6 ? 'next_6_hours' : 'next_1_hours';
  data[period] = { summary: { symbol_code: symbol }, details: { precipitation_amount: precip } };
  return { time: iso, data };
}

function hourly(start, count, tempAt = (index) => index) {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => step(
    new Date(startMs + index * 60 * 60 * 1000).toISOString(),
    tempAt(index),
    index % 5 === 0 ? 1.5 : 0,
    index % 2 ? 'rain_day' : 'clearsky_night',
  ));
}

function tromso(extra = {}) {
  return {
    skrivemåte: 'Tromsø',
    stedsnummer: 503295,
    representasjonspunkt: { nord: 69.65455, øst: 18.96366 },
    kommuner: [{ kommunenavn: 'Tromsø' }],
    fylker: [{ fylkesnavn: 'Troms - Romsa - Tromssa' }],
    ...extra,
  };
}

test('coordinates stay at four decimals and the Norway box is a backstop', () => {
  assert.equal(roundCoord(59.91394), 59.9139);
  assert.equal(roundCoord('nope'), null);
  assert.equal(inNorway(59.9139, 10.7522), true);
  assert.equal(inNorway(69.6546, 18.9637), true);
  assert.equal(inNorway(78.2232, 15.6267), true);
  assert.equal(inNorway(70.983, -8.5), true);
  assert.equal(inNorway(40, 10), false);
  assert.equal(inNorway(59.33, 18.07), true);
});

test('the forecast window starts at the hour covering now', () => {
  const series = hourly('2026-11-15T10:00:00Z', 60);
  const view = forecastFromMet({ properties: { timeseries: series } }, NOW, 48);
  assert.equal(view.current.time, '2026-11-15T12:00:00.000Z');
  assert.equal(view.hours.length, 48);
  assert.equal(view.hours.at(-1).time, '2026-11-17T11:00:00.000Z');
  const day = sliceHours(view.hours, 1);
  const two = sliceHours(view.hours, 2);
  assert.equal(day.length, 24);
  assert.equal(two.length, 48);
  assert.equal(day.at(-1).time, '2026-11-16T11:00:00.000Z');
  assert.equal(view.hours[0].symbol, 'clearsky_night');
  assert.equal(view.hours[0].precip, 0);
  assert.equal(view.hours.some((point) => point.precip === 1.5), true);
  const span = extent(day);
  assert.equal(span.low, 2);
  assert.equal(span.high, 25);
  assert.ok(span.precip > 0);
});

test('six-hour precipitation is kept when the hour is missing', () => {
  const point = forecastFromMet({
    properties: {
      timeseries: [step('2026-11-15T12:00:00Z', -3, 4, 'snow_day', 6)],
    },
  }, NOW, 24);
  assert.equal(point.hours[0].precip, 4);
  assert.equal(point.hours[0].precipSpan, 6);
  assert.equal(symbolKey('heavyrainandthunder_night'), 'heavyrainandthunder');
  assert.equal(symbolKey(''), 'unknown');
  assert.equal(symbolIcon('clearsky_night'), 'moon');
  assert.equal(symbolIcon('fair_night'), 'moon');
  assert.equal(symbolIcon('partlycloudy_night'), 'cloud-moon');
  assert.equal(symbolIcon('heavyrainandthunder_day'), 'cloud-lightning');
  assert.equal(symbolIcon('snow_day'), 'cloud-snow');
  assert.equal(symbolIcon('rain_day'), 'cloud-rain');
  assert.equal(compass(45, 'nb'), 'NØ');
  assert.equal(compass(45, 'en'), 'NE');
  assert.equal(compass(null, 'nb'), '');
});

test('the chart gives every hour a temperature point and a precipitation bar', () => {
  const hours = sliceHours(forecastFromMet({
    properties: { timeseries: hourly('2026-11-15T12:00:00Z', 24, (index) => 10 - index) },
  }, NOW, 24).hours, 1);
  const layout = layoutChart(hours);
  assert.equal(layout.marks.length, 24);
  assert.ok(layout.marks[0].tempY < layout.marks.at(-1).tempY);
  assert.ok(layout.marks[0].barH > layout.marks[1].barH);
  assert.ok(layout.marks[0].x < layout.marks[1].x);
});

test('place search keeps Kartverket hits inside Norway and shortens the county', () => {
  const places = placesFromSearch({
    navn: [
      tromso(),
      tromso(),
      {
        skrivemåte: 'Utenfor',
        stedsnummer: 9,
        representasjonspunkt: { nord: 40.1, øst: 10 },
        kommuner: [{ kommunenavn: 'Nei' }],
        fylker: [{ fylkesnavn: 'Utenfor' }],
      },
      { skrivemåte: '', stedsnummer: 10, representasjonspunkt: { nord: 60, øst: 10 } },
    ],
  });
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], {
    id: 503295,
    name: 'Tromsø',
    municipality: 'Tromsø',
    county: 'Troms',
    lat: 69.6546,
    lon: 18.9637,
  });
  const looked = placeFromLookup({
    navn: [{
      stedsnummer: 503295,
      representasjonspunkt: { nord: 69.65455, øst: 18.96366 },
      kommuner: [{ kommunenavn: 'Tromsø' }],
      fylker: [{ fylkesnavn: 'Troms - Romsa - Tromssa' }],
      stedsnavn: [
        { språk: 'Nordsamisk', skrivemåte: 'Romsa', skrivemåtestatus: 'godkjent og prioritert' },
        { språk: 'Norsk', skrivemåte: 'Tromsø', skrivemåtestatus: 'godkjent og prioritert' },
      ],
    }],
  });
  assert.equal(looked.name, 'Tromsø');
  assert.equal(placeFromLookup(null), null);
});

test('MET is cached until Expires and repeated with If-Modified-Since', async () => {
  const calls = [];
  let status = 200;
  const body = { properties: { timeseries: [step('2026-11-15T12:00:00Z', 2)] } };
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get(name) {
          if (name === 'expires') return 'Sun, 15 Nov 2026 12:40:00 GMT';
          if (name === 'last-modified') return 'Sun, 15 Nov 2026 12:00:00 GMT';
          return '';
        },
      },
      json: async () => body,
    };
  };
  const met = createMetClient(fetchImpl);
  const first = await met.forecast(59.9139, 10.7522, Date.parse('2026-11-15T12:30:00Z'));
  const second = await met.forecast(59.9139, 10.7522, Date.parse('2026-11-15T12:35:00Z'));
  assert.equal(calls.length, 1);
  assert.equal(second.cached, true);
  assert.equal(second.body, first.body);
  assert.equal(calls[0].headers['user-agent'], USER_AGENT);
  assert.equal(calls[0].url, forecastUrl(59.9139, 10.7522));
  assert.match(calls[0].url, /lat=59\.9139&lon=10\.7522$/);
  status = 304;
  const third = await met.forecast(59.9139, 10.7522, Date.parse('2026-11-15T12:41:00Z'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['if-modified-since'], 'Sun, 15 Nov 2026 12:00:00 GMT');
  assert.equal(third.body, first.body);
  assert.equal(third.cached, true);
});

test('a failed MET call surfaces as upstream', async () => {
  const met = createMetClient(async () => ({ ok: false, status: 403, headers: { get: () => '' } }));
  await assert.rejects(() => met.forecast(59.9139, 10.7522), (err) => err.code === 'upstream' && err.status === 403);
  const empty = await met.search('a');
  assert.deepEqual(empty, { navn: [] });
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('the sidecar checks the session, saves a Norwegian place, and serves the forecast', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-weather-'));
  const statePath = path.join(dir, 'place.json');
  const seen = [];
  const auth = await listen((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie || '' });
    const cookie = req.headers.cookie || '';
    const role = cookie.includes('admin') ? 'admin' : 'member';
    const level = cookie.includes('none') ? 'none' : 'write';
    res.writeHead(cookie.includes('down') ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      user: { id: cookie, display_name: role === 'admin' ? 'Ada' : 'Bea', role },
      permissions: { admin: role === 'admin', modules: { 'ext:met-weather': level } },
    }));
  });
  const metCalls = [];
  const met = {
    async forecast(lat, lon) {
      metCalls.push({ lat, lon });
      return {
        body: {
          properties: {
            timeseries: hourly('2026-11-15T12:00:00Z', 50, (index) => 8 - index * 0.1),
          },
        },
      };
    },
    async search(query) {
      assert.equal(query, 'Troms');
      return { navn: [tromso(), { skrivemåte: 'Ute', stedsnummer: 4, representasjonspunkt: { nord: 1, øst: 1 } }] };
    },
    async place(id) {
      if (id === 503295) return { navn: [tromso()] };
      if (id === 42) return { navn: [{ skrivemåte: 'Ute', stedsnummer: 42, representasjonspunkt: { nord: 40, øst: 10 } }] };
      return null;
    },
  };
  const authPort = auth.address().port;
  const server = createServer({
    statePath,
    authUrl: `http://127.0.0.1:${authPort}`,
    met,
    now: () => NOW,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  async function api(method, route, { cookie = 'session=admin', token, origin, body } = {}) {
    const headers = { accept: 'application/json', cookie };
    if (token) headers['x-met-weather-csrf'] = token;
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${port}${PREFIX}${route}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    const empty = await api('GET', '/forecast');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.configured, false);
    assert.equal(seen[0].url, '/api/v1/auth/me');

    const missing = await api('PUT', '/place', { body: { id: 503295 } });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.reason, 'csrf');
    const token = missing.body.csrfToken;
    const saved = await api('PUT', '/place', { token, body: { id: 503295 } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.place.name, 'Tromsø');
    assert.equal(saved.body.place.county, 'Troms');
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(saved.body).includes('skrivemåte'), false);

    const foreign = await api('PUT', '/place', {
      token,
      origin: 'https://evil.example',
      body: { id: 503295 },
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.reason, 'origin');

    const outside = await api('PUT', '/place', { token, body: { id: 42 } });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.reason, 'norway');
    const unknown = await api('PUT', '/place', { token, body: { id: 7 } });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.reason, 'norway');

    const memberSearch = await api('GET', '/places?q=Troms', { cookie: 'session=member' });
    assert.equal(memberSearch.status, 403);
    const search = await api('GET', '/places?q=Troms');
    assert.equal(search.status, 200);
    assert.equal(search.body.places.length, 1);

    const member = await api('GET', '/forecast', { cookie: 'session=member' });
    assert.equal(member.status, 200);
    assert.equal(member.body.configured, true);
    assert.equal(member.body.place.lat, 69.6546);
    assert.equal(member.body.place.lon, 18.9637);
    assert.equal(member.body.hours.length, 48);
    assert.equal(sliceHours(member.body.hours, 1).length, 24);
    assert.equal(metCalls[0].lat, 69.6546);
    assert.equal(member.body.attribution.met, 'https://www.met.no/');
    assert.equal(JSON.stringify(member.body).includes('properties'), false);

    const none = await api('GET', '/forecast', { cookie: 'session=none' });
    assert.equal(none.status, 403);
    assert.equal(none.body.reason, 'forbidden');
    const anonymous = await api('GET', '/forecast', { cookie: '' });
    assert.equal(anonymous.status, 401);

    fs.writeFileSync(statePath, '{', { mode: 0o600 });
    const broken = await api('GET', '/forecast');
    assert.equal(broken.status, 500);
    assert.equal(broken.body.reason, 'internal');
  } finally {
    server.close();
    auth.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the browser client treats a missing service as unavailable', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(() => createClient().forecast(), (err) => err instanceof WeatherError && err.reason === 'service');
    globalThis.fetch = async () => ({ status: 404, text: async () => '' });
    await assert.rejects(() => createClient().places('Oslo'), (err) => err.reason === 'service');
    globalThis.fetch = async () => ({
      status: 400,
      text: async () => JSON.stringify({ reason: 'norway', csrfToken: 't' }),
    });
    await assert.rejects(() => createClient().savePlace(1), (err) => err.reason === 'norway');
  } finally {
    globalThis.fetch = previous;
  }
});

test('the manifest and both languages describe the same weather module', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../met-weather/module.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, 'met-weather');
  assert.equal(manifest.settings.labelKey, 'settings.title');
  assert.equal(manifest.capabilities.api.prefix, '/api/extensions/met-weather');
  assert.equal(manifest.capabilities.widgets[0].entry, 'widgets/forecast.js');
  assert.equal(manifest.capabilities.widgets[0].defaultVisible, true);
  const english = JSON.parse(fs.readFileSync(new URL('../met-weather/locales/en.json', import.meta.url), 'utf8'));
  const norwegian = JSON.parse(fs.readFileSync(new URL('../met-weather/locales/nb.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(english).sort(), Object.keys(norwegian).sort());
  assert.equal(english['settings.title'], 'Weather');
  assert.equal(norwegian['settings.title'], 'Vær');
  assert.equal(english['page.day'], '1 day');
  assert.equal(norwegian['page.day'], '1 døgn');
  assert.equal(english['page.twoDays'], '2 days');
  assert.equal(norwegian['page.twoDays'], '2 døgn');
  assert.equal(english['symbol.clearsky'], 'Clear sky');
  assert.equal(norwegian['symbol.snowandthunder'], 'Snø og torden');
  for (const key of Object.keys(english)) {
    assert.equal(typeof norwegian[key], 'string');
    assert.ok(norwegian[key].length > 0);
  }
});
