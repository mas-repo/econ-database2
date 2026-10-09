// Statistics functions
// Dependencies: storage-core.js (window.storage), constants.js (CURRICULUM_NAMES, CURRICULUM_DISPLAY, CURRICULUM_ORDER, CHAPTER_DESCRIPTIONS),
// stats-filters.js (STAT_TABS, filter helpers), stats-explore.js (detail / crosstab)

// Get curriculum sort key (extracts letter/code from full name)
// Dependencies: None
function getCurriculumSortKey(topic) {
    // If it's already just a letter (A, B, C...), return it
    if (topic.match(/^[A-J]$|^E[12]$/)) {
        return topic;
    }

    // Extract the letter/code from the full name
    const match = topic.match(/^([A-J]|E[12])\s/);
    return match ? match[1] : topic;
}

// Legacy entry points (aliases still call these).
async function renderPublisherStats() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('publishers');
    await renderGroupedStats('publishers');
}

async function renderTopicStats() {
    await renderGroupedStats('topics');
}

async function renderChapterStats() {
    await renderGroupedStats('chapters');
}

async function renderConceptStats() {
    await renderGroupedStats('concepts');
}

async function renderPatternStats() {
    await renderGroupedStats('patterns');
}

async function renderStemPatternStats() {
    await renderGroupedStats('stemPatterns');
}

function sortStatRows(tabId, rows) {
    const state = getStatsTabState(tabId);
    const copy = rows.slice();
    const byCount = (dir) => copy.sort((a, b) => {
        const diff = dir * (a.data.total - b.data.total);
        if (diff !== 0) return diff;
        return a.searchText.localeCompare(b.searchText, 'zh-HK');
    });
    if (state.sort === 'count-asc') return byCount(1);
    if (state.sort === 'name') {
        return copy.sort((a, b) => a.searchText.localeCompare(b.searchText, 'zh-HK'));
    }
    if (state.sort === 'curriculum') {
        return copy.sort((a, b) => {
            const ia = CURRICULUM_ORDER.indexOf(getCurriculumSortKey(a.value));
            const ib = CURRICULUM_ORDER.indexOf(getCurriculumSortKey(b.value));
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
    }
    if (state.sort === 'number') {
        return copy.sort((a, b) => {
            const na = parseInt(String(a.value).replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(String(b.value).replace(/\D/g, ''), 10) || 0;
            return na - nb;
        });
    }
    return byCount(-1);
}

function renderStatsPager(tabId, page, pageSize, rowCount) {
    const pager = document.getElementById(STAT_TABS[tabId].pagerId);
    if (!pager) return;
    if (pageSize === -1 || rowCount === 0) {
        pager.innerHTML = '';
        return;
    }
    const totalPages = Math.max(1, Math.ceil(rowCount / pageSize));
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, rowCount);
    let buttons = '';
    if (totalPages > 1) {
        if (page > 1) buttons += `<button type="button" class="pagination-btn" data-sf-page="${tabId}" data-sf-page-num="${page - 1}">&laquo;</button>`;
        const startPage = Math.max(1, page - 2);
        const endPage = Math.min(totalPages, page + 2);
        if (startPage > 1) {
            buttons += `<button type="button" class="pagination-btn" data-sf-page="${tabId}" data-sf-page-num="1">1</button>`;
            if (startPage > 2) buttons += '<span style="padding: 8px;">...</span>';
        }
        for (let i = startPage; i <= endPage; i++) {
            buttons += `<button type="button" class="pagination-btn${i === page ? ' active' : ''}" data-sf-page="${tabId}" data-sf-page-num="${i}">${i}</button>`;
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) buttons += '<span style="padding: 8px;">...</span>';
            buttons += `<button type="button" class="pagination-btn" data-sf-page="${tabId}" data-sf-page-num="${totalPages}">${totalPages}</button>`;
        }
        if (page < totalPages) buttons += `<button type="button" class="pagination-btn" data-sf-page="${tabId}" data-sf-page-num="${page + 1}">&raquo;</button>`;
    }
    pager.innerHTML = `
        <div class="stats-page-info">顯示 ${start}-${end} 共 ${rowCount} 項</div>
        <div class="stats-page-buttons">${buttons}</div>`;
}

async function renderGroupedStats(tabId, gen) {
    const dim = (typeof resolveStatsDimension === 'function') ? resolveStatsDimension(tabId) : tabId;
    const cfg = (typeof STAT_TABS !== 'undefined') ? STAT_TABS[dim] : null;
    const grid = cfg && document.getElementById(cfg.gridId);
    if (!cfg || !grid || !window.storage) return;

    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension(dim);
    if (typeof ensureStatsFilterBar === 'function') ensureStatsFilterBar(dim);
    if (typeof syncStatsDimensionControl === 'function') syncStatsDimensionControl(dim);

    const all = await window.storage.getQuestions();
    if (typeof statsRenderIsCurrent === 'function' && typeof gen === 'number' && !statsRenderIsCurrent(dim, gen)) return;

    const filtered = (typeof questionsMatchingStatsFilters === 'function')
        ? questionsMatchingStatsFilters(dim, all)
        : all;

    const counts = new Map();
    filtered.forEach(q => {
        const seen = new Set();
        cfg.valuesOf(q).forEach(raw => {
            const value = String(raw == null ? '' : raw).trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            if (!counts.has(value)) counts.set(value, { total: 0, mc: 0, text: 0 });
            const bucket = counts.get(value);
            bucket.total += 1;
            if (q.questionType === 'MC') bucket.mc += 1;
            else if (q.questionType === '文字題 (SQ/LQ)') bucket.text += 1;
        });
    });

    const query = (typeof statsNameQuery === 'function') ? statsNameQuery(dim) : '';
    let rows = Array.from(counts.entries()).map(([value, data]) => {
        const presentation = statsRowPresentation(dim, value);
        return { value, data, ...presentation };
    });
    if (query) {
        rows = rows.filter(row => row.searchText.toLowerCase().includes(query));
    }
    rows = sortStatRows(dim, rows);

    const state = getStatsTabState(dim);
    const pageSize = state.pageSize;
    const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize) || 1);
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const pageRows = pageSize === -1 ? rows : rows.slice((state.page - 1) * pageSize, state.page * pageSize);

    window._statsRowIndex = window._statsRowIndex || {};
    window._statsRowIndex[dim] = pageRows.map(row => row.value);

    const taggedInAll = all.some(q => cfg.valuesOf(q).some(value => String(value == null ? '' : value).trim()));
    if (!pageRows.length) {
        const message = !taggedInAll ? cfg.empty : cfg.filteredEmpty;
        grid.innerHTML = `<p class="empty-state">${escapeHTML(message)}</p>`;
    } else {
        grid.innerHTML = pageRows.map((row, index) => `
            <div class="stat-card">
                <h3>${row.titleHtml}</h3>
                <div class="stat-details">
                    <div>總題目: ${row.data.total}</div>
                    <div>MC: ${row.data.mc}</div>
                    <div>文字題: ${row.data.text}</div>
                </div>
                <div class="stat-card-footer">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-stats-detail="${dim}" data-stats-idx="${index}" title="查看此項目的詳細統計">詳細統計</button>
                    <button type="button" class="btn btn-outline-primary btn-sm" data-stats-jump="${dim}" data-stats-idx="${index}" title="在題目分頁顯示這 ${row.data.total} 題">查看題目</button>
                </div>
            </div>`).join('');
    }

    renderStatsPager(dim, state.page, pageSize, rows.length);
    if (typeof refreshStatsFilterVisibility === 'function') refreshStatsFilterVisibility(dim, all);
    if (typeof updateStatsFilterChrome === 'function') {
        updateStatsFilterChrome(dim, { questionCount: filtered.length, rowCount: rows.length });
    }
    const heading = document.getElementById('stats-heading');
    if (heading) heading.textContent = '統計 · ' + cfg.label;
}

window.renderStatsTab = function (tabId, gen) {
    return renderGroupedStats(tabId, gen);
};

async function refreshStatistics() {
    if (typeof window.statsViewMode !== 'undefined' && window.statsViewMode === 'crosstab'
        && typeof window.renderStatsCrosstab === 'function') {
        await window.renderStatsCrosstab();
        return;
    }
    const dim = (typeof getStatsActiveDimension === 'function')
        ? getStatsActiveDimension()
        : 'concepts';
    await renderGroupedStats(dim);
}
