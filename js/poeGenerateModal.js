// poeGenerateModal.js
// Modal for generating new questions from the current filters.
// The browser only talks to the Apps Script web app in config.js.
// The upstream API key and the allowlist stay in Apps Script properties.
// Modes, the edited 出題指示, and the chosen model are stored in localStorage.
// The request sends `instruction`, `modeId`, and `model`.

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
    var INSTRUCTION_MAX = 4000;
    var INSTRUCTION_KEY = 'econ_ai_instruction_v1';
    var MODE_KEY = 'econ_ai_mode_v1';
    var MODEL_KEY = 'econ_ai_model_v1';
    var CLIENT_SEND_CAP = 60;
    var LOCAL_KEY = 'econ_poe_generations_v1';
    var HISTORY_LIMIT = 30;
    var ERROR_TEXT = {
        feature_unavailable: '此功能暫不可用。',
        proxy_not_configured: '出題服務尚未完成設定。',
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
        busyAction: ''
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

    function currentModel() {
        var select = document.getElementById('poe-model');
        var value = select ? String(select.value || '').trim() : '';
        if (POE_MODELS.indexOf(value) !== -1) return value;
        return POE_DEFAULT_MODEL;
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

    function readStoredModel() {
        try {
            var id = localStorage.getItem(MODEL_KEY);
            if (POE_MODELS.indexOf(id) !== -1) return id;
        } catch (error) {}
        return POE_DEFAULT_MODEL;
    }

    function writeStoredModel(id) {
        try {
            if (POE_MODELS.indexOf(id) === -1 || id === POE_DEFAULT_MODEL) {
                localStorage.removeItem(MODEL_KEY);
                return;
            }
            localStorage.setItem(MODEL_KEY, id);
        } catch (error) {}
    }

    function instructionField() {
        return document.getElementById('poe-instruction-input');
    }

    function fillComposerOptions() {
        var modeSelect = document.getElementById('poe-mode');
        var modelSelect = document.getElementById('poe-model');
        if (modeSelect && !modeSelect.options.length) {
            POE_GENERATION_MODES.forEach(function (mode) {
                var option = document.createElement('option');
                option.value = mode.id;
                option.textContent = mode.name;
                modeSelect.appendChild(option);
            });
        }
        if (modelSelect && !modelSelect.options.length) {
            POE_MODELS.forEach(function (model) {
                var option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
        }
    }

    function loadComposer() {
        fillComposerOptions();
        var modeSelect = document.getElementById('poe-mode');
        var modelSelect = document.getElementById('poe-model');
        var mode = modeById(readStoredModeId()) || POE_GENERATION_MODES[0];
        if (modeSelect) modeSelect.value = mode.id;
        if (modelSelect) modelSelect.value = readStoredModel();
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
        writeStoredModel(currentModel());
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

    function hideGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = true;
    }

    function showGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = false;
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
            + '      <p class="poe-subtitle">可以參考目前篩選，或貼上自己的題目。選擇出題模式與模型，可再改出題指示，然後按出題。測試只檢查所選模型能否回應，不會用題目出題。</p>'
            + '    </div>'
            + '    <button type="button" class="poe-close" aria-label="關閉">×</button>'
            + '  </header>'
            + '  <div class="poe-body">'
            + '    <aside class="poe-history" aria-label="過往生成">'
            + '      <div class="poe-history-head">'
            + '        <h3>此瀏覽器的紀錄</h3>'
            + '        <button type="button" class="poe-text-btn" id="poe-history-clear">清除</button>'
            + '      </div>'
            + '      <div id="poe-history-list"></div>'
            + '    </aside>'
            + '    <section class="poe-main">'
            + '      <div class="poe-meta" id="poe-meta"></div>'
            + '      <div class="poe-source" role="radiogroup" aria-label="參考題來源">'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="filter" checked> 使用目前篩選</label>'
            + '        <label class="poe-source-option"><input type="radio" name="poe-reference-source" value="paste"> 自行貼上題目</label>'
            + '      </div>'
            + '      <div class="poe-paste" id="poe-paste-wrap" hidden>'
            + '        <label for="poe-paste-input">貼上題目</label>'
            + '        <textarea id="poe-paste-input" rows="8" maxlength="100000" aria-label="貼上題目" placeholder="可貼上一題或多題。用空行分隔，或以 1. 2. 3. 編號。若有解釋，在題幹後另起一行寫「解釋：」。"></textarea>'
            + '      </div>'
            + '      <div class="poe-controls">'
            + '        <label class="poe-field">出題模式'
            + '          <select id="poe-mode" aria-label="出題模式"></select>'
            + '        </label>'
            + '        <label class="poe-field">模型'
            + '          <select id="poe-model" aria-label="模型"></select>'
            + '        </label>'
            + '        <button type="button" class="btn btn-outline-primary" id="poe-test">測試</button>'
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
            + '      <div class="poe-stage" id="poe-stage" tabindex="0"></div>'
            + '    </section>'
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
        overlay.querySelector('#poe-model').addEventListener('change', onModelChange);
        overlay.querySelector('#poe-instruction-reset').addEventListener('click', resetInstruction);
        overlay.querySelector('#poe-instruction-input').addEventListener('input', function (event) {
            writeStoredInstruction(event.target.value);
        });
        overlay.querySelector('#poe-copy').addEventListener('click', copyActive);
        overlay.querySelector('#poe-cancel').addEventListener('click', function () { cancelGeneration(false); });
        overlay.querySelector('#poe-history-clear').addEventListener('click', clearHistory);
        overlay.addEventListener('keydown', onDialogKeydown);
    }

    function onDialogKeydown(event) {
        if (!isPoeGenerateModalOpen()) return;
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
        poeUi.overlay.hidden = true;
        document.body.classList.remove('poe-modal-open');
        stopElapsed();
        if (poeUi.trigger && typeof poeUi.trigger.focus === 'function') poeUi.trigger.focus();
    }

    async function openPoeGenerateModal() {
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
            return;
        }
        ensureModal();
        loadComposer();
        clearTestBanner();
        var pasteWrap = document.getElementById('poe-paste-wrap');
        if (pasteWrap) pasteWrap.hidden = currentSource() !== 'paste';
        poeUi.pasteCount = pasteQuestions().length;
        poeUi.trigger = document.getElementById('poe-generate-btn');
        poeUi.overlay.hidden = false;
        document.body.classList.add('poe-modal-open');
        setStatus('');
        poeUi.counting = true;
        if (!poeUi.activeRecord) showIdle(0, true);
        updateMeta(0, true);
        syncActionButtons();
        var closeButton = poeUi.overlay.querySelector('.poe-close');
        if (closeButton) closeButton.focus();
        try {
            poeUi.records = await listGenerations(currentUsername());
        } catch (error) {
            poeUi.records = [];
        }
        renderHistory();
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

    function refreshSourceMeta(counting) {
        var meta = document.getElementById('poe-meta');
        if (!meta) return;
        if (currentSource() === 'paste') {
            meta.textContent = leadForPaste(poeUi.pasteCount);
            return;
        }
        meta.textContent = counting ? '正在計算目前篩選的題數…' : leadForCount(poeUi.filteredCount);
    }

    function onSourceChange() {
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
        stage.textContent = '';
        var lead = document.createElement('p');
        lead.className = 'poe-lead';
        if (currentSource() === 'paste') {
            lead.textContent = '按「根據貼上內容出題」後，伺服器會附上貼上的題目，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else {
            lead.textContent = '按「根據目前篩選出題」後，伺服器會附上參考題，並依上方的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        }
        stage.appendChild(lead);
        var noteText = '';
        if (currentSource() === 'paste') {
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
        stage.textContent = '';
        var box = document.createElement('div');
        box.className = 'poe-error';
        box.setAttribute('role', 'alert');
        var title = document.createElement('p');
        title.className = 'poe-error-title';
        title.textContent = '未能完成出題';
        var message = document.createElement('p');
        message.textContent = ERROR_TEXT[code] || ERROR_TEXT.server_error;
        box.appendChild(title);
        box.appendChild(message);
        stage.appendChild(box);
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Escape first, then allow only strong/em. A function replacer avoids
    // treating $&, $`, or $' in the model text as replacement patterns.
    function inlineMarkdownHtml(text) {
        var html = escapeHtml(text);
        html = html.replace(/\*\*([^*\n]+?)\*\*/g, function (_match, inner) {
            return '<strong>' + inner + '</strong>';
        });
        html = html.replace(/__([^_\n]+?)__/g, function (_match, inner) {
            return '<strong>' + inner + '</strong>';
        });
        html = html.replace(/(^|[\s（(])\*([^*\s](?:[^*]*[^*\s])?)\*(?=[\s。，、；：！？)）」]|$)/g, function (_match, prefix, inner) {
            return prefix + '<em>' + inner + '</em>';
        });
        return html;
    }

    function setInlineMarkdown(element, text) {
        element.innerHTML = inlineMarkdownHtml(text);
    }

    function renderStructured(container, text) {
        container.textContent = '';
        var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
        var list = null;
        function endList() {
            if (!list) return;
            container.appendChild(list);
            list = null;
        }
        lines.forEach(function (line) {
            var trimmed = line.trim();
            var heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
            var bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
            if (!trimmed) {
                endList();
                return;
            }
            if (heading) {
                endList();
                var level = heading[1].length;
                var head = document.createElement(level === 1 ? 'h3' : 'h4');
                head.className = 'poe-md-h';
                setInlineMarkdown(head, heading[2]);
                container.appendChild(head);
                return;
            }
            if (bullet) {
                if (!list) {
                    list = document.createElement('ul');
                    list.className = 'poe-md-list';
                }
                var item = document.createElement('li');
                setInlineMarkdown(item, bullet[1]);
                list.appendChild(item);
                return;
            }
            endList();
            var paragraph = document.createElement('p');
            setInlineMarkdown(paragraph, line);
            container.appendChild(paragraph);
        });
        endList();
        if (!container.childNodes.length) {
            var empty = document.createElement('p');
            empty.textContent = '（沒有內容）';
            container.appendChild(empty);
        }
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

    function previewText(content) {
        var line = String(content || '').split('\n').map(function (item) { return item.trim(); }).filter(Boolean)[0] || '（沒有內容）';
        line = line.replace(/^#{1,6}\s+/, '');
        return clipPreview(line, 42);
    }

    function renderHistory() {
        var list = document.getElementById('poe-history-list');
        if (!list) return;
        list.textContent = '';
        if (!poeUi.records.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有儲存的生成結果。成功出題後可以在這裡重新打開。';
            list.appendChild(empty);
            return;
        }
        poeUi.records.forEach(function (record) {
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

    function selectRecord(record) {
        if (poeUi.busy) return;
        poeUi.activeRecord = record;
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
        poeUi.records = [];
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
        var model = document.getElementById('poe-model');
        var test = document.getElementById('poe-test');
        var pasteMode = currentSource() === 'paste';
        var canRegenerate = false;
        if (poeUi.activeRecord && poeUi.activeRecord.referenceSource === 'paste') {
            canRegenerate = !!(poeUi.activeRecord.pastedReferences && poeUi.activeRecord.pastedReferences.length);
        } else {
            canRegenerate = !!(poeUi.activeRecord && poeUi.activeRecord.referenceIds && poeUi.activeRecord.referenceIds.length);
        }
        if (start) {
            start.textContent = pasteMode ? '根據貼上內容出題' : '根據目前篩選出題';
            var blocked = pasteMode ? poeUi.pasteCount === 0 : (poeUi.counting || poeUi.filteredCount === 0);
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
        if (model) model.disabled = !!poeUi.busy;
        if (test) test.disabled = !!poeUi.busy;
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
        source = source === 'paste' ? 'paste' : 'filter';
        var references = bankQuestions.map(toReference).filter(function (item) { return item.question; });
        if (!references.length) {
            showError('no_reference_questions');
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
        writeStoredModel(model);
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
            var data = await proxyRequest({
                action: 'generateQuestions',
                username: currentUsername(),
                filteredCount: filteredCount,
                questions: sending,
                instruction: instruction,
                source: source,
                modeId: mode.id,
                model: model
            }, 240000, poeUi.control);
            if (!isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') hideGenerateButton();
                showError(code);
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
                referenceIds: source === 'paste' ? [] : sending.map(function (item) { return item.id; }).filter(Boolean),
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
            poeUi.activeRecord = record;
            showResult(record);
            renderHistory();
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
        var model = currentModel();
        writeStoredModel(model);
        poeUi.busy = true;
        poeUi.busyAction = 'test';
        poeUi.control = { cancelled: false, handle: null };
        syncActionButtons();
        showTestBanner('pending', '正在測試模型「' + model + '」。這不會根據篩選出題。');
        setStatus('正在測試模型…');
        try {
            var data = await proxyRequest({
                action: 'testModel',
                username: currentUsername(),
                model: model
            }, 90000, poeUi.control);
            if (!isPoeGenerateModalOpen()) return;
            if (!data || data.ok !== true || !data.content) {
                var code = data && data.error ? data.error : 'server_error';
                if (code === 'feature_unavailable') hideGenerateButton();
                showTestBanner('fail', errorTextFor(code, 'test'));
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
            showTestBanner('fail', errorTextFor(error && error.code ? error.code : 'network', 'test'));
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
