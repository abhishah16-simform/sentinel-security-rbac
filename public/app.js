(function () {
  const list = document.getElementById('status');

  function row(name, isUp) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('span');
    value.textContent = isUp ? 'Up' : 'Down';
    value.className = isUp ? 'up' : 'down';
    li.append(label, value);
    return li;
  }

  fetch('/v1/health')
    .then(function (res) {
      return res.json();
    })
    .then(function (body) {
      list.replaceChildren(row('API', true));
      const checks = Object.assign({}, body.info, body.error);
      Object.keys(checks).forEach(function (name) {
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        list.append(row(label, checks[name].status === 'up'));
      });
    })
    .catch(function () {
      list.replaceChildren(row('API', false));
    });
})();
