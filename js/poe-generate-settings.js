// Provider, model, API key, and instruction settings.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.modeById = function modeById(id) {
        for (var i = 0; i < Poe.POE_GENERATION_MODES.length; i++) {
            if (Poe.POE_GENERATION_MODES[i].id === id) return Poe.POE_GENERATION_MODES[i];
        }
        return null;
    }

    Poe.currentMode = function currentMode() {
        var select = document.getElementById('poe-mode');
        var mode = select ? Poe.modeById(select.value) : null;
        return mode || Poe.POE_GENERATION_MODES[0];
    }

    Poe.normalizeProvider = function normalizeProvider(value) {
        return String(value || '').trim().toLowerCase() === Poe.PROVIDER_OPENROUTER
            ? Poe.PROVIDER_OPENROUTER
            : Poe.PROVIDER_POE;
    }

    Poe.providerLabel = function providerLabel(provider) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER ? 'OpenRouter' : 'Poe';
    }

    Poe.currentProvider = function currentProvider() {
        var checked = document.querySelector('input[name="poe-settings-provider"]:checked');
        if (checked) return Poe.normalizeProvider(checked.value);
        return Poe.readStoredProvider();
    }

    Poe.modelsForProvider = function modelsForProvider(provider) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER ? Poe.OPENROUTER_MODELS : Poe.POE_MODELS;
    }

    Poe.defaultModelForProvider = function defaultModelForProvider(provider) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER
            ? Poe.OPENROUTER_DEFAULT_MODEL
            : Poe.POE_DEFAULT_MODEL;
    }

    Poe.isKnownModel = function isKnownModel(provider, model) {
        var list = Poe.modelsForProvider(provider);
        return list.indexOf(model) !== -1;
    }

    Poe.sanitizeOpenRouterModelId = function sanitizeOpenRouterModelId(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text || text.length > 120) return '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._\-\/:]*$/.test(text)) return '';
        if (text.indexOf('..') !== -1) return '';
        return text;
    }

    Poe.sanitizePoeModelId = function sanitizePoeModelId(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text || text.length > 120) return '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(text)) return '';
        if (text.indexOf('..') !== -1) return '';
        return text;
    }

    Poe.sanitizeModelId = function sanitizeModelId(provider, value) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER
            ? Poe.sanitizeOpenRouterModelId(value)
            : Poe.sanitizePoeModelId(value);
    }

    Poe.settingsModelSelect = function settingsModelSelect(provider) {
        provider = Poe.normalizeProvider(provider);
        return document.getElementById(provider === Poe.PROVIDER_OPENROUTER
            ? 'poe-settings-model-openrouter'
            : 'poe-settings-model-poe');
    }

    Poe.settingsModelCustom = function settingsModelCustom(provider) {
        provider = Poe.normalizeProvider(provider);
        return document.getElementById(provider === Poe.PROVIDER_OPENROUTER
            ? 'poe-settings-model-custom-openrouter'
            : 'poe-settings-model-custom-poe');
    }

    Poe.settingsModelsPanel = function settingsModelsPanel(provider) {
        provider = Poe.normalizeProvider(provider);
        return document.getElementById(provider === Poe.PROVIDER_OPENROUTER
            ? 'poe-settings-models-openrouter'
            : 'poe-settings-models-poe');
    }

    Poe.syncProviderModelPanels = function syncProviderModelPanels(provider) {
        provider = Poe.normalizeProvider(provider);
        var poePanel = Poe.settingsModelsPanel(Poe.PROVIDER_POE);
        var orPanel = Poe.settingsModelsPanel(Poe.PROVIDER_OPENROUTER);
        if (poePanel) poePanel.hidden = provider !== Poe.PROVIDER_POE;
        if (orPanel) orPanel.hidden = provider !== Poe.PROVIDER_OPENROUTER;
    }

    Poe.currentModel = function currentModel() {
        var provider = Poe.currentProvider();
        var custom = Poe.settingsModelCustom(provider);
        var customValue = custom ? Poe.sanitizeModelId(provider, custom.value) : '';
        if (customValue) return customValue;
        var select = Poe.settingsModelSelect(provider);
        if (select) {
            var value = String(select.value || '').trim();
            var sanitized = Poe.sanitizeModelId(provider, value);
            if (sanitized) return sanitized;
        }
        return Poe.readStoredModel(provider);
    }

    Poe.sanitizeClientInstruction = function sanitizeClientInstruction(value) {
        var text = String(value == null ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u2028\u2029]/g, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
        if (text.length > Poe.INSTRUCTION_MAX) {
            text = text.slice(0, Poe.INSTRUCTION_MAX);
            var last = text.charCodeAt(text.length - 1);
            if (last >= 0xD800 && last <= 0xDBFF) text = text.slice(0, -1);
            text = text.trim();
        }
        return text;
    }

    Poe.readStoredInstruction = function readStoredInstruction() {
        try {
            var raw = localStorage.getItem(Poe.INSTRUCTION_KEY);
            if (raw == null) return null;
            return Poe.sanitizeClientInstruction(raw);
        } catch (error) {
            return null;
        }
    }

    Poe.writeStoredInstruction = function writeStoredInstruction(value) {
        try {
            var text = Poe.sanitizeClientInstruction(value);
            var baseline = Poe.currentMode().prompt;
            if (!text || text === baseline) {
                localStorage.removeItem(Poe.INSTRUCTION_KEY);
                return;
            }
            localStorage.setItem(Poe.INSTRUCTION_KEY, text);
        } catch (error) {
            // Quota or private mode. The textarea still holds this session's text.
        }
    }

    Poe.readStoredModeId = function readStoredModeId() {
        try {
            var id = localStorage.getItem(Poe.MODE_KEY);
            if (Poe.modeById(id)) return id;
        } catch (error) {}
        return Poe.POE_GENERATION_MODES[0].id;
    }

    Poe.writeStoredMode = function writeStoredMode(id) {
        try {
            if (!Poe.modeById(id) || id === Poe.POE_GENERATION_MODES[0].id) {
                localStorage.removeItem(Poe.MODE_KEY);
                return;
            }
            localStorage.setItem(Poe.MODE_KEY, id);
        } catch (error) {}
    }

    Poe.modelStorageKey = function modelStorageKey(provider) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER
            ? Poe.MODEL_KEY_OPENROUTER
            : Poe.MODEL_KEY_POE;
    }

    Poe.apiStorageKey = function apiStorageKey(provider) {
        return Poe.normalizeProvider(provider) === Poe.PROVIDER_OPENROUTER
            ? Poe.API_KEY_OPENROUTER
            : Poe.API_KEY_POE;
    }

    Poe.readStoredProvider = function readStoredProvider() {
        try {
            return Poe.normalizeProvider(localStorage.getItem(Poe.PROVIDER_KEY));
        } catch (error) {
            return Poe.PROVIDER_POE;
        }
    }

    Poe.writeStoredProvider = function writeStoredProvider(provider) {
        try {
            provider = Poe.normalizeProvider(provider);
            if (provider === Poe.PROVIDER_POE) {
                localStorage.removeItem(Poe.PROVIDER_KEY);
                return;
            }
            localStorage.setItem(Poe.PROVIDER_KEY, provider);
        } catch (error) {}
    }

    Poe.readStoredModel = function readStoredModel(provider) {
        provider = Poe.normalizeProvider(provider == null ? Poe.readStoredProvider() : provider);
        try {
            var id = localStorage.getItem(Poe.modelStorageKey(provider));
            var sanitized = Poe.sanitizeModelId(provider, id);
            if (sanitized) return sanitized;
            if (provider === Poe.PROVIDER_POE) {
                // Migrate legacy single-model key once.
                var legacy = localStorage.getItem(Poe.MODEL_KEY_LEGACY);
                var legacyOk = Poe.sanitizePoeModelId(legacy);
                if (legacyOk) {
                    Poe.writeStoredModel(legacyOk, Poe.PROVIDER_POE);
                    try { localStorage.removeItem(Poe.MODEL_KEY_LEGACY); } catch (error) {}
                    return legacyOk;
                }
            }
        } catch (error) {}
        return Poe.defaultModelForProvider(provider);
    }

    Poe.writeStoredModel = function writeStoredModel(id, provider) {
        provider = Poe.normalizeProvider(provider == null ? Poe.currentProvider() : provider);
        try {
            var key = Poe.modelStorageKey(provider);
            id = Poe.sanitizeModelId(provider, id);
            var fallback = Poe.defaultModelForProvider(provider);
            if (!id || id === fallback) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, id);
        } catch (error) {}
    }

    Poe.readStoredApiKey = function readStoredApiKey(provider) {
        provider = Poe.normalizeProvider(provider == null ? Poe.readStoredProvider() : provider);
        try {
            var raw = localStorage.getItem(Poe.apiStorageKey(provider));
            if (raw == null) return '';
            return String(raw).trim();
        } catch (error) {
            return '';
        }
    }

    Poe.writeStoredApiKey = function writeStoredApiKey(value, provider) {
        provider = Poe.normalizeProvider(provider == null ? Poe.currentProvider() : provider);
        try {
            var text = String(value == null ? '' : value).trim();
            var key = Poe.apiStorageKey(provider);
            if (!text) {
                localStorage.removeItem(key);
                return;
            }
            localStorage.setItem(key, text);
        } catch (error) {
            // Quota or private mode.
        }
    }

    Poe.clearStoredApiKey = function clearStoredApiKey(provider) {
        provider = Poe.normalizeProvider(provider == null ? Poe.currentProvider() : provider);
        try {
            localStorage.removeItem(Poe.apiStorageKey(provider));
        } catch (error) {}
    }

    Poe.apiKeyForRequest = function apiKeyForRequest(provider) {
        return Poe.readStoredApiKey(provider == null ? Poe.currentProvider() : provider);
    }

    Poe.withProviderAndApiKey = function withProviderAndApiKey(payload) {
        var provider = Poe.normalizeProvider(payload && payload.provider != null
            ? payload.provider
            : Poe.currentProvider());
        payload.provider = provider;
        var key = Poe.apiKeyForRequest(provider);
        if (key) {
            if (provider === Poe.PROVIDER_OPENROUTER) payload.openRouterApiKey = key;
            else payload.poeApiKey = key;
        }
        return payload;
    }

    // Admin may omit a browser key and use the server shared property for that
    // provider (POE_API_KEY or optional OPENROUTER_API_KEY). Everyone else must
    // enter a personal key before test/generate.
    Poe.viewerIsAdmin = function viewerIsAdmin() {
        var rights = (typeof currentAccessRights === 'function')
            ? currentAccessRights()
            : (window.accessRights || null);
        return !!(rights && rights.admin === true);
    }

    Poe.mayUseSharedServerKey = function mayUseSharedServerKey() {
        return Poe.viewerIsAdmin();
    }

    Poe.missingApiKeyMessage = function missingApiKeyMessage(provider) {
        return '尚未設定 ' + Poe.providerLabel(provider) + ' API Key。請按「API／模型設定」輸入金鑰後儲存。';
    }

    Poe.ensureApiKeyReady = function ensureApiKeyReady() {
        var provider = Poe.currentProvider();
        if (Poe.apiKeyForRequest(provider)) return true;
        if (Poe.mayUseSharedServerKey()) return true;
        Poe.showError('missing_api_key');
        Poe.setStatus(Poe.missingApiKeyMessage(provider));
        Poe.openSettingsModal(true);
        return false;
    }

    Poe.focusApiKeyFieldIfMissing = function focusApiKeyFieldIfMissing(code) {
        if (code !== 'missing_api_key') return;
        Poe.openSettingsModal(true);
    }

    Poe.apiKeyField = function apiKeyField() {
        return document.getElementById('poe-settings-api-key');
    }

    Poe.apiKeyHint = function apiKeyHint() {
        return document.getElementById('poe-settings-api-key-hint');
    }

    Poe.settingsStatus = function settingsStatus() {
        return document.getElementById('poe-settings-status');
    }

    Poe.setSettingsStatus = function setSettingsStatus(message) {
        var node = Poe.settingsStatus();
        if (node) node.textContent = message || '';
    }

    Poe.refreshProviderSummary = function refreshProviderSummary() {
        var node = document.getElementById('poe-provider-summary');
        if (!node) return;
        var provider = Poe.readStoredProvider();
        var model = Poe.readStoredModel(provider);
        var hasKey = !!Poe.readStoredApiKey(provider);
        var bits = [Poe.providerLabel(provider), '模型：' + model];
        bits.push(hasKey ? '已設金鑰' : (Poe.mayUseSharedServerKey() ? '可用伺服器金鑰' : '尚未設金鑰'));
        node.textContent = bits.join(' · ');
    }

    Poe.refreshApiKeyUi = function refreshApiKeyUi() {
        var provider = Poe.currentProvider();
        var input = Poe.apiKeyField();
        var hint = Poe.apiKeyHint();
        var label = document.getElementById('poe-settings-api-key-label');
        var stored = Poe.readStoredApiKey(provider);
        if (label) label.textContent = Poe.providerLabel(provider) + ' API Key（個人）';
        if (input && document.activeElement !== input) {
            input.value = stored ? stored : '';
            input.placeholder = stored
                ? '••••••••（已儲存在此瀏覽器）'
                : ('貼上你的 ' + Poe.providerLabel(provider) + ' API Key');
        }
        if (hint) {
            if (stored) {
                hint.textContent = '已在此瀏覽器儲存 ' + Poe.providerLabel(provider) + ' 金鑰。出題與測試時會一併送出；伺服器不會把它寫入紀錄或備份。';
                hint.classList.remove('is-warn');
            } else {
                hint.textContent = '尚未儲存個人金鑰。請先輸入並按「儲存」後再測試或出題（非管理員必須使用個人金鑰）。金鑰只存在此瀏覽器的 localStorage，不會提交到 Git。';
                hint.classList.add('is-warn');
            }
        }
        Poe.refreshProviderSummary();
    }

    Poe.fillSettingsModelOptions = function fillSettingsModelOptions(provider) {
        provider = Poe.normalizeProvider(provider);
        Poe.syncProviderModelPanels(provider);
        var modelSelect = Poe.settingsModelSelect(provider);
        if (!modelSelect) return;
        var list = Poe.modelsForProvider(provider);
        var selected = Poe.readStoredModel(provider);
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
        var custom = Poe.settingsModelCustom(provider);
        if (custom && document.activeElement !== custom) {
            custom.value = (selected && list.indexOf(selected) === -1) ? selected : '';
        }
    }

    Poe.loadSettingsForm = function loadSettingsForm() {
        Poe.ensureSettingsModal();
        var provider = Poe.readStoredProvider();
        var radios = document.querySelectorAll('input[name="poe-settings-provider"]');
        radios.forEach(function (input) {
            input.checked = Poe.normalizeProvider(input.value) === provider;
        });
        Poe.fillSettingsModelOptions(provider);
        Poe.refreshApiKeyUi();
        Poe.setSettingsStatus('');
    }

    Poe.onSettingsProviderChange = function onSettingsProviderChange() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        Poe.writeStoredProvider(provider);
        Poe.fillSettingsModelOptions(provider);
        Poe.refreshApiKeyUi();
        Poe.setSettingsStatus('已切換至 ' + Poe.providerLabel(provider) + '。金鑰與模型各自獨立儲存。');
    }

    Poe.onSettingsModelChange = function onSettingsModelChange() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        var select = Poe.settingsModelSelect(provider);
        var custom = Poe.settingsModelCustom(provider);
        if (custom) custom.value = '';
        var model = select ? String(select.value || '').trim() : '';
        Poe.writeStoredModel(model, provider);
        Poe.refreshProviderSummary();
    }

    Poe.onSettingsCustomModelInput = function onSettingsCustomModelInput() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        var custom = Poe.settingsModelCustom(provider);
        var value = custom ? Poe.sanitizeModelId(provider, custom.value) : '';
        if (!value) return;
        Poe.writeStoredModel(value, provider);
        Poe.fillSettingsModelOptions(provider);
        if (custom) custom.value = value;
        Poe.refreshProviderSummary();
    }

    Poe.saveApiKeyFromInput = function saveApiKeyFromInput() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        var input = Poe.apiKeyField();
        var value = input ? String(input.value || '').trim() : '';
        if (!value) {
            Poe.setSettingsStatus('請先貼上 ' + Poe.providerLabel(provider) + ' API Key，或按「清除」移除已儲存的金鑰。');
            return;
        }
        Poe.writeStoredApiKey(value, provider);
        Poe.writeStoredProvider(provider);
        Poe.writeStoredModel(Poe.currentModel(), provider);
        if (input) input.value = value;
        Poe.refreshApiKeyUi();
        Poe.setSettingsStatus('已儲存 ' + Poe.providerLabel(provider) + ' API Key 到此瀏覽器。');
        Poe.setStatus('已更新 API／模型設定。');
    }

    Poe.clearApiKeyFromUi = function clearApiKeyFromUi() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        Poe.clearStoredApiKey(provider);
        var input = Poe.apiKeyField();
        if (input) input.value = '';
        Poe.refreshApiKeyUi();
        Poe.setSettingsStatus('已清除此瀏覽器上的 ' + Poe.providerLabel(provider) + ' API Key。');
        Poe.setStatus('已清除 ' + Poe.providerLabel(provider) + ' API Key。');
    }

    Poe.saveSettingsFromUi = function saveSettingsFromUi() {
        if (Poe.poeUi.busy) return;
        var provider = Poe.currentProvider();
        Poe.writeStoredProvider(provider);
        var input = Poe.apiKeyField();
        var typed = input ? String(input.value || '').trim() : '';
        if (typed) Poe.writeStoredApiKey(typed, provider);
        var model = Poe.currentModel();
        Poe.writeStoredModel(model, provider);
        Poe.fillSettingsModelOptions(provider);
        Poe.refreshApiKeyUi();
        Poe.setSettingsStatus('已儲存供應商、模型' + (typed ? '與金鑰' : '') + '。');
        Poe.setStatus('已更新 API／模型設定（' + Poe.providerLabel(provider) + ' · ' + model + '）。');
    }



    Poe.instructionField = function instructionField() {
        return document.getElementById('poe-instruction-input');
    }

    Poe.fillComposerOptions = function fillComposerOptions() {
        var modeSelect = document.getElementById('poe-mode');
        if (modeSelect && !modeSelect.options.length) {
            Poe.POE_GENERATION_MODES.forEach(function (mode) {
                var option = document.createElement('option');
                option.value = mode.id;
                option.textContent = mode.name;
                modeSelect.appendChild(option);
            });
        }
    }

    Poe.loadComposer = function loadComposer() {
        Poe.fillComposerOptions();
        var modeSelect = document.getElementById('poe-mode');
        var mode = Poe.modeById(Poe.readStoredModeId()) || Poe.POE_GENERATION_MODES[0];
        if (modeSelect) modeSelect.value = mode.id;
        Poe.refreshProviderSummary();
        var area = Poe.instructionField();
        if (!area) return;
        var stored = Poe.readStoredInstruction();
        area.value = stored || mode.prompt;
    }

    Poe.currentInstructionForRequest = function currentInstructionForRequest() {
        var area = Poe.instructionField();
        var text = area ? Poe.sanitizeClientInstruction(area.value) : '';
        if (text) return text;
        return Poe.currentMode().prompt;
    }

    Poe.resetInstruction = function resetInstruction() {
        var area = Poe.instructionField();
        if (!area || Poe.poeUi.busy) return;
        area.value = Poe.currentMode().prompt;
        Poe.writeStoredInstruction(area.value);
    }

    Poe.onModeChange = function onModeChange() {
        if (Poe.poeUi.busy) return;
        var mode = Poe.currentMode();
        Poe.writeStoredMode(mode.id);
        var area = Poe.instructionField();
        if (!area) return;
        area.value = mode.prompt;
        Poe.writeStoredInstruction(area.value);
    }

    Poe.onModelChange = function onModelChange() {
        if (Poe.poeUi.busy) return;
        Poe.writeStoredModel(Poe.currentModel(), Poe.currentProvider());
    }
})(PoeGenerate);
