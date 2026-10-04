// Compose view, result rendering, and the usage tab.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.updateMeta = function updateMeta(count, counting) {
        Poe.poeUi.filteredCount = count;
        Poe.refreshSourceMeta(counting);
    }

    Poe.syncPinnedChrome = function syncPinnedChrome() {
        var subtitle = Poe.poeUi.overlay && Poe.poeUi.overlay.querySelector('.poe-subtitle');
        if (subtitle && !Poe.poeUi.defaultSubtitle) Poe.poeUi.defaultSubtitle = subtitle.textContent;
        if (subtitle) {
            subtitle.textContent = Poe.poeUi.pinnedQuestion
                ? '這次只根據你按下按鈕的那一題（題幹與答案）出題，不會用目前篩選的其他題。出題模式與「API／模型設定」與篩選出題相同。'
                : (Poe.poeUi.defaultSubtitle || subtitle.textContent);
        }
        var sourceBox = Poe.poeUi.overlay && Poe.poeUi.overlay.querySelector('.poe-source');
        var single = document.getElementById('poe-single-wrap');
        var pasteWrap = document.getElementById('poe-paste-wrap');
        var pinned = !!Poe.poeUi.pinnedQuestion;
        if (sourceBox) sourceBox.hidden = pinned;
        if (single) single.hidden = !pinned;
        if (pasteWrap) pasteWrap.hidden = pinned || Poe.currentSource() !== 'paste';
        var stem = document.getElementById('poe-single-stem');
        var answer = document.getElementById('poe-single-answer');
        var leadEl = document.getElementById('poe-single-lead');
        if (!pinned) return;
        if (stem) stem.textContent = Poe.poeUi.pinnedQuestion.plainText || '';
        if (answer) answer.textContent = Poe.explanationText(Poe.poeUi.pinnedQuestion) || '（沒有答案）';
        if (leadEl) {
            var pinnedId = Poe.poeUi.pinnedQuestion.id || '';
            leadEl.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
        }
    }

    Poe.refreshSourceMeta = function refreshSourceMeta(counting) {
        var meta = document.getElementById('poe-meta');
        if (!meta) return;
        if (Poe.currentSource() === 'single') {
            var pinnedId = Poe.poeUi.pinnedQuestion && Poe.poeUi.pinnedQuestion.id ? Poe.poeUi.pinnedQuestion.id : '';
            meta.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
            return;
        }
        if (Poe.currentSource() === 'paste') {
            meta.textContent = Poe.leadForPaste(Poe.poeUi.pasteCount);
            return;
        }
        meta.textContent = counting ? '正在計算目前篩選的題數…' : Poe.leadForCount(Poe.poeUi.filteredCount);
    }

    Poe.onSourceChange = function onSourceChange() {
        if (Poe.poeUi.pinnedQuestion) {
            Poe.syncPinnedChrome();
            Poe.refreshSourceMeta(false);
            if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(1, false);
            Poe.syncActionButtons();
            return;
        }
        var wrap = document.getElementById('poe-paste-wrap');
        var paste = Poe.currentSource() === 'paste';
        if (wrap) wrap.hidden = !paste;
        if (paste) Poe.poeUi.pasteCount = Poe.pasteQuestions().length;
        Poe.refreshSourceMeta(Poe.poeUi.counting);
        if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(Poe.poeUi.filteredCount, Poe.poeUi.counting);
        Poe.syncActionButtons();
    }

    Poe.onPasteInput = function onPasteInput() {
        Poe.poeUi.pasteCount = Poe.pasteQuestions().length;
        if (Poe.currentSource() === 'paste') {
            Poe.refreshSourceMeta(false);
            if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(Poe.poeUi.filteredCount, false);
        }
        Poe.syncActionButtons();
    }

    Poe.setStatus = function setStatus(message) {
        var status = document.getElementById('poe-status');
        if (status) status.textContent = message || '';
    }

    Poe.showIdle = function showIdle(count, counting) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setEnlargeButtonVisible(false);
        stage.textContent = '';
        var lead = document.createElement('p');
        lead.className = 'poe-lead';
        if (Poe.currentSource() === 'single') {
            lead.textContent = '按「根據這一題出題」後，伺服器會只附上這一題的題幹與答案，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else if (Poe.currentSource() === 'paste') {
            lead.textContent = '按「根據貼上內容出題」後，伺服器會附上貼上的題目，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else {
            lead.textContent = '按「根據目前篩選出題」後，伺服器會附上參考題，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        }
        stage.appendChild(lead);
        var noteText = '';
        if (Poe.currentSource() === 'single') {
            noteText = '';
        } else if (Poe.currentSource() === 'paste') {
            noteText = Poe.leadForPaste(Poe.poeUi.pasteCount);
        } else if (counting || !count) {
            noteText = counting ? '正在計算目前篩選的題數…' : Poe.leadForCount(0);
        }
        if (noteText) {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = noteText;
            stage.appendChild(empty);
        }
    }

    Poe.showLoading = function showLoading() {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setEnlargeButtonVisible(false);
        stage.textContent = '';
        var wrap = document.createElement('div');
        wrap.className = 'poe-loading';
        var bar = document.createElement('div');
        bar.className = 'poe-progress';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', '正在出題');
        var fill = document.createElement('div');
        fill.className = 'poe-progress-bar';
        bar.appendChild(fill);
        var title = document.createElement('p');
        title.id = 'poe-loading-title';
        title.textContent = '正在出題，請稍候。一次寫多題時，模型可能需要數分鐘。';
        var elapsed = document.createElement('p');
        elapsed.id = 'poe-elapsed';
        elapsed.className = 'poe-elapsed';
        elapsed.textContent = '已等待 0 秒';
        wrap.appendChild(bar);
        wrap.appendChild(title);
        wrap.appendChild(elapsed);
        stage.appendChild(wrap);
    }

    Poe.showError = function showError(code) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setEnlargeButtonVisible(false);
        stage.textContent = '';
        var box = document.createElement('div');
        box.className = 'poe-error';
        box.setAttribute('role', 'alert');
        var title = document.createElement('p');
        title.className = 'poe-error-title';
        title.textContent = (code === 'missing_api_key') ? '需要 API Key' : '未能完成出題';
        var message = document.createElement('p');
        message.textContent = (code === 'missing_api_key')
            ? Poe.missingApiKeyMessage(Poe.currentProvider())
            : (Poe.ERROR_TEXT[code] || Poe.ERROR_TEXT.server_error);
        box.appendChild(title);
        box.appendChild(message);
        if (code === 'missing_api_key') {
            var tip = document.createElement('p');
            tip.className = 'poe-note';
            tip.textContent = '按「API／模型設定」選擇供應商（Poe 或 OpenRouter），貼上對應金鑰後按「儲存」，再試一次。每位使用者可用自己的金鑰，不必共用伺服器上的設定。';
            box.appendChild(tip);
            Poe.openSettingsModal(true);
        }
        stage.appendChild(box);
    }

    Poe.escapeHtml = function escapeHtml(text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.escapeHtml === 'function') {
            return window.PoeMarkdown.escapeHtml(text);
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    Poe.inlineMarkdownHtml = function inlineMarkdownHtml(text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.inlineOnly === 'function') {
            return window.PoeMarkdown.inlineOnly(text);
        }
        return Poe.escapeHtml(text);
    }

    Poe.setInlineMarkdown = function setInlineMarkdown(element, text) {
        element.innerHTML = Poe.inlineMarkdownHtml(text);
    }

    Poe.renderStructured = function renderStructured(container, text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.renderInto === 'function') {
            window.PoeMarkdown.renderInto(container, text);
            return;
        }
        container.textContent = String(text || '');
    }

    Poe.setEnlargeButtonVisible = function setEnlargeButtonVisible(show) {
        var btn = document.getElementById('poe-enlarge');
        if (btn) btn.hidden = !show;
    }

    Poe.closeEnlargeOverlay = function closeEnlargeOverlay() {
        if (Poe.poeUi.enlargeOverlay) {
            Poe.poeUi.enlargeOverlay.hidden = true;
        }
        Poe.poeUi.resultExpanded = false;
        document.body.classList.remove('poe-result-enlarged');
    }

    Poe.ensureEnlargeOverlay = function ensureEnlargeOverlay() {
        if (Poe.poeUi.enlargeOverlay) return Poe.poeUi.enlargeOverlay;
        var overlay = document.createElement('div');
        overlay.id = 'poe-enlarge-overlay';
        overlay.className = 'poe-enlarge-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-enlarge-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-enlarge-title">'
            + '  <header class="poe-enlarge-header">'
            + '    <h2 id="poe-enlarge-title">出題結果</h2>'
            + '    <div class="poe-enlarge-actions">'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-enlarge-copy">複製內容</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-enlarge-restore">還原</button>'
            + '      <button type="button" class="poe-close" id="poe-enlarge-close" aria-label="關閉放大檢視">×</button>'
            + '    </div>'
            + '  </header>'
            + '  <div class="poe-enlarge-body" id="poe-enlarge-body"></div>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) Poe.closeEnlargeOverlay();
        });
        overlay.querySelector('#poe-enlarge-restore').addEventListener('click', Poe.closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-close').addEventListener('click', Poe.closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-copy').addEventListener('click', function () {
            if (Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.content) Poe.copyActive();
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                Poe.closeEnlargeOverlay();
            }
        });
        Poe.poeUi.enlargeOverlay = overlay;
        return overlay;
    }

    Poe.enlargeResult = function enlargeResult() {
        if (!Poe.poeUi.activeRecord || !Poe.poeUi.activeRecord.content) return;
        var overlay = Poe.ensureEnlargeOverlay();
        var body = overlay.querySelector('#poe-enlarge-body');
        body.textContent = '';
        var article = document.createElement('article');
        article.className = 'poe-result poe-result-enlarged-view';
        Poe.renderStructured(article, Poe.poeUi.activeRecord.content);
        body.appendChild(article);
        overlay.hidden = false;
        Poe.poeUi.resultExpanded = true;
        document.body.classList.add('poe-result-enlarged');
        var restore = overlay.querySelector('#poe-enlarge-restore');
        if (restore) restore.focus();
    }

    Poe.showResult = function showResult(record) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var article = document.createElement('article');
        article.className = 'poe-result';
        Poe.renderStructured(article, record.content);
        stage.appendChild(article);
        stage.scrollTop = 0;
        Poe.setEnlargeButtonVisible(!!(record && record.content));
        if (Poe.poeUi.resultExpanded) Poe.enlargeResult();
    }

    Poe.formatTime = function formatTime(timestamp) {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleString('zh-HK', {
                hour12: false,
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return date.toISOString();
        }
    }

    Poe.clipPreview = function clipPreview(line, max) {
        var count = 0;
        var index = 0;
        while (index < line.length && count < max) {
            if (line.substr(index, 2) === '**' || line.substr(index, 2) === '__') {
                index += 2;
                continue;
            }
            count += 1;
            index += 1;
        }
        var sliced = line.slice(0, index);
        if ((sliced.match(/\*\*/g) || []).length % 2 === 1) sliced += '**';
        if ((sliced.match(/__/g) || []).length % 2 === 1) sliced += '__';
        if (index < line.length) sliced += '…';
        return sliced;
    }

    Poe.normalizeReferenceIds = function normalizeReferenceIds(value) {
        if (!Array.isArray(value)) return [];
        var out = [];
        var seen = {};
        for (var i = 0; i < value.length && out.length < 80; i++) {
            var id = String(value[i] == null ? '' : value[i]).trim();
            if (!id || id.length > 80 || seen[id]) continue;
            seen[id] = true;
            out.push(id);
        }
        return out;
    }

    Poe.syncUsageTab = function syncUsageTab() {
        if (!Poe.poeUi.overlay) return;
        var tabs = Poe.poeUi.overlay.querySelector('.poe-tabs');
        var body = Poe.poeUi.overlay.querySelector('.poe-body');
        if (!tabs || !body) return;
        var existingTab = document.getElementById('poe-tab-usage');
        var existingPanel = document.getElementById('poe-panel-usage');
        if (!Poe.viewerIsAdmin()) {
            if (existingTab && existingTab.parentNode) existingTab.parentNode.removeChild(existingTab);
            if (existingPanel && existingPanel.parentNode) existingPanel.parentNode.removeChild(existingPanel);
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageLoaded = false;
            Poe.poeUi.usageLoading = false;
            Poe.poeUi.usageError = '';
            if (Poe.poeUi.activeTab === 'usage') Poe.showPoeTab('compose');
            return;
        }
        if (existingTab && existingPanel) return;
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'poe-tab';
        tab.id = 'poe-tab-usage';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-controls', 'poe-panel-usage');
        tab.tabIndex = -1;
        tab.textContent = '使用紀錄';
        tab.addEventListener('click', function () { Poe.showPoeTab('usage'); });
        tabs.appendChild(tab);

        var panel = document.createElement('aside');
        panel.className = 'poe-history poe-tab-panel';
        panel.id = 'poe-panel-usage';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', 'poe-tab-usage');
        panel.setAttribute('aria-label', '使用紀錄');
        panel.hidden = true;

        var head = document.createElement('div');
        head.className = 'poe-history-head';
        var title = document.createElement('h3');
        title.textContent = '使用紀錄';
        head.appendChild(title);
        panel.appendChild(head);

        var note = document.createElement('p');
        note.className = 'poe-usage-note';
        note.textContent = '以下是其他使用者的 AI 出題備份。只供管理員查看，不能在這裡刪除或再生成。';
        panel.appendChild(note);

        var label = document.createElement('label');
        label.className = 'poe-history-search';
        label.htmlFor = 'poe-usage-search';
        label.appendChild(document.createTextNode('搜尋參考題編號'));
        var input = document.createElement('input');
        input.type = 'search';
        input.id = 'poe-usage-search';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.placeholder = '例如 2026-P1-01';
        input.setAttribute('aria-label', '搜尋參考題編號');
        label.appendChild(input);
        var usageSearchNote = document.createElement('span');
        usageSearchNote.className = 'poe-history-search-note';
        usageSearchNote.textContent = '只搜尋本頁。';
        label.appendChild(usageSearchNote);
        panel.appendChild(label);

        var usagePager = document.createElement('div');
        usagePager.className = 'poe-history-pager';
        usagePager.setAttribute('role', 'navigation');
        usagePager.setAttribute('aria-label', '使用紀錄分頁');
        var usagePrev = document.createElement('button');
        usagePrev.type = 'button';
        usagePrev.className = 'poe-page-btn';
        usagePrev.id = 'poe-usage-prev';
        usagePrev.disabled = true;
        usagePrev.textContent = '上一頁';
        usagePrev.addEventListener('click', function () { Poe.showUsagePage(Poe.poeUi.usagePage - 1); });
        var usagePageLabel = document.createElement('span');
        usagePageLabel.className = 'poe-history-page';
        usagePageLabel.id = 'poe-usage-page';
        usagePageLabel.textContent = '第 1 頁';
        var usageNext = document.createElement('button');
        usageNext.type = 'button';
        usageNext.className = 'poe-page-btn';
        usageNext.id = 'poe-usage-next';
        usageNext.disabled = true;
        usageNext.textContent = '下一頁';
        usageNext.addEventListener('click', function () { Poe.showUsagePage(Poe.poeUi.usagePage + 1); });
        usagePager.appendChild(usagePrev);
        usagePager.appendChild(usagePageLabel);
        usagePager.appendChild(usageNext);
        panel.appendChild(usagePager);

        var list = document.createElement('div');
        list.id = 'poe-usage-list';
        panel.appendChild(list);
        var detail = document.createElement('div');
        detail.id = 'poe-usage-detail';
        detail.className = 'poe-usage-detail';
        detail.hidden = true;
        panel.appendChild(detail);
        body.appendChild(panel);
        input.addEventListener('input', Poe.onUsageSearchInput);
    }

    Poe.onUsageSearchInput = function onUsageSearchInput(event) {
        Poe.poeUi.usageQuery = String(event && event.target ? event.target.value : '');
        Poe.renderUsage();
    }

    Poe.usageQueryText = function usageQueryText() {
        var input = document.getElementById('poe-usage-search');
        var raw = input ? String(input.value || '') : String(Poe.poeUi.usageQuery || '');
        return raw.trim() ? raw.trim() : '';
    }

    Poe.mapUsageRecord = function mapUsageRecord(backup) {
        var owner = String(backup && backup.username || '').trim().toLowerCase();
        if (!owner || owner.length > 80) return null;
        for (var c = 0; c < owner.length; c++) {
            var code = owner.charCodeAt(c);
            if (code < 32 || code === 127) return null;
        }
        var mapped = Poe.mapRemoteBackup(backup, owner);
        if (!mapped) return null;
        mapped.owner = owner;
        mapped.id = 'usage:' + owner + ':' + String(mapped.remoteName || mapped.createdAt || '');
        return mapped;
    }

    Poe.loadUsageRecords = async function loadUsageRecords(force, pageIndex) {
        if (!Poe.viewerIsAdmin() || !document.getElementById('poe-tab-usage')) return;
        if (Poe.poeUi.usageLoading) return;
        var page = typeof pageIndex === 'number' ? pageIndex : Poe.poeUi.usagePage;
        if (page < 0) page = 0;
        if (Poe.poeUi.usageLoaded && !force && page === Poe.poeUi.usagePage) {
            Poe.renderUsage();
            return;
        }
        var username = Poe.currentUsername();
        if (!username || !Poe.proxyUrl()) {
            Poe.poeUi.usagePage = page;
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageHasMore = false;
            Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            Poe.poeUi.usageLoaded = false;
            Poe.renderUsage();
            return;
        }
        var after = page > 0 ? Poe.poeUi.usageCursors[page] : null;
        if (page > 0 && !(after && after.name && after.username)) return;
        Poe.poeUi.usagePage = page;
        Poe.poeUi.usageLoading = true;
        Poe.poeUi.usageError = '';
        Poe.renderUsage();
        var payload = {
            action: 'listAiUsageRecords',
            username: username
        };
        if (after && after.name && (after.username === 'ryan' || after.username === 'user57')) {
            payload.afterName = after.name;
            payload.afterUser = after.username;
        }
        try {
            var data = await Poe.proxyRequest(payload, 90000, null);
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username || !Poe.viewerIsAdmin()) return;
            if (!data || data.ok !== true || !Array.isArray(data.records)) {
                Poe.poeUi.usageRecords = [];
                Poe.poeUi.usageActiveId = '';
                Poe.poeUi.usageHasMore = false;
                Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
                Poe.poeUi.usageLoaded = false;
            } else {
                Poe.poeUi.usageRecords = data.records.map(Poe.mapUsageRecord).filter(Boolean).slice(0, Poe.HISTORY_LIMIT);
                var nextAfter = null;
                if (data.nextAfter && data.nextAfter.name && (data.nextAfter.username === 'ryan' || data.nextAfter.username === 'user57')) {
                    nextAfter = { name: String(data.nextAfter.name), username: String(data.nextAfter.username) };
                }
                Poe.poeUi.usageHasMore = data.hasMore === true && !!nextAfter;
                Poe.poeUi.usageNextAfter = nextAfter;
                if (Poe.poeUi.usageHasMore) Poe.poeUi.usageCursors[page + 1] = nextAfter;
                if (!Poe.poeUi.usageRecords.length) Poe.poeUi.usageHasMore = false;
                Poe.poeUi.usageError = '';
                Poe.poeUi.usageLoaded = true;
                if (Poe.poeUi.usageActiveId && !Poe.poeUi.usageRecords.some(function (item) { return item.id === Poe.poeUi.usageActiveId; })) {
                    Poe.poeUi.usageActiveId = '';
                }
            }
        } catch (error) {
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return;
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageHasMore = false;
            Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            Poe.poeUi.usageLoaded = false;
        } finally {
            Poe.poeUi.usageLoading = false;
            if (document.getElementById('poe-usage-list')) Poe.renderUsage();
        }
    }


    Poe.renderUsageDetail = function renderUsageDetail(record) {
        var box = document.getElementById('poe-usage-detail');
        if (!box) return;
        box.textContent = '';
        if (!record) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        var meta = document.createElement('p');
        meta.className = 'poe-usage-detail-meta';
        var bits = [record.owner || '', Poe.formatTime(record.createdAt)];
        if (record.modeName) bits.push(record.modeName);
        if (record.model) bits.push(record.model);
        meta.textContent = bits.filter(Boolean).join(' \u00b7 ');
        box.appendChild(meta);
        var article = document.createElement('article');
        article.className = 'poe-result';
        Poe.renderStructured(article, record.content || '');
        box.appendChild(article);
        box.scrollTop = 0;
    }

    Poe.renderUsage = function renderUsage() {
        Poe.updateUsagePager();
        var list = document.getElementById('poe-usage-list');
        if (!list) return;
        list.textContent = '';
        if (Poe.poeUi.usageLoading) {
            var loading = document.createElement('p');
            loading.className = 'poe-history-empty';
            loading.textContent = '正在載入使用紀錄…';
            list.appendChild(loading);
            Poe.renderUsageDetail(null);
            return;
        }
        if (Poe.poeUi.usageError) {
            var failed = document.createElement('p');
            failed.className = 'poe-history-empty';
            failed.textContent = Poe.poeUi.usageError;
            list.appendChild(failed);
            Poe.renderUsageDetail(null);
            return;
        }
        if (!Poe.poeUi.usageRecords.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有可顯示的使用紀錄。';
            if (Poe.poeUi.usagePage > 0) empty.textContent = '沒有更早的使用紀錄。';
            list.appendChild(empty);
            Poe.renderUsageDetail(null);
            return;
        }
        var query = Poe.usageQueryText();
        var records = Poe.poeUi.usageRecords.filter(function (record) {
            return Poe.recordMatchesHistoryQuery(record, query);
        });
        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'poe-history-empty';
            none.textContent = '沒有符合這個編號的紀錄。';
            list.appendChild(none);
            Poe.renderUsageDetail(null);
            return;
        }
        var active = null;
        records.forEach(function (record) {
            if (record.id === Poe.poeUi.usageActiveId) active = record;
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (record.id === Poe.poeUi.usageActiveId ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', record.id === Poe.poeUi.usageActiveId ? 'true' : 'false');
            var who = document.createElement('span');
            who.className = 'poe-history-owner';
            who.textContent = record.owner || '';
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = Poe.formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            Poe.setInlineMarkdown(preview, Poe.previewText(record.content));
            var meta = document.createElement('span');
            meta.className = 'poe-history-meta';
            var metaBits = [];
            if (record.referenceSource === 'paste') metaBits.push('貼上');
            if (record.referenceSource === 'single') metaBits.push('單題');
            if (record.modeName) metaBits.push(record.modeName);
            metaBits.push((record.sentCount || 0) + ' 題參考');
            meta.textContent = metaBits.join(' \u00b7 ');
            open.appendChild(who);
            open.appendChild(time);
            open.appendChild(preview);
            open.appendChild(meta);
            open.addEventListener('click', function () {
                Poe.poeUi.usageActiveId = record.id;
                Poe.renderUsage();
            });
            row.appendChild(open);
            list.appendChild(row);
        });
        Poe.renderUsageDetail(active);
    }

    Poe.setPoeTabState = function setPoeTabState(tab, on) {
        if (!tab) return;
        tab.classList.toggle('is-active', !!on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    }

    Poe.showPoeTab = function showPoeTab(name) {
        var usageAllowed = !!document.getElementById('poe-tab-usage');
        var usageOn = name === 'usage' && usageAllowed;
        var historyOn = name === 'history' && !usageOn;
        var composeOn = !historyOn && !usageOn;
        var compose = document.getElementById('poe-panel-compose');
        var history = document.getElementById('poe-panel-history');
        var usage = document.getElementById('poe-panel-usage');
        if (compose) compose.hidden = !composeOn;
        if (history) history.hidden = !historyOn;
        if (usage) usage.hidden = !usageOn;
        Poe.setPoeTabState(document.getElementById('poe-tab-compose'), composeOn);
        Poe.setPoeTabState(document.getElementById('poe-tab-history'), historyOn);
        Poe.setPoeTabState(document.getElementById('poe-tab-usage'), usageOn);
        Poe.poeUi.activeTab = usageOn ? 'usage' : (historyOn ? 'history' : 'compose');
        if (usageOn) Poe.loadUsageRecords(false);
    }
})(PoeGenerate);
