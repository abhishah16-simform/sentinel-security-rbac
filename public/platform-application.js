// Platform Admin console: one Application's credentials and Application Schema.
(function () {
  const message = document.getElementById('message');
  const schema = document.getElementById('schema');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/platform/applications/' + encodeURIComponent(id);

  function block(title, text) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked').hidden = false;
  }

  function post(path, body) {
    return Sentinel.api(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function badge(text, kind) {
    const span = document.createElement('span');
    span.className = 'badge ' + kind;
    span.textContent = text;
    return span;
  }

  // Runs a change that returns the updated Application, then re-renders it.
  async function change(button, work, done) {
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      render(await work());
      if (done) showMessage(message, done, 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  function actionChip(resourceType, action) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (action.deprecated ? ' deprecated' : '');
    chip.textContent = action.name;
    if (action.deprecated) {
      chip.title = 'Deprecated';
      return chip;
    }
    const deprecate = document.createElement('button');
    deprecate.type = 'button';
    deprecate.className = 'ghost';
    deprecate.textContent = 'Deprecate';
    deprecate.setAttribute('aria-label', 'Deprecate Action ' + action.name + ' on ' + resourceType.name);
    deprecate.addEventListener('click', function () {
      if (!window.confirm('Deprecate Action "' + action.name + '"? No new Permissions can use it. This cannot be undone.')) return;
      change(
        deprecate,
        function () {
          return post('/resource-types/' + resourceType.id + '/actions/' + action.id + '/deprecate');
        },
        'Action ' + action.name + ' Deprecated.',
      );
    });
    chip.append(deprecate);
    return chip;
  }

  function resourceTypeItem(resourceType) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'schema-head';
    const title = document.createElement('strong');
    title.textContent = resourceType.name;
    if (resourceType.deprecatedAt) title.append(' ', badge('Deprecated', 'warn'));
    head.append(title);

    if (!resourceType.deprecatedAt) {
      const deprecate = document.createElement('button');
      deprecate.type = 'button';
      deprecate.className = 'ghost small';
      deprecate.textContent = 'Deprecate';
      deprecate.setAttribute('aria-label', 'Deprecate Resource Type ' + resourceType.name);
      deprecate.addEventListener('click', function () {
        const prompt = 'Deprecate Resource Type "' + resourceType.name + '" and all its Actions? This cannot be undone.';
        if (!window.confirm(prompt)) return;
        change(
          deprecate,
          function () {
            return post('/resource-types/' + resourceType.id + '/deprecate');
          },
          resourceType.name + ' Deprecated.',
        );
      });
      head.append(deprecate);
    }

    const chips = document.createElement('div');
    chips.className = 'chips';
    resourceType.actions.forEach(function (action) {
      chips.append(actionChip(resourceType, action));
    });
    if (resourceType.actions.length === 0) {
      const none = document.createElement('span');
      none.className = 'hint';
      none.textContent = 'No Actions yet.';
      chips.append(none);
    }
    li.append(head, chips);

    if (!resourceType.deprecatedAt) {
      const form = document.createElement('form');
      form.className = 'add-inline';
      const input = document.createElement('input');
      input.name = 'name';
      input.required = true;
      input.maxLength = 64;
      input.autocomplete = 'off';
      input.placeholder = 'New Action';
      input.setAttribute('aria-label', 'New Action on ' + resourceType.name);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'secondary small';
      submit.textContent = 'Add Action';
      form.append(input, submit);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        const name = input.value.trim();
        change(
          submit,
          function () {
            return post('/resource-types/' + resourceType.id + '/actions', { name: name });
          },
          'Action ' + name + ' added to ' + resourceType.name + '.',
        );
      });
      li.append(form);
    }
    return li;
  }

  function render(application) {
    document.title = application.name + ' · SENTINEL';
    document.getElementById('app-name').textContent = application.name;
    document.getElementById('crumb-name').textContent = application.name;
    document.getElementById('client-id').textContent = application.clientId;
    document.getElementById('origins').textContent = application.allowedOrigins.join(', ') || 'None';
    document.getElementById('registered').textContent = new Date(application.createdAt).toLocaleString();
    document.getElementById('secret-issued').textContent =
      'Current secret issued ' + new Date(application.secretIssuedAt).toLocaleString() + '. Only its hash is stored.';
    schema.replaceChildren.apply(schema, application.resourceTypes.map(resourceTypeItem));
    document.getElementById('schema-empty').hidden = application.resourceTypes.length > 0;
  }

  const rotate = document.getElementById('rotate');
  rotate.addEventListener('click', async function () {
    if (!window.confirm('Issue a new client secret? The current one stops working immediately.')) return;
    rotate.disabled = true;
    rotate.setAttribute('aria-busy', 'true');
    try {
      const issued = await post('/secret');
      render(issued.application);
      SecretReveal.show(document.getElementById('secret-box'), issued.application.clientId, issued.clientSecret);
      showMessage(message, 'Secret rotated. The old one no longer works.', 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      rotate.disabled = false;
      rotate.removeAttribute('aria-busy');
    }
  });

  const resourceTypeForm = document.getElementById('resource-type-form');
  handleForm(resourceTypeForm, message, async function (data) {
    const actions = String(data.get('actions') || '')
      .split(/[\s,]+/)
      .filter(Boolean);
    const name = String(data.get('name')).trim();
    render(await post('/resource-types', { name: name, actions: actions }));
    resourceTypeForm.reset();
    showMessage(message, 'Resource Type ' + name + ' added.', 'success');
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
      block('Platform Admins only', 'Only operators of SENTINEL itself can manage Applications.');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      block('Application not found', 'Open an Application from the list.');
      return;
    }
    render(await Sentinel.api(base));
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the Application', error.message);
  });
})();
