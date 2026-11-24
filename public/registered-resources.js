// Tenant Admin console: the Active Tenant's Registered Resources, filterable by Application and
// Resource ID. Each links to its page with the access-by-Registered-Resource report.
(function () {
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filters = document.getElementById('filters');
  const filterApplication = document.getElementById('filter-application');
  const filterResourceId = document.getElementById('filter-resource-id');
  const base = '/v1/tenants/current/registered-resources';
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

  function option(value, text) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = text;
    return element;
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

  function resourceRow(resource) {
    const link = document.createElement('a');
    link.href = '/registered-resource.html?id=' + encodeURIComponent(resource.id);
    link.textContent = resource.resourceId;
    const attributes = document.createElement('code');
    attributes.className = 'mono condition';
    attributes.textContent = JSON.stringify(resource.attributes);
    const tr = document.createElement('tr');
    tr.append(
      cell(link),
      cell(resource.resourceType, 'nowrap'),
      cell(resource.application.name),
      cell(attributes),
      cell(new Date(resource.updatedAt).toLocaleString(), 'nowrap'),
    );
    return tr;
  }

  function query(cursor) {
    const search = new URLSearchParams();
    if (filterApplication.value) search.set('applicationId', filterApplication.value);
    const resourceId = filterResourceId.value.trim();
    if (resourceId) search.set('resourceId', resourceId);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + (text ? '?' + text : '');
  }

  function show(page, append) {
    const built = page.items.map(resourceRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
    document.getElementById('empty-text').textContent =
      filterApplication.value || filterResourceId.value.trim()
        ? 'No resources match these filters.'
        : 'None of your Applications has registered a resource yet.';
  }

  async function refresh() {
    show(await Sentinel.api(query(null)), false);
  }

  function refreshOrShow() {
    refresh().catch(function (error) {
      showMessage(document.getElementById('message'), error.message, 'error');
    });
  }

  filterApplication.addEventListener('change', refreshOrShow);
  filters.addEventListener('submit', function (event) {
    event.preventDefault();
    refreshOrShow();
  });
  filterResourceId.addEventListener('change', refreshOrShow);
  more.addEventListener('click', async function () {
    more.disabled = true;
    try {
      show(await Sentinel.api(query(nextCursor)), true);
    } catch (error) {
      showMessage(document.getElementById('message'), error.message, 'error');
    } finally {
      more.disabled = false;
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
      block('No Active Tenant', 'Registered Resources belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can see the Registered Resources of ' + tenant.tenantName + '.', false);
      return;
    }
    const applications = await all('/v1/tenants/current/applications');
    applications.forEach(function (application) {
      filterApplication.append(option(application.id, application.name));
    });
    await refresh();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Registered Resources', error.message, false);
  });
})();
