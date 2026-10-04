// API settings dialog and the AI出題 dialog.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {



    Poe.isSettingsModalOpen = function isSettingsModalOpen() {
        return !!(Poe.poeUi.settingsOverlay && !Poe.poeUi.settingsOverlay.hidden);
    }

    Poe.syncSettingsBusyState = function syncSettingsBusyState() {
        if (!Poe.poeUi.settingsOverlay) return;
        var busy = !!Poe.poeUi.busy;
        ['poe-settings-api-key',
         'poe-settings-model-poe', 'poe-settings-model-custom-poe',
         'poe-settings-model-openrouter', 'poe-settings-model-custom-openrouter',
         'poe-settings-save', 'poe-settings-api-save', 'poe-settings-api-clear',
         'poe-settings-close', 'poe-settings-done'].forEach(function (id) {
            var node = document.getElementById(id);
            if (node) node.disabled = busy;
        });
        Poe.poeUi.settingsOverlay.querySelectorAll('input[name="poe-settings-provider"]').forEach(function (input) {
            input.disabled = busy;
        });
    }

    Poe.ensureSettingsModal = function ensureSettingsModal() {
        if (Poe.poeUi.settingsOverlay) return;
        var overlay = document.createElement('div');
        overlay.id = 'poe-settings-overlay';
        overlay.className = 'poe-overlay poe-settings-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-dialog poe-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-settings-title">'
            + '  <header class="poe-header">'
            + '    <div>'
            + '      <h2 id="poe-settings-title">API／模型設定</h2>'
            + '      <p class="poe-subtitle">選擇供應商、儲存個人 API Key，並指定出題／測試用的模型。設定只存在此瀏覽器，不會提交到 Git 或寫入伺服器備份。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" id="poe-settings-close" aria-label="關閉設定">×</button>'
            + '  </header>'
            + '  <div class="poe-settings-body">'
            + '    <fieldset class="poe-settings-provider" role="radiogroup" aria-label="供應商">'
            + '      <legend>供應商</legend>'
            + '      <label class="poe-source-option"><input type="radio" name="poe-settings-provider" value="poe" checked> Poe</label>'
            + '      <label class="poe-source-option"><input type="radio" name="poe-settings-provider" value="openrouter"> OpenRouter</label>'
            + '    </fieldset>'
            + '    <div class="poe-api-key poe-settings-api-key" id="poe-settings-api-wrap">'
            + '      <label class="poe-field" for="poe-settings-api-key"><span id="poe-settings-api-key-label">Poe API Key（個人）</span>'
            + '        <input type="password" id="poe-settings-api-key" autocomplete="off" spellcheck="false" maxlength="200" aria-describedby="poe-settings-api-key-hint" placeholder="貼上你的 API Key">'
            + '      </label>'
            + '      <div class="poe-api-key-actions">'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-settings-api-save">儲存金鑰</button>'
            + '        <button type="button" class="poe-text-btn" id="poe-settings-api-clear">清除金鑰</button>'
            + '      </div>'
            + '      <p class="poe-api-key-hint" id="poe-settings-api-key-hint"></p>'
            + '    </div>'
            + '    <div class="poe-settings-model-row">'
            + '      <div class="poe-settings-models-panel" id="poe-settings-models-poe">'
            + '        <label class="poe-field" for="poe-settings-model-poe">Poe 模型'
            + '          <select id="poe-settings-model-poe" aria-label="Poe 模型"></select>'
            + '        </label>'
            + '        <div class="poe-field">'
            + '          <label for="poe-settings-model-custom-poe">Poe 自訂模型 id（選填）</label>'
            + '          <input type="text" id="poe-settings-model-custom-poe" autocomplete="off" spellcheck="false" maxlength="120" placeholder="例如 Claude-Opus-4.6" aria-label="Poe 自訂模型 id">'
            + '        </div>'
            + '      </div>'
            + '      <div class="poe-settings-models-panel" id="poe-settings-models-openrouter" hidden>'
            + '        <label class="poe-field" for="poe-settings-model-openrouter">OpenRouter 模型'
            + '          <select id="poe-settings-model-openrouter" aria-label="OpenRouter 模型"></select>'
            + '        </label>'
            + '        <div class="poe-field">'
            + '          <label for="poe-settings-model-custom-openrouter">OpenRouter 自訂模型 id（選填）</label>'
            + '          <input type="text" id="poe-settings-model-custom-openrouter" autocomplete="off" spellcheck="false" maxlength="120" placeholder="例如 anthropic/claude-3.5-sonnet" aria-label="OpenRouter 自訂模型 id">'
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '    <p class="poe-settings-status" id="poe-settings-status" aria-live="polite"></p>'
            + '  </div>'
            + '  <footer class="poe-footer poe-settings-footer">'
            + '    <div class="poe-footer-actions">'
            + '      <button type="button" class="btn btn-primary" id="poe-settings-save">儲存設定</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-settings-done">完成</button>'
            + '    </div>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        Poe.poeUi.settingsOverlay = overlay;

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) Poe.closeSettingsModal();
        });
        overlay.querySelector('#poe-settings-close').addEventListener('click', Poe.closeSettingsModal);
        overlay.querySelector('#poe-settings-done').addEventListener('click', Poe.closeSettingsModal);
        overlay.querySelector('#poe-settings-save').addEventListener('click', Poe.saveSettingsFromUi);
        overlay.querySelector('#poe-settings-api-save').addEventListener('click', Poe.saveApiKeyFromInput);
        overlay.querySelector('#poe-settings-api-clear').addEventListener('click', Poe.clearApiKeyFromUi);
        overlay.querySelectorAll('input[name="poe-settings-provider"]').forEach(function (input) {
            input.addEventListener('change', Poe.onSettingsProviderChange);
        });
        ['poe-settings-model-poe', 'poe-settings-model-openrouter'].forEach(function (id) {
            overlay.querySelector('#' + id).addEventListener('change', Poe.onSettingsModelChange);
        });
        ['poe-settings-model-custom-poe', 'poe-settings-model-custom-openrouter'].forEach(function (id) {
            overlay.querySelector('#' + id).addEventListener('change', Poe.onSettingsCustomModelInput);
        });
        overlay.querySelector('#poe-settings-api-key').addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                Poe.saveApiKeyFromInput();
            }
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                Poe.closeSettingsModal();
            }
        });
    }

    Poe.openSettingsModal = function openSettingsModal(focusKey) {
        Poe.ensureModal();
        Poe.ensureSettingsModal();
        Poe.loadSettingsForm();
        Poe.syncSettingsBusyState();
        Poe.poeUi.settingsOverlay.hidden = false;
        document.body.classList.add('poe-settings-open');
        var target = focusKey
            ? document.getElementById('poe-settings-api-key')
            : document.getElementById('poe-settings-close');
        if (target) {
            try { target.focus(); } catch (error) {}
        }
    }

    Poe.closeSettingsModal = function closeSettingsModal() {
        if (!Poe.isSettingsModalOpen()) return;
        Poe.refreshProviderSummary();
        Poe.poeUi.settingsOverlay.hidden = true;
        document.body.classList.remove('poe-settings-open');
        var openBtn = document.getElementById('poe-settings-open');
        if (openBtn && Poe.isPoeGenerateModalOpen()) {
            try { openBtn.focus(); } catch (error) {}
        }
    }

    Poe.ensureModal = function ensureModal() {
        if (Poe.poeUi.overlay) return;
        var overlay = document.createElement('div');
        overlay.id = 'poe-generate-overlay';
        overlay.className = 'poe-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-generate-title">'
            + '  <header class="poe-header">'
            + '    <div>'
            + '      <h2 id="poe-generate-title">AI出題</h2>'
            + '      <p class="poe-subtitle">可以參考目前篩選，或貼上自己的題目。選擇出題模式，可再改出題指示，然後按出題。供應商、API Key 與模型請在「API／模型設定」調整。測試只檢查所選模型能否回應，不會用題目出題。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="poe-tabs" role="tablist" aria-label="AI出題分頁">'
            + '    <button type="button" class="poe-tab is-active" id="poe-tab-compose" role="tab" aria-selected="true" aria-controls="poe-panel-compose">出題</button>'
            + '    <button type="button" class="poe-tab" id="poe-tab-history" role="tab" aria-selected="false" aria-controls="poe-panel-history" tabindex="-1">過往紀錄</button>'
            + '  </div>'
            + '  <div class="poe-body">'
            + '    <section class="poe-main poe-tab-panel" id="poe-panel-compose" role="tabpanel" aria-labelledby="poe-tab-compose">'
            + '      <div class="poe-result-pane">'
            + '      <div class="poe-stage-bar">'
            + '        <span class="poe-stage-label">出題結果</span>'
            + '        <button type="button" class="poe-text-btn" id="poe-enlarge" hidden>放大檢視</button>'
            + '      </div>'
            + '      <div class="poe-stage" id="poe-stage" tabindex="0"></div>'
            + '      </div>'
            + '      <div class="poe-composer">'
            + '      <div class="poe-meta" id="poe-meta"></div>'
            + '      <div class="poe-source" role="radiogroup" aria-label="參考題來源">'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="filter" checked> 使用目前篩選</label>'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="paste"> 自行貼上題目</label>'
            + '      </div>'
            + '      <div class="poe-single" id="poe-single-wrap" hidden>'
            + '        <p class="poe-single-lead" id="poe-single-lead"></p>'
            + '        <div class="poe-single-block">'
            + '          <div class="poe-single-label">題幹</div>'
            + '          <pre class="poe-single-text" id="poe-single-stem"></pre>'
            + '        </div>'
            + '        <div class="poe-single-block">'
            + '          <div class="poe-single-label">答案</div>'
            + '          <pre class="poe-single-text" id="poe-single-answer"></pre>'
            + '        </div>'
            + '      </div>'
            + '      <div class="poe-paste" id="poe-paste-wrap" hidden>'
            + '        <label for="poe-paste-input">貼上題目</label>'
            + '        <textarea id="poe-paste-input" rows="8" maxlength="100000" aria-label="貼上題目" placeholder="可貼上一題或多題。用空行分隔，或以 1. 2. 3. 編號。若有解釋，在題幹後另起一行寫「解釋：」。"></textarea>'
            + '      </div>'
            + '      <div class="poe-controls">'
            + '        <label class="poe-field">出題模式'
            + '          <select id="poe-mode" aria-label="出題模式"></select>'
            + '        </label>'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-settings-open">API／模型設定</button>'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-test">測試</button>'
            + '        <p class="poe-provider-summary" id="poe-provider-summary" aria-live="polite"></p>'
            + '      </div>'
            + '      <div id="poe-test-banner" class="poe-test-banner" hidden role="status" aria-live="polite"></div>'
            + '      <details class="poe-instruction" open>'
            + '        <summary>出題指示</summary>'
            + '        <div class="poe-instruction-bar">'
            + '          <p class="poe-instruction-hint" id="poe-instruction-hint">選擇模式會填入該模式的指示，仍可再修改。回復預設會還原目前所選模式的指示。上次修改會記在這部瀏覽器。留空送出時，會改用目前所選模式的預設指示。</p>'
            + '          <button type="button" class="poe-text-btn" id="poe-instruction-reset">回復預設</button>'
            + '        </div>'
            + '        <textarea id="poe-instruction-input" maxlength="4000" rows="4" aria-label="出題指示" aria-describedby="poe-instruction-hint"></textarea>'
            + '      </details>'
            + '      </div>'
            + '    </section>'
            + '    <aside class="poe-history poe-tab-panel" id="poe-panel-history" role="tabpanel" aria-labelledby="poe-tab-history" aria-label="過往生成" hidden>'
            + '      <div class="poe-history-head">'
            + '        <h3>過往紀錄</h3>'
            + '        <button type="button" class="poe-text-btn" id="poe-history-clear">清除</button>'
            + '      </div>'
            + '      <label class="poe-history-search" for="poe-history-search">搜尋參考題編號'
            + '        <input type="search" id="poe-history-search" autocomplete="off" spellcheck="false" placeholder="例如 2026-P1-01" aria-label="搜尋參考題編號">'
            + '        <span class="poe-history-search-note">只搜尋本頁。</span>'
            + '      </label>'
            + '      <div class="poe-history-pager" role="navigation" aria-label="過往紀錄分頁">'
            + '        <button type="button" class="poe-page-btn" id="poe-history-prev" disabled>上一頁</button>'
            + '        <span class="poe-history-page" id="poe-history-page">第 1 頁</span>'
            + '        <button type="button" class="poe-page-btn" id="poe-history-next" disabled>下一頁</button>'
            + '      </div>'
            + '      <div id="poe-history-list"></div>'
            + '    </aside>'
            + '  </div>'
            + '  <footer class="poe-footer">'
            + '    <p class="poe-footer-status" id="poe-status" aria-live="polite"></p>'
            + '    <div class="poe-footer-actions">'
            + '      <button type="button" class="btn btn-primary" id="poe-start">根據目前篩選出題</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-again" disabled>再生成</button>'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-copy" disabled>複製內容</button>'
            + '      <button type="button" class="btn btn-outline-danger" id="poe-cancel" hidden>取消</button>'
            + '    </div>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        Poe.poeUi.overlay = overlay;

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) Poe.closePoeGenerateModal();
        });
        overlay.querySelector('.poe-close').addEventListener('click', Poe.closePoeGenerateModal);
        overlay.querySelector('#poe-start').addEventListener('click', Poe.generateFromCurrentSource);
        overlay.querySelectorAll('input[name="poe-reference-source"]').forEach(function (input) {
            input.addEventListener('change', Poe.onSourceChange);
        });
        overlay.querySelector('#poe-paste-input').addEventListener('input', Poe.onPasteInput);
        Poe.fillComposerOptions();
        overlay.querySelector('#poe-again').addEventListener('click', Poe.regenerateActive);
        overlay.querySelector('#poe-test').addEventListener('click', Poe.testSelectedModel);
        overlay.querySelector('#poe-mode').addEventListener('change', Poe.onModeChange);
        overlay.querySelector('#poe-settings-open').addEventListener('click', function () { Poe.openSettingsModal(false); });
        overlay.querySelector('#poe-instruction-reset').addEventListener('click', Poe.resetInstruction);
        overlay.querySelector('#poe-instruction-input').addEventListener('input', function (event) {
            Poe.writeStoredInstruction(event.target.value);
        });
        overlay.querySelector('#poe-enlarge').addEventListener('click', Poe.enlargeResult);
        overlay.querySelector('#poe-copy').addEventListener('click', Poe.copyActive);
        overlay.querySelector('#poe-cancel').addEventListener('click', function () { Poe.cancelGeneration(false); });
        overlay.querySelector('#poe-history-clear').addEventListener('click', Poe.clearHistory);
        overlay.querySelector('#poe-tab-compose').addEventListener('click', function () { Poe.showPoeTab('compose'); });
        overlay.querySelector('#poe-tab-history').addEventListener('click', function () { Poe.showPoeTab('history'); });
        overlay.querySelector('#poe-history-search').addEventListener('input', Poe.onHistorySearchInput);
        overlay.querySelector('#poe-history-prev').addEventListener('click', function () { Poe.showHistoryPage(Poe.poeUi.historyPage - 1); });
        overlay.querySelector('#poe-history-next').addEventListener('click', function () { Poe.showHistoryPage(Poe.poeUi.historyPage + 1); });
        overlay.addEventListener('keydown', Poe.onDialogKeydown);
    }

    Poe.onDialogKeydown = function onDialogKeydown(event) {
        if (!Poe.isPoeGenerateModalOpen()) return;
        if (event.key === 'Escape' && Poe.isSettingsModalOpen()) {
            event.preventDefault();
            Poe.closeSettingsModal();
            return;
        }
        if (event.key === 'Escape' && Poe.poeUi.resultExpanded) {
            event.preventDefault();
            Poe.closeEnlargeOverlay();
            return;
        }
        if (event.key === 'Tab') Poe.trapTab(event);
    }

    Poe.trapTab = function trapTab(event) {
        var dialog = Poe.poeUi.overlay.querySelector('.poe-dialog');
        var focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        var items = Array.prototype.filter.call(focusable, function (node) {
            return !node.disabled && !node.hidden && node.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    Poe.isPoeGenerateModalOpen = function isPoeGenerateModalOpen() {
        return !!(Poe.poeUi.overlay && !Poe.poeUi.overlay.hidden);
    }

    Poe.closePoeGenerateModal = function closePoeGenerateModal() {
        if (!Poe.isPoeGenerateModalOpen()) return;
        if (Poe.poeUi.busy) Poe.cancelGeneration(true);
        Poe.closeSettingsModal();
        Poe.closeEnlargeOverlay();
        Poe.poeUi.overlay.hidden = true;
        document.body.classList.remove('poe-modal-open');
        Poe.stopElapsed();
        if (Poe.poeUi.trigger && typeof Poe.poeUi.trigger.focus === 'function') Poe.poeUi.trigger.focus();
    }

    Poe.openPoeGenerateModal = async function openPoeGenerateModal() {
        if (Poe.poeUi.opening || Poe.isPoeGenerateModalOpen()) return;
        Poe.poeUi.pinnedQuestion = null;
        Poe.poeUi.pendingTrigger = document.getElementById('poe-generate-btn');
        await Poe.runPoeGenerateOpen();
    }

    Poe.openPoeGenerateModalForQuestion = async function openPoeGenerateModalForQuestion(id, trigger) {
        if (Poe.poeUi.opening || Poe.isPoeGenerateModalOpen()) return;
        var question = await Poe.questionById(id);
        if (Poe.poeUi.opening || Poe.isPoeGenerateModalOpen()) return;
        if (!question) {
            window.alert('找不到這一題，未能出題。');
            return;
        }
        var bank = Poe.bankQuestionFrom(question);
        if (!bank.plainText) {
            window.alert('這一題沒有可送出的題幹。');
            return;
        }
        Poe.poeUi.pinnedQuestion = bank;
        Poe.poeUi.pendingTrigger = trigger || null;
        await Poe.runPoeGenerateOpen();
    }

    Poe.runPoeGenerateOpen = async function runPoeGenerateOpen() {
        if (Poe.poeUi.opening || Poe.isPoeGenerateModalOpen()) return;
        Poe.poeUi.opening = true;
        try {
            await Poe.openPoeGenerateModalBody();
        } finally {
            Poe.poeUi.opening = false;
        }
    }

    Poe.openPoeGenerateModalBody = async function openPoeGenerateModalBody() {
        var allowed = await Poe.poeCheckAccess();
        if (!allowed) {
            Poe.hideGenerateButton();
            Poe.poeUi.pinnedQuestion = null;
            return;
        }
        Poe.ensureModal();
        Poe.syncUsageTab();
        Poe.poeUi.usageLoaded = false;
        Poe.poeUi.usageError = '';
        Poe.poeUi.usageActiveId = '';
        Poe.poeUi.usagePage = 0;
        Poe.poeUi.usageCursors = [null];
        Poe.poeUi.usageNextAfter = null;
        Poe.poeUi.usageHasMore = false;
        Poe.poeUi.historyPage = 0;
        Poe.poeUi.historyCursors = [''];
        Poe.poeUi.historyNextAfter = '';
        Poe.poeUi.historyHasMore = false;
        Poe.poeUi.historyLoading = false;
        Poe.poeUi.historyError = '';
        Poe.poeUi.historyLoadToken = (Poe.poeUi.historyLoadToken || 0) + 1;
        Poe.loadComposer();
        Poe.refreshProviderSummary();
        Poe.clearTestBanner();
        Poe.poeUi.pasteCount = Poe.pasteQuestions().length;
        Poe.poeUi.trigger = Poe.poeUi.pendingTrigger || document.getElementById('poe-generate-btn');
        Poe.syncPinnedChrome();
        Poe.poeUi.overlay.hidden = false;
        document.body.classList.add('poe-modal-open');
        Poe.setStatus('');
        Poe.poeUi.counting = true;
        if (!Poe.poeUi.activeRecord) Poe.showIdle(0, true);
        Poe.updateMeta(0, true);
        Poe.syncActionButtons();
        var closeButton = Poe.poeUi.overlay.querySelector('.poe-close');
        if (closeButton) closeButton.focus();
        var historyUser = Poe.currentUsername();
        try {
            Poe.poeUi.records = await Poe.listGenerations(historyUser);
        } catch (error) {
            Poe.poeUi.records = [];
        }
        Poe.showPoeTab('compose');
        Poe.renderHistory();
        // Cross-device history: merge GitHub AI backups without blocking the modal.
        Poe.syncRemoteHistoryIntoUi(historyUser);
        if (Poe.poeUi.pinnedQuestion) {
            Poe.poeUi.counting = false;
            Poe.updateMeta(1, false);
            if (!Poe.poeUi.activeRecord) Poe.showIdle(1, false);
            Poe.syncActionButtons();
            return;
        }
        var usable = [];
        try {
            usable = await Poe.loadFilteredQuestions();
        } catch (error) {
            usable = [];
        }
        Poe.poeUi.counting = false;
        Poe.poeUi.filteredCount = usable.length;
        Poe.updateMeta(usable.length, false);
        if (!Poe.poeUi.activeRecord) Poe.showIdle(usable.length, false);
        Poe.syncActionButtons();
    }
})(PoeGenerate);
