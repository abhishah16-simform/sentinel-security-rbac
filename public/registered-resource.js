// Tenant Admin console: one Registered Resource and the access-by-Registered-Resource report: for
// each member with a Role in its Application, what an Access Check would answer for each Action.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/tenants/current/registered-resources/' + encodeURIComponent(id);
  const roleNames = new Map();
  let nextCursor = null;
  let me = null;

  const REASONS = {
    'matched-allow': 'Allowed by a Permission',
    'matched-deny': 'Denied by a Deny Rule',
    'no-matching-permission': 'No matching Permission',
    'tenant-suspended': 'Tenant suspended',
    'application-not-enabled': 'Application not enabled',
    'no-membership': 'No Membership',
  };

  const DENIED_BECAUSE = {
    'tenant-suspended': 'This Tenant is suspended, so every Access Check in it is denied.',
    'application-not-enabled': 'This Tenant has not enabled the Application, so every Access Check for it is denied.',
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

  function memberName(member) {
    return Shell.fullName(member) || member.email;
  }

  // One Action's answer: allowed or denied, why, and a link to the Role that decided it.
  function answerCell(answer) {
    const wrap = document.createElement('div');
    wrap.className = 'event-type access-answer';
    const verdict = badge(answer.allowed ? 'Allowed' : 'Denied', answer.allowed ? 'ok' : 'bad');
    verdict.title = (REASONS[answer.reason] || answer.reason) + ' (reason: ' + answer.reason + ')';
    wrap.append(verdict);
    const why = document.createElement('small');
    if (answer.roleId) {
      const link = document.createElement('a');
      link.href = '/role.html?id=' + encodeURIComponent(answer.roleId);
      link.textContent = roleNames.get(answer.roleId) || 'Role';
      why.append(answer.allowed ? 'via ' : 'Deny Rule in ', link);
    } else {
      why.textContent = REASONS[answer.reason] || answer.reason;
    }
    wrap.append(why);
    return cell(wrap, 'nowrap');
  }

  function memberRow(row) {
    const who = document.createElement('div');
    who.className = 'event-type';
    const link = document.createElement('a');
    link.href = '/role-assignments.html?membership=' + encodeURIComponent(row.member.membershipId);
    link.textContent = memberName(row.member) + (me && row.member.userId === me.id ? ' (you)' : '');
    link.title = 'Role Assignments and effective Permissions';
    who.append(link);
    const email = document.createElement('small');
    email.textContent = row.member.email;
    who.append(email);
    const tr = document.createElement('tr');
    tr.append(cell(who));
    row.answers.forEach(function (answer) {
      tr.append(answerCell(answer));
    });
    return tr;
  }

  function showHead(actions) {
    const head = document.getElementById('access-head');
    const member = document.createElement('th');
    member.scope = 'col';
    member.textContent = 'Member';
    head.replaceChildren(member);
    actions.forEach(function (action) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = action.name + (action.deprecated ? ' (Deprecated)' : '');
      head.append(th);
    });
  }

  function showReport(report, append) {
    report.roles.forEach(function (role) {
      roleNames.set(role.id, role.name);
    });
    if (!append) {
      showHead(report.actions);
      document.getElementById('access-text').textContent =
        'What an Access Check would answer for each member with a Role in ' + report.resource.application.name +
        ', for each Action on this ' + report.resource.resourceType + ', with the attributes above. As of ' +
        new Date(report.asOf).toLocaleString() + '. Members without a Role in the Application are denied everything and not listed.';
      const callout = document.getElementById('denied-callout');
      callout.hidden = !report.deniedBecause;
      document.getElementById('denied-text').textContent = report.deniedBecause
        ? DENIED_BECAUSE[report.deniedBecause] || report.deniedBecause
        : '';
    }
    const built = report.items.map(memberRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = report.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
  }

  function showResource(resource) {
    document.title = resource.resourceId + ' · SENTINEL';
    document.getElementById('resource-name').textContent = resource.resourceId;
    document.getElementById('crumb-resource').textContent = resource.resourceId;
    document.getElementById('resource-subtitle').textContent =
      resource.resourceType + ' registered by ' + resource.application.name;
    document.getElementById('detail-application').textContent = resource.application.name;
    document.getElementById('detail-resource-type').textContent = resource.resourceType;
    document.getElementById('detail-attributes').textContent = JSON.stringify(resource.attributes, null, 2);
    document.getElementById('detail-created').textContent = new Date(resource.createdAt).toLocaleString();
    document.getElementById('detail-updated').textContent = new Date(resource.updatedAt).toLocaleString();
  }

  more.addEventListener('click', async function () {
    more.disabled = true;
    try {
      showReport(await Sentinel.api(base + '/access?cursor=' + encodeURIComponent(nextCursor)), true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
    }
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Registered Resources belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see who can access resources in ' + tenant.tenantName + '.', false);
      return;
    }
    // The report carries the resource too, so one request fills the whole page.
    const report = await Sentinel.api(base + '/access');
    showResource(report.resource);
    showReport(report, false);
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load this resource', error.message, false);
  });
})();
