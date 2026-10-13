// data-checks.js
// Admin-only data checks for ken.
//
// What this is
// ------------
// A small, independent panel that lists consistency checks over the loaded
// question bank. Each check has a mode plus a free combination of conditions
// (AND). Default mode perQuestion: every matching question (minus exceptions)
// needs handling. Mode crossPaperSameYear (UI: 同年跨卷重疊): match with the
// same conditions, then group by examination + year; a group is a hit only when
// ≥2 distinct non-empty paper values appear — all matching IDs in hit groups
// (minus exceptions) need handling. Exceptions are unchanged in both modes.
//
// Who can see it
// --------------
// Only the signed-in username "ken" (matched the same way the rest of the app
// lowercases authManager.currentUser / gitUsername), and only when
// accessRights.admin is true. Everyone else must not see the button, the view,
// or any counts. Visibility is refreshed whenever applyAccessRights runs.
//
// How to add / edit / remove a check
// ----------------------------------
// Prefer the in-panel UI (標題、條件、例外、新增檢查、下載). On open the panel
// shows localStorage cache (or DEFAULT_DATA_CHECKS) and counts immediately.
// Automatic syncDataChecksDownload runs only on the first open in a session,
// or when this browser has no usable cache; later opens reuse localStorage.
// Use 「下載」 to pull the shared file manually. Mutating controls stay disabled
// while a remote load is in flight. 「新增檢查」 opens a local draft only;
// upload runs on explicit 「儲存」 / delete when the list actually changed.
//
// The DEFAULT_DATA_CHECKS list below remains the seed / fallback when the
// remote file is missing. You can still edit that list in source:
// - To change the defaults: edit DEFAULT_DATA_CHECKS.
// - To add a default: append an object with id, name, conditions, exceptions.
// - To remove a default: delete that object from the array.
// - Conditions in one check are AND.
//
// Check shape
// -----------
// {
//   id: 'stable-slug',
//   name: 'Short Traditional Chinese label',
//   // perQuestion (default; omit or explicit) | crossPaperSameYear (同年跨卷重疊)
//   mode: 'perQuestion',
//   conditions: [
//     // Preferred shape (saved by the editor):
//     //   { include: true|false, field: '<real field id>', value: '…' }
//     // field ids are the bank / filter properties, e.g. text, concepts,
//     // graphType, tableType, AristochapterClassification, patterns, …
//     // Legacy type-only rows still load:
//     //   textContains / textNotContains / conceptPresent / conceptAbsent
//     { include: true, field: 'text', value: '機會成本' },
//     { include: false, field: 'concepts', value: '機會成本' }
//   ],
//   // Question IDs (same format as question.id), e.g. 'DSE-2026-P1-01'.
//   // An exception still matches the conditions, but is excluded from the
//   // "needs handling" count / ID list. It still appears in the exception count.
//   exceptions: []
// }
//
// Condition editor
// ----------------
// Each condition row: 「包含」/「不包括」 (exactly one), a field <select> of
// real filterable question fields, and a value box. Category fields offer
// autocomplete from values present in the loaded bank. 字串 (question text)
// is free text (no autocomplete).
//
// Persistence
// -----------
// Modal has two tabs: 「資料檢查」(error/inconsistency checks) and
// 「關注組合」(saved watch filter combos — match counts, not errors).
//
// 資料檢查 source of truth: shared/data/data-checks.json in
// mas-repo/econ-database-data. Downloads prefer direct GitHub via
// issueSharedReadToken; uploads stay on Apps Script syncDataChecksUpload
// (ken + githubSync). localStorage key
// econ_data_checks_v1:<username> is a session/cache. Auto-download is once
// per session (or when cache is empty); 「下載」 forces a pull. Auto-upload
// runs only after explicit 「儲存」 or delete — not while a draft editor is
// open. Remote refresh must not replace an in-progress draft. Missing remote
// file → keep cache/defaults (does not wipe the bank).
//
// 關注組合 is local-only (econ_watch_combos_v1:<username>). It never calls
// syncDataChecks* and never writes the shared checks file — so adding a
// watch combo cannot clobber an in-progress check draft via upload refresh.
//
// Clicking a needs-handling ID clears the question filters, sets search scope
// to 題目 ID, fills that id, switches to the 題目 tab, and runs filterQuestions
// — the same filter path the rest of the app uses. 「篩選全部待處理」 applies an
// internal ID-set filter (window.idSetFilter) for every pending ID at once —
// not via the comma-separated search box — then lands on the 題目 tab.
//
// Condition matching is shared with 進階篩選 via condition-match.js. Remote
// sync (syncDataChecks*) is data-checks only; advanced filter stays local.
//
// Concepts and other category fields use the same exact-value match the
// filters use (array includes / scalar equality). Question text (字串) is a
// substring of questionTextChi, questionTextEng, and plainText.
//
// Dependencies: ConditionMatch, question-list-filter.js (ID-set apply),
// auth / accessRights (visibility), IndexedDBStorage.getQuestions (data),
// filters.js clearFilters / filterQuestions, tabs switchTab. Does not
// change question data.

(function () {
    'use strict';

    // =====================================================================
    // Default / seeded checks — used when ken has no saved edits.
    // =====================================================================
    var DEFAULT_DATA_CHECKS = [
        {
            id: 'text-opp-cost-missing-concept',
            name: '題文有「機會成本」但概念未標機會成本',
            conditions: [
                { type: 'textContains', value: '機會成本' },
                { type: 'conceptAbsent', value: '機會成本' }
            ],
            // Question IDs in the bank format, e.g. 'DSE-2026-P1-01'.
            exceptions: []
        },
        {
            id: 'classical-qty-without-qty-theory',
            name: '概念有古典貨幣數量論但缺貨幣數量論',
            conditions: [
                { type: 'conceptPresent', value: '古典貨幣數量論' },
                { type: 'conceptAbsent', value: '貨幣數量論' }
            ],
            // Question IDs in the bank format, e.g. 'DSE-2026-P1-01'.
            exceptions: []
        }
    ];

    var DATA_CHECKS_USERNAME = 'ken';
    var STORAGE_PREFIX = 'econ_data_checks_v1:';
    var WATCH_STORAGE_PREFIX = 'econ_watch_combos_v1:';
    var REMOTE_SOURCE = 'remote';
    var DEFAULT_SOURCE = 'defaults';
    var CACHE_SOURCE = 'cache';
    var checksSource = DEFAULT_SOURCE;
    var checksBusy = false;
    var checksStatusText = '';
    var activePanelTab = 'checks'; // 'checks' | 'watches'
    var activeWatches = null;
    var editingWatchId = null;
    var unsavedWatchDraftIds = {};
    // Field catalog + matching live in condition-match.js (shared with 進階篩選).
    function Match() {
        return window.ConditionMatch || null;
    }
    function conditionFields() {
        var m = Match();
        return (m && m.FIELDS) || [];
    }
    function conditionFieldById() {
        var m = Match();
        return (m && m.FIELD_BY_ID) || {};
    }
    var CONDITION_FIELDS = conditionFields(); // refreshed via conditionFields() in UI helpers
    var CONDITION_FIELD_BY_ID = conditionFieldById();

    var overlay = null;
    var openDetails = {};
    var editingCheckId = null;
    // Ids created by 「新增檢查」 that have not been saved/uploaded yet.
    var unsavedDraftIds = {};
    var cachedQuestions = null;
    var activeChecks = null;
    var conditionRowSeq = 0;
    var mutationsLocked = false;
    var remoteLoadToken = 0;
    // After the first auto remote fetch in this page session succeeds or
    // completes, later opens skip syncDataChecksDownload unless cache is empty.
    var sessionRemoteFetchDone = false;
    var lastSyncedFingerprint = '';

    function currentUsername() {
        if (typeof gitUsername === 'function') {
            return String(gitUsername() || '').trim().toLowerCase();
        }
        if (!window.authManager || !window.authManager.currentUser) return '';
        return String(window.authManager.currentUser).trim().toLowerCase();
    }

    function canSeeDataChecks() {
        if (currentUsername() !== DATA_CHECKS_USERNAME) return false;
        return !!(window.accessRights && window.accessRights.admin === true);
    }

    function storageKeyForUser(username) {
        var user = String(username || '').trim().toLowerCase();
        if (!user) return '';
        return STORAGE_PREFIX + user;
    }

    function cloneChecks(list) {
        return JSON.parse(JSON.stringify(list || []));
    }

    function resolveFieldId(rawField) {
        var m = Match();
        return m ? m.resolveFieldId(rawField) : '';
    }

    function normalizeCondition(raw) {
        var m = Match();
        return m ? m.normalizeCondition(raw) : null;
    }

    function normalizeCheckMode(rawMode) {
        var mode = String(rawMode == null ? '' : rawMode).trim();
        if (mode === 'crossPaperSameYear') return 'crossPaperSameYear';
        return 'perQuestion';
    }

    function normalizeCheck(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        var id = String(raw.id == null ? '' : raw.id).trim();
        if (!id) id = 'check-' + String(index + 1) + '-' + Date.now().toString(36);
        var conditions = Array.isArray(raw.conditions)
            ? raw.conditions.map(normalizeCondition).filter(Boolean)
            : [];
        var exceptions = Array.isArray(raw.exceptions)
            ? raw.exceptions.map(function (item) {
                return String(item == null ? '' : item).trim();
            }).filter(Boolean)
            : [];
        return {
            id: id,
            name: String(raw.name == null ? '' : raw.name).trim() || '未命名檢查',
            mode: normalizeCheckMode(raw.mode),
            conditions: conditions,
            exceptions: exceptions
        };
    }

    function normalizeChecks(list) {
        if (!Array.isArray(list)) return cloneChecks(DEFAULT_DATA_CHECKS);
        return list.map(normalizeCheck).filter(Boolean);
    }

    function checksPayload(checks) {
        return {
            version: 1,
            checks: normalizeChecks(checks)
        };
    }

    function readSavedChecks(username) {
        var key = storageKeyForUser(username);
        if (!key) return null;
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            var list = Array.isArray(parsed.checks) ? parsed.checks : parsed;
            if (!Array.isArray(list)) return null;
            return normalizeChecks(list);
        } catch (error) {
            return null;
        }
    }

    function writeSavedChecks(username, checks) {
        var key = storageKeyForUser(username);
        if (!key) return false;
        try {
            localStorage.setItem(key, JSON.stringify(checksPayload(checks)));
            return true;
        } catch (error) {
            return false;
        }
    }


    function watchStorageKeyForUser(username) {
        var user = String(username || '').trim().toLowerCase();
        if (!user) return '';
        return WATCH_STORAGE_PREFIX + user;
    }

    function normalizeWatch(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        var id = String(raw.id == null ? '' : raw.id).trim();
        if (!id) id = 'watch-' + String(index + 1) + '-' + Date.now().toString(36);
        var conditions = Array.isArray(raw.conditions)
            ? raw.conditions.map(normalizeCondition).filter(Boolean)
            : [];
        return {
            id: id,
            name: String(raw.name == null ? '' : raw.name).trim() || '未命名關注',
            conditions: conditions
        };
    }

    function normalizeWatches(list) {
        if (!Array.isArray(list)) return [];
        return list.map(normalizeWatch).filter(Boolean);
    }

    function readSavedWatches(username) {
        var key = watchStorageKeyForUser(username);
        if (!key) return [];
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            var list = Array.isArray(parsed) ? parsed
                : (parsed && Array.isArray(parsed.watches) ? parsed.watches : null);
            return normalizeWatches(list || []);
        } catch (error) {
            return [];
        }
    }

    function writeSavedWatches(username, watches) {
        var key = watchStorageKeyForUser(username);
        if (!key) return false;
        try {
            localStorage.setItem(key, JSON.stringify({
                version: 1,
                watches: normalizeWatches(watches)
            }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function loadActiveWatches() {
        if (!canSeeDataChecks()) {
            activeWatches = [];
            return activeWatches;
        }
        if (Array.isArray(activeWatches)) return activeWatches;
        activeWatches = readSavedWatches(currentUsername());
        return activeWatches;
    }

    function persistWatchesLocal() {
        if (!canSeeDataChecks()) return false;
        activeWatches = normalizeWatches(activeWatches);
        var toSave = activeWatches.filter(function (watch) {
            return !(watch && unsavedWatchDraftIds[watch.id]);
        });
        writeSavedWatches(currentUsername(), toSave);
        setChecksStatus('關注組合已儲存本機');
        return true;
    }

    function countWatchMatches(questions, watch) {
        var m = Match();
        if (!m || typeof m.matchingQuestionIds !== 'function') return 0;
        return m.matchingQuestionIds(questions || [], (watch && watch.conditions) || []).length;
    }

    function setChecksStatus(text) {
        checksStatusText = String(text || '');
        var note = document.getElementById('data-checks-footer-note');
        if (!note) return;
        var base = note.getAttribute('data-dc-base') || note.textContent || '';
        if (checksStatusText) {
            note.textContent = base + ' · ' + checksStatusText;
        } else {
            note.textContent = base;
        }
    }

    async function downloadChecksFromRemote() {
        if (!canSeeDataChecks()) {
            var denied = new Error('feature_unavailable');
            denied.code = 'feature_unavailable';
            throw denied;
        }
        if (typeof fetchSharedJsonDirectOrProxy === 'function') {
            try {
                var direct = await fetchSharedJsonDirectOrProxy('data/data-checks.json', 60000);
                if (direct && direct.data && Array.isArray(direct.data.checks)) {
                    return normalizeChecks(direct.data.checks);
                }
            } catch (directErr) {
                // Fall back to Apps Script syncDataChecksDownload.
            }
        }
        if (typeof gitProxyRequest !== 'function') {
            var missing = new Error('network');
            missing.code = 'network';
            throw missing;
        }
        var data = await gitProxyRequest({
            action: 'syncDataChecksDownload',
            username: currentUsername()
        }, 60000);
        if (!data || data.ok !== true) {
            var failed = new Error((data && data.error) || 'github_error');
            failed.code = data && data.error ? data.error : 'github_error';
            throw failed;
        }
        if (!data.data || !Array.isArray(data.data.checks)) {
            var bad = new Error('github_error');
            bad.code = 'github_error';
            throw bad;
        }
        return normalizeChecks(data.data.checks);
    }

    async function uploadChecksToRemote(checks) {
        if (!canSeeDataChecks()) {
            var denied = new Error('feature_unavailable');
            denied.code = 'feature_unavailable';
            throw denied;
        }
        if (typeof gitProxyRequest !== 'function') {
            var missing = new Error('network');
            missing.code = 'network';
            throw missing;
        }
        var payload = checksPayload(checks);
        var data = await gitProxyRequest({
            action: 'syncDataChecksUpload',
            username: currentUsername(),
            data: payload
        }, 60000);
        if (!data || data.ok !== true) {
            var failed = new Error((data && data.error) || 'github_error');
            failed.code = data && data.error ? data.error : 'github_error';
            throw failed;
        }
        return payload.checks;
    }

    function fingerprintChecks(checks) {
        return JSON.stringify(normalizeChecks(checks));
    }

    function markChecksSynced(checks) {
        lastSyncedFingerprint = fingerprintChecks(checks);
    }

    function hasUsableLocalCache() {
        return !!readSavedChecks(currentUsername());
    }

    function shouldAutoDownloadOnOpen() {
        if (!hasUsableLocalCache()) return true;
        return !sessionRemoteFetchDone;
    }

    async function loadActiveChecksFromSource() {
        // Kept for compatibility; open path uses cache-first + optional remote.
        return loadChecksFromLocalCache();
    }

    function loadChecksFromLocalCache() {
        if (!canSeeDataChecks()) {
            activeChecks = cloneChecks(DEFAULT_DATA_CHECKS);
            checksSource = DEFAULT_SOURCE;
            return activeChecks;
        }
        var saved = readSavedChecks(currentUsername());
        if (saved) {
            activeChecks = saved;
            checksSource = CACHE_SOURCE;
        } else {
            activeChecks = cloneChecks(DEFAULT_DATA_CHECKS);
            checksSource = DEFAULT_SOURCE;
        }
        return activeChecks;
    }

    function loadActiveChecks() {
        if (!canSeeDataChecks()) {
            activeChecks = cloneChecks(DEFAULT_DATA_CHECKS);
            return activeChecks;
        }
        if (Array.isArray(activeChecks)) return activeChecks;
        return loadChecksFromLocalCache();
    }

    function applyToolbarLock() {
        var addBtn = document.getElementById('data-checks-add');
        if (addBtn) {
            addBtn.disabled = mutationsLocked;
            addBtn.textContent = activePanelTab === 'watches' ? '＋ 新增關注' : '＋ 新增檢查';
        }
        var downloadBtn = document.getElementById('data-checks-download');
        if (downloadBtn) {
            downloadBtn.disabled = mutationsLocked || activePanelTab === 'watches';
            downloadBtn.hidden = activePanelTab === 'watches';
        }
    }

    function updatePanelChrome() {
        var subtitle = document.getElementById('data-checks-subtitle');
        if (subtitle) {
            if (activePanelTab === 'watches') {
                subtitle.textContent = '儲存想持續留意的篩選組合（本機）。顯示符合題數；點題數或「套用」會以進階篩選套用該組合。關注組合不是錯誤檢查，也不會上傳到共用資料庫。';
            } else {
                subtitle.textContent = '列出仍需處理的題目（符合條件且不在該檢查的例外清單）。檢查模式可選普通檢查或同年跨卷重疊；可編輯標題、條件與例外；點題號會用既有「題目 ID」篩選顯示該題；「篩選全部待處理」會一次套用整批待處理編號（不經搜尋框）。';
            }
        }
        if (overlay) {
            overlay.querySelectorAll('[data-dc-tab]').forEach(function (btn) {
                var on = btn.getAttribute('data-dc-tab') === activePanelTab;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
        }
        applyToolbarLock();
    }

    function switchPanelTab(tab) {
        var next = tab === 'watches' ? 'watches' : 'checks';
        if (next === activePanelTab) return;
        // Leaving a tab abandons unsaved drafts on that tab (same as cancel).
        if (activePanelTab === 'checks' && editingCheckId && unsavedDraftIds[editingCheckId]) {
            loadActiveChecks();
            activeChecks = activeChecks.filter(function (check) {
                return check.id !== editingCheckId;
            });
            delete unsavedDraftIds[editingCheckId];
        }
        if (activePanelTab === 'watches' && editingWatchId && unsavedWatchDraftIds[editingWatchId]) {
            loadActiveWatches();
            activeWatches = activeWatches.filter(function (watch) {
                return watch.id !== editingWatchId;
            });
            delete unsavedWatchDraftIds[editingWatchId];
        }
        editingCheckId = null;
        editingWatchId = null;
        activePanelTab = next;
        updatePanelChrome();
        renderFromCache();
    }

    function setMutationsLocked(locked) {
        mutationsLocked = !!locked;
        if (mutationsLocked) editingCheckId = null;
        applyToolbarLock();
    }

    function logRemoteLoadError(error) {
        var code = (error && error.code) ? String(error.code) : 'unknown';
        var detail = error && error.message ? String(error.message) : '';
        var message = '[資料檢查] syncDataChecksDownload failed (error code: ' + code + ')';
        if (detail && detail !== code) message += ' — ' + detail;
        console.error(message, error || null);
    }

    async function refreshChecksFromRemoteInBackground(token, options) {
        options = options || {};
        var isManual = options.manual === true;
        try {
            var remote = await downloadChecksFromRemote();
            if (token !== remoteLoadToken) return;
            sessionRemoteFetchDone = true;
            // Never replace an in-progress editor from a post-download refresh.
            if (editingCheckId) {
                setMutationsLocked(false);
                if (!overlay || overlay.hidden) return;
                setChecksStatus('編輯中，略過遠端覆寫');
                return;
            }
            activeChecks = remote;
            checksSource = REMOTE_SOURCE;
            writeSavedChecks(currentUsername(), activeChecks);
            markChecksSynced(activeChecks);
            setMutationsLocked(false);
            if (!overlay || overlay.hidden) return;
            setChecksStatus(isManual ? '已下載共用設定' : '已從共用資料庫載入');
            renderFromCache();
        } catch (error) {
            if (token !== remoteLoadToken) return;
            sessionRemoteFetchDone = true;
            logRemoteLoadError(error);
            setMutationsLocked(false);
            if (!overlay || overlay.hidden) return;
            var code = error && error.code ? error.code : '';
            if (code === 'github_not_found') {
                markChecksSynced(activeChecks);
                setChecksStatus('共用檔尚未建立；保留' + (checksSource === CACHE_SOURCE ? '本機快取' : '預設檢查'));
            } else {
                setChecksStatus((isManual ? '下載失敗' : '同步失敗') + '；保留' + (checksSource === CACHE_SOURCE ? '本機快取' : '預設檢查'));
            }
            renderFromCache();
        }
    }

    function startRemoteDownload(options) {
        options = options || {};
        setMutationsLocked(true);
        setChecksStatus(options.manual ? '正在下載共用設定…' : '正在同步共用設定…');
        renderFromCache();
        applyToolbarLock();
        var token = ++remoteLoadToken;
        refreshChecksFromRemoteInBackground(token, options);
        return token;
    }

    async function manualDownloadChecks() {
        if (!canSeeDataChecks() || mutationsLocked) return;
        startRemoteDownload({ manual: true });
    }

    async function persistActiveChecks() {
        if (!canSeeDataChecks()) return false;
        if (mutationsLocked) return false;
        activeChecks = normalizeChecks(activeChecks);
        // Never upload / cache-stamp an open 「新增檢查」 draft — only explicit save.
        var toPersist = activeChecks.filter(function (check) {
            return !(check && unsavedDraftIds[check.id]);
        });
        writeSavedChecks(currentUsername(), toPersist);
        var fingerprint = fingerprintChecks(toPersist);
        if (fingerprint === lastSyncedFingerprint) {
            setChecksStatus('沒有變更，略過上傳');
            return true;
        }
        if (checksBusy) return false;
        checksBusy = true;
        setChecksStatus('正在儲存到資料庫…');
        try {
            await uploadChecksToRemote(toPersist);
            checksSource = REMOTE_SOURCE;
            writeSavedChecks(currentUsername(), toPersist);
            markChecksSynced(toPersist);
            setChecksStatus('已儲存到共用資料庫');
            return true;
        } catch (error) {
            var message = (typeof gitFailureText === 'function')
                ? gitFailureText(error)
                : '儲存失敗';
            setChecksStatus('儲存失敗（已暫存本機）：' + message);
            if (typeof showNotification === 'function') {
                showNotification('資料檢查儲存失敗：' + message, 'error');
            }
            return false;
        } finally {
            checksBusy = false;
        }
    }

    function matchesCondition(question, condition) {
        var m = Match();
        return !!(m && m.matchesCondition(question, condition));
    }

    function matchesCheck(question, check) {
        var m = Match();
        if (!m) return false;
        return m.matchesAllConditions(question, (check && check.conditions) || []);
    }

    function collectFieldValues(fieldId) {
        var m = Match();
        return m ? m.collectFieldValues(fieldId, cachedQuestions || []) : [];
    }

    function fieldLabel(fieldId) {
        var m = Match();
        return m ? m.fieldLabel(fieldId) : fieldId;
    }

    function exceptionSet(check) {
        var set = {};
        ((check && check.exceptions) || []).forEach(function (id) {
            var key = String(id == null ? '' : id).trim();
            if (key) set[key] = true;
        });
        return set;
    }

    function yearKeyForCheck(year) {
        if (typeof normalizeYearFilterKey === 'function') {
            var keyed = normalizeYearFilterKey(year);
            return String(keyed == null ? '' : keyed).trim();
        }
        return String(year == null ? '' : year).trim();
    }

    function examKeyForCheck(examination) {
        return String(examination == null ? '' : examination).trim();
    }

    function paperKeyForCheck(paper) {
        return String(paper == null ? '' : paper).trim();
    }

    function sortIdsLocale(list) {
        list.sort(function (a, b) { return a.localeCompare(b, 'zh-HK'); });
        return list;
    }

    function evaluatePerQuestionCheck(questions, check) {
        var excepted = exceptionSet(check);
        var needs = [];
        var exceptions = [];
        (questions || []).forEach(function (question) {
            if (!matchesCheck(question, check)) return;
            var id = String(question && question.id != null ? question.id : '').trim();
            if (id && excepted[id]) exceptions.push(id);
            else if (id) needs.push(id);
            else needs.push('(無編號)');
        });
        sortIdsLocale(needs);
        sortIdsLocale(exceptions);
        return {
            check: check,
            mode: 'perQuestion',
            needsHandling: needs,
            exceptionIds: exceptions,
            needsCount: needs.length,
            exceptionCount: exceptions.length,
            hitGroups: []
        };
    }

    function evaluateCrossPaperSameYearCheck(questions, check) {
        var excepted = exceptionSet(check);
        var groups = {};
        (questions || []).forEach(function (question) {
            if (!matchesCheck(question, check)) return;
            var exam = examKeyForCheck(question && question.examination);
            var yKey = yearKeyForCheck(question && question.year);
            var groupKey = exam + '\0' + yKey;
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    examination: exam,
                    yearKey: yKey,
                    papers: {},
                    ids: []
                };
            }
            var paper = paperKeyForCheck(question && question.paper);
            if (paper) groups[groupKey].papers[paper] = true;
            var id = String(question && question.id != null ? question.id : '').trim();
            groups[groupKey].ids.push(id || '(無編號)');
        });

        var needs = [];
        var exceptions = [];
        var hitGroups = [];
        var seenNeed = {};
        var seenExc = {};

        Object.keys(groups).forEach(function (groupKey) {
            var group = groups[groupKey];
            var papers = Object.keys(group.papers);
            if (papers.length < 2) return;
            papers.sort(function (a, b) { return a.localeCompare(b, 'zh-HK'); });
            hitGroups.push({
                examination: group.examination,
                yearKey: group.yearKey,
                papers: papers,
                ids: group.ids.slice()
            });
            group.ids.forEach(function (id) {
                if (id && id !== '(無編號)' && excepted[id]) {
                    if (!seenExc[id]) {
                        seenExc[id] = true;
                        exceptions.push(id);
                    }
                    return;
                }
                var key = id || '(無編號)';
                if (!seenNeed[key]) {
                    seenNeed[key] = true;
                    needs.push(key);
                }
            });
        });

        hitGroups.sort(function (a, b) {
            var ae = a.examination || '';
            var be = b.examination || '';
            if (ae !== be) return ae.localeCompare(be, 'zh-HK');
            return String(a.yearKey || '').localeCompare(String(b.yearKey || ''), 'zh-HK');
        });
        sortIdsLocale(needs);
        sortIdsLocale(exceptions);
        return {
            check: check,
            mode: 'crossPaperSameYear',
            needsHandling: needs,
            exceptionIds: exceptions,
            needsCount: needs.length,
            exceptionCount: exceptions.length,
            hitGroups: hitGroups
        };
    }

    function evaluateCheck(questions, check) {
        var mode = normalizeCheckMode(check && check.mode);
        if (mode === 'crossPaperSameYear') {
            return evaluateCrossPaperSameYearCheck(questions, check);
        }
        return evaluatePerQuestionCheck(questions, check);
    }

    function checkModeLabel(mode) {
        return normalizeCheckMode(mode) === 'crossPaperSameYear'
            ? '同年跨卷重疊'
            : '普通檢查';
    }

    // Display year like the 題目 year filter (MT29 not bare 29). Mock papers
    // store examination "HKDSE" + year "MT##"; after normalizeYearFilterKey the
    // group key is digits-only — do not prefix those with HKDSE.
    function formatHitGroupLabel(group) {
        var yearRaw = group && group.yearKey != null ? group.yearKey : '';
        var yearLabel;
        if (typeof yearFilterLabel === 'function') {
            yearLabel = yearFilterLabel(yearRaw);
        } else {
            yearLabel = String(yearRaw == null ? '' : yearRaw).trim();
            if (/^\d{1,3}$/.test(yearLabel)) yearLabel = 'MT' + yearLabel;
        }
        if (!yearLabel) yearLabel = '（無年份）';
        var papers = (group && group.papers && group.papers.length)
            ? group.papers.join('、')
            : '（無卷別）';
        var isMockYear = /^MT\d/i.test(yearLabel) || /^\d{1,3}$/.test(String(yearRaw).trim());
        if (isMockYear) {
            return yearLabel + '（' + papers + '）';
        }
        var exam = (group && group.examination) ? group.examination : '（無考試）';
        return exam + ' ' + yearLabel + '（' + papers + '）';
    }

    function ensureButton() {
        var host = document.querySelector('header div[style*="flex-wrap"]') ||
            document.querySelector('header');
        if (!host) return null;
        var button = document.getElementById('data-checks-btn');
        if (button) return button;
        button = document.createElement('button');
        button.type = 'button';
        button.id = 'data-checks-btn';
        button.className = 'btn btn-outline-primary header-toolbar-btn';
        button.hidden = true;
        button.textContent = '資料檢查';
        button.setAttribute('aria-label', '資料檢查');
        button.addEventListener('click', function () {
            openDataChecksPanel();
        });
        var adminBtn = document.getElementById('admin-mode-btn');
        if (adminBtn && adminBtn.parentNode === host) {
            host.insertBefore(button, adminBtn.nextSibling);
        } else {
            host.appendChild(button);
        }
        return button;
    }

    function refreshDataChecksVisibility() {
        var button = ensureButton();
        if (!button) return;
        var allowed = canSeeDataChecks();
        button.hidden = !allowed;
        if (!allowed) {
            editingCheckId = null;
            closeDataChecksPanel();
        }
    }

    function closeDataChecksPanel() {
        if (overlay) {
            overlay.hidden = true;
        }
        document.body.classList.remove('data-checks-open');
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'data-checks-overlay';
        overlay.className = 'data-checks-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="data-checks-dialog" role="dialog" aria-modal="true" aria-labelledby="data-checks-title">'
            + '  <header class="data-checks-header">'
            + '    <div>'
            + '      <h2 id="data-checks-title">資料檢查</h2>'
            + '      <p class="data-checks-subtitle" id="data-checks-subtitle">列出仍需處理的題目（符合條件且不在該檢查的例外清單）。檢查模式可選普通檢查或同年跨卷重疊；可編輯標題、條件與例外；點題號會用既有「題目 ID」篩選顯示該題；「篩選全部待處理」會一次套用整批待處理編號（不經搜尋框）。</p>'
            + '    </div>'
            + '    <button type="button" class="data-checks-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="data-checks-tabs" role="tablist" aria-label="資料檢查分頁">'
            + '    <button type="button" class="data-checks-tab is-active" role="tab" data-dc-tab="checks" aria-selected="true">資料檢查</button>'
            + '    <button type="button" class="data-checks-tab" role="tab" data-dc-tab="watches" aria-selected="false">關注組合</button>'
            + '  </div>'
            + '  <div class="data-checks-toolbar">'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="data-checks-add">＋ 新增檢查</button>'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="data-checks-download">下載</button>'
            + '  </div>'
            + '  <div class="data-checks-body" id="data-checks-body"></div>'
            + '  <footer class="data-checks-footer">'
            + '    <p class="data-checks-footer-note" id="data-checks-footer-note"></p>'
            + '    <button type="button" class="btn btn-secondary" id="data-checks-done">完成</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeDataChecksPanel();
        });
        overlay.querySelector('.data-checks-close').addEventListener('click', closeDataChecksPanel);
        overlay.querySelector('#data-checks-done').addEventListener('click', closeDataChecksPanel);
        overlay.querySelector('#data-checks-add').addEventListener('click', function () {
            if (activePanelTab === 'watches') addBlankWatch();
            else addBlankCheck();
        });
        overlay.querySelector('#data-checks-download').addEventListener('click', function () {
            manualDownloadChecks();
        });
        overlay.querySelector('.data-checks-tabs').addEventListener('click', function (event) {
            var tab = event.target.closest('[data-dc-tab]');
            if (!tab) return;
            switchPanelTab(tab.getAttribute('data-dc-tab'));
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDataChecksPanel();
            }
        });
        overlay.addEventListener('click', function (event) {
            var applyWatchBtn = event.target.closest('[data-dc-watch-apply]');
            if (applyWatchBtn) {
                event.preventDefault();
                applyWatchCombo(applyWatchBtn.getAttribute('data-dc-watch-apply'));
                return;
            }
            var editWatchBtn = event.target.closest('[data-dc-watch-edit]');
            if (editWatchBtn) {
                if (mutationsLocked) return;
                editingWatchId = editWatchBtn.getAttribute('data-dc-watch-edit');
                renderFromCache();
                return;
            }
            var cancelWatchBtn = event.target.closest('[data-dc-watch-cancel]');
            if (cancelWatchBtn) {
                if (mutationsLocked) return;
                var cancelWatchId = cancelWatchBtn.getAttribute('data-dc-watch-cancel');
                if (cancelWatchId && unsavedWatchDraftIds[cancelWatchId]) {
                    loadActiveWatches();
                    activeWatches = activeWatches.filter(function (watch) {
                        return watch.id !== cancelWatchId;
                    });
                    delete unsavedWatchDraftIds[cancelWatchId];
                }
                editingWatchId = null;
                renderFromCache();
                return;
            }
            var saveWatchBtn = event.target.closest('[data-dc-watch-save]');
            if (saveWatchBtn) {
                if (mutationsLocked) return;
                saveEditedWatch(saveWatchBtn.getAttribute('data-dc-watch-save'));
                return;
            }
            var deleteWatchBtn = event.target.closest('[data-dc-watch-delete]');
            if (deleteWatchBtn) {
                if (mutationsLocked) return;
                deleteWatch(deleteWatchBtn.getAttribute('data-dc-watch-delete'));
                return;
            }
            var idBtn = event.target.closest('[data-dc-qid]');
            if (idBtn) {
                event.preventDefault();
                showQuestionById(idBtn.getAttribute('data-dc-qid'));
                return;
            }
            var filterAllBtn = event.target.closest('[data-dc-filter-all]');
            if (filterAllBtn) {
                event.preventDefault();
                showAllPendingForCheck(filterAllBtn.getAttribute('data-dc-filter-all'));
                return;
            }
            var editBtn = event.target.closest('[data-dc-edit]');
            if (editBtn) {
                if (mutationsLocked) return;
                editingCheckId = editBtn.getAttribute('data-dc-edit');
                renderFromCache();
                return;
            }
            var cancelBtn = event.target.closest('[data-dc-cancel]');
            if (cancelBtn) {
                if (mutationsLocked) return;
                var cancelId = cancelBtn.getAttribute('data-dc-cancel');
                if (cancelId && unsavedDraftIds[cancelId]) {
                    loadActiveChecks();
                    activeChecks = activeChecks.filter(function (check) {
                        return check.id !== cancelId;
                    });
                    delete unsavedDraftIds[cancelId];
                }
                editingCheckId = null;
                renderFromCache();
                return;
            }
            var saveBtn = event.target.closest('[data-dc-save]');
            if (saveBtn) {
                if (mutationsLocked) return;
                saveEditedCheck(saveBtn.getAttribute('data-dc-save'));
                return;
            }
            var deleteBtn = event.target.closest('[data-dc-delete]');
            if (deleteBtn) {
                if (mutationsLocked) return;
                deleteCheck(deleteBtn.getAttribute('data-dc-delete'));
                return;
            }
            var addCond = event.target.closest('[data-dc-add-cond]');
            if (addCond) {
                if (mutationsLocked) return;
                addConditionRow(addCond.getAttribute('data-dc-add-cond'));
                return;
            }
            var addWatchCond = event.target.closest('[data-dc-watch-add-cond]');
            if (addWatchCond) {
                event.preventDefault();
                addWatchConditionRow(addWatchCond.getAttribute('data-dc-watch-add-cond'));
                return;
            }
            var removeCond = event.target.closest('[data-dc-remove-cond]');
            if (removeCond) {
                if (mutationsLocked) return;
                removeConditionRow(removeCond);
            }
        });
        overlay.addEventListener('change', function (event) {
            var includeBox = event.target.closest('input[data-dc-include]');
            if (includeBox) {
                enforceExclusivePair(includeBox, 'data-dc-include');
                return;
            }
            var fieldSelect = event.target.closest('select[data-dc-field]');
            if (fieldSelect) {
                refreshConditionAutocomplete(fieldSelect.closest('[data-dc-cond-row]'));
            }
        });
        return overlay;
    }

    function conditionSummary(check) {
        var m = Match();
        if (m && typeof m.conditionSummaryText === 'function') {
            return m.conditionSummaryText((check && check.conditions) || []);
        }
        return '';
    }

    function fieldSelectHtml(selectedField) {
        return conditionFields().map(function (def) {
            var sel = def.id === selectedField ? ' selected' : '';
            return '<option value="' + escapeAttr(def.id) + '"' + sel + '>' + escapeHtml(def.label) + '</option>';
        }).join('');
    }

    function datalistHtml(listId, fieldId) {
        var def = conditionFieldById()[fieldId];
        if (!def || !def.autocomplete) {
            return '<datalist id="' + escapeAttr(listId) + '"></datalist>';
        }
        var options = collectFieldValues(fieldId).map(function (value) {
            return '<option value="' + escapeAttr(value) + '"></option>';
        }).join('');
        return '<datalist id="' + escapeAttr(listId) + '">' + options + '</datalist>';
    }

    function refreshConditionAutocomplete(condRow) {
        if (!condRow) return;
        var fieldSelect = condRow.querySelector('select[data-dc-field]');
        var valueInput = condRow.querySelector('[data-dc-cond-value]');
        var list = condRow.querySelector('datalist');
        if (!fieldSelect || !valueInput || !list) return;
        var fieldId = resolveFieldId(fieldSelect.value) || 'text';
        var def = conditionFieldById()[fieldId];
        list.innerHTML = '';
        if (!def || !def.autocomplete) {
            valueInput.removeAttribute('list');
            valueInput.placeholder = def && def.kind === 'partMarks'
                ? '分題分數（如 2）'
                : '字串（題目／答案／評卷報告）';
            return;
        }
        valueInput.setAttribute('list', list.id);
        valueInput.placeholder = '從已載入題庫選擇或輸入';
        collectFieldValues(fieldId).forEach(function (value) {
            var opt = document.createElement('option');
            opt.value = value;
            list.appendChild(opt);
        });
    }

    function conditionRowHtml(condition) {
        var normalized = normalizeCondition(condition) || { include: true, field: 'text', value: '' };
        var value = normalized.value != null ? normalized.value : '';
        var includeChecked = normalized.include ? ' checked' : '';
        var excludeChecked = normalized.include ? '' : ' checked';
        var fieldId = normalized.field || 'text';
        var byId = conditionFieldById();
        var def = byId[fieldId] || byId.text || { autocomplete: false };
        conditionRowSeq += 1;
        var listId = 'dc-ac-' + conditionRowSeq;
        var listAttr = def.autocomplete ? (' list="' + escapeAttr(listId) + '"') : '';
        var placeholder = def.autocomplete
            ? '從已載入題庫選擇或輸入'
            : (def.kind === 'partMarks' ? '分題分數（如 2）' : '字串（題目／答案／評卷報告）');
        return ''
            + '<div class="data-checks-cond-row" data-dc-cond-row="1">'
            + '  <div class="data-checks-cond-pair" role="group" aria-label="包含或不包括">'
            + '    <label class="data-checks-check"><input type="checkbox" data-dc-include value="include"' + includeChecked + '>包含</label>'
            + '    <label class="data-checks-check"><input type="checkbox" data-dc-include value="exclude"' + excludeChecked + '>不包括</label>'
            + '  </div>'
            + '  <label class="data-checks-field-select">'
            + '    <span class="data-checks-field-select-label">欄位</span>'
            + '    <select data-dc-field aria-label="條件欄位">' + fieldSelectHtml(fieldId) + '</select>'
            + '  </label>'
            + '  <div class="data-checks-cond-value-wrap">'
            + '    <input type="text" data-dc-cond-value value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(placeholder) + '"' + listAttr + ' aria-label="條件值" autocomplete="off">'
            + datalistHtml(listId, fieldId)
            + '  </div>'
            + '  <button type="button" class="btn btn-secondary btn-sm" data-dc-remove-cond title="移除條件">✕</button>'
            + '</div>';
    }

    function enforceExclusivePair(changedInput, attrName) {
        if (!changedInput || !changedInput.checked) {
            // Exactly one must stay checked: if user unchecks the only one, re-check it.
            var row = changedInput && changedInput.closest('[data-dc-cond-row]');
            if (!row) return;
            var boxes = row.querySelectorAll('input[' + attrName + ']');
            var anyChecked = false;
            boxes.forEach(function (box) { if (box.checked) anyChecked = true; });
            if (!anyChecked && changedInput) changedInput.checked = true;
            return;
        }
        var condRow = changedInput.closest('[data-dc-cond-row]');
        if (!condRow) return;
        condRow.querySelectorAll('input[' + attrName + ']').forEach(function (box) {
            if (box !== changedInput) box.checked = false;
        });
    }

    function readConditionChoices(condRow) {
        var includeBox = condRow.querySelector('input[data-dc-include]:checked');
        var fieldSelect = condRow.querySelector('select[data-dc-field]');
        var include = !(includeBox && includeBox.value === 'exclude');
        var field = resolveFieldId(fieldSelect && fieldSelect.value) || 'text';
        return { include: include, field: field };
    }

    function escapeAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function newCheckId() {
        return 'check-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    async function addBlankCheck() {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveChecks();
        var check = {
            id: newCheckId(),
            name: '新檢查',
            mode: 'perQuestion',
            conditions: [{ include: true, field: 'text', value: '', type: 'textContains' }],
            exceptions: []
        };
        activeChecks.push(check);
        unsavedDraftIds[check.id] = true;
        editingCheckId = check.id;
        // Local draft only — do not upload / re-render after remote save.
        // Immediate persist + post-upload renderFromCache was wiping typing.
        renderFromCache();
        var nameInput = overlay && overlay.querySelector(
            '[data-check-id="' + check.id + '"] [data-dc-name]'
        );
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }

    async function deleteCheck(checkId) {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveChecks();
        var next = activeChecks.filter(function (check) { return check.id !== checkId; });
        if (next.length === activeChecks.length) return;
        if (!window.confirm('刪除此檢查？')) return;
        var wasDraft = !!unsavedDraftIds[checkId];
        activeChecks = next;
        if (editingCheckId === checkId) editingCheckId = null;
        delete unsavedDraftIds[checkId];
        renderFromCache();
        if (wasDraft) {
            // Never uploaded — nothing to push; leave lastSyncedFingerprint as-is.
            return;
        }
        await persistActiveChecks();
        if (!editingCheckId) renderFromCache();
    }

    function readEditorForm(checkId) {
        var row = overlay && overlay.querySelector('[data-check-id="' + checkId + '"]');
        if (!row) return null;
        var nameInput = row.querySelector('[data-dc-name]');
        var modeSelect = row.querySelector('[data-dc-mode]');
        var exceptionInput = row.querySelector('[data-dc-exceptions]');
        var conditionRows = row.querySelectorAll('[data-dc-cond-row]');
        var conditions = [];
        conditionRows.forEach(function (condRow) {
            var valueEl = condRow.querySelector('[data-dc-cond-value]');
            var choices = readConditionChoices(condRow);
            var value = valueEl ? valueEl.value : '';
            var normalized = normalizeCondition({
                include: choices.include,
                field: choices.field,
                value: value
            });
            if (normalized) conditions.push(normalized);
        });
        var exceptions = String(exceptionInput && exceptionInput.value || '')
            .split(/[\n,，]+/)
            .map(function (item) { return item.trim(); })
            .filter(Boolean);
        return {
            id: checkId,
            name: String(nameInput && nameInput.value || '').trim() || '未命名檢查',
            mode: normalizeCheckMode(modeSelect && modeSelect.value),
            conditions: conditions,
            exceptions: exceptions
        };
    }

    async function saveEditedCheck(checkId) {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveChecks();
        var edited = readEditorForm(checkId);
        if (!edited) return;
        if (!edited.conditions.length) {
            window.alert('請至少保留一項條件。');
            return;
        }
        var found = false;
        activeChecks = activeChecks.map(function (check) {
            if (check.id !== checkId) return check;
            found = true;
            return edited;
        });
        if (!found) activeChecks.push(edited);
        delete unsavedDraftIds[checkId];
        editingCheckId = null;
        renderFromCache();
        await persistActiveChecks();
        // Upload can take seconds; do not clobber a newly opened editor.
        if (!editingCheckId) renderFromCache();
    }

    function addConditionRow(checkId) {
        var row = overlay && overlay.querySelector('[data-check-id="' + checkId + '"] .data-checks-cond-list');
        if (!row) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = conditionRowHtml({ type: 'textContains', value: '' });
        row.appendChild(wrap.firstChild);
    }

    function removeConditionRow(button) {
        var row = button.closest('[data-dc-cond-row]');
        var list = button.closest('.data-checks-cond-list');
        if (!row || !list) return;
        if (list.querySelectorAll('[data-dc-cond-row]').length <= 1) {
            window.alert('請至少保留一項條件。');
            return;
        }
        row.remove();
    }

    function showQuestionById(questionId) {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        var id = String(questionId == null ? '' : questionId).trim();
        if (!id || id === '(無編號)') return;

        // Reuse the existing question-list filter path (search scope = 題目 ID).
        if (typeof clearFilters === 'function') {
            clearFilters();
        }

        var searchEl = document.getElementById('search');
        var scopeEl = document.getElementById('search-scope');
        if (scopeEl) {
            if (!scopeEl.querySelector('option[value="id"]') && typeof populateSearchScope === 'function') {
                populateSearchScope();
            }
            if (scopeEl.querySelector('option[value="id"]')) {
                scopeEl.value = 'id';
                window.searchScope = 'id';
            } else {
                scopeEl.value = 'all';
                window.searchScope = 'all';
            }
        } else {
            window.searchScope = 'id';
        }
        if (searchEl) searchEl.value = id;

        if (window.paginationState && window.paginationState.questions) {
            window.paginationState.questions.page = 1;
        }

        closeDataChecksPanel();
        if (typeof switchTab === 'function') switchTab('questions');
        if (typeof filterQuestions === 'function') {
            filterQuestions();
        } else if (typeof renderQuestions === 'function') {
            renderQuestions();
        }
        if (typeof scrollToTop === 'function') scrollToTop();
    }

    function showAllPendingForCheck(checkId) {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        var id = String(checkId == null ? '' : checkId).trim();
        if (!id) return;
        loadActiveChecks();
        var check = null;
        (activeChecks || []).forEach(function (item) {
            if (item && item.id === id) check = item;
        });
        if (!check) return;
        var questions = Array.isArray(cachedQuestions) ? cachedQuestions : [];
        var result = evaluateCheck(questions, check);
        var ids = (result.needsHandling || []).filter(function (qid) {
            return qid && qid !== '(無編號)';
        });
        if (!ids.length) {
            window.alert('這項檢查目前沒有待處理題目。');
            return;
        }
        // Clear search-box filters that would fight the ID-set layer, but keep
        // tri-state alone is fine — ID set intersects. Prefer a clean landing.
        if (typeof clearFilters === 'function') {
            clearFilters();
        }
        closeDataChecksPanel();
        if (typeof applyQuestionIdSetFilter === 'function') {
            applyQuestionIdSetFilter(ids, {
                label: check.name + ' · 待處理 ' + ids.length + ' 題',
                source: 'data-checks-pending'
            });
        } else {
            // Fallback: should not happen once question-list-filter.js is loaded.
            window.alert('題目集合篩選尚未載入。');
        }
    }

    function renderEditor(check) {
        var conditionsHtml = (check.conditions.length ? check.conditions : [{ type: 'textContains', value: '' }]).map(function (condition) {
            return conditionRowHtml(condition);
        }).join('');
        var mode = normalizeCheckMode(check.mode);
        var perSelected = mode === 'perQuestion' ? ' selected' : '';
        var crossSelected = mode === 'crossPaperSameYear' ? ' selected' : '';

        return ''
            + '<div class="data-checks-editor">'
            + '  <label class="data-checks-field">'
            + '    <span>標題</span>'
            + '    <input type="text" data-dc-name value="' + escapeAttr(check.name) + '" maxlength="120">'
            + '  </label>'
            + '  <label class="data-checks-field">'
            + '    <span>檢查模式</span>'
            + '    <select data-dc-mode aria-label="檢查模式">'
            + '      <option value="perQuestion"' + perSelected + '>普通檢查</option>'
            + '      <option value="crossPaperSameYear"' + crossSelected + '>同年跨卷重疊</option>'
            + '    </select>'
            + '  </label>'
            + '  <div class="data-checks-field">'
            + '    <div class="data-checks-field-head">'
            + '      <span>條件（全部 AND；每列選 包含/不包括、欄位、值）</span>'
            + '      <button type="button" class="btn btn-outline-primary btn-sm" data-dc-add-cond="' + escapeAttr(check.id) + '">＋ 條件</button>'
            + '    </div>'
            + '    <div class="data-checks-cond-list">' + conditionsHtml + '</div>'
            + '  </div>'
            + '  <label class="data-checks-field">'
            + '    <span>例外題號（每行一個，格式如 DSE-2026-P1-01）</span>'
            + '    <textarea data-dc-exceptions rows="4" placeholder="DSE-2026-P1-01">' + escapeHtml((check.exceptions || []).join('\n')) + '</textarea>'
            + '  </label>'
            + '  <div class="data-checks-edit-actions">'
            + '    <button type="button" class="btn btn-primary btn-sm" data-dc-save="' + escapeAttr(check.id) + '">儲存</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" data-dc-cancel="' + escapeAttr(check.id) + '">取消</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" data-dc-delete="' + escapeAttr(check.id) + '">刪除檢查</button>'
            + '  </div>'
            + '</div>';
    }

    function renderResults(results, totalQuestions) {
        var body = document.getElementById('data-checks-body');
        var note = document.getElementById('data-checks-footer-note');
        if (!body) return;
        body.textContent = '';
        if (!results.length) {
            var empty = document.createElement('p');
            empty.className = 'data-checks-empty';
            empty.textContent = mutationsLocked
                ? '尚未設定任何檢查（同步中…）。'
                : '尚未設定任何檢查。按上方「新增檢查」。';
            body.appendChild(empty);
        } else {
            results.forEach(function (result) {
                var check = result.check;
                var row = document.createElement('section');
                row.className = 'data-checks-row';
                row.setAttribute('data-check-id', check.id);

                var head = document.createElement('div');
                head.className = 'data-checks-row-head';
                var title = document.createElement('h3');
                title.className = 'data-checks-row-title';
                title.textContent = check.name;
                head.appendChild(title);

                var counts = document.createElement('div');
                counts.className = 'data-checks-counts';
                counts.innerHTML = ''
                    + '<span class="data-checks-count is-needs">待處理 <strong>' + result.needsCount + '</strong></span>'
                    + '<span class="data-checks-count is-exceptions">例外 <strong>' + result.exceptionCount + '</strong></span>';
                head.appendChild(counts);
                row.appendChild(head);

                if (editingCheckId === check.id) {
                    var editorWrap = document.createElement('div');
                    editorWrap.innerHTML = renderEditor(check);
                    row.appendChild(editorWrap.firstChild);
                } else {
                    var summary = document.createElement('p');
                    summary.className = 'data-checks-row-summary';
                    var modeText = checkModeLabel(check.mode);
                    var condText = conditionSummary(check) || '（尚未設定條件）';
                    summary.textContent = modeText + ' · ' + condText;
                    row.appendChild(summary);

                    if (normalizeCheckMode(check.mode) === 'crossPaperSameYear') {
                        var hitNote = document.createElement('p');
                        hitNote.className = 'data-checks-hit-groups';
                        var groups = result.hitGroups || [];
                        if (groups.length) {
                            hitNote.textContent = '重疊年份：' + groups.map(formatHitGroupLabel).join('；');
                        } else {
                            hitNote.textContent = '重疊年份：目前沒有同年跨卷命中';
                        }
                        row.appendChild(hitNote);
                    }

                    var actions = document.createElement('div');
                    actions.className = 'data-checks-row-actions';
                    if (mutationsLocked) {
                        actions.innerHTML = '<span class="data-checks-syncing">同步中，暫不可編輯</span>';
                    } else {
                        actions.innerHTML = ''
                            + '<button type="button" class="btn btn-outline-primary btn-sm" data-dc-filter-all="' + escapeAttr(check.id) + '"'
                            + (result.needsCount ? '' : ' disabled')
                            + ' title="一次篩選本檢查全部待處理題目">篩選全部待處理'
                            + (result.needsCount ? ('（' + result.needsCount + '）') : '')
                            + '</button>'
                            + '<button type="button" class="btn btn-outline-primary btn-sm" data-dc-edit="' + escapeAttr(check.id) + '">編輯</button>'
                            + '<button type="button" class="btn btn-secondary btn-sm" data-dc-delete="' + escapeAttr(check.id) + '">刪除</button>';
                    }
                    row.appendChild(actions);

                    var details = document.createElement('details');
                    details.className = 'data-checks-ids';
                    if (openDetails[check.id]) details.open = true;
                    details.addEventListener('toggle', function () {
                        openDetails[check.id] = details.open;
                    });
                    var summaryEl = document.createElement('summary');
                    summaryEl.textContent = result.needsCount
                        ? ('查看待處理題目編號（' + result.needsCount + '）— 點編號可篩選該題')
                        : '沒有待處理題目';
                    details.appendChild(summaryEl);
                    if (result.needsCount) {
                        var list = document.createElement('ul');
                        list.className = 'data-checks-id-list';
                        result.needsHandling.forEach(function (id) {
                            var item = document.createElement('li');
                            if (id === '(無編號)') {
                                item.textContent = id;
                            } else {
                                var btn = document.createElement('button');
                                btn.type = 'button';
                                btn.className = 'data-checks-qid';
                                btn.setAttribute('data-dc-qid', id);
                                btn.title = '用題目 ID 篩選顯示此題';
                                btn.textContent = id;
                                item.appendChild(btn);
                            }
                            list.appendChild(item);
                        });
                        details.appendChild(list);
                    } else {
                        var none = document.createElement('p');
                        none.className = 'data-checks-empty';
                        none.textContent = '目前沒有需要處理的題目。';
                        details.appendChild(none);
                    }
                    row.appendChild(details);
                }

                body.appendChild(row);
            });
        }
        if (note) {
            var sourceLabel = checksSource === REMOTE_SOURCE
                ? '共用資料庫'
                : (checksSource === CACHE_SOURCE ? '本機快取' : '預設檢查');
            var base = '已載入 ' + totalQuestions + ' 題 · 共 ' + results.length + ' 項檢查 · ' + sourceLabel;
            note.setAttribute('data-dc-base', base);
            note.textContent = checksStatusText ? (base + ' · ' + checksStatusText) : base;
        }
    }


    function newWatchId() {
        return 'watch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    function addWatchConditionRow(watchId) {
        var row = overlay && overlay.querySelector('[data-watch-id="' + watchId + '"] .data-checks-cond-list');
        if (!row) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = conditionRowHtml({ type: 'textContains', value: '' });
        row.appendChild(wrap.firstChild);
    }

    function readWatchEditorForm(watchId) {
        var row = overlay && overlay.querySelector('[data-watch-id="' + watchId + '"]');
        if (!row) return null;
        var nameInput = row.querySelector('[data-dc-watch-name]');
        var conditionRows = row.querySelectorAll('[data-dc-cond-row]');
        var conditions = [];
        conditionRows.forEach(function (condRow) {
            var valueEl = condRow.querySelector('[data-dc-cond-value]');
            var choices = readConditionChoices(condRow);
            var normalized = normalizeCondition({
                include: choices.include,
                field: choices.field,
                value: valueEl ? valueEl.value : ''
            });
            if (normalized) conditions.push(normalized);
        });
        return {
            id: watchId,
            name: String(nameInput && nameInput.value || '').trim() || '未命名關注',
            conditions: conditions
        };
    }

    async function addBlankWatch() {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveWatches();
        var watch = {
            id: newWatchId(),
            name: '新關注',
            conditions: [{ include: true, field: 'text', value: '', type: 'textContains' }]
        };
        activeWatches.push(watch);
        unsavedWatchDraftIds[watch.id] = true;
        editingWatchId = watch.id;
        renderFromCache();
        var nameInput = overlay && overlay.querySelector(
            '[data-watch-id="' + watch.id + '"] [data-dc-watch-name]'
        );
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }

    function deleteWatch(watchId) {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveWatches();
        var next = activeWatches.filter(function (watch) { return watch.id !== watchId; });
        if (next.length === activeWatches.length) return;
        if (!window.confirm('刪除此關注組合？')) return;
        var wasDraft = !!unsavedWatchDraftIds[watchId];
        activeWatches = next;
        if (editingWatchId === watchId) editingWatchId = null;
        delete unsavedWatchDraftIds[watchId];
        if (!wasDraft) persistWatchesLocal();
        renderFromCache();
    }

    function saveEditedWatch(watchId) {
        if (!canSeeDataChecks() || mutationsLocked) return;
        loadActiveWatches();
        var edited = readWatchEditorForm(watchId);
        if (!edited) return;
        if (!edited.conditions.length) {
            window.alert('請至少保留一項條件。');
            return;
        }
        var found = false;
        activeWatches = activeWatches.map(function (watch) {
            if (watch.id !== watchId) return watch;
            found = true;
            return edited;
        });
        if (!found) activeWatches.push(edited);
        delete unsavedWatchDraftIds[watchId];
        editingWatchId = null;
        persistWatchesLocal();
        renderFromCache();
    }

    function applyWatchCombo(watchId) {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        loadActiveWatches();
        var watch = null;
        (activeWatches || []).forEach(function (item) {
            if (item && item.id === watchId) watch = item;
        });
        if (!watch || !watch.conditions || !watch.conditions.length) {
            window.alert('此關注組合尚未設定條件。');
            return;
        }
        closeDataChecksPanel();
        if (typeof applyAdvancedConditionFilter === 'function') {
            applyAdvancedConditionFilter(watch.conditions, {
                clearIdSet: false,
                label: '關注：' + watch.name
            });
        } else {
            window.alert('進階篩選尚未載入。');
        }
    }

    function renderWatchEditor(watch) {
        var conditionsHtml = (watch.conditions.length ? watch.conditions : [{ type: 'textContains', value: '' }]).map(function (condition) {
            return conditionRowHtml(condition);
        }).join('');
        return ''
            + '<div class="data-checks-editor">'
            + '  <label class="data-checks-field">'
            + '    <span>標題</span>'
            + '    <input type="text" data-dc-watch-name value="' + escapeAttr(watch.name) + '" maxlength="120">'
            + '  </label>'
            + '  <div class="data-checks-field">'
            + '    <div class="data-checks-field-head">'
            + '      <span>條件（全部 AND；關注組合，不是錯誤檢查）</span>'
            + '      <button type="button" class="btn btn-outline-primary btn-sm" data-dc-watch-add-cond="' + escapeAttr(watch.id) + '">＋ 條件</button>'
            + '    </div>'
            + '    <div class="data-checks-cond-list">' + conditionsHtml + '</div>'
            + '  </div>'
            + '  <div class="data-checks-edit-actions">'
            + '    <button type="button" class="btn btn-primary btn-sm" data-dc-watch-save="' + escapeAttr(watch.id) + '">儲存</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" data-dc-watch-cancel="' + escapeAttr(watch.id) + '">取消</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" data-dc-watch-delete="' + escapeAttr(watch.id) + '">刪除關注</button>'
            + '  </div>'
            + '</div>';
    }

    function renderWatches(questions) {
        var body = document.getElementById('data-checks-body');
        var note = document.getElementById('data-checks-footer-note');
        if (!body) return;
        body.textContent = '';
        loadActiveWatches();
        var watches = activeWatches || [];
        if (!watches.length) {
            var empty = document.createElement('p');
            empty.className = 'data-checks-empty';
            empty.textContent = '尚未設定關注組合。按上方「新增關注」儲存想留意的篩選條件。';
            body.appendChild(empty);
        } else {
            watches.forEach(function (watch) {
                var matchCount = countWatchMatches(questions, watch);
                var row = document.createElement('section');
                row.className = 'data-checks-row';
                row.setAttribute('data-watch-id', watch.id);

                var head = document.createElement('div');
                head.className = 'data-checks-row-head';
                var title = document.createElement('h3');
                title.className = 'data-checks-row-title';
                title.textContent = watch.name;
                head.appendChild(title);

                var counts = document.createElement('div');
                counts.className = 'data-checks-counts';
                counts.innerHTML = ''
                    + '<button type="button" class="data-checks-count is-watch" data-dc-watch-apply="' + escapeAttr(watch.id) + '"'
                    + ' title="套用此關注組合到題目列表">符合 <strong>' + matchCount + '</strong></button>';
                head.appendChild(counts);
                row.appendChild(head);

                if (editingWatchId === watch.id) {
                    var editorWrap = document.createElement('div');
                    editorWrap.innerHTML = renderWatchEditor(watch);
                    row.appendChild(editorWrap.firstChild);
                } else {
                    var summary = document.createElement('p');
                    summary.className = 'data-checks-row-summary';
                    summary.textContent = conditionSummary(watch) || '（尚未設定條件）';
                    row.appendChild(summary);

                    var actions = document.createElement('div');
                    actions.className = 'data-checks-row-actions';
                    actions.innerHTML = ''
                        + '<button type="button" class="btn btn-outline-primary btn-sm" data-dc-watch-apply="' + escapeAttr(watch.id) + '"'
                        + (matchCount ? '' : ' disabled')
                        + '>套用篩選'
                        + (matchCount ? ('（' + matchCount + '）') : '')
                        + '</button>'
                        + '<button type="button" class="btn btn-outline-primary btn-sm" data-dc-watch-edit="' + escapeAttr(watch.id) + '">編輯</button>'
                        + '<button type="button" class="btn btn-secondary btn-sm" data-dc-watch-delete="' + escapeAttr(watch.id) + '">刪除</button>';
                    row.appendChild(actions);
                }
                body.appendChild(row);
            });
        }
        if (note) {
            var base = '已載入 ' + (questions || []).length + ' 題 · 共 ' + watches.length + ' 項關注 · 本機儲存';
            note.setAttribute('data-dc-base', base);
            note.textContent = checksStatusText ? (base + ' · ' + checksStatusText) : base;
        }
    }

    function renderFromCache() {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        var questions = Array.isArray(cachedQuestions) ? cachedQuestions : [];
        if (activePanelTab === 'watches') {
            renderWatches(questions);
            return;
        }
        loadActiveChecks();
        var results = activeChecks.map(function (check) {
            return evaluateCheck(questions, check);
        });
        renderResults(results, questions.length);
    }


    async function loadQuestionsForChecks() {
        var questions = [];
        try {
            if (window.storage && typeof window.storage.getQuestions === 'function') {
                questions = await window.storage.getQuestions();
            }
        } catch (error) {
            questions = [];
        }
        if (!Array.isArray(questions)) questions = [];
        // Same permission filter the list view uses (mock papers hidden without mockTests).
        if (window.storage && typeof window.storage.applyPermissionFilter === 'function') {
            questions = window.storage.applyPermissionFilter(questions);
        }
        cachedQuestions = questions;
        return questions;
    }

    async function openDataChecksPanel() {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        ensureOverlay();
        overlay.hidden = false;
        document.body.classList.add('data-checks-open');
        editingCheckId = null;
        unsavedDraftIds = {};
        editingWatchId = null;
        unsavedWatchDraftIds = {};
        activeWatches = null;
        activePanelTab = 'checks';
        checksStatusText = '';
        loadChecksFromLocalCache();
        markChecksSynced(activeChecks);
        updatePanelChrome();

        var autoDownload = shouldAutoDownloadOnOpen();
        if (autoDownload) {
            startRemoteDownload({ manual: false });
        } else {
            setMutationsLocked(false);
            setChecksStatus(checksSource === CACHE_SOURCE ? '使用本機快取' : '使用預設檢查');
        }

        if (!Array.isArray(cachedQuestions)) {
            await loadQuestionsForChecks();
            if (!overlay || overlay.hidden) return;
        }
        renderFromCache();
        applyToolbarLock();
        var closeBtn = overlay.querySelector('.data-checks-close');
        if (closeBtn) closeBtn.focus();
    }

    function injectStyles() {
        if (document.getElementById('data-checks-styles')) return;
        var style = document.createElement('style');
        style.id = 'data-checks-styles';
        style.textContent = ''
            + 'body.data-checks-open { overflow: hidden; }'
            + '.data-checks-overlay {'
            + '  position: fixed; inset: 0; z-index: 12500; display: flex;'
            + '  align-items: center; justify-content: center; padding: 16px;'
            + '  background: rgba(15, 23, 42, 0.62); backdrop-filter: blur(4px);'
            + '}'
            + '.data-checks-overlay[hidden] { display: none !important; }'
            + '.data-checks-dialog {'
            + '  display: flex; flex-direction: column; width: min(860px, 100%);'
            + '  height: min(900px, calc(100vh - 24px)); background: #fff;'
            + '  color: var(--text-color); border-radius: 16px;'
            + '  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28); overflow: hidden;'
            + '}'
            + '.data-checks-header {'
            + '  display: flex; align-items: flex-start; justify-content: space-between;'
            + '  gap: 16px; padding: 20px 22px 14px; border-bottom: 1px solid var(--border-light);'
            + '  background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);'
            + '}'
            + '.data-checks-header h2 { margin: 0 0 6px; font-size: 22px; color: var(--primary-color); }'
            + '.data-checks-subtitle { margin: 0; color: var(--text-light); font-size: 14px; line-height: 1.55; }'
            + '.data-checks-close {'
            + '  flex: 0 0 auto; width: 36px; height: 36px; border: 1px solid var(--border-light);'
            + '  border-radius: 999px; background: #fff; color: var(--text-color); font-size: 22px; line-height: 1;'
            + '}'
            + '.data-checks-tabs {'
            + '  display: flex; gap: 0; padding: 0 18px;'
            + '  border-bottom: 1px solid var(--border-light); background: #fff;'
            + '}'
            + '.data-checks-tab {'
            + '  appearance: none; border: 0; border-bottom: 2px solid transparent;'
            + '  background: transparent; padding: 10px 14px; font: inherit; font-size: 14px;'
            + '  cursor: pointer; color: #556677;'
            + '}'
            + '.data-checks-tab.is-active {'
            + '  border-bottom-color: var(--primary-color); color: var(--primary-color); font-weight: 700;'
            + '}'
            + '.data-checks-toolbar {'
            + '  display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 18px;'
            + '  border-bottom: 1px solid var(--border-light); background: #fff;'
            + '}'
            + '.data-checks-count.is-watch {'
            + '  background: #eef6ff; border-color: #bfd6f0; color: var(--secondary-color);'
            + '  cursor: pointer; font: inherit;'
            + '}'
            + '.data-checks-count.is-watch:hover { background: #e0effc; }'
            + '.data-checks-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 24px; background: #f4f7fb; }'
            + '.data-checks-row {'
            + '  margin-bottom: 12px; padding: 14px 16px; border: 1px solid #d7e3ef;'
            + '  border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);'
            + '}'
            + '.data-checks-row-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }'
            + '.data-checks-row-title { margin: 0; color: var(--primary-color); font-size: 16px; line-height: 1.4; }'
            + '.data-checks-counts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }'
            + '.data-checks-count {'
            + '  display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px;'
            + '  border-radius: 999px; border: 1px solid #e1ebf4; background: #f3f7fb;'
            + '  color: var(--primary-color); font-size: 12px; font-weight: 600;'
            + '}'
            + '.data-checks-count.is-needs { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }'
            + '.data-checks-count.is-exceptions { background: #f8fafc; color: var(--text-light); }'
            + '.data-checks-count strong { font-size: 15px; font-weight: 800; }'
            + '.data-checks-row-summary { margin: 8px 0 0; color: var(--text-light); font-size: 13px; line-height: 1.55; }'
            + '.data-checks-row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }'
            + '.data-checks-syncing { color: var(--text-light); font-size: 13px; }'
            + '.data-checks-ids { margin-top: 10px; border-top: 1px solid #eef3f8; padding-top: 8px; }'
            + '.data-checks-ids summary { cursor: pointer; color: var(--secondary-color); font-size: 13px; font-weight: 700; }'
            + '.data-checks-id-list {'
            + '  margin: 10px 0 0; padding: 0; list-style: none; display: grid;'
            + '  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px 10px;'
            + '}'
            + '.data-checks-id-list li { margin: 0; }'
            + '.data-checks-qid {'
            + '  display: block; width: 100%; margin: 0; padding: 6px 8px; border-radius: 8px;'
            + '  background: #f8fafc; border: 1px solid #e7eef5; color: var(--secondary-color);'
            + '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;'
            + '  font-size: 12px; line-height: 1.4; word-break: break-all; text-align: left; cursor: pointer;'
            + '}'
            + '.data-checks-qid:hover { background: #eef6ff; border-color: #bfd6f0; }'
            + '.data-checks-editor { margin-top: 12px; display: grid; gap: 12px; }'
            + '.data-checks-field { display: grid; gap: 6px; font-size: 13px; color: var(--text-color); }'
            + '.data-checks-field > span, .data-checks-field-head span { font-weight: 700; color: var(--primary-color); }'
            + '.data-checks-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }'
            + '.data-checks-field input[type="text"], .data-checks-field textarea, .data-checks-field select, .data-checks-cond-row input[type="text"] {'
            + '  width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d7e3ef;'
            + '  border-radius: 8px; font: inherit; color: inherit; background: #fff;'
            + '}'
            + '.data-checks-hit-groups { margin: 6px 0 0; color: #9a3412; font-size: 13px; line-height: 1.55; font-weight: 600; }'
            + '.data-checks-field textarea { resize: vertical; min-height: 88px;'
            + '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }'
            + '.data-checks-cond-list { display: grid; gap: 10px; }'
            + '.data-checks-cond-row {'
            + '  display: flex; flex-wrap: nowrap; align-items: center; gap: 8px;'
            + '  padding: 8px; border: 1px solid #e7eef5; border-radius: 10px; background: #f8fafc;'
            + '}'
            + '.data-checks-cond-pair {'
            + '  display: inline-flex; flex: 0 0 auto; flex-wrap: nowrap; gap: 8px 10px; align-items: center;'
            + '}'
            + '.data-checks-field-select {'
            + '  display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; margin: 0;'
            + '  font-size: 12px; color: var(--text-light); white-space: nowrap;'
            + '}'
            + '.data-checks-field-select-label { font-weight: 700; color: var(--primary-color); }'
            + '.data-checks-field-select select {'
            + '  width: auto; max-width: max-content; min-width: 5.5em; box-sizing: border-box;'
            + '  padding: 7px 8px; border: 1px solid #d7e3ef; border-radius: 8px;'
            + '  font: inherit; color: inherit; background: #fff;'
            + '  field-sizing: content;'
            + '}'
            + '.data-checks-cond-value-wrap { flex: 1 1 auto; min-width: 0; }'
            + '.data-checks-cond-value-wrap input { width: 100%; }'
            + '.data-checks-cond-row > .btn { flex: 0 0 auto; }'
            + '.data-checks-check {'
            + '  display: inline-flex; align-items: center; gap: 4px; margin: 0;'
            + '  font-size: 13px; font-weight: 600; color: var(--primary-color); cursor: pointer;'
            + '  white-space: nowrap;'
            + '}'
            + '.data-checks-check input { width: auto; margin: 0; accent-color: var(--secondary-color); }'
            + '.data-checks-edit-actions { display: flex; flex-wrap: wrap; gap: 8px; }'
            + '.data-checks-empty { margin: 8px 0 0; color: var(--text-light); font-size: 13px; line-height: 1.55; }'
            + '.data-checks-footer {'
            + '  display: flex; align-items: center; justify-content: space-between; gap: 12px;'
            + '  padding: 12px 16px; border-top: 1px solid var(--border-light); background: #fff;'
            + '}'
            + '.data-checks-footer-note { margin: 0; color: var(--text-light); font-size: 13px; }'
            + '@media (max-width: 700px) {'
            + '  .data-checks-row-head { flex-direction: column; }'
            + '  .data-checks-counts { justify-content: flex-start; }'
            + '  .data-checks-cond-row { flex-wrap: wrap; }'
            + '  .data-checks-cond-value-wrap { flex: 1 1 100%; }'
            + '  .data-checks-footer { flex-direction: column; align-items: stretch; }'
            + '}';
        document.head.appendChild(style);
    }

    function hookAccessRights() {
        if (typeof window.applyAccessRights !== 'function') return;
        if (window.applyAccessRights.__dataChecksWrapped) return;
        var previous = window.applyAccessRights;
        function wrapped(rights) {
            var result = previous(rights);
            refreshDataChecksVisibility();
            return result;
        }
        wrapped.__dataChecksWrapped = true;
        window.applyAccessRights = wrapped;
    }

    function initDataChecksFeature() {
        injectStyles();
        hookAccessRights();
        ensureButton();
        refreshDataChecksVisibility();
    }

    window.initDataChecksFeature = initDataChecksFeature;
    window.refreshDataChecksVisibility = refreshDataChecksVisibility;
    window.openDataChecksPanel = openDataChecksPanel;
    window.closeDataChecksPanel = closeDataChecksPanel;
    window.__DATA_CHECKS_DEFAULTS__ = DEFAULT_DATA_CHECKS;
    window.__DATA_CHECKS_FIELDS__ = conditionFields();
    window.__evaluateDataCheck__ = evaluateCheck;
    window.__dataChecksShowQuestionById__ = showQuestionById;
    window.__dataChecksLoadActive__ = loadActiveChecks;
    window.__normalizeDataCheckCondition__ = normalizeCondition;
    window.__dataChecksConditionRowHtml__ = conditionRowHtml;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDataChecksFeature);
    } else {
        initDataChecksFeature();
    }
})();
