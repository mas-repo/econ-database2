// advanced-filter.js
// 「進階篩選」for the 題目 tab — available to every signed-in user.
// Local-only: conditions live in memory / optional localStorage cache for
// this browser. Never calls syncDataChecks* or writes econ-database-data.
//
// UI mirrors data-checks condition rows (包含/不包括 + field + value, AND).
// Apply intersects with existing filters via window.advancedFilter.
//
// Dependencies: ConditionMatch, question-list-filter.js, storage.

(function () {
    'use strict';

    var LOCAL_KEY = 'econ_advanced_filter_v1';
    var overlay = null;
    var rowSeq = 0;
    var draftConditions = [];

    function Match() {
        return window.ConditionMatch || null;
    }

    function escapeAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function readLocalDraft() {
        try {
            var raw = localStorage.getItem(LOCAL_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            var list = Array.isArray(parsed) ? parsed : (parsed && parsed.conditions);
            var m = Match();
            return m ? m.normalizeConditions(list) : (list || []);
        } catch (error) {
            return [];
        }
    }

    function writeLocalDraft(conditions) {
        try {
            var m = Match();
            var list = m ? m.normalizeConditions(conditions) : (conditions || []);
            localStorage.setItem(LOCAL_KEY, JSON.stringify({ version: 1, conditions: list }));
        } catch (error) {
            // Cache only.
        }
    }

    function currentQuestions() {
        return new Promise(function (resolve) {
            if (!window.storage || typeof window.storage.getQuestions !== 'function') {
                resolve([]);
                return;
            }
            window.storage.getQuestions({}).then(function (questions) {
                if (window.storage.applyPermissionFilter) {
                    questions = window.storage.applyPermissionFilter(questions || []);
                }
                resolve(Array.isArray(questions) ? questions : []);
            }).catch(function () {
                resolve([]);
            });
        });
    }

    function fieldSelectHtml(selected) {
        var m = Match();
        var fields = (m && m.FIELDS) || [];
        return fields.map(function (def) {
            var sel = def.id === selected ? ' selected' : '';
            return '<option value="' + escapeAttr(def.id) + '"' + sel + '>' + escapeAttr(def.label) + '</option>';
        }).join('');
    }

    function conditionRowHtml(condition) {
        var m = Match();
        var normalized = m ? m.normalizeCondition(condition) : condition;
        var include = !(normalized && normalized.include === false);
        var field = (normalized && normalized.field) || 'text';
        var value = normalized && normalized.value != null ? normalized.value : '';
        var def = m && m.FIELD_BY_ID ? m.FIELD_BY_ID[field] : null;
        rowSeq += 1;
        var listId = 'af-ac-' + rowSeq;
        var listAttr = def && def.autocomplete ? (' list="' + escapeAttr(listId) + '"') : '';
        var placeholder = def && def.autocomplete ? '從已載入題庫選擇或輸入' : '字串（題文自由輸入）';
        return ''
            + '<div class="af-cond-row" data-af-cond-row="1">'
            + '  <div class="af-cond-pair" role="group" aria-label="包含或不包括">'
            + '    <label class="af-check"><input type="checkbox" data-af-include value="include"' + (include ? ' checked' : '') + '>包含</label>'
            + '    <label class="af-check"><input type="checkbox" data-af-include value="exclude"' + (include ? '' : ' checked') + '>不包括</label>'
            + '  </div>'
            + '  <label class="af-field-select">'
            + '    <span>欄位</span>'
            + '    <select data-af-field aria-label="條件欄位">' + fieldSelectHtml(field) + '</select>'
            + '  </label>'
            + '  <div class="af-value-wrap">'
            + '    <input type="text" data-af-value value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(placeholder) + '"' + listAttr + ' autocomplete="off">'
            + '    <datalist id="' + escapeAttr(listId) + '"></datalist>'
            + '  </div>'
            + '  <button type="button" class="btn btn-secondary btn-sm" data-af-remove-cond title="移除條件">✕</button>'
            + '</div>';
    }

    function enforceExclusive(changed) {
        if (!changed) return;
        var row = changed.closest('[data-af-cond-row]');
        if (!row) return;
        if (!changed.checked) {
            var any = false;
            row.querySelectorAll('input[data-af-include]').forEach(function (box) {
                if (box.checked) any = true;
            });
            if (!any) changed.checked = true;
            return;
        }
        row.querySelectorAll('input[data-af-include]').forEach(function (box) {
            if (box !== changed) box.checked = false;
        });
    }

    async function refreshAutocomplete(row) {
        if (!row) return;
        var m = Match();
        var fieldEl = row.querySelector('[data-af-field]');
        var valueEl = row.querySelector('[data-af-value]');
        var list = row.querySelector('datalist');
        if (!fieldEl || !valueEl || !list || !m) return;
        var fieldId = m.resolveFieldId(fieldEl.value) || 'text';
        var def = m.FIELD_BY_ID[fieldId];
        list.innerHTML = '';
        if (!def || !def.autocomplete) {
            valueEl.removeAttribute('list');
            valueEl.placeholder = '字串（題文自由輸入）';
            return;
        }
        valueEl.setAttribute('list', list.id);
        valueEl.placeholder = '從已載入題庫選擇或輸入';
        var questions = await currentQuestions();
        m.collectFieldValues(fieldId, questions).forEach(function (value) {
            var opt = document.createElement('option');
            opt.value = value;
            list.appendChild(opt);
        });
    }

    function readRows() {
        if (!overlay) return [];
        var m = Match();
        var out = [];
        overlay.querySelectorAll('[data-af-cond-row]').forEach(function (row) {
            var includeBox = row.querySelector('input[data-af-include]:checked');
            var fieldEl = row.querySelector('[data-af-field]');
            var valueEl = row.querySelector('[data-af-value]');
            var include = !(includeBox && includeBox.value === 'exclude');
            var field = m ? m.resolveFieldId(fieldEl && fieldEl.value) : (fieldEl && fieldEl.value);
            var normalized = m
                ? m.normalizeCondition({ include: include, field: field, value: valueEl ? valueEl.value : '' })
                : { include: include, field: field, value: valueEl ? valueEl.value : '' };
            if (normalized) out.push(normalized);
        });
        return out;
    }

    function renderBody() {
        var body = document.getElementById('af-body');
        if (!body) return;
        var list = draftConditions.length ? draftConditions : [{ include: true, field: 'text', value: '' }];
        body.innerHTML = list.map(conditionRowHtml).join('');
        body.querySelectorAll('[data-af-cond-row]').forEach(function (row) {
            refreshAutocomplete(row);
        });
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'advanced-filter-overlay';
        overlay.className = 'af-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="af-dialog" role="dialog" aria-modal="true" aria-labelledby="af-title">'
            + '  <header class="af-header">'
            + '    <div>'
            + '      <h2 id="af-title">進階篩選</h2>'
            + '      <p class="af-subtitle">以包含／不包括與欄位條件篩選題目（條件全部 AND）。設定只保存在本瀏覽器，不會同步到共用資料庫。</p>'
            + '    </div>'
            + '    <button type="button" class="af-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="af-toolbar">'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="af-add-cond">＋ 條件</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" id="af-clear-conds">清空條件</button>'
            + '  </div>'
            + '  <div class="af-body" id="af-body"></div>'
            + '  <footer class="af-footer">'
            + '    <button type="button" class="btn btn-secondary" id="af-clear-layer">清除進階篩選</button>'
            + '    <button type="button" class="btn btn-primary" id="af-apply">套用條件</button>'
            + '    <button type="button" class="btn btn-secondary" id="af-done">關閉</button>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);

        var style = document.createElement('style');
        style.id = 'advanced-filter-styles';
        style.textContent = ''
            + '.af-overlay{position:fixed;inset:0;z-index:12400;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);}'
            + '.af-overlay[hidden]{display:none!important;}'
            + '.af-dialog{display:flex;flex-direction:column;width:min(860px,100%);max-height:calc(100vh - 24px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.28);}'
            + '.af-header{display:flex;justify-content:space-between;gap:12px;padding:18px 20px 12px;border-bottom:1px solid #e7eef5;}'
            + '.af-header h2{margin:0 0 6px;color:var(--primary-color);font-size:20px;}'
            + '.af-subtitle{margin:0;color:var(--text-light);font-size:13px;line-height:1.5;}'
            + '.af-close{width:34px;height:34px;border:1px solid #e7eef5;border-radius:999px;background:#fff;font-size:20px;}'
            + '.af-toolbar{display:flex;gap:8px;padding:10px 16px;border-bottom:1px solid #e7eef5;}'
            + '.af-body{flex:1;min-height:0;overflow:auto;padding:14px 16px 20px;background:#f4f7fb;display:grid;gap:10px;}'
            + '.af-cond-row{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;padding:8px;border:1px solid #e7eef5;border-radius:10px;background:#fff;}'
            + '.af-cond-pair,.af-field-select{display:inline-flex;flex:0 0 auto;align-items:center;gap:8px;white-space:nowrap;}'
            + '.af-field-select select{width:auto;padding:7px 8px;border:1px solid #d7e3ef;border-radius:8px;field-sizing:content;}'
            + '.af-value-wrap{flex:1 1 auto;min-width:0;}'
            + '.af-value-wrap input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7e3ef;border-radius:8px;}'
            + '.af-check{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--primary-color);}'
            + '.af-footer{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #e7eef5;background:#fff;}'
            + '@media (max-width:700px){.af-cond-row{flex-wrap:wrap}.af-value-wrap{flex-basis:100%}}';
        document.head.appendChild(style);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeAdvancedFilterModal();
        });
        overlay.querySelector('.af-close').addEventListener('click', closeAdvancedFilterModal);
        overlay.querySelector('#af-done').addEventListener('click', closeAdvancedFilterModal);
        overlay.querySelector('#af-add-cond').addEventListener('click', function () {
            draftConditions = readRows();
            draftConditions.push({ include: true, field: 'text', value: '' });
            renderBody();
        });
        overlay.querySelector('#af-clear-conds').addEventListener('click', function () {
            draftConditions = [{ include: true, field: 'text', value: '' }];
            renderBody();
        });
        overlay.querySelector('#af-clear-layer').addEventListener('click', function () {
            if (typeof clearAdvancedConditionFilter === 'function') clearAdvancedConditionFilter();
            writeLocalDraft([]);
            draftConditions = [{ include: true, field: 'text', value: '' }];
            renderBody();
        });
        overlay.querySelector('#af-apply').addEventListener('click', function () {
            var conditions = readRows().filter(function (condition) {
                return String(condition.value == null ? '' : condition.value).length > 0;
            });
            if (!conditions.length) {
                window.alert('請至少填寫一項有內容的條件。');
                return;
            }
            draftConditions = conditions;
            writeLocalDraft(conditions);
            if (typeof applyAdvancedConditionFilter === 'function') {
                applyAdvancedConditionFilter(conditions, { clearIdSet: false });
            }
            closeAdvancedFilterModal();
        });
        overlay.addEventListener('click', function (event) {
            var remove = event.target.closest('[data-af-remove-cond]');
            if (!remove) return;
            var rows = overlay.querySelectorAll('[data-af-cond-row]');
            if (rows.length <= 1) {
                window.alert('請至少保留一項條件。');
                return;
            }
            var row = remove.closest('[data-af-cond-row]');
            if (row) row.remove();
        });
        overlay.addEventListener('change', function (event) {
            var includeBox = event.target.closest('input[data-af-include]');
            if (includeBox) {
                enforceExclusive(includeBox);
                return;
            }
            var fieldSelect = event.target.closest('select[data-af-field]');
            if (fieldSelect) refreshAutocomplete(fieldSelect.closest('[data-af-cond-row]'));
        });
        return overlay;
    }

    function openAdvancedFilterModal() {
        if (!Match()) {
            window.alert('進階篩選尚未載入。');
            return;
        }
        ensureOverlay();
        var active = window.advancedFilter && window.advancedFilter.active
            ? window.advancedFilter.conditions
            : readLocalDraft();
        draftConditions = active && active.length ? active : [{ include: true, field: 'text', value: '' }];
        renderBody();
        overlay.hidden = false;
        document.body.classList.add('af-open');
    }

    function closeAdvancedFilterModal() {
        if (overlay) overlay.hidden = true;
        document.body.classList.remove('af-open');
    }

    window.openAdvancedFilterModal = openAdvancedFilterModal;
    window.closeAdvancedFilterModal = closeAdvancedFilterModal;
})();
