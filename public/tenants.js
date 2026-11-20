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
    const label = document.createElement('span');
    label.textContent = tenant.tenantName + (tenant.isTenantAdmin ? ' (Tenant Admin)' : '');
    li.append(label);
    if (tenant.tenantId === activeTenantId) {
      const current = document.createElement('span');
      current.textContent = 'Active';
      current.className = 'up';
      li.append(current);
      return li;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    button.textContent = 'Use this Tenant';
    button.addEventListener('click', function () {
      button.disabled = true;
      useTenant(tenant.tenantId).catch(function (error) {
        button.disabled = false;
        showMessage(message, error.message, 'error');
      });
    });
    li.append(button);
    return li;
  }

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const tenants = (await Sentinel.api('/v1/tenants')).items;
    const activeTenantId = Sentinel.claims().tid;
    document.getElementById('loading').hidden = true;
    document.getElementById('empty').hidden = tenants.length > 0;
    list.replaceChildren.apply(list, tenants.map(function (tenant) {
      return tenantRow(tenant, activeTenantId);
    }));
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
    showMessage(message, error.message, 'error');
  });
})();
