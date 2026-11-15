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
  dayHeading,
  daysFromHours,
  extent,
  forecastFromHost,
  forecastFromMet,
  forecastFromOpenMeteo,
  graphHours,
  inNorway,
  layoutChart,
  layoutGraph,
  osloLocalToIso,
  presentForecast,
  roundCoord,
  sliceHours,
  symbolFromWmo,
  symbolIcon,
  symbolKey,
  upcomingDays,
  weekdayShort,
} from '../met-weather/lib/forecast.js';
import { USER_AGENT, createMetClient, forecastUrl } from '../met-weather/lib/met.js';
import { placeFromLookup, placeFromPreferences, placesFromGeocode, placesFromSearch } from '../met-weather/lib/places.js';
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

test('eight days keep night, morning, afternoon and evening', () => {
  const hours = [];
  for (let day = 0; day < 8; day += 1) {
    for (const hour of [2, 8, 14, 20]) {
      const stamp = new Date(Date.UTC(2026, 10, 15 + day, hour - 1, 0));
      hours.push({
        time: stamp.toISOString(),
        temp: hour === 14 ? 4 : hour === 2 ? -1 : 1,
        precip: hour === 14 ? 1.25 : 0,
        precipMax: hour === 14 ? 2 : 0,
        wind: hour === 20 ? 6.4 : 3,
        gust: 9,
        direction: hour === 20 ? 0 : 90,
        symbol: hour < 6 ? 'clearsky_night' : hour < 12 ? 'cloudy' : hour < 18 ? 'clearsky_day' : 'fair_night',
      });
    }
  }
  const days = daysFromHours(hours);
  assert.equal(days.length, 8);
  assert.equal(days[0].date, '2026-11-15');
  assert.equal(days[7].date, '2026-11-22');
  assert.equal(days[0].periods.night.symbol, 'clearsky_night');
  assert.equal(days[0].periods.morning.symbol, 'cloudy');
  assert.equal(days[0].periods.afternoon.symbol, 'clearsky_day');
  assert.equal(days[0].periods.evening.symbol, 'fair_night');
  assert.equal(days[0].low, -1);
  assert.equal(days[0].high, 4);
  assert.equal(days[0].precip, 1.25);
  assert.equal(days[0].wind, 6.4);
  assert.equal(days[0].direction, 0);
  assert.equal(days[2].hours.length, 4);
  const next = upcomingDays(days, NOW);
  assert.deepEqual(next.map((day) => day.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  assert.equal(weekdayShort('2026-11-16', 'nb'), 'Man.');
  assert.equal(dayHeading('2026-11-17', 'nb'), 'Tirsdag 17. nov.');
  assert.equal(osloLocalToIso('2026-11-15T00:00'), '2026-11-14T23:00:00.000Z');

  const graph = graphHours(hours, NOW);
  assert.equal(graph[0].time, '2026-11-15T07:00:00.000Z');
  assert.equal(graph.length, 8);
  const warm = layoutGraph([
    { time: graph[0].time, temp: 4, precip: 2, precipMax: 3, wind: 3, gust: 6, direction: 0 },
    { time: graph[1].time, temp: -1, precip: 0, wind: 1, gust: 2, direction: 90 },
  ]);
  assert.ok(warm.marks[0].tempY < warm.marks[1].tempY);
  assert.ok(warm.marks[0].barH > warm.marks[1].barH);
  assert.ok(warm.marks[0].maxH > warm.marks[0].barH);
  assert.equal(warm.marks[0].direction, 180);
  assert.ok(warm.marks[0].gustY < warm.marks[0].windY);

  const dense = [];
  for (let hour = 0; hour < 24; hour += 1) {
    dense.push({
      time: new Date(Date.UTC(2026, 10, 16, hour - 1, 0)).toISOString(),
      temp: hour,
      precip: 0,
      wind: 2,
      symbol: 'cloudy',
    });
  }
  assert.equal(daysFromHours(dense)[0].hours.length, 24);
});

test('Open-Meteo hours become the same day rows', () => {
  const view = forecastFromOpenMeteo({
    current: {
      time: '2026-11-15T13:00',
      temperature_2m: 7,
      weather_code: 3,
      wind_speed_10m: 3.2,
      wind_direction_10m: 180,
      is_day: 0,
    },
    hourly: {
      time: ['2026-11-15T13:00', '2026-11-15T14:00'],
      temperature_2m: [7, 6.2],
      precipitation: [0, 0.4],
      wind_speed_10m: [3.2, 4],
      wind_gusts_10m: [6, 8],
      wind_direction_10m: [180, 200],
      weather_code: [3, 1],
      is_day: [0, 0],
    },
  }, { name: 'Langhus' }, NOW);
  assert.equal(view.source, 'open-meteo');
  assert.equal(view.place.name, 'Langhus');
  assert.equal(view.current.temp, 7);
  assert.equal(view.current.symbol, 'cloudy_night');
  assert.equal(view.hours.length, 2);
  assert.equal(view.hours[1].gust, 8);
  assert.equal(view.hours[0].time, '2026-11-15T12:00:00.000Z');
  assert.equal(view.days.length, 1);
  const daily = presentForecast(forecastFromHost(hostWeather()));
  assert.equal(daily.days[0].periods.night.symbol, 'cloudy');
  assert.equal(daily.days[0].periods.evening.symbol, 'cloudy');
  assert.equal(daily.days[0].hours.length, 0);
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
    assert.equal(member.body.hours.length, 50);
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

function hostWeather() {
  return {
    data: {
      provider: 'open-meteo',
      city: 'Oslo',
      units: 'metric',
      current: {
        temp: 8,
        wind_speed: 18,
        icon: 'cloud',
        desc: 'wmo.3',
      },
      today: { date: '2026-11-15', temp_min: 4, temp_max: 9, icon: 'cloud', desc: 'wmo.3' },
      forecast: [
        { date: '2026-11-16', temp_min: 2, temp_max: 7, icon: 'cloud-rain', desc: 'wmo.63' },
      ],
    },
  };
}

test('a place outside Norway is not taken from Yuvomi settings', () => {
  assert.equal(placeFromPreferences({ weather_lat: '52.52', weather_lon: '13.405', weather_city: 'Berlin' }), null);
  assert.equal(placeFromPreferences({
    weather_provider: 'openweathermap',
    weather_lat: '59.9139',
    weather_lon: '10.7522',
    weather_city: 'Oslo',
  }), null);
  assert.deepEqual(placeFromPreferences({
    weather_source: { provider: 'open-meteo', lat: '60.39', lon: '5.32', city: 'Bergen' },
  }), {
    id: null,
    name: 'Bergen',
    municipality: '',
    county: '',
    lat: 60.39,
    lon: 5.32,
  });
  assert.deepEqual(placeFromPreferences({
    weather_lat: '59.9139',
    weather_lon: '10.7522',
    weather_city: 'Oslo',
    weather_user: { lat: '69.6546', lon: '18.9637', city: 'Tromsø' },
  }), {
    id: null,
    name: 'Tromsø',
    municipality: '',
    county: '',
    lat: 69.6546,
    lon: 18.9637,
  });
  const places = placesFromGeocode([
    { name: 'Tromsø', country_code: 'NO', latitude: 69.649, longitude: 18.955, admin1: 'Troms', admin2: 'Tromsø' },
    { name: 'Stockholm', country_code: 'SE', latitude: 59.33, longitude: 18.07, admin1: 'Stockholm' },
  ]);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Tromsø');
  assert.equal(places[0].county, 'Troms');
});

test('Yuvomi weather becomes a day view in metres per second', () => {
  const view = forecastFromHost(hostWeather());
  assert.equal(view.configured, true);
  assert.equal(view.source, 'host');
  assert.equal(view.hours.length, 0);
  assert.equal(view.days.length, 2);
  assert.equal(view.current.temp, 8);
  assert.equal(view.current.symbol, 'cloudy');
  assert.ok(Math.abs(view.current.wind - 5) < 0.05);
  assert.equal(view.days[1].symbol, 'rain');
  assert.equal(symbolFromWmo('wmo.0', 'moon'), 'clearsky_night');
  assert.equal(forecastFromHost({ data: null, reason: 'not_configured' }).configured, false);
  assert.equal(forecastFromHost({ reason: 'upstream_error' }).error, 'upstream');
});

test('a missing sidecar reads Yuvomi weather instead of failing', async () => {
  const calls = [];
  const puts = [];
  const hostApi = {
    async get(path) {
      calls.push(path);
      if (path === '/preferences') {
        return { data: { weather_lat: '59.9139', weather_lon: '10.7522', weather_city: 'Oslo' } };
      }
      if (path === '/weather') return hostWeather();
      if (path.startsWith('/weather/geocode')) {
        return {
          data: [
            { name: 'Oslo', country_code: 'NO', latitude: 59.9139, longitude: 10.7522, admin1: 'Oslo' },
            { name: 'Berlin', country_code: 'DE', latitude: 52.52, longitude: 13.405, admin1: 'Berlin' },
          ],
        };
      }
      throw new Error(path);
    },
    async put(path, body) {
      puts.push({ path, body });
      return { data: {} };
    },
  };
  const absent = async () => ({ status: 404, text: async () => '' });
  const client = createClient({ fetchImpl: absent, hostApi });
  const forecast = await client.forecast();
  assert.equal(forecast.configured, true);
  assert.equal(forecast.place.name, 'Oslo');
  assert.equal(forecast.days.length, 2);
  assert.deepEqual(calls, ['/preferences', '/weather']);

  const abroad = createClient({
    fetchImpl: absent,
    hostApi: {
      async get(path) {
        assert.equal(path, '/preferences');
        return { data: { weather_lat: '52.52', weather_lon: '13.405', weather_city: 'Berlin' } };
      },
    },
  });
  const hidden = await abroad.forecast();
  assert.equal(hidden.configured, false);

  const places = await client.places('Os');
  assert.equal(places.places.length, 1);
  assert.equal(places.places[0].name, 'Oslo');
  const saved = await client.savePlace(places.places[0]);
  assert.equal(saved.place.name, 'Oslo');
  assert.equal(puts[0].path, '/preferences');
  assert.equal(puts[0].body.weather_provider, 'open-meteo');
  assert.equal(puts[0].body.weather_lat, 59.9139);
  assert.equal(puts[0].body.weather_user.city, 'Oslo');
  await assert.rejects(
    () => client.savePlace({ name: 'Berlin', lat: 52.52, lon: 13.405 }),
    (err) => err instanceof WeatherError && err.reason === 'norway',
  );
});

test('a missing sidecar prefers the hourly forecast over the daily summary', async () => {
  const calls = [];
  const client = createClient({
    hostApi: {
      async get(path) {
        calls.push(path);
        if (path === '/preferences') {
          return { data: { weather_lat: '59.748', weather_lon: '10.845', weather_city: 'Langhus' } };
        }
        if (path === '/weather') return hostWeather();
        throw new Error(path);
      },
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/api/extensions/met-weather')) return { status: 404, ok: false, text: async () => '' };
      if (target.includes('api.open-meteo.com')) {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({
            current: {
              time: '2026-11-15T13:00',
              temperature_2m: 7,
              weather_code: 3,
              wind_speed_10m: 3,
              wind_direction_10m: 180,
              is_day: 0,
            },
            hourly: {
              time: Array.from({ length: 24 * 8 }, (_, index) => {
                const day = Math.floor(index / 24);
                const hour = index % 24;
                return `2026-11-${String(15 + day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`;
              }),
              temperature_2m: Array.from({ length: 24 * 8 }, () => 4),
              precipitation: Array.from({ length: 24 * 8 }, () => 0),
              wind_speed_10m: Array.from({ length: 24 * 8 }, () => 3),
              wind_gusts_10m: Array.from({ length: 24 * 8 }, () => 5),
              wind_direction_10m: Array.from({ length: 24 * 8 }, () => 180),
              weather_code: Array.from({ length: 24 * 8 }, () => 1),
              is_day: Array.from({ length: 24 * 8 }, (_, index) => (index % 24 > 6 && index % 24 < 18 ? 1 : 0)),
            },
          }),
        };
      }
      throw new Error(target);
    },
  });
  const forecast = await client.forecast();
  assert.equal(forecast.source, 'open-meteo');
  assert.equal(forecast.place.name, 'Langhus');
  assert.ok(forecast.days.length >= 8);
  assert.equal(forecast.days[1].hours.length, 24);
  assert.deepEqual(calls, ['/preferences']);
});

test('the sidecar answer is used when the service is there', async () => {
  let hostCalled = false;
  const client = createClient({
    hostApi: { async get() { hostCalled = true; return {}; } },
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({
        configured: true,
        place: { name: 'Bergen' },
        current: { temp: 11 },
        hours: [{ time: '2026-11-15T12:00:00.000Z', temp: 11 }],
      }),
    }),
  });
  const forecast = await client.forecast();
  assert.equal(hostCalled, false);
  assert.equal(forecast.place.name, 'Bergen');
  const rejected = createClient({
    hostApi: null,
    fetchImpl: async () => ({
      status: 400,
      text: async () => JSON.stringify({ reason: 'norway', csrfToken: 't' }),
    }),
  });
  await assert.rejects(() => rejected.savePlace({ id: 1, name: 'Ute', lat: 40, lon: 10 }), (err) => err.reason === 'norway');
});

test('the manifest and both languages describe the same weather module', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../met-weather/module.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, 'met-weather');
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.description, 'Værdata fra Norsk meteorologisk institutt');
  assert.equal(manifest.settings.labelKey, 'settings.title');
  assert.equal(manifest.capabilities.api.prefix, '/api/extensions/met-weather');
  assert.equal(manifest.capabilities.widgets[0].entry, 'widgets/forecast.js');
  assert.equal(manifest.capabilities.widgets[0].defaultVisible, true);
  assert.equal(manifest.capabilities.widgets[0].defaultSize, '4x2');
  const widget = fs.readFileSync(new URL('../met-weather/widgets/forecast.js', import.meta.url), 'utf8');
  assert.equal(widget.includes('yuvomi.navigate'), false);
  assert.equal(widget.includes('/m/met-weather'), false);
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
