// question-list-filter.js
// Shared helpers for applying an ID-set or condition-match layer onto the
// main 題目 list. Used by 資料檢查「篩選全部待處理」and 進階篩選.
//
// Layers:
//   window.idSetFilter       — exact question-id membership (bulk pending)
//   window.advancedFilter    — AND conditions via ConditionMatch (local only)
//
// These intersect with the existing tri-state / search filters in
// storage.applyFilters. Advanced filter never syncs to GitHub.
//
// Dependencies: ConditionMatch (optional for condition apply), filters.js
// (filterQuestions / updateSearchInfo / switchTab).

(function (global) {
    'use strict';

    function emptyIdSetFilter() {
        return { active: false, ids: null, label: '', source: '' };
    }

    function emptyAdvancedFilter() {
        return { active: false, conditions: [], label: '' };
    }

    if (!global.idSetFilter) global.idSetFilter = emptyIdSetFilter();
    if (!global.advancedFilter) global.advancedFilter = emptyAdvancedFilter();

    function toIdMap(ids) {
        var map = Object.create(null);
        var count = 0;
        (ids || []).forEach(function (raw) {
            var id = String(raw == null ? '' : raw).trim();
            if (!id || id === '(無編號)') return;
            if (!map[id]) {
                map[id] = true;
                count += 1;
            }
        });
        return { map: map, count: count };
    }

    function refreshQuestionList() {
        if (global.paginationState && global.paginationState.questions) {
            global.paginationState.questions.page = 1;
        }
        if (typeof switchTab === 'function') switchTab('questions');
        if (typeof filterQuestions === 'function') {
            filterQuestions();
        } else if (typeof renderQuestions === 'function') {
            renderQuestions();
        }
        if (typeof scrollToTop === 'function') scrollToTop();
    }

    function applyQuestionIdSetFilter(ids, options) {
        options = options || {};
        var packed = toIdMap(ids);
        global.idSetFilter = {
            active: packed.count > 0,
            ids: packed.count > 0 ? packed.map : null,
            label: options.label || ('指定題目 ' + packed.count + ' 題'),
            source: options.source || 'id-set'
        };
        if (options.clearAdvanced) {
            global.advancedFilter = emptyAdvancedFilter();
        }
        refreshQuestionList();
        return packed.count;
    }

    function clearQuestionIdSetFilter(options) {
        options = options || {};
        global.idSetFilter = emptyIdSetFilter();
        if (!options.silent) refreshQuestionList();
    }

    function applyAdvancedConditionFilter(conditions, options) {
        options = options || {};
        var Match = global.ConditionMatch;
        var normalized = Match && typeof Match.normalizeConditions === 'function'
            ? Match.normalizeConditions(conditions)
            : (conditions || []);
        if (!normalized.length) {
            global.advancedFilter = emptyAdvancedFilter();
            if (!options.silent) refreshQuestionList();
            return 0;
        }
        global.advancedFilter = {
            active: true,
            conditions: normalized,
            label: options.label || (Match && Match.conditionSummaryText
                ? Match.conditionSummaryText(normalized)
                : ('進階條件 ×' + normalized.length))
        };
        if (options.clearIdSet) {
            global.idSetFilter = emptyIdSetFilter();
        }
        if (!options.silent) refreshQuestionList();
        return normalized.length;
    }

    function clearAdvancedConditionFilter(options) {
        options = options || {};
        global.advancedFilter = emptyAdvancedFilter();
        if (!options.silent) refreshQuestionList();
    }

    function applyConditionsAsIdSet(questions, conditions, options) {
        options = options || {};
        var Match = global.ConditionMatch;
        if (!Match || typeof Match.matchingQuestionIds !== 'function') return 0;
        var ids = Match.matchingQuestionIds(questions || [], conditions);
        return applyQuestionIdSetFilter(ids, {
            label: options.label || ('進階符合 ' + ids.length + ' 題'),
            source: options.source || 'advanced-conditions',
            clearAdvanced: options.clearAdvanced !== false
        });
    }

    global.applyQuestionIdSetFilter = applyQuestionIdSetFilter;
    global.clearQuestionIdSetFilter = clearQuestionIdSetFilter;
    global.applyAdvancedConditionFilter = applyAdvancedConditionFilter;
    global.clearAdvancedConditionFilter = clearAdvancedConditionFilter;
    global.applyConditionsAsIdSet = applyConditionsAsIdSet;
    global.emptyIdSetFilter = emptyIdSetFilter;
    global.emptyAdvancedFilter = emptyAdvancedFilter;
})(window);
