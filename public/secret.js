// Shows an Application's client ID and a newly issued client secret, once, with copy buttons.
(function () {
  function copyRow(label, value) {
    const row = document.createElement('div');
    row.className = 'secret-row';
    const field = document.createElement('label');
    field.textContent = label;
    const input = document.createElement('input');
    input.readOnly = true;
    input.value = value;
    field.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy ' + label);
    button.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'Copied';
      } catch {
        input.select();
        button.textContent = 'Press Ctrl+C';
      }
    });
    row.append(field, button);
    return row;
  }

  window.SecretReveal = {
    // Fills box (a .secret-box element) and unhides it.
    show(box, clientId, clientSecret) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Copy the client secret now. It is shown only this once; if it is lost, rotate it.';
      const title = document.createElement('strong');
      title.textContent = 'New client secret';
      box.replaceChildren(title, copyRow('Client ID', clientId), copyRow('Client secret', clientSecret), note);
      box.hidden = false;
    },
  };
})();
