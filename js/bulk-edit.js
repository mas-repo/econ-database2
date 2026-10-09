// bulk-edit.js
// Admin-only bulk edit modal: one table row per question from the current
// filtered 題目 list. Editable columns are choosable (persisted in
// localStorage). List fields get token autocomplete; curriculum stays
// CURRICULUM_ITEMS-only. Save only changed rows after confirm + validation.
//
// Visibility: .btn-admin-only (isAdminMode). Also gated on accessRights.admin.
// Does not invent auto-upload; after save calls maybeAutoSyncQuestions like
// the single form (honours existing 自動同步 preference).
//
// Dependencies: question-fields.js, constants.js (CURRICULUM_ITEMS, CHAPTER_RANGE),
// ConditionMatch (vocab), storage, gatherFilterState / getQuestions,
// showNotification, refreshViews.

(function () {
    'use strict';

    var BULK_EDIT_MAX_ROWS = 300;
    var COLUMN_STORAGE_KEY = 'econ_bulk_edit_columns_v1';
    var overlay = null;
    var draftRows = []; // { original, draft, fingerprint }
    var vocabCache = {}; // fieldId → string[]
    var activeSuggest = null; // { input, listEl, items, index }

    // id is always shown/read-only and is not stored in the picker prefs.
    var COLUMN_DEFS = [
        {
            id: 'AristochapterClassification',
            label: 'Chapters',
            kind: 'list',
            prop: 'AristochapterClassification',
            defaultOn: true,
            autocomplete: true,
            vocabField: 'AristochapterClassification',
            placeholder: 'Ch01, Ch02'
        },
        {
            id: 'curriculumClassification',
            label: '課程分類',
            kind: 'list',
            prop: 'curriculumClassification',
            defaultOn: true,
            autocomplete: true,
            vocabField: 'curriculumClassification',
            strictCurriculum: true,
            placeholder: 'A 基本經濟概念, …'
        },
        {
            id: 'marks',
            label: '總分',
            kind: 'number',
            prop: 'marks',
            defaultOn: true,
            placeholder: ''
        },
        {
            id: 'partsStatus',
            label: '分題狀態',
            kind: 'partsStatus',
            prop: 'partsStatus',
            defaultOn: true,
            placeholder: 'pending / none / filled'
        },
        {
            id: 'questionParts',
            label: '分題（標籤,分數,表現 | …）',
            kind: 'parts',
            prop: 'questionParts',
            defaultOn: true,
            placeholder: 'a,2,良好 | b,3,優良'
        },
        {
            id: 'concepts',
            label: '概念',
            kind: 'list',
            prop: 'concepts',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'concepts',
            placeholder: '概念, …'
        },
        {
            id: 'patterns',
            label: '題型',
            kind: 'list',
            prop: 'patterns',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'patterns',
            placeholder: '題型, …'
        },
        {
            id: 'stemPatterns',
            label: '題幹模式',
            kind: 'list',
            prop: 'stemPatterns',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'stemPatterns',
            placeholder: '題幹模式, …'
        },
        {
            id: 'graphType',
            label: '圖表類型',
            kind: 'scalar',
            prop: 'graphType',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'graphType',
            placeholder: ''
        },
        {
            id: 'tableType',
            label: '表格類型',
            kind: 'scalar',
            prop: 'tableType',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'tableType',
            placeholder: ''
        },
        {
            id: 'calculationType',
            label: '計算類型',
            kind: 'scalar',
            prop: 'calculationType',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'calculationType',
            placeholder: ''
        },
        {
            id: 'multipleSelectionType',
            label: '複選類型',
            kind: 'scalar',
            prop: 'multipleSelectionType',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'multipleSelectionType',
            placeholder: ''
        },
        {
            id: 'optionDesign',
            label: '選項設計',
            kind: 'text',
            prop: 'optionDesign',
            defaultOn: false,
            placeholder: ''
        },
        {
            id: 'section',
            label: 'Section',
            kind: 'scalar',
            prop: 'section',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'section',
            placeholder: 'A / B / C / -'
        },
        {
            id: 'year',
            label: '年份',
            kind: 'text',
            prop: 'year',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'year',
            placeholder: ''
        },
        {
            id: 'paper',
            label: '卷別',
            kind: 'text',
            prop: 'paper',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'paper',
            placeholder: ''
        },
        {
            id: 'publisher',
            label: '出版商',
            kind: 'text',
            prop: 'publisher',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'publisher',
            placeholder: ''
        },
        {
            id: 'examination',
            label: '考試',
            kind: 'text',
            prop: 'examination',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'examination',
            placeholder: ''
        },
        {
            id: 'questionType',
            label: '題目類型',
            kind: 'text',
            prop: 'questionType',
            defaultOn: false,
            autocomplete: true,
            vocabField: 'questionType',
            placeholder: ''
        }
    ];

    var COLUMN_BY_ID = {};
    COLUMN_DEFS.forEach(function (def) {
        COLUMN_BY_ID[def.id] = def;
    });

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function canUseBulkEdit() {
        return !!(window.accessRights && window.accessRights.admin === true &&
            typeof isAdminMode !== 'undefined' && isAdminMode);
    }

    function partsToCompact(parts) {
        if (typeof serializeQuestionPartsCompact === 'function') {
            return serializeQuestionPartsCompact(parts);
        }
        return '';
    }

    function compactToParts(text) {
        if (typeof parseQuestionPartsCompact === 'function') {
            return parseQuestionPartsCompact(text);
        }
        return [];
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

    function scalarDisplay(value) {
        if (value == null) return '';
        var text = String(value).trim();
        return text === '-' ? '' : text;
    }

    function scalarStore(text) {
        var trimmed = String(text == null ? '' : text).trim();
        return trimmed === '' ? '-' : trimmed;
    }

    function defaultVisibleIds() {
        return COLUMN_DEFS.filter(function (def) { return def.defaultOn; })
            .map(function (def) { return def.id; });
    }

    function loadVisibleColumnIds() {
        try {
            var raw = localStorage.getItem(COLUMN_STORAGE_KEY);
            if (!raw) return defaultVisibleIds();
            var parsed = JSON.parse(raw);
            var list = Array.isArray(parsed) ? parsed : (parsed && parsed.columns);
            if (!Array.isArray(list)) return defaultVisibleIds();
            var allowed = {};
            COLUMN_DEFS.forEach(function (def) { allowed[def.id] = true; });
            var cleaned = list.filter(function (id) {
                return typeof id === 'string' && allowed[id];
            });
            return cleaned.length ? cleaned : defaultVisibleIds();
        } catch (error) {
            return defaultVisibleIds();
        }
    }

    function saveVisibleColumnIds(ids) {
        try {
            localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({
                version: 1,
                columns: ids
            }));
        } catch (error) {
            // Prefs only.
        }
    }

    function visibleColumns() {
        var ids = loadVisibleColumnIds();
        var byId = COLUMN_BY_ID;
        return ids.map(function (id) { return byId[id]; }).filter(Boolean);
    }

    function snapshotFromQuestion(question) {
        var snap = {};
        COLUMN_DEFS.forEach(function (def) {
            if (def.kind === 'list') {
                snap[def.id] = listToComma(question[def.prop]);
            } else if (def.kind === 'partsStatus') {
                snap[def.id] = (typeof resolvePartsStatus === 'function')
                    ? resolvePartsStatus(question)
                    : String(question.partsStatus || 'pending');
            } else if (def.kind === 'parts') {
                snap[def.id] = partsToCompact(question[def.prop]);
            } else if (def.kind === 'number') {
                snap[def.id] = question[def.prop] == null || question[def.prop] === ''
                    ? ''
                    : String(question[def.prop]);
            } else if (def.kind === 'scalar') {
                snap[def.id] = scalarDisplay(question[def.prop]);
            } else if (def.prop === 'year' && typeof normalizeYear === 'function') {
                snap[def.id] = normalizeYear(question[def.prop]);
            } else {
                snap[def.id] = String(question[def.prop] == null ? '' : question[def.prop]);
            }
        });
        return snap;
    }

    function fingerprintDraft(draft) {
        var payload = {};
        COLUMN_DEFS.forEach(function (def) {
            payload[def.id] = draft[def.id] == null ? '' : String(draft[def.id]);
        });
        return JSON.stringify(payload);
    }

    function chapterVocab() {
        var set = {};
        if (typeof CHAPTER_RANGE !== 'undefined') {
            for (var i = CHAPTER_RANGE.min; i <= CHAPTER_RANGE.max; i++) {
                set['Ch' + String(i).padStart(2, '0')] = true;
            }
        }
        return set;
    }

    async function buildVocabCache(seedQuestions) {
        vocabCache = {};
        var questions = seedQuestions || [];
        try {
            if (window.storage && typeof window.storage.getQuestions === 'function') {
                var all = await window.storage.getQuestions({});
                if (Array.isArray(all) && all.length) questions = all;
            }
        } catch (error) {
            // Fall back to seed list.
        }

        var match = window.ConditionMatch;
        COLUMN_DEFS.forEach(function (def) {
            if (!def.autocomplete) return;
            var set = {};
            if (def.strictCurriculum && typeof CURRICULUM_ITEMS !== 'undefined') {
                CURRICULUM_ITEMS.forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
            } else if (def.vocabField === 'AristochapterClassification') {
                Object.keys(chapterVocab()).forEach(function (key) { set[key] = true; });
            } else if (def.vocabField === 'examination' && typeof EXAMINATION_TYPES !== 'undefined') {
                EXAMINATION_TYPES.forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
            } else if (def.vocabField === 'questionType' && typeof QUESTION_TYPES !== 'undefined') {
                QUESTION_TYPES.forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
            }

            if (match && typeof match.collectFieldValues === 'function' && def.vocabField) {
                match.collectFieldValues(def.vocabField, questions).forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
            } else if (def.kind === 'list' || def.kind === 'scalar' || def.kind === 'text') {
                questions.forEach(function (question) {
                    if (!question) return;
                    if (def.kind === 'list') {
                        var list = question[def.prop];
                        if (!Array.isArray(list)) return;
                        list.forEach(function (item) {
                            var text = String(item == null ? '' : item).trim();
                            if (text) set[text] = true;
                        });
                    } else {
                        var scalar = question[def.prop];
                        if (scalar == null) return;
                        var text = String(scalar).trim();
                        if (!text || (def.kind === 'scalar' && text === '-' && def.prop !== 'section')) return;
                        set[text] = true;
                    }
                });
            }

            vocabCache[def.id] = Object.keys(set).sort(function (a, b) {
                return a.localeCompare(b, 'zh-HK');
            });
        });
    }

    function vocabFor(def) {
        return vocabCache[def.id] || [];
    }

    async function loadFilteredQuestions() {
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

    function closeSuggest() {
        if (activeSuggest && activeSuggest.listEl) {
            activeSuggest.listEl.hidden = true;
            activeSuggest.listEl.innerHTML = '';
        }
        activeSuggest = null;
    }

    function currentTokenInfo(input) {
        var value = String(input.value || '');
        var caret = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
        var before = value.slice(0, caret);
        var commaAt = before.lastIndexOf(',');
        var start = commaAt + 1;
        while (start < before.length && before.charAt(start) === ' ') start += 1;
        return {
            value: value,
            caret: caret,
            start: start,
            token: before.slice(start),
            after: value.slice(caret)
        };
    }

    function applySuggestion(input, suggestion) {
        var info = currentTokenInfo(input);
        var beforePrefix = info.value.slice(0, info.start);
        var needsSpaceAfterComma = beforePrefix.length && !/\s$/.test(beforePrefix);
        if (needsSpaceAfterComma) beforePrefix += ' ';
        var next = beforePrefix + suggestion;
        var after = info.after;
        if (after && !/^,/.test(after.trim())) {
            // keep trailing text
        }
        // Prefer a trailing ", " so the next token can be typed immediately for lists.
        var insertComma = input.getAttribute('data-be-kind') === 'list';
        if (insertComma) {
            if (!after || !after.trim()) {
                next += ', ';
                after = '';
            } else if (/^\s*,/.test(after)) {
                // already have a comma after caret
            } else {
                next += ', ';
            }
        }
        input.value = next + after;
        var pos = next.length;
        input.setSelectionRange(pos, pos);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        closeSuggest();
        input.focus();
    }

    function renderSuggestList(input, items) {
        var wrap = input.closest('.be-ac');
        if (!wrap) return;
        var listEl = wrap.querySelector('.be-ac-list');
        if (!listEl) return;
        if (!items.length) {
            closeSuggest();
            return;
        }
        listEl.innerHTML = items.map(function (item, index) {
            return '<button type="button" class="be-ac-item" data-be-ac-index="' + index + '" role="option">'
                + escapeHtml(item) + '</button>';
        }).join('');
        listEl.hidden = false;
        activeSuggest = { input: input, listEl: listEl, items: items, index: 0 };
        highlightSuggest(0);
    }

    function highlightSuggest(index) {
        if (!activeSuggest) return;
        var buttons = activeSuggest.listEl.querySelectorAll('.be-ac-item');
        if (!buttons.length) return;
        var next = index;
        if (next < 0) next = buttons.length - 1;
        if (next >= buttons.length) next = 0;
        activeSuggest.index = next;
        buttons.forEach(function (btn, i) {
            if (i === next) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
        });
        var active = buttons[next];
        if (active && typeof active.scrollIntoView === 'function') {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    function filterVocab(def, token) {
        var all = vocabFor(def);
        var needle = String(token || '').trim().toLowerCase();
        if (!needle) {
            return all.slice(0, 40);
        }
        var starts = [];
        var contains = [];
        all.forEach(function (item) {
            var lower = item.toLowerCase();
            if (lower === needle) return;
            if (lower.indexOf(needle) === 0) starts.push(item);
            else if (lower.indexOf(needle) !== -1) contains.push(item);
        });
        return starts.concat(contains).slice(0, 40);
    }

    function updateSuggestForInput(input) {
        var colId = input.getAttribute('data-be-col');
        var def = COLUMN_BY_ID[colId];
        if (!def || !def.autocomplete) {
            closeSuggest();
            return;
        }
        var info = currentTokenInfo(input);
        if (def.kind !== 'list' && info.token !== info.value) {
            // scalar/text: whole-field match
        }
        var token = def.kind === 'list' ? info.token : String(input.value || '');
        var items = filterVocab(def, token);
        renderSuggestList(input, items);
    }

    function attachAutocomplete(input, def) {
        if (!def.autocomplete) return;
        var wrap = document.createElement('div');
        wrap.className = 'be-ac';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        var listEl = document.createElement('div');
        listEl.className = 'be-ac-list';
        listEl.hidden = true;
        listEl.setAttribute('role', 'listbox');
        wrap.appendChild(listEl);

        input.addEventListener('focus', function () {
            updateSuggestForInput(input);
        });
        input.addEventListener('input', function () {
            updateSuggestForInput(input);
        });
        input.addEventListener('keydown', function (event) {
            if (!activeSuggest || activeSuggest.input !== input || activeSuggest.listEl.hidden) {
                if (event.key === 'Escape') closeSuggest();
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                highlightSuggest(activeSuggest.index + 1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                highlightSuggest(activeSuggest.index - 1);
            } else if (event.key === 'Enter') {
                if (activeSuggest.items[activeSuggest.index]) {
                    event.preventDefault();
                    applySuggestion(input, activeSuggest.items[activeSuggest.index]);
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeSuggest();
            }
        });
        listEl.addEventListener('mousedown', function (event) {
            var btn = event.target.closest('.be-ac-item');
            if (!btn) return;
            event.preventDefault();
            var index = parseInt(btn.getAttribute('data-be-ac-index'), 10);
            if (!isNaN(index) && activeSuggest && activeSuggest.items[index]) {
                applySuggestion(input, activeSuggest.items[index]);
            }
        });
    }

    function cellInputHtml(def, value) {
        var attr = 'data-be-col="' + escapeHtml(def.id) + '" data-be-kind="' + escapeHtml(def.kind) + '"';
        var common = attr + ' value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(def.placeholder || '') + '" autocomplete="off"';
        if (def.kind === 'number') {
            return '<input type="number" ' + attr + ' min="0" step="0.5" value="' + escapeHtml(value) + '" style="width:5.5em;">';
        }
        if (def.kind === 'partsStatus') {
            var current = String(value || 'pending');
            var options = [
                { value: 'pending', label: '尚未輸入' },
                { value: 'none', label: '沒有分題' },
                { value: 'filled', label: '有分題' }
            ];
            return '<select ' + attr + ' style="min-width:7.5em;">'
                + options.map(function (opt) {
                    return '<option value="' + escapeHtml(opt.value) + '"'
                        + (opt.value === current ? ' selected' : '') + '>'
                        + escapeHtml(opt.label) + '</option>';
                }).join('')
                + '</select>';
        }
        return '<input type="text" ' + common + '>';
    }

    function rowHtml(draft, index, columns) {
        var id = String(draftRows[index].original.id != null ? draftRows[index].original.id : '');
        var cells = columns.map(function (def) {
            var value = draft[def.id] == null ? '' : draft[def.id];
            return '<td>' + cellInputHtml(def, value) + '</td>';
        }).join('');
        return ''
            + '<tr data-bulk-index="' + index + '" data-question-id="' + escapeHtml(id) + '">'
            + '  <td class="be-id">' + escapeHtml(id || '（無編號）') + '</td>'
            + cells
            + '</tr>';
    }

    function readVisibleDraftFromDom() {
        var tbody = document.getElementById('be-tbody');
        if (!tbody) return;
        tbody.querySelectorAll('tr[data-bulk-index]').forEach(function (tr) {
            var index = parseInt(tr.getAttribute('data-bulk-index'), 10);
            var row = draftRows[index];
            if (!row) return;
            tr.querySelectorAll('[data-be-col]').forEach(function (input) {
                var colId = input.getAttribute('data-be-col');
                if (!COLUMN_BY_ID[colId]) return;
                row.draft[colId] = input.value;
            });
        });
    }

    function renderColumnPicker() {
        var host = document.getElementById('be-column-picker');
        if (!host) return;
        var visible = {};
        loadVisibleColumnIds().forEach(function (id) { visible[id] = true; });
        host.innerHTML = ''
            + '<button type="button" class="btn btn-secondary btn-sm" id="be-columns-toggle" aria-expanded="false">欄位</button>'
            + '<div class="be-column-menu" id="be-column-menu" hidden>'
            + '  <div class="be-column-menu-title">顯示／編輯欄位（題目 ID 固定）</div>'
            + COLUMN_DEFS.map(function (def) {
                return '<label class="be-column-option">'
                    + '<input type="checkbox" data-be-column-id="' + escapeHtml(def.id) + '"'
                    + (visible[def.id] ? ' checked' : '') + '>'
                    + '<span>' + escapeHtml(def.label) + '</span>'
                    + '</label>';
            }).join('')
            + '  <div class="be-column-menu-actions">'
            + '    <button type="button" class="btn btn-secondary btn-sm" id="be-columns-reset">重設預設</button>'
            + '  </div>'
            + '</div>';

        var toggle = host.querySelector('#be-columns-toggle');
        var menu = host.querySelector('#be-column-menu');
        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            var open = menu.hidden;
            menu.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        menu.addEventListener('click', function (event) {
            event.stopPropagation();
        });
        host.querySelectorAll('[data-be-column-id]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var selected = [];
                host.querySelectorAll('[data-be-column-id]').forEach(function (box) {
                    if (box.checked) selected.push(box.getAttribute('data-be-column-id'));
                });
                if (!selected.length) {
                    // Keep at least the default set so the table is usable.
                    selected = defaultVisibleIds();
                    host.querySelectorAll('[data-be-column-id]').forEach(function (box) {
                        box.checked = selected.indexOf(box.getAttribute('data-be-column-id')) !== -1;
                    });
                }
                saveVisibleColumnIds(selected);
                rerenderTablePreservingDraft();
            });
        });
        host.querySelector('#be-columns-reset').addEventListener('click', function () {
            var selected = defaultVisibleIds();
            saveVisibleColumnIds(selected);
            host.querySelectorAll('[data-be-column-id]').forEach(function (box) {
                box.checked = selected.indexOf(box.getAttribute('data-be-column-id')) !== -1;
            });
            rerenderTablePreservingDraft();
        });
    }

    function renderTableHead() {
        var thead = document.getElementById('be-thead-row');
        if (!thead) return;
        var columns = visibleColumns();
        thead.innerHTML = '<th>題目 ID</th>' + columns.map(function (def) {
            return '<th>' + escapeHtml(def.label) + '</th>';
        }).join('');
    }

    function bindRowAutocompletes() {
        var tbody = document.getElementById('be-tbody');
        if (!tbody) return;
        tbody.querySelectorAll('input[data-be-col]').forEach(function (input) {
            var def = COLUMN_BY_ID[input.getAttribute('data-be-col')];
            if (def) attachAutocomplete(input, def);
        });
    }

    function rerenderTablePreservingDraft() {
        readVisibleDraftFromDom();
        closeSuggest();
        renderTableHead();
        var tbody = document.getElementById('be-tbody');
        if (!tbody) return;
        var columns = visibleColumns();
        tbody.innerHTML = draftRows.map(function (row, index) {
            return rowHtml(row.draft, index, columns);
        }).join('');
        bindRowAutocompletes();
        setStatus('已載入 ' + draftRows.length + ' 題（目前篩選結果）。可改顯示欄位；有分題時各分分數合計必須等於總分。');
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'bulk-edit-overlay';
        overlay.className = 'be-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="be-dialog" role="dialog" aria-modal="true" aria-labelledby="be-title">'
            + '  <div class="be-header">'
            + '    <div class="be-header-text">'
            + '      <h2 id="be-title">批量編輯</h2>'
            + '      <p class="be-subtitle">載入目前篩選結果（每題一列）。用「欄位」選擇要顯示／編輯的欄位；Chapters 與課程分類等支援自動完成。只儲存有變更的列。有分題時各分分數合計必須等於總分。</p>'
            + '    </div>'
            + '    <button type="button" class="be-close" aria-label="關閉">×</button>'
            + '  </div>'
            + '  <div class="be-toolbar">'
            + '    <span id="be-status" class="be-status"></span>'
            + '    <div class="be-toolbar-actions">'
            + '      <div class="be-column-picker" id="be-column-picker"></div>'
            + '      <button type="button" class="btn btn-secondary btn-sm" id="be-reload">重新載入篩選結果</button>'
            + '    </div>'
            + '  </div>'
            + '  <div class="be-body">'
            + '    <table class="be-table">'
            + '      <thead><tr id="be-thead-row"></tr></thead>'
            + '      <tbody id="be-tbody"></tbody>'
            + '    </table>'
            + '  </div>'
            + '  <div class="be-footer">'
            + '    <button type="button" class="btn btn-secondary" id="be-cancel">關閉</button>'
            + '    <button type="button" class="btn btn-primary" id="be-save">儲存變更</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(overlay);

        var style = document.createElement('style');
        style.id = 'bulk-edit-styles';
        style.textContent = ''
            + '.be-overlay{position:fixed;inset:0;z-index:12500;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);}'
            + '.be-overlay[hidden]{display:none!important;}'
            + '.be-dialog{display:flex;flex-direction:column;width:min(1200px,100%);max-height:calc(100vh - 24px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 18px 48px rgba(15,23,42,.22);color:var(--text-color,#2c3e50);}'
            + '.be-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px 14px;border-bottom:1px solid var(--border-light,#e0e0e0);background:#fff;}'
            + '.be-header-text{flex:1;min-width:0;}'
            + '.be-header h2{margin:0 0 6px;font-size:20px;line-height:1.3;}'
            + '.be-subtitle{margin:0;color:var(--text-light,#7f8c8d);font-size:13px;line-height:1.5;}'
            + '.be-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--border-light,#e0e0e0);border-radius:8px;background:#fff;color:var(--text-light,#7f8c8d);font-size:20px;line-height:1;cursor:pointer;}'
            + '.be-close:hover{background:var(--light-bg,#ecf0f1);color:var(--text-color,#2c3e50);}'
            + '.be-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border-light,#e0e0e0);background:#fff;flex-wrap:wrap;}'
            + '.be-toolbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
            + '.be-status{color:var(--text-light,#7f8c8d);font-size:13px;}'
            + '.be-column-picker{position:relative;}'
            + '.be-column-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:2;min-width:220px;max-height:320px;overflow:auto;padding:10px;border:1px solid #d7e3ef;border-radius:10px;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.14);}'
            + '.be-column-menu[hidden]{display:none!important;}'
            + '.be-column-menu-title{font-size:12px;font-weight:700;color:var(--text-light,#7f8c8d);margin:0 0 8px;}'
            + '.be-column-option{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13px;cursor:pointer;}'
            + '.be-column-menu-actions{margin-top:8px;padding-top:8px;border-top:1px solid #e7eef5;}'
            + '.be-body{flex:1;min-height:0;overflow:auto;padding:0;background:#f4f7fb;}'
            + '.be-table{width:100%;border-collapse:collapse;background:#fff;font-size:13px;}'
            + '.be-table th,.be-table td{padding:8px 10px;border-bottom:1px solid #e7eef5;vertical-align:top;text-align:left;}'
            + '.be-table th{position:sticky;top:0;background:#f8fafc;z-index:1;font-weight:700;color:var(--primary-color,#2c3e50);white-space:nowrap;}'
            + '.be-table input[type="text"],.be-table input[type="number"]{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
            + '.be-id{white-space:nowrap;font-weight:600;}'
            + '.be-ac{position:relative;}'
            + '.be-ac-list{position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:3;max-height:180px;overflow:auto;border:1px solid #d7e3ef;border-radius:8px;background:#fff;box-shadow:0 8px 20px rgba(15,23,42,.12);}'
            + '.be-ac-list[hidden]{display:none!important;}'
            + '.be-ac-item{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-bottom:1px solid #f0f4f8;background:#fff;font:inherit;cursor:pointer;}'
            + '.be-ac-item:last-child{border-bottom:0;}'
            + '.be-ac-item:hover,.be-ac-item.is-active{background:#eef5ff;}'
            + '.be-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border-light,#e0e0e0);background:#fff;}'
            + '@media (max-width:800px){.be-table{font-size:12px}}';
        document.head.appendChild(style);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeBulkEditModal();
        });
        overlay.querySelector('.be-close').addEventListener('click', closeBulkEditModal);
        overlay.querySelector('#be-cancel').addEventListener('click', closeBulkEditModal);
        overlay.querySelector('#be-reload').addEventListener('click', function () {
            populateBulkEditTable();
        });
        overlay.querySelector('#be-save').addEventListener('click', function () {
            saveBulkEditChanges();
        });
        document.addEventListener('click', function (event) {
            if (!overlay || overlay.hidden) return;
            var picker = document.getElementById('be-column-picker');
            if (picker && !picker.contains(event.target)) {
                var menu = document.getElementById('be-column-menu');
                var toggle = document.getElementById('be-columns-toggle');
                if (menu) menu.hidden = true;
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
            }
            if (!event.target.closest('.be-ac')) closeSuggest();
        });
        renderColumnPicker();
        return overlay;
    }

    function setStatus(text) {
        var node = document.getElementById('be-status');
        if (node) node.textContent = text || '';
    }

    async function populateBulkEditTable() {
        if (!canUseBulkEdit()) {
            closeBulkEditModal();
            return;
        }
        ensureOverlay();
        renderColumnPicker();
        var tbody = document.getElementById('be-tbody');
        setStatus('載入中…');
        tbody.innerHTML = '';
        draftRows = [];
        closeSuggest();
        var questions = await loadFilteredQuestions();
        if (!questions.length) {
            renderTableHead();
            setStatus('目前篩選結果沒有題目。');
            return;
        }
        if (questions.length > BULK_EDIT_MAX_ROWS) {
            setStatus('篩選結果有 ' + questions.length + ' 題；一次最多載入 ' + BULK_EDIT_MAX_ROWS + ' 題。請收窄篩選後再試。');
            questions = questions.slice(0, BULK_EDIT_MAX_ROWS);
        }
        await buildVocabCache(questions);
        draftRows = questions.map(function (question) {
            var draft = snapshotFromQuestion(question);
            return {
                original: question,
                draft: draft,
                fingerprint: fingerprintDraft(draft)
            };
        });
        rerenderTablePreservingDraft();
    }

    function applyDraftField(target, def, raw) {
        if (def.kind === 'list') {
            target[def.prop] = commaToList(raw);
        } else if (def.kind === 'parts') {
            target[def.prop] = compactToParts(raw);
        } else if (def.kind === 'partsStatus') {
            var st = String(raw == null ? '' : raw).trim().toLowerCase();
            if (st !== 'none' && st !== 'filled' && st !== 'pending') st = 'pending';
            target[def.prop] = st;
        } else if (def.kind === 'number') {
            var marksNum = parseFloat(String(raw).trim());
            if (String(raw).trim() === '' || isNaN(marksNum) || !isFinite(marksNum)) {
                marksNum = 0;
            }
            target[def.prop] = marksNum;
        } else if (def.kind === 'scalar') {
            target[def.prop] = scalarStore(raw);
        } else if (def.prop === 'year' && typeof normalizeYear === 'function') {
            target[def.prop] = normalizeYear(raw);
        } else {
            target[def.prop] = String(raw == null ? '' : raw).trim();
        }
    }

    function reconcilePartsFields(merged, draft) {
        var partsText = draft && draft.questionParts != null ? draft.questionParts : '';
        var statusChoice = String(draft && draft.partsStatus != null ? draft.partsStatus : 'pending').trim().toLowerCase();
        var parts = compactToParts(partsText);
        // Non-empty parts text always wins as filled.
        if (parts.length) statusChoice = 'filled';
        if (statusChoice !== 'none' && statusChoice !== 'filled') statusChoice = 'pending';
        if (typeof applyPartsFields === 'function') {
            applyPartsFields(merged, statusChoice === 'filled' ? parts : [], statusChoice);
        } else {
            merged.questionParts = statusChoice === 'filled' ? parts : [];
            merged.partsStatus = statusChoice;
        }
        if (statusChoice === 'filled' && !(merged.questionParts && merged.questionParts.length)) {
            return '已選擇「有分題」但分題欄空白';
        }
        return '';
    }

    function collectChangedUpdates() {
        readVisibleDraftFromDom();
        var updates = [];
        var errors = [];

        draftRows.forEach(function (row) {
            var nextFingerprint = fingerprintDraft(row.draft);
            if (nextFingerprint === row.fingerprint) return;

            var originalSnap = snapshotFromQuestion(row.original);
            var merged = Object.assign({}, row.original);
            var changedProps = [];

            COLUMN_DEFS.forEach(function (def) {
                var nextVal = row.draft[def.id] == null ? '' : String(row.draft[def.id]);
                var prevVal = originalSnap[def.id] == null ? '' : String(originalSnap[def.id]);
                if (nextVal === prevVal) return;
                applyDraftField(merged, def, nextVal);
                changedProps.push(def.id);
            });

            if (!changedProps.length) return;

            if (changedProps.indexOf('curriculumClassification') !== -1) {
                var invalidCurriculum = (merged.curriculumClassification || []).filter(function (item) {
                    return typeof CURRICULUM_ITEMS === 'undefined' || !CURRICULUM_ITEMS.includes(item);
                });
                if (invalidCurriculum.length) {
                    errors.push('題目「' + merged.id + '」課程分類包含不在清單中的項目：' + invalidCurriculum.join('、'));
                    return;
                }
            }

            if (changedProps.indexOf('questionParts') !== -1 || changedProps.indexOf('partsStatus') !== -1) {
                var partsErr = reconcilePartsFields(merged, row.draft);
                if (partsErr) {
                    errors.push('題目「' + merged.id + '」' + partsErr + '。請填寫分題或改為尚未輸入／沒有分題。');
                    return;
                }
            }

            if (changedProps.indexOf('marks') !== -1
                || changedProps.indexOf('questionParts') !== -1
                || changedProps.indexOf('partsStatus') !== -1) {
                if (typeof validatePartMarksSum === 'function') {
                    var marksCheck = validatePartMarksSum(merged);
                    if (!marksCheck.ok) {
                        errors.push(marksCheck.error);
                        return;
                    }
                }
            }

            merged.id = row.original.id;
            merged.dateModified = new Date().toISOString();
            updates.push(merged);
        });

        return { updates: updates, errors: errors };
    }

    async function saveBulkEditChanges() {
        if (!canUseBulkEdit()) {
            window.alert('請先進入管理員模式。');
            return;
        }
        if (!window.storage || typeof window.storage.updateQuestion !== 'function') {
            window.alert('資料庫尚未就緒。');
            return;
        }

        var collected = collectChangedUpdates();
        if (collected.errors.length) {
            window.alert('無法儲存：\n\n' + collected.errors.join('\n'));
            return;
        }
        if (!collected.updates.length) {
            if (typeof showNotification === 'function') {
                showNotification('沒有變更需要儲存', 'info');
            } else {
                window.alert('沒有變更需要儲存');
            }
            return;
        }

        var ids = collected.updates.map(function (q) { return q.id; });
        var confirmMsg = '即將更新 ' + collected.updates.length + ' 題：\n\n'
            + ids.slice(0, 20).join('\n')
            + (ids.length > 20 ? '\n…（其餘 ' + (ids.length - 20) + ' 題）' : '')
            + '\n\n只寫入本機題庫；不會自動上傳（除非已開啟自動同步）。確定？';
        if (!window.confirm(confirmMsg)) return;

        setStatus('正在儲存 ' + collected.updates.length + ' 題…');
        try {
            for (var i = 0; i < collected.updates.length; i++) {
                await window.storage.updateQuestion(collected.updates[i]);
            }
            if (typeof refreshViews === 'function') await refreshViews();
            if (typeof maybeAutoSyncQuestions === 'function') {
                await maybeAutoSyncQuestions();
            }
            if (typeof showNotification === 'function') {
                showNotification('已更新 ' + collected.updates.length + ' 題', 'success');
            }
            await populateBulkEditTable();
        } catch (error) {
            console.error(error);
            window.alert('儲存失敗：' + (error && error.message ? error.message : '未知錯誤'));
            setStatus('儲存失敗');
        }
    }

    async function openBulkEditModal() {
        if (!(window.accessRights && window.accessRights.admin === true)) {
            window.alert('沒有管理員權限。');
            return;
        }
        if (typeof isAdminMode === 'undefined' || !isAdminMode) {
            window.alert('請先開啟管理員模式。');
            return;
        }
        ensureOverlay();
        overlay.hidden = false;
        document.body.classList.add('be-open');
        await populateBulkEditTable();
    }

    function closeBulkEditModal() {
        closeSuggest();
        if (overlay) overlay.hidden = true;
        document.body.classList.remove('be-open');
    }

    window.openBulkEditModal = openBulkEditModal;
    window.closeBulkEditModal = closeBulkEditModal;
})();
