// Copy to clipboard function
// Dependencies: None

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = '✓';
        button.style.backgroundColor = '#27ae60';

        setTimeout(() => {
            button.innerHTML = originalText;
            button.style.backgroundColor = '';
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('複製失敗，請手動複製');
    });
}

// Toggle question text expand/collapse
// Dependencies: None
function toggleQuestionText(button) {
    const textContent = button.parentElement.nextElementSibling;
    const isCollapsed = textContent.classList.contains('collapsed');

    if (isCollapsed) {
        textContent.classList.remove('collapsed');
        textContent.classList.add('expanded');
        button.innerHTML = '▼';
        button.title = '收起';
    } else {
        textContent.classList.remove('expanded');
        textContent.classList.add('collapsed');
        button.innerHTML = '▶';
        button.title = '展開';
    }
}

// HTML escaping for security.
// HARDENED: now coerces non-string input (numbers, etc.) to String —
// previously escapeHTML(q.id) threw a TypeError when id was numeric
// (IndexedDB autoIncrement keys), which silently broke rendering.
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Attribute-only escaping (kept for use by template-form.js / admin code).
function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;');
}

// Populate chapter filter options dynamically
// Dependencies: constants.js (CHAPTER_RANGE, CHAPTER_DESCRIPTIONS)
function populateChapterFilter() {
    const container = document.getElementById('chapter-list');

    if (!container) {
        console.warn('Element #chapter-list not found. Make sure HTML is updated.');
        return;
    }

    let html = '';
    for (let i = CHAPTER_RANGE.min; i <= CHAPTER_RANGE.max; i++) {
        const chNumber = String(i).padStart(2, '0');
        const chName = (typeof CHAPTER_DESCRIPTIONS !== 'undefined' && CHAPTER_DESCRIPTIONS[chNumber])
            ? CHAPTER_DESCRIPTIONS[chNumber]
            : '';

        html += `
            <div class="tri-state-checkbox chapter-item" 
                 data-filter="chapter" 
                 data-value="${chNumber}" 
                 onclick="toggleTriState(this)"
                 ${chName ? `title="${escapeHTML(chNumber + ': ' + chName)}"` : ''}>
                <span class="ch-num">${chNumber}</span>${chName ? `<span class="ch-name">${escapeHTML(chName)}</span>` : ''}
            </div>`;
    }

    container.innerHTML = html;
}

// Populate curriculum filter options dynamically
// Dependencies: constants.js (CURRICULUM_ITEMS)
function populateCurriculumFilter() {
    const container = document.getElementById('curriculum-list');
    const fallbackContainer = document.getElementById('curriculum-options');

    const target = container || fallbackContainer;
    if (!target) return;

    let html = '';
    CURRICULUM_ITEMS.forEach(item => {
        html += `
            <div class="tri-state-label" onclick="toggleTriState(this)" data-filter="curriculum" data-value="${escapeHTML(item)}">
                <div class="tri-state-checkbox" data-filter="curriculum" data-value="${escapeHTML(item)}">
                    <span>${escapeHTML(item)}</span>
                </div>
            </div>
        `;
    });

    target.innerHTML = html;
}

// Populate feature filter options dynamically
// Dependencies: constants.js (FEATURE_ITEMS), globals.js (triStateFilters)
function populateFeatureFilter() {
    const container = document.getElementById('feature-options');
    if (!container) return;

    let html = '';
    FEATURE_ITEMS.forEach(item => {
        const state = (window.triStateFilters && window.triStateFilters.feature)
            ? window.triStateFilters.feature[item]
            : null;

        let labelClass = 'tri-state-label';
        let checkboxClass = 'tri-state-checkbox';
        if (state === 'checked') { labelClass += ' checked'; checkboxClass += ' checked'; }
        else if (state === 'excluded') { labelClass += ' excluded'; checkboxClass += ' excluded'; }

        html += `
            <div class="${labelClass}" onclick="toggleTriState(this)" data-filter="feature" data-value="${escapeHTML(item)}">
                <div class="${checkboxClass}" data-filter="feature" data-value="${escapeHTML(item)}">
                    <span>${escapeHTML(item)}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Populate curriculum form options (for the Add/Edit form)
// Dependencies: constants.js (CURRICULUM_ITEMS)
function populateCurriculumFormOptions() {
    const container = document.querySelector('#curriculum-form-options .options-list');
    if (!container) return;

    container.innerHTML = CURRICULUM_ITEMS.map(item => `
        <label><input type="checkbox" value="${escapeHTML(item)}" onchange="syncCurriculumFormInput()"> ${escapeHTML(item)}</label>
    `).join('');
}

// Show/hide the curriculum checkbox panel in the Add/Edit form
function toggleCurriculumFormOptions() {
    const panel = document.getElementById('curriculum-form-options');
    if (panel) panel.classList.toggle('hidden');
}

// Write checked curriculum items into the comma-separated text input
function syncCurriculumFormInput() {
    const container = document.querySelector('#curriculum-form-options .options-list');
    const input = document.getElementById('curriculum-classification');
    if (!container || !input) return;

    const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
    input.value = selected.join(', ');
}

// Scroll to top
// Dependencies: None
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 切換篩選條件顯示/隱藏
// The wrapper uses overflow:hidden + max-height for the collapse
// animation. After the expand animation completes, overflow is switched
// to 'visible' so floating dropdowns can escape the wrapper; switched
// back to 'hidden' right before collapsing so the animation still works.
function toggleFiltersPanel() {
    const wrapper = document.getElementById('collapsible-filters-wrapper');
    const btn = document.getElementById('toggle-filters-btn');
    if (!wrapper || !btn) return;

    const isCollapsed = wrapper.style.maxHeight === '0px' ||
                        wrapper.style.maxHeight === '0' ||
                        wrapper.style.maxHeight === '';

    if (isCollapsed) {
        // 展開
        wrapper.style.maxHeight = '2000px'; // 確保大於內容高度
        wrapper.style.opacity = '1';
        wrapper.style.marginTop = '15px';
        btn.innerHTML = '🔽 隱藏篩選條件';

        clearTimeout(wrapper._overflowTimer);
        wrapper._overflowTimer = setTimeout(() => {
            wrapper.style.overflow = 'visible';
        }, 320);
    } else {
        // 收合 — re-clip first so the max-height animation looks correct
        clearTimeout(wrapper._overflowTimer);
        wrapper.style.overflow = 'hidden';
        wrapper.style.maxHeight = '0px';
        wrapper.style.opacity = '0';
        wrapper.style.marginTop = '0';
        btn.innerHTML = '▶️ 顯示篩選條件';
    }
}

// Generic debounce (single source of truth — main.js's duplicate removed)
function debounce(fn, delay = 250) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}