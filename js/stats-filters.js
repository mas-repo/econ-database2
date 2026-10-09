// stats-filters.js
// Filters for the unified 「統計」tab (一維瀏覽 + 交叉分析).
//
// Dimensions (概念 / 課程分類 / 章節 / 題型 / 題幹模式 / 出版商) share one
// filter bar and one filter state. The active dimension is hidden from the
// filter bar via hideOn. State is independent of the 題目 tab until jump.
//
// Dependencies: storage-filters.js (applyFilters, filterLogic override),
// constants.js, utils.js (escapeHTML, debounce), filters.js
// (filterQuestions, closeAllDropdowns, yearFilterLabel, paperFilterLabel)

const STATS_SHARED_MOUNT = 'stats-filters';
const STATS_SHARED_GRID = 'stats-grid';
const STATS_SHARED_PAGER = 'stats-pager';
const STATS_STATE_KEY = 'stats';

const STAT_TABS = {
    concepts: {
        label: '概念',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'concepts',
        empty: '暫無概念資料',
        filteredEmpty: '沒有符合篩選的概念',
        defaultSort: 'count-desc',
        defaultPageSize: 48,
        valuesOf(q) {
            return Array.isArray(q.concepts) ? q.concepts : [];
        }
    },
    topics: {
        label: '課程分類',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'curriculum',
        empty: '暫無課程分類資料',
        filteredEmpty: '沒有符合篩選的課程分類',
        defaultSort: 'curriculum',
        defaultPageSize: -1,
        valuesOf(q) {
            return Array.isArray(q.curriculumClassification) ? q.curriculumClassification : [];
        }
    },
    chapters: {
        label: '章節',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'chapter',
        empty: '暫無章節資料',
        filteredEmpty: '沒有符合篩選的章節',
        defaultSort: 'number',
        defaultPageSize: -1,
        valuesOf(q) {
            return Array.isArray(q.AristochapterClassification) ? q.AristochapterClassification : [];
        }
    },
    patterns: {
        label: '題型',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'patterns',
        empty: '暫無題型資料',
        filteredEmpty: '沒有符合篩選的題型',
        defaultSort: 'count-desc',
        defaultPageSize: -1,
        valuesOf(q) {
            return Array.isArray(q.patterns) ? q.patterns : [];
        }
    },
    stemPatterns: {
        label: '題幹模式',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'stemPatterns',
        empty: '暫無題幹模式資料',
        filteredEmpty: '沒有符合篩選的題幹模式',
        defaultSort: 'count-desc',
        defaultPageSize: 24,
        valuesOf(q) {
            return Array.isArray(q.stemPatterns) ? q.stemPatterns : [];
        }
    },
    publishers: {
        label: '出版商',
        mountId: STATS_SHARED_MOUNT,
        gridId: STATS_SHARED_GRID,
        pagerId: STATS_SHARED_PAGER,
        groupKey: 'publisher',
        empty: '暫無出版商資料',
        filteredEmpty: '沒有符合篩選的出版商',
        defaultSort: 'count-desc',
        defaultPageSize: -1,
        valuesOf(q) {
            const text = String(q && q.publisher != null ? q.publisher : '').trim();
            return [text || 'Unknown'];
        }
    }
};

window.statsActiveDimension = window.statsActiveDimension || 'concepts';
window.statsViewMode = window.statsViewMode || 'browse'; // browse | crosstab

function getStatsActiveDimension() {
    const dim = window.statsActiveDimension;
    return STAT_TABS[dim] ? dim : 'concepts';
}

function setStatsActiveDimension(dim) {
    if (!STAT_TABS[dim]) return getStatsActiveDimension();
    window.statsActiveDimension = dim;
    return dim;
}

function statsStateKey(tabId) {
    if (tabId === STATS_STATE_KEY || STAT_TABS[tabId]) return STATS_STATE_KEY;
    return tabId;
}

function resolveStatsDimension(tabId) {
    if (tabId === STATS_STATE_KEY || tabId === 'stats') return getStatsActiveDimension();
    if (STAT_TABS[tabId]) return tabId;
    return getStatsActiveDimension();
}

// hideOn: the dimension that is already grouped (hidden from filter bar).
// optional: hidden when the loaded bank has no values.
const STAT_FILTER_DEFS = [
    { key: 'concepts', label: '💡 概念類型', kind: 'concepts', hideOn: ['concepts'] },
    { key: 'curriculum', label: '📚 課程分類', kind: 'curriculum', logic: true, hideOn: ['topics'] },
    { key: 'chapter', label: '📖 Chapters', kind: 'chapter', logic: true, hideOn: ['chapters'] },
    { key: 'patterns', label: '🎯 題型', kind: 'patterns', hideOn: ['patterns'] },
    { key: 'stemPatterns', label: '🧩 題幹模式', kind: 'stemPatterns', hideOn: ['stemPatterns'] },
    { key: 'qtype', label: '📝 題目類型', kind: 'qtype' },
    { key: 'exam', label: '📝 考試', kind: 'exam' },
    { key: 'year', label: '📅 年份', kind: 'year' },
    { key: 'paper', label: '📄 卷別', kind: 'paper' },
    { key: 'section', label: '📝 Section', kind: 'section' },
    { key: 'publisher', label: '🏢 出版商', kind: 'publisher', hideOn: ['publishers'] },
    { key: 'feature', label: '🎯 特徵', kind: 'feature' },
    { key: 'partPerformance', label: '📈 分題表現', kind: 'partPerformance' },
    { key: 'graph', label: '📊 圖表類型', kind: 'scalar', field: 'graphType', optional: true },
    { key: 'table', label: '📅 表格類型', kind: 'scalar', field: 'tableType', optional: true },
    { key: 'calculation', label: '🧮 計算類型', kind: 'scalar', field: 'calculationType', optional: true },
    { key: 'multipleSelection', label: '🔍 複選類型', kind: 'scalar', field: 'multipleSelectionType', optional: true },
    { key: 'percentage', label: '📊 答對率', kind: 'range', range: 'percentage' },
    { key: 'marks', label: '💯 分數', kind: 'range', range: 'marks' },
    { key: 'qnum', label: '#️⃣ 題號', kind: 'range', range: 'qnum' },
    { key: 'ai', label: '🤖 AI 詳解', kind: 'ai', optional: true }
];

const STAT_SEARCH_SCOPES = [
    { value: 'name', label: '名稱' },
    { value: 'content', label: '題目內容' },
    { value: 'id', label: '題目 ID' },
    { value: 'answer', label: '答案' },
    { value: 'concepts', label: '相關概念' },
    { value: 'patterns', label: '題型標籤' },
    { value: 'stemPatterns', label: '題幹模式' }
];

const STAT_SECTION_LABELS = {
    'A': '甲部（短題目）',
    'B': '乙部（結構/文章式/資料回應試題）',
    'C': '丙部（選修單元）',
    '-': 'NA'
};

const QNUM_MIN_STATS = (typeof QUESTION_NUMBER_RANGE !== 'undefined') ? QUESTION_NUMBER_RANGE.min : 1;
const QNUM_MAX_STATS = (typeof QUESTION_NUMBER_RANGE !== 'undefined') ? QUESTION_NUMBER_RANGE.max : 60;

const statsFilterState = {};
const statsRenderGen = {};
let statsUiBound = false;
let sfModal = null;
let sfOpenToken = 0;

function emptyStatsTriState() {
    return {
        curriculum: {},
        chapter: {},
        feature: { 'Out syl': 'excluded' },
        publisher: {},
        exam: {},
        qtype: {},
        section: {},
        paper: {},
        year: {},
        concepts: {},
        patterns: {},
        stemPatterns: {},
        ai: {},
        multipleSelection: {},
        graph: {},
        table: {},
        calculation: {}
    };
}

function getStatsTabState(tabId) {
    const key = statsStateKey(tabId);
    if (!statsFilterState[key]) {
        const cfg = STAT_TABS[resolveStatsDimension(tabId)] || STAT_TABS.concepts;
        statsFilterState[key] = {
            search: '',
            searchScope: 'name',
            sort: cfg.defaultSort,
            page: 1,
            pageSize: cfg.defaultPageSize,
            collapsed: false,
            triState: emptyStatsTriState(),
            logic: { curriculum: 'OR', chapter: 'OR' },
            percentage: { min: 0, max: 100, active: false },
            marks: { min: 0, max: 30, active: false },
            qnum: { min: QNUM_MIN_STATS, max: QNUM_MAX_STATS, active: false }
        };
    }
    return statsFilterState[key];
}

function statsStateToFilters(state, omitKey) {
    const tri = JSON.parse(JSON.stringify(state.triState));
    if (omitKey && tri[omitKey]) tri[omitKey] = {};
    const filters = {
        search: '',
        searchScope: 'all',
        triState: tri,
        percentageFilter: state.percentage,
        marksFilter: state.marks,
        questionNumberFilter: state.qnum,
        filterLogic: {
            curriculum: state.logic.curriculum || 'OR',
            chapter: state.logic.chapter || 'OR'
        }
    };
    const term = (state.search || '').trim();
    if (term && state.searchScope && state.searchScope !== 'name') {
        filters.search = term;
        filters.searchScope = state.searchScope;
    }
    return filters;
}

function questionsMatchingStatsFilters(tabId, questions) {
    if (!window.storage || typeof window.storage.applyFilters !== 'function') return questions || [];
    return window.storage.applyFilters(questions || [], statsStateToFilters(getStatsTabState(tabId)));
}

function statsNameQuery(tabId) {
    const state = getStatsTabState(tabId);
    if (state.searchScope !== 'name') return '';
    return (state.search || '').trim().toLowerCase();
}

function chapterFilterValue(raw) {
    const match = String(raw).match(/(\d+)/);
    return match ? match[1].padStart(2, '0') : String(raw);
}

function statsRowPresentation(tabId, value) {
    const text = String(value);
    if (tabId === 'chapters') {
        const padded = chapterFilterValue(text);
        const name = (typeof CHAPTER_DESCRIPTIONS !== 'undefined' && CHAPTER_DESCRIPTIONS[padded])
            ? CHAPTER_DESCRIPTIONS[padded]
            : '';
        const titleHtml = `${escapeHTML(text)}${name ? ` <span class="stat-card-sub">${escapeHTML(name)}</span>` : ''}`;
        return {
            titleHtml,
            searchText: `${text} ${padded} ${name}`,
            filterValue: padded
        };
    }
    return {
        titleHtml: escapeHTML(text),
        searchText: text,
        filterValue: text
    };
}

function statsSortOptions(tabId) {
    const options = [
        { value: 'count-desc', label: '題數 (多→少)' },
        { value: 'count-asc', label: '題數 (少→多)' },
        { value: 'name', label: '名稱' }
    ];
    if (tabId === 'topics') options.unshift({ value: 'curriculum', label: '課程順序' });
    if (tabId === 'chapters') options.unshift({ value: 'number', label: '章節順序' });
    return options;
}

function visibleStatFilters(tabId) {
    // Crosstab uses two free axes — keep every dimension filter available.
    if (window.statsViewMode === 'crosstab') {
        return STAT_FILTER_DEFS.slice();
    }
    const dim = resolveStatsDimension(tabId);
    return STAT_FILTER_DEFS.filter(def => !def.hideOn || !def.hideOn.includes(dim));
}

function triSelectionCount(state, key) {
    const items = (state.triState && state.triState[key]) || {};
    return Object.keys(items).filter(name => {
        if (key === 'feature' && name === 'Out syl' && items[name] === 'excluded') return false;
        return true;
    }).length;
}

function questionFeatureOn(q, value) {
    if (value === '含圖表') {
        return !!(q.graphType && q.graphType !== '' && q.graphType !== '-' && q.graphType !== '沒有圖');
    }
    if (value === '有內嵌圖') return !!(q.inlineDiagrams && String(q.inlineDiagrams).trim());
    if (value === '含表格') {
        return !!(q.tableType && q.tableType !== '' && q.tableType !== '-' && q.tableType !== '沒有表格');
    }
    if (value === '複選') {
        return !!(q.multipleSelectionType && q.multipleSelectionType !== '' && q.multipleSelectionType !== '-' &&
            q.multipleSelectionType !== '並非複選型' && q.multipleSelectionType !== '不適用');
    }
    if (value === '含計算') {
        return !!(q.calculationType && q.calculationType !== '' && q.calculationType !== '-' && q.calculationType !== '沒有計算');
    }
    if (value === '跨課題') {
        return !!(q.curriculumClassification && Array.isArray(q.curriculumClassification) && q.curriculumClassification.length > 1);
    }
    if (value === '跨章節') {
        return !!(q.AristochapterClassification && Array.isArray(q.AristochapterClassification) && q.AristochapterClassification.length > 1);
    }
    if (value === '已刪除') return !!(q.answerMC && String(q.answerMC).trim() === '*');
    if (value === 'Out syl') return !!(q.outSyl && String(q.outSyl).trim().toUpperCase() === 'Y');
    if (value === '有分題') {
        return typeof questionHasParts === 'function' ? questionHasParts(q) : !!(q.questionParts && q.questionParts.length);
    }
    if (value === '題目空白') {
        return typeof isQuestionTextBlank === 'function' ? isQuestionTextBlank(q) : false;
    }
    if (value === '答案空白') {
        return typeof isAnswerBlank === 'function' ? isAnswerBlank(q) : false;
    }
    if (value === '評卷報告空白') {
        return typeof isMarkersReportBlank === 'function' ? isMarkersReportBlank(q) : false;
    }
    return false;
}

function valuesOnQuestion(q, def) {
    if (def.kind === 'concepts') return (Array.isArray(q.concepts) ? q.concepts : []).map(v => String(v).trim()).filter(Boolean);
    if (def.kind === 'patterns') return (Array.isArray(q.patterns) ? q.patterns : []).map(v => String(v).trim()).filter(Boolean);
    if (def.kind === 'stemPatterns') return (Array.isArray(q.stemPatterns) ? q.stemPatterns : []).map(v => String(v).trim()).filter(Boolean);
    if (def.kind === 'curriculum') {
        return (Array.isArray(q.curriculumClassification) ? q.curriculumClassification : []).map(v => String(v).trim()).filter(Boolean);
    }
    if (def.kind === 'chapter') {
        return (Array.isArray(q.AristochapterClassification) ? q.AristochapterClassification : [])
            .map(chapterFilterValue)
            .filter(Boolean);
    }
    if (def.kind === 'feature') {
        const items = (typeof effectiveFeatureItems === 'function')
            ? effectiveFeatureItems()
            : ((typeof FEATURE_ITEMS !== 'undefined') ? FEATURE_ITEMS : []);
        return items.filter(item => questionFeatureOn(q, item));
    }
    if (def.kind === 'partPerformance') {
        const parts = (typeof normalizeQuestionParts === 'function')
            ? normalizeQuestionParts(q.questionParts)
            : (Array.isArray(q.questionParts) ? q.questionParts : []);
        const set = new Set();
        parts.forEach(part => {
            const perf = part && part.performance ? String(part.performance).trim() : '';
            if (perf) set.add(perf);
        });
        return Array.from(set);
    }
    if (def.kind === 'ai') {
        return (q.AIExplanation && String(q.AIExplanation).trim() !== '') ? ['AI 詳解'] : [];
    }
    if (def.kind === 'year') {
        const key = typeof normalizeYearFilterKey === 'function'
            ? normalizeYearFilterKey(q.year)
            : String(q.year == null ? '' : q.year).trim();
        return key ? [key] : [];
    }
    const field = def.field || (
        def.kind === 'qtype' ? 'questionType'
            : def.kind === 'exam' ? 'examination'
            : def.kind === 'paper' ? 'paper'
            : def.kind === 'section' ? 'section'
            : def.kind === 'publisher' ? 'publisher'
            : ''
    );
    if (!field || q[field] === undefined || q[field] === null) return [];
    const text = String(q[field]).trim();
    if (!text) return [];
    if (def.kind !== 'section' && text === '-') return [];
    return [text];
}

function countFilterValues(questions, def) {
    const counts = {};
    (questions || []).forEach(q => {
        const seen = new Set();
        valuesOnQuestion(q, def).forEach(value => {
            if (seen.has(value)) return;
            seen.add(value);
            counts[value] = (counts[value] || 0) + 1;
        });
    });
    return counts;
}

function staticFilterUniverse(def, counts) {
    let base = [];
    if (def.kind === 'curriculum' && typeof CURRICULUM_ITEMS !== 'undefined') base = CURRICULUM_ITEMS.slice();
    else if (def.kind === 'chapter' && typeof CHAPTER_RANGE !== 'undefined') {
        for (let i = CHAPTER_RANGE.min; i <= CHAPTER_RANGE.max; i++) base.push(String(i).padStart(2, '0'));
    } else if (def.kind === 'qtype' && typeof QUESTION_TYPES !== 'undefined') base = QUESTION_TYPES.slice();
    else if (def.kind === 'exam' && typeof EXAMINATION_TYPES !== 'undefined') base = EXAMINATION_TYPES.slice();
    else if (def.kind === 'section') base = ['A', 'B', 'C', '-'];
    else if (def.kind === 'paper') base = ['1', '2'];
    else if (def.kind === 'feature' && typeof effectiveFeatureItems === 'function') base = effectiveFeatureItems();
    else if (def.kind === 'feature' && typeof FEATURE_ITEMS !== 'undefined') base = FEATURE_ITEMS.slice();
    else if (def.kind === 'partPerformance' && typeof PART_PERFORMANCE_ITEMS !== 'undefined') base = PART_PERFORMANCE_ITEMS.slice();
    else if (def.kind === 'ai') base = ['AI 詳解'];
    else base = Object.keys(counts);

    Object.keys(counts).forEach(value => {
        if (!base.includes(value)) base.push(value);
    });
    return base;
}

function filterValueLabel(def, value) {
    if (value === EMPTY_FIELD_SENTINEL && EMPTY_FIELD_LABELS[def.key]) return EMPTY_FIELD_LABELS[def.key];
    if (def.kind === 'chapter') {
        const name = (typeof CHAPTER_DESCRIPTIONS !== 'undefined' && CHAPTER_DESCRIPTIONS[value]) || '';
        return name ? `${value} ${name}` : value;
    }
    if (def.kind === 'section') return STAT_SECTION_LABELS[value] || value;
    if (def.kind === 'year' && typeof yearFilterLabel === 'function') return yearFilterLabel(value);
    if (def.kind === 'paper') return (typeof paperFilterLabel === 'function') ? paperFilterLabel(value) : value;
    return value;
}

function sortFilterValues(def, values, state) {
    const selected = (state.triState && state.triState[def.key]) || {};
    const rank = (value) => {
        if (selected[value] === 'checked') return 0;
        if (selected[value] === 'excluded') return 1;
        return 2;
    };
    return values.slice().sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (def.kind === 'chapter') return parseInt(a, 10) - parseInt(b, 10);
        if (def.kind === 'curriculum' && typeof CURRICULUM_ORDER !== 'undefined' && typeof getCurriculumSortKey === 'function') {
            const ia = CURRICULUM_ORDER.indexOf(getCurriculumSortKey(a));
            const ib = CURRICULUM_ORDER.indexOf(getCurriculumSortKey(b));
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        }
        if (def.kind === 'year') {
            const yearRank = (value) => {
                const key = typeof normalizeYearFilterKey === 'function'
                    ? normalizeYearFilterKey(value)
                    : String(value);
                if (/^\d{4}$/.test(key)) return 30000 - parseInt(key, 10);
                if (/^\d{1,3}$/.test(key)) return 10000 - parseInt(key, 10);
                return 20000;
            };
            const diff = yearRank(a) - yearRank(b);
            if (diff !== 0) return diff;
        }
        return String(a).localeCompare(String(b), 'zh-HK');
    });
}

function datasetHasFilter(def, questions) {
    if (!def.optional) return true;
    return Object.keys(countFilterValues(questions, def)).length > 0;
}

function buildStatsFilterBar(tabId) {
    const state = getStatsTabState(tabId);
    const scopes = STAT_SEARCH_SCOPES.map(scope => {
        const selected = scope.value === state.searchScope ? ' selected' : '';
        return `<option value="${scope.value}"${selected}>${scope.label}</option>`;
    }).join('');
    const filters = visibleStatFilters(tabId).map(def => {
        if (def.kind === 'range') return buildStatsRangeItem(tabId, def, state);
        const count = triSelectionCount(state, def.key);
        return `
            <div class="filter-item" id="sf-item-${tabId}-${def.key}">
                <button type="button" class="dropdown-btn modal-filter-trigger${count ? ' mf-trigger-active' : ''}" data-sf-open="${tabId}:${def.key}">
                    <span>${def.label}</span>
                    <span class="mf-trigger-right">
                        <span class="mf-badge" id="sf-badge-${tabId}-${def.key}" ${count ? '' : 'hidden'}>${count || ''}</span>
                        <span class="arrow">▶</span>
                    </span>
                </button>
            </div>`;
    }).join('');

    return `
        <div class="filters-container stats-filters">
            <div class="search-row">
                <div class="search-input-group">
                    <div class="scope-select-wrapper">
                        <select data-sf-scope="${tabId}" aria-label="搜尋範圍">${scopes}</select>
                    </div>
                    <input type="text" data-sf-search="${tabId}" placeholder="搜尋名稱、題目或答案..." value="${escapeHTML(state.search)}">
                    <span class="search-icon">🔍</span>
                </div>
            </div>
            <div class="btn-group">
                <button type="button" id="sf-toggle-${tabId}" class="btn btn-secondary btn-sm" data-sf-toggle="${tabId}">🔽 隱藏篩選條件</button>
                <button type="button" class="btn btn-clear-filter btn-sm" data-sf-reset="${tabId}">🔄 重置篩選條件</button>
            </div>
            <div id="sf-panel-${tabId}" class="sf-collapsible" style="max-height: 4000px; opacity: 1; overflow: visible; margin-top: 15px;">
                <div class="filter-primary-grid">${filters}</div>
            </div>
        </div>
        <div class="active-filters-panel" id="sf-badges-${tabId}"></div>
        <div class="sort-controls-wrapper" id="sf-toolbar-${tabId}"></div>`;
}

function buildStatsRangeItem(tabId, def, state) {
    const spec = rangeSpec(def.range);
    const current = state[spec.stateKey];
    const active = !!(current && current.active);
    const badge = active ? `${formatRangeBound(def.range, current.min)}–${formatRangeBound(def.range, current.max)}` : '';
    return `
        <div class="filter-item" id="sf-item-${tabId}-${def.key}">
            <div class="dropdown-filter">
                <button type="button" class="dropdown-btn${active ? ' mf-trigger-active' : ''}" data-sf-range="${tabId}:${def.key}">
                    <span>${def.label}</span>
                    <span class="mf-trigger-right">
                        <span class="mf-badge" id="sf-badge-${tabId}-${def.key}" ${active ? '' : 'hidden'}>${escapeHTML(badge)}</span>
                        <span class="arrow">▶</span>
                    </span>
                </button>
                <div class="dropdown-content range-dropdown" id="sf-range-${tabId}-${def.key}">
                    <div class="range-filter-wrapper">
                        <div class="range-filter-header">
                            <button type="button" class="range-clear-btn" data-sf-range-clear="${tabId}:${def.key}">🗑️ 清除</button>
                        </div>
                        <div class="range-info">${spec.caption} <span id="sf-range-min-label-${tabId}-${def.key}">${formatRangeBound(def.range, current.min)}</span>${spec.suffix} - <span id="sf-range-max-label-${tabId}-${def.key}">${formatRangeBound(def.range, current.max)}</span>${spec.suffix}</div>
                        <div class="range-slider-container">
                            <div class="range-slider-track"></div>
                            <div class="range-slider-fill" id="sf-range-fill-${tabId}-${def.key}"></div>
                            <input type="range" id="sf-range-min-${tabId}-${def.key}" class="range-slider-input" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${current.min}" data-sf-range-input="${tabId}:${def.key}:min">
                            <input type="range" id="sf-range-max-${tabId}-${def.key}" class="range-slider-input" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${current.max}" data-sf-range-input="${tabId}:${def.key}:max">
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

function rangeSpec(range) {
    if (range === 'percentage') return { stateKey: 'percentage', min: 0, max: 100, step: 1, caption: '範圍:', suffix: '%' };
    if (range === 'marks') return { stateKey: 'marks', min: 0, max: 30, step: 1, caption: '範圍:', suffix: ' 分' };
    return { stateKey: 'qnum', min: QNUM_MIN_STATS, max: QNUM_MAX_STATS, step: 1, caption: '範圍:', suffix: '' };
}

function formatRangeBound(range, value) {
    if (range === 'qnum' && typeof formatQuestionNumberDisplay === 'function') return formatQuestionNumberDisplay(value);
    return String(value);
}

function paintStatsRange(tabId, rangeKey) {
    const def = STAT_FILTER_DEFS.find(item => item.key === rangeKey);
    if (!def) return;
    const spec = rangeSpec(def.range);
    const state = getStatsTabState(tabId)[spec.stateKey];
    const minSlider = document.getElementById(`sf-range-min-${tabId}-${rangeKey}`);
    const maxSlider = document.getElementById(`sf-range-max-${tabId}-${rangeKey}`);
    if (minSlider) minSlider.value = state.min;
    if (maxSlider) maxSlider.value = state.max;
    const minLabel = document.getElementById(`sf-range-min-label-${tabId}-${rangeKey}`);
    const maxLabel = document.getElementById(`sf-range-max-label-${tabId}-${rangeKey}`);
    if (minLabel) minLabel.textContent = formatRangeBound(def.range, state.min);
    if (maxLabel) maxLabel.textContent = formatRangeBound(def.range, state.max);
    const fill = document.getElementById(`sf-range-fill-${tabId}-${rangeKey}`);
    if (fill) {
        const span = spec.max - spec.min || 1;
        const left = ((state.min - spec.min) / span) * 100;
        const right = ((state.max - spec.min) / span) * 100;
        fill.style.left = left + '%';
        fill.style.width = Math.max(0, right - left) + '%';
    }
}

function ensureStatsFilterBar(tabId) {
    const dim = resolveStatsDimension(tabId);
    const cfg = STAT_TABS[dim];
    const mount = cfg && document.getElementById(cfg.mountId);
    if (!mount) return;
    bindStatsFilterUi();
    // Rebuild when the active dimension changes so hideOn stays correct.
    if (mount.dataset.ready === '1' && mount.dataset.statsDim === dim) return;
    mount.innerHTML = buildStatsFilterBar(dim);
    mount.dataset.ready = '1';
    mount.dataset.statsDim = dim;
    visibleStatFilters(dim).forEach(def => {
        if (def.kind === 'range') paintStatsRange(dim, def.key);
    });
}

function refreshStatsFilterVisibility(tabId, questions) {
    visibleStatFilters(tabId).forEach(def => {
        const item = document.getElementById(`sf-item-${tabId}-${def.key}`);
        if (!item || !def.optional) return;
        item.style.display = datasetHasFilter(def, questions) ? '' : 'none';
    });
}

function updateStatsFilterChrome(tabId, info) {
    const state = getStatsTabState(tabId);
    const questionCount = info && typeof info.questionCount === 'number' ? info.questionCount : 0;
    const rowCount = info && typeof info.rowCount === 'number' ? info.rowCount : 0;
    const cfg = STAT_TABS[tabId];

    visibleStatFilters(tabId).forEach(def => {
        const badge = document.getElementById(`sf-badge-${tabId}-${def.key}`);
        const button = badge ? badge.closest('button') : null;
        if (!badge || !button) return;
        if (def.kind === 'range') {
            const spec = rangeSpec(def.range);
            const current = state[spec.stateKey];
            const active = !!(current && current.active);
            badge.hidden = !active;
            badge.textContent = active ? `${formatRangeBound(def.range, current.min)}–${formatRangeBound(def.range, current.max)}` : '';
            button.classList.toggle('mf-trigger-active', active);
            return;
        }
        const count = triSelectionCount(state, def.key);
        badge.hidden = count === 0;
        badge.textContent = count ? String(count) : '';
        button.classList.toggle('mf-trigger-active', count > 0);
    });

    renderStatsBadges(tabId);
    renderStatsToolbar(tabId, cfg, questionCount, rowCount);
}

function renderStatsToolbar(tabId, cfg, questionCount, rowCount) {
    const toolbar = document.getElementById(`sf-toolbar-${tabId}`);
    if (!toolbar) return;
    const state = getStatsTabState(tabId);
    const sortOptions = statsSortOptions(tabId).map(option => {
        const selected = option.value === state.sort ? ' selected' : '';
        return `<option value="${option.value}"${selected}>${option.label}</option>`;
    }).join('');
    const sizes = [24, 48, 96, -1].map(size => {
        const selected = size === state.pageSize ? ' selected' : '';
        const label = size === -1 ? '全部' : `每頁 ${size} 項`;
        return `<option value="${size}"${selected}>${label}</option>`;
    }).join('');
    toolbar.innerHTML = `
        <span class="sort-label">排序方式：</span>
        <select data-sf-sort="${tabId}" aria-label="排序方式">${sortOptions}</select>
        <select data-sf-pagesize="${tabId}" aria-label="每頁項目數">${sizes}</select>
        <span class="total-count">符合篩選的題目: ${questionCount} · ${escapeHTML(cfg.label)}: ${rowCount}</span>`;
}

function renderStatsBadges(tabId) {
    const panel = document.getElementById(`sf-badges-${tabId}`);
    if (!panel) return;
    const state = getStatsTabState(tabId);
    const actions = [];
    let html = '';

    const addBadge = (label, value, color, action) => {
        const idx = actions.length;
        actions.push(action);
        html += `
            <span class="filter-badge ${color}">
                <span class="remove-filter-btn" data-sf-remove="${tabId}" data-sf-remove-idx="${idx}" style="cursor: pointer; margin-right: 6px; font-weight: bold; opacity: 0.7;">✕</span>
                ${escapeHTML(label)}: ${escapeHTML(value)}
            </span>`;
    };

    const term = (state.search || '').trim();
    if (term) {
        const scope = STAT_SEARCH_SCOPES.find(item => item.value === state.searchScope);
        addBadge(`搜尋 (${scope ? scope.label : '名稱'})`, term, 'blue', { kind: 'search' });
    }

    if (state.percentage.active) addBadge('答對率', `${state.percentage.min}% - ${state.percentage.max}%`, 'green', { kind: 'range', key: 'percentage' });
    if (state.marks.active) addBadge('分數', `${state.marks.min} - ${state.marks.max}`, 'green', { kind: 'range', key: 'marks' });
    if (state.qnum.active) {
        addBadge('題號', `${formatRangeBound('qnum', state.qnum.min)} - ${formatRangeBound('qnum', state.qnum.max)}`, 'green', { kind: 'range', key: 'qnum' });
    }

    visibleStatFilters(tabId).forEach(def => {
        if (def.kind === 'range') return;
        const items = state.triState[def.key] || {};
        Object.keys(items).forEach(value => {
            if (def.key === 'feature' && value === 'Out syl' && items[value] === 'excluded') return;
            const shown = filterValueLabel(def, value);
            if (items[value] === 'checked') addBadge(def.label.replace(/^[^\s]+\s/, ''), shown, 'blue', { kind: 'tri', key: def.key, value });
            else if (items[value] === 'excluded') addBadge(`排除 ${def.label.replace(/^[^\s]+\s/, '')}`, shown, 'red', { kind: 'tri', key: def.key, value });
        });
    });

    window._sfRemoveActions = window._sfRemoveActions || {};
    window._sfRemoveActions[tabId] = actions;

    if (!html) {
        panel.innerHTML = '';
        panel.style.display = 'none';
        return;
    }
    panel.innerHTML = `<div class="search-info-title">🔍 篩選條件:</div><div class="badges-list">${html}</div>`;
    panel.style.display = 'flex';
}

function scheduleStatsRender(tabId) {
    const dim = resolveStatsDimension(tabId);
    const gen = (statsRenderGen[dim] || 0) + 1;
    statsRenderGen[dim] = gen;
    if (window.statsViewMode === 'crosstab' && typeof window.renderStatsCrosstab === 'function') {
        window.renderStatsCrosstab(gen);
        return;
    }
    if (typeof window.renderStatsTab === 'function') {
        window.renderStatsTab(dim, gen);
    }
}

function statsRenderIsCurrent(tabId, gen) {
    const dim = resolveStatsDimension(tabId);
    return statsRenderGen[dim] === gen;
}

function resetStatsFilters(tabId) {
    const dim = resolveStatsDimension(tabId);
    const cfg = STAT_TABS[dim];
    const prev = getStatsTabState(dim);
    const fresh = {
        search: '',
        searchScope: 'name',
        sort: prev.sort,
        page: 1,
        pageSize: prev.pageSize,
        collapsed: prev.collapsed,
        triState: emptyStatsTriState(),
        logic: { curriculum: 'OR', chapter: 'OR' },
        percentage: { min: 0, max: 100, active: false },
        marks: { min: 0, max: 30, active: false },
        qnum: { min: QNUM_MIN_STATS, max: QNUM_MAX_STATS, active: false }
    };
    statsFilterState[statsStateKey(dim)] = fresh;
    const search = document.querySelector(`[data-sf-search="${dim}"]`);
    if (search) search.value = '';
    const scope = document.querySelector(`[data-sf-scope="${dim}"]`);
    if (scope) scope.value = 'name';
    visibleStatFilters(dim).forEach(def => {
        if (def.kind === 'range') paintStatsRange(dim, def.key);
    });
    if (sfModal && sfModal.tabId === dim) closeStatsFilterModal();
    if (cfg) scheduleStatsRender(dim);
}

function bindStatsFilterUi() {
    if (statsUiBound) return;
    statsUiBound = true;

    document.addEventListener('click', event => {
        const jump = event.target.closest('[data-stats-jump]');
        if (jump) {
            const tabId = jump.getAttribute('data-stats-jump');
            const idx = Number(jump.getAttribute('data-stats-idx'));
            const value = (window._statsRowIndex && window._statsRowIndex[tabId] || [])[idx];
            if (value !== undefined) jumpStatsRowToQuestions(tabId, value);
            return;
        }

        const remove = event.target.closest('[data-sf-remove]');
        if (remove) {
            removeStatsBadge(remove.getAttribute('data-sf-remove'), Number(remove.getAttribute('data-sf-remove-idx')));
            return;
        }

        const reset = event.target.closest('[data-sf-reset]');
        if (reset) {
            resetStatsFilters(reset.getAttribute('data-sf-reset'));
            return;
        }

        const toggle = event.target.closest('[data-sf-toggle]');
        if (toggle) {
            toggleStatsPanel(toggle.getAttribute('data-sf-toggle'));
            return;
        }

        const opener = event.target.closest('[data-sf-open]');
        if (opener) {
            const [tabId, key] = opener.getAttribute('data-sf-open').split(':');
            openStatsFilterModal(tabId, key);
            return;
        }

        const rangeBtn = event.target.closest('[data-sf-range]');
        if (rangeBtn) {
            const [tabId, key] = rangeBtn.getAttribute('data-sf-range').split(':');
            toggleStatsRange(tabId, key, rangeBtn);
            return;
        }

        const rangeClear = event.target.closest('[data-sf-range-clear]');
        if (rangeClear) {
            event.preventDefault();
            const [tabId, key] = rangeClear.getAttribute('data-sf-range-clear').split(':');
            clearStatsRange(tabId, key);
            return;
        }

        const pageBtn = event.target.closest('[data-sf-page]');
        if (pageBtn) {
            const tabId = pageBtn.getAttribute('data-sf-page');
            getStatsTabState(tabId).page = Number(pageBtn.getAttribute('data-sf-page-num'));
            scheduleStatsRender(tabId);
            if (typeof scrollToTop === 'function') scrollToTop();
        }
    });

    document.addEventListener('change', event => {
        const scope = event.target.closest('[data-sf-scope]');
        if (scope) {
            const tabId = scope.getAttribute('data-sf-scope');
            getStatsTabState(tabId).searchScope = scope.value;
            getStatsTabState(tabId).page = 1;
            scheduleStatsRender(tabId);
            return;
        }
        const sort = event.target.closest('[data-sf-sort]');
        if (sort) {
            const tabId = sort.getAttribute('data-sf-sort');
            getStatsTabState(tabId).sort = sort.value;
            getStatsTabState(tabId).page = 1;
            scheduleStatsRender(tabId);
            return;
        }
        const pageSize = event.target.closest('[data-sf-pagesize]');
        if (pageSize) {
            const tabId = pageSize.getAttribute('data-sf-pagesize');
            getStatsTabState(tabId).pageSize = parseInt(pageSize.value, 10);
            getStatsTabState(tabId).page = 1;
            scheduleStatsRender(tabId);
            return;
        }
        const logic = event.target.closest('[data-sf-logic]');
        if (logic) {
            const [tabId, key] = logic.getAttribute('data-sf-logic').split(':');
            const state = getStatsTabState(tabId);
            state.logic[key] = logic.checked ? 'AND' : 'OR';
            state.page = 1;
            scheduleStatsRender(tabId);
        }
    });

    const onSearch = typeof debounce === 'function'
        ? debounce(event => applyStatsSearchInput(event), 250)
        : event => applyStatsSearchInput(event);

    document.addEventListener('input', event => {
        if (event.target.closest('[data-sf-search]')) {
            onSearch(event);
            return;
        }
        const rangeInput = event.target.closest('[data-sf-range-input]');
        if (rangeInput) applyStatsRangeInput(rangeInput);
        const modalSearch = event.target.closest('#sf-search');
        if (modalSearch && sfModal) renderStatsModalList();
    });
}

function applyStatsSearchInput(event) {
    const input = event.target.closest('[data-sf-search]');
    if (!input) return;
    const tabId = input.getAttribute('data-sf-search');
    const state = getStatsTabState(tabId);
    state.search = input.value;
    state.page = 1;
    scheduleStatsRender(tabId);
}

function applyStatsRangeInput(input) {
    const [tabId, key, edge] = input.getAttribute('data-sf-range-input').split(':');
    const def = STAT_FILTER_DEFS.find(item => item.key === key);
    if (!def) return;
    const spec = rangeSpec(def.range);
    const state = getStatsTabState(tabId);
    const current = state[spec.stateKey];
    let min = edge === 'min' ? Number(input.value) : Number(current.min);
    let max = edge === 'max' ? Number(input.value) : Number(current.max);
    if (min > max) {
        if (edge === 'min') min = max;
        else max = min;
    }
    current.min = min;
    current.max = max;
    current.active = min > spec.min || max < spec.max;
    state.page = 1;
    paintStatsRange(tabId, key);
    scheduleStatsRender(tabId);
}

function clearStatsRange(tabId, key) {
    const def = STAT_FILTER_DEFS.find(item => item.key === key);
    if (!def) return;
    const spec = rangeSpec(def.range);
    const state = getStatsTabState(tabId);
    state[spec.stateKey] = { min: spec.min, max: spec.max, active: false };
    state.page = 1;
    paintStatsRange(tabId, key);
    scheduleStatsRender(tabId);
}

function toggleStatsPanel(tabId) {
    const state = getStatsTabState(tabId);
    const panel = document.getElementById(`sf-panel-${tabId}`);
    const button = document.getElementById(`sf-toggle-${tabId}`);
    if (!panel || !button) return;
    state.collapsed = !state.collapsed;
    if (state.collapsed) {
        panel.style.overflow = 'hidden';
        panel.style.maxHeight = '0px';
        panel.style.opacity = '0';
        panel.style.marginTop = '0';
        button.textContent = '▶️ 顯示篩選條件';
    } else {
        panel.style.maxHeight = '4000px';
        panel.style.opacity = '1';
        panel.style.marginTop = '15px';
        button.textContent = '🔽 隱藏篩選條件';
        setTimeout(() => {
            if (!getStatsTabState(tabId).collapsed) panel.style.overflow = 'visible';
        }, 320);
    }
}

function toggleStatsRange(tabId, key, button) {
    const panel = document.getElementById(`sf-range-${tabId}-${key}`);
    if (!panel) return;
    const wasOpen = panel.classList.contains('active');
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
    if (!wasOpen) {
        panel.classList.add('active');
        const arrow = button.querySelector('.arrow');
        if (arrow) arrow.textContent = '▼';
        paintStatsRange(tabId, key);
    }
}

function removeStatsBadge(tabId, idx) {
    const action = (window._sfRemoveActions && window._sfRemoveActions[tabId] || [])[idx];
    if (!action) return;
    const state = getStatsTabState(tabId);
    if (action.kind === 'search') {
        state.search = '';
        const input = document.querySelector(`[data-sf-search="${tabId}"]`);
        if (input) input.value = '';
    } else if (action.kind === 'range') {
        clearStatsRange(tabId, action.key);
        return;
    } else if (action.kind === 'tri' && state.triState[action.key]) {
        delete state.triState[action.key][action.value];
    }
    state.page = 1;
    if (sfModal && sfModal.tabId === tabId && sfModal.key === action.key) renderStatsModalList();
    scheduleStatsRender(tabId);
}

async function openStatsFilterModal(tabId, key) {
    const def = STAT_FILTER_DEFS.find(item => item.key === key);
    if (!def || def.kind === 'range') return;
    closeStatsFilterModal();
    const token = sfOpenToken;
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
    if (typeof closeFilterModal === 'function') closeFilterModal();

    const all = window.storage ? await window.storage.getQuestions() : [];
    if (token !== sfOpenToken) return;
    const state = getStatsTabState(tabId);
    const context = window.storage
        ? window.storage.applyFilters(all, statsStateToFilters(state, key))
        : all;
    const counts = countFilterValues(context, def);
    const selected = state.triState[key] || {};
    Object.keys(selected).forEach(value => {
        if (value === EMPTY_FIELD_SENTINEL) return;
        if (counts[value] === undefined) counts[value] = 0;
    });
    const order = sortFilterValues(def, staticFilterUniverse(def, counts), state)
        .filter(value => value !== EMPTY_FIELD_SENTINEL);
    const emptyCount = EMPTY_FIELD_LABELS[key]
        ? context.filter(q => isModalFieldEmpty(q, key)).length
        : 0;

    sfModal = { tabId, key, def, order, counts, emptyCount, rendered: order.slice() };

    const logic = def.logic ? `
        <div class="sf-logic-wrap">
            <span>組合方式</span>
            <div class="logic-toggle">
                <input type="checkbox" id="sf-logic-${tabId}-${key}" data-sf-logic="${tabId}:${key}" ${state.logic[key] === 'AND' ? 'checked' : ''}>
                <label for="sf-logic-${tabId}-${key}">
                    <span class="logic-text or">OR</span>
                    <span class="logic-text and">AND</span>
                </label>
            </div>
        </div>` : '<span></span>';

    const overlay = document.createElement('div');
    overlay.className = 'mf-overlay';
    overlay.id = 'sf-overlay';
    overlay.innerHTML = `
        <div class="mf-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(def.label)}">
            <div class="mf-header">
                <h3>${def.label}</h3>
                <button type="button" class="mf-close" id="sf-close" aria-label="關閉">✕</button>
            </div>
            <div class="mf-hint">點擊選項切換：未選 → ✔ 包含 → ✕ 排除</div>
            <div class="mf-empty-slot" id="sf-empty-slot"></div>
            <input type="text" class="mf-search" id="sf-search" placeholder="搜尋選項...">
            <div class="mf-list" id="sf-list"></div>
            <div class="mf-footer">${logic}<span class="sf-modal-actions"><button type="button" class="btn mf-clear-btn" id="sf-clear">🗑️ 清除</button><button type="button" class="btn mf-done-btn" id="sf-done">完成</button></span></div>
        </div>`;
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeStatsFilterModal();
        else event.stopPropagation();
    });
    document.body.appendChild(overlay);
    document.body.classList.add('mf-modal-open');
    document.getElementById('sf-close').onclick = closeStatsFilterModal;
    document.getElementById('sf-done').onclick = closeStatsFilterModal;
    document.getElementById('sf-clear').onclick = () => {
        if (!sfModal) return;
        getStatsTabState(sfModal.tabId).triState[sfModal.key] = {};
        if (sfModal.key === 'feature') {
            getStatsTabState(sfModal.tabId).triState.feature = { 'Out syl': 'excluded' };
        }
        renderStatsModalList();
        getStatsTabState(sfModal.tabId).page = 1;
        scheduleStatsRender(sfModal.tabId);
    };
    document.getElementById('sf-list').onclick = event => {
        const button = event.target.closest('.mf-option');
        if (!button || !sfModal) return;
        const value = sfModal.rendered[Number(button.dataset.idx)];
        if (value === undefined) return;
        cycleStatsOption(sfModal.tabId, sfModal.key, value);
    };
    renderStatsModalList();
    document.getElementById('sf-search').focus();
}

function renderStatsEmptyFieldOption() {
    const slot = document.getElementById('sf-empty-slot');
    if (!slot || !sfModal) return;
    const label = EMPTY_FIELD_LABELS[sfModal.key];
    if (!label) {
        slot.innerHTML = '';
        return;
    }
    const selected = (getStatsTabState(sfModal.tabId).triState[sfModal.key] || {})[EMPTY_FIELD_SENTINEL];
    const mode = selected === 'checked' ? 'include' : selected === 'excluded' ? 'exclude' : 'none';
    const mark = mode === 'include' ? '✔' : mode === 'exclude' ? '✕' : '';
    slot.innerHTML = `
        <button type="button" class="mf-option mf-empty-option mf-${mode}" id="sf-empty-option">
            <span class="mf-mark">${mark}</span>
            <span class="mf-option-label">${escapeHTML(label)}</span>
            <span class="mf-count">(${sfModal.emptyCount || 0})</span>
        </button>`;
    slot.onclick = () => cycleStatsOption(sfModal.tabId, sfModal.key, EMPTY_FIELD_SENTINEL);
}

function renderStatsModalList() {
    const list = document.getElementById('sf-list');
    if (!list || !sfModal) return;
    const state = getStatsTabState(sfModal.tabId);
    const selected = state.triState[sfModal.key] || {};
    renderStatsEmptyFieldOption();
    const term = (document.getElementById('sf-search')?.value || '').trim().toUpperCase();
    const opts = sfModal.order.filter(value => {
        if (!term) return true;
        return filterValueLabel(sfModal.def, value).toUpperCase().includes(term) || String(value).toUpperCase().includes(term);
    });
    sfModal.rendered = opts;
    if (!opts.length) {
        list.innerHTML = '<div class="mf-empty">沒有符合的選項</div>';
        return;
    }
    list.innerHTML = opts.map((value, index) => {
        const mode = selected[value] === 'checked' ? 'include' : selected[value] === 'excluded' ? 'exclude' : 'none';
        const mark = mode === 'include' ? '✔' : mode === 'exclude' ? '✕' : '';
        const count = sfModal.counts[value] || 0;
        return `
            <button type="button" class="mf-option mf-${mode}" data-idx="${index}">
                <span class="mf-mark">${mark}</span>
                <span class="mf-option-label">${escapeHTML(filterValueLabel(sfModal.def, value))}</span>
                <span class="mf-count">(${count})</span>
            </button>`;
    }).join('');
}

function cycleStatsOption(tabId, key, value) {
    const state = getStatsTabState(tabId);
    if (!state.triState[key]) state.triState[key] = {};
    const current = state.triState[key][value];
    if (!current) state.triState[key][value] = 'checked';
    else if (current === 'checked') state.triState[key][value] = 'excluded';
    else delete state.triState[key][value];
    state.page = 1;
    renderStatsModalList();
    scheduleStatsRender(tabId);
}

function closeStatsFilterModal() {
    sfOpenToken += 1;
    const overlay = document.getElementById('sf-overlay');
    if (overlay) overlay.remove();
    if (!document.getElementById('mf-overlay')) document.body.classList.remove('mf-modal-open');
    sfModal = null;
}

function syncQuestionRangeWidgets() {
    paintQuestionRange('percentage', 'min-percentage', 'max-percentage', 'min-percentage-display', 'max-percentage-display', 'percentage-range-fill', 0, 100, value => String(value));
    paintQuestionRange('marks', 'min-marks', 'max-marks', 'min-marks-display', 'max-marks-display', 'marks-range-fill', 0, 30, value => String(value));
    paintQuestionRange('qnum', 'min-qnum', 'max-qnum', 'min-qnum-display', 'max-qnum-display', 'qnum-range-fill', QNUM_MIN_STATS, QNUM_MAX_STATS, value => (
        typeof formatQuestionNumberDisplay === 'function' ? formatQuestionNumberDisplay(value) : String(value)
    ));
}

function paintQuestionRange(kind, minId, maxId, minLabelId, maxLabelId, fillId, scaleMin, scaleMax, format) {
    const source = kind === 'percentage' ? window.percentageFilter
        : kind === 'marks' ? window.marksFilter
        : window.questionNumberFilter;
    if (!source) return;
    const minSlider = document.getElementById(minId);
    const maxSlider = document.getElementById(maxId);
    if (minSlider) minSlider.value = source.min;
    if (maxSlider) maxSlider.value = source.max;
    const minLabel = document.getElementById(minLabelId);
    const maxLabel = document.getElementById(maxLabelId);
    if (minLabel) minLabel.textContent = format(source.min);
    if (maxLabel) maxLabel.textContent = format(source.max);
    const fill = document.getElementById(fillId);
    if (fill) {
        const span = scaleMax - scaleMin || 1;
        const left = ((Number(source.min) - scaleMin) / span) * 100;
        const right = ((Number(source.max) - scaleMin) / span) * 100;
        fill.style.left = left + '%';
        fill.style.width = Math.max(0, right - left) + '%';
    }
}

function syncQuestionSearchFromStats(state) {
    const searchEl = document.getElementById('search');
    const scopeEl = document.getElementById('search-scope');
    const term = (state.search || '').trim();
    const useQuestionSearch = term && state.searchScope && state.searchScope !== 'name';
    if (useQuestionSearch && scopeEl && scopeEl.querySelector(`option[value="${state.searchScope}"]`)) {
        if (searchEl) searchEl.value = term;
        scopeEl.value = state.searchScope;
        window.searchScope = state.searchScope;
        return;
    }
    if (searchEl) searchEl.value = '';
    if (scopeEl) scopeEl.value = 'all';
    window.searchScope = 'all';
}

function jumpStatsRowToQuestions(tabId, rawValue) {
    const cfg = STAT_TABS[tabId];
    if (!cfg) return;
    const state = getStatsTabState(tabId);
    const presentation = statsRowPresentation(tabId, rawValue);
    const tri = JSON.parse(JSON.stringify(state.triState));
    if (!tri[cfg.groupKey]) tri[cfg.groupKey] = {};
    tri[cfg.groupKey][presentation.filterValue] = 'checked';

    window.triStateFilters = tri;
    window.filterLogic = {
        curriculum: state.logic.curriculum || 'OR',
        chapter: state.logic.chapter || 'OR'
    };
    window.percentageFilter = Object.assign({ min: 0, max: 100, active: false }, state.percentage);
    window.marksFilter = Object.assign({ min: 0, max: 30, active: false }, state.marks);
    window.questionNumberFilter = Object.assign({ min: QNUM_MIN_STATS, max: QNUM_MAX_STATS, active: false }, state.qnum);

    syncQuestionRangeWidgets();
    const curriculumToggle = document.getElementById('curriculum-logic-toggle');
    if (curriculumToggle) curriculumToggle.checked = window.filterLogic.curriculum === 'AND';
    const chapterToggle = document.getElementById('chapter-logic-toggle');
    if (chapterToggle) chapterToggle.checked = window.filterLogic.chapter === 'AND';
    syncQuestionSearchFromStats(state);

    if (window.paginationState && window.paginationState.questions) {
        window.paginationState.questions.page = 1;
    }

    closeStatsFilterModal();
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
    if (typeof switchTab === 'function') switchTab('questions');
    if (typeof filterQuestions === 'function') filterQuestions();
    if (typeof scrollToTop === 'function') scrollToTop();
}

window.STAT_TABS = STAT_TABS;
window.getStatsTabState = getStatsTabState;
window.ensureStatsFilterBar = ensureStatsFilterBar;
window.questionsMatchingStatsFilters = questionsMatchingStatsFilters;
window.statsNameQuery = statsNameQuery;
window.statsRowPresentation = statsRowPresentation;
window.refreshStatsFilterVisibility = refreshStatsFilterVisibility;
window.updateStatsFilterChrome = updateStatsFilterChrome;
window.statsRenderIsCurrent = statsRenderIsCurrent;
window.jumpStatsRowToQuestions = jumpStatsRowToQuestions;
window.getStatsActiveDimension = getStatsActiveDimension;
window.setStatsActiveDimension = setStatsActiveDimension;
window.resolveStatsDimension = resolveStatsDimension;
window.scheduleStatsRender = scheduleStatsRender;
