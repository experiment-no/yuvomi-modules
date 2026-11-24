/**
 * Outbound webhook POST. Credentials are omitted so a household session
 * cookie is never sent to the reward URL. The URL itself is never logged.
 *
 * This runs in the sidecar, where the call can leave the machine. The page
 * is not allowed to fetch another site. A member check-off posts the same
 * JSON with a form instead. `plainFormBody` is that form body: the original
 * fields keep their types, and the extra `_` key is only how a form encodes
 * one raw JSON object.
 */

export function plainFormBody(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let json;
  try {
    json = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (!json.endsWith('}')) return null;
  const name = `${json.slice(0, -1)},"_":"`;
  const value = '"}';
  const body = `${name}=${value}\r\n`;
  let parsed;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  for (const key of Object.keys(payload)) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(payload[key])) return null;
  }
  return { name, value, body };
}

export async function postWebhook(url, payload, signal) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'follow',
    headers: { 'content-type': 'application/json', accept: '*/*' },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await response.text();
  let body = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}
