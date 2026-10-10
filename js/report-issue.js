// 回報問題 — UI for any authenticated session; Apps Script reportIssue requires
// a known hash (rights.known). Persist: shared/data/issue-reports.json
// (reportIssue / listIssueReports / update*Status). Admin hub「回饋／回報」
// combines AI解釋 Feedback、問題回報、分題審批 (question-parts proposals).
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
    var hubState = {
        tab: 'issues', // issues | ai | parts
        issues: [],
        aiRows: [],
        partsRows: [],
        partsStemById: {},
        statusFilter: 'open', // open | resolved | all (issues/ai only)
        selected: {},
        busy: false,
        loading: false,
        error: ''
    };

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
            if (event.target === reportOverlay) closeReportModal();
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
        button.textContent = '回饋／回報';
        button.setAttribute('aria-label', '瀏覽 AI解釋 Feedback、問題回報同埋分題審批');
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
        if (!allowed) closeFeedbackHub();
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
            + '      <h2 id="feedback-hub-title">回饋／回報</h2>'
            + '      <p class="report-issue-subtitle" id="feedback-hub-subtitle">AI解釋評分／Feedback、使用者問題回報，同埋分題提案審批。</p>'
            + '    </div>'
            + '    <button type="button" class="report-issue-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="feedback-hub-tabs" role="tablist">'
            + '    <button type="button" class="feedback-hub-tab is-active" role="tab" data-hub-tab="issues" aria-selected="true">回報問題</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="ai" aria-selected="false">AI解釋 Feedback</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="parts" aria-selected="false">分題審批</button>'
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
            + '  <div class="feedback-hub-list" id="feedback-hub-list"></div>'
            + '  <footer class="report-issue-footer">'
            + '    <button type="button" class="btn btn-secondary" id="feedback-hub-done">關閉</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(hubOverlay);
        hubOverlay.addEventListener('click', function (event) {
            if (event.target === hubOverlay) closeFeedbackHub();
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
            else bulkMarkResolved();
        });
        hubOverlay.querySelector('.feedback-hub-tabs').addEventListener('click', function (event) {
            var tab = event.target.closest('[data-hub-tab]');
            if (!tab) return;
            var next = String(tab.getAttribute('data-hub-tab') || 'issues');
            if (next !== 'ai' && next !== 'parts') next = 'issues';
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
            }
        });
        return hubOverlay;
    }

    function syncHubChrome() {
        if (!hubOverlay) return;
        var partsMode = hubState.tab === 'parts';
        var filterLabel = document.getElementById('feedback-hub-filter-label');
        var filter = document.getElementById('feedback-hub-status-filter');
        var bulk = document.getElementById('feedback-hub-bulk-resolve');
        var subtitle = document.getElementById('feedback-hub-subtitle');
        if (filterLabel) filterLabel.hidden = partsMode;
        if (filter) filter.hidden = partsMode;
        if (bulk) bulk.hidden = false;
        if (subtitle) {
            subtitle.textContent = partsMode
                ? '待審批的分題提案（通過會寫入共用題庫；拒絕只移除提案）。'
                : 'AI解釋評分／Feedback、使用者問題回報，同埋分題提案審批。';
        }
        syncBulkButton();
    }

    function closeFeedbackHub() {
        if (!hubOverlay) return;
        hubOverlay.hidden = true;
        hubState.selected = {};
        hubState.busy = false;
        if (global.AiExplanation && typeof AiExplanation.closeAdminPanel === 'function') {
            AiExplanation.closeAdminPanel();
        }
    }

    async function openFeedbackHub() {
        if (!hasAdminAccess()) return;
        ensureHubOverlay();
        bindEscape();
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
                })
            ]);
            var issues = results[0];
            var ai = results[1];
            var parts = results[2];
            hubState.issues = (issues && issues.ok && Array.isArray(issues.rows)) ? issues.rows : [];
            hubState.aiRows = (ai && ai.ok && Array.isArray(ai.rows)) ? ai.rows : [];
            hubState.partsRows = (parts && parts.ok && Array.isArray(parts.rows)) ? parts.rows : [];
            await loadPartsStemMap(hubState.partsRows);
            if ((!issues || issues.ok !== true)
                && (!ai || ai.ok !== true)
                && (!parts || parts.ok !== true)) {
                hubState.error = errorMessage(
                    (issues && issues.error) || (ai && ai.error) || (parts && parts.error)
                );
            } else {
                hubState.error = '';
            }
        } catch (err) {
            hubState.issues = [];
            hubState.aiRows = [];
            hubState.partsRows = [];
            hubState.error = errorMessage(err && err.code);
        } finally {
            hubState.loading = false;
            syncHubChrome();
            renderHubList();
        }
    }

    function filteredRows() {
        if (hubState.tab === 'parts') return (hubState.partsRows || []).slice();
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
        if (hubState.tab === 'parts') {
            var total = (hubState.partsRows || []).length;
            if (n > 0) {
                btn.disabled = hubState.busy;
                btn.textContent = '通過選中（' + n + '）';
            } else {
                btn.disabled = hubState.busy || total === 0;
                btn.textContent = '通過全部';
            }
            return;
        }
        btn.disabled = hubState.busy || n === 0;
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
        setHubBanner('', '');
        var rows = filteredRows();
        if (!rows.length) {
            var emptyMsg = '尚未有符合條件的項目。';
            if (hubState.tab === 'parts') {
                emptyMsg = '沒有待審批的分題提案。';
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
                    + esc(id) + '">通過</button>'
                    + '    <button type="button" class="btn btn-outline-danger btn-sm" data-parts-reject="'
                    + esc(id) + '">拒絕</button>'
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
        if (hubState.busy || !hasAdminAccess()) return;
        var row = findPartsRow(proposalId);
        if (!row) return;
        hubState.busy = true;
        syncBulkButton();
        setHubBanner('通過中…', 'info');
        try {
            var data = await proxyAction({
                action: 'approveQuestionPartsProposal',
                proposalId: String(row.id || ''),
                questionId: String(row.questionId || ''),
                confirmOverwrite: false
            }, 120000);
            if (!data) {
                setHubBanner(errorMessage('github_error'), 'error');
                return;
            }
            if (data.needsConfirm === true) {
                var currentPreview = formatPartsPreview(data.current && data.current.questionParts);
                var proposedPreview = formatPartsPreview(data.proposed && data.proposed.questionParts);
                var ok = global.confirm
                    ? global.confirm(
                        '題目「' + String(row.questionId || '') + '」已有分題。確定覆寫？\n\n'
                        + '現有：' + currentPreview + '\n'
                        + '提案：' + proposedPreview
                    )
                    : false;
                if (!ok) {
                    setHubBanner('已取消覆寫。', 'warn');
                    return;
                }
                setHubBanner('覆寫並通過中…', 'info');
                data = await proxyAction({
                    action: 'approveQuestionPartsProposal',
                    proposalId: String(row.id || ''),
                    questionId: String(row.questionId || ''),
                    confirmOverwrite: true
                }, 120000);
            }
            if (!data || data.ok !== true) {
                setHubBanner(
                    (data && data.message && String(data.message)) || errorMessage(data && data.error),
                    'error'
                );
                return;
            }
            hubState.partsRows = (hubState.partsRows || []).filter(function (item) {
                return !(item && String(item.id) === String(row.id));
            });
            await applyApprovedPartsLocally(data.question);
            setHubBanner('已通過並寫入題庫：' + String(row.questionId || ''), 'ok');
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
    }

    async function rejectPartsProposal(proposalId) {
        if (hubState.busy || !hasAdminAccess()) return;
        var row = findPartsRow(proposalId);
        if (!row) return;
        var ok = global.confirm
            ? global.confirm('拒絕題目「' + String(row.questionId || '') + '」的分題提案？提案會從暫存移除，不會改題庫。')
            : true;
        if (!ok) return;
        hubState.busy = true;
        syncBulkButton();
        setHubBanner('拒絕中…', 'info');
        try {
            var data = await proxyAction({
                action: 'rejectQuestionPartsProposal',
                proposalId: String(row.id || ''),
                questionId: String(row.questionId || '')
            }, 60000);
            if (!data || data.ok !== true) {
                setHubBanner(errorMessage(data && data.error), 'error');
                return;
            }
            hubState.partsRows = (hubState.partsRows || []).filter(function (item) {
                return !(item && String(item.id) === String(row.id));
            });
            setHubBanner('已拒絕並移除提案：' + String(row.questionId || ''), 'ok');
            renderHubList();
        } catch (err) {
            setHubBanner(errorMessage(err && err.code), 'error');
        } finally {
            hubState.busy = false;
            syncBulkButton();
        }
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

    async function bulkApproveParts() {
        if (hubState.busy || !hasAdminAccess()) return;
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
                    await applyApprovedPartsLocally(item.question);
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
        refreshHubButton();
    }

    global.ReportIssue = {
        open: openReportModal,
        close: closeReportModal,
        openHub: openFeedbackHub,
        refreshHubButton: refreshHubButton,
        init: initReportIssueFeature,
        TAG_DEFS: TAG_DEFS,
        STATUS_LABELS: STATUS_LABELS
    };
    global.openReportIssueModal = openReportModal;
    global.initReportIssueFeature = initReportIssueFeature;
})(window);
