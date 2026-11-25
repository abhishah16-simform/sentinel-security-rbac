// Tenant Admin console: the expiring-soon and expired Role Assignments report, with a look-ahead
// window for the expiring-soon list.
(function () {
  const message = document.getElementById('message');
  const withinDays = document.getElementById('within-days');
  const reports = '/v1/tenants/current/reports/';

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

  function memberName(member) {
    return Shell.fullName(member) || member.email;
  }

  // "in 3 hours", "2 days ago": how far an expiry time is from the report's asOf.
  function relative(value, asOf) {
    const minutes = Math.round((new Date(value).getTime() - new Date(asOf).getTime()) / 60000);
    const size = Math.abs(minutes);
    function count(amount, unit) {
      return amount + ' ' + unit + (amount === 1 ? '' : 's');
    }
    let text;
    if (size < 60) text = count(size, 'minute');
    else if (size < 48 * 60) text = count(Math.round(size / 60), 'hour');
    else text = count(Math.round(size / 1440), 'day');
    return minutes >= 0 ? 'in ' + text : text + ' ago';
  }

  function assignmentRow(assignment, asOf) {
    const who = document.createElement('div');
    who.className = 'event-type';
    who.append(memberName(assignment.member));
    const email = document.createElement('small');
    email.textContent = assignment.member.membershipId ? assignment.member.email : assignment.member.email + ' · left the Tenant';
    who.append(email);

    let role;
    if (assignment.role.id) {
      role = document.createElement('a');
      role.href = '/role.html?id=' + encodeURIComponent(assignment.role.id);
      role.textContent = assignment.role.name;
    } else {
      role = document.createElement('span');
      role.textContent = assignment.role.name + ' (deleted)';
    }

    const application = document.createElement('span');
    application.append(assignment.application.name);
    if (!assignment.application.enabled) application.append(' ', badge('Disabled', 'warn'));

    const expires = document.createElement('div');
    expires.className = 'event-type';
    expires.append(new Date(assignment.expiresAt).toLocaleString());
    const distance = document.createElement('small');
    distance.textContent = relative(assignment.expiresAt, asOf);
    expires.append(distance);
    if (assignment.status === 'expired' && !assignment.expiryRecordedAt) {
      const pending = badge('Not yet logged', 'warn below');
      pending.title = 'It already gives no access. The Scheduler records it in the Audit Log within a minute.';
      expires.append(pending);
    }

    const assigned = document.createElement('div');
    assigned.className = 'event-type';
    assigned.append(new Date(assignment.createdAt).toLocaleDateString());
    if (assignment.assignedByName) {
      const by = document.createElement('small');
      by.textContent = 'by ' + assignment.assignedByName;
      assigned.append(by);
    }

    const tr = document.createElement('tr');
    tr.append(cell(who), cell(role, 'nowrap'), cell(application), cell(expires, 'nowrap'), cell(assigned, 'nowrap'));
    return tr;
  }

  // One paginated report table: its rows, empty state and "Load more" button.
  function reportList(name, path) {
    const rows = document.getElementById(name + '-rows');
    const more = document.getElementById(name + '-more');
    let nextCursor = null;
    let onPage = function () {};

    function url(cursor) {
      const search = new URLSearchParams();
      if (name === 'expiring') search.set('withinDays', withinDays.value);
      if (cursor) search.set('cursor', cursor);
      const text = search.toString();
      return reports + path + (text ? '?' + text : '');
    }

    function show(page, append) {
      const built = page.items.map(function (assignment) {
        return assignmentRow(assignment, page.asOf);
      });
      if (append) rows.append.apply(rows, built);
      else rows.replaceChildren.apply(rows, built);
      nextCursor = page.nextCursor;
      document.getElementById(name + '-more-footer').hidden = !nextCursor;
      document.getElementById(name + '-empty').hidden = rows.children.length > 0;
      onPage(page);
    }

    more.addEventListener('click', async function () {
      more.disabled = true;
      more.setAttribute('aria-busy', 'true');
      try {
        show(await Sentinel.api(url(nextCursor)), true);
      } catch (error) {
        showMessage(message, error.message, 'error');
      } finally {
        more.disabled = false;
        more.removeAttribute('aria-busy');
      }
    });

    return {
      refresh: async function () {
        show(await Sentinel.api(url(null)), false);
      },
      onPage: function (callback) {
        onPage = callback;
      },
    };
  }

  const expiring = reportList('expiring', 'expiring-role-assignments');
  const expired = reportList('expired', 'expired-role-assignments');

  expiring.onPage(function (page) {
    const span = page.withinDays === 1 ? 'the next day' : 'the next ' + page.withinDays + ' days';
    document.getElementById('expiring-subtitle').textContent =
      'Active assignments that expire within ' + span + ' (until ' + new Date(page.windowEnd).toLocaleString() +
      '), soonest first. Each one stops giving access at exactly its expiry time.';
    document.getElementById('expiring-empty-text').textContent = 'No Temporary Role Assignment expires within ' + span + '.';
  });

  withinDays.addEventListener('change', function () {
    const url = new URL(window.location.href);
    url.searchParams.set('withinDays', withinDays.value);
    window.history.replaceState(null, '', url);
    expiring.refresh().catch(function (error) {
      showMessage(message, error.message, 'error');
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
      block('No Active Tenant', 'Role Assignments belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see the expiring access in ' + tenant.tenantName + '.', false);
      return;
    }
    const days = new URLSearchParams(window.location.search).get('withinDays');
    if (days && Array.prototype.some.call(withinDays.options, function (option) {
        return option.value === days;
      })) {
      withinDays.value = days;
    }
    await Promise.all([expiring.refresh(), expired.refresh()]);
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the report', error.message, false);
  });
})();
