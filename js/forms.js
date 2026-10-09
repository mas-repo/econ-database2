// Form functions
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), main.js (refreshViews), constants.js (DEFAULT_PUBLISHER)

// Dependencies: globals.js (window.editingId), constants.js (DEFAULT_PUBLISHER)
function toggleForm() {
    const form = document.getElementById('form-section');
    const isHidden = form.classList.contains('hidden');
    
    if (isHidden) {
        form.classList.remove('hidden');
        document.getElementById('form-title').textContent = '新增題目';
        window.editingId = null;
        clearForm();
    } else {
        form.classList.add('hidden');
    }
}

// Dependencies: constants.js (DEFAULT_PUBLISHER)
function clearForm() {
    document.getElementById('question-form').reset();
    const publisherField = document.getElementById('publisher');
    if (publisherField) {
        publisherField.value = DEFAULT_PUBLISHER;
    }
    setPartsStatusRadio('pending');
    renderQuestionPartRows([]);
    syncPartsEditorVisibility();
}

function getPartsStatusRadio() {
    const checked = document.querySelector('input[name="parts-status"]:checked');
    return checked ? String(checked.value || 'pending') : 'pending';
}

function setPartsStatusRadio(status) {
    const want = String(status || 'pending');
    const inputs = document.querySelectorAll('input[name="parts-status"]');
    let matched = false;
    inputs.forEach(input => {
        const on = input.value === want;
        input.checked = on;
        if (on) matched = true;
    });
    if (!matched) {
        const pending = document.querySelector('input[name="parts-status"][value="pending"]');
        if (pending) pending.checked = true;
    }
}

function syncPartsEditorVisibility() {
    const editor = document.getElementById('question-parts-editor');
    if (!editor) return;
    const status = getPartsStatusRadio();
    const show = status === 'filled';
    editor.hidden = !show;
    editor.style.display = show ? '' : 'none';
}

function onPartsStatusChange() {
    const status = getPartsStatusRadio();
    if (status === 'none' || status === 'pending') {
        renderQuestionPartRows([]);
    } else if (status === 'filled') {
        const list = document.getElementById('question-parts-list');
        if (list && !list.querySelector('[data-question-part-row]')) {
            renderQuestionPartRows([]);
        }
    }
    syncPartsEditorVisibility();
}

window.onPartsStatusChange = onPartsStatusChange;

function partPerformanceOptionsHtml(selected) {
    const items = (typeof PART_PERFORMANCE_ITEMS !== 'undefined' && Array.isArray(PART_PERFORMANCE_ITEMS))
        ? PART_PERFORMANCE_ITEMS
        : [];
    const sel = String(selected || '');
    let html = '<option value="">（未填）</option>';
    items.forEach(item => {
        html += `<option value="${escapeHTML(item)}"${item === sel ? ' selected' : ''}>${escapeHTML(item)}</option>`;
    });
    return html;
}

function questionPartRowHtml(part) {
    const label = part && part.label != null ? part.label : '';
    const marks = part && part.marks != null && part.marks !== '' ? part.marks : '';
    const performance = part && part.performance ? part.performance : '';
    return `
        <div class="question-part-row" data-question-part-row="1" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
            <input type="text" data-part-label placeholder="分題（如 a）" value="${escapeHTML(String(label))}" style="width:5.5em;">
            <input type="number" data-part-marks min="0" step="0.5" placeholder="分數" value="${marks === '' ? '' : escapeHTML(String(marks))}" style="width:6em;">
            <select data-part-performance aria-label="分題表現">${partPerformanceOptionsHtml(performance)}</select>
            <button type="button" class="btn btn-secondary btn-sm" onclick="removeQuestionPartRow(this)" title="移除分題">✕</button>
        </div>
    `;
}

function renderQuestionPartRows(parts) {
    const list = document.getElementById('question-parts-list');
    if (!list) return;
    const rows = (typeof normalizeQuestionParts === 'function')
        ? normalizeQuestionParts(parts)
        : (Array.isArray(parts) ? parts : []);
    if (!rows.length) {
        list.innerHTML = questionPartRowHtml({});
        return;
    }
    list.innerHTML = rows.map(questionPartRowHtml).join('');
}

function addQuestionPartRow() {
    if (getPartsStatusRadio() !== 'filled') {
        setPartsStatusRadio('filled');
        syncPartsEditorVisibility();
    }
    const list = document.getElementById('question-parts-list');
    if (!list) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = questionPartRowHtml({});
    list.appendChild(wrap.firstElementChild);
}

function removeQuestionPartRow(button) {
    const list = document.getElementById('question-parts-list');
    if (!list || !button) return;
    const row = button.closest('[data-question-part-row]');
    if (!row) return;
    if (list.querySelectorAll('[data-question-part-row]').length <= 1) {
        row.querySelectorAll('input, select').forEach(el => {
            if (el.tagName === 'SELECT') el.value = '';
            else el.value = '';
        });
        return;
    }
    row.remove();
}

function readQuestionPartsFromForm() {
    const list = document.getElementById('question-parts-list');
    if (!list) return [];
    const raw = [];
    list.querySelectorAll('[data-question-part-row]').forEach(row => {
        const labelEl = row.querySelector('[data-part-label]');
        const marksEl = row.querySelector('[data-part-marks]');
        const perfEl = row.querySelector('[data-part-performance]');
        raw.push({
            label: labelEl ? labelEl.value : '',
            marks: marksEl ? marksEl.value : '',
            performance: perfEl ? perfEl.value : ''
        });
    });
    return (typeof normalizeQuestionParts === 'function') ? normalizeQuestionParts(raw) : raw;
}

window.addQuestionPartRow = addQuestionPartRow;
window.removeQuestionPartRow = removeQuestionPartRow;
window.renderQuestionPartRows = renderQuestionPartRows;

// Dependencies: globals.js (window.editingId)
function cancelEdit() {
    document.getElementById('form-section').classList.add('hidden');
    window.editingId = null;
    clearForm();
}

// Check for duplicate questions
// Dependencies: storage-core.js (window.storage)
async function checkDuplicate(formData) {
    const questions = await window.storage.getQuestions();
    const yearKey = typeof normalizeYearFilterKey === 'function'
        ? normalizeYearFilterKey(formData.year)
        : String(formData.year == null ? '' : formData.year).trim();
    return questions.some(q => {
        const qYear = typeof normalizeYearFilterKey === 'function'
            ? normalizeYearFilterKey(q.year)
            : String(q.year == null ? '' : q.year).trim();
        return q.examination === formData.examination &&
            qYear === yearKey &&
            q.section === formData.section &&
            q.questionNumber === formData.questionNumber &&
            q.id !== window.editingId; // Don't count self when editing
    });
}

// Save question
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), main.js (refreshViews)
function setupFormHandler() {
    const form = document.getElementById('question-form');
    if (!form) return;
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Auto-fill '-' for empty fields
        const multipleSelectionType = document.getElementById('multiple-selection-type').value.trim() || '-';
        const graphType = document.getElementById('graph-type').value.trim() || '-';
        const tableType = document.getElementById('table-type').value.trim() || '-';

        const marksRaw = document.getElementById('marks').value.trim();
        let marksValue = 0;
        if (marksRaw !== '') {
            marksValue = parseFloat(marksRaw);
            if (isNaN(marksValue) || !isFinite(marksValue)) {
                alert('總分必須是數字（可為 0）。');
                document.getElementById('marks').focus();
                return;
            }
        }

        const pctRaw = document.getElementById('correct-percentage').value.trim();
        let percentageValue = null;
        if (pctRaw !== '') {
            percentageValue = parseFloat(pctRaw);
            if (isNaN(percentageValue) || !isFinite(percentageValue)) {
                alert('答對率必須是數字，或留空。');
                document.getElementById('correct-percentage').focus();
                return;
            }
        }

        const question = {
            id: window.editingId || document.getElementById('question-id').value.trim(),
            publisher: document.getElementById('publisher').value.trim(),
            examination: document.getElementById('examination').value,
            year: (typeof normalizeYear === 'function')
                ? normalizeYear(document.getElementById('year').value)
                : document.getElementById('year').value.trim(),
            paper: document.getElementById('paper').value.trim(),
            questionType: document.getElementById('question-type').value,
            marks: marksValue,
            section: document.getElementById('section').value.trim(),
            questionNumber: document.getElementById('question-number').value.trim(),
            questionTextChi: document.getElementById('question-text-chi').value.trim(),
            questionTextEng: document.getElementById('question-text-eng').value.trim(),
            multipleSelectionType: multipleSelectionType,
            graphType: graphType,
            tableType: tableType,
            calculationType: document.getElementById('calculation-type').value.trim() || '-',            
            answerMC: document.getElementById('answer-mc').value.trim(),
            answerChi: document.getElementById('answer-chi').value.trim(),
            answerEng: document.getElementById('answer-eng').value.trim(),
            correctPercentage: percentageValue,
            markersReportChi: document.getElementById('markers-report-chi').value.trim(),
            markersReportEng: document.getElementById('markers-report-eng').value.trim(),
            curriculumClassification: document.getElementById('curriculum-classification').value.split(',').map(s => s.trim()).filter(s => s),
            AristochapterClassification: document.getElementById('chapter-classification').value.split(',').map(s => s.trim()).filter(s => s),
            concepts: document.getElementById('concepts').value.split(',').map(s => s.trim()).filter(s => s),
            patterns: document.getElementById('patterns').value.split(',').map(s => s.trim()).filter(s => s),
            stemPatterns: document.getElementById('stemPatterns').value.split(',').map(s => s.trim()).filter(s => s),
            optionDesign: document.getElementById('option-design').value.trim(),
            // Legacy AIExplanation URL field is unused; AI解釋 lives in
            // shared/data/ai-explanations.json. Keep empty for bank compatibility.
            AIExplanation: '',
            remarks: document.getElementById('remarks').value.trim(),
            dateAdded: window.editingId ? null : new Date().toISOString(),
            dateModified: new Date().toISOString()
        };

        const partsChoice = getPartsStatusRadio();
        const partsRaw = partsChoice === 'filled' ? readQuestionPartsFromForm() : [];
        if (typeof applyPartsFields === 'function') {
            applyPartsFields(question, partsRaw, partsChoice);
        } else {
            question.questionParts = partsRaw;
            question.partsStatus = partsChoice || 'pending';
        }

        if (partsChoice === 'filled' && !(question.questionParts && question.questionParts.length)) {
            alert('已選擇「有分題」，請至少填寫一列分題，或改為「尚未輸入」／「沒有分題」。');
            setPartsStatusRadio('filled');
            syncPartsEditorVisibility();
            return;
        }
        
        if (!question.id) {
            alert('請輸入題目 ID');
            return;
        }

        if (!question.year) {
            alert('請輸入年份');
            return;
        }

        if (typeof validateExaminationType === 'function') {
            const examCheck = validateExaminationType(question.examination, { question: question });
            if (!examCheck.ok) {
                alert(examCheck.error);
                document.getElementById('examination').focus();
                return;
            }
        }

        if (typeof validateQuestionTypeValue === 'function') {
            const qtypeCheck = validateQuestionTypeValue(question.questionType, { question: question });
            if (!qtypeCheck.ok) {
                alert(qtypeCheck.error);
                document.getElementById('question-type').focus();
                return;
            }
        }

        const invalidCurriculum = question.curriculumClassification.filter(item => !CURRICULUM_ITEMS.includes(item));
        if (invalidCurriculum.length) {
            alert('課程分類包含不在清單中的項目：' + invalidCurriculum.join('、'));
            document.getElementById('curriculum-classification').focus();
            return;
        }

        if (typeof validateChapterClassification === 'function') {
            const chapterCheck = validateChapterClassification(question.AristochapterClassification, {
                question: question
            });
            if (!chapterCheck.ok) {
                alert(chapterCheck.error);
                document.getElementById('chapter-classification').focus();
                return;
            }
        }

        if (typeof validateMarksNonNegative === 'function') {
            const marksSignCheck = validateMarksNonNegative(question);
            if (!marksSignCheck.ok) {
                alert(marksSignCheck.error);
                document.getElementById('marks').focus();
                return;
            }
        }

        if (typeof validateCorrectPercentage === 'function') {
            const pctCheck = validateCorrectPercentage(question);
            if (!pctCheck.ok) {
                alert(pctCheck.error);
                document.getElementById('correct-percentage').focus();
                return;
            }
            question.correctPercentage = pctCheck.value;
        }

        if (typeof validatePartMarksSum === 'function') {
            const marksCheck = validatePartMarksSum(question);
            if (!marksCheck.ok) {
                alert(marksCheck.error);
                document.getElementById('marks').focus();
                return;
            }
        }

        // Check for duplicates (only when adding new questions)
        if (!window.editingId) {
            // Hard block: IndexedDB keyPath is id — duplicate would throw ConstraintError.
            try {
                const allRows = (typeof window.storage.getAllQuestions === 'function')
                    ? await window.storage.getAllQuestions()
                    : await window.storage.getQuestions();
                const idTaken = (allRows || []).some(q => String(q && q.id) === String(question.id));
                if (idTaken) {
                    alert('題目 ID「' + question.id + '」已存在，請改用其他編號。');
                    document.getElementById('question-id').focus();
                    return;
                }
            } catch (dupErr) {
                console.warn('duplicate-id check failed', dupErr);
            }

            const isDuplicate = await checkDuplicate(question);
            if (isDuplicate) {
                const confirmMsg = `已存在相同的題目：\n\n` +
                                 `考試: ${question.examination}\n` +
                                 `年份: ${question.year}\n` +
                                 `Section: ${question.section}\n` +
                                 `題號: ${question.questionNumber}\n\n` +
                                 `確定要新增嗎？`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }
            // Use addQuestion for new items
            await window.storage.addQuestion(question);
        } else {
            // Use updateQuestion for existing items
            await window.storage.updateQuestion(question);
        }       

        await refreshViews();
        
        document.getElementById('form-section').classList.add('hidden');
        clearForm();
        window.editingId = null;
        if (typeof maybeAutoSyncQuestions === 'function') {
            await maybeAutoSyncQuestions();
        }
    });
}




// Edit question
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), constants.js (DEFAULT_PUBLISHER), main.js (scrollToTop)
async function editQuestion(id) {

    scrollToTop();

    const questions = await window.storage.getQuestions();
    const question = questions.find(q => q.id === id);
    
    if (!question) {
        alert('找不到題目');
        return;
    }
    
    window.editingId = id;
    
    document.getElementById('question-id').value = question.id;
    document.getElementById('publisher').value = question.publisher || DEFAULT_PUBLISHER;
    document.getElementById('examination').value = question.examination;
    document.getElementById('year').value = (typeof normalizeYear === 'function')
        ? normalizeYear(question.year)
        : (question.year || '');
    document.getElementById('paper').value = question.paper || '';
    document.getElementById('question-type').value = question.questionType;
    // Nullish only — 0 marks / 0% must populate as "0", not empty.
    document.getElementById('marks').value = (question.marks == null || question.marks === '')
        ? ''
        : String(question.marks);
    document.getElementById('section').value = question.section || '';
    document.getElementById('question-number').value = question.questionNumber || '';
    document.getElementById('question-text-chi').value = question.questionTextChi || '';
    document.getElementById('question-text-eng').value = question.questionTextEng || '';
    // Don't show '-' in the form, leave it empty
    document.getElementById('multiple-selection-type').value = question.multipleSelectionType === '-' ? '' : (question.multipleSelectionType || '');
    document.getElementById('graph-type').value = question.graphType === '-' ? '' : (question.graphType || '');
    document.getElementById('table-type').value = question.tableType === '-' ? '' : (question.tableType || '');
    document.getElementById('calculation-type').value = question.calculationType === '-' ? '' : (question.calculationType || '');
    document.getElementById('correct-percentage').value = (question.correctPercentage == null || question.correctPercentage === '')
        ? ''
        : String(question.correctPercentage);
    document.getElementById('answer-mc').value = question.answerMC || '';
    document.getElementById('answer-chi').value = question.answerChi || '';    
    document.getElementById('answer-eng').value = question.answerEng || '';    
    document.getElementById('markers-report-chi').value = question.markersReportChi || '';
    document.getElementById('markers-report-eng').value = question.markersReportEng || '';

    document.getElementById('curriculum-classification').value = (question.curriculumClassification || []).join(', ');
    if (typeof syncCurriculumFormChecks === 'function') syncCurriculumFormChecks();
    document.getElementById('chapter-classification').value = (question.AristochapterClassification || []).join(', ');
    document.getElementById('concepts').value = (question.concepts || []).join(', ');
    document.getElementById('patterns').value = (question.patterns || []).join(', ');
    document.getElementById('stemPatterns').value = (question.stemPatterns || []).join(', ');
    document.getElementById('option-design').value = question.optionDesign || '';
    document.getElementById('remarks').value = question.remarks || '';
    const partsStatus = (typeof resolvePartsStatus === 'function')
        ? resolvePartsStatus(question)
        : (question.questionParts && question.questionParts.length
            ? 'filled'
            : (question.partsStatus === 'none' ? 'none' : 'pending'));
    setPartsStatusRadio(partsStatus);
    renderQuestionPartRows(partsStatus === 'filled' ? (question.questionParts || []) : []);
    syncPartsEditorVisibility();
    
    document.getElementById('form-section').classList.remove('hidden');
    document.getElementById('form-title').textContent = '編輯題目';
}

// Delete question
// Dependencies: storage-core.js (window.storage), main.js (refreshViews)
async function deleteQuestion(id) {
    if (confirm('確定要刪除此題目？')) {
        await window.storage.deleteQuestion(id);
        await refreshViews();
        if (typeof maybeAutoSyncQuestions === 'function') {
            await maybeAutoSyncQuestions();
        }
    }
}
