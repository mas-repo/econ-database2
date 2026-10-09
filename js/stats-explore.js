// stats-explore.js
// Unified 統計 tab chrome: dimension switcher, 詳細統計 modal, 交叉分析.
// Dimension lists come from STAT_TABS / STAT_DIMENSION_GROUPS (stats-filters.js).
// Dependencies: stats-filters.js, statistics.js, storage, constants, utils.

(function () {
    'use strict';

    var detailOverlay = null;
    var detailSession = null;
    var crosstabState = {
        row: 'topics',
        col: 'year',
        metric: 'count'
    };
    var dimensionOptionsGen = 0;

    var DETAIL_PREFS_KEY = 'statsDetailPrefs.v1';
    var DETAIL_TOP_N = 20;
    // Default-on sections (others available via picker). Parent dim is auto-hidden.
    var DETAIL_DEFAULT_VISIBLE = {
        year: true,
        exam: true,
        paper: true,
        qtype: true,
        percentageBin: true,
        marksBin: true,
        topics: true,
        chapters: true,
        section: true,
        publishers: true,
        patterns: true,
        feature: true,
        yearKind: true,
        qnumBin: true
    };

    var CROSSTAB_METRICS = [
        { id: 'count', label: '題數' },
        { id: 'mc', label: 'MC數' },
        { id: 'text', label: '文字題數' },
        { id: 'avgPercentage', label: '平均答對率' },
        { id: 'avgMarks', label: '平均分數' }
    ];

    var CROSSTAB_PRESETS = [
        { label: '課程分類 × 年份', row: 'topics', col: 'year', metric: 'count' },
        { label: '章節 × 答對率區間', row: 'chapters', col: 'percentageBin', metric: 'count' },
        { label: '題型 × 課程分類', row: 'patterns', col: 'topics', metric: 'count' },
        { label: '概念 × 題目類型', row: 'concepts', col: 'qtype', metric: 'count' },
        { label: '年份種類 × 特徵', row: 'yearKind', col: 'feature', metric: 'count' },
        { label: '題號區間 × 分數區間', row: 'qnumBin', col: 'marksBin', metric: 'count' }
    ];

    function esc(text) {
        return (typeof escapeHTML === 'function')
            ? escapeHTML(text)
            : String(text == null ? '' : text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
    }

    function axisLabelText(axisId) {
        return (window.STAT_TABS && STAT_TABS[axisId]) ? STAT_TABS[axisId].label : axisId;
    }

    function valuesForAxis(question, axisId) {
        if (window.STAT_TABS && STAT_TABS[axisId] && typeof STAT_TABS[axisId].valuesOf === 'function') {
            return STAT_TABS[axisId].valuesOf(question).map(function (v) {
                return String(v == null ? '' : v).trim();
            }).filter(Boolean);
        }
        return [];
    }

    function axisLabelPlain(value, axisId) {
        if (axisId === 'year' && typeof yearFilterLabel === 'function') return yearFilterLabel(value);
        if (axisId === 'paper' && typeof paperFilterLabel === 'function') return paperFilterLabel(value);
        if (axisId === 'section') {
            var sectionLabels = {
                A: '甲部（短題目）',
                B: '乙部（結構/文章式/資料回應試題）',
                C: '丙部（選修單元）',
                '-': 'NA'
            };
            return sectionLabels[value] || String(value);
        }
        return String(value);
    }

    async function syncStatsDimensionControl(dim) {
        var select = document.getElementById('stats-dimension');
        if (!select || !window.STAT_TABS) return;
        var gen = ++dimensionOptionsGen;
        var questions = [];
        try {
            if (window.storage && typeof window.storage.getQuestions === 'function') {
                questions = await window.storage.getQuestions();
            }
        } catch (e) {
            questions = [];
        }
        if (gen !== dimensionOptionsGen) return;
        if (typeof buildStatDimensionOptionsHtml === 'function') {
            select.innerHTML = buildStatDimensionOptionsHtml(dim, questions);
        } else {
            select.innerHTML = Object.keys(STAT_TABS).map(function (id) {
                return '<option value="' + esc(id) + '">' + esc(STAT_TABS[id].label) + '</option>';
            }).join('');
        }
        if (STAT_TABS[dim]) select.value = dim;
        else if (select.options.length) select.value = select.options[0].value;
    }

    function setStatsViewMode(mode) {
        window.statsViewMode = mode === 'crosstab' ? 'crosstab' : 'browse';
        document.querySelectorAll('[data-stats-mode]').forEach(function (btn) {
            var active = btn.getAttribute('data-stats-mode') === window.statsViewMode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        var browse = document.getElementById('stats-browse-panel');
        var cross = document.getElementById('stats-crosstab-panel');
        if (browse) browse.hidden = window.statsViewMode !== 'browse';
        if (cross) cross.hidden = window.statsViewMode !== 'crosstab';
        // Filter bar hideOn differs between browse and crosstab — rebuild.
        var mount = document.getElementById('stats-filters');
        if (mount) {
            mount.dataset.ready = '';
            mount.dataset.statsDim = '';
        }
        if (window.statsViewMode === 'crosstab') {
            ensureCrosstabPanel().then(function () {
                renderStatsCrosstab();
            });
        } else {
            var dim = getStatsActiveDimension();
            syncStatsDimensionControl(dim);
            if (typeof scheduleStatsRender === 'function') scheduleStatsRender(dim);
            else if (typeof renderGroupedStats === 'function') renderGroupedStats(dim);
        }
    }

    function bindStatsExploreUi() {
        if (bindStatsExploreUi.bound) return;
        bindStatsExploreUi.bound = true;

        document.addEventListener('change', function (event) {
            var dimSelect = event.target.closest('#stats-dimension');
            if (dimSelect) {
                var dim = setStatsActiveDimension(dimSelect.value);
                var state = getStatsTabState(dim);
                state.page = 1;
                if (STAT_TABS[dim]) {
                    state.sort = STAT_TABS[dim].defaultSort;
                    state.pageSize = STAT_TABS[dim].defaultPageSize;
                }
                var mount = document.getElementById('stats-filters');
                if (mount) {
                    mount.dataset.ready = '';
                    mount.dataset.statsDim = '';
                }
                if (typeof scheduleStatsRender === 'function') scheduleStatsRender(dim);
                return;
            }
            if (event.target.closest('[data-ct-row],[data-ct-col],[data-ct-metric]')) {
                var rowEl = document.getElementById('ct-row');
                var colEl = document.getElementById('ct-col');
                var metricEl = document.getElementById('ct-metric');
                if (rowEl) crosstabState.row = rowEl.value;
                if (colEl) crosstabState.col = colEl.value;
                if (metricEl) crosstabState.metric = metricEl.value;
                renderStatsCrosstab();
            }
        });

        document.addEventListener('click', function (event) {
            var modeBtn = event.target.closest('[data-stats-mode]');
            if (modeBtn) {
                setStatsViewMode(modeBtn.getAttribute('data-stats-mode'));
                return;
            }
            var detailBtn = event.target.closest('[data-stats-detail]');
            if (detailBtn) {
                var tabId = detailBtn.getAttribute('data-stats-detail');
                var idx = Number(detailBtn.getAttribute('data-stats-idx'));
                var value = (window._statsRowIndex && window._statsRowIndex[tabId] || [])[idx];
                if (value !== undefined) openStatsDetailModal(tabId, value);
                return;
            }
            var swap = event.target.closest('#ct-swap');
            if (swap) {
                var tmp = crosstabState.row;
                crosstabState.row = crosstabState.col;
                crosstabState.col = tmp;
                ensureCrosstabPanel().then(function () {
                    renderStatsCrosstab();
                });
                return;
            }
            var preset = event.target.closest('[data-ct-preset]');
            if (preset) {
                var i = Number(preset.getAttribute('data-ct-preset'));
                var p = CROSSTAB_PRESETS[i];
                if (p) {
                    crosstabState.row = p.row;
                    crosstabState.col = p.col;
                    crosstabState.metric = p.metric;
                    ensureCrosstabPanel().then(function () {
                        renderStatsCrosstab();
                    });
                }
                return;
            }
            var cell = event.target.closest('[data-ct-row-val][data-ct-col-val]');
            if (cell && !cell.classList.contains('is-empty')) {
                jumpCrosstabCellToQuestions(
                    cell.getAttribute('data-ct-row-axis'),
                    cell.getAttribute('data-ct-row-val'),
                    cell.getAttribute('data-ct-col-axis'),
                    cell.getAttribute('data-ct-col-val')
                );
            }
        });
    }

    function mean(nums) {
        if (!nums.length) return null;
        var sum = 0;
        for (var i = 0; i < nums.length; i++) sum += nums[i];
        return sum / nums.length;
    }

    function formatAvg(n, suffix) {
        if (n == null || isNaN(n)) return '—';
        var text = (Math.round(n * 10) / 10).toFixed(1);
        return suffix ? text + suffix : text;
    }

    function loadDetailPrefs() {
        var defaults = {
            sortMode: 'count',
            expandAll: false,
            topN: DETAIL_TOP_N,
            visible: Object.assign({}, DETAIL_DEFAULT_VISIBLE)
        };
        try {
            var raw = localStorage.getItem(DETAIL_PREFS_KEY);
            if (!raw) return defaults;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return defaults;
            var visible = Object.assign({}, DETAIL_DEFAULT_VISIBLE);
            if (parsed.visible && typeof parsed.visible === 'object') {
                Object.keys(parsed.visible).forEach(function (key) {
                    visible[key] = !!parsed.visible[key];
                });
            }
            return {
                sortMode: parsed.sortMode === 'natural' ? 'natural' : 'count',
                expandAll: !!parsed.expandAll,
                topN: Number(parsed.topN) > 0 ? Number(parsed.topN) : DETAIL_TOP_N,
                visible: visible
            };
        } catch (e) {
            return defaults;
        }
    }

    function saveDetailPrefs(prefs) {
        try {
            localStorage.setItem(DETAIL_PREFS_KEY, JSON.stringify({
                sortMode: prefs.sortMode === 'natural' ? 'natural' : 'count',
                expandAll: !!prefs.expandAll,
                topN: Number(prefs.topN) > 0 ? Number(prefs.topN) : DETAIL_TOP_N,
                visible: prefs.visible || {}
            }));
        } catch (e) { /* ignore quota / private mode */ }
    }

    function listDetailSectionIds() {
        if (typeof listStatDimensionIds === 'function') return listStatDimensionIds();
        return Object.keys(STAT_TABS || {});
    }

    function metricBreakdown(questions, dimId, groupTotal) {
        var map = {};
        (questions || []).forEach(function (q) {
            var seen = {};
            valuesForAxis(q, dimId).forEach(function (raw) {
                var key = String(raw == null ? '' : raw).trim();
                if (!key || seen[key]) return;
                seen[key] = true;
                if (!map[key]) {
                    map[key] = { key: key, count: 0, mc: 0, text: 0, pctSum: 0, pctN: 0, marksSum: 0, marksN: 0 };
                }
                var cell = map[key];
                cell.count += 1;
                if (q.questionType === 'MC') cell.mc += 1;
                else if (q.questionType === '文字題 (SQ/LQ)') cell.text += 1;
                if (q.correctPercentage != null && q.correctPercentage !== '' && !isNaN(Number(q.correctPercentage))) {
                    cell.pctSum += Number(q.correctPercentage);
                    cell.pctN += 1;
                }
                if (q.marks != null && q.marks !== '' && !isNaN(Number(q.marks))) {
                    cell.marksSum += Number(q.marks);
                    cell.marksN += 1;
                }
            });
        });
        var total = groupTotal > 0 ? groupTotal : 0;
        return Object.keys(map).map(function (key) {
            var cell = map[key];
            cell.share = total ? (cell.count / total) * 100 : 0;
            return cell;
        });
    }

    function sortDetailRows(rows, dimId, sortMode) {
        var copy = rows.slice();
        if (sortMode === 'natural') {
            var order = sortAxisKeys(copy.map(function (r) { return r.key; }), dimId);
            var rank = {};
            order.forEach(function (key, i) { rank[key] = i; });
            return copy.sort(function (a, b) {
                var ra = rank[a.key];
                var rb = rank[b.key];
                if (ra !== rb) return (ra == null ? 9999 : ra) - (rb == null ? 9999 : rb);
                return String(a.key).localeCompare(String(b.key), 'zh-HK');
            });
        }
        return copy.sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return String(a.key).localeCompare(String(b.key), 'zh-HK');
        });
    }

    function formatShare(pct) {
        if (pct == null || isNaN(pct)) return '—';
        return (Math.round(pct * 10) / 10).toFixed(1) + '%';
    }

    function ensureDetailOverlay() {
        if (detailOverlay) return detailOverlay;
        detailOverlay = document.createElement('div');
        detailOverlay.id = 'stats-detail-overlay';
        detailOverlay.className = 'stats-detail-overlay';
        detailOverlay.hidden = true;
        detailOverlay.innerHTML = ''
            + '<div class="stats-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="stats-detail-title">'
            + '  <div class="stats-detail-header">'
            + '    <h3 id="stats-detail-title">詳細統計</h3>'
            + '    <button type="button" class="stats-detail-close" aria-label="關閉">×</button>'
            + '  </div>'
            + '  <div class="stats-detail-body" id="stats-detail-body"></div>'
            + '  <div class="stats-detail-footer">'
            + '    <button type="button" class="btn btn-outline-primary" id="stats-detail-jump">查看題目</button>'
            + '    <button type="button" class="btn btn-secondary" id="stats-detail-close-btn">關閉</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(detailOverlay);
        if (!document.getElementById('stats-explore-styles')) {
            var style = document.createElement('style');
            style.id = 'stats-explore-styles';
            style.textContent = ''
                + '.stats-shell-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;}'
                + '.stats-shell-head h2{margin:0;font-size:1.35rem;}'
                + '.stats-mode-toggle{display:inline-flex;border:1px solid var(--border-light,#e0e0e0);border-radius:8px;overflow:hidden;background:#fff;}'
                + '.stats-mode-btn{appearance:none;border:0;background:#fff;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;}'
                + '.stats-mode-btn+.stats-mode-btn{border-left:1px solid var(--border-light,#e0e0e0);}'
                + '.stats-mode-btn.is-active{background:#e8f1ff;font-weight:700;}'
                + '.stats-dimension-bar{display:flex;align-items:center;gap:8px;margin:8px 0 4px;}'
                + '.stats-dimension-bar label{font-size:13px;color:var(--text-light,#7f8c8d);}'
                + '.stats-dimension-bar select{padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;max-width:min(100%,22em);}'
                + '.stat-card-footer{gap:8px;flex-wrap:wrap;}'
                + '.stats-detail-overlay{position:fixed;inset:0;z-index:12400;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.5);}'
                + '.stats-detail-overlay[hidden]{display:none!important;}'
                + '.stats-detail-dialog{width:min(960px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.2);}'
                + '.stats-detail-header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e7eef5;}'
                + '.stats-detail-header h3{margin:0;font-size:18px;}'
                + '.stats-detail-close{width:34px;height:34px;border:1px solid #e0e0e0;border-radius:8px;background:#fff;font-size:20px;cursor:pointer;}'
                + '.stats-detail-body{flex:1;min-height:0;overflow:auto;padding:14px 16px;}'
                + '.stats-detail-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;padding:10px;border:1px solid #e7eef5;border-radius:10px;background:#f8fafc;}'
                + '.stats-detail-toolbar .stats-mode-toggle{flex:0 0 auto;}'
                + '.stats-detail-toolbar-label{font-size:12px;color:var(--text-light,#7f8c8d);}'
                + '.stats-detail-sections-wrap{position:relative;}'
                + '.stats-detail-sections-panel{position:absolute;left:0;top:calc(100% + 4px);z-index:2;min-width:16em;max-height:min(50vh,360px);overflow:auto;padding:10px;border:1px solid #d7e3ef;border-radius:8px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.12);}'
                + '.stats-detail-sections-panel[hidden]{display:none!important;}'
                + '.stats-detail-sections-panel label{display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;cursor:pointer;}'
                + '.stats-detail-sections-panel .sf-group-label{display:block;margin:8px 0 4px;font-size:11px;font-weight:700;color:#64748b;}'
                + '.stats-detail-sections-panel .sf-group-label:first-child{margin-top:0;}'
                + '.stats-detail-hint{font-size:12px;color:var(--text-light,#7f8c8d);margin:0 0 10px;line-height:1.45;}'
                + '.stats-detail-section{margin-bottom:18px;}'
                + '.stats-detail-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 8px;}'
                + '.stats-detail-section-head h4{margin:0;font-size:14px;}'
                + '.stats-detail-section-meta{font-size:12px;color:#64748b;}'
                + '.stats-detail-table-wrap{overflow:auto;}'
                + '.stats-detail-table{width:100%;border-collapse:collapse;font-size:13px;}'
                + '.stats-detail-table th,.stats-detail-table td{padding:6px 8px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap;}'
                + '.stats-detail-table th.num,.stats-detail-table td.num{text-align:right;}'
                + '.stats-detail-table tbody tr.stats-detail-row{cursor:pointer;}'
                + '.stats-detail-table tbody tr.stats-detail-row:hover{background:#eef5ff;}'
                + '.stats-detail-expand{margin-top:8px;}'
                + '.stats-detail-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e7eef5;}'
                + '.stats-crosstab-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:8px 0 12px;padding:10px;border:1px solid #e7eef5;border-radius:10px;background:#f8fafc;}'
                + '.stats-crosstab-controls label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-light,#7f8c8d);}'
                + '.stats-crosstab-controls select{min-width:9em;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
                + '.stats-crosstab-presets{display:flex;flex-wrap:wrap;gap:6px;width:100%;}'
                + '.stats-crosstab-note{font-size:12px;color:var(--text-light,#7f8c8d);margin:0 0 8px;line-height:1.45;}'
                + '.stats-crosstab-scroll{overflow:auto;max-height:min(70vh,720px);border:1px solid #e7eef5;border-radius:8px;background:#fff;}'
                + '.stats-crosstab-table{border-collapse:collapse;font-size:12px;min-width:100%;}'
                + '.stats-crosstab-table th,.stats-crosstab-table td{padding:6px 8px;border:1px solid #e7eef5;white-space:nowrap;}'
                + '.stats-crosstab-table th{position:sticky;top:0;background:#f8fafc;z-index:1;font-weight:700;}'
                + '.stats-crosstab-table th.ct-corner{left:0;z-index:2;}'
                + '.stats-crosstab-table td.ct-rowhead{position:sticky;left:0;background:#fff;font-weight:600;z-index:1;}'
                + '.stats-crosstab-table td.ct-cell{cursor:pointer;text-align:right;}'
                + '.stats-crosstab-table td.ct-cell:hover{background:#eef5ff;}'
                + '.stats-crosstab-table td.is-empty{color:#94a3b8;cursor:default;}'
                + '.stats-crosstab-table td.is-empty:hover{background:transparent;}';
            document.head.appendChild(style);
        }

        detailOverlay.addEventListener('click', function (event) {
            if (event.target === detailOverlay) {
                closeStatsDetailModal();
                return;
            }
            var closeBtn = event.target.closest('.stats-detail-close, #stats-detail-close-btn');
            if (closeBtn) {
                closeStatsDetailModal();
                return;
            }
            var sortBtn = event.target.closest('[data-detail-sort]');
            if (sortBtn && detailSession) {
                detailSession.prefs.sortMode = sortBtn.getAttribute('data-detail-sort') === 'natural' ? 'natural' : 'count';
                saveDetailPrefs(detailSession.prefs);
                renderDetailModalBody();
                return;
            }
            var sectionsToggle = event.target.closest('#stats-detail-sections-btn');
            if (sectionsToggle) {
                var panel = document.getElementById('stats-detail-sections-panel');
                if (panel) panel.hidden = !panel.hidden;
                return;
            }
            var expandBtn = event.target.closest('[data-detail-expand]');
            if (expandBtn && detailSession) {
                detailSession.prefs.expandAll = expandBtn.getAttribute('data-detail-expand') === '1';
                saveDetailPrefs(detailSession.prefs);
                renderDetailModalBody();
                return;
            }
            var row = event.target.closest('tr.stats-detail-row[data-detail-dim][data-detail-val]');
            if (row && detailSession) {
                jumpDetailRowToQuestions(
                    detailSession.tabId,
                    detailSession.rawValue,
                    row.getAttribute('data-detail-dim'),
                    row.getAttribute('data-detail-val')
                );
            }
        });
        detailOverlay.addEventListener('change', function (event) {
            var check = event.target.closest('[data-detail-section]');
            if (!check || !detailSession) return;
            var id = check.getAttribute('data-detail-section');
            detailSession.prefs.visible[id] = !!check.checked;
            saveDetailPrefs(detailSession.prefs);
            renderDetailModalBody();
            var panel = document.getElementById('stats-detail-sections-panel');
            if (panel) panel.hidden = false;
        });
        return detailOverlay;
    }

    function isDetailSectionChecked(dimId, prefs) {
        if (prefs.visible[dimId] === false) return false;
        if (prefs.visible[dimId] === true) return true;
        return !!DETAIL_DEFAULT_VISIBLE[dimId];
    }

    function buildDetailSectionsPanelHtml(parentDim, prefs, breakdowns) {
        var groups = (window.STAT_DIMENSION_GROUPS && STAT_DIMENSION_GROUPS.length)
            ? STAT_DIMENSION_GROUPS
            : [{ label: '維度', ids: listDetailSectionIds() }];
        var html = '';
        groups.forEach(function (group) {
            var items = (group.ids || []).filter(function (id) {
                if (!STAT_TABS[id] || id === parentDim) return false;
                if (STAT_TABS[id].optional && breakdowns && !breakdowns[id]) return false;
                return true;
            });
            if (!items.length) return;
            html += '<div class="sf-group-label">' + esc(group.label) + '</div>';
            items.forEach(function (id) {
                var checked = isDetailSectionChecked(id, prefs);
                html += '<label><input type="checkbox" data-detail-section="' + esc(id) + '"'
                    + (checked ? ' checked' : '') + '> '
                    + esc(STAT_TABS[id].label) + '</label>';
            });
        });
        return html;
    }

    function isDetailSectionVisible(dimId, parentDim, prefs) {
        if (!STAT_TABS[dimId] || dimId === parentDim) return false;
        return isDetailSectionChecked(dimId, prefs);
    }

    function renderDetailSectionHtml(dimId, rows, prefs) {
        if (!rows || !rows.length) return '';
        var sorted = sortDetailRows(rows, dimId, prefs.sortMode);
        var topN = prefs.topN || DETAIL_TOP_N;
        var showAll = !!prefs.expandAll;
        var visible = showAll ? sorted : sorted.slice(0, topN);
        var hasPct = sorted.some(function (r) { return r.pctN > 0; });
        var hasMarks = sorted.some(function (r) { return r.marksN > 0; });
        var head = ''
            + '<tr>'
            + '<th>項目</th>'
            + '<th class="num">題數</th>'
            + '<th class="num">佔比</th>'
            + '<th class="num">MC</th>'
            + '<th class="num">文字題</th>'
            + (hasPct ? '<th class="num">平均答對率</th>' : '')
            + (hasMarks ? '<th class="num">平均分數</th>' : '')
            + '</tr>';
        var body = visible.map(function (row) {
            return '<tr class="stats-detail-row" data-detail-dim="' + esc(dimId) + '" data-detail-val="' + esc(row.key) + '" title="點擊以查看題目">'
                + '<td>' + esc(axisLabelPlain(row.key, dimId)) + '</td>'
                + '<td class="num">' + row.count + '</td>'
                + '<td class="num">' + esc(formatShare(row.share)) + '</td>'
                + '<td class="num">' + row.mc + '</td>'
                + '<td class="num">' + row.text + '</td>'
                + (hasPct ? '<td class="num">' + esc(row.pctN ? formatAvg(row.pctSum / row.pctN, '%') : '—') + '</td>' : '')
                + (hasMarks ? '<td class="num">' + esc(row.marksN ? formatAvg(row.marksSum / row.marksN) : '—') + '</td>' : '')
                + '</tr>';
        }).join('');
        var expand = '';
        if (sorted.length > topN) {
            if (showAll) {
                expand = '<button type="button" class="btn btn-secondary btn-sm stats-detail-expand" data-detail-expand="0">只顯示前 ' + topN + ' 項</button>';
            } else {
                expand = '<button type="button" class="btn btn-outline-primary btn-sm stats-detail-expand" data-detail-expand="1">展開全部（' + sorted.length + '）</button>';
            }
        }
        return ''
            + '<div class="stats-detail-section" data-detail-section-block="' + esc(dimId) + '">'
            + '<div class="stats-detail-section-head">'
            + '<h4>' + esc(STAT_TABS[dimId].label) + '</h4>'
            + '<span class="stats-detail-section-meta">' + sorted.length + ' 項'
            + (showAll || sorted.length <= topN ? '' : ' · 顯示前 ' + visible.length)
            + '</span></div>'
            + '<div class="stats-detail-table-wrap"><table class="stats-detail-table"><thead>' + head + '</thead><tbody>'
            + body + '</tbody></table></div>'
            + expand
            + '</div>';
    }

    function renderDetailModalBody() {
        if (!detailSession) return;
        var body = document.getElementById('stats-detail-body');
        var title = document.getElementById('stats-detail-title');
        if (!body) return;
        var prefs = detailSession.prefs;
        var parentDim = detailSession.tabId;
        var cfg = STAT_TABS[parentDim];
        if (title) title.textContent = (cfg ? cfg.label : parentDim) + ' · ' + detailSession.titleValue;

        var sortCountActive = prefs.sortMode !== 'natural';
        var sectionIds = listDetailSectionIds().filter(function (id) {
            return isDetailSectionVisible(id, parentDim, prefs);
        });

        var sectionsHtml = sectionIds.map(function (id) {
            return renderDetailSectionHtml(id, detailSession.breakdowns[id] || [], prefs);
        }).filter(Boolean).join('');

        body.innerHTML = ''
            + '<div class="stats-detail-toolbar">'
            + '  <span class="stats-detail-toolbar-label">排序</span>'
            + '  <div class="stats-mode-toggle" role="group" aria-label="明細排序">'
            + '    <button type="button" class="stats-mode-btn' + (sortCountActive ? ' is-active' : '') + '" data-detail-sort="count" aria-pressed="' + (sortCountActive ? 'true' : 'false') + '">題數</button>'
            + '    <button type="button" class="stats-mode-btn' + (!sortCountActive ? ' is-active' : '') + '" data-detail-sort="natural" aria-pressed="' + (!sortCountActive ? 'true' : 'false') + '">項目順序</button>'
            + '  </div>'
            + '  <div class="stats-detail-sections-wrap">'
            + '    <button type="button" class="btn btn-secondary btn-sm" id="stats-detail-sections-btn">顯示項目 ▾</button>'
            + '    <div class="stats-detail-sections-panel" id="stats-detail-sections-panel" hidden>'
            + buildDetailSectionsPanelHtml(parentDim, prefs, detailSession.breakdowns)
            + '    </div>'
            + '  </div>'
            + '  <button type="button" class="btn btn-secondary btn-sm" data-detail-expand="' + (prefs.expandAll ? '0' : '1') + '">'
            + (prefs.expandAll ? '收合長列表' : '預設展開全部')
            + '  </button>'
            + '</div>'
            + '<p class="stats-detail-hint">點選明細列可跳到「題目」（套用目前統計篩選 + 此卡片條件 + 該列條件）。底部「查看題目」只套用此卡片條件。設定會保存在此瀏覽器。</p>'
            + '<div class="stats-detail-section">'
            + '<div class="stat-details">'
            + '<div>符合目前統計篩選的題目：<strong>' + detailSession.matchedCount + '</strong></div>'
            + '<div>平均答對率：<strong>' + esc(formatAvg(detailSession.avgPct, '%')) + '</strong>（' + detailSession.pctN + ' 題有資料）</div>'
            + '<div>平均分數：<strong>' + esc(formatAvg(detailSession.avgMarks)) + '</strong>（' + detailSession.marksN + ' 題有資料）</div>'
            + '</div></div>'
            + (sectionsHtml || '<p class="empty-state">沒有可顯示的明細（可在「顯示項目」勾選其他維度）。</p>');

        var jumpBtn = document.getElementById('stats-detail-jump');
        if (jumpBtn) {
            jumpBtn.onclick = function () {
                closeStatsDetailModal();
                jumpStatsRowToQuestions(detailSession.tabId, detailSession.rawValue);
            };
        }
    }

    async function openStatsDetailModal(tabId, rawValue) {
        ensureDetailOverlay();
        var cfg = STAT_TABS[tabId];
        if (!cfg || !window.storage) return;
        var all = await window.storage.getQuestions();
        var filtered = questionsMatchingStatsFilters(tabId, all);
        var matched = filtered.filter(function (q) {
            return cfg.valuesOf(q).some(function (v) {
                return String(v == null ? '' : v).trim() === String(rawValue).trim();
            });
        });

        var pcts = [];
        var marks = [];
        matched.forEach(function (q) {
            if (q.correctPercentage != null && q.correctPercentage !== '' && !isNaN(Number(q.correctPercentage))) {
                pcts.push(Number(q.correctPercentage));
            }
            if (q.marks != null && q.marks !== '' && !isNaN(Number(q.marks))) {
                marks.push(Number(q.marks));
            }
        });

        var prefs = loadDetailPrefs();
        var breakdowns = {};
        listDetailSectionIds().forEach(function (id) {
            if (id === tabId || !STAT_TABS[id]) return;
            // Skip optional dims with no values in this matched set (and bank-wide unused).
            if (STAT_TABS[id].optional) {
                var any = matched.some(function (q) {
                    return valuesForAxis(q, id).length > 0;
                });
                if (!any) return;
            }
            breakdowns[id] = metricBreakdown(matched, id, matched.length);
        });

        detailSession = {
            tabId: tabId,
            rawValue: rawValue,
            titleValue: axisLabelPlain(rawValue, tabId),
            matchedCount: matched.length,
            avgPct: mean(pcts),
            pctN: pcts.length,
            avgMarks: mean(marks),
            marksN: marks.length,
            breakdowns: breakdowns,
            prefs: prefs
        };

        renderDetailModalBody();
        detailOverlay.hidden = false;
    }

    function closeStatsDetailModal() {
        if (detailOverlay) detailOverlay.hidden = true;
        var panel = document.getElementById('stats-detail-sections-panel');
        if (panel) panel.hidden = true;
    }

    async function jumpDetailRowToQuestions(parentDim, parentVal, childDim, childVal) {
        closeStatsDetailModal();
        await jumpCrosstabCellToQuestions(parentDim, parentVal, childDim, childVal);
    }

    async function ensureCrosstabPanel() {
        var host = document.getElementById('stats-crosstab-panel');
        if (!host) return;
        var questions = [];
        try {
            if (window.storage && typeof window.storage.getQuestions === 'function') {
                questions = await window.storage.getQuestions();
            }
        } catch (e) {
            questions = [];
        }
        var axisOptions = (typeof buildStatDimensionOptionsHtml === 'function')
            ? buildStatDimensionOptionsHtml(null, questions)
            : Object.keys(STAT_TABS || {}).map(function (id) {
                return '<option value="' + esc(id) + '">' + esc(STAT_TABS[id].label) + '</option>';
            }).join('');
        var metricOptions = CROSSTAB_METRICS.map(function (m) {
            return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>';
        }).join('');
        host.innerHTML = ''
            + '<div class="stats-crosstab-controls">'
            + '  <label>列（Row）<select id="ct-row" data-ct-row>' + axisOptions + '</select></label>'
            + '  <label>欄（Column）<select id="ct-col" data-ct-col>' + axisOptions + '</select></label>'
            + '  <label>指標<select id="ct-metric" data-ct-metric>' + metricOptions + '</select></label>'
            + '  <button type="button" class="btn btn-secondary btn-sm" id="ct-swap">⇄ 交換列／欄</button>'
            + '  <div class="stats-crosstab-presets">'
            + CROSSTAB_PRESETS.map(function (p, i) {
                return '<button type="button" class="btn btn-outline-primary btn-sm" data-ct-preset="' + i + '">' + esc(p.label) + '</button>';
            }).join('')
            + '  </div>'
            + '</div>'
            + '<p class="stats-crosstab-note">多值欄位（如概念、題型、分題表現）：一題可計入多格。點選有數字的儲存格可跳到「題目」並套用對應篩選。答對率／分數／題號以區間分組；年份種類與有／無分題為衍生維度。不含 AI解釋 分組。</p>'
            + '<div id="ct-table-host" class="stats-crosstab-scroll"></div>';
        var rowEl = document.getElementById('ct-row');
        var colEl = document.getElementById('ct-col');
        var metricEl = document.getElementById('ct-metric');
        if (rowEl) {
            if (STAT_TABS[crosstabState.row]) rowEl.value = crosstabState.row;
            else if (rowEl.options.length) crosstabState.row = rowEl.value;
        }
        if (colEl) {
            if (STAT_TABS[crosstabState.col]) colEl.value = crosstabState.col;
            else if (colEl.options.length) crosstabState.col = colEl.value;
        }
        if (metricEl) metricEl.value = crosstabState.metric;
    }

    function sortAxisKeys(keys, axisId) {
        var copy = keys.slice();
        var cfg = STAT_TABS[axisId];
        if (cfg && cfg.binOrder) {
            var order = cfg.binOrder;
            return copy.sort(function (a, b) {
                var ia = order.indexOf(a);
                var ib = order.indexOf(b);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
        }
        if (axisId === 'topics' && typeof CURRICULUM_ORDER !== 'undefined') {
            return copy.sort(function (a, b) {
                var ia = CURRICULUM_ORDER.indexOf(typeof getCurriculumSortKey === 'function' ? getCurriculumSortKey(a) : a);
                var ib = CURRICULUM_ORDER.indexOf(typeof getCurriculumSortKey === 'function' ? getCurriculumSortKey(b) : b);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
        }
        if (axisId === 'chapters') {
            return copy.sort(function (a, b) {
                return (parseInt(String(a).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b).replace(/\D/g, ''), 10) || 0);
            });
        }
        if (axisId === 'year') {
            return copy.sort(function (a, b) {
                var na = parseInt(a, 10);
                var nb = parseInt(b, 10);
                if (!isNaN(na) && !isNaN(nb)) return nb - na;
                return String(b).localeCompare(String(a), 'zh-HK');
            });
        }
        return copy.sort(function (a, b) { return String(a).localeCompare(String(b), 'zh-HK'); });
    }

    function emptyCell() {
        return { count: 0, mc: 0, text: 0, pctSum: 0, pctN: 0, marksSum: 0, marksN: 0 };
    }

    function formatMetric(cell, metric) {
        if (!cell || !cell.count) return '';
        if (metric === 'count') return String(cell.count);
        if (metric === 'mc') return String(cell.mc);
        if (metric === 'text') return String(cell.text);
        if (metric === 'avgPercentage') {
            return cell.pctN ? formatAvg(cell.pctSum / cell.pctN, '%') : '—';
        }
        if (metric === 'avgMarks') {
            return cell.marksN ? formatAvg(cell.marksSum / cell.marksN) : '—';
        }
        return String(cell.count);
    }

    async function renderStatsCrosstab(gen) {
        ensureDetailOverlay();
        await ensureCrosstabPanel();
        var host = document.getElementById('ct-table-host');
        if (!host || !window.storage) return;
        var dim = getStatsActiveDimension();
        if (typeof ensureStatsFilterBar === 'function') ensureStatsFilterBar(dim);
        if (typeof gen === 'number' && typeof statsRenderIsCurrent === 'function' && !statsRenderIsCurrent(dim, gen)) return;

        var all = await window.storage.getQuestions();
        var filtered = questionsMatchingStatsFilters(dim, all);
        var rowAxis = crosstabState.row;
        var colAxis = crosstabState.col;
        var metric = crosstabState.metric;
        if (!STAT_TABS[rowAxis] || !STAT_TABS[colAxis]) {
            host.innerHTML = '<p class="empty-state">請選擇有效的列／欄維度。</p>';
            return;
        }
        var matrix = {};
        var rowSet = {};
        var colSet = {};

        filtered.forEach(function (q) {
            var rows = valuesForAxis(q, rowAxis);
            var cols = valuesForAxis(q, colAxis);
            if (!rows.length || !cols.length) return;
            rows.forEach(function (r) {
                rowSet[r] = true;
                cols.forEach(function (c) {
                    colSet[c] = true;
                    var key = r + '\u0001' + c;
                    if (!matrix[key]) matrix[key] = emptyCell();
                    var cell = matrix[key];
                    cell.count += 1;
                    if (q.questionType === 'MC') cell.mc += 1;
                    else if (q.questionType === '文字題 (SQ/LQ)') cell.text += 1;
                    if (q.correctPercentage != null && q.correctPercentage !== '' && !isNaN(Number(q.correctPercentage))) {
                        cell.pctSum += Number(q.correctPercentage);
                        cell.pctN += 1;
                    }
                    if (q.marks != null && q.marks !== '' && !isNaN(Number(q.marks))) {
                        cell.marksSum += Number(q.marks);
                        cell.marksN += 1;
                    }
                });
            });
        });

        var rowKeys = sortAxisKeys(Object.keys(rowSet), rowAxis);
        var colKeys = sortAxisKeys(Object.keys(colSet), colAxis);
        if (!rowKeys.length || !colKeys.length) {
            host.innerHTML = '<p class="empty-state">目前篩選下沒有可交叉分析的資料。</p>';
            if (typeof updateStatsFilterChrome === 'function') {
                updateStatsFilterChrome(dim, { questionCount: filtered.length, rowCount: 0 });
            }
            var heading = document.getElementById('stats-heading');
            if (heading) heading.textContent = '統計 · 交叉分析';
            return;
        }

        var html = '<table class="stats-crosstab-table"><thead><tr>';
        html += '<th class="ct-corner">' + esc(axisLabelText(rowAxis)) + ' \\ ' + esc(axisLabelText(colAxis)) + '</th>';
        colKeys.forEach(function (c) {
            html += '<th title="' + esc(c) + '">' + esc(axisLabelPlain(c, colAxis)) + '</th>';
        });
        html += '</tr></thead><tbody>';
        rowKeys.forEach(function (r) {
            html += '<tr><td class="ct-rowhead" title="' + esc(r) + '">' + esc(axisLabelPlain(r, rowAxis)) + '</td>';
            colKeys.forEach(function (c) {
                var cell = matrix[r + '\u0001' + c];
                var text = formatMetric(cell, metric);
                var empty = !text;
                html += '<td class="ct-cell' + (empty ? ' is-empty' : '') + '"'
                    + ' data-ct-row-axis="' + esc(rowAxis) + '"'
                    + ' data-ct-col-axis="' + esc(colAxis) + '"'
                    + ' data-ct-row-val="' + esc(r) + '"'
                    + ' data-ct-col-val="' + esc(c) + '"'
                    + ' title="' + esc(axisLabelPlain(r, rowAxis) + ' × ' + axisLabelPlain(c, colAxis)) + '">'
                    + esc(text || '·') + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        host.innerHTML = html;

        if (typeof refreshStatsFilterVisibility === 'function') refreshStatsFilterVisibility(dim, all);
        if (typeof updateStatsFilterChrome === 'function') {
            updateStatsFilterChrome(dim, { questionCount: filtered.length, rowCount: rowKeys.length });
        }
        var headingEl = document.getElementById('stats-heading');
        if (headingEl) headingEl.textContent = '統計 · 交叉分析';
    }

    async function jumpCrosstabCellToQuestions(rowAxis, rowVal, colAxis, colVal) {
        var dim = getStatsActiveDimension();
        var state = getStatsTabState(dim);
        var tri = JSON.parse(JSON.stringify(state.triState));
        var specials = [];
        var s1 = typeof applyStatDimJumpToTri === 'function'
            ? applyStatDimJumpToTri(tri, rowAxis, rowVal)
            : null;
        var s2 = typeof applyStatDimJumpToTri === 'function'
            ? applyStatDimJumpToTri(tri, colAxis, colVal)
            : null;
        if (s1 && s1.special) specials.push(s1);
        if (s2 && s2.special) specials.push(s2);
        if (typeof finishJumpToQuestions === 'function') {
            await finishJumpToQuestions(state, tri, specials);
        }
    }

    function initStatsExplore() {
        bindStatsExploreUi();
        syncStatsDimensionControl(getStatsActiveDimension());
        setStatsViewMode(window.statsViewMode || 'browse');
    }

    window.syncStatsDimensionControl = syncStatsDimensionControl;
    window.setStatsViewMode = setStatsViewMode;
    window.openStatsDetailModal = openStatsDetailModal;
    window.closeStatsDetailModal = closeStatsDetailModal;
    window.renderStatsCrosstab = renderStatsCrosstab;
    window.initStatsExplore = initStatsExplore;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStatsExplore);
    } else {
        initStatsExplore();
    }
})();
