/**
 * Outbound webhook POST. Credentials are omitted so a household session
 * cookie is never sent to the reward URL. The URL itself is never logged.
 */

function athomHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'webhooks.athom.com' || host === 'webhook.homey.app' || host.endsWith('.connect.athom.com');
  } catch {
    return false;
  }
}

export async function postWebhook(url, payload, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'content-type': 'application/json', accept: '*/*' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Athom answers a successful call with the plain text "ok". A page is
    // often not allowed to read that response. The POST was still delivered,
    // which is the call Postman can read. Do not send it a second time.
    if (typeof document !== 'undefined' && athomHost(url)) return { status: 204, body: '' };
    throw err;
  }
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
