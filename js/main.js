/* ============================================
   Main Application Initialization
   ============================================ */

// Dependencies: auth.js, storage-core.js, render.js, filters.js,
// statistics.js, utils.js (debounce), filter-modal.js (closeFilterModal)

// Logout function
function logout() {
    if (confirm('確定要離開系統嗎？')) {
        window.authManager.logout();
    }
}

// Initialize application
async function init() {
    console.log('🚀 初始化應用程式...');

    // Safety check: ensure authManager exists
    if (!window.authManager) {
        console.error('❌ AuthManager not initialized!');
        alert('系統錯誤：認證模組未載入，請重新整理頁面');
        return;
    }    

    // Check if user is authenticated (from cookie)
    if (!window.authManager.isAuthenticated()) {
        console.log('❌ 未驗證，顯示驗證視窗');
        showLoginModal(); // This is defined in auth.js
        return; // Stop initialization until user logs in
    }
    
    console.log('✅ 使用者已驗證:', window.authManager.displayName);

    if (typeof logQuestionToolLogin === 'function') {
        logQuestionToolLogin();
    }
    
    // Update UI to show logged-in user
    updateUserDisplay();
    
    // Show loading state
    showLoadingState(true);
    
    // Initialize storage
    window.storage = new IndexedDBStorage();
    
    try {
        await window.storage.init();
        console.log('✅ IndexedDB 已初始化');
    } catch (error) {
        console.error('Failed to initialize storage:', error);
        updateStorageStatus('disconnected', '✗ 資料庫初始化失敗');
        showLoadingState(false);
        return; // Stop if storage fails
    }
    
    // Load the bundled question JSON (replaces Google Sheets sync).
    if (window.questionJsonSource) {
        try {
            console.log('📥 開始從 JSON 載入資料...');
            updateStorageStatus('loading', '⏳ 載入資料中...');
            const result = await window.questionJsonSource.syncOnLoad();
            
            if (result.success) {
                console.log('✅ JSON 資料載入完成');
                console.log(`📊 載入 ${result.count} 題`);
                updateStorageStatus('connected', `✓ 資料載入完成`);
            }
        } catch (error) {
            console.error('Failed to load JSON:', error);
            console.warn('⚠️ JSON 載入失敗:', error.message);
            updateStorageStatus('disconnected', '✗ JSON 載入失敗');
        }
    }
    
    // Initialize UI components
    await initializeApp();
    
    // Hide loading state after everything is loaded
    showLoadingState(false);
    
    console.log('✅ 應用程式初始化完成');
}

// Update storage status indicator
function updateStorageStatus(status, message) {
    const statusElement = document.getElementById('storage-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = '';
        statusElement.classList.add(status);
        statusElement.style.color = status === 'connected' ? '#27ae60' : '#e74c3c';
    }
}

function updateUserDisplay() {
    // Do nothing - user info not displayed on UI
}

// Initialize app UI (called by init() and also by auth.js after login)
async function initializeApp() {
    console.log('🔧 初始化應用程式介面...');
    
    setupFormHandler();
    setupEventListeners();
    
    // Initialize percentage slider
    if (document.getElementById('min-percentage')) {
        updatePercentageRange();
    }
    
    // Initialize marks slider
    if (document.getElementById('min-marks')) {
        updateMarksRange();
    }

    // Initialize question-number slider
    if (document.getElementById('min-qnum')) {
        updateQuestionNumberRange();
    }

    // Populate the Search Scope dropdown based on loaded permissions
    if (typeof populateSearchScope === 'function') {
        populateSearchScope();
    }
     
    // Populate the dynamic filters
    if (typeof populateDynamicFilters === 'function') {
        await populateDynamicFilters();
    }    
    await renderQuestions();
    await refreshStatistics();

    if (typeof initPoeGenerateFeature === 'function') {
        initPoeGenerateFeature();
    }
    if (typeof initGitSyncFeature === 'function') {
        initGitSyncFeature();
    }
}

// Also add to refreshViews() so they update if data changes (e.g. after sync)
async function refreshViews() {
    if (typeof populateDynamicFilters === 'function') {
        await populateDynamicFilters();
    }
    await renderQuestions();
    await refreshStatistics();
}

// Show/Hide loading state
function showLoadingState(show) {
    const loadingElement = document.getElementById('loading-indicator');
    if (loadingElement) {
        loadingElement.style.display = show ? 'block' : 'none';
    }
    
    // Clear "檢查資料庫..." text when hiding loading
    if (!show) {
        const statusElement = document.getElementById('storage-status');
        if (statusElement) {
            const currentText = statusElement.textContent.trim();
            // Only clear if it's still showing the loading message
            if (currentText === '檢查資料庫...') {
                statusElement.textContent = '';
            }
        }
    }
}

// Reload questions from the bundled JSON file.
async function manualSync() {
    if (!window.questionJsonSource) {
        alert('JSON 資料來源未設定，請檢查 config.js');
        return;
    }
    
    try {
        showLoading('正在從 JSON 載入資料...');
        const result = await window.questionJsonSource.syncOnLoad();
        hideLoading();
        
        if (result.success) {
            if (typeof populateSearchScope === 'function') {
                populateSearchScope();
            }
            await refreshViews();
            alert(`✅ 載入成功！\n\n匯入 ${result.count} 題`);
            console.log('✅ JSON 資料載入完成');
        }
    } catch (error) {
        hideLoading();
        alert('❌ 載入失敗: ' + error.message);
    }
}

// Helper functions
function showLoading(message) {
    let loader = document.getElementById('loading-overlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loading-overlay';
        loader.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); display: flex;
            align-items: center; justify-content: center; z-index: 9999;
        `;
        document.body.appendChild(loader);
    }
    loader.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 10px; text-align: center;">
            <div style="font-size: 24px; margin-bottom: 15px;">⏳</div>
            <div style="font-size: 16px; color: #333;">${message}</div>
        </div>
    `;
}

function hideLoading() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.remove();
}

// Tab switching — delegates to tabs.js renderers (thin wrappers around
// the read-only renderers in statistics.js).
function switchTab(tabName, event) {
    window.currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // Fallback if event not passed
        const btn = document.querySelector(`[onclick*="switchTab('${tabName}')"]`);
        if (btn) btn.classList.add('active');
    }
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    const content = document.getElementById(`${tabName}-tab`);
    if (content) content.classList.add('active');
    
    // Render content based on tab
    if (tabName === 'publishers') {
        if (typeof renderPublishers === 'function') renderPublishers();
    } else if (tabName === 'topics') {
        if (typeof renderTopics === 'function') renderTopics();
    } else if (tabName === 'chapters') {
        if (typeof renderChapters === 'function') renderChapters();     
    } else if (tabName === 'concepts') {
        if (typeof renderConcepts === 'function') renderConcepts();
    } else if (tabName === 'patterns') {
        if (typeof renderPatterns === 'function') renderPatterns();
    } else if (tabName === 'stemPatterns') {
        if (typeof renderStemPatterns === 'function') renderStemPatterns();
    }
}

// Event listeners
function setupEventListeners() {
    // Search input — debounced (~250ms) so typing against a 1000+
    // question IndexedDB doesn't re-render on every keystroke.
    // filterQuestions() resets pagination to page 1 and refreshes
    // dropdown counts + active-filter badges, so it is the correct
    // debounced target (NOT bare renderQuestions()).
    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterQuestions, 250));
    }

    // Search Scope Listener
    const searchScope = document.getElementById('search-scope');
    if (searchScope) {
        searchScope.addEventListener('change', filterQuestions);
    }    
    
    // Scroll to top button
    window.addEventListener('scroll', () => {
        const scrollBtn = document.getElementById('scroll-to-top');
        if (scrollBtn && window.pageYOffset > 300) {
            scrollBtn.style.display = 'block';
        } else if (scrollBtn) {
            scrollBtn.style.display = 'none';
        }
    });

    // === EVENT DELEGATION LISTENER ===
    const grid = document.getElementById('question-grid');
    if (grid) {
        grid.addEventListener('click', function(event) {
            const target = event.target;

            const filterTag = target.closest('[data-action="filter"]');
            if (filterTag) {
                const type = filterTag.getAttribute('data-type');
                const value = filterTag.getAttribute('data-value');
                filterByTag(type, value);
                return;
            }

            const marksTag = target.closest('[data-action="filter-marks"]');
            if (marksTag) {
                const marks = parseInt(marksTag.getAttribute('data-value'), 10);
                filterByExactMarks(marks);
                return;
            }

            const expandBtn = target.closest('.expand-btn');
            if (expandBtn) {
                toggleQuestionText(expandBtn);
                return;
            }

            const copyBtn = target.closest('[data-action="copy"]');
            if (copyBtn) {
                const content = copyBtn.getAttribute('data-content');
                copyToClipboard(content, copyBtn); 
                return;
            }

            const editBtn = target.closest('[data-action="edit"]');
            if (editBtn) {
                const id = editBtn.getAttribute('data-id');
                editQuestion(id);
                return;
            }

            const deleteBtn = target.closest('[data-action="delete"]');
            if (deleteBtn) {
                const id = deleteBtn.getAttribute('data-id');
                deleteQuestion(id);
                return;
            }
            
            const originalBtn = target.closest('[data-action="original"]');
            if (originalBtn) {
                openOriginalImages(originalBtn.getAttribute('data-images') || '');
                return;
            }
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        populateCurriculumFilter();
        populateChapterFilter();
        populateFeatureFilter();
        populateCurriculumFormOptions();
        init();
    });
} else {
    populateCurriculumFilter();
    populateChapterFilter();
    populateFeatureFilter();
    populateCurriculumFormOptions();
    init();
}

// === Hotkey Listener ===
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (typeof isPoeGenerateModalOpen === 'function' && isPoeGenerateModalOpen()) {
            if (typeof closePoeGenerateModal === 'function') closePoeGenerateModal();
            return;
        }
        // If a filter modal is open, Esc closes it — and does NOT clear
        // the user's filters. Only a "bare" Esc clears filters.
        if (document.getElementById('mf-overlay')) {
            if (typeof closeFilterModal === 'function') closeFilterModal();
            return;
        }
        clearFilters();
    }
});