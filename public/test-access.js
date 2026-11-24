// Tenant Admin console: ask what an Access Check would answer for one member of the Active Tenant,
// using the Application Schema for the pickers. Runs the same gates and engine as the real check.
(function () {
  const message = document.getElementById('message');
  const form = document.getElementById('test-form');
  const memberSelect = document.getElementById('member');
  const applicationSelect = document.getElementById('application');
  const resourceTypeSelect = document.getElementById('resource-type');
  const actionSelect = document.getElementById('action');
  const params = new URLSearchParams(window.location.search);
  const schemas = new Map();
  let members = [];
  let tenant = null;

  const REASONS = {
    'matched-allow': 'Allowed by this Permission.',
    'matched-deny': 'Denied by this Deny Rule. A matching deny always wins over any allow.',
    'no-matching-permission': 'Denied: none of the member’s active Roles in this Application has a Permission that matches.',
    'tenant-suspended': 'Denied: this Tenant is suspended, so every Access Check in it is denied.',
    'application-not-enabled': 'Denied: this Tenant has not enabled the Application.',
    'no-membership': 'Denied: the member is no longer in this Tenant.',
  };

  function block(title, text, showLink) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked-link').hidden = !showLink;
    document.getElementById('blocked').hidden = false;
  }

  function option(value, text) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = text;
    return element;
  }

  function badge(text, kind) {
    const span = document.createElement('span');
    span.className = 'badge ' + kind;
    span.textContent = text;
    return span;
  }

  function memberName(member) {
    return Shell.fullName(member) || member.email;
  }

  // Follows a paginated list to its end.
  async function all(path) {
    const items = [];
    let cursor = null;
    do {
      const page = await Sentinel.api(path + '?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      items.push.apply(items, page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  function withDeprecated(entry) {
    return entry.name + (entry.deprecated ? ' (Deprecated)' : '');
  }

  function fillActions() {
    const schema = schemas.get(applicationSelect.value) || [];
    const resourceType = schema.find(function (entry) {
      return entry.name === resourceTypeSelect.value;
    });
    actionSelect.replaceChildren.apply(
      actionSelect,
      (resourceType ? resourceType.actions : []).map(function (action) {
        return option(action.name, withDeprecated(action));
      }),
    );
  }

  function fillResourceTypes() {
    const schema = schemas.get(applicationSelect.value) || [];
    resourceTypeSelect.replaceChildren.apply(
      resourceTypeSelect,
      schema.map(function (resourceType) {
        return option(resourceType.name, withDeprecated(resourceType));
      }),
    );
    fillActions();
  }

  // What the Condition placeholders stand for when testing the chosen member.
  function showPlaceholders() {
    const member = members.find(function (entry) {
      return entry.membershipId === memberSelect.value;
    });
    document.getElementById('placeholders').textContent = member
      ? 'For this member, ${user.id} is ' + member.userId + ', ${membership.id} is ' + member.membershipId +
        ' and ${tenant.id} is ' + tenant.tenantId + '.'
      : '';
  }

  function parseAttributes(text) {
    if (!text.trim()) return undefined;
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('Resource attributes must be valid JSON.');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Resource attributes must be a JSON object, such as { "ownerId": "…" }.');
    }
    return value;
  }

  // The Role and Permission that settled the answer, read from the Tenant's Roles.
  async function showMatch(result) {
    const match = document.getElementById('answer-match');
    match.hidden = true;
    if (!result.roleId) return;
    const role = await Sentinel.api('/v1/tenants/current/roles/' + encodeURIComponent(result.roleId));
    const permission = role.permissions.find(function (entry) {
      return entry.id === result.permissionId;
    });
    const link = document.getElementById('answer-role');
    link.href = '/role.html?id=' + encodeURIComponent(role.id);
    link.textContent = role.name;
    const described = document.getElementById('answer-permission');
    described.replaceChildren();
    if (permission) {
      described.append(
        badge(permission.inverted ? 'Deny' : 'Allow', permission.inverted ? 'bad' : 'ok'),
        ' ' + permission.action + ' · ' + permission.resourceType,
      );
    }
    document.getElementById('answer-condition').textContent =
      permission && permission.conditions ? JSON.stringify(permission.conditions) : 'Every resource';
    match.hidden = false;
  }

  async function showAnswer(question, result) {
    const member = members.find(function (entry) {
      return entry.membershipId === question.membershipId;
    });
    document.getElementById('answer-question').textContent =
      'May ' + (member ? memberName(member) : 'this member') + ' ' + question.action + ' ' + question.resourceType +
      (question.resource && question.resource.id ? ' ' + question.resource.id : '') + ' in ' +
      applicationSelect.selectedOptions[0].textContent + '?';
    document
      .getElementById('answer-badge')
      .replaceChildren(badge(result.allowed ? 'Allowed' : 'Denied', result.allowed ? 'ok' : 'bad'));
    document.getElementById('answer-reason').textContent =
      (REASONS[result.reason] || result.reason) + ' (reason: ' + result.reason + ')';
    document.getElementById('answer').hidden = false;
    // The answer stands on its own; the Role's details are extra, so failing to load them is only a toast.
    try {
      await showMatch(result);
    } catch (error) {
      showMessage(message, 'Could not load Role ' + result.roleId + ': ' + error.message, 'error');
    }
  }

  memberSelect.addEventListener('change', showPlaceholders);
  applicationSelect.addEventListener('change', fillResourceTypes);
  resourceTypeSelect.addEventListener('change', fillActions);

  handleForm(form, message, async function (data) {
    // Never leave the previous answer next to a new question that fails.
    document.getElementById('answer').hidden = true;
    const attributes = parseAttributes(String(data.get('attributes') || ''));
    const resourceId = String(data.get('resourceId') || '').trim();
    const question = {
      membershipId: String(data.get('membershipId')),
      applicationId: String(data.get('applicationId')),
      resourceType: String(data.get('resourceType')),
      action: String(data.get('action')),
    };
    if (attributes || resourceId) {
      question.resource = {};
      if (resourceId) question.resource.id = resourceId;
      if (attributes) question.resource.attributes = attributes;
    }
    const result = await Sentinel.api('/v1/tenants/current/test-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question),
    });
    await showAnswer(question, result);
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    const me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Access is tested inside a Tenant. Choose one first.', true);
      return;
    }
    tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can test access in ' + tenant.tenantName + '.', false);
      return;
    }
    const [memberships, applications] = await Promise.all([
      all('/v1/tenants/current/memberships'),
      all('/v1/tenants/current/applications'),
    ]);
    members = memberships;
    members.forEach(function (member) {
      const label = memberName(member) + (member.userId === me.id ? ' (you)' : '') + ' · ' + member.email;
      memberSelect.append(option(member.membershipId, label));
    });

    // Every Application whose Schema has Resource Types; disabled ones stay, so their denial can be seen.
    const details = await Promise.all(
      applications.map(function (application) {
        return Sentinel.api('/v1/tenants/current/applications/' + encodeURIComponent(application.id));
      }),
    );
    details.forEach(function (application) {
      if (application.resourceTypes.length === 0) return;
      schemas.set(application.id, application.resourceTypes);
      applicationSelect.append(option(application.id, application.name + (application.enabled ? '' : ' (not enabled)')));
    });
    const hasApplications = schemas.size > 0;
    form.hidden = !hasApplications;
    document.getElementById('no-applications').hidden = hasApplications;

    const membership = params.get('membership');
    if (membership && members.some(function (member) {
        return member.membershipId === membership;
      })) {
      memberSelect.value = membership;
    }
    fillResourceTypes();
    showPlaceholders();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Test Access', error.message, false);
  });
})();
