// data-checks.js
// Admin-only data checks for ken.
//
// What this is
// ------------
// A small, independent panel that lists consistency checks over the loaded
// question bank. Each check is a free combination of conditions (AND).
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
// Prefer the in-panel UI (標題、條件、例外、新增檢查). Edits are saved to
// localStorage for the signed-in username and survive reloads.
//
// The DEFAULT_DATA_CHECKS list below remains the seed / fallback when ken has
// no saved edits. You can still edit that list in source:
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
// Saved under localStorage key econ_data_checks_v1:<username> (JSON). Only the
// current user's key is read/written, so other users are unaffected. Question
// bank data is never written.
//
// Clicking a needs-handling ID clears the question filters, sets search scope
// to 題目 ID, fills that id, switches to the 題目 tab, and runs filterQuestions
// — the same filter path the rest of the app uses.
//
// Concepts and other category fields use the same exact-value match the
// filters use (array includes / scalar equality). Question text (字串) is a
// substring of questionTextChi, questionTextEng, and plainText.
//
// Dependencies: auth / accessRights (visibility), IndexedDBStorage.getQuestions
// (data), filters.js clearFilters / filterQuestions, tabs switchTab. Does not
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
    // Real filterable fields from the question bank / filter UI.
    // id is what we store on the condition; prop is the question property when needed.
    var CONDITION_FIELDS = [
        { id: 'text', label: '字串', kind: 'text', autocomplete: false },
        { id: 'concepts', label: '概念', kind: 'array', prop: 'concepts', autocomplete: true },
        { id: 'patterns', label: '題型', kind: 'array', prop: 'patterns', autocomplete: true },
        { id: 'stemPatterns', label: '題幹模式', kind: 'array', prop: 'stemPatterns', autocomplete: true },
        { id: 'curriculumClassification', label: '課程分類', kind: 'array', prop: 'curriculumClassification', autocomplete: true },
        { id: 'AristochapterClassification', label: 'Chapters', kind: 'array', prop: 'AristochapterClassification', autocomplete: true },
        { id: 'graphType', label: '圖表類型', kind: 'scalar', prop: 'graphType', autocomplete: true },
        { id: 'tableType', label: '表格類型', kind: 'scalar', prop: 'tableType', autocomplete: true },
        { id: 'calculationType', label: '計算類型', kind: 'scalar', prop: 'calculationType', autocomplete: true },
        { id: 'multipleSelectionType', label: '複選類型', kind: 'scalar', prop: 'multipleSelectionType', autocomplete: true },
        { id: 'questionType', label: '題目類型', kind: 'scalar', prop: 'questionType', autocomplete: true },
        { id: 'examination', label: '考試', kind: 'scalar', prop: 'examination', autocomplete: true },
        { id: 'year', label: '年份', kind: 'scalar', prop: 'year', autocomplete: true },
        { id: 'paper', label: '卷別', kind: 'scalar', prop: 'paper', autocomplete: true },
        { id: 'section', label: 'Section', kind: 'scalar', prop: 'section', autocomplete: true },
        { id: 'publisher', label: '出版商', kind: 'scalar', prop: 'publisher', autocomplete: true },
        { id: 'feature', label: '特徵', kind: 'feature', autocomplete: true }
    ];
    var CONDITION_FIELD_BY_ID = {};
    CONDITION_FIELDS.forEach(function (def) {
        CONDITION_FIELD_BY_ID[def.id] = def;
    });
    var LEGACY_TYPE_TO_CHOICE = {
        textContains: { include: true, field: 'text' },
        textNotContains: { include: false, field: 'text' },
        conceptPresent: { include: true, field: 'concepts' },
        conceptAbsent: { include: false, field: 'concepts' }
    };
    var FIELD_ALIASES = {
        text: 'text',
        string: 'text',
        '字串': 'text',
        concept: 'concepts',
        concepts: 'concepts',
        '概念': 'concepts',
        patterns: 'patterns',
        stempatterns: 'stemPatterns',
        stemPatterns: 'stemPatterns',
        curriculum: 'curriculumClassification',
        curriculumclassification: 'curriculumClassification',
        curriculumClassification: 'curriculumClassification',
        chapter: 'AristochapterClassification',
        chapters: 'AristochapterClassification',
        aristochapterclassification: 'AristochapterClassification',
        AristochapterClassification: 'AristochapterClassification',
        graph: 'graphType',
        graphtype: 'graphType',
        graphType: 'graphType',
        table: 'tableType',
        tabletype: 'tableType',
        tableType: 'tableType',
        calculation: 'calculationType',
        calculationtype: 'calculationType',
        calculationType: 'calculationType',
        multipleselection: 'multipleSelectionType',
        multipleselectiontype: 'multipleSelectionType',
        multipleSelectionType: 'multipleSelectionType',
        qtype: 'questionType',
        questiontype: 'questionType',
        questionType: 'questionType',
        exam: 'examination',
        examination: 'examination',
        year: 'year',
        paper: 'paper',
        section: 'section',
        publisher: 'publisher',
        feature: 'feature'
    };

    var overlay = null;
    var openDetails = {};
    var editingCheckId = null;
    var cachedQuestions = null;
    var activeChecks = null;
    var conditionRowSeq = 0;

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
        var key = String(rawField == null ? '' : rawField).trim();
        if (!key) return '';
        if (CONDITION_FIELD_BY_ID[key]) return key;
        if (FIELD_ALIASES[key]) return FIELD_ALIASES[key];
        var lower = key.toLowerCase();
        if (FIELD_ALIASES[lower]) return FIELD_ALIASES[lower];
        return '';
    }

    function legacyTypeFor(include, field) {
        if (field === 'text') return include ? 'textContains' : 'textNotContains';
        if (field === 'concepts') return include ? 'conceptPresent' : 'conceptAbsent';
        return '';
    }

    function conditionChoicesFromRaw(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var type = String(raw.type || '').trim();
        if (LEGACY_TYPE_TO_CHOICE[type]) {
            return {
                include: LEGACY_TYPE_TO_CHOICE[type].include,
                field: LEGACY_TYPE_TO_CHOICE[type].field
            };
        }
        var include;
        if (typeof raw.include === 'boolean') {
            include = raw.include;
        } else if (raw.mode === 'include' || raw.mode === 'exclude') {
            include = raw.mode === 'include';
        } else if (raw.include === 'include' || raw.include === 'exclude') {
            include = raw.include === 'include';
        } else {
            include = null;
        }
        var field = resolveFieldId(raw.field || raw.match || raw.target || '');
        // Older dual-checkbox saves used field: 'concept'.
        if (!field && (raw.field === 'concept' || raw.field === '概念')) {
            field = 'concepts';
        }
        if (include === null || !field || !CONDITION_FIELD_BY_ID[field]) return null;
        return { include: include, field: field };
    }

    function normalizeCondition(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var choices = conditionChoicesFromRaw(raw);
        if (!choices) return null;
        var out = {
            include: choices.include,
            field: choices.field,
            value: String(raw.value == null ? '' : raw.value)
        };
        var legacy = legacyTypeFor(choices.include, choices.field);
        if (legacy) out.type = legacy;
        return out;
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
            conditions: conditions,
            exceptions: exceptions
        };
    }

    function normalizeChecks(list) {
        if (!Array.isArray(list)) return cloneChecks(DEFAULT_DATA_CHECKS);
        return list.map(normalizeCheck).filter(Boolean);
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
            localStorage.setItem(key, JSON.stringify({
                version: 1,
                checks: normalizeChecks(checks)
            }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function loadActiveChecks() {
        if (!canSeeDataChecks()) {
            activeChecks = cloneChecks(DEFAULT_DATA_CHECKS);
            return activeChecks;
        }
        var saved = readSavedChecks(currentUsername());
        activeChecks = saved ? saved : cloneChecks(DEFAULT_DATA_CHECKS);
        return activeChecks;
    }

    function persistActiveChecks() {
        if (!canSeeDataChecks()) return false;
        activeChecks = normalizeChecks(activeChecks);
        return writeSavedChecks(currentUsername(), activeChecks);
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

    function featureIsOn(question, featureName) {
        if (typeof questionFeatureOn === 'function') {
            return !!questionFeatureOn(question, featureName);
        }
        // Same semantics as stats-filters.js questionFeatureOn.
        if (featureName === '含圖表') {
            return !!(question.graphType && question.graphType !== '' && question.graphType !== '-' && question.graphType !== '沒有圖');
        }
        if (featureName === '有內嵌圖') return !!(question.inlineDiagrams && String(question.inlineDiagrams).trim());
        if (featureName === '含表格') {
            return !!(question.tableType && question.tableType !== '' && question.tableType !== '-' && question.tableType !== '沒有表格');
        }
        if (featureName === '複選') {
            return !!(question.multipleSelectionType && question.multipleSelectionType !== '' && question.multipleSelectionType !== '-' &&
                question.multipleSelectionType !== '並非複選型' && question.multipleSelectionType !== '不適用');
        }
        if (featureName === '含計算') {
            return !!(question.calculationType && question.calculationType !== '' && question.calculationType !== '-' && question.calculationType !== '沒有計算');
        }
        if (featureName === '跨課題') {
            return !!(question.curriculumClassification && Array.isArray(question.curriculumClassification) && question.curriculumClassification.length > 1);
        }
        if (featureName === '跨章節') {
            return !!(question.AristochapterClassification && Array.isArray(question.AristochapterClassification) && question.AristochapterClassification.length > 1);
        }
        if (featureName === '已刪除') return !!(question.answerMC && String(question.answerMC).trim() === '*');
        if (featureName === 'Out syl') return !!(question.outSyl && String(question.outSyl).trim().toUpperCase() === 'Y');
        return false;
    }

    function questionHasFieldValue(question, fieldId, value) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        if (!def || !question) return false;
        var needle = String(value == null ? '' : value);
        if (def.kind === 'text') {
            return questionText(question).indexOf(needle) !== -1;
        }
        if (def.kind === 'array') {
            var list = question[def.prop];
            if (!Array.isArray(list)) return false;
            return list.includes(needle);
        }
        if (def.kind === 'scalar') {
            if (question[def.prop] === undefined || question[def.prop] === null) return false;
            return String(question[def.prop]).trim() === needle;
        }
        if (def.kind === 'feature') {
            return featureIsOn(question, needle);
        }
        return false;
    }

    function matchesCondition(question, condition) {
        var normalized = normalizeCondition(condition);
        if (!normalized) return false;
        var present = questionHasFieldValue(question, normalized.field, normalized.value);
        return normalized.include ? present : !present;
    }

    function matchesCheck(question, check) {
        var conditions = (check && check.conditions) || [];
        if (!conditions.length) return false;
        for (var i = 0; i < conditions.length; i++) {
            if (!matchesCondition(question, conditions[i])) return false;
        }
        return true;
    }

    function collectFieldValues(fieldId) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        if (!def || !def.autocomplete) return [];
        var set = {};
        if (def.kind === 'feature' && typeof FEATURE_ITEMS !== 'undefined' && Array.isArray(FEATURE_ITEMS)) {
            FEATURE_ITEMS.forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (text) set[text] = true;
            });
        }
        if (def.kind === 'array' && def.prop === 'curriculumClassification' &&
            typeof CURRICULUM_ITEMS !== 'undefined' && Array.isArray(CURRICULUM_ITEMS)) {
            CURRICULUM_ITEMS.forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (text) set[text] = true;
            });
        }
        (cachedQuestions || []).forEach(function (question) {
            if (!question) return;
            if (def.kind === 'array') {
                var list = question[def.prop];
                if (!Array.isArray(list)) return;
                list.forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
                return;
            }
            if (def.kind === 'scalar') {
                if (question[def.prop] === undefined || question[def.prop] === null) return;
                var scalar = String(question[def.prop]).trim();
                if (!scalar) return;
                if (def.prop !== 'section' && scalar === '-') return;
                set[scalar] = true;
            }
        });
        return Object.keys(set).sort(function (a, b) {
            return a.localeCompare(b, 'zh-HK');
        });
    }

    function fieldLabel(fieldId) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        return def ? def.label : fieldId;
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
            + '      <p class="data-checks-subtitle">列出仍需處理的題目（符合條件且不在該檢查的例外清單）。可編輯標題、條件與例外；點題號會用既有「題目 ID」篩選顯示該題。</p>'
            + '    </div>'
            + '    <button type="button" class="data-checks-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="data-checks-toolbar">'
            + '    <button type="button" class="btn btn-outline-primary btn-sm" id="data-checks-add">＋ 新增檢查</button>'
            + '    <button type="button" class="btn btn-secondary btn-sm" id="data-checks-reset-defaults">還原預設檢查</button>'
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
            addBlankCheck();
        });
        overlay.querySelector('#data-checks-reset-defaults').addEventListener('click', function () {
            resetToDefaults();
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDataChecksPanel();
            }
        });
        overlay.addEventListener('click', function (event) {
            var idBtn = event.target.closest('[data-dc-qid]');
            if (idBtn) {
                event.preventDefault();
                showQuestionById(idBtn.getAttribute('data-dc-qid'));
                return;
            }
            var editBtn = event.target.closest('[data-dc-edit]');
            if (editBtn) {
                editingCheckId = editBtn.getAttribute('data-dc-edit');
                renderFromCache();
                return;
            }
            var cancelBtn = event.target.closest('[data-dc-cancel]');
            if (cancelBtn) {
                editingCheckId = null;
                renderFromCache();
                return;
            }
            var saveBtn = event.target.closest('[data-dc-save]');
            if (saveBtn) {
                saveEditedCheck(saveBtn.getAttribute('data-dc-save'));
                return;
            }
            var deleteBtn = event.target.closest('[data-dc-delete]');
            if (deleteBtn) {
                deleteCheck(deleteBtn.getAttribute('data-dc-delete'));
                return;
            }
            var addCond = event.target.closest('[data-dc-add-cond]');
            if (addCond) {
                addConditionRow(addCond.getAttribute('data-dc-add-cond'));
                return;
            }
            var removeCond = event.target.closest('[data-dc-remove-cond]');
            if (removeCond) {
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
        return ((check && check.conditions) || []).map(function (condition) {
            var choices = conditionChoicesFromRaw(condition) || { include: true, field: 'text' };
            var includeLabel = choices.include ? '包含' : '不包括';
            return includeLabel + fieldLabel(choices.field) + '「' + condition.value + '」';
        }).join(' 且 ');
    }

    function fieldSelectHtml(selectedField) {
        return CONDITION_FIELDS.map(function (def) {
            var sel = def.id === selectedField ? ' selected' : '';
            return '<option value="' + escapeAttr(def.id) + '"' + sel + '>' + escapeHtml(def.label) + '</option>';
        }).join('');
    }

    function datalistHtml(listId, fieldId) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
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
        var def = CONDITION_FIELD_BY_ID[fieldId];
        list.innerHTML = '';
        if (!def || !def.autocomplete) {
            valueInput.removeAttribute('list');
            valueInput.placeholder = '字串（題文自由輸入）';
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
        var choices = conditionChoicesFromRaw(condition) || { include: true, field: 'text' };
        var value = condition && condition.value != null ? condition.value : '';
        var includeChecked = choices.include ? ' checked' : '';
        var excludeChecked = choices.include ? '' : ' checked';
        var fieldId = choices.field || 'text';
        var def = CONDITION_FIELD_BY_ID[fieldId] || CONDITION_FIELD_BY_ID.text;
        conditionRowSeq += 1;
        var listId = 'dc-ac-' + conditionRowSeq;
        var listAttr = def.autocomplete ? (' list="' + escapeAttr(listId) + '"') : '';
        var placeholder = def.autocomplete ? '從已載入題庫選擇或輸入' : '字串（題文自由輸入）';
        return ''
            + '<div class="data-checks-cond-row" data-dc-cond-row="1">'
            + '  <div class="data-checks-cond-pairs">'
            + '    <div class="data-checks-cond-pair" role="group" aria-label="包含或不包括">'
            + '      <label class="data-checks-check"><input type="checkbox" data-dc-include value="include"' + includeChecked + '>包含</label>'
            + '      <label class="data-checks-check"><input type="checkbox" data-dc-include value="exclude"' + excludeChecked + '>不包括</label>'
            + '    </div>'
            + '    <label class="data-checks-field-select">'
            + '      <span class="data-checks-field-select-label">欄位</span>'
            + '      <select data-dc-field aria-label="條件欄位">' + fieldSelectHtml(fieldId) + '</select>'
            + '    </label>'
            + '  </div>'
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

    function addBlankCheck() {
        if (!canSeeDataChecks()) return;
        loadActiveChecks();
        var check = {
            id: newCheckId(),
            name: '新檢查',
            conditions: [{ include: true, field: 'text', value: '', type: 'textContains' }],
            exceptions: []
        };
        activeChecks.push(check);
        persistActiveChecks();
        editingCheckId = check.id;
        renderFromCache();
    }

    function resetToDefaults() {
        if (!canSeeDataChecks()) return;
        if (!window.confirm('還原為程式內建的預設檢查？目前已儲存的標題、條件、例外與新增檢查都會被取代。')) {
            return;
        }
        activeChecks = cloneChecks(DEFAULT_DATA_CHECKS);
        persistActiveChecks();
        editingCheckId = null;
        renderFromCache();
    }

    function deleteCheck(checkId) {
        if (!canSeeDataChecks()) return;
        loadActiveChecks();
        var next = activeChecks.filter(function (check) { return check.id !== checkId; });
        if (next.length === activeChecks.length) return;
        if (!window.confirm('刪除此檢查？')) return;
        activeChecks = next;
        persistActiveChecks();
        if (editingCheckId === checkId) editingCheckId = null;
        renderFromCache();
    }

    function readEditorForm(checkId) {
        var row = overlay && overlay.querySelector('[data-check-id="' + checkId + '"]');
        if (!row) return null;
        var nameInput = row.querySelector('[data-dc-name]');
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
            conditions: conditions,
            exceptions: exceptions
        };
    }

    function saveEditedCheck(checkId) {
        if (!canSeeDataChecks()) return;
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
        persistActiveChecks();
        editingCheckId = null;
        renderFromCache();
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

    function renderEditor(check) {
        var conditionsHtml = (check.conditions.length ? check.conditions : [{ type: 'textContains', value: '' }]).map(function (condition) {
            return conditionRowHtml(condition);
        }).join('');

        return ''
            + '<div class="data-checks-editor">'
            + '  <label class="data-checks-field">'
            + '    <span>標題</span>'
            + '    <input type="text" data-dc-name value="' + escapeAttr(check.name) + '" maxlength="120">'
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
            empty.textContent = '尚未設定任何檢查。按上方「新增檢查」，或還原預設檢查。';
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
                    summary.textContent = conditionSummary(check) || '（尚未設定條件）';
                    row.appendChild(summary);

                    var actions = document.createElement('div');
                    actions.className = 'data-checks-row-actions';
                    actions.innerHTML = ''
                        + '<button type="button" class="btn btn-outline-primary btn-sm" data-dc-edit="' + escapeAttr(check.id) + '">編輯</button>'
                        + '<button type="button" class="btn btn-secondary btn-sm" data-dc-delete="' + escapeAttr(check.id) + '">刪除</button>';
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
            var saved = canSeeDataChecks() && !!readSavedChecks(currentUsername());
            note.textContent = '已載入 ' + totalQuestions + ' 題 · 共 ' + results.length + ' 項檢查'
                + (saved ? ' · 已儲存個人設定' : ' · 使用預設檢查');
        }
    }

    function renderFromCache() {
        if (!canSeeDataChecks()) {
            refreshDataChecksVisibility();
            return;
        }
        loadActiveChecks();
        var questions = Array.isArray(cachedQuestions) ? cachedQuestions : [];
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
        var body = document.getElementById('data-checks-body');
        if (body) {
            body.innerHTML = '<p class="data-checks-empty">正在檢查題目…</p>';
        }
        loadActiveChecks();
        await loadQuestionsForChecks();
        renderFromCache();
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
            + '.data-checks-toolbar {'
            + '  display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 18px;'
            + '  border-bottom: 1px solid var(--border-light); background: #fff;'
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
            + '.data-checks-row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }'
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
            + '.data-checks-field input[type="text"], .data-checks-field textarea, .data-checks-cond-row input[type="text"] {'
            + '  width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d7e3ef;'
            + '  border-radius: 8px; font: inherit; color: inherit; background: #fff;'
            + '}'
            + '.data-checks-field textarea { resize: vertical; min-height: 88px;'
            + '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }'
            + '.data-checks-cond-list { display: grid; gap: 10px; }'
            + '.data-checks-cond-row {'
            + '  display: grid; grid-template-columns: minmax(260px, 1.1fr) minmax(140px, 1fr) auto;'
            + '  gap: 8px; align-items: center; padding: 8px; border: 1px solid #e7eef5;'
            + '  border-radius: 10px; background: #f8fafc;'
            + '}'
            + '.data-checks-cond-pairs { display: grid; gap: 8px; }'
            + '.data-checks-cond-pair { display: flex; flex-wrap: wrap; gap: 8px 12px; }'
            + '.data-checks-field-select {'
            + '  display: grid; gap: 4px; margin: 0; font-size: 12px; color: var(--text-light);'
            + '}'
            + '.data-checks-field-select-label { font-weight: 700; color: var(--primary-color); }'
            + '.data-checks-field-select select {'
            + '  width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid #d7e3ef;'
            + '  border-radius: 8px; font: inherit; color: inherit; background: #fff;'
            + '}'
            + '.data-checks-cond-value-wrap { min-width: 0; }'
            + '.data-checks-cond-value-wrap input { width: 100%; }'
            + '.data-checks-check {'
            + '  display: inline-flex; align-items: center; gap: 4px; margin: 0;'
            + '  font-size: 13px; font-weight: 600; color: var(--primary-color); cursor: pointer;'
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
            + '  .data-checks-cond-row { grid-template-columns: 1fr; }'
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
    window.__DATA_CHECKS_FIELDS__ = CONDITION_FIELDS;
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
