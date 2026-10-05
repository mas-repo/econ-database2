// History list and actions on a saved generation.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.onHistorySearchInput = function onHistorySearchInput(event) {
        Poe.poeUi.historyQuery = String(event && event.target ? event.target.value : '');
        Poe.renderHistory();
    }

    Poe.historyQueryText = function historyQueryText() {
        var input = document.getElementById('poe-history-search');
        var raw = input ? String(input.value || '') : String(Poe.poeUi.historyQuery || '');
        return raw.trim() ? raw.trim() : '';
    }

    Poe.recordMatchesHistoryQuery = function recordMatchesHistoryQuery(record, query) {
        if (!query) return true;
        var ids = record && Array.isArray(record.referenceIds) ? record.referenceIds : [];
        for (var i = 0; i < ids.length; i++) {
            if (String(ids[i]).indexOf(query) !== -1) return true;
        }
        return false;
    }

    Poe.incompleteLabel = function incompleteLabel(record) {
        return record && record.incomplete ? '未完成' : '';
    }

    Poe.previewText = function previewText(content, record) {
        if (record && record.incomplete && !String(content || '').trim()) {
            return '（出題未完成，尚無回覆文字）';
        }
        var line = String(content || '').split('\n').map(function (item) { return item.trim(); }).filter(Boolean)[0] || '（沒有內容）';
        line = line.replace(/^#{1,6}\s+/, '');
        if (record && record.incomplete) line = '未完成 · ' + line;
        return Poe.clipPreview(line, 42);
    }


    Poe.updateHistoryPager = function updateHistoryPager() {
        var prev = document.getElementById('poe-history-prev');
        var next = document.getElementById('poe-history-next');
        var label = document.getElementById('poe-history-page');
        if (label) label.textContent = '\u7b2c ' + (Poe.poeUi.historyPage + 1) + ' \u9801';
        if (prev) prev.disabled = !!(Poe.poeUi.historyLoading || Poe.poeUi.historyPage <= 0);
        if (next) next.disabled = !!(Poe.poeUi.historyLoading || !Poe.poeUi.historyHasMore);
    }

    Poe.updateUsagePager = function updateUsagePager() {
        var prev = document.getElementById('poe-usage-prev');
        var next = document.getElementById('poe-usage-next');
        var label = document.getElementById('poe-usage-page');
        if (label) label.textContent = '\u7b2c ' + (Poe.poeUi.usagePage + 1) + ' \u9801';
        if (prev) prev.disabled = !!(Poe.poeUi.usageLoading || Poe.poeUi.usagePage <= 0);
        if (next) next.disabled = !!(Poe.poeUi.usageLoading || !Poe.poeUi.usageHasMore);
    }

    Poe.showHistoryPage = function showHistoryPage(pageIndex) {
        if (Poe.poeUi.historyLoading) return;
        var page = pageIndex | 0;
        if (page < 0 || page === Poe.poeUi.historyPage) return;
        if (page === Poe.poeUi.historyPage + 1) {
            if (!Poe.poeUi.historyHasMore || !Poe.poeUi.historyNextAfter) return;
            Poe.poeUi.historyCursors[page] = Poe.poeUi.historyNextAfter;
        }
        if (page === 0) {
            Poe.syncRemoteHistoryIntoUi(Poe.currentUsername(), true);
            return;
        }
        var after = Poe.poeUi.historyCursors[page] || '';
        if (!after) return;
        var username = Poe.currentUsername();
        if (!username) return;
        var token = ++Poe.poeUi.historyLoadToken;
        Poe.poeUi.historyPage = page;
        Poe.poeUi.historyLoading = true;
        Poe.poeUi.historyError = '';
        Poe.renderHistory();
        Poe.fetchRemoteBackupPage(username, after).then(function (remotePage) {
            if (token !== Poe.poeUi.historyLoadToken) return;
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return;
            Poe.poeUi.records = remotePage.records || [];
            Poe.poeUi.historyHasMore = remotePage.hasMore === true && !!remotePage.nextAfter;
            Poe.poeUi.historyNextAfter = remotePage.nextAfter || '';
            if (Poe.poeUi.historyHasMore) Poe.poeUi.historyCursors[page + 1] = remotePage.nextAfter;
            if (!Poe.poeUi.records.length) Poe.poeUi.historyHasMore = false;
            Poe.poeUi.historyLoading = false;
            Poe.renderHistory();
        }).catch(function () {
            if (token !== Poe.poeUi.historyLoadToken) return;
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return;
            Poe.poeUi.records = [];
            Poe.poeUi.historyHasMore = false;
            Poe.poeUi.historyNextAfter = '';
            Poe.poeUi.historyError = '暫時未能載入過往紀錄，請再試一次。';
            Poe.poeUi.historyLoading = false;
            Poe.renderHistory();
        });
    }

    Poe.showUsagePage = function showUsagePage(pageIndex) {
        if (Poe.poeUi.usageLoading) return;
        var page = pageIndex | 0;
        if (page < 0 || page === Poe.poeUi.usagePage) return;
        if (page === Poe.poeUi.usagePage + 1) {
            if (!Poe.poeUi.usageHasMore || !Poe.poeUi.usageNextAfter) return;
            Poe.poeUi.usageCursors[page] = Poe.poeUi.usageNextAfter;
        }
        if (page > 0 && !(Poe.poeUi.usageCursors[page] && Poe.poeUi.usageCursors[page].name)) return;
        Poe.loadUsageRecords(true, page);
    }

    Poe.renderHistory = function renderHistory() {
        Poe.updateHistoryPager();
        var list = document.getElementById('poe-history-list');
        if (!list) return;
        list.textContent = '';
        if (Poe.poeUi.historyLoading || Poe.poeUi.historyError) {
            var notice = document.createElement('p');
            notice.className = 'poe-history-empty';
            notice.textContent = Poe.poeUi.historyLoading ? '正在載入過往紀錄…' : Poe.poeUi.historyError;
            list.appendChild(notice);
            return;
        }
        if (!Poe.poeUi.records.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有儲存的生成結果。成功出題後可以在這裡重新打開。';
            if (Poe.poeUi.historyPage > 0) empty.textContent = '沒有更早的紀錄。';
            list.appendChild(empty);
            return;
        }
        var query = Poe.historyQueryText();
        var records = Poe.poeUi.records.filter(function (record) {
            return Poe.recordMatchesHistoryQuery(record, query);
        });
        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'poe-history-empty';
            none.textContent = '沒有符合這個編號的紀錄。';
            list.appendChild(none);
            return;
        }
        records.forEach(function (record) {
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.id === record.id ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.id === record.id ? 'true' : 'false');
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = Poe.formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            Poe.setInlineMarkdown(preview, Poe.previewText(record.content, record));
            var meta = document.createElement('span');
            meta.className = 'poe-history-meta';
            var metaBits = [];
            if (record.incomplete) metaBits.push('未完成');
            if (record.referenceSource === 'paste') metaBits.push('貼上');
            if (record.referenceSource === 'single') metaBits.push('單題');
            if (record.modeName) metaBits.push(record.modeName);
            metaBits.push((record.sentCount || 0) + ' 題參考');
            meta.textContent = metaBits.join(' · ');
            open.appendChild(time);
            open.appendChild(preview);
            open.appendChild(meta);
            open.addEventListener('click', function () { Poe.selectRecord(record); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'poe-history-delete';
            remove.setAttribute('aria-label', '刪除這筆紀錄');
            remove.textContent = '刪除';
            remove.addEventListener('click', function () { Poe.removeRecord(record); });
            row.appendChild(open);
            row.appendChild(remove);
            list.appendChild(row);
        });
    }

    Poe.selectRecord = async function selectRecord(record) {
        if (Poe.poeUi.busy || !record) return;
        Poe.showPoeTab('compose');
        Poe.poeUi.activeRecord = record;
        Poe.renderHistory();
        Poe.syncActionButtons();
        if (record.lean && !record.content && record.remoteName) {
            Poe.setStatus('正在載入這筆過往紀錄…');
            await Poe.fillLeanRemoteRecord(record);
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (Poe.poeUi.activeRecord !== record) return;
        }
        Poe.showResult(record);
        var bits = [Poe.formatTime(record.createdAt), record.filterSummary || ''];
        if (record.incomplete) bits.push('未完成');
        if (record.modeName) bits.push(record.modeName);
        if (record.model) bits.push('模型：' + record.model);
        if (record.truncated) bits.push('參考題曾經截斷');
        if (record.incomplete && !record.content) bits.push('關閉視窗或連線中斷時尚未收到回覆');
        Poe.setStatus(bits.filter(Boolean).join(' · '));
        Poe.renderHistory();
        Poe.syncActionButtons();
    }

    Poe.removeRecord = async function removeRecord(record) {
        if (Poe.poeUi.busy) return;
        try {
            await Poe.deleteGeneration(record.id);
        } catch (error) {
            Poe.setStatus('未能刪除這筆紀錄。');
            return;
        }
        Poe.poeUi.records = Poe.poeUi.records.filter(function (item) { return item.id !== record.id; });
        if (Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.id === record.id) {
            Poe.poeUi.activeRecord = null;
            Poe.showIdle(Poe.poeUi.filteredCount);
            Poe.setStatus('已刪除。');
        }
        Poe.renderHistory();
        Poe.syncActionButtons();
    }

    Poe.clearHistory = async function clearHistory() {
        if (Poe.poeUi.busy) return;
        var username = Poe.currentUsername();
        if (!username || !Poe.poeUi.records.length) return;
        if (!confirm('清除這部瀏覽器上目前使用者的出題紀錄？')) return;
        try {
            await Poe.clearGenerations(username);
        } catch (error) {
            Poe.setStatus('未能清除紀錄。');
            return;
        }
        if (Poe.poeUi.historyPage === 0) Poe.poeUi.records = [];
        Poe.poeUi.activeRecord = null;
        Poe.renderHistory();
        Poe.showIdle(Poe.poeUi.filteredCount);
        Poe.setStatus('已清除這部瀏覽器上的出題紀錄。');
        Poe.syncActionButtons();
    }

    Poe.syncActionButtons = function syncActionButtons() {
        var start = document.getElementById('poe-start');
        var again = document.getElementById('poe-again');
        var copy = document.getElementById('poe-copy');
        var cancel = document.getElementById('poe-cancel');
        var instruction = Poe.instructionField();
        var reset = document.getElementById('poe-instruction-reset');
        var mode = document.getElementById('poe-mode');
        var settingsOpen = document.getElementById('poe-settings-open');
        var test = document.getElementById('poe-test');
        var sourceNow = Poe.currentSource();
        var pasteMode = sourceNow === 'paste';
        var singleMode = sourceNow === 'single';
        var canRegenerate = false;
        if (Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.referenceSource === 'single') {
            canRegenerate = !!Poe.poeUi.activeRecord.singleQuestion;
        } else if (Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.referenceSource === 'paste') {
            canRegenerate = !!(Poe.poeUi.activeRecord.pastedReferences && Poe.poeUi.activeRecord.pastedReferences.length);
        } else {
            canRegenerate = !!(Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.referenceIds && Poe.poeUi.activeRecord.referenceIds.length);
        }
        if (start) {
            start.textContent = singleMode ? '根據這一題出題' : (pasteMode ? '根據貼上內容出題' : '根據目前篩選出題');
            var blocked = singleMode ? !Poe.poeUi.pinnedQuestion : (pasteMode ? Poe.poeUi.pasteCount === 0 : (Poe.poeUi.counting || Poe.poeUi.filteredCount === 0));
            start.disabled = Poe.poeUi.busy || blocked;
        }
        if (again) again.disabled = Poe.poeUi.busy || !canRegenerate;
        if (copy) copy.disabled = Poe.poeUi.busy || !(Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.content);
        if (cancel) cancel.hidden = !Poe.poeUi.busy;
        if (instruction) instruction.disabled = !!Poe.poeUi.busy;
        if (reset) reset.disabled = !!Poe.poeUi.busy;
        var pasteInput = Poe.pasteField();
        if (pasteInput) pasteInput.disabled = !!Poe.poeUi.busy;
        if (Poe.poeUi.overlay) {
            Poe.poeUi.overlay.querySelectorAll('input[name="poe-reference-source"]').forEach(function (input) {
                input.disabled = !!Poe.poeUi.busy;
            });
        }
        if (mode) mode.disabled = !!Poe.poeUi.busy;
        if (settingsOpen) settingsOpen.disabled = !!Poe.poeUi.busy;
        if (test) test.disabled = !!Poe.poeUi.busy;
        Poe.syncSettingsBusyState();
        Poe.setEnlargeButtonVisible(!Poe.poeUi.busy && !!(Poe.poeUi.activeRecord && Poe.poeUi.activeRecord.content));
        var dialog = Poe.poeUi.overlay && Poe.poeUi.overlay.querySelector('.poe-dialog');
        if (dialog) dialog.setAttribute('aria-busy', Poe.poeUi.busy ? 'true' : 'false');
    }

    Poe.startElapsed = function startElapsed() {
        Poe.stopElapsed();
        Poe.poeUi.startedAt = Date.now();
        Poe.poeUi.timer = setInterval(function () {
            var node = document.getElementById('poe-elapsed');
            if (!node) return;
            var seconds = Math.floor((Date.now() - Poe.poeUi.startedAt) / 1000);
            node.textContent = '已等待 ' + seconds + ' 秒';
        }, 500);
    }

    Poe.stopElapsed = function stopElapsed() {
        if (Poe.poeUi.timer) clearInterval(Poe.poeUi.timer);
        Poe.poeUi.timer = null;
    }

    Poe.cancelGeneration = function cancelGeneration(silent) {
        if (Poe.poeUi.control) {
            Poe.poeUi.control.cancelled = true;
            if (Poe.poeUi.control.handle) Poe.poeUi.control.handle.cancel();
        }
        if (!silent && Poe.isPoeGenerateModalOpen()) {
            Poe.setStatus(Poe.poeUi.busyAction === 'test' ? '已取消這次測試。' : '已取消這次出題。');
        }
    }
})(PoeGenerate);
