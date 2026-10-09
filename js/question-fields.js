// question-fields.js
// Shared blank-field checks and questionParts helpers for filters, form, and
// advanced condition matching.
//
// Blank: null/undefined, whitespace-only, or '-' count as blank.
// 題目 = questionTextChi + questionTextEng + plainText (all blank → 題目空白)
// 答案 = answerMC + answerChi + answerEng
// 評卷報告 = markersReportChi + markersReportEng (UI label 評卷報告 / Markers Report)
//
// questionParts: [{ label, marks, performance }, ...]
// Total marks (question.marks) stays authoritative — parts do not auto-sum into it.

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
    global.questionSearchText = questionSearchText;
    global.ADMIN_BLANK_FEATURE_ITEMS = ADMIN_BLANK_FEATURES;
})(window);
