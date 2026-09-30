/**
 * Poe question-generation proxy and private GitHub sync for econ-database.
 *
 * The public site never sees the Poe API key, the GitHub token, the GitHub
 * account, or the private repository name, and it never sees who is allowed
 * to use these features. All of that lives only in Script properties:
 *   POE_API_KEY
 *   ALLOWED_USER_HASHES  (production: SHA-256 hex from the spreadsheet menu)
 *   ALLOWED_USERS        (legacy/dev only; leave unset in production)
 *   GITHUB_TOKEN
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH        (optional; main when empty)
 *   GITHUB_DATA_PATH     (inside each user's folder; shape data/questions.json)
 *   GITHUB_AI_BACKUP_DIR (inside each user's folder; shape ai-backups)
 *
 * Question uploads and model-reply files are stored per user:
 *   users/<username>/<GITHUB_DATA_PATH>
 *   users/<username>/<GITHUB_AI_BACKUP_DIR>/<timestamp>-….json
 * <username> is the trimmed, lowercased signed-in name. Spaces become hyphens.
 * The browser does not choose the path and never sees the owner or repository.
 *
 * Least privilege (admin):
 * - Deploy the web app as "Execute as: Me" (the account that owns the key
 *   and can edit this spreadsheet). Confirm "Who has access: Anyone".
 *   The public site has no Google sign-in, so anonymous access is required.
 *   This script still refuses Poe and GitHub calls unless the username is allowed.
 * - Do not put the key, the token, the owner, the repository name, or the
 *   real allowlist in the sheet, this repo, or the page.
 * - urlFetchWhitelist in appsscript.json limits outbound calls to api.poe.com
 *   and api.github.com. The browser never calls either host with a secret.
 * - UsageLog is created on first write. Protect that tab so casual editors
 *   cannot wipe the audit trail. The deploying account can still append.
 * - GenerationBackup is a separate tab. Successful generateQuestions and
 *   testModel calls append the model reply there. Protect that tab too.
 *   Do not point BACKUP_SHEET_NAME at UsageLog or a data tab.
 * - The spreadsheet may currently be shared with edit access. Narrow that
 *   share when you can. Visitors do not need sheet access; the web app
 *   writes the log as the deploying account.
 * - Production allowlist is ALLOWED_USER_HASHES only. In the bound
 *   spreadsheet use 出題代理 → 計算使用者名稱雜湊. Paste each username in
 *   that private dialog, then copy the hash into the property (comma,
 *   newline, or space separated). Do not commit those hashes. ALLOWED_USERS is
 *   legacy/dev only; remove it from the production project.
 * - Script property changes apply immediately. Code changes need a new
 *   deployment version (Manage deployments → Edit → New version) so the
 *   existing /exec URL keeps working.
 * - Bind this project to the log spreadsheet (Extensions → Apps Script)
 *   or set SPREADSHEET_ID. Do not point LOG_SHEET_NAME at a data tab.
 * - GitHub responses to the browser are ok/error, plus a commit sha and the
 *   configured relative path. They never include the token, owner, or repo.
 */

var POE_CHAT_URL_ = 'https://api.poe.com/v1/chat/completions';
var POE_DEFAULT_MODEL_ = 'Claude-Sonnet-5.5';
// Client model strings outside this list are ignored. Keep in sync with
// POE_MODELS in js/poeGenerateModal.js.
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
    gitConfigured: githubDataReady_(git) && githubBackupReady_(git)
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
  if (action === 'checkAccess') return handleCheck_(body);
  if (action === 'generateQuestions') return handleGenerate_(body);
  if (action === 'syncDataUpload') return handleGitUpload_(body);
  if (action === 'syncDataDownload') return handleGitDownload_(body);
  if (action === 'testModel') return handleTest_(body);
  return { ok: false, error: 'bad_request' };
}

function handleCheck_(body) {
  var username = normalizeUsername_(body.username);
  if (!username) return { ok: true, allowed: false };
  return { ok: true, allowed: isAllowed_(username) };
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

function referenceSource_(value) {
  return String(value || '') === 'paste' ? 'paste' : 'filter';
}

function handleGenerate_(body) {
  var username = normalizeUsername_(body.username);
  var source = referenceSource_(body && body.source);
  if (!username || !isAllowed_(username)) {
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

  var apiKey = String(props_().getProperty('POE_API_KEY') || '').trim();
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'generateQuestions',
      success: false,
      metadata: { error: 'proxy_not_configured', source: source }
    }, true);
    return { ok: false, error: 'proxy_not_configured' };
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

  var model = resolveModel_(body.model);
  var modeId = resolveModeId_(body.modeId);
  var instructionMeta = instructionMeta_(body.instruction);
  var started = Date.now();
  try {
    var completion = requestCompletion_(apiKey, model, buildPrompt_(packed.questions, filteredCount, packed.truncated, instructionMeta.text), POE_SYSTEM_PROMPT_);
    var durationMs = Date.now() - started;
    var gitBackup = false;
    try {
      gitBackup = writeGitAiBackup_({
        action: 'generateQuestions',
        username: username,
        model: completion.model || model,
        content: completion.content,
        sentCount: packed.questions.length,
        filteredCount: filteredCount,
        durationMs: durationMs,
        source: source
      }) === true;
    } catch (backupErr) {
      safeLog_(backupErr);
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
    var generateMeta = {
      model: result.model,
      requestedModel: model,
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
      metadata: {
        requestedModel: model,
        durationMs: durationMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        instructionChars: instructionMeta.chars,
        instructionProvidedChars: instructionMeta.providedChars,
        customInstruction: instructionMeta.custom,
        referencesTruncated: packed.truncated,
        source: source,
        gitBackup: gitBackup
      }
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
  if (!username || !isAllowed_(username)) {
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

  var apiKey = String(props_().getProperty('POE_API_KEY') || '').trim();
  if (!apiKey) {
    writeLog_({
      username: username,
      action: 'testModel',
      success: false,
      metadata: { error: 'proxy_not_configured' }
    }, true);
    return { ok: false, error: 'proxy_not_configured' };
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

  var model = resolveModel_(body.model);
  var started = Date.now();
  try {
    var completion = requestCompletion_(apiKey, model, POE_TEST_USER_PROMPT_, POE_TEST_SYSTEM_PROMPT_);
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
        durationMs: Date.now() - started
      }
    }, true);
    return { ok: false, error: code };
  }
}

function buildPrompt_(questions, filteredCount, truncated, instruction) {
  var lines = [instruction || POE_INSTRUCTION_, ''];
  if (truncated || questions.length < filteredCount) {
    lines.push('（篩選結果共有 ' + filteredCount + ' 題，以下只附上 ' + questions.length + ' 題作為風格、用字與句式的參考。）');
    lines.push('');
  }
  lines.push('以下為參考題目。請撰寫全新題目，不要逐句抄寫參考題。');
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

function requestCompletion_(apiKey, model, userPrompt, systemPrompt) {
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

  var response = UrlFetchApp.fetch(POE_CHAT_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
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

function isAllowed_(username) {
  var digest = sha256Hex_(username);
  var allowed = {};
  parseList_(props_().getProperty('ALLOWED_USER_HASHES')).forEach(function (hash) {
    var normalized = String(hash || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(normalized)) allowed[normalized] = true;
  });
  parseList_(props_().getProperty('ALLOWED_USERS')).forEach(function (name) {
    var normalized = normalizeUsername_(name);
    if (normalized) allowed[sha256Hex_(normalized)] = true;
  });
  return allowed[digest] === true;
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

function isAllowedModel_(value) {
  var name = String(value || '').trim();
  for (var i = 0; i < POE_ALLOWED_MODELS_.length; i++) {
    if (POE_ALLOWED_MODELS_[i] === name) return true;
  }
  return false;
}

// Allowlisted client model wins. A missing model may use POE_MODEL when that
// property is itself allowlisted. Any other string falls back to the default.
function resolveModel_(requested) {
  var value = String(requested == null ? '' : requested).trim();
  if (isAllowedModel_(value)) return value;
  if (!value) {
    var fromProperty = String(props_().getProperty('POE_MODEL') || '').trim();
    if (isAllowedModel_(fromProperty)) return fromProperty;
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
// username. Paste that hex into Script property ALLOWED_USER_HASHES
// (comma-, newline-, or space-separated). Do not store the username itself there.
function promptUsernameHash() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '計算雜湊',
    '輸入一個使用者名稱。程式會去掉首尾空白並轉成小寫，然後只顯示雜湊。把雜湊貼到指令碼屬性 ALLOWED_USER_HASHES（可用逗號、換行或空格分隔多個）。不要把使用者名稱寫進屬性。',
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
  isAllowed_('sample_user');
  var listed = parseList_('aa bb\tcc,dd;ee\nff\rgg  ,  hh');
  if (listed.join('|') !== 'aa|bb|cc|dd|ee|ff|gg|hh') throw new Error('parse_list_separators');
  if (parseList_('  , ;\n\t').length !== 0) throw new Error('parse_list_empty');
  if (referenceSource_('paste') !== 'paste') throw new Error('source_paste');
  if (referenceSource_('filter') !== 'filter') throw new Error('source_filter');
  if (referenceSource_('other') !== 'filter') throw new Error('source_other');
  if (referenceSource_(null) !== 'filter') throw new Error('source_empty');
  if (resolveModel_('GPT-6.1-Sol') !== 'GPT-6.1-Sol') throw new Error('model_allow');
  if (resolveModel_('  Gemini-3.8-Flash ') !== 'Gemini-3.8-Flash') throw new Error('model_trim');
  if (resolveModel_('Claude-Sonnet-4.6') !== POE_DEFAULT_MODEL_) throw new Error('model_reject');
  var emptyModel = resolveModel_('');
  var propertyModel = String(props_().getProperty('POE_MODEL') || '').trim();
  var expectedEmpty = isAllowedModel_(propertyModel) ? propertyModel : POE_DEFAULT_MODEL_;
  if (emptyModel !== expectedEmpty) throw new Error('model_empty_fallback');
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
  console.log('selfTestPromptShape ok');
}

// GitHub identity stays in Script properties. Callers are allowlisted first.
// Files that fit the Contents API are written with that API. Larger question
// banks use the Git Data API (blob, tree, commit, ref), which the same
// fine-grained Contents permission allows. Neither path is called from the browser.
var GITHUB_CONTENTS_MAX_BYTES_ = 900000;
var GITHUB_DATA_MAX_BYTES_ = 12000000;
var GITHUB_MAX_QUESTIONS_ = 20000;
var GITHUB_REPLY_MAX_CHARS_ = 1000000;

function handleGitUpload_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !isAllowed_(username)) return gitClientError_('feature_unavailable');
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
  var dataPath = githubUserDataPath_(cfg, username);
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
      metadata: { error: code }
    }, true);
    return gitClientError_(code);
  }
}

function handleGitDownload_(body) {
  var username = normalizeUsername_(body.username);
  if (!username || !isAllowed_(username)) return gitClientError_('feature_unavailable');
  var cfg = githubConfig_();
  if (!githubDataReady_(cfg)) return gitClientError_('github_not_configured');
  var dataPath = githubUserDataPath_(cfg, username);
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
  var text = JSON.stringify({
    action: action,
    username: String(info.username || ''),
    model: String(info.model || ''),
    createdAt: new Date().toISOString(),
    sentCount: numberOrNull_(info.sentCount),
    filteredCount: numberOrNull_(info.filteredCount),
    durationMs: numberOrNull_(info.durationMs),
    source: action === 'generateQuestions' ? referenceSource_(info.source) : '',
    content: reply
  });
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
    backupDir: String(stored.getProperty('GITHUB_AI_BACKUP_DIR') || '').trim()
  };
}

function githubDataReady_(cfg) {
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo) && githubBranchOk_(cfg.branch) && githubPathOk_(cfg.dataPath));
}

function githubBackupReady_(cfg) {
  var dir = String(cfg && cfg.backupDir || '').replace(/^\/+|\/+$/g, '');
  return !!(cfg && cfg.token && githubIdentOk_(cfg.owner) && githubIdentOk_(cfg.repo) && githubBranchOk_(cfg.branch) && githubPathOk_(dir));
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

// Folder name for one allowlisted user. The signed-in name is trimmed and
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

function githubUserDataPath_(cfg, username) {
  var segment = githubUserSegment_(username);
  var rel = String(cfg && cfg.dataPath || '').replace(/^\/+|\/+$/g, '');
  if (!segment || !githubPathOk_(rel)) return '';
  return joinGithubPath_('users/' + segment, rel);
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
    content: encodeGithubBase64_(text),
    encoding: 'base64'
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
  return githubRepoPrefix_(cfg) + '/git/ref/heads/' + branch;
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
  if (githubUserDataPath_({ dataPath: 'data/questions.json' }, 'Example') !== 'users/example/data/questions.json') {
    throw new Error('user_data_path');
  }
  if (githubUserDataPath_({ dataPath: '../questions.json' }, 'example')) throw new Error('user_data_escape');
  if (githubUserBackupDir_({ backupDir: 'ai-backups' }, 'Example') !== 'users/example/ai-backups') {
    throw new Error('user_backup_dir');
  }
  if (joinGithubPath_(githubUserBackupDir_({ backupDir: 'ai-backups' }, 'example'), '20260101-000000-000-generateQuestions-abcd1234.json') !== 'users/example/ai-backups/20260101-000000-000-generateQuestions-abcd1234.json') {
    throw new Error('user_backup_file');
  }
  if (githubUserDataPath_({ dataPath: 'data/questions.json' }, 'a/b')) throw new Error('user_data_slash');
  if (backupFileAction_('generateQuestions') !== 'generateQuestions') throw new Error('backup_generate');
  if (backupFileAction_('testModel') !== 'testModel') throw new Error('backup_test_model');
  if (backupFileAction_('login') !== 'reply') throw new Error('backup_other');
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
    props_().getProperty('GITHUB_TOKEN')
  ];
  secrets.forEach(function (secret) {
    var value = String(secret || '').trim();
    if (value && msg.indexOf(value) !== -1) msg = msg.split(value).join('[redacted]');
  });
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [redacted]');
  msg = msg.replace(/https:\/\/api\.github\.com\/repos\/\S+/g, 'https://api.github.com/repos/[redacted]');
  console.error(msg.slice(0, 1000));
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
