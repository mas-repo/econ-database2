// Git sync when the proxy sets githubSync. Uploads still go through Apps
// Script with the server write token. Downloads prefer a short-lived read
// credential (issueSharedReadToken) and fall back to syncDataDownload.
// Auto-sync is a local preference only (localStorage).

var GIT_AUTO_SYNC_KEY = 'econ_git_auto_sync';
var gitSyncState = {
    allowed: false,
    busy: false,
    pendingAuto: false,
    suppressAuto: false,
    localChanged: false,
    accessPromise: null
};

var GIT_ERROR_TEXT = {
    feature_unavailable: '沒有使用 Git 同步的權限',
    github_not_configured: 'GitHub 同步尚未在伺服器設定',
    github_not_found: 'GitHub 上還沒有題庫檔案',
    github_error: 'GitHub 同步失敗',
    bad_request: '題庫資料格式不正確',
    payload_too_large: '題庫太大，無法上傳',
    rate_limited: '操作太頻繁，請稍後再試',
    network: '無法連線到同步服務',
    server_error: '同步服務發生錯誤',
    schema_too_new: '共用題庫是由較新版本寫入的，請先更新網頁再上傳',
    schema_version_stale: '共用題庫是由較新版本寫入的，請先更新網頁再上傳',
    schema_unreadable: '無法安全載入較新格式的題庫，請先更新網頁',
    schema_inconsistent: '分片 schemaVersion 不一致，已停止同步',
    shards_missing: '雲端出版社分片缺失或不完整，已停止同步',
    combined_retired: '合併題庫 database.json 已停用',
    validation_failed: '上傳已拒絕：題目欄位驗證失敗',
    unknown_publisher: '上傳已拒絕：有題目的出版社不是 HKEAA 或 雅集出版社',
    empty_shard_refused: '上傳已拒絕：不可覆寫空白分片（請確認 wipe）',
    nothing_to_upload: '題庫與雲端相同，無需上傳',
    timeout: '同步逾時，請再試一次（大題庫上傳可能需數分鐘）'
};

function gitProxyUrl() {
    if (typeof CONFIG === 'undefined' || !CONFIG.POE_PROXY_WEB_APP_URL) return '';
    return String(CONFIG.POE_PROXY_WEB_APP_URL).trim();
}

function gitUsername() {
    if (!window.authManager || !window.authManager.currentUser) return '';
    return String(window.authManager.currentUser).trim().toLowerCase();
}

function readAutoSync() {
    try {
        return localStorage.getItem(GIT_AUTO_SYNC_KEY) === '1';
    } catch (error) {
        return false;
    }
}

function writeAutoSync(on) {
    try {
        localStorage.setItem(GIT_AUTO_SYNC_KEY, on ? '1' : '0');
    } catch (error) {
        // Preference only. The upload still works from the buttons.
    }
}

function gitErrorMessage(code) {
    return GIT_ERROR_TEXT[code] || '同步失敗';
}

function gitFailureText(error) {
    if (error && (error.code === 'schema_too_new' || error.code === 'schema_version_stale')) {
        if (typeof schemaNewerUploadMessage === 'function') {
            return schemaNewerUploadMessage(error.cloudSchemaVersion);
        }
        return GIT_ERROR_TEXT.schema_too_new;
    }
    if (error && error.code === 'schema_unreadable') {
        return error.message || GIT_ERROR_TEXT.schema_unreadable;
    }
    if (error && error.code === 'validation_failed') {
        var detail = error.message ? String(error.message).trim() : '';
        if (detail) return detail.length > 420 ? detail.slice(0, 419) + '…' : detail;
        return GIT_ERROR_TEXT.validation_failed;
    }
    if (error && error.code === 'unknown_publisher') {
        var unk = error.message ? String(error.message).trim() : '';
        if (unk) return unk.length > 420 ? unk.slice(0, 419) + '…' : unk;
        return GIT_ERROR_TEXT.unknown_publisher;
    }
    if (error && error.code === 'empty_shard_refused') {
        return error.message || GIT_ERROR_TEXT.empty_shard_refused;
    }
    if (error && (error.code === 'schema_inconsistent' || error.code === 'shards_missing' || error.code === 'combined_retired')) {
        return (error.message && String(error.message).indexOf('token') === -1)
            ? String(error.message)
            : GIT_ERROR_TEXT[error.code];
    }
    if (error && error.code && GIT_ERROR_TEXT[error.code]) return GIT_ERROR_TEXT[error.code];
    var message = error && error.message ? String(error.message) : '';
    if (message && message.length <= 80 && message.indexOf('token') === -1 && message.indexOf('github.com') === -1) {
        return message;
    }
    return gitErrorMessage(error && error.code ? error.code : 'network');
}

// Schema gate reads publisher shards only. Missing required shard or unequal
// schemaVersion throws. Combined database.json is never consulted.
async function readCloudShardStrict(rel, label) {
    if (typeof fetchSharedJsonDirectOrProxy !== 'function') {
        var unavailable = new Error('無法讀取雲端' + label + '分片。已停止，不會改讀合併題庫。');
        unavailable.code = 'shards_missing';
        throw unavailable;
    }
    try {
        var direct = await fetchSharedJsonDirectOrProxy(rel, 180000);
        if (direct && direct.data) return direct.data;
    } catch (err) {
        var code = err && err.code ? String(err.code) : '';
        if (code === 'github_not_found') {
            var missing = new Error('雲端' + label + '分片缺失（' + rel + '）。已停止，不會改讀合併題庫。');
            missing.code = 'shards_missing';
            throw missing;
        }
        if (err && err.code) throw err;
        var failed = new Error(code || 'github_error');
        failed.code = code || 'github_error';
        throw failed;
    }
    var empty = new Error('雲端' + label + '分片缺失（' + rel + '）。已停止，不會改讀合併題庫。');
    empty.code = 'shards_missing';
    throw empty;
}

function throwShardSchemaStatus(status) {
    if (!status || status.ok) return;
    var error = new Error(status.message || status.code || 'github_error');
    error.code = status.code || 'github_error';
    if (typeof status.hkeaa === 'number' || typeof status.aristo === 'number') {
        error.cloudSchemaVersion = Math.max(Number(status.hkeaa) || 0, Number(status.aristo) || 0);
    }
    throw error;
}

function setGitStatus(text, kind) {
    var node = document.getElementById('git-sync-status');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'git-sync-status' + (kind ? ' is-' + kind : '');
}

function setGitBusy(busy) {
    gitSyncState.busy = busy;
    ['git-upload-btn', 'git-download-btn', 'git-reconcile-btn'].forEach(function (id) {
        var button = document.getElementById(id);
        if (button) button.disabled = busy;
    });
}

function showGitPanel(show) {
    var panel = document.getElementById('git-sync-panel');
    if (!panel) return;
    if (show) panel.hidden = false;
    else panel.hidden = true;
}

function parseGitProxyJson(text) {
    var cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/^\)\]\}',?\n/, '');
    return JSON.parse(cleaned);
}

// Match the AI出題 client: only short connection-style failures retry.
// A parsed JSON body (ok:true or ok:false) is never retried.
var GIT_PROXY_RETRY_MAX = 3;
var GIT_PROXY_RETRY_BASE_MS = 1200;
// Bank upload (dirty publisher shards only) can exceed 3 minutes for multi-MB JSON
// through Apps Script → GitHub. Uploads get 15 min per file so one AbortController
// does not kill a still-running AS write. Combined database.json is not written.
var GIT_PROXY_UPLOAD_TIMEOUT_MS = 900000;

function gitProxyError(code) {
    var error = new Error(code || 'network');
    error.code = code || 'network';
    return error;
}

function isRetryableGitProxyCode(code) {
    return code === 'network' || code === 'bad_response' || code === 'empty_response';
}

function gitProxyActionName(payload) {
    return payload && payload.action ? String(payload.action) : 'unknown';
}

async function gitProxyRequestOnce(payload, timeoutMs) {
    var url = gitProxyUrl();
    if (!url) throw gitProxyError('network');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
        var response = await fetch(url, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        // A body that already started reading must not be thrown away for a
        // later retry. Parse what arrived; a real {ok:false} reply returns once.
        var text = await response.text();
        if (!String(text || '').trim()) throw gitProxyError('empty_response');
        try {
            return parseGitProxyJson(text);
        } catch (error) {
            throw gitProxyError('bad_response');
        }
    } catch (error) {
        // AbortController.abort() yields DOMException AbortError with numeric
        // .code (20). Treat that as our timeout, not a gitProxyError code.
        if (error && error.name === 'AbortError') throw gitProxyError('timeout');
        if (error && typeof error.code === 'string' && error.code) throw error;
        throw gitProxyError('network');
    } finally {
        clearTimeout(timer);
    }
}

async function gitProxyRequest(payload, timeoutMs) {
    var action = gitProxyActionName(payload);
    var lastError = null;
    for (var attempt = 1; attempt <= GIT_PROXY_RETRY_MAX; attempt++) {
        var started = Date.now();
        try {
            return await gitProxyRequestOnce(payload, timeoutMs);
        } catch (error) {
            lastError = error;
            var code = error && error.code ? error.code : 'network';
            var elapsed = Date.now() - started;
            // Only retry short connection failures. A long wait that ends in a
            // bad body already used the attempt's timeout; do not stack three.
            var canRetry = attempt < GIT_PROXY_RETRY_MAX
                && isRetryableGitProxyCode(code)
                && elapsed < 45000;
            if (!canRetry) throw error;
            console.warn(
                '[gitProxyRequest] ' + action + ' failed (' + code + '); retry '
                + attempt + '/' + GIT_PROXY_RETRY_MAX
            );
            var wait = GIT_PROXY_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            await new Promise(function (resolve) { setTimeout(resolve, wait); });
        }
    }
    throw lastError || gitProxyError('network');
}

async function refreshGitSyncAccess() {
    showGitPanel(false);
    gitSyncState.allowed = false;
    if (typeof refreshAccessRights !== 'function') return false;
    try {
        var rights = await refreshAccessRights();
        gitSyncState.allowed = !!(rights && rights.githubSync === true);
    } catch (error) {
        gitSyncState.allowed = false;
    }
    showGitPanel(gitSyncState.allowed);
    if (gitSyncState.allowed) {
        var box = document.getElementById('git-auto-sync');
        if (box) box.checked = readAutoSync();
    }
    return gitSyncState.allowed;
}

async function runGitJob(kind, job) {
    if (gitSyncState.busy) {
        if (kind === 'auto') gitSyncState.pendingAuto = true;
        return;
    }
    setGitBusy(true);
    try {
        await job();
    } finally {
        setGitBusy(false);
        if (gitSyncState.pendingAuto) {
            gitSyncState.pendingAuto = false;
            maybeAutoSyncQuestions();
        }
    }
}

function formatGitHubUploadLogTime(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date == null ? '' : date);
    try {
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(d);
        var map = {};
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].type !== 'literal') map[parts[i].type] = parts[i].value;
        }
        return map.year + '-' + map.month + '-' + map.day + ' '
            + map.hour + ':' + map.minute + ':' + map.second + ' HKT';
    } catch (err) {
        return d.toISOString();
    }
}

// Dirty-shard upload (shards only):
// 1) Partition IndexedDB by exact publisher (HKEAA / 雅集出版社); reject unknowns.
// 2) Schema gate reads publisher shards. Missing required shard, or unequal
//    schemaVersion, fails clearly. Combined database.json is not read or written.
// 3) Compare fingerprints vs those shards; write only dirty shards.
// 4) Local zero rows for a publisher → skip that shard (never empty-wipe).

async function uploadQuestionsToGit(options) {
    options = options || {};
    if (!gitSyncState.allowed) {
        if (!options.auto) {
            setGitStatus(gitErrorMessage('feature_unavailable'), 'error');
            if (typeof showNotification === 'function') {
                showNotification(gitErrorMessage('feature_unavailable'), 'error');
            }
        }
        return;
    }
    var mode = options.auto ? 'auto' : 'manual';
    await runGitJob(mode, async function () {
        console.log('[GitHub upload] ' + formatGitHubUploadLogTime(new Date()) + ' starting (' + mode + ')');
        setGitStatus(options.auto ? '正在自動同步到 GitHub…' : '正在上傳到 GitHub…', '');
        try {
            setGitStatus(options.auto ? '正在自動同步到 GitHub…' : '正在上傳到 GitHub…', '');
            var exportData = typeof buildQuestionExport === 'function'
                ? await buildQuestionExport(true)
                : null;
            if (!exportData || !Array.isArray(exportData.questions)) {
                throw Object.assign(new Error('bad_request'), { code: 'bad_request' });
            }
            if (typeof stampSchemaVersion === 'function') {
                stampSchemaVersion(exportData);
            }

            if (typeof partitionQuestionsByPublisher !== 'function') {
                throw Object.assign(new Error('bad_request'), { code: 'bad_request' });
            }
            var parts = partitionQuestionsByPublisher(exportData.questions);
            if (parts.unknown && parts.unknown.length) {
                var sample = parts.unknown.slice(0, 5).map(function (q) {
                    return String(q && q.id || '?') + '=' + JSON.stringify(q && q.publisher);
                }).join(', ');
                var unkMsg = '上傳已拒絕：有 '
                    + parts.unknown.length
                    + ' 題的 publisher 不是「HKEAA」或「雅集出版社」（空／-／未知不允許靜默寫入分片）。例：'
                    + sample;
                throw Object.assign(new Error(unkMsg), { code: 'unknown_publisher', message: unkMsg });
            }

            function questionsOf(payload) {
                if (typeof sharedBankQuestionsFromPayload === 'function') {
                    return sharedBankQuestionsFromPayload(payload) || [];
                }
                if (payload && Array.isArray(payload.questions)) return payload.questions;
                return [];
            }

            var localHkeaa = parts.hkeaa;
            var localAristo = parts.aristo;
            // Safety: never treat a missing local publisher as an empty dirty wipe.
            var hkeaaPresent = localHkeaa.length > 0;
            var aristoPresent = localAristo.length > 0;

            setGitStatus('正在檢查分片格式版本…', '');
            var hkeaaRel = typeof SHARED_BANK_HKEAA_REL === 'string' ? SHARED_BANK_HKEAA_REL : 'data/database-hkeaa.json';
            var aristoRel = typeof SHARED_BANK_ARISTO_REL === 'string' ? SHARED_BANK_ARISTO_REL : 'data/database-aristo.json';
            var cloudHkeaa = await readCloudShardStrict(hkeaaRel, 'HKEAA');
            var needAristo = aristoPresent
                || (typeof sharedBankHasMockAccess === 'function' && sharedBankHasMockAccess());
            var cloudAristo = null;
            var cloudSchemaVersion = (typeof readSchemaVersion === 'function')
                ? readSchemaVersion(cloudHkeaa)
                : 0;
            if (needAristo) {
                cloudAristo = await readCloudShardStrict(aristoRel, '雅集');
                var pairStatus = (typeof sharedBankSchemaPairStatus === 'function')
                    ? sharedBankSchemaPairStatus(cloudHkeaa, cloudAristo)
                    : { ok: true, schemaVersion: cloudSchemaVersion };
                throwShardSchemaStatus(pairStatus);
                if (pairStatus && typeof pairStatus.schemaVersion === 'number') {
                    cloudSchemaVersion = pairStatus.schemaVersion;
                }
            }
            if (typeof assertCanUploadOverCloud === 'function') {
                assertCanUploadOverCloud({ schemaVersion: cloudSchemaVersion });
            }
            setGitStatus('正在比對雲端分片…', '');

            var fp = typeof sharedBankShardFingerprint === 'function'
                ? sharedBankShardFingerprint
                : function (qs) { return { count: (qs || []).length, idsKey: '', contentKey: JSON.stringify(qs || []) }; };
            var fpEq = typeof sharedBankFingerprintsEqual === 'function'
                ? sharedBankFingerprintsEqual
                : function (a, b) { return a && b && a.contentKey === b.contentKey; };

            var hkeaaDirty = false;
            var aristoDirty = false;
            if (hkeaaPresent) {
                var cloudHkeaaQs = questionsOf(cloudHkeaa);
                hkeaaDirty = !cloudHkeaa || !fpEq(fp(localHkeaa), fp(cloudHkeaaQs));
            }
            if (aristoPresent) {
                var cloudAristoQs = questionsOf(cloudAristo);
                aristoDirty = !cloudAristo || !fpEq(fp(localAristo), fp(cloudAristoQs));
            }

            if (!hkeaaDirty && !aristoDirty) {
                var noopMsg = '題庫分片與雲端相同，無需上傳'
                    + '（HKEAA '
                    + localHkeaa.length
                    + '／雅集 '
                    + localAristo.length
                    + (hkeaaPresent ? '' : '；本機無 HKEAA，已跳過該分片')
                    + (aristoPresent ? '' : '；本機無雅集，已跳過該分片')
                    + '）';
                console.log('[GitHub upload] ' + formatGitHubUploadLogTime(new Date()) + ' noop: ' + noopMsg);
                setGitStatus(noopMsg, 'ok');
                if (typeof showNotification === 'function') showNotification(noopMsg, 'success');
                return;
            }

            var buildPayload = typeof buildShardExportPayload === 'function'
                ? buildShardExportPayload
                : function (base, qs) {
                    var o = Object.assign({}, base || {});
                    o.questions = qs;
                    o.questionCount = qs.length;
                    o.exportDate = new Date().toISOString();
                    return o;
                };

            var files = [];
            if (hkeaaDirty) {
                files.push({
                    path: typeof SHARED_BANK_HKEAA_REL === 'string' ? SHARED_BANK_HKEAA_REL : 'data/database-hkeaa.json',
                    data: buildPayload(exportData, localHkeaa)
                });
            }
            if (aristoDirty) {
                files.push({
                    path: typeof SHARED_BANK_ARISTO_REL === 'string' ? SHARED_BANK_ARISTO_REL : 'data/database-aristo.json',
                    data: buildPayload(exportData, localAristo)
                });
            }

            // Upload one allowlisted shard per Apps Script call. Combined is not written.
            var uploadTimeoutMs = typeof GIT_PROXY_UPLOAD_TIMEOUT_MS === 'number'
                ? GIT_PROXY_UPLOAD_TIMEOUT_MS
                : 900000;
            var writtenList = [];
            var writtenSchema = 0;
            var data = null;
            for (var fi = 0; fi < files.length; fi++) {
                var fileSpec = files[fi];
                var pathLabel = String(fileSpec.path || '');
                var shortLabel = pathLabel.indexOf('hkeaa') !== -1
                    ? ('HKEAA ' + localHkeaa.length)
                    : ('雅集 ' + localAristo.length);
                setGitStatus('正在上傳髒分片（'
                    + shortLabel
                    + '；'
                    + (fi + 1)
                    + '/'
                    + files.length
                    + '）…', '');
                data = await gitProxyRequest({
                    action: 'syncDataUpload',
                    username: gitUsername(),
                    files: [fileSpec]
                }, uploadTimeoutMs);
                if (!data || data.ok !== true) {
                    var failed = new Error((data && (data.message || data.error)) || 'github_error');
                    failed.code = data && data.error ? data.error : 'github_error';
                    if (data && typeof data.message === 'string' && data.message) {
                        failed.message = data.message;
                    }
                    if (data && typeof data.clientSchemaVersion === 'number') {
                        failed.clientSchemaVersion = data.clientSchemaVersion;
                    }
                    if (data && typeof data.cloudSchemaVersion === 'number') {
                        failed.cloudSchemaVersion = data.cloudSchemaVersion;
                    }
                    if (data && Array.isArray(data.failingIds)) {
                        failed.failingIds = data.failingIds;
                    }
                    throw failed;
                }
                if (Array.isArray(data.written)) {
                    for (var wi = 0; wi < data.written.length; wi++) {
                        writtenList.push(data.written[wi]);
                    }
                }
                if (typeof data.schemaVersion === 'number' && data.schemaVersion > writtenSchema) {
                    writtenSchema = data.schemaVersion;
                }
            }
            if (!writtenSchema && typeof readSchemaVersion === 'function') {
                writtenSchema = readSchemaVersion(exportData) || 0;
            }
            var writtenPaths = writtenList.map(function (w) {
                return w && (w.relPath || w.path) ? String(w.relPath || w.path) : '';
            }).filter(Boolean);
            console.log('[GitHub upload] ' + formatGitHubUploadLogTime(new Date())
                + ' succeeded (dirty hkeaa=' + hkeaaDirty
                + ' aristo=' + aristoDirty + '; wrote ' + writtenPaths.join(', ') + ')');
            var message = '已上傳髒分片到 GitHub'
                + (hkeaaDirty ? '（HKEAA ' + localHkeaa.length + ' 題）' : '')
                + (aristoDirty ? '（雅集 ' + localAristo.length + ' 題）' : '')
                + (!aristoPresent ? '；本機無雅集→未動 aristo 分片' : '')
                + (!hkeaaPresent ? '；本機無 HKEAA→未動 hkeaa 分片' : '');
            if (writtenSchema > 0) message += '（格式版本 ' + writtenSchema + '）';
            setGitStatus(message, 'ok');
            if (typeof showNotification === 'function') showNotification(message, 'success');
        } catch (error) {
            var message = gitFailureText(error);
            console.warn('[GitHub upload] ' + formatGitHubUploadLogTime(new Date()) + ' failed: ' + message);
            setGitStatus(message, 'error');
            if (typeof showNotification === 'function') showNotification(message, 'error');
        }
    });
}

async function downloadQuestionsFromGit(options) {
    options = options || {};
    if (!gitSyncState.allowed) {
        setGitStatus(gitErrorMessage('feature_unavailable'), 'error');
        return;
    }
    if (!options.auto) {
        var confirmed = confirm('從 GitHub 載入會取代這部瀏覽器上的題庫。\n\n重新整理頁面會再讀取網站上的 JSON。確定要載入嗎？');
        if (!confirmed) return;
    }
    await runGitJob(options.auto ? 'auto' : 'manual', async function () {
        setGitStatus('正在從 GitHub 載入…', '');
        try {
            var importedPayload = null;
            var data = null;
            // D2 shards-only: prefer fetchSharedQuestionBank (merge HKEAA[+雅集]).
            // On failure, Apps Script syncDataDownload is also shards-only (no combined).
            if (typeof fetchSharedQuestionBank === 'function') {
                try {
                    importedPayload = await fetchSharedQuestionBank();
                    if (importedPayload) {
                        data = {
                            ok: true,
                            data: importedPayload,
                            sha: '',
                            schemaVersion: (typeof readSchemaVersion === 'function')
                                ? readSchemaVersion(importedPayload)
                                : 0
                        };
                    }
                } catch (shardErr) {
                    var shardCode = shardErr && shardErr.code ? String(shardErr.code) : '';
                    if (shardCode === 'schema_inconsistent' || shardCode === 'shards_missing') throw shardErr;
                    importedPayload = null;
                }
            }
            if (!importedPayload) {
                data = await gitProxyRequest({
                    action: 'syncDataDownload',
                    username: gitUsername()
                }, 180000);
            }
            if (!data || data.ok !== true) {
                var failed = new Error((data && (data.message || data.error)) || 'github_error');
                failed.code = data && data.error ? data.error : 'github_error';
                if (data && typeof data.message === 'string' && data.message) failed.message = data.message;
                throw failed;
            }
            if (!window.questionJsonSource || typeof window.questionJsonSource.importPayload !== 'function') {
                throw Object.assign(new Error('github_error'), { code: 'github_error' });
            }
            if (options.auto && gitSyncState.localChanged) {
                setGitStatus('已保留本機修改，稍後上傳', '');
                return;
            }
            gitSyncState.suppressAuto = true;
            var imported = 0;
            try {
                imported = await window.questionJsonSource.importPayload(data.data, {
                    quiet: !!options.quiet,
                    statusSetter: setGitStatus
                });
                if (typeof refreshViews === 'function') await refreshViews();
            } finally {
                gitSyncState.suppressAuto = false;
            }
            var schemaVersion = (typeof data.schemaVersion === 'number')
                ? data.schemaVersion
                : (typeof readSchemaVersion === 'function' ? readSchemaVersion(data.data) : 0);
            var message = '已從 GitHub 載入 ' + imported + ' 題';
            if (schemaVersion > 0) message += '（格式版本 ' + schemaVersion + '）';
            setGitStatus(message, 'ok');
            if (!options.quiet) {
                if (typeof showNotification === 'function') showNotification(message, 'success');
            }
        } catch (error) {
            var code = error && error.code ? error.code : '';
            if (options.auto && code === 'github_not_found') {
                setGitStatus('GitHub 上還沒有題庫，目前使用網站內的 JSON', '');
                return;
            }
            var message = gitFailureText(error);
            setGitStatus(message, 'error');
            if (!options.auto && typeof showNotification === 'function') {
                showNotification(message, 'error');
            }
        }
    });
}

function formatShardReconcileStatus(summary) {
    summary = summary || {};
    var h = summary.hkeaa || {};
    var a = summary.aristo || {};
    var msg = '分片對帳：HKEAA '
        + (h.present === false ? '缺失' : ((h.questionCount || 0) + ' 題（schema ' + (h.schemaVersion || 0) + '）'))
        + '／雅集 '
        + (a.present === false ? '缺失' : ((a.questionCount || 0) + ' 題（schema ' + (a.schemaVersion || 0) + '）'))
        + '；合計 ' + (summary.totalQuestions || 0)
        + '；id 重疊 ' + (summary.overlapCount || 0);
    if (summary.missing && summary.missing.length) msg += '；缺失 ' + summary.missing.join('、');
    if (summary.schemaConsistent === false && h.present !== false && a.present !== false) {
        msg += '；schema 不一致';
    }
    if (summary.declaredCountMismatch) msg += '；questionCount 與陣列長度不符';
    msg += summary.consistent ? '；一致' : '；不一致';
    return msg;
}

async function reconcileBankShardsFromGit() {
    if (!gitSyncState.allowed) {
        setGitStatus(gitErrorMessage('feature_unavailable'), 'error');
        if (typeof showNotification === 'function') {
            showNotification(gitErrorMessage('feature_unavailable'), 'error');
        }
        return;
    }
    await runGitJob('manual', async function () {
        setGitStatus('正在對帳出版社分片…', '');
        try {
            var data = await gitProxyRequest({
                action: 'reconcileBankShards',
                username: gitUsername()
            }, 300000);
            if (!data || data.ok !== true) {
                var failed = new Error((data && (data.message || data.error)) || 'github_error');
                failed.code = data && data.error ? data.error : 'github_error';
                if (data && typeof data.message === 'string' && data.message) failed.message = data.message;
                throw failed;
            }
            var message = formatShardReconcileStatus(data);
            console.log('[GitHub reconcile] ' + formatGitHubUploadLogTime(new Date()) + ' ' + message);
            setGitStatus(message, data.consistent ? 'ok' : 'error');
            if (typeof showNotification === 'function') {
                showNotification(message, data.consistent ? 'success' : 'error');
            }
        } catch (error) {
            var message = gitFailureText(error);
            setGitStatus(message, 'error');
            if (typeof showNotification === 'function') showNotification(message, 'error');
        }
    });
}

async function maybeAutoSyncQuestions() {
    if (gitSyncState.suppressAuto || !readAutoSync()) return;
    gitSyncState.localChanged = true;
    if (gitSyncState.accessPromise) {
        try { await gitSyncState.accessPromise; } catch (error) {}
    }
    if (!gitSyncState.allowed || !readAutoSync()) return;
    await uploadQuestionsToGit({ auto: true });
}

function bindGitSyncControls() {
    var panel = document.getElementById('git-sync-panel');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';
    var box = document.getElementById('git-auto-sync');
    if (box) {
        box.checked = readAutoSync();
        box.addEventListener('change', function () {
            writeAutoSync(box.checked);
        });
    }
    var upload = document.getElementById('git-upload-btn');
    if (upload) {
        upload.addEventListener('click', function () {
            uploadQuestionsToGit({ auto: false });
        });
    }
    var download = document.getElementById('git-download-btn');
    if (download) {
        download.addEventListener('click', function () {
            downloadQuestionsFromGit({ auto: false });
        });
    }
    var reconcile = document.getElementById('git-reconcile-btn');
    if (reconcile) {
        reconcile.addEventListener('click', function () {
            reconcileBankShardsFromGit();
        });
    }
}

function initGitSyncFeature() {
    bindGitSyncControls();
    gitSyncState.accessPromise = refreshGitSyncAccess().catch(function () {
        showGitPanel(false);
        return false;
    });
    gitSyncState.accessPromise.then(function (allowed) {
        if (!allowed || !readAutoSync() || window.editingId || gitSyncState.localChanged) return;
        downloadQuestionsFromGit({ auto: true, quiet: true });
    });
}

window.maybeAutoSyncQuestions = maybeAutoSyncQuestions;
window.initGitSyncFeature = initGitSyncFeature;
window.reconcileBankShardsFromGit = reconcileBankShardsFromGit;
window.formatShardReconcileStatus = formatShardReconcileStatus;
