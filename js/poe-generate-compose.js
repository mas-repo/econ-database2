// Compose view, result rendering, and the usage tab.
// Depends on PoeGenerate from the earlier poe-generate-*.js scripts.
(function (Poe) {

    Poe.updateMeta = function updateMeta(count, counting) {
        Poe.poeUi.filteredCount = count;
        Poe.refreshSourceMeta(counting);
    }

    Poe.syncPinnedChrome = function syncPinnedChrome() {
        var subtitle = Poe.poeUi.overlay && Poe.poeUi.overlay.querySelector('.poe-subtitle');
        if (subtitle && !Poe.poeUi.defaultSubtitle) Poe.poeUi.defaultSubtitle = subtitle.textContent;
        if (subtitle) {
            subtitle.textContent = Poe.poeUi.pinnedQuestion
                ? '這次只根據你按下按鈕的那一題（題幹與答案）出題，不會用目前篩選的其他題。出題模式與「API／模型設定」與篩選出題相同。'
                : (Poe.poeUi.defaultSubtitle || subtitle.textContent);
        }
        var sourceBox = Poe.poeUi.overlay && Poe.poeUi.overlay.querySelector('.poe-source');
        var single = document.getElementById('poe-single-wrap');
        var pasteWrap = document.getElementById('poe-paste-wrap');
        var pinned = !!Poe.poeUi.pinnedQuestion;
        if (sourceBox) sourceBox.hidden = pinned;
        if (single) single.hidden = !pinned;
        if (pasteWrap) pasteWrap.hidden = pinned || Poe.currentSource() !== 'paste';
        var stem = document.getElementById('poe-single-stem');
        var answer = document.getElementById('poe-single-answer');
        var leadEl = document.getElementById('poe-single-lead');
        if (!pinned) return;
        if (stem) stem.textContent = Poe.poeUi.pinnedQuestion.plainText || '';
        if (answer) answer.textContent = Poe.explanationText(Poe.poeUi.pinnedQuestion) || '（沒有答案）';
        if (leadEl) {
            var pinnedId = Poe.poeUi.pinnedQuestion.id || '';
            leadEl.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
        }
    }

    Poe.refreshSourceMeta = function refreshSourceMeta(counting) {
        var meta = document.getElementById('poe-meta');
        if (!meta) return;
        if (Poe.currentSource() === 'single') {
            var pinnedId = Poe.poeUi.pinnedQuestion && Poe.poeUi.pinnedQuestion.id ? Poe.poeUi.pinnedQuestion.id : '';
            meta.textContent = pinnedId
                ? ('將只根據題目 ' + pinnedId + ' 的題幹與答案出題，不會用目前篩選的其他題。')
                : '將只根據這一題的題幹與答案出題，不會用目前篩選的其他題。';
            return;
        }
        if (Poe.currentSource() === 'paste') {
            meta.textContent = Poe.leadForPaste(Poe.poeUi.pasteCount);
            return;
        }
        meta.textContent = counting ? '正在計算目前篩選的題數…' : Poe.leadForCount(Poe.poeUi.filteredCount);
    }

    Poe.onSourceChange = function onSourceChange() {
        if (Poe.poeUi.pinnedQuestion) {
            Poe.syncPinnedChrome();
            Poe.refreshSourceMeta(false);
            if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(1, false);
            Poe.syncActionButtons();
            return;
        }
        var wrap = document.getElementById('poe-paste-wrap');
        var paste = Poe.currentSource() === 'paste';
        if (wrap) wrap.hidden = !paste;
        if (paste) Poe.poeUi.pasteCount = Poe.pasteQuestions().length;
        Poe.refreshSourceMeta(Poe.poeUi.counting);
        if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(Poe.poeUi.filteredCount, Poe.poeUi.counting);
        Poe.syncActionButtons();
    }

    Poe.onPasteInput = function onPasteInput() {
        Poe.poeUi.pasteCount = Poe.pasteQuestions().length;
        if (Poe.currentSource() === 'paste') {
            Poe.refreshSourceMeta(false);
            if (!Poe.poeUi.activeRecord && !Poe.poeUi.busy) Poe.showIdle(Poe.poeUi.filteredCount, false);
        }
        Poe.syncActionButtons();
    }

    Poe.setStatus = function setStatus(message) {
        var status = document.getElementById('poe-status');
        if (status) status.textContent = message || '';
    }

    Poe.setStageChrome = function setStageChrome(options) {
        options = options || {};
        var label = document.getElementById('poe-stage-label');
        var count = document.getElementById('poe-stage-count');
        var pane = document.querySelector('.poe-result-pane');
        if (label) label.textContent = options.label || '出題結果';
        if (count) {
            if (options.countText) {
                count.hidden = false;
                count.textContent = options.countText;
            } else {
                count.hidden = true;
                count.textContent = '';
            }
        }
        if (pane) pane.classList.toggle('has-paper', !!options.hasPaper);
        Poe.setEnlargeButtonVisible(!!options.enlarge);
    }

    Poe.showIdle = function showIdle(count, counting) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setStageChrome({ label: '出題結果', enlarge: false, hasPaper: false });
        stage.textContent = '';
        var idle = document.createElement('div');
        idle.className = 'poe-idle';
        var lead = document.createElement('p');
        lead.className = 'poe-lead';
        if (Poe.currentSource() === 'single') {
            lead.textContent = '按「根據這一題出題」後，伺服器會只附上這一題的題幹與答案，並依右欄的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else if (Poe.currentSource() === 'paste') {
            lead.textContent = '按「根據貼上內容出題」後，伺服器會附上貼上的題目，並依右欄的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        } else {
            lead.textContent = '按「根據目前篩選出題」後，伺服器會附上參考題的題幹與答案，並依右欄的出題模式與出題指示要求模型撰寫全新題目與解釋。結果會保存在這部瀏覽器。';
        }
        idle.appendChild(lead);
        var noteText = '';
        if (Poe.currentSource() === 'single') {
            noteText = '';
        } else if (Poe.currentSource() === 'paste') {
            noteText = Poe.leadForPaste(Poe.poeUi.pasteCount);
        } else if (counting || !count) {
            noteText = counting ? '正在計算目前篩選的題數…' : Poe.leadForCount(0);
        }
        if (noteText) {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = noteText;
            idle.appendChild(empty);
        }
        stage.appendChild(idle);
    }

    Poe.showLoading = function showLoading() {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setStageChrome({ label: '正在出題', enlarge: false, hasPaper: false });
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
        title.id = 'poe-loading-title';
        title.textContent = '正在出題，請稍候。一次寫多題時，模型可能需要數分鐘。';
        var elapsed = document.createElement('p');
        elapsed.id = 'poe-elapsed';
        elapsed.className = 'poe-elapsed';
        elapsed.textContent = '已等待 0 秒';
        wrap.appendChild(bar);
        wrap.appendChild(title);
        wrap.appendChild(elapsed);
        stage.appendChild(wrap);
    }

    Poe.showError = function showError(code) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        Poe.closeEnlargeOverlay();
        Poe.setStageChrome({ label: '出題結果', enlarge: false, hasPaper: false });
        stage.textContent = '';
        var box = document.createElement('div');
        box.className = 'poe-error';
        box.setAttribute('role', 'alert');
        var title = document.createElement('p');
        title.className = 'poe-error-title';
        title.textContent = (code === 'missing_api_key') ? '需要 API Key' : '未能完成出題';
        var message = document.createElement('p');
        message.textContent = (code === 'missing_api_key')
            ? Poe.missingApiKeyMessage(Poe.currentProvider())
            : (Poe.ERROR_TEXT[code] || Poe.ERROR_TEXT.server_error);
        box.appendChild(title);
        box.appendChild(message);
        if (code === 'network' || code === 'bad_response' || code === 'empty_response') {
            var netTip = document.createElement('p');
            netTip.className = 'poe-note';
            netTip.textContent = code === 'network'
                ? '常見原因是瀏覽器到出題服務的連線中斷。已自動重試短暫的連線失敗；若仍失敗，請稍後再試。未完成的紀錄會留在「使用紀錄」。'
                : '服務有回應但內容無法解析。未完成的紀錄會留在「使用紀錄」，可稍後再打開查看是否已取回備份。';
            box.appendChild(netTip);
        }
        if (code === 'missing_api_key') {
            var tip = document.createElement('p');
            tip.className = 'poe-note';
            tip.textContent = '按「API／模型設定」選擇供應商（Poe 或 OpenRouter），貼上對應金鑰後按「儲存」，再試一次。每位使用者可用自己的金鑰，不必共用伺服器上的設定。';
            box.appendChild(tip);
            Poe.openSettingsModal(true);
        }
        stage.appendChild(box);
    }

    Poe.escapeHtml = function escapeHtml(text) {
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

    Poe.inlineMarkdownHtml = function inlineMarkdownHtml(text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.inlineOnly === 'function') {
            return window.PoeMarkdown.inlineOnly(text);
        }
        return Poe.escapeHtml(text);
    }

    Poe.setInlineMarkdown = function setInlineMarkdown(element, text) {
        element.innerHTML = Poe.inlineMarkdownHtml(text);
    }

    Poe.renderStructured = function renderStructured(container, text) {
        if (window.PoeMarkdown && typeof window.PoeMarkdown.renderInto === 'function') {
            window.PoeMarkdown.renderInto(container, text);
            return;
        }
        container.textContent = String(text || '');
    }

    Poe.setEnlargeButtonVisible = function setEnlargeButtonVisible(show) {
        var btn = document.getElementById('poe-enlarge');
        if (btn) btn.hidden = !show;
    }

    Poe.sourceLabelForRecord = function sourceLabelForRecord(record) {
        var source = record && record.referenceSource;
        if (source === 'single') return '單題';
        if (source === 'paste') return '自行貼上';
        return '目前篩選';
    }

    Poe.isQuestionStartLine = function isQuestionStartLine(line) {
        var t = String(line || '').trim();
        if (!t) return false;
        if (/^#{1,4}\s+/.test(t) && /題|第\s*[0-9〇零一二三四五六七八九十百]+|[0-9]+/.test(t)) return true;
        if (/^【?\s*(?:題目|第)\s*[0-9〇零一二三四五六七八九十百]+\s*題?/.test(t)) return true;
        if (/^\*{0,2}題目\s*[0-9〇零一二三四五六七八九十百]+/.test(t)) return true;
        if (/^(?:Q|Question)\s*[0-9]+/i.test(t)) return true;
        return false;
    }

    Poe.isNumberedStartLine = function isNumberedStartLine(line) {
        return /^(?:[1-9][0-9]{0,2})[\.、\)]\s+\S/.test(String(line || '').trim());
    }

    Poe.sectionKindFromLabel = function sectionKindFromLabel(label) {
        if (/解釋|答案|評分/.test(String(label || ''))) return 'answer';
        return 'novelty';
    }

    Poe.parseQuestionChunk = function parseQuestionChunk(chunk, index) {
        var number = index + 1;
        var lines = String(chunk || '').split('\n');
        var title = '第 ' + number + ' 題';
        var bodyStart = 0;
        var first = (lines[0] || '').trim();
        if (Poe.isQuestionStartLine(first) || /^#{1,4}\s+/.test(first)) {
            title = first
                .replace(/^#{1,4}\s+/, '')
                .replace(/^\*{1,2}|\*{1,2}$/g, '')
                .replace(/^【\s*|\s*】$/g, '')
                .trim() || title;
            bodyStart = 1;
            while (bodyStart < lines.length && !String(lines[bodyStart]).trim()) bodyStart += 1;
        }
        var stemLines = [];
        var answerLines = [];
        var noveltyLines = [];
        var bucket = 'stem';
        var labelRe = /^(?:\*{0,2})(解釋|答案|參考答案|標準答案|評分重點|新意|創新之處|創新點|創新)(?:\*{0,2})\s*[:：]\s*(?:\*{0,2})(.*?)(?:\*{0,2})?$/;
        lines.slice(bodyStart).forEach(function (line) {
            var m = labelRe.exec(String(line).trim());
            if (m) {
                bucket = Poe.sectionKindFromLabel(m[1]);
                var rem = String(m[2] || '').trim();
                if (rem) {
                    if (bucket === 'answer') answerLines.push(rem);
                    else noveltyLines.push(rem);
                }
                return;
            }
            if (bucket === 'stem') stemLines.push(line);
            else if (bucket === 'answer') answerLines.push(line);
            else noveltyLines.push(line);
        });
        function join(arr) {
            return arr.join('\n').replace(/^\n+|\n+$/g, '').trim();
        }
        var stem = join(stemLines);
        var answer = join(answerLines);
        var novelty = join(noveltyLines);
        if (Poe.isNumberedStartLine(stem) && !Poe.isQuestionStartLine(first)) {
            stem = stem.replace(/^(?:[1-9][0-9]{0,2})[\.、\)]\s+/, '');
        }
        if (!stem && !answer && !novelty) stem = String(chunk || '').trim();
        return {
            number: number,
            title: title,
            stem: stem,
            answer: answer,
            novelty: novelty,
            raw: String(chunk || '')
        };
    }

    Poe.splitGeneratedQuestions = function splitGeneratedQuestions(content) {
        var text = String(content || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trim();
        if (!text) return [];
        var lines = text.split('\n');
        var starts = [];
        for (var i = 0; i < lines.length; i++) {
            if (Poe.isQuestionStartLine(lines[i])) starts.push(i);
        }
        if (starts.length < 2) {
            starts = [];
            for (var j = 0; j < lines.length; j++) {
                if (Poe.isNumberedStartLine(lines[j])) starts.push(j);
            }
        }
        var chunks = [];
        if (starts.length >= 2) {
            for (var k = 0; k < starts.length; k++) {
                var from = starts[k];
                var to = k + 1 < starts.length ? starts[k + 1] : lines.length;
                var chunk = lines.slice(from, to).join('\n').trim();
                if (chunk) chunks.push(chunk);
            }
        } else {
            chunks = [text];
        }
        return chunks.map(Poe.parseQuestionChunk);
    }

    Poe.questionPlainText = function questionPlainText(question) {
        if (!question) return '';
        var parts = [];
        if (question.title) parts.push(question.title);
        if (question.stem) parts.push(question.stem);
        if (question.answer) parts.push('解釋：\n' + question.answer);
        if (question.novelty) parts.push('新意：\n' + question.novelty);
        return parts.join('\n\n').trim();
    }

    Poe.copyTextWithFeedback = function copyTextWithFeedback(text, button, doneLabel) {
        if (!text) return;
        var original = button ? button.textContent : '';
        Poe.copyWithFallback(text).then(function () {
            if (button) {
                button.textContent = doneLabel || '已複製';
                setTimeout(function () {
                    if (button.textContent === (doneLabel || '已複製')) button.textContent = original;
                }, 1500);
            }
            Poe.setStatus('已複製到剪貼簿。');
        }).catch(function () {
            Poe.setStatus('複製失敗，請手動選取文字。');
        });
    }

    Poe.appendMarkdownBlock = function appendMarkdownBlock(parent, text, className) {
        var block = document.createElement('div');
        block.className = className || 'poe-md-block';
        if (text && String(text).trim()) Poe.renderStructured(block, text);
        else {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = '（沒有內容）';
            block.appendChild(empty);
        }
        parent.appendChild(block);
        return block;
    }

    Poe.buildRequestSummary = function buildRequestSummary(record) {
        var section = document.createElement('section');
        section.className = 'poe-request-summary';
        section.setAttribute('aria-label', '這次出題請求');

        var chips = document.createElement('div');
        chips.className = 'poe-request-chips';
        function addChip(label, value) {
            if (!value) return;
            var chip = document.createElement('span');
            chip.className = 'poe-request-chip';
            chip.innerHTML = '<span class="poe-request-chip-label">' + Poe.escapeHtml(label) + '</span>'
                + '<span class="poe-request-chip-value">' + Poe.escapeHtml(value) + '</span>';
            chips.appendChild(chip);
        }
        addChip('模式', record.modeName || '');
        addChip('模型', record.model || '');
        if (record.owner) addChip('使用者', record.owner);
        addChip('來源', Poe.sourceLabelForRecord(record));
        if (record.sentCount || record.filteredCount) {
            addChip('參考', (record.sentCount || 0) + ' / ' + (record.filteredCount || record.sentCount || 0) + ' 題');
        }
        if (record.createdAt) addChip('時間', Poe.formatTime(record.createdAt));
        if (record.durationMs) addChip('用時', Math.max(1, Math.round(record.durationMs / 1000)) + ' 秒');
        section.appendChild(chips);

        var details = document.createElement('details');
        details.className = 'poe-request-details';
        var summary = document.createElement('summary');
        summary.textContent = '對照這次請求';
        details.appendChild(summary);

        if (record.filterSummary) {
            var filter = document.createElement('p');
            filter.className = 'poe-request-line';
            filter.innerHTML = '<strong>篩選摘要</strong> ' + Poe.escapeHtml(record.filterSummary);
            details.appendChild(filter);
        }

        var instruction = String(record.instruction || '').trim();
        if (instruction) {
            var instrWrap = document.createElement('div');
            instrWrap.className = 'poe-request-block';
            var instrTitle = document.createElement('div');
            instrTitle.className = 'poe-request-block-title';
            instrTitle.textContent = '出題指示';
            var instrBody = document.createElement('pre');
            instrBody.className = 'poe-request-pre';
            instrBody.textContent = instruction;
            instrWrap.appendChild(instrTitle);
            instrWrap.appendChild(instrBody);
            details.appendChild(instrWrap);
        }

        var refs = Array.isArray(record.referenceIds) ? record.referenceIds.filter(Boolean) : [];
        if (refs.length) {
            var refWrap = document.createElement('div');
            refWrap.className = 'poe-request-block';
            var refTitle = document.createElement('div');
            refTitle.className = 'poe-request-block-title';
            refTitle.textContent = '參考題編號';
            var refBody = document.createElement('p');
            refBody.className = 'poe-request-refs';
            refBody.textContent = refs.join('、');
            refWrap.appendChild(refTitle);
            refWrap.appendChild(refBody);
            details.appendChild(refWrap);
        } else if (record.referenceSource === 'paste' && Array.isArray(record.pastedReferences) && record.pastedReferences.length) {
            var pasteWrap = document.createElement('div');
            pasteWrap.className = 'poe-request-block';
            var pasteTitle = document.createElement('div');
            pasteTitle.className = 'poe-request-block-title';
            pasteTitle.textContent = '貼上參考';
            var pasteBody = document.createElement('p');
            pasteBody.className = 'poe-request-refs';
            pasteBody.textContent = '共 ' + record.pastedReferences.length + ' 題自行貼上的參考內容';
            pasteWrap.appendChild(pasteTitle);
            pasteWrap.appendChild(pasteBody);
            details.appendChild(pasteWrap);
        } else if (record.referenceSource === 'single' && record.singleQuestion && record.singleQuestion.id) {
            var singleWrap = document.createElement('div');
            singleWrap.className = 'poe-request-block';
            var singleTitle = document.createElement('div');
            singleTitle.className = 'poe-request-block-title';
            singleTitle.textContent = '參考題編號';
            var singleBody = document.createElement('p');
            singleBody.className = 'poe-request-refs';
            singleBody.textContent = record.singleQuestion.id;
            singleWrap.appendChild(singleTitle);
            singleWrap.appendChild(singleBody);
            details.appendChild(singleWrap);
        }

        if (!details.querySelector('.poe-request-block') && !details.querySelector('.poe-request-line')) {
            var none = document.createElement('p');
            none.className = 'poe-note';
            none.textContent = '這筆紀錄沒有保存完整的請求細節。';
            details.appendChild(none);
        }

        section.appendChild(details);
        return section;
    }

    Poe.buildQuestionCard = function buildQuestionCard(question, options) {
        options = options || {};
        var card = document.createElement('article');
        card.className = 'poe-question-card' + (options.full ? ' is-full' : '');
        card.setAttribute('aria-label', question.title || ('第 ' + question.number + ' 題'));

        var head = document.createElement('header');
        head.className = 'poe-question-head';
        var badge = document.createElement('span');
        badge.className = 'poe-question-badge';
        badge.textContent = options.full ? '整份回覆' : (question.title || ('第 ' + question.number + ' 題'));
        head.appendChild(badge);
        if (!options.hideCopy) {
            var copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'poe-text-btn poe-question-copy';
            copyBtn.textContent = options.full ? '複製內容' : '複製此題';
            copyBtn.addEventListener('click', function () {
                Poe.copyTextWithFeedback(
                    options.full ? String(options.fullText || question.raw || '') : Poe.questionPlainText(question),
                    copyBtn,
                    '已複製'
                );
            });
            head.appendChild(copyBtn);
        }
        card.appendChild(head);

        if (options.full) {
            Poe.appendMarkdownBlock(card, options.fullText || question.raw || question.stem || '', 'poe-question-body');
            return card;
        }

        var stem = document.createElement('div');
        stem.className = 'poe-question-stem';
        Poe.appendMarkdownBlock(stem, question.stem || '', 'poe-question-body');
        card.appendChild(stem);

        if (question.answer) {
            var answer = document.createElement('section');
            answer.className = 'poe-question-section is-answer';
            var answerTitle = document.createElement('h4');
            answerTitle.textContent = '解釋';
            answer.appendChild(answerTitle);
            Poe.appendMarkdownBlock(answer, question.answer, 'poe-question-body');
            card.appendChild(answer);
        }
        if (question.novelty) {
            var novelty = document.createElement('section');
            novelty.className = 'poe-question-section is-novelty';
            var noveltyTitle = document.createElement('h4');
            noveltyTitle.textContent = '新意';
            novelty.appendChild(noveltyTitle);
            Poe.appendMarkdownBlock(novelty, question.novelty, 'poe-question-body');
            card.appendChild(novelty);
        }
        return card;
    }

    Poe.buildPaperView = function buildPaperView(record, options) {
        options = options || {};
        var paper = document.createElement('div');
        paper.className = 'poe-paper' + (options.enlarged ? ' is-enlarged' : '');

        if (!options.hideRequest) paper.appendChild(Poe.buildRequestSummary(record || {}));

        var content = String(record && record.content || '').trim();
        var questions = Poe.splitGeneratedQuestions(content);
        var structured = questions.length > 1
            || (questions.length === 1 && !!(questions[0].answer || questions[0].novelty));

        var listHead = document.createElement('div');
        listHead.className = 'poe-paper-list-head';
        var listTitle = document.createElement('h3');
        listTitle.className = 'poe-paper-list-title';
        if (!content) listTitle.textContent = '沒有可顯示的內容';
        else if (structured) listTitle.textContent = '題目';
        else listTitle.textContent = '模型回覆';
        listHead.appendChild(listTitle);
        paper.appendChild(listHead);

        if (!content) {
            var empty = document.createElement('p');
            empty.className = 'poe-note';
            empty.textContent = '（沒有內容）';
            paper.appendChild(empty);
            return { root: paper, questionCount: 0, structured: false };
        }

        if (structured) {
            var list = document.createElement('div');
            list.className = 'poe-question-list';
            questions.forEach(function (question) {
                list.appendChild(Poe.buildQuestionCard(question));
            });
            paper.appendChild(list);
            return { root: paper, questionCount: questions.length, structured: true };
        }

        var fallback = questions[0] || { title: '整份回覆', stem: content, raw: content, number: 1 };
        paper.appendChild(Poe.buildQuestionCard(fallback, {
            full: true,
            fullText: content,
            hideCopy: !!options.hideCopy
        }));
        return { root: paper, questionCount: 1, structured: false };
    }

    Poe.closeEnlargeOverlay = function closeEnlargeOverlay() {
        if (Poe.poeUi.enlargeOverlay) {
            Poe.poeUi.enlargeOverlay.hidden = true;
        }
        Poe.poeUi.resultExpanded = false;
        Poe.poeUi.enlargeRecord = null;
        document.body.classList.remove('poe-result-enlarged');
    }

    Poe.ensureEnlargeOverlay = function ensureEnlargeOverlay() {
        if (Poe.poeUi.enlargeOverlay) return Poe.poeUi.enlargeOverlay;
        var overlay = document.createElement('div');
        overlay.id = 'poe-enlarge-overlay';
        overlay.className = 'poe-enlarge-overlay';
        overlay.hidden = true;
        overlay.innerHTML = ''
            + '<div class="poe-enlarge-dialog" role="dialog" aria-modal="true" aria-labelledby="poe-enlarge-title">'
            + '  <header class="poe-enlarge-header">'
            + '    <div class="poe-enlarge-heading">'
            + '      <h2 id="poe-enlarge-title">出題結果</h2>'
            + '      <span class="poe-stage-count" id="poe-enlarge-count" hidden></span>'
            + '    </div>'
            + '    <div class="poe-enlarge-actions">'
            + '      <button type="button" class="btn btn-outline-primary" id="poe-enlarge-copy">複製全部</button>'
            + '      <button type="button" class="btn btn-secondary" id="poe-enlarge-restore">還原</button>'
            + '      <button type="button" class="poe-close" id="poe-enlarge-close" aria-label="關閉放大檢視">×</button>'
            + '    </div>'
            + '  </header>'
            + '  <div class="poe-enlarge-body" id="poe-enlarge-body"></div>'
            + '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) Poe.closeEnlargeOverlay();
        });
        overlay.querySelector('#poe-enlarge-restore').addEventListener('click', Poe.closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-close').addEventListener('click', Poe.closeEnlargeOverlay);
        overlay.querySelector('#poe-enlarge-copy').addEventListener('click', function () {
            var record = Poe.poeUi.enlargeRecord || Poe.poeUi.activeRecord;
            if (record && record.content) {
                Poe.copyTextWithFeedback(record.content, document.getElementById('poe-enlarge-copy'), '已複製');
            }
        });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                Poe.closeEnlargeOverlay();
            }
        });
        Poe.poeUi.enlargeOverlay = overlay;
        return overlay;
    }

    Poe.enlargeResult = function enlargeResult(record) {
        var target = record || Poe.poeUi.activeRecord;
        if (!target || !target.content) return;
        Poe.poeUi.enlargeRecord = target;
        var overlay = Poe.ensureEnlargeOverlay();
        var body = overlay.querySelector('#poe-enlarge-body');
        body.textContent = '';
        var built = Poe.buildPaperView(target, { enlarged: true });
        body.appendChild(built.root);
        var count = overlay.querySelector('#poe-enlarge-count');
        if (count) {
            if (built.questionCount > 0) {
                count.hidden = false;
                count.textContent = built.structured
                    ? ('共 ' + built.questionCount + ' 題')
                    : '整份回覆';
            } else {
                count.hidden = true;
                count.textContent = '';
            }
        }
        overlay.hidden = false;
        Poe.poeUi.resultExpanded = true;
        document.body.classList.add('poe-result-enlarged');
        var restore = overlay.querySelector('#poe-enlarge-restore');
        if (restore) restore.focus();
    }

    Poe.showResult = function showResult(record) {
        var stage = document.getElementById('poe-stage');
        if (!stage) return;
        stage.textContent = '';
        if (record && record.incomplete && !String(record.content || '').trim()) {
            Poe.setStageChrome({ label: '出題結果', enlarge: false, hasPaper: false });
            var pending = document.createElement('div');
            pending.className = 'poe-idle';
            var pendingTitle = document.createElement('p');
            pendingTitle.className = 'poe-idle-title';
            pendingTitle.textContent = '這次出題尚未完成';
            var pendingBody = document.createElement('p');
            pendingBody.textContent = '關閉視窗或連線中斷時還沒有收到回覆文字。若伺服器稍後有備份，可再打開「使用紀錄」查看。';
            pending.appendChild(pendingTitle);
            pending.appendChild(pendingBody);
            stage.appendChild(pending);
            return;
        }
        var built = Poe.buildPaperView(record || {});
        stage.appendChild(built.root);
        stage.scrollTop = 0;
        var label = record && record.incomplete ? '出題結果（未完成）' : '出題結果';
        Poe.setStageChrome({
            label: label,
            countText: !record || !record.content
                ? ''
                : (built.structured ? ('共 ' + built.questionCount + ' 題') : '整份回覆'),
            enlarge: !!(record && record.content),
            hasPaper: !!(record && record.content)
        });
        if (Poe.poeUi.resultExpanded) Poe.enlargeResult();
    }

    Poe.formatTime = function formatTime(timestamp) {
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

    Poe.clipPreview = function clipPreview(line, max) {
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

    Poe.normalizeReferenceIds = function normalizeReferenceIds(value) {
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

    Poe.syncUsageTab = function syncUsageTab() {
        if (!Poe.poeUi.overlay) return;
        var tabs = Poe.poeUi.overlay.querySelector('.poe-tabs');
        var body = Poe.poeUi.overlay.querySelector('.poe-body');
        if (!tabs || !body) return;
        var existingTab = document.getElementById('poe-tab-usage');
        var existingPanel = document.getElementById('poe-panel-usage');
        if (!Poe.viewerIsAdmin()) {
            if (existingTab && existingTab.parentNode) existingTab.parentNode.removeChild(existingTab);
            if (existingPanel && existingPanel.parentNode) existingPanel.parentNode.removeChild(existingPanel);
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageLoaded = false;
            Poe.poeUi.usageLoading = false;
            Poe.poeUi.usageError = '';
            if (Poe.poeUi.activeTab === 'usage') Poe.showPoeTab('compose');
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
        tab.addEventListener('click', function () { Poe.showPoeTab('usage'); });
        tabs.appendChild(tab);

        var panel = document.createElement('section');
        panel.className = 'poe-usage-layout poe-tab-panel';
        panel.id = 'poe-panel-usage';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', 'poe-tab-usage');
        panel.setAttribute('aria-label', '使用紀錄');
        panel.hidden = true;

        var resultPane = document.createElement('div');
        resultPane.className = 'poe-usage-result-pane';
        var stageBar = document.createElement('div');
        stageBar.className = 'poe-stage-bar';
        stageBar.innerHTML = ''
            + '<div class="poe-stage-heading">'
            + '  <span class="poe-stage-label" id="poe-usage-stage-label">出題結果</span>'
            + '  <span class="poe-stage-count" id="poe-usage-stage-count" hidden></span>'
            + '</div>'
            + '<div class="poe-stage-actions">'
            + '  <button type="button" class="poe-text-btn" id="poe-usage-enlarge" hidden>放大檢視</button>'
            + '</div>';
        resultPane.appendChild(stageBar);
        var detail = document.createElement('div');
        detail.id = 'poe-usage-detail';
        detail.className = 'poe-usage-detail is-empty';
        detail.setAttribute('tabindex', '0');
        resultPane.appendChild(detail);
        panel.appendChild(resultPane);

        var sidebar = document.createElement('aside');
        sidebar.className = 'poe-usage-sidebar';
        sidebar.setAttribute('aria-label', '其他使用者的出題紀錄');

        var head = document.createElement('div');
        head.className = 'poe-history-head';
        var title = document.createElement('h3');
        title.textContent = '使用紀錄';
        head.appendChild(title);
        sidebar.appendChild(head);

        var note = document.createElement('p');
        note.className = 'poe-usage-note';
        note.textContent = '以下是其他使用者的 AI 出題備份。只供管理員查看，不能在這裡刪除或再生成。點選一筆後，左側會顯示完整出題結果。';
        sidebar.appendChild(note);

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
        sidebar.appendChild(label);

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
        usagePrev.addEventListener('click', function () { Poe.showUsagePage(Poe.poeUi.usagePage - 1); });
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
        usageNext.addEventListener('click', function () { Poe.showUsagePage(Poe.poeUi.usagePage + 1); });
        usagePager.appendChild(usagePrev);
        usagePager.appendChild(usagePageLabel);
        usagePager.appendChild(usageNext);
        sidebar.appendChild(usagePager);

        var list = document.createElement('div');
        list.id = 'poe-usage-list';
        sidebar.appendChild(list);
        panel.appendChild(sidebar);

        body.appendChild(panel);
        input.addEventListener('input', Poe.onUsageSearchInput);
        var enlargeBtn = document.getElementById('poe-usage-enlarge');
        if (enlargeBtn) {
            enlargeBtn.addEventListener('click', function () {
                Poe.enlargeUsageResult();
            });
        }
        Poe.renderUsageDetail(null);
    }

    Poe.onUsageSearchInput = function onUsageSearchInput(event) {
        Poe.poeUi.usageQuery = String(event && event.target ? event.target.value : '');
        Poe.renderUsage();
    }

    Poe.usageQueryText = function usageQueryText() {
        var input = document.getElementById('poe-usage-search');
        var raw = input ? String(input.value || '') : String(Poe.poeUi.usageQuery || '');
        return raw.trim() ? raw.trim() : '';
    }

    Poe.mapUsageRecord = function mapUsageRecord(backup) {
        var owner = String(backup && backup.username || '').trim().toLowerCase();
        if (!owner || owner.length > 80) return null;
        for (var c = 0; c < owner.length; c++) {
            var code = owner.charCodeAt(c);
            if (code < 32 || code === 127) return null;
        }
        var mapped = Poe.mapRemoteBackup(backup, owner);
        if (!mapped) return null;
        mapped.owner = owner;
        mapped.id = 'usage:' + owner + ':' + String(mapped.remoteName || mapped.createdAt || '');
        return mapped;
    }

    Poe.loadUsageRecords = async function loadUsageRecords(force, pageIndex) {
        if (!Poe.viewerIsAdmin() || !document.getElementById('poe-tab-usage')) return;
        if (Poe.poeUi.usageLoading) return;
        var page = typeof pageIndex === 'number' ? pageIndex : Poe.poeUi.usagePage;
        if (page < 0) page = 0;
        if (Poe.poeUi.usageLoaded && !force && page === Poe.poeUi.usagePage) {
            Poe.renderUsage();
            return;
        }
        var username = Poe.currentUsername();
        if (!username || !Poe.proxyUrl()) {
            Poe.poeUi.usagePage = page;
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageHasMore = false;
            Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            Poe.poeUi.usageLoaded = false;
            Poe.renderUsage();
            return;
        }
        var after = page > 0 ? Poe.poeUi.usageCursors[page] : null;
        if (page > 0 && !(after && after.name && after.username)) return;
        Poe.poeUi.usagePage = page;
        Poe.poeUi.usageLoading = true;
        Poe.poeUi.usageError = '';
        Poe.renderUsage();
        var payload = {
            action: 'listAiUsageRecords',
            username: username
        };
        if (after && after.name && (after.username === 'ryan' || after.username === 'user57')) {
            payload.afterName = after.name;
            payload.afterUser = after.username;
        }
        try {
            var data = await Poe.proxyRequest(payload, 90000, null);
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username || !Poe.viewerIsAdmin()) return;
            if (!data || data.ok !== true || !Array.isArray(data.records)) {
                Poe.poeUi.usageRecords = [];
                Poe.poeUi.usageActiveId = '';
                Poe.poeUi.usageHasMore = false;
                Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
                Poe.poeUi.usageLoaded = false;
            } else {
                Poe.poeUi.usageRecords = data.records.map(Poe.mapUsageRecord).filter(Boolean).slice(0, Poe.HISTORY_LIMIT);
                var nextAfter = null;
                if (data.nextAfter && data.nextAfter.name && (data.nextAfter.username === 'ryan' || data.nextAfter.username === 'user57')) {
                    nextAfter = { name: String(data.nextAfter.name), username: String(data.nextAfter.username) };
                }
                Poe.poeUi.usageHasMore = data.hasMore === true && !!nextAfter;
                Poe.poeUi.usageNextAfter = nextAfter;
                if (Poe.poeUi.usageHasMore) Poe.poeUi.usageCursors[page + 1] = nextAfter;
                if (!Poe.poeUi.usageRecords.length) Poe.poeUi.usageHasMore = false;
                Poe.poeUi.usageError = '';
                Poe.poeUi.usageLoaded = true;
                if (Poe.poeUi.usageActiveId && !Poe.poeUi.usageRecords.some(function (item) { return item.id === Poe.poeUi.usageActiveId; })) {
                    Poe.poeUi.usageActiveId = '';
                }
            }
        } catch (error) {
            if (!Poe.isPoeGenerateModalOpen() || Poe.currentUsername() !== username) return;
            Poe.poeUi.usageRecords = [];
            Poe.poeUi.usageActiveId = '';
            Poe.poeUi.usageHasMore = false;
            Poe.poeUi.usageError = '暫時未能載入使用紀錄，請再試一次。';
            Poe.poeUi.usageLoaded = false;
        } finally {
            Poe.poeUi.usageLoading = false;
            if (document.getElementById('poe-usage-list')) Poe.renderUsage();
        }
    }


    Poe.setUsageStageChrome = function setUsageStageChrome(options) {
        options = options || {};
        var label = document.getElementById('poe-usage-stage-label');
        var count = document.getElementById('poe-usage-stage-count');
        var enlarge = document.getElementById('poe-usage-enlarge');
        var pane = document.querySelector('.poe-usage-result-pane');
        if (label) label.textContent = options.label || '出題結果';
        if (count) {
            if (options.countText) {
                count.hidden = false;
                count.textContent = options.countText;
            } else {
                count.hidden = true;
                count.textContent = '';
            }
        }
        if (enlarge) enlarge.hidden = !options.enlarge;
        if (pane) pane.classList.toggle('has-paper', !!options.hasPaper);
    }

    Poe.currentUsageRecord = function currentUsageRecord() {
        if (!Poe.poeUi.usageActiveId) return null;
        return (Poe.poeUi.usageRecords || []).filter(function (item) {
            return item.id === Poe.poeUi.usageActiveId;
        })[0] || null;
    }

    Poe.selectUsageRecord = async function selectUsageRecord(record) {
        if (!record) return;
        Poe.poeUi.usageActiveId = record.id;
        Poe.renderUsage();
        if (record.lean && !record.content && record.remoteName) {
            var detail = document.getElementById('poe-usage-detail');
            if (detail) {
                detail.textContent = '';
                detail.hidden = false;
                detail.classList.add('is-empty');
                detail.classList.remove('has-paper');
                var idle = document.createElement('div');
                idle.className = 'poe-idle';
                var lead = document.createElement('p');
                lead.className = 'poe-lead';
                lead.textContent = '正在載入這筆使用紀錄的完整回覆…';
                idle.appendChild(lead);
                detail.appendChild(idle);
                Poe.setUsageStageChrome({ label: '出題結果', enlarge: false, hasPaper: false });
            }
            await Poe.fillLeanRemoteRecord(record);
            if (!Poe.isPoeGenerateModalOpen()) return;
            if (Poe.poeUi.usageActiveId !== record.id) return;
            Poe.renderUsage();
        }
    }

    Poe.enlargeUsageResult = function enlargeUsageResult() {
        var record = Poe.currentUsageRecord();
        if (!record || !record.content) return;
        Poe.enlargeResult(record);
    }

    Poe.renderUsageDetail = function renderUsageDetail(record) {
        var box = document.getElementById('poe-usage-detail');
        if (!box) return;
        box.textContent = '';
        box.hidden = false;
        if (!record || !record.content) {
            box.classList.add('is-empty');
            box.classList.remove('has-paper');
            var idle = document.createElement('div');
            idle.className = 'poe-idle';
            var lead = document.createElement('p');
            lead.className = 'poe-lead';
            lead.textContent = record
                ? '這筆紀錄沒有可顯示的出題內容。'
                : '在右側點選一筆使用紀錄後，這裡會以完整紙本版面顯示該次出題結果。';
            idle.appendChild(lead);
            if (!record) {
                var note = document.createElement('p');
                note.className = 'poe-note';
                note.textContent = '左側保留足夠閱讀空間，方便對照題目卡片與請求摘要。';
                idle.appendChild(note);
            }
            box.appendChild(idle);
            Poe.setUsageStageChrome({ label: '出題結果', enlarge: false, hasPaper: false });
            if (Poe.poeUi.resultExpanded) Poe.closeEnlargeOverlay();
            return;
        }
        box.classList.remove('is-empty');
        box.classList.add('has-paper');
        var built = Poe.buildPaperView(record, { hideCopy: false });
        box.appendChild(built.root);
        box.scrollTop = 0;
        Poe.setUsageStageChrome({
            label: '出題結果',
            countText: built.structured ? ('共 ' + built.questionCount + ' 題') : '整份回覆',
            enlarge: true,
            hasPaper: true
        });
        if (Poe.poeUi.resultExpanded) Poe.enlargeResult(record);
    }

    Poe.renderUsage = function renderUsage() {
        Poe.updateUsagePager();
        var list = document.getElementById('poe-usage-list');
        if (!list) return;
        list.textContent = '';
        if (Poe.poeUi.usageLoading) {
            var loading = document.createElement('p');
            loading.className = 'poe-history-empty';
            loading.textContent = '正在載入使用紀錄…';
            list.appendChild(loading);
            Poe.renderUsageDetail(null);
            return;
        }
        if (Poe.poeUi.usageError) {
            var failed = document.createElement('p');
            failed.className = 'poe-history-empty';
            failed.textContent = Poe.poeUi.usageError;
            list.appendChild(failed);
            Poe.renderUsageDetail(null);
            return;
        }
        if (!Poe.poeUi.usageRecords.length) {
            var empty = document.createElement('p');
            empty.className = 'poe-history-empty';
            empty.textContent = '尚未有可顯示的使用紀錄。';
            if (Poe.poeUi.usagePage > 0) empty.textContent = '沒有更早的使用紀錄。';
            list.appendChild(empty);
            Poe.renderUsageDetail(null);
            return;
        }
        var query = Poe.usageQueryText();
        var records = Poe.poeUi.usageRecords.filter(function (record) {
            return Poe.recordMatchesHistoryQuery(record, query);
        });
        if (!records.length) {
            var none = document.createElement('p');
            none.className = 'poe-history-empty';
            none.textContent = '沒有符合這個編號的紀錄。';
            list.appendChild(none);
            Poe.renderUsageDetail(null);
            return;
        }
        var active = null;
        records.forEach(function (record) {
            if (record.id === Poe.poeUi.usageActiveId) active = record;
            var row = document.createElement('div');
            row.className = 'poe-history-item' + (record.id === Poe.poeUi.usageActiveId ? ' is-active' : '');
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'poe-history-open';
            open.setAttribute('aria-current', record.id === Poe.poeUi.usageActiveId ? 'true' : 'false');
            var who = document.createElement('span');
            who.className = 'poe-history-owner';
            who.textContent = record.owner || '';
            var time = document.createElement('span');
            time.className = 'poe-history-time';
            time.textContent = Poe.formatTime(record.createdAt);
            var preview = document.createElement('span');
            preview.className = 'poe-history-preview';
            Poe.setInlineMarkdown(preview, Poe.previewText(record.content, record));
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
                Poe.selectUsageRecord(record);
            });
            row.appendChild(open);
            list.appendChild(row);
        });
        Poe.renderUsageDetail(active);
    }

    Poe.setPoeTabState = function setPoeTabState(tab, on) {
        if (!tab) return;
        tab.classList.toggle('is-active', !!on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    }

    Poe.showPoeTab = function showPoeTab(name) {
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
        Poe.setPoeTabState(document.getElementById('poe-tab-compose'), composeOn);
        Poe.setPoeTabState(document.getElementById('poe-tab-history'), historyOn);
        Poe.setPoeTabState(document.getElementById('poe-tab-usage'), usageOn);
        Poe.poeUi.activeTab = usageOn ? 'usage' : (historyOn ? 'history' : 'compose');
        if (usageOn) Poe.loadUsageRecords(false);
    }
})(PoeGenerate);
