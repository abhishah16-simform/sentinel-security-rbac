// Tenant Admin console: assign Roles to Memberships (optionally until a set time), list and revoke
// Role Assignments, and show one member's effective Permissions across all their Roles.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const assignForm = document.getElementById('assign-form');
  const assignMember = document.getElementById('assign-member');
  const assignRole = document.getElementById('assign-role');
  const filterMember = document.getElementById('filter-member');
  const filterStatus = document.getElementById('filter-status');
  const base = '/v1/tenants/current/role-assignments';
  const params = new URLSearchParams(window.location.search);
  let nextCursor = null;
  let me = null;

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

  function when(value) {
    return value ? new Date(value).toLocaleString() : 'Never';
  }

  // Follows a paginated list to its end.
  async function all(path) {
    const items = [];
    let cursor = null;
    do {
      const page = await Sentinel.api(path + '?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      items.push.apply(items, page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  function option(value, text) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = text;
    return element;
  }

  function fillMembers(select, members) {
    members.forEach(function (member) {
      const label = memberName(member) + (member.userId === me.id ? ' (you)' : '') + ' · ' + member.email;
      select.append(option(member.membershipId, label));
    });
  }

  // Roles of enabled Applications, grouped by Application.
  function fillRoles(roles) {
    const groups = new Map();
    roles.forEach(function (role) {
      if (!role.application.enabled) return;
      let group = groups.get(role.application.id);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = role.application.name;
        groups.set(role.application.id, group);
      }
      group.append(option(role.id, role.name));
    });
    groups.forEach(function (group) {
      assignRole.append(group);
    });
    return groups.size > 0;
  }

  function statusBadge(assignment) {
    if (assignment.status === 'active') {
      return badge(assignment.expiresAt ? 'Active until ' + new Date(assignment.expiresAt).toLocaleDateString() : 'Active', 'ok');
    }
    if (assignment.status === 'expired') return badge('Expired', 'warn');
    const reasons = { revoked: 'Revoked', 'role-deleted': 'Role deleted', 'membership-ended': 'Membership ended' };
    const span = badge(reasons[assignment.endReason] || 'Revoked', 'bad');
    span.title =
      'Revoked ' + new Date(assignment.revokedAt).toLocaleString() + (assignment.revokedByName ? ' by ' + assignment.revokedByName : '');
    return span;
  }

  function revokeButton(assignment) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'danger small';
    button.textContent = 'Revoke';
    const label = assignment.role.name + ' from ' + memberName(assignment.member);
    button.setAttribute('aria-label', 'Revoke ' + label);
    button.addEventListener('click', async function () {
      if (!window.confirm('Revoke ' + label + '? Their access through this Role ends at once.')) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await Sentinel.api(base + '/' + assignment.id + '/revoke', { method: 'POST' });
        showMessage(message, 'Revoked ' + label + '.', 'success');
        await refresh();
      } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
    return button;
  }

  function assignmentRow(assignment) {
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

    const assigned = document.createElement('div');
    assigned.className = 'event-type';
    assigned.append(new Date(assignment.createdAt).toLocaleDateString());
    if (assignment.assignedByName) {
      const by = document.createElement('small');
      by.textContent = 'by ' + assignment.assignedByName;
      assigned.append(by);
    }

    const actions = document.createElement('span');
    actions.className = 'actions';
    if (assignment.status === 'active') actions.append(revokeButton(assignment));

    const tr = document.createElement('tr');
    tr.append(
      cell(who),
      cell(role, 'nowrap'),
      cell(application),
      cell(when(assignment.expiresAt), 'nowrap'),
      cell(statusBadge(assignment)),
      cell(assigned, 'nowrap'),
      cell(actions, 'num'),
    );
    return tr;
  }

  function query(cursor) {
    const search = new URLSearchParams();
    if (filterMember.value) search.set('membershipId', filterMember.value);
    if (filterStatus.value) search.set('status', filterStatus.value);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function show(page, append) {
    const built = page.items.map(assignmentRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
    document.getElementById('empty-text').textContent =
      filterMember.value || filterStatus.value !== 'active' ? 'No assignments match these filters.' : 'Assign a Role above.';
  }

  function permissionRow(application, permission) {
    const effect = document.createElement('span');
    effect.append(badge(permission.inverted ? 'Deny' : 'Allow', permission.inverted ? 'bad' : 'ok'));
    if (permission.overriddenByDeny) {
      const overridden = badge('Overridden', 'warn');
      overridden.title = 'A Deny Rule without a Condition for the same Action always wins over this allow.';
      effect.append(' ', overridden);
    }
    const target = document.createElement('span');
    target.textContent = permission.action + ' · ' + permission.resourceType;
    if (permission.deprecated) target.append(' ', badge('Deprecated', 'warn'));
    const condition = document.createElement('code');
    condition.className = 'mono condition';
    condition.textContent = permission.conditions ? JSON.stringify(permission.conditions) : 'Every resource';
    const role = document.createElement('a');
    role.href = '/role.html?id=' + encodeURIComponent(permission.role.id);
    role.textContent = permission.role.name;
    const app = document.createElement('span');
    app.append(application.name);
    if (!application.enabled) {
      const disabled = badge('Disabled', 'warn');
      disabled.title = 'Access Checks for this Application are denied until it is enabled again.';
      app.append(' ', disabled);
    }
    const tr = document.createElement('tr');
    tr.append(
      cell(effect, 'nowrap'),
      cell(target, 'nowrap'),
      cell(condition),
      cell(role, 'nowrap'),
      cell(app),
      cell(when(permission.expiresAt), 'nowrap'),
    );
    return tr;
  }

  async function showEffective() {
    const section = document.getElementById('effective');
    const membershipId = filterMember.value;
    if (!membershipId) {
      section.hidden = true;
      return;
    }
    const effective = await Sentinel.api('/v1/tenants/current/memberships/' + encodeURIComponent(membershipId) + '/effective-permissions');
    const name = memberName(effective.member);
    const roleCount = effective.assignments.length;
    document.getElementById('effective-subtitle').textContent =
      name + ' holds ' + roleCount + (roleCount === 1 ? ' active Role' : ' active Roles') +
      ' as of ' + new Date(effective.asOf).toLocaleString() + '. A deny always wins over an allow.' +
      (effective.isTenantAdmin ? ' Being a Tenant Admin gives console access only, not Application Permissions.' : '');

    const body = document.getElementById('effective-body');
    const permissions = [];
    effective.applications.forEach(function (application) {
      application.permissions.forEach(function (permission) {
        permissions.push(permissionRow(application, permission));
      });
    });
    if (permissions.length === 0) {
      body.replaceChildren();
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const table = document.createElement('table');
      table.className = 'data-table';
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Effect', 'Action · Resource Type', 'Condition', 'Role', 'Application', 'Expires'].forEach(function (title) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = title;
        headRow.append(th);
      });
      head.append(headRow);
      const tbody = document.createElement('tbody');
      tbody.append.apply(tbody, permissions);
      table.append(head, tbody);
      wrap.append(table);
      body.replaceChildren(wrap);
    }
    document.getElementById('effective-empty').hidden = permissions.length > 0;
    section.hidden = false;
  }

  async function refresh() {
    show(await Sentinel.api(query(null)), false);
    await showEffective();
  }

  function onFilterChange() {
    const url = new URL(window.location.href);
    if (filterMember.value) url.searchParams.set('membership', filterMember.value);
    else url.searchParams.delete('membership');
    window.history.replaceState(null, '', url);
    if (filterMember.value) assignMember.value = filterMember.value;
    refresh().catch(function (error) {
      showMessage(message, error.message, 'error');
    });
  }
  filterMember.addEventListener('change', onFilterChange);
  filterStatus.addEventListener('change', onFilterChange);

  more.addEventListener('click', async function () {
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      show(await Sentinel.api(query(nextCursor)), true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  handleForm(assignForm, message, async function (data) {
    const expires = String(data.get('expiresAt') || '');
    const assignment = await Sentinel.api(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        membershipId: String(data.get('membershipId')),
        roleId: String(data.get('roleId')),
        // datetime-local is the browser's local time; send it as an instant.
        expiresAt: expires ? new Date(expires).toISOString() : null,
      }),
    });
    document.getElementById('assign-expires').value = '';
    showMessage(message, 'Assigned ' + assignment.role.name + ' to ' + memberName(assignment.member) + '.', 'success');
    filterMember.value = assignment.member.membershipId;
    filterStatus.value = 'active';
    onFilterChange();
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
      block('No Active Tenant', 'Role Assignments belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can manage the Role Assignments in ' + tenant.tenantName + '.', false);
      return;
    }
    const lists = await Promise.all([all('/v1/tenants/current/memberships'), all('/v1/tenants/current/roles')]);
    const members = lists[0];
    fillMembers(assignMember, members);
    fillMembers(filterMember, members);
    const canAssign = fillRoles(lists[1]);
    assignForm.hidden = !canAssign;
    document.getElementById('no-roles').hidden = canAssign;

    const membership = params.get('membership');
    if (membership && members.some(function (member) {
        return member.membershipId === membership;
      })) {
      filterMember.value = membership;
      assignMember.value = membership;
    }
    await refresh();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Role Assignments', error.message, false);
  });
})();
