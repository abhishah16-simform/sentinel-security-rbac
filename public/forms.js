// Small helpers shared by every form: messages, busy buttons and password visibility.
(function () {
  const toastTimers = new WeakMap();

  // Shows text in a .message element. Toast messages hide themselves after a few seconds.
  window.showMessage = function (element, text, kind) {
    element.textContent = text;
    element.classList.remove('success', 'error');
    if (kind) element.classList.add(kind);
    element.hidden = !text;
    clearTimeout(toastTimers.get(element));
    if (text && element.classList.contains('toast')) {
      toastTimers.set(
        element,
        setTimeout(function () {
          element.hidden = true;
        }, 5000),
      );
    }
  };

  // Runs handler on submit, showing a spinner on the button and any error in messageEl.
  window.handleForm = function (form, messageEl, handler) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      window.showMessage(messageEl, '');
      try {
        await handler(new FormData(form));
      } catch (error) {
        window.showMessage(messageEl, error.message || 'Something went wrong', 'error');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  };

  // Adds a Show/Hide toggle to every password input on the page.
  document.querySelectorAll('input[type="password"]').forEach(function (input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    input.replaceWith(wrapper);
    wrapper.append(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    });
    wrapper.append(toggle);
  });
})();
