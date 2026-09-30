// Import/Export Functions
// Dependencies: storage-core.js (storage), admin.js (showNotification), main.js (refreshViews)

/**
 * Export database to JSON file
 * Dependencies: storage-core.js (storage), admin.js (showNotification)
 */
async function buildQuestionExport(includeAll) {
    const source = window.storage || storage;
    const questions = includeAll && typeof source.getAllQuestions === 'function'
        ? await source.getAllQuestions()
        : await source.getQuestions();

    return {
        version: '1.0',
        exportDate: new Date().toISOString(),
        questionCount: questions.length,
        questions: questions
    };
}

async function exportJSON() {
    try {
        const exportData = await buildQuestionExport(false);
        const questions = exportData.questions;
        
        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `econ-questions-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showNotification(`✅ 成功匯出 ${questions.length} 題`, 'success');
        if (typeof maybeAutoSyncQuestions === 'function') {
            await maybeAutoSyncQuestions();
        }
    } catch (error) {
        console.error('Export failed:', error);
        showNotification('❌ 匯出失敗: ' + error.message, 'error');
    }
}

/**
 * Import database from JSON file
 * Dependencies: storage-core.js (storage), admin.js (showNotification), main.js (refreshViews)
 */
async function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            showNotification('正在匯入資料...', 'info');
            
            const text = await file.text();
            const data = JSON.parse(text);
            
            // Validate JSON structure
            if (!data.questions || !Array.isArray(data.questions)) {
                throw new Error('無效的 JSON 格式：缺少 questions 陣列');
            }
            
            // Confirm before importing
            const confirmMsg = `即將匯入 ${data.questions.length} 題\n\n` +
                              `匯出日期: ${data.exportDate ? new Date(data.exportDate).toLocaleString('zh-TW') : '未知'}\n\n` +
                              `這將會清除現有資料，確定要繼續嗎？`;
            
            if (!confirm(confirmMsg)) {
                showNotification('已取消匯入', 'info');
                return;
            }
            
            let imported = 0;
            if (window.questionJsonSource) {
                imported = await window.questionJsonSource.importPayload(data);
            } else {
                await storage.clear();
                for (const question of data.questions) {
                    try {
                        await storage.addQuestion(question);
                        imported++;
                    } catch (error) {
                        console.error('Failed to import question:', question, error);
                    }
                }
            }
            
            await refreshViews();
            
            showNotification(`✅ 成功匯入 ${imported} 題`, 'success');
            if (typeof maybeAutoSyncQuestions === 'function') {
                await maybeAutoSyncQuestions();
            }
            
        } catch (error) {
            console.error('Import failed:', error);
            showNotification('❌ 匯入失敗: ' + error.message, 'error');
        }
    };
    
    input.click();
}

/**
 * Clear entire database
 * Dependencies: storage-core.js (storage), admin.js (showNotification), main.js (refreshViews)
 */
async function clearDatabase() {
    if (!confirm('⚠️ 確定要清除所有資料？\n\n此操作無法復原！')) {
        return;
    }
    
    if (!confirm('⚠️ 請再次確認：真的要刪除所有題目嗎？\n\n建議先匯出備份！')) {
        return;
    }
    
    try {
        await storage.clear();
        await refreshViews();
        showNotification('✅ 資料庫已清空', 'success');
    } catch (error) {
        console.error('Clear database failed:', error);
        showNotification('❌ 清除失敗: ' + error.message, 'error');
    }
}

