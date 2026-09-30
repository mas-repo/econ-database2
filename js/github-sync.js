// Git sync when the proxy sets githubSync. The browser only talks to the
// Apps Script web app already used by AI出題. The token, owner, and repository
// name stay in Script properties and are never read or stored here.
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
    server_error: '同步服務發生錯誤'
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
    if (error && error.code && GIT_ERROR_TEXT[error.code]) return GIT_ERROR_TEXT[error.code];
    var message = error && error.message ? String(error.message) : '';
    if (message && message.length <= 80 && message.indexOf('token') === -1 && message.indexOf('github.com') === -1) {
        return message;
    }
    return gitErrorMessage(error && error.code ? error.code : 'network');
}

function setGitStatus(text, kind) {
    var node = document.getElementById('git-sync-status');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'git-sync-status' + (kind ? ' is-' + kind : '');
}

function setGitBusy(busy) {
    gitSyncState.busy = busy;
    ['git-upload-btn', 'git-download-btn'].forEach(function (id) {
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

async function gitProxyRequest(payload, timeoutMs) {
    var url = gitProxyUrl();
    if (!url) {
        var missing = new Error('network');
        missing.code = 'network';
        throw missing;
    }
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
        var text = await response.text();
        try {
            return parseGitProxyJson(text);
        } catch (error) {
            var invalid = new Error('network');
            invalid.code = 'network';
            throw invalid;
        }
    } catch (error) {
        if (error && error.code) throw error;
        if (error && error.name === 'AbortError') {
            var timeout = new Error('network');
            timeout.code = 'network';
            throw timeout;
        }
        var network = new Error('network');
        network.code = 'network';
        throw network;
    } finally {
        clearTimeout(timer);
    }
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
        console.log('[GitHub upload] ' + new Date().toISOString() + ' starting (' + mode + ')');
        setGitStatus(options.auto ? '正在自動同步到 GitHub…' : '正在上傳到 GitHub…', '');
        try {
            var exportData = typeof buildQuestionExport === 'function'
                ? await buildQuestionExport(true)
                : null;
            if (!exportData || !Array.isArray(exportData.questions)) {
                throw Object.assign(new Error('bad_request'), { code: 'bad_request' });
            }
            var data = await gitProxyRequest({
                action: 'syncDataUpload',
                username: gitUsername(),
                data: exportData
            }, 180000);
            if (!data || data.ok !== true) {
                var failed = new Error((data && data.error) || 'github_error');
                failed.code = data && data.error ? data.error : 'github_error';
                throw failed;
            }
            var count = exportData.questionCount;
            console.log('[GitHub upload] ' + new Date().toISOString() + ' succeeded (' + count + ' questions)');
            var message = '已上傳 ' + count + ' 題到 GitHub';
            setGitStatus(message, 'ok');
            if (typeof showNotification === 'function') showNotification(message, 'success');
        } catch (error) {
            var message = gitFailureText(error);
            console.warn('[GitHub upload] ' + new Date().toISOString() + ' failed: ' + message);
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
            var data = await gitProxyRequest({
                action: 'syncDataDownload',
                username: gitUsername()
            }, 180000);
            if (!data || data.ok !== true) {
                var failed = new Error((data && data.error) || 'github_error');
                failed.code = data && data.error ? data.error : 'github_error';
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
                imported = await window.questionJsonSource.importPayload(data.data);
                if (typeof refreshViews === 'function') await refreshViews();
            } finally {
                gitSyncState.suppressAuto = false;
            }
            var message = '已從 GitHub 載入 ' + imported + ' 題';
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
