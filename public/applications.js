// Tenant Admin console: browse registered Applications, and enable or disable them for the Tenant.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const base = '/v1/tenants/current/applications';
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

  function status(application) {
    if (application.enabled) return badge('Enabled', 'ok');
    if (application.disabledAt) return badge('Disabled', 'warn');
    return 'Not enabled';
  }

  function cleanUp(application) {
    const count = application.deprecatedPermissions;
    if (count === 0) return '–';
    return badge(count + (count === 1 ? ' Deprecated Permission' : ' Deprecated Permissions'), 'warn');
  }

  function toggleButton(application) {
    const enable = !application.enabled;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = (enable ? 'secondary' : 'danger') + ' small';
    button.textContent = enable ? 'Enable' : 'Disable';
    button.setAttribute('aria-label', (enable ? 'Enable ' : 'Disable ') + application.name);
    button.addEventListener('click', async function () {
      if (!enable && !window.confirm('Disable ' + application.name + '? Your Users lose access to it. Your Roles for it are kept.')) {
        return;
      }
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const detail = await Sentinel.api(base + '/' + application.id + '/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
        rows.querySelector('[data-application-id="' + application.id + '"]').replaceWith(applicationRow(detail));
        showMessage(message, application.name + (enable ? ' enabled.' : ' disabled. Its Roles are kept.'), 'success');
      } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
    return button;
  }

  function applicationRow(application) {
    const link = document.createElement('a');
    link.href = '/application.html?id=' + encodeURIComponent(application.id);
    link.textContent = application.name;
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(toggleButton(application));
    const tr = document.createElement('tr');
    tr.dataset.applicationId = application.id;
    tr.append(
      cell(link),
      cell(status(application)),
      cell(cleanUp(application)),
      cell(new Date(application.registeredAt).toLocaleDateString(), 'nowrap'),
      cell(actions, 'num'),
    );
    return tr;
  }

  function show(page, append) {
    const built = page.items.map(applicationRow);
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
      show(await Sentinel.api(base + '?cursor=' + encodeURIComponent(nextCursor)), true);
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
      block('No Active Tenant', 'Applications are enabled per Tenant. Choose one first.', true);
      return;
    }
    const current = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(current);
    if (!current.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can choose the Applications ' + current.tenantName + ' uses.', false);
      return;
    }
    show(await Sentinel.api(base), false);
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Applications', error.message, false);
  });
})();
