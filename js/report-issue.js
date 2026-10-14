// 回報問題 — UI for any authenticated session; Apps Script reportIssue requires
// a known hash (rights.known). Persist: shared/data/issue-reports.json
// (reportIssue / listIssueReports / update*Status). Admin hub「審批與回報」
// combines AI解釋 Feedback、問題回報、分題審批、分類審批 (multi-field staging).
// Dependencies: access-rights, github-sync (gitProxyRequest / gitUsername),
// optional PoeGenerate.proxyRequest, AiExplanation admin hooks, question-fields.

(function (global) {
    'use strict';

    var TAG_DEFS = [
        { id: 'typo', label: '有錯字' },
        { id: 'image', label: '圖片未能正確顯示' },
        { id: 'classification', label: '分類不正確' },
        { id: 'other', label: '其他' }
    ];

    var STATUS_OPEN = 'open';
    var STATUS_RESOLVED = 'resolved';
    var STATUS_LABELS = {
        open: '待處理',
        resolved: '已關閉'
    };

    var reportOverlay = null;
    var hubOverlay = null;
    var escapeBound = false;
    var reportState = {
        questionId: '',
        tags: {},
        busy: false
    };
    var CLASS_FIELD_META = {
        concepts: { kind: 'list', label: '概念', blankOnly: false },
        stemPatterns: { kind: 'list', label: '題幹模式', blankOnly: false },
        patterns: { kind: 'list', label: '題型', blankOnly: false },
        graphType: { kind: 'scalar', label: '圖表類型', blankOnly: false },
        tableType: { kind: 'scalar', label: '表格類型', blankOnly: false },
        calculationType: { kind: 'scalar', label: '計算類型', blankOnly: false },
        multipleSelectionType: { kind: 'scalar', label: '複選類型', blankOnly: false },
        AristochapterClassification: { kind: 'list', label: 'Chapters', blankOnly: true },
        curriculumClassification: { kind: 'list', label: '課程分類', blankOnly: true },
        questionParts: { kind: 'parts', label: '分題', blankOnly: true }
    };

    function classFieldMeta(field) {
        return CLASS_FIELD_META[String(field || '')] || null;
    }

    function classFieldLabel(field) {
        var meta = classFieldMeta(field);
        return meta && meta.label ? meta.label : String(field || '');
    }

    function classFieldKind(field) {
        var meta = classFieldMeta(field);
        return meta ? meta.kind : 'list';
    }

    function isAllowedClassField(field) {
        return !!classFieldMeta(field);
    }

    var hubState = {
        tab: 'issues', // issues | ai | parts | classification
        issues: [],
        aiRows: [],
        partsRows: [],
        classRows: [],
        classPendingCount: 0,
        classPaused: false,
        classPauseThreshold: 200,
        partsStemById: {},
        classStemById: {},
        statusFilter: 'open', // open | resolved | all (issues/ai only)
        selected: {},
        busy: false,
        // Per-proposal in-flight keys (e.g. "class:ID", "parts:ID") so the same
        // approve cannot double-submit, while a *different* proposal can be
        // clicked as soon as the current network write finishes — without
        // waiting for IndexedDB getAll + filter/list re-render.
        inFlight: Object.create(null),
        _writeChain: Promise.resolve(),
        // Local-first staging approve/reject ops; flushed to cloud when hub closes.
        pendingOps: [],
        flushing: false,
        loading: false,
        error: '',
        // Lightweight staging lists for 題目 tab ✓/✕ (shared with hub when loaded).
        stagingCacheReady: false,
        stagingCacheLoading: false,
        stagingCacheError: ''
    };

    function stagingActionKey(kind, proposalId) {
        return String(kind || '') + ':' + String(proposalId || '');
    }

    function isStagingInFlight(kind, proposalId) {
        return !!hubState.inFlight[stagingActionKey(kind, proposalId)];
    }

    function anyStagingInFlight() {
        return Object.keys(hubState.inFlight).length > 0;
    }

    function tryBeginStagingAction(kind, proposalId) {
        if (hubState.busy) return false;
        var key = stagingActionKey(kind, proposalId);
        if (!proposalId || hubState.inFlight[key]) return false;
        hubState.inFlight[key] = true;
        return true;
    }

    function endStagingAction(kind, proposalId) {
        delete hubState.inFlight[stagingActionKey(kind, proposalId)];
    }

    // Serialize GitHub staging writes so overlapping clicks on different
    // proposals cannot 409 the same proposals/bank files.
    function enqueueStagingWrite(fn) {
        var run = hubState._writeChain.then(function () {
            return fn();
        });
        hubState._writeChain = run.then(function () {}, function () {});
        return run;
    }

    function scheduleLocalBankApply(promise) {
        if (!promise || typeof promise.then !== 'function') return;
        promise.catch(function () {});
    }

    function cloneJson(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (ignore) {
            return value;
        }
    }

    async function revertLocalBankFromUndo(undoSnap, kind) {
        if (!undoSnap || !undoSnap.questionId) return;
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') return;
        if (typeof global.storage.updateQuestion !== 'function') return;
        try {
            var all = await global.storage.getAllQuestions();
            var qid = String(undoSnap.questionId);
            var live = null;
            for (var i = 0; i < (all || []).length; i++) {
                if (all[i] && String(all[i].id) === qid) {
                    live = all[i];
                    break;
                }
            }
            if (!live) return;
            if (kind === 'parts') {
                if (typeof global.applyPartsFields !== 'function') return;
                var parts = Array.isArray(undoSnap.questionParts) ? undoSnap.questionParts : [];
                var status = undoSnap.partsStatus
                    || (parts.length ? 'filled' : 'none');
                global.applyPartsFields(live, parts, status);
            } else if (kind === 'class') {
                var values = undoSnap.values || {};
                var fields = Array.isArray(undoSnap.fields) ? undoSnap.fields : Object.keys(values);
                fields.forEach(function (field) {
                    if (!isAllowedClassField(field)) return;
                    var kindField = classFieldKind(field);
                    if (kindField === 'parts') {
                        if (typeof global.applyPartsFields === 'function') {
                            var p = Array.isArray(values[field]) ? values[field] : [];
                            global.applyPartsFields(live, p, p.length ? 'filled' : 'none');
                        } else {
                            live.questionParts = Array.isArray(values[field]) ? values[field].slice() : [];
                            live.partsStatus = live.questionParts.length ? 'filled' : 'none';
                        }
                        return;
                    }
                    if (kindField === 'scalar') {
                        live[field] = values[field] == null ? '' : String(values[field]);
                        return;
                    }
                    live[field] = Array.isArray(values[field]) ? values[field].slice() : [];
                });
            } else {
                return;
            }
            await global.storage.updateQuestion(live);
            if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
            if (typeof renderQuestions === 'function') renderQuestions();
        } catch (ignore) {}
    }

    var PENDING_DB_NAME = 'EconFeedbackHubPending';
    var PENDING_DB_VERSION = 1;
    var PENDING_STORE = 'ops';
    var beforeUnloadBound = false;
    var pendingPersistChain = Promise.resolve();
    // Outside-hub staging actions honour github-sync readAutoSync(); hub stays local-first.
    var lastFlushError = '';

    function pendingCount() {
        return (hubState.pendingOps || []).length;
    }

    function hasUnsyncedPending() {
        return pendingCount() > 0;
    }

    function makeLocalOpId() {
        return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    function openPendingDb() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('no_indexeddb'));
                return;
            }
            var req = global.indexedDB.open(PENDING_DB_NAME, PENDING_DB_VERSION);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(PENDING_STORE)) {
                    db.createObjectStore(PENDING_STORE, { keyPath: 'localId' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('idb_open_failed')); };
        });
    }

    function persistPendingOps() {
        var snapshot = (hubState.pendingOps || []).map(function (op) {
            try {
                return JSON.parse(JSON.stringify(op));
            } catch (ignore) {
                return op;
            }
        });
        pendingPersistChain = pendingPersistChain.then(function () {
            return openPendingDb().then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction(PENDING_STORE, 'readwrite');
                    var store = tx.objectStore(PENDING_STORE);
                    store.clear();
                    snapshot.forEach(function (op) { store.put(op); });
                    tx.oncomplete = function () {
                        try { db.close(); } catch (ignore) {}
                        try {
                            global.localStorage.removeItem('econ.feedbackHub.pendingOps');
                        } catch (ignore2) {}
                        resolve();
                    };
                    tx.onerror = function () {
                        try { db.close(); } catch (ignore) {}
                        reject(tx.error || new Error('idb_write_failed'));
                    };
                });
            }).catch(function () {
                try {
                    global.localStorage.setItem(
                        'econ.feedbackHub.pendingOps',
                        JSON.stringify(snapshot)
                    );
                } catch (ignore) {}
            });
        }, function () {});
        syncBeforeUnloadGuard();
        return pendingPersistChain;
    }

    async function loadPendingOpsFromDisk() {
        var loaded = null;
        try {
            var db = await openPendingDb();
            loaded = await new Promise(function (resolve, reject) {
                var tx = db.transaction(PENDING_STORE, 'readonly');
                var req = tx.objectStore(PENDING_STORE).getAll();
                req.onsuccess = function () {
                    try { db.close(); } catch (ignore) {}
                    resolve(req.result || []);
                };
                req.onerror = function () {
                    try { db.close(); } catch (ignore) {}
                    reject(req.error);
                };
            });
        } catch (ignore) {
            try {
                var raw = global.localStorage.getItem('econ.feedbackHub.pendingOps');
                if (raw) loaded = JSON.parse(raw);
            } catch (ignore2) {}
        }
        if (!Array.isArray(loaded)) loaded = [];
        hubState.pendingOps = loaded.filter(function (op) {
            return op && op.localId && op.kind && op.op;
        });
        syncBeforeUnloadGuard();
        return hubState.pendingOps;
    }

    function enqueuePendingOp(op) {
        var entry = Object.assign({ localId: makeLocalOpId(), enqueuedAt: new Date().toISOString() }, op || {});
        if (!Array.isArray(hubState.pendingOps)) hubState.pendingOps = [];
        hubState.pendingOps.push(entry);
        persistPendingOps();
        lastFlushError = '';
        updatePendingChrome();
        updatePendingFlushChip();
        return entry;
    }

    function removePendingOp(localId) {
        hubState.pendingOps = (hubState.pendingOps || []).filter(function (op) {
            return !(op && String(op.localId) === String(localId));
        });
        persistPendingOps();
        updatePendingChrome();
        updatePendingFlushChip();
        if (!hasUnsyncedPending()) {
            lastFlushError = '';
        }
    }

    function syncBeforeUnloadGuard() {
        if (beforeUnloadBound) return;
        beforeUnloadBound = true;
        global.addEventListener('beforeunload', function (event) {
            if (!hasUnsyncedPending()) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    function isHubModalOpen() {
        return !!(hubOverlay && !hubOverlay.hidden);
    }

    /** Same source of truth as github-sync.js「自動同步」checkbox. */
    function isGitAutoSyncOn() {
        if (typeof readAutoSync === 'function') {
            try { return !!readAutoSync(); } catch (ignore) { return false; }
        }
        try {
            return global.localStorage.getItem('econ_git_auto_sync') === '1';
        } catch (ignore2) {
            return false;
        }
    }

    function ensurePendingFlushChip() {
        var hubBtn = ensureHubButton();
        var host = hubBtn && hubBtn.parentNode;
        if (!host) {
            host = document.querySelector('header div[style*="flex-wrap"]')
                || document.querySelector('header');
        }
        if (!host) return null;
        var chip = document.getElementById('staging-pending-chip');
        if (chip) {
            if (chip.dataset.bound !== '1') {
                chip.dataset.bound = '1';
                var btn = chip.querySelector('#staging-pending-flush-btn');
                if (btn) {
                    btn.addEventListener('click', function () {
                        flushPendingOps({ reason: 'manual' }).catch(function () {});
                    });
                }
                var reviewExisting = chip.querySelector('#staging-pending-review-btn');
                if (reviewExisting) {
                    reviewExisting.addEventListener('click', function () {
                        openPendingQueuePanel();
                    });
                }
                var labelExisting = chip.querySelector('#staging-pending-chip-label');
                if (labelExisting) {
                    labelExisting.addEventListener('click', function () {
                        openPendingQueuePanel();
                    });
                }
            }
            return chip;
        }
        chip = document.createElement('div');
        chip.id = 'staging-pending-chip';
        chip.className = 'staging-pending-chip';
        chip.hidden = true;
        chip.setAttribute('role', 'status');
        chip.innerHTML = ''
            + '<button type="button" class="staging-pending-chip-label" id="staging-pending-chip-label"'
            + ' title="檢視待上傳佇列">待上傳審批 0</button>'
            + '<button type="button" class="btn btn-secondary btn-sm" id="staging-pending-review-btn">檢視佇列</button>'
            + '<button type="button" class="btn btn-primary btn-sm" id="staging-pending-flush-btn">立即上傳</button>';
        chip.dataset.bound = '1';
        var flushBtn = chip.querySelector('#staging-pending-flush-btn');
        flushBtn.addEventListener('click', function () {
            flushPendingOps({ reason: 'manual' }).catch(function () {});
        });
        var reviewBtn = chip.querySelector('#staging-pending-review-btn');
        if (reviewBtn) {
            reviewBtn.addEventListener('click', function () {
                openPendingQueuePanel();
            });
        }
        var labelBtn = chip.querySelector('#staging-pending-chip-label');
        if (labelBtn) {
            labelBtn.addEventListener('click', function () {
                openPendingQueuePanel();
            });
        }
        if (hubBtn && hubBtn.parentNode === host) {
            host.insertBefore(chip, hubBtn.nextSibling);
        } else {
            host.appendChild(chip);
        }
        return chip;
    }

    function updatePendingFlushChip() {
        if (!hasAdminAccess()) {
            var dead = document.getElementById('staging-pending-chip');
            if (dead) dead.hidden = true;
            return;
        }
        var chip = ensurePendingFlushChip();
        if (!chip) return;
        var n = pendingCount();
        var label = document.getElementById('staging-pending-chip-label');
        var btn = document.getElementById('staging-pending-flush-btn');
        if (n <= 0 && !hubState.flushing) {
            chip.hidden = true;
            chip.classList.remove('is-error', 'is-flushing');
            if (label) label.textContent = '待上傳審批 0';
            if (btn) {
                btn.disabled = false;
                btn.textContent = '立即上傳';
            }
            var emptyOverlay = document.getElementById('staging-pending-queue-overlay');
            if (emptyOverlay && !emptyOverlay.hidden) {
                renderPendingQueuePanel();
            }
            return;
        }
        chip.hidden = false;
        var reviewBtn = document.getElementById('staging-pending-review-btn');
        if (hubState.flushing) {
            chip.classList.add('is-flushing');
            chip.classList.remove('is-error');
            if (label) label.textContent = '正在上傳審批…';
            if (btn) {
                btn.disabled = true;
                btn.textContent = '上傳中';
            }
            if (reviewBtn) reviewBtn.disabled = true;
            return;
        }
        if (reviewBtn) reviewBtn.disabled = false;
        chip.classList.remove('is-flushing');
        if (lastFlushError) {
            chip.classList.add('is-error');
            if (label) {
                label.textContent = '待上傳審批 ' + n + '（失敗可重試）';
                label.title = lastFlushError;
            }
        } else {
            chip.classList.remove('is-error');
            if (label) {
                label.textContent = '待上傳審批 ' + n;
                label.title = isGitAutoSyncOn()
                    ? '有本機待同步審批（可立即上傳）'
                    : '自動同步已關閉：按「立即上傳」或開啟自動同步後再操作';
            }
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = '立即上傳';
        }
    }

    function pendingOpKindLabel(kind) {
        return kind === 'parts' ? '分題' : (kind === 'class' ? '分類' : String(kind || ''));
    }

    function pendingOpActionLabel(op) {
        if (!op) return '';
        if (op.op === 'approve') return '通過';
        if (op.op === 'reject') {
            if (op.kind === 'class' && Array.isArray(op.rejectFields) && op.rejectFields.length) {
                return '保留原值';
            }
            return '拒絕';
        }
        return String(op.op || '');
    }

    function pendingOpPreviewText(op) {
        if (!op) return '';
        try {
            if (op.kind === 'parts') {
                var parts = (op.bankSnap && op.bankSnap.questionParts)
                    || (op.proposalSnap && op.proposalSnap.questionParts)
                    || [];
                return formatPartsPreview(parts);
            }
            if (op.kind === 'class' && op.op === 'approve') {
                var fields = Array.isArray(op.approveFields) ? op.approveFields : [];
                var values = op.values || {};
                if (!fields.length) return '（無欄位）';
                return fields.map(function (f) {
                    return classFieldLabel(f) + '：' + formatClassList(values[f]);
                }).join('；');
            }
            if (op.kind === 'class' && op.op === 'reject') {
                if (Array.isArray(op.rejectFields) && op.rejectFields.length) {
                    return '保留：' + op.rejectFields.map(classFieldLabel).join('、');
                }
                return '全部保留原值／移除提案';
            }
        } catch (ignore) {}
        return '';
    }

    function restoreProposalFromOp(op) {
        if (!op || !op.proposalSnap || !op.proposalSnap.id) {
            return false;
        }
        var snap = cloneJson(op.proposalSnap);
        var id = String(snap.id || op.proposalId || '');
        if (!id) return false;
        if (op.kind === 'parts') {
            var partsList = (hubState.partsRows || []).filter(function (item) {
                return !(item && String(item.id) === id);
            });
            partsList.unshift(snap);
            hubState.partsRows = partsList;
            return true;
        }
        if (op.kind === 'class') {
            var found = false;
            hubState.classRows = (hubState.classRows || []).map(function (item) {
                if (!item || String(item.id) !== id) return item;
                found = true;
                return snap;
            });
            if (!found) {
                hubState.classRows = (hubState.classRows || []).concat([snap]);
            }
            hubState.classPendingCount = (hubState.classRows || []).length;
            return true;
        }
        return false;
    }

    async function revokePendingOp(localId) {
        var id = String(localId || '');
        if (!id || hubState.flushing) return false;
        var op = null;
        for (var i = 0; i < (hubState.pendingOps || []).length; i++) {
            if (hubState.pendingOps[i] && String(hubState.pendingOps[i].localId) === id) {
                op = hubState.pendingOps[i];
                break;
            }
        }
        if (!op) return false;
        removePendingOp(id);
        if (op.op === 'approve' && op.undoBankSnap) {
            scheduleLocalBankApply(revertLocalBankFromUndo(op.undoBankSnap, op.kind));
        }
        var restored = restoreProposalFromOp(op);
        if (!restored) {
            try {
                await ensureStagingCache(true);
            } catch (ignore) {}
        } else {
            // Re-apply remaining pending ops onto hub lists (hide still-queued proposals).
            applyPendingOpsToLoadedRows();
        }
        if (hubOverlay && !hubOverlay.hidden) {
            renderHubList();
            syncHubChrome();
            syncBulkButton();
        }
        refreshQuestionCardStaging(op.questionId);
        maybeRefreshPendingStagingFilter();
        updatePendingFlushChip();
        renderPendingQueuePanel();
        showCardStagingToast(
            '已撤銷本機佇列：' + String(op.questionId || '')
            + '（' + pendingOpKindLabel(op.kind) + '／' + pendingOpActionLabel(op) + '）'
        );
        return true;
    }

    function ensurePendingQueuePanel() {
        var overlay = document.getElementById('staging-pending-queue-overlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'staging-pending-queue-overlay';
        overlay.className = 'staging-pending-queue-overlay report-issue-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="staging-pending-queue-dialog report-issue-dialog" role="dialog"'
            + ' aria-modal="true" aria-labelledby="staging-pending-queue-title">'
            + '<div class="report-issue-header">'
            + '<div><h2 id="staging-pending-queue-title">待上傳審批佇列</h2>'
            + '<p class="report-issue-subtitle">尚未同步至雲端的本機通過／拒絕。可逐項撤銷後再上傳。</p></div>'
            + '<button type="button" class="report-issue-close" id="staging-pending-queue-close"'
            + ' aria-label="關閉">×</button>'
            + '</div>'
            + '<div class="staging-pending-queue-body" id="staging-pending-queue-body"></div>'
            + '<div class="staging-pending-queue-footer">'
            + '<button type="button" class="btn btn-secondary" id="staging-pending-queue-close-2">關閉</button>'
            + '<button type="button" class="btn btn-primary" id="staging-pending-queue-flush">立即上傳</button>'
            + '</div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (ev) {
            if (ev.target === overlay && shouldCloseOnBackdropClick()) closePendingQueuePanel();
        });
        var closeBtn = overlay.querySelector('#staging-pending-queue-close');
        var closeBtn2 = overlay.querySelector('#staging-pending-queue-close-2');
        if (closeBtn) closeBtn.addEventListener('click', closePendingQueuePanel);
        if (closeBtn2) closeBtn2.addEventListener('click', closePendingQueuePanel);
        var flushBtn = overlay.querySelector('#staging-pending-queue-flush');
        if (flushBtn) {
            flushBtn.addEventListener('click', function () {
                closePendingQueuePanel();
                flushPendingOps({ reason: 'manual' }).catch(function () {});
            });
        }
        var body = overlay.querySelector('#staging-pending-queue-body');
        if (body) {
            body.addEventListener('click', function (ev) {
                var btn = ev.target && ev.target.closest
                    ? ev.target.closest('[data-action="revoke-pending"]')
                    : null;
                if (!btn) return;
                var lid = btn.getAttribute('data-local-id');
                if (!lid || hubState.flushing) return;
                btn.disabled = true;
                revokePendingOp(lid).catch(function () {
                    btn.disabled = false;
                });
            });
        }
        return overlay;
    }

    function renderPendingQueuePanel() {
        var body = document.getElementById('staging-pending-queue-body');
        if (!body) return;
        var ops = hubState.pendingOps || [];
        if (!ops.length) {
            body.innerHTML = '<p class="staging-pending-queue-empty">目前沒有待上傳項目。</p>';
            return;
        }
        var html = '<ul class="staging-pending-queue-list">';
        ops.forEach(function (op) {
            if (!op || !op.localId) return;
            var preview = pendingOpPreviewText(op);
            html += '<li class="staging-pending-queue-item">'
                + '<div class="staging-pending-queue-main">'
                + '<div class="staging-pending-queue-meta">'
                + '<strong>' + esc(String(op.questionId || '（無編號）')) + '</strong>'
                + '<span class="staging-pending-queue-tag">' + esc(pendingOpKindLabel(op.kind)) + '</span>'
                + '<span class="staging-pending-queue-tag">' + esc(pendingOpActionLabel(op)) + '</span>'
                + '</div>'
                + (preview
                    ? '<div class="staging-pending-queue-preview">' + esc(preview) + '</div>'
                    : '')
                + '</div>'
                + '<button type="button" class="btn btn-secondary btn-sm"'
                + ' data-action="revoke-pending" data-local-id="' + esc(String(op.localId)) + '"'
                + (hubState.flushing ? ' disabled' : '')
                + '>撤銷</button>'
                + '</li>';
        });
        html += '</ul>';
        body.innerHTML = html;
    }

    function openPendingQueuePanel() {
        if (!hasAdminAccess()) return;
        var overlay = ensurePendingQueuePanel();
        renderPendingQueuePanel();
        overlay.hidden = false;
    }

    function closePendingQueuePanel() {
        var overlay = document.getElementById('staging-pending-queue-overlay');
        if (overlay) overlay.hidden = true;
    }

    function notifyFlushStatus(text, kind, reason) {
        setHubBanner(text, kind);
        updatePendingFlushChip();
        if (reason === 'hub') return;
        if (kind === 'error' || kind === 'ok') {
            showCardStagingToast(text);
            return;
        }
        if ((reason === 'manual' || reason === 'auto-sync' || reason === 'hub-close')
            && kind === 'info' && String(text || '').indexOf('（0／') !== -1) {
            showCardStagingToast(text);
        }
    }

    function updatePendingChrome() {
        updatePendingFlushChip();
        if (!hubOverlay || hubOverlay.hidden) return;
        if (hubState.flushing || hubState.busy) return;
        var n = pendingCount();
        if (n <= 0) return;
        var st = document.getElementById('feedback-hub-status');
        var cur = st ? String(st.textContent || '') : '';
        // Keep a fresh per-action ok/warn message; only fill empty or prior pending hint.
        if (cur && cur.indexOf('本機待同步') !== 0 && cur.indexOf('已通過（本機）') !== 0
            && cur.indexOf('已拒絕（本機）') !== 0 && cur.indexOf('已保留原值（本機）') !== 0
            && cur.indexOf('已全部保留原值（本機）') !== 0) {
            return;
        }
        if (cur.indexOf('已通過（本機）') === 0 || cur.indexOf('已拒絕（本機）') === 0
            || cur.indexOf('已保留原值（本機）') === 0 || cur.indexOf('已全部保留原值（本機）') === 0) {
            setHubBanner(cur.replace(/ — 關閉視窗時同步雲端.*/, '') + ' — 本機待同步 ' + n + ' 項', 'ok');
            return;
        }
        setHubBanner('本機待同步：' + n + ' 項（關閉視窗時寫入雲端）', 'info');
    }

    function computeClassRemaining(row, removedFields) {
        if (!row) return null;
        var removeSet = {};
        (removedFields || []).forEach(function (f) { removeSet[String(f)] = true; });
        var fields = (Array.isArray(row.fields) ? row.fields : []).filter(function (f) {
            return !removeSet[String(f)];
        });
        if (!fields.length) return null;
        var proposedValues = {};
        var currentValues = {};
        fields.forEach(function (f) {
            if (row.proposedValues && Object.prototype.hasOwnProperty.call(row.proposedValues, f)) {
                proposedValues[f] = row.proposedValues[f];
            }
            if (row.currentValues && Object.prototype.hasOwnProperty.call(row.currentValues, f)) {
                currentValues[f] = row.currentValues[f];
            }
        });
        return Object.assign({}, row, {
            fields: fields,
            proposedValues: proposedValues,
            currentValues: currentValues
        });
    }

    function applyPendingOpsToLoadedRows() {
        var ops = hubState.pendingOps || [];
        for (var i = 0; i < ops.length; i++) {
            var op = ops[i];
            if (!op) continue;
            if (op.kind === 'parts') {
                hubState.partsRows = (hubState.partsRows || []).filter(function (item) {
                    return !(item && String(item.id) === String(op.proposalId));
                });
                delete hubState.selected[String(op.proposalId || '')];
            } else if (op.kind === 'class') {
                if (Object.prototype.hasOwnProperty.call(op, 'proposalRemaining')) {
                    applyClassProposalRemaining(op.proposalId, op.proposalRemaining);
                } else if (op.op === 'reject' && !(op.rejectFields && op.rejectFields.length)) {
                    applyClassProposalRemaining(op.proposalId, null);
                } else if (op.op === 'approve' && Array.isArray(op.approveFields)) {
                    var row = findClassRow(op.proposalId);
                    if (row) {
                        applyClassProposalRemaining(
                            op.proposalId,
                            computeClassRemaining(row, op.approveFields)
                        );
                    }
                } else if (op.op === 'reject' && Array.isArray(op.rejectFields)) {
                    var row2 = findClassRow(op.proposalId);
                    if (row2) {
                        applyClassProposalRemaining(
                            op.proposalId,
                            computeClassRemaining(row2, op.rejectFields)
                        );
                    }
                }
            }
            if (op.op === 'approve' && op.bankSnap) {
                if (op.kind === 'parts') {
                    scheduleLocalBankApply(applyApprovedPartsLocally(op.bankSnap));
                } else if (op.kind === 'class') {
                    scheduleLocalBankApply(applyApprovedClassificationLocally(op.bankSnap));
                }
            }
        }
        updatePendingChrome();
        refreshQuestionCardStaging();
        // No maybeRefreshPendingStagingFilter: this runs inside ensureStagingCache
        // load (would deadlock on stagingCacheInflight). Card/hub approve hooks refresh.
    }

    async function lookupLocalQuestion(questionId) {
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') return null;
        try {
            var all = await global.storage.getAllQuestions();
            var qid = String(questionId || '');
            for (var i = 0; i < (all || []).length; i++) {
                if (all[i] && String(all[i].id) === qid) return all[i];
            }
        } catch (ignore) {}
        return null;
    }

    function bankHasFilledPartsLocal(q) {
        if (!q) return false;
        if (String(q.partsStatus || '').trim().toLowerCase() === 'filled') return true;
        return Array.isArray(q.questionParts) && q.questionParts.length > 0;
    }

    function classNeedsOverwriteLocal(q, fields, currentValues) {
        if (q && String(q.reviewedByAI || '').trim().toUpperCase() === 'Y') return true;
        var src = currentValues || {};
        for (var i = 0; i < (fields || []).length; i++) {
            var f = fields[i];
            var meta = classFieldMeta(f);
            if (meta && meta.blankOnly) continue;
            if (!classValueIsEmpty(f, src[f])) return true;
            if (q && !classValueIsEmpty(f, q[f])) return true;
        }
        return false;
    }

    var FLUSH_STAGING_BATCH_MAX = 50;

    function pendingOpToBatchPayload(op) {
        var payload = {
            localId: String(op.localId || ''),
            kind: String(op.kind || ''),
            op: String(op.op || ''),
            proposalId: String(op.proposalId || ''),
            questionId: String(op.questionId || ''),
            confirmOverwrite: op.confirmOverwrite === true
        };
        if (op.kind === 'class' && op.op === 'approve') {
            payload.approveFields = Array.isArray(op.approveFields) ? op.approveFields : [];
            payload.values = op.values || {};
        }
        if (op.kind === 'class' && op.op === 'reject') {
            if (Array.isArray(op.rejectFields) && op.rejectFields.length) {
                payload.rejectFields = op.rejectFields;
            }
        }
        return payload;
    }

    function findPendingOpByLocalId(localId) {
        var id = String(localId || '');
        var ops = hubState.pendingOps || [];
        for (var i = 0; i < ops.length; i++) {
            if (ops[i] && String(ops[i].localId) === id) return ops[i];
        }
        return null;
    }

    function applyBatchFlushResultItem(item, reason) {
        var localId = String(item && item.localId || '');
        var op = findPendingOpByLocalId(localId);
        var status = item && item.status;
        // Success / noop / blank_only → remove from client queue
        if (status === 'ok' || status === 'noop') {
            if (item.question) {
                if (op && op.kind === 'parts') {
                    scheduleLocalBankApply(applyApprovedPartsLocally(item.question));
                } else if (op && op.kind === 'class') {
                    scheduleLocalBankApply(applyApprovedClassificationLocally(item.question));
                } else if (item.kind === 'parts') {
                    scheduleLocalBankApply(applyApprovedPartsLocally(item.question));
                } else if (item.kind === 'class') {
                    scheduleLocalBankApply(applyApprovedClassificationLocally(item.question));
                }
            }
            if (op && item.proposalRemaining != null) {
                op.proposalRemaining = item.proposalRemaining;
            }
            if (localId) removePendingOp(localId);
            return { done: true };
        }
        if (status === 'needsConfirm') {
            var confirmMsg = (item && item.message && String(item.message))
                || '需要確認覆寫';
            logFlushOpFailure(op || item, confirmMsg, item, reason, null);
            return {
                done: false,
                failed: {
                    questionId: String((item && item.questionId) || (op && op.questionId) || ''),
                    message: confirmMsg,
                    needsConfirm: true
                }
            };
        }
        // failed
        var failMsg = (item && item.message && String(item.message))
            || errorMessage(item && item.error);
        logFlushOpFailure(op || item, failMsg, item, reason, null);
        return {
            done: false,
            failed: {
                questionId: String((item && item.questionId) || (op && op.questionId) || ''),
                message: failMsg
            }
        };
    }

    async function flushPendingOpsBatchChunk(chunk, reason) {
        var data = await enqueueStagingWrite(function () {
            return proxyAction({
                action: 'flushStagingApprovals',
                ops: chunk.map(pendingOpToBatchPayload)
            }, 180000);
        });
        return data;
    }

    async function flushPendingOpsSequentialFallback(ops, reason) {
        var done = 0;
        var failedList = [];
        for (var i = 0; i < ops.length; i++) {
            var op = ops[i];
            if (!findPendingOpByLocalId(op.localId)) continue;
            notifyFlushStatus('正在同步至雲端（' + done + '／' + ops.length + '）…', 'info', reason);
            var data = null;
            try {
                data = await enqueueStagingWrite(function () {
                    return executePendingOp(op);
                });
            } catch (err) {
                var catchMsg = errorMessage(err && err.code);
                logFlushOpFailure(op, catchMsg, null, reason, err);
                failedList.push({ questionId: String(op.questionId || ''), message: catchMsg });
                continue;
            }
            if (data && data.needsConfirm === true && op.confirmOverwrite !== true) {
                // Prefer skip+report (never block hub-close / background flush on confirm).
                var cancelMsg = (data.message && String(data.message)) || '需要確認覆寫';
                logFlushOpFailure(op, cancelMsg, data, reason, null);
                failedList.push({ questionId: String(op.questionId || ''), message: cancelMsg });
                continue;
            }
            if (data && data.error === 'blank_only_filled') {
                if (Object.prototype.hasOwnProperty.call(data, 'proposalRemaining')) {
                    op.proposalRemaining = data.proposalRemaining;
                }
                removePendingOp(op.localId);
                done += 1;
                continue;
            }
            if (!data || data.ok !== true) {
                var failMsg = (data && data.message && String(data.message))
                    || errorMessage(data && data.error);
                logFlushOpFailure(op, failMsg, data, reason, null);
                failedList.push({ questionId: String(op.questionId || ''), message: failMsg });
                continue;
            }
            if (data.question) {
                if (op.kind === 'parts') {
                    scheduleLocalBankApply(applyApprovedPartsLocally(data.question));
                } else if (op.kind === 'class') {
                    scheduleLocalBankApply(applyApprovedClassificationLocally(data.question));
                }
            }
            removePendingOp(op.localId);
            done += 1;
        }
        return { done: done, failedList: failedList };
    }


    function executePendingOp(op) {
        if (op.kind === 'parts' && op.op === 'approve') {
            return proxyAction({
                action: 'approveQuestionPartsProposal',
                proposalId: String(op.proposalId || ''),
                questionId: String(op.questionId || ''),
                confirmOverwrite: op.confirmOverwrite === true
            }, 120000);
        }
        if (op.kind === 'parts' && op.op === 'reject') {
            return proxyAction({
                action: 'rejectQuestionPartsProposal',
                proposalId: String(op.proposalId || ''),
                questionId: String(op.questionId || '')
            }, 60000);
        }
        if (op.kind === 'class' && op.op === 'approve') {
            return proxyAction({
                action: 'approveClassificationProposal',
                proposalId: String(op.proposalId || ''),
                questionId: String(op.questionId || ''),
                approveFields: Array.isArray(op.approveFields) ? op.approveFields : [],
                values: op.values || {},
                confirmOverwrite: op.confirmOverwrite === true
            }, 120000);
        }
        if (op.kind === 'class' && op.op === 'reject') {
            var payload = {
                action: 'rejectClassificationProposal',
                proposalId: String(op.proposalId || ''),
                questionId: String(op.questionId || '')
            };
            if (Array.isArray(op.rejectFields) && op.rejectFields.length) {
                payload.rejectFields = op.rejectFields;
            }
            return proxyAction(payload, 60000);
        }
        return Promise.resolve({ ok: false, error: 'bad_request' });
    }

    function logFlushOpFailure(op, message, data, reason, err) {
        var details = {
            questionId: op && op.questionId,
            kind: op && op.kind,
            op: op && op.op,
            proposalId: op && op.proposalId,
            localId: op && op.localId,
            message: message,
            flushReason: reason
        };
        if (data && typeof data === 'object') {
            details.raw = {
                ok: data.ok,
                error: data.error,
                message: data.message,
                needsConfirm: data.needsConfirm
            };
        }
        if (err) {
            details.error = err;
            details.errorCode = err && err.code;
        }
        console.error('[審批同步失敗]', details);
    }

    function marksMismatchHintForMessage(msg) {
        var s = String(msg || '');
        if (s.indexOf('分題分數合計') === -1 && s.indexOf('與總分') === -1) return '';
        return '（總分為 0 不會自動合計；請先把雲端題庫總分改成與分題一致，或清空總分後再上傳）';
    }

    async function flushPendingOps(options) {
        options = options || {};
        var reason = options.reason || 'hub';
        if (hubState.flushing) return false;
        var opsSnapshot = (hubState.pendingOps || []).slice();
        if (!opsSnapshot.length) {
            lastFlushError = '';
            updatePendingFlushChip();
            return true;
        }
        hubState.flushing = true;
        hubState.busy = true;
        syncBulkButton();
        updatePendingFlushChip();
        var total = opsSnapshot.length;
        var done = 0;
        var failedList = [];
        notifyFlushStatus('正在同步至雲端（0／' + total + '）…', 'info', reason);
        try {
            var useBatch = true;
            var offset = 0;
            while (offset < opsSnapshot.length) {
                var chunk = opsSnapshot.slice(offset, offset + FLUSH_STAGING_BATCH_MAX);
                offset += FLUSH_STAGING_BATCH_MAX;
                // Only ops still pending (revoked mid-flight stay skipped).
                chunk = chunk.filter(function (op) {
                    return op && findPendingOpByLocalId(op.localId);
                });
                if (!chunk.length) continue;
                notifyFlushStatus(
                    '正在同步至雲端（' + done + '／' + total + '）…',
                    'info',
                    reason
                );

                if (useBatch) {
                    var data = null;
                    try {
                        data = await flushPendingOpsBatchChunk(chunk, reason);
                    } catch (err) {
                        var batchErrCode = err && err.code;
                        // Old deployment / unknown action → fall back to sequential for this flush.
                        if (batchErrCode === 'unknown_action' || batchErrCode === 'bad_request') {
                            console.warn('[審批同步] batch API 不可用，改用逐筆同步', err);
                            useBatch = false;
                            var seq = await flushPendingOpsSequentialFallback(chunk, reason);
                            done += seq.done;
                            failedList = failedList.concat(seq.failedList);
                            continue;
                        }
                        var catchMsg = errorMessage(batchErrCode);
                        console.error('[審批同步失敗] batch', { reason: reason, error: err });
                        chunk.forEach(function (op) {
                            logFlushOpFailure(op, catchMsg, null, reason, err);
                            failedList.push({
                                questionId: String(op.questionId || ''),
                                message: catchMsg
                            });
                        });
                        continue;
                    }
                    if (data && data.error === 'batch_too_large') {
                        // Should not happen when client chunks; treat as hard fail for chunk.
                        var tooLargeMsg = (data.message && String(data.message))
                            || '單批項目過多';
                        chunk.forEach(function (op) {
                            logFlushOpFailure(op, tooLargeMsg, data, reason, null);
                            failedList.push({
                                questionId: String(op.questionId || ''),
                                message: tooLargeMsg
                            });
                        });
                        continue;
                    }
                    if (!data || data.ok !== true || !Array.isArray(data.results)) {
                        // Unknown / undeployed action → sequential fallback once.
                        var errCode = data && data.error;
                        if (errCode === 'unknown_action' || errCode === 'bad_request' || !data) {
                            console.warn('[審批同步] batch 回應異常，改用逐筆同步', data);
                            useBatch = false;
                            var seq2 = await flushPendingOpsSequentialFallback(chunk, reason);
                            done += seq2.done;
                            failedList = failedList.concat(seq2.failedList);
                            continue;
                        }
                        var failAll = (data.message && String(data.message))
                            || errorMessage(errCode);
                        chunk.forEach(function (op) {
                            logFlushOpFailure(op, failAll, data, reason, null);
                            failedList.push({
                                questionId: String(op.questionId || ''),
                                message: failAll
                            });
                        });
                        continue;
                    }
                    if (data.summary) {
                        console.info('[審批同步] batch summary', data.summary);
                    }
                    for (var riIdx = 0; riIdx < data.results.length; riIdx++) {
                        var applied = applyBatchFlushResultItem(data.results[riIdx], reason);
                        if (applied.done) done += 1;
                        else if (applied.failed) failedList.push(applied.failed);
                    }
                    // Ops in chunk with no result row → leave pending + report
                    var resultIds = {};
                    data.results.forEach(function (r) {
                        if (r && r.localId) resultIds[String(r.localId)] = true;
                    });
                    chunk.forEach(function (op) {
                        if (!resultIds[String(op.localId)]) {
                            var miss = '伺服器未回傳此項目結果';
                            logFlushOpFailure(op, miss, data, reason, null);
                            failedList.push({
                                questionId: String(op.questionId || ''),
                                message: miss
                            });
                        }
                    });
                } else {
                    var seq3 = await flushPendingOpsSequentialFallback(chunk, reason);
                    done += seq3.done;
                    failedList = failedList.concat(seq3.failedList);
                }
                notifyFlushStatus(
                    '正在同步至雲端（' + done + '／' + total + '）…',
                    'info',
                    reason
                );
            }

            if (failedList.length) {
                var firstFail = failedList[0];
                var firstMsg = firstFail && firstFail.message ? String(firstFail.message) : '';
                var failCount = failedList.length;
                var marksHint = marksMismatchHintForMessage(firstMsg);
                lastFlushError = firstMsg;
                console.error('[審批同步失敗] 摘要', {
                    reason: reason,
                    done: done,
                    total: total,
                    failedCount: failCount,
                    failures: failedList
                });
                var toastMsg;
                if (done > 0) {
                    toastMsg = '同步部分完成（已完成 ' + done + '／' + total + '）：失敗 '
                        + failCount + ' 項仍保留本機。首項：' + firstMsg
                        + marksHint + '。可按「立即上傳」重試。';
                } else if (failCount > 1) {
                    toastMsg = '同步失敗（已完成 0／' + total + '）：失敗 '
                        + failCount + ' 項仍保留本機。首項：' + firstMsg
                        + marksHint + '。可按「立即上傳」重試。';
                } else {
                    toastMsg = '同步失敗（已完成 0／' + total + '）：' + firstMsg
                        + marksHint + '。未完成項目仍保留本機，可按「立即上傳」重試。';
                }
                notifyFlushStatus(toastMsg, 'error', reason);
                return false;
            }
            lastFlushError = '';
            notifyFlushStatus(
                done ? ('已成功同步 ' + done + ' 項至雲端。') : '沒有待同步項目。',
                'ok',
                reason
            );
            return true;
        } finally {
            hubState.flushing = false;
            hubState.busy = false;
            syncBulkButton();
            syncHubChrome();
            updatePendingFlushChip();
            if (hasUnsyncedPending()) {
                // Keep chip visible; do not auto-retry immediately after failure.
            }
        }
    }

    function hideFeedbackHubUi() {
        if (!hubOverlay) return;
        hubOverlay.hidden = true;
        hubState.selected = {};
        // Keep busy/inFlight if a background flush is running (hub-close fire-and-forget).
        if (!hubState.flushing) {
            hubState.busy = false;
            hubState.inFlight = Object.create(null);
        }
        if (global.AiExplanation && typeof AiExplanation.closeAdminPanel === 'function') {
            AiExplanation.closeAdminPanel();
        }
    }

    function esc(text) {
        return (typeof escapeHTML === 'function') ? escapeHTML(text) : String(text == null ? '' : text);
    }

    function formatWhen(iso) {
        return (typeof formatDateTimeZhHk === 'function') ? formatDateTimeZhHk(iso) : String(iso || '');
    }

    function username() {
        if (global.PoeGenerate && typeof PoeGenerate.currentUsername === 'function') {
            return PoeGenerate.currentUsername();
        }
        if (typeof gitUsername === 'function') return String(gitUsername() || '').trim().toLowerCase();
        if (!global.authManager || !global.authManager.currentUser) return '';
        return String(global.authManager.currentUser).trim().toLowerCase();
    }


    // --- 題目 tab in-card staging approve/reject (admin) ---

    function findPartsRowByQuestionId(questionId) {
        var qid = String(questionId || '');
        if (!qid) return null;
        var rows = hubState.partsRows || [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && String(rows[i].questionId || '') === qid) return rows[i];
        }
        return null;
    }

    function findClassRowByQuestionId(questionId) {
        var qid = String(questionId || '');
        if (!qid) return null;
        var rows = hubState.classRows || [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && String(rows[i].questionId || '') === qid) return rows[i];
        }
        return null;
    }

    function pendingForQuestion(questionId) {
        if (!hasAdminAccess()) return { classRow: null, partsRow: null };
        return {
            classRow: findClassRowByQuestionId(questionId),
            partsRow: findPartsRowByQuestionId(questionId)
        };
    }

    function isStagingCacheReady() {
        return !!hubState.stagingCacheReady;
    }

    /** True when adminBlank「有未審批事項」is checked or excluded. */
    function pendingStagingFilterActive() {
        var map = global.triStateFilters && global.triStateFilters.adminBlank;
        if (!map) return false;
        var st = map['有未審批事項'];
        return st === 'checked' || st === 'excluded';
    }

    /** Re-run 題目 list when「有未審批事項」filter is on (chip hide ↔ filter). */
    function maybeRefreshPendingStagingFilter() {
        if (!pendingStagingFilterActive()) return;
        if (typeof global.filterQuestions === 'function') {
            try {
                var ret = global.filterQuestions();
                if (ret && typeof ret.then === 'function') ret.catch(function () {});
            } catch (ignore) {}
        }
    }

    /** Compact proposed vs current for 分類 pending on question card. */
    function stagingClassPreviewHtml(row) {
        if (!row) return '';
        var proposed = row.proposedValues || {};
        var current = row.currentValues || {};
        var fields = Array.isArray(row.fields) ? row.fields.slice() : [];
        if (!fields.length) {
            fields = Object.keys(proposed);
        }
        if (!fields.length) return '';
        var lines = fields.map(function (field) {
            var label = classFieldLabel(field);
            var propStr = formatClassList(proposed[field]);
            var curStr = formatClassList(current[field]);
            var html = '<div class="question-staging-preview-line">'
                + '<span class="question-staging-field">' + esc(label) + '</span>'
                + '<code class="question-staging-proposed">' + esc(propStr) + '</code>';
            if (curStr !== propStr) {
                html += '<span class="question-staging-current">現有：' + esc(curStr) + '</span>';
            }
            html += '</div>';
            return html;
        });
        return '<div class="question-staging-preview">' + lines.join('') + '</div>';
    }

    /** Compact proposed questionParts for 分題 pending on question card. */
    function stagingPartsPreviewHtml(row) {
        if (!row) return '';
        var parts = Array.isArray(row.questionParts) ? row.questionParts : [];
        if (!parts.length) {
            return '<div class="question-staging-preview">'
                + '<code class="question-staging-proposed">' + esc(formatPartsPreview(parts)) + '</code>'
                + '</div>';
        }
        var lines = parts.map(function (part) {
            var label = String(part && part.label != null ? part.label : '').trim() || '?';
            var marks = part && part.marks != null && part.marks !== '' ? String(part.marks) : '—';
            var perf = String(part && part.performance || '').trim();
            var bits = '<span class="question-staging-field">分題 ' + esc(label) + '</span>'
                + '<code class="question-staging-proposed">' + esc(marks) + ' 分'
                + (perf ? ' ｜ ' + esc(perf) : '') + '</code>';
            return '<div class="question-staging-preview-line">' + bits + '</div>';
        });
        return '<div class="question-staging-preview">' + lines.join('') + '</div>';
    }

    function stagingActionsHtml(questionId) {
        if (!hasAdminAccess()) return '';
        if (!hubState.stagingCacheReady && !hubState.partsRows.length && !hubState.classRows.length) {
            return '';
        }
        var pending = pendingForQuestion(questionId);
        var bits = [];
        if (pending.classRow && pending.classRow.id) {
            bits.push(
                '<div class="question-staging-row" data-staging-kind="class">'
                + '<div class="question-staging-row-head">'
                + '<span class="question-staging-label">待審批分類</span>'
                + '<button type="button" class="question-staging-btn is-approve" data-action="staging-approve"'
                + ' data-kind="class" data-proposal-id="' + esc(pending.classRow.id) + '"'
                + ' data-id="' + esc(questionId) + '" title="通過全部欄位（本機佇列）">✓</button>'
                + '<button type="button" class="question-staging-btn is-reject" data-action="staging-reject"'
                + ' data-kind="class" data-proposal-id="' + esc(pending.classRow.id) + '"'
                + ' data-id="' + esc(questionId) + '" title="全部保留原值（本機佇列）">✕</button>'
                + '</div>'
                + stagingClassPreviewHtml(pending.classRow)
                + '</div>'
            );
        }
        if (pending.partsRow && pending.partsRow.id) {
            bits.push(
                '<div class="question-staging-row" data-staging-kind="parts">'
                + '<div class="question-staging-row-head">'
                + '<span class="question-staging-label">待審批分題</span>'
                + '<button type="button" class="question-staging-btn is-approve" data-action="staging-approve"'
                + ' data-kind="parts" data-proposal-id="' + esc(pending.partsRow.id) + '"'
                + ' data-id="' + esc(questionId) + '" title="通過分題提案（本機佇列）">✓</button>'
                + '<button type="button" class="question-staging-btn is-reject" data-action="staging-reject"'
                + ' data-kind="parts" data-proposal-id="' + esc(pending.partsRow.id) + '"'
                + ' data-id="' + esc(questionId) + '" title="拒絕分題提案（本機佇列）">✕</button>'
                + '</div>'
                + stagingPartsPreviewHtml(pending.partsRow)
                + '</div>'
            );
        }
        if (!bits.length) return '';
        return '<div class="question-staging-actions" data-question-id="' + esc(questionId) + '">'
            + bits.join('')
            + '</div>';
    }

    function refreshQuestionCardStaging(questionId) {
        var grid = document.getElementById('question-grid');
        if (!grid) return;
        var cards = grid.querySelectorAll('.question-card');
        var onlyId = questionId != null && questionId !== '' ? String(questionId) : null;
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var qid = String(card.getAttribute('data-question-id') || '');
            if (!qid) {
                var reportBtn = card.querySelector('[data-action="report-issue"]');
                qid = reportBtn ? String(reportBtn.getAttribute('data-id') || '') : '';
            }
            if (!qid) continue;
            if (onlyId && qid !== onlyId) continue;
            var html = stagingActionsHtml(qid);
            var host = card.querySelector('.question-staging-actions');
            if (!html) {
                if (host) host.remove();
                continue;
            }
            if (host) {
                host.outerHTML = html;
            } else {
                var actions = card.querySelector('.question-card-actions');
                if (actions) {
                    actions.insertAdjacentHTML('beforebegin', html);
                }
            }
        }
    }

    var cardToastTimer = null;
    function showCardStagingToast(message) {
        var el = document.getElementById('question-staging-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'question-staging-toast';
            el.className = 'question-staging-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = String(message || '');
        el.hidden = !message;
        el.classList.add('is-visible');
        if (cardToastTimer) clearTimeout(cardToastTimer);
        cardToastTimer = setTimeout(function () {
            el.classList.remove('is-visible');
            el.hidden = true;
        }, 4200);
    }

    var stagingCacheInflight = null;

    async function ensureStagingCache(force) {
        if (!hasAdminAccess()) {
            hubState.stagingCacheReady = false;
            hubState.partsRows = [];
            hubState.classRows = [];
            refreshQuestionCardStaging();
            return;
        }
        if (hubState.stagingCacheReady && !force) {
            refreshQuestionCardStaging();
            return;
        }
        // Coalesce concurrent callers (filterQuestions + init) onto one load.
        if (stagingCacheInflight && !force) {
            return stagingCacheInflight;
        }
        // If hub already loaded rows this session and not forcing, reuse.
        if (!force && (hubState.partsRows.length || hubState.classRows.length)
            && hubState.stagingCacheReady) {
            refreshQuestionCardStaging();
            return;
        }
        hubState.stagingCacheLoading = true;
        hubState.stagingCacheError = '';
        stagingCacheInflight = (async function () {
            try {
                await loadPendingOpsFromDisk();
                var results = await Promise.all([
                    proxyAction({ action: 'listQuestionPartsProposals' }, 60000).catch(function (err) {
                        return { ok: false, error: err && err.code };
                    }),
                    proxyAction({ action: 'listClassificationProposals' }, 60000).catch(function (err) {
                        return { ok: false, error: err && err.code };
                    })
                ]);
                var parts = results[0];
                var klass = results[1];
                // Only overwrite hub lists when hub overlay is closed or empty load —
                // when hub is open mid-edit, prefer hub's fresher loadHubData.
                var hubOpen = hubOverlay && !hubOverlay.hidden;
                if (!hubOpen || force) {
                    if (parts && parts.ok && Array.isArray(parts.rows)) {
                        hubState.partsRows = parts.rows;
                    }
                    if (klass && klass.ok && Array.isArray(klass.rows)) {
                        hubState.classRows = klass.rows;
                        hubState.classPendingCount = (typeof klass.pendingCount === 'number')
                            ? klass.pendingCount
                            : hubState.classRows.length;
                        hubState.classPauseThreshold = (typeof klass.pauseThreshold === 'number')
                            ? klass.pauseThreshold
                            : (hubState.classPauseThreshold || 200);
                        hubState.classPaused = !!(klass.paused === true)
                            || hubState.classPendingCount >= hubState.classPauseThreshold;
                    }
                    applyPendingOpsToLoadedRows();
                }
                hubState.stagingCacheReady = true;
                if ((!parts || parts.ok !== true) && (!klass || klass.ok !== true)) {
                    hubState.stagingCacheError = errorMessage(
                        (parts && parts.error) || (klass && klass.error)
                    );
                }
            } catch (err) {
                hubState.stagingCacheError = errorMessage(err && err.code);
            } finally {
                hubState.stagingCacheLoading = false;
                stagingCacheInflight = null;
                refreshQuestionCardStaging();
                // Do not call maybeRefreshPendingStagingFilter here: filterQuestions
                // awaits this function and would re-enter. Approve／reject paths call it.
            }
        })();
        return stagingCacheInflight;
    }

    async function handleCardStagingAction(op, kind, proposalId, questionId) {
        if (!hasAdminAccess() || hubState.flushing) return;
        var k = String(kind || '');
        var action = String(op || '');
        var pid = String(proposalId || '');
        if (!pid || (k !== 'class' && k !== 'parts')) return;
        // Ensure row is in hubState (cache may be stale after hub-only edits).
        if (k === 'parts' && !findPartsRow(pid)) {
            await ensureStagingCache(true);
        }
        if (k === 'class' && !findClassRow(pid)) {
            await ensureStagingCache(true);
        }
        var beforePending = pendingCount();
        if (k === 'parts' && action === 'approve') {
            await approvePartsProposal(pid);
        } else if (k === 'parts' && action === 'reject') {
            await rejectPartsProposal(pid);
        } else if (k === 'class' && action === 'approve') {
            await approveClassificationProposal(pid);
        } else if (k === 'class' && action === 'reject') {
            await rejectClassificationProposal(pid);
        }
        refreshQuestionCardStaging(questionId);
        maybeRefreshPendingStagingFilter();
        if (pendingCount() <= beforePending) return;
        // Outside hub: honour「自動同步」. Hub path never uses this handler.
        if (isGitAutoSyncOn()) {
            showCardStagingToast('正在上傳審批至雲端…');
            await flushPendingOps({ reason: 'auto-sync' });
        } else {
            showCardStagingToast('已加入本機佇列（自動同步已關閉）。可按「立即上傳」或稍後開啟自動同步。');
            updatePendingFlushChip();
        }
    }


    function hasAdminAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (global.accessRights || null);
        return !!(rights && rights.admin === true);
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

    function errorMessage(code) {
        var map = {
            feature_unavailable: '沒有權限',
            bad_request: '請選擇標籤或輸入說明',
            not_found: '找不到該項目',
            rate_limited: '提交太頻繁，請稍後再試',
            github_not_configured: '回報服務尚未設定',
            github_error: '儲存失敗，請稍後再試',
            validation_failed: '分題資料驗證失敗',
            network: '無法連線到服務',
            proxy_not_configured: '未設定代理服務'
        };
        return map[code] || ('操作失敗' + (code ? '（' + code + '）' : ''));
    }

    function normalizeStatus(raw) {
        var text = String(raw == null ? '' : raw).trim().toLowerCase();
        if (text === 'resolved' || text === 'closed' || text === '已關閉' || text === '已修') {
            return STATUS_RESOLVED;
        }
        return STATUS_OPEN;
    }

    function statusLabel(status) {
        return STATUS_LABELS[normalizeStatus(status)] || STATUS_LABELS.open;
    }

    function bindEscape() {
        if (escapeBound) return;
        escapeBound = true;
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (reportOverlay && !reportOverlay.hidden) {
                closeReportModal();
                return;
            }
            if (hubOverlay && !hubOverlay.hidden) closeFeedbackHub();
        });
    }

    // --- User report modal ---

    function ensureReportOverlay() {
        if (reportOverlay) return reportOverlay;
        reportOverlay = document.createElement('div');
        reportOverlay.id = 'report-issue-overlay';
        reportOverlay.className = 'report-issue-overlay';
        reportOverlay.hidden = true;
        reportOverlay.innerHTML = ''
            + '<div class="report-issue-dialog" role="dialog" aria-modal="true" aria-labelledby="report-issue-title">'
            + '  <header class="report-issue-header">'
            + '    <div>'
            + '      <h2 id="report-issue-title">回報問題</h2>'
            + '      <p class="report-issue-subtitle" id="report-issue-qid"></p>'
            + '    </div>'
            + '    <button type="button" class="report-issue-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="report-issue-chips" id="report-issue-chips" role="group" aria-label="問題類型"></div>'
            + '  <label class="report-issue-label" for="report-issue-text">補充說明（選填）</label>'
            + '  <textarea id="report-issue-text" rows="4" maxlength="4000" placeholder="可簡單寫低邊度有問題…"></textarea>'
            + '  <p class="report-issue-status" id="report-issue-status" hidden></p>'
            + '  <footer class="report-issue-footer">'
            + '    <button type="button" class="btn btn-secondary" id="report-issue-cancel">取消</button>'
            + '    <button type="button" class="btn btn-primary" id="report-issue-submit">提交</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(reportOverlay);
        reportOverlay.addEventListener('click', function (event) {
            if (event.target === reportOverlay && shouldCloseOnBackdropClick()) closeReportModal();
        });
        reportOverlay.querySelector('.report-issue-close').addEventListener('click', closeReportModal);
        reportOverlay.querySelector('#report-issue-cancel').addEventListener('click', closeReportModal);
        reportOverlay.querySelector('#report-issue-submit').addEventListener('click', submitReport);
        var chips = reportOverlay.querySelector('#report-issue-chips');
        chips.innerHTML = TAG_DEFS.map(function (tag) {
            return '<button type="button" class="report-chip" data-tag="' + esc(tag.id) + '" aria-pressed="false">'
                + esc(tag.label) + '</button>';
        }).join('');
        chips.addEventListener('click', function (event) {
            var btn = event.target.closest('[data-tag]');
            if (!btn) return;
            var id = btn.getAttribute('data-tag');
            if (reportState.tags[id]) delete reportState.tags[id];
            else reportState.tags[id] = true;
            btn.classList.toggle('is-active', !!reportState.tags[id]);
            btn.setAttribute('aria-pressed', reportState.tags[id] ? 'true' : 'false');
        });
        return reportOverlay;
    }

    function setReportStatus(text, kind) {
        var el = document.getElementById('report-issue-status');
        if (!el) return;
        el.textContent = String(text || '');
        el.hidden = !text;
        el.className = 'report-issue-status' + (kind ? ' is-' + kind : '');
    }

    function openReportModal(questionId) {
        if (!isSignedIn()) return;
        ensureReportOverlay();
        bindEscape();
        reportState.questionId = String(questionId || '');
        reportState.tags = {};
        reportState.busy = false;
        var qid = document.getElementById('report-issue-qid');
        if (qid) qid.textContent = '題目 ' + reportState.questionId;
        var ta = document.getElementById('report-issue-text');
        if (ta) ta.value = '';
        reportOverlay.querySelectorAll('.report-chip').forEach(function (btn) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
        });
        setReportStatus('', '');
        var submit = document.getElementById('report-issue-submit');
        if (submit) submit.disabled = false;
        reportOverlay.hidden = false;
        document.body.classList.add('report-issue-open');
        if (ta) ta.focus();
    }

    function closeReportModal() {
        if (!reportOverlay) return;
        reportOverlay.hidden = true;
        document.body.classList.remove('report-issue-open');
        reportState.busy = false;
    }

    async function submitReport() {
        if (reportState.busy) return;
        var tags = Object.keys(reportState.tags);
        var ta = document.getElementById('report-issue-text');
        var text = ta ? String(ta.value || '').trim() : '';
        if (!tags.length && !text) {
            setReportStatus('請揀至少一個標籤，或者寫低說明。', 'error');
            return;
        }
        reportState.busy = true;
        var submit = document.getElementById('report-issue-submit');
        if (submit) submit.disabled = true;
        setReportStatus('提交緊…', 'info');
        try {
            var data = await proxyAction({
                action: 'reportIssue',
                questionId: reportState.questionId,
                tags: tags.length ? tags : ['other'],
                text: text
            }, 60000);
            if (!data || data.ok !== true) {
                setReportStatus(errorMessage(data && data.error), 'error');
                return;
            }
            setReportStatus('已提交，多謝回報。', 'ok');
            setTimeout(closeReportModal, 700);
            if (typeof showNotification === 'function') {
                showNotification('已提交問題回報', 'success');
            }
        } catch (err) {
            setReportStatus(errorMessage(err && err.code), 'error');
        } finally {
            reportState.busy = false;
            if (submit) submit.disabled = false;
        }
    }

    // --- Combined admin hub (AI解釋 Feedback + 回報問題) ---

    function ensureHubButton() {
        var host = document.querySelector('header div[style*="flex-wrap"]') ||
            document.querySelector('header');
        if (!host) return null;
        var button = document.getElementById('feedback-hub-admin-btn');
        if (button) {
            if (button.dataset.bound !== '1') {
                button.dataset.bound = '1';
                button.addEventListener('click', openFeedbackHub);
            }
            return button;
        }
        button = document.createElement('button');
        button.type = 'button';
        button.id = 'feedback-hub-admin-btn';
        button.className = 'btn btn-outline-primary header-toolbar-btn';
        button.hidden = true;
        button.textContent = '審批與回報';
        button.setAttribute('aria-label', '審批與回報：AI解釋 Feedback、問題回報、分題審批同埋分類審批');
        button.dataset.bound = '1';
        button.addEventListener('click', openFeedbackHub);
        var anchor = document.getElementById('data-checks-btn')
            || document.getElementById('admin-mode-btn');
        if (anchor && anchor.parentNode === host) {
            host.insertBefore(button, anchor.nextSibling);
        } else {
            host.appendChild(button);
        }
        return button;
    }

    function refreshHubButton() {
        var button = ensureHubButton();
        if (!button) return;
        var allowed = hasAdminAccess();
        button.hidden = !allowed;
        if (!allowed) {
            closeFeedbackHub();
            hubState.stagingCacheReady = false;
            refreshQuestionCardStaging();
            updatePendingFlushChip();
            return;
        }
        ensurePendingFlushChip();
        updatePendingFlushChip();
        ensureStagingCache(false).catch(function () {});
    }

    function ensureHubOverlay() {
        if (hubOverlay) return hubOverlay;
        hubOverlay = document.createElement('div');
        hubOverlay.id = 'feedback-hub-overlay';
        hubOverlay.className = 'report-issue-overlay';
        hubOverlay.hidden = true;
        hubOverlay.innerHTML = ''
            + '<div class="report-issue-dialog feedback-hub-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-hub-title">'
            + '  <header class="report-issue-header">'
            + '    <div>'
            + '      <h2 id="feedback-hub-title">審批與回報</h2>'
            + '      <p class="report-issue-subtitle" id="feedback-hub-subtitle">AI解釋評分／Feedback、使用者問題回報、分題提案審批，同埋分類提案審批。</p>'
            + '    </div>'
            + '    <button type="button" class="report-issue-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="feedback-hub-tabs" role="tablist">'
            + '    <button type="button" class="feedback-hub-tab is-active" role="tab" data-hub-tab="issues" aria-selected="true">回報問題</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="ai" aria-selected="false">AI解釋 Feedback</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="parts" aria-selected="false">分題審批</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="classification" aria-selected="false">分類審批</button>'
            + '  </div>'
            + '  <div class="feedback-hub-toolbar">'
            + '    <label class="feedback-hub-filter-label" id="feedback-hub-filter-label" for="feedback-hub-status-filter">狀態</label>'
            + '    <select id="feedback-hub-status-filter" class="feedback-hub-status-filter" aria-label="按狀態篩選">'
            + '      <option value="open">待處理</option>'
            + '      <option value="resolved">已關閉</option>'
            + '      <option value="all">全部</option>'
            + '    </select>'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="feedback-hub-refresh">重新載入</button>'
            + '    <button type="button" class="btn btn-primary btn-sm" id="feedback-hub-bulk-resolve" disabled>標記已關閉</button>'
            + '  </div>'
            + '  <p class="report-issue-status" id="feedback-hub-status" hidden></p>'
            + '  <p class="feedback-hub-paused-banner" id="feedback-hub-class-paused" hidden>分類提案待審已達提醒門檻（≥200）；新題仍可提交，請盡快審批。</p>'
            + '  <div class="feedback-hub-list" id="feedback-hub-list"></div>'
            + '  <footer class="report-issue-footer">'
            + '    <button type="button" class="btn btn-secondary" id="feedback-hub-done">關閉</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(hubOverlay);
        hubOverlay.addEventListener('click', function (event) {
            if (event.target === hubOverlay && shouldCloseOnBackdropClick()) closeFeedbackHub();
        });
        hubOverlay.querySelector('.report-issue-close').addEventListener('click', closeFeedbackHub);
        hubOverlay.querySelector('#feedback-hub-done').addEventListener('click', closeFeedbackHub);
        hubOverlay.querySelector('#feedback-hub-refresh').addEventListener('click', function () {
            loadHubData(true);
        });
        hubOverlay.querySelector('#feedback-hub-status-filter').addEventListener('change', function (event) {
            var value = String(event.target.value || 'open');
            hubState.statusFilter = (value === 'resolved' || value === 'all') ? value : 'open';
            hubState.selected = {};
            renderHubList();
        });
        hubOverlay.querySelector('#feedback-hub-bulk-resolve').addEventListener('click', function () {
            if (hubState.tab === 'parts') bulkApproveParts();
            else if (hubState.tab === 'classification') bulkApproveClassification();
            else bulkMarkResolved();
        });
        hubOverlay.querySelector('.feedback-hub-tabs').addEventListener('click', function (event) {
            var tab = event.target.closest('[data-hub-tab]');
            if (!tab) return;
            var next = String(tab.getAttribute('data-hub-tab') || 'issues');
            if (next !== 'ai' && next !== 'parts' && next !== 'classification') next = 'issues';
            hubState.tab = next;
            hubState.selected = {};
            hubOverlay.querySelectorAll('[data-hub-tab]').forEach(function (btn) {
                var on = btn.getAttribute('data-hub-tab') === hubState.tab;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            syncHubChrome();
            renderHubList();
        });
        hubOverlay.querySelector('#feedback-hub-list').addEventListener('change', function (event) {
            var box = event.target.closest('input[data-hub-select]');
            if (!box) return;
            var id = box.getAttribute('data-hub-select');
            if (!id) return;
            if (box.checked) hubState.selected[id] = true;
            else delete hubState.selected[id];
            syncBulkButton();
        });
        hubOverlay.querySelector('#feedback-hub-list').addEventListener('click', function (event) {
            var resolveBtn = event.target.closest('[data-hub-resolve]');
            if (resolveBtn && !hubState.busy) {
                var resolveId = resolveBtn.getAttribute('data-hub-resolve');
                if (resolveId) markItemsResolved([resolveId]);
                return;
            }
            var deleteBtn = event.target.closest('[data-hub-delete-explanation]');
            if (deleteBtn && !hubState.busy) {
                var qid = deleteBtn.getAttribute('data-hub-qid');
                var eid = deleteBtn.getAttribute('data-hub-delete-explanation');
                if (qid && eid) deleteAiExplanationFromHub(qid, eid);
                return;
            }
            var approveBtn = event.target.closest('[data-parts-approve]');
            if (approveBtn && !hubState.busy) {
                approvePartsProposal(approveBtn.getAttribute('data-parts-approve'));
                return;
            }
            var rejectBtn = event.target.closest('[data-parts-reject]');
            if (rejectBtn && !hubState.busy) {
                rejectPartsProposal(rejectBtn.getAttribute('data-parts-reject'));
                return;
            }
            var classApproveFieldBtn = event.target.closest('[data-class-approve-field]');
            if (classApproveFieldBtn && !hubState.busy) {
                approveClassificationProposal(
                    classApproveFieldBtn.getAttribute('data-class-id'),
                    {
                        approveFields: [classApproveFieldBtn.getAttribute('data-class-approve-field')]
                    }
                );
                return;
            }
            var classKeepFieldBtn = event.target.closest('[data-class-keep-field]');
            if (classKeepFieldBtn && !hubState.busy) {
                rejectClassificationProposal(
                    classKeepFieldBtn.getAttribute('data-class-id'),
                    {
                        rejectFields: [classKeepFieldBtn.getAttribute('data-class-keep-field')]
                    }
                );
                return;
            }
            var classApproveBtn = event.target.closest('[data-class-approve]');
            if (classApproveBtn && !hubState.busy) {
                approveClassificationProposal(classApproveBtn.getAttribute('data-class-approve'));
                return;
            }
            var classRejectBtn = event.target.closest('[data-class-reject]');
            if (classRejectBtn && !hubState.busy) {
                rejectClassificationProposal(classRejectBtn.getAttribute('data-class-reject'));
            }
        });
        return hubOverlay;
    }

    function syncHubChrome() {
        if (!hubOverlay) return;
        var partsMode = hubState.tab === 'parts';
        var classMode = hubState.tab === 'classification';
        var stagingMode = partsMode || classMode;
        var filterLabel = document.getElementById('feedback-hub-filter-label');
        var filter = document.getElementById('feedback-hub-status-filter');
        var bulk = document.getElementById('feedback-hub-bulk-resolve');
        var subtitle = document.getElementById('feedback-hub-subtitle');
        var pausedBanner = document.getElementById('feedback-hub-class-paused');
        if (filterLabel) filterLabel.hidden = stagingMode;
        if (filter) filter.hidden = stagingMode;
        if (bulk) bulk.hidden = false;
        if (subtitle) {
            if (partsMode) {
                subtitle.textContent = '待審批的分題提案（通過會寫入共用題庫；拒絕只移除提案）。';
            } else if (classMode) {
                var n = hubState.classPendingCount || (hubState.classRows || []).length;
                subtitle.textContent = '待審批的分類提案（可逐欄通過／保留原值；通過前可改提案內容）。目前待審：'
                    + n + '／' + (hubState.classPauseThreshold || 200) + '。';
            } else {
                subtitle.textContent = 'AI解釋評分／Feedback、使用者問題回報、分題提案審批，同埋分類提案審批。';
            }
        }
        if (pausedBanner) {
            var showPaused = classMode && (hubState.classPaused
                || (hubState.classPendingCount || 0) >= (hubState.classPauseThreshold || 200));
            pausedBanner.hidden = !showPaused;
        }
        syncBulkButton();
    }

    function closeFeedbackHub() {
        if (!hubOverlay || hubOverlay.hidden) return;
        // Hide immediately — never await flush or block on hubState.flushing.
        // Pending upload continues in the background; chip/toast/beforeunload still apply.
        var shouldFlush = hasUnsyncedPending();
        hideFeedbackHubUi();
        if (shouldFlush) {
            flushPendingOps({ reason: 'hub-close' }).catch(function (err) {
                console.error('[審批同步] hub-close flush failed', err);
            });
        }
    }

    async function openFeedbackHub() {
        if (!hasAdminAccess()) return;
        ensureHubOverlay();
        bindEscape();
        syncBeforeUnloadGuard();
        await loadPendingOpsFromDisk();
        hubOverlay.hidden = false;
        var filter = document.getElementById('feedback-hub-status-filter');
        if (filter) filter.value = hubState.statusFilter || 'open';
        syncHubChrome();
        // Close standalone AI admin if open.
        if (global.AiExplanation && typeof AiExplanation.closeAdminPanel === 'function') {
            AiExplanation.closeAdminPanel();
        }
        await loadHubData(true);
    }

    function setHubBanner(text, kind) {
        var st = document.getElementById('feedback-hub-status');
        if (!st) return;
        st.textContent = String(text || '');
        st.hidden = !text;
        st.className = 'report-issue-status' + (kind ? ' is-' + kind : '');
    }

    async function loadPartsStemMap(rows) {
        var map = {};
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') {
            hubState.partsStemById = map;
            return map;
        }
        try {
            var all = await global.storage.getAllQuestions();
            var want = {};
            (rows || []).forEach(function (row) {
                if (row && row.questionId) want[String(row.questionId)] = true;
            });
            (all || []).forEach(function (q) {
                if (!q || !want[String(q.id || '')]) return;
                var stem = String(q.plainText || q.questionTextChi || q.questionTextEng || '')
                    .replace(/\s+/g, ' ').trim();
                if (stem.length > 120) stem = stem.slice(0, 120) + '…';
                map[String(q.id)] = stem;
            });
        } catch (ignore) {}
        hubState.partsStemById = map;
        return map;
    }

    async function loadClassStemMap(rows) {
        var map = {};
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') {
            hubState.classStemById = map;
            return map;
        }
        try {
            var all = await global.storage.getAllQuestions();
            var want = {};
            (rows || []).forEach(function (row) {
                if (row && row.questionId) want[String(row.questionId)] = true;
            });
            (all || []).forEach(function (q) {
                if (!q || !want[String(q.id || '')]) return;
                var stem = String(q.plainText || q.questionTextChi || q.questionTextEng || '')
                    .replace(/\s+/g, ' ').trim();
                if (stem.length > 120) stem = stem.slice(0, 120) + '…';
                map[String(q.id)] = stem;
            });
        } catch (ignore) {}
        hubState.classStemById = map;
        return map;
    }

    async function loadHubData() {
        if (!hasAdminAccess()) return;
        hubState.loading = true;
        hubState.error = '';
        hubState.selected = {};
        var list = document.getElementById('feedback-hub-list');
        if (list) list.innerHTML = '<p class="report-issue-empty">載入中…</p>';
        setHubBanner('', '');
        try {
            var results = await Promise.all([
                proxyAction({ action: 'listIssueReports' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                }),
                proxyAction({ action: 'listAiExplanationFeedback' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                }),
                proxyAction({ action: 'listQuestionPartsProposals' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                }),
                proxyAction({ action: 'listClassificationProposals' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                })
            ]);
            var issues = results[0];
            var ai = results[1];
            var parts = results[2];
            var klass = results[3];
            hubState.issues = (issues && issues.ok && Array.isArray(issues.rows)) ? issues.rows : [];
            hubState.aiRows = (ai && ai.ok && Array.isArray(ai.rows)) ? ai.rows : [];
            hubState.partsRows = (parts && parts.ok && Array.isArray(parts.rows)) ? parts.rows : [];
            hubState.classRows = (klass && klass.ok && Array.isArray(klass.rows)) ? klass.rows : [];
            hubState.classPendingCount = (klass && typeof klass.pendingCount === 'number')
                ? klass.pendingCount
                : hubState.classRows.length;
            hubState.classPauseThreshold = (klass && typeof klass.pauseThreshold === 'number')
                ? klass.pauseThreshold
                : 200;
            hubState.classPaused = !!(klass && klass.paused === true)
                || hubState.classPendingCount >= hubState.classPauseThreshold;
            await loadPartsStemMap(hubState.partsRows);
            await loadClassStemMap(hubState.classRows);
            if ((!issues || issues.ok !== true)
                && (!ai || ai.ok !== true)
                && (!parts || parts.ok !== true)
                && (!klass || klass.ok !== true)) {
                hubState.error = errorMessage(
                    (issues && issues.error) || (ai && ai.error)
                    || (parts && parts.error) || (klass && klass.error)
                );
            } else {
                hubState.error = '';
            }
        } catch (err) {
            hubState.issues = [];
            hubState.aiRows = [];
            hubState.partsRows = [];
            hubState.classRows = [];
            hubState.classPendingCount = 0;
            hubState.classPaused = false;
            hubState.error = errorMessage(err && err.code);
        } finally {
            hubState.loading = false;
            hubState.stagingCacheReady = true;
            applyPendingOpsToLoadedRows();
            syncHubChrome();
            renderHubList();
            updatePendingChrome();
            refreshQuestionCardStaging();
            maybeRefreshPendingStagingFilter();
        }
    }

    function filteredRows() {
        if (hubState.tab === 'parts') return (hubState.partsRows || []).slice();
        if (hubState.tab === 'classification') return (hubState.classRows || []).slice();
        var source = hubState.tab === 'ai' ? (hubState.aiRows || []) : (hubState.issues || []);
        var filter = hubState.statusFilter || 'open';
        if (filter === 'all') return source.slice();
        return source.filter(function (row) {
            return normalizeStatus(row && row.status) === filter;
        });
    }

    function formatPartsPreview(parts) {
        if (!Array.isArray(parts) || !parts.length) return '（無分題）';
        return parts.map(function (part) {
            var label = String(part && part.label != null ? part.label : '').trim() || '?';
            var marks = part && part.marks != null && part.marks !== '' ? String(part.marks) : '—';
            var perf = String(part && part.performance || '').trim();
            return label + ',' + marks + (perf ? ',' + perf : '');
        }).join(' | ');
    }

    function findPartsRow(proposalId) {
        var id = String(proposalId || '');
        var rows = hubState.partsRows || [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && String(rows[i].id) === id) return rows[i];
        }
        return null;
    }

    async function applyApprovedPartsLocally(questionSnap) {
        if (!questionSnap || !questionSnap.questionId) return;
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') return;
        if (typeof global.applyPartsFields !== 'function'
            || typeof global.storage.updateQuestion !== 'function') {
            return;
        }
        try {
            var all = await global.storage.getAllQuestions();
            var qid = String(questionSnap.questionId);
            var live = null;
            for (var i = 0; i < (all || []).length; i++) {
                if (all[i] && String(all[i].id) === qid) {
                    live = all[i];
                    break;
                }
            }
            if (!live) return;
            global.applyPartsFields(live, questionSnap.questionParts || [], 'filled');
            await global.storage.updateQuestion(live);
            if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
            if (typeof renderQuestions === 'function') renderQuestions();
        } catch (ignore) {}
    }

    function syncBulkButton() {
        var btn = document.getElementById('feedback-hub-bulk-resolve');
        if (!btn) return;
        var n = Object.keys(hubState.selected).length;
        var locked = hubState.busy || hubState.flushing || anyStagingInFlight();
        if (hubState.tab === 'parts' || hubState.tab === 'classification') {
            var total = hubState.tab === 'parts'
                ? (hubState.partsRows || []).length
                : (hubState.classRows || []).length;
            if (n > 0) {
                btn.disabled = locked;
                btn.textContent = '通過選中（' + n + '）';
            } else {
                btn.disabled = locked || total === 0;
                btn.textContent = '通過全部';
            }
            return;
        }
        btn.disabled = locked || n === 0;
        btn.textContent = n ? ('標記已關閉（' + n + '）') : '標記已關閉';
    }

    function renderHubList() {
        var list = document.getElementById('feedback-hub-list');
        if (!list) return;
        if (hubState.loading) {
            list.innerHTML = '<p class="report-issue-empty">載入中…</p>';
            syncBulkButton();
            return;
        }
        if (hubState.error) {
            list.innerHTML = '';
            setHubBanner(hubState.error, 'error');
            syncBulkButton();
            return;
        }
        if (!hasUnsyncedPending() || hubState.flushing) {
            setHubBanner('', '');
        }
        var rows = filteredRows();
        if (!rows.length) {
            var emptyMsg = '尚未有符合條件的項目。';
            if (hubState.tab === 'parts') {
                emptyMsg = '沒有待審批的分題提案。';
            } else if (hubState.tab === 'classification') {
                emptyMsg = '沒有待審批的分類提案。';
            } else if (hubState.tab === 'ai') {
                emptyMsg = hubState.statusFilter === 'open'
                    ? '沒有待處理的 AI解釋 Feedback。'
                    : '尚未有符合條件的 AI解釋 Feedback。';
            } else {
                emptyMsg = hubState.statusFilter === 'open'
                    ? '沒有待處理的問題回報。'
                    : '尚未有符合條件的問題回報。';
            }
            list.innerHTML = '<p class="report-issue-empty">' + emptyMsg + '</p>';
            syncBulkButton();
            return;
        }
        if (hubState.tab === 'parts') {
            list.innerHTML = rows.map(function (row) {
                var id = String(row.id || '');
                var qid = String(row.questionId || '');
                var stem = hubState.partsStemById[qid] || '';
                var preview = formatPartsPreview(row.questionParts);
                var checked = hubState.selected[id] ? ' checked' : '';
                var metaBits = [];
                if (row.source) metaBits.push(esc(row.source));
                if (row.proposedBy) metaBits.push(esc(row.proposedBy));
                if (row.proposedAt) metaBits.push(esc(formatWhen(row.proposedAt)));
                return ''
                    + '<article class="feedback-hub-row" data-parts-id="' + esc(id) + '">'
                    + '  <div class="feedback-hub-meta">'
                    + (id ? '    <label class="feedback-hub-select"><input type="checkbox" data-hub-select="'
                        + esc(id) + '"' + checked + '> 選取</label>' : '')
                    + '    <strong>' + esc(qid) + '</strong>'
                    + '    <span class="feedback-hub-pill">分題提案</span>'
                    + metaBits.map(function (bit) {
                        return '    <span>' + bit + '</span>';
                    }).join('')
                    + '  </div>'
                    + (stem ? '  <p class="feedback-hub-snippet">' + esc(stem) + '</p>' : '')
                    + '  <p class="feedback-hub-text"><code class="feedback-hub-parts-preview">'
                    + esc(preview) + '</code></p>'
                    + (row.note ? '  <p class="feedback-hub-text">' + esc(row.note) + '</p>' : '')
                    + '  <div class="feedback-hub-meta">'
                    + '    <button type="button" class="btn btn-primary btn-sm" data-parts-approve="'
                    + esc(id) + '"' + (isStagingInFlight('parts', id) ? ' disabled' : '')
                    + '>通過</button>'
                    + '    <button type="button" class="btn btn-outline-danger btn-sm" data-parts-reject="'
                    + esc(id) + '"' + (isStagingInFlight('parts', id) ? ' disabled' : '')
                    + '>拒絕</button>'
                    + '  </div>'
                    + '</article>';
            }).join('');
            syncBulkButton();
            return;
        }
        if (hubState.tab === 'classification') {
            list.innerHTML = rows.map(function (row) {
                var id = String(row.id || '');
                var qid = String(row.questionId || '');
                var stem = hubState.classStemById[qid] || '';
                var fields = Array.isArray(row.fields) ? row.fields : [];
                var current = row.currentValues || {};
                var proposed = row.proposedValues || {};
                var fieldBlocks = fields.map(function (field) {
                    var label = classFieldLabel(field);
                    var kind = classFieldKind(field);
                    var meta = classFieldMeta(field);
                    var proposedVal = proposed[field];
                    var isClear = classValueIsEmpty(field, proposedVal);
                    var clearPill = isClear
                        ? ' <span class="feedback-hub-class-pill is-clear" title="通過此欄會清空題庫該欄">清空</span>'
                        : '';
                    var blankPill = meta && meta.blankOnly
                        ? ' <span class="feedback-hub-class-pill is-blank-only" title="僅當題庫此欄空白時可寫入">空白才寫</span>'
                        : '';
                    var editText = classValueToEditText(field, proposedVal);
                    var placeholder = kind === 'parts'
                        ? 'a,2,良好 | b,3,優良；留空＝通過時清空'
                        : (kind === 'scalar'
                            ? '單一值；留空＝通過時清空'
                            : '逗號分隔；留空＝通過時清空');
                    var inputTag = kind === 'parts'
                        ? ('<textarea class="feedback-hub-class-input feedback-hub-class-textarea" rows="2"'
                            + ' data-class-edit-field="' + esc(field) + '" placeholder="'
                            + esc(placeholder) + '">' + esc(editText) + '</textarea>')
                        : ('<input type="text" class="feedback-hub-class-input" data-class-edit-field="'
                            + esc(field) + '" value="' + esc(editText)
                            + '" placeholder="' + esc(placeholder) + '" autocomplete="off">');
                    var currentFilled = !classValueIsEmpty(field, current[field]);
                    var approveDisabled = meta && meta.blankOnly && currentFilled;
                    var rowBusy = isStagingInFlight('class', id);
                    var approveBtn = (approveDisabled || rowBusy)
                        ? ('<button type="button" class="btn btn-primary btn-sm" disabled'
                            + (approveDisabled
                                ? ' title="題庫此欄已有值（空白才可寫入）"'
                                : ' title="處理中…"')
                            + '>通過此欄</button>')
                        : ('<button type="button" class="btn btn-primary btn-sm" data-class-id="'
                            + esc(id) + '" data-class-approve-field="' + esc(field) + '">通過此欄</button>');
                    return ''
                        + '<div class="feedback-hub-class-field" data-class-field="' + esc(field) + '"'
                        + ' data-class-kind="' + esc(kind) + '">'
                        + '  <div class="feedback-hub-class-field-head">'
                        + '    <strong>' + esc(label) + '</strong>' + clearPill + blankPill
                        + '  </div>'
                        + '  <div class="feedback-hub-class-diff">'
                        + '    <span class="feedback-hub-class-label">現有</span>'
                        + '    <code>' + esc(formatClassList(current[field])) + '</code>'
                        + '  </div>'
                        + '  <div class="feedback-hub-class-diff feedback-hub-class-edit">'
                        + '    <span class="feedback-hub-class-label">提案</span>'
                        + '    ' + inputTag
                        + '  </div>'
                        + '  <div class="feedback-hub-class-field-actions">'
                        + '    ' + approveBtn
                        + '    <button type="button" class="btn btn-secondary btn-sm" data-class-id="'
                        + esc(id) + '" data-class-keep-field="' + esc(field) + '"'
                        + (rowBusy ? ' disabled' : '')
                        + ' title="不寫入題庫，只從提案移除此欄">保留原值</button>'
                        + '  </div>'
                        + '</div>';
                }).join('');
                var checked = hubState.selected[id] ? ' checked' : '';
                var metaBits = [];
                if (row.confidence) metaBits.push('信心：' + esc(row.confidence));
                if (row.createdBy) metaBits.push(esc(row.createdBy));
                if (row.createdAt) metaBits.push(esc(formatWhen(row.createdAt)));
                return ''
                    + '<article class="feedback-hub-row" data-class-id="' + esc(id) + '">'
                    + '  <div class="feedback-hub-meta">'
                    + (id ? '    <label class="feedback-hub-select"><input type="checkbox" data-hub-select="'
                        + esc(id) + '"' + checked + '> 選取</label>' : '')
                    + '    <strong>' + esc(qid) + '</strong>'
                    + '    <span class="feedback-hub-pill">分類提案</span>'
                    + metaBits.map(function (bit) {
                        return '    <span>' + bit + '</span>';
                    }).join('')
                    + '  </div>'
                    + (stem ? '  <p class="feedback-hub-snippet">' + esc(stem) + '</p>' : '')
                    + fieldBlocks
                    + (row.reason ? '  <p class="feedback-hub-text">理由：' + esc(row.reason) + '</p>' : '')
                    + '  <div class="feedback-hub-meta">'
                    + '    <button type="button" class="btn btn-primary btn-sm" data-class-approve="'
                    + esc(id) + '"' + (isStagingInFlight('class', id) ? ' disabled' : '')
                    + '>通過全部欄位</button>'
                    + '    <button type="button" class="btn btn-outline-danger btn-sm" data-class-reject="'
                    + esc(id) + '"' + (isStagingInFlight('class', id) ? ' disabled' : '')
                    + ' title="不寫入題庫，整筆提案移除">全部保留原值</button>'
                    + '  </div>'
                    + '</article>';
            }).join('');
            syncBulkButton();
            return;
        }
        if (hubState.tab === 'ai') {
            list.innerHTML = rows.map(function (row) {
                var id = String(row.id || '');
                var rating = row.rating === 'up' ? '👍' : (row.rating === 'down' ? '👎' : '—');
                var level = row.detailLevel === 'detailed' ? '詳盡' : '簡短';
                var status = normalizeStatus(row.status);
                var checked = hubState.selected[id] ? ' checked' : '';
                var resolveBtn = status === STATUS_OPEN && id
                    ? '<button type="button" class="btn btn-outline-primary btn-sm" data-hub-resolve="'
                        + esc(id) + '">標記已關閉</button>'
                    : '';
                var deleteBtn = row.questionId && row.explanationId
                    ? '<button type="button" class="btn btn-outline-danger btn-sm" data-hub-delete-explanation="'
                        + esc(row.explanationId) + '" data-hub-qid="' + esc(row.questionId)
                        + '" title="刪除此則 AI解釋（含其 Feedback）">刪除解釋</button>'
                    : '';
                return ''
                    + '<article class="feedback-hub-row" data-status="' + esc(status) + '">'
                    + '  <div class="feedback-hub-meta">'
                    + (id ? '    <label class="feedback-hub-select"><input type="checkbox" data-hub-select="'
                        + esc(id) + '"' + checked + '> 選取</label>' : '')
                    + '    <span class="feedback-hub-pill feedback-hub-status-pill is-' + esc(status) + '">'
                    + esc(row.statusLabel || statusLabel(status)) + '</span>'
                    + '    <strong>' + esc(row.questionId || '') + '</strong>'
                    + '    <span>' + esc(level) + '</span>'
                    + '    <span>' + esc(row.model || '') + '</span>'
                    + '    <span>👍' + esc(String(row.upCount || 0)) + ' 👎' + esc(String(row.downCount || 0)) + '</span>'
                    + '  </div>'
                    + '  <p class="feedback-hub-snippet">' + esc(row.explanationSnippet || '') + '</p>'
                    + '  <div class="feedback-hub-meta">'
                    + '    <span>' + rating + '</span>'
                    + '    <span>' + esc(row.user || '') + '</span>'
                    + '    <span>' + esc(formatWhen(row.at)) + '</span>'
                    + resolveBtn
                    + deleteBtn
                    + '  </div>'
                    + '  <p class="feedback-hub-text">' + esc(row.text || '') + '</p>'
                    + '</article>';
            }).join('');
            syncBulkButton();
            return;
        }
        list.innerHTML = rows.map(function (row) {
            var id = String(row.id || '');
            var status = normalizeStatus(row.status);
            var labels = Array.isArray(row.tagLabels) && row.tagLabels.length
                ? row.tagLabels
                : (Array.isArray(row.tags) ? row.tags : []);
            var chips = labels.map(function (label) {
                return '<span class="feedback-hub-pill">' + esc(label) + '</span>';
            }).join('');
            var checked = hubState.selected[id] ? ' checked' : '';
            var resolveBtn = status === STATUS_OPEN && id
                ? '<button type="button" class="btn btn-outline-primary btn-sm" data-hub-resolve="'
                    + esc(id) + '">標記已關閉</button>'
                : '';
            return ''
                + '<article class="feedback-hub-row" data-status="' + esc(status) + '">'
                + '  <div class="feedback-hub-meta">'
                + (id ? '    <label class="feedback-hub-select"><input type="checkbox" data-hub-select="'
                    + esc(id) + '"' + checked + '> 選取</label>' : '')
                + '    <span class="feedback-hub-pill feedback-hub-status-pill is-' + esc(status) + '">'
                + esc(row.statusLabel || statusLabel(status)) + '</span>'
                + '    <strong>' + esc(row.questionId || '') + '</strong>'
                + '    <span>' + esc(row.user || '') + '</span>'
                + '    <span>' + esc(formatWhen(row.createdAt)) + '</span>'
                + resolveBtn
                + '  </div>'
                + '  <div class="feedback-hub-meta">' + chips + '</div>'
                + '  <p class="feedback-hub-text">' + esc(row.text || '（無補充說明）') + '</p>'
                + '</article>';
        }).join('');
        syncBulkButton();
    }

    function applyLocalStatus(ids, status) {
        var set = {};
        (ids || []).forEach(function (id) { set[String(id)] = true; });
        function patch(list) {
            (list || []).forEach(function (row) {
                if (!row || !set[String(row.id || '')]) return;
                row.status = status;
                row.statusLabel = statusLabel(status);
            });
        }
        patch(hubState.issues);
        patch(hubState.aiRows);
    }

    async function markItemsResolved(ids) {
        if (hubState.busy) return;
        var list = (ids || []).map(function (id) { return String(id || '').trim(); }).filter(Boolean);
        if (!list.length) return;
        hubState.busy = true;
        syncBulkButton();
        setHubBanner('更新狀態中…', 'info');
        try {
            var action = hubState.tab === 'ai'
                ? 'bulkUpdateAiExplanationFeedbackStatus'
                : 'bulkUpdateIssueReportStatus';
            var data = await proxyAction({
                action: action,
                ids: list,
                status: STATUS_RESOLVED
            }, 60000);
            if (!data || data.ok !== true) {
                setHubBanner(errorMessage(data && data.error), 'error');
                return;
            }
            applyLocalStatus(list, STATUS_RESOLVED);
            list.forEach(function (id) { delete hubState.selected[id]; });
            setHubBanner('已標記 ' + list.length + ' 項為已關閉。', 'ok');
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
    }

    async function approvePartsProposal(proposalId) {
        if (!hasAdminAccess() || hubState.flushing) return;
        var row = findPartsRow(proposalId);
        if (!row) return;
        var actionId = String(row.id || '');
        if (!actionId) return;
        // Same proposal already queued for remove → ignore.
        var already = (hubState.pendingOps || []).some(function (op) {
            return op && op.kind === 'parts' && String(op.proposalId) === actionId;
        });
        if (already) {
            setHubBanner('此提案已在本機待同步佇列。', 'warn');
            return;
        }

        var confirmOverwrite = false;
        var live = await lookupLocalQuestion(row.questionId);
        if (bankHasFilledPartsLocal(live)) {
            var currentPreview = formatPartsPreview(live && live.questionParts);
            var proposedPreview = formatPartsPreview(row.questionParts);
            var ok = global.confirm
                ? global.confirm(
                    '題目「' + String(row.questionId || '') + '」已有分題。確定覆寫？\n\n'
                    + '現有：' + currentPreview + '\n'
                    + '提案：' + proposedPreview
                    + '\n\n（會先記在本機，關閉審批視窗時才同步雲端）'
                )
                : false;
            if (!ok) {
                setHubBanner('已取消覆寫。', 'warn');
                return;
            }
            confirmOverwrite = true;
        }

        var bankSnap = {
            questionId: String(row.questionId || ''),
            questionParts: Array.isArray(row.questionParts) ? row.questionParts.slice() : []
        };
        var undoBankSnap = {
            questionId: String(row.questionId || ''),
            questionParts: live && Array.isArray(live.questionParts)
                ? cloneJson(live.questionParts)
                : [],
            partsStatus: live
                ? String(live.partsStatus || (bankHasFilledPartsLocal(live) ? 'filled' : 'none'))
                : 'none'
        };
        enqueuePendingOp({
            kind: 'parts',
            op: 'approve',
            proposalId: actionId,
            questionId: String(row.questionId || ''),
            confirmOverwrite: confirmOverwrite,
            bankSnap: bankSnap,
            undoBankSnap: undoBankSnap,
            proposalSnap: cloneJson(row)
        });
        hubState.partsRows = (hubState.partsRows || []).filter(function (item) {
            return !(item && String(item.id) === actionId);
        });
        delete hubState.selected[actionId];
        scheduleLocalBankApply(applyApprovedPartsLocally(bankSnap));
        setHubBanner(
            '已通過（本機）：' + String(row.questionId || '') + ' — 關閉視窗時同步雲端',
            'ok'
        );
        syncBulkButton();
        renderHubList();
        updatePendingChrome();
        refreshQuestionCardStaging();
        maybeRefreshPendingStagingFilter();
    }

    async function rejectPartsProposal(proposalId) {
        if (!hasAdminAccess() || hubState.flushing) return;
        var row = findPartsRow(proposalId);
        if (!row) return;
        var ok = global.confirm
            ? global.confirm(
                '拒絕題目「' + String(row.questionId || '') + '」的分題提案？'
                + '提案會在關閉視窗同步後從暫存移除，不會改題庫。'
            )
            : true;
        if (!ok) return;
        var actionId = String(row.id || '');
        if (!actionId) return;
        var already = (hubState.pendingOps || []).some(function (op) {
            return op && op.kind === 'parts' && String(op.proposalId) === actionId;
        });
        if (already) {
            setHubBanner('此提案已在本機待同步佇列。', 'warn');
            return;
        }
        enqueuePendingOp({
            kind: 'parts',
            op: 'reject',
            proposalId: actionId,
            questionId: String(row.questionId || ''),
            proposalSnap: cloneJson(row)
        });
        hubState.partsRows = (hubState.partsRows || []).filter(function (item) {
            return !(item && String(item.id) === actionId);
        });
        delete hubState.selected[actionId];
        setHubBanner(
            '已拒絕（本機）：' + String(row.questionId || '') + ' — 關閉視窗時同步雲端',
            'ok'
        );
        syncBulkButton();
        renderHubList();
        updatePendingChrome();
        refreshQuestionCardStaging();
        maybeRefreshPendingStagingFilter();
    }

    async function deleteAiExplanationFromHub(questionId, explanationId) {
        if (hubState.busy || !hasAdminAccess()) return;
        var qid = String(questionId || '').trim();
        var eid = String(explanationId || '').trim();
        if (!qid || !eid) return;
        var ok = global.confirm
            ? global.confirm('確定刪除此則 AI解釋？刪除後無法復原（該解釋下的 Feedback 一併移除）。')
            : true;
        if (!ok) return;
        hubState.busy = true;
        syncBulkButton();
        setHubBanner('正在刪除解釋…', 'info');
        try {
            var data = await proxyAction({
                action: 'deleteAiExplanation',
                questionId: qid,
                explanationId: eid
            }, 60000);
            if (!data || data.ok !== true) {
                setHubBanner(errorMessage(data && data.error), 'error');
                return;
            }
            if (global.AiExplanation && typeof AiExplanation.applyDeletedExplanation === 'function') {
                AiExplanation.applyDeletedExplanation(
                    data.questionId || qid,
                    data.deletedId || eid,
                    Array.isArray(data.explanations) ? data.explanations : null
                );
            }
            // Drop hub rows that pointed at the deleted explanation.
            hubState.aiRows = (hubState.aiRows || []).filter(function (row) {
                return !(row && String(row.questionId || '') === qid
                    && String(row.explanationId || '') === eid);
            });
            Object.keys(hubState.selected).forEach(function (id) {
                var still = hubState.aiRows.some(function (row) {
                    return row && String(row.id || '') === String(id);
                });
                if (!still) delete hubState.selected[id];
            });
            setHubBanner('已刪除該則 AI解釋。', 'ok');
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
    }


    function formatClassList(values) {
        if (Array.isArray(values)) {
            if (!values.length) return '（空）';
            // questionParts objects
            if (values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) {
                return formatPartsPreview(values);
            }
            return values.map(function (item) { return String(item == null ? '' : item).trim(); })
                .filter(Boolean).join(' ｜ ');
        }
        if (values == null || values === '') return '（空）';
        return String(values);
    }

    function classValueToEditText(field, value) {
        var kind = classFieldKind(field);
        if (kind === 'parts') {
            return formatPartsPreview(Array.isArray(value) ? value : []);
        }
        if (kind === 'scalar') {
            return value == null ? '' : String(value);
        }
        if (!Array.isArray(value) || !value.length) return '';
        return value.map(function (item) { return String(item == null ? '' : item).trim(); })
            .filter(Boolean).join(', ');
    }

    function parseClassEditText(field, text) {
        var kind = classFieldKind(field);
        var raw = String(text == null ? '' : text).trim();
        if (kind === 'scalar') return raw;
        if (kind === 'parts') {
            if (!raw || raw === '（無分題）' || raw === '（空）') return [];
            // Compact: a,2,良好 | b,3,優良  OR JSON array
            if (raw.charAt(0) === '[') {
                try {
                    var parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (ignore) {
                    return [];
                }
            }
            return raw.split(/\s*\|\s*/).map(function (chunk) {
                var bits = chunk.split(',').map(function (b) { return b.trim(); });
                var marks = bits[1] !== undefined && bits[1] !== '' && bits[1] !== '—'
                    ? Number(bits[1]) : null;
                if (marks !== null && !isFinite(marks)) marks = null;
                return {
                    label: bits[0] || '',
                    marks: marks,
                    performance: bits[2] || ''
                };
            }).filter(function (p) { return p.label || p.marks !== null || p.performance; });
        }
        if (!raw) return [];
        return raw.split(/[,，|｜]/).map(function (item) { return item.trim(); }).filter(Boolean);
    }

    function classValueIsEmpty(field, value) {
        var kind = classFieldKind(field);
        if (kind === 'scalar') return !String(value == null ? '' : value).trim();
        if (kind === 'parts') return !Array.isArray(value) || !value.length;
        return !Array.isArray(value) || !value.length;
    }

    function readClassEditsFromDom(proposalId) {
        var article = hubOverlay && hubOverlay.querySelector(
            '.feedback-hub-row[data-class-id="' + String(proposalId || '').replace(/"/g, '') + '"]'
        );
        var values = {};
        if (!article) return values;
        article.querySelectorAll('[data-class-edit-field]').forEach(function (input) {
            var field = input.getAttribute('data-class-edit-field');
            if (!isAllowedClassField(field)) return;
            values[field] = parseClassEditText(field, input.value);
        });
        return values;
    }

    function applyClassProposalRemaining(proposalId, remaining) {
        var id = String(proposalId || '');
        if (!id) return;
        if (!remaining || !Array.isArray(remaining.fields) || !remaining.fields.length) {
            hubState.classRows = (hubState.classRows || []).filter(function (item) {
                return !(item && String(item.id) === id);
            });
            delete hubState.selected[id];
        } else {
            hubState.classRows = (hubState.classRows || []).map(function (item) {
                if (!item || String(item.id) !== id) return item;
                return remaining;
            });
        }
        hubState.classPendingCount = (hubState.classRows || []).length;
        hubState.classPaused = hubState.classPendingCount >= (hubState.classPauseThreshold || 200);
    }

    function findClassRow(proposalId) {
        var id = String(proposalId || '');
        var rows = hubState.classRows || [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] && String(rows[i].id) === id) return rows[i];
        }
        return null;
    }

    async function applyApprovedClassificationLocally(questionSnap) {
        if (!questionSnap || !questionSnap.questionId) return;
        if (!global.storage || typeof global.storage.getAllQuestions !== 'function') return;
        if (typeof global.storage.updateQuestion !== 'function') return;
        try {
            var all = await global.storage.getAllQuestions();
            var qid = String(questionSnap.questionId);
            var live = null;
            for (var i = 0; i < (all || []).length; i++) {
                if (all[i] && String(all[i].id) === qid) {
                    live = all[i];
                    break;
                }
            }
            if (!live) return;
            var values = questionSnap.values || {};
            var fields = Array.isArray(questionSnap.fields) ? questionSnap.fields : Object.keys(values);
            fields.forEach(function (field) {
                if (!isAllowedClassField(field)) return;
                var kind = classFieldKind(field);
                if (kind === 'parts') {
                    if (typeof global.applyPartsFields === 'function') {
                        global.applyPartsFields(
                            live,
                            Array.isArray(values[field]) ? values[field] : [],
                            Array.isArray(values[field]) && values[field].length ? 'filled' : 'none'
                        );
                    } else {
                        live.questionParts = Array.isArray(values[field]) ? values[field].slice() : [];
                        live.partsStatus = live.questionParts.length ? 'filled' : 'none';
                    }
                    return;
                }
                if (kind === 'scalar') {
                    live[field] = values[field] == null ? '' : String(values[field]);
                    return;
                }
                live[field] = Array.isArray(values[field]) ? values[field].slice() : [];
            });
            await global.storage.updateQuestion(live);
            if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
            if (typeof renderQuestions === 'function') renderQuestions();
        } catch (ignore) {}
    }

    function formatClassConfirmPreview(snap) {
        if (!snap) return '（無）';
        var values = snap.values || {};
        var fields = Array.isArray(snap.fields) ? snap.fields : Object.keys(values);
        return fields.map(function (field) {
            return classFieldLabel(field) + '：' + formatClassList(values[field]);
        }).join('\n');
    }

    async function approveClassificationProposal(proposalId, options) {
        if (!hasAdminAccess() || hubState.flushing) return;
        var row = findClassRow(proposalId);
        if (!row) return;
        options = options || {};
        var edits = readClassEditsFromDom(row.id);
        var approveFields = Array.isArray(options.approveFields) && options.approveFields.length
            ? options.approveFields.filter(function (f) {
                return isAllowedClassField(f);
            })
            : (Array.isArray(row.fields) ? row.fields.slice() : []);
        var skippedBlank = [];
        approveFields = approveFields.filter(function (field) {
            var meta = classFieldMeta(field);
            if (!meta || !meta.blankOnly) return true;
            var cur = row.currentValues && row.currentValues[field];
            if (!classValueIsEmpty(field, cur)) {
                skippedBlank.push(classFieldLabel(field));
                return false;
            }
            return true;
        });
        if (!approveFields.length) {
            setHubBanner(
                skippedBlank.length
                    ? ('空白才可寫入的欄位在題庫已有值，已略過：' + skippedBlank.join('、'))
                    : '沒有可通過的欄位。',
                'warn'
            );
            return;
        }
        if (skippedBlank.length) {
            setHubBanner('已略過非空白欄位：' + skippedBlank.join('、'), 'warn');
        }
        var values = {};
        approveFields.forEach(function (field) {
            if (Object.prototype.hasOwnProperty.call(edits, field)) {
                values[field] = edits[field];
            } else if (row.proposedValues && Object.prototype.hasOwnProperty.call(row.proposedValues, field)) {
                var pv = row.proposedValues[field];
                var kind = classFieldKind(field);
                if (kind === 'scalar') {
                    values[field] = pv == null ? '' : String(pv);
                } else if (kind === 'parts') {
                    values[field] = Array.isArray(pv) ? pv.slice() : [];
                } else {
                    values[field] = Array.isArray(pv) ? pv.slice() : [];
                }
            } else {
                values[field] = classFieldKind(field) === 'scalar' ? '' : [];
            }
        });
        var clearFields = approveFields.filter(function (field) {
            return classValueIsEmpty(field, values[field]);
        });
        if (clearFields.length) {
            var clearLabels = clearFields.map(classFieldLabel).join('、');
            var clearOk = global.confirm
                ? global.confirm(
                    '題目「' + String(row.questionId || '') + '」的「' + clearLabels
                    + '」通過後會清空題庫該欄。確定？'
                )
                : true;
            if (!clearOk) {
                setHubBanner('已取消清空。', 'warn');
                return;
            }
        }

        var live = await lookupLocalQuestion(row.questionId);
        var confirmOverwrite = false;
        if (classNeedsOverwriteLocal(live, approveFields, row.currentValues || {})) {
            var currentPreview = approveFields.map(function (field) {
                return classFieldLabel(field) + '：'
                    + formatClassList((row.currentValues || {})[field]);
            }).join('\n');
            var proposedPreview = approveFields.map(function (field) {
                return classFieldLabel(field) + '：' + formatClassList(values[field]);
            }).join('\n');
            var overwriteOk = global.confirm
                ? global.confirm(
                    '題目「' + String(row.questionId || '') + '」已有分類或 reviewedByAI=Y。確定覆寫？\n\n'
                    + '現有：\n' + currentPreview + '\n\n'
                    + '將寫入：\n' + proposedPreview
                    + '\n\n（會先記在本機，關閉審批視窗時才同步雲端）'
                )
                : false;
            if (!overwriteOk) {
                setHubBanner('已取消覆寫。', 'warn');
                return;
            }
            confirmOverwrite = true;
        }

        var actionId = String(row.id || '');
        var remaining = computeClassRemaining(row, approveFields);
        // Also update proposedValues on remaining for edited-but-not-approved fields
        if (remaining) {
            Object.keys(edits).forEach(function (field) {
                if (remaining.fields.indexOf(field) >= 0) {
                    remaining.proposedValues[field] = edits[field];
                }
            });
        }
        var bankSnap = {
            questionId: String(row.questionId || ''),
            fields: approveFields.slice(),
            values: values
        };
        var undoValues = {};
        approveFields.forEach(function (field) {
            if (live && Object.prototype.hasOwnProperty.call(live, field)) {
                undoValues[field] = cloneJson(live[field]);
            } else if (row.currentValues && Object.prototype.hasOwnProperty.call(row.currentValues, field)) {
                undoValues[field] = cloneJson(row.currentValues[field]);
            } else {
                undoValues[field] = classFieldKind(field) === 'list' ? [] : '';
            }
        });
        var undoBankSnap = {
            questionId: String(row.questionId || ''),
            fields: approveFields.slice(),
            values: undoValues
        };
        enqueuePendingOp({
            kind: 'class',
            op: 'approve',
            proposalId: actionId,
            questionId: String(row.questionId || ''),
            approveFields: approveFields.slice(),
            values: values,
            confirmOverwrite: confirmOverwrite,
            proposalRemaining: remaining,
            bankSnap: bankSnap,
            undoBankSnap: undoBankSnap,
            proposalSnap: cloneJson(row)
        });
        applyClassProposalRemaining(actionId, remaining);
        scheduleLocalBankApply(applyApprovedClassificationLocally(bankSnap));
        var fieldNote = approveFields.length
            ? '（' + approveFields.map(classFieldLabel).join('、') + '）'
            : '';
        setHubBanner(
            '已通過（本機）：' + String(row.questionId || '') + fieldNote + ' — 關閉視窗時同步雲端',
            'ok'
        );
        syncBulkButton();
        syncHubChrome();
        renderHubList();
        updatePendingChrome();
        refreshQuestionCardStaging();
        maybeRefreshPendingStagingFilter();
    }

    async function rejectClassificationProposal(proposalId, options) {
        if (!hasAdminAccess() || hubState.flushing) return;
        var row = findClassRow(proposalId);
        if (!row) return;
        options = options || {};
        var rejectFields = Array.isArray(options.rejectFields) && options.rejectFields.length
            ? options.rejectFields.filter(function (f) {
                return isAllowedClassField(f);
            })
            : [];
        var partial = rejectFields.length > 0;
        var label = partial
            ? rejectFields.map(classFieldLabel).join('、')
            : '全部欄位';
        var ok = global.confirm
            ? global.confirm(
                partial
                    ? '保留題目「' + String(row.questionId || '') + '」的「' + label
                        + '」原值？該欄會從提案移除（關閉視窗時同步），不會改題庫。'
                    : '全部保留原值並移除題目「' + String(row.questionId || '')
                        + '」的分類提案？（關閉視窗時同步）不會改題庫。'
            )
            : true;
        if (!ok) return;
        var actionId = String(row.id || '');
        var remaining = partial ? computeClassRemaining(row, rejectFields) : null;
        enqueuePendingOp({
            kind: 'class',
            op: 'reject',
            proposalId: actionId,
            questionId: String(row.questionId || ''),
            rejectFields: partial ? rejectFields.slice() : [],
            proposalRemaining: remaining,
            proposalSnap: cloneJson(row)
        });
        applyClassProposalRemaining(actionId, remaining);
        setHubBanner(
            partial
                ? '已保留原值（本機）：' + String(row.questionId || '') + '（' + label + '）— 關閉視窗時同步雲端'
                : '已全部保留原值（本機）：' + String(row.questionId || '') + ' — 關閉視窗時同步雲端',
            'ok'
        );
        syncBulkButton();
        syncHubChrome();
        renderHubList();
        updatePendingChrome();
        refreshQuestionCardStaging();
        maybeRefreshPendingStagingFilter();
    }

    async function bulkApproveClassification() {
        if (hubState.busy || hubState.flushing || anyStagingInFlight() || !hasAdminAccess()) return;
        if (hasUnsyncedPending()) {
            setHubBanner('請先關閉視窗同步本機待審批（' + pendingCount() + ' 項），再使用批量通過。', 'warn');
            return;
        }
        var selected = Object.keys(hubState.selected).filter(Boolean);
        var ids = selected.length
            ? selected
            : (hubState.classRows || []).map(function (row) {
                return row && row.id ? String(row.id) : '';
            }).filter(Boolean);
        if (!ids.length) return;
        if (ids.length > 200) ids = ids.slice(0, 200);

        hubState.busy = true;
        syncBulkButton();
        setHubBanner('批量通過中（' + ids.length + '）…', 'info');
        try {
            var data = await proxyAction({
                action: 'bulkApproveClassificationProposals',
                proposalIds: ids,
                confirmOverwrite: false
            }, 180000);
            if (!data || data.ok !== true) {
                setHubBanner(
                    (data && data.message && String(data.message)) || errorMessage(data && data.error),
                    'error'
                );
                return;
            }

            var approved = Array.isArray(data.approved) ? data.approved : [];
            var needsConfirm = Array.isArray(data.needsConfirm) ? data.needsConfirm : [];
            var failed = Array.isArray(data.failed) ? data.failed : [];

            async function applyApprovedList(list) {
                var approvedIds = {};
                for (var i = 0; i < list.length; i++) {
                    var item = list[i];
                    if (!item) continue;
                    approvedIds[String(item.proposalId || '')] = true;
                    delete hubState.selected[String(item.proposalId || '')];
                    scheduleLocalBankApply(applyApprovedClassificationLocally(item.question));
                }
                hubState.classRows = (hubState.classRows || []).filter(function (row) {
                    return !(row && approvedIds[String(row.id || '')]);
                });
                hubState.classPendingCount = (hubState.classRows || []).length;
                hubState.classPaused = hubState.classPendingCount >= (hubState.classPauseThreshold || 200);
            }

            await applyApprovedList(approved);

            if (needsConfirm.length) {
                var previewLines = needsConfirm.slice(0, 8).map(function (item) {
                    return '• ' + String(item.questionId || item.proposalId || '');
                }).join('\n');
                var more = needsConfirm.length > 8
                    ? '\n…另有 ' + (needsConfirm.length - 8) + ' 題'
                    : '';
                var ok = global.confirm
                    ? global.confirm(
                        '有 ' + needsConfirm.length + ' 題已有分類或 reviewedByAI=Y。確定全部覆寫並通過？\n\n'
                        + previewLines + more
                    )
                    : false;
                if (!ok) {
                    var bits = [];
                    if (approved.length) bits.push('已通過 ' + approved.length + ' 題');
                    bits.push('已取消覆寫 ' + needsConfirm.length + ' 題');
                    if (failed.length) bits.push('失敗 ' + failed.length + ' 題');
                    setHubBanner(bits.join('；') + '。', 'warn');
                    syncHubChrome();
                    renderHubList();
                    return;
                }
                setHubBanner('覆寫並通過中（' + needsConfirm.length + '）…', 'info');
                var confirmIds = needsConfirm.map(function (item) {
                    return String(item.proposalId || '');
                }).filter(Boolean);
                data = await proxyAction({
                    action: 'bulkApproveClassificationProposals',
                    proposalIds: confirmIds,
                    confirmOverwrite: true
                }, 180000);
                if (!data || data.ok !== true) {
                    setHubBanner(
                        (data && data.message && String(data.message)) || errorMessage(data && data.error),
                        'error'
                    );
                    syncHubChrome();
                    renderHubList();
                    return;
                }
                var approved2 = Array.isArray(data.approved) ? data.approved : [];
                var failed2 = Array.isArray(data.failed) ? data.failed : [];
                await applyApprovedList(approved2);
                approved = approved.concat(approved2);
                failed = failed.concat(failed2);
                needsConfirm = Array.isArray(data.needsConfirm) ? data.needsConfirm : [];
            }

            var summary = [];
            if (approved.length) summary.push('已通過 ' + approved.length + ' 題');
            if (failed.length) summary.push('失敗 ' + failed.length + ' 題');
            if (needsConfirm.length) summary.push('仍待確認 ' + needsConfirm.length + ' 題');
            if (!summary.length) summary.push('沒有可通過的提案');
            var firstFail = failed[0];
            var failHint = firstFail && firstFail.message
                ? '（例如：' + String(firstFail.message) + '）'
                : '';
            setHubBanner(summary.join('；') + failHint, failed.length && !approved.length ? 'error' : 'ok');
            syncHubChrome();
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
    }

    async function bulkApproveParts() {
        if (hubState.busy || hubState.flushing || anyStagingInFlight() || !hasAdminAccess()) return;
        if (hasUnsyncedPending()) {
            setHubBanner('請先關閉視窗同步本機待審批（' + pendingCount() + ' 項），再使用批量通過。', 'warn');
            return;
        }
        var selected = Object.keys(hubState.selected).filter(Boolean);
        var ids = selected.length
            ? selected
            : (hubState.partsRows || []).map(function (row) {
                return row && row.id ? String(row.id) : '';
            }).filter(Boolean);
        if (!ids.length) return;
        if (ids.length > 200) ids = ids.slice(0, 200);

        hubState.busy = true;
        syncBulkButton();
        setHubBanner('批量通過中（' + ids.length + '）…', 'info');
        try {
            var data = await proxyAction({
                action: 'bulkApproveQuestionPartsProposals',
                proposalIds: ids,
                confirmOverwrite: false
            }, 180000);
            if (!data || data.ok !== true) {
                setHubBanner(
                    (data && data.message && String(data.message)) || errorMessage(data && data.error),
                    'error'
                );
                return;
            }

            var approved = Array.isArray(data.approved) ? data.approved : [];
            var needsConfirm = Array.isArray(data.needsConfirm) ? data.needsConfirm : [];
            var failed = Array.isArray(data.failed) ? data.failed : [];

            async function applyApprovedList(list) {
                var approvedIds = {};
                for (var i = 0; i < list.length; i++) {
                    var item = list[i];
                    if (!item) continue;
                    approvedIds[String(item.proposalId || '')] = true;
                    delete hubState.selected[String(item.proposalId || '')];
                    scheduleLocalBankApply(applyApprovedPartsLocally(item.question));
                }
                hubState.partsRows = (hubState.partsRows || []).filter(function (row) {
                    return !(row && approvedIds[String(row.id || '')]);
                });
            }

            await applyApprovedList(approved);

            if (needsConfirm.length) {
                var previewLines = needsConfirm.slice(0, 8).map(function (item) {
                    return '• ' + String(item.questionId || item.proposalId || '');
                }).join('\n');
                var more = needsConfirm.length > 8
                    ? '\n…另有 ' + (needsConfirm.length - 8) + ' 題'
                    : '';
                var ok = global.confirm
                    ? global.confirm(
                        '有 ' + needsConfirm.length + ' 題已有分題資料。確定全部覆寫並通過？\n\n'
                        + previewLines + more
                    )
                    : false;
                if (!ok) {
                    var bits = [];
                    if (approved.length) bits.push('已通過 ' + approved.length + ' 題');
                    bits.push('已取消覆寫 ' + needsConfirm.length + ' 題');
                    if (failed.length) bits.push('失敗 ' + failed.length + ' 題');
                    setHubBanner(bits.join('；') + '。', 'warn');
                    renderHubList();
                    return;
                }
                setHubBanner('覆寫並通過中（' + needsConfirm.length + '）…', 'info');
                var confirmIds = needsConfirm.map(function (item) {
                    return String(item.proposalId || '');
                }).filter(Boolean);
                data = await proxyAction({
                    action: 'bulkApproveQuestionPartsProposals',
                    proposalIds: confirmIds,
                    confirmOverwrite: true
                }, 180000);
                if (!data || data.ok !== true) {
                    setHubBanner(
                        (data && data.message && String(data.message)) || errorMessage(data && data.error),
                        'error'
                    );
                    renderHubList();
                    return;
                }
                var approved2 = Array.isArray(data.approved) ? data.approved : [];
                var failed2 = Array.isArray(data.failed) ? data.failed : [];
                await applyApprovedList(approved2);
                approved = approved.concat(approved2);
                failed = failed.concat(failed2);
                needsConfirm = Array.isArray(data.needsConfirm) ? data.needsConfirm : [];
            }

            var summary = [];
            if (approved.length) summary.push('已通過 ' + approved.length + ' 題');
            if (failed.length) summary.push('失敗 ' + failed.length + ' 題');
            if (needsConfirm.length) summary.push('仍待確認 ' + needsConfirm.length + ' 題');
            if (!summary.length) summary.push('沒有可通過的提案');
            var firstFail = failed[0];
            var failHint = firstFail && firstFail.message
                ? '（例如：' + String(firstFail.message) + '）'
                : '';
            setHubBanner(summary.join('；') + failHint, failed.length && !approved.length ? 'error' : 'ok');
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
    }

    function bulkMarkResolved() {
        markItemsResolved(Object.keys(hubState.selected));
    }

    function initReportIssueFeature() {
        bindEscape();
        syncBeforeUnloadGuard();
        loadPendingOpsFromDisk().then(function () {
            refreshHubButton();
            updatePendingFlushChip();
            // Leftover pending from prior session: if 自動同步 ON, flush now (no hub needed).
            if (hasUnsyncedPending() && hasAdminAccess() && isGitAutoSyncOn()) {
                flushPendingOps({ reason: 'auto-sync' }).catch(function () {});
            }
            if (hasAdminAccess()) {
                return ensureStagingCache(false);
            }
        }).catch(function () {
            refreshHubButton();
        });
    }

    global.ReportIssue = {
        open: openReportModal,
        close: closeReportModal,
        openHub: openFeedbackHub,
        refreshHubButton: refreshHubButton,
        init: initReportIssueFeature,
        TAG_DEFS: TAG_DEFS,
        STATUS_LABELS: STATUS_LABELS,
        hasAdminAccess: hasAdminAccess,
        pendingForQuestion: pendingForQuestion,
        isStagingCacheReady: isStagingCacheReady,
        pendingStagingFilterActive: pendingStagingFilterActive,
        stagingActionsHtml: stagingActionsHtml,
        refreshQuestionCardStaging: refreshQuestionCardStaging,
        ensureStagingCache: ensureStagingCache,
        handleCardStagingAction: handleCardStagingAction,
        flushPendingOps: flushPendingOps,
        updatePendingFlushChip: updatePendingFlushChip,
        openPendingQueuePanel: openPendingQueuePanel,
        revokePendingOp: revokePendingOp
    };
    global.openReportIssueModal = openReportModal;
    global.initReportIssueFeature = initReportIssueFeature;
})(window);
