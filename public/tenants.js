// Tenant picker and switcher, plus creating a Tenant.
(function () {
  const list = document.getElementById('tenant-list');
  const message = document.getElementById('message');

  async function useTenant(tenantId) {
    await Sentinel.switchTenant(tenantId);
    window.location.href = '/';
  }

  function tenantRow(tenant, activeTenantId) {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'tenant';
    const avatar = document.createElement('span');
    avatar.className = 'tenant-avatar';
    avatar.textContent = Shell.initials(tenant.tenantName);
    const text = document.createElement('span');
    text.className = 'tenant-text';
    const name = document.createElement('strong');
    name.textContent = tenant.tenantName;
    const role = document.createElement('small');
    role.textContent = tenant.isTenantAdmin ? 'Tenant Admin' : 'Member';
    text.append(name, role);
    info.append(avatar, text);
    li.append(info);

    const end = document.createElement('span');
    if (tenant.tenantId === activeTenantId) {
      const current = document.createElement('span');
      current.textContent = 'Active';
      current.className = 'badge ok';
      end.append(current);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary small';
      button.textContent = 'Switch';
      button.setAttribute('aria-label', 'Switch to ' + tenant.tenantName);
      button.addEventListener('click', function () {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        useTenant(tenant.tenantId).catch(function (error) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          showMessage(message, error.message, 'error');
        });
      });
      end.append(button);
    }
    li.append(end);
    return li;
  }

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const [me, tenants] = await Promise.all([Sentinel.api('/v1/me'), Sentinel.api('/v1/tenants')]);
    Shell.setUser(me);
    const activeTenantId = Sentinel.claims().tid;
    const active = tenants.items.find(function (tenant) {
      return tenant.tenantId === activeTenantId;
    });
    Shell.setTenant(active || null);

    document.getElementById('loading').hidden = true;
    document.getElementById('empty').hidden = tenants.items.length > 0;
    const count = document.getElementById('tenant-count');
    count.textContent = tenants.items.length + (tenants.items.length === 1 ? ' Tenant' : ' Tenants');
    count.hidden = tenants.items.length === 0;
    list.replaceChildren.apply(
      list,
      tenants.items.map(function (tenant) {
        return tenantRow(tenant, activeTenantId);
      }),
    );
  }

  handleForm(document.getElementById('create-form'), message, async function (data) {
    const created = await Sentinel.api('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.get('name') }),
    });
    await useTenant(created.tenantId);
  });

  load().catch(function (error) {
    document.getElementById('loading').hidden = true;
    showMessage(message, error.message, 'error');
  });
})();
