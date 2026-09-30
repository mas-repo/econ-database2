// Dependencies: globals.js, render.js, storage-core.js, storage-filters.js,
// constants.js, utils.js (escapeHTML, debounce), filter-modal.js
// (populateModalFilter, updateModalFilterBadges, closeFilterModal)
//
// NOTE: the input-first dropdown machinery (filterDropdownList,
// setupInputDropdownListeners, populateList) has been removed — all seven
// dynamic filters now use the modal pickers in filter-modal.js. Restore
// from git history if an input-first filter is ever needed again.

// ============================================
// GLOBAL FILTER STATE INITIALIZATION
// ============================================
if (!window.percentageFilter) {
    window.percentageFilter = { min: 0, max: 100, active: false };
}

if (!window.marksFilter) {
    window.marksFilter = { min: 0, max: 30, active: false };
}

const QNUM_MIN = (typeof QUESTION_NUMBER_RANGE !== 'undefined') ? QUESTION_NUMBER_RANGE.min : 1;
const QNUM_MAX = (typeof QUESTION_NUMBER_RANGE !== 'undefined') ? QUESTION_NUMBER_RANGE.max : 60;

if (!window.questionNumberFilter) {
    window.questionNumberFilter = { min: QNUM_MIN, max: QNUM_MAX, active: false };
}

function formatQuestionNumberDisplay(n) {
    return String(Math.round(n)).padStart(2, '0');
}

if (!window.triStateFilters) {
    window.triStateFilters = { 
        curriculum: {}, 
        chapter: {}, 
        feature: { 'Out syl': 'excluded' }, 
        publisher: {},
        exam: {}, 
        qtype: {},
        section: {},
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

// ============================================
// DROPDOWN & UI FUNCTIONS
// ============================================

// Configuration map for all filters that have arrow icons.
// (All six dynamic filters moved to modals — no arrows.)
const ARROW_MAP = {
    // Custom Grid Filters
    'curriculum-options': 'curriculum-arrow',
    'feature-options': 'feature-arrow',
    'chapter-options': 'chapter-arrow',
    'year-options': 'year-arrow',
    
    // Standard Filters
    'publisher-options': 'publisher-arrow',
    'exam-options': 'exam-arrow',
    'qtype-options': 'qtype-arrow',
    'section-options': 'section-arrow',

    // Range Filters
    'percentage-options': 'percentage-arrow',
    'marks-options': 'marks-arrow',
    'qnum-options': 'qnum-arrow',
    
    // AI
    'ai-options': 'ai-arrow'
};

// Priority sort options for the modal pickers.
const PRIORITY_CONFIG = { 
    multipleSelection: ['並非複選型', '不適用'], 
    graph: ['沒有圖', '未命名圖表'],
    table: ['沒有表格', '未命名表格'],
    calculation: ['沒有計算', '未命名計算題'],
    concepts: [],
    patterns: ['未分類'],
    stemPatterns: ['未分類']
};

/**
 * Helper: Closes ALL dropdowns and resets all arrow icons.
 */
function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-content').forEach(d => {
        d.classList.remove('active');
    });

    ['curriculum', 'chapter', 'feature', 'year'].forEach(type => {
        const section = document.getElementById(`${type}-options`);
        if (section) section.style.display = 'none';
    });

    Object.values(ARROW_MAP).forEach(arrowId => {
        const arrow = document.getElementById(arrowId);
        if (arrow) arrow.textContent = '▶';
    });

    document.querySelectorAll('.dropdown-btn .arrow').forEach(arrow => {
        if (arrow.textContent === '▼') arrow.textContent = '▶';
    });
}

/**
 * Helper: Applies tooltips to Chapter options based on constants.js.
 * Also enforces the "Colleagues" rule: that group must not see chapter names,
 * so the full-name spans are hidden via the 'hide-chapter-names' class.
 */
function applyChapterTooltips() {
    const container = document.getElementById('chapter-options');
    if (!container) return;

    // Colleagues: hide names and tooltips entirely
    if (window.authManager && window.authManager.userGroup === 'Colleagues') {
        container.classList.add('hide-chapter-names');
        container.querySelectorAll('[data-value]').forEach(item => item.removeAttribute('title'));
        return;
    }
    container.classList.remove('hide-chapter-names');

    if (typeof CHAPTER_DESCRIPTIONS === 'undefined') return;

    const items = container.querySelectorAll('[data-value]');
    items.forEach(item => {
        const rawVal = item.getAttribute('data-value');
        if (!rawVal) return;

        const paddedVal = rawVal.toString().padStart(2, '0');
        const description = CHAPTER_DESCRIPTIONS[paddedVal];
        if (description) {
            item.setAttribute('title', `${paddedVal}: ${description}`);
        }
    });
}

/**
 * Master Toggle Function
 */
function toggleDropdown(dropdownId) {
    const target = document.getElementById(dropdownId);
    if (!target) return;

    const isStandardActive = target.classList.contains('active');
    const isGridActive = target.style.display === 'grid' || target.style.display === 'block';
    
    const isActuallyVisible = isGridActive || (isStandardActive && target.style.display !== 'none');
    const wasOpen = isActuallyVisible;

    closeAllDropdowns();

    if (!wasOpen) {
        const gridFilters = ['curriculum-options', 'feature-options', 'chapter-options', 'year-options'];

        if (gridFilters.includes(dropdownId)) {
            target.style.display = 'grid';
            
            if (dropdownId === 'chapter-options') {
                applyChapterTooltips();
            }
        } else {
            target.style.display = ''; 
            target.classList.add('active');
        }

        // === ARROW LOGIC ===
        let arrowUpdated = false;
        const arrowId = ARROW_MAP[dropdownId];
        if (arrowId) {
            const arrow = document.getElementById(arrowId);
            if (arrow) {
                arrow.textContent = '▼';
                arrowUpdated = true;
            }
        }

        if (!arrowUpdated) {
            const container = target.closest('.dropdown-filter');
            if (container) {
                const btn = container.querySelector('.dropdown-btn');
                if (btn) {
                    const arrow = btn.querySelector('.arrow');
                    if (arrow) {
                        arrow.textContent = '▼';
                    }
                }
            }
        }
    }

    updateDynamicDropdowns();
}

document.addEventListener('click', function(event) {
    const isFilterClick = event.target.closest('.dropdown-filter') || 
                          event.target.closest('.dropdown-section') || 
                          event.target.closest('.advanced-header');

    if (!isFilterClick) {
        closeAllDropdowns();
        updateDynamicDropdowns();
    }
});

function toggleTriState(element) {
    const filter = element.dataset.filter;
    const value = element.dataset.value;
    
    if (!window.triStateFilters[filter]) {
        window.triStateFilters[filter] = {};
    }
    
    const currentState = window.triStateFilters[filter][value];
    
    if (!currentState) {
        element.classList.add('checked');
        window.triStateFilters[filter][value] = 'checked';
    } else if (currentState === 'checked') {
        element.classList.remove('checked');
        element.classList.add('excluded');
        window.triStateFilters[filter][value] = 'excluded';
    } else {
        element.classList.remove('excluded');
        delete window.triStateFilters[filter][value];
    }

    const parentLabel = element.closest('.tri-state-label');
    if (parentLabel && element !== parentLabel) {
        if (window.triStateFilters[filter][value] === 'checked') {
            parentLabel.classList.add('checked');
            parentLabel.classList.remove('excluded');
        } else if (window.triStateFilters[filter][value] === 'excluded') {
            parentLabel.classList.remove('checked');
            parentLabel.classList.add('excluded');
        } else {
            parentLabel.classList.remove('checked', 'excluded');
        }
    }
    
    updateFilterIndicators();
    filterQuestions();
}

window.filterByTag = async function(category, value) {
    if (!window.triStateFilters[category]) {
        window.triStateFilters[category] = {};
    }

    const currentState = window.triStateFilters[category][value];

    if (currentState === 'checked') {
        delete window.triStateFilters[category][value];
    } else {
        window.triStateFilters[category][value] = 'checked';
    }

    await filterQuestions();
};

function updateFilterIndicators() {
    // graph/table/calculation/multipleSelection/concepts/patterns/stemPatterns
    // use modal trigger badges (filter-modal.js) instead of dot indicators.
    const triStateTypes = [
        'publisher', 'exam', 'qtype', 'curriculum', 'chapter', 'feature', 'year',
        'section', 'ai'
    ];
    
    triStateTypes.forEach(type => {
            const indicator = document.getElementById(`indicator-${type}`);
            if (!indicator) return;

            let hasActiveFilters = false;
            if (window.triStateFilters[type]) {
                const activeKeys = Object.keys(window.triStateFilters[type]).filter(key => {
                    if (type === 'feature' && key === 'Out syl' && window.triStateFilters[type][key] === 'excluded') {
                        return false;
                    }
                    return true;
                });
                hasActiveFilters = activeKeys.length > 0;
            }
            
            if (hasActiveFilters) {
                indicator.classList.add('visible');
            } else {
                indicator.classList.remove('visible');
            }
    });

    // Modal trigger badges
    if (typeof updateModalFilterBadges === 'function') {
        updateModalFilterBadges();
    }

    const aiBtn = document.getElementById('ai-filter-btn');
    if (aiBtn) {
        const hasAiFilter = window.triStateFilters.ai && Object.keys(window.triStateFilters.ai).length > 0;
        if (hasAiFilter) {
            aiBtn.style.borderColor = 'var(--secondary-color)';
            aiBtn.style.color = 'var(--secondary-color)';
            const childIndicator = aiBtn.querySelector('.filter-indicator');
            if (childIndicator) childIndicator.classList.add('visible');
        } else {
            aiBtn.style.borderColor = '';
            aiBtn.style.color = '';
            const childIndicator = aiBtn.querySelector('.filter-indicator');
            if (childIndicator) childIndicator.classList.remove('visible');
        }
    }

    const pctIndicator = document.getElementById('indicator-percentage');
    if (pctIndicator) {
        if (window.percentageFilter && window.percentageFilter.active) {
            pctIndicator.classList.add('visible');
        } else {
            pctIndicator.classList.remove('visible');
        }
    }

    const marksIndicator = document.getElementById('indicator-marks');
    if (marksIndicator) {
        if (window.marksFilter && window.marksFilter.active) {
            marksIndicator.classList.add('visible');
        } else {
            marksIndicator.classList.remove('visible');
        }
    }

    const qnumIndicator = document.getElementById('indicator-qnum');
    if (qnumIndicator) {
        if (window.questionNumberFilter && window.questionNumberFilter.active) {
            qnumIndicator.classList.add('visible');
        } else {
            qnumIndicator.classList.remove('visible');
        }
    }
}

// ============================================
// DYNAMIC OPTION LOGIC (Context-Aware)
// ============================================

function gatherFilterState() {
    return {
        search: document.getElementById('search').value,
        searchScope: window.searchScope || 'all',
        percentageFilter: window.percentageFilter,
        marksFilter: window.marksFilter,
        questionNumberFilter: window.questionNumberFilter,
        triState: window.triStateFilters
    };
}

/**
 * Shared option-data builder for the dynamic modal filters.
 * Returns { values: sorted array, counts: { value: n } }.
 *
 * Includes the consistency bugfixes:
 * - Stale selections are cleaned ONLY against the FULL dataset (so other
 *   filters narrowing the context never silently delete user selections).
 * - Active selections always render, even with a (0) count in context.
 */
function buildOptionData(fieldName, filterType, isArrayField, contextQuestions, allQuestions) {
    // 1. Counts from the current context
    const counts = {};
    contextQuestions.forEach(q => {
        const val = q[fieldName];
        if (isArrayField && Array.isArray(val)) {
            val.forEach(v => {
                if (v && v.trim() !== '') {
                    const key = v.trim();
                    counts[key] = (counts[key] || 0) + 1;
                }
            });
        } else if (val) {
            const key = typeof val === 'string' ? val.trim() : val;
            if (key !== '') counts[key] = (counts[key] || 0) + 1;
        }
    });

    // 2. Values present in the context
    let validValues;
    if (isArrayField) {
        const set = new Set();
        contextQuestions.forEach(q => {
            if (Array.isArray(q[fieldName])) {
                q[fieldName].forEach(val => {
                    if (val && val.trim() !== '') set.add(val.trim());
                });
            }
        });
        validValues = Array.from(set);
    } else {
        validValues = window.storage.getUniqueValues(contextQuestions, fieldName);
    }

    // 3. Stale-selection cleanup against the FULL dataset only
    const allValuesSet = new Set();
    if (isArrayField) {
        allQuestions.forEach(q => {
            if (Array.isArray(q[fieldName])) {
                q[fieldName].forEach(v => {
                    if (v && typeof v === 'string' && v.trim() !== '') allValuesSet.add(v.trim());
                });
            }
        });
    } else {
        window.storage.getUniqueValues(allQuestions, fieldName).forEach(v => allValuesSet.add(v));
    }

    if (window.triStateFilters[filterType]) {
        Object.keys(window.triStateFilters[filterType]).forEach(val => {
            if (!allValuesSet.has(val)) {
                delete window.triStateFilters[filterType][val];
            }
        });
    }

    // 4. Always render active selections, even with 0 context matches
    Object.keys(window.triStateFilters[filterType] || {}).forEach(val => {
        if (!validValues.includes(val)) {
            validValues.push(val);
        }
    });

    // 5. Sort: checked first, excluded next, then priority list, then locale
    const priorities = PRIORITY_CONFIG[filterType] || [];

    validValues.sort((a, b) => {
        const isAChecked = window.triStateFilters[filterType] && window.triStateFilters[filterType][a] === 'checked';
        const isBChecked = window.triStateFilters[filterType] && window.triStateFilters[filterType][b] === 'checked';

        if (isAChecked && !isBChecked) return -1;
        if (!isAChecked && isBChecked) return 1;

        const isAExcluded = window.triStateFilters[filterType] && window.triStateFilters[filterType][a] === 'excluded';
        const isBExcluded = window.triStateFilters[filterType] && window.triStateFilters[filterType][b] === 'excluded';

        if (isAExcluded && !isBExcluded) return -1;
        if (!isAExcluded && isBExcluded) return 1;

        const indexA = priorities.indexOf(a);
        const indexB = priorities.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;

        return a.localeCompare(b, 'zh-HK');
    });

    return { values: validValues, counts };
}

async function updateDynamicDropdowns() {
    if (!window.storage) return;

    const allQuestions = await window.storage.getQuestions();
    const currentFilters = gatherFilterState();

    const contextFilters = JSON.parse(JSON.stringify(currentFilters));
    
    // Remove self-filter to allow seeing other options in the same category
    if (contextFilters.triState) {
        delete contextFilters.triState.multipleSelection;
        delete contextFilters.triState.graph;
        delete contextFilters.triState.table;
        delete contextFilters.triState.calculation;
        delete contextFilters.triState.concepts;
        delete contextFilters.triState.patterns;
        delete contextFilters.triState.stemPatterns;
        delete contextFilters.triState.ai;
        delete contextFilters.triState.year; // Allow seeing other years
    }
    
    // Remove 'search' from the context used to populate dropdowns.
    delete contextFilters.search;

    const contextQuestions = window.storage.applyFilters(allQuestions, contextFilters);

    // --- Populate Year Filter Dynamically (Grouped by Decade) ---
    // Mock papers store a paper number (44), not a calendar year. Show MT44.
    const populateYearGrid = () => {
        const container = document.getElementById('year-options');
        if (!container) return;

        // 1. Calculate Counts
        const counts = {};
        contextQuestions.forEach(q => {
            if (q.year) {
                const y = String(q.year).trim();
                counts[y] = (counts[y] || 0) + 1;
            }
        });

        // 2. Soft Update if the dropdown is currently open
        const isVisible = container.style.display === 'grid' || container.style.display === 'block';

        if (isVisible) {
            const existingItems = container.querySelectorAll('.tri-state-checkbox');
            existingItems.forEach(el => {
                const itemValue = el.dataset.value;
                const currentState = window.triStateFilters.year && window.triStateFilters.year[itemValue];
                
                el.classList.remove('checked', 'excluded');

                if (currentState === 'checked') {
                    el.classList.add('checked');
                } else if (currentState === 'excluded') {
                    el.classList.add('excluded');
                }
            });
            return;
        }

        // 3. Full Rebuild
        let validYears = window.storage.getUniqueValues(contextQuestions, 'year').map(String);

        // BUGFIX-CONSISTENCY: always keep currently-selected years visible,
        // even if the current context contains no matching questions.
        Object.keys(window.triStateFilters.year || {}).forEach(y => {
            if (!validYears.includes(y)) validYears.push(y);
        });

        // 4. Four-digit exam years go by decade. Practice papers (PP, SP)
        // stay in their own group. Mock-paper numbers (27–44) go last.
        const decadeGroups = {};
        const specialYears = [];
        const mockYears = [];

        validYears.forEach(y => {
            const text = String(y).trim();
            if (/^\d{4}$/.test(text)) {
                const decade = Math.floor(parseInt(text, 10) / 10) * 10;
                if (!decadeGroups[decade]) decadeGroups[decade] = [];
                decadeGroups[decade].push(y);
            } else if (/^\d{1,3}$/.test(text)) {
                mockYears.push(y);
            } else {
                specialYears.push(y);
            }
        });

        const decadeKeys = Object.keys(decadeGroups).map(Number).sort((a, b) => b - a); // newest decade first
        specialYears.sort((a, b) => String(b).localeCompare(String(a)));
        mockYears.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

        // Helper to render a single year button (Sheet-sourced → escaped)
        const yearButton = (year) => {
            const currentState = window.triStateFilters.year && window.triStateFilters.year[year];
            let itemClass = 'tri-state-checkbox';
            if (currentState === 'checked') itemClass += ' checked';
            else if (currentState === 'excluded') itemClass += ' excluded';

            const count = counts[year] || 0;
            const label = yearFilterLabel(year);
            return `
                <div class="${itemClass}" 
                     data-filter="year" 
                     data-value="${escapeHTML(year)}" 
                     onclick="toggleTriState(this)"
                     title="${escapeHTML(label)}（${count} 題）">
                    ${escapeHTML(label)}
                </div>`;
        };

        // 5. Build HTML: global header + decade groups + special group
        let html = `
            <div class="year-global-header">
                <button onclick="selectAllYears()" class="clear-btn" style="color: var(--secondary-color); font-weight: bold;">全選</button>
                <button onclick="clearYearFilter()" class="clear-btn">🗑️ 清除</button>
            </div>
        `;

        decadeKeys.forEach(decade => {
            const years = decadeGroups[decade].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
            html += `
                <div class="year-group">
                    <div class="year-group-header">
                        <span class="year-group-title">${decade}s</span>
                        <button class="clear-btn year-decade-btn" onclick="toggleYearDecade('${decade}')">全選 / 取消</button>
                    </div>
                    <div class="year-group-grid">
                        ${years.map(yearButton).join('')}
                    </div>
                </div>`;
        });

        if (specialYears.length > 0) {
            html += `
                <div class="year-group">
                    <div class="year-group-header">
                        <span class="year-group-title">其他 (PP / SP)</span>
                    </div>
                    <div class="year-group-grid">
                        ${specialYears.map(yearButton).join('')}
                    </div>
                </div>`;
        }

        if (mockYears.length > 0) {
            html += `
                <div class="year-group">
                    <div class="year-group-header">
                        <span class="year-group-title">Mock Test</span>
                    </div>
                    <div class="year-group-grid">
                        ${mockYears.map(yearButton).join('')}
                    </div>
                </div>`;
        }

        container.innerHTML = html;
    };
    populateYearGrid();
    // ---------------------------------------------

    // Modal-based filters (圖表 / 表格 / 計算 / 複選 / 概念 / 題型 / 題幹模式)
    if (typeof populateModalFilter === 'function') {
        populateModalFilter('graph',             buildOptionData('graphType',             'graph',             false, contextQuestions, allQuestions));
        populateModalFilter('table',             buildOptionData('tableType',             'table',             false, contextQuestions, allQuestions));
        populateModalFilter('calculation',       buildOptionData('calculationType',       'calculation',       false, contextQuestions, allQuestions));
        populateModalFilter('multipleSelection', buildOptionData('multipleSelectionType', 'multipleSelection', false, contextQuestions, allQuestions));
        populateModalFilter('concepts',          buildOptionData('concepts',              'concepts',          true,  contextQuestions, allQuestions));
        populateModalFilter('patterns',          buildOptionData('patterns',              'patterns',          true,  contextQuestions, allQuestions));
        populateModalFilter('stemPatterns',      buildOptionData('stemPatterns',          'stemPatterns',      true,  contextQuestions, allQuestions));
    }

    const aiContainer = document.getElementById('ai-options');
    if (aiContainer) {
        const hasAI = contextQuestions.some(q => q.AIExplanation && q.AIExplanation.trim() !== '');
        const wrapper = aiContainer.closest('.dropdown-filter') || aiContainer.parentElement;

        if (!hasAI) {
            if (wrapper) wrapper.style.display = 'none';
        } else {
            if (wrapper) wrapper.style.display = 'block'; 
            
            const aiCount = contextQuestions.filter(q => q.AIExplanation && q.AIExplanation.trim() !== '').length;

            const item = 'AI 詳解';
            const currentState = window.triStateFilters.ai && window.triStateFilters.ai[item];
            
            let wrapperClass = 'tri-state-label';
            let checkboxClass = 'tri-state-checkbox';
            
            if (currentState === 'checked') {
                wrapperClass += ' checked';
                checkboxClass += ' checked';
            } else if (currentState === 'excluded') {
                wrapperClass += ' excluded';
                checkboxClass += ' excluded';
            }

            aiContainer.innerHTML = `
                <div class="${wrapperClass}" onclick="toggleTriState(this)" data-filter="ai" data-value="${item}">
                    <div class="${checkboxClass}" data-filter="ai" data-value="${item}">
                        <span>${item} <small style="opacity: 0.6; font-size: 0.85em; margin-left: 4px;">(${aiCount})</small></span>
                    </div>
                </div>
            `;
        }
    }
    
    updateFilterIndicators();
}

async function populateDynamicFilters() {
    await updateDynamicDropdowns();
    applyChapterTooltips();
}

function yearFilterLabel(year) {
    const text = String(year).trim();
    if (/^\d{1,3}$/.test(text)) return `MT${text}`;
    return text;
}

function populateSearchScope() {
    const select = document.getElementById('search-scope');
    if (!select) return;

    const currentSelection = select.value;
    const available = window.availableFields || new Set();

    let html = `<option value="all">全部欄位</option>`;
    
    if (available.size === 0 || available.has('id')) {
        html += `<option value="id">題目 ID</option>`;
    }

    const hasContent = available.size === 0 || 
                      available.has('questionTextChi') || 
                      available.has('questionTextEng');

    const hasAnswer = available.size === 0 || 
                      available.has('answerChi') || 
                      available.has('answerEng');                      

    const hasReports = available.size === 0 || 
                      available.has('markersReportChi') || 
                      available.has('markersReportEng'); 

    if (hasContent) {
        html += `<option value="content">題目內容</option>`;
    }
    if (hasAnswer) {
        html += `<option value="answer">答案</option>`;
    }
    if (hasReports) {
        html += `<option value="markersReport">評卷報告</option>`;
    }

    const fieldMapping = {
        'concepts': '相關概念',
        'patterns': '題型標籤',
        'stemPatterns': '題幹模式'
    };

    Object.entries(fieldMapping).forEach(([field, label]) => {
        if (available.has(field)) {
            html += `<option value="${field}">${label}</option>`;
        }
    });

    select.innerHTML = html;

    if (select.querySelector(`option[value="${currentSelection}"]`)) {
        select.value = currentSelection;
    } else {
        select.value = 'all';
        window.searchScope = 'all';
    }
}

// ============================================
// CLEAR & RESET FUNCTIONS
// ============================================

window.clearYearFilter = function() {
    window.triStateFilters.year = {};
    const container = document.getElementById('year-options');
    if (container) {
        container.querySelectorAll('.tri-state-checkbox').forEach(el => {
            el.classList.remove('checked', 'excluded');
        });
    }
    filterQuestions();
};

// Select All Years
window.selectAllYears = function() {
    const container = document.getElementById('year-options');
    if (!container) return;
    
    const items = container.querySelectorAll('[data-value]');
    items.forEach(el => {
        const val = el.getAttribute('data-value');
        if (val) {
            window.triStateFilters.year[val] = 'checked';
            el.classList.add('checked');
            el.classList.remove('excluded');
        }
    });
    
    filterQuestions();
};

// Toggle all years within a decade (e.g. toggleYearDecade('1990'))
// If every year in that decade is already checked → unselect them all.
// Otherwise → check them all.
window.toggleYearDecade = function(decade) {
    const container = document.getElementById('year-options');
    if (!container) return;

    const decadeNum = parseInt(decade, 10);
    if (isNaN(decadeNum)) return;

    const items = Array.from(container.querySelectorAll('.tri-state-checkbox[data-value]')).filter(el => {
        const num = parseInt(el.dataset.value, 10);
        return !isNaN(num) && Math.floor(num / 10) * 10 === decadeNum;
    });

    if (items.length === 0) return;

    if (!window.triStateFilters.year) window.triStateFilters.year = {};

    const allChecked = items.every(el => window.triStateFilters.year[el.dataset.value] === 'checked');

    items.forEach(el => {
        const val = el.dataset.value;
        el.classList.remove('checked', 'excluded');
        if (allChecked) {
            delete window.triStateFilters.year[val];
        } else {
            window.triStateFilters.year[val] = 'checked';
            el.classList.add('checked');
        }
    });

    filterQuestions();
};

window.clearChapterFilter = function() {
    window.triStateFilters.chapter = {};
    const container = document.getElementById('chapter-options');
    if (container) {
        container.querySelectorAll('.tri-state-checkbox, .tri-state-label').forEach(el => {
            el.classList.remove('checked', 'excluded');
        });
    }
    
    const toggle = document.getElementById('chapter-logic-toggle');
    if (toggle) {
        toggle.checked = false;
        window.filterLogic.chapter = 'OR';
    }
    filterQuestions();
};

function clearFilters() {
    document.getElementById('search').value = '';
    
    const pctSection = document.getElementById('percentage-options');
    if (pctSection) pctSection.style.display = 'none';

    const marksSection = document.getElementById('marks-options');
    if (marksSection) marksSection.style.display = 'none';

    const qnumSection = document.getElementById('qnum-options');
    if (qnumSection) qnumSection.style.display = 'none';

    const collapsibleTypes = ['curriculum', 'chapter', 'feature', 'year'];
    collapsibleTypes.forEach(type => {
        const section = document.getElementById(`${type}-options`);
        if (section) section.style.display = 'none';
    });

    closeAllDropdowns();

    // Close any open filter modal
    if (typeof closeFilterModal === 'function') closeFilterModal();

    const scopeSelect = document.getElementById('search-scope');
    if (scopeSelect) scopeSelect.value = 'all';
    window.searchScope = 'all';

    // === Reset tri-state visual classes with Out syl exception ===
    document.querySelectorAll('.tri-state-checkbox').forEach(el => {
        if (el.dataset.value === 'Out syl') {
            el.classList.remove('checked');
            el.classList.add('excluded');
            const label = el.closest('.tri-state-label');
            if(label) {
                label.classList.remove('checked');
                label.classList.add('excluded');
            }
        } else {
            el.classList.remove('checked', 'excluded');
            const label = el.closest('.tri-state-label');
            if(label) label.classList.remove('checked', 'excluded');
        }
    });

    const aiBtn = document.getElementById('ai-filter-btn');
    if (aiBtn) {
        aiBtn.style.borderColor = '';
        aiBtn.style.color = '';
    }

    window.triStateFilters = { 
        curriculum: {}, 
        chapter: {}, 
        feature: { 'Out syl': 'excluded' },  
        publisher: {},
        exam: {}, 
        qtype: {},
        section: {},
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

    // === RESET LOGIC TOGGLES ===
    const currToggle = document.getElementById('curriculum-logic-toggle');
    if (currToggle) {
        currToggle.checked = false; 
        if (window.filterLogic) window.filterLogic.curriculum = 'OR';
    }

    const chapToggle = document.getElementById('chapter-logic-toggle');
    if (chapToggle) {
        chapToggle.checked = false; 
        if (window.filterLogic) window.filterLogic.chapter = 'OR';
    }

    clearPercentageFilter();    
    clearMarksFilter();
    clearQuestionNumberFilter();
    updateFilterIndicators();

    if (window.paginationState && window.paginationState.questions) {
        window.paginationState.questions.page = 1;
    }
    
    updateDynamicDropdowns().then(() => {
        if (typeof renderQuestions === 'function') renderQuestions();
    });
}

window.removeFilter = function(type, param1, param2) {
    if (type === 'search') {
        document.getElementById('search').value = '';
    } else if (type === 'year') {
        if (param1) {
            if (window.triStateFilters.year) {
                delete window.triStateFilters.year[param1];
            }
        } else {
            window.triStateFilters.year = {};
        }
    } else if (type === 'percentage') {
        clearPercentageFilter();
        return;
    } else if (type === 'marks') {
        clearMarksFilter();
        return;
    } else if (type === 'qnum') {
        clearQuestionNumberFilter();
        return;
    } else if (type === 'tag') {
        const category = param1;
        const value = param2;
        if (window.triStateFilters[category]) {
            delete window.triStateFilters[category][value];
        }
    }
    
    filterQuestions();
};

function updateSearchInfo() {
    const container = document.getElementById('active-filters-display');
    if (!container) return;

    let html = '';
    let hasFilters = false;

    // SECURITY: values are Sheet-sourced. For inline onclick args we
    // JS-escape backslashes/quotes first, then HTML-escape the result
    // (the browser decodes entities before parsing the handler, so the
    // JS escaping survives intact). Display text is HTML-escaped.
    const jsArg = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const createBadge = (label, value, colorClass = 'blue', removeType, p1, p2) => {
        let removeArgs = `'${removeType}'`;
        if (p1 !== undefined && p1 !== null) removeArgs += `, '${escapeHTML(jsArg(p1))}'`;
        if (p2 !== undefined && p2 !== null) removeArgs += `, '${escapeHTML(jsArg(p2))}'`;

        return `
        <span class="filter-badge ${colorClass}">
            <span class="remove-filter-btn" onclick="removeFilter(${removeArgs})" style="cursor: pointer; margin-right: 6px; font-weight: bold; opacity: 0.7; display: inline-block;">✕</span>
            ${escapeHTML(label)}: ${escapeHTML(value)}
        </span>`;
    };

    const searchText = document.getElementById('search').value.trim();
    const scopeSelect = document.getElementById('search-scope');
    const scopeText = scopeSelect && scopeSelect.options[scopeSelect.selectedIndex] 
        ? scopeSelect.options[scopeSelect.selectedIndex].text 
        : '全部';
    
    if (searchText) {
        html += createBadge(`搜尋 (${scopeText})`, searchText, 'blue', 'search');
        hasFilters = true;
    }

    if (window.percentageFilter && window.percentageFilter.active) {
        html += createBadge('答對率', `${window.percentageFilter.min}% - ${window.percentageFilter.max}%`, 'green', 'percentage');
        hasFilters = true;
    }

    if (window.marksFilter && window.marksFilter.active) {
        html += createBadge('分數', `${window.marksFilter.min} - ${window.marksFilter.max}`, 'green', 'marks');
        hasFilters = true;
    }

    if (window.questionNumberFilter && window.questionNumberFilter.active) {
        html += createBadge(
            '題號',
            `${formatQuestionNumberDisplay(window.questionNumberFilter.min)} - ${formatQuestionNumberDisplay(window.questionNumberFilter.max)}`,
            'green',
            'qnum'
        );
        hasFilters = true;
    }

    const categories = {
        'curriculum': '課程',
        'chapter': 'Chapter',
        'feature': '特徵',
        'publisher': '出版商',
        'exam': '考試',
        'qtype': '題型',
        'section': 'Section',
        'year': '年份',
        'concepts': '概念',
        'patterns': '題型標籤',
        'stemPatterns': '題幹模式',
        'multipleSelection': '複選',
        'graph': '圖表',
        'table': '表格',
        'calculation': '計算',
        'ai': 'AI'
    };

    Object.entries(window.triStateFilters).forEach(([catKey, items]) => {
            Object.entries(items).forEach(([itemVal, state]) => {
                
                if (catKey === 'feature' && itemVal === 'Out syl' && state === 'excluded') {
                    return;
                }

                const label = categories[catKey] || catKey;
                const shown = catKey === 'year' ? yearFilterLabel(itemVal) : itemVal;
                if (state === 'checked') {
                    html += createBadge(label, shown, 'blue', 'tag', catKey, itemVal);
                    hasFilters = true;
                } else if (state === 'excluded') {
                    html += createBadge(`排除 ${label}`, shown, 'red', 'tag', catKey, itemVal);
                    hasFilters = true;
                }
            });
    });

    if (hasFilters) {
        container.innerHTML = `<div class="search-info-title">🔍 篩選條件:</div><div class="badges-list">${html}</div>`;
        container.style.display = 'flex';
    } else {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

/**
 * Helper: Updates the visual state (checked/excluded) of static filters.
 */
function updateStaticFilterVisuals() {
    const filterElements = document.querySelectorAll('[data-filter][data-value]');
    
    filterElements.forEach(el => {
        const filterType = el.dataset.filter;
        const itemValue = el.dataset.value; 
        
        if (!filterType || !itemValue) return;

        const label = el.closest('.tri-state-label');
        const checkbox = el.classList.contains('tri-state-checkbox') ? el : el.querySelector('.tri-state-checkbox');
        
        const currentState = window.triStateFilters[filterType] && window.triStateFilters[filterType][itemValue];
        
        if (label) {
            label.classList.remove('checked', 'excluded');
            if (currentState === 'checked') label.classList.add('checked');
            if (currentState === 'excluded') label.classList.add('excluded');
        }

        if (checkbox) {
            checkbox.classList.remove('checked', 'excluded');
            if (currentState === 'checked') checkbox.classList.add('checked');
            if (currentState === 'excluded') checkbox.classList.add('excluded');
        }
    });
}

async function filterQuestions() {
    if (window.paginationState && window.paginationState.questions) {
        window.paginationState.questions.page = 1;
    }
    
    const scopeSelect = document.getElementById('search-scope');
    if (scopeSelect) {
        window.searchScope = scopeSelect.value;
    }

    updateFilterIndicators();
    
    await updateDynamicDropdowns();
    
    updateStaticFilterVisuals();
    
    updateSearchInfo();
    if (typeof renderQuestions === 'function') await renderQuestions();
}

// ============================================
// RANGE FILTER FUNCTIONS
// ============================================

function updatePercentageRange() {
    const minSlider = document.getElementById('min-percentage');
    const maxSlider = document.getElementById('max-percentage');
    const minDisplay = document.getElementById('min-percentage-display');
    const maxDisplay = document.getElementById('max-percentage-display');
    const rangeFill = document.getElementById('percentage-range-fill');
    
    if (!minSlider || !maxSlider || !minDisplay || !maxDisplay || !rangeFill) return;
    
    let minVal = parseInt(minSlider.value);
    let maxVal = parseInt(maxSlider.value);
    
    if (minVal > maxVal) {
        minVal = maxVal;
        minSlider.value = minVal;
    }
    
    minDisplay.textContent = minVal;
    maxDisplay.textContent = maxVal;
    
    const percentMin = (minVal / 100) * 100;
    const percentMax = (maxVal / 100) * 100;
    
    rangeFill.style.left = percentMin + '%';
    rangeFill.style.width = (percentMax - percentMin) + '%';
    
    if (!window.percentageFilter) window.percentageFilter = { min: 0, max: 100, active: false };
    window.percentageFilter.min = minVal;
    window.percentageFilter.max = maxVal;
    
    applyPercentageFilter();
}

function applyPercentageFilter() {
    const minVal = parseInt(document.getElementById('min-percentage').value);
    const maxVal = parseInt(document.getElementById('max-percentage').value);
    
    window.percentageFilter = {
        min: minVal,
        max: maxVal,
        active: (minVal > 0 || maxVal < 100)
    };
    filterQuestions();
}

function clearPercentageFilter() {
    const minSlider = document.getElementById('min-percentage');
    const maxSlider = document.getElementById('max-percentage');
    if (!minSlider || !maxSlider) return;
    
    minSlider.value = 0;
    maxSlider.value = 100;
    window.percentageFilter = { min: 0, max: 100, active: false };
    updatePercentageRange();
}

function updateMarksRange() {
    const minSlider = document.getElementById('min-marks');
    const maxSlider = document.getElementById('max-marks');
    const minDisplay = document.getElementById('min-marks-display');
    const maxDisplay = document.getElementById('max-marks-display');
    const rangeFill = document.getElementById('marks-range-fill');
    
    if (!minSlider || !maxSlider || !minDisplay || !maxDisplay || !rangeFill) return;
    
    let minVal = parseFloat(minSlider.value);
    let maxVal = parseFloat(maxSlider.value);
    
    if (minVal > maxVal) {
        minVal = maxVal;
        minSlider.value = minVal;
    }
    
    minDisplay.textContent = minVal;
    maxDisplay.textContent = maxVal;
    
    const percentMin = (minVal / 30) * 100;
    const percentMax = (maxVal / 30) * 100;
    
    rangeFill.style.left = percentMin + '%';
    rangeFill.style.width = (percentMax - percentMin) + '%';
    
    if (!window.marksFilter) window.marksFilter = { min: 0, max: 30, active: false };
    window.marksFilter.min = minVal;
    window.marksFilter.max = maxVal;
    
    applyMarksFilter();
}

function applyMarksFilter() {
    const minVal = parseFloat(document.getElementById('min-marks').value);
    const maxVal = parseFloat(document.getElementById('max-marks').value);
    
    window.marksFilter = {
        min: minVal,
        max: maxVal,
        active: (minVal > 0 || maxVal < 30)
    };
    filterQuestions();
}

function clearMarksFilter() {
    const minSlider = document.getElementById('min-marks');
    const maxSlider = document.getElementById('max-marks');
    if (!minSlider || !maxSlider) return;
    
    minSlider.value = 0;
    maxSlider.value = 30;
    window.marksFilter = { min: 0, max: 30, active: false };
    updateMarksRange();
}

function updateQuestionNumberRange() {
    const minSlider = document.getElementById('min-qnum');
    const maxSlider = document.getElementById('max-qnum');
    const minDisplay = document.getElementById('min-qnum-display');
    const maxDisplay = document.getElementById('max-qnum-display');
    const rangeFill = document.getElementById('qnum-range-fill');
    
    if (!minSlider || !maxSlider || !minDisplay || !maxDisplay || !rangeFill) return;
    
    let minVal = parseFloat(minSlider.value);
    let maxVal = parseFloat(maxSlider.value);
    
    if (minVal > maxVal) {
        minVal = maxVal;
        minSlider.value = minVal;
    }
    
    minDisplay.textContent = formatQuestionNumberDisplay(minVal);
    maxDisplay.textContent = formatQuestionNumberDisplay(maxVal);
    
    const span = QNUM_MAX - QNUM_MIN;
    const percentMin = span > 0 ? ((minVal - QNUM_MIN) / span) * 100 : 0;
    const percentMax = span > 0 ? ((maxVal - QNUM_MIN) / span) * 100 : 100;
    
    rangeFill.style.left = percentMin + '%';
    rangeFill.style.width = (percentMax - percentMin) + '%';
    
    if (!window.questionNumberFilter) {
        window.questionNumberFilter = { min: QNUM_MIN, max: QNUM_MAX, active: false };
    }
    window.questionNumberFilter.min = minVal;
    window.questionNumberFilter.max = maxVal;
    
    applyQuestionNumberFilter();
}

function applyQuestionNumberFilter() {
    const minVal = parseFloat(document.getElementById('min-qnum').value);
    const maxVal = parseFloat(document.getElementById('max-qnum').value);
    
    window.questionNumberFilter = {
        min: minVal,
        max: maxVal,
        active: (minVal > QNUM_MIN || maxVal < QNUM_MAX)
    };
    filterQuestions();
}

function clearQuestionNumberFilter() {
    const minSlider = document.getElementById('min-qnum');
    const maxSlider = document.getElementById('max-qnum');
    if (!minSlider || !maxSlider) return;
    
    minSlider.value = QNUM_MIN;
    maxSlider.value = QNUM_MAX;
    window.questionNumberFilter = { min: QNUM_MIN, max: QNUM_MAX, active: false };
    updateQuestionNumberRange();
}

function toggleChapterLogic(checkbox) {
    window.filterLogic.chapter = checkbox.checked ? 'AND' : 'OR';
    filterQuestions();
}

function toggleCurriculumLogic(checkbox) {
    window.filterLogic.curriculum = checkbox.checked ? 'AND' : 'OR';
    filterQuestions();
}

window.clearCurriculumFilter = function() {
    window.triStateFilters.curriculum = {};
    const container = document.getElementById('curriculum-options');
    if (container) {
        container.querySelectorAll('.tri-state-checkbox, .tri-state-label').forEach(el => {
            el.classList.remove('checked', 'excluded');
        });
        const toggle = document.getElementById('curriculum-logic-toggle');
        if (toggle) {
            toggle.checked = false;
            window.filterLogic.curriculum = 'OR';
        }
    }
    filterQuestions();
};

window.filterByExactMarks = function(marks) {
    const minSlider = document.getElementById('min-marks');
    const maxSlider = document.getElementById('max-marks');
    
    const isAlreadyFiltered = window.marksFilter && 
                              window.marksFilter.active && 
                              window.marksFilter.min == marks && 
                              window.marksFilter.max == marks;

    if (isAlreadyFiltered) {
        if (typeof clearMarksFilter === 'function') {
            clearMarksFilter();
        } else {
            if (minSlider) minSlider.value = minSlider.min;
            if (maxSlider) maxSlider.value = maxSlider.max;
            updateMarksRange();
        }
    } else {
        if (minSlider && maxSlider) {
            minSlider.value = marks;
            maxSlider.value = marks;
            
            updateMarksRange();
            
            const marksDropdown = document.getElementById('marks-options');
            if (marksDropdown && !marksDropdown.classList.contains('active')) {
                toggleDropdown('marks-options');
            }
        } else {
            window.marksFilter = { min: marks, max: marks, active: true };
            filterQuestions();
        }
    }
};