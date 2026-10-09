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
            id: attempt.recordId
                || backup.id
                || (attempt.username + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8)),
            username: attempt.username,
            createdAt: attempt.startedAt || backup.createdAt || Date.now(),
            content: String(backup.content || ''),
            model: backup.model || attempt.model,
            modeId: backup.modeId || attempt.modeId,
            modeName: backup.modeName || attempt.modeName,
            instruction: backup.instruction || attempt.instruction,
            requestId: attempt.requestId || backup.requestId || '',
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
            incomplete: !String(backup.content || '').trim(),
            lean: false,
            originalContent: String(backup.content || ''),
            thread: []
        };
    }

    Poe.recoverSavedGeneration = async function recoverSavedGeneration(attempt) {
        var username = attempt && attempt.username;
        if (!username || username !== Poe.currentUsername()) return null;
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.setLoadingTitle('尚未收到回覆。正在查看是否已儲存這次出題…');
            Poe.setStatus('尚未收到回覆。正在查看是否已儲存這次出題…');
        }
        var pauses = [0, 6000, 12000];
        for (var i = 0; i < pauses.length; i++) {
            if (Poe.currentUsername() !== username) return null;
            if (Poe.poeUi.control && Poe.poeUi.control.cancelled) return null;
            if (pauses[i]) await Poe.sleepMs(pauses[i]);
            if (Poe.currentUsername() !== username) return null;
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
            if (!match.content && match.remoteName) {
                match = await Poe.fillLeanRemoteRecord(match);
            }
            if (!match || !String(match.content || '').trim()) continue;
            if (match.username && match.username !== username) continue;
            if (!(attempt.requestId && match.requestId === attempt.requestId) && !Poe.backupMatchesAttempt(match, attempt)) continue;
            return match;
        }
        return null;
    }

    Poe.rememberRecordInUi = function rememberRecordInUi(record) {
        if (!record || !record.id) return;
        var others = (Poe.poeUi.records || []).filter(function (item) { return item && item.id !== record.id; });
        Poe.poeUi.records = [record].concat(others);
    }

    Poe.persistGenerationRecord = async function persistGenerationRecord(record) {
        if (!record) return false;
        try {
            await Poe.saveGeneration(record);
            if (record.username === Poe.currentUsername()) {
                try {
                    Poe.poeUi.records = await Poe.listGenerations(record.username);
                } catch (error) {
                    Poe.rememberRecordInUi(record);
                }
            } else {
                Poe.rememberRecordInUi(record);
            }
            return true;
        } catch (error) {
            Poe.rememberRecordInUi(record);
            return false;
        }
    }

    Poe.buildDraftRecord = function buildDraftRecord(attempt) {
        var content = String(attempt.content || '');
        var thread = Array.isArray(attempt.thread) ? attempt.thread.slice() : [];
        var originalContent = attempt.originalContent != null
            ? String(attempt.originalContent)
            : (thread.length >= 2 && thread[1] && thread[1].role === 'assistant'
                ? String(thread[1].content || '')
                : content);
        return {
            id: attempt.recordId
                || (attempt.username + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8)),
            username: attempt.username,
            createdAt: attempt.startedAt || Date.now(),
            content: content,
            originalContent: originalContent,
            thread: thread,
            model: attempt.model || '',
            modeId: attempt.modeId || '',
            modeName: attempt.modeName || '',
            instruction: attempt.instruction || '',
            requestId: attempt.requestId || '',
            sentCount: attempt.sentCount || 0,
            filteredCount: attempt.filteredCount || 0,
            truncated: !!attempt.truncated,
            referenceSource: attempt.source || 'filter',
            singleQuestion: attempt.singleQuestion || null,
            referenceIds: (attempt.referenceIds || []).slice(),
            pastedReferences: attempt.pastedReferences || [],
            filterSummary: attempt.summary || '',
            durationMs: attempt.durationMs || 0,
            incomplete: attempt.incomplete !== false,
            remoteName: attempt.remoteName || '',
            lean: false
        };
    }

    Poe.buildThreadSeedUserMessage = function buildThreadSeedUserMessage(record) {
        var parts = ['【出題請求】'];
        if (record && record.modeName) parts.push('模式：' + record.modeName);
        var instruction = String(record && record.instruction || '').trim();
        if (instruction) {
            parts.push('指示：');
            parts.push(instruction);
        }
        var sent = Number(record && record.sentCount) || 0;
        var source = record && record.referenceSource;
        var sourceLabel = source === 'single' ? '單題參考' : (source === 'paste' ? '貼上參考' : '篩選參考');
        parts.push('來源：' + sourceLabel + (sent ? ('（已附 ' + sent + ' 題參考；追問預設不重送題庫）') : ''));
        parts.push('請根據以上指示與已提供的參考撰寫題目。後續追問會帶上你的回覆，但不會預設重送整份參考題。');
        return parts.join('\n');
    }

    Poe.normalizeThreadMessages = function normalizeThreadMessages(thread) {
        if (!Array.isArray(thread)) return [];
        return thread.map(function (item) {
            if (!item || typeof item !== 'object') return null;
            var role = String(item.role || '').trim().toLowerCase();
            if (role !== 'user' && role !== 'assistant' && role !== 'system') return null;
            var content = String(item.content == null ? '' : item.content).trim();
            if (!content) return null;
            return { role: role, content: content };
        }).filter(Boolean);
    }

    Poe.ensureRecordThread = function ensureRecordThread(record) {
        if (!record) return [];
        var existing = Poe.normalizeThreadMessages(record.thread);
        if (existing.length >= 2) {
            record.thread = existing;
            if (!record.originalContent) {
                var firstAssistant = existing.filter(function (m) { return m.role === 'assistant'; })[0];
                record.originalContent = firstAssistant ? firstAssistant.content : String(record.content || '');
            }
            return record.thread;
        }
        var reply = String(record.originalContent || record.content || '').trim();
        if (!reply) {
            record.thread = existing;
            return record.thread;
        }
        record.originalContent = reply;
        record.thread = [
            { role: 'user', content: Poe.buildThreadSeedUserMessage(record) },
            { role: 'assistant', content: reply }
        ];
        return record.thread;
    }

    Poe.followUpRoundCount = function followUpRoundCount(record) {
        var thread = Poe.normalizeThreadMessages(record && record.thread);
        var assistantTurns = thread.filter(function (m) { return m.role === 'assistant'; }).length;
        return Math.max(0, assistantTurns - 1);
    }

    Poe.presentGenerationRecord = async function presentGenerationRecord(record, fromBackup, data) {
        if (!record) return;
        if (record.content) {
            record.incomplete = false;
            Poe.ensureRecordThread(record);
        }
        var saved = await Poe.persistGenerationRecord(record);
        Poe.poeUi.historyPage = 0;
        Poe.poeUi.historyCursors = [''];
        Poe.poeUi.historyNextAfter = '';
        Poe.poeUi.historyHasMore = false;
        Poe.poeUi.historyError = '';
        Poe.poeUi.activeRecord = record;
        if (Poe.isPoeGenerateModalOpen()) {
            if (record.content) Poe.showResult(record);
            Poe.renderHistory();
            Poe.syncRemoteHistoryIntoUi(Poe.currentUsername());
            var statusParts = [];
            if (record.incomplete) statusParts.push('未完成');
            if (record.modeName) statusParts.push(record.modeName);
            if (record.model) statusParts.push('模型：' + record.model);
            statusParts.push('參考 ' + record.sentCount + ' / ' + record.filteredCount + ' 題');
            if (record.durationMs) statusParts.push('用時 ' + Math.max(1, Math.round(record.durationMs / 1000)) + ' 秒');
            if (record.content) {
                statusParts.push(saved ? '已儲存在這部瀏覽器' : Poe.ERROR_TEXT.save_failed);
            } else {
                statusParts.push('已寫入使用紀錄，待取回內容');
            }
            if (fromBackup) statusParts.push('已從儲存的備份取回');
            if (data && data.logged === false) statusParts.push('未能寫入試算表紀錄');
            if (data && data.backedUp === false) statusParts.push('未能備份回覆到試算表');
            Poe.setStatus(statusParts.join(' · '));
        }
    }

    Poe.runGeneration = async function runGeneration(bankQuestions, summary, source) {
        if (Poe.poeUi.busy) return;
        if (Poe.isPoeGenerateModalOpen()) Poe.showPoeTab('compose');
        source = source === 'paste' ? 'paste' : (source === 'single' ? 'single' : 'filter');
        var references = bankQuestions.map(Poe.toReference).filter(function (item) { return item.question; });
        if (!references.length) {
            if (Poe.isPoeGenerateModalOpen()) {
                Poe.showError('no_reference_questions');
                Poe.syncActionButtons();
            }
            return;
        }
        if (!Poe.ensureApiKeyReady()) {
            if (Poe.isPoeGenerateModalOpen()) Poe.syncActionButtons();
            return;
        }
        var filteredCount = references.length;
        var sending = references.slice(0, Poe.CLIENT_SEND_CAP);
        var instruction = Poe.currentInstructionForRequest();
        var mode = Poe.currentMode();
        var model = Poe.currentModel();
        var username = Poe.currentUsername();
        var referenceIds = source === 'paste' ? [] : Poe.normalizeReferenceIds(sending.map(function (item) { return item.id; }));
        var pastedReferences = source === 'paste' ? sending.map(function (item) {
            return { question: item.question, explanation: item.explanation || '' };
        }) : [];
        var singleQuestion = source === 'single' ? (bankQuestions[0] || null) : null;
        var truncated = filteredCount > sending.length;
        Poe.writeStoredInstruction(instruction);
        Poe.writeStoredMode(mode.id);
        Poe.writeStoredModel(model, Poe.currentProvider());
        Poe.writeStoredProvider(Poe.currentProvider());
        Poe.poeUi.busy = true;
        Poe.poeUi.busyAction = 'generate';
        Poe.poeUi.control = { cancelled: false, handle: null, keepAlive: true };
        Poe.clearTestBanner();
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.syncActionButtons();
            Poe.showLoading();
            Poe.startElapsed();
        }
        var requestId = Poe.newRequestId();
        var startedAt = Date.now();
        Poe.poeUi.startedAt = startedAt;
        var draft = Poe.buildDraftRecord({
            username: username,
            startedAt: startedAt,
            requestId: requestId,
            modeId: mode.id,
            modeName: mode.name,
            model: model,
            source: source,
            instruction: instruction,
            sentCount: sending.length,
            filteredCount: filteredCount,
            truncated: truncated,
            summary: summary,
            referenceIds: referenceIds,
            pastedReferences: pastedReferences,
            singleQuestion: singleQuestion,
            incomplete: true,
            content: ''
        });
        await Poe.persistGenerationRecord(draft);
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.poeUi.activeRecord = draft;
            Poe.renderHistory();
        }
        var known = Poe.knownGenerationKeys();
        var baselinePromise = Poe.fetchRemoteBackupPage(username, '').then(function (page) {
            (page.records || []).forEach(function (row) {
                if (!row || (Number(row.createdAt) || 0) >= startedAt - 5000) return;
                if (row.remoteName) known.names[row.remoteName] = true;
                var key = Poe.contentDedupeKey(row);
                if (key) known.content[key] = true;
            });
        }).catch(function () {});
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.setStatus(truncated
                ? '正在送出前 ' + sending.length + ' / ' + filteredCount + ' 題參考。'
                : '正在送出 ' + sending.length + ' 題參考。');
        }
        var attempt = {
            recordId: draft.id,
            username: username,
            requestId: requestId,
            modeId: mode.id,
            modeName: mode.name,
            model: model,
            source: source,
            instruction: instruction,
            startedAt: startedAt,
            sentCount: sending.length,
            filteredCount: filteredCount,
            truncated: truncated,
            summary: summary,
            referenceIds: referenceIds,
            pastedReferences: pastedReferences,
            singleQuestion: singleQuestion,
            knownNames: known.names,
            knownContent: known.content
        };
        try {
            var data = await Poe.proxyRequest(Poe.withProviderAndApiKey({
                action: 'generateQuestions',
                username: username,
                filteredCount: filteredCount,
                questions: sending,
                instruction: instruction,
                source: source,
                modeId: mode.id,
                model: model,
                requestId: requestId,
                referenceIds: referenceIds
            }), Poe.GENERATE_WAIT_MS, Poe.poeUi.control);
            if (!data || data.ok !== true) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') Poe.hideGenerateButton();
                draft.content = '';
                draft.incomplete = true;
                draft.durationMs = Date.now() - startedAt;
                await Poe.persistGenerationRecord(draft);
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.showError(code);
                    Poe.focusApiKeyFieldIfMissing(code);
                    Poe.setStatus('');
                }
                return;
            }
            var content = String(data.content || '');
            var needsBackupFetch = data.contentViaBackup === true
                || (!content && (data.backupName || data.gitBackup || data.requestId));
            if (needsBackupFetch) {
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.setLoadingTitle('回覆較長，正在取回完整內容…');
                    Poe.setStatus('回覆較長，正在從備份取回完整內容…');
                }
                if (data.backupName) {
                    try {
                        var named = await Poe.fetchAiBackupContent(data.backupName, {
                            control: Poe.poeUi.control,
                            timeoutMs: 90000
                        });
                        if (named && named.content) content = String(named.content);
                    } catch (backupFetchErr) {
                        content = content || '';
                    }
                }
                if (!String(content || '').trim()) {
                    try { await baselinePromise; } catch (ignore) {}
                    var viaList = await Poe.recoverSavedGeneration(attempt);
                    if (viaList && viaList.content) content = String(viaList.content);
                }
            }
            if (!String(content || '').trim()) {
                draft.content = '';
                draft.incomplete = true;
                draft.durationMs = Date.now() - startedAt;
                await Poe.persistGenerationRecord(draft);
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.showError('bad_response');
                    Poe.setStatus('這次出題未完成，已留在使用紀錄。可稍後在「使用紀錄」查看是否已取回內容。');
                }
                return;
            }
            var record = Poe.buildDraftRecord({
                recordId: draft.id,
                username: username,
                startedAt: startedAt,
                requestId: requestId,
                modeId: mode.id,
                modeName: mode.name,
                model: data.model || model,
                source: source,
                instruction: instruction,
                sentCount: data.sentCount || sending.length,
                filteredCount: data.filteredCount || filteredCount,
                truncated: !!data.truncated || truncated,
                summary: summary,
                referenceIds: referenceIds,
                pastedReferences: pastedReferences,
                singleQuestion: singleQuestion,
                incomplete: false,
                content: content,
                originalContent: content,
                durationMs: data.durationMs || (Date.now() - startedAt)
            });
            Poe.ensureRecordThread(record);
            if (data.backupName) record.remoteName = data.backupName;
            await Poe.presentGenerationRecord(record, needsBackupFetch, data);
        } catch (error) {
            var failCode = error && error.code ? error.code : 'network';
            if (failCode === 'cancelled') {
                draft.incomplete = true;
                draft.durationMs = Date.now() - startedAt;
                await Poe.persistGenerationRecord(draft);
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.showIdle(Poe.poeUi.filteredCount);
                    Poe.setStatus('已取消這次出題。未完成的紀錄已留在使用紀錄。');
                }
                return;
            }
            var recovered = null;
            if (failCode === 'upstream_timeout' || Poe.isRetryableProxyCode(failCode)) {
                try { await baselinePromise; } catch (ignore) {}
                recovered = await Poe.recoverSavedGeneration(attempt);
            }
            if (recovered && String(recovered.content || '').trim()) {
                var recoveredRecord = Poe.recordFromRecoveredBackup(recovered, attempt);
                recoveredRecord.id = draft.id;
                recoveredRecord.incomplete = false;
                await Poe.presentGenerationRecord(recoveredRecord, true, null);
                return;
            }
            draft.incomplete = true;
            draft.durationMs = Date.now() - startedAt;
            await Poe.persistGenerationRecord(draft);
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (Poe.poeUi.control && Poe.poeUi.control.cancelled) {
                Poe.showIdle(Poe.poeUi.filteredCount);
                Poe.setStatus('已取消這次出題。未完成的紀錄已留在使用紀錄。');
                return;
            }
            Poe.showError(failCode);
            Poe.setStatus('這次出題未完成，已留在使用紀錄。可稍後在「使用紀錄」查看是否已取回內容。');
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

    Poe.renderFollowUpChips = function renderFollowUpChips() {
        var host = document.getElementById('poe-followup-chips');
        if (!host) return;
        host.innerHTML = '';
        (Poe.FOLLOWUP_CHIPS || []).forEach(function (chip) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'poe-followup-chip';
            btn.setAttribute('data-followup-chip', chip.id);
            btn.textContent = chip.label;
            btn.title = chip.text;
            btn.addEventListener('click', function () {
                var input = document.getElementById('poe-followup-input');
                if (!input || input.disabled) return;
                input.value = chip.text;
                input.focus();
                try {
                    input.setSelectionRange(input.value.length, input.value.length);
                } catch (e) { /* ignore */ }
            });
            host.appendChild(btn);
        });
    }

    Poe.syncFollowUpUi = function syncFollowUpUi() {
        var wrap = document.getElementById('poe-followup');
        if (!wrap) return;
        var record = Poe.poeUi.activeRecord;
        var canFollow = !!(record && String(record.content || '').trim() && !record.incomplete);
        wrap.hidden = !canFollow;
        if (!canFollow) return;
        Poe.ensureRecordThread(record);
        var rounds = Poe.followUpRoundCount(record);
        var meta = document.getElementById('poe-followup-meta');
        if (meta) {
            meta.textContent = rounds > 0
                ? ('已追問 ' + rounds + ' 輪 · 「再生成」會另開新對話')
                : '可對這次回覆追問 · 「再生成」會另開新對話';
        }
        var busy = !!Poe.poeUi.busy;
        var input = document.getElementById('poe-followup-input');
        var send = document.getElementById('poe-followup-send');
        var clear = document.getElementById('poe-followup-clear');
        var refs = document.getElementById('poe-followup-refs');
        if (input) input.disabled = busy;
        if (send) send.disabled = busy;
        if (clear) clear.disabled = busy || rounds === 0;
        if (refs) refs.disabled = busy;
        wrap.querySelectorAll('.poe-followup-chip').forEach(function (chip) {
            chip.disabled = busy;
        });
    }

    Poe.clearFollowUpThread = async function clearFollowUpThread() {
        var record = Poe.poeUi.activeRecord;
        if (!record || Poe.poeUi.busy) return;
        var original = String(record.originalContent || '').trim();
        if (!original) {
            Poe.ensureRecordThread(record);
            original = String(record.originalContent || record.content || '').trim();
        }
        if (!original) return;
        record.content = original;
        record.originalContent = original;
        record.thread = [
            { role: 'user', content: Poe.buildThreadSeedUserMessage(record) },
            { role: 'assistant', content: original }
        ];
        await Poe.persistGenerationRecord(record);
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.showResult(record);
            Poe.renderHistory();
            Poe.setStatus('已清空追問，保留首次回覆。');
            Poe.syncActionButtons();
            Poe.syncFollowUpUi();
        }
    }

    Poe.collectFollowUpReferences = async function collectFollowUpReferences(record) {
        if (!record) return [];
        if (record.referenceSource === 'single' && record.singleQuestion) {
            return [Poe.toReference(record.singleQuestion)].filter(function (item) { return item.question; });
        }
        if (record.referenceSource === 'paste' && record.pastedReferences && record.pastedReferences.length) {
            return record.pastedReferences.map(function (item) {
                return {
                    id: '',
                    examination: '',
                    year: '',
                    questionType: '',
                    concepts: '',
                    question: String(item.question || ''),
                    explanation: String(item.explanation || '')
                };
            }).filter(function (item) { return item.question; });
        }
        if (record.referenceIds && record.referenceIds.length) {
            var questions = await Poe.questionsByIds(record.referenceIds);
            return questions.map(Poe.toReference).filter(function (item) { return item.question; });
        }
        return [];
    }

    Poe.sendFollowUp = async function sendFollowUp() {
        if (Poe.poeUi.busy) return;
        var record = Poe.poeUi.activeRecord;
        if (!record || !String(record.content || '').trim()) {
            Poe.showError('no_active_reply');
            return;
        }
        var input = document.getElementById('poe-followup-input');
        var text = input ? String(input.value || '').trim() : '';
        if (!text) {
            Poe.showError('empty_followup');
            return;
        }
        if (!Poe.ensureApiKeyReady()) return;

        var thread = Poe.ensureRecordThread(record).slice();
        thread.push({ role: 'user', content: text });
        var includeRefs = !!(document.getElementById('poe-followup-refs') && document.getElementById('poe-followup-refs').checked);
        var questions = [];
        if (includeRefs) {
            questions = await Poe.collectFollowUpReferences(record);
            if (!questions.length) {
                Poe.setStatus('找不到可附上的參考題，已改為不附參考繼續追問。');
                includeRefs = false;
            }
        }

        Poe.poeUi.busy = true;
        Poe.poeUi.busyAction = 'continue';
        Poe.poeUi.control = { cancelled: false, handle: null, keepAlive: true };
        Poe.clearTestBanner();
        if (Poe.isPoeGenerateModalOpen()) {
            Poe.syncActionButtons();
            Poe.syncFollowUpUi();
            Poe.showLoading();
            Poe.setLoadingTitle('正在追問…');
            Poe.startElapsed();
            Poe.setStatus(includeRefs ? '正在送出追問（含參考題）…' : '正在送出追問…');
        }

        var requestId = Poe.newRequestId();
        var startedAt = Date.now();
        try {
            var payload = Poe.withProviderAndApiKey({
                action: 'continueGeneration',
                username: Poe.currentUsername(),
                messages: thread,
                model: Poe.currentModel(),
                modeId: record.modeId || Poe.currentMode().id,
                source: record.referenceSource || 'filter',
                requestId: requestId,
                includeReferences: includeRefs,
                filteredCount: record.filteredCount || questions.length || 0,
                referenceIds: includeRefs ? (record.referenceIds || []).slice() : []
            });
            if (includeRefs) payload.questions = questions.slice(0, Poe.CLIENT_SEND_CAP);
            var data = await Poe.proxyRequest(payload, Poe.GENERATE_WAIT_MS, Poe.poeUi.control);
            if (!data || data.ok !== true) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') Poe.hideGenerateButton();
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.showError(code);
                    Poe.focusApiKeyFieldIfMissing(code);
                    Poe.showResult(record);
                    Poe.setStatus('');
                }
                return;
            }
            var reply = String(data.content || '').trim();
            if (!reply) {
                if (Poe.isPoeGenerateModalOpen()) {
                    Poe.showError('empty_response');
                    Poe.showResult(record);
                }
                return;
            }
            // Prefer backup body when the proxy says the inline reply was truncated.
            if (data.contentViaBackup === true || (!reply && data.backupName)) {
                if (data.backupName) {
                    try {
                        var named = await Poe.fetchAiBackupContent(data.backupName, {
                            control: Poe.poeUi.control,
                            timeoutMs: 90000
                        });
                        if (named && named.content) reply = String(named.content).trim() || reply;
                    } catch (backupErr) { /* keep inline */ }
                }
            }
            thread.push({ role: 'assistant', content: reply });
            record.thread = thread;
            record.content = reply;
            if (!record.originalContent) record.originalContent = reply;
            record.model = data.model || record.model || Poe.currentModel();
            record.durationMs = (Number(record.durationMs) || 0) + (Number(data.durationMs) || (Date.now() - startedAt));
            record.incomplete = false;
            if (data.backupName) record.remoteName = data.backupName;
            await Poe.persistGenerationRecord(record);
            if (input) input.value = '';
            if (Poe.isPoeGenerateModalOpen()) {
                Poe.poeUi.activeRecord = record;
                Poe.showResult(record);
                Poe.renderHistory();
                var rounds = Poe.followUpRoundCount(record);
                Poe.setStatus('追問完成（第 ' + rounds + ' 輪）'
                    + (data.model ? (' · 模型：' + data.model) : '')
                    + (data.durationMs ? (' · 用時 ' + Math.max(1, Math.round(data.durationMs / 1000)) + ' 秒') : ''));
            }
        } catch (error) {
            var failCode = error && error.code ? error.code : 'network';
            if (Poe.isPoeGenerateModalOpen()) {
                if (failCode === 'cancelled') {
                    Poe.showResult(record);
                    Poe.setStatus('已取消這次追問。');
                } else {
                    Poe.showError(failCode);
                    Poe.showResult(record);
                }
            }
        } finally {
            Poe.poeUi.busy = false;
            Poe.poeUi.busyAction = '';
            Poe.poeUi.control = null;
            Poe.stopElapsed();
            if (Poe.isPoeGenerateModalOpen()) {
                Poe.syncActionButtons();
                Poe.syncFollowUpUi();
            }
        }
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
