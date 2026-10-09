// 回報問題 — per-question issue reports for all signed-in users.
// Persist: shared/data/issue-reports.json via Apps Script (reportIssue /
// listIssueReports). Admin viewer is combined with AI解釋 Feedback.
// Dependencies: access-rights, github-sync (gitProxyRequest / gitUsername),
// optional PoeGenerate.proxyRequest, AiExplanation admin hooks.

(function (global) {
    'use strict';

    var TAG_DEFS = [
        { id: 'typo', label: '有錯字' },
        { id: 'image', label: '圖片未能正確顯示' },
        { id: 'classification', label: '分類不正確' },
        { id: 'other', label: '其他' }
    ];

    var reportOverlay = null;
    var hubOverlay = null;
    var escapeBound = false;
    var reportState = {
        questionId: '',
        tags: {},
        busy: false
    };
    var hubState = {
        tab: 'issues', // issues | ai
        issues: [],
        aiRows: [],
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
        return !!(global.authManager && global.authManager.isAuthenticated
            && global.authManager.isAuthenticated() && username());
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
            rate_limited: '提交太頻繁，請稍後再試',
            github_not_configured: '回報服務尚未設定',
            github_error: '儲存失敗，請稍後再試',
            network: '無法連線到服務',
            proxy_not_configured: '未設定代理服務'
        };
        return map[code] || ('操作失敗' + (code ? '（' + code + '）' : ''));
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
        // Retire the old AI-only button if present.
        var legacy = document.getElementById('ai-explain-feedback-admin-btn');
        if (legacy) {
            legacy.hidden = true;
            legacy.id = 'ai-explain-feedback-admin-btn-retired';
        }
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
        button.className = 'btn btn-outline-primary';
        button.hidden = true;
        button.textContent = '回饋／回報';
        button.setAttribute('aria-label', '瀏覽 AI解釋 Feedback 同問題回報');
        button.dataset.bound = '1';
        button.addEventListener('click', openFeedbackHub);
        var anchor = document.getElementById('data-checks-btn') || document.getElementById('admin-mode-btn');
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
        // Hide legacy AI-only button if somehow still separate.
        var legacy = document.getElementById('ai-explain-feedback-admin-btn');
        if (legacy && legacy !== button) legacy.hidden = true;
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
            + '      <p class="report-issue-subtitle">AI解釋評分／Feedback，同埋使用者問題回報（最新在前）。</p>'
            + '    </div>'
            + '    <button type="button" class="report-issue-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="feedback-hub-tabs" role="tablist">'
            + '    <button type="button" class="feedback-hub-tab is-active" role="tab" data-hub-tab="issues" aria-selected="true">回報問題</button>'
            + '    <button type="button" class="feedback-hub-tab" role="tab" data-hub-tab="ai" aria-selected="false">AI解釋 Feedback</button>'
            + '  </div>'
            + '  <div class="feedback-hub-toolbar">'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="feedback-hub-refresh">重新載入</button>'
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
        hubOverlay.querySelector('.feedback-hub-tabs').addEventListener('click', function (event) {
            var tab = event.target.closest('[data-hub-tab]');
            if (!tab) return;
            hubState.tab = tab.getAttribute('data-hub-tab') === 'ai' ? 'ai' : 'issues';
            hubOverlay.querySelectorAll('[data-hub-tab]').forEach(function (btn) {
                var on = btn.getAttribute('data-hub-tab') === hubState.tab;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            renderHubList();
        });
        return hubOverlay;
    }

    function closeFeedbackHub() {
        if (!hubOverlay) return;
        hubOverlay.hidden = true;
        if (global.AiExplanation && typeof AiExplanation.closeAdminPanel === 'function') {
            AiExplanation.closeAdminPanel();
        }
    }

    async function openFeedbackHub() {
        if (!hasAdminAccess()) return;
        ensureHubOverlay();
        bindEscape();
        hubOverlay.hidden = false;
        // Close standalone AI admin if open.
        if (global.AiExplanation && typeof AiExplanation.closeAdminPanel === 'function') {
            AiExplanation.closeAdminPanel();
        }
        await loadHubData(true);
    }

    async function loadHubData() {
        if (!hasAdminAccess()) return;
        hubState.loading = true;
        hubState.error = '';
        var list = document.getElementById('feedback-hub-list');
        var st = document.getElementById('feedback-hub-status');
        if (list) list.innerHTML = '<p class="report-issue-empty">載入中…</p>';
        if (st) {
            st.hidden = true;
            st.textContent = '';
        }
        try {
            var results = await Promise.all([
                proxyAction({ action: 'listIssueReports' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                }),
                proxyAction({ action: 'listAiExplanationFeedback' }, 60000).catch(function (err) {
                    return { ok: false, error: err && err.code };
                })
            ]);
            var issues = results[0];
            var ai = results[1];
            hubState.issues = (issues && issues.ok && Array.isArray(issues.rows)) ? issues.rows : [];
            hubState.aiRows = (ai && ai.ok && Array.isArray(ai.rows)) ? ai.rows : [];
            if ((!issues || issues.ok !== true) && (!ai || ai.ok !== true)) {
                hubState.error = errorMessage((issues && issues.error) || (ai && ai.error));
            } else {
                hubState.error = '';
            }
        } catch (err) {
            hubState.issues = [];
            hubState.aiRows = [];
            hubState.error = errorMessage(err && err.code);
        } finally {
            hubState.loading = false;
            renderHubList();
        }
    }

    function renderHubList() {
        var list = document.getElementById('feedback-hub-list');
        var st = document.getElementById('feedback-hub-status');
        if (!list) return;
        if (hubState.loading) {
            list.innerHTML = '<p class="report-issue-empty">載入中…</p>';
            return;
        }
        if (hubState.error) {
            list.innerHTML = '';
            if (st) {
                st.hidden = false;
                st.textContent = hubState.error;
                st.className = 'report-issue-status is-error';
            }
            return;
        }
        if (st) st.hidden = true;
        if (hubState.tab === 'ai') {
            var aiRows = hubState.aiRows || [];
            if (!aiRows.length) {
                list.innerHTML = '<p class="report-issue-empty">尚未有 AI解釋 Feedback。</p>';
                return;
            }
            list.innerHTML = aiRows.map(function (row) {
                var rating = row.rating === 'up' ? '👍' : (row.rating === 'down' ? '👎' : '—');
                var level = row.detailLevel === 'detailed' ? '詳盡' : '簡短';
                return ''
                    + '<article class="feedback-hub-row">'
                    + '  <div class="feedback-hub-meta">'
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
                    + '  </div>'
                    + '  <p class="feedback-hub-text">' + esc(row.text || '') + '</p>'
                    + '</article>';
            }).join('');
            return;
        }
        var rows = hubState.issues || [];
        if (!rows.length) {
            list.innerHTML = '<p class="report-issue-empty">尚未有問題回報。</p>';
            return;
        }
        list.innerHTML = rows.map(function (row) {
            var labels = Array.isArray(row.tagLabels) && row.tagLabels.length
                ? row.tagLabels
                : (Array.isArray(row.tags) ? row.tags : []);
            var chips = labels.map(function (label) {
                return '<span class="feedback-hub-pill">' + esc(label) + '</span>';
            }).join('');
            return ''
                + '<article class="feedback-hub-row">'
                + '  <div class="feedback-hub-meta">'
                + '    <strong>' + esc(row.questionId || '') + '</strong>'
                + '    <span>' + esc(row.user || '') + '</span>'
                + '    <span>' + esc(formatWhen(row.createdAt)) + '</span>'
                + '  </div>'
                + '  <div class="feedback-hub-meta">' + chips + '</div>'
                + '  <p class="feedback-hub-text">' + esc(row.text || '（無補充說明）') + '</p>'
                + '</article>';
        }).join('');
    }

    function initReportIssueFeature() {
        bindEscape();
        refreshHubButton();
        // Prefer combined hub over standalone AI admin button.
        if (global.AiExplanation && typeof AiExplanation.setAdminUiDelegated === 'function') {
            AiExplanation.setAdminUiDelegated(true);
        }
        refreshHubButton();
    }

    global.ReportIssue = {
        open: openReportModal,
        close: closeReportModal,
        openHub: openFeedbackHub,
        refreshHubButton: refreshHubButton,
        init: initReportIssueFeature,
        TAG_DEFS: TAG_DEFS
    };
    global.openReportIssueModal = openReportModal;
    global.initReportIssueFeature = initReportIssueFeature;
})(window);
