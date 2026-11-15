/**
 * Outbound webhook POST. Credentials are omitted so a household session
 * cookie is never sent to the reward URL. The URL itself is never logged.
 */

import { isAthomWebhook } from './logic.js';

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
    if (isAthomWebhook(url)) return { status: 204, body: '' };
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
