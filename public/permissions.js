// Renders Permissions ("ALLOW read Document") the same way in the Platform and Tenant consoles.
// A Permission on a Deprecated Resource Type or Action gets the "flagged" style.
(function () {
  function describe(permission) {
    return (permission.inverted ? 'deny ' : 'allow ') + permission.action + ' ' + permission.resourceType;
  }

  // permission: { action, resourceType, inverted, deprecated, conditions? }.
  // remove: optional; when given, the chip gets a Remove button that calls it.
  function chip(permission, remove) {
    const span = document.createElement('span');
    span.className = 'chip' + (permission.deprecated ? ' flagged' : '') + (remove ? '' : ' static');
    if (permission.deprecated) span.title = 'Uses a Deprecated Resource Type or Action. Remove it when you can.';
    const effect = document.createElement('span');
    effect.className = 'effect ' + (permission.inverted ? 'deny' : 'allow');
    effect.textContent = permission.inverted ? 'Deny' : 'Allow';
    const text = document.createElement('span');
    text.textContent = permission.action + ' · ' + permission.resourceType;
    span.append(effect, text);
    if (permission.deprecated) {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = 'Deprecated';
      span.append(flag);
    }
    if (permission.conditions) {
      const conditions = document.createElement('span');
      conditions.className = 'hint';
      conditions.textContent = 'if ' + JSON.stringify(permission.conditions);
      span.append(conditions);
    }
    if (remove) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost';
      button.textContent = 'Remove';
      button.setAttribute('aria-label', 'Remove Permission: ' + describe(permission));
      button.addEventListener('click', function () {
        remove(button);
      });
      span.append(button);
    }
    return span;
  }

  window.Permissions = { chip: chip, describe: describe };
})();
