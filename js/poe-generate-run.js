// Generation, model test, copy, and the public entry points.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.generateFromCurrentSource = async function generateFromCurrentSource() {
        if (Poe.currentSource() === 'single') {
            if (!Poe.poeUi.pinnedQuestion || !Poe.poeUi.pinnedQuestion.plainText) {
                Poe.showError('no_reference_questions');
                Poe.syncActionButtons();
                return;
            }
            var singleId = Poe.poeUi.pinnedQuestion.id ? ('單題 ' + Poe.poeUi.pinnedQuestion.id) : '單題';
            await Poe.runGeneration([Poe.poeUi.pinnedQuestion], singleId, 'single');
            return;
        }
        if (Poe.currentSource() === 'paste') {
            var parsed = Poe.pasteQuestions();
            Poe.poeUi.pasteCount = parsed.length;
            Poe.refreshSourceMeta(false);
            Poe.syncActionButtons();
            if (!String(Poe.pasteField() && Poe.pasteField().value || '').trim() || !parsed.length) {
                Poe.showError('empty_paste');
                return;
            }
            var pastedBank = parsed.map(function (item) {
                return { plainText: item.question, answerChi: item.explanation || '' };
            });
            await Poe.runGeneration(pastedBank, '貼上 ' + parsed.length + ' 題', 'paste');
            return;
        }
        var usable = [];
        try {
            usable = await Poe.loadFilteredQuestions();
        } catch (error) {
            Poe.showError('no_reference_questions');
            return;
        }
        Poe.updateMeta(usable.length);
        Poe.syncActionButtons();
        await Poe.runGeneration(usable, Poe.filterSummary(usable.length), 'filter');
    }

    Poe.regenerateActive = async function regenerateActive() {
        var active = Poe.poeUi.activeRecord;
        if (!active) return;
        if (active.referenceSource === 'single' && active.singleQuestion) {
            await Poe.runGeneration([active.singleQuestion], active.filterSummary || '單題', 'single');
            return;
        }
        if (active.referenceSource === 'paste' && active.pastedReferences && active.pastedReferences.length) {
            var pastedBank = active.pastedReferences.map(function (item) {
                return { plainText: item.question, answerChi: item.explanation || '' };
            });
            await Poe.runGeneration(pastedBank, active.filterSummary || '貼上的參考題', 'paste');
            return;
        }
        if (!active.referenceIds) return;
        var questions = await Poe.questionsByIds(active.referenceIds);
        if (!questions.length) {
            Poe.showError('missing_references');
            Poe.syncActionButtons();
            return;
        }
        await Poe.runGeneration(questions, active.filterSummary || '沿用上一批參考題', 'filter');
    }


    Poe.newRequestId = function newRequestId() {
        var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        var out = '';
        for (var i = 0; i < 16; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
        return out;
    }

    Poe.knownGenerationKeys = function knownGenerationKeys() {
        var names = {};
        var content = {};
        (Poe.poeUi.records || []).forEach(function (row) {
            if (!row) return;
            if (row.remoteName) names[row.remoteName] = true;
            var key = Poe.contentDedupeKey(row);
            if (key) content[key] = true;
        });
        return { names: names, content: content };
    }

    Poe.setLoadingTitle = function setLoadingTitle(text) {
        var title = document.getElementById('poe-loading-title');
        if (title) title.textContent = text;
    }

    Poe.sleepMs = function sleepMs(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    Poe.backupMatchesAttempt = function backupMatchesAttempt(item, attempt) {
        if (!item || !attempt) return false;
        if (item.username && item.username !== attempt.username) return false;
        if (!item.modeId || item.modeId !== attempt.modeId) return false;
        if (attempt.source && item.referenceSource && item.referenceSource !== attempt.source) return false;
        var created = Number(item.createdAt) || 0;
        if (!created) return false;
        // Small clock skew only. Older rows are a previous run, not this one.
        if (created < attempt.startedAt - 20000) return false;
        if (created > Date.now() + 20000) return false;
        if (attempt.knownNames && item.remoteName && attempt.knownNames[item.remoteName]) return false;
        var key = Poe.contentDedupeKey(item);
        if (attempt.knownContent && key && attempt.knownContent[key]) return false;
        return true;
    }

    Poe.pickRecoveredBackup = function pickRecoveredBackup(records, attempt) {
        var byId = null;
        var best = null;
        for (var i = 0; i < records.length; i++) {
            var row = records[i];
            if (!row) continue;
            if (row.username && row.username !== attempt.username) continue;
            if (attempt.requestId && row.requestId && row.requestId === attempt.requestId) byId = row;
            if (!Poe.backupMatchesAttempt(row, attempt)) continue;
            if (!best || (Number(row.createdAt) || 0) > (Number(best.createdAt) || 0)) best = row;
        }
        if (byId && (byId.content || byId.remoteName)) return byId;
        return best;
    }

    Poe.recordFromRecoveredBackup = function recordFromRecoveredBackup(backup, attempt) {
        return {
            id: backup.id || (attempt.username + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8)),
            username: attempt.username,
            createdAt: backup.createdAt || Date.now(),
            content: String(backup.content || ''),
            model: backup.model || attempt.model,
            modeId: backup.modeId || attempt.modeId,
            modeName: backup.modeName || attempt.modeName,
            instruction: backup.instruction || attempt.instruction,
            sentCount: backup.sentCount || attempt.sentCount,
            filteredCount: backup.filteredCount || attempt.filteredCount,
            truncated: !!attempt.truncated,
            referenceSource: attempt.source,
            singleQuestion: attempt.singleQuestion || null,
            referenceIds: (backup.referenceIds && backup.referenceIds.length)
                ? backup.referenceIds.slice()
                : (attempt.referenceIds || []).slice(),
            pastedReferences: attempt.pastedReferences || [],
            filterSummary: attempt.summary || '',
            durationMs: backup.durationMs || Math.max(0, Date.now() - attempt.startedAt),
            remoteName: backup.remoteName || '',
            lean: false
        };
    }

    Poe.recoverSavedGeneration = async function recoverSavedGeneration(attempt) {
        var username = attempt && attempt.username;
        if (!username || username !== Poe.currentUsername()) return null;
        Poe.setLoadingTitle('尚未收到回覆。正在查看是否已儲存這次出題…');
        Poe.setStatus('尚未收到回覆。正在查看是否已儲存這次出題…');
        var pauses = [0, 6000];
        for (var i = 0; i < pauses.length; i++) {
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return null;
            if (Poe.poeUi.control && Poe.poeUi.control.cancelled) return null;
            if (pauses[i]) await Poe.sleepMs(pauses[i]);
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return null;
            if (Poe.poeUi.control && Poe.poeUi.control.cancelled) return null;
            var page;
            try {
                page = await Poe.fetchRemoteBackupPage(username, '', Poe.poeUi.control, 30000);
            } catch (error) {
                if (Poe.poeUi.control && Poe.poeUi.control.cancelled) return null;
                continue;
            }
            var match = Poe.pickRecoveredBackup(page.records || [], attempt);
            if (!match) continue;
            if (!match.content && match.remoteName) match = await Poe.fillLeanRemoteRecord(match);
            if (!match || !String(match.content || '').trim()) continue;
            if (match.username && match.username !== username) continue;
            if (!(attempt.requestId && match.requestId === attempt.requestId) && !Poe.backupMatchesAttempt(match, attempt)) continue;
            return match;
        }
        return null;
    }

    Poe.presentGenerationRecord = async function presentGenerationRecord(record, fromBackup, data) {
        if (!Poe.isPoeGenerateModalOpen() || !record || !record.content) return;
        var saved = true;
        try {
            await Poe.saveGeneration(record);
            Poe.poeUi.records = await Poe.listGenerations(Poe.currentUsername());
        } catch (error) {
            saved = false;
            Poe.poeUi.records = [record].concat(Poe.poeUi.records.filter(function (item) { return item.id !== record.id; }));
        }
        Poe.poeUi.historyPage = 0;
        Poe.poeUi.historyCursors = [''];
        Poe.poeUi.historyNextAfter = '';
        Poe.poeUi.historyHasMore = false;
        Poe.poeUi.historyError = '';
        Poe.poeUi.activeRecord = record;
        Poe.showResult(record);
        Poe.renderHistory();
        Poe.syncRemoteHistoryIntoUi(Poe.currentUsername());
        var statusParts = [];
        if (record.modeName) statusParts.push(record.modeName);
        if (record.model) statusParts.push('模型：' + record.model);
        statusParts.push('參考 ' + record.sentCount + ' / ' + record.filteredCount + ' 題');
        if (record.durationMs) statusParts.push('用時 ' + Math.max(1, Math.round(record.durationMs / 1000)) + ' 秒');
        statusParts.push(saved ? '已儲存在這部瀏覽器' : Poe.ERROR_TEXT.save_failed);
        if (fromBackup) statusParts.push('已從儲存的備份取回');
        if (data && data.logged === false) statusParts.push('未能寫入試算表紀錄');
        if (data && data.backedUp === false) statusParts.push('未能備份回覆到試算表');
        Poe.setStatus(statusParts.join(' · '));
    }

    Poe.runGeneration = async function runGeneration(bankQuestions, summary, source) {
        if (Poe.poeUi.busy) return;
        Poe.showPoeTab('compose');
        source = source === 'paste' ? 'paste' : (source === 'single' ? 'single' : 'filter');
        var references = bankQuestions.map(Poe.toReference).filter(function (item) { return item.question; });
        if (!references.length) {
            Poe.showError('no_reference_questions');
            Poe.syncActionButtons();
            return;
        }
        if (!Poe.ensureApiKeyReady()) {
            Poe.syncActionButtons();
            return;
        }
        var filteredCount = references.length;
        var sending = references.slice(0, Poe.CLIENT_SEND_CAP);
        var instruction = Poe.currentInstructionForRequest();
        var mode = Poe.currentMode();
        var model = Poe.currentModel();
        Poe.writeStoredInstruction(instruction);
        Poe.writeStoredMode(mode.id);
        Poe.writeStoredModel(model, Poe.currentProvider());
        Poe.writeStoredProvider(Poe.currentProvider());
        Poe.poeUi.busy = true;
        Poe.poeUi.busyAction = 'generate';
        Poe.poeUi.control = { cancelled: false, handle: null };
        Poe.clearTestBanner();
        Poe.syncActionButtons();
        Poe.showLoading();
        Poe.startElapsed();
        var requestId = Poe.newRequestId();
        var known = Poe.knownGenerationKeys();
        var baselineUser = Poe.currentUsername();
        var baselinePromise = Poe.fetchRemoteBackupPage(baselineUser, '').then(function (page) {
            (page.records || []).forEach(function (row) {
                if (!row || (Number(row.createdAt) || 0) >= Poe.poeUi.startedAt - 5000) return;
                if (row.remoteName) known.names[row.remoteName] = true;
                var key = Poe.contentDedupeKey(row);
                if (key) known.content[key] = true;
            });
        }).catch(function () {});
        Poe.setStatus(filteredCount > sending.length
            ? '正在送出前 ' + sending.length + ' / ' + filteredCount + ' 題參考。'
            : '正在送出 ' + sending.length + ' 題參考。');
        try {
            var data = await Poe.proxyRequest(Poe.withProviderAndApiKey({
                action: 'generateQuestions',
                username: Poe.currentUsername(),
                filteredCount: filteredCount,
                questions: sending,
                instruction: instruction,
                source: source,
                modeId: mode.id,
                model: model,
                requestId: requestId,
                referenceIds: source === 'paste' ? [] : Poe.normalizeReferenceIds(sending.map(function (item) { return item.id; }))
            }), Poe.GENERATE_WAIT_MS, Poe.poeUi.control);
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') Poe.hideGenerateButton();
                Poe.showError(code);
                Poe.focusApiKeyFieldIfMissing(code);
                Poe.setStatus('');
                return;
            }
            var record = {
                id: Poe.currentUsername() + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8),
                username: Poe.currentUsername(),
                createdAt: Date.now(),
                content: String(data.content),
                model: data.model || model,
                modeId: mode.id,
                modeName: mode.name,
                instruction: instruction,
                sentCount: data.sentCount || sending.length,
                filteredCount: data.filteredCount || filteredCount,
                truncated: !!data.truncated || filteredCount > sending.length,
                referenceSource: source,
                singleQuestion: source === 'single' ? (bankQuestions[0] || null) : null,
                referenceIds: source === 'paste' ? [] : Poe.normalizeReferenceIds(sending.map(function (item) { return item.id; })),
                pastedReferences: source === 'paste' ? sending.map(function (item) {
                    return { question: item.question, explanation: item.explanation || '' };
                }) : [],
                filterSummary: summary,
                durationMs: data.durationMs || (Date.now() - Poe.poeUi.startedAt)
            };
            await Poe.presentGenerationRecord(record, false, data);
        } catch (error) {
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (error && error.code === 'cancelled') {
                Poe.showIdle(Poe.poeUi.filteredCount);
                Poe.setStatus('已取消這次出題。');
                return;
            }
            var failCode = error && error.code ? error.code : 'network';
            var recovered = null;
            if (failCode === 'upstream_timeout' || failCode === 'network') {
                try { await baselinePromise; } catch (ignore) {}
                recovered = await Poe.recoverSavedGeneration({
                    username: Poe.currentUsername(),
                    requestId: requestId,
                    modeId: mode.id,
                    modeName: mode.name,
                    model: model,
                    source: source,
                    instruction: instruction,
                    startedAt: Poe.poeUi.startedAt,
                    sentCount: sending.length,
                    filteredCount: filteredCount,
                    truncated: filteredCount > sending.length,
                    summary: summary,
                    referenceIds: source === 'paste' ? [] : Poe.normalizeReferenceIds(sending.map(function (item) { return item.id; })),
                    pastedReferences: source === 'paste' ? sending.map(function (item) {
                        return { question: item.question, explanation: item.explanation || '' };
                    }) : [],
                    singleQuestion: source === 'single' ? (bankQuestions[0] || null) : null,
                    knownNames: known.names,
                    knownContent: known.content
                });
            }
            if (recovered && String(recovered.content || '').trim()) {
                await Poe.presentGenerationRecord(Poe.recordFromRecoveredBackup(recovered, {
                    username: Poe.currentUsername(),
                    modeId: mode.id,
                    modeName: mode.name,
                    model: model,
                    source: source,
                    instruction: instruction,
                    startedAt: Poe.poeUi.startedAt,
                    sentCount: sending.length,
                    filteredCount: filteredCount,
                    truncated: filteredCount > sending.length,
                    summary: summary,
                    referenceIds: source === 'paste' ? [] : Poe.normalizeReferenceIds(sending.map(function (item) { return item.id; })),
                    pastedReferences: source === 'paste' ? sending.map(function (item) {
                        return { question: item.question, explanation: item.explanation || '' };
                    }) : [],
                    singleQuestion: source === 'single' ? (bankQuestions[0] || null) : null
                }), true, null);
                return;
            }
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (Poe.poeUi.control && Poe.poeUi.control.cancelled) {
                Poe.showIdle(Poe.poeUi.filteredCount);
                Poe.setStatus('已取消這次出題。');
                return;
            }
            Poe.showError(failCode);
            Poe.setStatus('');
        } finally {
            Poe.poeUi.busy = false;
            Poe.poeUi.busyAction = '';
            Poe.poeUi.control = null;
            Poe.stopElapsed();
            if (Poe.isPoeGenerateModalOpen()) Poe.syncActionButtons();
        }
    }

    Poe.errorTextFor = function errorTextFor(code, action) {
        if (action === 'test' && code === 'rate_limited') return '測試太頻密，請稍後再試。';
        if (action === 'test' && code === 'upstream_timeout') return '模型測試逾時，請再試一次。';
        if (code === 'missing_api_key') return Poe.ERROR_TEXT.missing_api_key;
        return Poe.ERROR_TEXT[code] || Poe.ERROR_TEXT.server_error;
    }

    Poe.clearTestBanner = function clearTestBanner() {
        var banner = document.getElementById('poe-test-banner');
        if (!banner) return;
        banner.hidden = true;
        banner.className = 'poe-test-banner';
        banner.textContent = '';
    }

    Poe.showTestBanner = function showTestBanner(kind, message) {
        var banner = document.getElementById('poe-test-banner');
        if (!banner) return;
        banner.hidden = false;
        banner.className = 'poe-test-banner is-' + kind;
        banner.textContent = '';
        var title = document.createElement('p');
        title.className = 'poe-test-title';
        title.textContent = kind === 'ok' ? '模型測試成功' : (kind === 'pending' ? '正在測試模型' : '模型測試失敗');
        var body = document.createElement('p');
        body.textContent = message || '';
        banner.appendChild(title);
        banner.appendChild(body);
    }

    Poe.clipReply = function clipReply(text, max) {
        var value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value.length <= max) return value;
        return value.slice(0, max) + '…';
    }

    Poe.testSelectedModel = async function testSelectedModel() {
        if (Poe.poeUi.busy) return;
        Poe.showPoeTab('compose');
        if (!Poe.ensureApiKeyReady()) {
            Poe.syncActionButtons();
            return;
        }
        var model = Poe.currentModel();
        Poe.writeStoredModel(model, Poe.currentProvider());
        Poe.writeStoredProvider(Poe.currentProvider());
        Poe.poeUi.busy = true;
        Poe.poeUi.busyAction = 'test';
        Poe.poeUi.control = { cancelled: false, handle: null };
        Poe.syncActionButtons();
        Poe.showTestBanner('pending', '正在以 ' + Poe.providerLabel(Poe.currentProvider()) + ' 測試模型「' + model + '」。這不會根據篩選出題。');
        Poe.setStatus('正在測試模型…');
        try {
            var data = await Poe.proxyRequest(Poe.withProviderAndApiKey({
                action: 'testModel',
                username: Poe.currentUsername(),
                model: model
            }), 90000, Poe.poeUi.control);
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') Poe.hideGenerateButton();
                Poe.showTestBanner('fail', Poe.errorTextFor(code, 'test'));
                Poe.focusApiKeyFieldIfMissing(code);
                Poe.setStatus('模型測試失敗。');
                return;
            }
            var returned = data.model || model;
            var shown = Poe.clipReply(data.content, 400);
            var note = [];
            if (data.logged === false) note.push('未能寫入試算表紀錄');
            if (data.backedUp === false) note.push('未能備份回覆到試算表');
            if (data.passed === false) {
                Poe.showTestBanner('fail', '模型「' + returned + '」有回應，但內容不是預期的「正常」。回覆：' + shown);
                Poe.setStatus(['模型測試未通過'].concat(note).join(' · '));
                return;
            }
            Poe.showTestBanner('ok', '模型「' + returned + '」有回應。回覆：' + shown);
            Poe.setStatus(['模型測試成功'].concat(note).join(' · '));
        } catch (error) {
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (error && error.code === 'cancelled') {
                Poe.showTestBanner('fail', '已取消這次測試。');
                Poe.setStatus('已取消這次測試。');
                return;
            }
            var failCode = error && error.code ? error.code : 'network';
            Poe.showTestBanner('fail', Poe.errorTextFor(failCode, 'test'));
            Poe.focusApiKeyFieldIfMissing(failCode);
            Poe.setStatus('模型測試失敗。');
        } finally {
            Poe.poeUi.busy = false;
            Poe.poeUi.busyAction = '';
            Poe.poeUi.control = null;
            if (Poe.isPoeGenerateModalOpen()) Poe.syncActionButtons();
        }
    }

    Poe.copyWithFallback = function copyWithFallback(text) {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(function () {
                return Poe.copyWithTextarea(text);
            });
        }
        return Poe.copyWithTextarea(text);
    }

    Poe.copyWithTextarea = function copyWithTextarea(text) {
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.top = '0';
            area.style.left = '0';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.focus();
            area.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
            area.remove();
            if (ok) resolve();
            else reject(new Error('copy'));
        });
    }

    Poe.copyActive = function copyActive() {
        if (!Poe.poeUi.activeRecord || !Poe.poeUi.activeRecord.content) return;
        var button = document.getElementById('poe-copy');
        var original = button ? button.textContent : '複製全部';
        Poe.copyWithFallback(Poe.poeUi.activeRecord.content).then(function () {
            if (button) {
                button.textContent = '✓';
                setTimeout(function () {
                    if (button.textContent === '✓') button.textContent = original;
                }, 1500);
            }
            Poe.setStatus('已複製到剪貼簿。');
        }).catch(function () {
            Poe.setStatus('複製失敗，請手動選取文字。');
        });
    }

    window.openPoeGenerateModal = Poe.openPoeGenerateModal;
    window.openPoeGenerateModalForQuestion = Poe.openPoeGenerateModalForQuestion;
    window.closePoeGenerateModal = Poe.closePoeGenerateModal;
    window.isPoeGenerateModalOpen = Poe.isPoeGenerateModalOpen;
    window.initPoeGenerateFeature = Poe.initPoeGenerateFeature;
    window.logQuestionToolLogin = Poe.logQuestionToolLogin;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', Poe.bindGenerateButton);
    } else {
        Poe.bindGenerateButton();
    }
})(PoeGenerate);
