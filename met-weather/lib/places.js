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

function coord(value) {
  if (value == null || value === '') return null;
  return roundCoord(value);
}

function namedPlace(lat, lon, nameSource) {
  if (lat == null || lon == null || !inNorway(lat, lon)) return null;
  const name = typeof nameSource === 'string' ? nameSource.trim() : '';
  return { id: null, name, municipality: '', county: '', lat, lon };
}

/**
 * The place Yuvomi would actually forecast.
 * OpenWeatherMap ignores coordinates, so that provider is not a place here.
 * A member's own point wins, then the household point, then the server default.
 */
export function placeFromPreferences(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const reported = settings.weather_source && typeof settings.weather_source === 'object' ? settings.weather_source : null;
  if (settings.weather_provider === 'openweathermap' || reported?.provider === 'openweathermap') return null;
  const personal = settings.weather_user && typeof settings.weather_user === 'object' ? settings.weather_user : null;
  const personalLat = coord(personal?.lat);
  const personalLon = coord(personal?.lon);
  if (personalLat != null && personalLon != null) return namedPlace(personalLat, personalLon, personal.city);
  const household = namedPlace(coord(settings.weather_lat), coord(settings.weather_lon), settings.weather_city);
  if (household) return household;
  if (reported?.provider !== 'open-meteo') return null;
  return namedPlace(coord(reported.lat), coord(reported.lon), reported.city);
}

/** Open-Meteo geocoding hits, kept only when the country is Norway. */
export function placesFromGeocode(results) {
  const hits = Array.isArray(results) ? results : [];
  const places = [];
  const seen = new Set();
  for (const hit of hits) {
    if (hit?.country_code !== 'NO') continue;
    const lat = coord(hit.latitude);
    const lon = coord(hit.longitude);
    const name = typeof hit.name === 'string' ? hit.name.trim() : '';
    if (!name || lat == null || lon == null || !inNorway(lat, lon)) continue;
    const key = `${name}|${lat}|${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      id: null,
      name,
      municipality: typeof hit.admin2 === 'string' ? hit.admin2 : '',
      county: shortCounty(typeof hit.admin1 === 'string' ? hit.admin1 : ''),
      lat,
      lon,
    });
    if (places.length >= 8) break;
  }
  return places;
}

/** A place the page is allowed to store: named, and inside Norway. */
export function placeRecord(value) {
  const lat = coord(value?.lat);
  const lon = coord(value?.lon);
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || lat == null || lon == null || !inNorway(lat, lon)) return null;
  const id = Number(value.id);
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    name,
    municipality: typeof value.municipality === 'string' ? value.municipality : '',
    county: typeof value.county === 'string' ? value.county : '',
    lat,
    lon,
  };
}
