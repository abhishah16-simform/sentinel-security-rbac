// Members page in the Tenant Admin console: Memberships, the Tenant Admin flag and Invitations.
(function () {
  const message = document.getElementById('message');
  const memberRows = document.getElementById('member-rows');
  const invitationRows = document.getElementById('invitation-rows');
  let me = null;

  function block(title, text, showLink) {
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = true;
    document.getElementById('blocked-title').textContent = title;
    document.getElementById('blocked-text').textContent = text;
    document.getElementById('blocked-link').hidden = !showLink;
    document.getElementById('blocked').hidden = false;
  }

  function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content;
    return td;
  }

  function badge(text, kind) {
    const span = document.createElement('span');
    span.className = 'badge ' + kind;
    span.textContent = text;
    return span;
  }

  // A small button that runs action, then reloads the lists. Errors show as a toast.
  function actionButton(label, className, ariaLabel, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className + ' small';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', async function () {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const done = await action();
        if (done === false) return;
        showMessage(message, done, 'success');
        await refresh();
      } catch (error) {
        showMessage(message, error.message, 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
    return button;
  }

  function memberRow(member) {
    const name = Shell.fullName(member) || member.email;
    const isYou = member.userId === me.id;
    const access = document.createElement('a');
    access.className = 'button ghost small';
    access.href = '/role-assignments.html?membership=' + encodeURIComponent(member.membershipId);
    access.textContent = 'Roles';
    access.setAttribute('aria-label', 'Roles and effective Permissions of ' + name);
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      access,
      actionButton(
        member.isTenantAdmin ? 'Remove admin' : 'Make admin',
        'ghost',
        (member.isTenantAdmin ? 'Remove the Tenant Admin flag from ' : 'Make Tenant Admin: ') + name,
        async function () {
          const makeAdmin = !member.isTenantAdmin;
          if (!makeAdmin && isYou && !window.confirm('Remove your own Tenant Admin flag? You lose access to this console.')) {
            return false;
          }
          await Sentinel.api('/v1/tenants/current/memberships/' + member.membershipId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isTenantAdmin: makeAdmin }),
          });
          return makeAdmin ? name + ' is now a Tenant Admin.' : name + ' is no longer a Tenant Admin.';
        },
      ),
      actionButton('Remove', 'danger', 'Remove ' + name + ' from this Tenant', async function () {
        const prompt = isYou ? 'Remove yourself from this Tenant?' : 'Remove ' + name + ' from this Tenant?';
        if (!window.confirm(prompt)) return false;
        await Sentinel.api('/v1/tenants/current/memberships/' + member.membershipId, { method: 'DELETE' });
        return name + ' was removed.';
      }),
    );

    const tr = document.createElement('tr');
    const who = document.createElement('span');
    who.textContent = name;
    if (isYou) who.append(' ', badge('You', 'accent'));
    tr.append(
      cell(who),
      cell(member.email),
      cell(member.isTenantAdmin ? badge('Tenant Admin', 'ok') : 'Member'),
      cell(new Date(member.joinedAt).toLocaleDateString(), 'nowrap'),
      cell(actions, 'num'),
    );
    return tr;
  }

  function invitationRow(invitation) {
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      actionButton('Resend', 'ghost', 'Resend the Invitation to ' + invitation.email, async function () {
        await Sentinel.api('/v1/tenants/current/invitations/' + invitation.id + '/resend', { method: 'POST' });
        return 'Invitation resent to ' + invitation.email + '.';
      }),
      actionButton('Cancel', 'danger', 'Cancel the Invitation to ' + invitation.email, async function () {
        if (!window.confirm('Cancel the Invitation to ' + invitation.email + '? Its link stops working.')) return false;
        await Sentinel.api('/v1/tenants/current/invitations/' + invitation.id, { method: 'DELETE' });
        return 'Invitation to ' + invitation.email + ' cancelled.';
      }),
    );
    const tr = document.createElement('tr');
    tr.append(
      cell(invitation.email),
      cell(invitation.invitedByName || '–'),
      cell(new Date(invitation.sentAt).toLocaleString(), 'nowrap'),
      cell(
        invitation.expired
          ? badge('Expired', 'warn')
          : badge('Pending until ' + new Date(invitation.expiresAt).toLocaleDateString(), 'accent'),
      ),
      cell(actions, 'num'),
    );
    return tr;
  }

  // A paginated list: rows render into tbody, and its footer's Load more button fetches the next page.
  function pagedList(path, tbody, footerId, buttonId, row) {
    const footer = document.getElementById(footerId);
    const button = document.getElementById(buttonId);
    let nextCursor = null;
    let total = 0;

    function show(page, append) {
      const rows = page.items.map(row);
      if (append) tbody.append.apply(tbody, rows);
      else tbody.replaceChildren.apply(tbody, rows);
      total = (append ? total : 0) + page.items.length;
      nextCursor = page.nextCursor;
      footer.hidden = !nextCursor;
    }

    button.addEventListener('click', async function () {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        show(await Sentinel.api(path + '?cursor=' + encodeURIComponent(nextCursor)), true);
      } catch (error) {
        showMessage(message, error.message, 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });

    return {
      async reload() {
        show(await Sentinel.api(path), false);
      },
      count() {
        return total;
      },
      hasMore() {
        return nextCursor !== null;
      },
    };
  }

  const members = pagedList('/v1/tenants/current/memberships', memberRows, 'members-more-footer', 'members-more', memberRow);
  const invitations = pagedList(
    '/v1/tenants/current/invitations',
    invitationRows,
    'invitations-more-footer',
    'invitations-more',
    invitationRow,
  );

  async function refresh() {
    try {
      await Promise.all([members.reload(), invitations.reload()]);
    } catch (error) {
      // Removing your own flag or Membership ends your access to this console.
      if (error.status === 403 || error.status === 404) {
        block('Tenant Admins only', 'You are no longer a Tenant Admin of this Tenant.', true);
        return;
      }
      throw error;
    }
    const shown = members.count() + (members.hasMore() ? '+' : '');
    document.getElementById('member-count').textContent = shown + (members.count() === 1 && !members.hasMore() ? ' member' : ' members');
    document.getElementById('invitations-empty').hidden = invitations.count() > 0;
  }

  const inviteForm = document.getElementById('invite-form');
  handleForm(inviteForm, message, async function (data) {
    const invitation = await Sentinel.api('/v1/tenants/current/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: data.get('email') }),
    });
    inviteForm.reset();
    showMessage(message, 'Invitation sent to ' + invitation.email + '.', 'success');
    await refresh();
  });

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html';
      return;
    }
    me = await Sentinel.api('/v1/me');
    Shell.setUser(me);
    if (!Sentinel.claims().tid) {
      Shell.setTenant(null);
      block('No Active Tenant', 'Members belong to a Tenant. Choose one first.', true);
      return;
    }
    const current = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(current);
    if (!current.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can manage the members of ' + current.tenantName + '.', false);
      return;
    }
    await refresh();
    document.getElementById('loading').hidden = true;
    if (document.getElementById('blocked').hidden) document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load Members', error.message, false);
  });
})();
