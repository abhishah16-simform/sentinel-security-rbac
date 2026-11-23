// Invitations inbox: pending Invitations to the logged-in User's email, to accept or decline.
(function () {
  const list = document.getElementById('invitation-list');
  const message = document.getElementById('message');

  function busy(buttons, on) {
    buttons.forEach(function (button) {
      button.disabled = on;
    });
  }

  function actionButton(label, className, ariaLabel, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className + ' small';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', onClick);
    return button;
  }

  function invitationRow(invitation) {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'tenant';
    const avatar = document.createElement('span');
    avatar.className = 'tenant-avatar';
    avatar.textContent = Shell.initials(invitation.tenantName);
    const text = document.createElement('span');
    text.className = 'tenant-text';
    const name = document.createElement('strong');
    name.textContent = invitation.tenantName;
    const detail = document.createElement('small');
    detail.textContent =
      (invitation.invitedByName ? 'From ' + invitation.invitedByName + ' · ' : '') +
      'expires ' + new Date(invitation.expiresAt).toLocaleDateString();
    text.append(name, detail);
    info.append(avatar, text);

    const end = document.createElement('span');
    end.className = 'actions';
    const buttons = [];
    const accept = actionButton('Accept', 'secondary', 'Accept the Invitation to ' + invitation.tenantName, async function () {
      busy(buttons, true);
      accept.setAttribute('aria-busy', 'true');
      try {
        const membership = await Sentinel.api('/v1/me/invitations/' + invitation.id + '/accept', { method: 'POST' });
        end.replaceChildren(
          actionButton('Switch to it', 'secondary', 'Switch to ' + membership.tenantName, async function () {
            await Sentinel.switchTenant(membership.tenantId);
            window.location.href = '/';
          }),
        );
        detail.textContent = 'You joined ' + membership.tenantName + '.';
        showMessage(message, 'You are now a member of ' + membership.tenantName + '.', 'success');
      } catch (error) {
        busy(buttons, false);
        accept.removeAttribute('aria-busy');
        showMessage(message, error.message, 'error');
      }
    });
    const decline = actionButton('Decline', 'ghost', 'Decline the Invitation to ' + invitation.tenantName, async function () {
      if (!window.confirm('Decline the Invitation to ' + invitation.tenantName + '?')) return;
      busy(buttons, true);
      try {
        await Sentinel.api('/v1/me/invitations/' + invitation.id + '/decline', { method: 'POST' });
        li.remove();
        showMessage(message, 'Invitation to ' + invitation.tenantName + ' declined.', 'success');
        updateCount();
      } catch (error) {
        busy(buttons, false);
        showMessage(message, error.message, 'error');
      }
    });
    buttons.push(accept, decline);
    end.append(decline, accept);
    li.append(info, end);
    return li;
  }

  function updateCount() {
    const count = list.children.length;
    const badge = document.getElementById('invitation-count');
    badge.textContent = count + ' pending';
    badge.hidden = count === 0;
    document.getElementById('empty').hidden = count > 0;
  }

  async function load() {
    if (!(await Sentinel.resume())) {
      window.location.href = '/login.html?next=invitations';
      return;
    }
    const [me, invitations] = await Promise.all([Sentinel.api('/v1/me'), Sentinel.api('/v1/me/invitations')]);
    Shell.setUser(me);
    const current = Sentinel.claims().tid
      ? await Sentinel.api('/v1/tenants/current').catch(function () {
          return null;
        })
      : null;
    Shell.setTenant(current);

    document.getElementById('loading').hidden = true;
    list.replaceChildren.apply(list, invitations.items.map(invitationRow));
    updateCount();
    if (!me.emailVerified && invitations.items.length > 0) {
      showMessage(message, 'Verify your email address before accepting an Invitation.', 'error');
    }
  }

  load().catch(function (error) {
    document.getElementById('loading').hidden = true;
    showMessage(message, error.message, 'error');
  });
})();
