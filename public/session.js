// Session handling shared by every page. The access token lives only in memory; the refresh
// token lives in an HttpOnly cookie that the browser sends to /v1/auth/refresh only.
(function () {
  const REFRESH_MARGIN_SECONDS = 60;
  let accessToken = null;
  let refreshTimer = null;

  async function readError(res) {
    try {
      const body = await res.json();
      return Array.isArray(body.message) ? body.message.join('. ') : body.message || res.statusText;
    } catch {
      return res.statusText;
    }
  }

  async function request(path, options) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options));
    if (!res.ok) {
      const error = new Error(await readError(res));
      error.status = res.status;
      throw error;
    }
    return res.status === 204 ? null : res.json();
  }

  function postJson(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function useTokens(body) {
    accessToken = body.accessToken;
    clearTimeout(refreshTimer);
    const delay = Math.max(body.expiresIn - REFRESH_MARGIN_SECONDS, 10) * 1000;
    refreshTimer = setTimeout(function () {
      refresh().catch(function () {
        window.location.href = '/login.html';
      });
    }, delay);
  }

  function forget() {
    accessToken = null;
    clearTimeout(refreshTimer);
  }

  // Each refresh token works once, so tabs must not refresh at the same moment with the same
  // cookie: that would look like reuse and end the login. A Web Lock makes tabs take turns,
  // and each tab then sends the cookie the previous one received.
  function withRefreshLock(fn) {
    return navigator.locks ? navigator.locks.request('sentinel-refresh', fn) : fn();
  }

  async function refresh() {
    try {
      useTokens(await withRefreshLock(function () {
        return request('/v1/auth/refresh', { method: 'POST' });
      }));
    } catch (error) {
      forget();
      throw error;
    }
  }

  async function api(path, options) {
    if (!accessToken) await refresh();
    const withAuth = function () {
      const opts = Object.assign({}, options);
      opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + accessToken });
      return request(path, opts);
    };
    try {
      return await withAuth();
    } catch (error) {
      if (error.status !== 401) throw error;
      await refresh();
      return withAuth();
    }
  }

  // Reads the access token's claims for display only; the server verifies the token on every call.
  function claims() {
    if (!accessToken) return null;
    const part = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  }

  window.Sentinel = {
    postJson: postJson,
    api: api,
    claims: claims,
    // Makes a Tenant the Active Tenant: the refresh cookie is swapped for new tokens carrying it.
    async switchTenant(tenantId) {
      useTokens(await withRefreshLock(function () {
        return request('/v1/auth/refresh/active-tenant', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: tenantId }),
        });
      }));
    },
    async login(email, password) {
      useTokens(await postJson('/v1/auth/login', { email: email, password: password }));
    },
    // Restores the session from the refresh cookie. Resolves false when not logged in.
    async resume() {
      try {
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    async logout() {
      forget();
      await request('/v1/auth/refresh', { method: 'DELETE' });
    },
    async logoutEverywhere() {
      await api('/v1/auth/logout-all', { method: 'POST' });
      forget();
    },
  };
})();
