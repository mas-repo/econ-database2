// Shared diagrams, question JSON, and paper files live in the private data
// repository. The browser only asks the Apps Script web app already used by
// AI出題 and Git sync. The token, owner, and repository name stay in Script
// properties. A static host cannot read those private files itself.
//
// Path rules match githubSharedRelOk_ in apps-script/Code.gs.

var SHARED_ASSET_ROOTS = { data: 1, diagrams: 1, originals: 1, papers: 1, build: 1 };
var SHARED_ASSET_EXT = {
    json: 1, js: 1, jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, svg: 1,
    pdf: 1, docx: 1, doc: 1, jsonl: 1, txt: 1, md: 1
};
var SHARED_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
var sharedBlobCache = new Map();

var SHARED_ERROR_TEXT = {
    feature_unavailable: '沒有讀取共用題庫的權限',
    github_not_configured: '共用題庫尚未在伺服器設定',
    github_not_found: '共用題庫尚未上傳',
    github_error: '共用題庫讀取失敗',
    bad_request: '檔案路徑不正確',
    payload_too_large: '檔案太大，無法經由網站讀取',
    rate_limited: '讀取太頻繁，請稍後再試',
    network: '無法連線到題庫服務',
    server_error: '題庫服務發生錯誤'
};

function sharedErrorMessage(code) {
    return SHARED_ERROR_TEXT[code] || SHARED_ERROR_TEXT.github_error;
}

function sharedAssetPathOk(value) {
    var path = String(value || '');
    if (!path || path.charAt(0) === '/' || path.charAt(0) === '\\') return false;
    if (path.length > 400 || path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return false;
    if (path.charAt(path.length - 1) === '/') return false;
    if (/[\u0000-\u001F\u007F?#%<>:"|*]/.test(path)) return false;
    var parts = path.split('/');
    if (!SHARED_ASSET_ROOTS[parts[0]]) return false;
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part || part === '.' || part === '..' || part.length > 180) return false;
        for (var c = 0; c < part.length; c++) {
            var ch = part.charAt(c);
            var code = part.charCodeAt(c);
            if (code < 32 || code === 127) return false;
            if (code < 128 && !/[A-Za-z0-9._() -]/.test(ch)) return false;
        }
    }
    var file = parts[parts.length - 1];
    var dot = file.lastIndexOf('.');
    if (dot <= 0) return false;
    return !!SHARED_ASSET_EXT[file.slice(dot + 1).toLowerCase()];
}

function sharedAssetFailure(data) {
    var code = data && data.error ? data.error : 'github_error';
    var error = new Error(sharedErrorMessage(code));
    error.code = SHARED_ERROR_TEXT[code] ? code : 'github_error';
    return error;
}

async function sharedAssetRequest(payload, timeoutMs) {
    if (typeof gitProxyRequest !== 'function') {
        var missing = new Error(sharedErrorMessage('network'));
        missing.code = 'network';
        throw missing;
    }
    var username = typeof gitUsername === 'function' ? gitUsername() : '';
    if (!username) {
        var denied = new Error(sharedErrorMessage('feature_unavailable'));
        denied.code = 'feature_unavailable';
        throw denied;
    }
    payload.username = username;
    var data;
    try {
        data = await gitProxyRequest(payload, timeoutMs);
    } catch (error) {
        if (error && error.code && SHARED_ERROR_TEXT[error.code]) throw error;
        var network = new Error(sharedErrorMessage('network'));
        network.code = 'network';
        throw network;
    }
    if (!data || data.ok !== true) throw sharedAssetFailure(data);
    return data;
}

async function fetchSharedQuestionBank() {
    var data = await sharedAssetRequest({
        action: 'fetchSharedAsset',
        path: 'data/database.json'
    }, 180000);
    if (data.encoding !== 'utf8' || typeof data.content !== 'string') {
        throw sharedAssetFailure({ error: 'github_error' });
    }
    try {
        return JSON.parse(data.content);
    } catch (error) {
        throw sharedAssetFailure({ error: 'github_error' });
    }
}

function bytesFromBase64(b64) {
    var binary = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function sharedAssetObjectUrl(path) {
    if (!sharedAssetPathOk(path)) {
        throw sharedAssetFailure({ error: 'bad_request' });
    }
    if (sharedBlobCache.has(path)) return sharedBlobCache.get(path);
    var pending = sharedAssetRequest({
        action: 'fetchSharedAsset',
        path: path
    }, 120000).then(function (data) {
        if (data.encoding !== 'base64' || typeof data.content !== 'string') {
            throw sharedAssetFailure({ error: 'github_error' });
        }
        var blob = new Blob([bytesFromBase64(data.content)], {
            type: data.mediaType || 'application/octet-stream'
        });
        return URL.createObjectURL(blob);
    });
    sharedBlobCache.set(path, pending);
    try {
        return await pending;
    } catch (error) {
        sharedBlobCache.delete(path);
        throw error;
    }
}

function hydrateSharedImages(root) {
    var scope = root || document;
    var images = scope.querySelectorAll ? scope.querySelectorAll('img[data-shared-src]') : [];
    Array.prototype.forEach.call(images, function (img) {
        var path = img.getAttribute('data-shared-src') || '';
        if (!sharedAssetPathOk(path) || img.dataset.sharedLoading === '1') return;
        img.dataset.sharedLoading = '1';
        sharedAssetObjectUrl(path).then(function (url) {
            img.src = url;
        }).catch(function () {
            img.alt = (img.alt || '圖') + '（圖片未能載入）';
        });
    });
}

async function listSharedData(path, recursive) {
    var data = await sharedAssetRequest({
        action: 'listSharedData',
        path: path || '',
        recursive: recursive === true
    }, 120000);
    return {
        path: data.path || '',
        truncated: data.truncated === true,
        entries: Array.isArray(data.entries) ? data.entries : []
    };
}

window.fetchSharedQuestionBank = fetchSharedQuestionBank;
window.sharedAssetObjectUrl = sharedAssetObjectUrl;
window.sharedAssetPathOk = sharedAssetPathOk;
window.hydrateSharedImages = hydrateSharedImages;
window.listSharedData = listSharedData;
window.SHARED_IMG_PLACEHOLDER = SHARED_IMG_PLACEHOLDER;
