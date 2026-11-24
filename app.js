const $ = (selector) => document.querySelector(selector);
const sources = { discord: 'Discord', supabase: 'Supabase form', instagram: 'Instagram DM (archived)' };
const kinds = {
  major_bug: 'Major bug', minor_bug: 'Minor bug', suggestion: 'Suggestion',
  app_bug: 'App bug', supabase_bug: 'Supabase bug', bug: 'Bug',
  feature: 'Feature request', feedback: 'General feedback', review: 'Needs review', pending: 'Pending', other: 'Other',
};
const reviewLabels = {
  possible_duplicate: 'Possible duplicate', needs_review: 'Ayman review', confirmed_duplicate: 'Duplicate',
};
const views = {
  overview: ['Overview', 'Feedback overview', 'Track incoming reports from Discord and Supabase.', 'Recent feedback'],
  inbox: ['Feedback inbox', 'Feedback inbox', 'Search, review, and resolve feedback from all sources.', 'All feedback'],
  linear: ['Linear issues', 'Linear issues', 'Review feedback that has been sent to your Linear workspace.', 'Linked reports'],
};
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const state = { view: 'overview', page: 1, detail: null, request: 0, filterTimer: null, deliveryTimer: null,
  labelRequest: 0, linearLabels: null, labelError: null, editedLabels: null };
const detail = $('#detail');
const editForm = $('#edit-form');
const destinationLabels = { discord: 'Discord', linear: 'Linear', both: 'Discord and Linear' };
const apiOrigin = document.documentElement.dataset.apiOrigin ?? '';
let sessionToken;

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function showError(selector, message) {
  const target = $(selector);
  target.textContent = message ?? '';
  target.hidden = !message;
}

function showLogin(message) {
  sessionToken = undefined;
  if (detail.open) detail.close();
  state.detail = null;
  $('#detail-body').replaceChildren();
  $('#detail-title').textContent = 'Feedback report';
  $('#detail-id').textContent = '';
  $('#reports').replaceChildren();
  $('#workspace').hidden = true;
  $('#sign-in').hidden = false;
  $('#password').value = '';
  $('#password').focus();
  showError('#login-error', message);
}

async function api(path, method = 'GET', data) {
  const headers = {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch(`${apiOrigin}/dashboard/api/${path}`, {
    method,
    headers,
    credentials: apiOrigin ? 'omit' : 'same-origin',
    redirect: 'error',
    ...(data !== undefined && { body: JSON.stringify(data) }),
  }).catch(() => { throw new Error('Could not connect to the feedback server.'); });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== 'session') showLogin();
    throw new Error(result.error ?? 'The dashboard could not load this request.');
  }
  return result;
}

function linearLink(report) {
  if (!report.linear_identifier || !report.linear_url?.startsWith('https://linear.app/')) return null;
  const link = element('a', report.linear_identifier, 'linear-link');
  link.href = report.linear_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const kindPill = (kind) => element('span', kinds[kind] ?? 'Other', `pill ${kind ?? 'other'}`);
const statusPill = (status, review) => element('span', reviewLabels[review] ?? (status === 'resolved' ? 'Resolved' : 'Open'), `pill ${review ?? status}`);

function renderOverview(data) {
  $('#sign-out').hidden = data.demo;
  $('#mode span').textContent = data.demo ? 'Demo data' : 'Live workspace';
  for (const metric of document.querySelectorAll('[data-metric]')) {
    metric.textContent = data.counts[metric.dataset.metric].toLocaleString();
  }
  const chart = $('#activity-chart');
  const max = Math.max(1, ...data.activity.map((item) => item.total));
  chart.setAttribute('aria-label', data.activity.map((item) => `${item.date}: ${item.total} reports`).join(', '));
  chart.replaceChildren(...data.activity.map((item) => {
    const column = element('div', undefined, 'bar-column');
    const track = element('div', undefined, 'bar-track');
    const bar = element('div', undefined, 'bar');
    bar.style.setProperty('--height', `${item.total / max * 82}%`);
    if (item.total) bar.append(element('span', item.total, 'bar-value'));
    track.append(bar);
    const label = day.format(new Date(item.date));
    column.title = `${label}: ${item.total} reports`;
    column.append(track, element('span', label, 'bar-day'));
    return column;
  }));
  const counts = new Map(data.sources.map((item) => [item.source, item.total]));
  $('#sources').replaceChildren(...Object.entries(sources).filter(([key]) => key !== 'instagram' || counts.has(key)).map(([key, name]) => {
    const button = element('button', undefined, 'source-row');
    const icon = element('span', name[0], `source-icon ${key}`);
    const arrow = element('span', '›', 'source-arrow');
    icon.setAttribute('aria-hidden', 'true');
    arrow.setAttribute('aria-hidden', 'true');
    button.append(icon, element('strong', name),
      element('span', (counts.get(key) ?? 0).toLocaleString(), 'source-count'), arrow);
    button.addEventListener('click', () => setView('inbox', key));
    return button;
  }));
}

function renderReports({ reports, total, page, pageSize }) {
  const first = (page - 1) * pageSize + 1;
  $('#result-count').textContent = `${total.toLocaleString()} ${total === 1 ? 'report' : 'reports'}`;
  $('#page-info').textContent = reports.length ? `Showing ${first}–${first + reports.length - 1} of ${total}` : '0 reports on this page';
  $('#previous').disabled = page <= 1;
  $('#next').disabled = first + reports.length - 1 >= total || !reports.length;
  if (!reports.length) {
    const row = element('tr');
    const cell = element('td', 'No reports found. Try changing the filters.', 'empty');
    cell.colSpan = 6;
    row.append(cell);
    $('#reports').replaceChildren(row);
    return;
  }
  const cell = (content) => {
    const td = element('td');
    td.append(content);
    return td;
  };
  $('#reports').replaceChildren(...reports.map((report) => {
    const row = element('tr');
    const title = report.title ?? report.preview.replace(/\s+/g, ' ');
    const open = element('button', title, 'report-button');
    open.title = title;
    open.addEventListener('click', () => openReport(report.id));
    const reportCell = cell(open);
    reportCell.append(element('span', `#${report.id}`, 'report-id'));
    row.append(reportCell, cell(sources[report.source] ?? report.source), cell(kindPill(report.classification ?? report.kind)),
      cell(statusPill(report.status, report.review_state)), cell(linearLink(report) ?? '—'), cell(date.format(report.created_at)));
    return row;
  }));
}

async function reloadReports() {
  clearTimeout(state.filterTimer);
  const request = ++state.request;
  const params = new URLSearchParams({
    q: $('#search').value,
    source: $('#source-filter').value,
    kind: $('#kind-filter').value,
    status: state.view === 'linear' ? 'linked' : $('#status-filter').value,
    page: state.page,
  });
  showError('#workspace-error');
  try {
    const result = await api(`reports?${params}`);
    if (request !== state.request) return;
    if (!result.reports.length && state.page > 1) {
      state.page = Math.max(1, Math.ceil(result.total / result.pageSize));
      return reloadReports();
    }
    renderReports(result);
  } catch (error) {
    if (request === state.request) showError('#workspace-error', error.message);
  }
}

function setView(view, source = '') {
  state.view = view;
  state.page = 1;
  const [breadcrumb, title, subtitle, inbox] = views[view];
  $('#breadcrumb').textContent = breadcrumb;
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#inbox-title').textContent = inbox;
  $('#overview').hidden = view !== 'overview';
  $('#status-filter').hidden = view === 'linear';
  $('#source-filter').value = source;
  $('#search').value = '';
  $('#kind-filter').value = '';
  $('#status-filter').value = '';
  for (const button of document.querySelectorAll('[data-view]')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  return reloadReports();
}

async function openReport(id) {
  clearTimeout(state.deliveryTimer);
  const labelRequest = ++state.labelRequest;
  state.linearLabels = null;
  state.labelError = null;
  state.editedLabels = null;
  state.detail = null;
  $('#detail-id').textContent = `Feedback #${id}`;
  $('#detail-title').textContent = 'Feedback report';
  $('#detail-body').textContent = 'Loading report…';
  $('#detail-labels').replaceChildren();
  $('#detail-labels').hidden = true;
  $('#detail-status').hidden = true;
  $('#detail-retry').hidden = true;
  $('#detail-edit').hidden = true;
  closeEditor();
  $('#duplicate-form').hidden = true;
  $('#duplicate-form').reset();
  showError('#detail-error');
  showError('#detail-notice');
  if (!detail.open) detail.showModal();
  try {
    const report = await api(`reports/${id}`);
    if (!detail.open || $('#detail-id').textContent !== `Feedback #${id}`) return;
    renderDetail(report);
    if (report.editor?.canEditLabels) void loadLinearLabels(id, labelRequest);
  } catch (error) {
    $('#detail-body').textContent = '';
    showError('#detail-error', error.message);
  }
}

function closeEditor() {
  editForm.hidden = true;
  $('#detail-edit').setAttribute('aria-expanded', 'false');
}

function selectedLabelIds(kind) {
  const { linearLabels, detail: report } = state;
  const defaultId = linearLabels?.defaultLabelIds[kind];
  return report.editor?.labelIds ?? linearLabels?.selectedIds ?? (defaultId ? [defaultId] : []);
}

function labelDot(color) {
  const dot = element('span', undefined, 'linear-label-dot');
  dot.style.backgroundColor = color;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function renderLabelBadges(report) {
  const badges = $('#detail-labels');
  const kind = report.kind ?? report.category;
  const ids = selectedLabelIds(kind);
  const labels = state.linearLabels?.labels.filter(({ id }) => ids.includes(id)) ?? [];
  badges.replaceChildren(...labels.map(({ name, color }) => {
    const badge = element('span', undefined, 'linear-label');
    badge.append(labelDot(color), name);
    return badge;
  }));
  badges.hidden = labels.length === 0;
}

function filterLabelChoices() {
  const search = $('#label-search');
  const query = search.value.trim().toLowerCase();
  const choices = [...$('#label-options').children];
  for (const choice of choices) choice.hidden = !choice.dataset.labelName.toLowerCase().includes(query);
  if (!search.disabled) showError('#label-status', choices.some((choice) => !choice.hidden) ? '' : 'No matching labels.');
}

function renderLabelChoices() {
  $('#edit-labels').hidden = !state.detail.editor?.canEditLabels;
  const labels = state.linearLabels?.labels ?? [];
  const search = $('#label-search');
  search.disabled = labels.length === 0;
  const kind = $('#edit-kind').value;
  const ids = state.editedLabels ?? selectedLabelIds(kind);
  $('#label-options').replaceChildren(...labels.map(({ id, color, name }) => {
    const choice = element('label', undefined, 'linear-label-choice');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = ids.includes(id);
    choice.dataset.labelName = name;
    choice.append(labelDot(color), element('span', name), checkbox);
    return choice;
  }));
  showError('#label-status', state.labelError ?? (!state.linearLabels ? 'Loading labels…' : labels.length ? '' : 'No matching Linear labels are available.'));
  filterLabelChoices();
}

async function loadLinearLabels(id, request) {
  try {
    const labels = await api(`reports/${id}/labels`);
    if (!detail.open || request !== state.labelRequest) return;
    state.linearLabels = labels;
  } catch (error) {
    if (!detail.open || request !== state.labelRequest) return;
    state.labelError = error.message;
  }
  renderLabelBadges(state.detail);
  if (!editForm.hidden) renderLabelChoices();
}

function updateDestinations() {
  const { editor, stage } = state.detail;
  const selected = $('#edit-assignee').value;
  const person = editor.people.find(({ value }) => value === selected);
  const canDiscord = editor.canSend && person?.discord;
  const canLinear = editor.canSend && editor.canSendLinear !== false && $('#edit-kind').value !== 'review' && (!selected || person?.linear);
  const destination = $('#edit-destination');
  destination.querySelector('[value="discord"]').disabled = !canDiscord;
  destination.querySelector('[value="linear"]').disabled = !canLinear;
  destination.querySelector('[value="both"]').disabled = !(canDiscord && canLinear);
  if (destination.selectedOptions[0]?.disabled) destination.value = 'save';
  const sending = destination.value !== 'save';
  $('#edit-save').textContent = sending ? 'Save and send' : 'Save changes';
  $('#edit-summary').required = sending;
  const hint = sending && destination.value !== 'discord' && state.detail.linear_identifier
    ? 'Saving will update the linked Linear issue.'
    : !sending && ['classify', 'linear'].includes(stage)
      ? 'Saving here takes this report out of automatic triage and delivery.'
      : '';
  const missing = editor.canSend && person
    ? [!person.discord && 'a Discord channel', !person.linear && 'a Linear user'].filter(Boolean)
    : [];
  const setupHint = editor.canSend && editor.canSendLinear === false
    ? 'Configure Linear on the bot host to enable ticket delivery.'
    : missing.length ? `${person.label} needs ${missing.join(' and ')} configured for those delivery options.` : '';
  showError('#edit-hint', [hint, setupHint].filter(Boolean).join(' '));
}

function openEditor() {
  const report = state.detail;
  state.editedLabels = null;
  $('#label-search').value = '';
  const owner = $('#edit-assignee');
  owner.replaceChildren(new Option('Unassigned', ''), ...report.editor.people.map(({ label, value }) => new Option(label, value)));
  owner.value = report.editor.owner ?? '';
  $('#edit-title').value = report.title ?? report.message.replace(/\s+/g, ' ').trim().slice(0, 120);
  $('#edit-summary').value = report.summary ?? '';
  $('#edit-message').value = report.message;
  $('#edit-category').value = report.category;
  const kind = $('#edit-kind');
  kind.querySelector('[value="review"]').hidden = report.kind !== 'review';
  const submittedKind = report.category?.trim().toLowerCase();
  kind.value = report.kind ?? (['app_bug', 'supabase_bug', 'bug', 'feature', 'feedback'].includes(submittedKind) ? submittedKind : 'other');
  $('#edit-area').value = report.area ?? '';
  $('#edit-priority').value = report.priority ?? '';
  $('#edit-impact').value = report.impact ?? '';
  $('#edit-status').value = report.status;
  $('#edit-destination').value = 'save';
  updateDestinations();
  renderLabelChoices();
  showError('#detail-error');
  showError('#detail-notice');
  editForm.hidden = false;
  $('#detail-edit').setAttribute('aria-expanded', 'true');
  $('#edit-title').focus();
}

function watchDeliveries(report, pending) {
  clearTimeout(state.deliveryTimer);
  if (!pending) return;
  state.deliveryTimer = setTimeout(async () => {
    if (!detail.open || state.detail !== report) return;
    try {
      const updated = await api(`reports/${report.id}`);
      if (!detail.open || state.detail !== report) return;
      renderDetail(updated);
      if (!updated.editor?.deliveries.some(({ pending }) => pending)) {
        const failed = updated.editor?.deliveries.some(({ error }) => error);
        showError('#detail-notice', failed ? 'Delivery finished with an error. See the destination status above.' : 'Delivery complete.');
        await refresh();
      }
    } catch (error) {
      if (detail.open && state.detail === report) showError('#detail-error', error.message);
    }
  }, 2000);
}

function renderDetail(report) {
  state.detail = report;
  $('#detail-title').textContent = report.title ?? 'Feedback report';
  renderLabelBadges(report);
  const meta = element('div', undefined, 'detail-meta');
  const classification = report.classification ?? report.kind ?? (report.stage ? 'pending' : report.category);
  meta.append(sources[report.source], statusPill(report.status, report.review_state), kindPill(classification), date.format(report.created_at));
  const section = (label, content) => {
    const part = element('section', undefined, 'detail-section');
    const text = element('p', content);
    text.dir = 'auto';
    part.append(element('h3', label), text);
    return part;
  };
  const triage = report.triageLabels;
  const content = [meta];
  if (report.summary) content.push(section('Summary', report.summary));
  if (triage?.decision && (!report.review_state || report.rationale !== report.review_reason)) {
    content.push(section(triage.decision, report.rationale));
  }
  if (triage?.assignee) content.push(section(report.review_state && report.editor?.owner === 'ayman' ? 'Reviewer' : 'Assignee', triage.assignee));
  if (report.requestedAssignee) content.push(section('Requested assignee', report.requestedAssignee));
  if (report.review_state) content.push(section(reviewLabels[report.review_state], report.review_reason));
  if (report.related) {
    const related = section('Related report', report.related.title ?? ('Feedback #' + report.related.id));
    const actions = element('div', undefined, 'duplicate-actions');
    const open = element('button', 'Open feedback #' + report.related.id, 'outline');
    open.addEventListener('click', () => openReport(report.related.id));
    const relatedIssue = linearLink(report.related);
    actions.append(open);
    if (relatedIssue) actions.append(relatedIssue);
    related.append(actions);
    content.push(related);
  }
  if (report.evidence) content.push(section('Evidence from the report', report.evidence));
  if (triage?.impact) content.push(section('Reported impact', triage.impact));
  if (triage?.area || triage?.priority) content.push(section('Routing and priority', [triage.area, triage.priority].filter(Boolean).join(' · ')));
  content.push(section(report.original_message ? 'Report text' : 'Original report', report.message));
  if (report.original_message && report.original_message !== report.message) {
    const original = element('details', undefined, 'detail-section');
    const text = element('p', report.original_message);
    text.dir = 'auto';
    original.append(element('summary', 'Original report'), text);
    content.push(original);
  }
  if (report.category) content.push(section('Submitted as', kinds[report.category] ?? report.category));
  const link = linearLink(report);
  if (link) content.push(link);
  else if (report.stage === 'linear') content.push(section('Linear', report.exhausted ? 'Delivery failed.' : 'Queued for delivery.'));
  else if (report.stage === 'classify') content.push(section('Classification', report.exhausted ? 'Needs staff review.' : 'Queued for classification.'));
  if (report.error) content.push(section('Processing error', report.error));
  for (const { target, recipient, sent_at, pending, error } of report.editor?.deliveries ?? []) {
    const status = pending ? (error ? 'Retrying · ' + error : 'Queued')
      : sent_at ? 'Sent' : 'Failed · ' + error;
    content.push(section(destinationLabels[target] + (recipient ? ' · ' + recipient : ''), status));
  }
  $('#detail-body').replaceChildren(...content);
  $('#detail-status').textContent = report.status === 'open' ? 'Mark resolved' : 'Reopen report';
  $('#detail-status').hidden = false;
  $('#detail-retry').hidden = !report.canRetry;
  if (report.canConfirmDuplicate && $('#duplicate-form').hidden) {
    $('#duplicate-related').value = report.related?.id ?? '';
  }
  $('#duplicate-form').hidden = !report.canConfirmDuplicate;
  const pending = report.editor?.deliveries.some(({ pending }) => pending);
  $('#detail-edit').hidden = !report.editor;
  $('#detail-edit').disabled = Boolean(pending);
  watchDeliveries(report, pending);
}

async function refresh() {
  try {
    renderOverview(await api('overview'));
    await reloadReports();
  } catch (error) {
    showError('#workspace-error', error.message);
  }
}

async function start() {
  const data = await api('overview');
  renderOverview(data);
  $('#sign-in').hidden = true;
  $('#password').value = '';
  $('#workspace').hidden = false;
  await setView('overview');
}

$('#sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const session = await api('session', 'POST', { password: $('#password').value });
    sessionToken = session.token;
    await start();
  } catch (error) {
    showError('#login-error', error.message);
  }
});
$('#sign-out').addEventListener('click', async () => {
  try {
    await api('session', 'DELETE');
    state.request += 1;
    showLogin();
  } catch (error) {
    showError('#workspace-error', error.message);
  }
});
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => setView(button.dataset.view));
}
$('#refresh').addEventListener('click', refresh);
$('#search').addEventListener('input', () => {
  clearTimeout(state.filterTimer);
  state.page = 1;
  state.filterTimer = setTimeout(reloadReports, 180);
});
for (const id of ['#source-filter', '#kind-filter', '#status-filter']) {
  $(id).addEventListener('change', () => {
    state.page = 1;
    reloadReports();
  });
}
$('#previous').addEventListener('click', () => { state.page -= 1; reloadReports(); });
$('#next').addEventListener('click', () => { state.page += 1; reloadReports(); });
$('#detail-close').addEventListener('click', () => detail.close());
detail.addEventListener('close', () => clearTimeout(state.deliveryTimer));
$('#detail-edit').addEventListener('click', () => {
  if (editForm.hidden) openEditor();
  else closeEditor();
});
$('#edit-cancel').addEventListener('click', () => {
  closeEditor();
  $('#detail-edit').focus();
});
for (const selector of ['#edit-assignee', '#edit-kind', '#edit-destination']) {
  $(selector).addEventListener('change', updateDestinations);
}
$('#edit-kind').addEventListener('change', renderLabelChoices);
$('#label-search').addEventListener('input', filterLabelChoices);
$('#label-options').addEventListener('change', () => {
  const ids = [...$('#label-options').querySelectorAll('input:checked')].map(({ value }) => value);
  const original = selectedLabelIds($('#edit-kind').value);
  state.editedLabels = ids.length === original.length && ids.every((id) => original.includes(id)) ? null : ids;
});
async function updateReport(data) {
  const { id } = state.detail;
  const buttons = ['#detail-status', '#detail-retry', '#edit-save', '#detail-duplicate'].map($);
  for (const button of buttons) button.disabled = true;
  showError('#detail-error');
  try {
    const report = await api(`reports/${id}`, 'PATCH', data);
    if (detail.open && state.detail?.id === id) {
      if (data.action === 'edit') {
        closeEditor();
        showError('#detail-notice', data.destination === 'save' ? 'Changes saved.' : 'Queued for ' + destinationLabels[data.destination] + '.');
      }
      renderDetail(report);
    }
    void refresh();
  } catch (error) {
    if (detail.open && state.detail?.id === id) {
      showError('#detail-error', error.message);
      $('#detail-error').scrollIntoView({ block: 'nearest' });
    }
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

$('#detail-status').addEventListener('click', () => {
  updateReport({ status: state.detail.status === 'open' ? 'resolved' : 'open' });
});
$('#detail-retry').addEventListener('click', () => updateReport({ action: 'retry' }));
$('#duplicate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  updateReport({ action: 'confirm_duplicate', relatedId: $('#duplicate-related').valueAsNumber });
});
editForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const report = state.detail;
  const message = $('#edit-message').value;
  updateReport({
    action: 'edit', version: report.editor.version, destination: $('#edit-destination').value,
    title: $('#edit-title').value, summary: $('#edit-summary').value, category: $('#edit-category').value,
    kind: $('#edit-kind').value, area: $('#edit-area').value, priority: $('#edit-priority').value, impact: $('#edit-impact').value,
    assignee: $('#edit-assignee').value, ...(message !== report.message && { message }),
    ...($('#edit-status').value !== report.status && { status: $('#edit-status').value }),
    ...(state.editedLabels !== null && { labelIds: state.editedLabels }),
  });
});

start().catch((error) => {
  if ($('#sign-in').hidden) showLogin(error.message);
});
