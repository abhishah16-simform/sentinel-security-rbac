// Tenant Admin console: one Access Review. Its progress, its items with a Certify or Revoke decision
// for each until the due date, and, once closed, the outcome report: each item's result and who
// decided it.
(function () {
  const message = document.getElementById('message');
  const rows = document.getElementById('rows');
  const more = document.getElementById('more');
  const filterOutcome = document.getElementById('filter-outcome');
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const base = '/v1/tenants/current/access-reviews/' + encodeURIComponent(id);
  let review = null;
  let nextCursor = null;
  let me = null;
  // Bumped on every refresh, so a late answer for an older filter is dropped.
  let generation = 0;

  const OUTCOMES = {
    pending: ['Pending', 'accent'],
    certified: ['Certified', 'ok'],
    revoked: ['Revoked', 'bad'],
    'auto-revoked': ['Auto-revoked', 'warn'],
  };

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

  function memberName(member) {
    return Shell.fullName(member) || member.email;
  }

  // Decisions are taken while the review is open and before its due date.
  function decidable() {
    return review.status === 'open' && new Date(review.dueAt).getTime() > Date.now();
  }

  function showReview() {
    const application = review.application.name;
    document.title = 'Access Review of ' + application + ' · SENTINEL';
    document.getElementById('review-name').textContent = 'Access Review of ' + application;
    document.getElementById('crumb-review').textContent = application;
    document.getElementById('review-subtitle').textContent =
      'Started ' + new Date(review.createdAt).toLocaleString() + (review.startedByName ? ' by ' + review.startedByName : '') +
      ' · due ' + new Date(review.dueAt).toLocaleString();
    document.getElementById('by-resource').href =
      '/registered-resources.html?applicationId=' + encodeURIComponent(review.application.id);

    let state;
    if (review.status === 'closed') {
      state = 'Closed ' + new Date(review.closedAt).toLocaleString() + '. This is the outcome report: each item\'s result and who decided it.';
    } else if (!decidable()) {
      state = 'Past its due date. The Scheduler is revoking the undecided items and will close the review within a minute.';
    } else {
      state = 'Open until ' + new Date(review.dueAt).toLocaleString() +
        '. Any Tenant Admin can Certify or revoke each item; revoking ends the Role Assignment at once. Anything still pending then is revoked automatically.';
    }
    document.getElementById('state-text').textContent = state;

    const progress = review.progress;
    document.getElementById('count-certified').textContent = progress.certified;
    document.getElementById('count-revoked').textContent = progress.revoked;
    document.getElementById('count-auto-revoked').textContent = progress.autoRevoked;
    document.getElementById('count-pending').textContent = progress.pending;
    document.getElementById('progress-wrap').replaceChildren(ReviewProgress.bar(progress));
    document.getElementById('items-title').textContent = review.status === 'closed' ? 'Outcome report' : 'Items';
    document.getElementById('items-text').textContent =
      progress.total + ' Role Assignment' + (progress.total === 1 ? '' : 's') + ' active in ' + application +
      ' when the review started, by member. Revoking one anywhere else, such as from a Registered Resource, decides its item too.';
  }

  function assignmentContent(item) {
    const wrap = document.createElement('div');
    wrap.className = 'event-type';
    const assignment = item.roleAssignment;
    if (assignment.status === 'active') {
      wrap.append(badge(assignment.expiresAt ? 'Active until ' + new Date(assignment.expiresAt).toLocaleDateString() : 'Active', 'ok'));
    } else if (assignment.status === 'expired') {
      wrap.append(badge('Expired', 'warn'));
    } else {
      wrap.append(badge('Revoked', 'bad'));
    }
    const since = document.createElement('small');
    since.textContent = 'Since ' + new Date(assignment.createdAt).toLocaleDateString() +
      (assignment.assignedByName ? ' · by ' + assignment.assignedByName : '');
    wrap.append(since);
    return wrap;
  }

  function resultContent(item) {
    const wrap = document.createElement('div');
    wrap.className = 'event-type';
    const outcome = OUTCOMES[item.outcome] || [item.outcome, 'accent'];
    wrap.append(badge(outcome[0], outcome[1]));
    if (item.decidedAt) {
      const by = document.createElement('small');
      const who = item.outcome === 'auto-revoked' ? 'Scheduler, at the due date' : item.decidedByName || 'a former member';
      by.textContent = new Date(item.decidedAt).toLocaleString() + ' · ' + who;
      wrap.append(by);
    }
    return wrap;
  }

  function decisionButton(item, decision) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = (decision === 'certify' ? 'secondary' : 'danger') + ' small';
    button.textContent = decision === 'certify' ? 'Certify' : 'Revoke';
    const label = item.role.name + ' for ' + memberName(item.member);
    button.setAttribute('aria-label', button.textContent + ' ' + label);
    button.addEventListener('click', async function () {
      if (decision === 'revoke' && !window.confirm('Revoke ' + label + '? Their access through this Role ends at once.')) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await Sentinel.api(base + '/items/' + encodeURIComponent(item.id) + '/' + decision, { method: 'POST' });
        showMessage(message, (decision === 'certify' ? 'Certified ' : 'Revoked ') + label + '.', 'success');
        await refresh();
      } catch (error) {
        showMessage(message, error.message, 'error');
        button.disabled = false;
        button.removeAttribute('aria-busy');
        // Someone else may have decided it, or the due date passed: show how things stand now.
        await refresh().catch(function () {});
      }
    });
    return button;
  }

  function itemRow(item) {
    const who = document.createElement('div');
    who.className = 'event-type';
    if (item.member.membershipId) {
      const link = document.createElement('a');
      link.href = '/role-assignments.html?membership=' + encodeURIComponent(item.member.membershipId);
      link.textContent = memberName(item.member) + (me && item.member.userId === me.id ? ' (you)' : '');
      who.append(link);
    } else {
      who.append(memberName(item.member));
    }
    const email = document.createElement('small');
    email.textContent = item.member.membershipId ? item.member.email : item.member.email + ' · left the Tenant';
    who.append(email);

    let role;
    if (item.role.id) {
      role = document.createElement('a');
      role.href = '/role.html?id=' + encodeURIComponent(item.role.id);
      role.textContent = item.role.name;
    } else {
      role = document.createElement('span');
      role.textContent = item.role.name + ' (deleted)';
    }

    const actions = document.createElement('div');
    actions.className = 'filter-actions';
    if (item.outcome === 'pending' && decidable()) {
      if (item.roleAssignment.status === 'active') actions.append(decisionButton(item, 'certify'));
      actions.append(decisionButton(item, 'revoke'));
    }

    const tr = document.createElement('tr');
    tr.append(cell(who), cell(role, 'nowrap'), cell(assignmentContent(item), 'nowrap'), cell(resultContent(item), 'nowrap'), cell(actions));
    return tr;
  }

  function itemsUrl(cursor) {
    const search = new URLSearchParams();
    if (filterOutcome.value) search.set('outcome', filterOutcome.value);
    if (cursor) search.set('cursor', cursor);
    const text = search.toString();
    return base + '/items' + (text ? '?' + text : '');
  }

  function showItems(page, append) {
    const built = page.items.map(itemRow);
    if (append) rows.append.apply(rows, built);
    else rows.replaceChildren.apply(rows, built);
    nextCursor = page.nextCursor;
    document.getElementById('more-footer').hidden = !nextCursor;
    document.getElementById('empty').hidden = rows.children.length > 0;
  }

  // The review's counts and the first page of items, read together.
  async function refresh() {
    const asked = ++generation;
    const results = await Promise.all([Sentinel.api(base), Sentinel.api(itemsUrl(null))]);
    if (asked !== generation) return;
    review = results[0];
    showReview();
    showItems(results[1], false);
  }

  more.addEventListener('click', async function () {
    const asked = generation;
    more.disabled = true;
    more.setAttribute('aria-busy', 'true');
    try {
      const page = await Sentinel.api(itemsUrl(nextCursor));
      if (asked === generation) showItems(page, true);
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      more.disabled = false;
      more.removeAttribute('aria-busy');
    }
  });

  filterOutcome.addEventListener('change', function () {
    refresh().catch(function (error) {
      showMessage(message, error.message, 'error');
    });
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
      block('No Active Tenant', 'Access Reviews belong to a Tenant. Choose one first.', true);
      return;
    }
    const tenant = await Sentinel.api('/v1/tenants/current');
    Shell.setTenant(tenant);
    if (!tenant.isTenantAdmin) {
      block('Tenant Admins only', 'Only Tenant Admins can run Access Reviews in ' + tenant.tenantName + '.', false);
      return;
    }
    await refresh();
    document.getElementById('loading').hidden = true;
    document.getElementById('console').hidden = false;
  }

  load().catch(function (error) {
    block('Could not load this Access Review', error.message, false);
  });
})();
