// condition-match.js
// Shared condition / field matching for 資料檢查 and 進階篩選.
//
// Exposes field definitions, condition normalization, AND matching, and
// autocomplete value collection. Does NOT own remote sync, exceptions,
// or any UI. Advanced filter must stay local-only; data-checks keeps
// its own GitHub sync.
//
// Dependencies: optional FEATURE_ITEMS / CURRICULUM_ITEMS / questionFeatureOn.

(function (global) {
    'use strict';

    var CONDITION_FIELDS = [
        { id: 'text', label: '字串', kind: 'text', autocomplete: false },
        { id: 'concepts', label: '概念', kind: 'array', prop: 'concepts', autocomplete: true },
        { id: 'patterns', label: '題型', kind: 'array', prop: 'patterns', autocomplete: true },
        { id: 'stemPatterns', label: '題幹模式', kind: 'array', prop: 'stemPatterns', autocomplete: true },
        { id: 'curriculumClassification', label: '課程分類', kind: 'array', prop: 'curriculumClassification', autocomplete: true },
        { id: 'AristochapterClassification', label: 'Chapters', kind: 'array', prop: 'AristochapterClassification', autocomplete: true },
        { id: 'graphType', label: '圖表類型', kind: 'scalar', prop: 'graphType', autocomplete: true },
        { id: 'tableType', label: '表格類型', kind: 'scalar', prop: 'tableType', autocomplete: true },
        { id: 'calculationType', label: '計算類型', kind: 'scalar', prop: 'calculationType', autocomplete: true },
        { id: 'multipleSelectionType', label: '複選類型', kind: 'scalar', prop: 'multipleSelectionType', autocomplete: true },
        { id: 'questionType', label: '題目類型', kind: 'scalar', prop: 'questionType', autocomplete: true },
        { id: 'examination', label: '考試', kind: 'scalar', prop: 'examination', autocomplete: true },
        { id: 'year', label: '年份', kind: 'scalar', prop: 'year', autocomplete: true },
        { id: 'paper', label: '卷別', kind: 'scalar', prop: 'paper', autocomplete: true },
        { id: 'section', label: 'Section', kind: 'scalar', prop: 'section', autocomplete: true },
        { id: 'publisher', label: '出版商', kind: 'scalar', prop: 'publisher', autocomplete: true },
        { id: 'feature', label: '特徵', kind: 'feature', autocomplete: true }
    ];

    var CONDITION_FIELD_BY_ID = {};
    CONDITION_FIELDS.forEach(function (def) {
        CONDITION_FIELD_BY_ID[def.id] = def;
    });

    var LEGACY_TYPE_TO_CHOICE = {
        textContains: { include: true, field: 'text' },
        textNotContains: { include: false, field: 'text' },
        conceptPresent: { include: true, field: 'concepts' },
        conceptAbsent: { include: false, field: 'concepts' }
    };

    var FIELD_ALIASES = {
        text: 'text',
        string: 'text',
        '字串': 'text',
        concept: 'concepts',
        concepts: 'concepts',
        '概念': 'concepts',
        patterns: 'patterns',
        stempatterns: 'stemPatterns',
        stemPatterns: 'stemPatterns',
        curriculum: 'curriculumClassification',
        curriculumclassification: 'curriculumClassification',
        curriculumClassification: 'curriculumClassification',
        chapter: 'AristochapterClassification',
        chapters: 'AristochapterClassification',
        aristochapterclassification: 'AristochapterClassification',
        AristochapterClassification: 'AristochapterClassification',
        graph: 'graphType',
        graphtype: 'graphType',
        graphType: 'graphType',
        table: 'tableType',
        tabletype: 'tableType',
        tableType: 'tableType',
        calculation: 'calculationType',
        calculationtype: 'calculationType',
        calculationType: 'calculationType',
        multipleselection: 'multipleSelectionType',
        multipleselectiontype: 'multipleSelectionType',
        multipleSelectionType: 'multipleSelectionType',
        qtype: 'questionType',
        questiontype: 'questionType',
        questionType: 'questionType',
        exam: 'examination',
        examination: 'examination',
        year: 'year',
        paper: 'paper',
        section: 'section',
        publisher: 'publisher',
        feature: 'feature'
    };

    function resolveFieldId(rawField) {
        var key = String(rawField == null ? '' : rawField).trim();
        if (!key) return '';
        if (CONDITION_FIELD_BY_ID[key]) return key;
        if (FIELD_ALIASES[key]) return FIELD_ALIASES[key];
        var lower = key.toLowerCase();
        if (FIELD_ALIASES[lower]) return FIELD_ALIASES[lower];
        return '';
    }

    function legacyTypeFor(include, field) {
        if (field === 'text') return include ? 'textContains' : 'textNotContains';
        if (field === 'concepts') return include ? 'conceptPresent' : 'conceptAbsent';
        return '';
    }

    function conditionChoicesFromRaw(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var type = String(raw.type || '').trim();
        if (LEGACY_TYPE_TO_CHOICE[type]) {
            return {
                include: LEGACY_TYPE_TO_CHOICE[type].include,
                field: LEGACY_TYPE_TO_CHOICE[type].field
            };
        }
        var include;
        if (typeof raw.include === 'boolean') {
            include = raw.include;
        } else if (raw.mode === 'include' || raw.mode === 'exclude') {
            include = raw.mode === 'include';
        } else if (raw.include === 'include' || raw.include === 'exclude') {
            include = raw.include === 'include';
        } else {
            include = null;
        }
        var field = resolveFieldId(raw.field || raw.match || raw.target || '');
        if (!field && (raw.field === 'concept' || raw.field === '概念')) {
            field = 'concepts';
        }
        if (include === null || !field || !CONDITION_FIELD_BY_ID[field]) return null;
        return { include: include, field: field };
    }

    function normalizeCondition(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var choices = conditionChoicesFromRaw(raw);
        if (!choices) return null;
        var out = {
            include: choices.include,
            field: choices.field,
            value: String(raw.value == null ? '' : raw.value)
        };
        var legacy = legacyTypeFor(choices.include, choices.field);
        if (legacy) out.type = legacy;
        return out;
    }

    function normalizeConditions(list) {
        if (!Array.isArray(list)) return [];
        return list.map(normalizeCondition).filter(Boolean);
    }

    function fieldLabel(fieldId) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        return def ? def.label : fieldId;
    }

    function questionText(question) {
        return [
            question && question.questionTextChi,
            question && question.questionTextEng,
            question && question.plainText
        ].map(function (part) {
            return String(part == null ? '' : part);
        }).join('\n');
    }

    function featureIsOn(question, featureName) {
        if (typeof questionFeatureOn === 'function') {
            return !!questionFeatureOn(question, featureName);
        }
        if (featureName === '含圖表') {
            return !!(question.graphType && question.graphType !== '' && question.graphType !== '-' && question.graphType !== '沒有圖');
        }
        if (featureName === '有內嵌圖') return !!(question.inlineDiagrams && String(question.inlineDiagrams).trim());
        if (featureName === '含表格') {
            return !!(question.tableType && question.tableType !== '' && question.tableType !== '-' && question.tableType !== '沒有表格');
        }
        if (featureName === '複選') {
            return !!(question.multipleSelectionType && question.multipleSelectionType !== '' && question.multipleSelectionType !== '-' &&
                question.multipleSelectionType !== '並非複選型' && question.multipleSelectionType !== '不適用');
        }
        if (featureName === '含計算') {
            return !!(question.calculationType && question.calculationType !== '' && question.calculationType !== '-' && question.calculationType !== '沒有計算');
        }
        if (featureName === '跨課題') {
            return !!(question.curriculumClassification && Array.isArray(question.curriculumClassification) && question.curriculumClassification.length > 1);
        }
        if (featureName === '跨章節') {
            return !!(question.AristochapterClassification && Array.isArray(question.AristochapterClassification) && question.AristochapterClassification.length > 1);
        }
        if (featureName === '已刪除') return !!(question.answerMC && String(question.answerMC).trim() === '*');
        if (featureName === 'Out syl') return !!(question.outSyl && String(question.outSyl).trim().toUpperCase() === 'Y');
        return false;
    }

    function questionHasFieldValue(question, fieldId, value) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        if (!def || !question) return false;
        var needle = String(value == null ? '' : value);
        if (def.kind === 'text') {
            return questionText(question).indexOf(needle) !== -1;
        }
        if (def.kind === 'array') {
            var list = question[def.prop];
            if (!Array.isArray(list)) return false;
            return list.includes(needle);
        }
        if (def.kind === 'scalar') {
            if (question[def.prop] === undefined || question[def.prop] === null) return false;
            return String(question[def.prop]).trim() === needle;
        }
        if (def.kind === 'feature') {
            return featureIsOn(question, needle);
        }
        return false;
    }

    function matchesCondition(question, condition) {
        var normalized = normalizeCondition(condition);
        if (!normalized) return false;
        var present = questionHasFieldValue(question, normalized.field, normalized.value);
        return normalized.include ? present : !present;
    }

    function matchesAllConditions(question, conditions) {
        var list = normalizeConditions(conditions);
        if (!list.length) return false;
        for (var i = 0; i < list.length; i++) {
            if (!matchesCondition(question, list[i])) return false;
        }
        return true;
    }

    function collectFieldValues(fieldId, questions) {
        var def = CONDITION_FIELD_BY_ID[fieldId];
        if (!def || !def.autocomplete) return [];
        var set = {};
        if (def.kind === 'feature' && typeof FEATURE_ITEMS !== 'undefined' && Array.isArray(FEATURE_ITEMS)) {
            FEATURE_ITEMS.forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (text) set[text] = true;
            });
        }
        if (def.kind === 'array' && def.prop === 'curriculumClassification' &&
            typeof CURRICULUM_ITEMS !== 'undefined' && Array.isArray(CURRICULUM_ITEMS)) {
            CURRICULUM_ITEMS.forEach(function (item) {
                var text = String(item == null ? '' : item).trim();
                if (text) set[text] = true;
            });
        }
        (questions || []).forEach(function (question) {
            if (!question) return;
            if (def.kind === 'array') {
                var list = question[def.prop];
                if (!Array.isArray(list)) return;
                list.forEach(function (item) {
                    var text = String(item == null ? '' : item).trim();
                    if (text) set[text] = true;
                });
                return;
            }
            if (def.kind === 'scalar') {
                if (question[def.prop] === undefined || question[def.prop] === null) return;
                var scalar = String(question[def.prop]).trim();
                if (!scalar) return;
                if (def.prop !== 'section' && scalar === '-') return;
                set[scalar] = true;
            }
        });
        return Object.keys(set).sort(function (a, b) {
            return a.localeCompare(b, 'zh-HK');
        });
    }

    function conditionSummaryText(conditions) {
        return normalizeConditions(conditions).map(function (condition) {
            var includeLabel = condition.include ? '包含' : '不包括';
            return includeLabel + fieldLabel(condition.field) + '「' + condition.value + '」';
        }).join(' 且 ');
    }

    function matchingQuestionIds(questions, conditions) {
        var ids = [];
        (questions || []).forEach(function (question) {
            if (!matchesAllConditions(question, conditions)) return;
            var id = String(question && question.id != null ? question.id : '').trim();
            if (id) ids.push(id);
        });
        ids.sort(function (a, b) { return a.localeCompare(b, 'zh-HK'); });
        return ids;
    }

    global.ConditionMatch = {
        FIELDS: CONDITION_FIELDS,
        FIELD_BY_ID: CONDITION_FIELD_BY_ID,
        resolveFieldId: resolveFieldId,
        normalizeCondition: normalizeCondition,
        normalizeConditions: normalizeConditions,
        fieldLabel: fieldLabel,
        questionHasFieldValue: questionHasFieldValue,
        matchesCondition: matchesCondition,
        matchesAllConditions: matchesAllConditions,
        collectFieldValues: collectFieldValues,
        conditionSummaryText: conditionSummaryText,
        matchingQuestionIds: matchingQuestionIds
    };
})(window);
