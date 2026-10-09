// bulk-edit.js
// Admin-only bulk edit modal: one table row per question from the current
// filtered 題目 list. Edit Chapters, curriculumClassification, marks, and
// questionParts; save only changed rows after confirm + validation.
//
// Visibility: .btn-admin-only (isAdminMode). Also gated on accessRights.admin.
// Does not invent auto-upload; after save calls maybeAutoSyncQuestions like
// the single form (honours existing 自動同步 preference).
//
// Dependencies: question-fields.js, constants.js (CURRICULUM_ITEMS),
// storage, gatherFilterState / getQuestions, showNotification, refreshViews.

(function () {
    'use strict';

    var BULK_EDIT_MAX_ROWS = 300;
    var overlay = null;
    var draftRows = []; // { original, fingerprint }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function canUseBulkEdit() {
        return !!(window.accessRights && window.accessRights.admin === true &&
            typeof isAdminMode !== 'undefined' && isAdminMode);
    }

    function partsToCompact(parts) {
        if (typeof serializeQuestionPartsCompact === 'function') {
            return serializeQuestionPartsCompact(parts);
        }
        return '';
    }

    function compactToParts(text) {
        if (typeof parseQuestionPartsCompact === 'function') {
            return parseQuestionPartsCompact(text);
        }
        return [];
    }

    function listToComma(list) {
        return (Array.isArray(list) ? list : []).map(function (item) {
            return String(item == null ? '' : item).trim();
        }).filter(Boolean).join(', ');
    }

    function commaToList(text) {
        return String(text == null ? '' : text).split(',')
            .map(function (item) { return item.trim(); })
            .filter(Boolean);
    }

    function fingerprintEditable(question) {
        return JSON.stringify({
            chapters: listToComma(question.AristochapterClassification),
            curriculum: listToComma(question.curriculumClassification),
            marks: question.marks == null ? 0 : Number(question.marks),
            parts: partsToCompact(question.questionParts)
        });
    }

    async function loadFilteredQuestions() {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') {
            return [];
        }
        var filters = typeof gatherFilterState === 'function'
            ? gatherFilterState()
            : {};
        var questions = await window.storage.getQuestions(filters);
        if (!Array.isArray(questions)) return [];
        var sortSelect = document.getElementById('sort-order');
        var sortBy = sortSelect ? sortSelect.value : 'default';
        if (typeof sortQuestions === 'function') {
            questions = sortQuestions(questions, sortBy);
        }
        return questions;
    }

    function rowHtml(question, index) {
        var id = String(question.id != null ? question.id : '');
        var chapters = listToComma(question.AristochapterClassification);
        var curriculum = listToComma(question.curriculumClassification);
        var marks = question.marks == null || question.marks === '' ? '' : String(question.marks);
        var parts = partsToCompact(question.questionParts);
        return ''
            + '<tr data-bulk-index="' + index + '" data-question-id="' + escapeHtml(id) + '">'
            + '  <td class="be-id">' + escapeHtml(id || '（無編號）') + '</td>'
            + '  <td><input type="text" data-be-chapters value="' + escapeHtml(chapters) + '" placeholder="Ch01, Ch02" autocomplete="off"></td>'
            + '  <td><input type="text" data-be-curriculum value="' + escapeHtml(curriculum) + '" placeholder="A 基本經濟概念, …" autocomplete="off"></td>'
            + '  <td><input type="number" data-be-marks min="0" step="0.5" value="' + escapeHtml(marks) + '" style="width:5.5em;"></td>'
            + '  <td><input type="text" data-be-parts value="' + escapeHtml(parts) + '" placeholder="a,2,良好 | b,3,優良" autocomplete="off"></td>'
            + '</tr>';
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'bulk-edit-overlay';
        overlay.className = 'be-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="be-dialog" role="dialog" aria-modal="true" aria-labelledby="be-title">'
            + '  <div class="be-header">'
            + '    <div class="be-header-text">'
            + '      <h2 id="be-title">批量編輯</h2>'
            + '      <p class="be-subtitle">載入目前篩選結果（每題一列）。可改 Chapters、課程分類、總分與分題；只儲存有變更的列。有分題時各分分數合計必須等於總分。</p>'
            + '    </div>'
            + '    <button type="button" class="be-close" aria-label="關閉">×</button>'
            + '  </div>'
            + '  <div class="be-toolbar">'
            + '    <span id="be-status" class="be-status"></span>'
            + '    <button type="button" class="btn btn-secondary btn-sm" id="be-reload">重新載入篩選結果</button>'
            + '  </div>'
            + '  <div class="be-body">'
            + '    <table class="be-table">'
            + '      <thead><tr>'
            + '        <th>題目 ID</th>'
            + '        <th>Chapters</th>'
            + '        <th>課程分類</th>'
            + '        <th>總分</th>'
            + '        <th>分題（標籤,分數,表現 | …）</th>'
            + '      </tr></thead>'
            + '      <tbody id="be-tbody"></tbody>'
            + '    </table>'
            + '  </div>'
            + '  <div class="be-footer">'
            + '    <button type="button" class="btn btn-secondary" id="be-cancel">關閉</button>'
            + '    <button type="button" class="btn btn-primary" id="be-save">儲存變更</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(overlay);

        var style = document.createElement('style');
        style.id = 'bulk-edit-styles';
        style.textContent = ''
            + '.be-overlay{position:fixed;inset:0;z-index:12500;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);}'
            + '.be-overlay[hidden]{display:none!important;}'
            + '.be-dialog{display:flex;flex-direction:column;width:min(1100px,100%);max-height:calc(100vh - 24px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 18px 48px rgba(15,23,42,.22);color:var(--text-color,#2c3e50);}'
            + '.be-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px 14px;border-bottom:1px solid var(--border-light,#e0e0e0);background:#fff;}'
            + '.be-header-text{flex:1;min-width:0;}'
            + '.be-header h2{margin:0 0 6px;font-size:20px;line-height:1.3;}'
            + '.be-subtitle{margin:0;color:var(--text-light,#7f8c8d);font-size:13px;line-height:1.5;}'
            + '.be-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--border-light,#e0e0e0);border-radius:8px;background:#fff;color:var(--text-light,#7f8c8d);font-size:20px;line-height:1;cursor:pointer;}'
            + '.be-close:hover{background:var(--light-bg,#ecf0f1);color:var(--text-color,#2c3e50);}'
            + '.be-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border-light,#e0e0e0);background:#fff;}'
            + '.be-status{color:var(--text-light,#7f8c8d);font-size:13px;}'
            + '.be-body{flex:1;min-height:0;overflow:auto;padding:0;background:#f4f7fb;}'
            + '.be-table{width:100%;border-collapse:collapse;background:#fff;font-size:13px;}'
            + '.be-table th,.be-table td{padding:8px 10px;border-bottom:1px solid #e7eef5;vertical-align:top;text-align:left;}'
            + '.be-table th{position:sticky;top:0;background:#f8fafc;z-index:1;font-weight:700;color:var(--primary-color,#2c3e50);}'
            + '.be-table input[type="text"],.be-table input[type="number"]{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d7e3ef;border-radius:6px;font:inherit;}'
            + '.be-id{white-space:nowrap;font-weight:600;}'
            + '.be-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border-light,#e0e0e0);background:#fff;}'
            + '@media (max-width:800px){.be-table{font-size:12px}.be-table th:nth-child(5),.be-table td:nth-child(5){min-width:12em}}';
        document.head.appendChild(style);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeBulkEditModal();
        });
        overlay.querySelector('.be-close').addEventListener('click', closeBulkEditModal);
        overlay.querySelector('#be-cancel').addEventListener('click', closeBulkEditModal);
        overlay.querySelector('#be-reload').addEventListener('click', function () {
            populateBulkEditTable();
        });
        overlay.querySelector('#be-save').addEventListener('click', function () {
            saveBulkEditChanges();
        });
        return overlay;
    }

    function setStatus(text) {
        var node = document.getElementById('be-status');
        if (node) node.textContent = text || '';
    }

    function readRowFromDom(tr, original) {
        var chapters = commaToList(tr.querySelector('[data-be-chapters]').value);
        var curriculum = commaToList(tr.querySelector('[data-be-curriculum]').value);
        var marksRaw = tr.querySelector('[data-be-marks]').value;
        var marksNum = parseFloat(String(marksRaw).trim());
        if (String(marksRaw).trim() === '' || isNaN(marksNum) || !isFinite(marksNum)) {
            marksNum = 0;
        }
        var parts = compactToParts(tr.querySelector('[data-be-parts]').value);
        return {
            id: original.id,
            AristochapterClassification: chapters,
            curriculumClassification: curriculum,
            marks: marksNum,
            questionParts: parts
        };
    }

    async function populateBulkEditTable() {
        if (!canUseBulkEdit()) {
            closeBulkEditModal();
            return;
        }
        ensureOverlay();
        var tbody = document.getElementById('be-tbody');
        setStatus('載入中…');
        tbody.innerHTML = '';
        draftRows = [];
        var questions = await loadFilteredQuestions();
        if (!questions.length) {
            setStatus('目前篩選結果沒有題目。');
            return;
        }
        if (questions.length > BULK_EDIT_MAX_ROWS) {
            setStatus('篩選結果有 ' + questions.length + ' 題；一次最多載入 ' + BULK_EDIT_MAX_ROWS + ' 題。請收窄篩選後再試。');
            questions = questions.slice(0, BULK_EDIT_MAX_ROWS);
        }
        draftRows = questions.map(function (question) {
            return {
                original: question,
                fingerprint: fingerprintEditable(question)
            };
        });
        tbody.innerHTML = draftRows.map(function (row, index) {
            return rowHtml(row.original, index);
        }).join('');
        setStatus('已載入 ' + draftRows.length + ' 題（目前篩選結果）。分題格式：a,2,良好 | b,3,優良');
    }

    function collectChangedUpdates() {
        var tbody = document.getElementById('be-tbody');
        var updates = [];
        var errors = [];
        if (!tbody) return { updates: updates, errors: errors };

        tbody.querySelectorAll('tr[data-bulk-index]').forEach(function (tr) {
            var index = parseInt(tr.getAttribute('data-bulk-index'), 10);
            var draft = draftRows[index];
            if (!draft) return;
            var edited = readRowFromDom(tr, draft.original);
            var nextFingerprint = fingerprintEditable(edited);
            if (nextFingerprint === draft.fingerprint) return;

            var invalidCurriculum = edited.curriculumClassification.filter(function (item) {
                return typeof CURRICULUM_ITEMS === 'undefined' || !CURRICULUM_ITEMS.includes(item);
            });
            if (invalidCurriculum.length) {
                errors.push('題目「' + edited.id + '」課程分類包含不在清單中的項目：' + invalidCurriculum.join('、'));
                return;
            }

            if (typeof validatePartMarksSum === 'function') {
                var marksCheck = validatePartMarksSum(edited);
                if (!marksCheck.ok) {
                    errors.push(marksCheck.error);
                    return;
                }
            }

            var merged = Object.assign({}, draft.original, {
                AristochapterClassification: edited.AristochapterClassification,
                curriculumClassification: edited.curriculumClassification,
                marks: edited.marks,
                questionParts: edited.questionParts,
                dateModified: new Date().toISOString()
            });
            updates.push(merged);
        });

        return { updates: updates, errors: errors };
    }

    async function saveBulkEditChanges() {
        if (!canUseBulkEdit()) {
            window.alert('請先進入管理員模式。');
            return;
        }
        if (!window.storage || typeof window.storage.updateQuestion !== 'function') {
            window.alert('資料庫尚未就緒。');
            return;
        }

        var collected = collectChangedUpdates();
        if (collected.errors.length) {
            window.alert('無法儲存：\n\n' + collected.errors.join('\n'));
            return;
        }
        if (!collected.updates.length) {
            if (typeof showNotification === 'function') {
                showNotification('沒有變更需要儲存', 'info');
            } else {
                window.alert('沒有變更需要儲存');
            }
            return;
        }

        var ids = collected.updates.map(function (q) { return q.id; });
        var confirmMsg = '即將更新 ' + collected.updates.length + ' 題：\n\n'
            + ids.slice(0, 20).join('\n')
            + (ids.length > 20 ? '\n…（其餘 ' + (ids.length - 20) + ' 題）' : '')
            + '\n\n只寫入本機題庫；不會自動上傳（除非已開啟自動同步）。確定？';
        if (!window.confirm(confirmMsg)) return;

        setStatus('正在儲存 ' + collected.updates.length + ' 題…');
        try {
            for (var i = 0; i < collected.updates.length; i++) {
                await window.storage.updateQuestion(collected.updates[i]);
            }
            if (typeof refreshViews === 'function') await refreshViews();
            if (typeof maybeAutoSyncQuestions === 'function') {
                await maybeAutoSyncQuestions();
            }
            if (typeof showNotification === 'function') {
                showNotification('已更新 ' + collected.updates.length + ' 題', 'success');
            }
            await populateBulkEditTable();
        } catch (error) {
            console.error(error);
            window.alert('儲存失敗：' + (error && error.message ? error.message : '未知錯誤'));
            setStatus('儲存失敗');
        }
    }

    async function openBulkEditModal() {
        if (!(window.accessRights && window.accessRights.admin === true)) {
            window.alert('沒有管理員權限。');
            return;
        }
        if (typeof isAdminMode === 'undefined' || !isAdminMode) {
            window.alert('請先開啟管理員模式。');
            return;
        }
        ensureOverlay();
        overlay.hidden = false;
        document.body.classList.add('be-open');
        await populateBulkEditTable();
    }

    function closeBulkEditModal() {
        if (overlay) overlay.hidden = true;
        document.body.classList.remove('be-open');
    }

    window.openBulkEditModal = openBulkEditModal;
    window.closeBulkEditModal = closeBulkEditModal;
})();
