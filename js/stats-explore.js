// stats-explore.js
// Unified 統計 tab chrome: dimension switcher, 詳細統計 modal, 交叉分析.
// Dependencies: stats-filters.js (STAT_TABS, filters, jump), statistics.js,
// storage, constants, utils (escapeHTML).

(function () {
    'use strict';

    var detailOverlay = null;
    var crosstabState = {
        row: 'topics',
        col: 'year',
        metric: 'count'
    };

    var CROSSTAB_AXES = [
        { id: 'concepts', label: '概念', kind: 'stat' },
        { id: 'topics', label: '課程分類', kind: 'stat' },
        { id: 'chapters', label: '章節', kind: 'stat' },
        { id: 'patterns', label: '題型', kind: 'stat' },
        { id: 'stemPatterns', label: '題幹模式', kind: 'stat' },
        { id: 'publishers', label: '出版商', kind: 'stat' },
        { id: 'year', label: '年份', kind: 'year' },
        { id: 'exam', label: '考試', kind: 'exam' },
        { id: 'paper', label: '卷別', kind: 'paper' },
        { id: 'qtype', label: '題目類型', kind: 'qtype' },
        { id: 'percentageBin', label: '答對率區間', kind: 'percentageBin' },
        { id: 'marksBin', label: '分數區間', kind: 'marksBin' }
    ];

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
        { label: '概念 × 題目類型', row: 'concepts', col: 'qtype', metric: 'count' }
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

    function axisById(id) {
        for (var i = 0; i < CROSSTAB_AXES.length; i++) {
            if (CROSSTAB_AXES[i].id === id) return CROSSTAB_AXES[i];
        }
        return CROSSTAB_AXES[0];
    }

    function percentageBin(value) {
        if (value == null || value === '' || isNaN(Number(value))) return '（無答對率）';
        var n = Number(value);
        if (n < 20) return '0–20%';
        if (n < 40) return '20–40%';
        if (n < 60) return '40–60%';
        if (n < 80) return '60–80%';
        return '80–100%';
    }

    function marksBin(value) {
        if (value == null || value === '' || isNaN(Number(value))) return '（無分數）';
        var n = Number(value);
        if (n <= 2) return '0–2';
        if (n <= 5) return '3–5';
        if (n <= 10) return '6–10';
        if (n <= 15) return '11–15';
        return '16+';
    }

    function valuesForAxis(question, axisId) {
        var axis = axisById(axisId);
        if (axis.kind === 'stat' && window.STAT_TABS && STAT_TABS[axisId]) {
            return STAT_TABS[axisId].valuesOf(question).map(function (v) {
                return String(v == null ? '' : v).trim();
            }).filter(Boolean);
        }
        if (axis.kind === 'year') {
            var key = (typeof normalizeYearFilterKey === 'function')
                ? normalizeYearFilterKey(question.year)
                : String(question.year == null ? '' : question.year).trim();
            return key ? [key] : [];
        }
        if (axis.kind === 'exam') {
            var exam = String(question.examination == null ? '' : question.examination).trim();
            return exam ? [exam] : [];
        }
        if (axis.kind === 'paper') {
            var paper = String(question.paper == null ? '' : question.paper).trim();
            return paper && paper !== '-' ? [paper] : [];
        }
        if (axis.kind === 'qtype') {
            var qt = String(question.questionType == null ? '' : question.questionType).trim();
            return qt ? [qt] : [];
        }
        if (axis.kind === 'percentageBin') return [percentageBin(question.correctPercentage)];
        if (axis.kind === 'marksBin') return [marksBin(question.marks)];
        return [];
    }

    function axisLabel(value, axisId) {
        if (axisId === 'year' && typeof yearFilterLabel === 'function') {
            return yearFilterLabel(value);
        }
        if (axisId === 'chapters' && typeof statsRowPresentation === 'function') {
            var p = statsRowPresentation('chapters', value);
            return String(value) + (p.searchText && p.searchText !== value ? '' : '');
        }
        return String(value);
    }

    function syncStatsDimensionControl(dim) {
        var select = document.getElementById('stats-dimension');
        if (!select || !window.STAT_TABS) return;
        if (!select.options.length) {
            select.innerHTML = Object.keys(STAT_TABS).map(function (id) {
                return '<option value="' + esc(id) + '">' + esc(STAT_TABS[id].label) + '</option>';
            }).join('');
        }
        if (STAT_TABS[dim]) select.value = dim;
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
            ensureCrosstabPanel();
            renderStatsCrosstab();
        } else {
            var dim = getStatsActiveDimension();
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
                ensureCrosstabPanel();
                renderStatsCrosstab();
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
                    ensureCrosstabPanel();
                    renderStatsCrosstab();
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

    function countBreakdown(questions, getValues) {
        var map = {};
        questions.forEach(function (q) {
            var seen = {};
            getValues(q).forEach(function (raw) {
                var key = String(raw == null ? '' : raw).trim();
                if (!key || seen[key]) return;
                seen[key] = true;
                map[key] = (map[key] || 0) + 1;
            });
        });
        return Object.keys(map).map(function (key) {
            return { key: key, count: map[key] };
        }).sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return a.key.localeCompare(b.key, 'zh-HK');
        });
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
            + '.stats-dimension-bar select{padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
            + '.stat-card-footer{gap:8px;flex-wrap:wrap;}'
            + '.stats-detail-overlay{position:fixed;inset:0;z-index:12400;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.5);}'
            + '.stats-detail-overlay[hidden]{display:none!important;}'
            + '.stats-detail-dialog{width:min(720px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.2);}'
            + '.stats-detail-header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e7eef5;}'
            + '.stats-detail-header h3{margin:0;font-size:18px;}'
            + '.stats-detail-close{width:34px;height:34px;border:1px solid #e0e0e0;border-radius:8px;background:#fff;font-size:20px;cursor:pointer;}'
            + '.stats-detail-body{flex:1;min-height:0;overflow:auto;padding:14px 16px;}'
            + '.stats-detail-section{margin-bottom:16px;}'
            + '.stats-detail-section h4{margin:0 0 8px;font-size:14px;}'
            + '.stats-detail-table{width:100%;border-collapse:collapse;font-size:13px;}'
            + '.stats-detail-table th,.stats-detail-table td{padding:6px 8px;border-bottom:1px solid #eef2f7;text-align:left;}'
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

        detailOverlay.addEventListener('click', function (event) {
            if (event.target === detailOverlay) closeStatsDetailModal();
        });
        detailOverlay.querySelector('.stats-detail-close').addEventListener('click', closeStatsDetailModal);
        detailOverlay.querySelector('#stats-detail-close-btn').addEventListener('click', closeStatsDetailModal);
        return detailOverlay;
    }

    async function openStatsDetailModal(tabId, rawValue) {
        ensureDetailOverlay();
        var cfg = STAT_TABS[tabId];
        if (!cfg || !window.storage) return;
        var all = await window.storage.getQuestions();
        var filtered = questionsMatchingStatsFilters(tabId, all);
        var presentation = statsRowPresentation(tabId, rawValue);
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

        var yearRows = countBreakdown(matched, function (q) {
            var key = (typeof normalizeYearFilterKey === 'function')
                ? normalizeYearFilterKey(q.year)
                : String(q.year || '').trim();
            return key ? [key] : [];
        });
        var examRows = countBreakdown(matched, function (q) {
            var exam = String(q.examination || '').trim();
            return exam ? [exam] : [];
        });
        var paperRows = countBreakdown(matched, function (q) {
            var paper = String(q.paper || '').trim();
            return paper && paper !== '-' ? [paper] : [];
        });
        var typeRows = countBreakdown(matched, function (q) {
            var qt = String(q.questionType || '').trim();
            return qt ? [qt] : [];
        });
        var pctBinRows = countBreakdown(matched, function (q) { return [percentageBin(q.correctPercentage)]; });
        var marksBinRows = countBreakdown(matched, function (q) { return [marksBin(q.marks)]; });

        function sectionHtml(title, rows, labelFn) {
            if (!rows.length) return '';
            return ''
                + '<div class="stats-detail-section">'
                + '<h4>' + esc(title) + '</h4>'
                + '<table class="stats-detail-table"><thead><tr><th>項目</th><th>題數</th></tr></thead><tbody>'
                + rows.slice(0, 40).map(function (row) {
                    var label = labelFn ? labelFn(row.key) : row.key;
                    return '<tr><td>' + esc(label) + '</td><td>' + row.count + '</td></tr>';
                }).join('')
                + '</tbody></table></div>';
        }

        var body = document.getElementById('stats-detail-body');
        var title = document.getElementById('stats-detail-title');
        if (title) title.textContent = cfg.label + ' · ' + String(rawValue);
        body.innerHTML = ''
            + '<div class="stats-detail-section">'
            + '<div class="stat-details">'
            + '<div>符合目前統計篩選的題目：<strong>' + matched.length + '</strong></div>'
            + '<div>平均答對率：<strong>' + formatAvg(mean(pcts), '%') + '</strong>（' + pcts.length + ' 題有資料）</div>'
            + '<div>平均分數：<strong>' + formatAvg(mean(marks)) + '</strong>（' + marks.length + ' 題有資料）</div>'
            + '</div></div>'
            + sectionHtml('年份', yearRows, function (k) {
                return typeof yearFilterLabel === 'function' ? yearFilterLabel(k) : k;
            })
            + sectionHtml('考試', examRows)
            + sectionHtml('卷別', paperRows)
            + sectionHtml('題目類型', typeRows)
            + sectionHtml('答對率分布', pctBinRows)
            + sectionHtml('分數分布', marksBinRows);

        var jumpBtn = document.getElementById('stats-detail-jump');
        jumpBtn.onclick = function () {
            closeStatsDetailModal();
            jumpStatsRowToQuestions(tabId, rawValue);
        };

        detailOverlay.hidden = false;
    }

    function closeStatsDetailModal() {
        if (detailOverlay) detailOverlay.hidden = true;
    }

    function ensureCrosstabPanel() {
        var host = document.getElementById('stats-crosstab-panel');
        if (!host) return;
        var axisOptions = CROSSTAB_AXES.map(function (axis) {
            return '<option value="' + esc(axis.id) + '">' + esc(axis.label) + '</option>';
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
            + '<p class="stats-crosstab-note">多值欄位（如概念、題型）：一題可計入多格。點選有數字的儲存格可跳到「題目」並套用對應篩選。答對率／分數以區間分組。</p>'
            + '<div id="ct-table-host" class="stats-crosstab-scroll"></div>';
        var rowEl = document.getElementById('ct-row');
        var colEl = document.getElementById('ct-col');
        var metricEl = document.getElementById('ct-metric');
        if (rowEl) rowEl.value = crosstabState.row;
        if (colEl) colEl.value = crosstabState.col;
        if (metricEl) metricEl.value = crosstabState.metric;
    }

    function sortAxisKeys(keys, axisId) {
        var copy = keys.slice();
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
        if (axisId === 'percentageBin') {
            var order = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%', '（無答對率）'];
            return copy.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
        }
        if (axisId === 'marksBin') {
            var mOrder = ['0–2', '3–5', '6–10', '11–15', '16+', '（無分數）'];
            return copy.sort(function (a, b) { return mOrder.indexOf(a) - mOrder.indexOf(b); });
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
        ensureCrosstabPanel();
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
        html += '<th class="ct-corner">' + esc(axisById(rowAxis).label) + ' \\ ' + esc(axisById(colAxis).label) + '</th>';
        colKeys.forEach(function (c) {
            html += '<th title="' + esc(c) + '">' + esc(axisLabel(c, colAxis)) + '</th>';
        });
        html += '</tr></thead><tbody>';
        rowKeys.forEach(function (r) {
            html += '<tr><td class="ct-rowhead" title="' + esc(r) + '">' + esc(axisLabel(r, rowAxis)) + '</td>';
            colKeys.forEach(function (c) {
                var cell = matrix[r + '\u0001' + c];
                var text = formatMetric(cell, metric);
                var empty = !text;
                html += '<td class="ct-cell' + (empty ? ' is-empty' : '') + '"'
                    + ' data-ct-row-axis="' + esc(rowAxis) + '"'
                    + ' data-ct-col-axis="' + esc(colAxis) + '"'
                    + ' data-ct-row-val="' + esc(r) + '"'
                    + ' data-ct-col-val="' + esc(c) + '"'
                    + ' title="' + esc(axisLabel(r, rowAxis) + ' × ' + axisLabel(c, colAxis)) + '">'
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

    function applyAxisFilterToTri(tri, axisId, rawValue) {
        if (axisId === 'percentageBin' || axisId === 'marksBin') {
            return { special: axisId, value: rawValue };
        }
        if (STAT_TABS[axisId]) {
            var cfg = STAT_TABS[axisId];
            var presentation = statsRowPresentation(axisId, rawValue);
            if (!tri[cfg.groupKey]) tri[cfg.groupKey] = {};
            tri[cfg.groupKey][presentation.filterValue] = 'checked';
            return null;
        }
        if (axisId === 'year') {
            if (!tri.year) tri.year = {};
            tri.year[rawValue] = 'checked';
            return null;
        }
        if (axisId === 'exam') {
            if (!tri.exam) tri.exam = {};
            tri.exam[rawValue] = 'checked';
            return null;
        }
        if (axisId === 'paper') {
            if (!tri.paper) tri.paper = {};
            tri.paper[rawValue] = 'checked';
            return null;
        }
        if (axisId === 'qtype') {
            if (!tri.qtype) tri.qtype = {};
            tri.qtype[rawValue] = 'checked';
            return null;
        }
        return null;
    }

    function applyBinRange(stateKey, binValue) {
        if (stateKey === 'percentage') {
            var pctMap = {
                '0–20%': { min: 0, max: 20 },
                '20–40%': { min: 20, max: 40 },
                '40–60%': { min: 40, max: 60 },
                '60–80%': { min: 60, max: 80 },
                '80–100%': { min: 80, max: 100 }
            };
            var p = pctMap[binValue];
            if (!p) return;
            window.percentageFilter = { min: p.min, max: p.max, active: true };
            return;
        }
        if (stateKey === 'marks') {
            var marksMap = {
                '0–2': { min: 0, max: 2 },
                '3–5': { min: 3, max: 5 },
                '6–10': { min: 6, max: 10 },
                '11–15': { min: 11, max: 15 },
                '16+': { min: 16, max: 30 }
            };
            var m = marksMap[binValue];
            if (!m) return;
            window.marksFilter = { min: m.min, max: m.max, active: true };
        }
    }

    function jumpCrosstabCellToQuestions(rowAxis, rowVal, colAxis, colVal) {
        var dim = getStatsActiveDimension();
        var state = getStatsTabState(dim);
        var tri = JSON.parse(JSON.stringify(state.triState));
        var specials = [];
        var s1 = applyAxisFilterToTri(tri, rowAxis, rowVal);
        var s2 = applyAxisFilterToTri(tri, colAxis, colVal);
        if (s1) specials.push(s1);
        if (s2) specials.push(s2);

        window.triStateFilters = tri;
        window.filterLogic = {
            curriculum: state.logic.curriculum || 'OR',
            chapter: state.logic.chapter || 'OR'
        };
        window.percentageFilter = Object.assign({ min: 0, max: 100, active: false }, state.percentage);
        window.marksFilter = Object.assign({ min: 0, max: 30, active: false }, state.marks);
        window.questionNumberFilter = Object.assign(
            { min: (typeof QNUM_MIN_STATS !== 'undefined' ? QNUM_MIN_STATS : 1), max: (typeof QNUM_MAX_STATS !== 'undefined' ? QNUM_MAX_STATS : 60), active: false },
            state.qnum
        );

        specials.forEach(function (spec) {
            if (spec.special === 'percentageBin') applyBinRange('percentage', spec.value);
            if (spec.special === 'marksBin') applyBinRange('marks', spec.value);
        });

        if (typeof syncQuestionRangeWidgets === 'function') syncQuestionRangeWidgets();
        var curriculumToggle = document.getElementById('curriculum-logic-toggle');
        if (curriculumToggle) curriculumToggle.checked = window.filterLogic.curriculum === 'AND';
        var chapterToggle = document.getElementById('chapter-logic-toggle');
        if (chapterToggle) chapterToggle.checked = window.filterLogic.chapter === 'AND';
        if (typeof syncQuestionSearchFromStats === 'function') syncQuestionSearchFromStats(state);
        else {
            var searchEl = document.getElementById('search');
            if (searchEl) searchEl.value = '';
        }

        if (window.paginationState && window.paginationState.questions) {
            window.paginationState.questions.page = 1;
        }
        if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
        if (typeof switchTab === 'function') switchTab('questions');
        if (typeof filterQuestions === 'function') filterQuestions();
        if (typeof scrollToTop === 'function') scrollToTop();
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
