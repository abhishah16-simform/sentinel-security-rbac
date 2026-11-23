// Platform Admin console: list and register Applications.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  let nextCursor = null;

  function block(title, text) {
    document.getElementById('loading').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked').hidden = false;
  }

  function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
  }

  function applicationRow(application) {
    const link = document.createElement('a');
    link.href = '/platform-application.html?id=' + encodeURIComponent(application.id);
    link.textContent = application.name;
    const tr = document.createElement('tr');
    tr.append(
      cell(link),
      cell(application.clientId, 'mono'),
      cell(application.allowedOrigins.join(', ') || '–'),
      cell(new Date(application.createdAt).toLocaleDateString(), 'nowrap'),
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
      show(await Sentinel.api('/v1/platform/applications?cursor=' + encodeURIComponent(nextCursor)), true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  const form = document.getElementById('register-form');
  handleForm(form, message, async function (data) {
    const origins = String(data.get('allowedOrigins') || '')
      .split(/\s+/)
      .map(function (origin) {
        return origin.trim();
      })
      .filter(Boolean);
    const issued = await Sentinel.api('/v1/platform/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.get('name'), allowedOrigins: origins }),
    });
    form.reset();
    SecretReveal.show(document.getElementById('secret-box'), issued.application.clientId, issued.clientSecret);
    showMessage(message, issued.application.name + ' registered.', 'success');
    show(await Sentinel.api('/v1/platform/applications'), false);
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    Shell.setTenant(null);
    if (!me.isPlatformAdmin) {
      block('Platform Admins only', 'Only operators of SENTINEL itself can register Applications.');
      return;
    }
    show(await Sentinel.api('/v1/platform/applications'), false);
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Applications', error.message);
  });
})();
