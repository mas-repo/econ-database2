// template-header.js
// Generates the page header (title, storage status, sync & admin buttons)
// Dependencies: None (pure HTML string generator)

function renderHeaderTemplate() {
    return `
    <header>
        <div id="storage-status">檢查資料庫...</div>
        <h1>📚 HKDSE 經濟科題目資料庫</h1>
        <p>管理及搜尋 HKDSE、HKCEE、HKALE 經濟科試題</p>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; align-items: center;">
            <button class="btn btn-info" onclick="manualSync()">🔄 重新載入資料</button>
            <button class="btn btn-info" onclick="toggleAdminMode()" style="opacity: 0.3;">🔒 管理員模式</button>
            <span id="admin-status"></span>
            <button id="logout-btn" class="btn" onclick="logout()">🚪 登出</button>
        </div>
    </header>`;
}