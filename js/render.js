// Render questions
// Dependencies: storage-core.js (storage), storage-filters.js (applyFilters),
// globals.js (paginationState, triStateFilters, window.percentageFilter,
// window.marksFilter, window.questionNumberFilter), pagination.js (updatePaginationInfo,
// generatePagination), admin.js (isAdminMode), utils.js (escapeHTML,
// copyToClipboard, toggleQuestionText), sort.js, constants.js
// (CURRICULUM_ORDER, CURRICULUM_DISPLAY, SECTION_DISPLAY_NAMES)
//
// SECURITY: every Sheet-sourced field interpolated into HTML goes through
// escapeHTML() — body text, attribute values, and tag labels alike.
// URL fields (imageChi / imageEng / AIExplanation) are additionally
// restricted to http(s) schemes to block javascript: URL injection.

// ==========================================
// Tag Visibility
// ==========================================
if (typeof window.showQuestionTags === 'undefined') {
    window.showQuestionTags = true;
}

window.toggleTags = function(checkbox) {
    window.showQuestionTags = checkbox.checked;
    renderQuestions(); // Re-render immediately
};
// ==========================================

// Only allow http/https URLs from the Sheet (blocks javascript: etc.)
function renderOriginalBadge(paths, label) {
    if (!paths || paths === '-' || typeof paths !== 'string') return '';
    const list = paths.split(',').map(p => p.trim()).filter(p => p && !/^[a-z]+:/i.test(p) && !p.includes('..'));
    if (!list.length) return '';
    const encoded = encodeURIComponent(list.join(','));
    return `<button type="button" class="ai-btn" data-action="original" data-images="${encoded}" title="開啟${label}原卷圖片" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 8px; border-radius: 15px; background-color: #eff6ff; border: 1px solid #93c5fd; margin-left: 8px; font-size: 0.85em; cursor: pointer; color: #2563eb; font-weight: bold;">${label}</button>`;
}

function openOriginalImages(encoded) {
    const list = decodeURIComponent(encoded).split(',').filter(Boolean);
    let overlay = document.getElementById('original-image-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'original-image-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:3000;overflow:auto;padding:24px;';
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="max-width:920px;margin:0 auto;background:#fff;border-radius:12px;padding:16px;">
        <div style="text-align:right;margin-bottom:8px;"><button type="button" id="original-image-close" class="btn btn-cancel">關閉</button></div>
        ${list.map(src => `<img src="${escapeHTML(src)}" alt="" style="width:100%;margin-bottom:12px;border:1px solid #e5e7eb;">`).join('')}
    </div>`;
    document.getElementById('original-image-close').onclick = () => overlay.remove();
}

function safeHttpUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

async function renderQuestions() {
    const filters = {
        search: document.getElementById('search').value,
        searchScope: window.searchScope || 'all',
        triState: triStateFilters,
        percentageFilter: window.percentageFilter,
        marksFilter: window.marksFilter,
        questionNumberFilter: window.questionNumberFilter
    };

    let questions = await storage.getQuestions(filters);

    // Get sort order and apply sorting
    const sortSelect = document.getElementById('sort-order');
    const sortBy = sortSelect ? sortSelect.value : 'default';
    questions = sortQuestions(questions, sortBy);

    const currentPage = paginationState.questions.page;
    const itemsPerPage = paginationState.questions.itemsPerPage;

    const totalPages = itemsPerPage === -1 ? 1 : Math.max(1, Math.ceil(questions.length / itemsPerPage));
    const paginatedQuestions = itemsPerPage === -1 ? questions : questions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    updatePaginationInfo(currentPage, questions.length, itemsPerPage);
    generatePagination(currentPage, totalPages);

    const renderImageButtons = (urls, lang) => {
        if (!urls || urls === '-' || typeof urls !== 'string') return '';

        // Split by comma, trim, drop empties AND drop non-http(s) URLs
        const urlArray = urls.split(',').map(u => u.trim()).map(safeHttpUrl).filter(u => u);
        if (urlArray.length === 0) return '';

        const label = lang === 'chi' ? 'ZH' : 'EN';
        const titlePrefix = lang === 'chi' ? '原題圖片 (中文)' : '原題圖片 (英文)';

        return urlArray.map((url, index) => {
            const displayLabel = urlArray.length > 1 ? `${label}${index + 1}` : label;
            const displayTitle = urlArray.length > 1 ? `${titlePrefix} - P.${index + 1}` : titlePrefix;

            return `
                <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="ai-btn" title="${escapeHTML(displayTitle)}" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 15px; background-color: #eff6ff; border: 1px solid #93c5fd; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1); margin-left: 8px; font-size: 0.85em; transition: all 0.2s; cursor: pointer; color: #2563eb; font-weight: bold;">
                    ${displayLabel}
                </a>
            `;
        }).join('');
    };

    document.getElementById('question-count').textContent = `總題目數: ${questions.length}`;

    const grid = document.getElementById('question-grid');

    if (questions.length === 0) {
        grid.innerHTML = '<p style="text-align: center; padding: 40px; color: #7f8c8d;">未找到題目</p>';
        return;
    }

    // Helper function to determine tag style based on filter state
    const getTagStyle = (category, value) => {
        const isChecked = triStateFilters[category] && triStateFilters[category][value] === 'checked';
        return isChecked
            ? 'cursor:pointer; background-color: #e3f2fd; border: 1px solid #2196f3; color: #1565c0; font-weight: 600;'
            : 'cursor:pointer; color:var(--secondary-color);';
    };

    // Helper function to render collapsible text sections (Answers/Reports)
    const diagramSrcs = (q) => (q.inlineDiagrams || '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s && !s.includes('..') && !/^[a-z]+:/i.test(s));

    const renderInlineText = (content, images) => {
        let parts = content.split(/\[圖：[^\]]*\]/);
        let marks = content.match(/\[圖：[^\]]*\]/g) || [];
        if (!marks.length && images.length) {
            const lines = content.split('\n');
            const at = lines.findIndex(line => /圖/.test(line));
            const cut = at === -1 ? 0 : at + 1;
            const before = lines.slice(0, cut).join('\n');
            const after = lines.slice(cut).join('\n');
            return escapeHTML(before)
                + images.map(src => `<img class="inline-diagram" src="${escapeHTML(src)}" alt="圖">`).join('')
                + escapeHTML(after);
        }
        let html = '';
        let used = 0;
        parts.forEach((part, i) => {
            html += escapeHTML(part);
            if (i < marks.length) {
                const src = images[used];
                if (src) {
                    const alt = marks[i].slice(2, -1);
                    html += `<img class="inline-diagram" src="${escapeHTML(src)}" alt="${escapeHTML(alt)}">`;
                    used += 1;
                } else {
                    html += escapeHTML(marks[i]);
                }
            }
        });
        while (used < images.length) {
            html += `<img class="inline-diagram" src="${escapeHTML(images[used])}" alt="圖">`;
            used += 1;
        }
        return html;
    };

    const renderCollapsibleSection = (label, content, images) => {
        if (!content || content.trim() === '' || content === '-') return '';

        const pics = images || [];
        const escapedContent = escapeHTML(content.trim());
        const body = pics.length ? renderInlineText(content.trim(), pics) : escapedContent;
        const open = pics.length > 0;

        return `
            <div class="question-text">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                    <button class="expand-btn" title="${open ? '收起' : '展開/收起'}">${open ? '▼' : '▶'}</button>
                    <strong style="flex: 1;">${label}</strong>
                    <button class="copy-btn" data-action="copy" title="複製" data-content="${escapedContent}">📋</button>
                </div>
                <div class="question-text-content ${open ? 'expanded' : 'collapsed'}">${body}</div>
            </div>
        `;
    };

    grid.innerHTML = paginatedQuestions.map(q => {

        // Sort curriculum classifications by CURRICULUM_ORDER
        const sortedCurriculum = q.curriculumClassification ?
            [...q.curriculumClassification].sort((a, b) => {
                const indexA = CURRICULUM_ORDER.findIndex(code => CURRICULUM_DISPLAY[code] === a);
                const indexB = CURRICULUM_ORDER.findIndex(code => CURRICULUM_DISPLAY[code] === b);
                const valA = indexA === -1 ? 999 : indexA;
                const valB = indexB === -1 ? 999 : indexB;
                return valA - valB;
            }) : [];

        // Sort chapter classifications numerically
        const sortedChapters = q.AristochapterClassification ?
            [...q.AristochapterClassification].sort((a, b) => {
                const getNum = (str) => {
                    const match = str.match(/(\d+)/);
                    return match ? parseInt(match[0], 10) : 9999;
                };
                return getNum(a) - getNum(b);
            }) : [];

        // --- PRE-GENERATE HTML FOR CLASSIFICATIONS TO GROUP THEM ---

        let classificationHtml = '';
        const hasClassifications = window.showQuestionTags && (
            sortedCurriculum.length > 0 ||
            sortedChapters.length > 0 ||
            (q.concepts && q.concepts.length > 0) ||
            (q.patterns && q.patterns.length > 0) ||
            (q.stemPatterns && q.stemPatterns.length > 0)
        );

        if (hasClassifications) {
            classificationHtml += `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #e0e0e0; display: flex; flex-wrap: wrap; gap: 15px; row-gap: 8px; align-items: baseline;">`;

            // 1. Curriculum
            if (sortedCurriculum.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">課程:</strong>
                        ${sortedCurriculum.map(c => `
                            <span class="tag clickable-tag" data-action="filter" data-type="curriculum" data-value="${escapeHTML(c)}" style="${getTagStyle('curriculum', c)}">
                                ${escapeHTML(c)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            // 2. Chapters
            if (sortedChapters.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">Chapter:</strong>
                        ${sortedChapters.map(c => {
                            const match = c.match(/(\d+)/);
                            const val = match ? match[0] : c;
                            const displayLabel = c.replace(/^(Ch|Chapter)\s*/i, '');
                            return `
                            <span class="tag clickable-tag" data-action="filter" data-type="chapter" data-value="${escapeHTML(val)}" style="${getTagStyle('chapter', val)}">
                                ${escapeHTML(displayLabel)}
                            </span>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            // 3. Concepts
            if (q.concepts && q.concepts.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">概念:</strong>
                        ${q.concepts.map(c => `
                            <span class="tag clickable-tag" data-action="filter" data-type="concepts" data-value="${escapeHTML(c)}" style="${getTagStyle('concepts', c)}">
                                ${escapeHTML(c)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            // 4. Patterns
            if (q.patterns && q.patterns.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">題型:</strong>
                        ${q.patterns.map(p => `
                            <span class="tag clickable-tag" data-action="filter" data-type="patterns" data-value="${escapeHTML(p)}" style="${getTagStyle('patterns', p)}">
                                ${escapeHTML(p)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            // 5. Stem patterns
            if (q.stemPatterns && q.stemPatterns.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">題幹模式:</strong>
                        ${q.stemPatterns.map(p => `
                            <span class="tag clickable-tag" data-action="filter" data-type="stemPatterns" data-value="${escapeHTML(p)}" style="${getTagStyle('stemPatterns', p)}">
                                ${escapeHTML(p)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            classificationHtml += `</div>`;
        }

        const sectionDisplay = typeof SECTION_DISPLAY_NAMES !== 'undefined' && SECTION_DISPLAY_NAMES[q.section]
            ? SECTION_DISPLAY_NAMES[q.section]
            : q.section;

        const aiUrl = safeHttpUrl(q.AIExplanation);

        return `
        <div class="question-card">
            <div class="question-header">
                <div class="question-title">
                    ${escapeHTML(q.id)}
                    ${renderImageButtons(q.imageChi, 'chi')}
                    ${renderImageButtons(q.imageEng, 'eng')}
                    ${renderOriginalBadge(q.originalQuestionImage, '原題')}
                    ${renderOriginalBadge(q.originalQuestionImageEng, '英題')}
                    ${renderOriginalBadge(q.originalAnswerImage, '答案')}
                    ${renderOriginalBadge(q.originalAnswerImageEng, '英答案')}
                    ${renderOriginalBadge(q.originalReportImage, '報告')}
                    ${renderOriginalBadge(q.originalReportImageEng, '英報告')}
                    ${aiUrl ? `
                        <a href="${escapeHTML(aiUrl)}" target="_blank" rel="noopener noreferrer" class="ai-btn" title="AI 詳解" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background-color: #e3f2fd; border: 1px solid #90caf9; margin-left: 8px; font-size: 1.2em; transition: all 0.2s; cursor: pointer;">
                            🤖
                        </a>
                    ` : ''} 
                </div>
                <div class="question-badges">
                    ${q.reviewedByAI === 'Y' ? `<span class="badge" title="上次覆核 ${escapeHTML(q.lastReviewDate || '')}">AI已覆核</span>` : `<span class="badge" title="尚未人工覆核">未覆核</span>`}
                    ${q.publisher && q.publisher !== '-' ? `<span class="badge" style="cursor: pointer;" data-action="filter" data-type="publisher" data-value="${escapeHTML(q.publisher)}" title="點擊以篩選此出版商">${escapeHTML(q.publisher)}</span>` : ''}
                    ${q.year && q.year !== '-' ? `<span class="badge badge-year" style="cursor: pointer;" data-action="filter" data-type="year" data-value="${escapeHTML(q.year)}" title="點擊以篩選此年份">${escapeHTML(/^\d{1,3}$/.test(String(q.year).trim()) ? `MT${String(q.year).trim()}` : q.year)}</span>` : ''}
                    ${q.questionType && q.questionType !== '-' ? `<span class="badge badge-type" style="cursor: pointer;" data-action="filter" data-type="qtype" data-value="${escapeHTML(q.questionType)}" title="點擊以篩選此題型">${escapeHTML(q.questionType)}</span>` : ''}
                    ${q.marks > 0 ? `<span class="badge badge-marks" style="cursor: pointer;" data-action="filter-marks" data-value="${q.marks}" title="點擊以篩選此分數">${q.marks}分</span>` : ''}
                    ${q.section && q.section !== '-' ? `<span class="badge badge-section" style="cursor: pointer;" data-action="filter" data-type="section" data-value="${escapeHTML(q.section)}" title="點擊以篩選此部分">${escapeHTML(sectionDisplay)}</span>` : ''}
                </div>
            </div>
            
            <div class="question-content">
                ${(q.topic && q.topic !== '-') ? `
                    <div class="info-item" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <strong>課題：</strong>
                        <span class="tag">${escapeHTML(q.topic)}</span>
                    </div>
                ` : ''}
                ${renderCollapsibleSection('純文字：', q.plainText || q.questionTextChi, diagramSrcs(q))}
                ${renderCollapsibleSection('Question:', q.questionTextEng)}

                ${(q.answerMC && q.answerMC !== '-') ? `
                    <div class="info-item" style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                        <strong>答案：</strong> 
                        <span style="font-weight: bold; color: #2c3e50;">${escapeHTML(q.answerMC)}</span>
                    </div>
                ` : ''}

                ${renderCollapsibleSection('答案：', q.answerChi)}
                ${renderCollapsibleSection('Answer:', q.answerEng)}

                ${renderCollapsibleSection('評卷報告：', q.markersReportChi)}
                ${renderCollapsibleSection('Markers Report:', q.markersReportEng)}

                <div class="question-info">             
                    ${q.correctPercentage !== null && q.correctPercentage !== undefined ? `<div class="info-item"><strong>答對率：</strong> ${escapeHTML(q.correctPercentage)}%</div>` : ''}

                    ${(window.showQuestionTags && q.graphType && q.graphType !== '-') ? `
                        <div class="info-item">
                            <strong>圖表：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="graph" data-value="${escapeHTML(q.graphType)}" style="${getTagStyle('graph', q.graphType)}">
                                ${escapeHTML(q.graphType)}
                            </span>
                        </div>
                    ` : ''}
                    
                    ${(window.showQuestionTags && q.tableType && q.tableType !== '-') ? `
                        <div class="info-item">
                            <strong>表格：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="table" data-value="${escapeHTML(q.tableType)}" style="${getTagStyle('table', q.tableType)}">
                                ${escapeHTML(q.tableType)}
                            </span>
                        </div>
                    ` : ''}
                    
                    ${(window.showQuestionTags && q.calculationType && q.calculationType !== '-') ? `
                        <div class="info-item">
                            <strong>計算：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="calculation" data-value="${escapeHTML(q.calculationType)}" style="${getTagStyle('calculation', q.calculationType)}">
                                ${escapeHTML(q.calculationType)}
                            </span>
                        </div>
                    ` : ''}

                    ${(window.showQuestionTags && q.multipleSelectionType && q.multipleSelectionType !== '-') ? `
                        <div class="info-item">
                            <strong>複選：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="multipleSelection" data-value="${escapeHTML(q.multipleSelectionType)}" style="${getTagStyle('multipleSelection', q.multipleSelectionType)}">
                                ${escapeHTML(q.multipleSelectionType)}
                            </span>
                        </div>
                    ` : ''}                    
                </div>
                
                ${classificationHtml}
                
            </div>
            
            ${isAdminMode ? `
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button class="btn btn-warning" data-action="edit" data-id="${escapeHTML(q.id)}">編輯</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${escapeHTML(q.id)}">刪除</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');
}

// Copy every question that matches the current filters, in the current sort
// order. Pagination is ignored. A large set asks for confirmation first
// because the clipboard text includes full stems and answers.
const COPY_CONFIRM_THRESHOLD = 50;

function answerTextForCopy(q) {
    const letter = q.answerMC && q.answerMC !== '-' ? String(q.answerMC).trim() : '';
    const written = q.answerChi && q.answerChi !== '-' ? String(q.answerChi).trim() : '';
    if (letter && written) {
        return written.includes(letter) ? written : `${letter}\n${written}`;
    }
    return letter || written || '（沒有答案）';
}

async function copyFilteredQuestions() {
    const searchEl = document.getElementById('search');
    const filters = {
        search: searchEl ? searchEl.value : '',
        searchScope: window.searchScope || 'all',
        triState: triStateFilters,
        percentageFilter: window.percentageFilter,
        marksFilter: window.marksFilter,
        questionNumberFilter: window.questionNumberFilter
    };

    let questions = await storage.getQuestions(filters);
    const sortSelect = document.getElementById('sort-order');
    const sortBy = sortSelect ? sortSelect.value : 'default';
    questions = sortQuestions(questions, sortBy);

    const button = document.getElementById('copy-filtered-btn');
    if (questions.length === 0) {
        alert('沒有符合篩選條件的題目可複製。');
        return;
    }
    if (questions.length > COPY_CONFIRM_THRESHOLD) {
        const ok = confirm(`現時篩選有 ${questions.length} 題。複製後剪貼簿會包含每題的全文和答案，內容可能很長。確定要複製嗎？`);
        if (!ok) return;
    }

    const text = questions.map(q => {
        const question = (q.plainText || q.questionTextChi || '').trim();
        return `${question}\n${answerTextForCopy(q)}`;
    }).join('\n\n');

    copyToClipboard(text, button);
}