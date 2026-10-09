// stem-pattern-review.js
// Independent modal: multi-select 題幹 → AI review of stemPatterns (same
// Poe/OpenRouter settings as AI出題) → admin can apply edits locally.
//
// History is local only (localStorage). Never calls listAiBackups /
// writeGitAiBackup / getAiBackup. Server action: reviewStemPatterns.
//
// Access: button when accessRights.ai (like AI出題). Applying stemPatterns
// edits requires accessRights.admin. Non-admins may still run the AI review.
//
// Dependencies: PoeGenerate (proxyRequest, withProviderAndApiKey, settings),
// ConditionMatch (vocab), gatherFilterState / storage, refreshViews.

(function () {
    'use strict';

    var LOCAL_HISTORY_KEY = 'econ_stem_review_history_v1';
    var HISTORY_LIMIT = 20;
    var SEND_CAP = 20;
    var LIST_CAP = 400;
    var overlay = null;
    var selectedIds = {}; // id → true
    var loadedQuestions = []; // current picker rows
    var reviewBusy = false;
    var lastReply = '';
    var applyDraft = {}; // id → comma string for suggested stemPatterns

    function Poe() {
        return window.PoeGenerate || null;
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function hasAiAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (window.accessRights || null);
        return !!(rights && rights.ai === true);
    }

    function hasAdminAccess() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (window.accessRights || null);
        return !!(rights && rights.admin === true);
    }

    function stemText(question) {
        return String(
            (question && (question.plainText || question.questionTextChi || question.questionTextEng)) || ''
        ).trim();
    }

    function stemSnippet(question, maxLen) {
        var text = stemText(question).replace(/\s+/g, ' ');
        var limit = maxLen || 80;
        if (text.length <= limit) return text;
        return text.slice(0, limit - 1) + '…';
    }

    function listToComma(list) {
        return (Array.isArray(list) ? list : []).map(function (item) {
            return String(item == null ? '' : item).trim();
        }).filter(Boolean).join(', ');
    }

    function commaToList(text) {
        return String(text == null ? '' : text).split(',')
            .map(function (item) { return item.trim(); })
            .filter(Boolean);
    }

    function selectedIdList() {
        return Object.keys(selectedIds).filter(function (id) { return selectedIds[id]; });
    }

    function readHistory() {
        try {
            var raw = localStorage.getItem(LOCAL_HISTORY_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function writeHistory(records) {
        try {
            localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
        } catch (error) {
            // Quota — drop older half and retry once.
            try {
                localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(records.slice(0, Math.floor(HISTORY_LIMIT / 2))));
            } catch (err2) { /* ignore */ }
        }
    }

    function pushHistory(entry) {
        var username = '';
        var poe = Poe();
        if (poe && typeof poe.currentUsername === 'function') {
            username = poe.currentUsername();
        }
        var next = readHistory().filter(function (item) { return item.id !== entry.id; });
        next.unshift(Object.assign({ username: username }, entry));
        writeHistory(next);
        renderHistory();
    }

    function setStatus(text) {
        var node = document.getElementById('spr-status');
        if (node) node.textContent = text || '';
    }

    function setReply(text) {
        lastReply = text || '';
        var node = document.getElementById('spr-reply');
        if (!node) return;
        if (!lastReply) {
            node.innerHTML = '<p class="spr-empty">尚未送出審核。</p>';
            return;
        }
        if (window.PoeMarkdown && typeof window.PoeMarkdown.renderInto === 'function') {
            window.PoeMarkdown.renderInto(node, lastReply);
        } else {
            node.innerHTML = '<pre class="spr-pre">' + escapeHtml(lastReply) + '</pre>';
        }
    }

    function parseSuggestions(content) {
        var map = {};
        var text = String(content || '');
        var blocks = text.split(/###\s*編號\s*[:：]\s*/);
        for (var i = 1; i < blocks.length; i++) {
            var block = blocks[i];
            var idMatch = block.match(/^([^\n\r]+)/);
            if (!idMatch) continue;
            var id = String(idMatch[1] || '').trim();
            if (!id) continue;
            var suggestMatch = block.match(/建議\s*[:：]\s*([^\n\r]+)/);
            if (!suggestMatch) continue;
            var raw = String(suggestMatch[1] || '').trim();
            if (!raw || raw === '（空）' || raw === '(空)') {
                map[id] = '';
                continue;
            }
            var parts = raw.split('|').map(function (item) { return item.trim(); }).filter(Boolean);
            map[id] = parts.join(', ');
        }
        return map;
    }

    async function loadPickerQuestions() {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') {
            return [];
        }
        var filters = typeof gatherFilterState === 'function'
            ? gatherFilterState()
            : {};
        var questions = await window.storage.getQuestions(filters);
        if (!Array.isArray(questions)) return [];
        var sortSelect = document.getElementById('sort-order');
        var sortBy = sortSelect ? sortSelect.value : 'default';
        if (typeof sortQuestions === 'function') {
            questions = sortQuestions(questions, sortBy);
        }
        return questions;
    }

    async function collectVocabulary(seed) {
        var set = {};
        (seed || []).forEach(function (q) {
            (Array.isArray(q.stemPatterns) ? q.stemPatterns : []).forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (text) set[text] = true;
            });
        });
        try {
            if (window.ConditionMatch && typeof window.ConditionMatch.collectFieldValues === 'function'
                && window.storage && typeof window.storage.getQuestions === 'function') {
                var all = await window.storage.getQuestions({});
                window.ConditionMatch.collectFieldValues('stemPatterns', all).forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
            }
        } catch (error) {
            // Seed only.
        }
        return Object.keys(set).sort(function (a, b) {
            return a.localeCompare(b, 'zh-HK');
        }).slice(0, 120);
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'stem-pattern-review-overlay';
        overlay.className = 'spr-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="spr-dialog" role="dialog" aria-modal="true" aria-labelledby="spr-title">'
            + '  <div class="spr-header">'
            + '    <div class="spr-header-text">'
            + '      <h2 id="spr-title">題幹模式檢視</h2>'
            + '      <p class="spr-subtitle">多選題目後，用與「AI出題」相同的 API／模型設定，請 AI 審核 stemPatterns 是否正確、是否應共用模板，並建議字串。對話只存在本瀏覽器，不上傳 GitHub AI 備份。</p>'
            + '    </div>'
            + '    <button type="button" class="spr-close" aria-label="關閉">×</button>'
            + '  </div>'
            + '  <div class="spr-toolbar">'
            + '    <span id="spr-status" class="spr-status"></span>'
            + '    <div class="spr-toolbar-actions">'
            + '      <button type="button" class="btn btn-secondary btn-sm" id="spr-settings">API／模型設定</button>'
            + '      <button type="button" class="btn btn-secondary btn-sm" id="spr-reload">重新載入篩選</button>'
            + '    </div>'
            + '  </div>'
            + '  <div class="spr-main">'
            + '    <section class="spr-panel spr-picker">'
            + '      <div class="spr-panel-head">'
            + '        <h3>選擇題目</h3>'
            + '        <input type="search" id="spr-search" placeholder="搜尋編號或題幹…" autocomplete="off">'
            + '      </div>'
            + '      <div class="spr-picker-actions">'
            + '        <button type="button" class="btn btn-secondary btn-sm" id="spr-select-visible">全選可見</button>'
            + '        <button type="button" class="btn btn-secondary btn-sm" id="spr-clear-selected">清除選取</button>'
            + '        <span id="spr-selected-count" class="spr-muted">已選 0</span>'
            + '      </div>'
            + '      <div id="spr-list" class="spr-list"></div>'
            + '    </section>'
            + '    <section class="spr-panel spr-chat">'
            + '      <div class="spr-panel-head"><h3>AI 審核</h3></div>'
            + '      <label class="spr-note-label" for="spr-note">補充說明（選填）</label>'
            + '      <textarea id="spr-note" rows="2" maxlength="2000" placeholder="例如：請特別比較這幾題是否同一模板…"></textarea>'
            + '      <div class="spr-chat-actions">'
            + '        <button type="button" class="btn btn-primary" id="spr-run">送出審核</button>'
            + '        <button type="button" class="btn btn-secondary" id="spr-cancel-run" hidden>取消</button>'
            + '      </div>'
            + '      <div id="spr-reply" class="spr-reply"></div>'
            + '      <div class="spr-panel-head spr-hist-head"><h3>本機紀錄</h3></div>'
            + '      <div id="spr-history" class="spr-history"></div>'
            + '    </section>'
            + '    <section class="spr-panel spr-apply">'
            + '      <div class="spr-panel-head">'
            + '        <h3>套用 stemPatterns</h3>'
            + '        <span class="spr-muted" id="spr-apply-hint">需管理員權限才可儲存</span>'
            + '      </div>'
            + '      <div id="spr-apply-rows" class="spr-apply-rows"></div>'
            + '      <div class="spr-apply-actions">'
            + '        <button type="button" class="btn btn-secondary btn-sm" id="spr-fill-suggestions">填入 AI 建議</button>'
            + '        <button type="button" class="btn btn-primary" id="spr-save" disabled>儲存變更</button>'
            + '      </div>'
            + '    </section>'
            + '  </div>'
            + '  <div class="spr-footer">'
            + '    <button type="button" class="btn btn-secondary" id="spr-close-btn">關閉</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(overlay);

        var style = document.createElement('style');
        style.id = 'stem-pattern-review-styles';
        style.textContent = ''
            + '.spr-overlay{position:fixed;inset:0;z-index:12600;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(15,23,42,.55);}'
            + '.spr-overlay[hidden]{display:none!important;}'
            + '.spr-dialog{display:flex;flex-direction:column;width:min(1280px,100%);max-height:calc(100vh - 20px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 18px 48px rgba(15,23,42,.22);color:var(--text-color,#2c3e50);}'
            + '.spr-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border-light,#e0e0e0);}'
            + '.spr-header h2{margin:0 0 4px;font-size:20px;}'
            + '.spr-subtitle{margin:0;color:var(--text-light,#7f8c8d);font-size:13px;line-height:1.45;}'
            + '.spr-close{width:34px;height:34px;border:1px solid var(--border-light,#e0e0e0);border-radius:8px;background:#fff;font-size:20px;cursor:pointer;}'
            + '.spr-toolbar{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border-light,#e0e0e0);flex-wrap:wrap;}'
            + '.spr-toolbar-actions{display:flex;gap:8px;}'
            + '.spr-status{font-size:13px;color:var(--text-light,#7f8c8d);}'
            + '.spr-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(240px,1.1fr) minmax(260px,1.2fr) minmax(240px,1fr);gap:0;overflow:hidden;}'
            + '.spr-panel{display:flex;flex-direction:column;min-height:0;border-right:1px solid #e7eef5;padding:12px;background:#fff;}'
            + '.spr-panel:last-child{border-right:0;}'
            + '.spr-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}'
            + '.spr-panel-head h3{margin:0;font-size:15px;}'
            + '.spr-muted{font-size:12px;color:var(--text-light,#7f8c8d);}'
            + '#spr-search{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
            + '.spr-picker-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0;}'
            + '.spr-list{flex:1;min-height:0;overflow:auto;border:1px solid #e7eef5;border-radius:8px;background:#f8fafc;}'
            + '.spr-item{display:grid;grid-template-columns:auto 1fr;gap:8px;padding:8px 10px;border-bottom:1px solid #e7eef5;cursor:pointer;font-size:12px;}'
            + '.spr-item:hover{background:#eef5ff;}'
            + '.spr-item.is-selected{background:#e8f1ff;}'
            + '.spr-item-id{font-weight:700;}'
            + '.spr-item-stem{color:#334155;line-height:1.35;}'
            + '.spr-item-tags{color:#64748b;margin-top:2px;}'
            + '#spr-note{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;resize:vertical;}'
            + '.spr-note-label{display:block;font-size:12px;margin-bottom:4px;color:var(--text-light,#7f8c8d);}'
            + '.spr-chat-actions{display:flex;gap:8px;margin:8px 0;}'
            + '.spr-reply{flex:1;min-height:120px;overflow:auto;border:1px solid #e7eef5;border-radius:8px;padding:10px;background:#f8fafc;font-size:13px;}'
            + '.spr-empty{margin:0;color:var(--text-light,#7f8c8d);}'
            + '.spr-pre{white-space:pre-wrap;margin:0;font:inherit;}'
            + '.spr-hist-head{margin-top:10px;}'
            + '.spr-history{max-height:120px;overflow:auto;border:1px solid #e7eef5;border-radius:8px;}'
            + '.spr-hist-item{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-bottom:1px solid #eef2f7;background:#fff;font:inherit;font-size:12px;cursor:pointer;}'
            + '.spr-hist-item:hover{background:#eef5ff;}'
            + '.spr-apply-rows{flex:1;min-height:0;overflow:auto;border:1px solid #e7eef5;border-radius:8px;}'
            + '.spr-apply-row{padding:8px 10px;border-bottom:1px solid #e7eef5;font-size:12px;}'
            + '.spr-apply-row input[type="text"]{width:100%;box-sizing:border-box;margin-top:4px;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
            + '.spr-apply-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap;}'
            + '.spr-footer{display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--border-light,#e0e0e0);}'
            + '@media (max-width:980px){.spr-main{grid-template-columns:1fr;overflow:auto}.spr-panel{border-right:0;border-bottom:1px solid #e7eef5;max-height:none}}';
        document.head.appendChild(style);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeStemPatternReviewModal();
        });
        overlay.querySelector('.spr-close').addEventListener('click', closeStemPatternReviewModal);
        overlay.querySelector('#spr-close-btn').addEventListener('click', closeStemPatternReviewModal);
        overlay.querySelector('#spr-reload').addEventListener('click', function () {
            populatePicker();
        });
        overlay.querySelector('#spr-settings').addEventListener('click', function () {
            var poe = Poe();
            if (poe && typeof poe.openSettingsModal === 'function') poe.openSettingsModal(true);
            else window.alert('請先透過 AI出題 開啟 API／模型設定。');
        });
        overlay.querySelector('#spr-search').addEventListener('input', function () {
            renderPickerList();
        });
        overlay.querySelector('#spr-select-visible').addEventListener('click', selectVisible);
        overlay.querySelector('#spr-clear-selected').addEventListener('click', function () {
            selectedIds = {};
            renderPickerList();
            renderApplyRows();
            updateSelectedCount();
        });
        overlay.querySelector('#spr-run').addEventListener('click', runReview);
        overlay.querySelector('#spr-cancel-run').addEventListener('click', cancelReview);
        overlay.querySelector('#spr-fill-suggestions').addEventListener('click', fillSuggestionsFromReply);
        overlay.querySelector('#spr-save').addEventListener('click', saveStemPatternEdits);

        setReply('');
        return overlay;
    }

    function updateSelectedCount() {
        var node = document.getElementById('spr-selected-count');
        if (node) node.textContent = '已選 ' + selectedIdList().length;
        var saveBtn = document.getElementById('spr-save');
        if (saveBtn) {
            saveBtn.disabled = !hasAdminAccess() || !selectedIdList().length;
        }
        var hint = document.getElementById('spr-apply-hint');
        if (hint) {
            hint.textContent = hasAdminAccess()
                ? '儲存會寫入本機題庫（與單題表單相同路徑）'
                : '可檢視 AI 建議；儲存需管理員權限';
        }
    }

    function questionById(id) {
        for (var i = 0; i < loadedQuestions.length; i++) {
            if (String(loadedQuestions[i].id) === String(id)) return loadedQuestions[i];
        }
        return null;
    }

    function renderPickerList() {
        var host = document.getElementById('spr-list');
        if (!host) return;
        var needle = String((document.getElementById('spr-search') || {}).value || '')
            .trim().toLowerCase();
        var rows = loadedQuestions.filter(function (q) {
            if (!needle) return true;
            var id = String(q.id || '').toLowerCase();
            var stem = stemText(q).toLowerCase();
            var tags = listToComma(q.stemPatterns).toLowerCase();
            return id.indexOf(needle) !== -1 || stem.indexOf(needle) !== -1 || tags.indexOf(needle) !== -1;
        });
        if (!rows.length) {
            host.innerHTML = '<p class="spr-empty" style="padding:10px;">沒有符合的題目。</p>';
            return;
        }
        host.innerHTML = rows.map(function (q) {
            var id = String(q.id || '');
            var selected = !!selectedIds[id];
            var tags = listToComma(q.stemPatterns) || '（無 stemPatterns）';
            return ''
                + '<label class="spr-item' + (selected ? ' is-selected' : '') + '">'
                + '  <input type="checkbox" data-spr-id="' + escapeHtml(id) + '"' + (selected ? ' checked' : '') + '>'
                + '  <span>'
                + '    <div class="spr-item-id">' + escapeHtml(id || '（無編號）') + '</div>'
                + '    <div class="spr-item-stem">' + escapeHtml(stemSnippet(q, 100) || '（無題幹）') + '</div>'
                + '    <div class="spr-item-tags">' + escapeHtml(tags) + '</div>'
                + '  </span>'
                + '</label>';
        }).join('');
        host.querySelectorAll('input[data-spr-id]').forEach(function (box) {
            box.addEventListener('change', function () {
                var id = box.getAttribute('data-spr-id');
                if (box.checked) selectedIds[id] = true;
                else delete selectedIds[id];
                var label = box.closest('.spr-item');
                if (label) label.classList.toggle('is-selected', box.checked);
                updateSelectedCount();
                renderApplyRows();
            });
        });
    }

    function selectVisible() {
        var host = document.getElementById('spr-list');
        if (!host) return;
        host.querySelectorAll('input[data-spr-id]').forEach(function (box) {
            box.checked = true;
            selectedIds[box.getAttribute('data-spr-id')] = true;
            var label = box.closest('.spr-item');
            if (label) label.classList.add('is-selected');
        });
        updateSelectedCount();
        renderApplyRows();
    }

    function renderApplyRows() {
        var host = document.getElementById('spr-apply-rows');
        if (!host) return;
        var ids = selectedIdList();
        if (!ids.length) {
            host.innerHTML = '<p class="spr-empty" style="padding:10px;">先在左側選取題目。</p>';
            return;
        }
        host.innerHTML = ids.map(function (id) {
            var q = questionById(id);
            var current = q ? listToComma(q.stemPatterns) : '';
            var draft = applyDraft[id] != null ? applyDraft[id] : current;
            var reviewed = q && String(q.reviewedByAI || '').toUpperCase() === 'Y'
                ? ' <span class="spr-muted">（reviewedByAI=Y：建議合併而非清空）</span>'
                : '';
            return ''
                + '<div class="spr-apply-row" data-spr-apply-id="' + escapeHtml(id) + '">'
                + '  <div><strong>' + escapeHtml(id) + '</strong>' + reviewed + '</div>'
                + '  <div class="spr-muted">現行：' + escapeHtml(current || '（空）') + '</div>'
                + '  <input type="text" data-spr-apply-input value="' + escapeHtml(draft) + '" placeholder="stemPatterns，逗號分隔" autocomplete="off"'
                + (hasAdminAccess() ? '' : ' readonly') + '>'
                + '</div>';
        }).join('');
        host.querySelectorAll('[data-spr-apply-input]').forEach(function (input) {
            input.addEventListener('input', function () {
                var row = input.closest('[data-spr-apply-id]');
                if (!row) return;
                applyDraft[row.getAttribute('data-spr-apply-id')] = input.value;
            });
        });
    }

    function fillSuggestionsFromReply() {
        var map = parseSuggestions(lastReply);
        var count = 0;
        selectedIdList().forEach(function (id) {
            if (Object.prototype.hasOwnProperty.call(map, id)) {
                applyDraft[id] = map[id];
                count += 1;
            }
        });
        renderApplyRows();
        if (count) setStatus('已填入 ' + count + ' 題的 AI 建議（可再手動修改）。');
        else setStatus('回覆中找不到可解析的「建議：」列。請手動填寫，或確認 AI 使用建議格式。');
    }

    function renderHistory() {
        var host = document.getElementById('spr-history');
        if (!host) return;
        var poe = Poe();
        var username = poe && typeof poe.currentUsername === 'function' ? poe.currentUsername() : '';
        var rows = readHistory().filter(function (item) {
            return !username || item.username === username;
        }).slice(0, HISTORY_LIMIT);
        if (!rows.length) {
            host.innerHTML = '<p class="spr-empty" style="padding:8px;">尚無本機紀錄。</p>';
            return;
        }
        host.innerHTML = rows.map(function (item) {
            var when = item.createdAt ? new Date(item.createdAt).toLocaleString('zh-HK') : '';
            var label = when + ' · ' + (item.sentCount || 0) + ' 題 · ' + escapeHtml(item.model || '');
            return '<button type="button" class="spr-hist-item" data-spr-hist="' + escapeHtml(item.id) + '">' + label + '</button>';
        }).join('');
        host.querySelectorAll('[data-spr-hist]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-spr-hist');
                var found = rows.filter(function (item) { return item.id === id; })[0];
                if (!found) return;
                setReply(found.content || '');
                if (Array.isArray(found.questionIds)) {
                    selectedIds = {};
                    found.questionIds.forEach(function (qid) { selectedIds[String(qid)] = true; });
                    renderPickerList();
                    renderApplyRows();
                    updateSelectedCount();
                }
                setStatus('已載入本機紀錄（不上傳）。');
            });
        });
    }

    async function populatePicker() {
        setStatus('載入篩選結果…');
        loadedQuestions = await loadPickerQuestions();
        if (loadedQuestions.length > LIST_CAP) {
            setStatus('篩選結果有 ' + loadedQuestions.length + ' 題；列表最多顯示 ' + LIST_CAP + ' 題。');
            loadedQuestions = loadedQuestions.slice(0, LIST_CAP);
        } else {
            setStatus('已載入 ' + loadedQuestions.length + ' 題（目前篩選結果）。一次最多送審 ' + SEND_CAP + ' 題。');
        }
        // Drop selections that are no longer in the list.
        var alive = {};
        loadedQuestions.forEach(function (q) { alive[String(q.id)] = true; });
        Object.keys(selectedIds).forEach(function (id) {
            if (!alive[id]) delete selectedIds[id];
        });
        renderPickerList();
        renderApplyRows();
        updateSelectedCount();
        renderHistory();
    }

    var activeControl = null;

    function cancelReview() {
        var poe = Poe();
        if (activeControl) activeControl.cancelled = true;
        if (activeControl && activeControl.handle && typeof activeControl.handle.cancel === 'function') {
            activeControl.handle.cancel();
        }
        reviewBusy = false;
        var cancelBtn = document.getElementById('spr-cancel-run');
        if (cancelBtn) cancelBtn.hidden = true;
        var runBtn = document.getElementById('spr-run');
        if (runBtn) runBtn.disabled = false;
        setStatus('已取消。');
    }

    async function runReview() {
        if (reviewBusy) return;
        if (!hasAiAccess()) {
            window.alert('沒有 AI 使用權限。');
            return;
        }
        var poe = Poe();
        if (!poe || typeof poe.proxyRequest !== 'function') {
            window.alert('AI 出題模組尚未就緒。');
            return;
        }
        if (typeof poe.ensureApiKeyReady === 'function' && !poe.ensureApiKeyReady()) {
            return;
        }
        var ids = selectedIdList();
        if (!ids.length) {
            window.alert('請先選取至少一題。');
            return;
        }
        if (ids.length > SEND_CAP) {
            window.alert('一次最多送審 ' + SEND_CAP + ' 題（目前已選 ' + ids.length + '）。請減少選取。');
            return;
        }

        var questions = [];
        ids.forEach(function (id) {
            var q = questionById(id);
            if (!q) return;
            var stem = stemText(q);
            if (!stem) return;
            questions.push({
                id: q.id,
                examination: q.examination || '',
                year: q.year == null ? '' : String(q.year),
                questionType: q.questionType || '',
                concepts: Array.isArray(q.concepts) ? q.concepts.slice() : [],
                patterns: Array.isArray(q.patterns) ? q.patterns.slice() : [],
                stemPatterns: Array.isArray(q.stemPatterns) ? q.stemPatterns.slice() : [],
                question: stem
            });
        });
        if (!questions.length) {
            window.alert('選取的題目沒有可用題幹。');
            return;
        }

        reviewBusy = true;
        activeControl = { cancelled: false, handle: null };
        var cancelBtn = document.getElementById('spr-cancel-run');
        if (cancelBtn) cancelBtn.hidden = false;
        var runBtn = document.getElementById('spr-run');
        if (runBtn) runBtn.disabled = true;
        setStatus('正在送出審核（' + questions.length + ' 題）…');

        try {
            var vocabulary = await collectVocabulary(questions);
            var note = String((document.getElementById('spr-note') || {}).value || '').trim();
            var model = typeof poe.currentModel === 'function'
                ? poe.currentModel()
                : (typeof poe.readStoredModel === 'function' ? poe.readStoredModel() : '');
            var username = poe.currentUsername();
            var requestId = 'spr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
            var payload = poe.withProviderAndApiKey({
                action: 'reviewStemPatterns',
                username: username,
                questions: questions,
                vocabulary: vocabulary,
                note: note,
                model: model,
                requestId: requestId
            });
            var waitMs = poe.GENERATE_WAIT_MS || 375000;
            var data = await poe.proxyRequest(payload, waitMs, activeControl);
            if (!data || data.ok === false) {
                var code = data && data.error ? data.error : 'upstream_error';
                var msg = (poe.ERROR_TEXT && poe.ERROR_TEXT[code]) || ('審核失敗：' + code);
                if (typeof poe.focusApiKeyFieldIfMissing === 'function') {
                    poe.focusApiKeyFieldIfMissing(code);
                }
                window.alert(msg);
                setStatus(msg);
                return;
            }
            setReply(data.content || '');
            fillSuggestionsFromReply();
            pushHistory({
                id: requestId,
                createdAt: Date.now(),
                model: data.model || model,
                sentCount: data.sentCount || questions.length,
                questionIds: questions.map(function (q) { return q.id; }),
                content: data.content || '',
                note: note
            });
            setStatus('審核完成（本機已存紀錄；未上傳備份）。模型：' + (data.model || model || '—'));
        } catch (error) {
            if (error && error.code === 'cancelled') {
                setStatus('已取消。');
            } else {
                var errCode = error && error.code ? error.code : 'network';
                var errMsg = (poe.ERROR_TEXT && poe.ERROR_TEXT[errCode]) || ('審核失敗：' + errCode);
                window.alert(errMsg);
                setStatus(errMsg);
            }
        } finally {
            reviewBusy = false;
            activeControl = null;
            if (cancelBtn) cancelBtn.hidden = true;
            if (runBtn) runBtn.disabled = false;
        }
    }

    async function saveStemPatternEdits() {
        if (!hasAdminAccess()) {
            window.alert('只有管理員可以儲存 stemPatterns。');
            return;
        }
        if (!window.storage || typeof window.storage.updateQuestion !== 'function') {
            window.alert('資料庫尚未就緒。');
            return;
        }
        // Pull latest input values.
        var host = document.getElementById('spr-apply-rows');
        if (host) {
            host.querySelectorAll('[data-spr-apply-id]').forEach(function (row) {
                var id = row.getAttribute('data-spr-apply-id');
                var input = row.querySelector('[data-spr-apply-input]');
                if (input) applyDraft[id] = input.value;
            });
        }

        var updates = [];
        var warnings = [];
        selectedIdList().forEach(function (id) {
            var original = questionById(id);
            if (!original) return;
            var nextList = commaToList(applyDraft[id] != null ? applyDraft[id] : listToComma(original.stemPatterns));
            var prevList = Array.isArray(original.stemPatterns) ? original.stemPatterns.map(String) : [];
            var prevKey = prevList.map(function (s) { return s.trim(); }).filter(Boolean).join('\u0001');
            var nextKey = nextList.join('\u0001');
            if (prevKey === nextKey) return;

            var merged = nextList.slice();
            if (String(original.reviewedByAI || '').toUpperCase() === 'Y') {
                // Additive merge for reviewed rows (README invariant).
                var set = {};
                prevList.forEach(function (item) {
                    var text = String(item || '').trim();
                    if (text) set[text] = true;
                });
                nextList.forEach(function (item) {
                    var text = String(item || '').trim();
                    if (text) set[text] = true;
                });
                merged = Object.keys(set);
                if (!nextList.length && prevList.length) {
                    warnings.push(id + '（reviewedByAI=Y，拒絕清空；已保留原值）');
                    merged = prevList.slice();
                }
            }
            var mergedKey = merged.map(function (s) { return String(s).trim(); }).filter(Boolean).join('\u0001');
            if (mergedKey === prevKey) return;

            updates.push(Object.assign({}, original, {
                stemPatterns: merged,
                dateModified: new Date().toISOString()
            }));
        });

        if (!updates.length) {
            window.alert(warnings.length
                ? ('沒有可儲存的變更。\n' + warnings.join('\n'))
                : '沒有變更需要儲存。');
            return;
        }

        var confirmMsg = '即將更新 ' + updates.length + ' 題的 stemPatterns：\n\n'
            + updates.slice(0, 15).map(function (q) { return q.id; }).join('\n')
            + (updates.length > 15 ? '\n…' : '')
            + '\n\n只寫入本機題庫（不會因本功能上傳 AI 備份）。確定？';
        if (warnings.length) confirmMsg += '\n\n注意：\n' + warnings.join('\n');
        if (!window.confirm(confirmMsg)) return;

        setStatus('正在儲存…');
        try {
            for (var i = 0; i < updates.length; i++) {
                await window.storage.updateQuestion(updates[i]);
            }
            if (typeof refreshViews === 'function') await refreshViews();
            if (typeof maybeAutoSyncQuestions === 'function') {
                await maybeAutoSyncQuestions();
            }
            if (typeof showNotification === 'function') {
                showNotification('已更新 ' + updates.length + ' 題 stemPatterns', 'success');
            }
            await populatePicker();
            setStatus('已儲存 ' + updates.length + ' 題。');
        } catch (error) {
            console.error(error);
            window.alert('儲存失敗：' + (error && error.message ? error.message : '未知錯誤'));
            setStatus('儲存失敗');
        }
    }

    async function openStemPatternReviewModal() {
        if (!hasAiAccess()) {
            window.alert('沒有 AI 使用權限。');
            return;
        }
        ensureOverlay();
        overlay.hidden = false;
        document.body.classList.add('spr-open');
        await populatePicker();
    }

    function closeStemPatternReviewModal() {
        if (reviewBusy) {
            if (!window.confirm('審核進行中，確定關閉？')) return;
            cancelReview();
        }
        if (overlay) overlay.hidden = true;
        document.body.classList.remove('spr-open');
    }

    function showStemReviewButton() {
        var button = document.getElementById('stem-pattern-review-btn');
        if (button) button.hidden = false;
    }

    function hideStemReviewButton() {
        var button = document.getElementById('stem-pattern-review-btn');
        if (button) button.hidden = true;
    }

    function bindStemReviewButton() {
        var button = document.getElementById('stem-pattern-review-btn');
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', function () {
            openStemPatternReviewModal();
        });
    }

    // Hook into PoeGenerate show/hide so the entry appears with AI出題.
    function patchPoeButtonVisibility() {
        var poe = Poe();
        if (!poe || poe._stemReviewPatched) return;
        poe._stemReviewPatched = true;
        var origShow = poe.showGenerateButton;
        var origHide = poe.hideGenerateButton;
        poe.showGenerateButton = function () {
            if (typeof origShow === 'function') origShow.call(poe);
            showStemReviewButton();
        };
        poe.hideGenerateButton = function () {
            if (typeof origHide === 'function') origHide.call(poe);
            hideStemReviewButton();
        };
        // If AI already allowed, show now.
        if (document.body.classList.contains('poe-ai-allowed')) {
            showStemReviewButton();
        }
    }

    function initStemPatternReviewFeature() {
        bindStemReviewButton();
        patchPoeButtonVisibility();
        if (hasAiAccess() || document.body.classList.contains('poe-ai-allowed')) {
            showStemReviewButton();
        } else {
            hideStemReviewButton();
        }
    }

    window.openStemPatternReviewModal = openStemPatternReviewModal;
    window.closeStemPatternReviewModal = closeStemPatternReviewModal;
    window.initStemPatternReviewFeature = initStemPatternReviewFeature;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStemPatternReviewFeature);
    } else {
        initStemPatternReviewFeature();
    }
})();
