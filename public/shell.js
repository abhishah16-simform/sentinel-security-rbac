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
    '/access-review.html': '/access-reviews.html',
  };
  const current = detailOf[path] || path;

  function navItem(href, icon, label) {
    const here = href === current ? ' aria-current="page"' : '';
    return '<a class="nav-item" href="' + href + '"' + here + '><i data-icon="' + icon + '"></i>' + label + '</a>';
  }

  // A page only Tenant Admins of the Active Tenant can use; moved to "Not available" for anyone else.
  function adminItem(href, icon, label) {
    return navItem(href, icon, label).replace('<a class="nav-item"', '<a class="nav-item" data-tenant-admin data-label="' + label + '"');
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
    adminItem('/members.html', 'users', 'Members') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Access control">' +
    '<div class="nav-label">Access control</div>' +
    adminItem('/roles.html', 'key', 'Roles') +
    adminItem('/permissions.html', 'lock', 'Permissions') +
    adminItem('/role-assignments.html', 'shieldCheck', 'Role assignments') +
    adminItem('/test-access.html', 'search', 'Test access') +
    adminItem('/registered-resources.html', 'list', 'Resources') +
    adminItem('/applications.html', 'grid', 'Applications') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Platform" id="platform-nav" hidden>' +
    '<div class="nav-label">Platform</div>' +
    navItem('/platform-applications.html', 'server', 'Applications') +
    navItem('/platform-tenants.html', 'building', 'Tenants') +
    '</nav>' +
    '<nav class="nav-section" aria-label="Compliance">' +
    '<div class="nav-label">Compliance</div>' +
    adminItem('/audit-log.html', 'list', 'Audit log') +
    adminItem('/expiring-access.html', 'clock', 'Expiring access') +
    adminItem('/access-reviews.html', 'clipboardCheck', 'Access reviews') +
    adminItem('/security-alerts.html', 'bell', 'Security alerts') +
    '</nav>' +
    '<details class="nav-section nav-locked" id="locked-nav" hidden>' +
    '<summary class="nav-label"><i data-icon="lock"></i><span id="locked-count">Not available</span><i data-icon="chevronRight"></i></summary>' +
    '<div id="locked-items"></div>' +
    '<p class="nav-note" id="locked-note" role="status" hidden></p>' +
    '</details>' +
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

  // ---- Pages the user can't open: collapsed under "Not available", with the reason on click ----------

  const lockedNav = document.getElementById('locked-nav');
  const lockedItems = document.getElementById('locked-items');
  const lockedNote = document.getElementById('locked-note');
  // Each Tenant Admin page remembers its place, so it can go back when access is known to allow it.
  const adminItems = Array.prototype.slice.call(sidebar.querySelectorAll('[data-tenant-admin]')).map(function (item) {
    const home = document.createComment(item.dataset.label);
    item.before(home);
    return { item: item, home: home };
  });
  let lockReason = '';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // access: { platformAdmin, tenant: { tenantName, isTenantAdmin } | null }
  function reasonFor(access) {
    if (access.tenant) {
      return 'Only Tenant Admins of ' + escapeHtml(access.tenant.tenantName) + ' can open it. Ask one of them to make you a Tenant Admin.';
    }
    if (access.platformAdmin) {
      return 'Platform Admins work outside every Tenant and can\'t see Tenant data. To manage a Tenant, join it as a member and choose it on <a href="/tenants.html">Tenants</a>.';
    }
    return 'It belongs to a Tenant. Choose one on <a href="/tenants.html">Tenants</a> first; then its Tenant Admins can open it.';
  }

  function applyAccess(access) {
    const allowed = Boolean(access.tenant && access.tenant.isTenantAdmin);
    lockReason = reasonFor(access);
    adminItems.forEach(function (entry) {
      if (allowed) {
        entry.home.after(entry.item);
        entry.item.classList.remove('locked');
        entry.item.removeAttribute('aria-describedby');
      } else {
        lockedItems.append(entry.item);
        // Still a link, so keyboards and screen readers can reach it; clicking explains instead of opening.
        entry.item.classList.add('locked');
        entry.item.setAttribute('aria-describedby', 'locked-note');
      }
    });
    // A section left with nothing but its heading is hidden.
    sidebar.querySelectorAll('nav.nav-section').forEach(function (section) {
      if (section.id === 'platform-nav') return;
      section.hidden = !section.querySelector('.nav-item');
    });
    lockedNav.hidden = allowed;
    document.getElementById('locked-count').textContent = 'Not available (' + adminItems.length + ')';
    lockedNote.hidden = true;
    // Someone who opened a locked page directly sees where it went.
    if (!allowed && lockedItems.querySelector('[aria-current="page"]')) lockedNav.open = true;
  }

  lockedItems.addEventListener('click', function (event) {
    const item = event.target.closest('a.nav-item');
    if (!item) return;
    event.preventDefault();
    lockedNote.innerHTML = '<strong>' + escapeHtml(item.dataset.label) + ' isn\'t available to you.</strong> ' + lockReason;
    lockedNote.hidden = false;
  });

  // Works out access from the session itself, so it doesn't depend on what each page passes to
  // setTenant (Platform pages always pass null).
  function resolveAccess(me) {
    const claims = Sentinel.claims();
    if (!claims || !claims.tid) {
      applyAccess({ platformAdmin: me.isPlatformAdmin, tenant: null });
      return;
    }
    Sentinel.api('/v1/tenants/current')
      .then(function (tenant) {
        applyAccess({ platformAdmin: me.isPlatformAdmin, tenant: tenant });
      })
      .catch(function () {
        // A suspended Tenant, or a Membership that just ended: treat it as no Tenant.
        applyAccess({ platformAdmin: me.isPlatformAdmin, tenant: null });
      });
  }

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
      resolveAccess(me);
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
