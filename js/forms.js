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
    renderQuestionPartRows([]);
}

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
    return questions.some(q => 
        q.examination === formData.examination &&
        q.year === formData.year &&
        q.section === formData.section &&
        q.questionNumber === formData.questionNumber &&
        q.id !== window.editingId // Don't count self when editing
    );
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

        // Safely get AI Explanation value if the input exists in the DOM
        const aiExplanationInput = document.getElementById('ai-explanation');
        const aiExplanationValue = aiExplanationInput ? aiExplanationInput.value.trim() : '';

        const question = {
            id: window.editingId || document.getElementById('question-id').value.trim(),
            publisher: document.getElementById('publisher').value.trim(),
            examination: document.getElementById('examination').value,
            year: document.getElementById('year').value.trim(),
            paper: document.getElementById('paper').value.trim(),
            questionType: document.getElementById('question-type').value,
            marks: parseFloat(document.getElementById('marks').value) || 0,
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
            correctPercentage: parseFloat(document.getElementById('correct-percentage').value) || null,
            markersReportChi: document.getElementById('markers-report-chi').value.trim(),
            markersReportEng: document.getElementById('markers-report-eng').value.trim(),
            curriculumClassification: document.getElementById('curriculum-classification').value.split(',').map(s => s.trim()).filter(s => s),
            AristochapterClassification: document.getElementById('chapter-classification').value.split(',').map(s => s.trim()).filter(s => s),
            concepts: document.getElementById('concepts').value.split(',').map(s => s.trim()).filter(s => s),
            patterns: document.getElementById('patterns').value.split(',').map(s => s.trim()).filter(s => s),
            stemPatterns: document.getElementById('stemPatterns').value.split(',').map(s => s.trim()).filter(s => s),
            optionDesign: document.getElementById('option-design').value.trim(),
            AIExplanation: aiExplanationValue,
            remarks: document.getElementById('remarks').value.trim(),
            questionParts: readQuestionPartsFromForm(),
            dateAdded: window.editingId ? null : new Date().toISOString(),
            dateModified: new Date().toISOString()
        };
        
        if (!question.id) {
            alert('請輸入題目 ID');
            return;
        }

        if (!question.year) {
            alert('請輸入年份');
            return;
        }

        const invalidCurriculum = question.curriculumClassification.filter(item => !CURRICULUM_ITEMS.includes(item));
        if (invalidCurriculum.length) {
            alert('課程分類包含不在清單中的項目：' + invalidCurriculum.join('、'));
            document.getElementById('curriculum-classification').focus();
            return;
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
    document.getElementById('year').value = question.year;
    document.getElementById('paper').value = question.paper || '';
    document.getElementById('question-type').value = question.questionType;
    document.getElementById('marks').value = question.marks || '';
    document.getElementById('section').value = question.section || '';
    document.getElementById('question-number').value = question.questionNumber || '';
    document.getElementById('question-text-chi').value = question.questionTextChi || '';
    document.getElementById('question-text-eng').value = question.questionTextEng || '';
    // Don't show '-' in the form, leave it empty
    document.getElementById('multiple-selection-type').value = question.multipleSelectionType === '-' ? '' : (question.multipleSelectionType || '');
    document.getElementById('graph-type').value = question.graphType === '-' ? '' : (question.graphType || '');
    document.getElementById('table-type').value = question.tableType === '-' ? '' : (question.tableType || '');
    document.getElementById('calculation-type').value = question.calculationType === '-' ? '' : (question.calculationType || '');
    document.getElementById('correct-percentage').value = question.correctPercentage || '';
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
    // Safely populate AI Explanation if input exists
    const aiExplanationInput = document.getElementById('ai-explanation');
    if (aiExplanationInput) {
        aiExplanationInput.value = question.AIExplanation || '';
    }
    document.getElementById('remarks').value = question.remarks || '';
    renderQuestionPartRows(question.questionParts || []);
    
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
