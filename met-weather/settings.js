import { weatherApi } from './browser.js';
import {
  ensureStyle,
  errorBody,
  listen,
  showEmpty,
  stopped,
  tr,
} from './lib/ui.js';

const ACCENT = '#0369A1';

export async function render(container, context = {}) {
  const { section, signal } = context;
  if (section !== 'household') {
    container.replaceChildren();
    return;
  }
  await ensureStyle();
  if (signal?.aborted) return;
  const token = {};
  container._mwToken = token;
  container.style.setProperty('--widget-accent', ACCENT);
  await paint(container, signal, token);
}

async function paint(container, signal, token) {
  if (stopped(container, signal, token)) return;
  let data;
  try {
    data = await weatherApi('forecast', { signal });
  } catch (err) {
    if (stopped(container, signal, token) || err?.name === 'AbortError') return;
    await showEmpty(container, {
      variant: 'error',
      title: tr('error.loadTitle'),
      description: errorBody(err),
      action: { label: tr('error.retry'), onClick: () => { void paint(container, signal, token); } },
    });
    return;
  }
  if (stopped(container, signal, token)) return;
  draw(container, data, signal, token);
}

function draw(container, data, signal, token) {
  const root = document.createElement('div');
  root.className = 'mw-settings';
  const heading = document.createElement('h2');
  heading.className = 'page-toolbar__title';
  heading.textContent = tr('settings.title');
  const current = document.createElement('p');
  current.className = 'mw-place';
  current.textContent = data.configured
    ? `${tr('settings.current')}: ${[data.place.name, data.place.county].filter(Boolean).join(' · ')}`
    : tr('page.placeMissing');
  const form = document.createElement('form');
  form.className = 'mw-form';
  const label = document.createElement('label');
  label.htmlFor = 'mw-place-search';
  label.textContent = tr('settings.search');
  const input = document.createElement('input');
  input.id = 'mw-place-search';
  input.type = 'search';
  input.className = 'input';
  input.autocomplete = 'off';
  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = tr('settings.searchHint');
  const results = document.createElement('div');
  results.className = 'mw-results';
  const status = document.createElement('p');
  status.className = 'form-hint mw-status';
  form.append(label, input, hint, results, status);
  root.append(heading, current, form);
  container.replaceChildren(root);

  let timer = 0;
  listen(input, 'input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void search(input.value, results, status, signal, token, container); }, 250);
  }, signal);
  listen(form, 'submit', (event) => {
    event.preventDefault();
    void search(input.value, results, status, signal, token, container);
  }, signal);
}

async function search(query, results, status, signal, token, container) {
  const text = query.trim();
  results.replaceChildren();
  if (text.length < 2) {
    status.textContent = '';
    return;
  }
  status.textContent = tr('settings.searching');
  try {
    const data = await weatherApi('places', { query: text, signal });
    if (stopped(container, signal, token)) return;
    status.textContent = data.places?.length ? '' : tr('settings.empty');
    for (const place of data.places || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mw-result';
      const name = document.createElement('span');
      name.textContent = place.name;
      const where = document.createElement('span');
      where.textContent = [place.municipality, place.county].filter(Boolean).join(' · ');
      button.append(name, where);
      listen(button, 'click', () => {
        void choose(place.id, status, signal, token, container);
      }, signal);
      results.append(button);
    }
  } catch (err) {
    if (err?.name === 'AbortError' || stopped(container, signal, token)) return;
    status.textContent = errorBody(err);
  }
}

async function choose(id, status, signal, token, container) {
  status.textContent = tr('settings.saving');
  try {
    await weatherApi('place', { id, signal });
    if (stopped(container, signal, token)) return;
    status.textContent = tr('settings.saved');
    await paint(container, signal, token);
  } catch (err) {
    if (err?.name === 'AbortError' || stopped(container, signal, token)) return;
    status.textContent = errorBody(err);
  }
}
