/**
 * Norwegian place names from Kartverket's stedsnavn register.
 * A saved place is always one of those records, resolved again on the server.
 */

import { inNorway, roundCoord } from './forecast.js';

export function shortCounty(name) {
  return String(name || '').split(' - ')[0].trim();
}

function preferredName(hit) {
  if (typeof hit?.skrivemåte === 'string' && hit.skrivemåte.trim()) return hit.skrivemåte.trim();
  const names = Array.isArray(hit?.stedsnavn) ? hit.stedsnavn : [];
  const norwegian = names.find((item) => item?.språk === 'Norsk' && item?.skrivemåtestatus === 'godkjent og prioritert')
    || names.find((item) => item?.språk === 'Norsk')
    || names[0];
  return typeof norwegian?.skrivemåte === 'string' ? norwegian.skrivemåte.trim() : '';
}

export function normalizePlace(hit) {
  const lat = roundCoord(hit?.representasjonspunkt?.nord);
  const lon = roundCoord(hit?.representasjonspunkt?.øst);
  const id = Number(hit?.stedsnummer);
  const name = preferredName(hit);
  if (!Number.isInteger(id) || id <= 0 || !name || lat == null || lon == null || !inNorway(lat, lon)) {
    return null;
  }
  return {
    id,
    name,
    municipality: String(hit?.kommuner?.[0]?.kommunenavn || '').trim(),
    county: shortCounty(hit?.fylker?.[0]?.fylkesnavn || ''),
    lat,
    lon,
  };
}

export function placesFromSearch(payload) {
  const hits = Array.isArray(payload?.navn) ? payload.navn : [];
  const places = [];
  const seen = new Set();
  for (const hit of hits) {
    const place = normalizePlace(hit);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    places.push(place);
    if (places.length >= 8) break;
  }
  return places;
}

export function placeFromLookup(payload) {
  const hits = Array.isArray(payload?.navn) ? payload.navn : [];
  return normalizePlace(hits[0]);
}
