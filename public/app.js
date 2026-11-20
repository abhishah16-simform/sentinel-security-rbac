// Overview page: system status, the logged-in User's account and Active Tenant.
(function () {
  const list = document.getElementById('status');
  const apiStat = document.getElementById('stat-api');

  function row(name, isUp) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('span');
    const badge = document.createElement('span');
    badge.textContent = isUp ? 'Operational' : 'Down';
    badge.className = isUp ? 'up' : 'down';
    value.append(badge);
    li.append(label, value);
    return li;
  }

  function setApiStat(healthy) {
    apiStat.textContent = healthy ? 'Operational' : 'Degraded';
    apiStat.className = 'badge ' + (healthy ? 'ok' : 'bad');
  }

  fetch('/v1/health')
    .then(function (res) {
      return res.json();
    })
    .then(function (body) {
      list.replaceChildren(row('API', true));
      const checks = Object.assign({}, body.info, body.error);
      let healthy = true;
      Object.keys(checks).forEach(function (name) {
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        const up = checks[name].status === 'up';
        healthy = healthy && up;
        list.append(row(label, up));
      });
      setApiStat(healthy);
    })
    .catch(function () {
      list.replaceChildren(row('API', false));
      setApiStat(false);
    });
})();

(function () {
  const loading = document.getElementById('account-loading');
  const loggedOut = document.getElementById('logged-out');
  const loggedIn = document.getElementById('logged-in');
  const message = document.getElementById('message');
  const resend = document.getElementById('resend');
  const nameForm = document.getElementById('name-form');
  const editName = document.getElementById('edit-name');

  function showLoggedOut() {
    loading.hidden = true;
    loggedIn.hidden = true;
    loggedOut.hidden = false;
  }

  // Accounts created before names existed have empty names: hide the row and offer to add one.
  function showName(me) {
    const fullName = Shell.fullName(me);
    document.getElementById('me-name').textContent = fullName;
    document.getElementById('name-row').hidden = !fullName;
    document.getElementById('greeting').textContent = me.firstName ? ', ' + me.firstName : '';
    document.getElementById('profile-name').textContent = fullName || 'Add your name';
    document.getElementById('profile-email').textContent = me.email;
    document.getElementById('profile-avatar').textContent = Shell.initials(fullName || me.email);
    editName.lastChild.textContent = fullName ? 'Edit name' : 'Add your name';
    nameForm.elements.firstName.value = me.firstName;
    nameForm.elements.lastName.value = me.lastName;
    Shell.setUser(me);
  }

  function toggleNameForm(open) {
    nameForm.hidden = !open;
    editName.hidden = open;
    if (open) nameForm.elements.firstName.focus();
  }

  editName.addEventListener('click', function () {
    toggleNameForm(true);
  });
  document.getElementById('cancel-name').addEventListener('click', function () {
    toggleNameForm(false);
  });
  handleForm(nameForm, message, async function (data) {
    const me = await Sentinel.api('/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: data.get('firstName'), lastName: data.get('lastName') }),
    });
    showName(me);
    toggleNameForm(false);
    showMessage(message, 'Your name is saved.', 'success');
  });

  async function showAccount() {
    if (!(await Sentinel.resume())) {
      showLoggedOut();
      return;
    }
    const me = await Sentinel.api('/v1/me');
    showName(me);
    document.getElementById('me-email').textContent = me.email;
    document.getElementById('me-id').textContent = me.id;
    document.getElementById('me-type').textContent = me.isPlatformAdmin ? 'Platform Admin' : 'Standard';
    const verified = document.getElementById('me-verified');
    verified.textContent = me.emailVerified ? 'Verified' : 'Unverified';
    verified.className = 'badge ' + (me.emailVerified ? 'ok' : 'warn');
    resend.hidden = me.emailVerified;
    document.getElementById('verify-footer').hidden = me.emailVerified;

    const activeTenant = document.getElementById('active-tenant');
    const role = document.getElementById('stat-role');
    const tenantLink = document.getElementById('tenant-link');
    if (Sentinel.claims().tid) {
      const current = await Sentinel.api('/v1/tenants/current');
      activeTenant.textContent = current.tenantName;
      role.textContent = current.isTenantAdmin ? 'Tenant Admin' : 'Member';
      tenantLink.lastChild.textContent = 'Switch Tenant';
      Shell.setTenant(current);
    } else {
      activeTenant.textContent = 'None selected';
      role.textContent = '–';
      Shell.setTenant(null);
    }
    resend.onclick = async function () {
      resend.disabled = true;
      try {
        const body = await Sentinel.postJson('/v1/auth/resend-verification', { email: me.email });
        showMessage(message, body.message, 'success');
      } catch (error) {
        showMessage(message, error.message, 'error');
      } finally {
        resend.disabled = false;
      }
    };
    loading.hidden = true;
    loggedIn.hidden = false;
    if (window.location.hash === '#profile') document.getElementById('profile').scrollIntoView();
  }

  async function run(action, doneText) {
    try {
      await action();
      showLoggedOut();
      showMessage(message, doneText, 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  }

  document.getElementById('logout').addEventListener('click', function () {
    run(Sentinel.logout, 'You are logged out on this device.');
  });
  document.getElementById('logout-all').addEventListener('click', function () {
    run(Sentinel.logoutEverywhere, 'You are logged out on every device.');
  });

  showAccount().catch(function (error) {
    showLoggedOut();
    showMessage(message, error.message, 'error');
  });
})();
