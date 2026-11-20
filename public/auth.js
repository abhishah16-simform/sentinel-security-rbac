// The marketing panel beside the login, signup and verification forms.
(function () {
  const aside = document.getElementById('auth-aside');
  if (!aside) return;

  function feature(icon, title, text) {
    return (
      '<li><span class="feature-icon"><i data-icon="' + icon + '"></i></span>' +
      '<div><strong>' + title + '</strong><span>' + text + '</span></div></li>'
    );
  }

  aside.innerHTML =
    '<a class="brand" href="/"><span class="brand-mark"><i data-icon="shield"></i></span>SENTINEL</a>' +
    '<div class="auth-pitch">' +
    '<span class="eyebrow"><b>New</b>Multi-tenant access control</span>' +
    '<h2>Authorization your auditors will <em>actually love</em>.</h2>' +
    '<p>One login across every Tenant, fine-grained roles for every Application, and a tamper-evident audit trail built in.</p>' +
    '<ul class="feature-list">' +
    feature('building', 'Tenant isolation by default', 'Row-level security keeps every Tenant’s data apart.') +
    feature('key', 'Roles and permissions', 'Grant exactly the access each person needs, nothing more.') +
    feature('clipboardCheck', 'Compliance ready', 'Audit log, access reviews, alerts and compliance reports.') +
    '</ul></div>' +
    '<div class="auth-footnote"><span>© SENTINEL</span><span>Row-level Tenant isolation</span><span>Argon2id password hashing</span></div>';
  Icons.hydrate(aside);
})();
