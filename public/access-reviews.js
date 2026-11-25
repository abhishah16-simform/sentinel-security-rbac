// Tenant Admin console: start an Access Review for an enabled Application, and list reviews with
// their progress.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filterStatus = document.getElementById('filter-status');
  const startForm = document.getElementById('start-form');
  const startApplication = document.getElementById('start-application');
  const startDue = document.getElementById('start-due');
  const base = '/v1/tenants/current/access-reviews';
  let nextCursor = null;
  // Bumped on every refresh, so a late answer for an older filter is dropped.
  let generation = 0;

  function block(title, text, showLink) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked-link').hidden = !showLink;
    document.getElementById('blocked').hidden = false;
  }

  function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
  }

  function badge(text, kind) {
    const span = document.createElement('span');
    span.className = 'badge ' + kind;
    span.textContent = text;
    return span;
  }

  // The value a datetime-local input takes for a moment, in the browser's time zone.
  function localInputValue(date) {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }

  function statusBadge(review) {
    if (review.status === 'closed') return badge('Closed', 'accent');
    if (review.pastDue) return badge('Closing', 'warn');
    return badge('Open', 'ok');
  }

  // A bar of certified, revoked and auto-revoked items, with the count still pending.
  function progressContent(progress) {
    const wrap = document.createElement('div');
    wrap.className = 'event-type';
    wrap.append(ReviewProgress.bar(progress));
    const text = document.createElement('small');
    const decided = progress.total - progress.pending;
    text.textContent = decided + ' of ' + progress.total + ' decided' + (progress.pending ? ' · ' + progress.pending + ' pending' : '');
    wrap.append(text);
    return wrap;
  }

  function reviewRow(review) {
    const name = document.createElement('a');
    name.href = '/access-review.html?id=' + encodeURIComponent(review.id);
    name.textContent = review.application.name;

    const due = document.createElement('div');
    due.className = 'event-type';
    due.append(new Date(review.dueAt).toLocaleString());
    if (review.closedAt) {
      const closed = document.createElement('small');
      closed.textContent = 'Closed ' + new Date(review.closedAt).toLocaleString();
      due.append(closed);
    }

    const started = document.createElement('div');
    started.className = 'event-type';
    started.append(new Date(review.createdAt).toLocaleDateString());
    if (review.startedByName) {
      const by = document.createElement('small');
      by.textContent = 'by ' + review.startedByName;
      started.append(by);
    }

    const tr = document.createElement('tr');
    tr.append(
      cell(name),
      cell(statusBadge(review)),
      cell(due, 'nowrap'),
      cell(progressContent(review.progress)),
      cell(started, 'nowrap'),
    );
    return tr;
  }

  function url(cursor) {
    const search = new URLSearchParams();
    if (filterStatus.value) search.set('status', filterStatus.value);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function show(page, append) {
    const built = page.items.map(reviewRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
  }

  async function refresh() {
    const asked = ++generation;
    const page = await Sentinel.api(url(null));
    if (asked === generation) show(page, false);
  }

  more.addEventListener('click', async function () {
    const asked = generation;
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      const page = await Sentinel.api(url(nextCursor));
      if (asked === generation) show(page, true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  filterStatus.addEventListener('change', function () {
    refresh().catch(function (error) {
      showMessage(message, error.message, 'error');
    });
  });

  handleForm(startForm, message, async function (data) {
    const review = await Sentinel.api(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: String(data.get('applicationId')),
        // datetime-local is the browser's local time; send it as an instant.
        dueAt: new Date(String(data.get('dueAt'))).toISOString(),
      }),
    });
    window.location.href = '/access-review.html?id=' + encodeURIComponent(review.id);
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    Shell.setUser(await Sentinel.api('/v1/me'));
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Access Reviews belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can run Access Reviews in ' + tenant.tenantName + '.', false);
      return;
    }
    const applications = (await TenantApplications.all()).filter(function (application) {
      return application.enabled;
    });
    TenantApplications.fill(startApplication, applications);
    startForm.hidden = applications.length === 0;
    document.getElementById('no-applications').hidden = applications.length > 0;
    // Two weeks from now by default; the earliest choice is a minute ahead.
    startDue.value = localInputValue(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
    startDue.min = localInputValue(new Date(Date.now() + 60000));
    await refresh();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Access Reviews', error.message, false);
  });
})();
