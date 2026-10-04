/**
 * Poe question-generation proxy and private GitHub sync for econ-database.
 *
 * The public site never receives the server Poe API key, the GitHub token, the GitHub
 * account, or the private repository name, and it never sees who is allowed
 * to use these features. All of that lives only in Script properties:
 *   POE_API_KEY                (shared Poe fallback for admin only; see resolveApiKey_)
 *   OPENROUTER_API_KEY         (optional shared OpenRouter fallback for admin only)
 *   ALLOWED_ADMIN_HASHES       (SHA-256 hex; full rights)
 *   ALLOWED_AI_HASHES          (SHA-256 hex; AI出題 and mock tests, no GitHub)
 *   ALLOWED_RESTRICTED_HASHES  (SHA-256 hex; browse without mock tests, AI, or GitHub)
 *   GITHUB_TOKEN
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH        (optional; main when empty)
 *   GITHUB_DATA_PATH     (under shared prefix; shape data/database.json → shared/data/database.json)
 *   GITHUB_AI_BACKUP_DIR (inside each user's folder; shape ai-backups)
 *   GITHUB_SHARED_PREFIX (optional; shared when empty)
 *
 * Question-bank upload/download is shared for every githubSync user:
 *   <GITHUB_SHARED_PREFIX>/<GITHUB_DATA_PATH>
 *   e.g. shared/data/database.json
 * Username is required for auth only and must not appear in the bank path.
 * Bank paths under users/ are rejected.
 * Model-reply (AI出題) backups stay personal:
 *   users/<username>/<GITHUB_AI_BACKUP_DIR>/<timestamp>-….json
 * <username> is the trimmed, lowercased signed-in name. Spaces become hyphens.
 * The browser does not choose that path and never sees the owner or repository.
 * listAiUsageRecords is admin-only. It reads those same backup files for the
 * fixed folders in AI_USAGE_RECORD_USERS_ and ignores any other name in the request.
 * listAiBackups and listAiUsageRecords each return one page of AI_BACKUP_LIST_MAX_
 * generateQuestions files, newest first. Pass after / afterName to continue.
 * The request still cannot choose other users.
 *
 * Shared diagrams, the question bank, and paper packs live under the same prefix.
 * GITHUB_SHARED_PREFIX defaults to shared. The site asks for a relative path
 * such as data/database.json, diagrams/…, originals/…, or papers/….
 * The script reads <prefix>/<relative path> and will not read users/.
 * A static host such as GitHub Pages cannot read a private repository:
 * raw file URLs for a private repo answer 404 unless a token is sent, and
 * the token stays in Script properties. fetchSharedAsset and listSharedData
 * are the only browser path to those files.
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
 * - GenerationBackup is a separate tab. Successful generateQuestions and
 *   testModel calls append the model reply there. Protect that tab too.
 *   Do not point BACKUP_SHEET_NAME at UsageLog or a data tab.
 * - The spreadsheet may currently be shared with edit access. Narrow that
 *   share when you can. Visitors do not need sheet access; the web app
 *   writes the log as the deploying account.
 * - Production allowlists are hash-only. In the bound spreadsheet use
 *   出題代理 → 計算使用者名稱雜湊. Paste each username in that private
 *   dialog, then copy the hex into exactly one of ALLOWED_ADMIN_HASHES,
 *   ALLOWED_AI_HASHES, or ALLOWED_RESTRICTED_HASHES (comma, newline, or
 *   space separated). Do not commit those hashes or the usernames.
 *   ALLOWED_USER_HASHES and ALLOWED_USERS are not read. Delete them.
 * - Script property changes apply immediately. Code changes need a new
 *   deployment version (Manage deployments → Edit → New version) so the
 *   existing /exec URL keeps working.
 * - Bind this project to the log spreadsheet (Extensions → Apps Script)
 *   or set SPREADSHEET_ID. Do not point LOG_SHEET_NAME at a data tab.
 * - GitHub responses to the browser are ok/error, plus a commit sha and the
 *   configured relative path. They never include the token, owner, or repo.
 */

var POE_CHAT_URL_ = 'https://api.poe.com/v1/chat/completions';
var OPENROUTER_CHAT_URL_ = 'https://openrouter.ai/api/v1/chat/completions';
var POE_DEFAULT_MODEL_ = 'Claude-Sonnet-5.5';
var OPENROUTER_DEFAULT_MODEL_ = 'openai/gpt-4o-mini';
var OPENROUTER_MODEL_MAX_ = 120;
var POE_MODEL_MAX_ = 120;
// Dropdown presets for Poe (keep in sync with POE_MODELS in js/poeGenerateModal.js).
// Clients may also send a sanitized free-text Poe bot id (isAllowedPoeModelId_).
// OpenRouter accepts free-text ids (validated by isAllowedOpenRouterModel_).
var POE_ALLOWED_MODELS_ = ['Claude-Sonnet-5.5', 'GPT-6.1-Sol', 'Gemini-3.8-Flash'];
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

function doGet() {
  var key = String(props_().getProperty('POE_API_KEY') || '').trim();
  var git = githubConfig_();
  return json_({
    ok: true,
    service: 'question-proxy',
    configured: key.length > 0,
    gitConfigured: githubDataReady_(git) && githubBackupReady_(git),
    sharedConfigured: githubSharedReady_(git)
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
  if (action === 'syncDataUpload') return handleGitUpload_(body);
  if (action === 'syncDataDownload') return handleGitDownload_(body);
  if (action === 'fetchSharedAsset') return handleFetchShared_(body);
  if (action === 'listSharedData') return handleListShared_(body);
  if (action === 'listAiBackups') return handleListAiBackups_(body);
  if (action === 'getAiBackup') return handleGetAiBackup_(body);
  if (action === 'listAiUsageRecords') return handleListAiUsageRecords_(body);
  if (action === 'testModel') return handleTest_(body);
  return { ok: false, error: 'bad_request' };
}

function handleCheck_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return rightsResponse_(null);
  return rightsResponse_(lookupRights_(username));
}

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
    var requestId = requestId_(body && body.requestId);
    // Leave time to answer. A backup written after the cap kills the return,
    // and the browser then has to read that same personal backup back.
    if (executionMsLeft_(invokedAt) > 45000) {
      try {
        gitBackup = writeGitAiBackup_({
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
        }) === true;
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
      gitBackup: gitBackup
    };
    if (executionMsLeft_(invokedAt) <= 25000) return result;
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
    return result;
  } catch (err) {
    releaseIntervalSlot_(username);
    var code = classifyFetchError_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: {
        error: code,
        model: model,
        provider: provider,
        modeId: modeId,
        sentCount: packed.questions.length,
        durationMs: Date.now() - started,
        instructionChars: instructionMeta.chars,
        instructionProvidedChars: instructionMeta.providedChars,
        customInstruction: instructionMeta.custom,
        source: source
      }
    }, true);
    return { ok: false, error: code };
  }
}

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
    try {
      gitBackup = writeGitAiBackup_({
        action: 'testModel',
        username: username,
        model: completion.model || model,
        content: completion.content,
        durationMs: durationMs
      }) === true;
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
    var code = classifyFetchError_(err);
    safeLog_(err);
    writeLog_({
      username: username,
      action: 'testModel',
      success: false,
      metadata: {
        error: code,
        model: model,
        provider: provider,
        durationMs: Date.now() - started
      }
    }, true);
    return { ok: false, error: code };
  }
}

function buildPrompt_(questions, filteredCount, truncated, instruction, source) {
  var lines = [instruction || POE_INSTRUCTION_, ''];
  var single = referenceSource_(source) === 'single';
  if (!single && (truncated || questions.length < filteredCount)) {
    lines.push('（篩選結果共有 ' + filteredCount + ' 題，以下只附上 ' + questions.length + ' 題作為風格、用字與句式的參考。）');
    lines.push('');
  }
  lines.push(single ? '以下只附上使用者指定的一題，包含題幹與答案（解釋）。請只根據這一題撰寫全新題目，不要假設還有其他篩選題，也不要逐句抄寫。' : '以下為參考題目。請撰寫全新題目，不要逐句抄寫參考題。');
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
    lines.push('解釋：');
    lines.push(q.explanation || '（沒有解釋）');
    lines.push('');
  });
  return lines.join('\n');
}

function requestCompletion_(apiKey, model, userPrompt, systemPrompt, provider) {
  provider = provider === 'openrouter' ? 'openrouter' : 'poe';
  var payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt || POE_SYSTEM_PROMPT_ },
      { role: 'user', content: userPrompt }
    ]
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
    var entry = {
      id: clip_(item.id, 80),
      examination: clip_(item.examination, 40),
      year: clip_(item.year, 20),
      questionType: clip_(item.questionType, 40),
      concepts: clip_(item.concepts, 300),
      question: question,
      explanation: clip_(item.explanation, 6000)
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

// `allowed` is only for public Pages builds that still check data.allowed.
// It mirrors githubSync only (admin). AI-only clients must use the `ai` flag.
// role flags and ignores this field.
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
      if (user !== username || action !== 'generateQuestions' || success !== 'success') continue;
      if (ts instanceof Date && ts.getTime() >= today) count++;
    }
    return count;
  } catch (err) {
    safeLog_(err);
    return 0;
  }
}

function intervalKey_(username, slot) {
  var prefix = slot === 'test' ? 'poe_test_iv_' : 'poe_iv_';
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
  if (sharedMockOnly_('papers/past-papers/file.pdf')) throw new Error('mock_path_past');
}

function selfTestPromptShape() {
  var sample = packReferences_([
    { id: 'SAMPLE-1', question: '測試題幹', explanation: '測試解釋', questionType: 'MC', concepts: '機會成本' }
  ], 5, 80000);
  var built = buildPrompt_(sample.questions, 1, false, sanitizeInstruction_(''));
  selfTestGitPaths();
  if (built.indexOf(POE_INSTRUCTION_) !== 0) throw new Error('instruction_mismatch');
  if (built.indexOf('測試題幹') === -1) throw new Error('missing_reference');
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
  if (singleBuilt.indexOf('測試題幹') === -1 || singleBuilt.indexOf('測試解釋') === -1) throw new Error('single_missing_qa');
  if (singleBuilt.indexOf('只附上使用者指定的一題') === -1) throw new Error('single_prompt_frame');
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

// Personal AI backup folders an admin may read via listAiUsageRecords.
// Not a role allowlist. Callers still need ALLOWED_ADMIN_HASHES.
// The request cannot add, remove, or rename these folders.
var AI_USAGE_RECORD_USERS_ = ['ryan', 'user57'];

function handleGitUpload_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).githubSync) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var text;
  try {
    text = questionPayloadText_(coerceJson_(body && body.data));
  } catch (err) {
    return gitClientError_(err && err.code ? err.code : 'bad_request');
  }
  var bytes = utf8Length_(text);
  if (bytes > GITHUB_DATA_MAX_BYTES_) return gitClientError_('payload_too_large');
  var dataPath = githubSharedBankPath_(cfg);
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
    try { count = JSON.parse(text).questionCount; } catch (ignore) { count = 0; }
    var written = githubWriteText_(cfg, dataPath, text, 'Update question data (' + count + ')');
    lock.releaseLock();
    held = false;
    writeLog_({
      username: username,
      action: 'syncDataUpload',
      success: true,
      metadata: { questionCount: count, bytes: bytes }
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
      action: 'syncDataUpload',
      success: false,
      metadata: { error: code , detail: clip_(err && err.message, 120) }
    }, true);
    return gitClientError_(code);
  }
}

function handleGitDownload_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).githubSync) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var dataPath = githubSharedBankPath_(cfg);
  if (!dataPath) return gitClientError_('github_error');
  try {
    var read = githubReadText_(cfg, dataPath);
    var parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (ignore) {
      return gitClientError_('github_error');
    }
    if (!parsed || typeof parsed !== 'object') return gitClientError_('github_error');
    writeLog_({
      username: username,
      action: 'syncDataDownload',
      success: true,
      metadata: { bytes: String(read.text || '').length }
    }, true);
    return gitOk_({ sha: read.sha, path: dataPath, data: parsed });
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
      backups.push(item);
    } else {
      hasMore = true;
      break;
    }
  }
  var nextAfter = backups.length ? String(backups[backups.length - 1].name || '') : '';
  return { backups: backups, hasMore: hasMore, nextAfter: nextAfter };
}


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


function handleGetAiBackup_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !lookupRights_(username).ai) return gitClientError_('feature_unavailable');
  if (!takeSharedReadSlot_(username)) return gitClientError_('rate_limited');
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return gitClientError_('github_not_found');
  var name = String(body.name || body.file || '').trim();
  var full = resolveUserAiBackupPath_(cfg, username, name);
  if (!full) return gitClientError_('bad_request');
  try {
    var read = githubReadText_(cfg, full);
    var item = parseAiBackupJson_(read && read.text, name);
    if (!item) return gitClientError_('github_error');
    return { ok: true, backup: item };
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
  return {
    username: name,
    name: String(item.name || ''),
    action: 'generateQuestions',
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
    content: item.content,
    referenceIds: item.referenceIds || []
  };
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

function writeGitAiBackup_(info) {
  var cfg = githubConfig_();
  if (!githubBackupReady_(cfg)) return false;
  var action = backupFileAction_(info.action);
  var tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss-SSS');
  var nonce = String(Utilities.getUuid() || '').replace(/-/g, '').slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(nonce)) nonce = '00000000';
  var backupDir = githubUserBackupDir_(cfg, info && info.username);
  if (!backupDir) return false;
  var path = joinGithubPath_(backupDir, stamp + '-' + action + '-' + nonce + '.json');
  if (!path) return false;
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
  if (!lock.tryLock(20000)) return false;
  try {
    githubWriteText_(cfg, path, text, 'Backup model reply');
    return true;
  } catch (err) {
    safeLog_(err);
    return false;
  } finally {
    lock.releaseLock();
  }
}

function githubConfig_() {
  var stored = props_();
  return {
    token: String(stored.getProperty('GITHUB_TOKEN') || '').trim(),
    owner: String(stored.getProperty('GITHUB_OWNER') || '').trim(),
    repo: String(stored.getProperty('GITHUB_REPO') || '').trim(),
    branch: String(stored.getProperty('GITHUB_BRANCH') || '').trim() || 'main',
    dataPath: String(stored.getProperty('GITHUB_DATA_PATH') || '').trim(),
    backupDir: String(stored.getProperty('GITHUB_AI_BACKUP_DIR') || '').trim(),
    sharedPrefix: String(stored.getProperty('GITHUB_SHARED_PREFIX') || '').trim()
  };
}

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

// Shared question-bank path for syncDataUpload / syncDataDownload.
// Joins GITHUB_SHARED_PREFIX (default shared) with GITHUB_DATA_PATH.
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

function questionPayloadText_(data) {
  var extracted = extractQuestions_(data);
  if (!extracted.ok) throw gitFail_(extracted.error);
  return JSON.stringify({
    version: '1.0',
    exportDate: new Date().toISOString(),
    questionCount: extracted.questions.length,
    questions: extracted.questions
  });
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
  return { ok: true, questions: questions };
}

function gitFail_(code) {
  var err = new Error(code || 'github_error');
  err.code = code || 'github_error';
  return err;
}

function gitClientError_(code) {
  var allowed = {
    feature_unavailable: true,
    github_not_configured: true,
    github_not_found: true,
    github_error: true,
    bad_request: true,
    payload_too_large: true,
    rate_limited: true,
    server_error: true
  };
  return { ok: false, error: allowed[code] ? code : 'github_error' };
}

function gitOk_(extra) {
  var out = { ok: true };
  if (!extra) return out;
  var sha = sanitizeSha_(extra.sha);
  if (sha) out.sha = sha;
  if (extra.path && githubPathOk_(extra.path)) out.path = extra.path;
  if (Object.prototype.hasOwnProperty.call(extra, 'data')) out.data = extra.data;
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
  if (usageRow.poeApiKey || JSON.stringify(usageRow).indexOf('secret-key') !== -1) throw new Error('usage_row_secret');
  if (usageRecordFromBackup_(usageRow, 'woody')) throw new Error('usage_row_woody');
  if (usageRecordFromBackup_(usageRow, 'user57') && usageRecordFromBackup_(usageRow, 'user57').username !== 'user57') {
    throw new Error('usage_row_user57');
  }
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
  if (clipChars_('甲乙丙', 2) !== '甲乙') throw new Error('clip_chars');
  if (githubSharedPrefix_({ sharedPrefix: '' }) !== 'shared') throw new Error('shared_prefix_default');
  if (githubSharedPrefix_({ sharedPrefix: 'users' })) throw new Error('shared_prefix_users');
  if (githubSharedPrefix_({ sharedPrefix: 'users/example' })) throw new Error('shared_prefix_users_child');
  if (githubSharedPrefix_({ sharedPrefix: 'shared' }) !== 'shared') throw new Error('shared_prefix_explicit');
  if (!githubSharedRelOk_('data/database.json')) throw new Error('shared_json');
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

function safeLog_(err) {
  var msg = String(err && err.stack || err && err.message || err || '');
  var secrets = [
    props_().getProperty('POE_API_KEY'),
    props_().getProperty('OPENROUTER_API_KEY'),
    props_().getProperty('GITHUB_TOKEN')
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
