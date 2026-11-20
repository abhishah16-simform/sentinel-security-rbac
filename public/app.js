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
    document.getElementById('me-email').textContent = me.email;
    const verified = document.getElementById('me-verified');
    verified.textContent = me.emailVerified ? 'Yes' : 'No';
    verified.className = me.emailVerified ? 'up' : 'down';
    resend.hidden = me.emailVerified;
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
