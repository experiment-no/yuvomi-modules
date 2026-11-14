import { createClient } from './lib/client.js';
import { WEEKDAYS } from './lib/logic.js';
import {
  STYLE_HREF,
  button,
  ensureStyle,
  errorBody,
  field,
  listen,
  showEmpty,
  showToast,
  toggleField,
  tr,
} from './lib/ui.js';

const client = createClient();

export async function render(container, context = {}) {
  const { section, signal } = context;
  if (section !== 'household') {
    container.replaceChildren();
    return;
  }
  await ensureStyle(STYLE_HREF);
  if (signal?.aborted) return;
  const token = {};
  container._kcToken = token;
  await paint(container, signal, token, null);
}

async function paint(container, signal, token, editing) {
  if (stopped(container, signal, token)) return;
  let data;
  try {
    data = await client.chores(signal);
  } catch (err) {
    if (stopped(container, signal, token) || err?.name === 'AbortError') return;
    await showEmpty(container, {
      variant: 'error',
      title: tr('error.loadTitle'),
      description: errorBody(err),
      action: {
        label: tr('error.retry'),
        onClick: () => { void paint(container, signal, token, editing); },
      },
    });
    return;
  }
  if (stopped(container, signal, token)) return;
  draw(container, data, signal, token, editing);
}

function draw(container, data, signal, token, editing) {
  const root = document.createElement('div');
  root.className = 'kc-settings';
  const heading = document.createElement('h2');
  heading.className = 'kc-settings__title';
  heading.textContent = tr('settings.title');
  root.append(heading);

  if (data.local) {
    const local = document.createElement('p');
    local.className = 'form-hint';
    local.textContent = tr('hint.local');
    root.append(local);
  }

  root.append(settingsForm(data, signal, token, container));
  root.append(choreSection(data, signal, token, container, editing));
  container.replaceChildren(root);
}

function settingsForm(data, signal, token, container) {
  const form = document.createElement('form');
  form.className = 'kc-form';
  const settings = data.settings;

  const title = input(settings.displayTitle, 'text');
  const goal = input(String(settings.pointGoal), 'text');
  goal.inputMode = 'numeric';
  const congrats = input(settings.congratsMessage, 'text');
  const webhook = input(settings.webhookUrl || '', 'url');
  webhook.spellcheck = false;
  webhook.autocomplete = 'off';
  const timezone = input(settings.timezone, 'text');
  timezone.autocomplete = 'off';
  const icon = document.createElement('select');
  icon.className = 'form-input';
  for (const value of ['sun', 'star']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = tr(`icon.${value}`);
    option.selected = settings.progressIcon === value;
    icon.append(option);
  }
  const notify = toggleField(tr('settings.notifyAdmin'), settings.notifyAdmin !== false);
  const wall = toggleField(tr('settings.showOnWall'), settings.showOnWall === true);

  form.append(
    field(tr('settings.displayTitle'), title),
    field(tr('settings.pointGoal'), goal),
    field(tr('settings.congrats'), congrats),
    field(tr('settings.webhook'), webhook),
    field(tr('settings.timezone'), timezone, tr('hint.midnight')),
    field(tr('settings.progressIcon'), icon),
    notify.wrap,
    wall.wrap,
  );

  const actions = document.createElement('div');
  actions.className = 'kc-actions';
  const status = document.createElement('p');
  status.className = 'form-hint';
  status.hidden = true;
  actions.append(
    button(tr('settings.save'), 'btn btn--primary', signal, (event) => {
      event.preventDefault();
      void saveSettings();
    }),
    button(tr('settings.testYes'), 'btn', signal, () => { void test('yes'); }),
    button(tr('settings.testNo'), 'btn', signal, () => { void test('no'); }),
  );
  form.append(actions, status);

  listen(form, 'submit', (event) => {
    event.preventDefault();
    void saveSettings();
  }, signal);

  async function saveSettings() {
    const pointGoal = strictInt(goal.value);
    if (pointGoal == null || pointGoal > 1000000) {
      showToast(tr('reasons.invalid'), 'error');
      return;
    }
    try {
      const saved = await client.saveSettings({
        displayTitle: title.value,
        pointGoal,
        congratsMessage: congrats.value,
        timezone: timezone.value.trim(),
        progressIcon: icon.value,
        notifyAdmin: notify.input.checked,
        showOnWall: wall.input.checked,
        webhookUrl: webhook.value,
      }, signal);
      if (stopped(container, signal, token)) return;
      showToast(tr('settings.saved'));
      await paint(container, signal, token, null);
      if (saved?.local) status.hidden = true;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showToast(errorBody(err), 'error');
    }
  }

  async function test(state) {
    try {
      const result = await client.testWebhook(state, signal);
      if (stopped(container, signal, token)) return;
      if (result?.needsService || result?.local) {
        status.hidden = false;
        status.textContent = tr('hint.testNeedsService');
        return;
      }
      status.hidden = false;
      status.textContent = tr('settings.tested');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      status.hidden = false;
      status.textContent = errorBody(err);
    }
  }

  return form;
}

function choreSection(data, signal, token, container, editing) {
  const section = document.createElement('section');
  section.className = 'kc-chores';
  const head = document.createElement('div');
  head.className = 'kc-chores__head';
  const title = document.createElement('h3');
  title.textContent = tr('chores.title');
  head.append(
    title,
    button(tr('chores.add'), 'btn', signal, () => {
      draw(container, data, signal, token, { mode: 'create' });
    }),
  );
  section.append(head);

  if (!data.chores.length && editing?.mode !== 'create') {
    const empty = document.createElement('p');
    empty.className = 'form-hint';
    empty.textContent = tr('chores.empty');
    section.append(empty);
  }

  const list = document.createElement('div');
  list.className = 'kc-rows';
  data.chores.forEach((chore, index) => {
    list.append(choreRow(chore, index, data.chores.length, data, signal, token, container));
  });
  section.append(list);
  void bindSortable(list, data, signal, token, container);

  if (editing?.mode === 'create' || editing?.mode === 'edit') {
    const current = editing.mode === 'edit'
      ? data.chores.find((chore) => chore.id === editing.id)
      : null;
    if (editing.mode === 'edit' && !current) return section;
    section.append(editor(current, data, signal, token, container));
  }
  return section;
}

function choreRow(chore, index, total, data, signal, token, container) {
  const row = document.createElement('div');
  row.className = 'kc-row';
  row.dataset.id = chore.id;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'kc-handle';
  handle.tabIndex = -1;
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⋮⋮';

  const main = document.createElement('div');
  main.className = 'kc-row__main';
  const name = document.createElement('span');
  name.className = 'kc-row__title';
  name.textContent = chore.title;
  const meta = document.createElement('span');
  meta.className = 'kc-row__meta';
  meta.textContent = `${tr('chores.points', { points: chore.points })} · ${dayNames(chore.days)}`;
  main.append(name, meta);
  if (chore.requireAboveDone || chore.webhookUrl || chore.resetWebhookUrl) {
    const badges = document.createElement('span');
    badges.className = 'kc-row__badges';
    if (chore.requireAboveDone) badges.append(badge(tr('chores.waits')));
    if (chore.webhookUrl || chore.resetWebhookUrl) badges.append(badge(tr('chores.hasWebhook')));
    main.append(badges);
  }

  const moves = document.createElement('div');
  moves.className = 'kc-row__moves';
  moves.append(
    button(tr('chores.moveUp'), 'btn', signal, () => {
      if (index === 0) return;
      const ids = data.chores.map((item) => item.id);
      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
      void reorder(ids);
    }),
    button(tr('chores.moveDown'), 'btn', signal, () => {
      if (index === total - 1) return;
      const ids = data.chores.map((item) => item.id);
      [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
      void reorder(ids);
    }),
  );
  const up = moves.firstChild;
  const down = moves.lastChild;
  if (index === 0) up.disabled = true;
  if (index === total - 1) down.disabled = true;

  const actions = document.createElement('div');
  actions.className = 'kc-row__actions';
  actions.append(
    button(tr('chores.edit'), 'btn', signal, () => {
      draw(container, data, signal, token, { mode: 'edit', id: chore.id });
    }),
    button(tr('chores.delete'), 'btn', signal, () => { void remove(chore); }),
  );

  row.append(handle, main, moves, actions);

  async function reorder(ids) {
    try {
      await client.reorder(ids, signal);
      if (!stopped(container, signal, token)) await paint(container, signal, token, null);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(errorBody(err), 'error');
    }
  }

  async function remove(item) {
    if (!window.confirm(tr('chores.deleteConfirm', { title: item.title }))) return;
    try {
      await client.deleteChore(item.id, signal);
      if (!stopped(container, signal, token)) await paint(container, signal, token, null);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(errorBody(err), 'error');
    }
  }

  return row;
}

function editor(chore, data, signal, token, container) {
  const form = document.createElement('form');
  form.className = 'kc-form kc-editor';
  const title = input(chore?.title || '', 'text');
  title.maxLength = 80;
  title.required = true;
  const points = input(chore ? String(chore.points) : '1', 'text');
  points.inputMode = 'numeric';
  const days = new Set(chore?.days || [1, 2, 3, 4, 5]);
  const dayBox = document.createElement('div');
  dayBox.className = 'kc-days';
  const dayInputs = WEEKDAYS.map((day) => {
    const label = document.createElement('label');
    label.className = 'kc-day';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = days.has(day);
    const text = document.createElement('span');
    text.textContent = tr(`days.${day}`);
    label.append(box, text);
    dayBox.append(label);
    return box;
  });
  const active = toggleField(tr('chores.field.active'), chore ? chore.active !== false : true);
  const above = toggleField(tr('chores.field.requireAbove'), chore?.requireAboveDone === true);
  const webhook = input(chore?.webhookUrl || '', 'url');
  const reset = input(chore?.resetWebhookUrl || '', 'url');
  for (const el of [webhook, reset]) {
    el.spellcheck = false;
    el.autocomplete = 'off';
  }

  form.append(
    field(tr('chores.field.title'), title),
    field(tr('chores.field.points'), points),
    field(tr('chores.field.days'), dayBox),
    active.wrap,
    above.wrap,
    field(tr('chores.field.webhook'), webhook),
    field(tr('chores.field.resetWebhook'), reset),
  );

  const actions = document.createElement('div');
  actions.className = 'kc-actions';
  actions.append(
    button(tr('chores.save'), 'btn btn--primary', signal, (event) => {
      event.preventDefault();
      void save();
    }),
    button(tr('chores.cancel'), 'btn', signal, () => {
      draw(container, data, signal, token, null);
    }),
  );
  form.append(actions);
  listen(form, 'submit', (event) => {
    event.preventDefault();
    void save();
  }, signal);

  async function save() {
    const value = strictInt(points.value);
    if (!title.value.trim() || title.value.trim().length > 80 || value == null || value > 1000) {
      showToast(tr('reasons.invalid'), 'error');
      return;
    }
    const body = {
      title: title.value,
      points: value,
      days: WEEKDAYS.filter((_, index) => dayInputs[index].checked),
      active: active.input.checked,
      requireAboveDone: above.input.checked,
      webhookUrl: webhook.value,
      resetWebhookUrl: reset.value,
    };
    try {
      if (chore) await client.updateChore(chore.id, body, signal);
      else await client.createChore(body, signal);
      if (!stopped(container, signal, token)) await paint(container, signal, token, null);
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(errorBody(err), 'error');
    }
  }

  return form;
}

async function bindSortable(list, data, signal, token, container) {
  if (signal?.aborted || list.children.length < 2) return;
  try {
    const mod = await import('/utils/sortable.js');
    if (typeof mod.makeSortable !== 'function' || signal?.aborted) return;
    await mod.makeSortable(list, {
      handle: '.kc-handle',
      draggable: '.kc-row',
      onEnd: () => {
        const ids = [...list.querySelectorAll('.kc-row')].map((row) => row.dataset.id);
        const current = data.chores.map((chore) => chore.id);
        if (ids.join() === current.join()) return;
        void client.reorder(ids, signal)
          .then(() => {
            if (!stopped(container, signal, token)) return paint(container, signal, token, null);
            return null;
          })
          .catch((err) => {
            if (err?.name !== 'AbortError') showToast(errorBody(err), 'error');
          });
      },
    });
  } catch {
    // The up and down buttons stay available when the helper cannot load.
  }
}

function badge(text) {
  const el = document.createElement('span');
  el.className = 'kc-badge';
  el.textContent = text;
  return el;
}

function dayNames(days) {
  return (days || []).map((day) => tr(`days.${day}`)).join(' ');
}

function input(value, type) {
  const el = document.createElement('input');
  el.className = 'form-input';
  el.type = type;
  el.value = value;
  return el;
}

function strictInt(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function stopped(container, signal, token) {
  return signal?.aborted || container._kcToken !== token;
}
