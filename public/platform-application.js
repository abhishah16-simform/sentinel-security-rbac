// Platform Admin console: one Application's credentials, Application Schema and Role Templates.
(function () {
  const message = document.getElementById('message');
  const schema = document.getElementById('schema');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/platform/applications/' + encodeURIComponent(id);
  // The Application as last loaded: its Schema feeds the Permission pickers on Role Templates.
  let current = null;

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
      await templates.reload();
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
    current = application;
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

  // ---------------------------------------------------------------- Role Templates

  function api(method, path, body) {
    return Sentinel.api(base + '/role-templates' + path, {
      method: method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // Runs a change to one template. It returns the updated template (re-rendered in place) or
  // nothing (the list is reloaded).
  async function templateChange(button, work, done) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const updated = await work();
      if (updated) templates.replace(updated);
      else await templates.reload();
      showMessage(message, done, 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function smallButton(label, className, ariaLabel, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className + ' small';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', function () {
      onClick(button);
    });
    return button;
  }

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  // The form that adds a Permission: allow or deny, then an Action that isn't Deprecated.
  function permissionForm(template) {
    const form = document.createElement('form');
    form.className = 'add-inline';
    const pairs = [];
    current.resourceTypes.forEach(function (resourceType) {
      if (resourceType.deprecatedAt) return;
      resourceType.actions.forEach(function (action) {
        if (!action.deprecated) pairs.push({ resourceType: resourceType.name, action: action.name });
      });
    });
    if (pairs.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'Add Resource Types and Actions to the Schema to give this template Permissions.';
      form.append(hint);
      return form;
    }
    const effect = document.createElement('select');
    effect.setAttribute('aria-label', 'Allow or deny, for a new Permission on ' + template.name);
    effect.append(option('allow', 'Allow'), option('deny', 'Deny'));
    const pair = document.createElement('select');
    pair.setAttribute('aria-label', 'Action on Resource Type, for a new Permission on ' + template.name);
    pairs.forEach(function (entry, index) {
      pair.append(option(String(index), entry.action + ' · ' + entry.resourceType));
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'secondary small';
    submit.textContent = 'Add Permission';
    form.append(effect, pair, submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const chosen = pairs[Number(pair.value)];
      const permission = { resourceType: chosen.resourceType, action: chosen.action, inverted: effect.value === 'deny' };
      templateChange(
        submit,
        function () {
          return api('POST', '/' + template.id + '/permissions', permission);
        },
        'Added "' + Permissions.describe(permission) + '" to ' + template.name + '.',
      );
    });
    return form;
  }

  function templateItem(template) {
    const li = document.createElement('li');
    li.dataset.templateId = template.id;
    const head = document.createElement('div');
    head.className = 'schema-head';
    const title = document.createElement('strong');
    title.textContent = template.name;
    const flagged = template.permissions.filter(function (permission) {
      return permission.deprecated;
    }).length;
    if (flagged > 0) title.append(' ', badge(flagged + ' Deprecated', 'warn'));
    const buttons = document.createElement('span');
    buttons.className = 'actions';
    buttons.append(
      smallButton('Edit', 'ghost', 'Rename or describe Role Template ' + template.name, function (button) {
        const name = window.prompt('Role Template name', template.name);
        if (name === null) return;
        const description = window.prompt('Description (optional)', template.description);
        if (description === null) return;
        templateChange(
          button,
          function () {
            return api('PATCH', '/' + template.id, { name: name.trim(), description: description.trim() });
          },
          'Role Template saved.',
        );
      }),
      smallButton('Delete', 'danger', 'Delete Role Template ' + template.name, function (button) {
        const prompt = 'Delete Role Template "' + template.name + '"? Tenants that already copied it keep their Role.';
        if (!window.confirm(prompt)) return;
        templateChange(
          button,
          async function () {
            await api('DELETE', '/' + template.id);
          },
          'Role Template ' + template.name + ' deleted.',
        );
      }),
    );
    head.append(title, buttons);
    if (template.description) {
      const description = document.createElement('span');
      description.className = 'description';
      description.textContent = template.description;
      head.append(description);
    }

    const chips = document.createElement('div');
    chips.className = 'chips';
    template.permissions.forEach(function (permission) {
      chips.append(
        Permissions.chip(permission, function (button) {
          templateChange(
            button,
            function () {
              return api('DELETE', '/' + template.id + '/permissions/' + permission.id);
            },
            'Removed "' + Permissions.describe(permission) + '" from ' + template.name + '.',
          );
        }),
      );
    });
    if (template.permissions.length === 0) {
      const none = document.createElement('span');
      none.className = 'hint';
      none.textContent = 'No Permissions yet.';
      chips.append(none);
    }
    li.append(head, chips, permissionForm(template));
    return li;
  }

  // The paginated list of Role Templates, oldest first.
  const templates = (function () {
    const list = document.getElementById('templates');
    const footer = document.getElementById('templates-more-footer');
    const more = document.getElementById('templates-more');
    let nextCursor = null;

    function show(page, append) {
      const items = page.items.map(templateItem);
      if (append) list.append.apply(list, items);
      else list.replaceChildren.apply(list, items);
      nextCursor = page.nextCursor;
      footer.hidden = !nextCursor;
      document.getElementById('templates-empty').hidden = list.children.length > 0;
    }

    more.addEventListener('click', async function () {
      more.disabled = true;
      more.setAttribute('aria-busy', 'true');
      try {
        show(await api('GET', '?cursor=' + encodeURIComponent(nextCursor)), true);
      } catch (error) {
        showMessage(message, error.message, 'error');
      } finally {
        more.disabled = false;
        more.removeAttribute('aria-busy');
      }
    });

    return {
      async reload() {
        show(await api('GET', ''), false);
      },
      replace(template) {
        const existing = list.querySelector('[data-template-id="' + template.id + '"]');
        if (existing) existing.replaceWith(templateItem(template));
      },
    };
  })();

  const templateForm = document.getElementById('template-form');
  handleForm(templateForm, message, async function (data) {
    const template = await api('POST', '', {
      name: String(data.get('name')).trim(),
      description: String(data.get('description') || '').trim(),
    });
    templateForm.reset();
    await templates.reload();
    showMessage(message, 'Role Template ' + template.name + ' added. Give it Permissions below.', 'success');
  });

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
    await templates.reload();
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
    await templates.reload();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load the Application', error.message);
  });
})();
