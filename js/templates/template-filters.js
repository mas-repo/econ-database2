// template-filters.js
// Generates the complete filter panel markup.
// Dependencies: None (pure HTML string generator).
// Dynamic option lists are populated later by utils.js / filters.js;
// modal filter triggers are managed by filter-modal.js (badge ids must
// match: mf-item-*, mf-trigger-*, mf-badge-*).
//
// NOTE: the input-first dropdown pattern has been fully retired — all
// seven dynamic filters (圖表 / 表格 / 計算 / 複選 / 概念 / 題型 / 題幹模式) now use
// modal pickers. If you ever need an input-first filter again, restore
// the inputFilter helper from git history along with filterDropdownList
// and setupInputDropdownListeners in filters.js.

function renderFiltersTemplate() {

    // Helper: standard tri-state label item (used for hardcoded static filters)
    const triLabel = (filter, value, display) => `
        <div class="tri-state-label" onclick="toggleTriState(this)" data-filter="${filter}" data-value="${value}">
            <div class="tri-state-checkbox" data-filter="${filter}" data-value="${value}">
                <span>${display || value}</span>
            </div>
        </div>`;

    // Helper: modal trigger button for long-option filters. Hidden until
    // filter-modal.js confirms the dataset actually contains values for
    // the field.
    const modalTrigger = (key, label) => `
        <div class="filter-item" id="mf-item-${key}" style="display: none;">
            <button type="button" class="dropdown-btn modal-filter-trigger" id="mf-trigger-${key}"
                    onclick="openFilterModal('${key}')">
                <span>${label}</span>
                <span class="mf-trigger-right">
                    <span class="mf-badge" id="mf-badge-${key}" hidden></span>
                    <span class="arrow">▶</span>
                </span>
            </button>
        </div>`;

    return `
    <div class="filters-container">

        <!-- Row 1: Search bar with scope selector -->
        <div class="search-row">
            <div class="search-input-group">
                <div class="scope-select-wrapper">
                    <select id="search-scope">
                        <option value="all">全部欄位</option>
                    </select>
                </div>
                <input type="text" id="search" placeholder="搜尋題目 ID、內容、答案...">
                <span class="search-icon">🔍</span>
            </div>
        </div>

        <!-- Row 2: Panel toggle + reset -->
        <div class="btn-group">
            <button id="toggle-filters-btn" class="btn btn-secondary btn-sm" onclick="toggleFiltersPanel()">▶️ 顯示篩選條件</button>
            <button class="btn btn-clear-filter btn-sm" onclick="clearFilters()">🔄 重置篩選條件</button>
        </div>

        <!-- Collapsible filter grid -->
        <div id="collapsible-filters-wrapper" style="max-height: 0px; opacity: 0; overflow: hidden; transition: all 0.3s ease; margin-top: 0;">
            <div class="filter-primary-grid">

                <!-- 🏢 出版商 -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('publisher-options')">
                            <span>🏢 出版商</span><span class="arrow" id="publisher-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-publisher"></span>
                        <div class="dropdown-content" id="publisher-options">
                            ${triLabel('publisher', '雅集出版社')}
                            ${triLabel('publisher', 'HKEAA')}
                        </div>
                    </div>
                </div>

                <!-- 📝 考試 -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('exam-options')">
                            <span>📝 考試</span><span class="arrow" id="exam-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-exam"></span>
                        <div class="dropdown-content" id="exam-options">
                            ${triLabel('exam', 'HKDSE')}
                            ${triLabel('exam', 'HKCEE')}
                            ${triLabel('exam', 'HKALE')}
                        </div>
                    </div>
                </div>

                <!-- 📅 年份 (populated dynamically, grouped by decade) -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('year-options')">
                            <span>📅 年份</span><span class="arrow" id="year-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-year"></span>
                        <div id="year-options"></div>
                    </div>
                </div>

                <!-- 📝 題目類型 -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('qtype-options')">
                            <span>📝 題目類型</span><span class="arrow" id="qtype-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-qtype"></span>
                        <div class="dropdown-content" id="qtype-options">
                            ${triLabel('qtype', 'MC')}
                            ${triLabel('qtype', '文字題 (SQ/LQ)')}
                        </div>
                    </div>
                </div>

                <!-- 📝 Section -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('section-options')">
                            <span>📝 Section</span><span class="arrow" id="section-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-section"></span>
                        <div class="dropdown-content" id="section-options">
                            ${triLabel('section', 'A', '甲部（短題目）')}
                            ${triLabel('section', 'B', '乙部（結構/文章式/資料回應試題）')}
                            ${triLabel('section', 'C', '丙部（選修單元）')}
                            ${triLabel('section', '-', 'NA')}
                        </div>
                    </div>
                </div>

                <!-- 📚 課程分類 -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('curriculum-options')">
                            <span>📚 課程分類</span><span class="arrow" id="curriculum-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-curriculum"></span>
                        <div class="custom-grid-dropdown" id="curriculum-options">
                            <div class="filter-header">
                                <div class="logic-toggle">
                                    <input type="checkbox" id="curriculum-logic-toggle" onchange="toggleCurriculumLogic(this)">
                                    <label for="curriculum-logic-toggle">
                                        <span class="logic-text or">OR</span>
                                        <span class="logic-text and">AND</span>
                                    </label>
                                </div>
                                <button class="clear-btn" onclick="clearCurriculumFilter()">🗑️ 清除</button>
                            </div>
                            <div id="curriculum-list"></div>
                        </div>
                    </div>
                </div>

                <!-- 📖 Chapters -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('chapter-options')">
                            <span>📖 Chapters</span><span class="arrow" id="chapter-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-chapter"></span>
                        <div class="custom-grid-dropdown chapter-grid-width" id="chapter-options">
                            <div class="filter-header">
                                <div class="logic-toggle">
                                    <input type="checkbox" id="chapter-logic-toggle" onchange="toggleChapterLogic(this)">
                                    <label for="chapter-logic-toggle">
                                        <span class="logic-text or">OR</span>
                                        <span class="logic-text and">AND</span>
                                    </label>
                                </div>
                                <button class="clear-btn" onclick="clearChapterFilter()">🗑️ 清除</button>
                            </div>
                            <div id="chapter-list"></div>
                        </div>
                    </div>
                </div>

                <!-- 🎯 特徵 -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('feature-options')">
                            <span>🎯 特徵</span><span class="arrow" id="feature-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-feature"></span>
                        <div class="custom-grid-dropdown" id="feature-options"></div>
                    </div>
                </div>

                <!-- 📊 答對率 (range slider) -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('percentage-options')">
                            <span>📊 答對率</span><span class="arrow" id="percentage-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-percentage"></span>
                        <div class="dropdown-content range-dropdown" id="percentage-options">
                            <div class="range-filter-wrapper">
                                <div class="range-filter-header">
                                    <button class="range-clear-btn" onclick="clearPercentageFilter()">🗑️ 清除</button>
                                </div>
                                <div class="range-info">範圍: <span id="min-percentage-display">0</span>% - <span id="max-percentage-display">100</span>%</div>
                                <div class="range-slider-container">
                                    <div class="range-slider-track"></div>
                                    <div class="range-slider-fill" id="percentage-range-fill"></div>
                                    <input type="range" id="min-percentage" class="range-slider-input" min="0" max="100" value="0" oninput="updatePercentageRange()">
                                    <input type="range" id="max-percentage" class="range-slider-input" min="0" max="100" value="100" oninput="updatePercentageRange()">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 💯 分數 (range slider) -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('marks-options')">
                            <span>💯 分數</span><span class="arrow" id="marks-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-marks"></span>
                        <div class="dropdown-content range-dropdown marks-filter" id="marks-options">
                            <div class="range-filter-wrapper">
                                <div class="range-filter-header">
                                    <button class="range-clear-btn" onclick="clearMarksFilter()">🗑️ 清除</button>
                                </div>
                                <div class="range-info">範圍: <span id="min-marks-display">0</span> - <span id="max-marks-display">30</span> 分</div>
                                <div class="range-slider-container">
                                    <div class="range-slider-track"></div>
                                    <div class="range-slider-fill" id="marks-range-fill"></div>
                                    <input type="range" id="min-marks" class="range-slider-input" min="0" max="30" value="0" oninput="updateMarksRange()">
                                    <input type="range" id="max-marks" class="range-slider-input" min="0" max="30" value="30" oninput="updateMarksRange()">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- #️⃣ 題號 (last digits of id, range slider) -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" onclick="toggleDropdown('qnum-options')">
                            <span>#️⃣ 題號</span><span class="arrow" id="qnum-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-qnum"></span>
                        <div class="dropdown-content range-dropdown qnum-filter" id="qnum-options">
                            <div class="range-filter-wrapper">
                                <div class="range-filter-header">
                                    <button class="range-clear-btn" onclick="clearQuestionNumberFilter()">🗑️ 清除</button>
                                </div>
                                <div class="range-info">範圍: <span id="min-qnum-display">01</span> - <span id="max-qnum-display">60</span></div>
                                <div class="range-slider-container">
                                    <div class="range-slider-track"></div>
                                    <div class="range-slider-fill" id="qnum-range-fill"></div>
                                    <input type="range" id="min-qnum" class="range-slider-input" min="1" max="60" value="1" step="1" oninput="updateQuestionNumberRange()">
                                    <input type="range" id="max-qnum" class="range-slider-input" min="1" max="60" value="60" step="1" oninput="updateQuestionNumberRange()">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Modal-based filters (long option lists) -->
                ${modalTrigger('graph', '📊 圖表類型')}
                ${modalTrigger('table', '📅 表格類型')}
                ${modalTrigger('calculation', '🧮 計算類型')}
                ${modalTrigger('multipleSelection', '🔍 複選類型')}
                ${modalTrigger('concepts', '💡 概念類型')}
                ${modalTrigger('patterns', '🎯 題型')}
                ${modalTrigger('stemPatterns', '🧩 題幹模式')}

                <!-- 🤖 AI 詳解 (shown only when data exists) -->
                <div class="filter-item">
                    <div class="dropdown-filter">
                        <button class="dropdown-btn" id="ai-filter-btn" onclick="toggleDropdown('ai-options')">
                            <span>🤖 AI 詳解</span><span class="arrow" id="ai-arrow">▶</span>
                        </button>
                        <span class="active-indicator" id="indicator-ai"></span>
                        <div class="dropdown-content" id="ai-options"></div>
                    </div>
                </div>

            </div>
        </div>
    </div>`;
}