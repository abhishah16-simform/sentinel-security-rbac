// Every registered Application with the Active Tenant's Enablement of it, for the Application pickers
// on the Roles and Permissions pages. Follows the pages of the list until the end.
(function () {
  async function all() {
    const applications = [];
    let cursor = null;
    do {
      const page = await Sentinel.api(
        '/v1/tenants/current/applications?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      );
      applications.push.apply(applications, page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return applications;
  }

  // Fills a <select> with Applications, keeping any options already in it (such as "All").
  function fill(select, applications) {
    applications.forEach(function (application) {
      const option = document.createElement('option');
      option.value = application.id;
      option.textContent = application.name + (application.enabled ? '' : ' (not enabled)');
      select.append(option);
    });
  }

  window.TenantApplications = { all: all, fill: fill };
})();
