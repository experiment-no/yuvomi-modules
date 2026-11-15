/**
 * Outbound webhook POST. Credentials are omitted so a household session
 * cookie is never sent to the reward URL. The URL itself is never logged.
 *
 * This runs in the sidecar, where the call can leave the machine. The page
 * itself is not allowed to call another site, so the browser fallback does
 * not treat a blocked fetch as a delivered Homey trigger.
 */

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
