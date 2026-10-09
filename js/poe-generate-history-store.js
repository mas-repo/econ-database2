// Local generation history and the remote backup sync.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.idbRequest = function idbRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    Poe.transactionDone = function transactionDone(tx) {
        return new Promise(function (resolve, reject) {
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error || new Error('aborted')); };
        });
    }

    Poe.openGenerationDb = function openGenerationDb() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) {
                reject(new Error('no indexedDB'));
                return;
            }
            var request = window.indexedDB.open('econPoeGenerations', 1);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains('generations')) {
                    var store = db.createObjectStore('generations', { keyPath: 'id' });
                    store.createIndex('byUser', 'username', { unique: false });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    Poe.ensureStore = async function ensureStore() {
        if (Poe.poeUi.storeMode) return Poe.poeUi.storeMode;
        try {
            Poe.poeUi.db = await Poe.openGenerationDb();
            Poe.poeUi.storeMode = 'idb';
        } catch (error) {
            Poe.poeUi.storeMode = 'local';
        }
        return Poe.poeUi.storeMode;
    }

    Poe.readLocal = function readLocal() {
        try {
            var raw = localStorage.getItem(Poe.LOCAL_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    Poe.writeLocal = function writeLocal(records) {
        var next = records.slice();
        var lastError = null;
        while (next.length) {
            try {
                localStorage.setItem(Poe.LOCAL_KEY, JSON.stringify(next));
                return;
            } catch (error) {
                lastError = error;
                if (next.length === 1) break;
                next = next.slice(Math.ceil(next.length / 2));
            }
        }
        throw lastError || new Error('quota');
    }

    Poe.listGenerations = async function listGenerations(username) {
        var mode = await Poe.ensureStore();
        if (mode === 'local') {
            return Poe.readLocal()
                .filter(function (record) { return record.username === username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
        }
        var index = Poe.poeUi.db.transaction('generations', 'readonly').objectStore('generations').index('byUser');
        var rows = await Poe.idbRequest(index.getAll(username));
        return (rows || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    }

    Poe.saveGeneration = async function saveGeneration(record) {
        var mode = await Poe.ensureStore();
        if (mode === 'local') {
            var all = Poe.readLocal().filter(function (item) { return item.id !== record.id; });
            all.push(record);
            var mine = all
                .filter(function (item) { return item.username === record.username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
            var keep = {};
            mine.slice(0, Poe.HISTORY_LIMIT).forEach(function (item) { keep[item.id] = true; });
            Poe.writeLocal(all.filter(function (item) {
                return item.username !== record.username || keep[item.id];
            }));
            return;
        }
        var writeTx = Poe.poeUi.db.transaction('generations', 'readwrite');
        writeTx.objectStore('generations').put(record);
        await Poe.transactionDone(writeTx);
        var rows = await Poe.listGenerations(record.username);
        var extra = rows.slice(Poe.HISTORY_LIMIT);
        if (!extra.length) return;
        var tx = Poe.poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        extra.forEach(function (item) { store.delete(item.id); });
        await Poe.transactionDone(tx);
    }

    Poe.deleteGeneration = async function deleteGeneration(id) {
        var mode = await Poe.ensureStore();
        if (mode === 'local') {
            Poe.writeLocal(Poe.readLocal().filter(function (record) { return record.id !== id; }));
            return;
        }
        var tx = Poe.poeUi.db.transaction('generations', 'readwrite');
        tx.objectStore('generations').delete(id);
        await Poe.transactionDone(tx);
    }

    Poe.clearGenerations = async function clearGenerations(username) {
        var mode = await Poe.ensureStore();
        if (mode === 'local') {
            Poe.writeLocal(Poe.readLocal().filter(function (record) { return record.username !== username; }));
            return;
        }
        var rows = await Poe.listGenerations(username);
        if (!rows.length) return;
        var tx = Poe.poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        rows.forEach(function (record) { store.delete(record.id); });
        await Poe.transactionDone(tx);
    }

    Poe.remoteBackupCreatedAt = function remoteBackupCreatedAt(backup, name) {
        var parsed = Date.parse(String(backup && backup.createdAt || ''));
        if (isFinite(parsed) && parsed > 0) return parsed;
        var m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(name || ''));
        if (!m) return 0;
        // Backup filenames use the Apps Script timezone (Asia/Hong_Kong).
        parsed = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00');
        return isFinite(parsed) ? parsed : 0;
    }

    // Remote list pages are generateQuestions-only. continueGeneration is
    // accepted here defensively; Git files labeled "reply" (追問) are not listed.
    Poe.mapRemoteBackup = function mapRemoteBackup(backup, username) {
        if (!backup || typeof backup !== 'object') return null;
        var action = String(backup.action || '');
        if (action && action !== 'generateQuestions' && action !== 'continueGeneration') return null;
        var name = String(backup.name || '').replace(/^.*\//, '');
        var content = String(backup.content == null ? '' : backup.content);
        var source = backup.referenceSource || backup.source || 'filter';
        source = source === 'paste' ? 'paste' : (source === 'single' ? 'single' : 'filter');
        var createdAt = Poe.remoteBackupCreatedAt(backup, name);
        var id = name
            ? ('remote:' + name)
            : ('remote:' + username + ':' + String(createdAt || Date.now()));
        var lean = backup.lean === true || !content;
        return {
            id: id,
            username: username,
            createdAt: createdAt || Date.now(),
            content: content,
            contentPreview: String(backup.contentPreview || ''),
            contentChars: Number(backup.contentChars) || content.length || 0,
            model: String(backup.model || ''),
            modeId: String(backup.modeId || ''),
            modeName: String(backup.modeName || ''),
            requestId: String(backup.requestId || ''),
            instruction: String(backup.instruction || ''),
            sentCount: Number(backup.sentCount) || 0,
            filteredCount: Number(backup.filteredCount) || Number(backup.sentCount) || 0,
            truncated: false,
            referenceSource: source,
            referenceIds: Poe.normalizeReferenceIds(backup.referenceIds),
            pastedReferences: [],
            singleQuestion: null,
            filterSummary: '',
            durationMs: Number(backup.durationMs) || 0,
            remoteName: name,
            lean: lean
        };
    }

    Poe.contentDedupeKey = function contentDedupeKey(record) {
        return String(record && record.content || '').replace(/\s+/g, ' ').trim();
    }

    Poe.mergeGenerationRecords = function mergeGenerationRecords(localRecords, remoteRecords) {
        var merged = [];
        var byId = {};
        var byContent = {};
        var byRequest = {};

        function prefer(existing, next) {
            if (!existing) return next;
            // Keep local rows that still have reference ids / pasted stems.
            var existingLocal = String(existing.id || '').indexOf('remote:') !== 0;
            var nextLocal = String(next.id || '').indexOf('remote:') !== 0;
            if (existingLocal && !nextLocal) {
                if (!existing.content && next.content) {
                    existing.content = next.content;
                    existing.incomplete = false;
                }
                if (!existing.modeId && next.modeId) existing.modeId = next.modeId;
                if (!existing.modeName && next.modeName) existing.modeName = next.modeName;
                if (!existing.instruction && next.instruction) existing.instruction = next.instruction;
                if (!existing.model && next.model) existing.model = next.model;
                if (!existing.remoteName && next.remoteName) existing.remoteName = next.remoteName;
                if (existing.lean && next.content) existing.lean = false;
                if ((!existing.referenceIds || !existing.referenceIds.length) && next.referenceIds && next.referenceIds.length) {
                    existing.referenceIds = next.referenceIds.slice();
                }
                return existing;
            }
            if (!existing.content && next.content) {
                next.incomplete = false;
                return next;
            }
            if (existing.incomplete && next.content && !next.incomplete) {
                next.id = existing.id;
                next.referenceIds = existing.referenceIds && existing.referenceIds.length
                    ? existing.referenceIds
                    : next.referenceIds;
                next.pastedReferences = existing.pastedReferences || next.pastedReferences || [];
                next.filterSummary = existing.filterSummary || next.filterSummary || '';
                next.singleQuestion = existing.singleQuestion || next.singleQuestion || null;
                next.incomplete = false;
                return next;
            }
            if ((next.modeName || next.instruction) && !(existing.modeName || existing.instruction)) return next;
            if ((next.createdAt || 0) > (existing.createdAt || 0)) {
                if (!next.referenceIds || !next.referenceIds.length) {
                    next.referenceIds = existing.referenceIds || [];
                    next.pastedReferences = existing.pastedReferences || [];
                    next.filterSummary = next.filterSummary || existing.filterSummary || '';
                }
                return next;
            }
            return existing;
        }

        function add(record) {
            if (!record || !record.id) return;
            var existing = byId[record.id];
            var key = Poe.contentDedupeKey(record);
            var requestId = String(record.requestId || '').trim();
            if (!existing && key && byContent[key]) existing = byContent[key];
            if (!existing && requestId && byRequest[requestId]) existing = byRequest[requestId];
            var chosen = prefer(existing, record);
            if (existing && existing !== chosen) {
                merged = merged.filter(function (item) { return item !== existing; });
                delete byId[existing.id];
                var oldKey = Poe.contentDedupeKey(existing);
                if (oldKey && byContent[oldKey] === existing) delete byContent[oldKey];
                var oldRequest = String(existing.requestId || '').trim();
                if (oldRequest && byRequest[oldRequest] === existing) delete byRequest[oldRequest];
            }
            if (!byId[chosen.id]) merged.push(chosen);
            byId[chosen.id] = chosen;
            var chosenKey = Poe.contentDedupeKey(chosen);
            if (chosenKey) byContent[chosenKey] = chosen;
            var chosenRequest = String(chosen.requestId || '').trim();
            if (chosenRequest) byRequest[chosenRequest] = chosen;
        }

        (localRecords || []).forEach(add);
        (remoteRecords || []).forEach(add);
        merged.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return merged.slice(0, Poe.HISTORY_LIMIT);
    }

    Poe.fetchRemoteBackupPage = async function fetchRemoteBackupPage(username, afterName, control, timeoutMs) {
        if (!username || !Poe.proxyUrl()) return { records: [], hasMore: false, nextAfter: '' };
        var payload = {
            action: 'listAiBackups',
            username: username
        };
        if (afterName) payload.after = afterName;
        var data = await Poe.proxyRequest(payload, timeoutMs || 90000, control || null);
        if (!data || data.ok !== true || !Array.isArray(data.backups)) {
            var failure = new Error('history');
            failure.code = data && data.error ? data.error : 'server_error';
            throw failure;
        }
        var records = data.backups
            .map(function (item) { return Poe.mapRemoteBackup(item, username); })
            .filter(Boolean)
            .slice(0, Poe.HISTORY_LIMIT);
        var nextAfter = String(data.nextAfter || '');
        if (!nextAfter && records.length) nextAfter = String(records[records.length - 1].remoteName || '');
        return {
            records: records,
            hasMore: data.hasMore === true && !!nextAfter,
            nextAfter: nextAfter
        };
    }


    Poe.fetchAiBackupContent = async function fetchAiBackupContent(name, options) {
        options = options || {};
        var username = Poe.currentUsername();
        if (!username || !name) return null;
        var offset = 0;
        var parts = [];
        var meta = null;
        var chunkLimit = Poe.BACKUP_CONTENT_CHUNK_CHARS || 40000;
        var guard = 0;
        while (guard < 40) {
            guard += 1;
            if (options.control && options.control.cancelled) return null;
            var payload = {
                action: 'getAiBackup',
                username: username,
                name: name,
                offset: offset,
                limit: chunkLimit
            };
            if (options.owner) payload.owner = options.owner;
            var data = await Poe.proxyRequest(payload, options.timeoutMs || 90000, options.control || null);
            if (!data || data.ok !== true || !data.backup) return null;
            if (!meta) meta = data.backup;
            parts.push(String(data.backup.content == null ? '' : data.backup.content));
            var chunkLen = String(data.backup.content == null ? '' : data.backup.content).length;
            var nextOffset = (Number(data.contentOffset) || offset) + chunkLen;
            if (data.contentComplete === true || chunkLen === 0) break;
            if (nextOffset <= offset) break;
            offset = nextOffset;
        }
        if (!meta) return null;
        meta.content = parts.join('');
        meta.name = String(meta.name || name);
        return meta;
    }

    Poe.fillLeanRemoteRecord = async function fillLeanRemoteRecord(record) {
        if (!record || !record.lean || record.content || !record.remoteName) return record;
        var username = Poe.currentUsername();
        if (!username) return record;
        try {
            var owner = record.owner || record.username || '';
            var options = { timeoutMs: 90000, control: null };
            if (owner && owner !== username) options.owner = owner;
            var filledBackup = await Poe.fetchAiBackupContent(record.remoteName, options);
            var filled = filledBackup ? Poe.mapRemoteBackup(filledBackup, owner || username) : null;
            if (!filled || !filled.content) return record;
            record.content = filled.content;
            record.contentChars = filled.contentChars || filled.content.length;
            record.contentPreview = filled.contentPreview || record.contentPreview || '';
            if (!record.model && filled.model) record.model = filled.model;
            if (!record.modeId && filled.modeId) record.modeId = filled.modeId;
            if (!record.modeName && filled.modeName) record.modeName = filled.modeName;
            if (!record.instruction && filled.instruction) record.instruction = filled.instruction;
            if (!record.referenceSource && filled.referenceSource) record.referenceSource = filled.referenceSource;
            if (!record.sentCount && filled.sentCount) record.sentCount = filled.sentCount;
            if (!record.filteredCount && filled.filteredCount) record.filteredCount = filled.filteredCount;
            if (!record.durationMs && filled.durationMs) record.durationMs = filled.durationMs;
            if ((!record.referenceIds || !record.referenceIds.length) && filled.referenceIds && filled.referenceIds.length) {
                record.referenceIds = filled.referenceIds.slice();
            }
            if (!record.requestId && filled.requestId) record.requestId = filled.requestId;
            record.lean = false;
            record.incomplete = false;
            try { await Poe.saveGeneration(record); } catch (error) {}
        } catch (error) {
            // Keep the lean row selectable after a later retry.
        }
        return record;
    }

    Poe.syncRemoteHistory = async function syncRemoteHistory(username) {
        if (!username) return null;
        var local = [];
        try {
            local = await Poe.listGenerations(username);
        } catch (error) {
            local = [];
        }
        var remotePage;
        try {
            remotePage = await Poe.fetchRemoteBackupPage(username, '');
        } catch (error) {
            return null;
        }
        var remote = remotePage.records || [];
        if (!remote.length) {
            return { records: local, hasMore: false, nextAfter: '' };
        }
        var merged = Poe.mergeGenerationRecords(local, remote);
        for (var i = 0; i < merged.length; i++) {
            var row = merged[i];
            if (!row || !row.content) continue;
            var known = local.some(function (item) {
                return item && (item.id === row.id || (Poe.contentDedupeKey(item) && Poe.contentDedupeKey(item) === Poe.contentDedupeKey(row)));
            });
            if (known && String(row.id || '').indexOf('remote:') !== 0) continue;
            try {
                await Poe.saveGeneration(row);
            } catch (error) {
                // Quota or private-mode storage failures must not block the UI.
            }
        }
        var listed;
        try {
            listed = await Poe.listGenerations(username);
        } catch (error) {
            listed = merged;
        }
        return {
            records: listed,
            hasMore: remotePage.hasMore === true,
            nextAfter: remotePage.nextAfter || ''
        };
    }


    Poe.syncRemoteHistoryIntoUi = function syncRemoteHistoryIntoUi(username, showLoading) {
        if (!username) return;
        var token = ++Poe.poeUi.historyLoadToken;
        var previousPage = Poe.poeUi.historyPage;
        if (showLoading) {
            Poe.poeUi.historyPage = 0;
            Poe.poeUi.historyLoading = true;
            Poe.poeUi.historyError = '';
            Poe.renderHistory();
        }
        Poe.syncRemoteHistory(username).then(function (payload) {
            if (token !== Poe.poeUi.historyLoadToken) return;
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return;
            Poe.poeUi.historyLoading = false;
            if (!payload) {
                if (showLoading) Poe.poeUi.historyPage = previousPage;
                Poe.renderHistory();
                return;
            }
            Poe.poeUi.historyPage = 0;
            Poe.poeUi.records = payload.records || [];
            Poe.poeUi.historyHasMore = payload.hasMore === true && !!payload.nextAfter;
            Poe.poeUi.historyNextAfter = payload.nextAfter || '';
            Poe.poeUi.historyCursors = [''];
            if (Poe.poeUi.historyHasMore) Poe.poeUi.historyCursors[1] = Poe.poeUi.historyNextAfter;
            Poe.poeUi.historyError = '';
            if (Poe.poeUi.activeRecord) {
                var activeId = Poe.poeUi.activeRecord.id;
                var refreshed = Poe.poeUi.records.filter(function (item) { return item.id === activeId; })[0];
                if (refreshed) Poe.poeUi.activeRecord = refreshed;
            }
            Poe.renderHistory();
        }).catch(function () {
            if (token !== Poe.poeUi.historyLoadToken) return;
            Poe.poeUi.historyLoading = false;
            if (showLoading) Poe.poeUi.historyPage = previousPage;
            Poe.renderHistory();
        });
    }
})(PoeGenerate);
