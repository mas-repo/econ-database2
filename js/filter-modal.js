// filter-modal.js
// Modal-based pickers for the seven long-option filters:
// 圖表類型 / 表格類型 / 計算類型 / 複選類型 / 概念類型 / 題型 / 題幹模式
//
// DESIGN: state lives directly in window.triStateFilters (keys: graph,
// table, calculation, multipleSelection, concepts, patterns, stemPatterns) with the
// existing 'checked' / 'excluded' tri-state semantics. This means
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
// (filterQuestions, triStateFilters), template-filters.js (trigger
// buttons with ids mf-item-*, mf-trigger-*, mf-badge-*).

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
    // (same behavior as the old input-first dropdowns).
    const item = document.getElementById(`mf-item-${key}`);
    if (item) item.style.display = data.values.length ? '' : 'none';

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

// ---------- Option list ----------

function renderModalOptionList() {
    const list = document.getElementById('mf-list');
    if (!list || !_mfActiveKey) return;
    const key = _mfActiveKey;
    const data = modalFilterData[key];
    const state = (window.triStateFilters && window.triStateFilters[key]) || {};

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

function clearFilterModal() {
    if (!_mfActiveKey) return;
    window.triStateFilters[_mfActiveKey] = {};
    renderModalOptionList();
    updateModalFilterBadge(_mfActiveKey);
    if (typeof filterQuestions === 'function') filterQuestions();
}