// question-fields.js
// Shared blank-field checks, year normalize, questionParts / partsStatus helpers,
// and questionFeatureOn (題目／統計／ConditionMatch 特徵 matcher).
// Must load before condition-match.js (see index.html load-order comment).
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
//
// partsStatus: "pending" | "none" | "filled"
//   pending = 尚未輸入 (legacy empty/absent migrates here; not confirmed none)
//   none    = 沒有分題 (explicitly confirmed no sub-parts; store [])
//   filled  = 有分題 (non-empty questionParts)

(function (global) {
    'use strict';

    var PARTS_STATUS_PENDING = 'pending';
    var PARTS_STATUS_NONE = 'none';
    var PARTS_STATUS_FILLED = 'filled';
    var PARTS_STATUS_LABELS = {
        pending: '尚未輸入分題',
        none: '沒有分題',
        filled: '有分題'
    };

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

    function normalizePartsStatus(raw) {
        var text = String(raw == null ? '' : raw).trim().toLowerCase();
        if (text === PARTS_STATUS_NONE || text === 'no' || text === 'confirmed_none') {
            return PARTS_STATUS_NONE;
        }
        if (text === PARTS_STATUS_FILLED || text === 'yes' || text === 'has') {
            return PARTS_STATUS_FILLED;
        }
        if (text === PARTS_STATUS_PENDING || text === 'unentered' || text === 'unknown') {
            return PARTS_STATUS_PENDING;
        }
        return '';
    }

    // Effective status. Non-empty parts always win as filled. Legacy empty
    // without partsStatus → pending (not confirmed none).
    function resolvePartsStatus(question) {
        if (questionHasParts(question)) return PARTS_STATUS_FILLED;
        var stored = normalizePartsStatus(question && question.partsStatus);
        if (stored === PARTS_STATUS_NONE) return PARTS_STATUS_NONE;
        return PARTS_STATUS_PENDING;
    }

    function partsStatusLabel(statusOrQuestion) {
        var key;
        if (statusOrQuestion && typeof statusOrQuestion === 'object') {
            key = resolvePartsStatus(statusOrQuestion);
        } else {
            key = normalizePartsStatus(statusOrQuestion) || PARTS_STATUS_PENDING;
        }
        return PARTS_STATUS_LABELS[key] || PARTS_STATUS_LABELS.pending;
    }

    // Apply write rules: filled requires parts; none/pending store [].
    // choice may be pending|none|filled; if omitted, inferred from parts.
    function applyPartsFields(question, parts, choice) {
        var target = question && typeof question === 'object' ? question : {};
        var list = normalizeQuestionParts(parts);
        var want = normalizePartsStatus(choice);
        if (list.length > 0) {
            target.questionParts = list;
            target.partsStatus = PARTS_STATUS_FILLED;
            return target;
        }
        target.questionParts = [];
        if (want === PARTS_STATUS_NONE) {
            target.partsStatus = PARTS_STATUS_NONE;
        } else if (want === PARTS_STATUS_FILLED) {
            // User chose filled but left rows blank → treat as pending.
            target.partsStatus = PARTS_STATUS_PENDING;
        } else {
            target.partsStatus = PARTS_STATUS_PENDING;
        }
        return target;
    }

    function questionPartsPending(question) {
        return resolvePartsStatus(question) === PARTS_STATUS_PENDING;
    }

    function questionPartsConfirmedNone(question) {
        return resolvePartsStatus(question) === PARTS_STATUS_NONE;
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
     * When partsStatus is pending/none or questionParts is empty → ok (no sum check).
     * When filled (one or more parts):
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

    function questionIdLabel_(question, options) {
        options = options || {};
        var id = String(question && question.id != null ? question.id : options.id || '').trim();
        return id || '（無編號）';
    }

    /**
     * Total marks and each part marks must be finite and ≥ 0 when present.
     * Empty total → treated as 0 (same as form/bulk coerce). Does not run
     * part-sum equality (use validatePartMarksSum).
     */
    function validateMarksNonNegative(question, options) {
        options = options || {};
        var idLabel = questionIdLabel_(question, options);
        var total = parseTotalMarks(question && question.marks);
        if (total === null) {
            return { ok: false, error: '題目「' + idLabel + '」的總分無效，請輸入數字（可為 0）。' };
        }
        if (total < 0) {
            return { ok: false, error: '題目「' + idLabel + '」的總分不能為負數。' };
        }
        var parts = normalizeQuestionParts(question && question.questionParts);
        var bad = [];
        parts.forEach(function (part, index) {
            if (part.marks === null || part.marks === undefined) return;
            if (!(Number(part.marks) >= 0)) {
                bad.push(part.label || String(index + 1));
            }
        });
        if (bad.length) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」分題分數不能為負數（' + bad.join('、') + '）。'
            };
        }
        return { ok: true, error: '' };
    }

    /**
     * correctPercentage: empty/null OK; otherwise finite number in [0, 100].
     */
    function validateCorrectPercentage(question, options) {
        options = options || {};
        var idLabel = questionIdLabel_(question, options);
        var raw = question && question.correctPercentage;
        if (raw === null || raw === undefined || String(raw).trim() === '') {
            return { ok: true, error: '', value: null };
        }
        var num = parseFloat(String(raw).trim());
        if (isNaN(num) || !isFinite(num)) {
            return { ok: false, error: '題目「' + idLabel + '」的答對率必須是數字，或留空。', value: null };
        }
        if (num < 0 || num > 100) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」的答對率須介乎 0 至 100（目前：' + String(num) + '）。',
                value: null
            };
        }
        return { ok: true, error: '', value: num };
    }

    /**
     * Accept Ch01 / Ch1 / 01 / 1 (and spaced variants). Returns padded "01"…"29"
     * or '' if the token has no usable chapter number.
     */
    function parseChapterNumberToken(raw) {
        var text = String(raw == null ? '' : raw).trim();
        if (!text || text === '-') return '';
        var mt = text.match(/^Ch\s*0*(\d{1,2})$/i);
        if (mt) return String(parseInt(mt[1], 10)).padStart(2, '0');
        if (/^\d{1,2}$/.test(text)) return String(parseInt(text, 10)).padStart(2, '0');
        var digits = text.match(/(\d{1,2})/);
        if (digits) return String(parseInt(digits[1], 10)).padStart(2, '0');
        return '';
    }

    /**
     * Each AristochapterClassification entry must map to CHAPTER_RANGE.
     * Empty list OK. Does not rewrite stored labels.
     */
    function validateChapterClassification(list, options) {
        options = options || {};
        var idLabel = questionIdLabel_(options.question || null, options);
        var items = Array.isArray(list) ? list : [];
        if (!items.length) return { ok: true, error: '', invalid: [] };
        var min = (typeof CHAPTER_RANGE !== 'undefined' && CHAPTER_RANGE.min) || 1;
        var max = (typeof CHAPTER_RANGE !== 'undefined' && CHAPTER_RANGE.max) || 29;
        var invalid = [];
        items.forEach(function (item) {
            var text = String(item == null ? '' : item).trim();
            if (!text) return;
            var padded = parseChapterNumberToken(text);
            if (!padded) {
                invalid.push(text);
                return;
            }
            var num = parseInt(padded, 10);
            if (num < min || num > max) invalid.push(text);
        });
        if (!invalid.length) return { ok: true, error: '', invalid: [] };
        return {
            ok: false,
            error: '題目「' + idLabel + '」章節不在清單（Ch'
                + String(min).padStart(2, '0') + '–Ch' + String(max).padStart(2, '0')
                + '）：' + invalid.join('、'),
            invalid: invalid
        };
    }

    function validateExaminationType(value, options) {
        options = options || {};
        var idLabel = questionIdLabel_(options.question || null, options);
        var text = String(value == null ? '' : value).trim();
        if (!text) {
            return { ok: false, error: '題目「' + idLabel + '」請選擇考試類型。' };
        }
        var allowed = (typeof EXAMINATION_TYPES !== 'undefined' && Array.isArray(EXAMINATION_TYPES))
            ? EXAMINATION_TYPES
            : [];
        if (allowed.length && allowed.indexOf(text) === -1) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」考試類型須為：' + allowed.join('、') + '（目前：' + text + '）。'
            };
        }
        return { ok: true, error: '' };
    }

    function validateQuestionTypeValue(value, options) {
        options = options || {};
        var idLabel = questionIdLabel_(options.question || null, options);
        var text = String(value == null ? '' : value).trim();
        if (!text) {
            return { ok: false, error: '題目「' + idLabel + '」請選擇題目類型。' };
        }
        var allowed = (typeof QUESTION_TYPES !== 'undefined' && Array.isArray(QUESTION_TYPES))
            ? QUESTION_TYPES
            : [];
        if (allowed.length && allowed.indexOf(text) === -1) {
            return {
                ok: false,
                error: '題目「' + idLabel + '」題目類型須為：' + allowed.join('、') + '（目前：' + text + '）。'
            };
        }
        return { ok: true, error: '' };
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

    // Shared 特徵 matcher for 題目 filters, 統計, and ConditionMatch.
    // Lives here (before condition-match.js) so advanced filter / data-checks
    // do not need a duplicate fallback body.
    function questionFeatureOn(q, value) {
        if (value === '含圖表') {
            return !!(q.graphType && q.graphType !== '' && q.graphType !== '-' && q.graphType !== '沒有圖');
        }
        if (value === '有內嵌圖') return !!(q.inlineDiagrams && String(q.inlineDiagrams).trim());
        if (value === '含表格') {
            return !!(q.tableType && q.tableType !== '' && q.tableType !== '-' && q.tableType !== '沒有表格');
        }
        if (value === '複選') {
            return !!(q.multipleSelectionType && q.multipleSelectionType !== '' && q.multipleSelectionType !== '-' &&
                q.multipleSelectionType !== '並非複選型' && q.multipleSelectionType !== '不適用');
        }
        if (value === '含計算') {
            return !!(q.calculationType && q.calculationType !== '' && q.calculationType !== '-' && q.calculationType !== '沒有計算');
        }
        if (value === '跨課題') {
            return !!(q.curriculumClassification && Array.isArray(q.curriculumClassification) && q.curriculumClassification.length > 1);
        }
        if (value === '跨章節') {
            return !!(q.AristochapterClassification && Array.isArray(q.AristochapterClassification) && q.AristochapterClassification.length > 1);
        }
        if (value === '已刪除') return !!(q.answerMC && String(q.answerMC).trim() === '*');
        if (value === 'Out syl') return !!(q.outSyl && String(q.outSyl).trim().toUpperCase() === 'Y');
        if (value === '有分題') return questionHasParts(q);
        if (value === '沒有分題') return questionPartsConfirmedNone(q);
        if (value === '尚未輸入分題') return questionPartsPending(q);
        if (value === '題目空白') return isQuestionTextBlank(q);
        if (value === '答案空白') return isAnswerBlank(q);
        if (value === '評卷報告空白') return isMarkersReportBlank(q);
        return false;
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
    global.normalizePartsStatus = normalizePartsStatus;
    global.resolvePartsStatus = resolvePartsStatus;
    global.partsStatusLabel = partsStatusLabel;
    global.applyPartsFields = applyPartsFields;
    global.questionPartsPending = questionPartsPending;
    global.questionPartsConfirmedNone = questionPartsConfirmedNone;
    global.PARTS_STATUS_PENDING = PARTS_STATUS_PENDING;
    global.PARTS_STATUS_NONE = PARTS_STATUS_NONE;
    global.PARTS_STATUS_FILLED = PARTS_STATUS_FILLED;
    global.PARTS_STATUS_LABELS = PARTS_STATUS_LABELS;
    global.questionHasPartPerformance = questionHasPartPerformance;
    global.questionHasPartMarks = questionHasPartMarks;
    global.sumPartMarks = sumPartMarks;
    global.validatePartMarksSum = validatePartMarksSum;
    global.validatePartMarksSumMany = validatePartMarksSumMany;
    global.validateMarksNonNegative = validateMarksNonNegative;
    global.validateCorrectPercentage = validateCorrectPercentage;
    global.parseChapterNumberToken = parseChapterNumberToken;
    global.validateChapterClassification = validateChapterClassification;
    global.validateExaminationType = validateExaminationType;
    global.validateQuestionTypeValue = validateQuestionTypeValue;
    global.serializeQuestionPartsCompact = serializeQuestionPartsCompact;
    global.parseQuestionPartsCompact = parseQuestionPartsCompact;
    global.normalizeYear = normalizeYear;
    global.questionSearchText = questionSearchText;
    global.questionFeatureOn = questionFeatureOn;
    global.ADMIN_BLANK_FEATURE_ITEMS = ADMIN_BLANK_FEATURES;
    global.PART_MARKS_SUM_TOLERANCE = PART_MARKS_SUM_TOLERANCE;
})(window);
