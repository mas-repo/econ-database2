// Role flags from the Apps Script proxy. The page never stores an allowlist.
// checkAccess returns booleans only. Defaults stay closed until that reply.

var accessRightsCache = {
    username: '',
    promise: null
};

function emptyAccessRights() {
    return { admin: false, ai: false, githubSync: false, mockTests: false };
}

function currentAccessRights() {
    return window.accessRights || emptyAccessRights();
}

function applyAccessRights(rights) {
    var flags = rights || emptyAccessRights();
    window.accessRights = {
        admin: flags.admin === true,
        ai: flags.ai === true,
        githubSync: flags.githubSync === true,
        mockTests: flags.mockTests === true
    };
    if (window.authManager) {
        window.authManager._canViewMockTests = window.accessRights.mockTests;
        window.authManager._canEdit = window.accessRights.admin;
    }
    var adminButton = document.getElementById('admin-mode-btn');
    if (adminButton) adminButton.hidden = !window.accessRights.admin;
    if (!window.accessRights.admin && typeof isAdminMode !== 'undefined' && isAdminMode) {
        isAdminMode = false;
        if (typeof updateAdminUI === 'function') updateAdminUI();
    }
    document.querySelectorAll('[data-mock-only="1"]').forEach(function (node) {
        node.hidden = !window.accessRights.mockTests;
    });
    if (!window.accessRights.admin && typeof clearAdminBlankFeatureFilters === 'function') {
        clearAdminBlankFeatureFilters();
    }
    if (typeof populateFeatureFilter === 'function') {
        populateFeatureFilter();
    }
    if (typeof populateDynamicFilters === 'function') {
        populateDynamicFilters();
    }
    if (window.AiExplanation && typeof AiExplanation.refreshAdminButton === 'function') {
        AiExplanation.refreshAdminButton();
    }
    if (window.ReportIssue && typeof ReportIssue.refreshHubButton === 'function') {
        ReportIssue.refreshHubButton();
    }
    if (!window.accessRights.ai) {
        if (window.triStateFilters && window.triStateFilters.ai) {
            window.triStateFilters.ai = {};
        }
        if (typeof closeAiExplanationModal === 'function') {
            // no-op if not exported; AiExplanation.close covers it
        }
        if (window.AiExplanation && typeof AiExplanation.close === 'function') {
            AiExplanation.close();
        }
    } else if (window.AiExplanation && typeof AiExplanation.load === 'function') {
        AiExplanation.load(false).then(function () {
            if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
        }).catch(function () {});
    }
}

async function loadAccessRights(username) {
    var flags = emptyAccessRights();
    if (!username || typeof gitProxyRequest !== 'function' || typeof gitProxyUrl !== 'function' || !gitProxyUrl()) {
        applyAccessRights(flags);
        return flags;
    }
    try {
        var data = await gitProxyRequest({ action: 'checkAccess', username: username }, 20000);
        if (data && data.ok === true) {
            flags = {
                admin: data.admin === true,
                ai: data.ai === true,
                githubSync: data.githubSync === true,
                mockTests: data.mockTests === true
            };
        }
    } catch (error) {
        flags = emptyAccessRights();
    }
    applyAccessRights(flags);
    return window.accessRights;
}

async function refreshAccessRights() {
    var username = typeof gitUsername === 'function' ? gitUsername() : '';
    if (accessRightsCache.promise && accessRightsCache.username === username) {
        return accessRightsCache.promise;
    }
    accessRightsCache.username = username;
    accessRightsCache.promise = loadAccessRights(username);
    return accessRightsCache.promise;
}

window.accessRights = emptyAccessRights();
window.refreshAccessRights = refreshAccessRights;
window.applyAccessRights = applyAccessRights;
