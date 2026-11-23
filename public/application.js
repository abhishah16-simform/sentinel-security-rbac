// Tenant Admin console: one Application, its Enablement, the Tenant's Roles for it (with Permissions on
// Deprecated Schema entries flagged) and its Application Schema.
(function () {
  const message = document.getElementById('message');
  const toggle = document.getElementById('toggle');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/tenants/current/applications/' + encodeURIComponent(id);
  let current = null;

  function block(title, text) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    toggle.hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked').hidden = false;
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

  function roleItem(role) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'schema-head';
    const title = document.createElement('strong');
    title.textContent = role.name;
    head.append(title);
    if (role.description) {
      const description = document.createElement('span');
      description.className = 'description';
      description.textContent = role.description;
      head.append(description);
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    role.permissions.forEach(function (permission) {
      chips.append(Permissions.chip(permission));
    });
    if (role.permissions.length === 0) {
      const none = document.createElement('span');
      none.className = 'hint';
      none.textContent = 'No Permissions: this Role allows nothing.';
      chips.append(none);
    }
    li.append(head, chips);
    return li;
  }

  function templateItem(template) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'schema-head';
    const title = document.createElement('strong');
    title.textContent = template.name;
    const count = document.createElement('span');
    count.className = 'hint';
    count.textContent = plural(template.permissionCount, 'Permission', 'Permissions');
    head.append(title, count);
    if (template.deprecatedPermissions > 0) {
      head.append(
        badge(
          plural(template.deprecatedPermissions, 'Permission', 'Permissions') + ' on Deprecated entries won’t be copied',
          'warn',
        ),
      );
    }
    if (template.description) {
      const description = document.createElement('span');
      description.className = 'description';
      description.textContent = template.description;
      head.append(description);
    }
    li.append(head);
    return li;
  }

  function resourceTypeItem(resourceType) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'schema-head';
    const title = document.createElement('strong');
    title.textContent = resourceType.name;
    if (resourceType.deprecated) title.append(' ', badge('Deprecated', 'warn'));
    head.append(title);
    const chips = document.createElement('div');
    chips.className = 'chips';
    resourceType.actions.forEach(function (action) {
      const chip = document.createElement('span');
      chip.className = 'chip static' + (action.deprecated ? ' deprecated' : '');
      chip.textContent = action.name;
      if (action.deprecated) chip.title = 'Deprecated';
      chips.append(chip);
    });
    li.append(head, chips);
    return li;
  }

  function render(application) {
    current = application;
    document.title = application.name + ' · SENTINEL';
    document.getElementById('app-name').textContent = application.name;
    document.getElementById('crumb-name').textContent = application.name;
    const status = document.getElementById('app-status');
    if (application.enabled) status.replaceChildren(badge('Enabled', 'ok'));
    else if (application.disabledAt) status.replaceChildren(badge('Disabled', 'warn'));
    else status.replaceChildren(badge('Not enabled', 'accent'));

    toggle.hidden = false;
    toggle.className = application.enabled ? 'danger' : '';
    toggle.textContent = application.enabled ? 'Disable' : 'Enable';
    toggle.setAttribute('aria-label', (application.enabled ? 'Disable ' : 'Enable ') + application.name);

    let intro;
    if (!application.templatesCopied) intro = 'Enable this Application to get its default Roles.';
    else if (application.enabled) intro = 'Copied from its Role Templates when you first enabled it. They are yours: template changes never reach them.';
    else intro = 'Kept while the Application is disabled. Enabling it again brings them back as they are.';
    document.getElementById('roles-intro').textContent = intro;

    const flagged = application.deprecatedPermissions;
    document.getElementById('deprecated-callout').hidden = flagged === 0;
    document.getElementById('deprecated-text').textContent =
      plural(flagged, 'Permission uses', 'Permissions use') +
      ' a Deprecated Resource Type or Action. ' +
      (flagged === 1 ? 'It still applies' : 'They still apply') +
      ' until removed, but no new Permission can use those entries.';

    const roles = document.getElementById('roles');
    roles.replaceChildren.apply(roles, application.roles.map(roleItem));
    document.getElementById('roles-empty').hidden = application.roles.length > 0;
    document.getElementById('roles-empty-title').textContent = application.templatesCopied ? 'No Roles' : 'No Roles yet';
    document.getElementById('roles-empty-text').textContent = application.templatesCopied
      ? 'This Application had no Role Templates when you enabled it.'
      : application.roleTemplates.length > 0
        ? 'Enabling it copies the default Roles below into your Tenant.'
        : 'This Application has no default Roles.';

    const templates = document.getElementById('templates');
    templates.replaceChildren.apply(templates, application.roleTemplates.map(templateItem));
    document.getElementById('templates-card').hidden = application.roleTemplates.length === 0;

    const schema = document.getElementById('schema');
    schema.replaceChildren.apply(schema, application.resourceTypes.map(resourceTypeItem));
    document.getElementById('schema-empty').hidden = application.resourceTypes.length > 0;
  }

  toggle.addEventListener('click', async function () {
    const enable = !current.enabled;
    if (!enable && !window.confirm('Disable ' + current.name + '? Your Users lose access to it. Your Roles for it are kept.')) {
      return;
    }
    toggle.disabled = true;
    toggle.setAttribute('aria-busy', 'true');
    try {
      const firstTime = enable && !current.templatesCopied;
      const skipped = current.roleTemplates.reduce(function (sum, template) {
        return sum + template.deprecatedPermissions;
      }, 0);
      const updated = await Sentinel.api(base + '/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
      render(updated);
      let done = current.name + ' disabled. Its Roles are kept.';
      if (enable) {
        done = firstTime
          ? current.name +
            ' enabled with ' +
            plural(updated.roles.length, 'default Role', 'default Roles') +
            (skipped > 0 ? ', leaving out ' + plural(skipped, 'Permission', 'Permissions') + ' on Deprecated entries.' : '.')
          : current.name + ' enabled again with your existing Roles.';
      }
      showMessage(message, done, 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      toggle.disabled = false;
      toggle.removeAttribute('aria-busy');
    }
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
      block('No Active Tenant', 'Applications are enabled per Tenant. Choose one first.');
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can manage the Applications ' + tenant.tenantName + ' uses.');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      block('Application not found', 'Open an Application from the list.');
      return;
    }
    render(await Sentinel.api(base));
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the Application', error.message);
  });
})();
