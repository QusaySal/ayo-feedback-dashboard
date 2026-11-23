const $ = (selector) => document.querySelector(selector);
const sources = { discord: 'Discord', instagram: 'Instagram DM', supabase: 'Supabase form' };
const kinds = {
  app_bug: 'App bug', supabase_bug: 'Supabase bug', bug: 'Bug',
  feature: 'Feature request', feedback: 'General feedback', review: 'Needs review', pending: 'Pending', other: 'Other',
};
const views = {
  overview: ['Overview', 'Feedback overview', 'Track incoming reports from Discord, Instagram, and Supabase.', 'Recent feedback'],
  inbox: ['Feedback inbox', 'Feedback inbox', 'Search, review, and resolve feedback from all sources.', 'All feedback'],
  linear: ['Linear issues', 'Linear issues', 'Review feedback that has been sent to your Linear workspace.', 'Linked reports'],
};
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const state = { view: 'overview', page: 1, detail: null, request: 0, filterTimer: null };
const detail = $('#detail');
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
const statusPill = (status) => element('span', status === 'resolved' ? 'Resolved' : 'Open', `pill ${status}`);

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
    const bar = element('div', item.total || '', 'bar');
    bar.style.setProperty('--height', `${item.total / max * 76}%`);
    const label = day.format(new Date(item.date));
    column.title = `${label}: ${item.total} reports`;
    column.append(bar, element('span', label, 'bar-day'));
    return column;
  }));
  const counts = new Map(data.sources.map((item) => [item.source, item.total]));
  $('#sources').replaceChildren(...Object.entries(sources).map(([key, name]) => {
    const button = element('button', undefined, 'source-row');
    button.append(element('span', name[0], `source-icon ${key}`), element('strong', name),
      element('span', (counts.get(key) ?? 0).toLocaleString(), 'source-count'));
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
    row.append(reportCell, cell(sources[report.source] ?? report.source), cell(kindPill(report.kind)),
      cell(statusPill(report.status)), cell(linearLink(report) ?? '—'), cell(date.format(report.created_at)));
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
  state.detail = null;
  $('#detail-id').textContent = `Feedback #${id}`;
  $('#detail-title').textContent = 'Feedback report';
  $('#detail-body').textContent = 'Loading report…';
  $('#detail-status').hidden = true;
  showError('#detail-error');
  if (!detail.open) detail.showModal();
  try {
    const report = await api(`reports/${id}`);
    if (!detail.open || $('#detail-id').textContent !== `Feedback #${id}`) return;
    renderDetail(report);
  } catch (error) {
    $('#detail-body').textContent = '';
    showError('#detail-error', error.message);
  }
}

function renderDetail(report) {
  state.detail = report;
  $('#detail-title').textContent = report.title ?? 'Feedback report';
  const meta = element('div', undefined, 'detail-meta');
  meta.append(sources[report.source], statusPill(report.status), kindPill(report.kind ?? (report.stage ? 'pending' : report.category)), date.format(report.created_at));
  const section = (label, content) => {
    const part = element('section', undefined, 'detail-section');
    part.append(element('h3', label), element('p', content));
    return part;
  };
  const content = [meta];
  if (report.summary) content.push(section('Summary', report.summary));
  content.push(section('Original report', report.message));
  if (report.category) content.push(section('Submitted as', kinds[report.category] ?? report.category));
  const link = linearLink(report);
  if (link) content.push(link);
  else if (report.stage === 'linear') content.push(section('Linear', report.exhausted ? 'Delivery failed. Retry from Discord with /feedback triage.' : 'Queued for delivery.'));
  else if (report.stage === 'classify' && report.exhausted) content.push(section('Classification', 'Processing failed. Retry from Discord with /feedback triage.'));
  $('#detail-body').replaceChildren(...content);
  $('#detail-status').textContent = report.status === 'open' ? 'Mark resolved' : 'Reopen report';
  $('#detail-status').hidden = false;
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
$('#detail-status').addEventListener('click', async () => {
  const button = $('#detail-status');
  button.disabled = true;
  showError('#detail-error');
  try {
    const { id, status } = state.detail;
    const report = await api(`reports/${id}`, 'PATCH', { status: status === 'open' ? 'resolved' : 'open' });
    if (detail.open && state.detail?.id === id) renderDetail(report);
    await refresh();
  } catch (error) {
    showError('#detail-error', error.message);
  } finally {
    button.disabled = false;
  }
});

start().catch((error) => {
  if ($('#sign-in').hidden) showLogin(error.message);
});
