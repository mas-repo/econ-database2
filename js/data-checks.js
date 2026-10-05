// data-checks.js
// Admin-only data checks for ken.
//
// What this is
// ------------
// A small, independent panel that lists preset consistency checks over the
// loaded question bank. Each check is a free combination of conditions (AND).
// Matching questions that are not in that check's exception list are the ones
// that still need handling. Matching questions that are listed as exceptions
// are counted separately and are not part of the "needs handling" set.
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
// Edit DATA_CHECKS below only. Do not bury checks inside the UI helpers.
// - To add a check: append an object with id, name, conditions, exceptions.
// - To remove a check: delete that object from the array.
// - To change conditions: edit the conditions array (all entries are AND).
// - To exempt an ID: put the question id string in that check's exceptions.
//
// Check shape
// -----------
// {
//   id: 'stable-slug',
//   name: 'Short Traditional Chinese label',
//   conditions: [
//     { type: 'textContains', value: '機會成本' },      // question text has this
//     { type: 'textNotContains', value: '…' },         // question text lacks this
//     { type: 'conceptPresent', value: '機會成本' },   // concepts[] includes this
//     { type: 'conceptAbsent', value: '機會成本' }     // concepts[] lacks this
//   ],
//   // Question IDs (same format as question.id), e.g. 'DSE-2026-P1-01'.
//   // An exception still matches the conditions, but is excluded from the
//   // "needs handling" count / ID list. It still appears in the exception count.
//   exceptions: []
// }
//
// Concepts are matched with the same exact string includes() the filters use.
// Question text is taken from questionTextChi, questionTextEng, and plainText.
//
// Dependencies: auth / accessRights (visibility), IndexedDBStorage.getQuestions
// (data). Does not change question data.

(function () {
    'use strict';

    // =====================================================================
    // Preset checks — edit this list to add, change, or remove a check.
    // =====================================================================
    var DATA_CHECKS = [
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
    var overlay = null;
    var openDetails = {};

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

    function questionText(question) {
        return [
            question && question.questionTextChi,
            question && question.questionTextEng,
            question && question.plainText
        ].map(function (part) {
            return String(part == null ? '' : part);
        }).join('\n');
    }

    function hasConcept(question, concept) {
        if (!question || !Array.isArray(question.concepts)) return false;
        return question.concepts.includes(concept);
    }

    function matchesCondition(question, condition) {
        if (!condition || !condition.type) return false;
        var value = String(condition.value == null ? '' : condition.value);
        if (condition.type === 'textContains') {
            return questionText(question).indexOf(value) !== -1;
        }
        if (condition.type === 'textNotContains') {
            return questionText(question).indexOf(value) === -1;
        }
        if (condition.type === 'conceptPresent') {
            return hasConcept(question, value);
        }
        if (condition.type === 'conceptAbsent') {
            return !hasConcept(question, value);
        }
        return false;
    }

    function matchesCheck(question, check) {
        var conditions = (check && check.conditions) || [];
        if (!conditions.length) return false;
        for (var i = 0; i < conditions.length; i++) {
            if (!matchesCondition(question, conditions[i])) return false;
        }
        return true;
    }

    function exceptionSet(check) {
        var set = {};
        ((check && check.exceptions) || []).forEach(function (id) {
            var key = String(id == null ? '' : id).trim();
            if (key) set[key] = true;
        });
        return set;
    }

    function evaluateCheck(questions, check) {
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
        needs.sort(function (a, b) { return a.localeCompare(b, 'zh-HK'); });
        exceptions.sort(function (a, b) { return a.localeCompare(b, 'zh-HK'); });
        return {
            check: check,
            needsHandling: needs,
            exceptionIds: exceptions,
            needsCount: needs.length,
            exceptionCount: exceptions.length
        };
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
        button.className = 'btn btn-outline-primary';
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
        if (!allowed) closeDataChecksPanel();
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
            + '      <p class="data-checks-subtitle">列出仍需處理的題目（符合條件且不在該檢查的例外清單）。例外題仍符合條件，但另計、不列入待處理。</p>'
            + '    </div>'
            + '    <button type="button" class="data-checks-close" aria-label="關閉">×</button>'
            + '  </header>'
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
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDataChecksPanel();
            }
        });
        return overlay;
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function conditionSummary(check) {
        return ((check && check.conditions) || []).map(function (condition) {
            if (condition.type === 'textContains') return '題文含「' + condition.value + '」';
            if (condition.type === 'textNotContains') return '題文不含「' + condition.value + '」';
            if (condition.type === 'conceptPresent') return '概念有「' + condition.value + '」';
            if (condition.type === 'conceptAbsent') return '概念無「' + condition.value + '」';
            return String(condition.type || '');
        }).join(' 且 ');
    }

    function renderResults(results, totalQuestions) {
        var body = document.getElementById('data-checks-body');
        var note = document.getElementById('data-checks-footer-note');
        if (!body) return;
        body.textContent = '';
        if (!results.length) {
            var empty = document.createElement('p');
            empty.className = 'data-checks-empty';
            empty.textContent = '尚未設定任何檢查。請在 js/data-checks.js 的 DATA_CHECKS 新增。';
            body.appendChild(empty);
        } else {
            results.forEach(function (result) {
                var row = document.createElement('section');
                row.className = 'data-checks-row';
                row.setAttribute('data-check-id', result.check.id);

                var head = document.createElement('div');
                head.className = 'data-checks-row-head';
                var title = document.createElement('h3');
                title.className = 'data-checks-row-title';
                title.textContent = result.check.name;
                head.appendChild(title);

                var counts = document.createElement('div');
                counts.className = 'data-checks-counts';
                counts.innerHTML = ''
                    + '<span class="data-checks-count is-needs">待處理 <strong>' + result.needsCount + '</strong></span>'
                    + '<span class="data-checks-count is-exceptions">例外 <strong>' + result.exceptionCount + '</strong></span>';
                head.appendChild(counts);
                row.appendChild(head);

                var summary = document.createElement('p');
                summary.className = 'data-checks-row-summary';
                summary.textContent = conditionSummary(result.check);
                row.appendChild(summary);

                var details = document.createElement('details');
                details.className = 'data-checks-ids';
                if (openDetails[result.check.id]) details.open = true;
                details.addEventListener('toggle', function () {
                    openDetails[result.check.id] = details.open;
                });
                var summaryEl = document.createElement('summary');
                summaryEl.textContent = result.needsCount
                    ? ('查看待處理題目編號（' + result.needsCount + '）')
                    : '沒有待處理題目';
                details.appendChild(summaryEl);
                if (result.needsCount) {
                    var list = document.createElement('ul');
                    list.className = 'data-checks-id-list';
                    result.needsHandling.forEach(function (id) {
                        var item = document.createElement('li');
                        item.textContent = id;
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
                body.appendChild(row);
            });
        }
        if (note) {
            note.textContent = '已載入 ' + totalQuestions + ' 題 · 共 ' + results.length + ' 項檢查';
        }
    }

    async function openDataChecksPanel() {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        ensureOverlay();
        overlay.hidden = false;
        document.body.classList.add('data-checks-open');
        var body = document.getElementById('data-checks-body');
        if (body) {
            body.innerHTML = '<p class="data-checks-empty">正在檢查題目…</p>';
        }
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
        var results = DATA_CHECKS.map(function (check) {
            return evaluateCheck(questions, check);
        });
        renderResults(results, questions.length);
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
            + '  display: flex; flex-direction: column; width: min(820px, 100%);'
            + '  height: min(860px, calc(100vh - 24px)); background: #fff;'
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
            + '.data-checks-ids { margin-top: 10px; border-top: 1px solid #eef3f8; padding-top: 8px; }'
            + '.data-checks-ids summary { cursor: pointer; color: var(--secondary-color); font-size: 13px; font-weight: 700; }'
            + '.data-checks-id-list {'
            + '  margin: 10px 0 0; padding: 0; list-style: none; display: grid;'
            + '  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px 10px;'
            + '}'
            + '.data-checks-id-list li {'
            + '  margin: 0; padding: 6px 8px; border-radius: 8px; background: #f8fafc;'
            + '  border: 1px solid #e7eef5; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;'
            + '  font-size: 12px; line-height: 1.4; word-break: break-all;'
            + '}'
            + '.data-checks-empty { margin: 8px 0 0; color: var(--text-light); font-size: 13px; line-height: 1.55; }'
            + '.data-checks-footer {'
            + '  display: flex; align-items: center; justify-content: space-between; gap: 12px;'
            + '  padding: 12px 16px; border-top: 1px solid var(--border-light); background: #fff;'
            + '}'
            + '.data-checks-footer-note { margin: 0; color: var(--text-light); font-size: 13px; }'
            + '@media (max-width: 700px) {'
            + '  .data-checks-row-head { flex-direction: column; }'
            + '  .data-checks-counts { justify-content: flex-start; }'
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
    // Exposed for manual verification / future tooling; not used by the UI list editor.
    window.__DATA_CHECKS__ = DATA_CHECKS;
    window.__evaluateDataCheck__ = evaluateCheck;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDataChecksFeature);
    } else {
        initDataChecksFeature();
    }
})();
