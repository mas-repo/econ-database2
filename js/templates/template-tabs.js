// template-tabs.js
// Generates the tab navigation and all tab content containers.
// Dependencies: renderFiltersTemplate (template-filters.js), renderFormTemplate (template-form.js)

// Tab registry. To publish a hidden tab, just flip `visible` to true.
// (Replaces the old commented-out <button> block — do not delete.)
const TAB_DEFINITIONS = [
    { id: 'questions',  label: '題目',        visible: true  },
    { id: 'publishers', label: '出版商統計',   visible: false },
    { id: 'concepts',   label: '概念統計',     visible: true  },
    { id: 'topics',     label: '課程分類統計', visible: true  },
    { id: 'chapters',   label: 'Chapters統計', visible: true  },
    { id: 'patterns',      label: '題型統計',     visible: true  },
    { id: 'stemPatterns',  label: '題幹模式統計', visible: true  },
];

function renderTabsNavTemplate() {
    const visibleTabs = TAB_DEFINITIONS.filter(t => t.visible);

    // A tab bar with one (or zero) tabs is pointless UI — render nothing.
    // The questions tab content is already marked .active in
    // renderTabContentsTemplate(), so no tab button is required.
    if (visibleTabs.length <= 1) return '';

    return `
    <div class="tabs">
        ${visibleTabs.map((t, i) => `
        <button class="tab${i === 0 ? ' active' : ''}" onclick="switchTab('${t.id}', event)">${t.label}</button>`).join('')}
    </div>`;
}

function renderTabContentsTemplate() {
    return `
    <!-- ===== Questions Tab ===== -->
    <div id="questions-tab" class="tab-content active">

        ${renderFiltersTemplate()}

        <!-- Active filter badges -->
        <div class="active-filters-panel" id="active-filters-display"></div>

        <!-- Sort controls -->
        <div class="sort-controls-wrapper">
            <button type="button" class="btn btn-outline-primary" id="copy-filtered-btn" onclick="copyFilteredQuestions()">📋 複製篩選題目</button>
            <button type="button" class="btn btn-outline-primary" id="poe-generate-btn" hidden aria-label="AI出題">AI出題</button>
            <span class="sort-label">排序方式：</span>
            <select id="sort-order" onchange="onSortOrderChange()">
                <option value="default">預設 (年份新→舊，題號小→大)</option>
                <option value="year-desc">年份 (新→舊)</option>
                <option value="year-asc">年份 (舊→新)</option>
                <option value="question-asc">題號 (小→大)</option>
                <option value="question-desc">題號 (大→小)</option>
                <option value="marks-asc">分數 (低→高)</option>
                <option value="marks-desc">分數 (高→低)</option>
                <option value="percentage-asc">答對率 (低→高)</option>
                <option value="percentage-desc">答對率 (高→低)</option>
            </select>
            <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer;">
                <input type="checkbox" id="show-tags-toggle" checked onchange="toggleTags(this)"> 顯示詳細標籤
            </label>
            <span class="total-count" id="question-count">總題目數: 0</span>
        </div>

        <!-- Action bar (admin-only actions) -->
        <div class="action-bar">
            <div>
                <button class="btn btn-success btn-admin-only" onclick="toggleForm()">➕ 新增題目</button>
                <button class="btn btn-outline-primary btn-admin-only" onclick="exportJSON()">📥 匯出 JSON</button>
                <button class="btn btn-outline-primary btn-admin-only" onclick="importJSON()">📤 匯入 JSON</button>
                <button class="btn btn-outline-danger btn-admin-only" onclick="clearDatabase()">🗑️ 清除資料庫</button>
            </div>
            <div id="git-sync-panel" class="git-sync-panel" hidden>
                <label class="git-auto-sync" for="git-auto-sync" title="只記在這部瀏覽器。進入頁面時會載入 GitHub 題庫；儲存、刪除、匯入或匯出後會再上傳。">
                    <input type="checkbox" id="git-auto-sync">
                    自動同步
                </label>
                <button type="button" class="btn btn-outline-primary" id="git-upload-btn">上傳到 GitHub</button>
                <button type="button" class="btn btn-outline-primary" id="git-download-btn">從 GitHub 載入</button>
                <span id="git-sync-status" class="git-sync-status" aria-live="polite"></span>
            </div>
        </div>

        ${renderFormTemplate()}

        <!-- Top pagination -->
        <div class="pagination-container">
            <div id="pagination-info">
                <span id="pagination-info-text">顯示 0 題目</span>
                <select id="items-per-page" onchange="changeItemsPerPage('questions')">
                    <option value="10">每頁 10 題</option>
                    <option value="20" selected>每頁 20 題</option>
                    <option value="50">每頁 50 題</option>
                    <option value="-1">全部</option>
                </select>
            </div>
            <div id="pagination-buttons-top"></div>
        </div>

        <!-- Question cards -->
        <div class="question-grid" id="question-grid"></div>

        <!-- Bottom pagination -->
        <div class="pagination-container">
            <div id="pagination-buttons"></div>
        </div>
    </div>

    <!-- ===== Statistics Tabs (hidden until published via TAB_DEFINITIONS) ===== -->
    <div id="publishers-tab" class="tab-content">
        <h2>出版商統計</h2>
        <div class="stats-grid" id="publishers-grid"></div>
    </div>

    <div id="topics-tab" class="tab-content">
        <h2>課程分類統計</h2>
        <div class="stats-grid" id="topics-grid"></div>
    </div>

    <div id="chapters-tab" class="tab-content">
        <h2>Chapters統計</h2>
        <div class="stats-grid" id="chapters-grid"></div>
    </div>

    <div id="concepts-tab" class="tab-content">
        <h2>涉及概念統計</h2>
        <div class="stats-grid" id="concepts-grid"></div>
    </div>

    <div id="patterns-tab" class="tab-content">
        <h2>題型統計</h2>
        <div class="stats-grid" id="patterns-grid"></div>
    </div>

    <div id="stemPatterns-tab" class="tab-content">
        <h2>題幹模式統計</h2>
        <div class="stats-grid" id="stemPatterns-grid"></div>
    </div>`;
}

// Sort change handler — resets to page 1 so the user never lands on a
// stale/empty page after re-sorting. Falls back gracefully if the
// pagination global has a different name in your render.js.
function onSortOrderChange() {
    if (typeof window.currentPage !== 'undefined') window.currentPage = 1;
    renderQuestions();
}