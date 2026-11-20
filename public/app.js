(function () {
  const list = document.getElementById('status');

  function row(name, isUp) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('span');
    value.textContent = isUp ? 'Up' : 'Down';
    value.className = isUp ? 'up' : 'down';
    li.append(label, value);
    return li;
  }

  fetch('/v1/health')
    .then(function (res) {
      return res.json();
    })
    .then(function (body) {
      list.replaceChildren(row('API', true));
      const checks = Object.assign({}, body.info, body.error);
      Object.keys(checks).forEach(function (name) {
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        list.append(row(label, checks[name].status === 'up'));
      });
    })
    .catch(function () {
      list.replaceChildren(row('API', false));
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

  // Accounts created before names existed have empty names: hide the row and offer to add one.
  function showName(me) {
    const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ');
    document.getElementById('me-name').textContent = fullName;
    document.getElementById('name-row').hidden = !fullName;
    editName.textContent = fullName ? 'Edit name' : 'Add your name';
    nameForm.elements.firstName.value = me.firstName;
    nameForm.elements.lastName.value = me.lastName;
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

  function showLoggedOut() {
    loading.hidden = true;
    loggedIn.hidden = true;
    loggedOut.hidden = false;
  }

  async function showAccount() {
    if (!(await Sentinel.resume())) {
      showLoggedOut();
      return;
    }
    const me = await Sentinel.api('/v1/me');
    showName(me);
    document.getElementById('me-email').textContent = me.email;
    const verified = document.getElementById('me-verified');
    verified.textContent = me.emailVerified ? 'Yes' : 'No';
    verified.className = me.emailVerified ? 'up' : 'down';
    resend.hidden = me.emailVerified;
    const activeTenant = document.getElementById('active-tenant');
    if (Sentinel.claims().tid) {
      const current = await Sentinel.api('/v1/tenants/current');
      activeTenant.textContent = current.tenantName + (current.isTenantAdmin ? ' (Tenant Admin)' : '');
      document.getElementById('tenant-link').textContent = 'Switch Tenant';
    } else {
      activeTenant.textContent = 'None';
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
