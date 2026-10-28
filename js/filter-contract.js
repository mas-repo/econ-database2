// filter-contract.js
// Shared Filter Contract (version 1) for 題目 / 統計 filters.
//
// Humans keep the existing filter UI. Agents read and write the same
// session state through window.__SFC__ only. Empty fields mean unrestricted.
// This JSON is query state: it is not written to IndexedDB, GitHub sync,
// or question import/export payloads.
//
// applyLegacyFilters is the single bank-row engine (moved from
// storage-filters.js). IndexedDBStorage.applyFilters, gatherFilterState,
// and statsStateToFilters all go through this file.
//
// Dependencies at parse time: none.
// Runtime (same as the previous apply path): questionFeatureOn,
// questionHasPartPerformance, questionMatchesAiFilter, isAdminBlankFeature,
// ConditionMatch, accessRights, filterLogic, idSetFilter, advancedFilter.
//
// Load before storage-filters.js.

var SFC_VERSION = 1;
var SFC_APP = 'econ-database2';

var EMPTY_FIELD_SENTINEL = '__empty__';
var EMPTY_FIELD_LABELS = {
    graph: '尚未輸入',
    table: '尚未輸入',
    calculation: '尚未輸入',
    multipleSelection: '尚未輸入',
    concepts: '尚未輸入',
    patterns: '尚未輸入',
    stemPatterns: '尚未輸入'
};

var SFC_TRI_KEYS = [
    'curriculum', 'chapter', 'feature', 'adminBlank', 'partPerformance',
    'publisher', 'exam', 'qtype', 'section', 'paper', 'year',
    'concepts', 'patterns', 'stemPatterns', 'ai',
    'multipleSelection', 'graph', 'table', 'calculation'
];

function isBlankFilterValue(value) {
    if (value == null) return true;
    const text = String(value).trim();
    return text === '' || text === '-';
}

function meaningfulArrayValues(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => !isBlankFilterValue(item));
}

function isModalFieldEmpty(question, key) {
    const arrays = { concepts: 'concepts', patterns: 'patterns', stemPatterns: 'stemPatterns' };
    const scalars = {
        graph: 'graphType',
        table: 'tableType',
        calculation: 'calculationType',
        multipleSelection: 'multipleSelectionType'
    };
    if (arrays[key]) return meaningfulArrayValues(question[arrays[key]]).length === 0;
    if (scalars[key]) return isBlankFilterValue(question[scalars[key]]);
    return false;
}

function partitionEmptySelection(stateMap) {
    const checked = Object.keys(stateMap).filter(key => stateMap[key] === 'checked');
    const excluded = Object.keys(stateMap).filter(key => stateMap[key] === 'excluded');
    return {
        includeEmpty: checked.includes(EMPTY_FIELD_SENTINEL),
        excludeEmpty: excluded.includes(EMPTY_FIELD_SENTINEL),
        checked: checked.filter(key => key !== EMPTY_FIELD_SENTINEL),
        excluded: excluded.filter(key => key !== EMPTY_FIELD_SENTINEL)
    };
}

// Canonical year key for filters/stats matching only — does not rewrite stored
// q.year (writes use normalizeYear → MT##). Mock papers may still appear as
// legacy "39" or stored "MT39"; both become key "39" (UI label MT39 via
// yearFilterLabel). Four-digit exam years and tokens (PP / SP) stay as text.
function normalizeYearFilterKey(year) {
    if (year == null) return '';
    const text = String(year).trim();
    if (!text || text === '-') return '';
    const mt = text.match(/^MT\s*(\d{1,3})$/i);
    if (mt) return String(parseInt(mt[1], 10));
    if (/^\d{1,3}$/.test(text)) return String(parseInt(text, 10));
    if (/^\d{4}$/.test(text)) return text;
    return text;
}

function sfcRoot() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return {};
}

function sfcClone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
}

function sfcLogicToken(value) {
    return String(value || '').toUpperCase() === 'AND' ? 'AND' : 'OR';
}

function sfcQnumDefaults() {
    var min = 1;
    var max = 60;
    if (typeof QUESTION_NUMBER_RANGE !== 'undefined' && QUESTION_NUMBER_RANGE) {
        if (QUESTION_NUMBER_RANGE.min != null) min = QUESTION_NUMBER_RANGE.min;
        if (QUESTION_NUMBER_RANGE.max != null) max = QUESTION_NUMBER_RANGE.max;
    }
    return { active: false, min: min, max: max };
}

function sfcEmptyTriState() {
    var out = {};
    SFC_TRI_KEYS.forEach(function (key) { out[key] = {}; });
    return out;
}

function sfcNormalizeTriState(raw) {
    var out = sfcEmptyTriState();
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
        var map = raw[key];
        var clean = {};
        if (map && typeof map === 'object' && !Array.isArray(map)) {
            Object.keys(map).forEach(function (name) {
                if (map[name] === 'checked' || map[name] === 'excluded') clean[name] = map[name];
            });
        }
        out[key] = clean;
    });
    return out;
}

function sfcNormalizeRange(raw, defaults) {
    var range = {
        active: false,
        min: defaults.min,
        max: defaults.max
    };
    if (!raw || typeof raw !== 'object') return range;
    if (raw.min != null && raw.min !== '' && !isNaN(Number(raw.min))) range.min = Number(raw.min);
    if (raw.max != null && raw.max !== '' && !isNaN(Number(raw.max))) range.max = Number(raw.max);
    range.active = !!raw.active;
    return range;
}

function sfcNormalizeRanges(raw) {
    raw = raw || {};
    return {
        percentage: sfcNormalizeRange(raw.percentage, { min: 0, max: 100 }),
        marks: sfcNormalizeRange(raw.marks, { min: 0, max: 30 }),
        questionNumber: sfcNormalizeRange(raw.questionNumber, sfcQnumDefaults())
    };
}

function sfcIdList(rawIds) {
    var ids = [];
    var seen = {};
    if (Array.isArray(rawIds)) {
        rawIds.forEach(function (raw) {
            var id = String(raw == null ? '' : raw).trim();
            if (!id || seen[id]) return;
            seen[id] = true;
            ids.push(id);
        });
    } else if (rawIds && typeof rawIds === 'object') {
        Object.keys(rawIds).forEach(function (raw) {
            if (!rawIds[raw]) return;
            var id = String(raw).trim();
            if (!id || seen[id]) return;
            seen[id] = true;
            ids.push(id);
        });
        ids.sort();
    }
    return ids;
}

function sfcNormalizeIdSet(raw) {
    if (raw == null || raw === false) {
        return { active: false, ids: [], label: '', source: '' };
    }
    var ids = sfcIdList(raw.ids);
    var active = raw.active != null ? !!raw.active : ids.length > 0;
    return {
        active: active,
        ids: ids,
        label: raw.label ? String(raw.label) : '',
        source: raw.source ? String(raw.source) : ''
    };
}

function sfcNormalizeAdvanced(raw) {
    var conditions = [];
    if (raw && Array.isArray(raw.conditions)) {
        raw.conditions.forEach(function (item) {
            if (item && typeof item === 'object') conditions.push(sfcClone(item));
        });
    }
    var active = raw && raw.active != null ? !!raw.active : conditions.length > 0;
    return {
        active: active,
        conditions: conditions,
        label: raw && raw.label ? String(raw.label) : ''
    };
}

function sfcNormalizeLogic(raw) {
    raw = raw || {};
    return {
        curriculum: sfcLogicToken(raw.curriculum),
        chapter: sfcLogicToken(raw.chapter)
    };
}

function sfcAssertVersion(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Filter JSON 不是物件');
    }
    if (data.version != null && Number(data.version) !== SFC_VERSION) {
        throw new Error('Unsupported filter contract version: ' + data.version);
    }
}

function emptyQuestionsContract() {
    return {
        version: SFC_VERSION,
        surface: 'questions',
        search: '',
        searchScope: 'all',
        triState: sfcEmptyTriState(),
        filterLogic: { curriculum: 'OR', chapter: 'OR' },
        ranges: sfcNormalizeRanges(null),
        idSet: sfcNormalizeIdSet(null),
        advanced: sfcNormalizeAdvanced(null)
    };
}

function emptyStatsContract() {
    return {
        version: SFC_VERSION,
        surface: 'stats',
        search: '',
        searchScope: 'name',
        triState: sfcEmptyTriState(),
        filterLogic: { curriculum: 'OR', chapter: 'OR' },
        ranges: sfcNormalizeRanges(null)
    };
}

function normalizeQuestionsContract(raw) {
    if (raw && raw.questions && !raw.surface && !raw.triState) raw = raw.questions;
    sfcAssertVersion(raw || {});
    var base = emptyQuestionsContract();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.surface && raw.surface !== 'questions') {
        throw new Error('Expected questions filter contract');
    }
    base.search = raw.search == null ? '' : String(raw.search);
    base.searchScope = raw.searchScope ? String(raw.searchScope) : 'all';
    base.triState = sfcNormalizeTriState(raw.triState);
    base.filterLogic = sfcNormalizeLogic(raw.filterLogic);
    base.ranges = sfcNormalizeRanges(raw.ranges);
    base.idSet = sfcNormalizeIdSet(raw.idSet);
    base.advanced = sfcNormalizeAdvanced(raw.advanced);
    return base;
}

function normalizeStatsContract(raw) {
    if (raw && raw.stats && !raw.surface && !raw.triState) raw = raw.stats;
    sfcAssertVersion(raw || {});
    var base = emptyStatsContract();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.surface && raw.surface !== 'stats') {
        throw new Error('Expected stats filter contract');
    }
    base.search = raw.search == null ? '' : String(raw.search);
    base.searchScope = raw.searchScope ? String(raw.searchScope) : 'name';
    base.triState = sfcNormalizeTriState(raw.triState);
    base.filterLogic = sfcNormalizeLogic(raw.filterLogic || raw.logic);
    base.ranges = sfcNormalizeRanges(raw.ranges);
    return base;
}

function sfcIdSetToLegacy(idSet) {
    var normalized = sfcNormalizeIdSet(idSet);
    if (!normalized.active) {
        return {
            active: false,
            ids: null,
            label: normalized.label,
            source: normalized.source
        };
    }
    var map = Object.create(null);
    normalized.ids.forEach(function (id) { map[id] = true; });
    return {
        active: true,
        ids: map,
        label: normalized.label,
        source: normalized.source
    };
}

function sfcAdvancedToLegacy(advanced) {
    var normalized = sfcNormalizeAdvanced(advanced);
    return {
        active: !!normalized.active,
        conditions: normalized.conditions,
        label: normalized.label
    };
}

function questionsContractToLegacy(contract) {
    var normalized = normalizeQuestionsContract(contract);
    return {
        search: normalized.search,
        searchScope: normalized.searchScope,
        percentageFilter: sfcClone(normalized.ranges.percentage),
        marksFilter: sfcClone(normalized.ranges.marks),
        questionNumberFilter: sfcClone(normalized.ranges.questionNumber),
        triState: sfcClone(normalized.triState),
        filterLogic: {
            curriculum: normalized.filterLogic.curriculum,
            chapter: normalized.filterLogic.chapter
        },
        idSetFilter: sfcIdSetToLegacy(normalized.idSet),
        advancedFilter: sfcAdvancedToLegacy(normalized.advanced)
    };
}

// Same projection as the pre-contract statsStateToFilters.
function statsStateToLegacyFilters(state, omitKey) {
    var tri = JSON.parse(JSON.stringify(state.triState));
    if (omitKey && tri[omitKey]) tri[omitKey] = {};
    var filters = {
        search: '',
        searchScope: 'all',
        triState: tri,
        percentageFilter: state.percentage,
        marksFilter: state.marks,
        questionNumberFilter: state.qnum,
        filterLogic: {
            curriculum: state.logic.curriculum || 'OR',
            chapter: state.logic.chapter || 'OR'
        },
        idSetFilter: (typeof emptyIdSetFilter === 'function')
            ? emptyIdSetFilter()
            : { active: false, ids: null, label: '', source: '' },
        advancedFilter: (typeof emptyAdvancedFilter === 'function')
            ? emptyAdvancedFilter()
            : { active: false, conditions: [], label: '' }
    };
    var term = (state.search || '').trim();
    if (term && state.searchScope && state.searchScope !== 'name') {
        filters.search = term;
        filters.searchScope = state.searchScope;
    }
    return filters;
}

function statsContractToLegacy(contract, omitKey) {
    var normalized = normalizeStatsContract(contract);
    return statsStateToLegacyFilters({
        search: normalized.search,
        searchScope: normalized.searchScope,
        triState: normalized.triState,
        logic: normalized.filterLogic,
        percentage: normalized.ranges.percentage,
        marks: normalized.ranges.marks,
        qnum: normalized.ranges.questionNumber
    }, omitKey);
}

function sfcPermission(questions) {
    var root = sfcRoot();
    if (root.storage && typeof root.storage.applyPermissionFilter === 'function') {
        return root.storage.applyPermissionFilter(questions);
    }
    return sfcPermissionFallback(questions);
}

function sfcIsMockQuestion(q) {
    var id = String(q && q.id ? q.id : '');
    if (/^MT?\d/i.test(id)) return true;
    var publisher = String(q && q.publisher ? q.publisher : '');
    return publisher !== '' && publisher !== 'HKEAA' && publisher !== '-';
}

function sfcPermissionFallback(questions) {
    var root = sfcRoot();
    if (root.accessRights) {
        if (root.accessRights.mockTests === true) return questions;
        return (questions || []).filter(function (q) { return !sfcIsMockQuestion(q); });
    }
    if (!root.authManager || (typeof root.authManager.canViewMockTests === 'function' && root.authManager.canViewMockTests())) {
        return questions;
    }
    return (questions || []).filter(function (q) { return !sfcIsMockQuestion(q); });
}

function applyQuestionsFilterContract(questions, contract) {
    return applyLegacyFilters(questions || [], questionsContractToLegacy(contract), sfcPermission);
}

function applyStatsFilterContract(questions, contract, omitKey) {
    return applyLegacyFilters(questions || [], statsContractToLegacy(contract, omitKey), sfcPermission);
}

function sfcDoc() {
    return typeof document !== 'undefined' ? document : null;
}

function readQuestionsLegacy() {
    var root = sfcRoot();
    var doc = sfcDoc();
    var searchEl = doc && doc.getElementById ? doc.getElementById('search') : null;
    return {
        search: searchEl ? searchEl.value : '',
        searchScope: root.searchScope || 'all',
        percentageFilter: root.percentageFilter,
        marksFilter: root.marksFilter,
        questionNumberFilter: root.questionNumberFilter,
        triState: root.triStateFilters,
        idSetFilter: root.idSetFilter,
        advancedFilter: root.advancedFilter
    };
}

function sfcSnapshotIdSet(raw) {
    if (!raw || typeof raw !== 'object') return sfcNormalizeIdSet(null);
    return sfcNormalizeIdSet({
        active: !!raw.active,
        ids: raw.ids,
        label: raw.label || '',
        source: raw.source || ''
    });
}

function sfcSnapshotAdvanced(raw) {
    if (!raw || typeof raw !== 'object') return sfcNormalizeAdvanced(null);
    return sfcNormalizeAdvanced({
        active: !!raw.active,
        conditions: raw.conditions || [],
        label: raw.label || ''
    });
}

function readQuestionsFromUI() {
    var root = sfcRoot();
    var legacy = readQuestionsLegacy();
    var ranges = {
        percentage: legacy.percentageFilter || { active: false, min: 0, max: 100 },
        marks: legacy.marksFilter || { active: false, min: 0, max: 30 },
        questionNumber: legacy.questionNumberFilter || sfcQnumDefaults()
    };
    return normalizeQuestionsContract({
        version: SFC_VERSION,
        surface: 'questions',
        search: legacy.search,
        searchScope: legacy.searchScope,
        triState: legacy.triState,
        filterLogic: root.filterLogic,
        ranges: ranges,
        idSet: sfcSnapshotIdSet(legacy.idSetFilter),
        advanced: sfcSnapshotAdvanced(legacy.advancedFilter)
    });
}

function sfcSetInputValue(id, value) {
    var doc = sfcDoc();
    if (!doc || !doc.getElementById) return;
    var el = doc.getElementById(id);
    if (el) el.value = value;
}

function sfcSelectHasValue(select, value) {
    var options = select && select.options;
    if (!options) return false;
    for (var i = 0; i < options.length; i++) {
        if (options[i] && options[i].value === value) return true;
    }
    return false;
}

// The scope <select> only accepts a value that already has an <option>.
// filterQuestions() then copies the select back onto window.searchScope,
// so a missing option would drop the contract scope.
function sfcEnsureSelectValue(select, value) {
    if (!select) return;
    var wanted = value == null ? '' : String(value);
    if (!sfcSelectHasValue(select, wanted)) {
        var doc = sfcDoc();
        if (doc && doc.createElement && select.appendChild) {
            var opt = doc.createElement('option');
            opt.value = wanted;
            opt.textContent = wanted;
            select.appendChild(opt);
        }
    }
    select.value = wanted;
}

function sfcSetChecked(id, checked) {
    var doc = sfcDoc();
    if (!doc || !doc.getElementById) return;
    var el = doc.getElementById(id);
    if (el) el.checked = !!checked;
}

function sfcPaintQuestionRange(minId, maxId, minLabelId, maxLabelId, fillId, min, max, scaleMin, scaleMax) {
    var doc = sfcDoc();
    if (!doc || !doc.getElementById) return;
    var minEl = doc.getElementById(minId);
    var maxEl = doc.getElementById(maxId);
    if (minEl) minEl.value = min;
    if (maxEl) maxEl.value = max;
    var minLabel = doc.getElementById(minLabelId);
    var maxLabel = doc.getElementById(maxLabelId);
    if (minLabel) minLabel.textContent = String(min);
    if (maxLabel) maxLabel.textContent = String(max);
    var fill = doc.getElementById(fillId);
    if (!fill || !fill.style) return;
    var span = (scaleMax - scaleMin) || 1;
    var left = ((min - scaleMin) / span) * 100;
    var right = ((max - scaleMin) / span) * 100;
    fill.style.left = left + '%';
    fill.style.width = Math.max(0, right - left) + '%';
}

function writeQuestionsToUI(contract) {
    var root = sfcRoot();
    var normalized = normalizeQuestionsContract(contract);
    var doc = sfcDoc();
    var searchEl = doc && doc.getElementById ? doc.getElementById('search') : null;
    if (searchEl) searchEl.value = normalized.search;
    var scopeEl = doc && doc.getElementById ? doc.getElementById('search-scope') : null;
    sfcEnsureSelectValue(scopeEl, normalized.searchScope);
    root.searchScope = normalized.searchScope;

    root.triStateFilters = sfcClone(normalized.triState);
    if (!root.filterLogic) root.filterLogic = { curriculum: 'OR', chapter: 'OR' };
    root.filterLogic.curriculum = normalized.filterLogic.curriculum;
    root.filterLogic.chapter = normalized.filterLogic.chapter;
    sfcSetChecked('curriculum-logic-toggle', normalized.filterLogic.curriculum === 'AND');
    sfcSetChecked('chapter-logic-toggle', normalized.filterLogic.chapter === 'AND');

    root.percentageFilter = sfcClone(normalized.ranges.percentage);
    root.marksFilter = sfcClone(normalized.ranges.marks);
    root.questionNumberFilter = sfcClone(normalized.ranges.questionNumber);
    sfcPaintQuestionRange(
        'min-percentage', 'max-percentage',
        'min-percentage-display', 'max-percentage-display',
        'percentage-range-fill',
        normalized.ranges.percentage.min, normalized.ranges.percentage.max, 0, 100
    );
    sfcPaintQuestionRange(
        'min-marks', 'max-marks',
        'min-marks-display', 'max-marks-display',
        'marks-range-fill',
        normalized.ranges.marks.min, normalized.ranges.marks.max, 0, 30
    );
    var qnum = normalized.ranges.questionNumber;
    var qDefaults = sfcQnumDefaults();
    sfcPaintQuestionRange(
        'min-qnum', 'max-qnum',
        'min-qnum-display', 'max-qnum-display',
        'qnum-range-fill',
        qnum.min, qnum.max, qDefaults.min, qDefaults.max
    );

    root.idSetFilter = sfcIdSetToLegacy(normalized.idSet);
    root.advancedFilter = sfcAdvancedToLegacy(normalized.advanced);

    if (typeof updateStaticFilterVisuals === 'function') updateStaticFilterVisuals();
    function finishWrite() {
        // filterQuestions copies #search-scope back onto window.searchScope.
        // Put the contract value back if that control could not hold it.
        sfcEnsureSelectValue(scopeEl, normalized.searchScope);
        root.searchScope = normalized.searchScope;
        return normalized;
    }
    if (typeof filterQuestions === 'function') {
        return Promise.resolve(filterQuestions()).then(finishWrite);
    }
    return finishWrite();
}

function statsStateToContract(state) {
    state = state || {};
    return normalizeStatsContract({
        version: SFC_VERSION,
        surface: 'stats',
        search: state.search || '',
        searchScope: state.searchScope || 'name',
        triState: state.triState,
        filterLogic: state.logic,
        ranges: {
            percentage: state.percentage,
            marks: state.marks,
            questionNumber: state.qnum
        }
    });
}

function readStatsFromUI() {
    if (typeof getStatsTabState !== 'function') return emptyStatsContract();
    return statsStateToContract(getStatsTabState('stats'));
}

function writeStatsToUI(contract) {
    var normalized = normalizeStatsContract(contract);
    if (typeof getStatsTabState !== 'function') return normalized;
    var state = getStatsTabState('stats');
    state.search = normalized.search;
    state.searchScope = normalized.searchScope;
    state.triState = sfcClone(normalized.triState);
    if (!state.logic) state.logic = { curriculum: 'OR', chapter: 'OR' };
    state.logic.curriculum = normalized.filterLogic.curriculum;
    state.logic.chapter = normalized.filterLogic.chapter;
    state.percentage = sfcClone(normalized.ranges.percentage);
    state.marks = sfcClone(normalized.ranges.marks);
    state.qnum = sfcClone(normalized.ranges.questionNumber);
    state.page = 1;

    var doc = sfcDoc();
    if (doc && doc.querySelectorAll) {
        doc.querySelectorAll('[data-sf-search]').forEach(function (el) {
            el.value = normalized.search;
        });
        doc.querySelectorAll('[data-sf-scope]').forEach(function (el) {
            el.value = normalized.searchScope;
        });
    }
    if (typeof paintStatsRange === 'function') {
        var dims = typeof listStatDimensionIds === 'function' ? listStatDimensionIds() : [];
        dims.forEach(function (dim) {
            paintStatsRange(dim, 'percentage');
            paintStatsRange(dim, 'marks');
            paintStatsRange(dim, 'qnum');
        });
    }
    if (typeof scheduleStatsRender === 'function') scheduleStatsRender('stats');
    return normalized;
}

function sfcParseInput(input) {
    if (typeof input === 'string') {
        if (!input.trim()) throw new Error('Filter JSON 是空的');
        return JSON.parse(input);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Filter JSON 不是物件');
    }
    return input;
}

function exportFilterObject() {
    return {
        version: SFC_VERSION,
        app: SFC_APP,
        questions: readQuestionsFromUI(),
        stats: readStatsFromUI()
    };
}

function exportFilterJSON() {
    return JSON.stringify(exportFilterObject(), null, 2);
}

function importFilterJSON(input) {
    var data = sfcParseInput(input);
    sfcAssertVersion(data);
    var jobs = [];
    if (data.questions || data.stats || data.app) {
        if (data.questions) {
            sfcAssertVersion(data.questions);
            jobs.push(writeQuestionsToUI(data.questions));
        }
        if (data.stats) {
            sfcAssertVersion(data.stats);
            jobs.push(writeStatsToUI(data.stats));
        }
    } else if (data.surface === 'stats') {
        jobs.push(writeStatsToUI(data));
    } else {
        jobs.push(writeQuestionsToUI(data));
    }
    return Promise.resolve()
        .then(function () { return Promise.all(jobs); })
        .then(function () { return exportFilterObject(); });
}

var FilterContract = {
    version: SFC_VERSION,
    app: SFC_APP,
    emptyQuestionsContract: emptyQuestionsContract,
    emptyStatsContract: emptyStatsContract,
    normalizeQuestionsContract: normalizeQuestionsContract,
    normalizeStatsContract: normalizeStatsContract,
    questionsContractToLegacy: questionsContractToLegacy,
    statsStateToLegacyFilters: statsStateToLegacyFilters,
    statsContractToLegacy: statsContractToLegacy,
    readQuestionsLegacy: readQuestionsLegacy,
    readQuestionsFromUI: readQuestionsFromUI,
    writeQuestionsToUI: writeQuestionsToUI,
    readStatsFromUI: readStatsFromUI,
    writeStatsToUI: writeStatsToUI,
    applyQuestionsFilterContract: applyQuestionsFilterContract,
    applyStatsFilterContract: applyStatsFilterContract,
    importFilterJSON: importFilterJSON,
    exportFilterJSON: exportFilterJSON,
    exportFilterObject: exportFilterObject
};

var __SFC__ = {
    version: SFC_VERSION,
    importFilterJSON: importFilterJSON,
    exportFilterJSON: exportFilterJSON,
    readQuestionsFromUI: readQuestionsFromUI,
    writeQuestionsToUI: writeQuestionsToUI,
    readStatsFromUI: readStatsFromUI,
    writeStatsToUI: writeStatsToUI,
    applyQuestionsFilterContract: applyQuestionsFilterContract,
    applyStatsFilterContract: applyStatsFilterContract,
    emptyQuestionsContract: emptyQuestionsContract,
    emptyStatsContract: emptyStatsContract
};

sfcRoot().FilterContract = FilterContract;
sfcRoot().__SFC__ = __SFC__;

function applyLegacyFilters(questions, filters, applyPermission) {
    // Mock papers are omitted unless the proxy granted mockTests.
    questions = applyPermission(questions);

    // Apply search filter with Scope
    if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const scope = filters.searchScope || 'all';

        questions = questions.filter(q => {
            // Helper for checking content
            const checkId = () => q.id && String(q.id).toLowerCase().includes(searchLower);
            const checkExam = () => q.examination && q.examination.toLowerCase().includes(searchLower);
            const checkSection = () => q.section && q.section.toLowerCase().includes(searchLower);
            const checkNum = () => q.questionNumber && q.questionNumber.toLowerCase().includes(searchLower);
            const checkContent = () => (q.questionTextChi && q.questionTextChi.toLowerCase().includes(searchLower)) ||
                                     (q.questionTextEng && q.questionTextEng.toLowerCase().includes(searchLower)) ||
                                     (q.plainText && q.plainText.toLowerCase().includes(searchLower)) ||
                                     (q.topic && q.topic.toLowerCase().includes(searchLower));
            const checkPublisher = () => q.publisher && q.publisher.toLowerCase().includes(searchLower);
            const checkAnswer = () => {
                return (q.answerMC && q.answerMC.toLowerCase().includes(searchLower)) ||
                       (q.answerChi && q.answerChi.toLowerCase().includes(searchLower)) ||
                       (q.answerEng && q.answerEng.toLowerCase().includes(searchLower));
            };
            const checkReport = () => {
                return (q.markersReportChi && q.markersReportChi.toLowerCase().includes(searchLower)) ||
                       (q.markersReportEng && q.markersReportEng.toLowerCase().includes(searchLower));
            };            

            switch (scope) {
                case 'id':
                    return checkId();
                case 'content':
                    return checkContent();
                case 'publisher':
                    return checkPublisher();
                case 'exam':
                    return checkExam() || checkSection() || checkNum();
                case 'answer':
                    return checkAnswer();
                case 'concepts':
                    return q.concepts && Array.isArray(q.concepts) && q.concepts.some(c => c.toLowerCase().includes(searchLower));
                case 'patterns':
                    return q.patterns && Array.isArray(q.patterns) && q.patterns.some(p => p.toLowerCase().includes(searchLower));
                case 'stemPatterns':
                    return q.stemPatterns && Array.isArray(q.stemPatterns) && q.stemPatterns.some(p => p.toLowerCase().includes(searchLower));
                case 'markersReport':
                    return checkReport();
                case 'section':
                    return checkSection();
                case 'all':
                default:
                    return checkId() || checkExam() || checkSection() || checkNum() || checkContent() || checkPublisher() || checkAnswer() || checkReport();
            }
        });
    }
    
    // Apply exam filter
    if (filters.examination) {
        questions = questions.filter(q => q.examination === filters.examination);
    }
    
    // REMOVED: Old single-value year filter
    /* if (filters.year) {
        questions = questions.filter(q => String(q.year) === String(filters.year));
    } */
    
    // Apply question type filter
    if (filters.questionType) {
        questions = questions.filter(q => q.questionType === filters.questionType);
    }

    // Percentage filter
    if (filters.percentageFilter && filters.percentageFilter.active) {
        const { min, max } = filters.percentageFilter;
        
        questions = questions.filter(q => {
            if (q.correctPercentage === undefined || 
                q.correctPercentage === null || 
                q.correctPercentage === '') {
                return false;
            }
            
            const percentage = parseFloat(q.correctPercentage);
            
            if (isNaN(percentage)) {
                return false;
            }
            
            return percentage >= min && percentage <= max;
        });
        
    }

    // Marks filter
    if (filters.marksFilter && filters.marksFilter.active) {
        const { min, max } = filters.marksFilter;
        
        questions = questions.filter(q => {
            if (q.marks === undefined || 
                q.marks === null || 
                q.marks === '') {
                return false;
            }
            
            const marks = parseFloat(q.marks);
            
            if (isNaN(marks)) {
                return false;
            }
            
            return marks >= min && marks <= max;
        });
    }

    // Question number filter — last digits of id (e.g. DSE-2026-P1-01 → 1)
    if (filters.questionNumberFilter && filters.questionNumberFilter.active) {
        const { min, max } = filters.questionNumberFilter;

        questions = questions.filter(q => {
            let num = NaN;
            if (q.id) {
                const idMatch = String(q.id).match(/(\d+)\s*$/);
                if (idMatch) num = parseInt(idMatch[1], 10);
            }
            if (isNaN(num) && q.questionNumber !== undefined && q.questionNumber !== null && q.questionNumber !== '') {
                const qnMatch = String(q.questionNumber).match(/^(\d+)/);
                if (qnMatch) num = parseInt(qnMatch[1], 10);
            }
            if (isNaN(num)) return false;
            return num >= min && num <= max;
        });
    }

    // Tri-state filters
    if (filters.triState) {
        if (filters.triState.publisher) {
            const checkedPublishers = Object.keys(filters.triState.publisher).filter(k => filters.triState.publisher[k] === 'checked');
            const excludedPublishers = Object.keys(filters.triState.publisher).filter(k => filters.triState.publisher[k] === 'excluded');

            if (checkedPublishers.length > 0) {
                questions = questions.filter(q => checkedPublishers.includes(q.publisher));
            }

            if (excludedPublishers.length > 0) {
                questions = questions.filter(q => !excludedPublishers.includes(q.publisher));
            }
        }

        // Exam type filters
        if (filters.triState.exam) {
            const checkedExams = Object.keys(filters.triState.exam).filter(k => filters.triState.exam[k] === 'checked');
            const excludedExams = Object.keys(filters.triState.exam).filter(k => filters.triState.exam[k] === 'excluded');
            
            if (checkedExams.length > 0) {
                questions = questions.filter(q => checkedExams.includes(q.examination));
            }
            
            if (excludedExams.length > 0) {
                questions = questions.filter(q => !excludedExams.includes(q.examination));
            }
        }

        // ADDED: Year tri-state filter
        if (filters.triState.year) {
            const checkedYears = Object.keys(filters.triState.year)
                .filter(k => filters.triState.year[k] === 'checked')
                .map(normalizeYearFilterKey)
                .filter(Boolean);
            const excludedYears = Object.keys(filters.triState.year)
                .filter(k => filters.triState.year[k] === 'excluded')
                .map(normalizeYearFilterKey)
                .filter(Boolean);

            if (checkedYears.length > 0) {
                // OR Logic: Question matches any of the checked years
                // (canonical keys so "39" and "MT39" are the same logical year)
                questions = questions.filter(q => checkedYears.includes(normalizeYearFilterKey(q.year)));
            }

            if (excludedYears.length > 0) {
                // Exclude if matches any of the excluded years
                questions = questions.filter(q => !excludedYears.includes(normalizeYearFilterKey(q.year)));
            }
        }

        // Question type filters
        if (filters.triState.qtype) {
            const checkedQtypes = Object.keys(filters.triState.qtype).filter(k => filters.triState.qtype[k] === 'checked');
            const excludedQtypes = Object.keys(filters.triState.qtype).filter(k => filters.triState.qtype[k] === 'excluded');
            
            if (checkedQtypes.length > 0) {
                questions = questions.filter(q => checkedQtypes.includes(q.questionType));
            }
            
            if (excludedQtypes.length > 0) {
                questions = questions.filter(q => !excludedQtypes.includes(q.questionType));
            }
        }

            // Curriculum filters
                    if (filters.triState.curriculum) {
                        const checkedCurr = Object.keys(filters.triState.curriculum).filter(k => filters.triState.curriculum[k] === 'checked');
                        const excludedCurr = Object.keys(filters.triState.curriculum).filter(k => filters.triState.curriculum[k] === 'excluded');
                        
                        // Prefer logic passed with this filter set (stats tabs).
                        // The questions tab keeps using window.filterLogic.
                        const logic = (filters.filterLogic && filters.filterLogic.curriculum)
                            || (window.filterLogic && window.filterLogic.curriculum)
                            || 'OR';

                        if (checkedCurr.length > 0) {
                            questions = questions.filter(q => {
                                if (!q.curriculumClassification || !Array.isArray(q.curriculumClassification)) return false;
                                
                                // Logic Check: AND vs OR
                                if (logic === 'AND') {
                                    // AND Logic: Question must contain ALL selected curriculum tags
                                    return checkedCurr.every(curr => q.curriculumClassification.includes(curr));
                                } else {
                                    // OR Logic (Default): Question must contain AT LEAST ONE selected tag
                                    return checkedCurr.some(curr => q.curriculumClassification.includes(curr));
                                }
                            });
                        }
                        
                        if (excludedCurr.length > 0) {
                            questions = questions.filter(q => {
                                if (!q.curriculumClassification || !Array.isArray(q.curriculumClassification)) return true;
                                // Excluded logic remains the same (exclude if ANY match found)
                                return !excludedCurr.some(curr => q.curriculumClassification.includes(curr));
                            });
                        }
                    }

        // Chapter filters
        if (filters.triState.chapter) {
            const checkedChapter = Object.keys(filters.triState.chapter).filter(k => filters.triState.chapter[k] === 'checked');
            const excludedChapter = Object.keys(filters.triState.chapter).filter(k => filters.triState.chapter[k] === 'excluded');
            
            // Prefer logic passed with this filter set (stats tabs).
            const logic = (filters.filterLogic && filters.filterLogic.chapter)
                || (window.filterLogic && window.filterLogic.chapter)
                || 'OR';

            if (checkedChapter.length > 0) {
                questions = questions.filter(q => {
                    if (!q.AristochapterClassification || !Array.isArray(q.AristochapterClassification)) return false;
                    
                    // Logic Check: AND vs OR
                    if (logic === 'AND') {
                        // AND Logic: Question must contain ALL selected chapter tags
                        return checkedChapter.every(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                    } else {
                        // OR Logic (Default): Question must contain AT LEAST ONE selected chapter tag
                        return checkedChapter.some(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                    }
                });
            }
            
            if (excludedChapter.length > 0) {
                questions = questions.filter(q => {
                    if (!q.AristochapterClassification || !Array.isArray(q.AristochapterClassification)) return true;
                    // Excluded logic remains the same (exclude if ANY match found)
                    return !excludedChapter.some(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                });
            }
        }

        // Concept filters
        if (filters.triState.concepts) {
            const conceptPick = partitionEmptySelection(filters.triState.concepts);

            if (conceptPick.checked.length > 0 || conceptPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (conceptPick.includeEmpty && isModalFieldEmpty(q, 'concepts')) return true;
                    if (!conceptPick.checked.length) return false;
                    if (!q.concepts || !Array.isArray(q.concepts)) return false;
                    return conceptPick.checked.some(c => q.concepts.includes(c));
                });
            }

            if (conceptPick.excluded.length > 0 || conceptPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (conceptPick.excludeEmpty && isModalFieldEmpty(q, 'concepts')) return false;
                    if (!q.concepts || !Array.isArray(q.concepts)) return true;
                    return !conceptPick.excluded.some(c => q.concepts.includes(c));
                });
            }
        }

        // Pattern filters
        if (filters.triState.patterns) {
            const patternPick = partitionEmptySelection(filters.triState.patterns);

            if (patternPick.checked.length > 0 || patternPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (patternPick.includeEmpty && isModalFieldEmpty(q, 'patterns')) return true;
                    if (!patternPick.checked.length) return false;
                    if (!q.patterns || !Array.isArray(q.patterns)) return false;
                    return patternPick.checked.some(p => q.patterns.includes(p));
                });
            }

            if (patternPick.excluded.length > 0 || patternPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (patternPick.excludeEmpty && isModalFieldEmpty(q, 'patterns')) return false;
                    if (!q.patterns || !Array.isArray(q.patterns)) return true;
                    return !patternPick.excluded.some(p => q.patterns.includes(p));
                });
            }
        }

        // Stem pattern filters
        if (filters.triState.stemPatterns) {
            const stemPick = partitionEmptySelection(filters.triState.stemPatterns);

            if (stemPick.checked.length > 0 || stemPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (stemPick.includeEmpty && isModalFieldEmpty(q, 'stemPatterns')) return true;
                    if (!stemPick.checked.length) return false;
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return false;
                    return stemPick.checked.some(p => q.stemPatterns.includes(p));
                });
            }

            if (stemPick.excluded.length > 0 || stemPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (stemPick.excludeEmpty && isModalFieldEmpty(q, 'stemPatterns')) return false;
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return true;
                    return !stemPick.excluded.some(p => q.stemPatterns.includes(p));
                });
            }
        }

        // Paper (卷一 / 卷二). Values are stored as "1" / "2".
        if (filters.triState.paper) {
            const checkedPapers = Object.keys(filters.triState.paper).filter(k => filters.triState.paper[k] === 'checked');
            const excludedPapers = Object.keys(filters.triState.paper).filter(k => filters.triState.paper[k] === 'excluded');

            if (checkedPapers.length > 0) {
                questions = questions.filter(q => checkedPapers.includes(String(q.paper)));
            }

            if (excludedPapers.length > 0) {
                questions = questions.filter(q => !excludedPapers.includes(String(q.paper)));
            }
        }

        // Section filters
        if (filters.triState.section) {
            const checkedSections = Object.keys(filters.triState.section).filter(k => filters.triState.section[k] === 'checked');
            const excludedSections = Object.keys(filters.triState.section).filter(k => filters.triState.section[k] === 'excluded');
            
            if (checkedSections.length > 0) {
                questions = questions.filter(q => checkedSections.includes(q.section));
            }
            
            if (excludedSections.length > 0) {
                questions = questions.filter(q => !excludedSections.includes(q.section));
            }
        }

        // AI解釋 filter (side-file index; legacy AIExplanation URL ignored)
        if (filters.triState.ai) {
            const aiMap = filters.triState.ai;
            const hasSelection = Object.keys(aiMap).some(k => aiMap[k] === 'checked' || aiMap[k] === 'excluded');
            if (hasSelection) {
                if (typeof questionMatchesAiFilter === 'function') {
                    questions = questions.filter(q => questionMatchesAiFilter(q, aiMap));
                } else if (window.AiExplanation && typeof AiExplanation.questionMatchesAiFilter === 'function') {
                    questions = questions.filter(q => AiExplanation.questionMatchesAiFilter(q, aiMap));
                }
            }
        }

        // Multiple Selection Filter
        if (filters.triState.multipleSelection) {
            const pick = partitionEmptySelection(filters.triState.multipleSelection);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'multipleSelection')) return true;
                    return pick.checked.includes(q.multipleSelectionType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'multipleSelection')) return false;
                    return !pick.excluded.includes(q.multipleSelectionType);
                });
            }
        }

        // Graph Filter
        if (filters.triState.graph) {
            const pick = partitionEmptySelection(filters.triState.graph);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'graph')) return true;
                    return pick.checked.includes(q.graphType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'graph')) return false;
                    return !pick.excluded.includes(q.graphType);
                });
            }
        }

        // Table Filter
        if (filters.triState.table) {
            const pick = partitionEmptySelection(filters.triState.table);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'table')) return true;
                    return pick.checked.includes(q.tableType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'table')) return false;
                    return !pick.excluded.includes(q.tableType);
                });
            }
        }

        // Calculation Filter
        if (filters.triState.calculation) {
            const pick = partitionEmptySelection(filters.triState.calculation);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'calculation')) return true;
                    return pick.checked.includes(q.calculationType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'calculation')) return false;
                    return !pick.excluded.includes(q.calculationType);
                });
            }
        }

        // Feature filters (product-ish 特徵 only)
        if (filters.triState.feature) {
            const features = filters.triState.feature;
            
            Object.entries(features).forEach(([value, state]) => {
                // Ignore legacy admin-blank keys left under feature after logout / older sessions.
                if (typeof isAdminBlankFeature === 'function' && isAdminBlankFeature(value)) {
                    return;
                }
                if (state === 'checked' || state === 'excluded') {
                    const wantOn = state === 'checked';
                    questions = questions.filter(q => {
                        if (typeof questionFeatureOn === 'function') {
                            const on = questionFeatureOn(q, value);
                            return wantOn ? on : !on;
                        }
                        return true;
                    });
                }
            });
        }

        // Admin-only 空白／缺漏 filters (same matchers via questionFeatureOn)
        if (filters.triState.adminBlank) {
            const adminOk = !!(typeof window !== 'undefined' && window.accessRights && window.accessRights.admin === true);
            if (adminOk) {
                Object.entries(filters.triState.adminBlank).forEach(([value, state]) => {
                    if (state === 'checked' || state === 'excluded') {
                        const wantOn = state === 'checked';
                        questions = questions.filter(q => {
                            if (typeof questionFeatureOn === 'function') {
                                const on = questionFeatureOn(q, value);
                                return wantOn ? on : !on;
                            }
                            return true;
                        });
                    }
                });
            }
        }

        if (filters.triState.partPerformance) {
            Object.entries(filters.triState.partPerformance).forEach(([value, state]) => {
                if (state === 'checked') {
                    questions = questions.filter(q => {
                        return typeof questionHasPartPerformance === 'function'
                            ? questionHasPartPerformance(q, value)
                            : false;
                    });
                } else if (state === 'excluded') {
                    questions = questions.filter(q => {
                        return typeof questionHasPartPerformance === 'function'
                            ? !questionHasPartPerformance(q, value)
                            : true;
                    });
                }
            });
        }
    }

    // Exact ID-set / advanced: fall back to window.* only when the caller
    // omitted the key (題目 gatherFilterState). Stats must pass inactive
    // layers explicitly so counts never inherit 題目 idSet / 進階篩選.
    var idSet = Object.prototype.hasOwnProperty.call(filters, 'idSetFilter')
        ? filters.idSetFilter
        : (typeof window !== 'undefined' ? window.idSetFilter : null);
    if (idSet && idSet.active && idSet.ids) {
        questions = questions.filter(function (q) {
            var id = q && q.id != null ? String(q.id) : '';
            return !!(id && idSet.ids[id]);
        });
    }

    // Advanced condition layer (local-only; ConditionMatch AND).
    var advanced = Object.prototype.hasOwnProperty.call(filters, 'advancedFilter')
        ? filters.advancedFilter
        : (typeof window !== 'undefined' ? window.advancedFilter : null);
    if (advanced && advanced.active && Array.isArray(advanced.conditions) && advanced.conditions.length) {
        var Match = typeof window !== 'undefined' ? window.ConditionMatch : null;
        if (Match && typeof Match.matchesAllConditions === 'function') {
            questions = questions.filter(function (q) {
                return Match.matchesAllConditions(q, advanced.conditions);
            });
        }
    }
    
    return questions;
}

