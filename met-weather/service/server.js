/**
 * MET weather sidecar. Yuvomi does not start this process.
 * It answers /api/extensions/met-weather and is the only place that calls MET,
 * because the page cannot set the required User-Agent.
 *
 *   YUVOMI_INTERNAL_URL=http://127.0.0.1:3000 node service/server.js
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FORECAST_HOURS, PREFIX, forecastFromMet, inNorway, roundCoord } from '../lib/forecast.js';
import { UpstreamError, createMetClient } from '../lib/met.js';
import { placeFromLookup, placesFromSearch } from '../lib/places.js';

const CSRF_HEADER = 'x-met-weather-csrf';
const BODY_LIMIT = 16 * 1024;

export function createServer(options = {}) {
  const statePath = options.statePath || process.env.MET_WEATHER_STATE || path.join(process.cwd(), 'data/met-weather/place.json');
  const authBase = (options.authUrl || process.env.YUVOMI_INTERNAL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const met = options.met || createMetClient(options.fetchImpl);
  const now = options.now || (() => new Date());
  const profiles = new Map();
  const tokens = new Map();
  let chain = Promise.resolve();

  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  function load() {
    try {
      return { place: normalizeStored(JSON.parse(fs.readFileSync(statePath, 'utf8'))) };
    } catch (err) {
      if (err && err.code === 'ENOENT') return { place: null };
      return { corrupt: true };
    }
  }

  function save(place) {
    const dir = path.dirname(statePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(place, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, statePath);
    fs.chmodSync(statePath, 0o600);
  }

  function tokenFor(key, rotate) {
    if (rotate || !tokens.has(key)) tokens.set(key, crypto.randomBytes(32).toString('hex'));
    return tokens.get(key);
  }

  async function identify(cookie) {
    const key = crypto.createHash('sha256').update(cookie).digest('hex');
    const cached = profiles.get(key);
    if (cached && Date.now() - cached.at < 5000) return { key, actor: cached.actor };
    let response;
    try {
      response = await (options.fetchImpl || fetch)(`${authBase}/api/v1/auth/me`, {
        headers: { cookie, accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      return { error: { status: 502, reason: 'upstream' } };
    }
    if (response.status === 401 || response.status === 403) return { error: { status: 401, reason: 'auth' } };
    if (!response.ok) return { error: { status: 502, reason: 'upstream' } };
    let data;
    try {
      data = await response.json();
    } catch {
      return { error: { status: 502, reason: 'upstream' } };
    }
    const user = data?.user && typeof data.user === 'object' ? data.user : {};
    const permissions = data?.permissions && typeof data.permissions === 'object' ? data.permissions : {};
    const level = permissions.modules?.['ext:met-weather'];
    const access = level == null || level === '' ? 'write' : level;
    const actor = {
      id: user.id ?? '',
      name: typeof user.display_name === 'string' && user.display_name
        ? user.display_name
        : (typeof user.username === 'string' ? user.username : ''),
      access: access === 'none' || access === 'read' || access === 'write' ? access : 'none',
      role: user.role === 'admin' || permissions.admin === true ? 'admin' : 'member',
    };
    profiles.set(key, { at: Date.now(), actor });
    return { key, actor };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > BODY_LIMIT) {
          reject(Object.assign(new Error('limit'), { code: 'LIMIT' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(Object.assign(new Error('invalid'), { code: 'JSON' }));
        }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body, token, secure) {
    const payload = JSON.stringify(body);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    };
    if (token) {
      const parts = [`met-weather-csrf=${token}`, 'Path=/', 'SameSite=Lax', 'HttpOnly'];
      if (secure) parts.push('Secure');
      headers['set-cookie'] = parts.join('; ');
    }
    res.writeHead(status, headers);
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    void onRequest(req, res);
  });

  async function onRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const route = url.pathname === PREFIX
      ? '/'
      : (url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : null);
    if (!route) {
      send(res, 404, { error: 'missing', reason: 'missing' });
      return;
    }
    const cookie = req.headers.cookie || '';
    if (!cookie) {
      send(res, 401, { error: 'auth', reason: 'auth' });
      return;
    }
    const identified = await identify(cookie);
    if (identified.error) {
      send(res, identified.error.status, { error: identified.error.reason, reason: identified.error.reason });
      return;
    }
    const method = req.method || 'GET';
    const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    const token = tokenFor(identified.key, false);
    const actor = { ...identified.actor, csrfToken: token };
    if (actor.access === 'none') {
      send(res, 403, { error: 'forbidden', reason: 'forbidden', ...publicActor(actor) }, token, secure);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
        if (origin !== `${proto}://${host}`) {
          send(res, 403, { error: 'origin', reason: 'origin', ...publicActor(actor) }, token, secure);
          return;
        }
      }
      const header = String(req.headers[CSRF_HEADER] || '');
      if (!header || header !== token) {
        const fresh = tokenFor(identified.key, true);
        send(res, 403, {
          error: 'csrf',
          reason: 'csrf',
          ...publicActor({ ...actor, csrfToken: fresh }),
        }, fresh, secure);
        return;
      }
      if (actor.role !== 'admin') {
        send(res, 403, { error: 'forbidden', reason: 'forbidden', ...publicActor(actor) }, token, secure);
        return;
      }
    }

    let body;
    try {
      body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    } catch (err) {
      const reason = err?.code === 'LIMIT' ? 'limit' : 'invalid';
      send(res, 400, { error: reason, reason, ...publicActor(actor) }, token, secure);
      return;
    }

    try {
      const result = await locked(() => routeRequest({
        method,
        route,
        url,
        body,
        actor,
        met,
        load,
        save,
        now,
      }));
      send(res, result.status, { ...result.body, ...publicActor(actor) }, token, secure);
    } catch (err) {
      const reason = err instanceof UpstreamError ? 'upstream' : 'internal';
      const status = reason === 'upstream' ? 502 : 500;
      send(res, status, { error: reason, reason, ...publicActor(actor) }, token, secure);
    }
  }

  return server;
}

function publicActor(actor) {
  return { access: actor.access, role: actor.role, csrfToken: actor.csrfToken };
}

function normalizeStored(value) {
  const lat = roundCoord(value?.lat);
  const lon = roundCoord(value?.lon);
  const id = Number(value?.id);
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!Number.isInteger(id) || !name || lat == null || lon == null || !inNorway(lat, lon)) return null;
  return {
    id,
    name,
    municipality: typeof value.municipality === 'string' ? value.municipality : '',
    county: typeof value.county === 'string' ? value.county : '',
    lat,
    lon,
  };
}

async function routeRequest({ method, route, url, body, actor, met, load, save, now }) {
  if ((route === '/places' || route === '/place') && actor.role !== 'admin') {
    return { status: 403, body: { error: 'forbidden', reason: 'forbidden' } };
  }
  if (method === 'GET' && route === '/forecast') {
    const loaded = load();
    if (loaded.corrupt) return { status: 500, body: { error: 'internal', reason: 'internal' } };
    if (!loaded.place) return { status: 200, body: { configured: false, place: null, hours: [] } };
    const forecast = await met.forecast(loaded.place.lat, loaded.place.lon);
    const view = forecastFromMet(forecast.body, now(), FORECAST_HOURS);
    return {
      status: 200,
      body: {
        configured: true,
        place: loaded.place,
        current: view.current,
        hours: view.hours,
        updated: new Date(now()).toISOString(),
        attribution: {
          met: 'https://www.met.no/',
          places: 'https://www.kartverket.no/',
        },
      },
    };
  }
  if (method === 'GET' && route === '/places') {
    const payload = await met.search(url.searchParams.get('q') || '');
    return { status: 200, body: { places: placesFromSearch(payload) } };
  }
  if (method === 'PUT' && route === '/place') {
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'invalid', reason: 'invalid' } };
    const payload = await met.place(id);
    const place = placeFromLookup(payload);
    if (!place) return { status: 400, body: { error: 'norway', reason: 'norway' } };
    save(place);
    return { status: 200, body: { place } };
  }
  return { status: 404, body: { error: 'missing', reason: 'missing' } };
}

export function start(options = {}) {
  const server = createServer(options);
  const port = Number(options.port ?? process.env.PORT ?? 3012);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  start().catch(() => {
    process.exitCode = 1;
  });
}
