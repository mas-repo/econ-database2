// AI解釋 — per-question explanations (generate / list / vote / feedback).
// Gate: accessRights.ai (same as AI出題; CSS class body.poe-ai-allowed).
// Persist: shared/data/ai-explanations.json via Apps Script + direct read.
// Admin Feedback UI is normally delegated to the 回饋／回報 hub
// (ReportIssue.setAdminUiDelegated); standalone admin overlay is fallback only.
// Depends: PoeGenerate (proxyRequest, withProviderAndApiKey, settings),
// shared-assets (fetchSharedJsonDirectOrProxy), access-rights, render.

(function (global) {
    'use strict';

    var AI_EXPLANATIONS_PATH = 'data/ai-explanations.json';
    var LABEL_HAS = '有AI解釋';
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
        busy: false,
        detailLevel: 'short',
        status: '',
        statusKind: ''
    };

    var overlay = null;
    var feedbackOverlay = null;
    var adminOverlay = null;
    var escapeHandlerBound = false;

    function hasAiAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (global.accessRights || null);
        return !!(rights && rights.ai === true);
    }

    function hasAdminAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (global.accessRights || null);
        return !!(rights && rights.admin === true);
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
    function filterValuesForQuestion(questionId) {
        var summary = summaryForQuestion(questionId);
        if (!summary.count) return [];
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
            + '    <button type="button" class="btn btn-primary btn-sm" id="ai-explain-generate-btn">產生新解釋</button>'
            + '  </div>'
            + '  <p class="ai-explain-status" id="ai-explain-status" hidden></p>'
            + '  <div class="ai-explain-list" id="ai-explain-list"></div>'
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
        overlay.querySelector('#ai-explain-generate-btn').addEventListener('click', onGenerateClick);
        overlay.addEventListener('change', function (event) {
            var input = event.target.closest('input[name="ai-explain-level"]');
            if (input) modalState.detailLevel = normalizeDetailLevel(input.value);
        });
        overlay.addEventListener('click', function (event) {
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

    function bindEscape() {
        if (escapeHandlerBound) return;
        escapeHandlerBound = true;
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (feedbackOverlay && !feedbackOverlay.hidden) {
                closeFeedbackPrompt();
                return;
            }
            if (adminOverlay && !adminOverlay.hidden) {
                closeAdminFeedback();
                return;
            }
            if (overlay && !overlay.hidden) closeModal();
        });
    }

    function renderExplanationList() {
        var box = document.getElementById('ai-explain-list');
        if (!box) return;
        var list = modalState.explanations || [];
        if (!list.length) {
            box.innerHTML = '<p class="ai-explain-empty">尚未有解釋。可選擇簡短或詳盡後產生。</p>';
            return;
        }
        box.innerHTML = list.map(function (exp) {
            var upActive = exp.myVote === 'up' ? ' is-active' : '';
            var downActive = exp.myVote === 'down' ? ' is-active' : '';
            return ''
                + '<article class="ai-explain-card" data-eid="' + esc(exp.id) + '">'
                + '  <header class="ai-explain-card-head">'
                + '    <span class="ai-explain-pill">' + esc(detailLevelLabel(exp.detailLevel)) + '</span>'
                + '    <span class="ai-explain-meta">' + esc(exp.model || '—') + '</span>'
                + '    <span class="ai-explain-meta">' + esc(formatWhen(exp.createdAt)) + '</span>'
                + (exp.createdBy ? '    <span class="ai-explain-meta">by ' + esc(exp.createdBy) + '</span>' : '')
                + '  </header>'
                + '  <div class="ai-explain-body">' + esc(exp.text).replace(/\n/g, '<br>') + '</div>'
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
        }).join('');
    }

    function refreshModalListFromStore() {
        modalState.explanations = listLocalExplanations(modalState.questionId);
        renderExplanationList();
    }

    async function openModal(questionId, trigger) {
        if (!hasAiAccess()) return;
        var qid = String(questionId || '');
        if (!qid) return;
        ensureOverlay();
        bindEscape();
        modalState.questionId = qid;
        modalState.busy = false;
        modalState.detailLevel = 'short';
        var levelShort = overlay.querySelector('input[name="ai-explain-level"][value="short"]');
        var levelDetailed = overlay.querySelector('input[name="ai-explain-level"][value="detailed"]');
        if (levelShort) levelShort.checked = true;
        if (levelDetailed) levelDetailed.checked = false;
        var qidEl = document.getElementById('ai-explain-qid');
        if (qidEl) qidEl.textContent = '題目 ' + qid;
        setModalStatus(store.loaded ? '' : '載入過往解釋…', store.loaded ? '' : 'info');
        overlay.hidden = false;
        document.body.classList.add('ai-explain-open');
        if (trigger && trigger.focus) overlay.dataset.trigger = '1';

        await loadAiExplanations(false);
        if (modalState.questionId !== qid) return;
        refreshModalListFromStore();
        if (store.loadError) {
            setModalStatus('過往解釋載入不完整，仍可嘗試產生新解釋。', 'warn');
        } else {
            setModalStatus('', '');
        }
    }

    function closeModal() {
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('ai-explain-open');
        modalState.questionId = '';
        modalState.explanations = [];
        modalState.busy = false;
        setModalStatus('', '');
    }

    async function onGenerateClick() {
        if (!hasAiAccess() || modalState.busy) return;
        var poe = proxy();
        if (poe && typeof poe.ensureApiKeyReady === 'function' && !poe.ensureApiKeyReady()) {
            setModalStatus(errorMessage('missing_api_key'), 'error');
            return;
        }
        var qid = modalState.questionId;
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
        modalState.busy = true;
        var btn = document.getElementById('ai-explain-generate-btn');
        if (btn) btn.disabled = true;
        setModalStatus('正在產生 AI解釋…', 'info');
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
                detailLevel: modalState.detailLevel,
                model: model,
                question: ref
            }, waitMs);
            if (!data || data.ok !== true) {
                setModalStatus(errorMessage(data && data.error), 'error');
                return;
            }
            if (Array.isArray(data.explanations)) {
                replaceQuestionExplanations(qid, data.explanations);
            } else if (data.explanation) {
                mergeExplanationIntoStore(data.explanation);
            }
            refreshModalListFromStore();
            if (data.persisted === false) {
                setModalStatus('已產生，但未能寫入共用檔（' + errorMessage(data.error || 'github_error') + '）', 'warn');
            } else {
                setModalStatus('已產生並儲存', 'ok');
            }
            if (typeof populateDynamicFilters === 'function') populateDynamicFilters();
        } catch (err) {
            setModalStatus(errorMessage(err && err.code), 'error');
        } finally {
            modalState.busy = false;
            if (btn) btn.disabled = false;
        }
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

    // --- Admin feedback browser ---
    // When ReportIssue owns the combined「回饋／回報」hub, skip the standalone
    // AI-only button (setAdminUiDelegated(true)).

    var adminUiDelegated = false;

    function setAdminUiDelegated(flag) {
        adminUiDelegated = !!flag;
        if (adminUiDelegated) {
            var legacy = document.getElementById('ai-explain-feedback-admin-btn');
            if (legacy) legacy.hidden = true;
            closeAdminFeedback();
        } else {
            refreshAdminButton();
        }
    }

    function ensureAdminButton() {
        if (adminUiDelegated) return null;
        var host = document.querySelector('header div[style*="flex-wrap"]') ||
            document.querySelector('header');
        if (!host) return null;
        var button = document.getElementById('ai-explain-feedback-admin-btn');
        if (button) return button;
        button = document.createElement('button');
        button.type = 'button';
        button.id = 'ai-explain-feedback-admin-btn';
        button.className = 'btn btn-outline-primary';
        button.hidden = true;
        button.textContent = 'AI解釋 Feedback';
        button.setAttribute('aria-label', '瀏覽 AI解釋 Feedback');
        button.addEventListener('click', openAdminFeedback);
        var anchor = document.getElementById('data-checks-btn') || document.getElementById('admin-mode-btn');
        if (anchor && anchor.parentNode === host) {
            host.insertBefore(button, anchor.nextSibling);
        } else {
            host.appendChild(button);
        }
        return button;
    }

    function refreshAdminButton() {
        if (adminUiDelegated) {
            var legacy = document.getElementById('ai-explain-feedback-admin-btn');
            if (legacy) legacy.hidden = true;
            return;
        }
        var button = ensureAdminButton();
        if (!button) return;
        var allowed = hasAdminAccess();
        button.hidden = !allowed;
        if (!allowed) closeAdminFeedback();
    }

    function ensureAdminOverlay() {
        if (adminOverlay) return adminOverlay;
        adminOverlay = document.createElement('div');
        adminOverlay.id = 'ai-explain-admin-overlay';
        adminOverlay.className = 'ai-explain-overlay';
        adminOverlay.hidden = true;
        adminOverlay.innerHTML = ''
            + '<div class="ai-explain-dialog ai-explain-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-admin-title">'
            + '  <header class="ai-explain-header">'
            + '    <div>'
            + '      <h2 id="ai-admin-title">AI解釋 Feedback</h2>'
            + '      <p class="ai-explain-subtitle">使用者對解釋的文字回饋與投票摘要（最新在前）。</p>'
            + '    </div>'
            + '    <button type="button" class="ai-explain-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="ai-explain-admin-toolbar">'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="ai-admin-refresh">重新載入</button>'
            + '  </div>'
            + '  <p class="ai-explain-status" id="ai-admin-status" hidden></p>'
            + '  <div class="ai-explain-admin-list" id="ai-admin-list"></div>'
            + '  <footer class="ai-explain-footer">'
            + '    <button type="button" class="btn btn-secondary" id="ai-admin-done">關閉</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(adminOverlay);
        adminOverlay.addEventListener('click', function (event) {
            if (event.target === adminOverlay) closeAdminFeedback();
        });
        adminOverlay.querySelector('.ai-explain-close').addEventListener('click', closeAdminFeedback);
        adminOverlay.querySelector('#ai-admin-done').addEventListener('click', closeAdminFeedback);
        adminOverlay.querySelector('#ai-admin-refresh').addEventListener('click', function () {
            loadAdminFeedback(true);
        });
        return adminOverlay;
    }

    function closeAdminFeedback() {
        if (!adminOverlay) return;
        adminOverlay.hidden = true;
    }

    async function openAdminFeedback() {
        if (!hasAdminAccess()) return;
        ensureAdminOverlay();
        bindEscape();
        adminOverlay.hidden = false;
        await loadAdminFeedback(true);
    }

    async function loadAdminFeedback() {
        var list = document.getElementById('ai-admin-list');
        var st = document.getElementById('ai-admin-status');
        if (list) list.innerHTML = '<p class="ai-explain-empty">載入中…</p>';
        if (st) {
            st.hidden = true;
            st.textContent = '';
        }
        try {
            var data = await proxyAction({ action: 'listAiExplanationFeedback' }, 60000);
            if (!data || data.ok !== true) {
                if (list) list.innerHTML = '';
                if (st) {
                    st.hidden = false;
                    st.textContent = errorMessage(data && data.error);
                    st.className = 'ai-explain-status is-error';
                }
                return;
            }
            var rows = Array.isArray(data.rows) ? data.rows : [];
            if (!rows.length) {
                if (list) list.innerHTML = '<p class="ai-explain-empty">尚未有 Feedback。</p>';
                return;
            }
            if (list) {
                list.innerHTML = rows.map(function (row) {
                    var rating = row.rating === 'up' ? '👍' : (row.rating === 'down' ? '👎' : '—');
                    return ''
                        + '<article class="ai-explain-admin-row">'
                        + '  <div class="ai-explain-admin-meta">'
                        + '    <strong>' + esc(row.questionId || '') + '</strong>'
                        + '    <span>' + esc(detailLevelLabel(row.detailLevel)) + '</span>'
                        + '    <span>' + esc(row.model || '') + '</span>'
                        + '    <span>👍' + esc(String(row.upCount || 0)) + ' 👎' + esc(String(row.downCount || 0)) + '</span>'
                        + '  </div>'
                        + '  <p class="ai-explain-admin-snippet">' + esc(row.explanationSnippet || '') + '</p>'
                        + '  <div class="ai-explain-admin-fb">'
                        + '    <span>' + rating + '</span>'
                        + '    <span>' + esc(row.user || '') + '</span>'
                        + '    <span>' + esc(formatWhen(row.at)) + '</span>'
                        + '  </div>'
                        + '  <p class="ai-explain-admin-text">' + esc(row.text || '') + '</p>'
                        + '</article>';
                }).join('');
            }
        } catch (err) {
            if (list) list.innerHTML = '';
            if (st) {
                st.hidden = false;
                st.textContent = errorMessage(err && err.code);
                st.className = 'ai-explain-status is-error';
            }
        }
    }

    function questionMatchesAiFilter(question, triAi) {
        if (!triAi || typeof triAi !== 'object') return true;
        var checked = Object.keys(triAi).filter(function (k) { return triAi[k] === 'checked'; });
        var excluded = Object.keys(triAi).filter(function (k) { return triAi[k] === 'excluded'; });
        if (!checked.length && !excluded.length) return true;
        var values = filterValuesForQuestion(question && question.id);
        var has = values.indexOf(LABEL_HAS) !== -1;

        if (checked.length) {
            var ok = checked.every(function (item) {
                if (item === LABEL_HAS) return has;
                return values.indexOf(item) !== -1;
            });
            if (!ok) return false;
        }
        if (excluded.length) {
            var blocked = excluded.some(function (item) {
                if (item === LABEL_HAS) return has;
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
        ensureAdminButton();
        refreshAdminButton();
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
    global.AiExplanation = {
        LABEL_HAS: LABEL_HAS,
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
        refreshAdminButton: refreshAdminButton,
        setAdminUiDelegated: setAdminUiDelegated,
        closeAdminPanel: closeAdminFeedback,
        init: initAiExplanationFeature,
        store: store
    };

    global.openAiExplanationModal = openModal;
    global.initAiExplanationFeature = initAiExplanationFeature;
    global.aiExplanationFilterValues = filterValuesForQuestion;
    global.questionMatchesAiFilter = questionMatchesAiFilter;

})(window);
