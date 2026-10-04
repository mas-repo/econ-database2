// poeGenerateModal.js
// Modal for generating new questions from the current filters, or from one displayed question.
// The browser only talks to the Apps Script web app in config.js.
// Providers: Poe | OpenRouter. Script property POE_API_KEY is an admin-only
// shared fallback for Poe; optional OPENROUTER_API_KEY is the same for OpenRouter.
// Every other AI user must store their own key in localStorage and send it as
// `poeApiKey` or `openRouterApiKey` (never written to backups or logs).
// Provider, keys, models, modes, and the edited 出題指示 live in localStorage.
// API key / model / provider live in a separate settings modal (API／模型設定).
// Requests send `provider`, `model`, `instruction`, `modeId`, and the matching key.

(function () {
    // Mode prompts live in this one object. style-continue must stay identical
    // to POE_INSTRUCTION_ in apps-script/Code.gs. Names for those ids are
    // repeated there only so the backup sheet can label a row.
    var POE_GENERATION_MODES = [
        {
            id: 'style-continue',
            name: '風格延續・求新',
            prompt: '參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。'
        },
        {
            id: 'vary-examples',
            name: '改例子／數字',
            prompt: '參考以下題目，撰寫全新的題目。這次只需要修改例子或數字，不需要在題型上作出有新意的修改。請保持與參考題相同或非常接近的題型、問法結構與考點，只更換情境、例子或數字，使題目是新的，而不是原句複製。例子必須是中學生能夠理解的日常生活情境，不可包括過於深奧的科學知識或術語。請盡量提供最多的題目。每題都要提供問題與解釋。解釋請參考所附題目的風格、用字與句式。'
        },
        {
            id: 'add-novelty',
            name: '題型加新意',
            prompt: '建基於以下所篩選題目的現有題型，撰寫全新的題目，並在問法、切入角度或情境安排上加上適度的新意。請以參考題的題型為基礎，不要只替換例子或數字，也不必完全改成另一種題型。請盡量提供最多的題目。一條題目不一定只涉及一件事件。每題都要提供問題與解釋，並說明它相對於參考題型的新意在哪裡。解釋請參考所附題目的風格、用字與句式。'
        },
        {
            id: 'different-types',
            name: '截然不同題型',
            prompt: '先辨認以下所篩選題目已經出現的題型與問法格式，然後撰寫全新的題目。每一題都必須使用所篩選題目中沒有出現過的題型或問法格式，目標是提供截然不同的題型，而不是沿用、微調或只改例子。請盡量提供最多的題目，並讓各題的題型彼此也盡量不同。每題都要提供問題與解釋，並說明該題的題型為何與參考題不同、創新之處在哪裡。解釋請使用清晰的中學經濟科用語。'
        }
    ];
    var POE_INSTRUCTION = POE_GENERATION_MODES[0].prompt;
    var POE_DEFAULT_MODEL = 'Claude-Sonnet-5.5';
    var POE_MODELS = ['Claude-Sonnet-5.5', 'GPT-6.1-Sol', 'Gemini-3.8-Flash'];
    var OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';
    var OPENROUTER_MODELS = [
        'openai/gpt-4o-mini',
        'openai/gpt-4o',
        'google/gemini-2.0-flash-001',
        'anthropic/claude-sonnet-4',
        'google/gemini-2.0-flash-exp:free',
        'openai/gpt-oss-20b:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free'
    ];
    var PROVIDER_POE = 'poe';
    var PROVIDER_OPENROUTER = 'openrouter';
    var INSTRUCTION_MAX = 4000;
    var INSTRUCTION_KEY = 'econ_ai_instruction_v1';
    var MODE_KEY = 'econ_ai_mode_v1';
    var PROVIDER_KEY = 'econ_ai_provider_v1';
    var MODEL_KEY_POE = 'econ_ai_model_poe_v1';
    var MODEL_KEY_OPENROUTER = 'econ_ai_model_openrouter_v1';
    var MODEL_KEY_LEGACY = 'econ_ai_model_v1';
    var API_KEY_POE = 'econ_poe_api_key_v1';
    var API_KEY_OPENROUTER = 'econ_openrouter_api_key_v1';
    var CLIENT_SEND_CAP = 60;
    var LOCAL_KEY = 'econ_poe_generations_v1';
    // One page of personal history and of admin usage. Matches AI_BACKUP_LIST_MAX_.
    var HISTORY_LIMIT = 30;
    var ERROR_TEXT = {
        feature_unavailable: '此功能暫不可用。',
        proxy_not_configured: '出題服務尚未完成設定。',
        missing_api_key: '尚未設定 API Key。請按「API／模型設定」輸入金鑰後儲存。',
        no_reference_questions: '沒有可送出的參考題目。請先篩選出含題幹的題目，或改為貼上題目。',
        empty_paste: '請先貼上至少一題題目。',
        missing_references: '找不到當時的參考題。請再選擇來源後出題。',
        rate_limited: '出題次數暫時達到上限，請稍後再試。',
        upstream_error: '出題服務暫時未能回應，請再試一次。',
        upstream_timeout: '出題時間過長而被中斷。可以縮小篩選範圍後再試。',
        bad_request: '無法送出這次請求。',
        server_error: '出題服務發生錯誤，請再試一次。',
        network: '無法連線到出題服務。',
        save_failed: '題目已產生，但未能寫入這部瀏覽器。'
    };

    var poeUi = {
        overlay: null,
        settingsOverlay: null,
        busy: false,
        control: null,
        timer: null,
        startedAt: 0,
        records: [],
        activeRecord: null,
        filteredCount: 0,
        pasteCount: 0,
        counting: false,
        trigger: null,
        db: null,
        storeMode: null,
        busyAction: '',
        resultExpanded: false,
        enlargeOverlay: null,
        pinnedQuestion: null,
        pendingTrigger: null,
        defaultSubtitle: '',
        historyQuery: '',
        activeTab: 'compose',
        usageRecords: [],
        usageQuery: '',
        usageActiveId: '',
        usageLoaded: false,
        usageLoading: false,
        usageError: '',
        historyPage: 0,
        historyCursors: [''],
        historyNextAfter: '',
        historyHasMore: false,
        historyLoading: false,
        historyLoadToken: 0,
        historyError: '',
        usagePage: 0,
        usageCursors: [null],
        usageNextAfter: null,
        usageHasMore: false
    };

    function modeById(id) {
        for (var i = 0; i < POE_GENERATION_MODES.length; i++) {
            if (POE_GENERATION_MODES[i].id === id) return POE_GENERATION_MODES[i];
        }
        return null;
    }

    function currentMode() {
        var select = document.getElementById('poe-mode');
        var mode = select ? modeById(select.value) : null;
        return mode || POE_GENERATION_MODES[0];
    }

    function normalizeProvider(value) {
        return String(value || '').trim().toLowerCase() === PROVIDER_OPENROUTER
            ? PROVIDER_OPENROUTER
            : PROVIDER_POE;
    }

    function providerLabel(provider) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER ? 'OpenRouter' : 'Poe';
    }

    function currentProvider() {
        var checked = document.querySelector('input[name="poe-settings-provider"]:checked');
        if (checked) return normalizeProvider(checked.value);
        return readStoredProvider();
    }

    function modelsForProvider(provider) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER ? OPENROUTER_MODELS : POE_MODELS;
    }

    function defaultModelForProvider(provider) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER
            ? OPENROUTER_DEFAULT_MODEL
            : POE_DEFAULT_MODEL;
    }

    function isKnownModel(provider, model) {
        var list = modelsForProvider(provider);
        return list.indexOf(model) !== -1;
    }

    function sanitizeOpenRouterModelId(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text || text.length > 120) return '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._\-\/:]*$/.test(text)) return '';
        if (text.indexOf('..') !== -1) return '';
        return text;
    }

    function sanitizePoeModelId(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text || text.length > 120) return '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(text)) return '';
        if (text.indexOf('..') !== -1) return '';
        return text;
    }

    function sanitizeModelId(provider, value) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER
            ? sanitizeOpenRouterModelId(value)
            : sanitizePoeModelId(value);
    }

    function settingsModelSelect(provider) {
        provider = normalizeProvider(provider);
        return document.getElementById(provider === PROVIDER_OPENROUTER
            ? 'poe-settings-model-openrouter'
            : 'poe-settings-model-poe');
    }

    function settingsModelCustom(provider) {
        provider = normalizeProvider(provider);
        return document.getElementById(provider === PROVIDER_OPENROUTER
            ? 'poe-settings-model-custom-openrouter'
            : 'poe-settings-model-custom-poe');
    }

    function settingsModelsPanel(provider) {
        provider = normalizeProvider(provider);
        return document.getElementById(provider === PROVIDER_OPENROUTER
            ? 'poe-settings-models-openrouter'
            : 'poe-settings-models-poe');
    }

    function syncProviderModelPanels(provider) {
        provider = normalizeProvider(provider);
        var poePanel = settingsModelsPanel(PROVIDER_POE);
        var orPanel = settingsModelsPanel(PROVIDER_OPENROUTER);
        if (poePanel) poePanel.hidden = provider !== PROVIDER_POE;
        if (orPanel) orPanel.hidden = provider !== PROVIDER_OPENROUTER;
    }

    function currentModel() {
        var provider = currentProvider();
        var custom = settingsModelCustom(provider);
        var customValue = custom ? sanitizeModelId(provider, custom.value) : '';
        if (customValue) return customValue;
        var select = settingsModelSelect(provider);
        if (select) {
            var value = String(select.value || '').trim();
            var sanitized = sanitizeModelId(provider, value);
            if (sanitized) return sanitized;
        }
        return readStoredModel(provider);
    }

    function sanitizeClientInstruction(value) {
        var text = String(value == null ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u2028\u2029]/g, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
        if (text.length > INSTRUCTION_MAX) {
            text = text.slice(0, INSTRUCTION_MAX);
            var last = text.charCodeAt(text.length - 1);
            if (last >= 0xD800 && last <= 0xDBFF) text = text.slice(0, -1);
            text = text.trim();
        }
        return text;
    }

    function readStoredInstruction() {
        try {
            var raw = localStorage.getItem(INSTRUCTION_KEY);
            if (raw == null) return null;
            return sanitizeClientInstruction(raw);
        } catch (error) {
            return null;
        }
    }

    function writeStoredInstruction(value) {
        try {
            var text = sanitizeClientInstruction(value);
            var baseline = currentMode().prompt;
            if (!text || text === baseline) {
                localStorage.removeItem(INSTRUCTION_KEY);
                return;
            }
            localStorage.setItem(INSTRUCTION_KEY, text);
        } catch (error) {
            // Quota or private mode. The textarea still holds this session's text.
        }
    }

    function readStoredModeId() {
        try {
            var id = localStorage.getItem(MODE_KEY);
            if (modeById(id)) return id;
        } catch (error) {}
        return POE_GENERATION_MODES[0].id;
    }

    function writeStoredMode(id) {
        try {
            if (!modeById(id) || id === POE_GENERATION_MODES[0].id) {
                localStorage.removeItem(MODE_KEY);
                return;
            }
            localStorage.setItem(MODE_KEY, id);
        } catch (error) {}
    }

    function modelStorageKey(provider) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER
            ? MODEL_KEY_OPENROUTER
            : MODEL_KEY_POE;
    }

    function apiStorageKey(provider) {
        return normalizeProvider(provider) === PROVIDER_OPENROUTER
            ? API_KEY_OPENROUTER
            : API_KEY_POE;
    }

    function readStoredProvider() {
        try {
            return normalizeProvider(localStorage.getItem(PROVIDER_KEY));
        } catch (error) {
            return PROVIDER_POE;
        }
    }

    function writeStoredProvider(provider) {
        try {
            provider = normalizeProvider(provider);
            if (provider === PROVIDER_POE) {
                localStorage.removeItem(PROVIDER_KEY);
                return;
            }
            localStorage.setItem(PROVIDER_KEY, provider);
        } catch (error) {}
    }

    function readStoredModel(provider) {
        provider = normalizeProvider(provider == null ? readStoredProvider() : provider);
        try {
            var id = localStorage.getItem(modelStorageKey(provider));
            var sanitized = sanitizeModelId(provider, id);
            if (sanitized) return sanitized;
            if (provider === PROVIDER_POE) {
                // Migrate legacy single-model key once.
                var legacy = localStorage.getItem(MODEL_KEY_LEGACY);
                var legacyOk = sanitizePoeModelId(legacy);
                if (legacyOk) {
                    writeStoredModel(legacyOk, PROVIDER_POE);
                    try { localStorage.removeItem(MODEL_KEY_LEGACY); } catch (error) {}
                    return legacyOk;
                }
            }
        } catch (error) {}
        return defaultModelForProvider(provider);
    }

    function writeStoredModel(id, provider) {
        provider = normalizeProvider(provider == null ? currentProvider() : provider);
        try {
            var key = modelStorageKey(provider);
            id = sanitizeModelId(provider, id);
            var fallback = defaultModelForProvider(provider);
            if (!id || id === fallback) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, id);
        } catch (error) {}
    }

    function readStoredApiKey(provider) {
        provider = normalizeProvider(provider == null ? readStoredProvider() : provider);
        try {
            var raw = localStorage.getItem(apiStorageKey(provider));
            if (raw == null) return '';
            return String(raw).trim();
        } catch (error) {
            return '';
        }
    }

    function writeStoredApiKey(value, provider) {
        provider = normalizeProvider(provider == null ? currentProvider() : provider);
        try {
            var text = String(value == null ? '' : value).trim();
            var key = apiStorageKey(provider);
            if (!text) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, text);
        } catch (error) {
            // Quota or private mode.
        }
    }

    function clearStoredApiKey(provider) {
        provider = normalizeProvider(provider == null ? currentProvider() : provider);
        try {
            localStorage.removeItem(apiStorageKey(provider));
        } catch (error) {}
    }

    function apiKeyForRequest(provider) {
        return readStoredApiKey(provider == null ? currentProvider() : provider);
    }

    function withProviderAndApiKey(payload) {
        var provider = normalizeProvider(payload && payload.provider != null
            ? payload.provider
            : currentProvider());
        payload.provider = provider;
        var key = apiKeyForRequest(provider);
        if (key) {
            if (provider === PROVIDER_OPENROUTER) payload.openRouterApiKey = key;
            else payload.poeApiKey = key;
        }
        return payload;
    }

    // Admin may omit a browser key and use the server shared property for that
    // provider (POE_API_KEY or optional OPENROUTER_API_KEY). Everyone else must
    // enter a personal key before test/generate.
    function viewerIsAdmin() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (window.accessRights || null);
        return !!(rights && rights.admin === true);
    }

    function mayUseSharedServerKey() {
        return viewerIsAdmin();
    }

    function missingApiKeyMessage(provider) {
        return '尚未設定 ' + providerLabel(provider) + ' API Key。請按「API／模型設定」輸入金鑰後儲存。';
    }

    function ensureApiKeyReady() {
        var provider = currentProvider();
        if (apiKeyForRequest(provider)) return true;
        if (mayUseSharedServerKey()) return true;
        showError('missing_api_key');
        setStatus(missingApiKeyMessage(provider));
        openSettingsModal(true);
        return false;
    }

    function focusApiKeyFieldIfMissing(code) {
        if (code !== 'missing_api_key') return;
        openSettingsModal(true);
    }

    function apiKeyField() {
        return document.getElementById('poe-settings-api-key');
    }

    function apiKeyHint() {
        return document.getElementById('poe-settings-api-key-hint');
    }

    function settingsStatus() {
        return document.getElementById('poe-settings-status');
    }

    function setSettingsStatus(message) {
        var node = settingsStatus();
        if (node) node.textContent = message || '';
    }

    function refreshProviderSummary() {
        var node = document.getElementById('poe-provider-summary');
        if (!node) return;
        var provider = readStoredProvider();
        var model = readStoredModel(provider);
        var hasKey = !!readStoredApiKey(provider);
        var bits = [providerLabel(provider), '模型：' + model];
        bits.push(hasKey ? '已設金鑰' : (mayUseSharedServerKey() ? '可用伺服器金鑰' : '尚未設金鑰'));
        node.textContent = bits.join(' · ');
    }

    function refreshApiKeyUi() {
        var provider = currentProvider();
        var input = apiKeyField();
        var hint = apiKeyHint();
        var label = document.getElementById('poe-settings-api-key-label');
        var stored = readStoredApiKey(provider);
        if (label) label.textContent = providerLabel(provider) + ' API Key（個人）';
        if (input && document.activeElement !== input) {
            input.value = stored ? stored : '';
            input.placeholder = stored
                ? '••••••••（已儲存在此瀏覽器）'
                : ('貼上你的 ' + providerLabel(provider) + ' API Key');
        }
        if (hint) {
            if (stored) {
                hint.textContent = '已在此瀏覽器儲存 ' + providerLabel(provider) + ' 金鑰。出題與測試時會一併送出；伺服器不會把它寫入紀錄或備份。';
                hint.classList.remove('is-warn');
            } else {
                hint.textContent = '尚未儲存個人金鑰。請先輸入並按「儲存」後再測試或出題（非管理員必須使用個人金鑰）。金鑰只存在此瀏覽器的 localStorage，不會提交到 Git。';
                hint.classList.add('is-warn');
            }
        }
        refreshProviderSummary();
    }

    function fillSettingsModelOptions(provider) {
        provider = normalizeProvider(provider);
        syncProviderModelPanels(provider);
        var modelSelect = settingsModelSelect(provider);
        if (!modelSelect) return;
        var list = modelsForProvider(provider);
        var selected = readStoredModel(provider);
        modelSelect.textContent = '';
        var seen = false;
        list.forEach(function (model) {
            var option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
            if (model === selected) seen = true;
        });
        if (selected && !seen) {
            var customOption = document.createElement('option');
            customOption.value = selected;
            customOption.textContent = selected + '（自訂）';
            modelSelect.appendChild(customOption);
        }
        modelSelect.value = selected;
        var custom = settingsModelCustom(provider);
        if (custom && document.activeElement !== custom) {
            custom.value = (selected && list.indexOf(selected) === -1) ? selected : '';
        }
    }

    function loadSettingsForm() {
        ensureSettingsModal();
        var provider = readStoredProvider();
        var radios = document.querySelectorAll('input[name="poe-settings-provider"]');
        radios.forEach(function (input) {
            input.checked = normalizeProvider(input.value) === provider;
        });
        fillSettingsModelOptions(provider);
        refreshApiKeyUi();
        setSettingsStatus('');
    }

    function onSettingsProviderChange() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        writeStoredProvider(provider);
        fillSettingsModelOptions(provider);
        refreshApiKeyUi();
        setSettingsStatus('已切換至 ' + providerLabel(provider) + '。金鑰與模型各自獨立儲存。');
    }

    function onSettingsModelChange() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        var select = settingsModelSelect(provider);
        var custom = settingsModelCustom(provider);
        if (custom) custom.value = '';
        var model = select ? String(select.value || '').trim() : '';
        writeStoredModel(model, provider);
        refreshProviderSummary();
    }

    function onSettingsCustomModelInput() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        var custom = settingsModelCustom(provider);
        var value = custom ? sanitizeModelId(provider, custom.value) : '';
        if (!value) return;
        writeStoredModel(value, provider);
        fillSettingsModelOptions(provider);
        if (custom) custom.value = value;
        refreshProviderSummary();
    }

    function saveApiKeyFromInput() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        var input = apiKeyField();
        var value = input ? String(input.value || '').trim() : '';
        if (!value) {
            setSettingsStatus('請先貼上 ' + providerLabel(provider) + ' API Key，或按「清除」移除已儲存的金鑰。');
            return;
        }
        writeStoredApiKey(value, provider);
        writeStoredProvider(provider);
        writeStoredModel(currentModel(), provider);
        if (input) input.value = value;
        refreshApiKeyUi();
        setSettingsStatus('已儲存 ' + providerLabel(provider) + ' API Key 到此瀏覽器。');
        setStatus('已更新 API／模型設定。');
    }

    function clearApiKeyFromUi() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        clearStoredApiKey(provider);
        var input = apiKeyField();
        if (input) input.value = '';
        refreshApiKeyUi();
        setSettingsStatus('已清除此瀏覽器上的 ' + providerLabel(provider) + ' API Key。');
        setStatus('已清除 ' + providerLabel(provider) + ' API Key。');
    }

    function saveSettingsFromUi() {
        if (poeUi.busy) return;
        var provider = currentProvider();
        writeStoredProvider(provider);
        var input = apiKeyField();
        var typed = input ? String(input.value || '').trim() : '';
        if (typed) writeStoredApiKey(typed, provider);
        var model = currentModel();
        writeStoredModel(model, provider);
        fillSettingsModelOptions(provider);
        refreshApiKeyUi();
        setSettingsStatus('已儲存供應商、模型' + (typed ? '與金鑰' : '') + '。');
        setStatus('已更新 API／模型設定（' + providerLabel(provider) + ' · ' + model + '）。');
    }



    function instructionField() {
        return document.getElementById('poe-instruction-input');
    }

    function fillComposerOptions() {
        var modeSelect = document.getElementById('poe-mode');
        if (modeSelect && !modeSelect.options.length) {
            POE_GENERATION_MODES.forEach(function (mode) {
                var option = document.createElement('option');
                option.value = mode.id;
                option.textContent = mode.name;
                modeSelect.appendChild(option);
            });
        }
    }

    function loadComposer() {
        fillComposerOptions();
        var modeSelect = document.getElementById('poe-mode');
        var mode = modeById(readStoredModeId()) || POE_GENERATION_MODES[0];
        if (modeSelect) modeSelect.value = mode.id;
        refreshProviderSummary();
        var area = instructionField();
        if (!area) return;
        var stored = readStoredInstruction();
        area.value = stored || mode.prompt;
    }

    function currentInstructionForRequest() {
        var area = instructionField();
        var text = area ? sanitizeClientInstruction(area.value) : '';
        if (text) return text;
        return currentMode().prompt;
    }

    function resetInstruction() {
        var area = instructionField();
        if (!area || poeUi.busy) return;
        area.value = currentMode().prompt;
        writeStoredInstruction(area.value);
    }

    function onModeChange() {
        if (poeUi.busy) return;
        var mode = currentMode();
        writeStoredMode(mode.id);
        var area = instructionField();
        if (!area) return;
        area.value = mode.prompt;
        writeStoredInstruction(area.value);
    }

    function onModelChange() {
        if (poeUi.busy) return;
        writeStoredModel(currentModel(), currentProvider());
    }

    function proxyUrl() {
        if (typeof CONFIG === 'undefined' || !CONFIG.POE_PROXY_WEB_APP_URL) return '';
        return String(CONFIG.POE_PROXY_WEB_APP_URL).trim();
    }

    function currentUsername() {
        if (!window.authManager || !window.authManager.currentUser) return '';
        return String(window.authManager.currentUser).trim().toLowerCase();
    }

    function beginRequest(timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return {
            signal: controller.signal,
            cancel: function () { controller.abort(); },
            clear: function () { clearTimeout(timer); }
        };
    }

    function parseProxyJson(text) {
        var cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/^\)\]\}',?\n/, '');
        return JSON.parse(cleaned);
    }

    async function proxyRequest(payload, timeoutMs, control) {
        var url = proxyUrl();
        if (!url) {
            var missing = new Error('network');
            missing.code = 'network';
            throw missing;
        }
        var handle = beginRequest(timeoutMs);
        if (control) control.handle = handle;
        try {
            var response = await fetch(url, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                signal: handle.signal
            });
            var text = await response.text();
            try {
                return parseProxyJson(text);
            } catch (error) {
                var invalid = new Error('network');
                invalid.code = 'network';
                throw invalid;
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                var aborted = new Error('aborted');
                aborted.code = control && control.cancelled ? 'cancelled' : 'upstream_timeout';
                throw aborted;
            }
            if (error && error.code) throw error;
            var network = new Error('network');
            network.code = 'network';
            throw network;
        } finally {
            handle.clear();
        }
    }

    async function poeCheckAccess() {
        if (typeof refreshAccessRights !== 'function') return false;
        try {
            var rights = await refreshAccessRights();
            return !!(rights && rights.ai === true);
        } catch (error) {
            return false;
        }
    }

    function setAiGenerateAllowed(allowed) {
        document.body.classList.toggle('poe-ai-allowed', !!allowed);
    }

    function hideGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = true;
        setAiGenerateAllowed(false);
    }

    function showGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = false;
        setAiGenerateAllowed(true);
    }

    async function refreshPoeGenerateAccess() {
        hideGenerateButton();
        var allowed = await poeCheckAccess();
        if (allowed) showGenerateButton();
    }

    function logQuestionToolLogin() {
        var username = currentUsername();
        if (!username || !proxyUrl()) return;
        var key = 'econ_proxy_login_logged:' + username;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch (error) {
            // Continue. The server also dedupes login rows.
        }
        proxyRequest({ action: 'logLogin', username: username }, 15000, null).catch(function () {
            try { sessionStorage.removeItem(key); } catch (error) {}
        });
    }

    function initPoeGenerateFeature() {
        bindGenerateButton();
        refreshPoeGenerateAccess();
    }

    function bindGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', function () {
            openPoeGenerateModal();
        });
    }

    function explanationText(question) {
        var letter = question.answerMC && question.answerMC !== '-' ? String(question.answerMC).trim() : '';
        var written = question.answerChi && question.answerChi !== '-' ? String(question.answerChi).trim() : '';
        if (letter && written) {
            return written.indexOf(letter) !== -1 ? written : letter + '\n' + written;
        }
        return letter || written || '';
    }

    function bankQuestionFrom(question) {
        var stem = String(question.plainText || question.questionTextChi || question.questionTextEng || '').trim();
        var copy = {
            id: question.id || '',
            examination: question.examination || '',
            year: question.year == null ? '' : question.year,
            questionType: question.questionType || '',
            concepts: Array.isArray(question.concepts) ? question.concepts.slice() : [],
            plainText: stem,
            questionTextChi: question.questionTextChi || '',
            answerMC: question.answerMC,
            answerChi: question.answerChi,
            answerEng: question.answerEng
        };
        if (!explanationText(copy)) {
            var eng = copy.answerEng && copy.answerEng !== '-' ? String(copy.answerEng).trim() : '';
            if (eng) copy.answerChi = eng;
        }
        return copy;
    }

    function toReference(question) {
        var concepts = Array.isArray(question.concepts)
            ? question.concepts.map(function (item) { return String(item || '').trim(); }).filter(Boolean).join('、')
            : '';
        return {
            id: question.id || '',
            examination: question.examination || '',
            year: question.year == null ? '' : String(question.year),
            questionType: question.questionType || '',
            concepts: concepts,
            question: String(question.plainText || question.questionTextChi || '').trim(),
            explanation: explanationText(question)
        };
    }

    function currentFilters() {
        var searchEl = document.getElementById('search');
        return {
            search: searchEl ? searchEl.value : '',
            searchScope: window.searchScope || 'all',
            triState: typeof triStateFilters !== 'undefined' ? triStateFilters : {},
            percentageFilter: window.percentageFilter,
            marksFilter: window.marksFilter,
            questionNumberFilter: window.questionNumberFilter
        };
    }

    async function loadFilteredQuestions() {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') return [];
        var questions = await window.storage.getQuestions(currentFilters());
        var sortSelect = document.getElementById('sort-order');
        var sortBy = sortSelect ? sortSelect.value : 'default';
        if (typeof sortQuestions === 'function') questions = sortQuestions(questions, sortBy);
        return questions.filter(function (question) {
            return String(question.plainText || question.questionTextChi || '').trim().length > 0;
        });
    }

    async function questionById(id) {
        var wanted = String(id || '');
        if (!wanted || !window.storage || typeof window.storage.getQuestions !== 'function') return null;
        var questions = await window.storage.getQuestions({ triState: {} });
        for (var i = 0; i < questions.length; i++) {
            if (questions[i] && String(questions[i].id) === wanted) return questions[i];
        }
        return null;
    }

    async function questionsByIds(ids) {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') return [];
        var questions = await window.storage.getQuestions({ triState: {} });
        var byId = {};
        questions.forEach(function (question) {
            if (question && question.id) byId[question.id] = question;
        });
        return ids.map(function (id) { return byId[id]; }).filter(function (question) {
            return question && String(question.plainText || question.questionTextChi || '').trim();
        });
    }

    function currentSource() {
        if (poeUi.pinnedQuestion) return 'single';
        var selected = document.querySelector('input[name="poe-reference-source"]:checked');
        return selected && selected.value === 'paste' ? 'paste' : 'filter';
    }

    function pasteField() {
        return document.getElementById('poe-paste-input');
    }

    function normalizePaste(raw) {
        return String(raw == null ? '' : raw)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u2028\u2029]/g, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
    }

    function isNumberedQuestionLine(line) {
        return /^(?:\d{1,3})\s*[.、．)）]\s*\S/.test(line) || /^[（(]\s*\d{1,3}\s*[）)]\s*\S/.test(line);
    }

    function isOptionBlock(block) {
        var lines = String(block || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
        if (!lines.length) return false;
        return lines.every(function (line) {
            return /^(?:[A-Ha-h]|[甲乙丙丁戊己庚辛])\s*[.、．)）]\s*\S/.test(line)
                || /^[（(]\s*[A-Ha-h]\s*[）)]\s*\S/.test(line);
        });
    }

    function isExplanationOnly(block) {
        return /^(?:解釋|答案|explanation)\s*[:：]/i.test(String(block || '').trim());
    }

    function splitPasteChunks(text) {
        var lines = text.split('\n');
        var markerRows = [];
        lines.forEach(function (line, index) {
            if (isNumberedQuestionLine(line.trim())) markerRows.push(index);
        });
        if (markerRows.length >= 2) {
            var numbered = [];
            for (var i = 0; i < markerRows.length; i++) {
                var start = markerRows[i];
                var end = i + 1 < markerRows.length ? markerRows[i + 1] : lines.length;
                var chunk = lines.slice(start, end).join('\n').trim();
                if (chunk) numbered.push(chunk);
            }
            if (numbered.length >= 2) return numbered;
        }
        var blocks = text.split(/\n\s*\n+/).map(function (block) { return block.trim(); }).filter(Boolean);
        if (blocks.length < 2) return [text];
        var merged = [];
        blocks.forEach(function (block) {
            if (merged.length && (isOptionBlock(block) || isExplanationOnly(block))) {
                merged[merged.length - 1] += '\n\n' + block;
            } else {
                merged.push(block);
            }
        });
        return merged.length ? merged : [text];
    }

    function parsePasteChunk(chunk) {
        var text = String(chunk || '').trim();
        if (!text) return null;
        text = text.replace(/^(?:\d{1,3})\s*[.、．)）]\s*/, '');
        text = text.replace(/^[（(]\s*\d{1,3}\s*[）)]\s*/, '');
        text = text.replace(/^【[^】\n]{0,24}】\s*/, '');
        var labelAt = text.search(/(?:^|\n)\s*(?:解釋|答案|explanation)\s*[:：]/i);
        var explanation = '';
        if (labelAt >= 0) {
            explanation = text.slice(labelAt).replace(/^(?:\n)?\s*(?:解釋|答案|explanation)\s*[:：]\s*/i, '').trim();
            text = text.slice(0, labelAt).trim();
        }
        text = text.replace(/^(?:題目|問題|question)\s*[:：]\s*/i, '').trim();
        if (!text) return null;
        if (text.length > 6000) text = text.slice(0, 6000);
        if (explanation.length > 6000) explanation = explanation.slice(0, 6000);
        return { question: text, explanation: explanation };
    }

    function parsePastedQuestions(raw) {
        var text = normalizePaste(raw);
        if (!text) return [];
        var chunks = splitPasteChunks(text);
        var items = [];
        chunks.forEach(function (chunk) {
            var item = parsePasteChunk(chunk);
            if (item && item.question) items.push(item);
        });
        if (!items.length) {
            var only = parsePasteChunk(text);
            if (only && only.question) items.push(only);
        }
        return items;
    }

    function pasteQuestions() {
        var field = pasteField();
        return parsePastedQuestions(field ? field.value : '');
    }

    function filterSummary(count) {
        var searchEl = document.getElementById('search');
        var search = searchEl ? String(searchEl.value || '').trim() : '';
        if (search) {
            var clipped = search.length > 40 ? search.slice(0, 40) + '…' : search;
            return '篩選 ' + count + ' 題，搜尋「' + clipped + '」';
        }
        return '篩選 ' + count + ' 題';
    }

    function leadForCount(count) {
        if (!count) return '沒有符合篩選條件、而且含有題幹的題目。';
        if (count > CLIENT_SEND_CAP) {
            return '目前篩選有 ' + count + ' 題含題幹。出題時會依目前排序送出前 ' + CLIENT_SEND_CAP + ' 題，伺服器可能再減少。';
        }
        return '目前篩選有 ' + count + ' 題含題幹，會全部送出作為參考。';
    }

    function leadForPaste(count) {
        if (!count) return '請在下方貼上題目。題與題之間可用空行分隔，或以 1. 2. 3. 編號。';
        if (count > CLIENT_SEND_CAP) {
            return '貼上內容可分成 ' + count + ' 題。出題時會送出前 ' + CLIENT_SEND_CAP + ' 題。';
        }
        if (count === 1) return '貼上內容會當成 1 題參考。';
        return '貼上內容可分成 ' + count + ' 題參考，會全部送出。';
    }

    function idbRequest(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function transactionDone(tx) {
        return new Promise(function (resolve, reject) {
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error || new Error('aborted')); };
        });
    }

    function openGenerationDb() {
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

    async function ensureStore() {
        if (poeUi.storeMode) return poeUi.storeMode;
        try {
            poeUi.db = await openGenerationDb();
            poeUi.storeMode = 'idb';
        } catch (error) {
            poeUi.storeMode = 'local';
        }
        return poeUi.storeMode;
    }

    function readLocal() {
        try {
            var raw = localStorage.getItem(LOCAL_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function writeLocal(records) {
        var next = records.slice();
        var lastError = null;
        while (next.length) {
            try {
                localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
                return;
            } catch (error) {
                lastError = error;
                if (next.length === 1) break;
                next = next.slice(Math.ceil(next.length / 2));
            }
        }
        throw lastError || new Error('quota');
    }

    async function listGenerations(username) {
        var mode = await ensureStore();
        if (mode === 'local') {
            return readLocal()
                .filter(function (record) { return record.username === username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
        }
        var index = poeUi.db.transaction('generations', 'readonly').objectStore('generations').index('byUser');
        var rows = await idbRequest(index.getAll(username));
        return (rows || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    }

    async function saveGeneration(record) {
        var mode = await ensureStore();
        if (mode === 'local') {
            var all = readLocal().filter(function (item) { return item.id !== record.id; });
            all.push(record);
            var mine = all
                .filter(function (item) { return item.username === record.username; })
                .sort(function (a, b) { return b.createdAt - a.createdAt; });
            var keep = {};
            mine.slice(0, HISTORY_LIMIT).forEach(function (item) { keep[item.id] = true; });
            writeLocal(all.filter(function (item) {
                return item.username !== record.username || keep[item.id];
            }));
            return;
        }
        var writeTx = poeUi.db.transaction('generations', 'readwrite');
        writeTx.objectStore('generations').put(record);
        await transactionDone(writeTx);
        var rows = await listGenerations(record.username);
        var extra = rows.slice(HISTORY_LIMIT);
        if (!extra.length) return;
        var tx = poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        extra.forEach(function (item) { store.delete(item.id); });
        await transactionDone(tx);
    }

    async function deleteGeneration(id) {
        var mode = await ensureStore();
        if (mode === 'local') {
            writeLocal(readLocal().filter(function (record) { return record.id !== id; }));
            return;
        }
        var tx = poeUi.db.transaction('generations', 'readwrite');
        tx.objectStore('generations').delete(id);
        await transactionDone(tx);
    }

    async function clearGenerations(username) {
        var mode = await ensureStore();
        if (mode === 'local') {
            writeLocal(readLocal().filter(function (record) { return record.username !== username; }));
            return;
        }
        var rows = await listGenerations(username);
        if (!rows.length) return;
        var tx = poeUi.db.transaction('generations', 'readwrite');
        var store = tx.objectStore('generations');
        rows.forEach(function (record) { store.delete(record.id); });
        await transactionDone(tx);
    }

    function remoteBackupCreatedAt(backup, name) {
        var parsed = Date.parse(String(backup && backup.createdAt || ''));
        if (isFinite(parsed) && parsed > 0) return parsed;
        var m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(name || ''));
        if (!m) return 0;
        // Backup filenames use the Apps Script timezone (Asia/Hong_Kong).
        parsed = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00');
        return isFinite(parsed) ? parsed : 0;
    }

    function mapRemoteBackup(backup, username) {
        if (!backup || typeof backup !== 'object') return null;
        var action = String(backup.action || '');
        if (action && action !== 'generateQuestions') return null;
        var name = String(backup.name || '').replace(/^.*\//, '');
        var content = String(backup.content == null ? '' : backup.content);
        var source = backup.referenceSource || backup.source || 'filter';
        source = source === 'paste' ? 'paste' : (source === 'single' ? 'single' : 'filter');
        var createdAt = remoteBackupCreatedAt(backup, name);
        var id = name
            ? ('remote:' + name)
            : ('remote:' + username + ':' + String(createdAt || Date.now()));
        return {
            id: id,
            username: username,
            createdAt: createdAt || Date.now(),
            content: content,
            model: String(backup.model || ''),
            modeId: String(backup.modeId || ''),
            modeName: String(backup.modeName || ''),
            instruction: String(backup.instruction || ''),
            sentCount: Number(backup.sentCount) || 0,
            filteredCount: Number(backup.filteredCount) || Number(backup.sentCount) || 0,
            truncated: false,
            referenceSource: source,
            referenceIds: normalizeReferenceIds(backup.referenceIds),
            pastedReferences: [],
            singleQuestion: null,
            filterSummary: '',
            durationMs: Number(backup.durationMs) || 0,
            remoteName: name,
            lean: !content
        };
    }

    function contentDedupeKey(record) {
        return String(record && record.content || '').replace(/\s+/g, ' ').trim();
    }

    function mergeGenerationRecords(localRecords, remoteRecords) {
        var merged = [];
        var byId = {};
        var byContent = {};

        function prefer(existing, next) {
            if (!existing) return next;
            // Keep local rows that still have reference ids / pasted stems.
            var existingLocal = String(existing.id || '').indexOf('remote:') !== 0;
            var nextLocal = String(next.id || '').indexOf('remote:') !== 0;
            if (existingLocal && !nextLocal) {
                if (!existing.content && next.content) existing.content = next.content;
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
            if (!existing.content && next.content) return next;
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
            var key = contentDedupeKey(record);
            if (!existing && key && byContent[key]) existing = byContent[key];
            var chosen = prefer(existing, record);
            if (existing && existing !== chosen) {
                merged = merged.filter(function (item) { return item !== existing; });
                delete byId[existing.id];
                var oldKey = contentDedupeKey(existing);
                if (oldKey && byContent[oldKey] === existing) delete byContent[oldKey];
            }
            if (!byId[chosen.id]) merged.push(chosen);
            byId[chosen.id] = chosen;
            var chosenKey = contentDedupeKey(chosen);
            if (chosenKey) byContent[chosenKey] = chosen;
        }

        (localRecords || []).forEach(add);
        (remoteRecords || []).forEach(add);
        merged.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return merged.slice(0, HISTORY_LIMIT);
    }

    async function fetchRemoteBackupPage(username, afterName) {
        if (!username || !proxyUrl()) return { records: [], hasMore: false, nextAfter: '' };
        var payload = {
            action: 'listAiBackups',
            username: username
        };
        if (afterName) payload.after = afterName;
        var data = await proxyRequest(payload, 90000, null);
        if (!data || data.ok !== true || !Array.isArray(data.backups)) {
            var failure = new Error('history');
            failure.code = data && data.error ? data.error : 'server_error';
            throw failure;
        }
        var records = data.backups
            .map(function (item) { return mapRemoteBackup(item, username); })
            .filter(Boolean)
            .slice(0, HISTORY_LIMIT);
        var nextAfter = String(data.nextAfter || '');
        if (!nextAfter && records.length) nextAfter = String(records[records.length - 1].remoteName || '');
        return {
            records: records,
            hasMore: data.hasMore === true && !!nextAfter,
            nextAfter: nextAfter
        };
    }


    async function fillLeanRemoteRecord(record) {
        if (!record || !record.lean || record.content || !record.remoteName) return record;
        var username = currentUsername();
        if (!username) return record;
        try {
            var data = await proxyRequest({
                action: 'getAiBackup',
                username: username,
                name: record.remoteName
            }, 90000, null);
            if (!data || data.ok !== true || !data.backup) return record;
            var filled = mapRemoteBackup(data.backup, username);
            if (!filled || !filled.content) return record;
            record.content = filled.content;
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
            record.lean = false;
            try { await saveGeneration(record); } catch (error) {}
        } catch (error) {
            // Keep the lean row selectable after a later retry.
        }
        return record;
    }

    async function syncRemoteHistory(username) {
        if (!username) return null;
        var local = [];
        try {
            local = await listGenerations(username);
        } catch (error) {
            local = [];
        }
        var remotePage;
        try {
            remotePage = await fetchRemoteBackupPage(username, '');
        } catch (error) {
            return null;
        }
        var remote = remotePage.records || [];
        if (!remote.length) {
            return { records: local, hasMore: false, nextAfter: '' };
        }
        var merged = mergeGenerationRecords(local, remote);
        for (var i = 0; i < merged.length; i++) {
            var row = merged[i];
            if (!row || !row.content) continue;
            var known = local.some(function (item) {
                return item && (item.id === row.id || (contentDedupeKey(item) && contentDedupeKey(item) === contentDedupeKey(row)));
            });
            if (known && String(row.id || '').indexOf('remote:') !== 0) continue;
            try {
                await saveGeneration(row);
            } catch (error) {
                // Quota or private-mode storage failures must not block the UI.
            }
        }
        var listed;
        try {
            listed = await listGenerations(username);
        } catch (error) {
            listed = merged;
        }
        return {
            records: listed,
            hasMore: remotePage.hasMore === true,
            nextAfter: remotePage.nextAfter || ''
        };
    }


    function syncRemoteHistoryIntoUi(username, showLoading) {
        if (!username) return;
        var token = ++poeUi.historyLoadToken;
        var previousPage = poeUi.historyPage;
        if (showLoading) {
            poeUi.historyPage = 0;
            poeUi.historyLoading = true;
            poeUi.historyError = '';
            renderHistory();
        }
        syncRemoteHistory(username).then(function (payload) {
            if (token !== poeUi.historyLoadToken) return;
            if (!isPoeGenerateModalOpen() || currentUsername() !== username) return;
            poeUi.historyLoading = false;
            if (!payload) {
                if (showLoading) poeUi.historyPage = previousPage;
                renderHistory();
                return;
            }
            poeUi.historyPage = 0;
            poeUi.records = payload.records || [];
            poeUi.historyHasMore = payload.hasMore === true && !!payload.nextAfter;
            poeUi.historyNextAfter = payload.nextAfter || '';
            poeUi.historyCursors = [''];
            if (poeUi.historyHasMore) poeUi.historyCursors[1] = poeUi.historyNextAfter;
            poeUi.historyError = '';
            if (poeUi.activeRecord) {
                var activeId = poeUi.activeRecord.id;
                var refreshed = poeUi.records.filter(function (item) { return item.id === activeId; })[0];
                if (refreshed) poeUi.activeRecord = refreshed;
            }
            renderHistory();
        }).catch(function () {
            if (token !== poeUi.historyLoadToken) return;
            poeUi.historyLoading = false;
            if (showLoading) poeUi.historyPage = previousPage;
            renderHistory();
        });
    }



    function isSettingsModalOpen() {
        return !!(poeUi.settingsOverlay && !poeUi.settingsOverlay.hidden);
    }

    function syncSettingsBusyState() {
        if (!poeUi.settingsOverlay) return;
        var busy = !!poeUi.busy;
        ['poe-settings-api-key',
         'poe-settings-model-poe', 'poe-settings-model-custom-poe',
         'poe-settings-model-openrouter', 'poe-settings-model-custom-openrouter',
         'poe-settings-save', 'poe-settings-api-save', 'poe-settings-api-clear',
         'poe-settings-close', 'poe-settings-done'].forEach(function (id) {
            var node = document.getElementById(id);
            if (node) node.disabled = busy;
        });
        poeUi.settingsOverlay.querySelectorAll('input[name="poe-settings-provider"]').forEach(function (input) {
            input.disabled = busy;
        });
    }

    function ensureSettingsModal() {
        if (poeUi.settingsOverlay) return;
        var overlay = document.createElement('div');
        overlay.id = 'poe-settings-overlay';
        overlay.className = 'poe-overlay poe-settings-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-dialog poe-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-settings-title">'
            + '  <header class="poe-header">'
            + '    <div>'
            + '      <h2 id="poe-settings-title">API／模型設定</h2>'
            + '      <p class="poe-subtitle">選擇供應商、儲存個人 API Key，並指定出題／測試用的模型。設定只存在此瀏覽器，不會提交到 Git 或寫入伺服器備份。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" id="poe-settings-close" aria-label="關閉設定">×</button>'
            + '  </header>'
            + '  <div class="poe-settings-body">'
            + '    <fieldset class="poe-settings-provider" role="radiogroup" aria-label="供應商">'
            + '      <legend>供應商</legend>'
            + '      <label class="poe-source-option"><input type="radio" name="poe-settings-provider" value="poe" checked> Poe</label>'
            + '      <label class="poe-source-option"><input type="radio" name="poe-settings-provider" value="openrouter"> OpenRouter</label>'
            + '    </fieldset>'
            + '    <div class="poe-api-key poe-settings-api-key" id="poe-settings-api-wrap">'
            + '      <label class="poe-field" for="poe-settings-api-key"><span id="poe-settings-api-key-label">Poe API Key（個人）</span>'
            + '        <input type="password" id="poe-settings-api-key" autocomplete="off" spellcheck="false" maxlength="200" aria-describedby="poe-settings-api-key-hint" placeholder="貼上你的 API Key">'
            + '      </label>'
            + '      <div class="poe-api-key-actions">'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-settings-api-save">儲存金鑰</button>'
            + '        <button type="button" class="poe-text-btn" id="poe-settings-api-clear">清除金鑰</button>'
            + '      </div>'
            + '      <p class="poe-api-key-hint" id="poe-settings-api-key-hint"></p>'
            + '    </div>'
            + '    <div class="poe-settings-model-row">'
            + '      <div class="poe-settings-models-panel" id="poe-settings-models-poe">'
            + '        <label class="poe-field" for="poe-settings-model-poe">Poe 模型'
            + '          <select id="poe-settings-model-poe" aria-label="Poe 模型"></select>'
            + '        </label>'
            + '        <div class="poe-field">'
            + '          <label for="poe-settings-model-custom-poe">Poe 自訂模型 id（選填）</label>'
            + '          <input type="text" id="poe-settings-model-custom-poe" autocomplete="off" spellcheck="false" maxlength="120" placeholder="例如 Claude-Opus-4.6" aria-label="Poe 自訂模型 id">'
            + '        </div>'
            + '      </div>'
            + '      <div class="poe-settings-models-panel" id="poe-settings-models-openrouter" hidden>'
            + '        <label class="poe-field" for="poe-settings-model-openrouter">OpenRouter 模型'
            + '          <select id="poe-settings-model-openrouter" aria-label="OpenRouter 模型"></select>'
            + '        </label>'
            + '        <div class="poe-field">'
            + '          <label for="poe-settings-model-custom-openrouter">OpenRouter 自訂模型 id（選填）</label>'
            + '          <input type="text" id="poe-settings-model-custom-openrouter" autocomplete="off" spellcheck="false" maxlength="120" placeholder="例如 anthropic/claude-3.5-sonnet" aria-label="OpenRouter 自訂模型 id">'
            + '        </div>'
            + '      </div>'
            + '    </div>'
            + '    <p class="poe-settings-status" id="poe-settings-status" aria-live="polite"></p>'
            + '  </div>'
            + '  <footer class="poe-footer poe-settings-footer">'
            + '    <div class="poe-footer-actions">'
            + '      <button type="button" class="btn btn-primary" id="poe-settings-save">儲存設定</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-settings-done">完成</button>'
            + '    </div>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        poeUi.settingsOverlay = overlay;

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeSettingsModal();
        });
        overlay.querySelector('#poe-settings-close').addEventListener('click', closeSettingsModal);
        overlay.querySelector('#poe-settings-done').addEventListener('click', closeSettingsModal);
        overlay.querySelector('#poe-settings-save').addEventListener('click', saveSettingsFromUi);
        overlay.querySelector('#poe-settings-api-save').addEventListener('click', saveApiKeyFromInput);
        overlay.querySelector('#poe-settings-api-clear').addEventListener('click', clearApiKeyFromUi);
        overlay.querySelectorAll('input[name="poe-settings-provider"]').forEach(function (input) {
            input.addEventListener('change', onSettingsProviderChange);
        });
        ['poe-settings-model-poe', 'poe-settings-model-openrouter'].forEach(function (id) {
            overlay.querySelector('#' + id).addEventListener('change', onSettingsModelChange);
        });
        ['poe-settings-model-custom-poe', 'poe-settings-model-custom-openrouter'].forEach(function (id) {
            overlay.querySelector('#' + id).addEventListener('change', onSettingsCustomModelInput);
        });
        overlay.querySelector('#poe-settings-api-key').addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveApiKeyFromInput();
            }
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeSettingsModal();
            }
        });
    }

    function openSettingsModal(focusKey) {
        ensureModal();
        ensureSettingsModal();
        loadSettingsForm();
        syncSettingsBusyState();
        poeUi.settingsOverlay.hidden = false;
        document.body.classList.add('poe-settings-open');
        var target = focusKey
            ? document.getElementById('poe-settings-api-key')
            : document.getElementById('poe-settings-close');
        if (target) {
            try { target.focus(); } catch (error) {}
        }
    }

    function closeSettingsModal() {
        if (!isSettingsModalOpen()) return;
        refreshProviderSummary();
        poeUi.settingsOverlay.hidden = true;
        document.body.classList.remove('poe-settings-open');
        var openBtn = document.getElementById('poe-settings-open');
        if (openBtn && isPoeGenerateModalOpen()) {
            try { openBtn.focus(); } catch (error) {}
        }
    }

    function ensureModal() {
        if (poeUi.overlay) return;
        var overlay = document.createElement('div');
        overlay.id = 'poe-generate-overlay';
        overlay.className = 'poe-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-generate-title">'
            + '  <header class="poe-header">'
            + '    <div>'
            + '      <h2 id="poe-generate-title">AI出題</h2>'
            + '      <p class="poe-subtitle">可以參考目前篩選，或貼上自己的題目。選擇出題模式，可再改出題指示，然後按出題。供應商、API Key 與模型請在「API／模型設定」調整。測試只檢查所選模型能否回應，不會用題目出題。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="poe-tabs" role="tablist" aria-label="AI出題分頁">'
            + '    <button type="button" class="poe-tab is-active" id="poe-tab-compose" role="tab" aria-selected="true" aria-controls="poe-panel-compose">出題</button>'
            + '    <button type="button" class="poe-tab" id="poe-tab-history" role="tab" aria-selected="false" aria-controls="poe-panel-history" tabindex="-1">過往紀錄</button>'
            + '  </div>'
            + '  <div class="poe-body">'
            + '    <section class="poe-main poe-tab-panel" id="poe-panel-compose" role="tabpanel" aria-labelledby="poe-tab-compose">'
            + '      <div class="poe-result-pane">'
            + '      <div class="poe-stage-bar">'
            + '        <span class="poe-stage-label">出題結果</span>'
            + '        <button type="button" class="poe-text-btn" id="poe-enlarge" hidden>放大檢視</button>'
            + '      </div>'
            + '      <div class="poe-stage" id="poe-stage" tabindex="0"></div>'
            + '      </div>'
            + '      <div class="poe-composer">'
            + '      <div class="poe-meta" id="poe-meta"></div>'
            + '      <div class="poe-source" role="radiogroup" aria-label="參考題來源">'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="filter" checked> 使用目前篩選</label>'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="paste"> 自行貼上題目</label>'
            + '      </div>'
            + '      <div class="poe-single" id="poe-single-wrap" hidden>'
            + '        <p class="poe-single-lead" id="poe-single-lead"></p>'
            + '        <div class="poe-single-block">'
            + '          <div class="poe-single-label">題幹</div>'
            + '          <pre class="poe-single-text" id="poe-single-stem"></pre>'
            + '        </div>'
            + '        <div class="poe-single-block">'
            + '          <div class="poe-single-label">答案</div>'
            + '          <pre class="poe-single-text" id="poe-single-answer"></pre>'
            + '        </div>'
            + '      </div>'
            + '      <div class="poe-paste" id="poe-paste-wrap" hidden>'
            + '        <label for="poe-paste-input">貼上題目</label>'
            + '        <textarea id="poe-paste-input" rows="8" maxlength="100000" aria-label="貼上題目" placeholder="可貼上一題或多題。用空行分隔，或以 1. 2. 3. 編號。若有解釋，在題幹後另起一行寫「解釋：」。"></textarea>'
            + '      </div>'
            + '      <div class="poe-controls">'
            + '        <label class="poe-field">出題模式'
            + '          <select id="poe-mode" aria-label="出題模式"></select>'
            + '        </label>'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-settings-open">API／模型設定</button>'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-test">測試</button>'
            + '        <p class="poe-provider-summary" id="poe-provider-summary" aria-live="polite"></p>'
            + '      </div>'
            + '      <div id="poe-test-banner" class="poe-test-banner" hidden role="status" aria-live="polite"></div>'
            + '      <details class="poe-instruction" open>'
            + '        <summary>出題指示</summary>'
            + '        <div class="poe-instruction-bar">'
            + '          <p class="poe-instruction-hint" id="poe-instruction-hint">選擇模式會填入該模式的指示，仍可再修改。回復預設會還原目前所選模式的指示。上次修改會記在這部瀏覽器。留空送出時，會改用目前所選模式的預設指示。</p>'
            + '          <button type="button" class="poe-text-btn" id="poe-instruction-reset">回復預設</button>'
            + '        </div>'
            + '        <textarea id="poe-instruction-input" maxlength="4000" rows="4" aria-label="出題指示" aria-describedby="poe-instruction-hint"></textarea>'
            + '      </details>'
            + '      </div>'
            + '    </section>'
            + '    <aside class="poe-history poe-tab-panel" id="poe-panel-history" role="tabpanel" aria-labelledby="poe-tab-history" aria-label="過往生成" hidden>'
            + '      <div class="poe-history-head">'
            + '        <h3>過往紀錄</h3>'
            + '        <button type="button" class="poe-text-btn" id="poe-history-clear">清除</button>'
            + '      </div>'
            + '      <label class="poe-history-search" for="poe-history-search">搜尋參考題編號'
            + '        <input type="search" id="poe-history-search" autocomplete="off" spellcheck="false" placeholder="例如 2026-P1-01" aria-label="搜尋參考題編號">'
            + '        <span class="poe-history-search-note">只搜尋本頁。</span>'
            + '      </label>'
            + '      <div class="poe-history-pager" role="navigation" aria-label="過往紀錄分頁">'
            + '        <button type="button" class="poe-page-btn" id="poe-history-prev" disabled>上一頁</button>'
            + '        <span class="poe-history-page" id="poe-history-page">第 1 頁</span>'
            + '        <button type="button" class="poe-page-btn" id="poe-history-next" disabled>下一頁</button>'
            + '      </div>'
            + '      <div id="poe-history-list"></div>'
            + '    </aside>'
            + '  </div>'
            + '  <footer class="poe-footer">'
            + '    <p class="poe-footer-status" id="poe-status" aria-live="polite"></p>'
            + '    <div class="poe-footer-actions">'
            + '      <button type="button" class="btn btn-primary" id="poe-start">根據目前篩選出題</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-again" disabled>再生成</button>'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-copy" disabled>複製內容</button>'
            + '      <button type="button" class="btn btn-outline-danger" id="poe-cancel" hidden>取消</button>'
            + '    </div>'
            + '  </footer>'
            + '</div>';
        document.body.appendChild(overlay);
        poeUi.overlay = overlay;

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closePoeGenerateModal();
        });
        overlay.querySelector('.poe-close').addEventListener('click', closePoeGenerateModal);
        overlay.querySelector('#poe-start').addEventListener('click', generateFromCurrentSource);
        overlay.querySelectorAll('input[name="poe-reference-source"]').forEach(function (input) {
            input.addEventListener('change', onSourceChange);
        });
        overlay.querySelector('#poe-paste-input').addEventListener('input', onPasteInput);
        fillComposerOptions();
        overlay.querySelector('#poe-again').addEventListener('click', regenerateActive);
        overlay.querySelector('#poe-test').addEventListener('click', testSelectedModel);
        overlay.querySelector('#poe-mode').addEventListener('change', onModeChange);
        overlay.querySelector('#poe-settings-open').addEventListener('click', function () { openSettingsModal(false); });
        overlay.querySelector('#poe-instruction-reset').addEventListener('click', resetInstruction);
        overlay.querySelector('#poe-instruction-input').addEventListener('input', function (event) {
            writeStoredInstruction(event.target.value);
        });
        overlay.querySelector('#poe-enlarge').addEventListener('click', enlargeResult);
        overlay.querySelector('#poe-copy').addEventListener('click', copyActive);
        overlay.querySelector('#poe-cancel').addEventListener('click', function () { cancelGeneration(false); });
        overlay.querySelector('#poe-history-clear').addEventListener('click', clearHistory);
        overlay.querySelector('#poe-tab-compose').addEventListener('click', function () { showPoeTab('compose'); });
        overlay.querySelector('#poe-tab-history').addEventListener('click', function () { showPoeTab('history'); });
        overlay.querySelector('#poe-history-search').addEventListener('input', onHistorySearchInput);
        overlay.querySelector('#poe-history-prev').addEventListener('click', function () { showHistoryPage(poeUi.historyPage - 1); });
        overlay.querySelector('#poe-history-next').addEventListener('click', function () { showHistoryPage(poeUi.historyPage + 1); });
        overlay.addEventListener('keydown', onDialogKeydown);
    }

    function onDialogKeydown(event) {
        if (!isPoeGenerateModalOpen()) return;
        if (event.key === 'Escape' && isSettingsModalOpen()) {
            event.preventDefault();
            closeSettingsModal();
            return;
        }
        if (event.key === 'Escape' && poeUi.resultExpanded) {
            event.preventDefault();
            closeEnlargeOverlay();
            return;
        }
        if (event.key === 'Tab') trapTab(event);
    }

    function trapTab(event) {
        var dialog = poeUi.overlay.querySelector('.poe-dialog');
        var focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        var items = Array.prototype.filter.call(focusable, function (node) {
            return !node.disabled && !node.hidden && node.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function isPoeGenerateModalOpen() {
        return !!(poeUi.overlay && !poeUi.overlay.hidden);
    }

    function closePoeGenerateModal() {
        if (!isPoeGenerateModalOpen()) return;
        if (poeUi.busy) cancelGeneration(true);
        closeSettingsModal();
        closeEnlargeOverlay();
        poeUi.overlay.hidden = true;
        document.body.classList.remove('poe-modal-open');
        stopElapsed();
        if (poeUi.trigger && typeof poeUi.trigger.focus === 'function') poeUi.trigger.focus();
    }

    async function openPoeGenerateModal() {
        if (poeUi.opening || isPoeGenerateModalOpen()) return;
        poeUi.pinnedQuestion = null;
        poeUi.pendingTrigger = document.getElementById('poe-generate-btn');
        await runPoeGenerateOpen();
    }

    async function openPoeGenerateModalForQuestion(id, trigger) {
        if (poeUi.opening || isPoeGenerateModalOpen()) return;
        var question = await questionById(id);
        if (poeUi.opening || isPoeGenerateModalOpen()) return;
        if (!question) {
            window.alert('找不到這一題，未能出題。');
            return;
        }
        var bank = bankQuestionFrom(question);
        if (!bank.plainText) {
            window.alert('這一題沒有可送出的題幹。');
            return;
        }
        poeUi.pinnedQuestion = bank;
        poeUi.pendingTrigger = trigger || null;
        await runPoeGenerateOpen();
    }

    async function runPoeGenerateOpen() {
        if (poeUi.opening || isPoeGenerateModalOpen()) return;
        poeUi.opening = true;
        try {
            await openPoeGenerateModalBody();
        } finally {
            poeUi.opening = false;
        }
    }

    async function openPoeGenerateModalBody() {
        var allowed = await poeCheckAccess();
        if (!allowed) {
            hideGenerateButton();
            poeUi.pinnedQuestion = null;
            return;
        }
        ensureModal();
        syncUsageTab();
        poeUi.usageLoaded = false;
        poeUi.usageError = '';
        poeUi.usageActiveId = '';
        poeUi.usagePage = 0;
        poeUi.usageCursors = [null];
        poeUi.usageNextAfter = null;
        poeUi.usageHasMore = false;
        poeUi.historyPage = 0;
        poeUi.historyCursors = [''];
        poeUi.historyNextAfter = '';
        poeUi.historyHasMore = false;
        poeUi.historyLoading = false;
        poeUi.historyError = '';
        poeUi.historyLoadToken = (poeUi.historyLoadToken || 0) + 1;
        loadComposer();
        refreshProviderSummary();
        clearTestBanner();
        poeUi.pasteCount = pasteQuestions().length;
        poeUi.trigger = poeUi.pendingTrigger || document.getElementById('poe-generate-btn');
        syncPinnedChrome();
        poeUi.overlay.hidden = false;
        document.body.classList.add('poe-modal-open');
        setStatus('');
        poeUi.counting = true;
        if (!poeUi.activeRecord) showIdle(0, true);
        updateMeta(0, true);
        syncActionButtons();
        var closeButton = poeUi.overlay.querySelector('.poe-close');
        if (closeButton) closeButton.focus();
        var historyUser = currentUsername();
        try {
            poeUi.records = await listGenerations(historyUser);
        } catch (error) {
            poeUi.records = [];
        }
        showPoeTab('compose');
        renderHistory();
        // Cross-device history: merge GitHub AI backups without blocking the modal.
        syncRemoteHistoryIntoUi(historyUser);
        if (poeUi.pinnedQuestion) {
            poeUi.counting = false;
            updateMeta(1, false);
            if (!poeUi.activeRecord) showIdle(1, false);
            syncActionButtons();
            return;
        }
        var usable = [];
        try {
            usable = await loadFilteredQuestions();
        } catch (error) {
            usable = [];
        }
        poeUi.counting = false;
        poeUi.filteredCount = usable.length;
        updateMeta(usable.length, false);
        if (!poeUi.activeRecord) showIdle(usable.length, false);
        syncActionButtons();
    }

    function updateMeta(count, counting) {
        poeUi.filteredCount = count;
        refreshSourceMeta(counting);
    }

    function syncPinnedChrome() {
        var subtitle = poeUi.overlay && poeUi.overlay.querySelector('.poe-subtitle');
        if (subtitle && !poeUi.defaultSubtitle) poeUi.defaultSubtitle = subtitle.textContent;
        if (subtitle) {
            subtitle.textContent = poeUi.pinnedQuestion
                ? '這次只根據你按下按鈕的那一題（題幹與答案）出題，不會用目前篩選的其他題。出題模式與「API／模型設定」與篩選出題相同。'
                : (poeUi.defaultSubtitle || subtitle.textContent);
        }
        var sourceBox = poeUi.overlay && poeUi.overlay.querySelector('.poe-source');
        var single = document.getElementById('poe-single-wrap');
        var pasteWrap = document.getElementById('poe-paste-wrap');
        var pinned = !!poeUi.pinnedQuestion;
        if (sourceBox) sourceBox.hidden = pinned;
        if (single) single.hidden = !pinned;
        if (pasteWrap) pasteWrap.hidden = pinned || currentSource() !== 'paste';
        var stem = document.getElementById('poe-single-stem');
        var answer = document.getElementById('poe-single-answer');
        var leadEl = document.getElementById('poe-single-lead');
        if (!pinned) return;
        if (stem) stem.textContent = poeUi.pinnedQuestion.plainText || '';
        if (answer) answer.textContent = explanationText(poeUi.pinnedQuestion) || '（沒有答案）';
        if (leadEl) {
            var pinnedId = poeUi.pinnedQuestion.id || '';
            leadEl.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
        }
    }

    function refreshSourceMeta(counting) {
        var meta = document.getElementById('poe-meta');
        if (!meta) return;
        if (currentSource() === 'single') {
            var pinnedId = poeUi.pinnedQuestion && poeUi.pinnedQuestion.id ? poeUi.pinnedQuestion.id : '';
            meta.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
            return;
        }
        if (currentSource() === 'paste') {
            meta.textContent = leadForPaste(poeUi.pasteCount);
            return;
        }
        meta.textContent = counting ? '正在計算目前篩選的題數…' : leadForCount(poeUi.filteredCount);
    }

    function onSourceChange() {
        if (poeUi.pinnedQuestion) {
            syncPinnedChrome();
            refreshSourceMeta(false);
            if (!poeUi.activeRecord && !poeUi.busy) showIdle(1, false);
            syncActionButtons();
            return;
        }
        var wrap = document.getElementById('poe-paste-wrap');
        var paste = currentSource() === 'paste';
        if (wrap) wrap.hidden = !paste;
        if (paste) poeUi.pasteCount = pasteQuestions().length;
        refreshSourceMeta(poeUi.counting);
        if (!poeUi.activeRecord && !poeUi.busy) showIdle(poeUi.filteredCount, poeUi.counting);
        syncActionButtons();
    }

    function onPasteInput() {
        poeUi.pasteCount = pasteQuestions().length;
        if (currentSource() === 'paste') {
            refreshSourceMeta(false);
            if (!poeUi.activeRecord && !poeUi.busy) showIdle(poeUi.filteredCount, false);
        }
        syncActionButtons();
    }

    function setStatus(message) {
        var status = document.getElementById('poe-status');
        if (status) status.textContent = message || '';
    }

    function showIdle(count, counting) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        closeEnlargeOverlay();
        setEnlargeButtonVisible(false);
        stage.textContent = '';
        var lead = document.createElement('p');
        lead.className = 'poe-lead';
        if (currentSource() === 'single') {
            lead.textContent = '按「根據這一題出題」後，伺服器會只附上這一題的題幹與答案，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else if (currentSource() === 'paste') {
            lead.textContent = '按「根據貼上內容出題」後，伺服器會附上貼上的題目，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else {
            lead.textContent = '按「根據目前篩選出題」後，伺服器會附上參考題，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        }
        stage.appendChild(lead);
        var noteText = '';
        if (currentSource() === 'single') {
            noteText = '';
        } else if (currentSource() === 'paste') {
            noteText = leadForPaste(poeUi.pasteCount);
        } else if (counting || !count) {
            noteText = counting ? '正在計算目前篩選的題數…' : leadForCount(0);
        }
        if (noteText) {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = noteText;
            stage.appendChild(empty);
        }
    }

    function showLoading() {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        closeEnlargeOverlay();
        setEnlargeButtonVisible(false);
        stage.textContent = '';
        var wrap = document.createElement('div');
        wrap.className = 'poe-loading';
        var bar = document.createElement('div');
        bar.className = 'poe-progress';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', '正在出題');
        var fill = document.createElement('div');
        fill.className = 'poe-progress-bar';
        bar.appendChild(fill);
        var title = document.createElement('p');
        title.textContent = '正在出題，請稍候。一次寫多題時，模型可能需要約一分鐘。';
        var elapsed = document.createElement('p');
        elapsed.id = 'poe-elapsed';
        elapsed.className = 'poe-elapsed';
        elapsed.textContent = '已等待 0 秒';
        wrap.appendChild(bar);
        wrap.appendChild(title);
        wrap.appendChild(elapsed);
        stage.appendChild(wrap);
    }

    function showError(code) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        closeEnlargeOverlay();
        setEnlargeButtonVisible(false);
        stage.textContent = '';
        var box = document.createElement('div');
        box.className = 'poe-error';
        box.setAttribute('role', 'alert');
        var title = document.createElement('p');
        title.className = 'poe-error-title';
        title.textContent = (code === 'missing_api_key') ? '需要 API Key' : '未能完成出題';
        var message = document.createElement('p');
        message.textContent = (code === 'missing_api_key')
            ? missingApiKeyMessage(currentProvider())
            : (ERROR_TEXT[code] || ERROR_TEXT.server_error);
        box.appendChild(title);
        box.appendChild(message);
        if (code === 'missing_api_key') {
            var tip = document.createElement('p');
            tip.className = 'poe-note';
            tip.textContent = '按「API／模型設定」選擇供應商（Poe 或 OpenRouter），貼上對應金鑰後按「儲存」，再試一次。每位使用者可用自己的金鑰，不必共用伺服器上的設定。';
            box.appendChild(tip);
            openSettingsModal(true);
        }
        stage.appendChild(box);
    }

    function escapeHtml(text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.escapeHtml === 'function') {
            return window.PoeMarkdown.escapeHtml(text);
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function inlineMarkdownHtml(text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.inlineOnly === 'function') {
            return window.PoeMarkdown.inlineOnly(text);
        }
        return escapeHtml(text);
    }

    function setInlineMarkdown(element, text) {
        element.innerHTML = inlineMarkdownHtml(text);
    }

    function renderStructured(container, text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.renderInto === 'function') {
            window.PoeMarkdown.renderInto(container, text);
            return;
        }
        container.textContent = String(text || '');
    }

    function setEnlargeButtonVisible(show) {
        var btn = document.getElementById('poe-enlarge');
        if (btn) btn.hidden = !show;
    }

    function closeEnlargeOverlay() {
        if (poeUi.enlargeOverlay) {
            poeUi.enlargeOverlay.hidden = true;
        }
        poeUi.resultExpanded = false;
        document.body.classList.remove('poe-result-enlarged');
    }

    function ensureEnlargeOverlay() {
        if (poeUi.enlargeOverlay) return poeUi.enlargeOverlay;
        var overlay = document.createElement('div');
        overlay.id = 'poe-enlarge-overlay';
        overlay.className = 'poe-enlarge-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-enlarge-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-enlarge-title">'
            + '  <header class="poe-enlarge-header">'
            + '    <h2 id="poe-enlarge-title">出題結果</h2>'
            + '    <div class="poe-enlarge-actions">'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-enlarge-copy">複製內容</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-enlarge-restore">還原</button>'
            + '      <button type="button" class="poe-close" id="poe-enlarge-close" aria-label="關閉放大檢視">×</button>'
            + '    </div>'
            + '  </header>'
            + '  <div class="poe-enlarge-body" id="poe-enlarge-body"></div>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) closeEnlargeOverlay();
        });
        overlay.querySelector('#poe-enlarge-restore').addEventListener('click', closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-close').addEventListener('click', closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-copy').addEventListener('click', function () {
            if (poeUi.activeRecord && poeUi.activeRecord.content) copyActive();
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeEnlargeOverlay();
            }
        });
        poeUi.enlargeOverlay = overlay;
        return overlay;
    }

    function enlargeResult() {
        if (!poeUi.activeRecord || !poeUi.activeRecord.content) return;
        var overlay = ensureEnlargeOverlay();
        var body = overlay.querySelector('#poe-enlarge-body');
        body.textContent = '';
        var article = document.createElement('article');
        article.className = 'poe-result poe-result-enlarged-view';
        renderStructured(article, poeUi.activeRecord.content);
        body.appendChild(article);
        overlay.hidden = false;
        poeUi.resultExpanded = true;
        document.body.classList.add('poe-result-enlarged');
        var restore = overlay.querySelector('#poe-enlarge-restore');
        if (restore) restore.focus();
    }

    function showResult(record) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        var article = document.createElement('article');
        article.className = 'poe-result';
        renderStructured(article, record.content);
        stage.appendChild(article);
        stage.scrollTop = 0;
        setEnlargeButtonVisible(!!(record && record.content));
        if (poeUi.resultExpanded) enlargeResult();
    }

    function formatTime(timestamp) {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleString('zh-HK', {
                hour12: false,
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return date.toISOString();
        }
    }

    function clipPreview(line, max) {
        var count = 0;
        var index = 0;
        while (index < line.length && count < max) {
            if (line.substr(index, 2) === '**' || line.substr(index, 2) === '__') {
                index += 2;
                continue;
            }
            count += 1;
            index += 1;
        }
        var sliced = line.slice(0, index);
        if ((sliced.match(/\*\*/g) || []).length % 2 === 1) sliced += '**';
        if ((sliced.match(/__/g) || []).length % 2 === 1) sliced += '__';
        if (index < line.length) sliced += '…';
        return sliced;
    }

    function normalizeReferenceIds(value) {
        if (!Array.isArray(value)) return [];
        var out = [];
        var seen = {};
        for (var i = 0; i < value.length && out.length < 80; i++) {
            var id = String(value[i] == null ? '' : value[i]).trim();
            if (!id || id.length > 80 || seen[id]) continue;
            seen[id] = true;
            out.push(id);
        }
        return out;
    }

    function syncUsageTab() {
        if (!poeUi.overlay) return;
        var tabs = poeUi.overlay.querySelector('.poe-tabs');
        var body = poeUi.overlay.querySelector('.poe-body');
        if (!tabs || !body) return;
        var existingTab = document.getElementById('poe-tab-usage');
        var existingPanel = document.getElementById('poe-panel-usage');
        if (!viewerIsAdmin()) {
            if (existingTab && existingTab.parentNode) existingTab.parentNode.removeChild(existingTab);
            if (existingPanel && existingPanel.parentNode) existingPanel.parentNode.removeChild(existingPanel);
            poeUi.usageRecords = [];
            poeUi.usageActiveId = '';
            poeUi.usageLoaded = false;
            poeUi.usageLoading = false;
            poeUi.usageError = '';
            if (poeUi.activeTab === 'usage') showPoeTab('compose');
            return;
        }
        if (existingTab && existingPanel) return;
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'poe-tab';
        tab.id = 'poe-tab-usage';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-controls', 'poe-panel-usage');
        tab.tabIndex = -1;
        tab.textContent = '使用紀錄';
        tab.addEventListener('click', function () { showPoeTab('usage'); });
        tabs.appendChild(tab);

        var panel = document.createElement('aside');
        panel.className = 'poe-history poe-tab-panel';
        panel.id = 'poe-panel-usage';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', 'poe-tab-usage');
        panel.setAttribute('aria-label', '使用紀錄');
        panel.hidden = true;

        var head = document.createElement('div');
        head.className = 'poe-history-head';
        var title = document.createElement('h3');
        title.textContent = '使用紀錄';
        head.appendChild(title);
        panel.appendChild(head);

        var note = document.createElement('p');
        note.className = 'poe-usage-note';
        note.textContent = '以下是其他使用者的 AI 出題備份。只供管理員查看，不能在這裡刪除或再生成。';
        panel.appendChild(note);

        var label = document.createElement('label');
        label.className = 'poe-history-search';
        label.htmlFor = 'poe-usage-search';
        label.appendChild(document.createTextNode('搜尋參考題編號'));
        var input = document.createElement('input');
        input.type = 'search';
        input.id = 'poe-usage-search';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.placeholder = '例如 2026-P1-01';
        input.setAttribute('aria-label', '搜尋參考題編號');
        label.appendChild(input);
        var usageSearchNote = document.createElement('span');
        usageSearchNote.className = 'poe-history-search-note';
        usageSearchNote.textContent = '只搜尋本頁。';
        label.appendChild(usageSearchNote);
        panel.appendChild(label);

        var usagePager = document.createElement('div');
        usagePager.className = 'poe-history-pager';
        usagePager.setAttribute('role', 'navigation');
        usagePager.setAttribute('aria-label', '使用紀錄分頁');
        var usagePrev = document.createElement('button');
        usagePrev.type = 'button';
        usagePrev.className = 'poe-page-btn';
        usagePrev.id = 'poe-usage-prev';
        usagePrev.disabled = true;
        usagePrev.textContent = '上一頁';
        usagePrev.addEventListener('click', function () { showUsagePage(poeUi.usagePage - 1); });
        var usagePageLabel = document.createElement('span');
        usagePageLabel.className = 'poe-history-page';
        usagePageLabel.id = 'poe-usage-page';
        usagePageLabel.textContent = '第 1 頁';
        var usageNext = document.createElement('button');
        usageNext.type = 'button';
        usageNext.className = 'poe-page-btn';
        usageNext.id = 'poe-usage-next';
        usageNext.disabled = true;
        usageNext.textContent = '下一頁';
        usageNext.addEventListener('click', function () { showUsagePage(poeUi.usagePage + 1); });
        usagePager.appendChild(usagePrev);
        usagePager.appendChild(usagePageLabel);
        usagePager.appendChild(usageNext);
        panel.appendChild(usagePager);

        var list = document.createElement('div');
        list.id = 'poe-usage-list';
        panel.appendChild(list);
        var detail = document.createElement('div');
        detail.id = 'poe-usage-detail';
        detail.className = 'poe-usage-detail';
        detail.hidden = true;
        panel.appendChild(detail);
        body.appendChild(panel);
        input.addEventListener('input', onUsageSearchInput);
    }

    function onUsageSearchInput(event) {
        poeUi.usageQuery = String(event && event.target ? event.target.value : '');
        renderUsage();
    }

    function usageQueryText() {
        var input = document.getElementById('poe-usage-search');
        var raw = input ? String(input.value || '') : String(poeUi.usageQuery || '');
        return raw.trim() ? raw.trim() : '';
    }

    function mapUsageRecord(backup) {
        var owner = String(backup && backup.username || '').trim().toLowerCase();
        if (!owner || owner.length > 80) return null;
        for (var c = 0; c < owner.length; c++) {
            var code = owner.charCodeAt(c);
            if (code < 32 || code === 127) return null;
        }
        var mapped = mapRemoteBackup(backup, owner);
        if (!mapped) return null;
        mapped.owner = owner;
        mapped.id = 'usage:' + owner + ':' + String(mapped.remoteName || mapped.createdAt || '');
        return mapped;
    }

    async function loadUsageRecords(force, pageIndex) {
        if (!viewerIsAdmin() || !document.getElementById('poe-tab-usage')) return;
        if (poeUi.usageLoading) return;
        var page = typeof pageIndex === 'number' ? pageIndex : poeUi.usagePage;
        if (page < 0) page = 0;
        if (poeUi.usageLoaded && !force && page === poeUi.usagePage) {
            renderUsage();
            return;
        }
        var username = currentUsername();
        if (!username || !proxyUrl()) {
            poeUi.usagePage = page;
            poeUi.usageRecords = [];
            poeUi.usageActiveId = '';
            poeUi.usageHasMore = false;
            poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            poeUi.usageLoaded = false;
            renderUsage();
            return;
        }
        var after = page > 0 ? poeUi.usageCursors[page] : null;
        if (page > 0 && !(after && after.name && after.username)) return;
        poeUi.usagePage = page;
        poeUi.usageLoading = true;
        poeUi.usageError = '';
        renderUsage();
        var payload = {
            action: 'listAiUsageRecords',
            username: username
        };
        if (after && after.name && (after.username === 'ryan' || after.username === 'user57')) {
            payload.afterName = after.name;
            payload.afterUser = after.username;
        }
        try {
            var data = await proxyRequest(payload, 90000, null);
            if (!isPoeGenerateModalOpen() || currentUsername() !== username || !viewerIsAdmin()) return;
            if (!data || data.ok !== true || !Array.isArray(data.records)) {
                poeUi.usageRecords = [];
                poeUi.usageActiveId = '';
                poeUi.usageHasMore = false;
                poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
                poeUi.usageLoaded = false;
            } else {
                poeUi.usageRecords = data.records.map(mapUsageRecord).filter(Boolean).slice(0, HISTORY_LIMIT);
                var nextAfter = null;
                if (data.nextAfter && data.nextAfter.name && (data.nextAfter.username === 'ryan' || data.nextAfter.username === 'user57')) {
                    nextAfter = { name: String(data.nextAfter.name), username: String(data.nextAfter.username) };
                }
                poeUi.usageHasMore = data.hasMore === true && !!nextAfter;
                poeUi.usageNextAfter = nextAfter;
                if (poeUi.usageHasMore) poeUi.usageCursors[page + 1] = nextAfter;
                if (!poeUi.usageRecords.length) poeUi.usageHasMore = false;
                poeUi.usageError = '';
                poeUi.usageLoaded = true;
                if (poeUi.usageActiveId && !poeUi.usageRecords.some(function (item) { return item.id === poeUi.usageActiveId; })) {
                    poeUi.usageActiveId = '';
                }
            }
        } catch (error) {
            if (!isPoeGenerateModalOpen() || currentUsername() !== username) return;
            poeUi.usageRecords = [];
            poeUi.usageActiveId = '';
            poeUi.usageHasMore = false;
            poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            poeUi.usageLoaded = false;
        } finally {
            poeUi.usageLoading = false;
            if (document.getElementById('poe-usage-list')) renderUsage();
        }
    }


    function renderUsageDetail(record) {
        var box = document.getElementById('poe-usage-detail');
        if (!box) return;
        box.textContent = '';
        if (!record) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        var meta = document.createElement('p');
        meta.className = 'poe-usage-detail-meta';
        var bits = [record.owner || '', formatTime(record.createdAt)];
        if (record.modeName) bits.push(record.modeName);
        if (record.model) bits.push(record.model);
        meta.textContent = bits.filter(Boolean).join(' \u00b7 ');
        box.appendChild(meta);
        var article = document.createElement('article');
        article.className = 'poe-result';
        renderStructured(article, record.content || '');
        box.appendChild(article);
        box.scrollTop = 0;
    }

    function renderUsage() {
        updateUsagePager();
        var list = document.getElementById('poe-usage-list');
        if (!list) return;
        list.textContent = '';
        if (poeUi.usageLoading) {
            var loading = document.createElement('p');
            loading.className = 'poe-history-empty';
            loading.textContent = '正在載入使用紀錄…';
            list.appendChild(loading);
            renderUsageDetail(null);
            return;
        }
        if (poeUi.usageError) {
            var failed = document.createElement('p');
            failed.className = 'poe-history-empty';
            failed.textContent = poeUi.usageError;
            list.appendChild(failed);
            renderUsageDetail(null);
            return;
        }
        if (!poeUi.usageRecords.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有可顯示的使用紀錄。';
            if (poeUi.usagePage > 0) empty.textContent = '沒有更早的使用紀錄。';
            list.appendChild(empty);
            renderUsageDetail(null);
            return;
        }
        var query = usageQueryText();
        var records = poeUi.usageRecords.filter(function (record) {
            return recordMatchesHistoryQuery(record, query);
        });
        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'poe-history-empty';
            none.textContent = '沒有符合這個編號的紀錄。';
            list.appendChild(none);
            renderUsageDetail(null);
            return;
        }
        var active = null;
        records.forEach(function (record) {
            if (record.id === poeUi.usageActiveId) active = record;
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (record.id === poeUi.usageActiveId ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', record.id === poeUi.usageActiveId ? 'true' : 'false');
            var who = document.createElement('span');
            who.className = 'poe-history-owner';
            who.textContent = record.owner || '';
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            setInlineMarkdown(preview, previewText(record.content));
            var meta = document.createElement('span');
            meta.className = 'poe-history-meta';
            var metaBits = [];
            if (record.referenceSource === 'paste') metaBits.push('貼上');
            if (record.referenceSource === 'single') metaBits.push('單題');
            if (record.modeName) metaBits.push(record.modeName);
            metaBits.push((record.sentCount || 0) + ' 題參考');
            meta.textContent = metaBits.join(' \u00b7 ');
            open.appendChild(who);
            open.appendChild(time);
            open.appendChild(preview);
            open.appendChild(meta);
            open.addEventListener('click', function () {
                poeUi.usageActiveId = record.id;
                renderUsage();
            });
            row.appendChild(open);
            list.appendChild(row);
        });
        renderUsageDetail(active);
    }

    function setPoeTabState(tab, on) {
        if (!tab) return;
        tab.classList.toggle('is-active', !!on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    }

    function showPoeTab(name) {
        var usageAllowed = !!document.getElementById('poe-tab-usage');
        var usageOn = name === 'usage' && usageAllowed;
        var historyOn = name === 'history' && !usageOn;
        var composeOn = !historyOn && !usageOn;
        var compose = document.getElementById('poe-panel-compose');
        var history = document.getElementById('poe-panel-history');
        var usage = document.getElementById('poe-panel-usage');
        if (compose) compose.hidden = !composeOn;
        if (history) history.hidden = !historyOn;
        if (usage) usage.hidden = !usageOn;
        setPoeTabState(document.getElementById('poe-tab-compose'), composeOn);
        setPoeTabState(document.getElementById('poe-tab-history'), historyOn);
        setPoeTabState(document.getElementById('poe-tab-usage'), usageOn);
        poeUi.activeTab = usageOn ? 'usage' : (historyOn ? 'history' : 'compose');
        if (usageOn) loadUsageRecords(false);
    }

    function onHistorySearchInput(event) {
        poeUi.historyQuery = String(event && event.target ? event.target.value : '');
        renderHistory();
    }

    function historyQueryText() {
        var input = document.getElementById('poe-history-search');
        var raw = input ? String(input.value || '') : String(poeUi.historyQuery || '');
        return raw.trim() ? raw.trim() : '';
    }

    function recordMatchesHistoryQuery(record, query) {
        if (!query) return true;
        var ids = record && Array.isArray(record.referenceIds) ? record.referenceIds : [];
        for (var i = 0; i < ids.length; i++) {
            if (String(ids[i]).indexOf(query) !== -1) return true;
        }
        return false;
    }

    function previewText(content) {
        var line = String(content || '').split('\n').map(function (item) { return item.trim(); }).filter(Boolean)[0] || '（沒有內容）';
        line = line.replace(/^#{1,6}\s+/, '');
        return clipPreview(line, 42);
    }


    function updateHistoryPager() {
        var prev = document.getElementById('poe-history-prev');
        var next = document.getElementById('poe-history-next');
        var label = document.getElementById('poe-history-page');
        if (label) label.textContent = '\u7b2c ' + (poeUi.historyPage + 1) + ' \u9801';
        if (prev) prev.disabled = !!(poeUi.historyLoading || poeUi.historyPage <= 0);
        if (next) next.disabled = !!(poeUi.historyLoading || !poeUi.historyHasMore);
    }

    function updateUsagePager() {
        var prev = document.getElementById('poe-usage-prev');
        var next = document.getElementById('poe-usage-next');
        var label = document.getElementById('poe-usage-page');
        if (label) label.textContent = '\u7b2c ' + (poeUi.usagePage + 1) + ' \u9801';
        if (prev) prev.disabled = !!(poeUi.usageLoading || poeUi.usagePage <= 0);
        if (next) next.disabled = !!(poeUi.usageLoading || !poeUi.usageHasMore);
    }

    function showHistoryPage(pageIndex) {
        if (poeUi.historyLoading) return;
        var page = pageIndex | 0;
        if (page < 0 || page === poeUi.historyPage) return;
        if (page === poeUi.historyPage + 1) {
            if (!poeUi.historyHasMore || !poeUi.historyNextAfter) return;
            poeUi.historyCursors[page] = poeUi.historyNextAfter;
        }
        if (page === 0) {
            syncRemoteHistoryIntoUi(currentUsername(), true);
            return;
        }
        var after = poeUi.historyCursors[page] || '';
        if (!after) return;
        var username = currentUsername();
        if (!username) return;
        var token = ++poeUi.historyLoadToken;
        poeUi.historyPage = page;
        poeUi.historyLoading = true;
        poeUi.historyError = '';
        renderHistory();
        fetchRemoteBackupPage(username, after).then(function (remotePage) {
            if (token !== poeUi.historyLoadToken) return;
            if (!isPoeGenerateModalOpen() || currentUsername() !== username) return;
            poeUi.records = remotePage.records || [];
            poeUi.historyHasMore = remotePage.hasMore === true && !!remotePage.nextAfter;
            poeUi.historyNextAfter = remotePage.nextAfter || '';
            if (poeUi.historyHasMore) poeUi.historyCursors[page + 1] = remotePage.nextAfter;
            if (!poeUi.records.length) poeUi.historyHasMore = false;
            poeUi.historyLoading = false;
            renderHistory();
        }).catch(function () {
            if (token !== poeUi.historyLoadToken) return;
            if (!isPoeGenerateModalOpen() || currentUsername() !== username) return;
            poeUi.records = [];
            poeUi.historyHasMore = false;
            poeUi.historyNextAfter = '';
            poeUi.historyError = '暫時未能載入過往紀錄，請再試一次。';
            poeUi.historyLoading = false;
            renderHistory();
        });
    }

    function showUsagePage(pageIndex) {
        if (poeUi.usageLoading) return;
        var page = pageIndex | 0;
        if (page < 0 || page === poeUi.usagePage) return;
        if (page === poeUi.usagePage + 1) {
            if (!poeUi.usageHasMore || !poeUi.usageNextAfter) return;
            poeUi.usageCursors[page] = poeUi.usageNextAfter;
        }
        if (page > 0 && !(poeUi.usageCursors[page] && poeUi.usageCursors[page].name)) return;
        loadUsageRecords(true, page);
    }

    function renderHistory() {
        updateHistoryPager();
        var list = document.getElementById('poe-history-list');
        if (!list) return;
        list.textContent = '';
        if (poeUi.historyLoading || poeUi.historyError) {
            var notice = document.createElement('p');
            notice.className = 'poe-history-empty';
            notice.textContent = poeUi.historyLoading ? '正在載入過往紀錄…' : poeUi.historyError;
            list.appendChild(notice);
            return;
        }
        if (!poeUi.records.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有儲存的生成結果。成功出題後可以在這裡重新打開。';
            if (poeUi.historyPage > 0) empty.textContent = '沒有更早的紀錄。';
            list.appendChild(empty);
            return;
        }
        var query = historyQueryText();
        var records = poeUi.records.filter(function (record) {
            return recordMatchesHistoryQuery(record, query);
        });
        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'poe-history-empty';
            none.textContent = '沒有符合這個編號的紀錄。';
            list.appendChild(none);
            return;
        }
        records.forEach(function (record) {
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (poeUi.activeRecord && poeUi.activeRecord.id === record.id ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', poeUi.activeRecord && poeUi.activeRecord.id === record.id ? 'true' : 'false');
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            setInlineMarkdown(preview, previewText(record.content));
            var meta = document.createElement('span');
            meta.className = 'poe-history-meta';
            var metaBits = [];
            if (record.referenceSource === 'paste') metaBits.push('貼上');
            if (record.referenceSource === 'single') metaBits.push('單題');
            if (record.modeName) metaBits.push(record.modeName);
            metaBits.push((record.sentCount || 0) + ' 題參考');
            meta.textContent = metaBits.join(' · ');
            open.appendChild(time);
            open.appendChild(preview);
            open.appendChild(meta);
            open.addEventListener('click', function () { selectRecord(record); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'poe-history-delete';
            remove.setAttribute('aria-label', '刪除這筆紀錄');
            remove.textContent = '刪除';
            remove.addEventListener('click', function () { removeRecord(record); });
            row.appendChild(open);
            row.appendChild(remove);
            list.appendChild(row);
        });
    }

    async function selectRecord(record) {
        if (poeUi.busy || !record) return;
        showPoeTab('compose');
        poeUi.activeRecord = record;
        renderHistory();
        syncActionButtons();
        if (record.lean && !record.content && record.remoteName) {
            setStatus('正在載入這筆過往紀錄…');
            await fillLeanRemoteRecord(record);
            if (!isPoeGenerateModalOpen()) return;
            if (poeUi.activeRecord !== record) return;
        }
        showResult(record);
        var bits = [formatTime(record.createdAt), record.filterSummary || ''];
        if (record.modeName) bits.push(record.modeName);
        if (record.model) bits.push('模型：' + record.model);
        if (record.truncated) bits.push('參考題曾經截斷');
        setStatus(bits.filter(Boolean).join(' · '));
        renderHistory();
        syncActionButtons();
    }

    async function removeRecord(record) {
        if (poeUi.busy) return;
        try {
            await deleteGeneration(record.id);
        } catch (error) {
            setStatus('未能刪除這筆紀錄。');
            return;
        }
        poeUi.records = poeUi.records.filter(function (item) { return item.id !== record.id; });
        if (poeUi.activeRecord && poeUi.activeRecord.id === record.id) {
            poeUi.activeRecord = null;
            showIdle(poeUi.filteredCount);
            setStatus('已刪除。');
        }
        renderHistory();
        syncActionButtons();
    }

    async function clearHistory() {
        if (poeUi.busy) return;
        var username = currentUsername();
        if (!username || !poeUi.records.length) return;
        if (!confirm('清除這部瀏覽器上目前使用者的出題紀錄？')) return;
        try {
            await clearGenerations(username);
        } catch (error) {
            setStatus('未能清除紀錄。');
            return;
        }
        if (poeUi.historyPage === 0) poeUi.records = [];
        poeUi.activeRecord = null;
        renderHistory();
        showIdle(poeUi.filteredCount);
        setStatus('已清除這部瀏覽器上的出題紀錄。');
        syncActionButtons();
    }

    function syncActionButtons() {
        var start = document.getElementById('poe-start');
        var again = document.getElementById('poe-again');
        var copy = document.getElementById('poe-copy');
        var cancel = document.getElementById('poe-cancel');
        var instruction = instructionField();
        var reset = document.getElementById('poe-instruction-reset');
        var mode = document.getElementById('poe-mode');
        var settingsOpen = document.getElementById('poe-settings-open');
        var test = document.getElementById('poe-test');
        var sourceNow = currentSource();
        var pasteMode = sourceNow === 'paste';
        var singleMode = sourceNow === 'single';
        var canRegenerate = false;
        if (poeUi.activeRecord && poeUi.activeRecord.referenceSource === 'single') {
            canRegenerate = !!poeUi.activeRecord.singleQuestion;
        } else if (poeUi.activeRecord && poeUi.activeRecord.referenceSource === 'paste') {
            canRegenerate = !!(poeUi.activeRecord.pastedReferences && poeUi.activeRecord.pastedReferences.length);
        } else {
            canRegenerate = !!(poeUi.activeRecord && poeUi.activeRecord.referenceIds && poeUi.activeRecord.referenceIds.length);
        }
        if (start) {
            start.textContent = singleMode ? '根據這一題出題' : (pasteMode ? '根據貼上內容出題' : '根據目前篩選出題');
            var blocked = singleMode ? !poeUi.pinnedQuestion : (pasteMode ? poeUi.pasteCount === 0 : (poeUi.counting || poeUi.filteredCount === 0));
            start.disabled = poeUi.busy || blocked;
        }
        if (again) again.disabled = poeUi.busy || !canRegenerate;
        if (copy) copy.disabled = poeUi.busy || !(poeUi.activeRecord && poeUi.activeRecord.content);
        if (cancel) cancel.hidden = !poeUi.busy;
        if (instruction) instruction.disabled = !!poeUi.busy;
        if (reset) reset.disabled = !!poeUi.busy;
        var pasteInput = pasteField();
        if (pasteInput) pasteInput.disabled = !!poeUi.busy;
        if (poeUi.overlay) {
            poeUi.overlay.querySelectorAll('input[name="poe-reference-source"]').forEach(function (input) {
                input.disabled = !!poeUi.busy;
            });
        }
        if (mode) mode.disabled = !!poeUi.busy;
        if (settingsOpen) settingsOpen.disabled = !!poeUi.busy;
        if (test) test.disabled = !!poeUi.busy;
        syncSettingsBusyState();
        setEnlargeButtonVisible(!poeUi.busy && !!(poeUi.activeRecord && poeUi.activeRecord.content));
        var dialog = poeUi.overlay && poeUi.overlay.querySelector('.poe-dialog');
        if (dialog) dialog.setAttribute('aria-busy', poeUi.busy ? 'true' : 'false');
    }

    function startElapsed() {
        stopElapsed();
        poeUi.startedAt = Date.now();
        poeUi.timer = setInterval(function () {
            var node = document.getElementById('poe-elapsed');
            if (!node) return;
            var seconds = Math.floor((Date.now() - poeUi.startedAt) / 1000);
            node.textContent = '已等待 ' + seconds + ' 秒';
        }, 500);
    }

    function stopElapsed() {
        if (poeUi.timer) clearInterval(poeUi.timer);
        poeUi.timer = null;
    }

    function cancelGeneration(silent) {
        if (poeUi.control) {
            poeUi.control.cancelled = true;
            if (poeUi.control.handle) poeUi.control.handle.cancel();
        }
        if (!silent && isPoeGenerateModalOpen()) {
            setStatus(poeUi.busyAction === 'test' ? '已取消這次測試。' : '已取消這次出題。');
        }
    }

    async function generateFromCurrentSource() {
        if (currentSource() === 'single') {
            if (!poeUi.pinnedQuestion || !poeUi.pinnedQuestion.plainText) {
                showError('no_reference_questions');
                syncActionButtons();
                return;
            }
            var singleId = poeUi.pinnedQuestion.id ? ('單題 ' + poeUi.pinnedQuestion.id) : '單題';
            await runGeneration([poeUi.pinnedQuestion], singleId, 'single');
            return;
        }
        if (currentSource() === 'paste') {
            var parsed = pasteQuestions();
            poeUi.pasteCount = parsed.length;
            refreshSourceMeta(false);
            syncActionButtons();
            if (!String(pasteField() && pasteField().value || '').trim() || !parsed.length) {
                showError('empty_paste');
                return;
            }
            var pastedBank = parsed.map(function (item) {
                return { plainText: item.question, answerChi: item.explanation || '' };
            });
            await runGeneration(pastedBank, '貼上 ' + parsed.length + ' 題', 'paste');
            return;
        }
        var usable = [];
        try {
            usable = await loadFilteredQuestions();
        } catch (error) {
            showError('no_reference_questions');
            return;
        }
        updateMeta(usable.length);
        syncActionButtons();
        await runGeneration(usable, filterSummary(usable.length), 'filter');
    }

    async function regenerateActive() {
        var active = poeUi.activeRecord;
        if (!active) return;
        if (active.referenceSource === 'single' && active.singleQuestion) {
            await runGeneration([active.singleQuestion], active.filterSummary || '單題', 'single');
            return;
        }
        if (active.referenceSource === 'paste' && active.pastedReferences && active.pastedReferences.length) {
            var pastedBank = active.pastedReferences.map(function (item) {
                return { plainText: item.question, answerChi: item.explanation || '' };
            });
            await runGeneration(pastedBank, active.filterSummary || '貼上的參考題', 'paste');
            return;
        }
        if (!active.referenceIds) return;
        var questions = await questionsByIds(active.referenceIds);
        if (!questions.length) {
            showError('missing_references');
            syncActionButtons();
            return;
        }
        await runGeneration(questions, active.filterSummary || '沿用上一批參考題', 'filter');
    }

    async function runGeneration(bankQuestions, summary, source) {
        if (poeUi.busy) return;
        showPoeTab('compose');
        source = source === 'paste' ? 'paste' : (source === 'single' ? 'single' : 'filter');
        var references = bankQuestions.map(toReference).filter(function (item) { return item.question; });
        if (!references.length) {
            showError('no_reference_questions');
            syncActionButtons();
            return;
        }
        if (!ensureApiKeyReady()) {
            syncActionButtons();
            return;
        }
        var filteredCount = references.length;
        var sending = references.slice(0, CLIENT_SEND_CAP);
        var instruction = currentInstructionForRequest();
        var mode = currentMode();
        var model = currentModel();
        writeStoredInstruction(instruction);
        writeStoredMode(mode.id);
        writeStoredModel(model, currentProvider());
        writeStoredProvider(currentProvider());
        poeUi.busy = true;
        poeUi.busyAction = 'generate';
        poeUi.control = { cancelled: false, handle: null };
        clearTestBanner();
        syncActionButtons();
        showLoading();
        startElapsed();
        setStatus(filteredCount > sending.length
            ? '正在送出前 ' + sending.length + ' / ' + filteredCount + ' 題參考。'
            : '正在送出 ' + sending.length + ' 題參考。');
        try {
            var data = await proxyRequest(withProviderAndApiKey({
                action: 'generateQuestions',
                username: currentUsername(),
                filteredCount: filteredCount,
                questions: sending,
                instruction: instruction,
                source: source,
                modeId: mode.id,
                model: model,
                referenceIds: source === 'paste' ? [] : normalizeReferenceIds(sending.map(function (item) { return item.id; }))
            }), 240000, poeUi.control);
            if (!isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') hideGenerateButton();
                showError(code);
                focusApiKeyFieldIfMissing(code);
                setStatus('');
                return;
            }
            var record = {
                id: currentUsername() + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8),
                username: currentUsername(),
                createdAt: Date.now(),
                content: String(data.content),
                model: data.model || model,
                modeId: mode.id,
                modeName: mode.name,
                instruction: instruction,
                sentCount: data.sentCount || sending.length,
                filteredCount: data.filteredCount || filteredCount,
                truncated: !!data.truncated || filteredCount > sending.length,
                referenceSource: source,
                singleQuestion: source === 'single' ? (bankQuestions[0] || null) : null,
                referenceIds: source === 'paste' ? [] : normalizeReferenceIds(sending.map(function (item) { return item.id; })),
                pastedReferences: source === 'paste' ? sending.map(function (item) {
                    return { question: item.question, explanation: item.explanation || '' };
                }) : [],
                filterSummary: summary,
                durationMs: data.durationMs || (Date.now() - poeUi.startedAt)
            };
            var saved = true;
            try {
                await saveGeneration(record);
                poeUi.records = await listGenerations(currentUsername());
            } catch (error) {
                saved = false;
                poeUi.records = [record].concat(poeUi.records.filter(function (item) { return item.id !== record.id; }));
            }
            poeUi.historyPage = 0;
            poeUi.historyCursors = [''];
            poeUi.historyNextAfter = '';
            poeUi.historyHasMore = false;
            poeUi.historyError = '';
            poeUi.activeRecord = record;
            showResult(record);
            renderHistory();
            syncRemoteHistoryIntoUi(currentUsername());
            var statusParts = [];
            if (record.modeName) statusParts.push(record.modeName);
            if (record.model) statusParts.push('模型：' + record.model);
            statusParts.push('參考 ' + record.sentCount + ' / ' + record.filteredCount + ' 題');
            if (record.durationMs) statusParts.push('用時 ' + Math.max(1, Math.round(record.durationMs / 1000)) + ' 秒');
            statusParts.push(saved ? '已儲存在這部瀏覽器' : ERROR_TEXT.save_failed);
            if (data.logged === false) statusParts.push('未能寫入試算表紀錄');
            if (data.backedUp === false) statusParts.push('未能備份回覆到試算表');
            setStatus(statusParts.join(' · '));
        } catch (error) {
            if (!isPoeGenerateModalOpen()) return;
            if (error && error.code === 'cancelled') {
                showIdle(poeUi.filteredCount);
                setStatus('已取消這次出題。');
                return;
            }
            showError(error && error.code ? error.code : 'network');
            setStatus('');
        } finally {
            poeUi.busy = false;
            poeUi.busyAction = '';
            poeUi.control = null;
            stopElapsed();
            if (isPoeGenerateModalOpen()) syncActionButtons();
        }
    }

    function errorTextFor(code, action) {
        if (action === 'test' && code === 'rate_limited') return '測試太頻密，請稍後再試。';
        if (action === 'test' && code === 'upstream_timeout') return '模型測試逾時，請再試一次。';
        if (code === 'missing_api_key') return ERROR_TEXT.missing_api_key;
        return ERROR_TEXT[code] || ERROR_TEXT.server_error;
    }

    function clearTestBanner() {
        var banner = document.getElementById('poe-test-banner');
        if (!banner) return;
        banner.hidden = true;
        banner.className = 'poe-test-banner';
        banner.textContent = '';
    }

    function showTestBanner(kind, message) {
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

    function clipReply(text, max) {
        var value = String(text || '').replace(/\s+/g, ' ').trim();
        if (value.length <= max) return value;
        return value.slice(0, max) + '…';
    }

    async function testSelectedModel() {
        if (poeUi.busy) return;
        showPoeTab('compose');
        if (!ensureApiKeyReady()) {
            syncActionButtons();
            return;
        }
        var model = currentModel();
        writeStoredModel(model, currentProvider());
        writeStoredProvider(currentProvider());
        poeUi.busy = true;
        poeUi.busyAction = 'test';
        poeUi.control = { cancelled: false, handle: null };
        syncActionButtons();
        showTestBanner('pending', '正在以 ' + providerLabel(currentProvider()) + ' 測試模型「' + model + '」。這不會根據篩選出題。');
        setStatus('正在測試模型…');
        try {
            var data = await proxyRequest(withProviderAndApiKey({
                action: 'testModel',
                username: currentUsername(),
                model: model
            }), 90000, poeUi.control);
            if (!isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') hideGenerateButton();
                showTestBanner('fail', errorTextFor(code, 'test'));
                focusApiKeyFieldIfMissing(code);
                setStatus('模型測試失敗。');
                return;
            }
            var returned = data.model || model;
            var shown = clipReply(data.content, 400);
            var note = [];
            if (data.logged === false) note.push('未能寫入試算表紀錄');
            if (data.backedUp === false) note.push('未能備份回覆到試算表');
            if (data.passed === false) {
                showTestBanner('fail', '模型「' + returned + '」有回應，但內容不是預期的「正常」。回覆：' + shown);
                setStatus(['模型測試未通過'].concat(note).join(' · '));
                return;
            }
            showTestBanner('ok', '模型「' + returned + '」有回應。回覆：' + shown);
            setStatus(['模型測試成功'].concat(note).join(' · '));
        } catch (error) {
            if (!isPoeGenerateModalOpen()) return;
            if (error && error.code === 'cancelled') {
                showTestBanner('fail', '已取消這次測試。');
                setStatus('已取消這次測試。');
                return;
            }
            var failCode = error && error.code ? error.code : 'network';
            showTestBanner('fail', errorTextFor(failCode, 'test'));
            focusApiKeyFieldIfMissing(failCode);
            setStatus('模型測試失敗。');
        } finally {
            poeUi.busy = false;
            poeUi.busyAction = '';
            poeUi.control = null;
            if (isPoeGenerateModalOpen()) syncActionButtons();
        }
    }

    function copyWithFallback(text) {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(function () {
                return copyWithTextarea(text);
            });
        }
        return copyWithTextarea(text);
    }

    function copyWithTextarea(text) {
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

    function copyActive() {
        if (!poeUi.activeRecord || !poeUi.activeRecord.content) return;
        var button = document.getElementById('poe-copy');
        var original = button ? button.textContent : '複製內容';
        copyWithFallback(poeUi.activeRecord.content).then(function () {
            if (button) {
                button.textContent = '✓';
                setTimeout(function () {
                    if (button.textContent === '✓') button.textContent = original;
                }, 1500);
            }
            setStatus('已複製到剪貼簿。');
        }).catch(function () {
            setStatus('複製失敗，請手動選取文字。');
        });
    }

    window.openPoeGenerateModal = openPoeGenerateModal;
    window.openPoeGenerateModalForQuestion = openPoeGenerateModalForQuestion;
    window.closePoeGenerateModal = closePoeGenerateModal;
    window.isPoeGenerateModalOpen = isPoeGenerateModalOpen;
    window.initPoeGenerateFeature = initPoeGenerateFeature;
    window.logQuestionToolLogin = logQuestionToolLogin;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindGenerateButton);
    } else {
        bindGenerateButton();
    }
})();
