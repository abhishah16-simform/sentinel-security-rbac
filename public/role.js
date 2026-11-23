// Tenant Admin console: one Role. Rename it, delete it, and add or remove its allow and deny Permissions,
// each optionally limited by a Condition (CASL/Mongo-style JSON, checked by the server when saved).
(function () {
  const message = document.getElementById('message');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/tenants/current/roles/' + encodeURIComponent(id);
  const detailsForm = document.getElementById('details-form');
  const permissionForm = document.getElementById('permission-form');
  const pairSelect = document.getElementById('pair');
  const deleteButton = document.getElementById('delete');
  let current = null;
  // The Actions a new Permission may use: in the Schema and not Deprecated.
  let pairs = [];

  function block(title, text) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    deleteButton.hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked').hidden = false;
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function api(method, path, body) {
    return Sentinel.api(base + path, {
      method: method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  // Keeps the chosen Action selected when the list is rebuilt after a change.
  function renderPairs(role) {
    const chosen = pairSelect.value;
    pairs = [];
    role.resourceTypes.forEach(function (resourceType) {
      resourceType.actions.forEach(function (action) {
        if (!action.deprecated) pairs.push({ resourceType: resourceType.name, action: action.name });
      });
    });
    pairSelect.replaceChildren.apply(
      pairSelect,
      pairs.map(function (pair, index) {
        return option(String(index), pair.action + ' · ' + pair.resourceType);
      }),
    );
    if (chosen && Number(chosen) < pairs.length) pairSelect.value = chosen;
  }

  async function removePermission(permission, button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      render(await api('DELETE', '/permissions/' + permission.id));
      showMessage(message, 'Removed "' + Permissions.describe(permission) + '".', 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function render(role) {
    current = role;
    document.title = role.name + ' · SENTINEL';
    document.getElementById('role-name').textContent = role.name;
    document.getElementById('crumb-name').textContent = role.name;
    const subtitle = document.getElementById('role-subtitle');
    const appLink = document.createElement('a');
    appLink.href = '/application.html?id=' + encodeURIComponent(role.application.id);
    appLink.textContent = role.application.name;
    subtitle.replaceChildren('A Role for ', appLink, role.description ? '. ' + role.description : '.');
    deleteButton.hidden = false;
    deleteButton.setAttribute('aria-label', 'Delete Role ' + role.name);
    detailsForm.elements.name.value = role.name;
    detailsForm.elements.description.value = role.description;

    const enabled = role.application.enabled;
    document.getElementById('disabled-callout').hidden = enabled;
    document.getElementById('disabled-text').textContent =
      role.application.name + ' is disabled for your Tenant, so no Access Check passes. Enable it to add Permissions; you can still remove them.';
    renderPairs(role);
    permissionForm.hidden = !enabled || pairs.length === 0;
    document.getElementById('no-pairs').hidden = !enabled || pairs.length > 0;

    const flagged = role.permissions.filter(function (permission) {
      return permission.deprecated;
    }).length;
    document.getElementById('deprecated-callout').hidden = flagged === 0;
    document.getElementById('deprecated-text').textContent =
      plural(flagged, 'Permission uses', 'Permissions use') +
      ' a Deprecated Resource Type or Action. ' +
      (flagged === 1 ? 'It still applies' : 'They still apply') +
      ' until removed, but no new Permission can use those entries.';

    const list = document.getElementById('permissions');
    list.replaceChildren.apply(
      list,
      role.permissions.map(function (permission) {
        return Permissions.chip(permission, function (button) {
          removePermission(permission, button);
        });
      }),
    );
    document.getElementById('permissions-empty').hidden = role.permissions.length > 0;
  }

  handleForm(detailsForm, message, async function (data) {
    render(
      await api('PATCH', '', {
        name: String(data.get('name')).trim(),
        description: String(data.get('description') || '').trim(),
      }),
    );
    showMessage(message, 'Role saved.', 'success');
  });

  handleForm(permissionForm, message, async function (data) {
    const pair = pairs[Number(data.get('pair'))];
    if (!pair) throw new Error('Choose an Action.');
    const text = String(data.get('conditions') || '').trim();
    let conditions = null;
    if (text) {
      try {
        conditions = JSON.parse(text);
      } catch (error) {
        throw new Error('The Condition is not valid JSON: ' + error.message);
      }
    }
    const permission = {
      resourceType: pair.resourceType,
      action: pair.action,
      inverted: data.get('effect') === 'deny',
      conditions: conditions,
    };
    render(await api('POST', '/permissions', permission));
    document.getElementById('conditions').value = '';
    showMessage(message, 'Added "' + Permissions.describe(permission) + '".', 'success');
  });

  deleteButton.addEventListener('click', async function () {
    const prompt =
      'Delete Role "' + current.name + '" and its ' + plural(current.permissions.length, 'Permission', 'Permissions') + '? Anyone holding it loses it at once.';
    if (!window.confirm(prompt)) return;
    deleteButton.disabled = true;
    deleteButton.setAttribute('aria-busy', 'true');
    try {
      await api('DELETE', '');
      window.location.href = '/roles.html?deleted=' + encodeURIComponent(current.name);
    } catch (error) {
      showMessage(message, error.message, 'error');
      deleteButton.disabled = false;
      deleteButton.removeAttribute('aria-busy');
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
      block('No Active Tenant', 'Roles belong to a Tenant. Choose one first.');
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can manage the Roles in ' + tenant.tenantName + '.');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      block('Role not found', 'Open a Role from the list.');
      return;
    }
    render(await api('GET', ''));
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the Role', error.message);
  });
})();
