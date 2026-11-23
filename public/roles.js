// Tenant Admin console: the Tenant's Roles across Applications, filtered by Application, with a form
// to create a Role for an enabled Application and a Delete button on each.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filter = document.getElementById('filter-application');
  const roleForm = document.getElementById('role-form');
  const base = '/v1/tenants/current/roles';
  const params = new URLSearchParams(window.location.search);
  let nextCursor = null;

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

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function query(cursor) {
    const search = new URLSearchParams();
    if (filter.value) search.set('applicationId', filter.value);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function deleteButton(role) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'danger small';
    button.textContent = 'Delete';
    button.setAttribute('aria-label', 'Delete Role ' + role.name);
    button.addEventListener('click', async function () {
      const prompt =
        'Delete Role "' + role.name + '" and its ' + plural(role.permissions.length, 'Permission', 'Permissions') + '?';
      if (!window.confirm(prompt)) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await Sentinel.api(base + '/' + role.id, { method: 'DELETE' });
        rows.querySelector('[data-role-id="' + role.id + '"]').remove();
        document.getElementById('empty').hidden = rows.children.length > 0;
        showMessage(message, 'Role ' + role.name + ' deleted.', 'success');
      } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
    return button;
  }

  function roleRow(role) {
    const name = document.createElement('div');
    name.className = 'event-type';
    const link = document.createElement('a');
    link.href = '/role.html?id=' + encodeURIComponent(role.id);
    link.textContent = role.name;
    name.append(link);
    if (role.description) {
      const description = document.createElement('small');
      description.textContent = role.description;
      name.append(description);
    }
    const application = document.createElement('span');
    application.append(role.application.name);
    if (!role.application.enabled) application.append(' ', badge('Disabled', 'warn'));
    const flagged = role.permissions.filter(function (permission) {
      return permission.deprecated;
    }).length;
    const denies = role.permissions.filter(function (permission) {
      return permission.inverted;
    }).length;
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(deleteButton(role));
    const tr = document.createElement('tr');
    tr.dataset.roleId = role.id;
    tr.append(
      cell(name),
      cell(application),
      cell(
        role.permissions.length === 0
          ? 'None'
          : plural(role.permissions.length, 'Permission', 'Permissions') + (denies > 0 ? ' (' + denies + ' deny)' : ''),
        'nowrap',
      ),
      cell(flagged === 0 ? '–' : badge(flagged + ' Deprecated', 'warn')),
      cell(actions, 'num'),
    );
    return tr;
  }

  function show(page, append) {
    const built = page.items.map(roleRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
    document.getElementById('empty-text').textContent = filter.value
      ? 'This Application has no Roles in your Tenant.'
      : 'Create one above, or enable an Application to get its default Roles.';
  }

  async function reload() {
    show(await Sentinel.api(query(null)), false);
  }

  filter.addEventListener('change', function () {
    const url = new URL(window.location.href);
    if (filter.value) url.searchParams.set('app', filter.value);
    else url.searchParams.delete('app');
    url.searchParams.delete('deleted');
    window.history.replaceState(null, '', url);
    reload().catch(function (error) {
      showMessage(message, error.message, 'error');
    });
  });

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

  handleForm(roleForm, message, async function (data) {
    const role = await Sentinel.api(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: String(data.get('applicationId')),
        name: String(data.get('name')).trim(),
        description: String(data.get('description') || '').trim(),
      }),
    });
    window.location.href = '/role.html?id=' + encodeURIComponent(role.id);
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Roles belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can manage the Roles in ' + tenant.tenantName + '.', false);
      return;
    }
    const applications = await TenantApplications.all();
    TenantApplications.fill(filter, applications);
    const enabled = applications.filter(function (application) {
      return application.enabled;
    });
    const newApplication = document.getElementById('new-application');
    TenantApplications.fill(newApplication, enabled);
    roleForm.hidden = enabled.length === 0;
    document.getElementById('no-enabled').hidden = enabled.length > 0;

    const app = params.get('app');
    function isApp(application) {
      return application.id === app;
    }
    if (app && applications.some(isApp)) {
      filter.value = app;
      if (enabled.some(isApp)) newApplication.value = app;
    }
    await reload();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
    const deleted = params.get('deleted');
    if (deleted) showMessage(message, 'Role ' + deleted + ' deleted.', 'success');
  }

  load().catch(function (error) {
    block('Could not load Roles', error.message, false);
  });
})();
