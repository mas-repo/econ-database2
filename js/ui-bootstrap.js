// ui-bootstrap.js
// Assembles all HTML templates and injects them into the page.
// MUST be loaded after all template-*.js files and BEFORE any logic files
// that query the DOM (utils.js, filters.js, main.js, etc.).
// Dependencies: template-header.js, template-filters.js, template-form.js,
//               template-tabs.js, template-modals.js

(function buildUI() {
    const app = document.getElementById('app');
    if (!app) {
        console.error('❌ #app container not found — UI cannot be rendered.');
        return;
    }

    // Main application shell
    app.innerHTML =
        renderHeaderTemplate() +
        renderTabsNavTemplate() +
        renderTabContentsTemplate();

    // Modals live directly under <body> so they overlay everything
    document.body.insertAdjacentHTML('beforeend', renderModalsTemplate());

    console.log('✅ UI templates injected');
})();