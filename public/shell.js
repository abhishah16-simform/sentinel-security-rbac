// The signed-in app shell: sidebar navigation, Tenant switcher, user menu, header health pill.
// Pages put <aside class="sidebar" id="sidebar"></aside> in their markup and call Shell.setUser
// and Shell.setTenant once they know who is logged in.
(function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const path = window.location.pathname === '/' ? '/index.html' : window.location.pathname;
  // Detail pages highlight the list they belong to.
  const detailOf = {
    '/platform-application.html': '/platform-applications.html',
    '/application.html': '/applications.html',
    '/role.html': '/roles.html',
    '/registered-resource.html': '/registered-resources.html',
  };
  const current = detailOf[path] || path;

  function navItem(href, icon, label) {
    const here = href === current ? ' aria-current="page"' : '';
    return '<a class="nav-item" href="' + href + '"' + here + '><i data-icon="' + icon + '"></i>' + label + '</a>';
  }

  function soonItem(icon, label) {
    return (
      '<span class="nav-item" aria-disabled="true"><i data-icon="' + icon + '"></i>' + label +
      '<span class="soon">Soon</span></span>'
    );
  }

  sidebar.innerHTML =
    '<a class="brand" href="/"><span class="brand-mark"><i data-icon="shield"></i></span>SENTINEL</a>' +
    '<a class="workspace none" id="workspace" href="/tenants.html" title="Switch Tenant">' +
    '<span class="workspace-avatar" id="workspace-avatar">–</span>' +
    '<span class="workspace-text"><small>Tenant</small><span id="workspace-name">No Tenant selected</span></span>' +
    '<i data-icon="chevronsUpDown"></i></a>' +
    '<nav class="nav-section" aria-label="Main">' +
    navItem('/index.html', 'home', 'Overview') +
    navItem('/tenants.html', 'building', 'Tenants') +
    navItem('/invitations.html', 'mail', 'Invitations') +
    navItem('/members.html', 'users', 'Members') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Access control">' +
    '<div class="nav-label">Access control</div>' +
    navItem('/roles.html', 'key', 'Roles') +
    navItem('/permissions.html', 'lock', 'Permissions') +
    navItem('/role-assignments.html', 'shieldCheck', 'Role assignments') +
    navItem('/test-access.html', 'search', 'Test access') +
    navItem('/registered-resources.html', 'list', 'Resources') +
    navItem('/applications.html', 'grid', 'Applications') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Platform" id="platform-nav" hidden>' +
    '<div class="nav-label">Platform</div>' +
    navItem('/platform-applications.html', 'server', 'Applications') +
    navItem('/platform-tenants.html', 'building', 'Tenants') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Compliance">' +
    '<div class="nav-label">Compliance</div>' +
    navItem('/audit-log.html', 'list', 'Audit log') +
    soonItem('clipboardCheck', 'Access reviews') +
    soonItem('bell', 'Alerts') +
    '</nav>' +
    '<div class="sidebar-footer"><details class="user-menu" id="user-menu">' +
    '<summary><span class="avatar" id="user-avatar"></span>' +
    '<span class="user-text"><strong id="user-name"></strong><span id="user-email"></span></span>' +
    '<i data-icon="chevronsUpDown"></i></summary>' +
    '<div class="menu-panel" role="menu">' +
    '<a class="menu-item" role="menuitem" href="/index.html#profile"><i data-icon="user"></i>Account</a>' +
    '<a class="menu-item" role="menuitem" href="/tenants.html"><i data-icon="building"></i>Switch Tenant</a>' +
    '<div class="menu-divider"></div>' +
    '<button class="menu-item danger" role="menuitem" type="button" id="menu-logout"><i data-icon="logout"></i>Log out</button>' +
    '</div></details></div>';
  Icons.hydrate(sidebar);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  sidebar.after(backdrop);

  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', open);
  }
  backdrop.addEventListener('click', function () {
    setSidebarOpen(false);
  });
  document.querySelectorAll('[data-sidebar-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      setSidebarOpen(!document.body.classList.contains('sidebar-open'));
    });
  });

  const userMenu = document.getElementById('user-menu');
  document.addEventListener('click', function (event) {
    if (userMenu.open && !userMenu.contains(event.target)) userMenu.open = false;
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    userMenu.open = false;
    setSidebarOpen(false);
  });

  document.getElementById('menu-logout').addEventListener('click', async function () {
    try {
      await Sentinel.logout();
    } finally {
      window.location.href = '/login.html';
    }
  });

  function initials(text) {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  function fullName(me) {
    return [me.firstName, me.lastName].filter(Boolean).join(' ');
  }

  // Header health pill: one quiet indicator that every page shares.
  const healthPill = document.getElementById('health-pill');
  if (healthPill) {
    fetch('/v1/health')
      .then(function (res) {
        return res.json().then(function (body) {
          return res.ok && body.status === 'ok';
        });
      })
      .catch(function () {
        return false;
      })
      .then(function (healthy) {
        healthPill.textContent = healthy ? 'All systems normal' : 'Degraded';
        healthPill.className = 'badge ' + (healthy ? 'ok' : 'bad');
        healthPill.hidden = false;
      });
  }

  window.Shell = {
    initials: initials,
    fullName: fullName,
    setUser(me) {
      document.getElementById('platform-nav').hidden = !me.isPlatformAdmin;
      const name = fullName(me);
      document.getElementById('user-avatar').textContent = initials(name || me.email);
      document.getElementById('user-name').textContent = name || me.email;
      document.getElementById('user-email').textContent = name ? me.email : 'Add your name in Account';
    },
    // tenant: { tenantName, isTenantAdmin } or null when no Active Tenant is chosen.
    setTenant(tenant) {
      const workspace = document.getElementById('workspace');
      workspace.classList.toggle('none', !tenant);
      document.getElementById('workspace-avatar').textContent = tenant ? initials(tenant.tenantName) : '–';
      document.getElementById('workspace-name').textContent = tenant ? tenant.tenantName : 'No Tenant selected';
      document.querySelectorAll('[data-crumb-tenant]').forEach(function (el) {
        el.textContent = tenant ? tenant.tenantName : 'Personal';
      });
    },
  };
})();
