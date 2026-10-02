// poe-markdown.js
// Lightweight Markdown → HTML for AI出題 results.
// Behavior inspired by universal-chat markdown.js; keeps poe-* class names
// and does not pull in that app's visual theme.

(function (global) {
    'use strict';

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(text) {
        return escapeHtml(text).replace(/`/g, '&#96;');
    }

    function safeUrl(url) {
        var u = String(url || '').trim();
        if (/^(https?:|mailto:|#|\/)/i.test(u)) return u;
        return '#';
    }

    function extractFences(text, codes) {
        var lines = text.split('\n');
        var out = [];
        var openRe = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;
        var i = 0;
        while (i < lines.length) {
            var m = openRe.exec(lines[i]);
            var marker = m ? m[1] : null;
            var info = m ? String(m[2] || '').trim() : '';
            var usable = !!marker && !(marker.charAt(0) === '`' && info.indexOf('`') !== -1);
            if (!usable) {
                out.push(lines[i]);
                i += 1;
                continue;
            }
            var ch = marker.charAt(0);
            var len = marker.length;
            var lang = info.split(/\s+/)[0] || '';
            var closeRe = new RegExp('^ {0,3}' + ch + '{' + len + ',}[ \\t]*$');
            var body = [];
            i += 1;
            while (i < lines.length && !closeRe.test(lines[i])) {
                body.push(lines[i]);
                i += 1;
            }
            if (i < lines.length) i += 1;
            codes.push({ lang: lang, code: body.join('\n') });
            out.push('\u0000C' + (codes.length - 1) + '\u0000');
        }
        return out.join('\n');
    }

    function inlineMarkdown(escapedText) {
        var html = String(escapedText || '');
        html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (_m, alt, url) {
            return '<img class="poe-md-img" src="' + escapeAttr(safeUrl(url)) + '" alt="' + escapeAttr(alt) + '" loading="lazy">';
        });
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (_m, txt, url) {
            return '<a class="poe-md-link" href="' + escapeAttr(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
        });
        html = html.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, function (_m, pre, url) {
            return pre + '<a class="poe-md-link" href="' + escapeAttr(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
        });
        html = html.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        return html;
    }

    function codeBlockHtml(code, lang) {
        var label = lang || 'code';
        return ''
            + '<div class="poe-md-code">'
            + '<div class="poe-md-code-head"><span class="poe-md-code-lang">' + escapeHtml(label) + '</span></div>'
            + '<pre class="poe-md-pre"><code>' + escapeHtml(code) + '</code></pre>'
            + '</div>';
    }

    function renderToHtml(src) {
        if (!src) return '';
        var codes = [];
        var inlines = [];
        var text = String(src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
        text = extractFences(text, codes);
        text = text.replace(/``([^`\n]+)``/g, function (_m, c) {
            inlines.push(String(c).trim());
            return '\u0000I' + (inlines.length - 1) + '\u0000';
        });
        text = text.replace(/`([^`\n]+)`/g, function (_m, c) {
            inlines.push(c);
            return '\u0000I' + (inlines.length - 1) + '\u0000';
        });
        text = escapeHtml(text);

        var lines = text.split('\n');
        var out = [];
        var para = [];
        var listType = null;
        var quote = [];

        function flushPara() {
            if (!para.length) return;
            out.push('<p>' + inlineMarkdown(para.join('<br>')) + '</p>');
            para = [];
        }
        function flushList() {
            if (!listType) return;
            out.push('</' + listType + '>');
            listType = null;
        }
        function flushQuote() {
            if (!quote.length) return;
            out.push('<blockquote class="poe-md-quote">' + inlineMarkdown(quote.join('<br>')) + '</blockquote>');
            quote = [];
        }
        function flushAll() {
            flushPara();
            flushList();
            flushQuote();
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\s+$/, '');
            if (!line.trim()) {
                flushAll();
                continue;
            }
            if (/^\u0000C\d+\u0000$/.test(line.trim())) {
                flushAll();
                out.push(line.trim());
                continue;
            }
            if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
                flushAll();
                out.push('<hr class="poe-md-hr">');
                continue;
            }
            var h = /^(#{1,6})\s+(.*)$/.exec(line);
            if (h) {
                flushAll();
                var level = Math.min(h[1].length, 4);
                var tag = level <= 1 ? 'h3' : (level === 2 ? 'h4' : 'h4');
                out.push('<' + tag + ' class="poe-md-h">' + inlineMarkdown(h[2]) + '</' + tag + '>');
                continue;
            }
            var q = /^\s*&gt;\s?(.*)$/.exec(line);
            if (q) {
                flushPara();
                flushList();
                quote.push(q[1]);
                continue;
            }
            flushQuote();

            var ul = /^(\s*)[-*+•]\s+(.*)$/.exec(line);
            var ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
            if (ul || ol) {
                var want = ul ? 'ul' : 'ol';
                var content = (ul || ol)[2];
                flushPara();
                if (listType !== want) {
                    flushList();
                    out.push('<' + want + ' class="poe-md-list">');
                    listType = want;
                }
                out.push('<li>' + inlineMarkdown(content) + '</li>');
                continue;
            }
            flushList();
            para.push(line);
        }
        flushAll();

        var html = out.join('\n');
        html = html.replace(/\u0000C(\d+)\u0000/g, function (_m, idx) {
            var item = codes[Number(idx)];
            if (!item) return '';
            return codeBlockHtml(item.code, item.lang || '');
        });
        html = html.replace(/\u0000I(\d+)\u0000/g, function (_m, idx) {
            return '<code class="poe-md-inline">' + escapeHtml(inlines[Number(idx)]) + '</code>';
        });
        return html;
    }

    function renderInto(container, text) {
        if (!container) return;
        var html = renderToHtml(text);
        if (!html) {
            container.textContent = '';
            var empty = document.createElement('p');
            empty.textContent = '（沒有內容）';
            container.appendChild(empty);
            return;
        }
        container.innerHTML = html;
    }

    function inlineOnly(text) {
        return inlineMarkdown(escapeHtml(text));
    }

    global.PoeMarkdown = {
        escapeHtml: escapeHtml,
        renderToHtml: renderToHtml,
        renderInto: renderInto,
        inlineOnly: inlineOnly
    };
})(window);
