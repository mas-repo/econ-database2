// question-fields.js
// Shared blank-field checks, year normalize, and questionParts helpers for
// filters, form, bulk edit, import/sync, and advanced condition matching.
//
// Blank: null/undefined, whitespace-only, or '-' count as blank.
// 題目 = questionTextChi + questionTextEng + plainText (all blank → 題目空白)
// 答案 = answerMC + answerChi + answerEng
// 評卷報告 = markersReportChi + markersReportEng (UI label 評卷報告 / Markers Report)
//
// year: mock papers store MT## (e.g. MT27–MT44). Bare 1–3 digit years are
// auto-normalized to MT## on write. Four-digit calendar years and tokens
// like PP / SP are never rewritten.
//
// questionParts: [{ label, marks, performance }, ...]
// Total marks (question.marks) stays authoritative — parts do not auto-sum into it.
// When parts exist, validatePartMarksSum requires every part to have marks and
// sum(part.marks) === marks (tolerance PART_MARKS_SUM_TOLERANCE).

(function (global) {
    'use strict';

    var ADMIN_BLANK_FEATURES = (typeof ADMIN_BLANK_FEATURE_ITEMS !== 'undefined' && Array.isArray(ADMIN_BLANK_FEATURE_ITEMS))
        ? ADMIN_BLANK_FEATURE_ITEMS.slice()
        : ['題目空白', '答案空白', '評卷報告空白'];

    function isBlankText(value) {
        if (value === null || value === undefined) return true;
        var text = String(value).trim();
        return text === '' || text === '-';
    }

    function allBlank(values) {
        for (var i = 0; i < values.length; i++) {
            if (!isBlankText(values[i])) return false;
        }
        return true;
    }

    function isQuestionTextBlank(question) {
        if (!question) return true;
        return allBlank([
            question.questionTextChi,
            question.questionTextEng,
            question.plainText
        ]);
    }

    function isAnswerBlank(question) {
        if (!question) return true;
        return allBlank([
            question.answerMC,
            question.answerChi,
            question.answerEng
        ]);
    }

    function isMarkersReportBlank(question) {
        if (!question) return true;
        return allBlank([
            question.markersReportChi,
            question.markersReportEng
        ]);
    }

    function isAdminBlankFeature(name) {
        return ADMIN_BLANK_FEATURES.indexOf(String(name || '')) !== -1;
    }

    function isAdminUser() {
        return !!(global.accessRights && global.accessRights.admin === true);
    }

    function effectiveFeatureItems() {
        var base = (typeof FEATURE_ITEMS !== 'undefined' && Array.isArray(FEATURE_ITEMS))
            ? FEATURE_ITEMS.slice()
            : [];
        if (!isAdminUser()) return base;
        ADMIN_BLANK_FEATURES.forEach(function (item) {
            if (base.indexOf(item) === -1) base.push(item);
        });
        return base;
    }

    function clearAdminBlankFeatureFilters() {
        if (!global.triStateFilters || !global.triStateFilters.feature) return;
        ADMIN_BLANK_FEATURES.forEach(function (item) {
            delete global.triStateFilters.feature[item];
        });
    }

    function normalizePartPerformance(raw) {
        var text = String(raw == null ? '' : raw).trim();
        if (!text) return '';
        var allowed = (typeof PART_PERFORMANCE_ITEMS !== 'undefined' && Array.isArray(PART_PERFORMANCE_ITEMS))
            ? PART_PERFORMANCE_ITEMS
            : [];
        return allowed.indexOf(text) !== -1 ? text : '';
    }

    function normalizeQuestionPart(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var label = String(raw.label == null ? (raw.id == null ? '' : raw.id) : raw.label).trim();
        var marksRaw = raw.marks;
        var marks = null;
        if (marksRaw !== null && marksRaw !== undefined && String(marksRaw).trim() !== '') {
            var num = parseFloat(String(marksRaw).trim());
            if (!isNaN(num) && isFinite(num)) marks = num;
        }
        var performance = normalizePartPerformance(raw.performance);
        if (!label && marks === null && !performance) return null;
        return {
            label: label,
            marks: marks,
            performance: performance
        };
    }

    function normalizeQuestionParts(list) {
        if (!Array.isArray(list)) return [];
        return list.map(normalizeQuestionPart).filter(Boolean);
    }

    function questionHasParts(question) {
        return normalizeQuestionParts(question && question.questionParts).length > 0;
    }

    function questionHasPartPerformance(question, value) {
        var needle = String(value == null ? '' : value).trim();
        if (!needle) return false;
        return normalizeQuestionParts(question && question.questionParts).some(function (part) {
            return part.performance === needle;
        });
    }

    function questionHasPartMarks(question, value) {
        var needle = parseFloat(String(value == null ? '' : value).trim());
        if (isNaN(needle) || !isFinite(needle)) return false;
        return normalizeQuestionParts(question && question.questionParts).some(function (part) {
            return part.marks !== null && Number(part.marks) === needle;
        });
    }

    function sumPartMarks(question) {
        var total = 0;
        var any = false;
        normalizeQuestionParts(question && question.questionParts).forEach(function (part) {
            if (part.marks === null) return;
            total += Number(part.marks);
            any = true;
        });
        return any ? total : null;
    }

    // Float tolerance for 0.5-step marks (and minor float noise).
    var PART_MARKS_SUM_TOLERANCE = 0.001;

    function parseTotalMarks(raw) {
        if (raw === null || raw === undefined || String(raw).trim() === '') return 0;
        var num = parseFloat(String(raw).trim());
        if (isNaN(num) || !isFinite(num)) return null;
        return num;
    }

    /**
     * When questionParts is empty/absent → ok (no sum check).
     * When one or more parts exist:
     *   - every part must have a numeric marks value
     *   - sum(part.marks) must equal top-level marks within PART_MARKS_SUM_TOLERANCE
     * Does not mutate marks; validation only.
     * Returns { ok, error, sum, total, partsCount } with Traditional Chinese error text.
     */
    function validatePartMarksSum(question, options) {
        options = options || {};
        var id = String(question && question.id != null ? question.id : options.id || '').trim();
        var idLabel = id || '（無編號）';
        var parts = normalizeQuestionParts(question && question.questionParts);
        if (!parts.length) {
            return { ok: true, error: '', sum: null, total: parseTotalMarks(question && question.marks), partsCount: 0 };
        }
        var missing = [];
        parts.forEach(function (part, index) {
            if (part.marks === null || part.marks === undefined) {
                missing.push(part.label || String(index + 1));
            }
        });
        if (missing.length) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」有分題但缺少分數（' + missing.join('、') + '）。有分題時每一分題都必須填分數，且合計須等於總分。',
                sum: null,
                total: parseTotalMarks(question && question.marks),
                partsCount: parts.length
            };
        }
        var sum = 0;
        parts.forEach(function (part) { sum += Number(part.marks); });
        var total = parseTotalMarks(question && question.marks);
        if (total === null) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」的總分無效；有分題時總分必須是數字，且等於各分題分數合計。',
                sum: sum,
                total: null,
                partsCount: parts.length
            };
        }
        if (Math.abs(sum - total) > PART_MARKS_SUM_TOLERANCE) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」分題分數合計為 ' + String(sum) + '，與總分 ' + String(total) + ' 不符。請修正後再儲存（總分不會自動覆寫）。',
                sum: sum,
                total: total,
                partsCount: parts.length
            };
        }
        return { ok: true, error: '', sum: sum, total: total, partsCount: parts.length };
    }

    function validatePartMarksSumMany(questions) {
        var errors = [];
        (questions || []).forEach(function (question) {
            var result = validatePartMarksSum(question);
            if (!result.ok) errors.push(result.error);
        });
        return {
            ok: errors.length === 0,
            errors: errors,
            error: errors.length ? errors.join('\n') : ''
        };
    }

    // Compact parts text for bulk table: "a,2,良好 | b,3,優良"
    function serializeQuestionPartsCompact(parts) {
        return normalizeQuestionParts(parts).map(function (part) {
            var marks = part.marks === null || part.marks === undefined ? '' : String(part.marks);
            return [part.label || '', marks, part.performance || ''].join(',');
        }).join(' | ');
    }

    function parseQuestionPartsCompact(text) {
        var raw = String(text == null ? '' : text).trim();
        if (!raw) return [];
        var chunks = raw.split('|');
        var list = [];
        chunks.forEach(function (chunk) {
            var piece = String(chunk || '').trim();
            if (!piece) return;
            var bits = piece.split(',');
            var label = (bits[0] == null ? '' : String(bits[0])).trim();
            var marks = bits.length > 1 ? String(bits[1]).trim() : '';
            var performance = bits.length > 2 ? bits.slice(2).join(',').trim() : '';
            list.push({ label: label, marks: marks, performance: performance });
        });
        return normalizeQuestionParts(list);
    }

    /**
     * Canonical stored year. Auto-normalizes bare 1–3 digit mock years to MT##
     * (MT27, MT39, …). Leaves 4-digit calendar years and other tokens (PP, SP)
     * unchanged. Already-MT values are re-canonicalized to MT + integer digits
     * (no leading zeros, no spaces).
     */
    function normalizeYear(year) {
        if (year == null) return '';
        var text = String(year).trim();
        if (!text || text === '-') return text === '-' ? '-' : '';
        var mt = text.match(/^MT\s*(\d{1,3})$/i);
        if (mt) return 'MT' + String(parseInt(mt[1], 10));
        if (/^\d{1,3}$/.test(text)) return 'MT' + String(parseInt(text, 10));
        if (/^\d{4}$/.test(text)) return text;
        return text;
    }

    function questionSearchText(question, scope) {
        scope = scope || 'all';
        var parts = [];
        if (scope === 'all' || scope === 'question' || scope === 'text') {
            parts.push(
                question && question.questionTextChi,
                question && question.questionTextEng,
                question && question.plainText
            );
        }
        if (scope === 'all' || scope === 'answer') {
            parts.push(
                question && question.answerMC,
                question && question.answerChi,
                question && question.answerEng
            );
        }
        if (scope === 'all' || scope === 'report' || scope === 'markersReport') {
            parts.push(
                question && question.markersReportChi,
                question && question.markersReportEng
            );
        }
        return parts.map(function (part) {
            return String(part == null ? '' : part);
        }).join('\n');
    }

    global.isBlankText = isBlankText;
    global.isQuestionTextBlank = isQuestionTextBlank;
    global.isAnswerBlank = isAnswerBlank;
    global.isMarkersReportBlank = isMarkersReportBlank;
    global.isAdminBlankFeature = isAdminBlankFeature;
    global.effectiveFeatureItems = effectiveFeatureItems;
    global.clearAdminBlankFeatureFilters = clearAdminBlankFeatureFilters;
    global.normalizeQuestionParts = normalizeQuestionParts;
    global.normalizeQuestionPart = normalizeQuestionPart;
    global.questionHasParts = questionHasParts;
    global.questionHasPartPerformance = questionHasPartPerformance;
    global.questionHasPartMarks = questionHasPartMarks;
    global.sumPartMarks = sumPartMarks;
    global.validatePartMarksSum = validatePartMarksSum;
    global.validatePartMarksSumMany = validatePartMarksSumMany;
    global.serializeQuestionPartsCompact = serializeQuestionPartsCompact;
    global.parseQuestionPartsCompact = parseQuestionPartsCompact;
    global.normalizeYear = normalizeYear;
    global.questionSearchText = questionSearchText;
    global.ADMIN_BLANK_FEATURE_ITEMS = ADMIN_BLANK_FEATURES;
    global.PART_MARKS_SUM_TOLERANCE = PART_MARKS_SUM_TOLERANCE;
})(window);
