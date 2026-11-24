// Platform Admin console: every Tenant with its counts, and suspending or reactivating one.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  let nextCursor = null;

  function block(title, text) {
    document.getElementById('loading').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked').hidden = false;
  }

  function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
  }

  function statusBadge(tenant) {
    const badge = document.createElement('span');
    badge.className = 'badge ' + (tenant.suspendedAt ? 'bad' : 'ok');
    badge.textContent = tenant.suspendedAt ? 'Suspended' : 'Active';
    if (tenant.suspendedAt) badge.title = 'Suspended ' + new Date(tenant.suspendedAt).toLocaleString();
    return badge;
  }

  function toggleButton(tenant, tr) {
    const suspend = !tenant.suspendedAt;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = (suspend ? 'danger' : 'secondary') + ' small';
    button.textContent = suspend ? 'Suspend' : 'Reactivate';
    button.setAttribute('aria-label', button.textContent + ' ' + tenant.name);
    button.addEventListener('click', async function () {
      const prompt = suspend
        ? 'Suspend ' + tenant.name + '? Its Users can no longer switch into it, and every Access Check in it is denied until you reactivate it.'
        : 'Reactivate ' + tenant.name + '? Its Users can switch into it and pass Access Checks again.';
      if (!window.confirm(prompt)) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const updated = await Sentinel.api(
          '/v1/platform/tenants/' + encodeURIComponent(tenant.id) + (suspend ? '/suspend' : '/reactivate'),
          { method: 'POST' },
        );
        tr.replaceWith(tenantRow(updated));
        showMessage(message, updated.name + (suspend ? ' is suspended.' : ' is active again.'), 'success');
      } catch (error) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        showMessage(message, error.message, 'error');
      }
    });
    return button;
  }

  function tenantRow(tenant) {
    const tr = document.createElement('tr');
    const name = document.createElement('div');
    name.className = 'event-type';
    name.append(tenant.name);
    const id = document.createElement('small');
    id.className = 'mono';
    id.textContent = tenant.id;
    name.append(id);
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(toggleButton(tenant, tr));
    tr.append(
      cell(name),
      cell(String(tenant.membershipCount), 'num'),
      cell(String(tenant.enabledApplicationCount), 'num'),
      cell(new Date(tenant.createdAt).toLocaleDateString(), 'nowrap'),
      cell(statusBadge(tenant)),
      cell(actions, 'num'),
    );
    return tr;
  }

  function show(page, append) {
    const built = page.items.map(tenantRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
  }

  more.addEventListener('click', async function () {
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      show(await Sentinel.api('/v1/platform/tenants?cursor=' + encodeURIComponent(nextCursor)), true);
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
    Shell.setTenant(null);
    if (!me.isPlatformAdmin) {
      block('Platform Admins only', 'Only operators of SENTINEL itself can see every Tenant.');
      return;
    }
    show(await Sentinel.api('/v1/platform/tenants'), false);
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Tenants', error.message);
  });
})();
