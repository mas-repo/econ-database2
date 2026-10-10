// 用戶設定 — local apply + GitHub sync to users/<username>/settings.json
// via Apps Script getUserSettings / saveUserSettings.
//
// Shape (settings.schemaVersion, independent of bank SCHEMA_VERSION):
//   display: fontSize / density / lang / questionsExpandedByDefault
//   list: pageSize / sort
//   filters: excludeOutSyl / rememberLast / searchScope  (NOT idSet / live tri-state)
//   stats: mode / dimensions / metrics / crosstab / detailPrefs
//   ai: defaultModel / provider / explainStyle / showQuickPrompts  (no API keys)
//   ui: defaultTab
//
// Anonymous / offline: localStorage only. Logged-in known users: debounce upload.

(function (global) {
    'use strict';

    var SETTINGS_SCHEMA = 1;
    var LOCAL_KEY = 'econ_user_settings_v1';
    var DEBOUNCE_MS = 800;
    var LEGACY_DETAIL_PREFS_KEY = 'statsDetailPrefs.v1';

    var state = {
        settings: null,
        remoteUpdatedAt: '',
        remoteSha: '',
        pendingSave: false,
        saveTimer: null,
        readyPromise: null,
        applied: false,
        syncing: false,
        lastLocalEditAt: ''
    };

    var overlay = null;
    var escapeBound = false;

    function defaultSettings() {
        return {
            schemaVersion: SETTINGS_SCHEMA,
            updatedAt: '',
            display: { fontSize: 'medium', density: 'standard', lang: 'both', questionsExpandedByDefault: false },
            list: { pageSize: 20, sort: 'default' },
            filters: { excludeOutSyl: true, rememberLast: true, searchScope: 'all' },
            stats: {
                mode: 'browse',
                dimensions: ['topics'],
                metrics: ['count'],
                crosstab: { row: 'topics', col: 'year', metric: 'count' },
                detailPrefs: null
            },
            ai: {
                // System defaults for new / empty prefs (UI label「詳盡」= detailed).
                defaultModel: 'GPT-6.1-Sol',
                provider: 'poe',
                explainStyle: 'detailed',
                showQuickPrompts: true
            },
            ui: { defaultTab: 'questions' }
        };
    }

    function esc(text) {
        return (typeof escapeHTML === 'function') ? escapeHTML(text) : String(text == null ? '' : text);
    }

    function username() {
        if (global.PoeGenerate && typeof PoeGenerate.currentUsername === 'function') {
            return PoeGenerate.currentUsername();
        }
        if (typeof gitUsername === 'function') return String(gitUsername() || '').trim().toLowerCase();
        if (!global.authManager || !global.authManager.currentUser) return '';
        return String(global.authManager.currentUser).trim().toLowerCase();
    }

    function isSignedIn() {
        // Avoid isAuthenticated() here: signed-in checks must not touch
        // mock/edit permission flags (those come from applyAccessRights).
        const am = global.authManager;
        if (!am) return false;
        if (am.currentUser) return true;
        if (typeof am.getPersistedAuthData === 'function' && am.getPersistedAuthData()) {
            try {
                const raw = am.getPersistedAuthData();
                const data = JSON.parse(decodeURIComponent(raw));
                return !!(data && data.username);
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    function hasAiAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (global.accessRights || null);
        return !!(rights && rights.ai === true);
    }

    async function proxyAction(payload, timeoutMs) {
        var body = Object.assign({ username: username() }, payload || {});
        if (global.PoeGenerate && typeof PoeGenerate.proxyRequest === 'function') {
            return PoeGenerate.proxyRequest(body, timeoutMs || 60000, null, { retries: 1 });
        }
        if (typeof gitProxyRequest === 'function') {
            return gitProxyRequest(body, timeoutMs || 60000);
        }
        var err = new Error('proxy_not_configured');
        err.code = 'proxy_not_configured';
        throw err;
    }

    function readLocalRaw() {
        try {
            var raw = localStorage.getItem(LOCAL_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function writeLocalRaw(settings) {
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
        } catch (e) { /* quota / private mode */ }
    }

    function migrateLegacyInto(settings) {
        // Lift stats detail modal prefs if not already in the blob.
        if (!settings.stats.detailPrefs) {
            try {
                var raw = localStorage.getItem(LEGACY_DETAIL_PREFS_KEY);
                if (raw) {
                    var parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        settings.stats.detailPrefs = parsed;
                    }
                }
            } catch (e) { /* ignore */ }
        }
        // AI model / provider from existing Poe LS keys (never API keys).
        try {
            if (global.PoeGenerate) {
                var Poe = global.PoeGenerate;
                if (!settings.ai.provider && typeof Poe.readStoredProvider === 'function') {
                    settings.ai.provider = Poe.readStoredProvider() || 'poe';
                }
                if (!settings.ai.defaultModel && typeof Poe.readStoredModel === 'function') {
                    var provider = settings.ai.provider || 'poe';
                    var storedModel = Poe.readStoredModel(provider) || '';
                    var fallback = typeof Poe.defaultModelForProvider === 'function'
                        ? Poe.defaultModelForProvider(provider)
                        : '';
                    // Only migrate when user actually customized away from default.
                    if (storedModel && storedModel !== fallback) {
                        settings.ai.defaultModel = storedModel;
                    }
                }
            } else {
                if (!settings.ai.provider) {
                    settings.ai.provider = localStorage.getItem('econ_ai_provider_v1') || 'poe';
                }
                if (!settings.ai.defaultModel) {
                    var key = settings.ai.provider === 'openrouter'
                        ? 'econ_ai_model_openrouter_v1'
                        : 'econ_ai_model_poe_v1';
                    settings.ai.defaultModel = localStorage.getItem(key)
                        || localStorage.getItem('econ_ai_model_v1')
                        || '';
                }
            }
        } catch (e) { /* ignore */ }
        return settings;
    }

    function normalizeSettings(raw) {
        var base = defaultSettings();
        if (!raw || typeof raw !== 'object') return base;
        function merge(dest, src) {
            if (!src || typeof src !== 'object' || Array.isArray(src)) return;
            Object.keys(src).forEach(function (key) {
                if (src[key] != null && typeof src[key] === 'object' && !Array.isArray(src[key])
                    && dest[key] && typeof dest[key] === 'object' && !Array.isArray(dest[key])) {
                    merge(dest[key], src[key]);
                } else {
                    dest[key] = src[key];
                }
            });
        }
        merge(base, raw);
        base.schemaVersion = SETTINGS_SCHEMA;
        // Clamp / sanitize high-value fields.
        var pageSize = Number(base.list.pageSize);
        if (!(pageSize === -1 || pageSize === 10 || pageSize === 20 || pageSize === 50)) {
            base.list.pageSize = 20;
        }
        var allowedSort = {
            default: 1, 'year-desc': 1, 'year-asc': 1,
            'question-asc': 1, 'question-desc': 1,
            'marks-asc': 1, 'marks-desc': 1,
            'percentage-asc': 1, 'percentage-desc': 1
        };
        if (!allowedSort[base.list.sort]) base.list.sort = 'default';
        base.filters.excludeOutSyl = base.filters.excludeOutSyl !== false;
        base.filters.rememberLast = base.filters.rememberLast !== false;
        if (typeof base.filters.searchScope !== 'string' || !base.filters.searchScope) {
            base.filters.searchScope = 'all';
        }
        if (base.display.fontSize !== 'small' && base.display.fontSize !== 'large') {
            base.display.fontSize = 'medium';
        }
        if (base.display.density !== 'compact') base.display.density = 'standard';
        if (base.display.lang !== 'zh' && base.display.lang !== 'en') base.display.lang = 'both';
        // Missing / non-true → collapsed (historical default); only explicit true expands.
        base.display.questionsExpandedByDefault = base.display.questionsExpandedByDefault === true;
        if (base.stats.mode === 'crosstab' || base.stats.mode === 'detail') {
            base.stats.mode = base.stats.mode === 'detail' ? 'browse' : 'crosstab';
        } else {
            base.stats.mode = 'browse';
        }
        if (!Array.isArray(base.stats.dimensions)) base.stats.dimensions = ['topics'];
        if (!Array.isArray(base.stats.metrics)) base.stats.metrics = ['count'];
        if (!base.stats.crosstab || typeof base.stats.crosstab !== 'object') {
            base.stats.crosstab = { row: 'topics', col: 'year', metric: 'count' };
        }
        // Keep explicit short/detailed; anything else → system default「詳盡」.
        if (base.ai.explainStyle !== 'short' && base.ai.explainStyle !== 'detailed') {
            base.ai.explainStyle = 'detailed';
        }
        base.ai.showQuickPrompts = base.ai.showQuickPrompts !== false;
        if (base.ai.provider !== 'openrouter') base.ai.provider = 'poe';
        if (!String(base.ai.defaultModel || '').trim()) {
            base.ai.defaultModel = base.ai.provider === 'openrouter'
                ? (global.PoeGenerate && PoeGenerate.OPENROUTER_DEFAULT_MODEL) || 'openai/gpt-4o-mini'
                : 'GPT-6.1-Sol';
        }
        if (base.ui.defaultTab !== 'stats') base.ui.defaultTab = 'questions';
        // Never keep secrets even if somehow present.
        delete base.poeApiKey;
        delete base.openRouterApiKey;
        delete base.apiKey;
        delete base.idSetFilter;
        delete base.advancedFilter;
        delete base.triStateFilters;
        return base;
    }

    function getSettings() {
        if (!state.settings) {
            state.settings = migrateLegacyInto(normalizeSettings(readLocalRaw()));
        }
        return state.settings;
    }

    function featureTriStateDefault() {
        var s = getSettings();
        if (s.filters.excludeOutSyl) return { 'Out syl': 'excluded' };
        return {};
    }

    function applyDisplay(settings) {
        var root = document.documentElement;
        var body = document.body;
        if (!root || !body) return;
        root.setAttribute('data-user-font', settings.display.fontSize || 'medium');
        root.setAttribute('data-user-density', settings.display.density || 'standard');
        root.setAttribute('data-user-lang', settings.display.lang || 'both');
        root.setAttribute('data-user-qa-expanded', settings.display.questionsExpandedByDefault ? '1' : '0');
        body.classList.toggle('user-density-compact', settings.display.density === 'compact');
        body.classList.toggle('user-qa-expanded-default', !!settings.display.questionsExpandedByDefault);
        body.classList.remove('user-font-small', 'user-font-medium', 'user-font-large');
        body.classList.add('user-font-' + (settings.display.fontSize || 'medium'));
        body.classList.remove('user-lang-zh', 'user-lang-en', 'user-lang-both');
        body.classList.add('user-lang-' + (settings.display.lang || 'both'));
    }

    function applyList(settings) {
        if (typeof paginationState !== 'undefined' && paginationState.questions) {
            paginationState.questions.itemsPerPage = settings.list.pageSize;
            paginationState.questions.page = 1;
        }
        var pageSelect = document.getElementById('items-per-page');
        if (pageSelect) pageSelect.value = String(settings.list.pageSize);
        var sortSelect = document.getElementById('sort-order');
        if (sortSelect && settings.list.sort) sortSelect.value = settings.list.sort;
    }

    function applyFilters(settings) {
        if (settings.filters.rememberLast && settings.filters.searchScope) {
            if (typeof searchScope !== 'undefined') {
                // globals.js var
            }
            global.searchScope = settings.filters.searchScope;
            var scopeEl = document.getElementById('search-scope');
            if (scopeEl) {
                var opt = Array.prototype.find.call(scopeEl.options || [], function (o) {
                    return o.value === settings.filters.searchScope;
                });
                if (opt) scopeEl.value = settings.filters.searchScope;
            }
        }
        if (global.triStateFilters && global.triStateFilters.feature) {
            if (settings.filters.excludeOutSyl) {
                global.triStateFilters.feature['Out syl'] = 'excluded';
            } else {
                delete global.triStateFilters.feature['Out syl'];
            }
        }
    }

    function applyStats(settings) {
        var mode = settings.stats.mode === 'crosstab' ? 'crosstab' : 'browse';
        if (typeof setStatsViewMode === 'function' && global.statsViewMode !== mode) {
            // Defer heavy render until stats tab is shown if possible.
            global.statsViewMode = mode;
            document.querySelectorAll('[data-stats-mode]').forEach(function (btn) {
                var active = btn.getAttribute('data-stats-mode') === mode;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            var browse = document.getElementById('stats-browse-panel');
            var cross = document.getElementById('stats-crosstab-panel');
            if (browse) browse.hidden = mode !== 'browse';
            if (cross) cross.hidden = mode !== 'crosstab';
        }
        var dim = (settings.stats.dimensions && settings.stats.dimensions[0]) || 'topics';
        if (typeof setStatsActiveDimension === 'function') {
            try { setStatsActiveDimension(dim); } catch (e) { global.statsActiveDimension = dim; }
        } else {
            global.statsActiveDimension = dim;
        }
        if (settings.stats.crosstab && typeof global.setStatsCrosstabState === 'function') {
            global.setStatsCrosstabState(settings.stats.crosstab);
        }
        if (settings.stats.detailPrefs && typeof global.applyStatsDetailPrefs === 'function') {
            global.applyStatsDetailPrefs(settings.stats.detailPrefs);
        } else if (settings.stats.detailPrefs) {
            try {
                localStorage.setItem(LEGACY_DETAIL_PREFS_KEY, JSON.stringify(settings.stats.detailPrefs));
            } catch (e) { /* ignore */ }
        }
    }

    function applyAi(settings) {
        if (!hasAiAccess()) return;
        try {
            var Poe = global.PoeGenerate;
            if (Poe) {
                if (settings.ai.provider && typeof Poe.writeStoredProvider === 'function') {
                    Poe.writeStoredProvider(settings.ai.provider);
                }
                if (settings.ai.defaultModel && typeof Poe.writeStoredModel === 'function') {
                    Poe.writeStoredModel(settings.ai.defaultModel, settings.ai.provider || 'poe');
                }
            } else {
                if (settings.ai.provider) {
                    localStorage.setItem('econ_ai_provider_v1', settings.ai.provider);
                }
                if (settings.ai.defaultModel) {
                    var key = settings.ai.provider === 'openrouter'
                        ? 'econ_ai_model_openrouter_v1'
                        : 'econ_ai_model_poe_v1';
                    localStorage.setItem(key, settings.ai.defaultModel);
                }
            }
        } catch (e) { /* ignore */ }
        if (global.AiExplanation && typeof AiExplanation.setDefaultDetailLevel === 'function') {
            AiExplanation.setDefaultDetailLevel(settings.ai.explainStyle);
        } else {
            global.__userAiExplainStyle = settings.ai.explainStyle;
        }
        global.__userShowQuickPrompts = settings.ai.showQuickPrompts !== false;
        var chips = document.getElementById('poe-followup-chips');
        if (chips) chips.hidden = settings.ai.showQuickPrompts === false;
    }

    function applyUi(settings) {
        // Default tab applied once after first paint of initializeApp.
        if (state.applied) return;
        if (settings.ui.defaultTab === 'stats' && typeof switchTab === 'function') {
            switchTab('stats');
        }
    }

    function applySettings(options) {
        options = options || {};
        var settings = getSettings();
        applyDisplay(settings);
        applyList(settings);
        applyFilters(settings);
        applyStats(settings);
        applyAi(settings);
        if (options.includeTab !== false) applyUi(settings);
        state.applied = true;
        if (options.rerender !== false) {
            if (typeof updateActiveFiltersDisplay === 'function') {
                try { updateActiveFiltersDisplay(); } catch (e) { /* optional */ }
            }
            if (typeof renderQuestions === 'function' && document.getElementById('question-grid')) {
                try { renderQuestions(); } catch (e) { /* ignore */ }
            }
        }
        return settings;
    }

    function markLocalEdit() {
        state.lastLocalEditAt = new Date().toISOString();
        state.pendingSave = true;
        getSettings().updatedAt = state.lastLocalEditAt;
        writeLocalRaw(getSettings());
    }

    function scheduleRemoteSave() {
        if (!isSignedIn()) return;
        markLocalEdit();
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () {
            state.saveTimer = null;
            flushRemoteSave();
        }, DEBOUNCE_MS);
    }

    async function flushRemoteSave() {
        if (!isSignedIn() || state.syncing) return;
        var settings = getSettings();
        state.syncing = true;
        try {
            var data = await proxyAction({
                action: 'saveUserSettings',
                settings: settings
            }, 60000);
            if (data && data.ok === true && data.settings) {
                state.settings = normalizeSettings(data.settings);
                state.remoteUpdatedAt = state.settings.updatedAt || '';
                state.remoteSha = data.sha || '';
                state.pendingSave = false;
                writeLocalRaw(state.settings);
                setModalStatus('已同步到 GitHub', 'ok');
            } else {
                setModalStatus('同步失敗：' + ((data && data.error) || 'unknown'), 'error');
            }
        } catch (err) {
            setModalStatus('同步失敗：' + ((err && err.code) || 'network'), 'error');
        } finally {
            state.syncing = false;
        }
    }

    function isoTime(value) {
        var t = Date.parse(String(value || ''));
        return isFinite(t) ? t : 0;
    }

    async function fetchRemoteAndMerge() {
        if (!isSignedIn()) return getSettings();
        try {
            var data = await proxyAction({ action: 'getUserSettings' }, 60000);
            if (!data || data.ok !== true) return getSettings();
            var remote = normalizeSettings(data.settings || {});
            state.remoteSha = data.sha || '';
            state.remoteUpdatedAt = remote.updatedAt || '';
            if (data.missing) return getSettings();

            var local = getSettings();
            var remoteNewer = isoTime(remote.updatedAt) > isoTime(local.updatedAt || state.lastLocalEditAt);
            if (state.pendingSave && remoteNewer) {
                var keepLocal = confirm(
                    '雲端用戶設定較新（' + (remote.updatedAt || '') + '）。\n\n'
                    + '按「確定」使用雲端設定並捨棄本機未上載變更；\n'
                    + '按「取消」保留本機設定並稍後上載。'
                );
                if (keepLocal) {
                    state.settings = remote;
                    state.pendingSave = false;
                    writeLocalRaw(state.settings);
                } else {
                    // Keep local pending edits and push them after merge decision.
                    scheduleRemoteSave();
                }
            } else if (remoteNewer || !local.updatedAt) {
                state.settings = migrateLegacyInto(remote);
                writeLocalRaw(state.settings);
            }
        } catch (err) {
            // Keep local on network errors.
        }
        return getSettings();
    }

    function patchSettings(mutator, options) {
        options = options || {};
        var settings = getSettings();
        mutator(settings);
        state.settings = normalizeSettings(settings);
        writeLocalRaw(state.settings);
        if (options.apply !== false) applySettings({ includeTab: false, rerender: options.rerender !== false });
        if (options.sync !== false) scheduleRemoteSave();
        else markLocalEdit();
        return state.settings;
    }

    // --- Remember lightweight live prefs (search scope only) ---
    function rememberSearchScope(scope) {
        var settings = getSettings();
        if (!settings.filters.rememberLast) return;
        if (settings.filters.searchScope === scope) return;
        patchSettings(function (s) { s.filters.searchScope = scope; }, { apply: false, rerender: false });
    }

    function rememberListPrefs() {
        patchSettings(function (s) {
            var pageSelect = document.getElementById('items-per-page');
            var sortSelect = document.getElementById('sort-order');
            if (pageSelect) s.list.pageSize = parseInt(pageSelect.value, 10);
            if (sortSelect) s.list.sort = sortSelect.value || 'default';
        }, { apply: false, rerender: false });
    }

    function rememberStatsPrefs() {
        patchSettings(function (s) {
            s.stats.mode = global.statsViewMode === 'crosstab' ? 'crosstab' : 'browse';
            var dim = (typeof getStatsActiveDimension === 'function')
                ? getStatsActiveDimension()
                : (global.statsActiveDimension || 'topics');
            s.stats.dimensions = [dim];
            if (typeof global.getStatsCrosstabState === 'function') {
                s.stats.crosstab = global.getStatsCrosstabState();
                s.stats.metrics = [s.stats.crosstab.metric || 'count'];
            }
            if (typeof global.getStatsDetailPrefs === 'function') {
                s.stats.detailPrefs = global.getStatsDetailPrefs();
            }
        }, { apply: false, rerender: false });
    }

    // --- Modal UI ---

    function setModalStatus(text, kind) {
        var el = document.getElementById('user-settings-status');
        if (!el) return;
        el.textContent = String(text || '');
        el.hidden = !text;
        el.className = 'user-settings-status' + (kind ? ' is-' + kind : '');
    }

    function ensureButton() {
        var host = document.querySelector('header div[style*="flex-wrap"]') ||
            document.querySelector('header');
        if (!host) return null;
        var button = document.getElementById('user-settings-btn');
        if (button) {
            if (button.dataset.bound !== '1') {
                button.dataset.bound = '1';
                button.addEventListener('click', openModal);
            }
            return button;
        }
        button = document.createElement('button');
        button.type = 'button';
        button.id = 'user-settings-btn';
        button.className = 'btn btn-outline-primary header-toolbar-btn';
        button.textContent = '用戶設定';
        button.setAttribute('aria-label', '開啟用戶設定');
        button.dataset.bound = '1';
        button.addEventListener('click', openModal);
        var logout = document.getElementById('logout-btn');
        if (logout && logout.parentNode === host) {
            host.insertBefore(button, logout);
        } else {
            host.appendChild(button);
        }
        return button;
    }

    function refreshButton() {
        var button = ensureButton();
        if (!button) return;
        button.hidden = !isSignedIn();
    }

    function usAiProviderFromSelect() {
        var el = document.getElementById('us-ai-provider');
        return el && el.value === 'openrouter' ? 'openrouter' : 'poe';
    }

    function fillUsAiModelControls(provider, selectedModel) {
        var selectEl = document.getElementById('us-ai-model');
        var customEl = document.getElementById('us-ai-model-custom');
        if (!selectEl) return;
        var Poe = global.PoeGenerate;
        provider = provider === 'openrouter' ? 'openrouter' : 'poe';
        if (customEl) {
            customEl.placeholder = provider === 'openrouter'
                ? '例如 anthropic/claude-3.5-sonnet'
                : '例如 Claude-Opus-4.6';
        }
        if (Poe && typeof Poe.fillModelSelect === 'function') {
            Poe.fillModelSelect(selectEl, provider, selectedModel, customEl);
            return;
        }
        // Fallback if Poe helpers are unavailable: keep a minimal known list.
        var list = provider === 'openrouter'
            ? ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-sonnet-4']
            : ['Claude-Sonnet-5.5', 'GPT-6.1-Sol', 'Gemini-3.8-Flash', 'GLM-5.3-flash', 'GLM-5.3'];
        var selected = String(selectedModel || '').trim() || list[0];
        selectEl.textContent = '';
        var seen = false;
        list.forEach(function (model) {
            var opt = document.createElement('option');
            opt.value = model;
            opt.textContent = model;
            selectEl.appendChild(opt);
            if (model === selected) seen = true;
        });
        if (selected && !seen) {
            var customOpt = document.createElement('option');
            customOpt.value = selected;
            customOpt.textContent = selected + '（自訂）';
            selectEl.appendChild(customOpt);
        }
        selectEl.value = selected;
        if (customEl && document.activeElement !== customEl) {
            customEl.value = (selected && list.indexOf(selected) === -1) ? selected : '';
        }
    }

    function readUsAiModel(provider) {
        var selectEl = document.getElementById('us-ai-model');
        var customEl = document.getElementById('us-ai-model-custom');
        var Poe = global.PoeGenerate;
        provider = provider === 'openrouter' ? 'openrouter' : 'poe';
        var customRaw = customEl ? String(customEl.value || '').trim() : '';
        if (customRaw) {
            if (Poe && typeof Poe.sanitizeModelId === 'function') {
                var customOk = Poe.sanitizeModelId(provider, customRaw);
                if (customOk) return customOk;
            } else {
                return customRaw;
            }
        }
        var fromSelect = selectEl ? String(selectEl.value || '').trim() : '';
        if (Poe && typeof Poe.sanitizeModelId === 'function') {
            return Poe.sanitizeModelId(provider, fromSelect)
                || (typeof Poe.defaultModelForProvider === 'function'
                    ? Poe.defaultModelForProvider(provider)
                    : fromSelect);
        }
        return fromSelect;
    }

    function fillModalFromSettings() {
        var s = getSettings();
        var setVal = function (id, value) {
            var el = document.getElementById(id);
            if (el) el.value = value;
        };
        var setCheck = function (id, on) {
            var el = document.getElementById(id);
            if (el) el.checked = !!on;
        };
        setVal('us-default-tab', s.ui.defaultTab);
        setVal('us-page-size', String(s.list.pageSize));
        setVal('us-sort', s.list.sort);
        setCheck('us-exclude-out-syl', s.filters.excludeOutSyl);
        setCheck('us-remember-last', s.filters.rememberLast);
        setVal('us-search-scope', s.filters.searchScope || 'all');
        setVal('us-stats-mode', s.stats.mode);
        setVal('us-stats-dimension', (s.stats.dimensions && s.stats.dimensions[0]) || 'topics');
        setVal('us-ct-row', (s.stats.crosstab && s.stats.crosstab.row) || 'topics');
        setVal('us-ct-col', (s.stats.crosstab && s.stats.crosstab.col) || 'year');
        setVal('us-ct-metric', (s.stats.crosstab && s.stats.crosstab.metric) || 'count');
        setVal('us-font-size', s.display.fontSize);
        setVal('us-density', s.display.density);
        setVal('us-lang', s.display.lang);
        setVal('us-qa-default', s.display.questionsExpandedByDefault ? 'expanded' : 'collapsed');
        setVal('us-ai-provider', s.ai.provider || 'poe');
        fillUsAiModelControls(s.ai.provider || 'poe', s.ai.defaultModel || 'GPT-6.1-Sol');
        setVal('us-ai-explain', s.ai.explainStyle === 'short' ? 'short' : 'detailed');
        setCheck('us-ai-quick-prompts', s.ai.showQuickPrompts !== false);
        var aiAllowed = hasAiAccess();
        var aiNav = document.getElementById('user-settings-nav-ai');
        if (aiNav) aiNav.hidden = !aiAllowed;
        var aiPanel = document.getElementById('us-panel-ai');
        if (aiPanel && !aiAllowed) aiPanel.hidden = true;
        // Populate dimension options if STAT_TABS exists.
        ['us-stats-dimension', 'us-ct-row', 'us-ct-col'].forEach(function (id) {
            var sel = document.getElementById(id);
            if (!sel || !global.STAT_TABS) return;
            var current = sel.value;
            sel.innerHTML = Object.keys(global.STAT_TABS).map(function (key) {
                return '<option value="' + esc(key) + '">' + esc(global.STAT_TABS[key].label || key) + '</option>';
            }).join('');
            if (current && global.STAT_TABS[current]) sel.value = current;
        });
        var metricSel = document.getElementById('us-ct-metric');
        if (metricSel && !metricSel.options.length) {
            [
                { id: 'count', label: '題數' },
                { id: 'mc', label: 'MC數' },
                { id: 'text', label: '文字題數' },
                { id: 'avgPercentage', label: '平均答對率' },
                { id: 'avgMarks', label: '平均分數' }
            ].forEach(function (m) {
                var opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.label;
                metricSel.appendChild(opt);
            });
            metricSel.value = (s.stats.crosstab && s.stats.crosstab.metric) || 'count';
        }
        // Keep current category if still valid; otherwise land on 介面.
        var activeBtn = overlay && overlay.querySelector('.user-settings-nav-btn.is-active:not([hidden])');
        var cat = activeBtn ? activeBtn.getAttribute('data-us-cat') : 'ui';
        showSettingsCategory(cat || 'ui');
    }

    function readModalIntoSettings() {
        var val = function (id) {
            var el = document.getElementById(id);
            return el ? el.value : '';
        };
        var chk = function (id) {
            var el = document.getElementById(id);
            return !!(el && el.checked);
        };
        return patchSettings(function (s) {
            s.ui.defaultTab = val('us-default-tab') === 'stats' ? 'stats' : 'questions';
            s.list.pageSize = parseInt(val('us-page-size'), 10);
            s.list.sort = val('us-sort') || 'default';
            s.filters.excludeOutSyl = chk('us-exclude-out-syl');
            s.filters.rememberLast = chk('us-remember-last');
            s.filters.searchScope = val('us-search-scope') || 'all';
            s.stats.mode = val('us-stats-mode') === 'crosstab' ? 'crosstab' : 'browse';
            s.stats.dimensions = [val('us-stats-dimension') || 'topics'];
            s.stats.crosstab = {
                row: val('us-ct-row') || 'topics',
                col: val('us-ct-col') || 'year',
                metric: val('us-ct-metric') || 'count'
            };
            s.stats.metrics = [s.stats.crosstab.metric];
            s.display.fontSize = val('us-font-size') || 'medium';
            s.display.density = val('us-density') === 'compact' ? 'compact' : 'standard';
            s.display.lang = val('us-lang') || 'both';
            s.display.questionsExpandedByDefault = val('us-qa-default') === 'expanded';
            if (hasAiAccess()) {
                s.ai.provider = val('us-ai-provider') === 'openrouter' ? 'openrouter' : 'poe';
                s.ai.defaultModel = readUsAiModel(s.ai.provider);
                s.ai.explainStyle = val('us-ai-explain') === 'detailed' ? 'detailed' : 'short';
                s.ai.showQuickPrompts = chk('us-ai-quick-prompts');
            }
        }, { apply: true, rerender: true, sync: true });
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'user-settings-overlay';
        overlay.className = 'user-settings-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="user-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">'
            + '  <header class="user-settings-header">'
            + '    <div>'
            + '      <h2 id="user-settings-title">用戶設定</h2>'
            + '      <p class="user-settings-subtitle">偏好會即時套用；登入後會同步到 GitHub（users/…/settings.json）。不會上載 API 金鑰或即時篩選內容。</p>'
            + '    </div>'
            + '    <button type="button" class="user-settings-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="user-settings-main">'
            + '    <div class="user-settings-panels" id="user-settings-panels">'
            + '      <section class="user-settings-panel" id="us-panel-ui" data-us-panel="ui">'
            + '        <h3 class="user-settings-panel-title">介面</h3>'
            + '        <div class="user-settings-section">'
            + '          <label>預設分頁<select id="us-default-tab">'
            + '            <option value="questions">題目</option>'
            + '            <option value="stats">統計</option>'
            + '          </select></label>'
            + '          <label>字型大小<select id="us-font-size">'
            + '            <option value="small">較小</option>'
            + '            <option value="medium">標準</option>'
            + '            <option value="large">較大</option>'
            + '          </select></label>'
            + '          <label>卡片密度<select id="us-density">'
            + '            <option value="standard">標準</option>'
            + '            <option value="compact">緊湊</option>'
            + '          </select></label>'
            + '          <label>題目語言<select id="us-lang">'
            + '            <option value="both">雙語</option>'
            + '            <option value="zh">中文</option>'
            + '            <option value="en">英文</option>'
            + '          </select></label>'
            + '        </div>'
            + '        <div class="user-settings-section">'
            + '          <h4 class="user-settings-subhead">題目列表</h4>'
            + '          <label>每頁題數<select id="us-page-size">'
            + '            <option value="10">10</option><option value="20">20</option>'
            + '            <option value="50">50</option><option value="-1">全部</option>'
            + '          </select></label>'
            + '          <label>預設排序<select id="us-sort">'
            + '            <option value="default">預設 (年份新→舊，題號小→大)</option>'
            + '            <option value="year-desc">年份 (新→舊)</option>'
            + '            <option value="year-asc">年份 (舊→新)</option>'
            + '            <option value="question-asc">題號 (小→大)</option>'
            + '            <option value="question-desc">題號 (大→小)</option>'
            + '            <option value="marks-asc">分數 (低→高)</option>'
            + '            <option value="marks-desc">分數 (高→低)</option>'
            + '            <option value="percentage-asc">答對率 (低→高)</option>'
            + '            <option value="percentage-desc">答對率 (高→低)</option>'
            + '          </select></label>'
            + '          <label>題目／答案預設顯示<select id="us-qa-default" aria-label="題目與答案預設顯示">'
            + '            <option value="collapsed">預設摺疊</option>'
            + '            <option value="expanded">預設展開</option>'
            + '          </select></label>'
            + '          <p class="user-settings-note">控制題幹、答案、評卷報告各區塊載入時是否展開；仍可逐題手動摺疊／展開。</p>'
            + '        </div>'
            + '      </section>'
            + '      <section class="user-settings-panel" id="us-panel-filters" data-us-panel="filters" hidden>'
            + '        <h3 class="user-settings-panel-title">篩選偏好</h3>'
            + '        <div class="user-settings-section">'
            + '          <label class="user-settings-check"><input type="checkbox" id="us-exclude-out-syl"> 預設排除 Out syl</label>'
            + '          <label class="user-settings-check"><input type="checkbox" id="us-remember-last"> 記住搜尋範圍偏好</label>'
            + '          <label>預設搜尋範圍<select id="us-search-scope">'
            + '            <option value="all">全部欄位</option>'
            + '            <option value="id">題目 ID</option>'
            + '            <option value="content">題目內容</option>'
            + '            <option value="answer">答案</option>'
            + '            <option value="markersReport">評卷報告</option>'
            + '          </select></label>'
            + '          <p class="user-settings-note">不會儲存即時 idSet／進階篩選內容。</p>'
            + '        </div>'
            + '        <div class="user-settings-section">'
            + '          <h4 class="user-settings-subhead">統計</h4>'
            + '          <label>模式<select id="us-stats-mode">'
            + '            <option value="browse">一維瀏覽</option>'
            + '            <option value="crosstab">交叉分析</option>'
            + '          </select></label>'
            + '          <label>偏好維度<select id="us-stats-dimension"></select></label>'
            + '          <label>交叉列<select id="us-ct-row"></select></label>'
            + '          <label>交叉欄<select id="us-ct-col"></select></label>'
            + '          <label>交叉指標<select id="us-ct-metric"></select></label>'
            + '        </div>'
            + '      </section>'
            + '      <section class="user-settings-panel" id="us-panel-ai" data-us-panel="ai" hidden>'
            + '        <h3 class="user-settings-panel-title">AI</h3>'
            + '        <div class="user-settings-section" id="user-settings-ai-section">'
            + '          <label>預設供應商<select id="us-ai-provider" aria-label="預設供應商">'
            + '            <option value="poe">Poe</option>'
            + '            <option value="openrouter">OpenRouter</option>'
            + '          </select></label>'
            + '          <label>預設模型<select id="us-ai-model" aria-label="預設模型"></select></label>'
            + '          <label>自訂模型 id（選填）'
            + '            <input type="text" id="us-ai-model-custom" autocomplete="off" spellcheck="false" maxlength="120"'
            + '              placeholder="例如 Claude-Opus-4.6" aria-label="自訂模型 id">'
            + '          </label>'
            + '          <label>AI解釋詳細度<select id="us-ai-explain">'
            + '            <option value="short">簡短</option>'
            + '            <option value="detailed">詳盡</option>'
            + '          </select></label>'
            + '          <label class="user-settings-check"><input type="checkbox" id="us-ai-quick-prompts"> 顯示追問快捷提示</label>'
            + '          <p class="user-settings-note">模型清單與「API／模型設定」相同。API 金鑰只留在本機，不會上載。</p>'
            + '        </div>'
            + '      </section>'
            + '    </div>'
            + '    <nav class="user-settings-nav" aria-label="設定分類" role="tablist">'
            + '      <button type="button" class="user-settings-nav-btn is-active" role="tab" data-us-cat="ui" aria-controls="us-panel-ui" aria-selected="true">介面</button>'
            + '      <button type="button" class="user-settings-nav-btn" role="tab" data-us-cat="filters" aria-controls="us-panel-filters" aria-selected="false">篩選偏好</button>'
            + '      <button type="button" class="user-settings-nav-btn" role="tab" data-us-cat="ai" aria-controls="us-panel-ai" aria-selected="false" id="user-settings-nav-ai">AI</button>'
            + '    </nav>'
            + '  </div>'
            + '  <p class="user-settings-status" id="user-settings-status" hidden></p>'
            + '  <footer class="user-settings-footer">'
            + '    <button type="button" class="btn btn-secondary" id="user-settings-cancel">關閉</button>'
            + '    <button type="button" class="btn btn-primary" id="user-settings-save">套用並同步</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeModal();
        });
        overlay.querySelector('.user-settings-close').addEventListener('click', closeModal);
        overlay.querySelector('#user-settings-cancel').addEventListener('click', closeModal);
        overlay.querySelector('#user-settings-save').addEventListener('click', function () {
            readModalIntoSettings();
            setModalStatus('已套用' + (isSignedIn() ? '，正在同步…' : '（本機）'), 'info');
            if (isSignedIn()) flushRemoteSave();
        });
        overlay.querySelector('.user-settings-nav').addEventListener('click', function (event) {
            var btn = event.target && event.target.closest
                ? event.target.closest('[data-us-cat]')
                : null;
            if (!btn || btn.hidden) return;
            showSettingsCategory(btn.getAttribute('data-us-cat'));
        });
        var providerSel = overlay.querySelector('#us-ai-provider');
        var modelSel = overlay.querySelector('#us-ai-model');
        var modelCustom = overlay.querySelector('#us-ai-model-custom');
        if (providerSel) {
            providerSel.addEventListener('change', function () {
                var provider = usAiProviderFromSelect();
                var keep = modelCustom && String(modelCustom.value || '').trim()
                    ? String(modelCustom.value || '').trim()
                    : (modelSel ? String(modelSel.value || '').trim() : '');
                var Poe = global.PoeGenerate;
                // Preset lists differ by provider; don't carry a Poe id into OpenRouter (or vice versa).
                if (Poe && typeof Poe.isKnownModel === 'function' && keep && !Poe.isKnownModel(provider, keep)) {
                    keep = '';
                }
                fillUsAiModelControls(provider, keep);
            });
        }
        if (modelSel) {
            modelSel.addEventListener('change', function () {
                if (modelCustom) modelCustom.value = '';
            });
        }
        if (modelCustom) {
            modelCustom.addEventListener('change', function () {
                var provider = usAiProviderFromSelect();
                var Poe = global.PoeGenerate;
                var value = modelCustom.value;
                if (Poe && typeof Poe.sanitizeModelId === 'function') {
                    value = Poe.sanitizeModelId(provider, value);
                } else {
                    value = String(value || '').trim();
                }
                if (!value) return;
                fillUsAiModelControls(provider, value);
                modelCustom.value = value;
            });
        }
        return overlay;
    }

    function showSettingsCategory(cat) {
        if (!overlay) return;
        var allowed = { ui: 1, filters: 1, ai: 1 };
        var next = allowed[cat] ? cat : 'ui';
        if (next === 'ai' && !hasAiAccess()) next = 'ui';
        overlay.querySelectorAll('[data-us-panel]').forEach(function (panel) {
            var id = panel.getAttribute('data-us-panel');
            panel.hidden = id !== next;
        });
        overlay.querySelectorAll('[data-us-cat]').forEach(function (btn) {
            var id = btn.getAttribute('data-us-cat');
            var active = id === next;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.tabIndex = active ? 0 : -1;
        });
        var panels = overlay.querySelector('#user-settings-panels');
        if (panels) panels.scrollTop = 0;
    }

    function bindEscape() {
        if (escapeBound) return;
        escapeBound = true;
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (overlay && !overlay.hidden) closeModal();
        });
    }

    function openModal() {
        if (!isSignedIn()) return;
        ensureOverlay();
        bindEscape();
        fillModalFromSettings();
        showSettingsCategory('ui');
        setModalStatus('', '');
        overlay.hidden = false;
        document.body.classList.add('user-settings-open');
    }

    function closeModal() {
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('user-settings-open');
    }

    function bindLiveHooks() {
        if (bindLiveHooks.bound) return;
        bindLiveHooks.bound = true;
        document.addEventListener('change', function (event) {
            var t = event.target;
            if (!t) return;
            if (t.id === 'search-scope') {
                rememberSearchScope(t.value);
                return;
            }
            if (t.id === 'items-per-page' || t.id === 'sort-order') {
                rememberListPrefs();
                return;
            }
            if (t.id === 'stats-dimension' || t.closest('[data-ct-row],[data-ct-col],[data-ct-metric]')) {
                rememberStatsPrefs();
                return;
            }
            if (t.closest('[data-stats-mode]')) {
                // click handler below
            }
        });
        document.addEventListener('click', function (event) {
            if (event.target.closest('[data-stats-mode]')) {
                setTimeout(rememberStatsPrefs, 0);
            }
        });
    }

    async function initUserSettingsFeature() {
        refreshButton();
        bindEscape();
        bindLiveHooks();
        state.settings = migrateLegacyInto(normalizeSettings(readLocalRaw()));
        writeLocalRaw(state.settings);
        // Apply display early (font/density/lang) before first paint if possible.
        applyDisplay(state.settings);
        applyFilters(state.settings);

        state.readyPromise = (async function () {
            if (isSignedIn()) {
                await fetchRemoteAndMerge();
            }
            return getSettings();
        })();
        return state.readyPromise;
    }

    async function applyAfterUiReady() {
        if (state.readyPromise) {
            try { await state.readyPromise; } catch (e) { /* ignore */ }
        }
        applySettings({ includeTab: true, rerender: true });
        refreshButton();
    }

    global.UserSettings = {
        init: initUserSettingsFeature,
        applyAfterUiReady: applyAfterUiReady,
        get: getSettings,
        apply: applySettings,
        open: openModal,
        close: closeModal,
        refreshButton: refreshButton,
        scheduleSave: scheduleRemoteSave,
        featureTriStateDefault: featureTriStateDefault,
        rememberSearchScope: rememberSearchScope,
        rememberListPrefs: rememberListPrefs,
        rememberStatsPrefs: rememberStatsPrefs,
        LOCAL_KEY: LOCAL_KEY
    };
    global.initUserSettingsFeature = initUserSettingsFeature;
    global.emptyFeatureTriStateFromSettings = featureTriStateDefault;
})(window);
