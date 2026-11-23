// Tenant Admin console: every Permission in the Tenant's Roles, filtered by Application and Resource
// Type, each linking to its Role. Read-only: Permissions are changed on the Role page.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filters = document.getElementById('filters');
  const applicationFilter = document.getElementById('filter-application');
  const resourceTypeFilter = document.getElementById('filter-resource-type');
  const base = '/v1/tenants/current/permissions';
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

  function query(cursor) {
    const search = new URLSearchParams();
    if (applicationFilter.value) search.set('applicationId', applicationFilter.value);
    const resourceType = resourceTypeFilter.value.trim();
    if (resourceType) search.set('resourceType', resourceType);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function permissionRow(permission) {
    const effect = document.createElement('span');
    effect.className = 'badge ' + (permission.inverted ? 'bad' : 'ok');
    effect.textContent = permission.inverted ? 'Deny' : 'Allow';
    const target = document.createElement('span');
    target.textContent = permission.action + ' · ' + permission.resourceType;
    if (permission.deprecated) {
      const flag = document.createElement('span');
      flag.className = 'badge warn';
      flag.textContent = 'Deprecated';
      flag.title = 'Uses a Deprecated Resource Type or Action. Remove it when you can.';
      target.append(' ', flag);
    }
    const condition = document.createElement('code');
    condition.className = 'mono condition';
    condition.textContent = permission.conditions ? JSON.stringify(permission.conditions) : 'Every resource';
    const role = document.createElement('a');
    role.href = '/role.html?id=' + encodeURIComponent(permission.role.id);
    role.textContent = permission.role.name;
    const tr = document.createElement('tr');
    tr.append(
      cell(effect),
      cell(target, 'nowrap'),
      cell(condition),
      cell(role, 'nowrap'),
      cell(permission.application.name),
    );
    return tr;
  }

  function show(page, append) {
    const built = page.items.map(permissionRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
    document.getElementById('empty-text').textContent =
      applicationFilter.value || resourceTypeFilter.value.trim()
        ? 'No Permissions match these filters.'
        : "Your Roles don't have any Permissions yet.";
  }

  async function reload() {
    show(await Sentinel.api(query(null)), false);
  }

  handleForm(filters, message, reload);

  document.getElementById('clear').addEventListener('click', function () {
    filters.reset();
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

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Permissions belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see the Permissions in ' + tenant.tenantName + '.', false);
      return;
    }
    TenantApplications.fill(applicationFilter, await TenantApplications.all());
    await reload();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Permissions', error.message, false);
  });
})();
