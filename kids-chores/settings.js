import { createClient } from './lib/client.js';
import { PROGRESS_ICONS, WEEKDAYS, webhookEvent } from './lib/logic.js';
import { loadMembers } from './lib/members.js';
import {
  STYLE_HREF,
  button,
  ensureStyle,
  errorBody,
  field,
  listen,
  progressMark,
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
    const [chores, members] = await Promise.all([client.chores(signal), loadMembers(signal)]);
    data = chores;
    data.members = members;
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
  congrats.placeholder = tr('page.congrats');
  const webhook = input(settings.webhookUrl || '', 'url');
  webhook.spellcheck = false;
  webhook.autocomplete = 'off';
  const timezone = input(settings.timezone, 'text');
  timezone.autocomplete = 'off';
  const icons = iconPicker(settings.progressIcon);
  const notify = toggleField(tr('settings.notifyAdmin'), settings.notifyAdmin !== false);
  const wall = toggleField(tr('settings.showOnWall'), settings.showOnWall === true);
  const share = toggleField(tr('settings.share'), settings.shareAcrossUsers !== false);
  const follow = followPicker(data);

  form.append(
    field(tr('settings.displayTitle'), title),
    field(tr('settings.pointGoal'), goal),
    field(tr('settings.congrats'), congrats),
    rewardWebhookField(webhook, goal, signal),
    field(tr('settings.timezone'), timezone, tr('hint.midnight')),
    iconField(icons),
    notify.wrap,
    wall.wrap,
    share.wrap,
    hint(tr('settings.shareHint')),
  );
  if (follow) form.append(follow.field);

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
  if (data.role === 'admin' && data.access === 'write') {
    const resetRow = document.createElement('div');
    resetRow.className = 'kc-actions';
    resetRow.append(button(tr('settings.reset'), 'btn', signal, () => { void resetToday(); }));
    form.append(hint(tr('settings.resetHint')), resetRow);
  }

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
        progressIcon: chosenIcon(icons),
        notifyAdmin: notify.input.checked,
        showOnWall: wall.input.checked,
        shareAcrossUsers: share.input.checked,
        ...(follow ? { followingIds: follow.ids() } : {}),
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

  async function resetToday() {
    try {
      await client.resetToday(signal);
      if (stopped(container, signal, token)) return;
      showToast(tr('settings.resetDone'));
      await paint(container, signal, token, null);
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
  const assigned = assignmentLabel(chore, data);
  if (assigned) meta.textContent += ` · ${assigned}`;
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
  const members = memberPicker(chore, data);
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
    members.field,
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
      ...(members.ids ? { assigneeIds: members.ids() } : {}),
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

function iconPicker(selected) {
  const group = document.createElement('div');
  group.className = 'kc-icons';
  group.role = 'radiogroup';
  const current = PROGRESS_ICONS.includes(selected) ? selected : 'sun';
  for (const value of PROGRESS_ICONS) {
    const choice = document.createElement('label');
    choice.className = 'kc-icon-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'kc-progress-icon';
    radio.value = value;
    radio.checked = value === current;
    const caption = document.createElement('span');
    caption.textContent = tr(`icon.${value}`);
    choice.append(radio, progressMark(100, value, 36), caption);
    group.append(choice);
  }
  return group;
}

function iconField(icons) {
  const wrap = field(tr('settings.progressIcon'), icons);
  const label = wrap.querySelector('.form-label');
  label.id = 'kc-progress-icon-label';
  icons.setAttribute('aria-labelledby', label.id);
  return wrap;
}

function chosenIcon(group) {
  const picked = group.querySelector('input:checked');
  return picked ? picked.value : 'sun';
}

function hint(text) {
  const el = document.createElement('p');
  el.className = 'form-hint';
  el.textContent = text;
  return el;
}

/** Reward webhook field with an info panel that shows the Homey JSON shape. */
function rewardWebhookField(webhookInput, goalInput, signal) {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';

  const head = document.createElement('div');
  head.className = 'kc-field-head';
  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = tr('settings.webhook');
  if (!webhookInput.id) webhookInput.id = `kc-${Math.random().toString(36).slice(2, 9)}`;
  label.htmlFor = webhookInput.id;

  const infoBtn = document.createElement('button');
  infoBtn.type = 'button';
  infoBtn.className = 'kc-info-btn';
  infoBtn.setAttribute('aria-label', tr('settings.webhookInfoOpen'));
  infoBtn.setAttribute('aria-expanded', 'false');
  infoBtn.append(infoIcon());

  const panel = document.createElement('div');
  panel.className = 'kc-info-box';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', tr('settings.webhookInfo'));

  const intro = document.createElement('p');
  intro.className = 'kc-info-box__text';
  const reachedLabel = document.createElement('p');
  reachedLabel.className = 'kc-info-box__label';
  reachedLabel.textContent = tr('settings.webhookInfoReached');
  const reachedCode = document.createElement('pre');
  reachedCode.className = 'kc-info-box__code';
  const resetLabel = document.createElement('p');
  resetLabel.className = 'kc-info-box__label';
  resetLabel.textContent = tr('settings.webhookInfoReset');
  const resetCode = document.createElement('pre');
  resetCode.className = 'kc-info-box__code';
  panel.append(intro, reachedLabel, reachedCode, resetLabel, resetCode);

  function refresh() {
    const event = webhookEvent(webhookInput.value.trim(), '') || 'event_name';
    const points = strictInt(goalInput.value);
    const earned = points != null && points >= 0 ? points : 35;
    intro.textContent = tr('settings.webhookInfoIntro');
    reachedCode.textContent = JSON.stringify({
      event,
      state: 'yes',
      done: true,
      points: earned,
    }, null, 2);
    resetCode.textContent = JSON.stringify({
      event,
      state: 'no',
      done: false,
      points: 0,
    }, null, 2);
  }

  listen(infoBtn, 'click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    infoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    infoBtn.setAttribute(
      'aria-label',
      open ? tr('settings.webhookInfoClose') : tr('settings.webhookInfoOpen'),
    );
    if (open) refresh();
  }, signal);
  listen(webhookInput, 'input', () => {
    if (!panel.hidden) refresh();
  }, signal);
  listen(goalInput, 'input', () => {
    if (!panel.hidden) refresh();
  }, signal);

  head.append(label, infoBtn);
  wrap.append(head, webhookInput, panel);
  return wrap;
}

function infoIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.75');
  const stem = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  stem.setAttribute('d', 'M12 11v6');
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', 'currentColor');
  stem.setAttribute('stroke-width', '1.75');
  stem.setAttribute('stroke-linecap', 'round');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '7.5');
  dot.setAttribute('r', '1.15');
  dot.setAttribute('fill', 'currentColor');
  svg.append(circle, stem, dot);
  return svg;
}

function assignmentLabel(chore, data) {
  if (data.settings?.shareAcrossUsers === false) return '';
  if (chore?.assigneeIds == null) return tr('chores.forEveryone');
  if (!chore.assigneeIds.length) return tr('chores.generic');
  const members = Array.isArray(data.members) ? data.members : [];
  const ids = new Set(chore.assigneeIds.map(String));
  const names = members.filter((member) => ids.has(member.id)).map((member) => member.name);
  if (!names.length) return tr('chores.unassigned');
  return tr('chores.forNames', { names: names.join(', ') });
}

function followPicker(data) {
  if (data.settings?.shareAcrossUsers === false) return null;
  const members = Array.isArray(data.members) ? data.members : [];
  if (!members.length) return null;
  const selected = new Set((data.followingIds || []).map(String));
  const box = document.createElement('div');
  box.className = 'kc-members';
  const inputs = members.map((member) => {
    const label = document.createElement('label');
    label.className = 'kc-member kc-follow';
    const inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    inputEl.checked = selected.has(member.id);
    const text = document.createElement('span');
    text.textContent = member.name;
    label.append(inputEl, text);
    box.append(label);
    return { member, inputEl };
  });
  return {
    field: field(tr('settings.follow'), box, tr('settings.followHint')),
    ids() {
      return inputs.filter((row) => row.inputEl.checked).map((row) => row.member.id);
    },
  };
}

function memberPicker(chore, data) {
  if (data.settings?.shareAcrossUsers === false) {
    return { field: hint(tr('settings.shareOff')), ids: null };
  }
  const members = Array.isArray(data.members) ? data.members : [];
  if (!members.length) return { field: hint(tr('chores.membersMissing')), ids: null };
  const explicit = Array.isArray(chore?.assigneeIds);
  const assigned = new Set(explicit ? chore.assigneeIds.map(String) : []);
  const excluded = new Set((chore?.excludedMemberIds || []).map(String));
  const box = document.createElement('div');
  box.className = 'kc-members';
  const everyone = document.createElement('label');
  everyone.className = 'kc-member kc-everyone';
  const everyoneInput = document.createElement('input');
  everyoneInput.type = 'checkbox';
  const everyoneText = document.createElement('span');
  everyoneText.textContent = tr('chores.everyone');
  everyone.append(everyoneInput, everyoneText);
  box.append(everyone);
  const inputs = members.map((member) => {
    const label = document.createElement('label');
    label.className = 'kc-member kc-assignee';
    const inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    if (!chore) inputEl.checked = false;
    else if (explicit) inputEl.checked = assigned.has(member.id);
    else inputEl.checked = !excluded.has(member.id);
    const text = document.createElement('span');
    text.textContent = member.name;
    label.append(inputEl, text);
    box.append(label);
    return { member, inputEl };
  });
  const syncAll = () => {
    everyoneInput.checked = inputs.length > 0 && inputs.every((row) => row.inputEl.checked);
  };
  everyoneInput.addEventListener('change', () => {
    for (const row of inputs) row.inputEl.checked = everyoneInput.checked;
  });
  for (const row of inputs) row.inputEl.addEventListener('change', syncAll);
  syncAll();
  return {
    field: field(tr('chores.field.for'), box, tr('chores.forHint')),
    ids() {
      return inputs.filter((row) => row.inputEl.checked).map((row) => row.member.id);
    },
  };
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
