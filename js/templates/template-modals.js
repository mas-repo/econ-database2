// template-modals.js
// Generates the Feedback modal and the shared Filter modal.
// Dependencies: None (pure HTML string generator)

function renderModalsTemplate() {
    return `
    <!-- Shared Filter Modal (used by filter-modal.js, mainly on mobile) -->
    <div id="filter-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 2000; align-items: center; justify-content: center;">
        <div style="background: white; border-radius: 12px; width: 90%; max-width: 480px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; border-bottom: 1px solid #eee;">
                <h3 id="filter-modal-title" style="margin: 0;">篩選條件</h3>
                <button onclick="closeFilterModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; line-height: 1;">×</button>
            </div>
            <div id="filter-modal-search-container" style="padding: 10px 20px; display: none;">
                <input type="text" id="filter-modal-search" placeholder="搜尋選項..." style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;">
            </div>
            <div id="filter-modal-body" style="padding: 15px 20px; overflow-y: auto; flex: 1;"></div>
            <div style="padding: 12px 20px; border-top: 1px solid #eee; text-align: right;">
                <button class="btn btn-primary" onclick="closeFilterModal()">完成</button>
            </div>
        </div>
    </div>`;
}