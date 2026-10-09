// poe-markdown.js
// Lightweight Markdown → HTML for AI出題 / AI解釋 results.
// Behavior inspired by universal-chat markdown.js; keeps poe-* class names
// and does not pull in that app's visual theme.
// Supports GFM pipe tables and LaTeX math via vendored KaTeX (\\[ \\], \\( \\), $$).

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

    function normalizeMathTex(body, delim) {
        var tex = String(body || '').replace(/^\s+|\s+$/g, '');
        // Doubled delimiters (\\[ ... \\]) usually mean the body is also
        // double-escaped (\\text → \text). Real line-breaks inside single
        // \\[ ... \\] keep delim length 1 and are left alone.
        if (delim && delim.length >= 2) {
            tex = tex.replace(/\\\\/g, '\\');
        }
        return tex;
    }

    function extractMath(text, maths) {
        // Display: $$ ... $$
        text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (_m, body) {
            maths.push({ tex: String(body || '').replace(/^\s+|\s+$/g, ''), display: true });
            return '\u0000M' + (maths.length - 1) + '\u0000';
        });
        // Display: \[ ... \] or \\[ ... \\] (matching delimiter length)
        text = text.replace(/(\\+)\[([\s\S]+?)\1\]/g, function (_m, delim, body) {
            maths.push({ tex: normalizeMathTex(body, delim), display: true });
            return '\u0000M' + (maths.length - 1) + '\u0000';
        });
        // Inline: \( ... \) or \\( ... \\)
        text = text.replace(/(\\+)\(([\s\S]+?)\1\)/g, function (_m, delim, body) {
            maths.push({ tex: normalizeMathTex(body, delim), display: false });
            return '\u0000M' + (maths.length - 1) + '\u0000';
        });
        return text;
    }

    function mathHtml(item) {
        var katexApi = global.katex;
        var tex = item && item.tex != null ? String(item.tex) : '';
        if (katexApi && typeof katexApi.renderToString === 'function' && tex) {
            try {
                var rendered = katexApi.renderToString(tex, {
                    displayMode: !!item.display,
                    throwOnError: false,
                    trust: false,
                    strict: 'ignore',
                    output: 'html'
                });
                if (item.display) {
                    return '<div class="poe-md-math poe-md-math-display">' + rendered + '</div>';
                }
                return '<span class="poe-md-math poe-md-math-inline">' + rendered + '</span>';
            } catch (_err) {
                // fall through to escaped fallback
            }
        }
        if (item && item.display) {
            return '<div class="poe-md-math poe-md-math-fallback"><pre>' + escapeHtml(tex) + '</pre></div>';
        }
        return '<code class="poe-md-math poe-md-math-fallback">' + escapeHtml(tex) + '</code>';
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

    function splitTableRow(line) {
        var s = String(line || '').replace(/\s+$/, '').replace(/^\s+/, '');
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        return s.split('|').map(function (cell) {
            return String(cell || '').replace(/^\s+|\s+$/g, '');
        });
    }

    function isTableSeparator(line) {
        var s = String(line || '').replace(/\s+$/, '').replace(/^\s+/, '');
        if (s.indexOf('|') === -1 || s.indexOf('-') === -1) return false;
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        var parts = s.split('|');
        if (!parts.length) return false;
        for (var i = 0; i < parts.length; i++) {
            if (!/^\s*:?-{1,}:?\s*$/.test(parts[i])) return false;
        }
        return true;
    }

    function isTableRowLine(line) {
        var s = String(line || '');
        return /^\s*\|/.test(s) && s.indexOf('|', s.indexOf('|') + 1) !== -1;
    }

    function alignFromSep(cell) {
        var t = String(cell || '').replace(/\s+/g, '');
        var left = t.charAt(0) === ':';
        var right = t.charAt(t.length - 1) === ':';
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
    }

    function tableHtml(headerCells, aligns, bodyRows) {
        var html = '<div class="poe-md-table-wrap"><table class="poe-md-table"><thead><tr>';
        var i;
        for (i = 0; i < headerCells.length; i++) {
            var align = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '';
            html += '<th' + align + '>' + inlineMarkdown(headerCells[i]) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (var r = 0; r < bodyRows.length; r++) {
            html += '<tr>';
            var row = bodyRows[r];
            for (i = 0; i < headerCells.length; i++) {
                var a = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '';
                html += '<td' + a + '>' + inlineMarkdown(row[i] != null ? row[i] : '') + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        return html;
    }

    function tryParseTable(lines, start) {
        if (!isTableRowLine(lines[start])) return null;
        if (start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;
        var header = splitTableRow(lines[start]);
        var sep = splitTableRow(lines[start + 1]);
        if (!header.length) return null;
        var aligns = [];
        var i;
        for (i = 0; i < header.length; i++) {
            aligns.push(alignFromSep(sep[i] || ''));
        }
        var body = [];
        var iLine = start + 2;
        while (iLine < lines.length && isTableRowLine(lines[iLine])) {
            var cells = splitTableRow(lines[iLine]);
            while (cells.length < header.length) cells.push('');
            if (cells.length > header.length) cells = cells.slice(0, header.length);
            body.push(cells);
            iLine += 1;
        }
        return { html: tableHtml(header, aligns, body), next: iLine };
    }

    var BANNED_TAGS = {
        SCRIPT: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1,
        STYLE: 1, BASE: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1
    };

    function sanitizeHtml(html) {
        if (!html) return '';
        if (typeof document === 'undefined' || !document.createElement) {
            return String(html);
        }
        var template = document.createElement('template');
        template.innerHTML = String(html);
        var nodes = template.content.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!el || !el.tagName) continue;
            if (BANNED_TAGS[el.tagName]) {
                el.remove();
                continue;
            }
            var attrs = el.attributes;
            if (!attrs) continue;
            for (var a = attrs.length - 1; a >= 0; a--) {
                var attr = attrs[a];
                var name = String(attr.name || '').toLowerCase();
                var value = String(attr.value || '');
                if (name.indexOf('on') === 0) {
                    el.removeAttribute(attr.name);
                    continue;
                }
                if ((name === 'href' || name === 'src' || name === 'xlink:href')
                    && /^\s*javascript:/i.test(value)) {
                    el.removeAttribute(attr.name);
                }
            }
        }
        return template.innerHTML;
    }

    function renderToHtml(src) {
        if (!src) return '';
        var codes = [];
        var inlines = [];
        var maths = [];
        var text = String(src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
        text = extractFences(text, codes);
        text = extractMath(text, maths);
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
            if (/^\u0000C\d+\u0000$/.test(line.trim()) || /^\u0000M\d+\u0000$/.test(line.trim())) {
                flushAll();
                out.push(line.trim());
                continue;
            }
            if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
                flushAll();
                out.push('<hr class="poe-md-hr">');
                continue;
            }
            var table = tryParseTable(lines, i);
            if (table) {
                flushAll();
                out.push(table.html);
                i = table.next - 1;
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
        html = html.replace(/\u0000M(\d+)\u0000/g, function (_m, idx) {
            var item = maths[Number(idx)];
            if (!item) return '';
            return mathHtml(item);
        });
        return sanitizeHtml(html);
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
        inlineOnly: inlineOnly,
        sanitizeHtml: sanitizeHtml
    };
})(window);
