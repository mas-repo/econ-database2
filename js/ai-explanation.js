// AI解釋 — per-question explanations (generate / list / vote / feedback).
// Gate: accessRights.ai (same as AI出題; CSS class body.poe-ai-allowed).
// Persist: shared/data/ai-explanations.json via Apps Script + direct read.
// Admin AI Feedback UI lives in ReportIssue「回饋／回報」hub (AI tab).
// Depends: PoeGenerate (proxyRequest, withProviderAndApiKey, settings),
// shared-assets (fetchSharedJsonDirectOrProxy), access-rights, render.

(function (global) {
    'use strict';

    var AI_EXPLANATIONS_PATH = 'data/ai-explanations.json';
    var LABEL_HAS = '有AI解釋';
    var LABEL_NONE = '沒有AI解釋';
    var LABEL_SHORT = '簡短';
    var LABEL_DETAILED = '詳盡';

    var store = {
        version: 1,
        updatedAt: '',
        byQuestion: {},
        loaded: false,
        loading: false,
        loadError: '',
        loadPromise: null
    };

    var modalState = {
        questionId: '',
        explanations: [],
        selectedId: '',
        busy: false,
        detailLevel: 'short',
        status: '',
        statusKind: ''
    };
    var defaultDetailLevel = 'short';

    // Survives modal close/reopen: per-question in-flight generate jobs.
    // Keyed by questionId → { busy, status, statusKind, detailLevel, promise }.
    var generatingByQuestion = Object.create(null);

    var overlay = null;
    var feedbackOverlay = null;
    var escapeHandlerBound = false;

    function hasAiAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (global.accessRights || null);
        return !!(rights && rights.ai === true);
    }

    function username() {
        if (global.PoeGenerate && typeof PoeGenerate.currentUsername === 'function') {
            return PoeGenerate.currentUsername();
        }
        if (!global.authManager || !global.authManager.currentUser) return '';
        return String(global.authManager.currentUser).trim().toLowerCase();
    }

    function esc(text) {
        return (typeof escapeHTML === 'function') ? escapeHTML(text) : String(text == null ? '' : text);
    }

    function formatWhen(iso) {
        return (typeof formatDateTimeZhHk === 'function') ? formatDateTimeZhHk(iso) : String(iso || '');
    }

    function normalizeDetailLevel(raw) {
        var text = String(raw == null ? '' : raw).trim().toLowerCase();
        if (text === 'detailed' || text === '詳盡' || text === 'detail' || text === 'long') {
            return 'detailed';
        }
        return 'short';
    }

    function detailLevelLabel(level) {
        return normalizeDetailLevel(level) === 'detailed' ? LABEL_DETAILED : LABEL_SHORT;
    }

    function emptyStore() {
        return { version: 1, updatedAt: '', byQuestion: {} };
    }

    function applyStorePayload(payload) {
        var next = emptyStore();
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            if (typeof payload.version === 'number') next.version = payload.version;
            next.updatedAt = String(payload.updatedAt || '');
            if (payload.byQuestion && typeof payload.byQuestion === 'object' && !Array.isArray(payload.byQuestion)) {
                next.byQuestion = payload.byQuestion;
            }
        }
        store.version = next.version;
        store.updatedAt = next.updatedAt;
        store.byQuestion = next.byQuestion;
        store.loaded = true;
        store.loadError = '';
    }

    function summaryForQuestion(questionId) {
        var qid = String(questionId || '');
        var bucket = store.byQuestion && store.byQuestion[qid];
        var list = bucket && Array.isArray(bucket.explanations) ? bucket.explanations : [];
        var shortCount = 0;
        var detailedCount = 0;
        var models = {};
        list.forEach(function (exp) {
            if (!exp) return;
            if (normalizeDetailLevel(exp.detailLevel) === 'detailed') detailedCount += 1;
            else shortCount += 1;
            var model = String(exp.model || '').trim();
            if (model) models[model] = (models[model] || 0) + 1;
        });
        return {
            count: list.length,
            shortCount: shortCount,
            detailedCount: detailedCount,
            models: models,
            explanations: list.slice()
        };
    }

    // Values used by 題目 / 統計 AI filters (tri-state).
    // Presence: 有AI解釋 / 沒有AI解釋. Detail: 簡短 / 詳盡 when present.
    function filterValuesForQuestion(questionId) {
        var summary = summaryForQuestion(questionId);
        if (!summary.count) return [LABEL_NONE];
        var values = [LABEL_HAS];
        if (summary.shortCount) values.push(LABEL_SHORT);
        if (summary.detailedCount) values.push(LABEL_DETAILED);
        return values;
    }

    function questionHasExplanation(questionId) {
        return summaryForQuestion(questionId).count > 0;
    }

    function listLocalExplanations(questionId) {
        var summary = summaryForQuestion(questionId);
        var list = summary.explanations.slice();
        list.sort(function (a, b) {
            return String(b && b.createdAt || '').localeCompare(String(a && a.createdAt || ''));
        });
        return list.map(function (exp) {
            return publicView(exp, username());
        });
    }

    function publicView(exp, viewer) {
        if (!exp) return null;
        var up = Array.isArray(exp.votes && exp.votes.up) ? exp.votes.up : [];
        var down = Array.isArray(exp.votes && exp.votes.down) ? exp.votes.down : [];
        var myVote = '';
        if (viewer) {
            if (up.indexOf(viewer) !== -1) myVote = 'up';
            else if (down.indexOf(viewer) !== -1) myVote = 'down';
        }
        return {
            id: String(exp.id || ''),
            questionId: String(exp.questionId || ''),
            detailLevel: normalizeDetailLevel(exp.detailLevel),
            model: String(exp.model || ''),
            createdAt: String(exp.createdAt || ''),
            createdBy: String(exp.createdBy || ''),
            text: String(exp.text || ''),
            upCount: up.length,
            downCount: down.length,
            myVote: myVote,
            feedbackCount: Array.isArray(exp.feedback) ? exp.feedback.length : 0
        };
    }

    function mergeExplanationIntoStore(explanation) {
        if (!explanation || !explanation.id || !explanation.questionId) return;
        var qid = String(explanation.questionId);
        if (!store.byQuestion[qid] || typeof store.byQuestion[qid] !== 'object') {
            store.byQuestion[qid] = { explanations: [] };
        }
        var list = Array.isArray(store.byQuestion[qid].explanations)
            ? store.byQuestion[qid].explanations
            : [];
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === String(explanation.id)) {
                list[i] = hydrateFromPublic(list[i], explanation, username());
                found = true;
                break;
            }
        }
        if (!found) {
            list.unshift(hydrateFromPublic(null, explanation, username()));
        }
        store.byQuestion[qid].explanations = list;
    }

    function hydrateFromPublic(existing, publicExp, viewer) {
        var base = existing && typeof existing === 'object' ? existing : {
            id: publicExp.id,
            questionId: publicExp.questionId,
            votes: { up: [], down: [] },
            feedback: []
        };
        base.id = publicExp.id;
        base.questionId = publicExp.questionId;
        base.detailLevel = normalizeDetailLevel(publicExp.detailLevel);
        base.model = String(publicExp.model || '');
        base.createdAt = String(publicExp.createdAt || '');
        base.createdBy = String(publicExp.createdBy || base.createdBy || '');
        if (publicExp.text != null) base.text = String(publicExp.text);
        // Rebuild vote arrays from public counts + myVote (side file may
        // still hold full lists; public view only exposes counts).
        var up = [];
        var down = [];
        var upNeed = publicExp.upCount || 0;
        var downNeed = publicExp.downCount || 0;
        if (viewer && publicExp.myVote === 'up') {
            up.push(viewer);
            upNeed = Math.max(0, upNeed - 1);
        }
        if (viewer && publicExp.myVote === 'down') {
            down.push(viewer);
            downNeed = Math.max(0, downNeed - 1);
        }
        for (var i = 0; i < upNeed; i++) up.push('__u' + i);
        for (var j = 0; j < downNeed; j++) down.push('__d' + j);
        base.votes = { up: up, down: down };
        if (!Array.isArray(base.feedback)) base.feedback = [];
        return base;
    }

    function replaceQuestionExplanations(questionId, publicList) {
        var qid = String(questionId || '');
        if (!qid) return;
        if (!Array.isArray(publicList)) return;
        if (!store.byQuestion[qid]) store.byQuestion[qid] = { explanations: [] };
        var viewer = username();
        store.byQuestion[qid].explanations = publicList.map(function (item) {
            return hydrateFromPublic(null, item, viewer);
        });
    }

    async function loadAiExplanations(force) {
        if (!hasAiAccess()) {
            store.byQuestion = {};
            store.loaded = false;
            store.loadError = '';
            store.loadPromise = null;
            return store;
        }
        if (store.loading && store.loadPromise) return store.loadPromise;
        if (store.loaded && !force) return store;

        store.loading = true;
        store.loadError = '';
        store.loadPromise = (async function () {
            try {
                if (typeof fetchSharedJsonDirectOrProxy === 'function') {
                    var direct = await fetchSharedJsonDirectOrProxy(AI_EXPLANATIONS_PATH, 60000);
                    if (direct && direct.data) {
                        applyStorePayload(direct.data);
                        return store;
                    }
                }
                applyStorePayload(emptyStore());
                return store;
            } catch (err) {
                var code = err && (err.code || err.message) ? String(err.code || err.message) : 'github_error';
                if (code === 'github_not_found' || code.indexOf('not_found') !== -1) {
                    applyStorePayload(emptyStore());
                    return store;
                }
                store.loadError = code;
                store.loaded = true;
                if (!store.byQuestion) store.byQuestion = {};
                return store;
            } finally {
                store.loading = false;
            }
        })();
        return store.loadPromise;
    }

    function proxy() {
        return global.PoeGenerate || null;
    }

    async function proxyAction(payload, timeoutMs) {
        var poe = proxy();
        if (!poe || typeof poe.proxyRequest !== 'function') {
            var missing = new Error('proxy_not_configured');
            missing.code = 'proxy_not_configured';
            throw missing;
        }
        var body = Object.assign({ username: username() }, payload || {});
        if (typeof poe.withProviderAndApiKey === 'function') {
            body = poe.withProviderAndApiKey(body);
        }
        return poe.proxyRequest(body, timeoutMs || 90000, null, { retries: 0 });
    }

    function errorMessage(code) {
        var map = {
            feature_unavailable: '沒有 AI解釋 權限',
            missing_api_key: '尚未設定 API Key。請先在 AI出題 的「API／模型設定」輸入金鑰。',
            rate_limited: '請求太頻繁或已達每日上限，請稍後再試',
            bad_request: '請求資料不正確',
            not_found: '找不到該解釋',
            empty_response: '模型沒有回傳內容',
            network: '無法連線到服務',
            github_error: '儲存或讀取失敗',
            github_not_configured: '共用題庫尚未在伺服器設定',
            github_not_found: '尚未有 AI解釋 資料',
            payload_too_large: '內容太大，無法儲存',
            proxy_not_configured: '未設定代理服務',
            no_reference_questions: '題目資料不足，無法產生解釋'
        };
        return map[code] || ('操作失敗' + (code ? '（' + code + '）' : ''));
    }

    function setModalStatus(text, kind) {
        modalState.status = String(text || '');
        modalState.statusKind = String(kind || '');
        var el = document.getElementById('ai-explain-status');
        if (!el) return;
        el.textContent = modalState.status;
        el.hidden = !modalState.status;
        el.className = 'ai-explain-status' + (kind ? ' is-' + kind : '');
    }

    function syncGenerateButton() {
        var btn = document.getElementById('ai-explain-generate-btn');
        if (!btn) return;
        btn.disabled = !!modalState.busy;
    }

    function getGeneratingJob(qid) {
        var key = String(qid || '');
        return key ? generatingByQuestion[key] || null : null;
    }

    function setGeneratingJob(qid, job) {
        var key = String(qid || '');
        if (!key) return;
        if (job) generatingByQuestion[key] = job;
        else delete generatingByQuestion[key];
    }

    function restoreGeneratingUi(qid) {
        var job = getGeneratingJob(qid);
        if (!job || !job.busy) {
            modalState.busy = false;
            syncGenerateButton();
            return false;
        }
        modalState.busy = true;
        if (job.detailLevel) {
            modalState.detailLevel = normalizeDetailLevel(job.detailLevel);
            var levelShort = overlay && overlay.querySelector('input[name="ai-explain-level"][value="short"]');
            var levelDetailed = overlay && overlay.querySelector('input[name="ai-explain-level"][value="detailed"]');
            if (levelShort) levelShort.checked = modalState.detailLevel === 'short';
            if (levelDetailed) levelDetailed.checked = modalState.detailLevel === 'detailed';
        }
        setModalStatus(job.status || '正在產生 AI解釋…', job.statusKind || 'info');
        syncGenerateButton();
        return true;
    }

    function renderMarkdownBody(text) {
        if (global.PoeMarkdown && typeof PoeMarkdown.renderToHtml === 'function') {
            return PoeMarkdown.renderToHtml(text);
        }
        return esc(text).replace(/\n/g, '<br>');
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'ai-explain-overlay';
        overlay.className = 'ai-explain-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="ai-explain-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-explain-title">'
            + '  <header class="ai-explain-header">'
            + '    <div>'
            + '      <h2 id="ai-explain-title">AI解釋</h2>'
            + '      <p class="ai-explain-subtitle" id="ai-explain-qid"></p>'
            + '    </div>'
            + '    <button type="button" class="ai-explain-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="ai-explain-generate">'
            + '    <div class="ai-explain-level" role="group" aria-label="詳細程度">'
            + '      <label><input type="radio" name="ai-explain-level" value="short" checked> 簡短</label>'
            + '      <label><input type="radio" name="ai-explain-level" value="detailed"> 詳盡</label>'
            + '    </div>'
            + '    <div class="ai-explain-generate-actions">'
            + '      <button type="button" class="btn btn-outline-primary btn-sm" id="ai-explain-settings-btn">API／模型設定</button>'
            + '      <button type="button" class="btn btn-primary btn-sm" id="ai-explain-generate-btn">產生新解釋</button>'
            + '    </div>'
            + '  </div>'
            + '  <p class="ai-explain-status" id="ai-explain-status" hidden></p>'
            + '  <div class="ai-explain-workspace" id="ai-explain-workspace">'
            + '    <aside class="ai-explain-versions" id="ai-explain-versions" aria-label="過往解釋版本"></aside>'
            + '    <div class="ai-explain-detail" id="ai-explain-detail"></div>'
            + '  </div>'
            + '  <footer class="ai-explain-footer">'
            + '    <button type="button" class="btn btn-secondary" id="ai-explain-done">關閉</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeModal();
        });
        overlay.querySelector('.ai-explain-close').addEventListener('click', closeModal);
        overlay.querySelector('#ai-explain-done').addEventListener('click', closeModal);
        overlay.querySelector('#ai-explain-settings-btn').addEventListener('click', openSharedApiSettings);
        overlay.querySelector('#ai-explain-generate-btn').addEventListener('click', onGenerateClick);
        overlay.addEventListener('change', function (event) {
            var input = event.target.closest('input[name="ai-explain-level"]');
            if (input) modalState.detailLevel = normalizeDetailLevel(input.value);
        });
        overlay.addEventListener('click', function (event) {
            var versionBtn = event.target.closest('[data-ai-select]');
            if (versionBtn) {
                selectExplanation(versionBtn.getAttribute('data-ai-select'));
                return;
            }
            var voteBtn = event.target.closest('[data-ai-vote]');
            if (voteBtn) {
                onVoteClick(voteBtn.getAttribute('data-ai-qid'), voteBtn.getAttribute('data-ai-eid'), voteBtn.getAttribute('data-ai-vote'));
                return;
            }
            var fbBtn = event.target.closest('[data-ai-feedback]');
            if (fbBtn) {
                openFeedbackPrompt(fbBtn.getAttribute('data-ai-qid'), fbBtn.getAttribute('data-ai-eid'));
            }
        });
        return overlay;
    }

    function openSharedApiSettings() {
        // Reuse AI出題's API／模型設定 modal + the same localStorage keys.
        var poe = proxy();
        if (poe && typeof poe.openSettingsModal === 'function') {
            poe.openSettingsModal(false);
            return;
        }
        if (global.PoeGenerate && typeof PoeGenerate.openSettingsModal === 'function') {
            PoeGenerate.openSettingsModal(false);
            return;
        }
        setModalStatus('API／模型設定尚未載入', 'error');
    }

    function bindEscape() {
        if (escapeHandlerBound) return;
        escapeHandlerBound = true;
        // Capture phase: see settings while it is still open. Bubble-phase
        // listeners run after settings Esc has already closed it, which would
        // incorrectly close AI解釋 on the same keypress.
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (global.PoeGenerate && typeof PoeGenerate.isSettingsModalOpen === 'function'
                && PoeGenerate.isSettingsModalOpen()) {
                return;
            }
            if (document.body.classList.contains('poe-settings-open')) return;
            var settingsOverlay = document.getElementById('poe-settings-overlay');
            if (settingsOverlay && !settingsOverlay.hidden) return;
            if (feedbackOverlay && !feedbackOverlay.hidden) {
                closeFeedbackPrompt();
                return;
            }
            if (overlay && !overlay.hidden) closeModal();
        }, true);
    }

    function selectedExplanation() {
        var list = modalState.explanations || [];
        if (!list.length) return null;
        var id = String(modalState.selectedId || '');
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === id) return list[i];
        }
        return list[0];
    }

    function selectExplanation(explanationId) {
        var id = String(explanationId || '');
        var list = modalState.explanations || [];
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === id) {
                found = true;
                break;
            }
        }
        modalState.selectedId = found ? id : (list[0] && list[0].id ? String(list[0].id) : '');
        renderExplanationList();
    }

    function renderExplanationList() {
        var versions = document.getElementById('ai-explain-versions');
        var detail = document.getElementById('ai-explain-detail');
        if (!versions || !detail) return;
        var list = modalState.explanations || [];
        if (!list.length) {
            versions.innerHTML = '';
            detail.innerHTML = '<p class="ai-explain-empty">尚未有解釋。可選擇簡短或詳盡後產生。</p>';
            return;
        }
        if (!modalState.selectedId || !list.some(function (e) { return e && String(e.id) === String(modalState.selectedId); })) {
            modalState.selectedId = String(list[0].id || '');
        }
        versions.innerHTML = ''
            + '<div class="ai-explain-versions-head">'
            + '  <strong>過往版本</strong>'
            + '  <span class="ai-explain-meta">' + esc(String(list.length)) + ' 則</span>'
            + '</div>'
            + '<div class="ai-explain-versions-list" role="listbox" aria-label="選擇解釋版本">'
            + list.map(function (exp, index) {
                var selected = String(exp.id) === String(modalState.selectedId);
                var snippet = String(exp.text || '').replace(/\s+/g, ' ').trim().slice(0, 72);
                return ''
                    + '<button type="button" role="option" class="ai-explain-version'
                    + (selected ? ' is-selected' : '') + '" data-ai-select="' + esc(exp.id) + '"'
                    + ' aria-selected="' + (selected ? 'true' : 'false') + '">'
                    + '  <span class="ai-explain-version-top">'
                    + '    <span class="ai-explain-pill">' + esc(detailLevelLabel(exp.detailLevel)) + '</span>'
                    + '    <span class="ai-explain-version-index">#' + esc(String(list.length - index)) + '</span>'
                    + '  </span>'
                    + '  <span class="ai-explain-version-model">' + esc(exp.model || '—') + '</span>'
                    + '  <span class="ai-explain-meta">' + esc(formatWhen(exp.createdAt)) + '</span>'
                    + (snippet ? '  <span class="ai-explain-version-snippet">' + esc(snippet) + (exp.text && exp.text.length > 72 ? '…' : '') + '</span>' : '')
                    + '</button>';
            }).join('')
            + '</div>';

        var exp = selectedExplanation();
        if (!exp) {
            detail.innerHTML = '<p class="ai-explain-empty">請選擇一則解釋。</p>';
            return;
        }
        var upActive = exp.myVote === 'up' ? ' is-active' : '';
        var downActive = exp.myVote === 'down' ? ' is-active' : '';
        // Author/submitter intentionally omitted from user-facing UI.
        detail.innerHTML = ''
            + '<article class="ai-explain-card is-selected" data-eid="' + esc(exp.id) + '">'
            + '  <header class="ai-explain-card-head">'
            + '    <span class="ai-explain-pill">' + esc(detailLevelLabel(exp.detailLevel)) + '</span>'
            + '    <span class="ai-explain-meta">' + esc(exp.model || '—') + '</span>'
            + '    <span class="ai-explain-meta">' + esc(formatWhen(exp.createdAt)) + '</span>'
            + '  </header>'
            + '  <div class="ai-explain-body ai-explain-md">' + renderMarkdownBody(exp.text) + '</div>'
            + '  <div class="ai-explain-actions">'
            + '    <button type="button" class="ai-vote-btn' + upActive + '" data-ai-vote="up" data-ai-qid="'
            + esc(exp.questionId || modalState.questionId) + '" data-ai-eid="' + esc(exp.id)
            + '" title="有用">👍 <span>' + esc(String(exp.upCount || 0)) + '</span></button>'
            + '    <button type="button" class="ai-vote-btn' + downActive + '" data-ai-vote="down" data-ai-qid="'
            + esc(exp.questionId || modalState.questionId) + '" data-ai-eid="' + esc(exp.id)
            + '" title="沒有幫助">👎 <span>' + esc(String(exp.downCount || 0)) + '</span></button>'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" data-ai-feedback="1" data-ai-qid="'
            + esc(exp.questionId || modalState.questionId) + '" data-ai-eid="' + esc(exp.id)
            + '">Feedback</button>'
            + (exp.feedbackCount ? '    <span class="ai-explain-meta">Feedback ' + esc(String(exp.feedbackCount)) + '</span>' : '')
            + '  </div>'
            + '</article>';
    }

    function refreshModalListFromStore() {
        modalState.explanations = listLocalExplanations(modalState.questionId);
        if (modalState.explanations.length && !modalState.selectedId) {
            modalState.selectedId = String(modalState.explanations[0].id || '');
        }
        renderExplanationList();
    }

    async function openModal(questionId, trigger) {
        if (!hasAiAccess()) return;
        var qid = String(questionId || '');
        if (!qid) return;
        ensureOverlay();
        bindEscape();
        modalState.questionId = qid;
        modalState.selectedId = '';
        var preferredLevel = normalizeDetailLevel(
            defaultDetailLevel
            || (global.__userAiExplainStyle)
            || 'short'
        );
        modalState.detailLevel = preferredLevel;
        var levelShort = overlay.querySelector('input[name="ai-explain-level"][value="short"]');
        var levelDetailed = overlay.querySelector('input[name="ai-explain-level"][value="detailed"]');
        if (levelShort) levelShort.checked = preferredLevel === 'short';
        if (levelDetailed) levelDetailed.checked = preferredLevel === 'detailed';
        var qidEl = document.getElementById('ai-explain-qid');
        if (qidEl) qidEl.textContent = '題目 ' + qid;
        var generating = restoreGeneratingUi(qid);
        if (!generating) {
            setModalStatus(store.loaded ? '' : '載入過往解釋…', store.loaded ? '' : 'info');
            syncGenerateButton();
        }
        overlay.hidden = false;
        document.body.classList.add('ai-explain-open');
        if (trigger && trigger.focus) overlay.dataset.trigger = '1';

        await loadAiExplanations(false);
        if (modalState.questionId !== qid) return;
        refreshModalListFromStore();
        // Prefer in-flight generate status over load warnings.
        if (restoreGeneratingUi(qid)) return;
        if (store.loadError) {
            setModalStatus('過往解釋載入不完整，仍可嘗試產生新解釋。', 'warn');
        } else if (!modalState.status) {
            setModalStatus('', '');
        }
    }

    function closeModal() {
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('ai-explain-open');
        // Keep generatingByQuestion[qid] so reopen restores 「正在產生…」.
        // Only clear view-local fields; do not abort in-flight work.
        modalState.questionId = '';
        modalState.explanations = [];
        modalState.selectedId = '';
        modalState.busy = false;
        setModalStatus('', '');
        syncGenerateButton();
    }

    async function onGenerateClick() {
        if (!hasAiAccess() || modalState.busy) return;
        var poe = proxy();
        if (poe && typeof poe.ensureApiKeyReady === 'function' && !poe.ensureApiKeyReady()) {
            setModalStatus(errorMessage('missing_api_key'), 'error');
            return;
        }
        var qid = modalState.questionId;
        if (!qid) return;
        if (getGeneratingJob(qid) && getGeneratingJob(qid).busy) {
            restoreGeneratingUi(qid);
            return;
        }
        var question = null;
        if (poe && typeof poe.questionById === 'function') {
            question = await poe.questionById(qid);
        }
        if (!question) {
            setModalStatus('找不到題目資料', 'error');
            return;
        }
        var ref = (poe && typeof poe.toReference === 'function')
            ? poe.toReference(question)
            : {
                id: question.id,
                examination: question.examination || '',
                year: question.year == null ? '' : String(question.year),
                questionType: question.questionType || '',
                concepts: Array.isArray(question.concepts) ? question.concepts.join('、') : '',
                question: String(question.plainText || question.questionTextChi || '').trim(),
                explanation: ''
            };
        var detailLevel = modalState.detailLevel;
        var job = {
            busy: true,
            status: '正在產生 AI解釋…',
            statusKind: 'info',
            detailLevel: detailLevel,
            startedAt: Date.now()
        };
        setGeneratingJob(qid, job);
        modalState.busy = true;
        setModalStatus(job.status, job.statusKind);
        syncGenerateButton();

        var run = (async function () {
            try {
                var model = '';
                if (poe && typeof poe.currentModel === 'function') model = poe.currentModel();
                else if (poe && typeof poe.readStoredModel === 'function') {
                    model = poe.readStoredModel(poe.currentProvider && poe.currentProvider());
                }
                var waitMs = (poe && poe.GENERATE_WAIT_MS) || 375000;
                var data = await proxyAction({
                    action: 'generateAiExplanation',
                    questionId: qid,
                    detailLevel: detailLevel,
                    model: model,
                    question: ref
                }, waitMs);
                var stillOpen = modalState.questionId === qid && overlay && !overlay.hidden;
                if (!data || data.ok !== true) {
                    var failMsg = errorMessage(data && data.error);
                    job.busy = false;
                    job.status = failMsg;
                    job.statusKind = 'error';
                    setGeneratingJob(qid, null);
                    if (stillOpen) {
                        modalState.busy = false;
                        setModalStatus(failMsg, 'error');
                        syncGenerateButton();
                    }
                    return;
                }
                if (Array.isArray(data.explanations)) {
                    replaceQuestionExplanations(qid, data.explanations);
                } else if (data.explanation) {
                    mergeExplanationIntoStore(data.explanation);
                }
                var okMsg = data.persisted === false
                    ? ('已產生，但未能寫入共用檔（' + errorMessage(data.error || 'github_error') + '）')
                    : '已產生並儲存';
                var okKind = data.persisted === false ? 'warn' : 'ok';
                job.busy = false;
                job.status = okMsg;
                job.statusKind = okKind;
                setGeneratingJob(qid, null);
                if (stillOpen) {
                    if (data.explanation && data.explanation.id) {
                        modalState.selectedId = String(data.explanation.id);
                    } else if (Array.isArray(data.explanations) && data.explanations[0]) {
                        modalState.selectedId = String(data.explanations[0].id || '');
                    }
                    refreshModalListFromStore();
                    modalState.busy = false;
                    setModalStatus(okMsg, okKind);
                    syncGenerateButton();
                }
                if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
            } catch (err) {
                var errMsg = errorMessage(err && err.code);
                job.busy = false;
                job.status = errMsg;
                job.statusKind = 'error';
                setGeneratingJob(qid, null);
                if (modalState.questionId === qid && overlay && !overlay.hidden) {
                    modalState.busy = false;
                    setModalStatus(errMsg, 'error');
                    syncGenerateButton();
                }
            }
        })();
        job.promise = run;
        await run;
    }

    async function onVoteClick(questionId, explanationId, voteRaw) {
        if (!hasAiAccess() || modalState.busy) return;
        var vote = String(voteRaw || '').toLowerCase();
        if (vote !== 'up' && vote !== 'down') return;
        var current = (modalState.explanations || []).filter(function (e) {
            return e && e.id === explanationId;
        })[0];
        // Toggle off if clicking the same vote again.
        if (current && current.myVote === vote) vote = '';
        modalState.busy = true;
        setModalStatus('儲存評價…', 'info');
        try {
            var data = await proxyAction({
                action: 'voteAiExplanation',
                questionId: questionId,
                explanationId: explanationId,
                vote: vote
            }, 60000);
            if (!data || data.ok !== true) {
                setModalStatus(errorMessage(data && data.error), 'error');
                return;
            }
            if (Array.isArray(data.explanations)) {
                replaceQuestionExplanations(questionId, data.explanations);
            } else if (data.explanation) {
                mergeExplanationIntoStore(data.explanation);
            }
            refreshModalListFromStore();
            setModalStatus('', '');
        } catch (err) {
            setModalStatus(errorMessage(err && err.code), 'error');
        } finally {
            modalState.busy = false;
        }
    }

    function ensureFeedbackOverlay() {
        if (feedbackOverlay) return feedbackOverlay;
        feedbackOverlay = document.createElement('div');
        feedbackOverlay.id = 'ai-explain-feedback-overlay';
        feedbackOverlay.className = 'ai-explain-overlay ai-explain-feedback-overlay';
        feedbackOverlay.hidden = true;
        feedbackOverlay.innerHTML = ''
            + '<div class="ai-explain-dialog ai-explain-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-fb-title">'
            + '  <header class="ai-explain-header">'
            + '    <h2 id="ai-fb-title">Feedback</h2>'
            + '    <button type="button" class="ai-explain-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <p class="ai-explain-subtitle">簡短說明原因（會連同你的使用者名稱儲存）。</p>'
            + '  <textarea id="ai-fb-text" rows="4" maxlength="2000" placeholder="例如：解釋漏了關鍵步驟／概念有誤…"></textarea>'
            + '  <p class="ai-explain-status" id="ai-fb-status" hidden></p>'
            + '  <footer class="ai-explain-footer">'
            + '    <button type="button" class="btn btn-secondary" id="ai-fb-cancel">取消</button>'
            + '    <button type="button" class="btn btn-primary" id="ai-fb-save">儲存</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(feedbackOverlay);
        feedbackOverlay.addEventListener('click', function (event) {
            if (event.target === feedbackOverlay) closeFeedbackPrompt();
        });
        feedbackOverlay.querySelector('.ai-explain-close').addEventListener('click', closeFeedbackPrompt);
        feedbackOverlay.querySelector('#ai-fb-cancel').addEventListener('click', closeFeedbackPrompt);
        feedbackOverlay.querySelector('#ai-fb-save').addEventListener('click', saveFeedbackPrompt);
        return feedbackOverlay;
    }

    function openFeedbackPrompt(questionId, explanationId) {
        ensureFeedbackOverlay();
        feedbackOverlay.dataset.qid = String(questionId || '');
        feedbackOverlay.dataset.eid = String(explanationId || '');
        var ta = document.getElementById('ai-fb-text');
        if (ta) ta.value = '';
        var st = document.getElementById('ai-fb-status');
        if (st) {
            st.hidden = true;
            st.textContent = '';
        }
        feedbackOverlay.hidden = false;
        if (ta) ta.focus();
    }

    function closeFeedbackPrompt() {
        if (!feedbackOverlay) return;
        feedbackOverlay.hidden = true;
    }

    async function saveFeedbackPrompt() {
        if (!hasAiAccess()) return;
        var qid = feedbackOverlay && feedbackOverlay.dataset.qid;
        var eid = feedbackOverlay && feedbackOverlay.dataset.eid;
        var ta = document.getElementById('ai-fb-text');
        var text = ta ? String(ta.value || '').trim() : '';
        var st = document.getElementById('ai-fb-status');
        if (!text) {
            if (st) {
                st.hidden = false;
                st.textContent = '請輸入簡短原因';
                st.className = 'ai-explain-status is-error';
            }
            return;
        }
        var current = (modalState.explanations || []).filter(function (e) { return e && e.id === eid; })[0];
        var rating = current && current.myVote ? current.myVote : '';
        var saveBtn = document.getElementById('ai-fb-save');
        if (saveBtn) saveBtn.disabled = true;
        try {
            var data = await proxyAction({
                action: 'feedbackAiExplanation',
                questionId: qid,
                explanationId: eid,
                text: text,
                rating: rating
            }, 60000);
            if (!data || data.ok !== true) {
                if (st) {
                    st.hidden = false;
                    st.textContent = errorMessage(data && data.error);
                    st.className = 'ai-explain-status is-error';
                }
                return;
            }
            if (Array.isArray(data.explanations)) {
                replaceQuestionExplanations(qid, data.explanations);
            } else if (data.explanation) {
                mergeExplanationIntoStore(data.explanation);
            }
            refreshModalListFromStore();
            closeFeedbackPrompt();
            setModalStatus('已儲存 Feedback', 'ok');
        } catch (err) {
            if (st) {
                st.hidden = false;
                st.textContent = errorMessage(err && err.code);
                st.className = 'ai-explain-status is-error';
            }
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    // --- Legacy standalone admin header button (removed) ---
    // Admins use ReportIssue「回饋／回報」→ AI解釋 Feedback tab instead.
    function removeLegacyAiAdminHeaderButtons() {
        var host = document.querySelector('header');
        if (!host) return;
        var nodes = host.querySelectorAll('button');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var id = node.id || '';
            var label = (node.getAttribute('aria-label') || '').trim();
            var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
            var isLegacy = id === 'ai-explain-feedback-admin-btn'
                || id === 'ai-explain-feedback-admin-btn-retired'
                || label === '瀏覽 AI解釋 Feedback'
                || text === 'AI解釋 Feedback';
            if (!isLegacy) continue;
            // Never remove the hub button (different label / id).
            if (id === 'feedback-hub-admin-btn') continue;
            node.remove();
        }
        var leftover = document.getElementById('ai-explain-admin-overlay');
        if (leftover) leftover.remove();
    }

    // No-op kept for ReportIssue.openHub (previously closed the standalone overlay).
    function closeAdminPanel() {}

    function questionMatchesAiFilter(question, triAi) {
        if (!triAi || typeof triAi !== 'object') return true;
        var checked = Object.keys(triAi).filter(function (k) { return triAi[k] === 'checked'; });
        var excluded = Object.keys(triAi).filter(function (k) { return triAi[k] === 'excluded'; });
        if (!checked.length && !excluded.length) return true;
        var values = filterValuesForQuestion(question && question.id);

        if (checked.length) {
            var ok = checked.every(function (item) {
                return values.indexOf(item) !== -1;
            });
            if (!ok) return false;
        }
        if (excluded.length) {
            var blocked = excluded.some(function (item) {
                return values.indexOf(item) !== -1;
            });
            if (blocked) return false;
        }
        return true;
    }

    function clearAiTriFilters() {
        if (global.triStateFilters && global.triStateFilters.ai) {
            global.triStateFilters.ai = {};
        }
    }

    async function initAiExplanationFeature() {
        bindEscape();
        removeLegacyAiAdminHeaderButtons();
        if (hasAiAccess()) {
            await loadAiExplanations(false);
            if (typeof populateDynamicFilters === 'function') {
                await populateDynamicFilters();
            }
        } else {
            clearAiTriFilters();
            closeModal();
        }
    }

    // Public API
    function setDefaultDetailLevel(level) {
        defaultDetailLevel = normalizeDetailLevel(level);
        global.__userAiExplainStyle = defaultDetailLevel;
        return defaultDetailLevel;
    }

    global.AiExplanation = {
        LABEL_HAS: LABEL_HAS,
        LABEL_NONE: LABEL_NONE,
        LABEL_SHORT: LABEL_SHORT,
        LABEL_DETAILED: LABEL_DETAILED,
        hasAiAccess: hasAiAccess,
        load: loadAiExplanations,
        open: openModal,
        close: closeModal,
        filterValuesForQuestion: filterValuesForQuestion,
        questionHasExplanation: questionHasExplanation,
        questionMatchesAiFilter: questionMatchesAiFilter,
        summaryForQuestion: summaryForQuestion,
        closeAdminPanel: closeAdminPanel,
        setDefaultDetailLevel: setDefaultDetailLevel,
        init: initAiExplanationFeature,
        store: store
    };

    global.openAiExplanationModal = openModal;
    global.initAiExplanationFeature = initAiExplanationFeature;
    global.aiExplanationFilterValues = filterValuesForQuestion;
    global.questionMatchesAiFilter = questionMatchesAiFilter;

})(window);
