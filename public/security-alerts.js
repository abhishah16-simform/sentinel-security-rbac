// Tenant Admin console: list the Active Tenant's Security Alerts and acknowledge them.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filterStatus = document.getElementById('filter-status');
  const filterRule = document.getElementById('filter-rule');
  const base = '/v1/tenants/current/security-alerts';
  let nextCursor = null;
  // Bumped on every refresh, so a late answer for an older filter is dropped.
  let generation = 0;

  const RULES = {
    'repeated-failed-logins': { title: 'Repeated failed logins', kind: 'warn' },
    'refresh-token-reused': { title: 'Refresh token reused', kind: 'bad' },
    'access-check-denials-spike': { title: 'Denied Access Checks spike', kind: 'warn' },
    'tenant-admin-changed': { title: 'Tenant Admin flag changed', kind: 'accent' },
  };

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

  function stacked(main, note) {
    const wrap = document.createElement('div');
    wrap.className = 'event-type';
    wrap.append(main);
    if (note) {
      const small = document.createElement('small');
      small.textContent = note;
      wrap.append(small);
    }
    return wrap;
  }

  function userName(user) {
    return user ? user.name : 'A former member';
  }

  // One sentence on what the rule saw.
  function summary(alert) {
    const details = alert.details || {};
    switch (alert.rule) {
      case 'repeated-failed-logins':
        return details.failedLogins + ' failed logins within ' + details.windowMinutes + ' minutes';
      case 'refresh-token-reused':
        return 'A used refresh token was presented again; that login was ended everywhere';
      case 'access-check-denials-spike':
        return 'At least ' + details.deniedChecks + ' denied Access Checks within ' + details.windowMinutes + ' minutes';
      case 'tenant-admin-changed':
        return (details.granted ? 'Made a Tenant Admin' : 'No longer a Tenant Admin') + (alert.actor ? ' by ' + alert.actor.name : '');
      default:
        return '';
    }
  }

  function about(alert) {
    if (alert.application) return stacked(alert.application.name, 'Application');
    if (alert.subject) return stacked(alert.subject.name, alert.subject.email);
    return stacked(userName(null), null);
  }

  function statusContent(alert) {
    if (alert.status === 'open') return badge('Open', 'bad');
    const when = new Date(alert.acknowledgedAt).toLocaleString();
    return stacked(badge('Acknowledged', 'ok'), (alert.acknowledgedByName ? 'by ' + alert.acknowledgedByName + ' · ' : '') + when);
  }

  function acknowledgeButton(alert) {
    const rule = RULES[alert.rule] || { title: alert.rule };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    button.textContent = 'Acknowledge';
    button.setAttribute('aria-label', 'Acknowledge ' + rule.title + ' alert from ' + new Date(alert.createdAt).toLocaleString());
    button.addEventListener('click', async function () {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await Sentinel.api(base + '/' + encodeURIComponent(alert.id) + '/acknowledge', { method: 'POST' });
        showMessage(message, 'Acknowledged ' + rule.title + '.', 'success');
        await refresh();
      } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
        button.removeAttribute('aria-busy');
        // Another Tenant Admin may have acknowledged it: show how things stand now.
        await refresh().catch(function () {});
      }
    });
    return button;
  }

  function alertRow(alert) {
    const rule = RULES[alert.rule] || { title: alert.rule, kind: 'accent' };
    const title = document.createElement('div');
    title.className = 'event-type';
    title.append(badge(rule.title, rule.kind));
    const text = document.createElement('small');
    text.textContent = summary(alert);
    title.append(text);

    const actions = document.createElement('div');
    actions.className = 'filter-actions';
    if (alert.status === 'open') actions.append(acknowledgeButton(alert));

    const tr = document.createElement('tr');
    tr.append(
      cell(title),
      cell(about(alert)),
      cell(new Date(alert.createdAt).toLocaleString(), 'nowrap'),
      cell(statusContent(alert), 'nowrap'),
      cell(actions),
    );
    return tr;
  }

  function url(cursor) {
    const search = new URLSearchParams();
    if (filterStatus.value) search.set('status', filterStatus.value);
    if (filterRule.value) search.set('rule', filterRule.value);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function showEmpty() {
    const filtered = filterStatus.value !== 'open' || filterRule.value;
    document.getElementById('empty-title').textContent = filtered ? 'No matching alerts' : 'No open alerts';
    document.getElementById('empty-text').textContent = filtered
      ? 'Try another status or rule.'
      : 'Nothing risky needs your attention right now.';
    document.getElementById('empty').hidden = rows.children.length > 0;
  }

  function show(page, append) {
    const built = page.items.map(alertRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    showEmpty();
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

  [filterStatus, filterRule].forEach(function (select) {
    select.addEventListener('change', function () {
      refresh().catch(function (error) {
        showMessage(message, error.message, 'error');
      });
    });
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    Shell.setUser(await Sentinel.api('/v1/me'));
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Security Alerts belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see Security Alerts in ' + tenant.tenantName + '.', false);
      return;
    }
    await refresh();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Security Alerts', error.message, false);
  });
})();
