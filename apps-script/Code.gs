/**
 * Poe question-generation proxy and private GitHub sync for econ-database.
 *
 * The public site never receives the server Poe API key, the GitHub token, the GitHub
 * account, or the private repository name, and it never sees who is allowed
 * to use these features. All of that lives only in Script properties:
 *   POE_API_KEY                (shared Poe fallback for admin only; see resolveApiKey_)
 *   OPENROUTER_API_KEY         (optional shared OpenRouter fallback for admin only)
 *   ALLOWED_ADMIN_HASHES       (SHA-256 hex; full rights: AI + GitHub + admin + mocks)
 *   ALLOWED_AI_HASHES          (SHA-256 hex; AI出題／追問／AI解釋／題幹檢視 + mocks; no GitHub)
 *   ALLOWED_MOCK_HASHES        (SHA-256 hex; mockTests only; no AI / GitHub / admin)
 *   ALLOWED_RESTRICTED_HASHES  (SHA-256 hex; known browse; no mock / AI / GitHub)
 *   GITHUB_TOKEN
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH        (optional; main when empty)
 *   GITHUB_DATA_PATH     (under shared prefix; shape data/database.json → shared/data/database.json)
 *   GITHUB_AI_BACKUP_DIR (inside each user's folder; shape ai-backups)
 *   GITHUB_SHARED_PREFIX (optional; shared when empty)
 *   GITHUB_READ_TOKEN    (optional; fine-grained Contents: Read only — browser direct reads)
 *   GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID / GITHUB_APP_PRIVATE_KEY
 *                        (optional; preferred short-lived installation tokens for browser reads)
 *
 * Question-bank upload/download is shared for every githubSync user:
 *   <GITHUB_SHARED_PREFIX>/<GITHUB_DATA_PATH>
 *   e.g. shared/data/database.json
 * syncDataUpload accepts multi-file dirty-shard writes (Phase 3): allowlisted
 * paths under the shared prefix — data/database-hkeaa.json, data/database-aristo.json,
 * and combined data/database.json (GITHUB_DATA_PATH). Legacy body.data still
 * writes combined only. Empty shard payloads are refused (no silent wipe).
 * syncDataDownload (D2) returns shards merge: mockTests → hkeaa+aristo;
 * otherwise HKEAA only. No silent fallback to combined database.json.
 * Username is required for auth only and must not appear in the bank path.
 * Bank paths under users/ are rejected.
 * Admin data-checks (ken only, githubSync) use a sibling shared file:
 *   <GITHUB_SHARED_PREFIX>/data/data-checks.json
 *   e.g. shared/data/data-checks.json
 * via syncDataChecksUpload / syncDataChecksDownload.
 * AI解釋 (ai-gated generate/vote/feedback; admin list feedback):
 *   <GITHUB_SHARED_PREFIX>/data/ai-explanations.json
 *   e.g. shared/data/ai-explanations.json
 * Legacy question field AIExplanation (URL) is unused by new clients.
 * 回報問題 (any known user; admin list):
 *   <GITHUB_SHARED_PREFIX>/data/issue-reports.json
 *   e.g. shared/data/issue-reports.json
 * 分題提案 staging (propose never writes bank; approve patches owning shard + combined):
 *   <GITHUB_SHARED_PREFIX>/data/question-parts-proposals.json
 *   e.g. shared/data/question-parts-proposals.json
 * 分類提案 staging (concepts / stemPatterns; pause at 200 pending):
 *   <GITHUB_SHARED_PREFIX>/data/classification-proposals.json
 *   e.g. shared/data/classification-proposals.json
 * Personal preferences (known user; getUserSettings / saveUserSettings):
 *   users/<username>/settings.json
 * Model-reply (AI出題) backups stay personal:
 *   users/<username>/<GITHUB_AI_BACKUP_DIR>/<timestamp>-….json
 * <username> is the trimmed, lowercased signed-in name. Spaces become hyphens.
 * The browser does not choose that path and never sees the owner or repository.
 * listAiUsageRecords is admin-only. It reads those same backup files for the
 * fixed folders in AI_USAGE_RECORD_USERS_ and ignores any other name in the request.
 * listAiBackups and listAiUsageRecords each return one page of AI_BACKUP_LIST_MAX_
 * generateQuestions files, newest first. Pass after / afterName to continue.
 * Personal Git backup *files* may also store testModel / continueGeneration
 * (written as action "reply" — see backupFileAction_); list/usage APIs still
 * page generateQuestions only. Lean list responses (metadata + contentPreview);
 * full text via getAiBackup (chunked). The request still cannot choose other users.
 *
 * Shared diagrams, the question bank, and paper packs live under the same prefix.
 * GITHUB_SHARED_PREFIX defaults to shared. The site asks for a relative path
 * such as data/database.json, data/database-hkeaa.json, data/database-aristo.json,
 * diagrams/…, originals/…, or papers/….
 * Publisher shards (hkeaa / aristo) are readable the same way as database.json
 * for known users; database-aristo.json is mockTests-only (sharedMockOnly_).
 * Client load (D2) is shards-only (mock merges both; else HKEAA);
 * no silent combined fallback. Combined remains for dual-write / schema peek (D4).
 * Upload (Phase 3) writes dirty publisher shards + combined dual-write.
 * Approve bank patches resolve questionId into the owning shard and update combined.
 * The script reads <prefix>/<relative path> and will not read users/.
 * A static host such as GitHub Pages cannot read a private repository:
 * raw file URLs for a private repo answer 404 unless a token is sent, and
 * the token stays in Script properties. Large shared assets prefer
 * issueSharedReadToken + direct GitHub API from the browser; fetchSharedAsset
 * and listSharedData remain Apps Script fallbacks for those files.
 *
 * Least privilege (admin):
 * - Deploy the web app as "Execute as: Me" (the account that owns the key
 *   and can edit this spreadsheet). Confirm "Who has access: Anyone".
 *   The public site has no Google sign-in, so anonymous access is required.
 *   This script still refuses Poe and GitHub calls unless the username is allowed.
 * - Do not put the key, the token, the owner, the repository name, or the
 *   real allowlist in the sheet, this repo, or the page.
 * - urlFetchWhitelist in appsscript.json limits outbound calls to api.poe.com,
 *   openrouter.ai, and api.github.com. The browser never calls those hosts with a secret.
 * - UsageLog is created on first write. Protect that tab so casual editors
 *   cannot wipe the audit trail. The deploying account can still append.
 * - GenerationBackup is a separate tab. Successful generateQuestions,
 *   continueGeneration, and testModel calls append the model reply there.
 *   Protect that tab too. Do not point BACKUP_SHEET_NAME at UsageLog or a
 *   data tab.
 * - The spreadsheet may currently be shared with edit access. Narrow that
 *   share when you can. Visitors do not need sheet access; the web app
 *   writes the log as the deploying account.
 * - Production allowlists are hash-only. In the bound spreadsheet use
 *   出題代理 → 計算使用者名稱雜湊. Paste each username in that private
 *   dialog, then copy the hex into exactly one of ALLOWED_ADMIN_HASHES,
 *   ALLOWED_AI_HASHES, ALLOWED_MOCK_HASHES, or ALLOWED_RESTRICTED_HASHES
 *   (comma, newline, or space separated). Do not commit those hashes or
 *   the usernames. ALLOWED_USER_HASHES and ALLOWED_USERS are not read.
 *   Delete them.
 * - Script property changes apply immediately. Code changes need a new
 *   deployment version (Manage deployments → Edit → New version) so the
 *   existing /exec URL keeps working.
 * - Bind this project to the log spreadsheet (Extensions → Apps Script)
 *   or set SPREADSHEET_ID. Do not point LOG_SHEET_NAME at a data tab.
 * - GitHub responses to the browser are ok/error, plus a commit sha and the
 *   configured relative path. They never include the write token. Direct-read
 *   sessions (issueSharedReadToken) intentionally return a short-lived read
 *   credential plus owner/repo/branch so the browser can call api.github.com.
 *
 * === Code.gs map (POST action → handler) ===
 * Entry: doGet / doPost → handlePost_
 * Access / login:
 *   checkAccess | checkRights → handleCheck_
 *   logLogin                   → handleLogin_
 * AI出題／追問／test／personal backups／admin usage:
 *   generateQuestions   → handleGenerate_
 *   continueGeneration  → handleContinueGeneration_  (multi-turn follow-up; messages[]; refs optional)
 *   testModel           → handleTest_
 *   reviewStemPatterns  → handleReviewStemPatterns_  (no Git AI backup / no GenerationBackup sheet)
 *   listAiBackups       → handleListAiBackups_
 *   getAiBackup         → handleGetAiBackup_
 *   listAiUsageRecords  → handleListAiUsageRecords_  (admin)
 * AI解釋 side-file (shared/data/ai-explanations.json):
 *   generateAiExplanation     → handleGenerateAiExplanation_  (ai)
 *   voteAiExplanation         → handleVoteAiExplanation_      (ai)
 *   feedbackAiExplanation     → handleFeedbackAiExplanation_  (ai)
 *   deleteAiExplanation       → handleDeleteAiExplanation_    (admin)
 *   listAiExplanationFeedback → handleListAiExplanationFeedback_ (admin)
 *   updateAiExplanationFeedbackStatus → handleUpdateAiExplanationFeedbackStatus_ (admin)
 *   bulkUpdateAiExplanationFeedbackStatus → handleBulkUpdateAiExplanationFeedbackStatus_ (admin)
 * 回報問題 side-file (shared/data/issue-reports.json):
 *   reportIssue               → handleReportIssue_       (known user)
 *   listIssueReports          → handleListIssueReports_  (admin)
 *   updateIssueReportStatus   → handleUpdateIssueReportStatus_ (admin)
 *   bulkUpdateIssueReportStatus → handleBulkUpdateIssueReportStatus_ (admin)
 * 分題提案 staging (shared/data/question-parts-proposals.json):
 *   listQuestionPartsProposals      → handleListQuestionPartsProposals_   (admin)
 *   proposeQuestionParts            → handleProposeQuestionParts_         (admin|githubSync)
 *   approveQuestionPartsProposal    → handleApproveQuestionPartsProposal_ (admin; bank patch)
 *   bulkApproveQuestionPartsProposals → handleBulkApproveQuestionPartsProposals_ (admin; bank patch)
 *   rejectQuestionPartsProposal     → handleRejectQuestionPartsProposal_  (admin)
 *   bulkRejectQuestionPartsProposals  → handleBulkRejectQuestionPartsProposals_  (admin)
 * 分類提案 staging (shared/data/classification-proposals.json; concepts / stemPatterns):
 *   listClassificationProposals       → handleListClassificationProposals_       (admin)
 *   submitClassificationProposal      → handleSubmitClassificationProposal_      (admin|githubSync; soft warn≥200)
 *   approveClassificationProposal     → handleApproveClassificationProposal_     (admin; shard bank patch; multi-field + blank-only)
 *   bulkApproveClassificationProposals → handleBulkApproveClassificationProposals_ (admin; bank patch)
 *   rejectClassificationProposal      → handleRejectClassificationProposal_      (admin; optional rejectFields keeps other fields)
 *   bulkRejectClassificationProposals → handleBulkRejectClassificationProposals_ (admin)
 *   flushStagingApprovals             → handleFlushStagingApprovals_             (admin; validate-all then one write/file)
 * Personal user settings (users/<username>/settings.json; known user; not bank SCHEMA):
 *   getUserSettings  → handleGetUserSettings_
 *   saveUserSettings → handleSaveUserSettings_
 * Shared bank read (Apps Script body fallback; prefer direct read below):
 *   fetchSharedAsset → handleFetchShared_
 *   listSharedData   → handleListShared_
 * Direct browser read (short-lived read credential; large files bypass echo):
 *   issueSharedReadToken → handleIssueSharedReadToken_
 *     GitHub App install token preferred (mintGithubInstallationToken_);
 *     else GITHUB_READ_TOKEN (issueGithubDirectReadCredential_)
 * Shared asset write + vision describe (server GITHUB_TOKEN / AI proxy):
 *   uploadSharedAsset → handleUploadSharedAsset_  (githubSync; diagrams/|originals/ only)
 *   describeImage     → handleDescribeImage_      (ai; multimodal Poe/OpenRouter)
 * Admin Git sync (shared bank write/read via server GITHUB_TOKEN):
 *   syncDataUpload   → handleGitUpload_  (multi-file dirty shards; schema_version_stale)
 *   syncDataDownload → handleGitDownload_ (returns schemaVersion)
 * Data-checks sync (ken + githubSync; shared/data/data-checks.json):
 *   syncDataChecksUpload   → handleDataChecksUpload_
 *   syncDataChecksDownload → handleDataChecksDownload_
 * Notable helpers (not POST actions):
 *   Rights: lookupRights_ / rightsFromLists_
 *   GitHub App PEM/JWT: normalizeGithubAppPrivateKeyPem_ / githubAppJwt_
 *   GitHub I/O: githubFetch_ / githubReadText_ / githubWriteText_
 *   AI backup file: writeGitAiBackup_
 */

// === Constants / HTTP entry ===

var POE_CHAT_URL_ = 'https://api.poe.com/v1/chat/completions';
var OPENROUTER_CHAT_URL_ = 'https://openrouter.ai/api/v1/chat/completions';
var POE_DEFAULT_MODEL_ = 'Claude-Sonnet-5.5';
var OPENROUTER_DEFAULT_MODEL_ = 'openai/gpt-4o-mini';
var OPENROUTER_MODEL_MAX_ = 120;
var POE_MODEL_MAX_ = 120;
// Dropdown presets for Poe (keep in sync with POE_MODELS in js/poe-generate-state.js).
// Clients may also send a sanitized free-text Poe bot id (isAllowedPoeModelId_).
// OpenRouter accepts free-text ids (validated by isAllowedOpenRouterModel_).
var POE_ALLOWED_MODELS_ = ['Claude-Sonnet-5.5', 'GPT-6.1-Sol', 'Gemini-3.8-Flash', 'Gemini-4-Argon', 'GLM-5.3-flash', 'GLM-5.3'];
// Ids and display names only. Prompts stay in POE_GENERATION_MODES on the client
// and arrive as `instruction`. Keep ids and names in sync with that object.
var POE_MODE_NAMES_ = {
  'style-continue': '風格延續・求新',
  'vary-examples': '改例子／數字',
  'add-novelty': '題型加新意',
  'different-types': '截然不同題型'
};
var POE_INSTRUCTION_ = '參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。';
var POE_INSTRUCTION_MAX_ = 4000;
var POE_SHEET_CELL_MAX_ = 45000;
var POE_SYSTEM_PROMPT_ = '你是香港中學文憑試經濟科的出題助手。請只用繁體中文回答。題目必須是全新的，不可原句複製參考題。請依照使用者的出題指示。每題都要有問題與解釋；若指示要求說明新意或創新之處，請一併說明。';
var POE_TEST_SYSTEM_PROMPT_ = '你是連線測試助手。請嚴格依照使用者要求回覆，不要出題，不要加解釋。';
var POE_TEST_USER_PROMPT_ = '請只回覆這一個詞：正常';
// Stem-pattern review (題幹模式檢視). Independent of generateQuestions.
// Reply stays in the browser; this action must not write Git AI backups.
var STEM_REVIEW_SYSTEM_PROMPT_ = [
  '你是香港中學文憑試經濟科題庫的題幹模式（stemPatterns）審核助手。',
  '請只用繁體中文回答。不要撰寫新題目，不要改寫原題幹。',
  'stemPatterns 是可重用的抽象題幹模板（問法形狀），不是故事細節、不是課程課題名、也不是題型標籤（patterns，例如填空／複選組合）。',
  '抽象時用 (某人)、(某事件)、(某物品)、(某市場)、(某廠商)；空白用 ___________；選項用全形斜線 ／。',
  '優先沿用「既有詞彙」清單中的字串；只有在確實沒有合適模板時才建議新字串。',
  '若題幹文字缺失，可建議維持空陣列。'
].join('');
var STEM_REVIEW_MAX_QUESTIONS_ = 30;
var STEM_REVIEW_MAX_CHARS_ = 90000;
var STEM_REVIEW_VOCAB_MAX_ = 120;

function doGet() {
  var key = String(props_().getProperty('POE_API_KEY') || '').trim();
  var git = githubConfig_();
  return json_({
    ok: true,
    service: 'question-proxy',
    configured: key.length > 0,
    gitConfigured: githubDataReady_(git) && githubBackupReady_(git),
    sharedConfigured: githubSharedReady_(git),
    directReadConfigured: githubDirectReadReady_(git)
  });
}

function doPost(e) {
  try {
    return json_(handlePost_(e));
  } catch (err) {
    safeLog_(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function handlePost_(e) {
  var body = parseBody_(e);
  var action = String(body.action || '');
  if (action === 'logLogin') return handleLogin_(body);
  if (action === 'checkAccess' || action === 'checkRights') return handleCheck_(body);
  if (action === 'generateQuestions') return handleGenerate_(body);
  if (action === 'continueGeneration') return handleContinueGeneration_(body);
  if (action === 'generateAiExplanation') return handleGenerateAiExplanation_(body);
  if (action === 'voteAiExplanation') return handleVoteAiExplanation_(body);
  if (action === 'feedbackAiExplanation') return handleFeedbackAiExplanation_(body);
  if (action === 'deleteAiExplanation') return handleDeleteAiExplanation_(body);
  if (action === 'listAiExplanationFeedback') return handleListAiExplanationFeedback_(body);
  if (action === 'updateAiExplanationFeedbackStatus') return handleUpdateAiExplanationFeedbackStatus_(body);
  if (action === 'bulkUpdateAiExplanationFeedbackStatus') return handleBulkUpdateAiExplanationFeedbackStatus_(body);
  if (action === 'reportIssue') return handleReportIssue_(body);
  if (action === 'listIssueReports') return handleListIssueReports_(body);
  if (action === 'updateIssueReportStatus') return handleUpdateIssueReportStatus_(body);
  if (action === 'bulkUpdateIssueReportStatus') return handleBulkUpdateIssueReportStatus_(body);
  if (action === 'listQuestionPartsProposals') return handleListQuestionPartsProposals_(body);
  if (action === 'proposeQuestionParts') return handleProposeQuestionParts_(body);
  if (action === 'approveQuestionPartsProposal') return handleApproveQuestionPartsProposal_(body);
  if (action === 'bulkApproveQuestionPartsProposals') return handleBulkApproveQuestionPartsProposals_(body);
  if (action === 'rejectQuestionPartsProposal') return handleRejectQuestionPartsProposal_(body);
  if (action === 'bulkRejectQuestionPartsProposals') return handleBulkRejectQuestionPartsProposals_(body);
  if (action === 'listClassificationProposals') return handleListClassificationProposals_(body);
  if (action === 'submitClassificationProposal') return handleSubmitClassificationProposal_(body);
  if (action === 'approveClassificationProposal') return handleApproveClassificationProposal_(body);
  if (action === 'bulkApproveClassificationProposals') return handleBulkApproveClassificationProposals_(body);
  if (action === 'rejectClassificationProposal') return handleRejectClassificationProposal_(body);
  if (action === 'bulkRejectClassificationProposals') return handleBulkRejectClassificationProposals_(body);
  if (action === 'flushStagingApprovals') return handleFlushStagingApprovals_(body);
  if (action === 'getUserSettings') return handleGetUserSettings_(body);
  if (action === 'saveUserSettings') return handleSaveUserSettings_(body);
  if (action === 'reviewStemPatterns') return handleReviewStemPatterns_(body);
  if (action === 'syncDataUpload') return handleGitUpload_(body);
  if (action === 'syncDataDownload') return handleGitDownload_(body);
  if (action === 'syncDataChecksUpload') return handleDataChecksUpload_(body);
  if (action === 'syncDataChecksDownload') return handleDataChecksDownload_(body);
  if (action === 'fetchSharedAsset') return handleFetchShared_(body);
  if (action === 'listSharedData') return handleListShared_(body);
  if (action === 'issueSharedReadToken') return handleIssueSharedReadToken_(body);
  if (action === 'uploadSharedAsset') return handleUploadSharedAsset_(body);
  if (action === 'describeImage') return handleDescribeImage_(body);
  if (action === 'listAiBackups') return handleListAiBackups_(body);
  if (action === 'getAiBackup') return handleGetAiBackup_(body);
  if (action === 'listAiUsageRecords') return handleListAiUsageRecords_(body);
  if (action === 'testModel') return handleTest_(body);
  return { ok: false, error: 'bad_request' };
}

// === Access / login / role helpers ===

// Booleans only (admin, ai, githubSync, mockTests). No username echo.
function handleCheck_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return rightsResponse_(null);
  return rightsResponse_(lookupRights_(username));
}

// Deduped login audit row for a known username.
function handleLogin_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return { ok: false, error: 'bad_request' };
  if (shouldAudit_(username, 'login', 30 * 60)) {
    writeLog_({
      username: username,
      action: 'login',
      success: true,
      metadata: {}
    }, false);
  }
  return { ok: true };
}

// paste: pasted questions. single: one displayed question (stem + answer). Anything else is filter.
function referenceSource_(value) {
  var text = String(value || '');
  if (text === 'paste' || text === 'single') return text;
  return 'filter';
}


function resolveProvider_(body) {
  var value = String(body && body.provider || '').trim().toLowerCase();
  return value === 'openrouter' ? 'openrouter' : 'poe';
}

function resolvePoeApiKey_(body, username) {
  // Prefer a non-empty per-request key from the browser. Never log or store it.
  var fromBody = String(body && body.poeApiKey || '').trim();
  if (fromBody) return fromBody;
  // Shared Script property POE_API_KEY is admin-only. Production admin
  // (ALLOWED_ADMIN_HASHES) maps to a single operator; AI editors and other
  // roles must send their own poeApiKey. Gate on admin (same users as
  // githubSync), not a plaintext username, so hashes stay out of git.
  var rights = lookupRights_(username);
  if (rights && rights.admin === true) {
    return String(props_().getProperty('POE_API_KEY') || '').trim();
  }
  return '';
}

function resolveOpenRouterApiKey_(body, username) {
  var fromBody = String(body && body.openRouterApiKey || '').trim();
  if (fromBody) return fromBody;
  var rights = lookupRights_(username);
  if (rights && rights.admin === true) {
    return String(props_().getProperty('OPENROUTER_API_KEY') || '').trim();
  }
  return '';
}

function resolveApiKey_(body, username, provider) {
  provider = provider === 'openrouter' ? 'openrouter' : 'poe';
  if (provider === 'openrouter') return resolveOpenRouterApiKey_(body, username);
  return resolvePoeApiKey_(body, username);
}


// Web-app executions stop at 6 minutes. Do not start a lock the return cannot outlive.
var GENERATE_EXECUTION_LIMIT_MS_ = 360000;

function executionMsLeft_(invokedAt) {
  return GENERATE_EXECUTION_LIMIT_MS_ - (Date.now() - invokedAt);
}

function requestId_(value) {
  var id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return '';
  return id;
}

function payloadJsonChars_(obj) {
  try {
    return JSON.stringify(obj).length;
  } catch (err) {
    return CONTENT_SERVICE_INLINE_MAX_CHARS_ + 1;
  }
}

// Drop full reply text from a successful generate payload when the JSON would
// be too large for the Apps Script / googleusercontent echo path. The client
// then loads the Git backup (backupName / requestId / listAiBackups).
function finalizeGeneratePayload_(result, backupName, requestId) {
  if (!result || result.ok !== true) return result;
  var id = requestId_(requestId || result.requestId);
  if (id) result.requestId = id;
  if (backupName) {
    result.backupName = String(backupName);
    result.gitBackup = true;
  }
  var content = String(result.content == null ? '' : result.content);
  if (content) result.contentChars = content.length;
  else if (typeof result.contentChars !== 'number') result.contentChars = 0;
  // Already deferred on an earlier return path.
  if (!content && result.contentViaBackup === true) {
    result.gitBackup = !!result.backupName || result.gitBackup === true;
    return result;
  }
  if (payloadJsonChars_(result) <= CONTENT_SERVICE_INLINE_MAX_CHARS_) {
    result.contentViaBackup = false;
    return result;
  }
  // Only omit the body when the client can fetch it from Git by name.
  if (!result.backupName) {
    result.contentViaBackup = false;
    return result;
  }
  result.content = '';
  result.contentViaBackup = true;
  result.gitBackup = true;
  return result;
}

function leanAiBackupItem_(item) {
  if (!item || typeof item !== 'object') return item;
  var content = String(item.content == null ? '' : item.content);
  return {
    name: String(item.name || ''),
    action: String(item.action || ''),
    model: item.model,
    createdAt: item.createdAt,
    sentCount: item.sentCount,
    filteredCount: item.filteredCount,
    durationMs: item.durationMs,
    source: item.source,
    referenceSource: item.referenceSource,
    modeId: item.modeId,
    modeName: item.modeName,
    instruction: item.instruction,
    requestId: item.requestId,
    referenceIds: item.referenceIds || [],
    content: '',
    contentChars: content.length,
    contentPreview: clipChars_(content, AI_BACKUP_LIST_PREVIEW_CHARS_),
    lean: true
  };
}

function aiBackupContentSlice_(text, offset, limit) {
  var full = String(text == null ? '' : text);
  var start = nonNegativeInt_(offset, 0);
  if (start > full.length) start = full.length;
  var size = positiveInt_(limit, AI_BACKUP_CONTENT_CHUNK_CHARS_);
  if (size > AI_BACKUP_CONTENT_CHUNK_CHARS_) size = AI_BACKUP_CONTENT_CHUNK_CHARS_;
  var slice = full.slice(start, start + size);
  // Avoid splitting a surrogate pair at either edge of the chunk.
  if (slice.length && start > 0) {
    var first = slice.charCodeAt(0);
    if (first >= 0xDC00 && first <= 0xDFFF) {
      start += 1;
      slice = full.slice(start, start + size);
    }
  }
  if (slice.length) {
    var last = slice.charCodeAt(slice.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) slice = slice.slice(0, -1);
  }
  return {
    content: slice,
    contentOffset: start,
    contentChars: full.length,
    contentComplete: start + slice.length >= full.length
  };
}

function resolveAiBackupOwner_(requester, body) {
  var username = normalizeUsername_(requester);
  if (!username) return '';
  var ownerRaw = body && (body.owner != null ? body.owner : body.targetUser);
  if (ownerRaw == null || String(ownerRaw).trim() === '') return username;
  var owner = normalizeUsername_(ownerRaw);
  if (!owner) return '';
  if (owner === username) return username;
  var rights = lookupRights_(username);
  if (!rights || rights.admin !== true) return '';
  if (!aiUsageOwnerAllowed_(owner) || owner === username) return '';
  return owner;
}

// === AI generate / continueGeneration / lean reply payload ===
// testModel and reviewStemPatterns live under "Model test / stem pattern review" below.

// Poe or OpenRouter completion; may defer large content via Git AI backup.
function handleGenerate_(body) {
  // Budget is the 6-minute web-app cap, measured from entry so a slow model
  // call can still return after the reply is saved.
  var invokedAt = Date.now();
  var username = normalizeUsername_(body.username);
  var source = referenceSource_(body && body.source);
  if (!username || !lookupRights_(username).ai) {
    if (username && shouldAudit_(username, 'generate-denied', 60)) {
      writeLog_({
        username: username,
        action: 'generateQuestions',
        success: false,
        metadata: { error: 'denied', source: source }
      }, false);
    }
    return { ok: false, error: 'feature_unavailable' };
  }

  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: { error: 'missing_api_key', source: source, provider: provider }
    }, true);
    return { ok: false, error: 'missing_api_key' };
  }

  try {
    getLogSheet_();
    getBackupSheet_();
  } catch (err) {
    safeLog_(err);
    return { ok: false, error: 'server_error' };
  }

  var maxReferences = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCES'), 40), 80);
  var maxChars = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCE_CHARS'), 80000), 200000);
  var packed = packReferences_(body.questions, maxReferences, maxChars);
  if (!packed.questions.length) {
    return { ok: false, error: 'no_reference_questions' };
  }

  var filteredCount = clampInt_(body.filteredCount, packed.questions.length, 100000);
  if (filteredCount < packed.questions.length) filteredCount = packed.questions.length;

  var dailyLimit = nonNegativeInt_(props_().getProperty('POE_DAILY_LIMIT'), 40);
  if (dailyLimit > 0 && countTodayGenerations_(username) >= dailyLimit) {
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: { error: 'daily_limit', source: source }
    }, true);
    return { ok: false, error: 'rate_limited' };
  }

  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds)) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var modeId = resolveModeId_(body.modeId);
  var instructionMeta = instructionMeta_(body.instruction);
  var referenceIds = referenceIdsForBackup_(body, packed, source);
  var started = Date.now();
  try {
    var completion = requestCompletion_(apiKey, model, buildPrompt_(packed.questions, filteredCount, packed.truncated, instructionMeta.text, source), POE_SYSTEM_PROMPT_, provider);
    var durationMs = Date.now() - started;
    var gitBackup = false;
    var backupName = '';
    var requestId = requestId_(body && body.requestId);
    var replyChars = String(completion.content || '').length;
    // Long replies must hit Git before the ContentService echo. Prefer backup
    // when the payload would otherwise exceed the inline JSON budget.
    var backupMsNeeded = replyChars > (CONTENT_SERVICE_INLINE_MAX_CHARS_ / 2) ? 8000 : 45000;
    if (executionMsLeft_(invokedAt) > backupMsNeeded) {
      try {
        backupName = writeGitAiBackup_({
          action: 'generateQuestions',
          username: username,
          model: completion.model || model,
          content: completion.content,
          sentCount: packed.questions.length,
          filteredCount: filteredCount,
          durationMs: durationMs,
          source: source,
          modeId: modeId,
          modeName: modeName_(modeId),
          instruction: instructionMeta.text,
          referenceIds: referenceIds,
          requestId: requestId
        }) || '';
        gitBackup = !!backupName;
      } catch (backupErr) {
        safeLog_(backupErr);
      }
    }
    var result = {
      ok: true,
      content: completion.content,
      model: completion.model || model,
      sentCount: packed.questions.length,
      filteredCount: filteredCount,
      truncated: packed.truncated,
      logged: false,
      backedUp: false,
      durationMs: durationMs,
      gitBackup: gitBackup,
      requestId: requestId
    };
    if (executionMsLeft_(invokedAt) <= 25000) {
      return finalizeGeneratePayload_(result, backupName, requestId);
    }
    var generateMeta = {
      model: result.model,
      requestedModel: model,
      provider: provider,
      modeId: modeId,
      modeName: modeName_(modeId),
      sentCount: result.sentCount,
      filteredCount: filteredCount,
      truncated: packed.truncated,
      durationMs: durationMs,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      instructionChars: instructionMeta.chars,
      instructionProvidedChars: instructionMeta.providedChars,
      customInstruction: instructionMeta.custom,
      source: source,
      gitBackup: gitBackup
    };
    result.logged = writeLog_({
      username: username,
      action: 'generateQuestions',
      success: true,
      metadata: generateMeta
    }, true);
    var backupMeta = {
      requestedModel: model,
      provider: provider,
      durationMs: durationMs,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      instructionChars: instructionMeta.chars,
      instructionProvidedChars: instructionMeta.providedChars,
      customInstruction: instructionMeta.custom,
      referencesTruncated: packed.truncated,
      source: source,
      gitBackup: gitBackup,
      referenceIds: referenceIds
    };
    // A long id list must not replace the whole metadata cell.
    if (JSON.stringify(backupMeta).length > 2000) {
      delete backupMeta.referenceIds;
      backupMeta.referenceIdsOmitted = true;
    }
    result.backedUp = writeBackup_({
      username: username,
      action: 'generateQuestions',
      model: result.model,
      modeId: modeId,
      modeName: modeName_(modeId),
      instruction: instructionMeta.text,
      filteredCount: filteredCount,
      sentCount: result.sentCount,
      content: completion.content,
      metadata: backupMeta
    });
    // Sheet logging can add fields; re-check the inline budget before return.
    return finalizeGeneratePayload_(result, backupName, requestId);
  } catch (err) {
    releaseIntervalSlot_(username);
    var fail = upstreamFailurePayload_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        model: model,
        provider: provider,
        modeId: modeId,
        sentCount: packed.questions.length,
        durationMs: Date.now() - started,
        instructionChars: instructionMeta.chars,
        instructionProvidedChars: instructionMeta.providedChars,
        customInstruction: instructionMeta.custom,
        source: source
      }, err)
    }, true);
    return fail;
  }
}

// Multi-turn follow-up after generateQuestions. Client sends messages[]
// (prior user/assistant turns). Full reference bank is NOT re-attached unless
// includeReferences is true and questions[] is provided.
function handleContinueGeneration_(body) {
  var invokedAt = Date.now();
  var username = normalizeUsername_(body.username);
  var source = referenceSource_(body && body.source);
  if (!username || !lookupRights_(username).ai) {
    if (username && shouldAudit_(username, 'continue-denied', 60)) {
      writeLog_({
        username: username,
        action: 'continueGeneration',
        success: false,
        metadata: { error: 'denied', source: source }
      }, false);
    }
    return { ok: false, error: 'feature_unavailable' };
  }

  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'continueGeneration',
      success: false,
      metadata: { error: 'missing_api_key', source: source, provider: provider }
    }, true);
    return { ok: false, error: 'missing_api_key' };
  }

  try {
    getLogSheet_();
    getBackupSheet_();
  } catch (err) {
    safeLog_(err);
    return { ok: false, error: 'server_error' };
  }

  var packedMessages = normalizeContinueMessages_(body.messages, POE_SYSTEM_PROMPT_);
  if (!packedMessages.ok) {
    return { ok: false, error: packedMessages.error || 'bad_request' };
  }

  var includeReferences = !!(body.includeReferences === true || body.includeReferences === 'true' || body.includeReferences === 1);
  var packedRefs = { questions: [], truncated: false };
  var sentCount = 0;
  if (includeReferences) {
    var maxReferences = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCES'), 40), 80);
    var maxChars = Math.min(positiveInt_(props_().getProperty('POE_MAX_REFERENCE_CHARS'), 80000), 200000);
    packedRefs = packReferences_(body.questions, maxReferences, maxChars);
    sentCount = packedRefs.questions.length;
    if (sentCount) {
      var refBlock = buildPrompt_(
        packedRefs.questions,
        sentCount,
        packedRefs.truncated,
        '【補充參考題（此追問回合選擇附上）】請對照以下題幹與答案；不要重新完整出題除非使用者要求。',
        source
      );
      // Insert just before the last user turn so the follow-up stays last.
      var msgs = packedMessages.messages.slice();
      var insertAt = msgs.length;
      for (var mi = msgs.length - 1; mi >= 0; mi--) {
        if (msgs[mi].role === 'user') {
          insertAt = mi;
          break;
        }
      }
      msgs.splice(insertAt, 0, { role: 'user', content: refBlock });
      packedMessages.messages = msgs;
      packedMessages.messageCount = msgs.length;
    }
  }

  var dailyLimit = nonNegativeInt_(props_().getProperty('POE_DAILY_LIMIT'), 40);
  if (dailyLimit > 0 && countTodayGenerations_(username) >= dailyLimit) {
    writeLog_({
      username: username,
      action: 'continueGeneration',
      success: false,
      metadata: { error: 'daily_limit', source: source }
    }, true);
    return { ok: false, error: 'rate_limited' };
  }

  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds)) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var modeId = resolveModeId_(body.modeId);
  var started = Date.now();
  var requestId = requestId_(body && body.requestId);
  try {
    var completion = requestCompletionMessages_(apiKey, model, packedMessages.messages, provider);
    var durationMs = Date.now() - started;
    var gitBackup = false;
    var backupName = '';
    var replyChars = String(completion.content || '').length;
    var backupMsNeeded = replyChars > (CONTENT_SERVICE_INLINE_MAX_CHARS_ / 2) ? 8000 : 45000;
    if (executionMsLeft_(invokedAt) > backupMsNeeded) {
      try {
        backupName = writeGitAiBackup_({
          action: 'continueGeneration',
          username: username,
          model: completion.model || model,
          content: completion.content,
          sentCount: sentCount,
          filteredCount: clampInt_(body.filteredCount, sentCount, 100000),
          durationMs: durationMs,
          source: source,
          modeId: modeId,
          modeName: modeName_(modeId),
          instruction: '',
          referenceIds: includeReferences ? referenceIdsForBackup_(body, packedRefs, source) : [],
          requestId: requestId,
          messageCount: packedMessages.messageCount
        }) || '';
        gitBackup = !!backupName;
      } catch (backupErr) {
        safeLog_(backupErr);
      }
    }
    var result = {
      ok: true,
      content: completion.content,
      model: completion.model || model,
      sentCount: sentCount,
      filteredCount: clampInt_(body.filteredCount, sentCount, 100000),
      truncated: !!packedRefs.truncated,
      logged: false,
      backedUp: false,
      durationMs: durationMs,
      gitBackup: gitBackup,
      requestId: requestId,
      continue: true,
      messageCount: packedMessages.messageCount
    };
    if (executionMsLeft_(invokedAt) <= 25000) {
      return finalizeGeneratePayload_(result, backupName, requestId);
    }
    result.logged = writeLog_({
      username: username,
      action: 'continueGeneration',
      success: true,
      metadata: {
        model: result.model,
        requestedModel: model,
        provider: provider,
        modeId: modeId,
        modeName: modeName_(modeId),
        sentCount: sentCount,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        source: source,
        gitBackup: gitBackup,
        includeReferences: includeReferences,
        messageCount: packedMessages.messageCount
      }
    }, true);
    result.backedUp = writeBackup_({
      username: username,
      action: 'continueGeneration',
      model: result.model,
      modeId: modeId,
      modeName: modeName_(modeId),
      instruction: '',
      filteredCount: result.filteredCount,
      sentCount: sentCount,
      content: completion.content,
      metadata: {
        requestedModel: model,
        provider: provider,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        source: source,
        gitBackup: gitBackup,
        includeReferences: includeReferences,
        messageCount: packedMessages.messageCount
      }
    });
    return finalizeGeneratePayload_(result, backupName, requestId);
  } catch (err) {
    releaseIntervalSlot_(username);
    var fail = upstreamFailurePayload_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'continueGeneration',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        model: model,
        provider: provider,
        modeId: modeId,
        durationMs: Date.now() - started,
        source: source,
        messageCount: packedMessages.messageCount
      }, err)
    }, true);
    return fail;
  }
}

// === AI 解釋 (shared/data/ai-explanations.json) ===
// Side file keyed by question id. Votes / feedback / bodies live here so
// the questions bank is not rewritten on every vote. Legacy question field
// AIExplanation (URL) is unused by new clients.

var AI_EXPLANATIONS_REL_PATH_ = 'data/ai-explanations.json';
var AI_EXPLANATIONS_MAX_BYTES_ = 2000000;
var AI_EXPLANATIONS_MAX_PER_QUESTION_ = 30;
var AI_EXPLANATIONS_MAX_FEEDBACK_ = 40;
var AI_EXPLANATION_SYSTEM_PROMPT_ = [
  '你是香港 DSE／公開試經濟科導師。請根據使用者提供的題幹與答案撰寫「AI解釋」。',
  '必須以中英雙語撰寫解釋：先繁體中文（香港），再英文；可用清楚標題分段（例如「中文」「English」）。',
  '題目與答案可能同時提供中文與英文版本；兩者都要參考，不要只根據其中一種語言。',
  '解說要正確、清楚，適合學生閱讀。',
  '不要虛構題目沒有的資料；若答案資料不足，請明確說明。',
  '不要輸出外部連結。'
].join('');

function githubSharedAiExplanationsPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  return joinGithubPath_(prefix, AI_EXPLANATIONS_REL_PATH_);
}

function emptyAiExplanationsStore_() {
  return { version: 1, updatedAt: '', byQuestion: {} };
}

function normalizeAiDetailLevel_(raw) {
  var text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (text === 'detailed' || text === '詳盡' || text === 'detail' || text === 'long') return 'detailed';
  return 'short';
}

function newAiExplanationId_() {
  return 'ax_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function readAiExplanationsStore_(cfg) {
  var path = githubSharedAiExplanationsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      throw gitFail_('github_error');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw gitFail_('github_error');
    }
    if (!parsed.byQuestion || typeof parsed.byQuestion !== 'object' || Array.isArray(parsed.byQuestion)) {
      parsed.byQuestion = {};
    }
    if (typeof parsed.version !== 'number') parsed.version = 1;
    return { store: parsed, sha: read.sha || '', path: path, existed: true };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return { store: emptyAiExplanationsStore_(), sha: '', path: path, existed: false };
    }
    throw err;
  }
}

function writeAiExplanationsStore_(cfg, store, message) {
  var path = githubSharedAiExplanationsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  store.version = 1;
  store.updatedAt = new Date().toISOString();
  if (!store.byQuestion || typeof store.byQuestion !== 'object') store.byQuestion = {};
  var text = JSON.stringify(store);
  if (utf8Length_(text) > AI_EXPLANATIONS_MAX_BYTES_) throw gitFail_('payload_too_large');
  var written = githubWriteText_(cfg, path, text, message || 'Update AI explanations');
  return { sha: written.sha, path: path, store: store };
}

function mutateAiExplanationsStore_(username, message, mutator) {
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var loaded = readAiExplanationsStore_(cfg);
    var result = mutator(loaded.store);
    if (!result || result.ok === false) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return result && result.error ? gitClientError_(result.error) : gitClientError_('bad_request');
    }
    var written = writeAiExplanationsStore_(cfg, loaded.store, message);
    lock.releaseLock();
    held = false;
    return {
      ok: true,
      sha: written.sha,
      path: written.path,
      explanation: result.explanation || null,
      explanations: result.explanations || null,
      feedback: result.feedback || null,
      deletedId: result.deletedId || null,
      questionId: result.questionId || null
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function listExplanationsForQuestion_(store, questionId) {
  var bucket = store.byQuestion && store.byQuestion[questionId];
  if (!bucket || !Array.isArray(bucket.explanations)) return [];
  return bucket.explanations.slice();
}

function findExplanation_(store, questionId, explanationId) {
  var list = listExplanationsForQuestion_(store, questionId);
  for (var i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].id) === String(explanationId)) return list[i];
  }
  return null;
}

function publicExplanationView_(exp, viewer) {
  if (!exp) return null;
  var up = Array.isArray(exp.votes && exp.votes.up) ? exp.votes.up : [];
  var down = Array.isArray(exp.votes && exp.votes.down) ? exp.votes.down : [];
  var myVote = '';
  if (viewer) {
    if (up.indexOf(viewer) !== -1) myVote = 'up';
    else if (down.indexOf(viewer) !== -1) myVote = 'down';
  }
  return {
    id: String(exp.id || ''),
    questionId: String(exp.questionId || ''),
    detailLevel: normalizeAiDetailLevel_(exp.detailLevel),
    model: String(exp.model || ''),
    createdAt: String(exp.createdAt || ''),
    createdBy: String(exp.createdBy || ''),
    text: String(exp.text || ''),
    upCount: up.length,
    downCount: down.length,
    myVote: myVote,
    feedbackCount: Array.isArray(exp.feedback) ? exp.feedback.length : 0
  };
}

function blankAiField_(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text || text === '-') return '';
  return text;
}

// Pack one bank row for AI解釋: always keep Chinese + English stem/answer
// (plus MC letter) so the model sees both languages. Falls back to legacy
// `question` / `explanation` fields when bilingual fields are absent.
function packAiExplanationQuestion_(raw) {
  var item = raw && typeof raw === 'object' ? raw : {};
  var questionChi = blankAiField_(
    item.questionChi || item.questionTextChi || item.question || item.plainText
  );
  var questionEng = blankAiField_(item.questionEng || item.questionTextEng);
  if (questionChi) questionChi = clip_(questionChi, 6000);
  if (questionEng) questionEng = clip_(questionEng, 6000);
  if (!questionChi && !questionEng) return null;

  var answerMC = blankAiField_(item.answerMC);
  if (answerMC) answerMC = clip_(answerMC, 40);
  var answerChi = blankAiField_(item.answerChi);
  var answerEng = blankAiField_(item.answerEng);
  if (answerChi) answerChi = clip_(answerChi, 6000);
  if (answerEng) answerEng = clip_(answerEng, 6000);
  var legacyAnswer = blankAiField_(item.explanation || item.answer);
  if (legacyAnswer) legacyAnswer = clip_(legacyAnswer, 6000);
  if (!answerChi && !answerEng && !answerMC && legacyAnswer) {
    answerChi = legacyAnswer;
  }

  return {
    id: clip_(item.id, 80),
    examination: clip_(item.examination, 40),
    year: clip_(item.year, 20),
    questionType: clip_(item.questionType, 40),
    concepts: clip_(item.concepts, 300),
    questionChi: questionChi,
    questionEng: questionEng,
    answerMC: answerMC,
    answerChi: answerChi,
    answerEng: answerEng,
    // Legacy aliases kept for older clients / logs.
    question: questionChi || questionEng,
    explanation: answerChi || answerEng || answerMC || ''
  };
}

function formatAiAnswerBlock_(mc, written) {
  var letter = blankAiField_(mc);
  var text = blankAiField_(written);
  if (letter && text) {
    return text.indexOf(letter) !== -1 ? text : letter + '\n' + text;
  }
  return letter || text || '';
}

function buildAiExplanationPrompt_(question, detailLevel) {
  var levelLabel = detailLevel === 'detailed' ? '詳盡' : '簡短';
  var lines = [];
  lines.push('請為以下經濟科題目撰寫「' + levelLabel + '」AI解釋。');
  lines.push('輸出必須為中英雙語（Chinese + English）：先寫繁體中文解釋，再寫對應的英文解釋。');
  if (detailLevel === 'detailed') {
    lines.push('詳盡要求：完整解題步驟、關鍵概念、常見陷阱，以及對照標準答案的說明；中文與英文兩部分都要涵蓋上述要點，篇幅可較長。');
  } else {
    lines.push('簡短要求：精簡重點（核心概念 + 答案要點）；中文與英文各約精簡一段，避免冗長。');
  }
  lines.push('');
  if (question.id) lines.push('題號：' + question.id);
  if (question.examination) lines.push('考試：' + question.examination);
  if (question.year) lines.push('年份：' + question.year);
  if (question.questionType) lines.push('題型：' + question.questionType);
  if (question.concepts) lines.push('概念：' + question.concepts);
  lines.push('題幹（中文）：');
  lines.push(blankAiField_(question.questionChi || question.question) || '（沒有中文題幹）');
  lines.push('Question (English):');
  lines.push(blankAiField_(question.questionEng) || '(No English stem)');
  lines.push('答案（中文）：');
  lines.push(formatAiAnswerBlock_(question.answerMC, question.answerChi || question.explanation) || '（沒有中文答案）');
  lines.push('Answer (English):');
  lines.push(formatAiAnswerBlock_(question.answerMC, question.answerEng) || '(No English answer)');
  return lines.join('\n');
}

function handleGenerateAiExplanation_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) {
    return { ok: false, error: 'feature_unavailable' };
  }
  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) return { ok: false, error: 'missing_api_key' };

  var questionId = String(body.questionId || (body.question && body.question.id) || '').trim();
  if (!questionId || questionId.length > 80) return { ok: false, error: 'bad_request' };
  var detailLevel = normalizeAiDetailLevel_(body.detailLevel);
  var qref = packAiExplanationQuestion_(body.question || body);
  if (!qref) return { ok: false, error: 'no_reference_questions' };
  qref.id = questionId;

  var dailyLimit = nonNegativeInt_(props_().getProperty('POE_DAILY_LIMIT'), 40);
  if (dailyLimit > 0 && countTodayGenerations_(username) >= dailyLimit) {
    return { ok: false, error: 'rate_limited' };
  }
  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds)) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var started = Date.now();
  try {
    var completion = requestCompletion_(
      apiKey,
      model,
      buildAiExplanationPrompt_(qref, detailLevel),
      AI_EXPLANATION_SYSTEM_PROMPT_,
      provider
    );
    var durationMs = Date.now() - started;
    var text = String(completion.content || '').trim();
    if (!text) {
      releaseIntervalSlot_(username);
      return { ok: false, error: 'empty_response' };
    }
    var nowIso = new Date().toISOString();
    var record = {
      id: newAiExplanationId_(),
      questionId: questionId,
      detailLevel: detailLevel,
      model: completion.model || model,
      createdAt: nowIso,
      createdBy: username,
      text: text,
      votes: { up: [], down: [] },
      feedback: []
    };
    var saved = mutateAiExplanationsStore_(username, 'Add AI explanation for ' + questionId, function (store) {
      if (!store.byQuestion[questionId] || typeof store.byQuestion[questionId] !== 'object') {
        store.byQuestion[questionId] = { explanations: [] };
      }
      var list = Array.isArray(store.byQuestion[questionId].explanations)
        ? store.byQuestion[questionId].explanations
        : [];
      list.unshift(record);
      if (list.length > AI_EXPLANATIONS_MAX_PER_QUESTION_) {
        list = list.slice(0, AI_EXPLANATIONS_MAX_PER_QUESTION_);
      }
      store.byQuestion[questionId].explanations = list;
      return {
        ok: true,
        explanation: publicExplanationView_(record, username),
        explanations: list.map(function (item) { return publicExplanationView_(item, username); })
      };
    });
    if (!saved || saved.ok !== true) {
      // Generation succeeded but persist failed — still return text so the user is not blank.
      writeLog_({
        username: username,
        action: 'generateAiExplanation',
        success: false,
        metadata: {
          error: saved && saved.error ? saved.error : 'github_error',
          questionId: questionId,
          model: record.model,
          detailLevel: detailLevel,
          durationMs: durationMs,
          persistFailed: true
        }
      }, true);
      return {
        ok: true,
        persisted: false,
        explanation: publicExplanationView_(record, username),
        explanations: [publicExplanationView_(record, username)],
        model: record.model,
        durationMs: durationMs,
        error: saved && saved.error ? saved.error : 'github_error'
      };
    }
    writeLog_({
      username: username,
      action: 'generateAiExplanation',
      success: true,
      metadata: {
        questionId: questionId,
        model: record.model,
        provider: provider,
        detailLevel: detailLevel,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens
      }
    }, true);
    return {
      ok: true,
      persisted: true,
      explanation: saved.explanation,
      explanations: saved.explanations,
      model: record.model,
      durationMs: durationMs,
      sha: saved.sha,
      path: saved.path
    };
  } catch (err) {
    releaseIntervalSlot_(username);
    var fail = upstreamFailurePayload_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'generateAiExplanation',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        questionId: questionId,
        model: model,
        detailLevel: detailLevel
      }, err)
    }, true);
    return fail;
  }
}

function handleDeleteAiExplanation_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var questionId = String(body.questionId || '').trim();
  var explanationId = String(body.explanationId || '').trim();
  if (!questionId || !explanationId) return { ok: false, error: 'bad_request' };
  if (questionId.length > 80 || explanationId.length > 80) return { ok: false, error: 'bad_request' };

  var saved = mutateAiExplanationsStore_(username, 'Delete AI explanation ' + explanationId, function (store) {
    var list = listExplanationsForQuestion_(store, questionId);
    var next = [];
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === explanationId) {
        found = true;
        continue;
      }
      next.push(list[i]);
    }
    if (!found) return { ok: false, error: 'not_found' };
    if (!next.length) {
      delete store.byQuestion[questionId];
    } else {
      if (!store.byQuestion[questionId] || typeof store.byQuestion[questionId] !== 'object') {
        store.byQuestion[questionId] = { explanations: [] };
      }
      store.byQuestion[questionId].explanations = next;
    }
    return {
      ok: true,
      questionId: questionId,
      deletedId: explanationId,
      explanations: next.map(function (item) {
        return publicExplanationView_(item, username);
      })
    };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return {
    ok: true,
    questionId: questionId,
    deletedId: saved.deletedId || explanationId,
    explanations: Array.isArray(saved.explanations) ? saved.explanations : [],
    sha: saved.sha,
    path: saved.path
  };
}

function handleVoteAiExplanation_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) return { ok: false, error: 'feature_unavailable' };
  var questionId = String(body.questionId || '').trim();
  var explanationId = String(body.explanationId || '').trim();
  var vote = String(body.vote == null ? '' : body.vote).trim().toLowerCase();
  if (!questionId || !explanationId) return { ok: false, error: 'bad_request' };
  if (vote && vote !== 'up' && vote !== 'down') return { ok: false, error: 'bad_request' };

  var saved = mutateAiExplanationsStore_(username, 'Vote AI explanation ' + explanationId, function (store) {
    var exp = findExplanation_(store, questionId, explanationId);
    if (!exp) return { ok: false, error: 'not_found' };
    if (!exp.votes || typeof exp.votes !== 'object') exp.votes = { up: [], down: [] };
    var up = Array.isArray(exp.votes.up) ? exp.votes.up.filter(Boolean) : [];
    var down = Array.isArray(exp.votes.down) ? exp.votes.down.filter(Boolean) : [];
    up = up.filter(function (u) { return u !== username; });
    down = down.filter(function (u) { return u !== username; });
    if (vote === 'up') up.push(username);
    if (vote === 'down') down.push(username);
    exp.votes.up = up;
    exp.votes.down = down;
    return {
      ok: true,
      explanation: publicExplanationView_(exp, username),
      explanations: listExplanationsForQuestion_(store, questionId).map(function (item) {
        return publicExplanationView_(item, username);
      })
    };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return {
    ok: true,
    explanation: saved.explanation,
    explanations: saved.explanations,
    sha: saved.sha
  };
}

function handleFeedbackAiExplanation_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) return { ok: false, error: 'feature_unavailable' };
  var questionId = String(body.questionId || '').trim();
  var explanationId = String(body.explanationId || '').trim();
  var text = String(body.text == null ? '' : body.text).trim();
  var rating = String(body.rating == null ? '' : body.rating).trim().toLowerCase();
  if (!questionId || !explanationId || !text) return { ok: false, error: 'bad_request' };
  if (text.length > 2000) text = text.slice(0, 2000);
  if (rating && rating !== 'up' && rating !== 'down') rating = '';

  var entry = {
    id: 'fb_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    user: username,
    rating: rating || null,
    text: text,
    status: 'open',
    at: new Date().toISOString()
  };

  var saved = mutateAiExplanationsStore_(username, 'Feedback AI explanation ' + explanationId, function (store) {
    var exp = findExplanation_(store, questionId, explanationId);
    if (!exp) return { ok: false, error: 'not_found' };
    if (!Array.isArray(exp.feedback)) exp.feedback = [];
    exp.feedback.unshift(entry);
    if (exp.feedback.length > AI_EXPLANATIONS_MAX_FEEDBACK_) {
      exp.feedback = exp.feedback.slice(0, AI_EXPLANATIONS_MAX_FEEDBACK_);
    }
    return {
      ok: true,
      explanation: publicExplanationView_(exp, username),
      feedback: entry,
      explanations: listExplanationsForQuestion_(store, questionId).map(function (item) {
        return publicExplanationView_(item, username);
      })
    };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return {
    ok: true,
    explanation: saved.explanation,
    feedback: saved.feedback,
    explanations: saved.explanations,
    sha: saved.sha
  };
}

function normalizeHubItemStatus_(raw) {
  var text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (text === 'resolved' || text === 'closed' || text === 'done'
      || text === '已修' || text === '已關閉' || text === '已處理') {
    return 'resolved';
  }
  // Missing / pending / open → open (backward compatible default).
  return 'open';
}

function hubStatusLabel_(status) {
  return normalizeHubItemStatus_(status) === 'resolved' ? '已關閉' : '待處理';
}

function publicAiFeedbackRow_(qid, exp, fb) {
  var status = normalizeHubItemStatus_(fb && fb.status);
  return {
    id: String(fb && fb.id || ''),
    questionId: qid,
    explanationId: String(exp && exp.id || ''),
    detailLevel: normalizeAiDetailLevel_(exp && exp.detailLevel),
    model: String(exp && exp.model || ''),
    explanationSnippet: clip_(String(exp && exp.text || ''), 160),
    upCount: Array.isArray(exp && exp.votes && exp.votes.up) ? exp.votes.up.length : 0,
    downCount: Array.isArray(exp && exp.votes && exp.votes.down) ? exp.votes.down.length : 0,
    user: String(fb && fb.user || ''),
    rating: fb && fb.rating ? String(fb.rating) : '',
    text: String(fb && fb.text || ''),
    status: status,
    statusLabel: hubStatusLabel_(status),
    at: String(fb && fb.at || '')
  };
}

function sortHubRowsOpenFirst_(rows, dateKey) {
  var key = dateKey || 'at';
  rows.sort(function (a, b) {
    var aOpen = normalizeHubItemStatus_(a && a.status) === 'open' ? 0 : 1;
    var bOpen = normalizeHubItemStatus_(b && b.status) === 'open' ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return String(b && b[key] || '').localeCompare(String(a && a[key] || ''));
  });
  return rows;
}

function findAiFeedbackEntry_(store, feedbackId) {
  var id = String(feedbackId || '').trim();
  if (!id) return null;
  var byQuestion = store && store.byQuestion ? store.byQuestion : {};
  var qids = Object.keys(byQuestion);
  for (var i = 0; i < qids.length; i++) {
    var qid = qids[i];
    var list = listExplanationsForQuestion_(store, qid);
    for (var j = 0; j < list.length; j++) {
      var exp = list[j];
      var feedback = Array.isArray(exp.feedback) ? exp.feedback : [];
      for (var k = 0; k < feedback.length; k++) {
        if (String(feedback[k] && feedback[k].id || '') === id) {
          return { questionId: qid, explanation: exp, feedback: feedback[k] };
        }
      }
    }
  }
  return null;
}

function handleListAiExplanationFeedback_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  try {
    var loaded = readAiExplanationsStore_(cfg);
    var rows = [];
    var byQuestion = loaded.store.byQuestion || {};
    Object.keys(byQuestion).forEach(function (qid) {
      var list = listExplanationsForQuestion_(loaded.store, qid);
      list.forEach(function (exp) {
        var feedback = Array.isArray(exp.feedback) ? exp.feedback : [];
        feedback.forEach(function (fb) {
          rows.push(publicAiFeedbackRow_(qid, exp, fb));
        });
      });
    });
    sortHubRowsOpenFirst_(rows, 'at');
    if (rows.length > 500) rows = rows.slice(0, 500);
    return { ok: true, rows: rows, path: loaded.path, sha: loaded.sha };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return { ok: true, rows: [], path: githubSharedAiExplanationsPath_(cfg), sha: '' };
    }
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

function handleUpdateAiExplanationFeedbackStatus_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var feedbackId = String(body.feedbackId || body.id || '').trim();
  var status = normalizeHubItemStatus_(body.status);
  if (!feedbackId) return { ok: false, error: 'bad_request' };
  var saved = mutateAiExplanationsStore_(username, 'Update AI feedback status ' + feedbackId, function (store) {
    var found = findAiFeedbackEntry_(store, feedbackId);
    if (!found) return { ok: false, error: 'not_found' };
    found.feedback.status = status;
    return { ok: true, feedback: publicAiFeedbackRow_(found.questionId, found.explanation, found.feedback) };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return { ok: true, feedback: saved.feedback, sha: saved.sha, path: saved.path };
}

function handleBulkUpdateAiExplanationFeedbackStatus_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var ids = Array.isArray(body.ids) ? body.ids : (Array.isArray(body.feedbackIds) ? body.feedbackIds : []);
  var status = normalizeHubItemStatus_(body.status);
  var want = {};
  var ordered = [];
  ids.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);
  var saved = mutateAiExplanationsStore_(username, 'Bulk update AI feedback status', function (store) {
    var updated = [];
    ordered.forEach(function (id) {
      var found = findAiFeedbackEntry_(store, id);
      if (!found) return;
      found.feedback.status = status;
      updated.push(publicAiFeedbackRow_(found.questionId, found.explanation, found.feedback));
    });
    if (!updated.length) return { ok: false, error: 'not_found' };
    return { ok: true, feedback: updated };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return {
    ok: true,
    updated: Array.isArray(saved.feedback) ? saved.feedback : [],
    sha: saved.sha,
    path: saved.path
  };
}

// === 回報問題 (shared/data/issue-reports.json) ===
// Side file of user issue reports keyed by id. Any known username may submit;
// admin lists for the combined feedback viewer.

var ISSUE_REPORTS_REL_PATH_ = 'data/issue-reports.json';
var ISSUE_REPORTS_MAX_BYTES_ = 1500000;
var ISSUE_REPORTS_MAX_ITEMS_ = 2000;
var ISSUE_REPORT_TAGS_ = {
  typo: '有錯字',
  image: '圖片未能正確顯示',
  classification: '分類不正確',
  other: '其他'
};

function githubSharedIssueReportsPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  return joinGithubPath_(prefix, ISSUE_REPORTS_REL_PATH_);
}

function emptyIssueReportsStore_() {
  return { version: 1, updatedAt: '', reports: [] };
}

function normalizeIssueTags_(raw) {
  var list = Array.isArray(raw) ? raw : [];
  var out = [];
  var seen = {};
  list.forEach(function (item) {
    var key = String(item == null ? '' : item).trim().toLowerCase();
    if (key === 'typo' || key === '有錯字') key = 'typo';
    else if (key === 'image' || key === '圖片未能正確顯示' || key === 'image_fail') key = 'image';
    else if (key === 'classification' || key === '分類不正確') key = 'classification';
    else if (key === 'other' || key === '其他') key = 'other';
    else return;
    if (seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function readIssueReportsStore_(cfg) {
  var path = githubSharedIssueReportsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      throw gitFail_('github_error');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw gitFail_('github_error');
    }
    if (!Array.isArray(parsed.reports)) parsed.reports = [];
    if (typeof parsed.version !== 'number') parsed.version = 1;
    return { store: parsed, sha: read.sha || '', path: path, existed: true };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return { store: emptyIssueReportsStore_(), sha: '', path: path, existed: false };
    }
    throw err;
  }
}

function writeIssueReportsStore_(cfg, store, message) {
  var path = githubSharedIssueReportsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  store.version = 1;
  store.updatedAt = new Date().toISOString();
  if (!Array.isArray(store.reports)) store.reports = [];
  var text = JSON.stringify(store);
  if (utf8Length_(text) > ISSUE_REPORTS_MAX_BYTES_) throw gitFail_('payload_too_large');
  var written = githubWriteText_(cfg, path, text, message || 'Update issue reports');
  return { sha: written.sha, path: path, store: store };
}

// Lock + slot + read/mutate/write — same control flow as mutateAiExplanationsStore_.
function mutateIssueReportsStore_(username, message, mutator) {
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var loaded = readIssueReportsStore_(cfg);
    var result = mutator(loaded.store);
    if (!result || result.ok === false) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return result && result.error ? gitClientError_(result.error) : gitClientError_('bad_request');
    }
    var written = writeIssueReportsStore_(cfg, loaded.store, message);
    lock.releaseLock();
    held = false;
    return {
      ok: true,
      sha: written.sha,
      path: written.path,
      report: result.report || null,
      reports: result.reports || null
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function publicIssueReportView_(row) {
  if (!row) return null;
  var tags = normalizeIssueTags_(row.tags);
  var status = normalizeHubItemStatus_(row.status);
  return {
    id: String(row.id || ''),
    questionId: String(row.questionId || ''),
    tags: tags,
    tagLabels: tags.map(function (t) { return ISSUE_REPORT_TAGS_[t] || t; }),
    text: String(row.text || ''),
    user: String(row.user || ''),
    status: status,
    statusLabel: hubStatusLabel_(status),
    createdAt: String(row.createdAt || '')
  };
}

function findIssueReportById_(store, reportId) {
  var id = String(reportId || '').trim();
  if (!id) return null;
  var list = Array.isArray(store && store.reports) ? store.reports : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i] && list[i].id || '') === id) return list[i];
  }
  return null;
}

function handleReportIssue_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return { ok: false, error: 'feature_unavailable' };

  var questionId = String(body.questionId || '').trim();
  if (!questionId || questionId.length > 80) return { ok: false, error: 'bad_request' };
  var tags = normalizeIssueTags_(body.tags);
  var text = String(body.text == null ? '' : body.text).trim();
  if (text.length > 4000) text = text.slice(0, 4000);
  if (!tags.length && !text) return { ok: false, error: 'bad_request' };
  if (!tags.length) tags = ['other'];

  var record = {
    id: 'ir_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16),
    questionId: questionId,
    tags: tags,
    text: text,
    user: username,
    status: 'open',
    createdAt: new Date().toISOString()
  };

  var saved = mutateIssueReportsStore_(username, 'Add issue report for ' + questionId, function (store) {
    var list = Array.isArray(store.reports) ? store.reports : [];
    list.unshift(record);
    if (list.length > ISSUE_REPORTS_MAX_ITEMS_) list = list.slice(0, ISSUE_REPORTS_MAX_ITEMS_);
    store.reports = list;
    return { ok: true, report: publicIssueReportView_(record) };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'reportIssue',
    success: true,
    metadata: { questionId: questionId, tags: tags.join(',') }
  }, true);
  return {
    ok: true,
    report: saved.report,
    sha: saved.sha,
    path: saved.path
  };
}

function handleListIssueReports_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  try {
    var loaded = readIssueReportsStore_(cfg);
    var rows = (loaded.store.reports || []).map(publicIssueReportView_).filter(Boolean);
    sortHubRowsOpenFirst_(rows, 'createdAt');
    if (rows.length > 500) rows = rows.slice(0, 500);
    return { ok: true, rows: rows, path: loaded.path, sha: loaded.sha };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return { ok: true, rows: [], path: githubSharedIssueReportsPath_(cfg), sha: '' };
    }
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

function handleUpdateIssueReportStatus_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var reportId = String(body.reportId || body.id || '').trim();
  var status = normalizeHubItemStatus_(body.status);
  if (!reportId) return { ok: false, error: 'bad_request' };
  var saved = mutateIssueReportsStore_(username, 'Update issue report status ' + reportId, function (store) {
    var row = findIssueReportById_(store, reportId);
    if (!row) return { ok: false, error: 'not_found' };
    row.status = status;
    return { ok: true, report: publicIssueReportView_(row) };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return { ok: true, report: saved.report, sha: saved.sha, path: saved.path };
}

function handleBulkUpdateIssueReportStatus_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var ids = Array.isArray(body.ids) ? body.ids : (Array.isArray(body.reportIds) ? body.reportIds : []);
  var status = normalizeHubItemStatus_(body.status);
  var want = {};
  var ordered = [];
  ids.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);
  var saved = mutateIssueReportsStore_(username, 'Bulk update issue report status', function (store) {
    var updated = [];
    ordered.forEach(function (id) {
      var row = findIssueReportById_(store, id);
      if (!row) return;
      row.status = status;
      updated.push(publicIssueReportView_(row));
    });
    if (!updated.length) return { ok: false, error: 'not_found' };
    return { ok: true, reports: updated };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  return {
    ok: true,
    updated: Array.isArray(saved.reports) ? saved.reports : [],
    sha: saved.sha,
    path: saved.path
  };
}

// === 分題提案 staging (shared/data/question-parts-proposals.json) ===
// Agents / bulk fillers propose questionParts here. Only approve patches the
// shared bank (database.json). Propose never touches the bank. Pending-only
// file: approve and reject both remove the staging row.

var QUESTION_PARTS_PROPOSALS_REL_PATH_ = 'data/question-parts-proposals.json';
var QUESTION_PARTS_PROPOSALS_MAX_BYTES_ = 2000000;
var QUESTION_PARTS_PROPOSALS_MAX_ITEMS_ = 5000;
var QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_ = 1;
var PARTS_PROPOSAL_PERFORMANCE_ = {
  '優異': true,
  '優良': true,
  '良好': true,
  '令人滿意': true,
  '尚可': true,
  '欠佳': true
};
var PARTS_PROPOSAL_SUM_TOLERANCE_ = 0.001;

function githubSharedQuestionPartsProposalsPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  return joinGithubPath_(prefix, QUESTION_PARTS_PROPOSALS_REL_PATH_);
}

function emptyQuestionPartsProposalsStore_() {
  return {
    schemaVersion: QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_,
    updatedAt: '',
    proposals: []
  };
}

function readQuestionPartsProposalsStore_(cfg) {
  var path = githubSharedQuestionPartsProposalsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      throw gitFail_('github_error');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw gitFail_('github_error');
    }
    if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
    if (typeof parsed.schemaVersion !== 'number') {
      parsed.schemaVersion = QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_;
    }
    return { store: parsed, sha: read.sha || '', path: path, existed: true };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return {
        store: emptyQuestionPartsProposalsStore_(),
        sha: '',
        path: path,
        existed: false
      };
    }
    throw err;
  }
}

function writeQuestionPartsProposalsStore_(cfg, store, message) {
  var path = githubSharedQuestionPartsProposalsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  store.schemaVersion = QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_;
  store.updatedAt = new Date().toISOString();
  if (!Array.isArray(store.proposals)) store.proposals = [];
  var text = JSON.stringify(store);
  if (utf8Length_(text) > QUESTION_PARTS_PROPOSALS_MAX_BYTES_) {
    throw gitFail_('payload_too_large');
  }
  var written = githubWriteText_(cfg, path, text, message || 'Update question-parts proposals');
  return { sha: written.sha, path: path, store: store };
}

function normalizeProposalPart_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var label = String(raw.label == null ? (raw.id == null ? '' : raw.id) : raw.label).trim();
  var marksRaw = raw.marks;
  var marks = null;
  if (marksRaw !== null && marksRaw !== undefined && String(marksRaw).trim() !== '') {
    var num = Number(String(marksRaw).trim());
    if (isFinite(num)) marks = num;
  }
  var performance = String(raw.performance == null ? '' : raw.performance).trim();
  if (performance && !PARTS_PROPOSAL_PERFORMANCE_[performance]) performance = '';
  if (!label && marks === null && !performance) return null;
  return { label: label, marks: marks, performance: performance };
}

function normalizeProposalParts_(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var part = normalizeProposalPart_(raw[i]);
    if (part) out.push(part);
  }
  return out;
}

function validateProposalPartsSum_(parts, totalMarks, questionId) {
  var idLabel = String(questionId || '').trim() || '（無編號）';
  if (!parts.length) {
    return {
      ok: false,
      error: 'validation_failed',
      message: '題目「' + idLabel + '」提案沒有有效分題。'
    };
  }
  var missing = [];
  var sum = 0;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].marks === null || parts[i].marks === undefined) {
      missing.push(parts[i].label || String(i + 1));
    } else {
      sum += Number(parts[i].marks);
    }
  }
  if (missing.length) {
    return {
      ok: false,
      error: 'validation_failed',
      message: '題目「' + idLabel + '」有分題但缺少分數（' + missing.join('、') + '）。'
    };
  }
  // Blank / non-numeric bank total: treat parts sum as the total (approve will write marks).
  var blankTotal = totalMarks === null || totalMarks === undefined || String(totalMarks).trim() === '';
  var total = blankTotal ? NaN : Number(totalMarks);
  if (blankTotal || !isFinite(total)) {
    return { ok: true, sum: sum, total: sum, filledMarksFromParts: true };
  }
  if (Math.abs(sum - total) > PARTS_PROPOSAL_SUM_TOLERANCE_) {
    return {
      ok: false,
      error: 'validation_failed',
      message: '題目「' + idLabel + '」分題分數合計為 ' + String(sum)
        + '，與總分 ' + String(total) + ' 不符。'
    };
  }
  return { ok: true, sum: sum, total: total, filledMarksFromParts: false };
}

function bankQuestionHasFilledParts_(question) {
  if (!question || typeof question !== 'object') return false;
  if (String(question.partsStatus || '').trim().toLowerCase() === 'filled') return true;
  return Array.isArray(question.questionParts) && question.questionParts.length > 0;
}

function publicPartsProposalView_(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    questionId: String(row.questionId || ''),
    questionParts: normalizeProposalParts_(row.questionParts),
    partsStatus: 'filled',
    note: String(row.note || ''),
    source: String(row.source || ''),
    proposedBy: String(row.proposedBy || ''),
    proposedAt: String(row.proposedAt || '')
  };
}

function findPartsProposal_(store, proposalId, questionId) {
  var list = Array.isArray(store && store.proposals) ? store.proposals : [];
  var pid = String(proposalId || '').trim();
  var qid = String(questionId || '').trim();
  var i;
  if (pid) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].id || '') === pid) {
        return { proposal: list[i], index: i };
      }
    }
  }
  if (qid) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].questionId || '') === qid) {
        return { proposal: list[i], index: i };
      }
    }
  }
  return null;
}

function removePartsProposalAt_(store, index) {
  var list = Array.isArray(store.proposals) ? store.proposals : [];
  if (index < 0 || index >= list.length) return null;
  var removed = list[index];
  list.splice(index, 1);
  store.proposals = list;
  return removed;
}

// --- Phase 3 approve bank workspace (shards + combined dual-write) ---
// Resolve questionId into HKEAA / 雅集 shards when present; always refresh combined.
function tryReadBankFile_(cfg, path) {
  if (!path) return null;
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.questions)) parsed.questions = [];
    return { bank: parsed, sha: read.sha || '', path: path };
  } catch (err) {
    if (err && err.code === 'github_not_found') return null;
    throw err;
  }
}

function githubSharedBankShardPath_(cfg, key) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  var rel = '';
  if (key === 'hkeaa') rel = 'data/database-hkeaa.json';
  else if (key === 'aristo') rel = 'data/database-aristo.json';
  else if (key === 'combined') return githubSharedBankPath_(cfg);
  else return '';
  var full = joinGithubPath_(prefix, rel);
  if (!full || full === 'users' || full.indexOf('users/') === 0) return '';
  if (!githubPathOk_(full)) return '';
  return full;
}

function publisherShardKeyForApprove_(publisher) {
  var p = String(publisher == null ? '' : publisher).trim();
  if (p === 'HKEAA') return 'hkeaa';
  if (p === '雅集出版社') return 'aristo';
  return '';
}

function readSharedBankForPartsApprove_(cfg) {
  var combinedPath = githubSharedBankPath_(cfg);
  if (!combinedPath) throw gitFail_('github_error');
  var hkeaaPath = githubSharedBankShardPath_(cfg, 'hkeaa');
  var aristoPath = githubSharedBankShardPath_(cfg, 'aristo');
  var hkeaa = tryReadBankFile_(cfg, hkeaaPath);
  var aristo = tryReadBankFile_(cfg, aristoPath);
  var combined = tryReadBankFile_(cfg, combinedPath);

  var questions = [];
  var usedShards = false;
  if (hkeaa && Array.isArray(hkeaa.bank.questions)) {
    usedShards = true;
    for (var i = 0; i < hkeaa.bank.questions.length; i++) {
      questions.push(hkeaa.bank.questions[i]);
    }
  }
  if (aristo && Array.isArray(aristo.bank.questions)) {
    usedShards = true;
    for (var j = 0; j < aristo.bank.questions.length; j++) {
      questions.push(aristo.bank.questions[j]);
    }
  }
  if (!usedShards) {
    if (!combined) throw gitFail_('github_not_found');
    questions = combined.bank.questions;
  } else if (!combined) {
    // Shards exist but combined missing — synthesize a combined view for dual-write.
    combined = {
      bank: {
        version: (hkeaa && hkeaa.bank.version) || (aristo && aristo.bank.version) || '1.0',
        schemaVersion: Math.max(
          readBankSchemaVersion_(hkeaa && hkeaa.bank),
          readBankSchemaVersion_(aristo && aristo.bank)
        ),
        questions: [],
        questionCount: 0
      },
      sha: '',
      path: combinedPath
    };
  }

  var viewBank = {
    version: (combined && combined.bank.version) || (hkeaa && hkeaa.bank.version) || '1.0',
    schemaVersion: Math.max(
      readBankSchemaVersion_(combined && combined.bank),
      readBankSchemaVersion_(hkeaa && hkeaa.bank),
      readBankSchemaVersion_(aristo && aristo.bank)
    ),
    exportDate: (combined && combined.bank.exportDate) || '',
    questions: questions,
    questionCount: questions.length
  };
  // Keep unknown top-level keys from combined when present.
  if (combined && combined.bank) {
    var keys = Object.keys(combined.bank);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === 'questions' || key === 'questionCount' || key === 'exportDate') continue;
      if (!Object.prototype.hasOwnProperty.call(viewBank, key)) {
        viewBank[key] = combined.bank[key];
      }
    }
  }
  viewBank.__approveWs = {
    hkeaa: hkeaa,
    aristo: aristo,
    combined: combined,
    combinedPath: combinedPath,
    usedShards: usedShards
  };
  return {
    bank: viewBank,
    sha: (combined && combined.sha) || (hkeaa && hkeaa.sha) || (aristo && aristo.sha) || '',
    path: combinedPath
  };
}

function writeBankFilePayload_(cfg, path, bank, message) {
  if (!path) throw gitFail_('github_error');
  bank.exportDate = new Date().toISOString();
  bank.questionCount = Array.isArray(bank.questions) ? bank.questions.length : 0;
  var text = JSON.stringify(bank);
  if (utf8Length_(text) > GITHUB_DATA_MAX_BYTES_) throw gitFail_('payload_too_large');
  return githubWriteText_(cfg, path, text, message || 'Update question bank');
}

function writeSharedBankForPartsApprove_(cfg, bank, message) {
  var ws = bank && bank.__approveWs;
  var combinedPath = githubSharedBankPath_(cfg);
  if (!combinedPath) throw gitFail_('github_error');

  // Legacy / no workspace: write combined only.
  if (!ws) {
    var writtenLegacy = writeBankFilePayload_(cfg, combinedPath, bank, message);
    return { sha: writtenLegacy.sha, path: combinedPath };
  }

  var msg = message || 'Approve bank patch';
  var last = { sha: '', path: combinedPath };

  if (ws.usedShards) {
    // Partition the (possibly mutated) view questions back into shards by publisher.
    // Question objects are shared refs with shard arrays when loaded from shards;
    // re-partition still required if publisher moved (rare on approve).
    var hkeaaQs = [];
    var aristoQs = [];
    var unknown = [];
    var list = Array.isArray(bank.questions) ? bank.questions : [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var key = publisherShardKeyForApprove_(q && q.publisher);
      if (key === 'hkeaa') hkeaaQs.push(q);
      else if (key === 'aristo') aristoQs.push(q);
      else unknown.push(q);
    }
    if (unknown.length) {
      throw gitFail_('bad_request', null, {
        message: 'Approve write refused: question publisher not HKEAA/雅集出版社 ('
          + unknown.length + ')'
      });
    }

    function cloneShell_(source, questions) {
      var out = {};
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        var sk = Object.keys(source);
        for (var s = 0; s < sk.length; s++) {
          var skk = sk[s];
          if (skk === 'questions' || skk === 'questionCount' || skk === 'exportDate') continue;
          if (skk === '__approveWs') continue;
          out[skk] = source[skk];
        }
      }
      out.questions = questions;
      out.questionCount = questions.length;
      if (typeof out.schemaVersion !== 'number') {
        out.schemaVersion = readBankSchemaVersion_(bank);
      }
      return out;
    }

    // Safety: never write an empty shard over a non-empty cloud shard unless the
    // view truly has zero of that publisher after partition (possible wipe).
    // Approve patches should not empty a shard; refuse empty overwrite of existing.
    if (ws.hkeaa && ws.hkeaa.path) {
      if (hkeaaQs.length === 0 && (ws.hkeaa.bank.questions || []).length > 0) {
        throw gitFail_('bad_request', null, {
          message: 'Refuse emptying HKEAA shard on approve'
        });
      }
      var hPayload = cloneShell_(ws.hkeaa.bank, hkeaaQs);
      last = writeBankFilePayload_(cfg, ws.hkeaa.path, hPayload, msg + ' [hkeaa]');
      ws.hkeaa.bank = hPayload;
    }
    if (ws.aristo && ws.aristo.path) {
      if (aristoQs.length === 0 && (ws.aristo.bank.questions || []).length > 0) {
        throw gitFail_('bad_request', null, {
          message: 'Refuse emptying 雅集 shard on approve'
        });
      }
      var aPayload = cloneShell_(ws.aristo.bank, aristoQs);
      last = writeBankFilePayload_(cfg, ws.aristo.path, aPayload, msg + ' [aristo]');
      ws.aristo.bank = aPayload;
    }
  }

  // Dual-write combined for fallback / old readers.
  var combinedShell = {};
  var base = (ws.combined && ws.combined.bank) || bank;
  var bk = Object.keys(base);
  for (var b = 0; b < bk.length; b++) {
    var bkey = bk[b];
    if (bkey === 'questions' || bkey === 'questionCount' || bkey === 'exportDate') continue;
    if (bkey === '__approveWs') continue;
    combinedShell[bkey] = base[bkey];
  }
  combinedShell.questions = Array.isArray(bank.questions) ? bank.questions : [];
  combinedShell.questionCount = combinedShell.questions.length;
  if (typeof combinedShell.schemaVersion !== 'number') {
    combinedShell.schemaVersion = readBankSchemaVersion_(bank);
  }
  last = writeBankFilePayload_(cfg, combinedPath, combinedShell, msg + ' [combined]');
  return { sha: last.sha, path: combinedPath };
}

function findBankQuestionIndex_(bank, questionId) {
  var qid = String(questionId || '').trim();
  var list = bank && Array.isArray(bank.questions) ? bank.questions : [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i] && list[i].id || '') === qid) return i;
  }
  return -1;
}

function publicBankPartsSnapshot_(question) {
  if (!question) return null;
  return {
    questionId: String(question.id || ''),
    marks: question.marks,
    partsStatus: String(question.partsStatus || ''),
    questionParts: normalizeProposalParts_(question.questionParts)
  };
}

function handleListQuestionPartsProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  try {
    var loaded = readQuestionPartsProposalsStore_(cfg);
    var rows = (loaded.store.proposals || []).map(publicPartsProposalView_).filter(Boolean);
    rows.sort(function (a, b) {
      return String(b.proposedAt || '').localeCompare(String(a.proposedAt || ''));
    });
    if (rows.length > 500) rows = rows.slice(0, 500);
    return {
      ok: true,
      rows: rows,
      path: loaded.path,
      sha: loaded.sha,
      schemaVersion: QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_
    };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return {
        ok: true,
        rows: [],
        path: githubSharedQuestionPartsProposalsPath_(cfg),
        sha: '',
        schemaVersion: QUESTION_PARTS_PROPOSALS_SCHEMA_VERSION_
      };
    }
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

// Propose: admin or githubSync (automation / Econ data fillers). Never writes database.json.
// Upserts one pending proposal per questionId.
function handleProposeQuestionParts_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !(rights.admin || rights.githubSync)) {
    return { ok: false, error: 'feature_unavailable' };
  }

  var incoming = [];
  if (Array.isArray(body.proposals)) {
    incoming = body.proposals;
  } else if (body.questionId || body.questionParts) {
    incoming = [body];
  }
  if (!incoming.length) return { ok: false, error: 'bad_request' };
  if (incoming.length > 200) incoming = incoming.slice(0, 200);

  var prepared = [];
  var i;
  for (i = 0; i < incoming.length; i++) {
    var item = incoming[i];
    if (!item || typeof item !== 'object') continue;
    var questionId = String(item.questionId || '').trim();
    if (!questionId || questionId.length > 80) continue;
    var parts = normalizeProposalParts_(item.questionParts);
    if (!parts.length) continue;
    var note = String(item.note == null ? '' : item.note).trim();
    if (note.length > 2000) note = note.slice(0, 2000);
    var source = String(item.source == null ? '' : item.source).trim();
    if (source.length > 200) source = source.slice(0, 200);
    prepared.push({
      questionId: questionId,
      questionParts: parts,
      partsStatus: 'filled',
      note: note,
      source: source
    });
  }
  if (!prepared.length) return { ok: false, error: 'bad_request' };

  var saved = mutateQuestionPartsProposalsStore_(username, 'Propose question parts (' + prepared.length + ')', function (store) {
    var list = Array.isArray(store.proposals) ? store.proposals : [];
    var existingByQid = {};
    var j;
    for (j = 0; j < list.length; j++) {
      var existingQid = String(list[j] && list[j].questionId || '');
      if (existingQid && existingByQid[existingQid] == null) {
        existingByQid[existingQid] = list[j];
      }
    }
    var replacing = {};
    for (j = 0; j < prepared.length; j++) replacing[prepared[j].questionId] = true;
    var kept = [];
    for (j = 0; j < list.length; j++) {
      var keepQid = String(list[j] && list[j].questionId || '');
      if (replacing[keepQid]) continue;
      kept.push(list[j]);
    }
    var upserted = [];
    var nowIso = new Date().toISOString();
    for (j = prepared.length - 1; j >= 0; j--) {
      var row = prepared[j];
      var prior = existingByQid[row.questionId];
      var record = {
        id: prior && prior.id
          ? String(prior.id)
          : ('qp_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16)),
        questionId: row.questionId,
        questionParts: row.questionParts,
        partsStatus: 'filled',
        note: row.note,
        source: row.source,
        proposedBy: username,
        proposedAt: nowIso
      };
      kept.unshift(record);
      upserted.unshift(publicPartsProposalView_(record));
    }
    if (kept.length > QUESTION_PARTS_PROPOSALS_MAX_ITEMS_) {
      kept = kept.slice(0, QUESTION_PARTS_PROPOSALS_MAX_ITEMS_);
    }
    store.proposals = kept;
    return { ok: true, proposals: upserted };
  });
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'proposeQuestionParts',
    success: true,
    metadata: { count: prepared.length }
  }, true);
  return {
    ok: true,
    proposals: Array.isArray(saved.proposals) ? saved.proposals : [],
    sha: saved.sha,
    path: saved.path
  };
}

function mutateQuestionPartsProposalsStore_(username, message, mutator) {
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var loaded = readQuestionPartsProposalsStore_(cfg);
    var result = mutator(loaded.store);
    if (!result || result.ok === false) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return result && result.error ? gitClientError_(result.error) : gitClientError_('bad_request');
    }
    var written = writeQuestionPartsProposalsStore_(cfg, loaded.store, message);
    lock.releaseLock();
    held = false;
    return {
      ok: true,
      sha: written.sha,
      path: written.path,
      proposals: result.proposals || null,
      proposal: result.proposal || null
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function handleApproveQuestionPartsProposal_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var proposalId = String(body.proposalId || body.id || '').trim();
  var questionIdHint = String(body.questionId || '').trim();
  var confirmOverwrite = body.confirmOverwrite === true
    || body.confirmOverwrite === 'true'
    || body.confirmOverwrite === 1;
  if (!proposalId && !questionIdHint) return { ok: false, error: 'bad_request' };

  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedBankPath_(cfg)) {
    return gitClientError_('github_not_configured');
  }
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var loadedProposals = readQuestionPartsProposalsStore_(cfg);
    var found = findPartsProposal_(loadedProposals.store, proposalId, questionIdHint);
    if (!found) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'not_found' };
    }
    var proposal = found.proposal;
    var questionId = String(proposal.questionId || '').trim();
    var parts = normalizeProposalParts_(proposal.questionParts);
    if (!questionId || !parts.length) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'bad_request' };
    }

    var loadedBank = readSharedBankForPartsApprove_(cfg);
    var qIndex = findBankQuestionIndex_(loadedBank.bank, questionId);
    if (qIndex < 0) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'not_found', message: '題庫找不到題目 ' + questionId };
    }
    var live = loadedBank.bank.questions[qIndex];
    var currentSnap = publicBankPartsSnapshot_(live);
    var proposedSnap = {
      questionId: questionId,
      marks: live.marks,
      partsStatus: 'filled',
      questionParts: parts
    };

    if (bankQuestionHasFilledParts_(live) && !confirmOverwrite) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return {
        ok: true,
        needsConfirm: true,
        proposalId: String(proposal.id || ''),
        questionId: questionId,
        current: currentSnap,
        proposed: proposedSnap,
        message: '題目已有分題資料。若要覆寫，請確認後再通過。'
      };
    }

    var sumCheck = validateProposalPartsSum_(parts, live.marks, questionId);
    if (!sumCheck.ok) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return {
        ok: false,
        error: sumCheck.error || 'validation_failed',
        message: sumCheck.message || ''
      };
    }

    live.questionParts = parts;
    live.partsStatus = 'filled';
    if (sumCheck.filledMarksFromParts) {
      live.marks = sumCheck.sum;
    }
    loadedBank.bank.questions[qIndex] = live;

    var bankWritten = writeSharedBankForPartsApprove_(
      cfg,
      loadedBank.bank,
      'Approve question parts for ' + questionId
    );

    removePartsProposalAt_(loadedProposals.store, found.index);
    var proposalsWritten = writeQuestionPartsProposalsStore_(
      cfg,
      loadedProposals.store,
      'Remove approved question-parts proposal ' + String(proposal.id || questionId)
    );

    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'approveQuestionPartsProposal',
      success: true,
      metadata: {
        questionId: questionId,
        proposalId: String(proposal.id || ''),
        overwrite: confirmOverwrite === true,
        partsCount: parts.length
      }
    }, true);
    return {
      ok: true,
      needsConfirm: false,
      questionId: questionId,
      proposalId: String(proposal.id || ''),
      question: publicBankPartsSnapshot_(live),
      bankSha: bankWritten.sha,
      bankPath: bankWritten.path,
      proposalsSha: proposalsWritten.sha,
      proposalsPath: proposalsWritten.path
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

// Bulk approve: one lock + one bank write + one proposals write.
// Body: { proposalIds: string[], confirmOverwrite?: boolean } (cap 200).
function handleBulkApproveQuestionPartsProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };

  var rawIds = Array.isArray(body.proposalIds)
    ? body.proposalIds
    : (Array.isArray(body.ids) ? body.ids : []);
  var want = {};
  var ordered = [];
  rawIds.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);

  var confirmOverwrite = body.confirmOverwrite === true
    || body.confirmOverwrite === 'true'
    || body.confirmOverwrite === 1;

  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedBankPath_(cfg)) {
    return gitClientError_('github_not_configured');
  }
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var loadedProposals = readQuestionPartsProposalsStore_(cfg);
    var loadedBank = readSharedBankForPartsApprove_(cfg);

    var approved = [];
    var needsConfirm = [];
    var failed = [];
    var removeIndexes = [];
    var i;

    for (i = 0; i < ordered.length; i++) {
      var proposalId = ordered[i];
      var found = findPartsProposal_(loadedProposals.store, proposalId, '');
      if (!found) {
        failed.push({
          proposalId: proposalId,
          questionId: '',
          error: 'not_found',
          message: '找不到提案 ' + proposalId
        });
        continue;
      }
      var proposal = found.proposal;
      var questionId = String(proposal.questionId || '').trim();
      var parts = normalizeProposalParts_(proposal.questionParts);
      if (!questionId || !parts.length) {
        failed.push({
          proposalId: String(proposal.id || proposalId),
          questionId: questionId,
          error: 'bad_request',
          message: '提案缺少有效分題。'
        });
        continue;
      }

      var qIndex = findBankQuestionIndex_(loadedBank.bank, questionId);
      if (qIndex < 0) {
        failed.push({
          proposalId: String(proposal.id || proposalId),
          questionId: questionId,
          error: 'not_found',
          message: '題庫找不到題目 ' + questionId
        });
        continue;
      }

      var live = loadedBank.bank.questions[qIndex];
      var currentSnap = publicBankPartsSnapshot_(live);
      var proposedSnap = {
        questionId: questionId,
        marks: live.marks,
        partsStatus: 'filled',
        questionParts: parts
      };

      if (bankQuestionHasFilledParts_(live) && !confirmOverwrite) {
        needsConfirm.push({
          proposalId: String(proposal.id || proposalId),
          questionId: questionId,
          current: currentSnap,
          proposed: proposedSnap,
          message: '題目已有分題資料。若要覆寫，請確認後再通過。'
        });
        continue;
      }

      var sumCheck = validateProposalPartsSum_(parts, live.marks, questionId);
      if (!sumCheck.ok) {
        failed.push({
          proposalId: String(proposal.id || proposalId),
          questionId: questionId,
          error: sumCheck.error || 'validation_failed',
          message: sumCheck.message || ''
        });
        continue;
      }

      live.questionParts = parts;
      live.partsStatus = 'filled';
      if (sumCheck.filledMarksFromParts) {
        live.marks = sumCheck.sum;
      }
      loadedBank.bank.questions[qIndex] = live;
      removeIndexes.push(found.index);
      approved.push({
        proposalId: String(proposal.id || proposalId),
        questionId: questionId,
        question: publicBankPartsSnapshot_(live)
      });
    }

    if (!approved.length) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return {
        ok: true,
        approved: [],
        needsConfirm: needsConfirm,
        failed: failed,
        bankSha: loadedBank.sha || '',
        bankPath: loadedBank.path || '',
        proposalsSha: loadedProposals.sha || '',
        proposalsPath: loadedProposals.path || ''
      };
    }

    // Remove highest indexes first so earlier indexes stay valid.
    removeIndexes.sort(function (a, b) { return b - a; });
    var seenIdx = {};
    for (i = 0; i < removeIndexes.length; i++) {
      var idx = removeIndexes[i];
      if (seenIdx[idx]) continue;
      seenIdx[idx] = true;
      removePartsProposalAt_(loadedProposals.store, idx);
    }

    var bankWritten = writeSharedBankForPartsApprove_(
      cfg,
      loadedBank.bank,
      'Bulk approve question parts (' + approved.length + ')'
    );
    var proposalsWritten = writeQuestionPartsProposalsStore_(
      cfg,
      loadedProposals.store,
      'Remove bulk-approved question-parts proposals (' + approved.length + ')'
    );

    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'bulkApproveQuestionPartsProposals',
      success: true,
      metadata: {
        approved: approved.length,
        needsConfirm: needsConfirm.length,
        failed: failed.length,
        overwrite: confirmOverwrite === true
      }
    }, true);
    return {
      ok: true,
      approved: approved,
      needsConfirm: needsConfirm,
      failed: failed,
      bankSha: bankWritten.sha,
      bankPath: bankWritten.path,
      proposalsSha: proposalsWritten.sha,
      proposalsPath: proposalsWritten.path
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function handleBulkRejectQuestionPartsProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };

  var rawIds = Array.isArray(body.proposalIds)
    ? body.proposalIds
    : (Array.isArray(body.ids) ? body.ids : []);
  var want = {};
  var ordered = [];
  rawIds.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);

  var saved = mutateQuestionPartsProposalsStore_(
    username,
    'Bulk reject question-parts proposals (' + ordered.length + ')',
    function (store) {
      var rejected = [];
      var failed = [];
      var removeIndexes = [];
      var i;
      for (i = 0; i < ordered.length; i++) {
        var proposalId = ordered[i];
        var found = findPartsProposal_(store, proposalId, '');
        if (!found) {
          failed.push({
            proposalId: proposalId,
            questionId: '',
            error: 'not_found',
            message: '找不到提案 ' + proposalId
          });
          continue;
        }
        removeIndexes.push(found.index);
        rejected.push(publicPartsProposalView_(found.proposal));
      }
      if (!rejected.length) return { ok: false, error: 'not_found' };
      removeIndexes.sort(function (a, b) { return b - a; });
      var seenIdx = {};
      for (i = 0; i < removeIndexes.length; i++) {
        var idx = removeIndexes[i];
        if (seenIdx[idx]) continue;
        seenIdx[idx] = true;
        removePartsProposalAt_(store, idx);
      }
      return { ok: true, proposals: rejected, failed: failed };
    }
  );
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'bulkRejectQuestionPartsProposals',
    success: true,
    metadata: { rejected: (saved.proposals || []).length }
  }, true);
  return {
    ok: true,
    rejected: Array.isArray(saved.proposals) ? saved.proposals : [],
    sha: saved.sha,
    path: saved.path
  };
}


function handleRejectQuestionPartsProposal_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var proposalId = String(body.proposalId || body.id || '').trim();
  var questionId = String(body.questionId || '').trim();
  if (!proposalId && !questionId) return { ok: false, error: 'bad_request' };

  var saved = mutateQuestionPartsProposalsStore_(
    username,
    'Reject question-parts proposal ' + (proposalId || questionId),
    function (store) {
      var found = findPartsProposal_(store, proposalId, questionId);
      if (!found) return { ok: false, error: 'not_found' };
      var removed = removePartsProposalAt_(store, found.index);
      return { ok: true, proposal: publicPartsProposalView_(removed) };
    }
  );
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'rejectQuestionPartsProposal',
    success: true,
    metadata: {
      proposalId: saved.proposal && saved.proposal.id,
      questionId: saved.proposal && saved.proposal.questionId
    }
  }, true);
  return {
    ok: true,
    proposal: saved.proposal,
    sha: saved.sha,
    path: saved.path
  };
}

// === 分類提案 staging (shared/data/classification-proposals.json) ===
// Agents propose concepts / stemPatterns here. Only approve patches the shared
// bank (database.json). Propose never touches the bank. Pending-only file:
// Multi-field staging (list/scalar/parts). Blank-only fields skip when filled.
// approve and reject both remove staging fields/rows. Intake pauses at 200 pending.

var CLASSIFICATION_PROPOSALS_REL_PATH_ = 'data/classification-proposals.json';
var CLASSIFICATION_PROPOSALS_MAX_BYTES_ = 2000000;
var CLASSIFICATION_PROPOSALS_MAX_ITEMS_ = 5000;
var CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_ = 1;
var CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_ = 200;
// Bank field keys + kinds. blankOnly = propose/approve only when bank value empty.
var CLASSIFICATION_FIELD_META_ = {
  concepts: { kind: 'list', label: '概念', blankOnly: false },
  stemPatterns: { kind: 'list', label: '題幹模式', blankOnly: false },
  patterns: { kind: 'list', label: '題型', blankOnly: false },
  graphType: { kind: 'scalar', label: '圖表類型', blankOnly: false },
  tableType: { kind: 'scalar', label: '表格類型', blankOnly: false },
  calculationType: { kind: 'scalar', label: '計算類型', blankOnly: false },
  multipleSelectionType: { kind: 'scalar', label: '複選類型', blankOnly: false },
  AristochapterClassification: { kind: 'list', label: 'Chapters', blankOnly: true },
  curriculumClassification: { kind: 'list', label: '課程分類', blankOnly: true },
  questionParts: { kind: 'parts', label: '分題', blankOnly: true }
};
var CLASSIFICATION_ALLOWED_FIELDS_ = (function () {
  var out = {};
  Object.keys(CLASSIFICATION_FIELD_META_).forEach(function (k) { out[k] = true; });
  return out;
})();
var CLASSIFICATION_ALWAYS_FIELDS_ = [
  'concepts', 'stemPatterns', 'patterns',
  'graphType', 'tableType', 'calculationType', 'multipleSelectionType'
];
var CLASSIFICATION_BLANK_ONLY_FIELDS_ = [
  'AristochapterClassification', 'curriculumClassification', 'questionParts'
];
var CLASSIFICATION_CONFIDENCE_ = { '高': true, '中': true, '低': true };

function githubSharedClassificationProposalsPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  return joinGithubPath_(prefix, CLASSIFICATION_PROPOSALS_REL_PATH_);
}

function emptyClassificationProposalsStore_() {
  return {
    schemaVersion: CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_,
    updatedAt: '',
    proposals: []
  };
}

function readClassificationProposalsStore_(cfg) {
  var path = githubSharedClassificationProposalsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      throw gitFail_('github_error');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw gitFail_('github_error');
    }
    if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
    if (typeof parsed.schemaVersion !== 'number') {
      parsed.schemaVersion = CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_;
    }
    return { store: parsed, sha: read.sha || '', path: path, existed: true };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return {
        store: emptyClassificationProposalsStore_(),
        sha: '',
        path: path,
        existed: false
      };
    }
    throw err;
  }
}

function writeClassificationProposalsStore_(cfg, store, message) {
  var path = githubSharedClassificationProposalsPath_(cfg);
  if (!path) throw gitFail_('github_error');
  store.schemaVersion = CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_;
  store.updatedAt = new Date().toISOString();
  if (!Array.isArray(store.proposals)) store.proposals = [];
  var text = JSON.stringify(store);
  if (utf8Length_(text) > CLASSIFICATION_PROPOSALS_MAX_BYTES_) {
    throw gitFail_('payload_too_large');
  }
  var written = githubWriteText_(cfg, path, text, message || 'Update classification proposals');
  return { sha: written.sha, path: path, store: store };
}

function classificationFieldMeta_(field) {
  return CLASSIFICATION_FIELD_META_[String(field || '')] || null;
}

function classificationFieldKind_(field) {
  var meta = classificationFieldMeta_(field);
  return meta ? meta.kind : '';
}

function classificationFieldBlankOnly_(field) {
  var meta = classificationFieldMeta_(field);
  return !!(meta && meta.blankOnly);
}

function classificationFieldLabel_(field) {
  var meta = classificationFieldMeta_(field);
  return meta && meta.label ? meta.label : String(field || '');
}

function normalizeClassificationStringList_(raw) {
  var out = [];
  var seen = {};
  var i;
  if (Array.isArray(raw)) {
    for (i = 0; i < raw.length; i++) {
      var s = String(raw[i] == null ? '' : raw[i]).trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }
  if (raw == null) return out;
  var text = String(raw).trim();
  if (!text) return out;
  var parts = text.split(/[|,\n；;]+/);
  for (i = 0; i < parts.length; i++) {
    var item = String(parts[i] || '').trim();
    if (!item || seen[item]) continue;
    seen[item] = true;
    out.push(item);
  }
  return out;
}

function normalizeClassificationScalar_(raw) {
  if (Array.isArray(raw)) {
    for (var i = 0; i < raw.length; i++) {
      var s = String(raw[i] == null ? '' : raw[i]).trim();
      if (s) return s;
    }
    return '';
  }
  if (raw == null) return '';
  return String(raw).trim();
}

function normalizeClassificationFieldValue_(field, raw) {
  var kind = classificationFieldKind_(field);
  if (kind === 'scalar') return normalizeClassificationScalar_(raw);
  if (kind === 'parts') return normalizeProposalParts_(raw);
  return normalizeClassificationStringList_(raw);
}

function classificationValueIsEmpty_(field, value) {
  var kind = classificationFieldKind_(field);
  if (kind === 'scalar') return !String(value == null ? '' : value).trim();
  if (kind === 'parts') return !Array.isArray(value) || !value.length;
  return !Array.isArray(value) || !value.length;
}

function classificationValuesEqual_(field, a, b) {
  var kind = classificationFieldKind_(field);
  if (kind === 'scalar') {
    return normalizeClassificationScalar_(a) === normalizeClassificationScalar_(b);
  }
  if (kind === 'parts') {
    var left = normalizeProposalParts_(a);
    var right = normalizeProposalParts_(b);
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i++) {
      if (left[i].label !== right[i].label) return false;
      if (left[i].marks !== right[i].marks) return false;
      if (left[i].performance !== right[i].performance) return false;
    }
    return true;
  }
  var la = normalizeClassificationStringList_(a);
  var lb = normalizeClassificationStringList_(b);
  if (la.length !== lb.length) return false;
  for (var j = 0; j < la.length; j++) {
    if (la[j] !== lb[j]) return false;
  }
  return true;
}

function normalizeClassificationFields_(raw) {
  var out = [];
  var seen = {};
  var list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  for (var i = 0; i < list.length; i++) {
    var key = String(list[i] == null ? '' : list[i]).trim();
    if (!CLASSIFICATION_ALLOWED_FIELDS_[key] || seen[key]) continue;
    seen[key] = true;
    out.push(key);
  }
  return out;
}

function normalizeClassificationConfidence_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (CLASSIFICATION_CONFIDENCE_[s]) return s;
  var lower = s.toLowerCase();
  if (lower === 'high' || lower === 'h') return '高';
  if (lower === 'medium' || lower === 'med' || lower === 'm') return '中';
  if (lower === 'low' || lower === 'l') return '低';
  return '';
}

function bankClassificationValue_(question, field) {
  if (!question) return normalizeClassificationFieldValue_(field, null);
  return normalizeClassificationFieldValue_(field, question[field]);
}

function bankClassificationList_(question, field) {
  var kind = classificationFieldKind_(field);
  var value = bankClassificationValue_(question, field);
  if (kind === 'scalar') return value ? [value] : [];
  if (kind === 'parts') {
    return normalizeProposalParts_(value).map(function (p) {
      return p.label + ',' + (p.marks == null ? '' : String(p.marks))
        + (p.performance ? ',' + p.performance : '');
    });
  }
  return Array.isArray(value) ? value : [];
}

function bankClassificationFieldFilled_(question, field) {
  if (field === 'questionParts') return bankQuestionHasFilledParts_(question);
  return !classificationValueIsEmpty_(field, bankClassificationValue_(question, field));
}

function bankQuestionReviewedByAi_(question) {
  return String(question && question.reviewedByAI || '').trim().toUpperCase() === 'Y';
}

function classificationListsEqual_(a, b) {
  var left = normalizeClassificationStringList_(a);
  var right = normalizeClassificationStringList_(b);
  if (left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function applyClassificationValueToQuestion_(question, field, value) {
  if (!question) return;
  var kind = classificationFieldKind_(field);
  var normalized = normalizeClassificationFieldValue_(field, value);
  if (kind === 'parts') {
    question.questionParts = normalized;
    question.partsStatus = normalized.length ? 'filled' : 'none';
    return;
  }
  question[field] = normalized;
}

function publicClassificationProposalView_(row) {
  if (!row || typeof row !== 'object') return null;
  var fields = normalizeClassificationFields_(row.fields);
  var currentValues = row.currentValues && typeof row.currentValues === 'object'
    ? row.currentValues
    : {};
  var proposedValues = row.proposedValues && typeof row.proposedValues === 'object'
    ? row.proposedValues
    : {};
  var currentOut = {};
  var proposedOut = {};
  var i;
  for (i = 0; i < fields.length; i++) {
    var f = fields[i];
    currentOut[f] = normalizeClassificationFieldValue_(f, currentValues[f]);
    proposedOut[f] = normalizeClassificationFieldValue_(f, proposedValues[f]);
  }
  return {
    id: String(row.id || ''),
    questionId: String(row.questionId || ''),
    fields: fields,
    currentValues: currentOut,
    proposedValues: proposedOut,
    reason: String(row.reason == null ? '' : row.reason).trim(),
    confidence: normalizeClassificationConfidence_(row.confidence),
    createdAt: String(row.createdAt || row.proposedAt || ''),
    createdBy: String(row.createdBy || row.proposedBy || ''),
    status: 'pending'
  };
}

function findClassificationProposal_(store, proposalId, questionId) {
  var list = Array.isArray(store.proposals) ? store.proposals : [];
  var wantId = String(proposalId || '').trim();
  var wantQ = String(questionId || '').trim();
  var i;
  if (wantId) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].id || '') === wantId) {
        return { proposal: list[i], index: i };
      }
    }
  }
  if (wantQ) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].questionId || '') === wantQ) {
        return { proposal: list[i], index: i };
      }
    }
  }
  return null;
}

function removeClassificationProposalAt_(store, index) {
  var list = Array.isArray(store.proposals) ? store.proposals : [];
  if (index < 0 || index >= list.length) return null;
  var removed = list[index];
  list.splice(index, 1);
  store.proposals = list;
  return removed;
}

function publicBankClassificationSnapshot_(question, fields) {
  if (!question) return null;
  var keys = normalizeClassificationFields_(fields);
  if (!keys.length) keys = CLASSIFICATION_ALWAYS_FIELDS_.slice();
  var values = {};
  for (var i = 0; i < keys.length; i++) {
    values[keys[i]] = bankClassificationValue_(question, keys[i]);
  }
  return {
    questionId: String(question.id || ''),
    reviewedByAI: String(question.reviewedByAI || ''),
    fields: keys,
    values: values
  };
}


function trimClassificationProposalFields_(proposal, removeFields) {
  if (!proposal || typeof proposal !== 'object') return 0;
  var remove = {};
  var list = normalizeClassificationFields_(removeFields);
  var i;
  for (i = 0; i < list.length; i++) remove[list[i]] = true;
  var fields = normalizeClassificationFields_(proposal.fields).filter(function (f) {
    return !remove[f];
  });
  proposal.fields = fields;
  if (proposal.proposedValues && typeof proposal.proposedValues === 'object') {
    Object.keys(remove).forEach(function (f) { delete proposal.proposedValues[f]; });
  }
  if (proposal.currentValues && typeof proposal.currentValues === 'object') {
    Object.keys(remove).forEach(function (f) { delete proposal.currentValues[f]; });
  }
  return fields.length;
}

/** Resolve approveFields / rejectFields / edited values for a proposal. */
function resolveClassificationFieldActions_(body, proposalFields) {
  var allFields = normalizeClassificationFields_(proposalFields);
  var approveFields = normalizeClassificationFields_(
    body && (body.approveFields != null ? body.approveFields : body.fields)
  );
  var rejectFields = normalizeClassificationFields_(body && body.rejectFields);
  var i;
  // Backward compatible: omit both → approve every field on the proposal.
  if (!approveFields.length && !rejectFields.length) {
    approveFields = allFields.slice();
  }
  var onProposal = {};
  for (i = 0; i < allFields.length; i++) onProposal[allFields[i]] = true;
  approveFields = approveFields.filter(function (f) { return onProposal[f]; });
  var approveSet = {};
  for (i = 0; i < approveFields.length; i++) approveSet[approveFields[i]] = true;
  rejectFields = rejectFields.filter(function (f) {
    return onProposal[f] && !approveSet[f];
  });
  return { approveFields: approveFields, rejectFields: rejectFields, allFields: allFields };
}

function classificationWriteValuesFromBody_(body, approveFields, proposedValues) {
  var edited = {};
  if (body && body.values && typeof body.values === 'object') edited = body.values;
  else if (body && body.editedValues && typeof body.editedValues === 'object') edited = body.editedValues;
  var proposed = proposedValues && typeof proposedValues === 'object' ? proposedValues : {};
  var out = {};
  for (var i = 0; i < approveFields.length; i++) {
    var f = approveFields[i];
    if (Object.prototype.hasOwnProperty.call(edited, f)) {
      out[f] = normalizeClassificationFieldValue_(f, edited[f]);
    } else {
      out[f] = normalizeClassificationFieldValue_(f, proposed[f]);
    }
  }
  return out;
}

/** Split approve fields into writable vs blank-only blocked (bank already filled). */
function partitionBlankOnlyApproveFields_(question, approveFields) {
  var allowed = [];
  var blocked = [];
  for (var i = 0; i < approveFields.length; i++) {
    var f = approveFields[i];
    if (classificationFieldBlankOnly_(f) && bankClassificationFieldFilled_(question, f)) {
      blocked.push(f);
    } else {
      allowed.push(f);
    }
  }
  return { allowed: allowed, blocked: blocked };
}

function classificationNeedsOverwriteConfirm_(question, fields) {
  if (bankQuestionReviewedByAi_(question)) return true;
  for (var i = 0; i < fields.length; i++) {
    if (bankClassificationFieldFilled_(question, fields[i])) return true;
  }
  return false;
}

function mutateClassificationProposalsStore_(username, message, mutator) {
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) {
    return { ok: false, error: 'github_not_configured' };
  }
  if (!takeGitSlot_(username, 8)) return { ok: false, error: 'rate_limited' };
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return { ok: false, error: 'rate_limited' };
    }
    held = true;
    var loaded = readClassificationProposalsStore_(cfg);
    var result = mutator(loaded.store, loaded);
    if (!result || result.ok !== true) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return result || { ok: false, error: 'github_error' };
    }
    var written = writeClassificationProposalsStore_(cfg, loaded.store, message);
    lock.releaseLock();
    held = false;
    releaseGitSlot_(username);
    result.sha = written.sha;
    result.path = written.path;
    return result;
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return { ok: false, error: 'payload_too_large' };
    if (code === 'github_not_found') return { ok: false, error: 'github_not_found' };
    return { ok: false, error: 'github_error' };
  }
}

function prepareClassificationProposalItem_(item, defaultCreatedBy) {
  if (!item || typeof item !== 'object') return null;
  var questionId = String(item.questionId || '').trim();
  if (!questionId || questionId.length > 80) return null;

  var proposedValuesRaw = item.proposedValues && typeof item.proposedValues === 'object'
    ? item.proposedValues
    : {};
  // Convenience: top-level known fields map into proposedValues.
  Object.keys(CLASSIFICATION_FIELD_META_).forEach(function (key) {
    if (item[key] != null && proposedValuesRaw[key] == null) {
      proposedValuesRaw[key] = item[key];
    }
  });

  var fields = normalizeClassificationFields_(item.fields);
  if (!fields.length) {
    Object.keys(CLASSIFICATION_FIELD_META_).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(proposedValuesRaw, key)) fields.push(key);
    });
  }
  if (!fields.length) return null;

  var currentValuesRaw = item.currentValues && typeof item.currentValues === 'object'
    ? item.currentValues
    : {};
  var currentValues = {};
  var proposedValues = {};
  var hasAnyProposed = false;
  var keptFields = [];
  var skippedBlankOnly = [];
  var i;
  for (i = 0; i < fields.length; i++) {
    var f = fields[i];
    var currentVal = normalizeClassificationFieldValue_(f, currentValuesRaw[f]);
    var proposedVal = normalizeClassificationFieldValue_(f, proposedValuesRaw[f]);
    // Soft blank-only gate on submit when currentValues show the bank field filled.
    if (classificationFieldBlankOnly_(f) && !classificationValueIsEmpty_(f, currentVal)) {
      skippedBlankOnly.push(f);
      continue;
    }
    currentValues[f] = currentVal;
    proposedValues[f] = proposedVal;
    keptFields.push(f);
    if (!classificationValueIsEmpty_(f, proposedVal)
        || Object.prototype.hasOwnProperty.call(proposedValuesRaw, f)) {
      hasAnyProposed = true;
    }
  }
  fields = keptFields;
  if (!fields.length || !hasAnyProposed) return null;

  var reason = String(item.reason == null ? '' : item.reason).trim();
  if (reason.length > 2000) reason = reason.slice(0, 2000);
  var confidence = normalizeClassificationConfidence_(item.confidence);
  var createdBy = String(
    item.createdBy != null ? item.createdBy
      : (item.proposedBy != null ? item.proposedBy : (defaultCreatedBy || ''))
  ).trim();
  if (createdBy.length > 120) createdBy = createdBy.slice(0, 120);

  return {
    questionId: questionId,
    fields: fields,
    currentValues: currentValues,
    proposedValues: proposedValues,
    reason: reason,
    confidence: confidence,
    createdBy: createdBy
  };
}

function handleListClassificationProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  try {
    var loaded = readClassificationProposalsStore_(cfg);
    var rows = (loaded.store.proposals || []).map(publicClassificationProposalView_).filter(Boolean);
    rows.sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    var pendingCount = rows.length;
    var paused = pendingCount >= CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_;
    if (rows.length > 500) rows = rows.slice(0, 500);
    return {
      ok: true,
      rows: rows,
      pendingCount: pendingCount,
      pauseThreshold: CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_,
      paused: paused,
      path: loaded.path,
      sha: loaded.sha,
      schemaVersion: CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_
    };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return {
        ok: true,
        rows: [],
        pendingCount: 0,
        pauseThreshold: CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_,
        paused: false,
        path: githubSharedClassificationProposalsPath_(cfg),
        sha: '',
        schemaVersion: CLASSIFICATION_PROPOSALS_SCHEMA_VERSION_
      };
    }
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

// Intake: admin|githubSync. Never writes database.json.
// Upserts one pending proposal per questionId.
// When pending >= 200, still accepts new questionIds; response sets paused:true as a soft reminder.
function handleSubmitClassificationProposal_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !(rights.admin || rights.githubSync)) {
    return { ok: false, error: 'feature_unavailable' };
  }

  var incoming = [];
  if (Array.isArray(body.proposals)) {
    incoming = body.proposals;
  } else if (body.questionId || body.proposedValues || body.concepts || body.stemPatterns) {
    incoming = [body];
  }
  if (!incoming.length) return { ok: false, error: 'bad_request' };
  if (incoming.length > 200) incoming = incoming.slice(0, 200);

  var prepared = [];
  var i;
  for (i = 0; i < incoming.length; i++) {
    var row = prepareClassificationProposalItem_(incoming[i], username);
    if (row) prepared.push(row);
  }
  if (!prepared.length) return { ok: false, error: 'bad_request' };

  var saved = mutateClassificationProposalsStore_(
    username,
    'Submit classification proposals (' + prepared.length + ')',
    function (store) {
      var list = Array.isArray(store.proposals) ? store.proposals : [];
      var existingByQid = {};
      var j;
      for (j = 0; j < list.length; j++) {
        var existingQid = String(list[j] && list[j].questionId || '');
        if (existingQid && existingByQid[existingQid] == null) {
          existingByQid[existingQid] = list[j];
        }
      }

      var replacing = {};
      for (j = 0; j < prepared.length; j++) replacing[prepared[j].questionId] = true;

      var keptWithoutReplace = [];
      for (j = 0; j < list.length; j++) {
        var keepQid = String(list[j] && list[j].questionId || '');
        if (replacing[keepQid]) continue;
        keptWithoutReplace.push(list[j]);
      }

      // Soft warn when backlog >= 200: still accept new questionIds.
      // Response paused:true is a reminder for agents / admin banner only (not a hard reject).
      var upserted = [];
      var nowIso = new Date().toISOString();
      var kept = keptWithoutReplace.slice();
      for (j = prepared.length - 1; j >= 0; j--) {
        var prep = prepared[j];
        var prior = existingByQid[prep.questionId];
        var record = {
          id: prior && prior.id
            ? String(prior.id)
            : ('cp_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16)),
          questionId: prep.questionId,
          fields: prep.fields,
          currentValues: prep.currentValues,
          proposedValues: prep.proposedValues,
          reason: prep.reason,
          confidence: prep.confidence,
          createdAt: nowIso,
          createdBy: prep.createdBy || username,
          status: 'pending'
        };
        kept.unshift(record);
        upserted.unshift(publicClassificationProposalView_(record));
      }
      if (kept.length > CLASSIFICATION_PROPOSALS_MAX_ITEMS_) {
        kept = kept.slice(0, CLASSIFICATION_PROPOSALS_MAX_ITEMS_);
      }
      store.proposals = kept;
      return {
        ok: true,
        proposals: upserted,
        pendingCount: kept.length,
        pauseThreshold: CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_,
        paused: kept.length >= CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_
      };
    }
  );

  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'submitClassificationProposal',
    success: true,
    metadata: { count: prepared.length, pendingCount: saved.pendingCount }
  }, true);
  var pausedNow = saved.paused === true;
  return {
    ok: true,
    proposals: Array.isArray(saved.proposals) ? saved.proposals : [],
    pendingCount: saved.pendingCount,
    pauseThreshold: CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_,
    paused: pausedNow,
    message: pausedNow
      ? ('待審批分類提案已達提醒門檻（' + CLASSIFICATION_PROPOSALS_PAUSE_THRESHOLD_
         + '）。新題仍可提交；請盡快審批。')
      : '',
    sha: saved.sha,
    path: saved.path
  };
}

function handleApproveClassificationProposal_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var proposalId = String(body.proposalId || body.id || '').trim();
  var questionIdHint = String(body.questionId || '').trim();
  var confirmOverwrite = body.confirmOverwrite === true
    || body.confirmOverwrite === 'true'
    || body.confirmOverwrite === 1;
  if (!proposalId && !questionIdHint) return { ok: false, error: 'bad_request' };

  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedBankPath_(cfg)) {
    return gitClientError_('github_not_configured');
  }
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var loadedProposals = readClassificationProposalsStore_(cfg);
    var found = findClassificationProposal_(loadedProposals.store, proposalId, questionIdHint);
    if (!found) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'not_found' };
    }
    var proposal = found.proposal;
    var view = publicClassificationProposalView_(proposal);
    var questionId = String(view && view.questionId || '').trim();
    if (!questionId || !view.fields.length) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'bad_request' };
    }

    var actions = resolveClassificationFieldActions_(body, view.fields);
    var approveFields = actions.approveFields;
    var rejectFields = actions.rejectFields;
    if (!approveFields.length && !rejectFields.length) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'bad_request', message: '沒有可通過或保留原值的欄位。' };
    }

    // Reject-only (no bank write): drop rejectFields from staging.
    if (!approveFields.length) {
      var remainingCount = trimClassificationProposalFields_(proposal, rejectFields);
      var proposalRemaining = null;
      if (remainingCount <= 0) {
        removeClassificationProposalAt_(loadedProposals.store, found.index);
      } else {
        loadedProposals.store.proposals[found.index] = proposal;
        proposalRemaining = publicClassificationProposalView_(proposal);
      }
      var proposalsWrittenOnly = writeClassificationProposalsStore_(
        cfg,
        loadedProposals.store,
        'Keep-original classification fields for ' + questionId
      );
      lock.releaseLock();
      held = false;
      writeLog_({
        username: username,
        action: 'approveClassificationProposal',
        success: true,
        metadata: {
          questionId: questionId,
          proposalId: String(proposal.id || ''),
          approveFields: [],
          rejectFields: rejectFields,
          removed: remainingCount <= 0
        }
      }, true);
      return {
        ok: true,
        needsConfirm: false,
        questionId: questionId,
        proposalId: String(proposal.id || ''),
        approvedFields: [],
        rejectedFields: rejectFields,
        question: null,
        proposalRemaining: proposalRemaining,
        removed: remainingCount <= 0,
        proposalsSha: proposalsWrittenOnly.sha,
        proposalsPath: proposalsWrittenOnly.path
      };
    }

    var loadedBank = readSharedBankForPartsApprove_(cfg);
    var qIndex = findBankQuestionIndex_(loadedBank.bank, questionId);
    if (qIndex < 0) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return { ok: false, error: 'not_found', message: '題庫找不到題目 ' + questionId };
    }
    var live = loadedBank.bank.questions[qIndex];

    // Blank-only fields never overwrite a filled bank value (confirmOverwrite ignored).
    var blankSplit = partitionBlankOnlyApproveFields_(live, approveFields);
    var blockedBlankOnly = blankSplit.blocked;
    if (blockedBlankOnly.length) {
      rejectFields = rejectFields.concat(blockedBlankOnly.filter(function (f) {
        return rejectFields.indexOf(f) < 0;
      }));
      approveFields = blankSplit.allowed;
    }
    if (!approveFields.length) {
      // Nothing writable: drop blocked blank-only (+ any rejectFields) from staging.
      var dropOnly = rejectFields.slice();
      var remainingOnly = trimClassificationProposalFields_(proposal, dropOnly);
      var proposalRemainingOnly = null;
      if (remainingOnly <= 0) {
        removeClassificationProposalAt_(loadedProposals.store, found.index);
      } else {
        loadedProposals.store.proposals[found.index] = proposal;
        proposalRemainingOnly = publicClassificationProposalView_(proposal);
      }
      var proposalsWrittenBlocked = writeClassificationProposalsStore_(
        cfg,
        loadedProposals.store,
        'Drop blank-only filled classification fields for ' + questionId
      );
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return {
        ok: false,
        error: 'blank_only_filled',
        message: '空白才可寫入的欄位在題庫已有值，已略過：'
          + blockedBlankOnly.map(classificationFieldLabel_).join('、'),
        questionId: questionId,
        proposalId: String(proposal.id || ''),
        blockedFields: blockedBlankOnly,
        rejectedFields: dropOnly,
        proposalRemaining: proposalRemainingOnly,
        removed: remainingOnly <= 0,
        proposalsSha: proposalsWrittenBlocked.sha,
        proposalsPath: proposalsWrittenBlocked.path
      };
    }

    var writeValues = classificationWriteValuesFromBody_(body, approveFields, view.proposedValues);
    var proposedSnap = {
      questionId: questionId,
      fields: approveFields,
      values: writeValues,
      reason: view.reason,
      confidence: view.confidence
    };
    var currentSnap = publicBankClassificationSnapshot_(live, approveFields);

    if (classificationNeedsOverwriteConfirm_(live, approveFields) && !confirmOverwrite) {
      lock.releaseLock();
      held = false;
      releaseGitSlot_(username);
      return {
        ok: true,
        needsConfirm: true,
        proposalId: String(proposal.id || ''),
        questionId: questionId,
        approveFields: approveFields,
        rejectFields: rejectFields,
        blockedFields: blockedBlankOnly,
        current: currentSnap,
        proposed: proposedSnap,
        reviewedByAI: String(live.reviewedByAI || ''),
        message: bankQuestionReviewedByAi_(live)
          ? '題目已標記 reviewedByAI=Y。若要覆寫分類，請確認後再通過。'
          : '題目已有分類資料。若要覆寫，請確認後再通過。'
      };
    }

    var fi;
    for (fi = 0; fi < approveFields.length; fi++) {
      applyClassificationValueToQuestion_(live, approveFields[fi], writeValues[approveFields[fi]]);
    }
    loadedBank.bank.questions[qIndex] = live;

    var bankWritten = writeSharedBankForPartsApprove_(
      cfg,
      loadedBank.bank,
      'Approve classification for ' + questionId + ' (' + approveFields.join(',') + ')'
    );

    var dropFields = approveFields.concat(rejectFields);
    var left = trimClassificationProposalFields_(proposal, dropFields);
    var remaining = null;
    if (left <= 0) {
      removeClassificationProposalAt_(loadedProposals.store, found.index);
    } else {
      loadedProposals.store.proposals[found.index] = proposal;
      remaining = publicClassificationProposalView_(proposal);
    }
    var proposalsWritten = writeClassificationProposalsStore_(
      cfg,
      loadedProposals.store,
      left <= 0
        ? ('Remove approved classification proposal ' + String(proposal.id || questionId))
        : ('Partial approve classification proposal ' + String(proposal.id || questionId))
    );

    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'approveClassificationProposal',
      success: true,
      metadata: {
        questionId: questionId,
        proposalId: String(proposal.id || ''),
        overwrite: confirmOverwrite === true,
        approveFields: approveFields,
        rejectFields: rejectFields,
        removed: left <= 0
      }
    }, true);
    return {
      ok: true,
      needsConfirm: false,
      questionId: questionId,
      proposalId: String(proposal.id || ''),
      approvedFields: approveFields,
      rejectedFields: rejectFields,
      blockedFields: blockedBlankOnly,
      question: publicBankClassificationSnapshot_(live, approveFields),
      proposalRemaining: remaining,
      removed: left <= 0,
      bankSha: bankWritten.sha,
      bankPath: bankWritten.path,
      proposalsSha: proposalsWritten.sha,
      proposalsPath: proposalsWritten.path
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function handleBulkApproveClassificationProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };

  var rawIds = Array.isArray(body.proposalIds)
    ? body.proposalIds
    : (Array.isArray(body.ids) ? body.ids : []);
  var want = {};
  var ordered = [];
  rawIds.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);

  var confirmOverwrite = body.confirmOverwrite === true
    || body.confirmOverwrite === 'true'
    || body.confirmOverwrite === 1;

  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedBankPath_(cfg)) {
    return gitClientError_('github_not_configured');
  }
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var loadedProposals = readClassificationProposalsStore_(cfg);
    var loadedBank = readSharedBankForPartsApprove_(cfg);

    var approved = [];
    var needsConfirm = [];
    var failed = [];
    var removeIndexes = [];
    var i;

    for (i = 0; i < ordered.length; i++) {
      var proposalId = ordered[i];
      var found = findClassificationProposal_(loadedProposals.store, proposalId, '');
      if (!found) {
        failed.push({ proposalId: proposalId, error: 'not_found', message: '找不到提案' });
        continue;
      }
      var view = publicClassificationProposalView_(found.proposal);
      var questionId = String(view && view.questionId || '').trim();
      var fields = view && view.fields ? view.fields : [];
      if (!questionId || !fields.length) {
        failed.push({
          proposalId: proposalId,
          questionId: questionId,
          error: 'bad_request',
          message: '提案缺少有效分類欄位。'
        });
        continue;
      }
      var qIndex = findBankQuestionIndex_(loadedBank.bank, questionId);
      if (qIndex < 0) {
        failed.push({
          proposalId: proposalId,
          questionId: questionId,
          error: 'not_found',
          message: '題庫找不到題目 ' + questionId
        });
        continue;
      }
      var live = loadedBank.bank.questions[qIndex];
      var blankSplit = partitionBlankOnlyApproveFields_(live, fields);
      var writable = blankSplit.allowed;
      if (!writable.length) {
        failed.push({
          proposalId: proposalId,
          questionId: questionId,
          error: 'blank_only_filled',
          message: '空白才可寫入的欄位在題庫已有值：'
            + blankSplit.blocked.map(classificationFieldLabel_).join('、'),
          blockedFields: blankSplit.blocked
        });
        // Drop blocked blank-only fields from staging so they do not stick forever.
        trimClassificationProposalFields_(found.proposal, blankSplit.blocked);
        if (!(found.proposal.fields && found.proposal.fields.length)) {
          removeIndexes.push(found.index);
        }
        continue;
      }
      if (blankSplit.blocked.length) {
        trimClassificationProposalFields_(found.proposal, blankSplit.blocked);
        fields = writable;
        view = publicClassificationProposalView_(found.proposal);
      }
      if (classificationNeedsOverwriteConfirm_(live, writable) && !confirmOverwrite) {
        needsConfirm.push({
          proposalId: String(found.proposal.id || proposalId),
          questionId: questionId,
          current: publicBankClassificationSnapshot_(live, writable),
          proposed: {
            questionId: questionId,
            fields: writable,
            values: (function () {
              var vals = {};
              for (var wi = 0; wi < writable.length; wi++) {
                vals[writable[wi]] = normalizeClassificationFieldValue_(
                  writable[wi],
                  view.proposedValues[writable[wi]]
                );
              }
              return vals;
            })()
          },
          reviewedByAI: String(live.reviewedByAI || ''),
          blockedFields: blankSplit.blocked
        });
        continue;
      }
      for (var fi = 0; fi < writable.length; fi++) {
        applyClassificationValueToQuestion_(
          live,
          writable[fi],
          view.proposedValues[writable[fi]]
        );
      }
      loadedBank.bank.questions[qIndex] = live;
      removeIndexes.push(found.index);
      approved.push({
        proposalId: String(found.proposal.id || proposalId),
        questionId: questionId,
        question: publicBankClassificationSnapshot_(live, writable),
        blockedFields: blankSplit.blocked
      });
    }

    removeIndexes.sort(function (a, b) { return b - a; });
    var seenIdx = {};
    for (i = 0; i < removeIndexes.length; i++) {
      var idx = removeIndexes[i];
      if (seenIdx[idx]) continue;
      seenIdx[idx] = true;
      removeClassificationProposalAt_(loadedProposals.store, idx);
    }

    var bankSha = '';
    var bankPath = '';
    var proposalsSha = '';
    var proposalsPath = '';
    if (approved.length) {
      var bankWritten = writeSharedBankForPartsApprove_(
        cfg,
        loadedBank.bank,
        'Bulk approve classification (' + approved.length + ')'
      );
      bankSha = bankWritten.sha;
      bankPath = bankWritten.path;
      var proposalsWritten = writeClassificationProposalsStore_(
        cfg,
        loadedProposals.store,
        'Remove bulk-approved classification proposals (' + approved.length + ')'
      );
      proposalsSha = proposalsWritten.sha;
      proposalsPath = proposalsWritten.path;
    }

    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'bulkApproveClassificationProposals',
      success: true,
      metadata: {
        approved: approved.length,
        needsConfirm: needsConfirm.length,
        failed: failed.length,
        overwrite: confirmOverwrite === true
      }
    }, true);
    return {
      ok: true,
      approved: approved,
      needsConfirm: needsConfirm,
      failed: failed,
      bankSha: bankSha,
      bankPath: bankPath,
      proposalsSha: proposalsSha,
      proposalsPath: proposalsPath
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function handleBulkRejectClassificationProposals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var rawIds = Array.isArray(body.proposalIds)
    ? body.proposalIds
    : (Array.isArray(body.ids) ? body.ids : []);
  var want = {};
  var ordered = [];
  rawIds.forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || want[id]) return;
    want[id] = true;
    ordered.push(id);
  });
  if (!ordered.length) return { ok: false, error: 'bad_request' };
  if (ordered.length > 200) ordered = ordered.slice(0, 200);

  var saved = mutateClassificationProposalsStore_(
    username,
    'Bulk reject classification proposals (' + ordered.length + ')',
    function (store) {
      var rejected = [];
      var failed = [];
      var removeIndexes = [];
      var i;
      for (i = 0; i < ordered.length; i++) {
        var proposalId = ordered[i];
        var found = findClassificationProposal_(store, proposalId, '');
        if (!found) {
          failed.push({ proposalId: proposalId, error: 'not_found' });
          continue;
        }
        rejected.push(publicClassificationProposalView_(found.proposal));
        removeIndexes.push(found.index);
      }
      removeIndexes.sort(function (a, b) { return b - a; });
      var seenIdx = {};
      for (i = 0; i < removeIndexes.length; i++) {
        var idx = removeIndexes[i];
        if (seenIdx[idx]) continue;
        seenIdx[idx] = true;
        removeClassificationProposalAt_(store, idx);
      }
      return { ok: true, proposals: rejected, failed: failed };
    }
  );
  if (!saved || saved.ok !== true) {
    return { ok: false, error: (saved && saved.error) || 'github_error' };
  }
  writeLog_({
    username: username,
    action: 'bulkRejectClassificationProposals',
    success: true,
    metadata: { count: Array.isArray(saved.proposals) ? saved.proposals.length : 0 }
  }, true);
  return {
    ok: true,
    action: 'bulkRejectClassificationProposals',
    rejected: Array.isArray(saved.proposals) ? saved.proposals : [],
    failed: Array.isArray(saved.failed) ? saved.failed : [],
    sha: saved.sha,
    path: saved.path
  };
}

function handleRejectClassificationProposal_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };
  var proposalId = String(body.proposalId || body.id || '').trim();
  var questionId = String(body.questionId || '').trim();
  if (!proposalId && !questionId) return { ok: false, error: 'bad_request' };

  var rejectFields = normalizeClassificationFields_(body && body.rejectFields);
  var saved = mutateClassificationProposalsStore_(
    username,
    rejectFields.length
      ? ('Keep-original classification fields ' + rejectFields.join(',') + ' for ' + (proposalId || questionId))
      : ('Reject classification proposal ' + (proposalId || questionId)),
    function (store) {
      var found = findClassificationProposal_(store, proposalId, questionId);
      if (!found) return { ok: false, error: 'not_found' };
      var proposal = found.proposal;
      var view = publicClassificationProposalView_(proposal);
      if (!rejectFields.length) {
        var removed = removeClassificationProposalAt_(store, found.index);
        return {
          ok: true,
          proposal: publicClassificationProposalView_(removed),
          rejectedFields: view ? view.fields : [],
          proposalRemaining: null,
          removed: true
        };
      }
      var onProposal = {};
      (view.fields || []).forEach(function (f) { onProposal[f] = true; });
      var drop = rejectFields.filter(function (f) { return onProposal[f]; });
      if (!drop.length) {
        return { ok: false, error: 'bad_request', message: '提案沒有這些欄位。' };
      }
      var left = trimClassificationProposalFields_(proposal, drop);
      if (left <= 0) {
        var gone = removeClassificationProposalAt_(store, found.index);
        return {
          ok: true,
          proposal: publicClassificationProposalView_(gone),
          rejectedFields: drop,
          proposalRemaining: null,
          removed: true
        };
      }
      store.proposals[found.index] = proposal;
      return {
        ok: true,
        proposal: view,
        rejectedFields: drop,
        proposalRemaining: publicClassificationProposalView_(proposal),
        removed: false
      };
    }
  );
  if (!saved || saved.ok !== true) {
    return {
      ok: false,
      error: (saved && saved.error) || 'github_error',
      message: saved && saved.message ? saved.message : ''
    };
  }
  writeLog_({
    username: username,
    action: 'rejectClassificationProposal',
    success: true,
    metadata: {
      proposalId: saved.proposal && saved.proposal.id,
      questionId: saved.proposal && saved.proposal.questionId,
      rejectedFields: saved.rejectedFields || [],
      removed: saved.removed === true
    }
  }, true);
  return {
    ok: true,
    proposal: saved.proposal,
    rejectedFields: saved.rejectedFields || [],
    proposalRemaining: saved.proposalRemaining || null,
    removed: saved.removed === true,
    sha: saved.sha,
    path: saved.path
  };
}

// === Personal user settings (users/<username>/settings.json) ===
// Preference blob only — never stores API keys, idSet, or live filter snapshots.
// Path is always derived from the authenticated username (no client path).
// settings.schemaVersion is independent of the shared bank SCHEMA_VERSION.

var USER_SETTINGS_REL_NAME_ = 'settings.json';
var USER_SETTINGS_MAX_BYTES_ = 80000;
var USER_SETTINGS_SCHEMA_VERSION_ = 1;

// --- flushStagingApprovals: validate-all then one write per file ---
// Cap keeps Apps Script under time/size limits; client chunks remaining.
// One batch uses one git slot + one script lock (not one per op).
var FLUSH_STAGING_APPROVALS_MAX_OPS_ = 50;

/**
 * Mixed parts+class approve/reject flush.
 * Body: { ops: [{ localId, kind:'parts'|'class', op:'approve'|'reject',
 *   proposalId, questionId, confirmOverwrite?, approveFields?, values?, rejectFields? }] }
 * Validate all → apply okToApply in memory → write bank once (via writeSharedBankForPartsApprove_)
 * + parts proposals + class proposals as needed. needsConfirm without confirmOverwrite → skip.
 * Proposal already gone → noop success (idempotent). marks=0 is valid (blank/null auto-sums).
 */
function handleFlushStagingApprovals_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).admin) return { ok: false, error: 'feature_unavailable' };

  var rawOps = Array.isArray(body.ops) ? body.ops : [];
  if (!rawOps.length) return { ok: false, error: 'bad_request', message: '沒有待同步項目。' };
  if (rawOps.length > FLUSH_STAGING_APPROVALS_MAX_OPS_) {
    return {
      ok: false,
      error: 'batch_too_large',
      message: '單批最多 ' + FLUSH_STAGING_APPROVALS_MAX_OPS_
        + ' 項（收到 ' + rawOps.length + '）。請分批同步其餘項目。',
      maxBatch: FLUSH_STAGING_APPROVALS_MAX_OPS_,
      received: rawOps.length
    };
  }

  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedBankPath_(cfg)) {
    return gitClientError_('github_not_configured');
  }

  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(25000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var needParts = false;
    var needClass = false;
    var needBank = false;
    var normalized = [];
    var ni;
    for (ni = 0; ni < rawOps.length; ni++) {
      var raw = rawOps[ni];
      if (!raw || typeof raw !== 'object') continue;
      var kind = String(raw.kind || '').trim();
      var opName = String(raw.op || '').trim();
      if ((kind !== 'parts' && kind !== 'class') || (opName !== 'approve' && opName !== 'reject')) {
        normalized.push({
          localId: String(raw.localId || ''),
          kind: kind,
          op: opName,
          proposalId: String(raw.proposalId || raw.id || '').trim(),
          questionId: String(raw.questionId || '').trim(),
          _invalid: true
        });
        continue;
      }
      if (kind === 'parts') needParts = true;
      if (kind === 'class') needClass = true;
      if (opName === 'approve') needBank = true;
      var confirmOverwrite = raw.confirmOverwrite === true
        || raw.confirmOverwrite === 'true'
        || raw.confirmOverwrite === 1;
      normalized.push({
        localId: String(raw.localId || ''),
        kind: kind,
        op: opName,
        proposalId: String(raw.proposalId || raw.id || '').trim(),
        questionId: String(raw.questionId || '').trim(),
        confirmOverwrite: confirmOverwrite,
        approveFields: Array.isArray(raw.approveFields) ? raw.approveFields : null,
        rejectFields: Array.isArray(raw.rejectFields) ? raw.rejectFields : null,
        values: raw.values && typeof raw.values === 'object' ? raw.values : null
      });
    }

    var partsLoaded = null;
    var classLoaded = null;
    var bankLoaded = null;
    if (needParts) partsLoaded = readQuestionPartsProposalsStore_(cfg);
    if (needClass) classLoaded = readClassificationProposalsStore_(cfg);
    if (needBank) bankLoaded = readSharedBankForPartsApprove_(cfg);

    var results = [];
    var applyPlans = [];
    var partsStoreDirty = false;
    var classStoreDirty = false;
    var bankDirty = false;

    function pushResult(item) {
      results.push(item);
    }

    for (ni = 0; ni < normalized.length; ni++) {
      var item = normalized[ni];
      if (item._invalid) {
        pushResult({
          localId: item.localId,
          kind: item.kind,
          op: item.op,
          proposalId: item.proposalId,
          questionId: item.questionId,
          status: 'failed',
          error: 'bad_request',
          message: '無效的同步項目。'
        });
        continue;
      }
      if (item.kind === 'parts' && item.op === 'approve') {
        flushValidatePartsApprove_(item, partsLoaded, bankLoaded, applyPlans, pushResult);
      } else if (item.kind === 'parts' && item.op === 'reject') {
        flushValidatePartsReject_(item, partsLoaded, applyPlans, pushResult);
      } else if (item.kind === 'class' && item.op === 'approve') {
        flushValidateClassApprove_(item, classLoaded, bankLoaded, applyPlans, pushResult);
      } else if (item.kind === 'class' && item.op === 'reject') {
        flushValidateClassReject_(item, classLoaded, applyPlans, pushResult);
      }
    }

    for (ni = 0; ni < applyPlans.length; ni++) {
      var plan = applyPlans[ni];
      if (plan.type === 'partsApprove') {
        var liveP = bankLoaded.bank.questions[plan.qIndex];
        liveP.questionParts = plan.parts;
        liveP.partsStatus = 'filled';
        if (plan.filledMarksFromParts) liveP.marks = plan.sum;
        bankLoaded.bank.questions[plan.qIndex] = liveP;
        bankDirty = true;
        var foundP = findPartsProposal_(partsLoaded.store, plan.proposalId, plan.questionId);
        if (foundP) {
          removePartsProposalAt_(partsLoaded.store, foundP.index);
          partsStoreDirty = true;
        }
        plan.result.question = publicBankPartsSnapshot_(liveP);
        plan.result.removed = true;
      } else if (plan.type === 'partsReject') {
        var foundPR = findPartsProposal_(partsLoaded.store, plan.proposalId, plan.questionId);
        if (foundPR) {
          removePartsProposalAt_(partsLoaded.store, foundPR.index);
          partsStoreDirty = true;
        }
        plan.result.removed = true;
      } else if (plan.type === 'classApprove') {
        if (plan.approveFields.length && plan.qIndex >= 0 && bankLoaded) {
          var liveC = bankLoaded.bank.questions[plan.qIndex];
          var fi;
          for (fi = 0; fi < plan.approveFields.length; fi++) {
            applyClassificationValueToQuestion_(
              liveC,
              plan.approveFields[fi],
              plan.writeValues[plan.approveFields[fi]]
            );
          }
          bankLoaded.bank.questions[plan.qIndex] = liveC;
          bankDirty = true;
          plan.result.question = publicBankClassificationSnapshot_(liveC, plan.approveFields);
        }
        if (classLoaded) {
          var foundC = findClassificationProposal_(classLoaded.store, plan.proposalId, plan.questionId);
          if (foundC) {
            var dropFields = plan.approveFields.concat(plan.rejectFields || []);
            var left = trimClassificationProposalFields_(foundC.proposal, dropFields);
            var remaining = null;
            if (left <= 0) {
              removeClassificationProposalAt_(classLoaded.store, foundC.index);
            } else {
              classLoaded.store.proposals[foundC.index] = foundC.proposal;
              remaining = publicClassificationProposalView_(foundC.proposal);
            }
            classStoreDirty = true;
            plan.result.proposalRemaining = remaining;
            plan.result.removed = left <= 0;
          } else {
            plan.result.removed = true;
          }
        }
        plan.result.approvedFields = plan.approveFields;
        plan.result.rejectedFields = plan.rejectFields || [];
        plan.result.blockedFields = plan.blockedFields || [];
      } else if (plan.type === 'classReject') {
        var foundCR = findClassificationProposal_(classLoaded.store, plan.proposalId, plan.questionId);
        if (foundCR) {
          if (plan.rejectFields && plan.rejectFields.length) {
            var leftR = trimClassificationProposalFields_(foundCR.proposal, plan.rejectFields);
            var remR = null;
            if (leftR <= 0) {
              removeClassificationProposalAt_(classLoaded.store, foundCR.index);
            } else {
              classLoaded.store.proposals[foundCR.index] = foundCR.proposal;
              remR = publicClassificationProposalView_(foundCR.proposal);
            }
            plan.result.proposalRemaining = remR;
            plan.result.removed = leftR <= 0;
            plan.result.rejectedFields = plan.rejectFields;
          } else {
            removeClassificationProposalAt_(classLoaded.store, foundCR.index);
            plan.result.removed = true;
            plan.result.proposalRemaining = null;
          }
          classStoreDirty = true;
        } else {
          plan.result.removed = true;
        }
      } else if (plan.type === 'classBlankOnly') {
        var foundB = findClassificationProposal_(classLoaded.store, plan.proposalId, plan.questionId);
        if (foundB) {
          var leftB = trimClassificationProposalFields_(foundB.proposal, plan.dropFields);
          var remB = null;
          if (leftB <= 0) {
            removeClassificationProposalAt_(classLoaded.store, foundB.index);
          } else {
            classLoaded.store.proposals[foundB.index] = foundB.proposal;
            remB = publicClassificationProposalView_(foundB.proposal);
          }
          classStoreDirty = true;
          plan.result.proposalRemaining = remB;
          plan.result.removed = leftB <= 0;
        } else {
          plan.result.removed = true;
        }
        plan.result.blockedFields = plan.dropFields;
        plan.result.blankOnlyFilled = true;
      }
    }

    var bankSha = '';
    var bankPath = '';
    var partsSha = '';
    var partsPath = '';
    var classSha = '';
    var classPath = '';
    var gitWrites = 0;

    if (bankDirty && bankLoaded) {
      var bankWritten = writeSharedBankForPartsApprove_(
        cfg,
        bankLoaded.bank,
        'Flush staging approvals (bank, ' + applyPlans.length + ' plans)'
      );
      bankSha = bankWritten.sha;
      bankPath = bankWritten.path;
      gitWrites += 1;
    }
    if (partsStoreDirty && partsLoaded) {
      var partsWritten = writeQuestionPartsProposalsStore_(
        cfg,
        partsLoaded.store,
        'Flush staging approvals (parts proposals)'
      );
      partsSha = partsWritten.sha;
      partsPath = partsWritten.path;
      gitWrites += 1;
    }
    if (classStoreDirty && classLoaded) {
      var classWritten = writeClassificationProposalsStore_(
        cfg,
        classLoaded.store,
        'Flush staging approvals (classification proposals)'
      );
      classSha = classWritten.sha;
      classPath = classWritten.path;
      gitWrites += 1;
    }

    lock.releaseLock();
    held = false;

    var summary = {
      ok: 0,
      noop: 0,
      failed: 0,
      needsConfirm: 0,
      bankWritten: bankDirty,
      partsProposalsWritten: partsStoreDirty,
      classProposalsWritten: classStoreDirty,
      gitWriteGroups: gitWrites
    };
    for (ni = 0; ni < results.length; ni++) {
      var st = results[ni].status;
      if (st === 'ok') summary.ok += 1;
      else if (st === 'noop') summary.noop += 1;
      else if (st === 'needsConfirm') summary.needsConfirm += 1;
      else summary.failed += 1;
    }

    writeLog_({
      username: username,
      action: 'flushStagingApprovals',
      success: true,
      metadata: summary
    }, true);

    return {
      ok: true,
      action: 'flushStagingApprovals',
      results: results,
      summary: summary,
      bankSha: bankSha,
      bankPath: bankPath,
      partsProposalsSha: partsSha,
      partsProposalsPath: partsPath,
      classProposalsSha: classSha,
      classProposalsPath: classPath,
      maxBatch: FLUSH_STAGING_APPROVALS_MAX_OPS_
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    if (code === 'github_not_found') return gitClientError_('github_not_found');
    return gitClientError_('github_error');
  }
}

function flushResultBase_(item, extra) {
  var out = {
    localId: item.localId,
    kind: item.kind,
    op: item.op,
    proposalId: item.proposalId,
    questionId: item.questionId
  };
  if (extra) {
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) out[keys[i]] = extra[keys[i]];
  }
  return out;
}

function flushValidatePartsApprove_(item, partsLoaded, bankLoaded, applyPlans, pushResult) {
  var found = findPartsProposal_(partsLoaded.store, item.proposalId, item.questionId);
  if (!found) {
    pushResult(flushResultBase_(item, {
      status: 'noop',
      message: '提案已不存在（視為已完成）。'
    }));
    return;
  }
  var proposal = found.proposal;
  var questionId = String(proposal.questionId || '').trim();
  var parts = normalizeProposalParts_(proposal.questionParts);
  item.proposalId = String(proposal.id || item.proposalId);
  item.questionId = questionId;
  if (!questionId || !parts.length) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: 'bad_request',
      message: '提案缺少有效分題。'
    }));
    return;
  }
  var qIndex = findBankQuestionIndex_(bankLoaded.bank, questionId);
  if (qIndex < 0) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: 'not_found',
      message: '題庫找不到題目「' + questionId + '」'
    }));
    return;
  }
  var live = bankLoaded.bank.questions[qIndex];
  if (bankQuestionHasFilledParts_(live) && !item.confirmOverwrite) {
    pushResult(flushResultBase_(item, {
      status: 'needsConfirm',
      needsConfirm: true,
      error: 'needs_confirm',
      message: '題目已有分題資料，需確認覆寫後再同步。',
      current: publicBankPartsSnapshot_(live),
      proposed: {
        questionId: questionId,
        marks: live.marks,
        partsStatus: 'filled',
        questionParts: parts
      }
    }));
    return;
  }
  var sumCheck = validateProposalPartsSum_(parts, live.marks, questionId);
  if (!sumCheck.ok) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: sumCheck.error || 'validation_failed',
      message: sumCheck.message || ''
    }));
    return;
  }
  var result = flushResultBase_(item, { status: 'ok', needsConfirm: false });
  applyPlans.push({
    type: 'partsApprove',
    proposalId: item.proposalId,
    questionId: questionId,
    qIndex: qIndex,
    parts: parts,
    sum: sumCheck.sum,
    filledMarksFromParts: sumCheck.filledMarksFromParts === true,
    result: result
  });
  pushResult(result);
}

function flushValidatePartsReject_(item, partsLoaded, applyPlans, pushResult) {
  var found = findPartsProposal_(partsLoaded.store, item.proposalId, item.questionId);
  if (!found) {
    pushResult(flushResultBase_(item, {
      status: 'noop',
      message: '提案已不存在（視為已完成）。'
    }));
    return;
  }
  item.proposalId = String(found.proposal.id || item.proposalId);
  item.questionId = String(found.proposal.questionId || item.questionId);
  var result = flushResultBase_(item, { status: 'ok' });
  applyPlans.push({
    type: 'partsReject',
    proposalId: item.proposalId,
    questionId: item.questionId,
    result: result
  });
  pushResult(result);
}

function flushValidateClassApprove_(item, classLoaded, bankLoaded, applyPlans, pushResult) {
  var found = findClassificationProposal_(classLoaded.store, item.proposalId, item.questionId);
  if (!found) {
    pushResult(flushResultBase_(item, {
      status: 'noop',
      message: '提案已不存在（視為已完成）。'
    }));
    return;
  }
  var proposal = found.proposal;
  var view = publicClassificationProposalView_(proposal);
  var questionId = String(view && view.questionId || '').trim();
  item.proposalId = String(proposal.id || item.proposalId);
  item.questionId = questionId;
  if (!questionId || !view.fields.length) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: 'bad_request',
      message: '提案缺少有效分類欄位。'
    }));
    return;
  }
  var fakeBody = {
    approveFields: item.approveFields,
    rejectFields: item.rejectFields,
    values: item.values
  };
  var actions = resolveClassificationFieldActions_(fakeBody, view.fields);
  var approveFields = actions.approveFields;
  var rejectFields = actions.rejectFields;
  if (!approveFields.length && !rejectFields.length) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: 'bad_request',
      message: '沒有指定要通過或保留原值的欄位。'
    }));
    return;
  }

  if (!approveFields.length) {
    var resultRO = flushResultBase_(item, {
      status: 'ok',
      approvedFields: [],
      rejectedFields: rejectFields
    });
    applyPlans.push({
      type: 'classApprove',
      proposalId: item.proposalId,
      questionId: questionId,
      qIndex: -1,
      approveFields: [],
      rejectFields: rejectFields,
      writeValues: {},
      blockedFields: [],
      result: resultRO
    });
    pushResult(resultRO);
    return;
  }

  var qIndex = findBankQuestionIndex_(bankLoaded.bank, questionId);
  if (qIndex < 0) {
    pushResult(flushResultBase_(item, {
      status: 'failed',
      error: 'not_found',
      message: '題庫找不到題目「' + questionId + '」'
    }));
    return;
  }
  var live = bankLoaded.bank.questions[qIndex];
  var blankSplit = partitionBlankOnlyApproveFields_(live, approveFields);
  var blockedBlankOnly = blankSplit.blocked;
  if (blockedBlankOnly.length) {
    rejectFields = rejectFields.concat(blockedBlankOnly.filter(function (f) {
      return rejectFields.indexOf(f) < 0;
    }));
    approveFields = blankSplit.allowed;
  }
  if (!approveFields.length) {
    var resultBO = flushResultBase_(item, {
      status: 'ok',
      error: 'blank_only_filled',
      blankOnlyFilled: true,
      message: '空白才可寫入的欄位在題庫已有值，已略過：'
        + blockedBlankOnly.map(classificationFieldLabel_).join('、'),
      blockedFields: blockedBlankOnly,
      rejectedFields: rejectFields
    });
    applyPlans.push({
      type: 'classBlankOnly',
      proposalId: item.proposalId,
      questionId: questionId,
      dropFields: rejectFields.slice(),
      result: resultBO
    });
    pushResult(resultBO);
    return;
  }

  var writeValues = classificationWriteValuesFromBody_(
    { values: item.values || {} },
    approveFields,
    view.proposedValues
  );
  if (classificationNeedsOverwriteConfirm_(live, approveFields) && !item.confirmOverwrite) {
    pushResult(flushResultBase_(item, {
      status: 'needsConfirm',
      needsConfirm: true,
      error: 'needs_confirm',
      message: bankQuestionReviewedByAi_(live)
        ? '題目已標記 reviewedByAI=Y，需確認覆寫後再同步。'
        : '題目已有分類資料，需確認覆寫後再同步。',
      approveFields: approveFields,
      rejectFields: rejectFields,
      blockedFields: blockedBlankOnly,
      current: publicBankClassificationSnapshot_(live, approveFields),
      proposed: {
        questionId: questionId,
        fields: approveFields,
        values: writeValues,
        reason: view.reason,
        confidence: view.confidence
      },
      reviewedByAI: String(live.reviewedByAI || '')
    }));
    return;
  }

  var result = flushResultBase_(item, {
    status: 'ok',
    needsConfirm: false,
    approvedFields: approveFields,
    rejectedFields: rejectFields,
    blockedFields: blockedBlankOnly
  });
  applyPlans.push({
    type: 'classApprove',
    proposalId: item.proposalId,
    questionId: questionId,
    qIndex: qIndex,
    approveFields: approveFields,
    rejectFields: rejectFields,
    writeValues: writeValues,
    blockedFields: blockedBlankOnly,
    result: result
  });
  pushResult(result);
}

function flushValidateClassReject_(item, classLoaded, applyPlans, pushResult) {
  var found = findClassificationProposal_(classLoaded.store, item.proposalId, item.questionId);
  if (!found) {
    pushResult(flushResultBase_(item, {
      status: 'noop',
      message: '提案已不存在（視為已完成）。'
    }));
    return;
  }
  item.proposalId = String(found.proposal.id || item.proposalId);
  item.questionId = String(found.proposal.questionId || item.questionId);
  var rejectFields = normalizeClassificationFields_(item.rejectFields);
  var result = flushResultBase_(item, { status: 'ok', rejectedFields: rejectFields });
  applyPlans.push({
    type: 'classReject',
    proposalId: item.proposalId,
    questionId: item.questionId,
    rejectFields: rejectFields,
    result: result
  });
  pushResult(result);
}



function githubUserSettingsPath_(username) {
  var segment = githubUserSegment_(username);
  if (!segment) return '';
  // Fixed filename under the user's folder — reject any traversal via segment.
  return joinGithubPath_('users/' + segment, USER_SETTINGS_REL_NAME_);
}

function githubUserSettingsReady_(cfg) {
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo)
    && githubBranchOk_(cfg.branch));
}

function emptyUserSettingsStore_() {
  return {
    schemaVersion: USER_SETTINGS_SCHEMA_VERSION_,
    updatedAt: '',
    display: { fontSize: 'medium', density: 'standard', lang: 'both' },
    list: { pageSize: 20, sort: 'default' },
    filters: { excludeOutSyl: true, rememberLast: true, searchScope: 'all' },
    stats: { mode: 'browse', dimensions: [], metrics: [] },
    ai: { defaultModel: '', explainStyle: 'short', showQuickPrompts: true },
    ui: { defaultTab: 'questions' }
  };
}

function normalizeUserSettingsPayload_(raw) {
  var data = coerceJson_(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'bad_request' };
  }
  // Strip secrets if a client ever sends them.
  delete data.poeApiKey;
  delete data.openRouterApiKey;
  delete data.apiKey;
  delete data.apiKeys;
  delete data.idSetFilter;
  delete data.advancedFilter;
  delete data.triStateFilters;

  var out = emptyUserSettingsStore_();
  var schema = Number(data.schemaVersion);
  if (isFinite(schema) && schema >= 1) {
    out.schemaVersion = Math.min(Math.floor(schema), USER_SETTINGS_SCHEMA_VERSION_);
  }
  if (typeof data.updatedAt === 'string') out.updatedAt = String(data.updatedAt).slice(0, 40);

  function copyObj_(src, dest) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return;
    Object.keys(dest).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) return;
      dest[key] = src[key];
    });
    // Allow extra preference keys for forward compatibility (bounded size later).
    Object.keys(src).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(dest, key)) return;
      if (key === 'poeApiKey' || key === 'openRouterApiKey' || key === 'apiKey') return;
      dest[key] = src[key];
    });
  }
  copyObj_(data.display, out.display);
  copyObj_(data.list, out.list);
  copyObj_(data.filters, out.filters);
  copyObj_(data.stats, out.stats);
  copyObj_(data.ai, out.ai);
  copyObj_(data.ui, out.ui);

  // Clamp a few high-value fields.
  var pageSize = Number(out.list.pageSize);
  if (!isFinite(pageSize) || (pageSize !== -1 && (pageSize < 1 || pageSize > 500))) {
    out.list.pageSize = 20;
  } else {
    out.list.pageSize = Math.floor(pageSize);
  }
  out.filters.excludeOutSyl = out.filters.excludeOutSyl !== false;
  out.filters.rememberLast = out.filters.rememberLast !== false;
  out.ai.showQuickPrompts = out.ai.showQuickPrompts !== false;
  if (out.ai.explainStyle !== 'detailed') out.ai.explainStyle = 'short';
  if (out.ui.defaultTab !== 'stats') out.ui.defaultTab = 'questions';
  if (out.stats.mode === 'crosstab' || out.stats.mode === 'detail') {
    out.stats.mode = out.stats.mode === 'detail' ? 'browse' : 'crosstab';
  } else {
    out.stats.mode = 'browse';
  }
  if (!Array.isArray(out.stats.dimensions)) out.stats.dimensions = [];
  if (!Array.isArray(out.stats.metrics)) out.stats.metrics = [];
  if (out.stats.dimensions.length > 40) out.stats.dimensions = out.stats.dimensions.slice(0, 40);
  if (out.stats.metrics.length > 20) out.stats.metrics = out.stats.metrics.slice(0, 20);

  var text = JSON.stringify(out);
  if (utf8Length_(text) > USER_SETTINGS_MAX_BYTES_) {
    return { ok: false, error: 'payload_too_large' };
  }
  return { ok: true, settings: out, text: text };
}

function handleGetUserSettings_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubUserSettingsReady_(cfg)) return gitClientError_('github_not_configured');
  var path = githubUserSettingsPath_(username);
  if (!path) return gitClientError_('bad_request');
  try {
    var read = githubReadText_(cfg, path);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      return gitClientError_('github_error');
    }
    var normalized = normalizeUserSettingsPayload_(parsed);
    if (!normalized.ok) {
      return { ok: true, settings: emptyUserSettingsStore_(), path: path, sha: read.sha || '', missing: false };
    }
    return {
      ok: true,
      settings: normalized.settings,
      path: path,
      sha: read.sha || '',
      missing: false
    };
  } catch (err) {
    if (err && err.code === 'github_not_found') {
      return {
        ok: true,
        settings: emptyUserSettingsStore_(),
        path: path,
        sha: '',
        missing: true
      };
    }
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

function handleSaveUserSettings_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return { ok: false, error: 'feature_unavailable' };
  var cfg = githubConfig_();
  if (!githubUserSettingsReady_(cfg)) return gitClientError_('github_not_configured');
  var path = githubUserSettingsPath_(username);
  if (!path) return gitClientError_('bad_request');

  var normalized = normalizeUserSettingsPayload_(body.settings != null ? body.settings : body.data);
  if (!normalized.ok) {
    return gitClientError_(normalized.error || 'bad_request');
  }
  var settings = normalized.settings;
  settings.updatedAt = new Date().toISOString();
  settings.schemaVersion = USER_SETTINGS_SCHEMA_VERSION_;
  var text = JSON.stringify(settings);
  if (utf8Length_(text) > USER_SETTINGS_MAX_BYTES_) return gitClientError_('payload_too_large');

  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(20000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var written = githubWriteText_(cfg, path, text, 'Update user settings for ' + githubUserSegment_(username));
    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'saveUserSettings',
      success: true,
      metadata: { bytes: utf8Length_(text), schemaVersion: settings.schemaVersion }
    }, true);
    return {
      ok: true,
      settings: settings,
      sha: written.sha,
      path: path
    };
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'payload_too_large') return gitClientError_('payload_too_large');
    return gitClientError_(code === 'github_not_found' ? 'github_error' : code);
  }
}

// === Model test / stem pattern review ===
// handleTest_ and stem review sit after side-file writers for historical layout.
// Stem review reuses requestCompletion_ but never writes Git AI backups.

// Short model ping (expects 正常). Does not count toward POE_DAILY_LIMIT.
function handleTest_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) {
    if (username && shouldAudit_(username, 'test-denied', 60)) {
      writeLog_({
        username: username,
        action: 'testModel',
        success: false,
        metadata: { error: 'denied' }
      }, false);
    }
    return { ok: false, error: 'feature_unavailable' };
  }

  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'testModel',
      success: false,
      metadata: { error: 'missing_api_key', provider: provider }
    }, true);
    return { ok: false, error: 'missing_api_key' };
  }

  try {
    getLogSheet_();
    getBackupSheet_();
  } catch (err) {
    safeLog_(err);
    return { ok: false, error: 'server_error' };
  }

  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds, 'test')) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var started = Date.now();
  try {
    var completion = requestCompletion_(apiKey, model, POE_TEST_USER_PROMPT_, POE_TEST_SYSTEM_PROMPT_, provider);
    var durationMs = Date.now() - started;
    var passed = testReplyOk_(completion.content);
    var gitBackup = false;
    var backupName = '';
    try {
      backupName = writeGitAiBackup_({
        action: 'testModel',
        username: username,
        model: completion.model || model,
        content: completion.content,
        durationMs: durationMs
      }) || '';
      gitBackup = !!backupName;
    } catch (backupErr) {
      safeLog_(backupErr);
    }
    var result = {
      ok: true,
      passed: passed,
      content: completion.content,
      model: completion.model || model,
      logged: false,
      backedUp: false,
      durationMs: durationMs,
      gitBackup: gitBackup
    };
    var testMeta = {
      model: result.model,
      requestedModel: model,
      provider: provider,
      passed: passed,
      durationMs: durationMs,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      replyPreview: clip_(completion.content, 120),
      replyChars: completion.content.length,
      gitBackup: gitBackup
    };
    result.logged = writeLog_({
      username: username,
      action: 'testModel',
      success: passed,
      metadata: testMeta
    }, true);
    result.backedUp = writeBackup_({
      username: username,
      action: 'testModel',
      model: result.model,
      modeId: '',
      modeName: '',
      instruction: POE_TEST_USER_PROMPT_,
      filteredCount: '',
      sentCount: '',
      content: completion.content,
      metadata: {
        requestedModel: model,
        passed: passed,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        gitBackup: gitBackup
      }
    });
    return result;
  } catch (err) {
    releaseIntervalSlot_(username, 'test');
    var fail = upstreamFailurePayload_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'testModel',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        model: model,
        provider: provider,
        durationMs: Date.now() - started
      }, err)
    }, true);
    return fail;
  }
}

// Review stemPatterns for selected bank rows. Reuses Poe/OpenRouter keys and
// requestCompletion_, but never writes Git AI backups or GenerationBackup rows.
// Transcript stays in the browser (localStorage). UsageLog records metadata only.
function handleReviewStemPatterns_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) {
    if (username && shouldAudit_(username, 'stem-review-denied', 60)) {
      writeLog_({
        username: username,
        action: 'reviewStemPatterns',
        success: false,
        metadata: { error: 'denied' }
      }, false);
    }
    return { ok: false, error: 'feature_unavailable' };
  }

  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'reviewStemPatterns',
      success: false,
      metadata: { error: 'missing_api_key', provider: provider }
    }, true);
    return { ok: false, error: 'missing_api_key' };
  }

  try {
    getLogSheet_();
  } catch (err) {
    safeLog_(err);
    return { ok: false, error: 'server_error' };
  }

  var packed = packStemReviewQuestions_(body.questions, STEM_REVIEW_MAX_QUESTIONS_, STEM_REVIEW_MAX_CHARS_);
  if (!packed.questions.length) {
    return { ok: false, error: 'no_reference_questions' };
  }

  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds, 'review')) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var noteMeta = instructionMeta_(body.note || body.instruction);
  var vocab = packStemReviewVocab_(body.vocabulary);
  var started = Date.now();
  try {
    var userPrompt = buildStemReviewPrompt_(packed.questions, vocab, noteMeta.text, packed.truncated);
    var completion = requestCompletion_(apiKey, model, userPrompt, STEM_REVIEW_SYSTEM_PROMPT_, provider);
    var durationMs = Date.now() - started;
    var result = {
      ok: true,
      content: completion.content,
      model: completion.model || model,
      sentCount: packed.questions.length,
      truncated: packed.truncated,
      logged: false,
      backedUp: false,
      gitBackup: false,
      durationMs: durationMs,
      requestId: requestId_(body && body.requestId)
    };
    result.logged = writeLog_({
      username: username,
      action: 'reviewStemPatterns',
      success: true,
      metadata: {
        model: result.model,
        requestedModel: model,
        provider: provider,
        sentCount: result.sentCount,
        truncated: packed.truncated,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        noteChars: noteMeta.chars,
        vocabCount: vocab.length,
        // Explicit: no remote transcript / backup for this action.
        gitBackup: false,
        sheetBackup: false
      }
    }, true);
    return result;
  } catch (err) {
    releaseIntervalSlot_(username, 'review');
    var fail = upstreamFailurePayload_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'reviewStemPatterns',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        model: model,
        provider: provider,
        sentCount: packed.questions.length,
        durationMs: Date.now() - started
      }, err)
    }, true);
    return fail;
  }
}

function listFieldJoin_(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return String(item == null ? '' : item).trim();
    }).filter(Boolean).join(' | ');
  }
  return String(value == null ? '' : value).trim();
}

function packStemReviewQuestions_(raw, maxCount, maxChars) {
  var questions = [];
  var used = 0;
  var truncated = false;
  if (!Array.isArray(raw)) return { questions: questions, truncated: false };
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') continue;
    var question = clip_(item.question || item.plainText || item.questionTextChi, 6000);
    if (!question) continue;
    if (questions.length >= maxCount) {
      truncated = true;
      break;
    }
    var entry = {
      id: clip_(item.id, 80),
      examination: clip_(item.examination, 40),
      year: clip_(item.year, 20),
      questionType: clip_(item.questionType, 40),
      concepts: clip_(listFieldJoin_(item.concepts), 300),
      patterns: clip_(listFieldJoin_(item.patterns), 300),
      stemPatterns: clip_(listFieldJoin_(item.stemPatterns), 800),
      question: question
    };
    var weight = entry.question.length + entry.stemPatterns.length + entry.patterns.length;
    if (questions.length > 0 && used + weight > maxChars) {
      truncated = true;
      break;
    }
    questions.push(entry);
    used += weight;
  }
  return { questions: questions, truncated: truncated };
}

function packStemReviewVocab_(raw) {
  var out = [];
  var seen = {};
  var list = Array.isArray(raw) ? raw : [];
  for (var i = 0; i < list.length; i++) {
    var text = String(list[i] == null ? '' : list[i]).trim();
    if (!text || seen[text]) continue;
    seen[text] = true;
    out.push(clip_(text, 200));
    if (out.length >= STEM_REVIEW_VOCAB_MAX_) break;
  }
  return out;
}

function buildStemReviewPrompt_(questions, vocabulary, note, truncated) {
  var lines = [];
  lines.push('請審核以下題目的 stemPatterns（題幹模式），並回答：');
  lines.push('1. 各題現行 stemPatterns 是否正確、是否應改寫或改用既有詞彙；');
  lines.push('2. 這批題目是否應共用同一個（或同一組）stemPatterns 模板；');
  lines.push('3. 為每題建議修正後的 stemPatterns 字串（可多個，用 | 分隔；優先用既有詞彙）。');
  lines.push('');
  lines.push('請用繁體中文，並依下列格式回覆（方便管理員套用）：');
  lines.push('## 總結');
  lines.push('（是否同模板、整體觀察）');
  lines.push('## 建議');
  lines.push('### 編號：<題目ID>');
  lines.push('現行：…');
  lines.push('建議：template A | template B');
  lines.push('理由：…');
  lines.push('同模板：是／否');
  if (note) {
    lines.push('');
    lines.push('使用者補充：');
    lines.push(note);
  }
  if (truncated) {
    lines.push('');
    lines.push('（題目或詞彙因長度上限而截斷；請只根據下列已附內容判斷。）');
  }
  if (vocabulary && vocabulary.length) {
    lines.push('');
    lines.push('既有 stemPatterns 詞彙（優先沿用）：');
    vocabulary.forEach(function (item, index) {
      lines.push((index + 1) + '. ' + item);
    });
  }
  lines.push('');
  lines.push('待審題目：');
  lines.push('');
  questions.forEach(function (q, index) {
    lines.push('【題目 ' + (index + 1) + '】');
    if (q.id) lines.push('編號：' + q.id);
    if (q.examination) lines.push('考試：' + q.examination);
    if (q.year) lines.push('年份：' + q.year);
    if (q.questionType) lines.push('題型：' + q.questionType);
    if (q.concepts) lines.push('概念：' + q.concepts);
    if (q.patterns) lines.push('題型標籤（patterns）：' + q.patterns);
    lines.push('現行 stemPatterns：' + (q.stemPatterns || '（空）'));
    lines.push('題幹：');
    lines.push(q.question);
    lines.push('');
  });
  return lines.join('\n');
}

function buildPrompt_(questions, filteredCount, truncated, instruction, source) {
  var lines = [instruction || POE_INSTRUCTION_, ''];
  var single = referenceSource_(source) === 'single';
  if (!single && (truncated || questions.length < filteredCount)) {
    lines.push('（篩選結果共有 ' + filteredCount + ' 題，以下只附上 ' + questions.length + ' 題作為風格、用字與句式的參考。）');
    lines.push('');
  }
  lines.push(single
    ? '以下只附上使用者指定的一題，包含題幹與答案。請只根據這一題撰寫全新題目，不要假設還有其他篩選題，也不要逐句抄寫。'
    : '以下為參考題目（每題含題幹與答案）。請撰寫全新題目，不要逐句抄寫參考題。');
  lines.push('');
  questions.forEach(function (q, index) {
    lines.push('【參考 ' + (index + 1) + '】');
    if (q.id) lines.push('編號：' + q.id);
    if (q.examination) lines.push('考試：' + q.examination);
    if (q.year) lines.push('年份：' + q.year);
    if (q.questionType) lines.push('題型：' + q.questionType);
    if (q.concepts) lines.push('概念：' + q.concepts);
    lines.push('題目：');
    lines.push(q.question);
    lines.push('答案：');
    lines.push(q.explanation || '（沒有答案）');
    lines.push('');
  });
  return lines.join('\n');
}

function requestCompletion_(apiKey, model, userPrompt, systemPrompt, provider) {
  return requestCompletionMessages_(apiKey, model, [
    { role: 'system', content: systemPrompt || POE_SYSTEM_PROMPT_ },
    { role: 'user', content: userPrompt }
  ], provider);
}

// Chat-completions with an arbitrary messages[] (roles: system/user/assistant).
function requestCompletionMessages_(apiKey, model, messages, provider) {
  provider = provider === 'openrouter' ? 'openrouter' : 'poe';
  var payload = {
    model: model,
    messages: messages
  };
  var maxTokens = optionalNumber_('POE_MAX_TOKENS');
  var temperature = optionalNumber_('POE_TEMPERATURE');
  if (maxTokens != null && maxTokens > 0) payload.max_tokens = Math.round(maxTokens);
  if (temperature != null) payload.temperature = temperature;

  var url = provider === 'openrouter' ? OPENROUTER_CHAT_URL_ : POE_CHAT_URL_;
  var headers = { Authorization: 'Bearer ' + apiKey };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/';
    headers['X-Title'] = 'econ-database AI';
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var raw = response.getContentText() || '';
  if (status < 200 || status >= 300) {
    var httpError = new Error('upstream_http_' + status);
    httpError.code = status === 408 || status === 504 ? 'upstream_timeout' : 'upstream_error';
    httpError.httpStatus = status;
    httpError.upstreamType = '';
    httpError.upstreamMessage = '';
    try {
      var errBody = JSON.parse(raw);
      var errObj = errBody && errBody.error;
      if (errObj && typeof errObj === 'object') {
        var typeStr = errObj.type != null ? String(errObj.type).trim() : '';
        var codeStr = errObj.code != null ? String(errObj.code).trim() : '';
        httpError.upstreamType = (typeStr || codeStr).slice(0, 80);
        if (errObj.message != null) {
          httpError.upstreamMessage = clip_(errObj.message, 200);
        }
      } else if (typeof errObj === 'string' && errObj) {
        httpError.upstreamMessage = clip_(errObj, 200);
      }
    } catch (parseIgnore) {
      // Non-JSON error body — keep httpStatus only.
    }
    throw httpError;
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    var parseError = new Error('upstream_parse');
    parseError.code = 'upstream_error';
    throw parseError;
  }
  var content = messageText_(parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message);
  if (!content) {
    var emptyError = new Error('upstream_empty');
    emptyError.code = 'upstream_error';
    throw emptyError;
  }
  var usage = parsed.usage || {};
  return {
    content: content,
    model: parsed.model || model,
    promptTokens: numberOrNull_(usage.prompt_tokens),
    completionTokens: numberOrNull_(usage.completion_tokens)
  };
}

// Normalize client chat turns for continueGeneration. Caps count and chars.
function normalizeContinueMessages_(raw, systemPrompt) {
  var maxMessages = Math.min(positiveInt_(props_().getProperty('POE_CONTINUE_MAX_MESSAGES'), 24), 40);
  var maxChars = Math.min(positiveInt_(props_().getProperty('POE_CONTINUE_MAX_CHARS'), 120000), 250000);
  var maxEach = Math.min(positiveInt_(props_().getProperty('POE_CONTINUE_MAX_EACH'), 40000), 80000);
  var list = Array.isArray(raw) ? raw : [];
  var out = [];
  var total = 0;
  var hasUser = false;
  for (var i = 0; i < list.length && out.length < maxMessages; i++) {
    var item = list[i];
    if (!item || typeof item !== 'object') continue;
    var role = String(item.role || '').trim().toLowerCase();
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue;
    var text = String(item.content == null ? '' : item.content).trim();
    if (!text) continue;
    if (text.length > maxEach) text = text.slice(0, maxEach);
    if (total + text.length > maxChars) {
      var room = maxChars - total;
      if (room < 200) break;
      text = text.slice(0, room);
    }
    total += text.length;
    if (role === 'user') hasUser = true;
    out.push({ role: role, content: text });
  }
  if (!out.length || !hasUser) {
    return { ok: false, error: 'bad_request', messages: [] };
  }
  if (out[0].role !== 'system') {
    out.unshift({ role: 'system', content: systemPrompt || POE_SYSTEM_PROMPT_ });
  }
  return { ok: true, messages: out, messageCount: out.length, charCount: total };
}

function messageText_(message) {
  if (!message) return '';
  var content = message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('').trim();
  }
  return '';
}

// Pack client reference rows for the model prompt.
// Each item should include stem (`question`) and answer (`explanation`, or
// alias `answer`). Missing answer is kept as empty and rendered as a clear
// placeholder — never strip unknown fields to "help" an old client.
function packReferences_(raw, maxCount, maxChars) {
  var questions = [];
  var used = 0;
  var truncated = false;
  if (!Array.isArray(raw)) return { questions: questions, truncated: false };
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') continue;
    var question = clip_(item.question, 6000);
    if (!question) continue;
    if (questions.length >= maxCount) {
      truncated = true;
      break;
    }
    var answerText = item.explanation;
    if (answerText == null || String(answerText).trim() === '') {
      answerText = item.answer;
    }
    var entry = {
      id: clip_(item.id, 80),
      examination: clip_(item.examination, 40),
      year: clip_(item.year, 20),
      questionType: clip_(item.questionType, 40),
      concepts: clip_(item.concepts, 300),
      question: question,
      explanation: clip_(answerText, 6000)
    };
    var weight = entry.question.length + entry.explanation.length;
    if (questions.length > 0 && used + weight > maxChars) {
      truncated = true;
      break;
    }
    questions.push(entry);
    used += weight;
  }
  return { questions: questions, truncated: truncated };
}

function hashInList_(digest, list) {
  var target = String(digest || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(target)) return false;
  var items = Array.isArray(list) ? list : parseList_(list);
  for (var i = 0; i < items.length; i++) {
    var hex = String(items[i] || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex) && hex === target) return true;
  }
  return false;
}

// Highest match wins: admin, then AI editor, then mock-only, then restricted.
// A value that is not 64 hex characters never matches, so a plaintext
// username in a property does not grant a role.
function rightsFromLists_(digest, adminHashes, aiHashes, mockHashes, restrictedHashes) {
  if (hashInList_(digest, adminHashes)) {
    return { known: true, admin: true, ai: true, githubSync: true, mockTests: true };
  }
  if (hashInList_(digest, aiHashes)) {
    return { known: true, admin: false, ai: true, githubSync: false, mockTests: true };
  }
  if (hashInList_(digest, mockHashes)) {
    return { known: true, admin: false, ai: false, githubSync: false, mockTests: true };
  }
  if (hashInList_(digest, restrictedHashes)) {
    return { known: true, admin: false, ai: false, githubSync: false, mockTests: false };
  }
  return { known: false, admin: false, ai: false, githubSync: false, mockTests: false };
}

function lookupRights_(username) {
  var name = normalizeUsername_(username);
  if (!name) return rightsFromLists_('', [], [], [], []);
  var stored = props_();
  return rightsFromLists_(
    sha256Hex_(name),
    stored.getProperty('ALLOWED_ADMIN_HASHES'),
    stored.getProperty('ALLOWED_AI_HASHES'),
    stored.getProperty('ALLOWED_MOCK_HASHES'),
    stored.getProperty('ALLOWED_RESTRICTED_HASHES')
  );
}

// `allowed` mirrors githubSync only (admin) for older Pages builds that still
// check data.allowed. Current clients use admin / ai / githubSync / mockTests
// and ignore `allowed`. AI-only features must gate on `ai`, not `allowed`.
function rightsResponse_(rights) {
  var item = rights || {};
  var ai = item.ai === true;
  var githubSync = item.githubSync === true;
  return {
    ok: true,
    admin: item.admin === true,
    ai: ai,
    githubSync: githubSync,
    mockTests: item.mockTests === true,
    allowed: githubSync
  };
}

function isMockQuestion_(question) {
  if (!question || typeof question !== 'object') return false;
  var id = String(question.id || '');
  if (/^MT?\d/i.test(id)) return true;
  var publisher = String(question.publisher || '');
  return publisher !== '' && publisher !== 'HKEAA' && publisher !== '-';
}

function stripMockQuestions_(text) {
  var parsed = JSON.parse(text);
  var list = Array.isArray(parsed) ? parsed : (parsed && parsed.questions);
  if (!Array.isArray(list)) throw gitFail_('github_error');
  var kept = [];
  for (var i = 0; i < list.length; i++) {
    if (!isMockQuestion_(list[i])) kept.push(list[i]);
  }
  if (Array.isArray(parsed)) return JSON.stringify(kept);
  parsed.questions = kept;
  if (typeof parsed.questionCount === 'number') parsed.questionCount = kept.length;
  return JSON.stringify(parsed);
}

function sharedMockOnly_(rel) {
  var path = String(rel || '');
  if (path === 'data/database.js') return true;
  // Publisher shard: 雅集 only for mockTests (HKEAA shard stays readable).
  if (path === 'data/database-aristo.json') return true;
  if (path === 'build' || path.indexOf('build/') === 0) return true;
  if (path === 'diagrams' || path.indexOf('diagrams/') === 0) return true;
  if (path === 'papers/mock-tests' || path.indexOf('papers/mock-tests/') === 0) return true;
  if (/^originals\/\d+(\/|$)/.test(path)) return true;
  return false;
}

function countTodayGenerations_(username) {
  try {
    var sheet = getLogSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return 0;
    var height = Math.min(last - 1, 2000);
    var start = last - height + 1;
    var values = sheet.getRange(start, 1, height, 4).getValues();
    var today = startOfToday_().getTime();
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      var ts = values[i][0];
      var user = normalizeUsername_(values[i][1]);
      var action = String(values[i][2] || '');
      var success = String(values[i][3] || '');
      if (user !== username || success !== 'success') continue;
      if (action !== 'generateQuestions' && action !== 'continueGeneration') continue;
      if (ts instanceof Date && ts.getTime() >= today) count++;
    }
    return count;
  } catch (err) {
    safeLog_(err);
    return 0;
  }
}

function intervalKey_(username, slot) {
  var prefix = 'poe_iv_';
  if (slot === 'test') prefix = 'poe_test_iv_';
  else if (slot === 'review') prefix = 'poe_review_iv_';
  return prefix + sha256Hex_(username).slice(0, 32);
}

function takeIntervalSlot_(username, seconds, slot) {
  if (!seconds) return true;
  var cache = CacheService.getScriptCache();
  var key = intervalKey_(username, slot);
  if (cache.get(key)) return false;
  cache.put(key, '1', Math.min(seconds, 21600));
  return true;
}

function releaseIntervalSlot_(username, slot) {
  try {
    CacheService.getScriptCache().remove(intervalKey_(username, slot));
  } catch (err) {
    safeLog_(err);
  }
}

function shouldAudit_(username, action, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'poe_au_' + sha256Hex_(action + '\n' + username).slice(0, 32);
    if (cache.get(key)) return false;
    cache.put(key, '1', Math.min(seconds, 21600));
    return true;
  } catch (err) {
    return true;
  }
}

function writeLog_(entry, priority) {
  try {
    if (!priority && !allowLowPriorityLog_()) return false;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return false;
    try {
      var sheet = getLogSheet_();
      var metadata = entry.metadata || {};
      var encoded = JSON.stringify(metadata);
      if (encoded.length > 500) encoded = encoded.slice(0, 500);
      sheet.appendRow([
        new Date(),
        entry.username,
        entry.action,
        entry.success ? 'success' : 'fail',
        encoded
      ]);
      return true;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    safeLog_(err);
    return false;
  }
}

function allowLowPriorityLog_() {
  try {
    var cache = CacheService.getScriptCache();
    var current = Number(cache.get('poe_log_bucket') || '0');
    if (current >= 60) return false;
    cache.put('poe_log_bucket', String(current + 1), 60);
    return true;
  } catch (err) {
    return true;
  }
}

function getLogSheet_() {
  var ss = getSpreadsheet_();
  var name = clip_(props_().getProperty('LOG_SHEET_NAME') || 'UsageLog', 80) || 'UsageLog';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'username', 'action', 'success', 'metadata']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getBackupSheet_() {
  var ss = getSpreadsheet_();
  var logName = clip_(props_().getProperty('LOG_SHEET_NAME') || 'UsageLog', 80) || 'UsageLog';
  var name = clip_(props_().getProperty('BACKUP_SHEET_NAME') || 'GenerationBackup', 80) || 'GenerationBackup';
  if (name === logName) name = 'GenerationBackup';
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    var headers = [
      'timestamp',
      'username',
      'action',
      'model',
      'modeId',
      'modeName',
      'instruction',
      'filteredCount',
      'sentCount',
      'responseTruncated',
      'responseText',
      'metadata'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeBackup_(entry) {
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return false;
    try {
      var sheet = getBackupSheet_();
      var instruction = fitSheetText_(entry.instruction, 8000);
      var response = fitSheetText_(entry.content, POE_SHEET_CELL_MAX_);
      var metadata = {};
      var source = entry.metadata || {};
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) metadata[key] = source[key];
      }
      var notes = [];
      if (response.truncated) notes.push('response_truncated');
      if (instruction.truncated) notes.push('instruction_truncated');
      if (notes.length) metadata.truncation = notes.join(',');
      var encoded = JSON.stringify(metadata);
      if (encoded.length > 2000) encoded = '{"truncation":"metadata_truncated"}';
      sheet.appendRow([
        new Date(),
        entry.username,
        entry.action,
        clip_(entry.model, 80),
        entry.modeId || '',
        entry.modeName || '',
        instruction.text,
        entry.filteredCount == null ? '' : entry.filteredCount,
        entry.sentCount == null ? '' : entry.sentCount,
        response.truncated ? 'yes' : 'no',
        response.text,
        encoded
      ]);
      return true;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    safeLog_(err);
    return false;
  }
}

function fitSheetText_(value, max) {
  var text = String(value == null ? '' : value);
  var limit = max > 0 ? max : POE_SHEET_CELL_MAX_;
  if (text.length <= limit) return { text: text, truncated: false };
  var sliced = text.slice(0, limit);
  var last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) sliced = sliced.slice(0, -1);
  return { text: sliced, truncated: true };
}

function isPresetPoeModel_(value) {
  var name = String(value || '').trim();
  for (var i = 0; i < POE_ALLOWED_MODELS_.length; i++) {
    if (POE_ALLOWED_MODELS_[i] === name) return true;
  }
  return false;
}

function isAllowedPoeModelId_(value) {
  var name = String(value || '').trim();
  if (!name || name.length > POE_MODEL_MAX_) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(name)) return false;
  if (name.indexOf('..') !== -1) return false;
  return true;
}

// Keep old name for property / empty fallbacks that used the allowlist helper.
function isAllowedModel_(value) {
  return isPresetPoeModel_(value) || isAllowedPoeModelId_(value);
}

function isAllowedOpenRouterModel_(value) {
  var name = String(value || '').trim();
  if (!name || name.length > OPENROUTER_MODEL_MAX_) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-\/:]*$/.test(name)) return false;
  if (name.indexOf('..') !== -1) return false;
  return true;
}

// Poe / OpenRouter: validated free-text id (presets preferred in the UI).
// A missing model may use POE_MODEL / OPENROUTER_MODEL when valid.
function resolveModel_(requested, provider) {
  provider = provider === 'openrouter' ? 'openrouter' : 'poe';
  var value = String(requested == null ? '' : requested).trim();
  if (provider === 'openrouter') {
    if (isAllowedOpenRouterModel_(value)) return value;
    if (!value) {
      var fromOr = String(props_().getProperty('OPENROUTER_MODEL') || '').trim();
      if (isAllowedOpenRouterModel_(fromOr)) return fromOr;
    }
    return OPENROUTER_DEFAULT_MODEL_;
  }
  if (isAllowedPoeModelId_(value)) return value;
  if (!value) {
    var fromProperty = String(props_().getProperty('POE_MODEL') || '').trim();
    if (isAllowedPoeModelId_(fromProperty)) return fromProperty;
  }
  return POE_DEFAULT_MODEL_;
}

function resolveModeId_(value) {
  var id = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(POE_MODE_NAMES_, id) ? id : '';
}

function modeName_(id) {
  return POE_MODE_NAMES_[id] || '';
}

function testReplyOk_(content) {
  var text = String(content || '').replace(/\s+/g, '');
  text = text.replace(/[。．.！!，,、：:；;「」"'“”]/g, '');
  return text === '正常' || text.indexOf('正常') === 0;
}

function getSpreadsheet_() {
  var id = String(props_().getProperty('SPREADSHEET_ID') || '').trim();
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('no_spreadsheet');
}

// Client `instruction` is optional. Empty, non-string, or whitespace-only
// values fall back to POE_INSTRUCTION_. UsageLog stores the length only.
// GenerationBackup stores the instruction text that was actually sent.
function sanitizeInstruction_(value) {
  if (typeof value !== 'string') return POE_INSTRUCTION_;
  var text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return POE_INSTRUCTION_;
  if (text.length > POE_INSTRUCTION_MAX_) {
    text = text.slice(0, POE_INSTRUCTION_MAX_);
    var last = text.charCodeAt(text.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) text = text.slice(0, -1);
    text = text.trim();
  }
  return text || POE_INSTRUCTION_;
}

function instructionMeta_(raw) {
  var providedChars = typeof raw === 'string' ? raw.length : 0;
  var text = sanitizeInstruction_(raw);
  return {
    text: text,
    chars: text.length,
    providedChars: providedChars,
    custom: text !== POE_INSTRUCTION_
  };
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('出題代理')
    .addItem('計算使用者名稱雜湊', 'promptUsernameHash')
    .addToUi();
}

// Admin helper. The dialog shows only the SHA-256 hex of the normalized
// username. Paste that hex into one role property. Do not store the username.
function promptUsernameHash() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '計算雜湊',
    '輸入一個使用者名稱。程式會去掉首尾空白並轉成小寫，然後只顯示雜湊。把雜湊貼到 ALLOWED_ADMIN_HASHES、ALLOWED_AI_HASHES 或 ALLOWED_RESTRICTED_HASHES 其中一個（可用逗號、換行或空格分隔多個）。不要把使用者名稱寫進屬性。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var username = normalizeUsername_(response.getResponseText());
  if (!username) {
    ui.alert('請輸入使用者名稱');
    return;
  }
  ui.alert('SHA-256', sha256Hex_(username), ui.ButtonSet.OK);
}

function selfTestRoleRights() {
  var sample = sha256Hex_('sample_user');
  var adminRights = rightsFromLists_(sample, [sample], [], [], []);
  if (!adminRights.known || !adminRights.admin || !adminRights.ai || !adminRights.githubSync || !adminRights.mockTests) {
    throw new Error('role_admin');
  }
  var aiRights = rightsFromLists_(sample, [], [sample], [], []);
  if (!aiRights.known || aiRights.admin || !aiRights.ai || aiRights.githubSync || !aiRights.mockTests) {
    throw new Error('role_ai');
  }
  var restrictedRights = rightsFromLists_(sample, [], [], [], [sample]);
  if (!restrictedRights.known || restrictedRights.admin || restrictedRights.ai || restrictedRights.githubSync || restrictedRights.mockTests) {
    throw new Error('role_restricted');
  }
  var none = rightsFromLists_(sample, [], [], [], []);
  if (none.known || none.ai || none.githubSync || none.mockTests) throw new Error('role_none');
  if (rightsFromLists_(sample, ['sample_user'], [], [], []).known) throw new Error('role_plaintext_ignored');
  if (rightsFromLists_(sample, [sample], [sample], [sample], [sample]).admin !== true) throw new Error('role_admin_wins');
  var payload = rightsResponse_(aiRights);
  var encoded = JSON.stringify(payload);
  if (payload.ok !== true || payload.ai !== true || payload.githubSync !== false || payload.mockTests !== true || payload.admin !== false || payload.allowed !== false) {
    throw new Error('role_response');
  }
  if (rightsResponse_(adminRights).allowed !== true) throw new Error('role_response_allowed_admin');
  if (rightsResponse_(restrictedRights).allowed !== false) throw new Error('role_response_allowed_restricted');
  if (rightsResponse_(none).allowed !== false) throw new Error('role_response_allowed_none');
  if (rightsResponse_(null).allowed !== false) throw new Error('role_response_allowed_empty');
  if (encoded.indexOf(sample) !== -1 || encoded.indexOf('sample_user') !== -1 || encoded.indexOf('known') !== -1) {
    throw new Error('role_response_leak');
  }
  if (!isMockQuestion_({ id: 'MT27-P1-01', publisher: 'HKEAA' })) throw new Error('mock_id');
  if (isMockQuestion_({ id: 'DSE-2012-P1-01', publisher: 'HKEAA' })) throw new Error('mock_dse');
  if (!isMockQuestion_({ id: 'DSE-2012-P1-01', publisher: '雅集出版社' })) throw new Error('mock_publisher');
  var stripped = JSON.parse(stripMockQuestions_(JSON.stringify({
    questionCount: 2,
    questions: [
      { id: 'MT27-P1-01', publisher: 'HKEAA' },
      { id: 'DSE-2012-P1-01', publisher: 'HKEAA' }
    ]
  })));
  if (stripped.questionCount !== 1 || stripped.questions.length !== 1 || stripped.questions[0].id !== 'DSE-2012-P1-01') {
    throw new Error('mock_strip');
  }
  if (!sharedMockOnly_('diagrams/MT27-P1-24.jpg')) throw new Error('mock_path_diagram');
  if (!sharedMockOnly_('originals/27/q-p1-01.jpg')) throw new Error('mock_path_original');
  if (!sharedMockOnly_('papers/mock-tests/file.pdf')) throw new Error('mock_path_paper');
  if (sharedMockOnly_('originals/dse/2012/q-p1-01.jpg')) throw new Error('mock_path_dse');
  if (sharedMockOnly_('data/database.json')) throw new Error('mock_path_bank');
  if (sharedMockOnly_('data/database-hkeaa.json')) throw new Error('mock_path_hkeaa');
  if (!sharedMockOnly_('data/database-aristo.json')) throw new Error('mock_path_aristo');
  if (sharedMockOnly_('papers/past-papers/file.pdf')) throw new Error('mock_path_past');
}

function selfTestPromptShape() {
  var sample = packReferences_([
    { id: 'SAMPLE-1', question: '測試題幹', explanation: '測試答案A', questionType: 'MC', concepts: '機會成本' }
  ], 5, 80000);
  var built = buildPrompt_(sample.questions, 1, false, sanitizeInstruction_(''));
  selfTestGitPaths();
  if (built.indexOf(POE_INSTRUCTION_) !== 0) throw new Error('instruction_mismatch');
  if (built.indexOf('測試題幹') === -1) throw new Error('missing_reference');
  if (built.indexOf('答案：') === -1 || built.indexOf('測試答案A') === -1) throw new Error('missing_reference_answer');
  if (built.indexOf('每題含題幹與答案') === -1) throw new Error('filter_prompt_frame');
  var aliasPacked = packReferences_([
    { id: 'SAMPLE-2', question: '別名題幹', answer: '別名答案' }
  ], 5, 80000);
  if (!aliasPacked.questions.length || aliasPacked.questions[0].explanation !== '別名答案') {
    throw new Error('pack_answer_alias');
  }
  var custom = '請只出一題選擇題。';
  var customBuilt = buildPrompt_(sample.questions, 1, false, sanitizeInstruction_(custom));
  if (customBuilt.indexOf(custom) !== 0) throw new Error('custom_instruction_unused');
  if (sanitizeInstruction_('   \n  ') !== POE_INSTRUCTION_) throw new Error('empty_instruction_fallback');
  if (sanitizeInstruction_(null) !== POE_INSTRUCTION_) throw new Error('missing_instruction_fallback');
  var huge = '';
  while (huge.length < POE_INSTRUCTION_MAX_ + 50) huge += '題目指示';
  var clipped = sanitizeInstruction_(huge);
  if (clipped.length > POE_INSTRUCTION_MAX_) throw new Error('instruction_cap');
  if (clipped === POE_INSTRUCTION_) throw new Error('instruction_cap_fell_back');
  var meta = instructionMeta_(huge);
  if (meta.providedChars !== huge.length) throw new Error('instruction_length_meta');
  if (String(meta.text).length > POE_INSTRUCTION_MAX_) throw new Error('instruction_meta_text');
  selfTestRoleRights();
  var listed = parseList_('aa bb\tcc,dd;ee\nff\rgg  ,  hh');
  if (listed.join('|') !== 'aa|bb|cc|dd|ee|ff|gg|hh') throw new Error('parse_list_separators');
  if (parseList_('  , ;\n\t').length !== 0) throw new Error('parse_list_empty');
  if (referenceSource_('paste') !== 'paste') throw new Error('source_paste');
  if (referenceSource_('filter') !== 'filter') throw new Error('source_filter');
  if (referenceSource_('other') !== 'filter') throw new Error('source_other');
  if (referenceSource_(null) !== 'filter') throw new Error('source_empty');
  if (referenceSource_('single') !== 'single') throw new Error('source_single');
  var singleBuilt = buildPrompt_(sample.questions, 1, false, sanitizeInstruction_(''), 'single');
  if (singleBuilt.indexOf('測試題幹') === -1 || singleBuilt.indexOf('測試答案A') === -1) throw new Error('single_missing_qa');
  if (singleBuilt.indexOf('只附上使用者指定的一題') === -1) throw new Error('single_prompt_frame');
  if (singleBuilt.indexOf('答案：') === -1) throw new Error('single_answer_label');
  if (resolveModel_('GPT-6.1-Sol', 'poe') !== 'GPT-6.1-Sol') throw new Error('model_allow');
  if (resolveModel_('  Gemini-3.8-Flash ', 'poe') !== 'Gemini-3.8-Flash') throw new Error('model_trim');
  if (resolveModel_('Claude-Sonnet-4.6', 'poe') !== 'Claude-Sonnet-4.6') throw new Error('model_custom_allow');
  if (resolveModel_('bad model!!', 'poe') !== POE_DEFAULT_MODEL_) throw new Error('model_reject');
  var emptyModel = resolveModel_('', 'poe');
  var propertyModel = String(props_().getProperty('POE_MODEL') || '').trim();
  var expectedEmpty = isAllowedModel_(propertyModel) ? propertyModel : POE_DEFAULT_MODEL_;
  if (emptyModel !== expectedEmpty) throw new Error('model_empty_fallback');
  if (resolveProvider_({ provider: 'openrouter' }) !== 'openrouter') throw new Error('provider_openrouter');
  if (resolveProvider_({ provider: 'poe' }) !== 'poe') throw new Error('provider_poe');
  if (resolveProvider_({}) !== 'poe') throw new Error('provider_default');
  if (resolveModel_('openai/gpt-4o-mini', 'openrouter') !== 'openai/gpt-4o-mini') throw new Error('or_model_allow');
  if (resolveModel_('bad model!!', 'openrouter') !== OPENROUTER_DEFAULT_MODEL_) throw new Error('or_model_reject');
  var orEmpty = resolveModel_('', 'openrouter');
  var orProp = String(props_().getProperty('OPENROUTER_MODEL') || '').trim();
  var orExpected = isAllowedOpenRouterModel_(orProp) ? orProp : OPENROUTER_DEFAULT_MODEL_;
  if (orEmpty !== orExpected) throw new Error('or_model_empty_fallback');
  if (resolveModeId_('add-novelty') !== 'add-novelty') throw new Error('mode_allow');
  if (resolveModeId_('nope') !== '') throw new Error('mode_reject');
  if (modeName_('vary-examples') !== '改例子／數字') throw new Error('mode_name');
  if (modeName_('style-continue') !== '風格延續・求新') throw new Error('mode_default_name');
  var fitted = fitSheetText_('題目回覆超過上限', 4);
  if (!fitted.truncated || fitted.text.length > 4) throw new Error('fit_sheet');
  if (fitSheetText_('正常', 10).truncated) throw new Error('fit_sheet_short');
  if (!testReplyOk_('正常')) throw new Error('test_reply_plain');
  if (!testReplyOk_(' 正常。 ')) throw new Error('test_reply_punct');
  if (testReplyOk_('未能連線')) throw new Error('test_reply_wrong');
  selfTestAiBackupPaging_();
  console.log('selfTestPromptShape ok');
}


// === Shared asset upload (diagrams / originals) + AI image describe ===

var SHARED_UPLOAD_MAX_BYTES_ = 800000; // under GitHub Contents ~1MB and AS practical POST size
var DESCRIBE_IMAGE_MAX_BYTES_ = 900000;
var DESCRIBE_IMAGE_SYSTEM_PROMPT_ =
  '你是香港經濟科試題資料庫助手。根據附上的圖（通常是題目內嵌圖或原題截圖），'
  + '用繁體中文寫一段簡短描述（約 40–120 字），適合放進備註、alt 文字或分類提示。'
  + '說明圖的類型（例如供需圖、生產可能線、表格截圖）與可見的關鍵標示／軸／曲線，'
  + '不要臆造題幹沒有顯示的數字或結論。只輸出描述正文，不要標題或 markdown。';

function sharedUploadRelOk_(rel) {
  var path = String(rel || '');
  if (!githubSharedRelOk_(path)) return false;
  if (path.indexOf('diagrams/') === 0) return true;
  if (path.indexOf('originals/') === 0) return true;
  return false;
}

function cleanBase64Payload_(raw) {
  var text = String(raw || '').trim();
  // Allow data URLs from the browser file reader.
  var dataUrl = /^data:([a-z0-9.+\/-]+);base64,(.+)$/i.exec(text);
  if (dataUrl) text = dataUrl[2];
  text = text.replace(/\s+/g, '');
  if (!text || !/^[A-Za-z0-9+/=]+$/.test(text)) return '';
  return text;
}

function base64ByteLength_(b64) {
  var cleaned = String(b64 || '').replace(/=+$/, '');
  return Math.floor(cleaned.length * 0.75);
}

function sanitizeSharedUploadFileName_(name) {
  var file = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  file = file.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, '-');
  if (file.length > 120) {
    var dot = file.lastIndexOf('.');
    var ext = dot > 0 ? file.slice(dot) : '';
    file = file.slice(0, Math.max(1, 120 - ext.length)) + ext;
  }
  return file;
}

function guessImageMime_(pathOrName, fallback) {
  var file = String(pathOrName || '').toLowerCase();
  if (/\.jpe?g$/.test(file)) return 'image/jpeg';
  if (/\.png$/.test(file)) return 'image/png';
  if (/\.gif$/.test(file)) return 'image/gif';
  if (/\.webp$/.test(file)) return 'image/webp';
  if (/\.svg$/.test(file)) return 'image/svg+xml';
  var fb = String(fallback || '').trim().toLowerCase();
  if (/^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/.test(fb)) {
    return fb === 'image/jpg' ? 'image/jpeg' : fb;
  }
  return 'application/octet-stream';
}

// Write raw file bytes (already base64) via Contents API. Does not UTF-8-re-encode.
function githubWriteBase64Content_(cfg, path, base64Content, message) {
  if (!githubPathOk_(path)) throw gitFail_('github_error');
  var b64 = cleanBase64Payload_(base64Content);
  if (!b64) throw gitFail_('bad_request');
  var bytes = base64ByteLength_(b64);
  if (bytes <= 0) throw gitFail_('bad_request');
  if (bytes > GITHUB_CONTENTS_MAX_BYTES_) throw gitFail_('payload_too_large');
  var api = githubContentsApi_(cfg, path);
  var existing = githubFetch_(cfg, 'get', api + '?ref=' + encodeURIComponent(cfg.branch), null);
  if (isGithubTooLarge_(existing)) throw gitFail_('payload_too_large');
  var sha = '';
  if (existing.status === 200) {
    if (!existing.body || existing.body.type === 'dir' || Array.isArray(existing.body)) throw gitFail_('github_error');
    sha = existing.body.sha ? String(existing.body.sha) : '';
  } else if (existing.status !== 404) {
    throw gitFail_('github_error');
  }
  var payload = {
    message: clip_(message, 200) || 'Upload shared asset',
    content: b64,
    branch: cfg.branch
  };
  if (sha) payload.sha = sha;
  var put = githubFetch_(cfg, 'put', api, payload);
  if (isGithubConflict_(put)) throw gitFail_('github_conflict');
  if (put.status < 200 || put.status >= 300) throw gitFail_('github_error');
  var newSha = put.body && put.body.content && put.body.content.sha
    ? put.body.content.sha
    : (put.body && put.body.commit && put.body.commit.sha);
  return { sha: sanitizeSha_(newSha), path: path, bytes: bytes };
}

// githubSync: upload one file under shared/diagrams/ or shared/originals/.
// Body: { username, path?: 'diagrams/…', fileName?, folder?: 'diagrams'|'originals', contentBase64, message? }
function handleUploadSharedAsset_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).githubSync) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg) || !githubSharedReady_(cfg)) return gitClientError_('github_not_configured');

  var b64 = cleanBase64Payload_(body && (body.contentBase64 || body.content || body.base64));
  if (!b64) return gitClientError_('bad_request');
  var bytes = base64ByteLength_(b64);
  if (bytes <= 0 || bytes > SHARED_UPLOAD_MAX_BYTES_) return gitClientError_('payload_too_large');

  var rel = String(body.path || '').trim();
  if (!rel) {
    var folder = String(body.folder || 'diagrams').trim().replace(/^\/+|\/+$/g, '');
    if (folder !== 'diagrams' && folder !== 'originals') folder = 'diagrams';
    var fileName = sanitizeSharedUploadFileName_(body.fileName || body.name || '');
    if (!fileName) {
      var tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
      var stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
      fileName = 'upload-' + stamp + '.jpg';
    }
    rel = folder + '/' + fileName;
  }
  if (!sharedUploadRelOk_(rel)) return gitClientError_('bad_request');
  var fullPath = githubSharedFilePath_(cfg, rel);
  if (!fullPath) return gitClientError_('github_error');

  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(20000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var written;
    try {
      written = githubWriteBase64Content_(
        cfg,
        fullPath,
        b64,
        String(body.message || '').trim() || ('Upload shared asset ' + rel + ' by ' + username)
      );
    } catch (writeErr) {
      if (writeErr && writeErr.code === 'github_conflict') {
        // One retry after conflict (sha race).
        written = githubWriteBase64Content_(
          cfg,
          fullPath,
          b64,
          String(body.message || '').trim() || ('Upload shared asset ' + rel + ' by ' + username)
        );
      } else {
        throw writeErr;
      }
    }
    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'uploadSharedAsset',
      success: true,
      metadata: { path: rel, bytes: bytes, sha: written.sha || '' }
    }, true);
    return gitOk_({
      path: rel,
      fullPath: fullPath,
      sha: written.sha,
      bytes: bytes,
      mediaType: guessImageMime_(rel, body.mediaType || body.mimeType)
    });
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code !== 'payload_too_large' && code !== 'bad_request' && code !== 'rate_limited') {
      code = 'github_error';
    }
    writeLog_({
      username: username,
      action: 'uploadSharedAsset',
      success: false,
      metadata: { error: code, path: rel, detail: clip_(err && err.message, 120) }
    }, true);
    return gitClientError_(code);
  }
}

// ai: multimodal describe for alt / remarks / classification hints.
// Body: { username, imageBase64|contentBase64, mimeType?, hint?, model?, provider?, poeApiKey?, openRouterApiKey? }
function handleDescribeImage_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) {
    return { ok: false, error: 'feature_unavailable' };
  }
  var provider = resolveProvider_(body);
  var apiKey = resolveApiKey_(body, username, provider);
  if (!apiKey) return { ok: false, error: 'missing_api_key' };

  var b64 = cleanBase64Payload_(body && (body.imageBase64 || body.contentBase64 || body.base64 || body.content));
  if (!b64) return { ok: false, error: 'bad_request' };
  var bytes = base64ByteLength_(b64);
  if (bytes <= 0 || bytes > DESCRIBE_IMAGE_MAX_BYTES_) return { ok: false, error: 'payload_too_large' };

  var mime = guessImageMime_(body.fileName || body.path || '', body.mimeType || body.mediaType || 'image/jpeg');
  if (mime.indexOf('image/') !== 0) mime = 'image/jpeg';
  var hint = clipChars_(String(body.hint || body.prompt || '').trim(), 500);

  var dailyLimit = nonNegativeInt_(props_().getProperty('POE_DAILY_LIMIT'), 40);
  if (dailyLimit > 0 && countTodayGenerations_(username) >= dailyLimit) {
    return { ok: false, error: 'rate_limited' };
  }
  var intervalSeconds = nonNegativeInt_(props_().getProperty('POE_MIN_INTERVAL_SECONDS'), 20);
  if (!takeIntervalSlot_(username, intervalSeconds)) {
    return { ok: false, error: 'rate_limited' };
  }

  var model = resolveModel_(body.model, provider);
  var userText = '請描述這張圖，供經濟科題庫備註／alt／分類參考。';
  if (hint) userText += '\n補充說明：' + hint;
  var dataUrl = 'data:' + mime + ';base64,' + b64;
  var messages = [
    { role: 'system', content: DESCRIBE_IMAGE_SYSTEM_PROMPT_ },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ];

  var started = Date.now();
  try {
    var completion = requestCompletionMessages_(apiKey, model, messages, provider);
    var durationMs = Date.now() - started;
    var description = String(completion.content || '').trim();
    if (!description) {
      releaseIntervalSlot_(username);
      return { ok: false, error: 'empty_response' };
    }
    // Cap client-facing description.
    description = clipChars_(description, 800);
    writeLog_({
      username: username,
      action: 'describeImage',
      success: true,
      metadata: {
        model: completion.model || model,
        provider: provider,
        durationMs: durationMs,
        bytes: bytes,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens
      }
    }, true);
    // Count toward daily usage like other AI actions when sheet helper exists.
    try {
      if (typeof recordGenerationRow_ === 'function') {
        recordGenerationRow_({
          username: username,
          action: 'describeImage',
          model: completion.model || model,
          provider: provider,
          durationMs: durationMs,
          success: true
        });
      }
    } catch (ignoreRow) {}
    return {
      ok: true,
      description: description,
      model: completion.model || model,
      provider: provider,
      durationMs: durationMs
    };
  } catch (err) {
    releaseIntervalSlot_(username);
    safeLog_(err);
    var fail = upstreamFailurePayload_(err);
    writeLog_({
      username: username,
      action: 'describeImage',
      success: false,
      metadata: mergeUpstreamFailureMeta_({
        model: model,
        provider: provider,
        detail: clip_(err && err.message, 120)
      }, err)
    }, true);
    return fail;
  }
}

// === Admin shared-bank Git sync (server GITHUB_TOKEN) ===

// GitHub identity stays in Script properties. Callers are checked for githubSync first.
// Files that fit the Contents API are written with that API. Larger question
// banks use the Git Data API (blob, tree, commit, ref), which the same
// fine-grained Contents permission allows. Neither path is called from the browser.
var GITHUB_CONTENTS_MAX_BYTES_ = 900000;
var GITHUB_DATA_MAX_BYTES_ = 12000000;
var GITHUB_MAX_QUESTIONS_ = 20000;
var GITHUB_REPLY_MAX_CHARS_ = 1000000;
// One shared file returned to the browser. Covers the question bank and
// images. Larger paper files are listed but not streamed.
var SHARED_FETCH_MAX_BYTES_ = 9000000;
var SHARED_LIST_MAX_ = 8000;
var SHARED_READS_PER_MINUTE_ = 120;
// Page size for listAiBackups and listAiUsageRecords (matches client HISTORY_LIMIT).
// Newest first. A request cannot raise this cap or name another user's folder.
var AI_BACKUP_LIST_MAX_ = 30;
// Keep generateQuestions / list JSON under the Apps Script googleusercontent
// echo path. Larger replies are stored in the Git backup and returned lean;
// the browser loads the full text with getAiBackup (optionally chunked).
var CONTENT_SERVICE_INLINE_MAX_CHARS_ = 48000;
var AI_BACKUP_LIST_PREVIEW_CHARS_ = 180;
var AI_BACKUP_CONTENT_CHUNK_CHARS_ = 40000;

// Personal AI backup folders an admin may read via listAiUsageRecords.
// Not a role allowlist. Callers still need ALLOWED_ADMIN_HASHES.
// The request cannot add, remove, or rename these folders.
var AI_USAGE_RECORD_USERS_ = ['ryan', 'user57'];

// Allowlisted relative bank paths for Phase 3 multi-file syncDataUpload.
// Joined with GITHUB_SHARED_PREFIX → shared/data/database*.json.
var GITHUB_UPLOAD_ALLOWLIST_RELS_ = {
  'data/database.json': true,
  'data/database-hkeaa.json': true,
  'data/database-aristo.json': true
};

function githubResolveUploadBankPath_(cfg, relPath) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  var rel = String(relPath || '').replace(/^\/+|\/+$/g, '');
  if (!rel || !GITHUB_UPLOAD_ALLOWLIST_RELS_[rel]) return '';
  if (!githubPathOk_(rel)) return '';
  var full = joinGithubPath_(prefix, rel);
  if (!full || full === 'users' || full.indexOf('users/') === 0) return '';
  if (!githubPathOk_(full)) return '';
  return full;
}

function isShardRelPath_(rel) {
  return rel === 'data/database-hkeaa.json' || rel === 'data/database-aristo.json';
}

function readCloudBankOrNull_(cfg, fullPath) {
  if (!fullPath) return null;
  try {
    var existing = githubReadText_(cfg, fullPath);
    try {
      return JSON.parse(existing && existing.text);
    } catch (ignoreParse) {
      return null;
    }
  } catch (readErr) {
    if (readErr && readErr.code === 'github_not_found') return null;
    throw readErr;
  }
}

// Prepare one allowlisted bank file for write. Enforces schema gate, validation,
// and empty-shard safety (never overwrite a non-empty cloud shard with 0 questions
// unless body.confirmEmptyWipe === true).
function prepareUploadFileWrite_(cfg, relPath, payload, confirmEmptyWipe) {
  var fullPath = githubResolveUploadBankPath_(cfg, relPath);
  if (!fullPath) {
    throw gitFail_('bad_request', null, { message: 'Upload path not allowlisted: ' + relPath });
  }
  var clientSchemaVersion = readBankSchemaVersion_(payload);
  var cloudData = readCloudBankOrNull_(cfg, fullPath);
  var cloudSchemaVersion = readBankSchemaVersion_(cloudData);
  if (clientSchemaVersion < cloudSchemaVersion) {
    var stale = gitFail_('schema_version_stale');
    stale.clientSchemaVersion = clientSchemaVersion;
    stale.cloudSchemaVersion = cloudSchemaVersion;
    throw stale;
  }
  var text;
  try {
    text = questionPayloadText_(payload, cloudData);
  } catch (err) {
    throw err;
  }
  var bytes = utf8Length_(text);
  if (bytes > GITHUB_DATA_MAX_BYTES_) throw gitFail_('payload_too_large');
  var writtenPayload;
  try {
    writtenPayload = JSON.parse(text);
  } catch (ignore) {
    throw gitFail_('bad_request');
  }
  var count = writtenPayload && typeof writtenPayload.questionCount === 'number'
    ? writtenPayload.questionCount
    : 0;
  // Safety: refuse empty shard overwrite of existing non-empty cloud shard.
  if (isShardRelPath_(relPath) && count === 0) {
    var cloudCount = 0;
    if (cloudData && Array.isArray(cloudData.questions)) cloudCount = cloudData.questions.length;
    else if (cloudData && typeof cloudData.questionCount === 'number') cloudCount = cloudData.questionCount;
    if (cloudCount > 0 && confirmEmptyWipe !== true) {
      throw gitFail_('empty_shard_refused', null, {
        message: 'Refuse empty overwrite of ' + relPath + ' (cloud has ' + cloudCount
          + ' questions). Pass confirmEmptyWipe to wipe.'
      });
    }
  }
  return {
    relPath: relPath,
    fullPath: fullPath,
    text: text,
    bytes: bytes,
    count: count,
    schemaVersion: readBankSchemaVersion_(writtenPayload)
  };
}

// Shared question-bank upload for githubSync users (Phase 3 dirty-shard).
// body.files: [{ path: 'data/database-hkeaa.json', data: {...} }, ...] under lock.
// Legacy body.data: writes combined GITHUB_DATA_PATH only (backward compatible).
// Schema gate per file written. Empty shard overwrite refused unless confirmEmptyWipe.
function handleGitUpload_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).githubSync) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');

  var confirmEmptyWipe = body && (body.confirmEmptyWipe === true
    || body.confirmEmptyWipe === 'true'
    || body.confirmEmptyWipe === 1);

  var fileSpecs = [];
  if (body && Array.isArray(body.files) && body.files.length) {
    for (var fi = 0; fi < body.files.length; fi++) {
      var spec = body.files[fi];
      if (!spec || typeof spec !== 'object') {
        releaseGitSlot_(username);
        return gitClientError_('bad_request');
      }
      fileSpecs.push({
        path: String(spec.path || '').replace(/^\/+|\/+$/g, ''),
        data: coerceJson_(spec.data)
      });
    }
  } else {
    // Legacy single combined write.
    var dataPathRel = String(cfg.dataPath || '').replace(/^\/+|\/+$/g, '');
    // Normalize to allowlisted relative form.
    if (dataPathRel === 'shared/data/database.json') dataPathRel = 'data/database.json';
    if (!dataPathRel) dataPathRel = 'data/database.json';
    fileSpecs.push({
      path: dataPathRel.indexOf('data/') === 0 ? dataPathRel : 'data/database.json',
      data: coerceJson_(body && body.data)
    });
  }
  if (!fileSpecs.length) {
    releaseGitSlot_(username);
    return gitClientError_('bad_request');
  }
  // Cap files (combined + 2 shards).
  if (fileSpecs.length > 3) {
    releaseGitSlot_(username);
    return gitClientError_('bad_request');
  }

  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(30000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;

    var prepared = [];
    for (var i = 0; i < fileSpecs.length; i++) {
      prepared.push(prepareUploadFileWrite_(
        cfg,
        fileSpecs[i].path,
        fileSpecs[i].data,
        confirmEmptyWipe
      ));
    }

    var writtenList = [];
    var maxSchema = 0;
    var totalBytes = 0;
    var lastSha = '';
    var lastPath = '';
    for (var w = 0; w < prepared.length; w++) {
      var item = prepared[w];
      var label = item.relPath.indexOf('hkeaa') !== -1
        ? 'hkeaa'
        : (item.relPath.indexOf('aristo') !== -1 ? 'aristo' : 'combined');
      var written = githubWriteText_(
        cfg,
        item.fullPath,
        item.text,
        'Update question data [' + label + '] (' + item.count + ')'
      );
      writtenList.push({
        path: item.fullPath,
        relPath: item.relPath,
        sha: written.sha,
        questionCount: item.count,
        schemaVersion: item.schemaVersion,
        bytes: item.bytes
      });
      totalBytes += item.bytes;
      if (item.schemaVersion > maxSchema) maxSchema = item.schemaVersion;
      lastSha = written.sha;
      lastPath = item.fullPath;
    }

    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'syncDataUpload',
      success: true,
      metadata: {
        files: writtenList.map(function (row) { return row.relPath; }),
        questionCount: writtenList.length ? writtenList[writtenList.length - 1].questionCount : 0,
        bytes: totalBytes,
        schemaVersion: maxSchema
      }
    }, true);
    var ok = gitOk_({
      sha: lastSha,
      path: lastPath,
      schemaVersion: maxSchema
    });
    ok.written = writtenList;
    return ok;
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code ? err.code : 'github_error';
    if (code === 'schema_version_stale') {
      writeLog_({
        username: username,
        action: 'syncDataUpload',
        success: false,
        metadata: {
          error: 'schema_version_stale',
          clientSchemaVersion: err.clientSchemaVersion,
          cloudSchemaVersion: err.cloudSchemaVersion
        }
      }, true);
      return gitClientError_('schema_version_stale', {
        clientSchemaVersion: err.clientSchemaVersion,
        cloudSchemaVersion: err.cloudSchemaVersion
      });
    }
    if (code === 'validation_failed') {
      writeLog_({
        username: username,
        action: 'syncDataUpload',
        success: false,
        metadata: {
          error: 'validation_failed',
          failingCount: err.failingCount || 0,
          detail: clip_(err.clientMessage || '', 120)
        }
      }, true);
      return gitClientError_('validation_failed', {
        message: err.clientMessage || '',
        failingIds: err.failingIds || [],
        failingCount: err.failingCount
      });
    }
    if (code === 'empty_shard_refused') {
      writeLog_({
        username: username,
        action: 'syncDataUpload',
        success: false,
        metadata: { error: 'empty_shard_refused', detail: clip_(err.clientMessage || '', 120) }
      }, true);
      return gitClientError_('empty_shard_refused', { message: err.clientMessage || '' });
    }
    if (code === 'payload_too_large') {
      return gitClientError_('payload_too_large');
    }
    if (code === 'bad_request') {
      return gitClientError_('bad_request', { message: err.clientMessage || '' });
    }
    writeLog_({
      username: username,
      action: 'syncDataUpload',
      success: false,
      metadata: { error: 'github_error', detail: clip_(err && err.message, 120) }
    }, true);
    return gitClientError_('github_error');
  }
}

// Shared question-bank download for githubSync users (Apps Script body path).
// D2 shards-only download: mockTests merges hkeaa+aristo; otherwise HKEAA only.
// Missing / unreadable shard → error (no silent combined database.json fallback).
function handleGitDownload_(body) {
  var username = normalizeUsername_(body.username);
  var rights = username ? lookupRights_(username) : null;
  if (!username || !rights || !rights.githubSync) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var hkeaaPath = githubSharedBankShardPath_(cfg, 'hkeaa');
  if (!hkeaaPath) return gitClientError_('github_error');
  try {
    var hkeaa = tryReadBankFile_(cfg, hkeaaPath);
    if (!hkeaa || !hkeaa.bank || !Array.isArray(hkeaa.bank.questions)) {
      writeLog_({
        username: username,
        action: 'syncDataDownload',
        success: false,
        metadata: { error: 'github_not_found', shard: 'hkeaa' }
      }, true);
      return gitClientError_('github_not_found');
    }
    var parsed;
    var sha;
    var pathMeta;
    var bytesApprox = 0;
    if (rights.mockTests === true) {
      var aristoPath = githubSharedBankShardPath_(cfg, 'aristo');
      if (!aristoPath) return gitClientError_('github_error');
      var aristo = tryReadBankFile_(cfg, aristoPath);
      if (!aristo || !aristo.bank || !Array.isArray(aristo.bank.questions)) {
        writeLog_({
          username: username,
          action: 'syncDataDownload',
          success: false,
          metadata: { error: 'github_not_found', shard: 'aristo' }
        }, true);
        return gitClientError_('github_not_found');
      }
      var questions = hkeaa.bank.questions.concat(aristo.bank.questions);
      parsed = {};
      var baseKeys = Object.keys(hkeaa.bank);
      for (var bi = 0; bi < baseKeys.length; bi++) {
        var bk = baseKeys[bi];
        if (bk === 'questions' || bk === 'questionCount') continue;
        parsed[bk] = hkeaa.bank[bk];
      }
      parsed.questions = questions;
      parsed.questionCount = questions.length;
      parsed.schemaVersion = Math.max(
        readBankSchemaVersion_(hkeaa.bank),
        readBankSchemaVersion_(aristo.bank)
      );
      sha = hkeaa.sha || aristo.sha || '';
      pathMeta = 'data/database-hkeaa.json+data/database-aristo.json';
      bytesApprox = JSON.stringify(parsed).length;
    } else {
      parsed = hkeaa.bank;
      sha = hkeaa.sha || '';
      pathMeta = 'data/database-hkeaa.json';
      bytesApprox = JSON.stringify(parsed).length;
    }
    if (!parsed || typeof parsed !== 'object') return gitClientError_('github_error');
    writeLog_({
      username: username,
      action: 'syncDataDownload',
      success: true,
      metadata: {
        bytes: bytesApprox,
        schemaVersion: readBankSchemaVersion_(parsed),
        shards: pathMeta
      }
    }, true);
    return gitOk_({
      sha: sha,
      path: pathMeta,
      data: parsed,
      schemaVersion: readBankSchemaVersion_(parsed)
    });
  } catch (err) {
    safeLog_(err);
    var code = err && err.code ? err.code : 'github_error';
    writeLog_({
      username: username,
      action: 'syncDataDownload',
      success: false,
      metadata: { error: code === 'github_not_found' ? 'github_not_found' : 'github_error' }
    }, true);
    return gitClientError_(code);
  }
}

// === Data-checks sync (ken + githubSync only) ===

// Fixed shared path for ken's data-checks panel (not the question bank).
var DATA_CHECKS_REL_PATH_ = 'data/data-checks.json';
var DATA_CHECKS_USERNAME_ = 'ken';
var DATA_CHECKS_MAX_BYTES_ = 500000;

function githubSharedDataChecksPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  return joinGithubPath_(prefix, DATA_CHECKS_REL_PATH_);
}

function canUseDataChecksSync_(username) {
  var name = normalizeUsername_(username);
  if (!name || name !== DATA_CHECKS_USERNAME_) return false;
  return lookupRights_(name).githubSync === true;
}

function dataChecksPayloadText_(raw) {
  var data = coerceJson_(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    var bad = new Error('bad_request');
    bad.code = 'bad_request';
    throw bad;
  }
  var list = Array.isArray(data.checks) ? data.checks : null;
  if (!list) {
    var badList = new Error('bad_request');
    badList.code = 'bad_request';
    throw badList;
  }
  if (list.length > 500) {
    var tooMany = new Error('bad_request');
    tooMany.code = 'bad_request';
    throw tooMany;
  }
  var out = {
    version: typeof data.version === 'number' ? data.version : 1,
    checks: list
  };
  return JSON.stringify(out);
}

// Upload shared/data/data-checks.json.
function handleDataChecksUpload_(body) {
  var username = normalizeUsername_(body.username);
  if (!canUseDataChecksSync_(username)) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var text;
  try {
    text = dataChecksPayloadText_(body && body.data);
  } catch (err) {
    return gitClientError_(err && err.code ? err.code : 'bad_request');
  }
  var bytes = utf8Length_(text);
  if (bytes > DATA_CHECKS_MAX_BYTES_) return gitClientError_('payload_too_large');
  var dataPath = githubSharedDataChecksPath_(cfg);
  if (!dataPath) return gitClientError_('github_error');
  if (!takeGitSlot_(username, 8)) return gitClientError_('rate_limited');
  var lock = LockService.getScriptLock();
  var held = false;
  try {
    if (!lock.tryLock(20000)) {
      releaseGitSlot_(username);
      return gitClientError_('rate_limited');
    }
    held = true;
    var count = 0;
    try { count = JSON.parse(text).checks.length; } catch (ignore) { count = 0; }
    var written = githubWriteText_(cfg, dataPath, text, 'Update data-checks (' + count + ')');
    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'syncDataChecksUpload',
      success: true,
      metadata: { checkCount: count, bytes: bytes }
    }, true);
    return gitOk_({ sha: written.sha, path: dataPath });
  } catch (err) {
    if (held) {
      try { lock.releaseLock(); } catch (ignore) {}
      held = false;
    }
    safeLog_(err);
    releaseGitSlot_(username);
    var code = err && err.code === 'payload_too_large' ? 'payload_too_large' : 'github_error';
    writeLog_({
      username: username,
      action: 'syncDataChecksUpload',
      success: false,
      metadata: { error: code, detail: clip_(err && err.message, 120) }
    }, true);
    return gitClientError_(code);
  }
}

// Download shared/data/data-checks.json (Apps Script body fallback).
function handleDataChecksDownload_(body) {
  var username = normalizeUsername_(body.username);
  if (!canUseDataChecksSync_(username)) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var dataPath = githubSharedDataChecksPath_(cfg);
  if (!dataPath) return gitClientError_('github_error');
  try {
    var read = githubReadText_(cfg, dataPath);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      return gitClientError_('github_error');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.checks)) {
      return gitClientError_('github_error');
    }
    writeLog_({
      username: username,
      action: 'syncDataChecksDownload',
      success: true,
      metadata: { bytes: String(read.text || '').length, checkCount: parsed.checks.length }
    }, true);
    return gitOk_({ sha: read.sha, path: dataPath, data: parsed });
  } catch (err) {
    safeLog_(err);
    var code = err && err.code ? err.code : 'github_error';
    writeLog_({
      username: username,
      action: 'syncDataChecksDownload',
      success: false,
      metadata: { error: code === 'github_not_found' ? 'github_not_found' : 'github_error' }
    }, true);
    return gitClientError_(code);
  }
}

// === Direct browser read (issueSharedReadToken / GitHub App / read PAT) ===

// Short-lived read-only credential for known users. Never returns GITHUB_TOKEN.
function handleIssueSharedReadToken_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubDirectReadReady_(cfg)) return gitClientError_('github_not_configured');
  var issued = null;
  try {
    issued = issueGithubDirectReadCredential_(cfg);
  } catch (err) {
    safeLog_(err);
    var failCode = err && err.code ? err.code : 'github_error';
    var meta = { error: failCode };
    if (err && typeof err.httpStatus === 'number') meta.httpStatus = err.httpStatus;
    writeLog_({
      username: username,
      action: 'issueSharedReadToken',
      success: false,
      metadata: meta
    }, true);
    console.error('issueSharedReadToken failed: ' + failCode
      + (meta.httpStatus ? (' http_' + meta.httpStatus) : ''));
    return gitClientError_(failCode);
  }
  if (!issued || !issued.token) return gitClientError_('github_not_configured');
  writeLog_({
    username: username,
    action: 'issueSharedReadToken',
    success: true,
    metadata: {
      tokenType: issued.tokenType,
      expiresAt: issued.expiresAt || ''
    }
  }, false);
  return {
    ok: true,
    token: issued.token,
    tokenType: issued.tokenType,
    expiresAt: issued.expiresAt,
    expiresAtMs: issued.expiresAtMs,
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    sharedPrefix: githubSharedPrefix_(cfg),
    apiBase: 'https://api.github.com',
    mockTests: rights.mockTests === true,
    canReadDataChecks: canUseDataChecksSync_(username) === true
  };
}

// === Shared asset proxy fallback (fetchSharedAsset / listSharedData) ===

// Return one shared file body through ContentService (fallback when direct read fails).
function handleFetchShared_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubSharedReady_(cfg)) return gitClientError_('github_not_configured');
  var rel = String(body.path || '').trim();
  var full = githubSharedFilePath_(cfg, rel);
  if (!full) return gitClientError_('bad_request');
  // data-checks.json is ken/admin only (same gate as syncDataChecks*).
  if (rel === DATA_CHECKS_REL_PATH_ && !canUseDataChecksSync_(username)) {
    return gitClientError_('feature_unavailable');
  }
  if (!rights.mockTests && sharedMockOnly_(rel)) return gitClientError_('feature_unavailable');
  var ext = sharedExt_(rel);
  try {
    var read = githubReadBase64_(cfg, full);
    if (!read || read.bytes > SHARED_FETCH_MAX_BYTES_) {
      logSharedRead_(username, 'fetchSharedAsset', false, { error: 'payload_too_large', path: clip_(rel, 180) }, true);
      return gitClientError_('payload_too_large');
    }
    var textExt = sharedTextExt_(ext);
    var content = textExt ? decodeGithubBase64_(read.b64) : read.b64;
    var bytes = read.bytes;
    if (textExt && !rights.mockTests && rel === 'data/database.json') {
      content = stripMockQuestions_(content);
      bytes = utf8Length_(content);
    }
    logSharedRead_(username, 'fetchSharedAsset', true, {
      path: clip_(rel, 180),
      bytes: bytes
    }, textExt);
    return sharedClientOk_({
      path: rel,
      encoding: textExt ? 'utf8' : 'base64',
      mediaType: sharedMediaType_(ext),
      bytes: bytes,
      content: content
    });
  } catch (err) {
    safeLog_(err);
    var code = err && err.code ? err.code : 'github_error';
    logSharedRead_(username, 'fetchSharedAsset', false, {
      error: code === 'github_not_found' || code === 'payload_too_large' || code === 'bad_request' ? code : 'github_error',
      path: clip_(rel, 180)
    }, true);
    return gitClientError_(code);
  }
}

// Directory listing under the shared prefix (Apps Script fallback).
function handleListShared_(body) {
  var username = normalizeUsername_(body.username);
  var rights = lookupRights_(username);
  if (!username || !rights.known) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubSharedReady_(cfg)) return gitClientError_('github_not_configured');
  var rel = String(body.path || '').trim().replace(/\/+$/g, '');
  var full = githubSharedDirPath_(cfg, rel);
  if (!full) return gitClientError_('bad_request');
  var recursive = body.recursive === true;
  try {
    var listed = githubListTree_(cfg, full, recursive);
    var entries = [];
    var truncated = listed.truncated === true;
    for (var i = 0; i < listed.entries.length; i++) {
      if (entries.length >= SHARED_LIST_MAX_) {
        truncated = true;
        break;
      }
      var item = listed.entries[i];
      var name = String(item.path || '');
      if (!name || name.indexOf('..') !== -1) continue;
      var child = rel ? rel + '/' + name : name;
      if (!rights.mockTests && sharedMockOnly_(child)) continue;
      var kind = String(item.type || '');
      if (kind === 'tree') {
        if (!githubSharedDirOk_(child)) continue;
        entries.push({ path: child, type: 'dir', size: 0 });
      } else if (kind === 'blob') {
        if (!githubSharedRelOk_(child)) continue;
        var size = Number(item.size);
        entries.push({
          path: child,
          type: 'file',
          size: isFinite(size) && size >= 0 ? size : 0
        });
      }
    }
    logSharedRead_(username, 'listSharedData', true, {
      path: clip_(rel || '.', 180),
      count: entries.length
    }, true);
    return sharedClientOk_({
      path: rel,
      truncated: truncated,
      entries: entries
    });
  } catch (err) {
    safeLog_(err);
    var code = err && err.code ? err.code : 'github_error';
    logSharedRead_(username, 'listSharedData', false, {
      error: code === 'github_not_found' ? 'github_not_found' : 'github_error',
      path: clip_(rel || '.', 180)
    }, true);
    return gitClientError_(code);
  }
}

// === AI personal backups / admin usage records ===

function aiBackupFileNameOk_(name) {
  var file = String(name || '');
  if (!file || file.indexOf('/') !== -1 || file.indexOf('\\') !== -1) return false;
  if (file.indexOf('..') !== -1 || file === '.' || file === '..') return false;
  if (!/\.json$/i.test(file)) return false;
  return githubPathOk_(file);
}

function aiBackupEmptyOk_() {
  return {
    ok: true,
    backups: [],
    pageSize: AI_BACKUP_LIST_MAX_,
    hasMore: false,
    nextAfter: ''
  };
}

function parseAiBackupJson_(text, name) {
  var parsed = null;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  var action = backupFileAction_(parsed.action);
  var refSource = '';
  if (action === 'generateQuestions') {
    refSource = referenceSource_(parsed.referenceSource || parsed.source);
  }
  var modeId = action === 'generateQuestions' ? resolveModeId_(parsed.modeId) : '';
  var createdAt = String(parsed.createdAt || '').trim();
  if (createdAt.length > 40) createdAt = createdAt.slice(0, 40);
  return {
    name: String(name || ''),
    action: action,
    model: clip_(parsed.model, 120),
    createdAt: createdAt,
    sentCount: numberOrNull_(parsed.sentCount),
    filteredCount: numberOrNull_(parsed.filteredCount),
    durationMs: numberOrNull_(parsed.durationMs),
    source: refSource,
    referenceSource: refSource,
    modeId: modeId,
    modeName: modeId ? modeName_(modeId) : clip_(parsed.modeName, 80),
    instruction: clipChars_(String(parsed.instruction || ''), POE_INSTRUCTION_MAX_),
    requestId: requestId_(parsed.requestId),
    content: clipChars_(String(parsed.content || ''), GITHUB_REPLY_MAX_CHARS_),
    referenceIds: action === 'generateQuestions' ? sanitizeReferenceIds_(parsed.referenceIds) : []
  };
}

function resolveUserAiBackupPath_(cfg, username, name) {
  if (!aiBackupFileNameOk_(name)) return '';
  var dir = githubUserBackupDir_(cfg, username);
  if (!dir) return '';
  return joinGithubPath_(dir, name);
}

function listAiBackupFileNames_(cfg, backupDir) {
  var listed = githubListTree_(cfg, backupDir, false);
  var names = [];
  for (var i = 0; i < listed.entries.length; i++) {
    var item = listed.entries[i];
    if (!item || String(item.type || '') !== 'blob') continue;
    var name = String(item.path || '');
    if (!aiBackupFileNameOk_(name)) continue;
    // Prefer generateQuestions filenames so testModel pings do not fill the cap.
    if (name.indexOf('-generateQuestions-') === -1) continue;
    // Tree entries for a non-recursive dir list are basenames.
    names.push(name);
  }
  names.sort(function (a, b) {
    if (a === b) return 0;
    return a < b ? 1 : -1;
  });
  return names;
}


function backupListStartIndex_(names, afterName) {
  if (!afterName) return 0;
  var i;
  for (i = 0; i < names.length; i++) {
    if (names[i] === afterName) return i + 1;
  }
  for (i = 0; i < names.length; i++) {
    if (names[i] < afterName) return i;
  }
  return names.length;
}

function aiBackupAfterName_(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  var name = String(raw).trim();
  if (!name) return '';
  if (!aiBackupFileNameOk_(name)) return null;
  return name;
}

function usageStartIndex_(rows, afterName, afterUser) {
  if (!afterName) return 0;
  var i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i].name === afterName && rows[i].username === afterUser) return i + 1;
  }
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.name !== afterName) {
      if (row.name < afterName) return i;
    } else if (String(row.username || '') > String(afterUser || '')) {
      return i;
    }
  }
  return rows.length;
}

function selfTestAiBackupPaging_() {
  var names = ['m.json', 'c.json', 'a.json'];
  if (backupListStartIndex_(names, '') !== 0) throw new Error('backup_cursor_blank');
  if (backupListStartIndex_(names, 'm.json') !== 1) throw new Error('backup_cursor_first');
  if (backupListStartIndex_(names, 'c.json') !== 2) throw new Error('backup_cursor_mid');
  if (backupListStartIndex_(names, 'd.json') !== 1) throw new Error('backup_cursor_gap');
  if (backupListStartIndex_(names, 'z.json') !== 0) throw new Error('backup_cursor_newer');
  if (backupListStartIndex_(names, '0.json') !== 3) throw new Error('backup_cursor_older');
  var rows = [
    { name: 'b.json', username: 'ryan' },
    { name: 'b.json', username: 'user57' },
    { name: 'a.json', username: 'ryan' }
  ];
  if (usageStartIndex_(rows, '', '') !== 0) throw new Error('usage_cursor_blank');
  if (usageStartIndex_(rows, 'b.json', 'ryan') !== 1) throw new Error('usage_cursor_ryan');
  if (usageStartIndex_(rows, 'b.json', 'user57') !== 2) throw new Error('usage_cursor_user57');
  if (usageStartIndex_(rows, 'b.json', 's') !== 1) throw new Error('usage_cursor_user_gap');
  if (aiBackupAfterName_('') !== '') throw new Error('after_blank');
  if (aiBackupAfterName_(null) !== '') throw new Error('after_null');
  if (aiBackupAfterName_('../x.json') !== null) throw new Error('after_reject');
  if (aiBackupAfterName_('20260101-000000-generateQuestions-ab.json') !== '20260101-000000-generateQuestions-ab.json') throw new Error('after_ok');
}

function collectGenerateBackups_(cfg, username, limit, afterName) {
  var backups = [];
  var backupDir = githubUserBackupDir_(cfg, username);
  if (!backupDir) return { backups: backups, hasMore: false, nextAfter: '' };
  var names = listAiBackupFileNames_(cfg, backupDir);
  var cap = positiveInt_(limit, AI_BACKUP_LIST_MAX_);
  if (cap > AI_BACKUP_LIST_MAX_) cap = AI_BACKUP_LIST_MAX_;
  var start = backupListStartIndex_(names, afterName || '');
  var hasMore = false;
  for (var i = start; i < names.length; i++) {
    var name = names[i];
    var full = resolveUserAiBackupPath_(cfg, username, name);
    if (!full) continue;
    var read;
    try {
      read = githubReadText_(cfg, full);
    } catch (readErr) {
      if (readErr && readErr.code === 'github_not_found') continue;
      safeLog_(readErr);
      continue;
    }
    var item = parseAiBackupJson_(read && read.text, name);
    if (!item || item.action !== 'generateQuestions') continue;
    if (backups.length < cap) {
      backups.push(leanAiBackupItem_(item));
    } else {
      hasMore = true;
      break;
    }
  }
  var nextAfter = backups.length ? String(backups[backups.length - 1].name || '') : '';
  return { backups: backups, hasMore: hasMore, nextAfter: nextAfter };
}


// One page of the caller's personal generateQuestions backups (lean).
function handleListAiBackups_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return aiBackupEmptyOk_();
  if (!githubUserBackupDir_(cfg, username)) return aiBackupEmptyOk_();
  var afterRaw = '';
  if (body && typeof body.after === 'string') afterRaw = body.after;
  else if (body && typeof body.afterName === 'string') afterRaw = body.afterName;
  var afterName = aiBackupAfterName_(afterRaw);
  if (afterName == null) return gitClientError_('bad_request');
  try {
    var page = collectGenerateBackups_(cfg, username, AI_BACKUP_LIST_MAX_, afterName);
    return {
      ok: true,
      backups: page.backups,
      pageSize: AI_BACKUP_LIST_MAX_,
      hasMore: page.hasMore === true,
      nextAfter: page.nextAfter || ''
    };
  } catch (err) {
    if (err && err.code === 'github_not_found') return aiBackupEmptyOk_();
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}


// Full (optionally chunked) personal backup body; admin may pass owner for usage folders.
function handleGetAiBackup_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return gitClientError_('feature_unavailable');
  var rights = lookupRights_(username);
  if (!rights) return gitClientError_('feature_unavailable');
  var owner = resolveAiBackupOwner_(username, body);
  if (!owner) return gitClientError_('bad_request');
  // Own folder needs ai. Admin usage-record reads of another fixed folder
  // only need admin (same gate as listAiUsageRecords).
  if (owner !== username) {
    if (rights.admin !== true) return gitClientError_('feature_unavailable');
  } else if (!rights.ai) {
    return gitClientError_('feature_unavailable');
  }
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return gitClientError_('github_not_found');
  var name = String(body.name || body.file || '').trim();
  var full = resolveUserAiBackupPath_(cfg, owner, name);
  if (!full) return gitClientError_('bad_request');
  try {
    var read = githubReadText_(cfg, full);
    var item = parseAiBackupJson_(read && read.text, name);
    if (!item) return gitClientError_('github_error');
    var offset = body && body.offset != null ? body.offset : 0;
    var limit = body && body.limit != null ? body.limit : AI_BACKUP_CONTENT_CHUNK_CHARS_;
    var sliced = aiBackupContentSlice_(item.content, offset, limit);
    item.content = sliced.content;
    return {
      ok: true,
      backup: item,
      contentChars: sliced.contentChars,
      contentOffset: sliced.contentOffset,
      contentComplete: sliced.contentComplete === true
    };
  } catch (err) {
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
}

function aiUsageRecordUsers_() {
  var out = [];
  for (var i = 0; i < AI_USAGE_RECORD_USERS_.length; i++) {
    var name = normalizeUsername_(AI_USAGE_RECORD_USERS_[i]);
    if (!name || !githubUserSegment_(name)) continue;
    if (out.indexOf(name) === -1) out.push(name);
  }
  return out;
}

function aiUsageOwnerAllowed_(username) {
  var name = normalizeUsername_(username);
  if (!name) return false;
  var allowed = aiUsageRecordUsers_();
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i] === name) return true;
  }
  return false;
}

function usageRecordFromBackup_(item, owner) {
  if (!item || item.action !== 'generateQuestions') return null;
  var name = normalizeUsername_(owner);
  if (!aiUsageOwnerAllowed_(name)) return null;
  var lean = leanAiBackupItem_(item);
  lean.username = name;
  lean.name = String(item.name || lean.name || '');
  return lean;
}

function usageCursor_(body, requester) {
  if (!body) return { name: '', username: '' };
  var nameRaw = body.afterName;
  var userRaw = body.afterUser;
  if ((nameRaw == null || String(nameRaw).trim() === '') && body.after && typeof body.after === 'object' && !Array.isArray(body.after)) {
    nameRaw = body.after.name;
    userRaw = body.after.username;
  }
  var nameText = nameRaw == null ? '' : String(nameRaw).trim();
  var userText = userRaw == null ? '' : String(userRaw).trim();
  if (!nameText && !userText) return { name: '', username: '' };
  if (typeof nameRaw !== 'string' || typeof userRaw !== 'string') {
    if (!(body.after && typeof body.after === 'object' && !Array.isArray(body.after) && typeof body.after.name === 'string' && typeof body.after.username === 'string')) {
      return null;
    }
  }
  if (!nameText || !aiBackupFileNameOk_(nameText)) return null;
  var user = normalizeUsername_(userText);
  if (!user || !aiUsageOwnerAllowed_(user) || user === requester) return null;
  return { name: nameText, username: user };
}

function listUsageFileRows_(cfg, requester) {
  var owners = aiUsageRecordUsers_();
  var rows = [];
  var hardFail = 0;
  var attempted = 0;
  for (var u = 0; u < owners.length; u++) {
    var owner = owners[u];
    if (!aiUsageOwnerAllowed_(owner) || owner === requester) continue;
    var backupDir = githubUserBackupDir_(cfg, owner);
    if (!backupDir) continue;
    attempted++;
    try {
      var names = listAiBackupFileNames_(cfg, backupDir);
      for (var n = 0; n < names.length; n++) {
        rows.push({ username: owner, name: names[n] });
      }
    } catch (err) {
      if (err && err.code === 'github_not_found') continue;
      safeLog_(err);
      hardFail++;
    }
  }
  rows.sort(function (a, b) {
    var an = String(a.name || '');
    var bn = String(b.name || '');
    if (an !== bn) return an < bn ? 1 : -1;
    var au = String(a.username || '');
    var bu = String(b.username || '');
    if (au === bu) return 0;
    return au < bu ? -1 : 1;
  });
  return { rows: rows, hardFail: hardFail, attempted: attempted };
}

function readUsageRecordAt_(cfg, row) {
  if (!row || !aiUsageOwnerAllowed_(row.username)) return null;
  var full = resolveUserAiBackupPath_(cfg, row.username, row.name);
  if (!full) return null;
  var read = githubReadText_(cfg, full);
  var item = parseAiBackupJson_(read && read.text, row.name);
  return usageRecordFromBackup_(item, row.username);
}

function usagePageOk_(records, hasMore, nextAfter) {
  var safeAfter = null;
  if (nextAfter && nextAfter.name && aiBackupFileNameOk_(nextAfter.name) && aiUsageOwnerAllowed_(nextAfter.username)) {
    safeAfter = {
      name: String(nextAfter.name),
      username: normalizeUsername_(nextAfter.username)
    };
  }
  return {
    ok: true,
    records: records || [],
    pageSize: AI_BACKUP_LIST_MAX_,
    hasMore: hasMore === true,
    nextAfter: safeAfter
  };
}

// Admin-only merged page of fixed folders (ryan / user57), lean records.
function handleListAiUsageRecords_(body) {
  var username = normalizeUsername_(body.username);
  var rights = username ? lookupRights_(username) : null;
  if (!username || !rights || rights.admin !== true) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cursor = usageCursor_(body, username);
  if (!cursor) return gitClientError_('bad_request');
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return usagePageOk_([], false, null);
  var listed;
  try {
    listed = listUsageFileRows_(cfg, username);
  } catch (err) {
    if (err && err.code === 'github_not_found') return usagePageOk_([], false, null);
    safeLog_(err);
    return gitClientError_(err && err.code ? err.code : 'github_error');
  }
  if (!listed.rows.length && listed.attempted > 0 && listed.hardFail === listed.attempted) {
    return gitClientError_('github_error');
  }
  var start = usageStartIndex_(listed.rows, cursor.name, cursor.username);
  var records = [];
  var hasMore = false;
  var cap = AI_BACKUP_LIST_MAX_;
  for (var i = start; i < listed.rows.length; i++) {
    var record = null;
    try {
      record = readUsageRecordAt_(cfg, listed.rows[i]);
    } catch (readErr) {
      if (readErr && readErr.code === 'github_not_found') continue;
      safeLog_(readErr);
      continue;
    }
    if (!record) continue;
    if (records.length < cap) {
      records.push(record);
    } else {
      hasMore = true;
      break;
    }
  }
  var last = records.length ? records[records.length - 1] : null;
  var nextAfter = last ? { name: String(last.name || ''), username: String(last.username || '') } : null;
  return usagePageOk_(records, hasMore, hasMore ? nextAfter : null);
}


function sanitizeReferenceIds_(raw) {
  var ids = [];
  var seen = {};
  var list = Array.isArray(raw) ? raw : [];
  for (var i = 0; i < list.length && ids.length < 80; i++) {
    var id = clip_(list[i], 80);
    if (!id || seen[id]) continue;
    if (/[\u0000-\u001F]/.test(id)) continue;
    seen[id] = true;
    ids.push(id);
  }
  return ids;
}

// Ids of questions actually sent as references. Paste runs store none.
// Explicit ids are kept only when they also appear on the sent questions.
function referenceIdsForBackup_(body, packed, source) {
  if (referenceSource_(source) === 'paste') return [];
  var fromSent = [];
  var rawQuestions = Array.isArray(body && body.questions) ? body.questions : [];
  for (var i = 0; i < rawQuestions.length; i++) {
    var item = rawQuestions[i];
    if (!item || typeof item !== 'object') continue;
    if (!clip_(item.question, 6000)) continue;
    fromSent.push(item.id);
  }
  var sentIds = sanitizeReferenceIds_(fromSent);
  if (!sentIds.length && packed && Array.isArray(packed.questions)) {
    for (var p = 0; p < packed.questions.length; p++) fromSent.push(packed.questions[p].id);
    sentIds = sanitizeReferenceIds_(fromSent);
  }
  var explicit = sanitizeReferenceIds_(body && body.referenceIds);
  if (!explicit.length) return sentIds;
  var allowed = {};
  for (var j = 0; j < sentIds.length; j++) allowed[sentIds[j]] = true;
  var kept = [];
  for (var k = 0; k < explicit.length; k++) {
    if (allowed[explicit[k]]) kept.push(explicit[k]);
  }
  return kept.length ? kept : sentIds;
}

// Write one personal AI reply JSON under users/<username>/<backupDir>/.
function writeGitAiBackup_(info) {
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return '';
  var action = backupFileAction_(info.action);
  var tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss-SSS');
  var nonce = String(Utilities.getUuid() || '').replace(/-/g, '').slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(nonce)) nonce = '00000000';
  var backupDir = githubUserBackupDir_(cfg, info && info.username);
  if (!backupDir) return '';
  var path = joinGithubPath_(backupDir, stamp + '-' + action + '-' + nonce + '.json');
  if (!path) return '';
  var reply = clipChars_(String(info.content || ''), GITHUB_REPLY_MAX_CHARS_);
  var refSource = action === 'generateQuestions' ? referenceSource_(info.source) : '';
  var modeId = action === 'generateQuestions' ? resolveModeId_(info.modeId) : '';
  var payload = {
    action: action,
    username: String(info.username || ''),
    model: String(info.model || ''),
    createdAt: new Date().toISOString(),
    sentCount: numberOrNull_(info.sentCount),
    filteredCount: numberOrNull_(info.filteredCount),
    durationMs: numberOrNull_(info.durationMs),
    source: refSource,
    referenceSource: refSource,
    modeId: modeId,
    modeName: modeId ? modeName_(modeId) : String(info.modeName || ''),
    instruction: action === 'generateQuestions'
      ? clipChars_(String(info.instruction || ''), POE_INSTRUCTION_MAX_)
      : '',
    content: reply
  };
  if (action === 'generateQuestions') {
    payload.referenceIds = sanitizeReferenceIds_(info.referenceIds);
    payload.requestId = requestId_(info.requestId);
  }
  if (action !== 'generateQuestions') {
    payload.modeId = '';
    payload.modeName = '';
    payload.instruction = '';
  }
  var text = JSON.stringify(payload);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return '';
  try {
    githubWriteText_(cfg, path, text, 'Backup model reply');
    return stamp + '-' + action + '-' + nonce + '.json';
  } catch (err) {
    safeLog_(err);
    return '';
  } finally {
    lock.releaseLock();
  }
}

// === GitHub config / App JWT + PEM normalize / direct-read credentials ===

function githubConfig_() {
  var stored = props_();
  return {
    token: String(stored.getProperty('GITHUB_TOKEN') || '').trim(),
    readToken: String(stored.getProperty('GITHUB_READ_TOKEN') || '').trim(),
    owner: String(stored.getProperty('GITHUB_OWNER') || '').trim(),
    repo: String(stored.getProperty('GITHUB_REPO') || '').trim(),
    branch: String(stored.getProperty('GITHUB_BRANCH') || '').trim() || 'main',
    dataPath: String(stored.getProperty('GITHUB_DATA_PATH') || '').trim(),
    backupDir: String(stored.getProperty('GITHUB_AI_BACKUP_DIR') || '').trim(),
    sharedPrefix: String(stored.getProperty('GITHUB_SHARED_PREFIX') || '').trim(),
    appId: String(stored.getProperty('GITHUB_APP_ID') || '').trim(),
    appInstallationId: String(stored.getProperty('GITHUB_APP_INSTALLATION_ID') || '').trim(),
    appPrivateKey: githubAppPrivateKeyRaw_()
  };
}

function githubAppPrivateKeyRaw_() {
  var raw = String(props_().getProperty('GITHUB_APP_PRIVATE_KEY') || '').trim();
  if (!raw) return '';
  if (raw.indexOf('\\n') !== -1) raw = raw.split('\\n').join('\n');
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalizeGithubAppPrivateKeyPem_(raw);
}

// Utilities.computeRsaSha256Signature expects PKCS#8 ("BEGIN PRIVATE KEY").
// GitHub App downloads are often PKCS#1 ("BEGIN RSA PRIVATE KEY").
function normalizeGithubAppPrivateKeyPem_(pem) {
  var text = String(pem || '').trim();
  if (!text) return '';
  if (text.indexOf('\\n') !== -1) text = text.split('\\n').join('\n');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (/-----BEGIN PRIVATE KEY-----/.test(text) && !/-----BEGIN RSA PRIVATE KEY-----/.test(text)) {
    return text;
  }
  if (!/-----BEGIN RSA PRIVATE KEY-----/.test(text)) {
    return /PRIVATE KEY/.test(text) ? text : '';
  }
  var body = text
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) return '';
  var pkcs1;
  try {
    pkcs1 = gasBytesToJs_(Utilities.base64Decode(body));
  } catch (err) {
    return '';
  }
  if (!pkcs1.length) return '';
  var pkcs8;
  try {
    pkcs8 = wrapRsaPkcs1ToPkcs8_(pkcs1);
  } catch (wrapErr) {
    return '';
  }
  return encodePemBlock_('PRIVATE KEY', pkcs8);
}

function gasBytesToJs_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i];
    out.push(v < 0 ? v + 256 : Number(v));
  }
  return out;
}

function asn1Tlv_(tag, content) {
  var len = content.length;
  var header = [tag];
  if (len < 0x80) {
    header.push(len);
  } else if (len < 0x100) {
    header.push(0x81, len);
  } else if (len < 0x10000) {
    header.push(0x82, (len >> 8) & 0xff, len & 0xff);
  } else if (len < 0x1000000) {
    header.push(0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  } else {
    throw new Error('asn1_len');
  }
  return header.concat(content);
}

// PrivateKeyInfo { version 0, rsaEncryption, OCTET STRING(RSAPrivateKey) }
function wrapRsaPkcs1ToPkcs8_(pkcs1) {
  var algId = [
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00
  ];
  var version = [0x02, 0x01, 0x00];
  var privateKeyOctet = asn1Tlv_(0x04, pkcs1);
  return asn1Tlv_(0x30, version.concat(algId, privateKeyOctet));
}

function encodePemBlock_(label, jsBytes) {
  var b64 = Utilities.base64Encode(jsBytes);
  var lines = String(b64).match(/.{1,64}/g) || [];
  return '-----BEGIN ' + label + '-----\n' + lines.join('\n') + '\n-----END ' + label + '-----';
}

function githubAppReady_(cfg) {
  return !!(cfg
    && cfg.appId
    && /^\d+$/.test(String(cfg.appId))
    && cfg.appInstallationId
    && /^\d+$/.test(String(cfg.appInstallationId))
    && cfg.appPrivateKey
    && /-----BEGIN PRIVATE KEY-----/.test(String(cfg.appPrivateKey))
    && githubIdentOk_(cfg.owner)
    && githubIdentOk_(cfg.repo)
    && githubBranchOk_(cfg.branch));
}

function githubReadPatReady_(cfg) {
  return !!(cfg
    && cfg.readToken
    && cfg.readToken !== cfg.token
    && githubIdentOk_(cfg.owner)
    && githubIdentOk_(cfg.repo)
    && githubBranchOk_(cfg.branch));
}

function githubDirectReadReady_(cfg) {
  return githubAppReady_(cfg) || githubReadPatReady_(cfg);
}

function b64urlFromString_(text) {
  return String(Utilities.base64EncodeWebSafe(String(text || ''))).replace(/=+$/g, '');
}

function b64urlFromBytes_(bytes) {
  return String(Utilities.base64EncodeWebSafe(bytes)).replace(/=+$/g, '');
}

function githubAppJwt_(cfg) {
  if (!githubAppReady_(cfg)) throw gitFail_('github_not_configured');
  var now = Math.floor(Date.now() / 1000);
  var header = b64urlFromString_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var payload = b64urlFromString_(JSON.stringify({
    iat: now - 60,
    exp: now + (9 * 60),
    iss: String(cfg.appId)
  }));
  var signingInput = header + '.' + payload;
  var signature;
  try {
    signature = Utilities.computeRsaSha256Signature(signingInput, cfg.appPrivateKey);
  } catch (err) {
    safeLog_(err);
    console.error('github_app_jwt signing failed');
    throw gitFail_('github_app_jwt');
  }
  if (!signature || !signature.length) {
    console.error('github_app_jwt empty signature');
    throw gitFail_('github_app_jwt');
  }
  return signingInput + '.' + b64urlFromBytes_(signature);
}

function mintGithubInstallationToken_(cfg) {
  if (!githubAppReady_(cfg)) throw gitFail_('github_not_configured');
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (ignore) { cache = null; }
  var cacheKey = 'gh_install_read_v1';
  if (cache) {
    try {
      var cached = cache.get(cacheKey);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed && parsed.token && Number(parsed.expiresAtMs) > Date.now() + 120000) {
          return {
            token: String(parsed.token),
            tokenType: 'installation',
            expiresAt: String(parsed.expiresAt || ''),
            expiresAtMs: Number(parsed.expiresAtMs)
          };
        }
      }
    } catch (ignoreCache) {}
  }
  var jwt = githubAppJwt_(cfg);
  var response;
  try {
    response = UrlFetchApp.fetch(
      'https://api.github.com/app/installations/' + encodeURIComponent(String(cfg.appInstallationId)) + '/access_tokens',
      {
        method: 'post',
        muteHttpExceptions: true,
        contentType: 'application/json; charset=utf-8',
        payload: JSON.stringify({}),
        headers: {
          Authorization: 'Bearer ' + jwt,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'econ-database-proxy'
        }
      }
    );
  } catch (err) {
    safeLog_(err);
    console.error('github_app_install fetch failed');
    throw gitFail_('github_app_install');
  }
  var status = response.getResponseCode();
  var raw = response.getContentText() || '';
  var body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (ignore) { body = null; }
  if (status < 200 || status >= 300 || !body || !body.token) {
    safeGithubStatus_(status, body);
    console.error('github_app_install http_' + status);
    throw gitFail_('github_app_install', status);
  }
  var expiresAt = String(body.expires_at || '').trim();
  var expiresAtMs = Date.parse(expiresAt);
  if (!isFinite(expiresAtMs)) expiresAtMs = Date.now() + (50 * 60 * 1000);
  var issued = {
    token: String(body.token),
    tokenType: 'installation',
    expiresAt: expiresAt || new Date(expiresAtMs).toISOString(),
    expiresAtMs: expiresAtMs
  };
  if (cache) {
    var ttlSec = Math.max(60, Math.min(21600, Math.floor((expiresAtMs - Date.now()) / 1000) - 90));
    try {
      cache.put(cacheKey, JSON.stringify({
        token: issued.token,
        expiresAt: issued.expiresAt,
        expiresAtMs: issued.expiresAtMs
      }), ttlSec);
    } catch (ignorePut) {}
  }
  return issued;
}

// Prefer a GitHub App installation token (about one hour). Fall back to a
// dedicated read-only fine-grained PAT. Never return GITHUB_TOKEN (write).
function issueGithubDirectReadCredential_(cfg) {
  if (githubAppReady_(cfg)) return mintGithubInstallationToken_(cfg);
  if (githubReadPatReady_(cfg)) {
    var expiresAtMs = Date.now() + (15 * 60 * 1000);
    return {
      token: String(cfg.readToken),
      tokenType: 'read_pat',
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs: expiresAtMs
    };
  }
  throw gitFail_('github_not_configured');
}

// === Shared GitHub path / Contents / Git Data I/O ===

function githubDataReady_(cfg) {
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo) && githubBranchOk_(cfg.branch) && githubSharedBankPath_(cfg));
}

function githubBackupReady_(cfg) {
  var dir = String(cfg && cfg.backupDir || '').replace(/^\/+|\/+$/g, '');
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo) && githubBranchOk_(cfg.branch) && githubPathOk_(dir));
}

function githubSharedReady_(cfg) {
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo) && githubBranchOk_(cfg.branch) && githubSharedPrefix_(cfg));
}

function githubSharedPrefix_(cfg) {
  var prefix = String(cfg && cfg.sharedPrefix || '').replace(/^\/+|\/+$/g, '');
  if (!prefix) prefix = 'shared';
  if (!githubPathOk_(prefix)) return '';
  if (prefix === 'users' || prefix.indexOf('users/') === 0) return '';
  return prefix;
}

function sharedExt_(path) {
  var file = String(path || '').split('/').pop();
  var dot = file.lastIndexOf('.');
  if (dot <= 0) return '';
  return file.slice(dot + 1).toLowerCase();
}

function sharedTextExt_(ext) {
  return ext === 'json' || ext === 'js' || ext === 'jsonl' || ext === 'txt' || ext === 'md';
}

function sharedMediaType_(ext) {
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

function githubSharedSegmentOk_(part) {
  if (!part || part === '.' || part === '..' || part.length > 180) return false;
  for (var c = 0; c < part.length; c++) {
    var ch = part.charAt(c);
    var code = part.charCodeAt(c);
    if (code < 32 || code === 127) return false;
    if (code < 128 && !/[A-Za-z0-9._() -]/.test(ch)) return false;
  }
  return true;
}

function githubSharedRelOk_(value) {
  var path = String(value || '');
  if (!path || path.charAt(0) === '/' || path.charAt(0) === '\\') return false;
  if (path.length > 400 || path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return false;
  if (path.charAt(path.length - 1) === '/') return false;
  if (/[\u0000-\u001F\u007F?#%<>:"|*]/.test(path)) return false;
  var parts = path.split('/');
  var roots = { data: true, diagrams: true, originals: true, papers: true, build: true };
  if (!roots[parts[0]]) return false;
  for (var i = 0; i < parts.length; i++) {
    if (!githubSharedSegmentOk_(parts[i])) return false;
  }
  var ext = sharedExt_(path);
  var allowed = {
    json: true, js: true, jpg: true, jpeg: true, png: true, gif: true, webp: true,
    svg: true, pdf: true, docx: true, doc: true, jsonl: true, txt: true, md: true
  };
  return !!allowed[ext];
}

function githubSharedDirOk_(value) {
  var raw = String(value || '');
  if (raw.charAt(0) === '/' || raw.charAt(0) === '\\') return false;
  var path = raw.replace(/\/+$/g, '');
  if (!path) return true;
  if (path.length > 400 || path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return false;
  if (/[\u0000-\u001F\u007F?#%<>:"|*]/.test(path)) return false;
  var parts = path.split('/');
  var roots = { data: true, diagrams: true, originals: true, papers: true, build: true };
  if (!roots[parts[0]]) return false;
  for (var i = 0; i < parts.length; i++) {
    if (!githubSharedSegmentOk_(parts[i])) return false;
  }
  return true;
}

function githubSharedFilePath_(cfg, rel) {
  var clean = String(rel || '').trim();
  if (!githubSharedRelOk_(clean)) return '';
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  var path = prefix + '/' + clean;
  if (path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return '';
  if (path.indexOf(prefix + '/') !== 0) return '';
  if (path === 'users' || path.indexOf('users/') === 0) return '';
  return path;
}

function githubSharedDirPath_(cfg, rel) {
  var clean = String(rel || '').replace(/\/+$/g, '');
  if (!githubSharedDirOk_(clean)) return '';
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  var path = clean ? prefix + '/' + clean : prefix;
  if (path.indexOf('..') !== -1 || path.indexOf('\\') !== -1) return '';
  if (path !== prefix && path.indexOf(prefix + '/') !== 0) return '';
  if (path === 'users' || path.indexOf('users/') === 0) return '';
  return path;
}

function sharedClientOk_(extra) {
  var out = { ok: true };
  if (!extra) return out;
  if (Object.prototype.hasOwnProperty.call(extra, 'path')) {
    var path = String(extra.path);
    if (path === '' || githubSharedRelOk_(path) || githubSharedDirOk_(path)) out.path = path;
  }
  if (extra.encoding === 'utf8' || extra.encoding === 'base64') out.encoding = extra.encoding;
  if (typeof extra.mediaType === 'string' && extra.mediaType && extra.mediaType.length < 160 && extra.mediaType.indexOf('\n') === -1) {
    out.mediaType = extra.mediaType;
  }
  if (typeof extra.bytes === 'number' && isFinite(extra.bytes) && extra.bytes >= 0 && extra.bytes <= SHARED_FETCH_MAX_BYTES_) {
    out.bytes = extra.bytes;
  }
  if (typeof extra.content === 'string') out.content = extra.content;
  if (extra.truncated === true || extra.truncated === false) out.truncated = extra.truncated;
  if (Array.isArray(extra.entries)) out.entries = extra.entries;
  return out;
}

function takeSharedReadSlot_(username) {
  try {
    var cache = CacheService.getScriptCache();
    var bucket = Math.floor(Date.now() / 60000);
    var key = 'sh_' + sha256Hex_(username).slice(0, 24) + '_' + bucket;
    var count = parseInt(cache.get(key) || '0', 10);
    if (!isFinite(count) || count < 0) count = 0;
    if (count >= SHARED_READS_PER_MINUTE_) return false;
    cache.put(key, String(count + 1), 120);
    return true;
  } catch (err) {
    return true;
  }
}

function logSharedRead_(username, action, success, metadata, always) {
  if (!always && !shouldAudit_(username, action, 300)) return;
  writeLog_({
    username: username,
    action: action,
    success: success === true,
    metadata: metadata || {}
  }, false);
}

function cleanBase64_(b64) {
  return String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
}

function githubReadBase64_(cfg, path) {
  if (!path || path.indexOf('..') !== -1) throw gitFail_('github_error');
  var existing = githubFetch_(cfg, 'get', githubContentsApi_(cfg, path) + '?ref=' + encodeURIComponent(cfg.branch), null);
  if (existing.status === 404) throw gitFail_('github_not_found');
  if (existing.status === 200 && existing.body && !Array.isArray(existing.body) && typeof existing.body.content === 'string' && String(existing.body.encoding || '') === 'base64') {
    var small = Number(existing.body.size || 0);
    if (small > SHARED_FETCH_MAX_BYTES_) throw gitFail_('payload_too_large');
    var smallB64 = cleanBase64_(existing.body.content);
    return {
      b64: smallB64,
      bytes: small > 0 ? small : base64Bytes_(smallB64),
      sha: sanitizeSha_(existing.body.sha)
    };
  }
  if (existing.status === 200 && Array.isArray(existing.body)) throw gitFail_('github_error');
  if (existing.status !== 200 && !isGithubTooLarge_(existing)) throw gitFail_('github_error');
  var meta = githubFindEntry_(cfg, path);
  if (!meta || meta.type !== 'blob') throw gitFail_('github_not_found');
  if (meta.size > SHARED_FETCH_MAX_BYTES_) throw gitFail_('payload_too_large');
  var blob = githubFetch_(cfg, 'get', githubRepoPrefix_(cfg) + '/git/blobs/' + encodeURIComponent(meta.sha), null);
  if (blob.status < 200 || blob.status >= 300 || !blob.body || blob.body.content == null) throw gitFail_('github_error');
  var encoding = String(blob.body.encoding || 'base64').toLowerCase();
  if (encoding !== 'base64') throw gitFail_('github_error');
  var b64 = cleanBase64_(blob.body.content);
  var bytes = Number(blob.body.size || meta.size || 0);
  if (!(bytes > 0)) bytes = base64Bytes_(b64);
  if (bytes > SHARED_FETCH_MAX_BYTES_) throw gitFail_('payload_too_large');
  return { b64: b64, bytes: bytes, sha: sanitizeSha_(blob.body.sha || meta.sha) };
}

function base64Bytes_(b64) {
  var cleaned = cleanBase64_(b64);
  if (!cleaned) return 0;
  var pad = 0;
  if (cleaned.charAt(cleaned.length - 1) === '=') pad++;
  if (cleaned.length > 1 && cleaned.charAt(cleaned.length - 2) === '=') pad++;
  return Math.floor(cleaned.length * 3 / 4) - pad;
}

function githubFindEntry_(cfg, repoPath) {
  var head = githubHead_(cfg);
  var parts = String(repoPath || '').split('/').filter(Boolean);
  var sha = head.treeSha;
  var type = 'tree';
  var size = 0;
  for (var i = 0; i < parts.length; i++) {
    var tree = githubFetch_(cfg, 'get', githubRepoPrefix_(cfg) + '/git/trees/' + encodeURIComponent(sha), null);
    if (tree.status === 404) throw gitFail_('github_not_found');
    if (tree.status < 200 || tree.status >= 300 || !tree.body || !Array.isArray(tree.body.tree)) throw gitFail_('github_error');
    var found = null;
    for (var j = 0; j < tree.body.tree.length; j++) {
      if (tree.body.tree[j] && tree.body.tree[j].path === parts[i]) {
        found = tree.body.tree[j];
        break;
      }
    }
    if (!found || !found.sha) throw gitFail_('github_not_found');
    type = String(found.type || '');
    sha = String(found.sha);
    size = Number(found.size || 0);
    if (i < parts.length - 1 && type !== 'tree') throw gitFail_('github_error');
  }
  return { sha: sha, type: type, size: size };
}

function githubListTree_(cfg, repoPath, recursive) {
  var entry = githubFindEntry_(cfg, repoPath);
  if (!entry || entry.type !== 'tree') throw gitFail_('github_not_found');
  var api = githubRepoPrefix_(cfg) + '/git/trees/' + encodeURIComponent(entry.sha);
  if (recursive) api += '?recursive=1';
  var tree = githubFetch_(cfg, 'get', api, null);
  if (tree.status === 404) throw gitFail_('github_not_found');
  if (tree.status < 200 || tree.status >= 300 || !tree.body || !Array.isArray(tree.body.tree)) throw gitFail_('github_error');
  return { entries: tree.body.tree, truncated: tree.body.truncated === true };
}

function githubIdentOk_(value) {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(String(value || ''));
}

function githubBranchOk_(value) {
  var branch = String(value || '');
  if (!branch || branch.length > 200 || branch.indexOf('..') !== -1 || branch.charAt(0) === '/') return false;
  return /^[A-Za-z0-9._\-\/]+$/.test(branch);
}

function githubPathOk_(value) {
  var path = String(value || '');
  if (!path || path.length > 240 || path.charAt(0) === '/' || path.indexOf('..') !== -1) return false;
  if (path.charAt(path.length - 1) === '/') return false;
  if (path.indexOf('\\') !== -1 || /[\s?#%<>:"|*]/.test(path)) return false;
  if (/[\u0000-\u001F\u007F]/.test(path)) return false;
  var parts = path.split('/');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === '.' || part === '..') return false;
    for (var c = 0; c < part.length; c++) {
      var code = part.charCodeAt(c);
      if (code < 128 && !/[A-Za-z0-9._-]/.test(part.charAt(c))) return false;
    }
  }
  return true;
}

// Folder name for one signed-in user. The name is trimmed and
// lowercased first. Spaces become hyphens. The result is one path segment,
// so a username cannot add extra folders.
function githubUserSegment_(username) {
  var name = normalizeUsername_(username);
  if (!name) return '';
  var segment = name.replace(/\s+/g, '-');
  if (!segment || segment.indexOf('/') !== -1 || segment.indexOf('\\') !== -1) return '';
  if (segment.indexOf('..') !== -1 || segment === '.' || segment === '..') return '';
  if (!githubPathOk_(segment)) return '';
  return segment;
}

// Shared combined question-bank path (GITHUB_DATA_PATH under shared prefix).
// D2: syncDataDownload uses publisher shards (see handleGitDownload_); this
// helper remains the combined-path resolver for dual-write / schema peek / approve.
// syncDataUpload Phase 3 also writes allowlisted shard paths via body.files.
// If dataPath already starts with the shared prefix, do not double-prefix.
// Rejects any bank path under users/. Username is never part of this path.
function githubSharedBankPath_(cfg) {
  var prefix = githubSharedPrefix_(cfg);
  if (!prefix) return '';
  var rel = String(cfg && cfg.dataPath || '').replace(/^\/+|\/+$/g, '');
  if (!rel || !githubPathOk_(rel)) return '';
  if (rel === 'users' || rel.indexOf('users/') === 0) return '';
  var full;
  if (rel === prefix || rel.indexOf(prefix + '/') === 0) {
    full = rel;
  } else {
    full = joinGithubPath_(prefix, rel);
  }
  if (!full) return '';
  if (full === 'users' || full.indexOf('users/') === 0) return '';
  return full;
}

function githubUserBackupDir_(cfg, username) {
  var segment = githubUserSegment_(username);
  var dir = String(cfg && cfg.backupDir || '').replace(/^\/+|\/+$/g, '');
  if (!segment || !githubPathOk_(dir)) return '';
  return joinGithubPath_('users/' + segment, dir);
}

function joinGithubPath_(dir, name) {
  var base = String(dir || '').replace(/^\/+|\/+$/g, '');
  var file = String(name || '').replace(/^\/+/, '');
  var path = base ? base + '/' + file : file;
  return githubPathOk_(path) ? path : '';
}

// Git AI backup JSON `action` field: keep generateQuestions / testModel;
// everything else (including continueGeneration) is stored as "reply".
// GenerationBackup sheet rows keep the real action string. listAiBackups
// still pages generateQuestions files only.
function backupFileAction_(action) {
  if (action === 'generateQuestions' || action === 'testModel') return action;
  return 'reply';
}

function coerceJson_(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

// Top-level bank field shared with the public site client (camelCase).
// Missing or invalid values are treated as 0 (oldest compatible).
function readBankSchemaVersion_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  var raw = data.schemaVersion;
  if (raw == null || raw === '') return 0;
  var number = Number(raw);
  if (!isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

// Rewrite the shared bank JSON for upload. Preserves schemaVersion and other
// unknown top-level fields from the client (and from cloud when the client
// omitted them) so an upload never "helps" by stripping newer keys.
function questionPayloadText_(data, cloudData) {
  var extracted = extractQuestions_(data);
  if (!extracted.ok) {
    throw gitFail_(extracted.error, null, {
      message: extracted.message || '',
      failingIds: extracted.failingIds || null,
      failingCount: extracted.failingCount
    });
  }
  var out = {};
  function copyTopLevel_(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === 'questions' || key === 'questionCount' || key === 'exportDate') continue;
      out[key] = source[key];
    }
  }
  copyTopLevel_(cloudData);
  copyTopLevel_(data);
  if (typeof out.version !== 'string' || !String(out.version).trim()) out.version = '1.0';
  if (Object.prototype.hasOwnProperty.call(out, 'schemaVersion')) {
    out.schemaVersion = readBankSchemaVersion_(out);
  }
  out.exportDate = new Date().toISOString();
  out.questionCount = extracted.questions.length;
  out.questions = extracted.questions;
  return JSON.stringify(out);
}

// Bank field schema for syncDataUpload (aligned with client EXAMINATION_TYPES /
// QUESTION_TYPES / CHAPTER_RANGE). Hard-reject whole upload on first failures.
var BANK_EXAMINATION_TYPES_ = ['HKDSE', 'HKCEE', 'HKALE'];
var BANK_QUESTION_TYPES_ = ['MC', '文字題 (SQ/LQ)'];
var BANK_CHAPTER_MIN_ = 1;
var BANK_CHAPTER_MAX_ = 29;
var BANK_UPLOAD_FAIL_IDS_CAP_ = 8;
var BANK_UPLOAD_MESSAGE_MAX_ = 420;

function parseBankChapterToken_(raw) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text || text === '-') return '';
  var mt = text.match(/^Ch\s*0*(\d{1,2})$/i);
  if (mt) return String(parseInt(mt[1], 10));
  if (/^\d{1,2}$/.test(text)) return String(parseInt(text, 10));
  var digits = text.match(/(\d{1,2})/);
  if (digits) return String(parseInt(digits[1], 10));
  return '';
}

function isPresentArrayField_(value) {
  return value != null && value !== '';
}

function validateArrayField_(value, fieldName, failures) {
  if (!isPresentArrayField_(value)) return;
  if (!Array.isArray(value)) failures.push(fieldName + ' must be an array');
}

function validateQuestionPartsShape_(parts, failures) {
  if (!isPresentArrayField_(parts)) return;
  if (!Array.isArray(parts)) {
    failures.push('questionParts must be an array');
    return;
  }
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      failures.push('questionParts[' + i + '] invalid shape');
      continue;
    }
    var label = String(part.label == null ? '' : part.label).trim();
    if (!label) failures.push('questionParts[' + i + '].label required');
    if (part.marks != null && part.marks !== '') {
      var marks = Number(part.marks);
      if (!isFinite(marks) || marks < 0) {
        failures.push('questionParts[' + i + '].marks must be ≥0');
      }
    }
    if (part.performance != null && part.performance !== ''
        && typeof part.performance !== 'string') {
      failures.push('questionParts[' + i + '].performance must be string');
    }
  }
}

function validateOneQuestionForUpload_(item, index) {
  var failures = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { id: '#' + index, failures: ['not an object'] };
  }
  var id = String(item.id == null ? '' : item.id).trim();
  if (!id) {
    id = '#' + index;
    failures.push('id required');
  }
  var examination = String(item.examination == null ? '' : item.examination).trim();
  if (!examination) failures.push('examination required');
  else if (BANK_EXAMINATION_TYPES_.indexOf(examination) === -1) {
    failures.push('examination not in allowed list');
  }
  if (item.questionType != null && item.questionType !== '') {
    var qtype = String(item.questionType).trim();
    if (BANK_QUESTION_TYPES_.indexOf(qtype) === -1) {
      failures.push('questionType not in allowed list');
    }
  }
  if (item.marks != null && item.marks !== '') {
    var marks = Number(item.marks);
    if (!isFinite(marks) || marks < 0) failures.push('marks must be a finite number ≥0');
  }
  if (item.correctPercentage != null && item.correctPercentage !== '') {
    var pct = Number(item.correctPercentage);
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      failures.push('correctPercentage must be 0–100 or empty');
    }
  }
  validateArrayField_(item.curriculumClassification, 'curriculumClassification', failures);
  validateArrayField_(item.AristochapterClassification, 'AristochapterClassification', failures);
  validateArrayField_(item.concepts, 'concepts', failures);
  validateArrayField_(item.patterns, 'patterns', failures);
  validateArrayField_(item.stemPatterns, 'stemPatterns', failures);
  validateQuestionPartsShape_(item.questionParts, failures);
  if (Array.isArray(item.AristochapterClassification)) {
    item.AristochapterClassification.forEach(function (token) {
      var text = String(token == null ? '' : token).trim();
      if (!text) return;
      var numText = parseBankChapterToken_(text);
      if (!numText) {
        failures.push('chapter token unmapped: ' + text);
        return;
      }
      var num = parseInt(numText, 10);
      if (num < BANK_CHAPTER_MIN_ || num > BANK_CHAPTER_MAX_) {
        failures.push('chapter out of Ch01–Ch29: ' + text);
      }
    });
  }
  return { id: id, failures: failures };
}

function buildUploadValidationMessage_(failing) {
  var ids = [];
  var i;
  for (i = 0; i < failing.length && ids.length < BANK_UPLOAD_FAIL_IDS_CAP_; i++) {
    ids.push(String(failing[i].id || ''));
  }
  var more = failing.length > ids.length
    ? ' …(+' + (failing.length - ids.length) + ')'
    : '';
  var msg = '上傳已拒絕：題目欄位驗證失敗（共 '
    + failing.length + ' 題）。Upload rejected: invalid question fields ('
    + failing.length + '). 問題 id / Failing ids: ' + ids.join(', ') + more;
  if (failing[0] && failing[0].failures && failing[0].failures.length) {
    msg += '。例 / e.g. ' + failing[0].id + ': ' + failing[0].failures[0];
  }
  if (msg.length > BANK_UPLOAD_MESSAGE_MAX_) {
    msg = msg.slice(0, BANK_UPLOAD_MESSAGE_MAX_ - 1) + '…';
  }
  return msg;
}

function validateQuestionsForUpload_(questions) {
  var failing = [];
  for (var i = 0; i < questions.length; i++) {
    var result = validateOneQuestionForUpload_(questions[i], i);
    if (result.failures && result.failures.length) failing.push(result);
  }
  if (!failing.length) return { ok: true };
  return {
    ok: false,
    error: 'validation_failed',
    message: buildUploadValidationMessage_(failing),
    failingIds: failing.slice(0, BANK_UPLOAD_FAIL_IDS_CAP_).map(function (row) {
      return row.id;
    }),
    failingCount: failing.length
  };
}

function extractQuestions_(data) {
  var questions = null;
  if (Array.isArray(data)) questions = data;
  else if (data && typeof data === 'object' && Array.isArray(data.questions)) questions = data.questions;
  else return { ok: false, error: 'bad_request' };
  if (questions.length > GITHUB_MAX_QUESTIONS_) return { ok: false, error: 'payload_too_large' };
  for (var i = 0; i < questions.length; i++) {
    var item = questions[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'bad_request' };
  }
  var fieldCheck = validateQuestionsForUpload_(questions);
  if (!fieldCheck.ok) return fieldCheck;
  return { ok: true, questions: questions };
}

function gitFail_(code, httpStatus, extra) {
  var err = new Error(code || 'github_error');
  err.code = code || 'github_error';
  if (typeof httpStatus === 'number' && isFinite(httpStatus)) err.httpStatus = httpStatus;
  if (extra && typeof extra === 'object') {
    if (typeof extra.message === 'string') err.clientMessage = extra.message;
    if (Array.isArray(extra.failingIds)) err.failingIds = extra.failingIds;
    if (typeof extra.failingCount === 'number') err.failingCount = extra.failingCount;
  }
  return err;
}

function gitClientError_(code, extra) {
  var allowed = {
    feature_unavailable: true,
    github_not_configured: true,
    github_not_found: true,
    github_error: true,
    github_app_jwt: true,
    github_app_install: true,
    bad_request: true,
    not_found: true,
    payload_too_large: true,
    rate_limited: true,
    server_error: true,
    schema_version_stale: true,
    validation_failed: true,
    empty_shard_refused: true,
    unknown_publisher: true
  };
  var out = { ok: false, error: allowed[code] ? code : 'github_error' };
  if (extra && typeof extra === 'object') {
    if (typeof extra.clientSchemaVersion === 'number' && isFinite(extra.clientSchemaVersion)) {
      out.clientSchemaVersion = Math.floor(extra.clientSchemaVersion);
    }
    if (typeof extra.cloudSchemaVersion === 'number' && isFinite(extra.cloudSchemaVersion)) {
      out.cloudSchemaVersion = Math.floor(extra.cloudSchemaVersion);
    }
    if (typeof extra.message === 'string' && extra.message) {
      out.message = String(extra.message).slice(0, BANK_UPLOAD_MESSAGE_MAX_);
    }
    if (Array.isArray(extra.failingIds)) {
      out.failingIds = extra.failingIds.slice(0, BANK_UPLOAD_FAIL_IDS_CAP_).map(function (id) {
        return String(id == null ? '' : id);
      });
    }
    if (typeof extra.failingCount === 'number' && isFinite(extra.failingCount)) {
      out.failingCount = Math.floor(extra.failingCount);
    }
  }
  return out;
}

function gitOk_(extra) {
  var out = { ok: true };
  if (!extra) return out;
  var sha = sanitizeSha_(extra.sha);
  if (sha) out.sha = sha;
  if (extra.path && githubPathOk_(extra.path)) out.path = extra.path;
  if (Object.prototype.hasOwnProperty.call(extra, 'data')) out.data = extra.data;
  // schemaVersion is a non-secret bank metadata field returned on upload/download.
  if (typeof extra.schemaVersion === 'number' && isFinite(extra.schemaVersion) && extra.schemaVersion >= 0) {
    out.schemaVersion = Math.floor(extra.schemaVersion);
  }
  return out;
}

function sanitizeSha_(value) {
  var sha = String(value || '').toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

function githubWriteText_(cfg, path, text, message) {
  var last = gitFail_('github_error');
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return githubWriteOnce_(cfg, path, text, message);
    } catch (err) {
      last = err && err.code ? err : gitFail_('github_error');
      if (last.code !== 'github_conflict') throw last;
    }
  }
  throw last.code === 'github_conflict' ? gitFail_('github_error') : last;
}

function githubWriteOnce_(cfg, path, text, message) {
  if (!githubPathOk_(path)) throw gitFail_('github_error');
  var bytes = utf8Length_(text);
  if (bytes > GITHUB_DATA_MAX_BYTES_) throw gitFail_('payload_too_large');
  if (bytes <= GITHUB_CONTENTS_MAX_BYTES_) return githubWriteViaContents_(cfg, path, text, message);
  return githubWriteViaGitData_(cfg, path, text, message);
}

function githubReadText_(cfg, path) {
  if (!githubPathOk_(path)) throw gitFail_('github_error');
  var existing = githubFetch_(cfg, 'get', githubContentsApi_(cfg, path) + '?ref=' + encodeURIComponent(cfg.branch), null);
  if (existing.status === 404) throw gitFail_('github_not_found');
  if (isGithubTooLarge_(existing)) return githubReadViaGitData_(cfg, path);
  if (existing.status === 200 && existing.body && typeof existing.body.content === 'string' && String(existing.body.encoding || '') === 'base64') {
    return {
      text: decodeGithubBase64_(existing.body.content),
      sha: sanitizeSha_(existing.body.sha),
      path: path
    };
  }
  if (existing.status === 200 && existing.body && existing.body.type === 'file' && existing.body.sha) {
    return githubReadViaGitData_(cfg, path);
  }
  throw gitFail_('github_error');
}

function githubWriteViaContents_(cfg, path, text, message) {
  var api = githubContentsApi_(cfg, path);
  var existing = githubFetch_(cfg, 'get', api + '?ref=' + encodeURIComponent(cfg.branch), null);
  if (isGithubTooLarge_(existing)) return githubWriteViaGitData_(cfg, path, text, message);
  var sha = '';
  if (existing.status === 200) {
    if (!existing.body || existing.body.type === 'dir' || Array.isArray(existing.body)) throw gitFail_('github_error');
    sha = existing.body.sha ? String(existing.body.sha) : '';
  } else if (existing.status !== 404) {
    throw gitFail_('github_error');
  }
  var payload = {
    message: clip_(message, 200) || 'Update data',
    content: encodeGithubBase64_(text),
    branch: cfg.branch
  };
  if (sha) payload.sha = sha;
  var put = githubFetch_(cfg, 'put', api, payload);
  if (isGithubTooLarge_(put)) return githubWriteViaGitData_(cfg, path, text, message);
  if (isGithubConflict_(put)) throw gitFail_('github_conflict');
  if (put.status < 200 || put.status >= 300) throw gitFail_('github_error');
  var newSha = put.body && put.body.content && put.body.content.sha ? put.body.content.sha : (put.body && put.body.commit && put.body.commit.sha);
  return { sha: sanitizeSha_(newSha), path: path };
}

function githubWriteViaGitData_(cfg, path, text, message) {
  var head = githubHead_(cfg);
  var blob = githubFetch_(cfg, 'post', githubRepoPrefix_(cfg) + '/git/blobs', {
    content: String(text),
    encoding: 'utf-8'
  });
  if (blob.status < 200 || blob.status >= 300 || !blob.body || !blob.body.sha) throw gitFail_('github_error');
  var tree = githubFetch_(cfg, 'post', githubRepoPrefix_(cfg) + '/git/trees', {
    base_tree: head.treeSha,
    tree: [{ path: path, mode: '100644', type: 'blob', sha: blob.body.sha }]
  });
  if (tree.status < 200 || tree.status >= 300 || !tree.body || !tree.body.sha) throw gitFail_('github_error');
  var commit = githubFetch_(cfg, 'post', githubRepoPrefix_(cfg) + '/git/commits', {
    message: clip_(message, 200) || 'Update data',
    tree: tree.body.sha,
    parents: [head.commitSha]
  });
  if (commit.status < 200 || commit.status >= 300 || !commit.body || !commit.body.sha) throw gitFail_('github_error');
  var updated = githubFetch_(cfg, 'patch', githubRefApi_(cfg), { sha: commit.body.sha });
  if (isGithubConflict_(updated)) throw gitFail_('github_conflict');
  if (updated.status < 200 || updated.status >= 300) throw gitFail_('github_error');
  return { sha: sanitizeSha_(commit.body.sha), path: path };
}

function githubReadViaGitData_(cfg, path) {
  var head = githubHead_(cfg);
  var blobSha = githubBlobSha_(cfg, head.treeSha, path);
  var blob = githubFetch_(cfg, 'get', githubRepoPrefix_(cfg) + '/git/blobs/' + encodeURIComponent(blobSha), null);
  if (blob.status < 200 || blob.status >= 300 || !blob.body || blob.body.content == null) throw gitFail_('github_error');
  var encoding = String(blob.body.encoding || 'base64').toLowerCase();
  var text = encoding === 'utf-8' ? String(blob.body.content) : decodeGithubBase64_(blob.body.content);
  return { text: text, sha: sanitizeSha_(blob.body.sha || blobSha), path: path };
}

function githubHead_(cfg) {
  var ref = githubFetch_(cfg, 'get', githubRefApi_(cfg), null);
  if (ref.status < 200 || ref.status >= 300 || !ref.body || !ref.body.object || !ref.body.object.sha) {
    throw gitFail_('github_error');
  }
  var commitSha = String(ref.body.object.sha);
  var commit = githubFetch_(cfg, 'get', githubRepoPrefix_(cfg) + '/git/commits/' + encodeURIComponent(commitSha), null);
  if (commit.status < 200 || commit.status >= 300 || !commit.body || !commit.body.tree || !commit.body.tree.sha) {
    throw gitFail_('github_error');
  }
  return { commitSha: commitSha, treeSha: String(commit.body.tree.sha) };
}

function githubBlobSha_(cfg, treeSha, path) {
  var parts = String(path || '').split('/').filter(Boolean);
  var sha = treeSha;
  for (var i = 0; i < parts.length; i++) {
    var tree = githubFetch_(cfg, 'get', githubRepoPrefix_(cfg) + '/git/trees/' + encodeURIComponent(sha), null);
    if (tree.status < 200 || tree.status >= 300 || !tree.body || !Array.isArray(tree.body.tree)) throw gitFail_('github_error');
    var found = null;
    for (var j = 0; j < tree.body.tree.length; j++) {
      if (tree.body.tree[j] && tree.body.tree[j].path === parts[i]) {
        found = tree.body.tree[j];
        break;
      }
    }
    if (!found || !found.sha) throw gitFail_('github_not_found');
    if (i === parts.length - 1) {
      if (found.type !== 'blob') throw gitFail_('github_error');
      return String(found.sha);
    }
    if (found.type !== 'tree') throw gitFail_('github_error');
    sha = String(found.sha);
  }
  throw gitFail_('github_not_found');
}

function githubRepoPrefix_(cfg) {
  return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
}

function githubRefApi_(cfg) {
  var branch = String(cfg.branch || 'main').split('/').map(function (part) {
    return encodeURIComponent(part);
  }).join('/');
  // GitHub update-ref requires /git/refs/… (plural). GET accepts it too.
  return githubRepoPrefix_(cfg) + '/git/refs/heads/' + branch;
}

function githubContentsApi_(cfg, path) {
  var encoded = String(path || '').split('/').map(function (part) {
    return encodeURIComponent(part);
  }).join('/');
  return githubRepoPrefix_(cfg) + '/contents/' + encoded;
}

function githubFetch_(cfg, method, apiPath, payload) {
  var options = {
    method: String(method || 'get').toLowerCase(),
    muteHttpExceptions: true,
    escaping: false,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'econ-database-proxy'
    }
  };
  if (payload != null) {
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(payload);
  }
  var response;
  try {
    response = UrlFetchApp.fetch('https://api.github.com' + apiPath, options);
  } catch (err) {
    safeLog_(err);
    throw gitFail_('github_error');
  }
  var status = response.getResponseCode();
  var raw = response.getContentText() || '';
  var body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch (ignore) { body = null; }
  }
  if (status < 200 || status >= 300) safeGithubStatus_(status, body);
  return { status: status, body: body };
}

function safeGithubStatus_(status, body) {
  var msg = 'github_http_' + status;
  if (body && body.message) {
    var text = String(body.message).replace(/https?:\/\/\S+/g, '[url]');
    if (text.length > 160) text = text.slice(0, 160);
    msg += ' ' + text;
  }
  console.error(msg);
}

function isGithubTooLarge_(result) {
  if (!result || !result.body) return false;
  var message = String(result.body.message || '').toLowerCase();
  if (message.indexOf('too large') !== -1) return true;
  var errors = result.body.errors;
  if (!Array.isArray(errors)) return false;
  for (var i = 0; i < errors.length; i++) {
    if (errors[i] && String(errors[i].code || '') === 'too_large') return true;
  }
  return false;
}

function isGithubConflict_(result) {
  if (!result) return false;
  if (result.status === 409) return true;
  var message = String(result.body && result.body.message || '').toLowerCase();
  if (message.indexOf('fast forward') !== -1) return true;
  if (message.indexOf('does not match') !== -1) return true;
  return false;
}

function encodeGithubBase64_(text) {
  return Utilities.base64Encode(Utilities.newBlob(String(text), 'application/json', 'payload.json').getBytes());
}

function decodeGithubBase64_(b64) {
  try {
    var cleaned = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (!cleaned) throw gitFail_('github_error');
    return Utilities.newBlob(Utilities.base64Decode(cleaned)).getDataAsString('UTF-8');
  } catch (err) {
    if (err && err.code) throw err;
    throw gitFail_('github_error');
  }
}

function utf8Length_(text) {
  return Utilities.newBlob(String(text)).getBytes().length;
}

function clipChars_(value, max) {
  var text = String(value || '');
  if (text.length <= max) return text;
  var clipped = text.slice(0, max);
  var last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) clipped = clipped.slice(0, -1);
  return clipped;
}

function takeGitSlot_(username, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'git_iv_' + sha256Hex_(username).slice(0, 32);
    if (cache.get(key)) return false;
    cache.put(key, '1', Math.min(Math.max(Number(seconds) || 1, 1), 30));
    return true;
  } catch (err) {
    return true;
  }
}

function releaseGitSlot_(username) {
  try {
    CacheService.getScriptCache().remove('git_iv_' + sha256Hex_(username).slice(0, 32));
  } catch (err) {
    safeLog_(err);
  }
}

function selfTestGitPaths() {
  if (!githubPathOk_('data/questions.json')) throw new Error('path_ok');
  if (githubPathOk_('../secrets')) throw new Error('path_dotdot');
  if (githubPathOk_('/tmp/questions.json')) throw new Error('path_abs');
  if (githubPathOk_('a b.json')) throw new Error('path_space');
  if (!githubIdentOk_('example-user')) throw new Error('ident_ok');
  if (githubIdentOk_('owner/repo')) throw new Error('ident_slash');
  if (githubReadPatReady_({
    readToken: 'same',
    token: 'same',
    owner: 'example-user',
    repo: 'example-repo',
    branch: 'main'
  })) throw new Error('read_pat_rejects_write_token');
  if (!githubReadPatReady_({
    readToken: 'read-only-token',
    token: 'write-token',
    owner: 'example-user',
    repo: 'example-repo',
    branch: 'main'
  })) throw new Error('read_pat_ok');
  if (githubAppReady_({
    appId: '123',
    appInstallationId: '456',
    appPrivateKey: 'not-a-key',
    owner: 'example-user',
    repo: 'example-repo',
    branch: 'main'
  })) throw new Error('app_ready_rejects_bad_key');
  // Minimal PKCS#1 body (not a real key) — only checks PEM wrap shape.
  var fakePkcs1 = '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----';
  var normalizedPem = normalizeGithubAppPrivateKeyPem_(fakePkcs1);
  if (!normalizedPem || normalizedPem.indexOf('BEGIN PRIVATE KEY') === -1) {
    throw new Error('pkcs1_to_pkcs8');
  }
  if (normalizedPem.indexOf('BEGIN RSA PRIVATE KEY') !== -1) throw new Error('pkcs1_left_over');
  var alreadyPkcs8 = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----';
  if (normalizeGithubAppPrivateKeyPem_(alreadyPkcs8) !== alreadyPkcs8) {
    throw new Error('pkcs8_passthrough');
  }
  if (gitClientError_('github_app_jwt').error !== 'github_app_jwt') throw new Error('client_error_jwt');
  if (gitClientError_('github_app_install').error !== 'github_app_install') throw new Error('client_error_install');
  var failInstall = gitFail_('github_app_install', 401);
  if (failInstall.code !== 'github_app_install' || failInstall.httpStatus !== 401) {
    throw new Error('git_fail_status');
  }
  if (b64urlFromString_('{}').indexOf('=') !== -1) throw new Error('b64url_padding');
  var readCred = issueGithubDirectReadCredential_({
    readToken: 'read-only-token',
    token: 'write-token',
    owner: 'example-user',
    repo: 'example-repo',
    branch: 'main',
    appId: '',
    appInstallationId: '',
    appPrivateKey: ''
  });
  if (!readCred || readCred.token !== 'read-only-token' || readCred.tokenType !== 'read_pat') {
    throw new Error('issue_read_pat');
  }
  if (readCred.token === 'write-token') throw new Error('issue_leaked_write');
  if (joinGithubPath_('ai-backups', '20260101-000000-000-generateQuestions-abcd1234.json') !== 'ai-backups/20260101-000000-000-generateQuestions-abcd1234.json') {
    throw new Error('join_path');
  }
  if (githubUserSegment_('  Example.User ') !== 'example.user') throw new Error('user_segment');
  if (githubUserSegment_('first last') !== 'first-last') throw new Error('user_segment_space');
  if (githubUserSegment_('user甲') !== 'user甲') throw new Error('user_segment_text');
  if (githubUserSegment_('a/b')) throw new Error('user_segment_slash');
  if (githubUserSegment_('../x')) throw new Error('user_segment_dotdot');
  if (githubUserSegment_('bad name.json') !== 'bad-name.json') throw new Error('user_segment_space_file');
  if (githubSharedBankPath_({ dataPath: 'data/database.json', sharedPrefix: '' }) !== 'shared/data/database.json') {
    throw new Error('shared_bank_path');
  }
  if (githubSharedBankPath_({ dataPath: 'data/database.json', sharedPrefix: 'shared' }) !== 'shared/data/database.json') {
    throw new Error('shared_bank_explicit');
  }
  if (githubSharedBankPath_({ dataPath: 'shared/data/database.json', sharedPrefix: 'shared' }) !== 'shared/data/database.json') {
    throw new Error('shared_bank_no_double');
  }
  if (githubSharedBankPath_({ dataPath: 'users/example/data/questions.json', sharedPrefix: 'shared' })) {
    throw new Error('shared_bank_rejects_users');
  }
  if (githubSharedBankPath_({ dataPath: '../questions.json', sharedPrefix: 'shared' })) throw new Error('shared_bank_escape');
  if (githubSharedBankPath_({ dataPath: 'data/database.json', sharedPrefix: 'users' })) throw new Error('shared_bank_bad_prefix');
  // Phase 3 upload path allowlist / shard resolver
  if (githubResolveUploadBankPath_({ sharedPrefix: 'shared' }, 'data/database-hkeaa.json') !== 'shared/data/database-hkeaa.json') {
    throw new Error('upload_allow_hkeaa');
  }
  if (githubResolveUploadBankPath_({ sharedPrefix: 'shared' }, 'data/database-aristo.json') !== 'shared/data/database-aristo.json') {
    throw new Error('upload_allow_aristo');
  }
  if (githubResolveUploadBankPath_({ sharedPrefix: 'shared' }, 'data/database.json') !== 'shared/data/database.json') {
    throw new Error('upload_allow_combined');
  }
  if (githubResolveUploadBankPath_({ sharedPrefix: 'shared' }, 'data/other.json')) throw new Error('upload_reject_other');
  if (githubResolveUploadBankPath_({ sharedPrefix: 'shared' }, 'users/x/data/database.json')) throw new Error('upload_reject_users');
  if (githubSharedBankShardPath_({ sharedPrefix: 'shared', dataPath: 'data/database.json' }, 'hkeaa') !== 'shared/data/database-hkeaa.json') {
    throw new Error('shard_path_hkeaa');
  }
  if (publisherShardKeyForApprove_('HKEAA') !== 'hkeaa') throw new Error('pub_hkeaa');
  if (publisherShardKeyForApprove_('雅集出版社') !== 'aristo') throw new Error('pub_aristo');
  if (publisherShardKeyForApprove_('-') !== '') throw new Error('pub_dash');
  if (publisherShardKeyForApprove_('') !== '') throw new Error('pub_empty');
  if (githubUserBackupDir_({ backupDir: 'ai-backups' }, 'Example') !== 'users/example/ai-backups') {
    throw new Error('user_backup_dir');
  }
  if (joinGithubPath_(githubUserBackupDir_({ backupDir: 'ai-backups' }, 'example'), '20260101-000000-000-generateQuestions-abcd1234.json') !== 'users/example/ai-backups/20260101-000000-000-generateQuestions-abcd1234.json') {
    throw new Error('user_backup_file');
  }
  if (backupFileAction_('generateQuestions') !== 'generateQuestions') throw new Error('backup_generate');
  if (backupFileAction_('testModel') !== 'testModel') throw new Error('backup_test_model');
  if (backupFileAction_('login') !== 'reply') throw new Error('backup_other');
  if (!aiBackupFileNameOk_('20260101-000000-000-generateQuestions-abcd1234.json')) throw new Error('ai_backup_name_ok');
  if (aiBackupFileNameOk_('../x.json')) throw new Error('ai_backup_name_dotdot');
  if (aiBackupFileNameOk_('dir/x.json')) throw new Error('ai_backup_name_slash');
  if (aiBackupFileNameOk_('note.txt')) throw new Error('ai_backup_name_ext');
  var parsedBackup = parseAiBackupJson_(JSON.stringify({
    action: 'generateQuestions',
    model: 'Claude-Sonnet-5.5',
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'paste',
    content: '題目'
  }), '20260101-000000-000-generateQuestions-abcd1234.json');
  if (!parsedBackup || parsedBackup.referenceSource !== 'paste' || parsedBackup.content !== '題目') {
    throw new Error('ai_backup_parse');
  }
  var parsedSingle = parseAiBackupJson_(JSON.stringify({
    action: 'generateQuestions',
    source: 'single',
    content: 'ok'
  }), '20260101-000000-000-generateQuestions-abcd1234.json');
  if (!parsedSingle || parsedSingle.referenceSource !== 'single' || parsedSingle.content !== 'ok') {
    throw new Error('ai_backup_single');
  }
  if (sanitizeReferenceIds_([' 2026-P1-01 ', '', '2026-P1-01', '2026-P2-03']).join('|') !== '2026-P1-01|2026-P2-03') {
    throw new Error('ref_ids');
  }
  var filterIds = referenceIdsForBackup_({
    questions: [{ id: '2026-P1-01', question: '題幹' }, { id: '', question: '沒有編號' }],
    referenceIds: ['2026-P1-01', 'not-sent']
  }, null, 'filter');
  if (filterIds.join('|') !== '2026-P1-01') throw new Error('ref_ids_filter');
  var singleIds = referenceIdsForBackup_({
    questions: [{ id: '2026-P1-01', question: '題幹' }]
  }, null, 'single');
  if (singleIds.join('|') !== '2026-P1-01') throw new Error('ref_ids_single');
  if (referenceIdsForBackup_({
    questions: [{ id: 'fake', question: '貼上' }],
    referenceIds: ['fake']
  }, null, 'paste').length !== 0) throw new Error('ref_ids_paste');
  var parsedIds = parseAiBackupJson_(JSON.stringify({
    action: 'generateQuestions',
    source: 'filter',
    referenceIds: ['2026-P1-01', '2026-P1-01', ''],
    content: 'ok'
  }), '20260101-000000-000-generateQuestions-abcd1234.json');
  if (!parsedIds || !parsedIds.referenceIds || parsedIds.referenceIds.join('|') !== '2026-P1-01') {
    throw new Error('ai_backup_ref_ids');
  }
  var parsedOld = parseAiBackupJson_(JSON.stringify({
    action: 'generateQuestions',
    source: 'filter',
    content: 'ok'
  }), '20260101-000000-000-generateQuestions-abcd1234.json');
  if (!parsedOld || !parsedOld.referenceIds || parsedOld.referenceIds.length !== 0) {
    throw new Error('ai_backup_ref_ids_missing');
  }
  if (requestId_('abc12345') !== 'abc12345') throw new Error('request_id_ok');
  if (requestId_('short') !== '') throw new Error('request_id_short');
  if (requestId_('../nope') !== '') throw new Error('request_id_bad');
  var parsedReq = parseAiBackupJson_(JSON.stringify({
    action: 'generateQuestions',
    source: 'filter',
    content: 'ok',
    requestId: 'abc12345xyz'
  }), '20260101-000000-000-generateQuestions-abcd1234.json');
  if (!parsedReq || parsedReq.requestId !== 'abc12345xyz') throw new Error('ai_backup_request_id');

  if (aiUsageRecordUsers_().join('|') !== 'ryan|user57') throw new Error('usage_users');
  if (!aiUsageOwnerAllowed_('Ryan') || !aiUsageOwnerAllowed_('user57')) throw new Error('usage_allow');
  if (aiUsageOwnerAllowed_('ken') || aiUsageOwnerAllowed_('woody') || aiUsageOwnerAllowed_('lydia')) throw new Error('usage_deny');
  if (aiUsageOwnerAllowed_('mas') || aiUsageOwnerAllowed_('sarah') || aiUsageOwnerAllowed_('vicky')) throw new Error('usage_deny_rest');
  var usageRow = usageRecordFromBackup_({
    action: 'generateQuestions',
    name: 'file.json',
    model: 'm',
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'filter',
    referenceSource: 'filter',
    modeId: '',
    modeName: '',
    instruction: '',
    content: 'stem',
    referenceIds: ['2026-P1-01'],
    poeApiKey: 'secret-key'
  }, 'ryan');
  if (!usageRow || usageRow.username !== 'ryan' || !usageRow.referenceIds || usageRow.referenceIds.join('|') !== '2026-P1-01') {
    throw new Error('usage_row');
  }
  if (usageRow.content) throw new Error('usage_row_full_content');
  if (usageRow.lean !== true || usageRow.contentPreview !== 'stem' || usageRow.contentChars !== 4) {
    throw new Error('usage_row_lean');
  }
  if (usageRow.poeApiKey || JSON.stringify(usageRow).indexOf('secret-key') !== -1) throw new Error('usage_row_secret');
  if (usageRecordFromBackup_(usageRow, 'woody')) throw new Error('usage_row_woody');
  if (usageRecordFromBackup_(usageRow, 'user57') && usageRecordFromBackup_(usageRow, 'user57').username !== 'user57') {
    throw new Error('usage_row_user57');
  }
  var bigReply = '';
  while (bigReply.length < CONTENT_SERVICE_INLINE_MAX_CHARS_ + 100) bigReply += '題目內容測試字串';
  var slim = finalizeGeneratePayload_({
    ok: true,
    content: bigReply,
    model: 'm',
    sentCount: 1,
    filteredCount: 1,
    gitBackup: true
  }, '20260101-000000-000-generateQuestions-abcd1234.json', 'abc12345xy');
  if (!slim.contentViaBackup || slim.content || !slim.backupName || slim.requestId !== 'abc12345xy') {
    throw new Error('finalize_defer');
  }
  if (slim.contentChars !== bigReply.length) throw new Error('finalize_chars');
  var inline = finalizeGeneratePayload_({
    ok: true,
    content: '短回覆',
    model: 'm',
    sentCount: 1,
    filteredCount: 1
  }, '', 'abc12345xy');
  if (inline.contentViaBackup || inline.content !== '短回覆') throw new Error('finalize_inline');
  var sliced = aiBackupContentSlice_('abcdefghij', 3, 4);
  if (sliced.content !== 'defg' || sliced.contentOffset !== 3 || sliced.contentChars !== 10 || sliced.contentComplete !== false) {
    throw new Error('backup_slice_mid');
  }
  var slicedEnd = aiBackupContentSlice_('abcdefghij', 8, 40);
  if (slicedEnd.content !== 'ij' || slicedEnd.contentComplete !== true) throw new Error('backup_slice_end');
  if (resolveAiBackupOwner_('ryan', {}) !== 'ryan') throw new Error('backup_owner_self');
  if (resolveAiBackupOwner_('', { owner: 'user57' }) !== '') throw new Error('backup_owner_blank');
  var leaked = gitOk_({
    sha: 'nope',
    path: '../x',
    token: 'secret-token',
    owner: 'someone',
    repo: 'private-data'
  });
  if (leaked.token || leaked.owner || leaked.repo || leaked.path || leaked.sha) throw new Error('response_leak');
  var kept = gitOk_({
    sha: '0123456789abcdef0123456789abcdef01234567',
    path: 'data/questions.json'
  });
  if (kept.path !== 'data/questions.json' || kept.sha !== '0123456789abcdef0123456789abcdef01234567') {
    throw new Error('response_keep');
  }
  var keptUser = gitOk_({
    sha: '0123456789abcdef0123456789abcdef01234567',
    path: 'users/example/data/questions.json'
  });
  if (keptUser.path !== 'users/example/data/questions.json') throw new Error('response_user_path');
  if (JSON.stringify(kept).indexOf('token') !== -1) throw new Error('response_token_key');
  var denied = gitClientError_('feature_unavailable');
  if (denied.ok !== false || denied.error !== 'feature_unavailable') throw new Error('client_error');
  var unknown = gitClientError_('token=abc owner=someone');
  if (unknown.error !== 'github_error' || JSON.stringify(unknown).indexOf('someone') !== -1) throw new Error('client_error_redacted');
  var packed = questionPayloadText_({ questions: [{ id: 'A', examination: 'DSE' }] });
  var parsed = JSON.parse(packed);
  if (parsed.questionCount !== 1 || parsed.questions[0].id !== 'A') throw new Error('payload_shape');
  try {
    questionPayloadText_({ nope: true });
    throw new Error('payload_should_fail');
  } catch (err) {
    if (!err || err.code !== 'bad_request') throw err;
  }
  if (readBankSchemaVersion_(null) !== 0) throw new Error('schema_missing');
  if (readBankSchemaVersion_({}) !== 0) throw new Error('schema_empty');
  if (readBankSchemaVersion_({ schemaVersion: 2 }) !== 2) throw new Error('schema_int');
  if (readBankSchemaVersion_({ schemaVersion: '3' }) !== 3) throw new Error('schema_string');
  if (readBankSchemaVersion_({ schemaVersion: -1 }) !== 0) throw new Error('schema_negative');
  if (gitClientError_('schema_version_stale').error !== 'schema_version_stale') {
    throw new Error('schema_error_code');
  }
  var stale = gitClientError_('schema_version_stale', {
    clientSchemaVersion: 1,
    cloudSchemaVersion: 2
  });
  if (stale.clientSchemaVersion !== 1 || stale.cloudSchemaVersion !== 2) {
    throw new Error('schema_error_meta');
  }
  var rewritten = JSON.parse(questionPayloadText_({
    version: '1.0',
    schemaVersion: 2,
    extraKeep: true,
    questions: [{ id: 'x' }]
  }, {
    schemaVersion: 1,
    cloudOnly: 'keep-me',
    questions: [{ id: 'old' }]
  }));
  if (rewritten.schemaVersion !== 2) throw new Error('schema_write_client');
  if (rewritten.cloudOnly !== 'keep-me') throw new Error('schema_write_cloud_field');
  if (rewritten.extraKeep !== true) throw new Error('schema_write_client_field');
  if (!rewritten.questions || rewritten.questions[0].id !== 'x') throw new Error('schema_write_questions');
  var okWithSchema = gitOk_({
    sha: '0123456789abcdef0123456789abcdef01234567',
    path: 'shared/data/database.json',
    schemaVersion: 2
  });
  if (okWithSchema.schemaVersion !== 2) throw new Error('schema_ok_passthrough');
  if (clipChars_('甲乙丙', 2) !== '甲乙') throw new Error('clip_chars');
  if (githubSharedPrefix_({ sharedPrefix: '' }) !== 'shared') throw new Error('shared_prefix_default');
  if (githubSharedPrefix_({ sharedPrefix: 'users' })) throw new Error('shared_prefix_users');
  if (githubSharedPrefix_({ sharedPrefix: 'users/example' })) throw new Error('shared_prefix_users_child');
  if (githubSharedPrefix_({ sharedPrefix: 'shared' }) !== 'shared') throw new Error('shared_prefix_explicit');
  if (!githubSharedRelOk_('data/database.json')) throw new Error('shared_json');
  if (!githubSharedRelOk_('data/database-hkeaa.json')) throw new Error('shared_json_hkeaa');
  if (!githubSharedRelOk_('data/database-aristo.json')) throw new Error('shared_json_aristo');
  if (!githubSharedRelOk_('diagrams/MT27-P1-24.jpg')) throw new Error('shared_diagram');
  if (!githubSharedRelOk_('originals/dse/2019/q-p1-41.jpg')) throw new Error('shared_original');
  if (!githubSharedRelOk_('papers/mock-tests/Mock Test 27 Paper 1.pdf')) throw new Error('shared_mock_name');
  if (!githubSharedRelOk_('papers/past-papers/DSE 2012 (Chi).pdf')) throw new Error('shared_past_name');
  if (!githubSharedRelOk_('papers/mock-tests/模擬試卷三十 卷二.pdf')) throw new Error('shared_mock_cjk');
  if (githubSharedRelOk_('users/example/data/questions.json')) throw new Error('shared_blocks_users');
  if (githubSharedRelOk_('../users/example/data/questions.json')) throw new Error('shared_blocks_dotdot');
  if (githubSharedRelOk_('diagrams/../../users/example/x.json')) throw new Error('shared_blocks_nested_dotdot');
  if (githubSharedRelOk_('/diagrams/a.jpg')) throw new Error('shared_blocks_abs');
  if (githubSharedRelOk_('diagrams/a.exe')) throw new Error('shared_blocks_ext');
  if (!githubSharedDirOk_('')) throw new Error('shared_dir_root');
  if (!githubSharedDirOk_('papers/mock-tests')) throw new Error('shared_dir_papers');
  if (githubSharedDirOk_('users')) throw new Error('shared_dir_users');
  if (githubSharedDirOk_('papers/../users')) throw new Error('shared_dir_escape');
  if (githubSharedFilePath_({ sharedPrefix: '' }, 'diagrams/MT27-P1-24.jpg') !== 'shared/diagrams/MT27-P1-24.jpg') {
    throw new Error('shared_file_path');
  }
  if (githubSharedFilePath_({ sharedPrefix: 'shared' }, 'papers/past-papers/DSE 2012 (Chi).pdf') !== 'shared/papers/past-papers/DSE 2012 (Chi).pdf') {
    throw new Error('shared_paper_path');
  }
  if (githubSharedFilePath_({ sharedPrefix: 'shared' }, 'users/example/data/questions.json')) throw new Error('shared_file_users');
  if (githubSharedDirPath_({ sharedPrefix: 'shared' }, '') !== 'shared') throw new Error('shared_dir_path_root');
  if (githubSharedDirPath_({ sharedPrefix: 'shared' }, 'originals/27') !== 'shared/originals/27') throw new Error('shared_dir_path_child');
  var sampleCfg = { token: 't', owner: 'example-user', repo: 'example-repo', branch: 'main', sharedPrefix: '' };
  if (!githubSharedReady_(sampleCfg)) throw new Error('shared_ready');
  if (githubSharedReady_({ token: '', owner: 'example-user', repo: 'example-repo', branch: 'main', sharedPrefix: 'shared' })) {
    throw new Error('shared_ready_token');
  }
  var sharedOut = sharedClientOk_({
    path: 'diagrams/MT27-P1-24.jpg',
    encoding: 'base64',
    mediaType: 'image/jpeg',
    bytes: 12,
    content: 'aaaa',
    token: 'secret-token',
    owner: 'someone',
    repo: 'private-data'
  });
  if (sharedOut.token || sharedOut.owner || sharedOut.repo) throw new Error('shared_response_leak');
  if (sharedOut.path !== 'diagrams/MT27-P1-24.jpg' || sharedOut.encoding !== 'base64') throw new Error('shared_response_keep');
  if (JSON.stringify(sharedOut).indexOf('secret-token') !== -1) throw new Error('shared_response_secret');
  if (JSON.stringify(sharedOut).indexOf('private-data') !== -1) throw new Error('shared_response_repo');
  console.log('selfTestGitPaths ok');
}

// === Small utilities / logging / JSON response ===

function props_() {
  return PropertiesService.getScriptProperties();
}

function parseBody_(e) {
  if (!e) return {};
  var raw = '';
  if (e.postData && e.postData.contents) raw = e.postData.contents;
  if (!raw && e.parameter && e.parameter.payload) raw = e.parameter.payload;
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

// Hashes may be comma-, newline-, or space-separated.
function parseList_(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map(function (part) { return String(part || '').trim(); })
    .filter(Boolean);
}

function normalizeUsername_(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    var hex = value.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function clip_(value, max) {
  return String(value == null ? '' : value).replace(/\s+$/g, '').trim().slice(0, max);
}

function positiveInt_(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return fallback;
  return Math.round(number);
}

function nonNegativeInt_(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  var number = Number(value);
  if (!isFinite(number) || number < 0) return fallback;
  return Math.round(number);
}

function clampInt_(value, fallback, max) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.round(number), max);
}

function optionalNumber_(name) {
  var raw = props_().getProperty(name);
  if (raw == null || String(raw).trim() === '') return null;
  var number = Number(raw);
  return isFinite(number) ? number : null;
}

function numberOrNull_(value) {
  var number = Number(value);
  return isFinite(number) ? number : null;
}

function startOfToday_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  var day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return Utilities.parseDate(day + ' 00:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
}

function classifyFetchError_(err) {
  if (err && err.code === 'upstream_timeout') return 'upstream_timeout';
  if (err && err.code === 'upstream_error') return 'upstream_error';
  var msg = String(err && err.message || err || '').toLowerCase();
  if (msg.indexOf('timeout') !== -1 || msg.indexOf('timed out') !== -1) return 'upstream_timeout';
  return 'upstream_error';
}

// Build client-facing upstream failure fields from a thrown UrlFetch error.
// Keeps error as a stable code; passes Poe/OpenRouter HTTP status and error.type through.
function upstreamFailurePayload_(err) {
  var code = classifyFetchError_(err);
  var httpStatus = null;
  if (err && err.httpStatus != null && isFinite(Number(err.httpStatus))) {
    httpStatus = Math.round(Number(err.httpStatus));
  }
  var upstreamType = '';
  if (err && err.upstreamType != null) {
    upstreamType = String(err.upstreamType).trim().slice(0, 80);
  }
  var upstreamDetail = '';
  if (err && err.upstreamMessage != null) {
    upstreamDetail = clip_(err.upstreamMessage, 200);
  }
  return {
    ok: false,
    error: code,
    httpStatus: httpStatus,
    upstreamType: upstreamType,
    upstreamDetail: upstreamDetail
  };
}

function mergeUpstreamFailureMeta_(meta, err) {
  var payload = upstreamFailurePayload_(err);
  var out = meta || {};
  out.error = payload.error;
  if (payload.httpStatus != null) out.httpStatus = payload.httpStatus;
  if (payload.upstreamType) out.upstreamType = payload.upstreamType;
  if (payload.upstreamDetail) out.upstreamDetail = payload.upstreamDetail;
  return out;
}

function safeLog_(err) {
  var msg = String(err && err.stack || err && err.message || err || '');
  var secrets = [
    props_().getProperty('POE_API_KEY'),
    props_().getProperty('OPENROUTER_API_KEY'),
    props_().getProperty('GITHUB_TOKEN'),
    props_().getProperty('GITHUB_READ_TOKEN'),
    props_().getProperty('GITHUB_APP_PRIVATE_KEY')
  ];
  secrets.forEach(function (secret) {
    var value = String(secret || '').trim();
    if (value && msg.indexOf(value) !== -1) msg = msg.split(value).join('[redacted]');
  });
  // Never echo a client-supplied key either (may appear in rare UrlFetch failures).
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [redacted]');
  msg = msg.replace(/"poeApiKey"\s*:\s*"[^"]*"/g, '"poeApiKey":"[redacted]"');
  msg = msg.replace(/poeApiKey[=:]\s*\S+/gi, 'poeApiKey=[redacted]');
  msg = msg.replace(/"openRouterApiKey"\s*:\s*"[^"]*"/g, '"openRouterApiKey":"[redacted]"');
  msg = msg.replace(/openRouterApiKey[=:]\s*\S+/gi, 'openRouterApiKey=[redacted]');
  msg = msg.replace(/https:\/\/api\.github\.com\/repos\/\S+/g, 'https://api.github.com/repos/[redacted]');
  console.error(msg.slice(0, 1000));
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
