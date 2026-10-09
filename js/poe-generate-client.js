// Proxy requests, access checks, and the question text sent to the model.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.proxyUrl = function proxyUrl() {
        if (typeof CONFIG === 'undefined' || !CONFIG.POE_PROXY_WEB_APP_URL) return '';
        return String(CONFIG.POE_PROXY_WEB_APP_URL).trim();
    }

    Poe.currentUsername = function currentUsername() {
        if (!window.authManager || !window.authManager.currentUser) return '';
        return String(window.authManager.currentUser).trim().toLowerCase();
    }

    Poe.beginRequest = function beginRequest(timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        return {
            signal: controller.signal,
            cancel: function () { controller.abort(); },
            clear: function () { clearTimeout(timer); }
        };
    }

    Poe.parseProxyJson = function parseProxyJson(text) {
        var cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/^\)\]\}',?\n/, '');
        return JSON.parse(cleaned);
    }

    Poe.isRetryableProxyCode = function isRetryableProxyCode(code) {
        return code === 'network' || code === 'bad_response' || code === 'empty_response';
    }

    Poe.proxyError = function proxyError(code, detail) {
        var error = new Error(code || 'network');
        error.code = code || 'network';
        if (detail) error.detail = detail;
        return error;
    }

    // One attempt. Retries for connection-style failures go through proxyRequest.
    Poe.proxyRequestOnce = async function proxyRequestOnce(payload, timeoutMs, control) {
        var url = Poe.proxyUrl();
        if (!url) throw Poe.proxyError('proxy_not_configured');
        var handle = Poe.beginRequest(timeoutMs);
        if (control) control.handle = handle;
        var response = null;
        var text = '';
        try {
            response = await fetch(url, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                signal: handle.signal
            });
            // A body that already started reading must not be thrown away for a
            // later retry. Parse what arrived, even when the HTTP status is odd.
            text = await response.text();
            if (!String(text || '').trim()) {
                throw Poe.proxyError('empty_response', 'http_' + response.status);
            }
            try {
                return Poe.parseProxyJson(text);
            } catch (error) {
                throw Poe.proxyError('bad_response', 'http_' + response.status);
            }
        } catch (error) {
            if (error && error.code) throw error;
            if (error && error.name === 'AbortError') {
                throw Poe.proxyError(control && control.cancelled ? 'cancelled' : 'upstream_timeout');
            }
            throw Poe.proxyError('network');
        } finally {
            handle.clear();
            if (control && control.handle === handle) control.handle = null;
        }
    }

    Poe.proxyRequest = async function proxyRequest(payload, timeoutMs, control, options) {
        options = options || {};
        var retries = options.retries;
        if (retries == null) retries = Poe.PROXY_RETRY_MAX;
        retries = Math.max(1, Number(retries) || 1);
        var lastError = null;
        for (var attempt = 1; attempt <= retries; attempt++) {
            if (control && control.cancelled) throw Poe.proxyError('cancelled');
            var started = Date.now();
            try {
                return await Poe.proxyRequestOnce(payload, timeoutMs, control);
            } catch (error) {
                lastError = error;
                var code = error && error.code ? error.code : 'network';
                var elapsed = Date.now() - started;
                // Only retry short connection failures. A long wait that ends in a
                // bad body already used the model; do not run the whole call again.
                var canRetry = attempt < retries
                    && Poe.isRetryableProxyCode(code)
                    && elapsed < 45000
                    && !(control && control.cancelled);
                if (!canRetry) throw error;
                var wait = Poe.PROXY_RETRY_BASE_MS * Math.pow(2, attempt - 1);
                if (typeof Poe.setStatus === 'function' && Poe.isPoeGenerateModalOpen && Poe.isPoeGenerateModalOpen()) {
                    Poe.setStatus('連線不穩，正在重試（' + attempt + '/' + retries + '）…');
                }
                await new Promise(function (resolve) { setTimeout(resolve, wait); });
            }
        }
        throw lastError || Poe.proxyError('network');
    }

    Poe.poeCheckAccess = async function poeCheckAccess() {
        if (typeof refreshAccessRights !== 'function') return false;
        try {
            var rights = await refreshAccessRights();
            return !!(rights && rights.ai === true);
        } catch (error) {
            return false;
        }
    }

    Poe.setAiGenerateAllowed = function setAiGenerateAllowed(allowed) {
        document.body.classList.toggle('poe-ai-allowed', !!allowed);
    }

    Poe.hideGenerateButton = function hideGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = true;
        Poe.setAiGenerateAllowed(false);
    }

    Poe.showGenerateButton = function showGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (button) button.hidden = false;
        Poe.setAiGenerateAllowed(true);
    }

    Poe.refreshPoeGenerateAccess = async function refreshPoeGenerateAccess() {
        Poe.hideGenerateButton();
        var allowed = await Poe.poeCheckAccess();
        if (allowed) Poe.showGenerateButton();
    }

    Poe.logQuestionToolLogin = function logQuestionToolLogin() {
        var username = Poe.currentUsername();
        if (!username || !Poe.proxyUrl()) return;
        var key = 'econ_proxy_login_logged:' + username;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch (error) {
            // Continue. The server also dedupes login rows.
        }
        Poe.proxyRequest({ action: 'logLogin', username: username }, 15000, null).catch(function () {
            try { sessionStorage.removeItem(key); } catch (error) {}
        });
    }

    Poe.initPoeGenerateFeature = function initPoeGenerateFeature() {
        Poe.bindGenerateButton();
        Poe.refreshPoeGenerateAccess();
    }

    Poe.bindGenerateButton = function bindGenerateButton() {
        var button = document.getElementById('poe-generate-btn');
        if (!button || button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', function () {
            Poe.openPoeGenerateModal();
        });
    }

    // Chi-first answer text for AI references — same fields as copyFilteredQuestions
    // (answerMC + answerChi). Falls back to answerEng only when Chi/MC are empty.
    Poe.explanationText = function explanationText(question) {
        if (!question || typeof question !== 'object') return '';
        var letter = question.answerMC && question.answerMC !== '-' ? String(question.answerMC).trim() : '';
        var written = question.answerChi && question.answerChi !== '-' ? String(question.answerChi).trim() : '';
        if (!letter && !written) {
            var eng = question.answerEng && question.answerEng !== '-' ? String(question.answerEng).trim() : '';
            if (eng) written = eng;
        }
        if (letter && written) {
            return written.indexOf(letter) !== -1 ? written : letter + '\n' + written;
        }
        return letter || written || '';
    }

    Poe.bankQuestionFrom = function bankQuestionFrom(question) {
        var stem = String(question.plainText || question.questionTextChi || question.questionTextEng || '').trim();
        return {
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
    }

    // Pack one bank row for generateQuestions. Always include stem + answer
    // (field name `explanation` matches Apps Script packReferences_ / buildPrompt_).
    Poe.toReference = function toReference(question) {
        var bank = Poe.bankQuestionFrom(question || {});
        var concepts = Array.isArray(bank.concepts)
            ? bank.concepts.map(function (item) { return String(item || '').trim(); }).filter(Boolean).join('、')
            : '';
        return {
            id: bank.id || '',
            examination: bank.examination || '',
            year: bank.year == null ? '' : String(bank.year),
            questionType: bank.questionType || '',
            concepts: concepts,
            question: String(bank.plainText || '').trim(),
            explanation: Poe.explanationText(bank)
        };
    }

    Poe.currentFilters = function currentFilters() {
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

    Poe.loadFilteredQuestions = async function loadFilteredQuestions() {
        if (!window.storage || typeof window.storage.getQuestions !== 'function') return [];
        var questions = await window.storage.getQuestions(Poe.currentFilters());
        var sortSelect = document.getElementById('sort-order');
        var sortBy = sortSelect ? sortSelect.value : 'default';
        if (typeof sortQuestions === 'function') questions = sortQuestions(questions, sortBy);
        return questions.filter(function (question) {
            return String(question.plainText || question.questionTextChi || '').trim().length > 0;
        });
    }

    Poe.questionById = async function questionById(id) {
        var wanted = String(id || '');
        if (!wanted || !window.storage || typeof window.storage.getQuestions !== 'function') return null;
        var questions = await window.storage.getQuestions({ triState: {} });
        for (var i = 0; i < questions.length; i++) {
            if (questions[i] && String(questions[i].id) === wanted) return questions[i];
        }
        return null;
    }

    Poe.questionsByIds = async function questionsByIds(ids) {
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

    Poe.currentSource = function currentSource() {
        if (Poe.poeUi.pinnedQuestion) return 'single';
        var selected = document.querySelector('input[name="poe-reference-source"]:checked');
        return selected && selected.value === 'paste' ? 'paste' : 'filter';
    }

    Poe.pasteField = function pasteField() {
        return document.getElementById('poe-paste-input');
    }

    Poe.normalizePaste = function normalizePaste(raw) {
        return String(raw == null ? '' : raw)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u2028\u2029]/g, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
    }

    Poe.isNumberedQuestionLine = function isNumberedQuestionLine(line) {
        return /^(?:\d{1,3})\s*[.、．)）]\s*\S/.test(line) || /^[（(]\s*\d{1,3}\s*[）)]\s*\S/.test(line);
    }

    Poe.isOptionBlock = function isOptionBlock(block) {
        var lines = String(block || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
        if (!lines.length) return false;
        return lines.every(function (line) {
            return /^(?:[A-Ha-h]|[甲乙丙丁戊己庚辛])\s*[.、．)）]\s*\S/.test(line)
                || /^[（(]\s*[A-Ha-h]\s*[）)]\s*\S/.test(line);
        });
    }

    Poe.isExplanationOnly = function isExplanationOnly(block) {
        return /^(?:解釋|答案|參考答案|標準答案|explanation|answer)\s*[:：]/i.test(String(block || '').trim());
    }

    Poe.splitPasteChunks = function splitPasteChunks(text) {
        var lines = text.split('\n');
        var markerRows = [];
        lines.forEach(function (line, index) {
            if (Poe.isNumberedQuestionLine(line.trim())) markerRows.push(index);
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
            if (merged.length && (Poe.isOptionBlock(block) || Poe.isExplanationOnly(block))) {
                merged[merged.length - 1] += '\n\n' + block;
            } else {
                merged.push(block);
            }
        });
        return merged.length ? merged : [text];
    }

    Poe.parsePasteChunk = function parsePasteChunk(chunk) {
        var text = String(chunk || '').trim();
        if (!text) return null;
        text = text.replace(/^(?:\d{1,3})\s*[.、．)）]\s*/, '');
        text = text.replace(/^[（(]\s*\d{1,3}\s*[）)]\s*/, '');
        text = text.replace(/^【[^】\n]{0,24}】\s*/, '');
        // Prefer an explicit 答案／解釋 label (copyFilteredQuestions writes「答案：」).
        var labelAt = text.search(/(?:^|\n)\s*(?:解釋|答案|參考答案|標準答案|explanation|answer)\s*[:：]/i);
        var explanation = '';
        if (labelAt >= 0) {
            explanation = text.slice(labelAt).replace(/^(?:\n)?\s*(?:解釋|答案|參考答案|標準答案|explanation|answer)\s*[:：]\s*/i, '').trim();
            text = text.slice(0, labelAt).trim();
        }
        text = text.replace(/^(?:題目|問題|question)\s*[:：]\s*/i, '').trim();
        if (!text) return null;
        if (text.length > 6000) text = text.slice(0, 6000);
        if (explanation.length > 6000) explanation = explanation.slice(0, 6000);
        return { question: text, explanation: explanation };
    }

    Poe.parsePastedQuestions = function parsePastedQuestions(raw) {
        var text = Poe.normalizePaste(raw);
        if (!text) return [];
        var chunks = Poe.splitPasteChunks(text);
        var items = [];
        chunks.forEach(function (chunk) {
            var item = Poe.parsePasteChunk(chunk);
            if (item && item.question) items.push(item);
        });
        if (!items.length) {
            var only = Poe.parsePasteChunk(text);
            if (only && only.question) items.push(only);
        }
        return items;
    }

    Poe.pasteQuestions = function pasteQuestions() {
        var field = Poe.pasteField();
        return Poe.parsePastedQuestions(field ? field.value : '');
    }

    Poe.filterSummary = function filterSummary(count) {
        var searchEl = document.getElementById('search');
        var search = searchEl ? String(searchEl.value || '').trim() : '';
        if (search) {
            var clipped = search.length > 40 ? search.slice(0, 40) + '…' : search;
            return '篩選 ' + count + ' 題，搜尋「' + clipped + '」';
        }
        return '篩選 ' + count + ' 題';
    }

    Poe.leadForCount = function leadForCount(count) {
        if (!count) return '沒有符合篩選條件、而且含有題幹的題目。';
        if (count > Poe.CLIENT_SEND_CAP) {
            return '目前篩選有 ' + count + ' 題含題幹。出題時會依目前排序送出前 ' + Poe.CLIENT_SEND_CAP + ' 題的題幹與答案，伺服器可能再減少。';
        }
        return '目前篩選有 ' + count + ' 題含題幹，會全部送出題幹與答案作為參考。';
    }

    Poe.leadForPaste = function leadForPaste(count) {
        if (!count) return '請在下方貼上題目。題與題之間可用空行分隔，或以 1. 2. 3. 編號。';
        if (count > Poe.CLIENT_SEND_CAP) {
            return '貼上內容可分成 ' + count + ' 題。出題時會送出前 ' + Poe.CLIENT_SEND_CAP + ' 題。';
        }
        if (count === 1) return '貼上內容會當成 1 題參考。';
        return '貼上內容可分成 ' + count + ' 題參考，會全部送出。';
    }
})(PoeGenerate);
