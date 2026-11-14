/**
 * Outbound webhook POST. Credentials are omitted so a household session
 * cookie is never sent to the reward URL. The URL itself is never logged.
 */

export async function postWebhook(url, payload, signal) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
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
