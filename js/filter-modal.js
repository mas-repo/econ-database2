// filter-modal.js
// Modal-based pickers for the seven long-option filters:
// 圖表類型 / 表格類型 / 計算類型 / 複選類型 / 概念類型 / 題型 / 題幹模式
// Plus Chapters (static 01–29 list) — was a viewport-overflowing dropdown.
//
// DESIGN: state lives directly in window.triStateFilters (keys: graph,
// table, calculation, multipleSelection, concepts, patterns, stemPatterns,
// chapter) with the existing 'checked' / 'excluded' tri-state semantics.
// Chapter also keeps window.filterLogic.chapter (OR/AND). This means
// applyFilters (storage-filters.js), the active-filter badges
// (updateSearchInfo), clickable question-card tags (filterByTag) and
// clearFilters() all work unchanged.
//
// Option lists + counts are pushed in by updateDynamicDropdowns()
// (filters.js) via populateModalFilter(), so counts are context-aware
// exactly like the old input-first dropdowns were.
//
// Esc handling lives in main.js's global hotkey (closes modal first,
// clears filters only when no modal is open).
//
// Dependencies: utils.js (escapeHTML, debounce), filters.js
// (filterQuestions, triStateFilters), constants.js (CHAPTER_*), 
// template-filters.js (trigger buttons with ids mf-item-*, mf-trigger-*,
// mf-badge-*).

const MODAL_FILTER_DEFS = [
    { key: 'graph',             label: '📊 圖表類型' },
    { key: 'table',             label: '📅 表格類型' },
    { key: 'calculation',       label: '🧮 計算類型' },
    { key: 'multipleSelection', label: '🔍 複選類型' },
    { key: 'concepts',          label: '💡 概念類型' },
    { key: 'patterns',          label: '🎯 題型' },
    { key: 'stemPatterns',      label: '🧩 題幹模式' },
];

// key -> { values: [sorted option strings], counts: { value: n } }
const modalFilterData = {};
MODAL_FILTER_DEFS.forEach(d => {
    modalFilterData[d.key] = { values: [], counts: {} };
});

let _mfActiveKey = null;
let _mfFrozenOrder = null;   // option order snapshot while modal is open
let _mfRenderedOpts = [];    // currently rendered (search-filtered) options

// ---------- Data intake (called from filters.js) ----------

function populateModalFilter(key, data) {
    if (!modalFilterData[key]) return;
    modalFilterData[key] = data;

    // Hide the trigger entirely when the dataset has no values for it
    // (same behavior as the old input-first dropdowns). An empty-field
    // choice still counts, so a field of only blanks stays reachable.
    const item = document.getElementById(`mf-item-${key}`);
    const hasChoices = data.values.length > 0 || (data.emptyCount || 0) > 0;
    if (item) item.style.display = hasChoices ? '' : 'none';

    updateModalFilterBadge(key);

    // Live-refresh counts/marks if this modal is currently open.
    if (_mfActiveKey === key) renderModalOptionList();
}

// ---------- Trigger badges ----------

function updateModalFilterBadge(key) {
    const badge = document.getElementById(`mf-badge-${key}`);
    const trigger = document.getElementById(`mf-trigger-${key}`);
    if (!badge || !trigger) return;
    const state = (window.triStateFilters && window.triStateFilters[key]) || {};
    const n = Object.keys(state).length;

    // Zero selections → badge fully hidden. The hidden attribute alone is
    // not enough because .mf-badge sets display:inline-block, which beats
    // the UA's [hidden]{display:none} rule — filters.css therefore also
    // declares .mf-badge[hidden]{display:none !important}. We blank the
    // text too as belt-and-braces.
    badge.hidden = n === 0;
    badge.textContent = n === 0 ? '' : n;
    trigger.classList.toggle('mf-trigger-active', n > 0);
}

function updateModalFilterBadges() {
    MODAL_FILTER_DEFS.forEach(d => updateModalFilterBadge(d.key));
    updateChapterFilterBadge();
}

// ---------- Modal lifecycle ----------

function openFilterModal(key) {
    const def = MODAL_FILTER_DEFS.find(d => d.key === key);
    if (!def) return;

    closeFilterModal(); // ensure no duplicate

    _mfActiveKey = key;
    // Freeze ordering so rows don't jump around while the user clicks
    // (filters.js re-sorts active-first on every change).
    _mfFrozenOrder = [...modalFilterData[key].values];

    const overlay = document.createElement('div');
    overlay.className = 'mf-overlay';
    overlay.id = 'mf-overlay';
    overlay.innerHTML = `
        <div class="mf-dialog" role="dialog" aria-modal="true" aria-label="${def.label}">
            <div class="mf-header">
                <h3>${def.label}</h3>
                <button type="button" class="mf-close" onclick="closeFilterModal()" aria-label="關閉">✕</button>
            </div>
            <div class="mf-hint">點擊選項切換：未選 → ✔ 包含 → ✕ 排除</div>
            <div class="mf-empty-slot" id="mf-empty-slot"></div>
            <input type="text" class="mf-search" id="mf-search" placeholder="搜尋選項...">
            <div class="mf-list" id="mf-list"></div>
            <div class="mf-footer">
                <button type="button" class="btn mf-clear-btn" onclick="clearFilterModal()">🗑️ 清除</button>
                <button type="button" class="btn mf-done-btn" onclick="closeFilterModal()">完成</button>
            </div>
        </div>`;

    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeFilterModal();
    });
    document.body.appendChild(overlay);
    document.body.classList.add('mf-modal-open');

    const searchEl = document.getElementById('mf-search');
    searchEl.addEventListener('input',
        typeof debounce === 'function'
            ? debounce(() => renderModalOptionList(), 150)
            : () => renderModalOptionList());

    renderModalOptionList();
    searchEl.focus();
}

function closeFilterModal() {
    const overlay = document.getElementById('mf-overlay');
    if (overlay) overlay.remove();
    document.body.classList.remove('mf-modal-open');
    _mfActiveKey = null;
    _mfFrozenOrder = null;
    _mfRenderedOpts = [];
}

// ---------- Chapters (centered modal; same tri-state + OR/AND as old dropdown) ----------

function updateChapterFilterBadge() {
    const badge = document.getElementById('mf-badge-chapter');
    const trigger = document.getElementById('mf-trigger-chapter');
    if (!badge || !trigger) return;
    const state = (window.triStateFilters && window.triStateFilters.chapter) || {};
    const n = Object.keys(state).length;
    badge.hidden = n === 0;
    badge.textContent = n === 0 ? '' : String(n);
    trigger.classList.toggle('mf-trigger-active', n > 0);
}

function openChapterFilterModal() {
    closeFilterModal();

    _mfActiveKey = 'chapter';
    _mfFrozenOrder = null;
    _mfRenderedOpts = [];

    if (!window.filterLogic) window.filterLogic = { curriculum: 'OR', chapter: 'OR' };
    const andOn = window.filterLogic.chapter === 'AND';

    const overlay = document.createElement('div');
    overlay.className = 'mf-overlay';
    overlay.id = 'mf-overlay';
    overlay.innerHTML = `
        <div class="mf-dialog mf-chapter-dialog" role="dialog" aria-modal="true" aria-label="Chapters">
            <div class="mf-header">
                <h3>📖 Chapters</h3>
                <button type="button" class="mf-close" onclick="closeFilterModal()" aria-label="關閉">✕</button>
            </div>
            <div class="mf-hint">點擊選項切換：未選 → ✔ 包含 → ✕ 排除</div>
            <div class="mf-chapter-toolbar">
                <div class="logic-toggle">
                    <input type="checkbox" id="chapter-logic-toggle" ${andOn ? 'checked' : ''}
                           onchange="toggleChapterLogic(this)">
                    <label for="chapter-logic-toggle">
                        <span class="logic-text or">OR</span>
                        <span class="logic-text and">AND</span>
                    </label>
                </div>
                <input type="text" class="mf-search mf-chapter-search" id="mf-chapter-search"
                       placeholder="搜尋章節編號或名稱...">
            </div>
            <div class="mf-list mf-chapter-list" id="mf-chapter-list"></div>
            <div class="mf-footer">
                <button type="button" class="btn mf-clear-btn" onclick="clearChapterFilter()">🗑️ 清除</button>
                <button type="button" class="btn mf-done-btn" onclick="closeFilterModal()">完成</button>
            </div>
        </div>`;

    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeFilterModal();
    });
    document.body.appendChild(overlay);
    document.body.classList.add('mf-modal-open');

    const searchEl = document.getElementById('mf-chapter-search');
    searchEl.addEventListener('input',
        typeof debounce === 'function'
            ? debounce(() => renderChapterModalList(), 150)
            : () => renderChapterModalList());

    renderChapterModalList();
    updateChapterFilterBadge();
    searchEl.focus();
}

function chapterModalEntries() {
    const min = (typeof CHAPTER_RANGE !== 'undefined' && CHAPTER_RANGE.min) || 1;
    const max = (typeof CHAPTER_RANGE !== 'undefined' && CHAPTER_RANGE.max) || 29;
    const descs = (typeof CHAPTER_DESCRIPTIONS !== 'undefined') ? CHAPTER_DESCRIPTIONS : {};
    const out = [];
    for (let i = min; i <= max; i++) {
        const chNumber = String(i).padStart(2, '0');
        out.push({
            value: chNumber,
            name: descs[chNumber] || ''
        });
    }
    return out;
}

function renderChapterModalList() {
    const list = document.getElementById('mf-chapter-list');
    if (!list || _mfActiveKey !== 'chapter') return;

    const state = (window.triStateFilters && window.triStateFilters.chapter) || {};
    const term = (document.getElementById('mf-chapter-search')?.value || '').trim().toLowerCase();
    const entries = chapterModalEntries().filter(entry => {
        if (!term) return true;
        return entry.value.includes(term)
            || String(parseInt(entry.value, 10)).includes(term)
            || entry.name.toLowerCase().includes(term);
    });
    _mfRenderedOpts = entries.map(e => e.value);

    if (!entries.length) {
        list.innerHTML = '<div class="mf-empty">沒有符合的章節</div>';
        return;
    }

    list.innerHTML = '<div class="mf-chapter-grid">' + entries.map((entry, i) => {
        const s = state[entry.value];
        const mode = s === 'checked' ? 'include' : s === 'excluded' ? 'exclude' : 'none';
        const mark = mode === 'include' ? '✔' : mode === 'exclude' ? '✕' : '';
        const nameHtml = entry.name
            ? `<span class="mf-chapter-name">${escapeHTML(entry.name)}</span>`
            : '';
        return `
        <button type="button" class="mf-option mf-chapter-option mf-${mode}" data-idx="${i}"
                title="${escapeHTML(entry.value + (entry.name ? ': ' + entry.name : ''))}">
            <span class="mf-mark">${mark}</span>
            <span class="mf-chapter-num">${escapeHTML(entry.value)}</span>
            ${nameHtml}
        </button>`;
    }).join('') + '</div>';

    list.onclick = e => {
        const btn = e.target.closest('.mf-chapter-option');
        if (!btn) return;
        const opt = _mfRenderedOpts[Number(btn.dataset.idx)];
        if (opt !== undefined) cycleChapterModalOption(opt);
    };
}

function cycleChapterModalOption(opt) {
    if (!window.triStateFilters.chapter) window.triStateFilters.chapter = {};
    const cur = window.triStateFilters.chapter[opt];
    if (!cur) {
        window.triStateFilters.chapter[opt] = 'checked';
    } else if (cur === 'checked') {
        window.triStateFilters.chapter[opt] = 'excluded';
    } else {
        delete window.triStateFilters.chapter[opt];
    }
    renderChapterModalList();
    updateChapterFilterBadge();
    if (typeof updateFilterIndicators === 'function') updateFilterIndicators();
    if (typeof filterQuestions === 'function') filterQuestions();
}

function clearFilterModal() {
    if (!_mfActiveKey) return;
    if (_mfActiveKey === 'chapter') {
        if (typeof clearChapterFilter === 'function') clearChapterFilter();
        return;
    }
    window.triStateFilters[_mfActiveKey] = {};
    renderModalOptionList();
    updateModalFilterBadge(_mfActiveKey);
    if (typeof filterQuestions === 'function') filterQuestions();
}

// ---------- Option list ----------

function renderEmptyFieldOption(key) {
    const slot = document.getElementById('mf-empty-slot');
    if (!slot) return;
    const label = EMPTY_FIELD_LABELS[key];
    if (!label) {
        slot.innerHTML = '';
        return;
    }
    const state = ((window.triStateFilters && window.triStateFilters[key]) || {})[EMPTY_FIELD_SENTINEL];
    const mode = state === 'checked' ? 'include' : state === 'excluded' ? 'exclude' : 'none';
    const mark = mode === 'include' ? '✔' : mode === 'exclude' ? '✕' : '';
    const count = (modalFilterData[key] && modalFilterData[key].emptyCount) || 0;
    slot.innerHTML = `
        <button type="button" class="mf-option mf-empty-option mf-${mode}">
            <span class="mf-mark">${mark}</span>
            <span class="mf-option-label">${escapeHTML(label)}</span>
            <span class="mf-count">(${count})</span>
        </button>`;
    slot.onclick = () => cycleModalOption(key, EMPTY_FIELD_SENTINEL);
}

function renderModalOptionList() {
    const list = document.getElementById('mf-list');
    if (!list || !_mfActiveKey) return;
    const key = _mfActiveKey;
    const data = modalFilterData[key];
    const state = (window.triStateFilters && window.triStateFilters[key]) || {};
    renderEmptyFieldOption(key);

    // Frozen base order + any values that appeared after opening.
    const base = _mfFrozenOrder ? [..._mfFrozenOrder] : [...data.values];
    data.values.forEach(v => {
        if (!base.includes(v)) base.push(v);
    });

    const term = (document.getElementById('mf-search')?.value || '').trim().toUpperCase();
    const opts = base.filter(o => !term || String(o).toUpperCase().includes(term));
    _mfRenderedOpts = opts;

    if (opts.length === 0) {
        list.innerHTML = `<div class="mf-empty">沒有符合的選項</div>`;
        return;
    }

    list.innerHTML = opts.map((opt, i) => {
        const s = state[opt];
        const mode = s === 'checked' ? 'include' : s === 'excluded' ? 'exclude' : 'none';
        const mark = mode === 'include' ? '✔' : mode === 'exclude' ? '✕' : '';
        const count = data.counts[opt] || 0;
        return `
        <button type="button" class="mf-option mf-${mode}" data-idx="${i}">
            <span class="mf-mark">${mark}</span>
            <span class="mf-option-label">${escapeHTML(opt)}</span>
            <span class="mf-count">(${count})</span>
        </button>`;
    }).join('');

    // Delegated handler; map index back to the rendered array so raw
    // option text never lands inside an onclick attribute (XSS-safe,
    // and quote-safe for option names containing ' or ").
    list.onclick = e => {
        const btn = e.target.closest('.mf-option');
        if (!btn) return;
        const opt = _mfRenderedOpts[Number(btn.dataset.idx)];
        if (opt !== undefined) cycleModalOption(key, opt);
    };
}

function cycleModalOption(key, opt) {
    if (!window.triStateFilters[key]) window.triStateFilters[key] = {};
    const cur = window.triStateFilters[key][opt];

    if (!cur) {
        window.triStateFilters[key][opt] = 'checked';
    } else if (cur === 'checked') {
        window.triStateFilters[key][opt] = 'excluded';
    } else {
        delete window.triStateFilters[key][opt];
    }

    renderModalOptionList();        // instant visual feedback
    updateModalFilterBadge(key);
    if (typeof filterQuestions === 'function') filterQuestions();
}