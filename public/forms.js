// Small helpers for the signup, login and verification pages.
(function () {
  window.showMessage = function (element, text, kind) {
    element.textContent = text;
    element.className = 'message ' + (kind || '');
    element.hidden = !text;
  };

  // Runs handler on submit, disabling the button and showing any error in messageEl.
  window.handleForm = function (form, messageEl, handler) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      window.showMessage(messageEl, '');
      try {
        await handler(new FormData(form));
      } catch (error) {
        window.showMessage(messageEl, error.message || 'Something went wrong', 'error');
      } finally {
        button.disabled = false;
      }
    });
  };
})();
