// Statistics functions
// Dependencies: storage-core.js (window.storage), constants.js (CURRICULUM_NAMES, CURRICULUM_DISPLAY, CURRICULUM_ORDER, CHAPTER_DESCRIPTIONS)

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


// Dependencies: storage-core.js (window.storage)
async function renderPublisherStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        const publisher = q.publisher || 'Unknown';
        if (!stats[publisher]) {
            stats[publisher] = { total: 0, mc: 0, text: 0 };
        }
        stats[publisher].total++;
        if (q.questionType === 'MC') stats[publisher].mc++;
        if (q.questionType === '文字題 (SQ/LQ)') stats[publisher].text++;
    });
    
    const grid = document.getElementById('publishers-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無出版社資料</p>';
        return;
    }
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([publisher, data]) => `
            <div class="stat-card">
                <h3>${publisher}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `).join('');
}

// Dependencies: storage-core.js (window.storage), constants.js (CURRICULUM_ORDER)
async function renderTopicStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        if (q.curriculumClassification && Array.isArray(q.curriculumClassification)) {
            q.curriculumClassification.forEach(topic => {
                if (!stats[topic]) {
                    stats[topic] = { total: 0, mc: 0, text: 0 };
                }
                stats[topic].total++;
                if (q.questionType === 'MC') stats[topic].mc++;
                if (q.questionType === '文字題 (SQ/LQ)') stats[topic].text++;
            });
        }
    });
    
    const grid = document.getElementById('topics-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無主題資料</p>';
        return;
    }
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => {
            // Sort by curriculum order using constants
            const keyA = getCurriculumSortKey(a[0]);
            const keyB = getCurriculumSortKey(b[0]);
            return CURRICULUM_ORDER.indexOf(keyA) - CURRICULUM_ORDER.indexOf(keyB);
        })
        .map(([topic, data]) => `
            <div class="stat-card">
                <h3>${topic}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `).join('');
}

// Dependencies: storage-core.js (window.storage), constants.js (CHAPTER_DESCRIPTIONS)
// UPDATED: Each chapter card now also shows the full chapter name from
// CHAPTER_DESCRIPTIONS (e.g. "Ch01 基本經濟概念"). Names are hidden for
// the 'Colleagues' user group, consistent with the chapter filter rule.
async function renderChapterStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        if (q.AristochapterClassification && Array.isArray(q.AristochapterClassification)) {
            q.AristochapterClassification.forEach(chapter => {
                if (!stats[chapter]) {
                    stats[chapter] = { total: 0, mc: 0, text: 0 };
                }
                stats[chapter].total++;
                if (q.questionType === 'MC') stats[chapter].mc++;
                if (q.questionType === '文字題 (SQ/LQ)') stats[chapter].text++;
            });
        }
    });
    
    const grid = document.getElementById('chapters-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無章節資料</p>';
        return;
    }
    
    // Colleagues must not see chapter names
    const showNames = !(window.authManager && window.authManager.userGroup === 'Colleagues') &&
                      typeof CHAPTER_DESCRIPTIONS !== 'undefined';
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => {
            // Sort by chapter number (Ch01, Ch02, ..., Ch29)
            const numA = parseInt(a[0].replace('Ch', ''));
            const numB = parseInt(b[0].replace('Ch', ''));
            return numA - numB;
        })
        .map(([chapter, data]) => {
            // Extract the number and look up the full name (e.g. "Ch1"/"Ch01" -> "01")
            let chapterName = '';
            if (showNames) {
                const match = String(chapter).match(/(\d+)/);
                if (match) {
                    const padded = match[1].padStart(2, '0');
                    chapterName = CHAPTER_DESCRIPTIONS[padded] || '';
                }
            }
            
            return `
            <div class="stat-card">
                <h3>${chapter}${chapterName ? ` <span style="font-weight: 400; font-size: 0.85em; color: var(--text-light);">${chapterName}</span>` : ''}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `;
        }).join('');
}

// Dependencies: storage-core.js (window.storage)
async function renderConceptStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        const concepts = Array.isArray(q.concepts) ? q.concepts : [];
        concepts.forEach(concept => {
            if (!stats[concept]) {
                stats[concept] = { total: 0, mc: 0, text: 0 };
            }
            stats[concept].total++;
            if (q.questionType === 'MC') stats[concept].mc++;
            if (q.questionType === '文字題 (SQ/LQ)') stats[concept].text++;
        });
    });
    
    const grid = document.getElementById('concepts-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無概念資料</p>';
        return;
    }
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([concept, data]) => `
            <div class="stat-card">
                <h3>${concept}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `).join('');
}

// Dependencies: storage-core.js (window.storage)
async function renderPatternStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        if (q.patterns && Array.isArray(q.patterns)) {
            q.patterns.forEach(pattern => {
                if (!stats[pattern]) {
                    stats[pattern] = { total: 0, mc: 0, text: 0 };
                }
                stats[pattern].total++;
                if (q.questionType === 'MC') stats[pattern].mc++;
                if (q.questionType === '文字題 (SQ/LQ)') stats[pattern].text++;
            });
        }
    });
    
    const grid = document.getElementById('patterns-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無題型資料</p>';
        return;
    }
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([pattern, data]) => `
            <div class="stat-card">
                <h3>${pattern}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `).join('');
}

// Dependencies: storage-core.js (window.storage)
async function renderStemPatternStats() {
    const questions = await window.storage.getQuestions();
    const stats = {};
    
    questions.forEach(q => {
        if (q.stemPatterns && Array.isArray(q.stemPatterns)) {
            q.stemPatterns.forEach(pattern => {
                if (!stats[pattern]) {
                    stats[pattern] = { total: 0, mc: 0, text: 0 };
                }
                stats[pattern].total++;
                if (q.questionType === 'MC') stats[pattern].mc++;
                if (q.questionType === '文字題 (SQ/LQ)') stats[pattern].text++;
            });
        }
    });
    
    const grid = document.getElementById('stemPatterns-grid');
    if (!grid) return;
    
    if (Object.keys(stats).length === 0) {
        grid.innerHTML = '<p class="empty-state">暫無題幹模式資料</p>';
        return;
    }
    
    grid.innerHTML = Object.entries(stats)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([pattern, data]) => `
            <div class="stat-card">
                <h3>${pattern}</h3>
                <div class="stat-details">
                    <div>總題目: ${data.total}</div>
                    <div>MC: ${data.mc}</div>
                    <div>文字題: ${data.text}</div>
                </div>
            </div>
        `).join('');
}

// Dependencies: None (calls all render functions)
async function refreshStatistics() {
    await renderPublisherStats();
    await renderTopicStats();
    await renderChapterStats();
    await renderConceptStats();
    await renderPatternStats();
    await renderStemPatternStats();
}