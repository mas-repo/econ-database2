// Shared diagrams, question JSON, and paper files live in the private data
// repository. After username validation, Apps Script may issue a short-lived
// read-only GitHub credential (installation token or dedicated read PAT). The
// browser then fetches large files from api.github.com directly so bodies do
// not travel through the Apps Script googleusercontent echo path.
//
// The write token (GITHUB_TOKEN) never reaches the browser. Mutations (bank
// upload, AI解釋, 回報問題, data-checks) stay on Apps Script; this module is
// read-path only. If token issuance fails, fetchSharedAsset / listSharedData
// remain as fallbacks.
//
// Path rules match githubSharedRelOk_ in apps-script/Code.gs.

var SHARED_ASSET_ROOTS = { data: 1, diagrams: 1, originals: 1, papers: 1, build: 1 };
var SHARED_ASSET_EXT = {
    json: 1, js: 1, jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, svg: 1,
    pdf: 1, docx: 1, doc: 1, jsonl: 1, txt: 1, md: 1
};
var SHARED_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
var sharedBlobCache = new Map();

// In-memory only. Never written to localStorage / sessionStorage.
var sharedReadSession = null;
var sharedReadSessionPromise = null;

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

function sharedMockOnlyPath(rel) {
    var path = String(rel || '');
    if (path === 'data/database.js') return true;
    if (path === 'build' || path.indexOf('build/') === 0) return true;
    if (path === 'diagrams' || path.indexOf('diagrams/') === 0) return true;
    if (path === 'papers/mock-tests' || path.indexOf('papers/mock-tests/') === 0) return true;
    if (/^originals\/\d+(\/|$)/.test(path)) return true;
    return false;
}

function sharedIsMockQuestion(question) {
    if (!question || typeof question !== 'object') return false;
    var id = String(question.id || '');
    if (/^MT?\d/i.test(id)) return true;
    var publisher = String(question.publisher || '');
    return publisher !== '' && publisher !== 'HKEAA' && publisher !== '-';
}

function sharedStripMockQuestions(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) {
        return payload.filter(function (item) { return !sharedIsMockQuestion(item); });
    }
    var list = Array.isArray(payload.questions) ? payload.questions : null;
    if (!list) return payload;
    var kept = list.filter(function (item) { return !sharedIsMockQuestion(item); });
    payload.questions = kept;
    if (typeof payload.questionCount === 'number') payload.questionCount = kept.length;
    return payload;
}

function sharedExt(path) {
    var file = String(path || '').split('/').pop() || '';
    var dot = file.lastIndexOf('.');
    if (dot <= 0) return '';
    return file.slice(dot + 1).toLowerCase();
}

function sharedTextExt(ext) {
    return ext === 'json' || ext === 'js' || ext === 'jsonl' || ext === 'txt' || ext === 'md';
}

function sharedMediaType(ext) {
    var map = {
        json: 'application/json',
        js: 'text/javascript',
        jsonl: 'application/x-ndjson',
        txt: 'text/plain',
        md: 'text/markdown',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    return map[ext] || 'application/octet-stream';
}

function sharedAssetFailure(data) {
    var code = data && data.error ? data.error : 'github_error';
    var error = new Error(sharedErrorMessage(code));
    error.code = SHARED_ERROR_TEXT[code] ? code : 'github_error';
    return error;
}

function clearSharedReadSession() {
    if (sharedReadSession && sharedReadSession.token) {
        try { sharedReadSession.token = ''; } catch (ignore) {}
    }
    sharedReadSession = null;
    sharedReadSessionPromise = null;
}

function sharedReadSessionValid() {
    return !!(sharedReadSession
        && sharedReadSession.token
        && sharedReadSession.owner
        && sharedReadSession.repo
        && Number(sharedReadSession.expiresAtMs) > Date.now() + 15000);
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

async function issueSharedReadSession() {
    var data = await sharedAssetRequest({ action: 'issueSharedReadToken' }, 30000);
    if (!data.token || !data.owner || !data.repo) {
        throw sharedAssetFailure({ error: 'github_not_configured' });
    }
    var tokenType = String(data.tokenType || '');
    if (tokenType !== 'installation' && tokenType !== 'read_pat') {
        throw sharedAssetFailure({ error: 'github_error' });
    }
    var expiresAtMs = Number(data.expiresAtMs);
    if (!isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        expiresAtMs = Date.now() + (tokenType === 'installation' ? 50 * 60 * 1000 : 15 * 60 * 1000);
    }
    sharedReadSession = {
        token: String(data.token),
        tokenType: tokenType,
        expiresAtMs: expiresAtMs,
        owner: String(data.owner),
        repo: String(data.repo),
        branch: String(data.branch || 'main'),
        sharedPrefix: String(data.sharedPrefix || 'shared').replace(/^\/+|\/+$/g, '') || 'shared',
        apiBase: String(data.apiBase || 'https://api.github.com').replace(/\/+$/, ''),
        mockTests: data.mockTests === true,
        canReadDataChecks: data.canReadDataChecks === true
    };
    return sharedReadSession;
}

async function ensureSharedReadSession() {
    if (sharedReadSessionValid()) return sharedReadSession;
    if (sharedReadSessionPromise) return sharedReadSessionPromise;
    sharedReadSessionPromise = issueSharedReadSession().then(function (session) {
        sharedReadSessionPromise = null;
        return session;
    }).catch(function (error) {
        sharedReadSessionPromise = null;
        clearSharedReadSession();
        throw error;
    });
    return sharedReadSessionPromise;
}

function sharedRepoApiPath(session, repoPath) {
    var encoded = String(repoPath || '').split('/').map(function (part) {
        return encodeURIComponent(part);
    }).join('/');
    return session.apiBase
        + '/repos/'
        + encodeURIComponent(session.owner)
        + '/'
        + encodeURIComponent(session.repo)
        + '/contents/'
        + encoded
        + '?ref='
        + encodeURIComponent(session.branch);
}

function sharedBlobApiPath(session, sha) {
    return session.apiBase
        + '/repos/'
        + encodeURIComponent(session.owner)
        + '/'
        + encodeURIComponent(session.repo)
        + '/git/blobs/'
        + encodeURIComponent(sha);
}

async function githubApiFetch(session, url, options) {
    options = options || {};
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (controller && options.timeoutMs) {
        timer = setTimeout(function () { controller.abort(); }, options.timeoutMs);
    }
    try {
        return await fetch(url, {
            method: options.method || 'GET',
            headers: {
                Authorization: 'Bearer ' + session.token,
                Accept: options.accept || 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            signal: controller ? controller.signal : undefined
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function bytesFromBase64(b64) {
    var binary = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function utf8FromBase64(b64) {
    var bytes = bytesFromBase64(b64);
    if (typeof TextDecoder === 'function') {
        return new TextDecoder('utf-8').decode(bytes);
    }
    var encoded = '';
    for (var i = 0; i < bytes.length; i++) {
        encoded += '%' + ('0' + bytes[i].toString(16)).slice(-2);
    }
    return decodeURIComponent(encoded);
}

async function githubReadSharedFile(session, rel, timeoutMs) {
    var prefix = session.sharedPrefix || 'shared';
    var repoPath = prefix + '/' + String(rel || '').replace(/^\/+/, '');
    var metaResponse = await githubApiFetch(session, sharedRepoApiPath(session, repoPath), {
        timeoutMs: timeoutMs || 120000,
        accept: 'application/vnd.github+json'
    });
    if (metaResponse.status === 404) throw sharedAssetFailure({ error: 'github_not_found' });
    if (metaResponse.status === 403 || metaResponse.status === 401) {
        clearSharedReadSession();
        throw sharedAssetFailure({ error: 'github_error' });
    }
    if (!metaResponse.ok) throw sharedAssetFailure({ error: 'github_error' });
    var meta = await metaResponse.json();
    if (!meta || (meta.type && meta.type !== 'file')) throw sharedAssetFailure({ error: 'bad_request' });

    var ext = sharedExt(rel);
    var textExt = sharedTextExt(ext);
    var b64 = '';
    var bytes = Number(meta.size) || 0;

    if (meta.encoding === 'base64' && typeof meta.content === 'string' && meta.content) {
        b64 = meta.content.replace(/\s/g, '');
    } else if (meta.sha) {
        var blobResponse = await githubApiFetch(session, sharedBlobApiPath(session, meta.sha), {
            timeoutMs: timeoutMs || 180000,
            accept: 'application/vnd.github+json'
        });
        if (blobResponse.status === 404) throw sharedAssetFailure({ error: 'github_not_found' });
        if (!blobResponse.ok) throw sharedAssetFailure({ error: 'github_error' });
        var blob = await blobResponse.json();
        if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string') {
            throw sharedAssetFailure({ error: 'github_error' });
        }
        b64 = String(blob.content).replace(/\s/g, '');
        bytes = Number(blob.size) || bytes;
    } else {
        throw sharedAssetFailure({ error: 'github_error' });
    }

    if (bytes > 9000000) throw sharedAssetFailure({ error: 'payload_too_large' });

    return {
        path: rel,
        encoding: textExt ? 'utf8' : 'base64',
        mediaType: sharedMediaType(ext),
        bytes: bytes,
        content: textExt ? utf8FromBase64(b64) : b64,
        sha: meta.sha || ''
    };
}

function sharedPathAllowedForSession(session, rel) {
    if (rel === 'data/data-checks.json') return session.canReadDataChecks === true;
    if (!sharedAssetPathOk(rel)) return false;
    if (!session.mockTests && sharedMockOnlyPath(rel)) return false;
    return true;
}

async function fetchSharedAssetDirectOrProxy(rel, timeoutMs) {
    if (!sharedAssetPathOk(rel) && rel !== 'data/data-checks.json') {
        throw sharedAssetFailure({ error: 'bad_request' });
    }
    try {
        var session = await ensureSharedReadSession();
        if (!sharedPathAllowedForSession(session, rel)) {
            throw sharedAssetFailure({ error: 'feature_unavailable' });
        }
        var direct = await githubReadSharedFile(session, rel, timeoutMs);
        if (rel === 'data/database.json' && !session.mockTests && direct.encoding === 'utf8') {
            try {
                var parsed = JSON.parse(direct.content);
                parsed = sharedStripMockQuestions(parsed);
                direct.content = JSON.stringify(parsed);
                direct.bytes = direct.content.length;
            } catch (stripErr) {
                throw sharedAssetFailure({ error: 'github_error' });
            }
        }
        return direct;
    } catch (error) {
        if (error && error.code === 'feature_unavailable') throw error;
        return sharedAssetRequest({
            action: 'fetchSharedAsset',
            path: rel
        }, timeoutMs || 180000);
    }
}

async function fetchSharedQuestionBank() {
    var data = await fetchSharedAssetDirectOrProxy('data/database.json', 180000);
    if (data.encoding !== 'utf8' || typeof data.content !== 'string') {
        throw sharedAssetFailure({ error: 'github_error' });
    }
    try {
        return JSON.parse(data.content);
    } catch (error) {
        throw sharedAssetFailure({ error: 'github_error' });
    }
}

async function fetchSharedJsonDirectOrProxy(rel, timeoutMs) {
    var data = await fetchSharedAssetDirectOrProxy(rel, timeoutMs || 120000);
    if (data.encoding !== 'utf8' || typeof data.content !== 'string') {
        throw sharedAssetFailure({ error: 'github_error' });
    }
    try {
        return {
            data: JSON.parse(data.content),
            sha: data.sha || '',
            path: data.path || rel
        };
    } catch (error) {
        throw sharedAssetFailure({ error: 'github_error' });
    }
}

async function sharedAssetObjectUrl(path) {
    if (!sharedAssetPathOk(path)) {
        throw sharedAssetFailure({ error: 'bad_request' });
    }
    if (sharedBlobCache.has(path)) return sharedBlobCache.get(path);
    var pending = fetchSharedAssetDirectOrProxy(path, 120000).then(function (data) {
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

async function listSharedDataDirect(session, path, recursive) {
    var rel = String(path || '').replace(/\/+$/g, '');
    var prefix = session.sharedPrefix || 'shared';
    var repoPath = rel ? (prefix + '/' + rel) : prefix;

    if (recursive === true) {
        var branchUrl = session.apiBase
            + '/repos/'
            + encodeURIComponent(session.owner)
            + '/'
            + encodeURIComponent(session.repo)
            + '/branches/'
            + encodeURIComponent(session.branch);
        var branchResponse = await githubApiFetch(session, branchUrl, {
            timeoutMs: 60000,
            accept: 'application/vnd.github+json'
        });
        if (branchResponse.status === 404) throw sharedAssetFailure({ error: 'github_not_found' });
        if (!branchResponse.ok) throw sharedAssetFailure({ error: 'github_error' });
        var branchBody = await branchResponse.json();
        var rootSha = branchBody
            && branchBody.commit
            && branchBody.commit.commit
            && branchBody.commit.commit.tree
            && branchBody.commit.commit.tree.sha;
        if (!rootSha) throw sharedAssetFailure({ error: 'github_error' });
        var treeUrl = session.apiBase
            + '/repos/'
            + encodeURIComponent(session.owner)
            + '/'
            + encodeURIComponent(session.repo)
            + '/git/trees/'
            + encodeURIComponent(rootSha)
            + '?recursive=1';
        var treeResponse = await githubApiFetch(session, treeUrl, {
            timeoutMs: 120000,
            accept: 'application/vnd.github+json'
        });
        if (!treeResponse.ok) throw sharedAssetFailure({ error: 'github_error' });
        var body = await treeResponse.json();
        var tree = body && Array.isArray(body.tree) ? body.tree : [];
        var wantedPrefix = repoPath + '/';
        var entries = [];
        var truncated = body && body.truncated === true;
        for (var i = 0; i < tree.length; i++) {
            if (entries.length >= 8000) {
                truncated = true;
                break;
            }
            var item = tree[i];
            if (!item || !item.path) continue;
            var fullPath = String(item.path);
            if (fullPath !== repoPath && fullPath.indexOf(wantedPrefix) !== 0) continue;
            var name = fullPath === repoPath ? '' : fullPath.slice(wantedPrefix.length);
            if (!name || name.indexOf('..') !== -1) continue;
            var child = rel ? rel + '/' + name : name;
            if (!session.mockTests && sharedMockOnlyPath(child)) continue;
            if (item.type === 'tree') {
                entries.push({ path: child, type: 'dir', size: 0 });
            } else if (item.type === 'blob') {
                if (!sharedAssetPathOk(child)) continue;
                entries.push({
                    path: child,
                    type: 'file',
                    size: Number(item.size) >= 0 ? Number(item.size) : 0
                });
            }
        }
        return { path: rel, truncated: truncated, entries: entries };
    }

    var listResponse = await githubApiFetch(session, sharedRepoApiPath(session, repoPath), {
        timeoutMs: 120000,
        accept: 'application/vnd.github+json'
    });
    if (listResponse.status === 404) throw sharedAssetFailure({ error: 'github_not_found' });
    if (!listResponse.ok) throw sharedAssetFailure({ error: 'github_error' });
    var listed = await listResponse.json();
    if (!Array.isArray(listed)) throw sharedAssetFailure({ error: 'bad_request' });
    var out = [];
    for (var j = 0; j < listed.length && out.length < 8000; j++) {
        var entry = listed[j];
        if (!entry || !entry.name) continue;
        var childPath = rel ? rel + '/' + entry.name : entry.name;
        if (!session.mockTests && sharedMockOnlyPath(childPath)) continue;
        if (entry.type === 'dir') {
            out.push({ path: childPath, type: 'dir', size: 0 });
        } else if (entry.type === 'file') {
            if (!sharedAssetPathOk(childPath)) continue;
            out.push({
                path: childPath,
                type: 'file',
                size: Number(entry.size) >= 0 ? Number(entry.size) : 0
            });
        }
    }
    return { path: rel, truncated: false, entries: out };
}

async function listSharedData(path, recursive) {
    try {
        var session = await ensureSharedReadSession();
        return await listSharedDataDirect(session, path, recursive);
    } catch (error) {
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
}

window.fetchSharedQuestionBank = fetchSharedQuestionBank;
window.fetchSharedJsonDirectOrProxy = fetchSharedJsonDirectOrProxy;
window.sharedAssetObjectUrl = sharedAssetObjectUrl;
window.sharedAssetPathOk = sharedAssetPathOk;
window.hydrateSharedImages = hydrateSharedImages;
window.listSharedData = listSharedData;
window.clearSharedReadSession = clearSharedReadSession;
window.ensureSharedReadSession = ensureSharedReadSession;
window.SHARED_IMG_PLACEHOLDER = SHARED_IMG_PLACEHOLDER;

window.addEventListener('pagehide', function () {
    clearSharedReadSession();
});
