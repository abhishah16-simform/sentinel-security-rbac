// Audit Log page in the Tenant Admin console: search the Active Tenant's log and verify its hash chain.
(function () {
  const message = document.getElementById('message');
  const filters = document.getElementById('filters');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  let nextCursor = null;
  let lastQuery = '';
  let shown = 0;

  function block(title, text, showLink) {
    document.getElementById('loading').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked-link').hidden = !showLink;
    document.getElementById('blocked').hidden = false;
  }

  // datetime-local values are local wall-clock minutes. "To" includes its whole minute, and the
  // API's "to" is exclusive, so it is sent as the start of the next minute.
  function toIso(value, endOfMinute) {
    if (!value) return null;
    const date = new Date(value);
    if (endOfMinute) date.setMinutes(date.getMinutes() + 1);
    return date.toISOString();
  }

  // The current filters as a query string, without a cursor.
  function filterQuery() {
    const data = new FormData(filters);
    const params = new URLSearchParams();
    const from = toIso(data.get('from'), false);
    const to = toIso(data.get('to'), true);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    ['user', 'eventType', 'applicationId'].forEach(function (name) {
      const value = String(data.get(name) || '').trim();
      if (value) params.set(name, value);
    });
    return params.toString();
  }

  function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
  }

  // A User as a button that filters the log to them.
  function userButton(user) {
    const label = user.name || user.email || user.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.textContent = label;
    button.title = (user.email || 'Deleted User') + ' · ' + user.id + ' (click to filter)';
    button.addEventListener('click', function () {
      filters.elements.user.value = user.email || user.id;
      search();
    });
    return button;
  }

  function targetContent(target) {
    if (!target) return '–';
    if (target.user) return userButton(target.user);
    const span = document.createElement('span');
    span.className = 'mono';
    span.textContent = target.type + ' ' + target.id.slice(0, 8);
    span.title = target.type + ' ' + target.id;
    return span;
  }

  function details(event) {
    const entries = Object.entries(event.payload || {});
    if (event.applicationId) entries.unshift(['application', event.applicationId]);
    if (entries.length === 0) return '–';
    const span = document.createElement('span');
    span.className = 'details';
    span.textContent = entries
      .map(function (entry) {
        return entry[0] + ': ' + (entry[1] === null ? '–' : String(entry[1]));
      })
      .join(' · ');
    return span;
  }

  function eventRow(event) {
    const tr = document.createElement('tr');
    const time = document.createElement('time');
    time.dateTime = event.occurredAt;
    time.textContent = new Date(event.occurredAt).toLocaleString();
    const type = document.createElement('span');
    type.className = 'event-type';
    const label = document.createElement('strong');
    label.textContent = event.eventLabel;
    const code = document.createElement('small');
    code.textContent = event.eventType;
    type.append(label, code);
    tr.append(
      cell(time, 'nowrap'),
      cell(type),
      cell(event.actor ? userButton(event.actor) : 'Unknown'),
      cell(targetContent(event.target)),
      cell(details(event)),
      cell(event.seq === null ? '–' : String(event.seq), 'num'),
    );
    return tr;
  }

  function show(page, append) {
    const items = page.items.map(eventRow);
    if (append) rows.append.apply(rows, items);
    else rows.replaceChildren.apply(rows, items);
    shown = (append ? shown : 0) + page.items.length;
    nextCursor = page.nextCursor;
    document.getElementById('empty').hidden = shown > 0;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('shown-count').textContent = shown + ' events shown';
  }

  async function search() {
    lastQuery = filterQuery();
    show(await Sentinel.api('/v1/audit-events?' + lastQuery), false);
  }

  handleForm(filters, message, search);

  document.getElementById('clear').addEventListener('click', function () {
    filters.reset();
    search().catch(function (error) {
      showMessage(message, error.message, 'error');
    });
  });

  more.addEventListener('click', async function () {
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      // The filters that produced the cursor, not whatever the form holds now.
      const params = new URLSearchParams(lastQuery);
      params.set('cursor', nextCursor);
      show(await Sentinel.api('/v1/audit-events?' + params.toString()), true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  const verify = document.getElementById('verify');
  verify.addEventListener('click', async function () {
    const badge = document.getElementById('integrity-badge');
    const text = document.getElementById('integrity-text');
    verify.disabled = true;
    verify.setAttribute('aria-busy', 'true');
    try {
      const report = await Sentinel.api('/v1/audit-events/integrity');
      const checkedAt = new Date(report.checkedAt).toLocaleString();
      badge.textContent = report.intact ? 'Intact' : 'Broken';
      badge.className = 'badge ' + (report.intact ? 'ok' : 'bad');
      badge.hidden = false;
      text.textContent = report.intact
        ? 'All ' + report.checkedEntries + ' chained entries check out (checked ' + checkedAt + ').'
        : 'First broken link at entry ' + report.firstBrokenLink.seq + ': ' + report.firstBrokenLink.detail +
          ' (checked ' + checkedAt + ').';
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      verify.disabled = false;
      verify.removeAttribute('aria-busy');
    }
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    Shell.setUser(await Sentinel.api('/v1/me'));
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'The Audit Log belongs to a Tenant. Choose one first.', true);
      return;
    }
    const current = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(current);
    if (!current.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see the Audit Log of ' + current.tenantName + '.', false);
      return;
    }

    const types = await Sentinel.api('/v1/audit-events/types');
    const select = document.getElementById('event-type');
    types.items.forEach(function (type) {
      const option = document.createElement('option');
      option.value = type.type;
      option.textContent = type.label;
      select.append(option);
    });
    await search();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the Audit Log', error.message, false);
  });
})();
