// schema-version.js
// Shared question-bank schemaVersion guards.
//
// Field: schemaVersion (integer on the bank JSON object root).
// Bump SCHEMA_VERSION in constants.js only when the data shape changes so an
// older writer would drop fields. Missing schemaVersion on a cloud/file
// payload is treated as 0 (oldest compatible — banks written before this
// guard). Distinct from export metadata `version: '1.0'`.
//
// Upload: local SCHEMA_VERSION < cloud schemaVersion → block (no overwrite).
// Load/download/import: cloud/file > local → notify user to update the app.
// Apps Script handleGitUpload_ also rejects with schema_version_stale when the
// client's declared schemaVersion is older than the cloud bank (defense in
// depth with the client check). Do not put write PATs in the browser.

(function (global) {
    'use strict';

    function currentSchemaVersion() {
        if (typeof SCHEMA_VERSION === 'number' && isFinite(SCHEMA_VERSION)) {
            return Math.floor(SCHEMA_VERSION);
        }
        return 0;
    }

    function readSchemaVersion(payload) {
        // Bare question arrays (legacy) and non-objects → 0.
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
        if (!Object.prototype.hasOwnProperty.call(payload, 'schemaVersion')) return 0;
        var raw = payload.schemaVersion;
        if (raw === null || raw === undefined || raw === '') return 0;
        var n = Number(raw);
        if (!isFinite(n) || n < 0) return 0;
        return Math.floor(n);
    }

    function stampSchemaVersion(payload) {
        var out = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload
            : {};
        out.schemaVersion = currentSchemaVersion();
        return out;
    }

    function isCloudSchemaNewer(payload) {
        return readSchemaVersion(payload) > currentSchemaVersion();
    }

    function schemaNewerUploadMessage(cloudVersion) {
        var cloud = cloudVersion == null ? '?' : String(cloudVersion);
        var local = String(currentSchemaVersion());
        return '共用題庫是由較新版本的應用程式寫入的（雲端 schemaVersion '
            + cloud + '，本機 ' + local
            + '）。請先更新到最新網頁版本，再上傳，以免覆蓋並遺失新欄位。';
    }

    function schemaNewerLoadMessage(cloudVersion) {
        var cloud = cloudVersion == null ? '?' : String(cloudVersion);
        var local = String(currentSchemaVersion());
        return '共用題庫的資料格式版本高於目前網頁（雲端 schemaVersion '
            + cloud + '，本機 ' + local
            + '）。請更新到最新版本，以免遺失新欄位。';
    }

    function schemaParseFailMessage(cloudVersion) {
        var cloud = cloudVersion == null ? '?' : String(cloudVersion);
        var local = String(currentSchemaVersion());
        return '無法安全載入較新格式的題庫（雲端 schemaVersion '
            + cloud + '，本機 ' + local
            + '）。請更新到最新網頁版本後再試。';
    }

    function notifyCloudSchemaNewer(payload, options) {
        options = options || {};
        if (!isCloudSchemaNewer(payload)) return false;
        var cloudVersion = readSchemaVersion(payload);
        var message = schemaNewerLoadMessage(cloudVersion);
        if (options.statusSetter && typeof options.statusSetter === 'function') {
            options.statusSetter(message, 'error');
        }
        // Always surface an update warning (even on quiet auto-download).
        if (typeof showNotification === 'function') {
            showNotification(message, 'warning');
        } else if (typeof alert === 'function' && !options.quiet) {
            alert(message);
        }
        return true;
    }

    // Throws { code: 'schema_too_new' } when local app must not overwrite cloud.
    // payload null/undefined means no cloud file yet → allow upload.
    function assertCanUploadOverCloud(payload) {
        if (payload == null) return;
        if (!isCloudSchemaNewer(payload)) return;
        var cloudVersion = readSchemaVersion(payload);
        var error = new Error(schemaNewerUploadMessage(cloudVersion));
        error.code = 'schema_too_new';
        error.cloudSchemaVersion = cloudVersion;
        throw error;
    }

    // True when payload has a usable questions list (or is a bare array).
    function payloadHasQuestions(payload) {
        if (Array.isArray(payload)) return payload.length >= 0;
        return !!(payload && typeof payload === 'object' && Array.isArray(payload.questions));
    }

    // For a newer cloud schema: notify. If we cannot see a questions array,
    // refuse the load (do not half-import then save).
    function guardIncomingBankPayload(payload, options) {
        options = options || {};
        var cloudVersion = readSchemaVersion(payload);
        var newer = cloudVersion > currentSchemaVersion();
        if (newer) {
            if (!payloadHasQuestions(payload)) {
                var error = new Error(schemaParseFailMessage(cloudVersion));
                error.code = 'schema_unreadable';
                error.cloudSchemaVersion = cloudVersion;
                throw error;
            }
            notifyCloudSchemaNewer(payload, options);
        }
        return {
            newer: newer,
            schemaVersion: cloudVersion,
            localSchemaVersion: currentSchemaVersion()
        };
    }

    global.currentSchemaVersion = currentSchemaVersion;
    global.readSchemaVersion = readSchemaVersion;
    global.stampSchemaVersion = stampSchemaVersion;
    global.isCloudSchemaNewer = isCloudSchemaNewer;
    global.notifyCloudSchemaNewer = notifyCloudSchemaNewer;
    global.assertCanUploadOverCloud = assertCanUploadOverCloud;
    global.guardIncomingBankPayload = guardIncomingBankPayload;
    global.schemaNewerUploadMessage = schemaNewerUploadMessage;
    global.schemaNewerLoadMessage = schemaNewerLoadMessage;
})(window);
