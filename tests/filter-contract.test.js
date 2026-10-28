#!/usr/bin/env node
// Shared Filter Contract parity tests.
// Run: node tests/filter-contract.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) {
        passed += 1;
        return;
    }
    failed += 1;
    failures.push(name + '\n  actual   ' + a + '\n  expected ' + b);
}

function checkTrue(name, value) {
    check(name, !!value, true);
}

function idsOf(list) {
    return (list || []).map(function (q) { return q.id; });
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractApplyBody(src) {
    const start = src.indexOf('// Mock papers are omitted unless the proxy granted mockTests.');
    const end = src.indexOf('return questions;', start);
    if (start < 0 || end < 0) throw new Error('apply body markers missing');
    return src.slice(start, end + 'return questions;'.length);
}

check(
    'moved apply body matches frozen reference',
    extractApplyBody(read('js/filter-contract.js')),
    extractApplyBody(read('tests/apply-filters-reference.js'))
);

const contractSrc = read('js/filter-contract.js');
checkTrue('contract does not touch localStorage', contractSrc.indexOf('localStorage') === -1);
checkTrue('contract does not touch indexedDB', contractSrc.indexOf('indexedDB') === -1);

const handoverNeedles = ['Copy JSON', 'Paste JSON', '複製 JSON', '貼上 JSON', 'copyFilterJSON', 'pasteFilterJSON'];
const handoverFiles = [
    'index.html',
    'js/filter-contract.js',
    'js/filters.js',
    'js/filter-modal.js',
    'js/stats-filters.js',
    'js/advanced-filter.js',
    'js/templates/template-filters.js',
    'js/storage-filters.js'
];
handoverFiles.forEach(function (rel) {
    const text = read(rel);
    handoverNeedles.forEach(function (needle) {
        checkTrue(rel + ' has no handover string ' + needle, text.indexOf(needle) === -1);
    });
});

const indexHtml = read('index.html');
const contractPos = indexHtml.indexOf('js/filter-contract.js');
const filtersPos = indexHtml.indexOf('js/storage-filters.js');
checkTrue('index loads filter-contract', contractPos > 0);
checkTrue('filter-contract loads before storage-filters', contractPos < filtersPos);

const storageSrc = read('js/storage-filters.js');
checkTrue('applyFilters delegates to applyLegacyFilters', storageSrc.indexOf('return applyLegacyFilters(') !== -1);

const els = {};
const searches = [];
const scopes = [];
const documentStub = {
    getElementById: function (id) { return els[id] || null; },
    querySelector: function () { return null; },
    querySelectorAll: function (sel) {
        if (sel === '[data-sf-search]') return searches;
        if (sel === '[data-sf-scope]') return scopes;
        return [];
    },
    addEventListener: function () {},
    removeEventListener: function () {}
};

const context = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    document: documentStub,
    localStorage: {
        getItem: function () { return null; },
        setItem: function () { context.__storageWrites += 1; },
        removeItem: function () {}
    },
    __storageWrites: 0
};
context.window = context;
context.global = context;
context.globalThis = context;
context.addEventListener = function () {};
context.removeEventListener = function () {};
vm.createContext(context);

function load(rel) {
    vm.runInContext(read(rel), context, { filename: rel });
}

function loadBundle(rels, filename) {
    const code = rels.map(read).join('\n;\n') + '\n;window.IndexedDBStorage = IndexedDBStorage;\n';
    vm.runInContext(code, context, { filename: filename });
}

load('js/globals.js');
loadBundle([
    'js/constants.js',
    'js/storage-core.js',
    'js/filter-contract.js',
    'js/storage-filters.js'
], 'filter-bundle.js');
load('js/question-fields.js');
load('js/condition-match.js');
load('js/question-list-filter.js');
load('tests/apply-filters-reference.js');
load('js/filters.js');
load('js/stats-filters.js');

let aiLoaded = false;
try {
    load('js/ai-explanation.js');
    aiLoaded = typeof context.questionMatchesAiFilter === 'function'
        && context.AiExplanation && context.AiExplanation.store;
} catch (err) {
    aiLoaded = false;
}
if (!aiLoaded) {
    context.questionMatchesAiFilter = function (question, triAi) {
        if (!triAi || typeof triAi !== 'object') return true;
        const checked = Object.keys(triAi).filter(function (k) { return triAi[k] === 'checked'; });
        const excluded = Object.keys(triAi).filter(function (k) { return triAi[k] === 'excluded'; });
        if (!checked.length && !excluded.length) return true;
        const values = (context.__aiValues && context.__aiValues[question && question.id]) || ['沒有AI解釋'];
        if (checked.length && !checked.every(function (item) { return values.indexOf(item) !== -1; })) return false;
        if (excluded.some(function (item) { return values.indexOf(item) !== -1; })) return false;
        return true;
    };
}
checkTrue('AI matcher is installed', typeof context.questionMatchesAiFilter === 'function');

context.storage = new context.IndexedDBStorage();
context.accessRights = { mockTests: true, admin: true, ai: true };
context.authManager = null;

function q(partial) {
    return Object.assign({
        id: 'Q',
        publisher: 'HKEAA',
        examination: 'HKDSE',
        year: '2024',
        questionType: 'SQ',
        paper: '1',
        section: 'A',
        questionNumber: '1',
        concepts: [],
        patterns: [],
        stemPatterns: [],
        curriculumClassification: ['A 基本經濟概念'],
        AristochapterClassification: ['Ch01'],
        questionTextChi: '題幹',
        questionTextEng: '',
        plainText: '題幹',
        topic: '課題',
        answerMC: 'A',
        answerChi: '答案',
        answerEng: '',
        markersReportChi: '報告',
        markersReportEng: '',
        correctPercentage: 55,
        marks: 4,
        outSyl: '',
        graphType: '沒有圖',
        tableType: '沒有表格',
        calculationType: '沒有計算',
        multipleSelectionType: '並非複選型',
        questionParts: [],
        partsStatus: 'none',
        inlineDiagrams: ''
    }, partial);
}

const bank = [
    q({ id: 'base' }),
    q({ id: 'out', outSyl: 'Y', plainText: '超綱題', questionTextChi: '超綱題' }),
    q({ id: 'parts', questionParts: [{ label: 'a', marks: 1, performance: '良好' }] }),
    q({ id: 'deleted', answerMC: '*', questionParts: [{ label: 'a', marks: 1, performance: '欠佳' }] }),
    q({
        id: 'blank',
        questionTextChi: '-',
        questionTextEng: '',
        plainText: '',
        topic: '',
        answerMC: '-',
        answerChi: '-',
        answerEng: '-',
        markersReportChi: '-',
        markersReportEng: '-'
    }),
    q({ id: 'mc', questionType: 'MC', questionParts: [], partsStatus: '' }),
    q({ id: 'pending', questionType: 'SQ', questionParts: [], partsStatus: '' }),
    q({ id: 'mt', year: 'MT39', id: 'mt' }),
    q({ id: 'bare', year: '39' }),
    q({ id: 'cal', year: '2020' }),
    q({ id: 'ch-both', AristochapterClassification: ['Ch01', 'Ch02'], curriculumClassification: ['A 基本經濟概念', 'B 廠商與生產'] }),
    q({ id: 'concept', concepts: ['需求'], patterns: ['圖表'], stemPatterns: ['資料回應'] }),
    q({ id: 'empty-concept', concepts: [], patterns: ['-'], stemPatterns: [] }),
    q({ id: 'graph-bar', graphType: '棒形圖' }),
    q({ id: 'graph-blank', graphType: '-' }),
    q({ id: 'pub', publisher: '雅集出版社', examination: 'Mock' }),
    q({ id: 'mock-id', id: 'MT12', publisher: 'HKEAA' }),
    q({ id: 'q7', id: 'DSE-2024-P1-07', questionNumber: '' }),
    q({ id: 'QX', questionNumber: '12(a)' }),
    q({ id: 'pct-blank', correctPercentage: '', marks: '' }),
    q({ id: 'paper2', paper: 2, section: 'B' }),
    q({ id: 'inflation', plainText: '通脹上升', questionTextChi: '通脹上升', topic: '物價' }),
    q({ id: 'only-concept-word', concepts: ['獨特概念'], plainText: '普通', questionTextChi: '普通', topic: '普通' }),
    q({ id: 'perf', questionParts: [{ label: 'a', marks: 2, performance: '優異' }, { label: 'b', marks: 2, performance: '良好' }] })
];

function perm(questions) {
    return context.storage.applyPermissionFilter(questions);
}

function resetLayers() {
    context.idSetFilter = { active: false, ids: null, label: '', source: '' };
    context.advancedFilter = { active: false, conditions: [], label: '' };
    context.filterLogic = { curriculum: 'OR', chapter: 'OR' };
    context.accessRights.mockTests = true;
    context.accessRights.admin = true;
}

function applyBoth(questions, filters) {
    const viaStorage = idsOf(context.storage.applyFilters(questions, filters));
    const viaReference = idsOf(context.referenceApplyFilters(questions, filters, perm));
    return { viaStorage: viaStorage, viaReference: viaReference };
}

function parity(name, questions, filters, expected) {
    const both = applyBoth(questions, filters);
    check(name + ' storage vs reference', both.viaStorage, both.viaReference);
    if (expected) check(name + ' expected ids', both.viaStorage, expected);
}

resetLayers();

parity('empty filters keep permission-visible rows', bank, {}, null);
check('empty filters count', applyBoth(bank, {}).viaStorage.length, bank.length);

context.accessRights.mockTests = false;
parity('mock papers hidden without mockTests', bank, {}, null);
checkTrue(
    'MT id dropped when mockTests is false',
    applyBoth(bank, {}).viaStorage.indexOf('MT12') === -1
);
checkTrue(
    'non-HKEAA publisher dropped when mockTests is false',
    applyBoth(bank, {}).viaStorage.indexOf('pub') === -1
);
checkTrue(
    'HKEAA calendar row kept when mockTests is false',
    applyBoth(bank, {}).viaStorage.indexOf('base') !== -1
);
context.accessRights.mockTests = true;
parity('mock papers return when mockTests is true', bank, {}, null);
checkTrue('MT id kept when mockTests is true', applyBoth(bank, {}).viaStorage.indexOf('MT12') !== -1);

parity('search scope all hits topic text', bank, { search: '物價', searchScope: 'all' }, ['inflation']);
parity('search scope all does not search concepts', bank, { search: '獨特概念', searchScope: 'all' }, []);
parity('search scope concepts hits concept tags', bank, { search: '獨特概念', searchScope: 'concepts' }, ['only-concept-word']);
parity('search scope id', bank, { search: 'dse-2024', searchScope: 'id' }, ['DSE-2024-P1-07']);
parity('search scope answer', bank, { search: '答案', searchScope: 'answer' }, null);
checkTrue('answer scope keeps a row with 答案', applyBoth(bank, { search: '答案', searchScope: 'answer' }).viaStorage.indexOf('base') !== -1);
checkTrue('answer scope drops the blank stem', applyBoth(bank, { search: '答案', searchScope: 'answer' }).viaStorage.indexOf('blank') === -1);
parity('search scope markersReport', bank, { search: '報告', searchScope: 'markersReport' }, null);
checkTrue('report scope keeps base', applyBoth(bank, { search: '報告', searchScope: 'markersReport' }).viaStorage.indexOf('base') !== -1);
parity('search scope exam matches section', bank, { search: '乙', searchScope: 'exam' }, []);
parity('search scope publisher', bank, { search: '雅集', searchScope: 'publisher' }, ['pub']);
parity('empty search is unrestricted', bank, { search: '', searchScope: 'all' }, null);
check('empty search length', applyBoth(bank, { search: '' }).viaStorage.length, bank.length);
parity('whitespace search is not stripped', bank, { search: ' ', searchScope: 'content' }, null);

parity('legacy examination scalar', bank, { examination: 'Mock' }, ['pub']);
parity('legacy questionType scalar', bank, { questionType: 'MC' }, ['mc']);

parity('percentage active drops blanks and out of range', bank, {
    percentageFilter: { active: true, min: 50, max: 60 }
}, null);
checkTrue('percentage keeps base 55', applyBoth(bank, { percentageFilter: { active: true, min: 50, max: 60 } }).viaStorage.indexOf('base') !== -1);
checkTrue('percentage drops blank', applyBoth(bank, { percentageFilter: { active: true, min: 0, max: 100 } }).viaStorage.indexOf('pct-blank') === -1);
parity('percentage inactive keeps blanks', bank, {
    percentageFilter: { active: false, min: 0, max: 10 }
}, null);
checkTrue('inactive percentage keeps pct-blank', applyBoth(bank, { percentageFilter: { active: false, min: 0, max: 10 } }).viaStorage.indexOf('pct-blank') !== -1);

parity('marks range', bank, { marksFilter: { active: true, min: 4, max: 4 } }, null);
checkTrue('marks 4 keeps base', applyBoth(bank, { marksFilter: { active: true, min: 4, max: 4 } }).viaStorage.indexOf('base') !== -1);
checkTrue('marks 4 drops pct-blank', applyBoth(bank, { marksFilter: { active: true, min: 4, max: 4 } }).viaStorage.indexOf('pct-blank') === -1);

parity('question number from id suffix', bank, {
    questionNumberFilter: { active: true, min: 7, max: 7 }
}, ['DSE-2024-P1-07']);
parity('question number id suffix and questionNumber fallback', bank, {
    questionNumberFilter: { active: true, min: 12, max: 12 }
}, ['MT12', 'QX']);

parity('publisher checked', bank, {
    triState: { publisher: { '雅集出版社': 'checked' } }
}, ['pub']);
parity('publisher excluded', bank, {
    triState: { publisher: { HKEAA: 'excluded' } }
}, ['pub']);
parity('publisher checked HKEAA then excluded 雅集 keeps HKEAA', bank, {
    triState: { publisher: { HKEAA: 'checked', '雅集出版社': 'excluded' } }
}, null);
checkTrue(
    'checked HKEAA drops 雅集',
    applyBoth(bank, { triState: { publisher: { HKEAA: 'checked', '雅集出版社': 'excluded' } } }).viaStorage.indexOf('pub') === -1
);
checkTrue(
    'checked HKEAA keeps base',
    applyBoth(bank, { triState: { publisher: { HKEAA: 'checked', '雅集出版社': 'excluded' } } }).viaStorage.indexOf('base') !== -1
);

parity('year 39 matches MT39 and bare 39', bank, {
    triState: { year: { '39': 'checked' } }
}, ['mt', 'bare']);
parity('year label MT39 matches the same rows', bank, {
    triState: { year: { MT39: 'checked' } }
}, ['mt', 'bare']);
parity('year excluded drops both spellings', bank, {
    triState: { year: { '39': 'excluded' } }
}, null);
checkTrue('excluded year drops mt', applyBoth(bank, { triState: { year: { '39': 'excluded' } } }).viaStorage.indexOf('mt') === -1);
checkTrue('excluded year keeps 2020', applyBoth(bank, { triState: { year: { '39': 'excluded' } } }).viaStorage.indexOf('cal') !== -1);
parity('checked years are OR', bank, {
    triState: { year: { '2020': 'checked', '2024': 'checked' } }
}, null);
checkTrue('2020 included in year OR', applyBoth(bank, { triState: { year: { '2020': 'checked', '2024': 'checked' } } }).viaStorage.indexOf('cal') !== -1);
checkTrue('2024 included in year OR', applyBoth(bank, { triState: { year: { '2020': 'checked', '2024': 'checked' } } }).viaStorage.indexOf('base') !== -1);

parity('qtype checked', bank, { triState: { qtype: { MC: 'checked' } } }, ['mc']);
parity('exam tri', bank, { triState: { exam: { Mock: 'checked' } } }, ['pub']);

context.filterLogic = { curriculum: 'OR', chapter: 'OR' };
parity('curriculum OR', bank, {
    triState: { curriculum: { 'B 廠商與生產': 'checked' } }
}, ['ch-both']);
context.filterLogic = { curriculum: 'AND', chapter: 'OR' };
parity('curriculum AND uses window.filterLogic', bank, {
    triState: { curriculum: { 'A 基本經濟概念': 'checked', 'B 廠商與生產': 'checked' } }
}, ['ch-both']);
parity('curriculum excluded', bank, {
    triState: { curriculum: { 'A 基本經濟概念': 'excluded' } }
}, null);
checkTrue('curriculum exclude drops base', applyBoth(bank, { triState: { curriculum: { 'A 基本經濟概念': 'excluded' } } }).viaStorage.indexOf('base') === -1);

context.filterLogic = { curriculum: 'OR', chapter: 'OR' };
parity('chapter OR uses Ch prefix', bank, {
    triState: { chapter: { '02': 'checked' } }
}, ['ch-both']);
context.filterLogic = { curriculum: 'OR', chapter: 'AND' };
parity('chapter AND', bank, {
    triState: { chapter: { '01': 'checked', '02': 'checked' } }
}, ['ch-both']);
parity('chapter excluded', bank, {
    triState: { chapter: { '01': 'excluded' } }
}, null);
checkTrue('chapter exclude drops base', applyBoth(bank, { triState: { chapter: { '01': 'excluded' } } }).viaStorage.indexOf('base') === -1);
context.filterLogic = { curriculum: 'OR', chapter: 'OR' };

parity('concepts checked is OR', bank, {
    triState: { concepts: { '需求': 'checked' } }
}, ['concept']);
parity('concepts empty sentinel', bank, {
    triState: { concepts: { __empty__: 'checked' } }
}, null);
checkTrue('empty concepts include empty-concept', applyBoth(bank, { triState: { concepts: { __empty__: 'checked' } } }).viaStorage.indexOf('empty-concept') !== -1);
checkTrue('empty concepts include base', applyBoth(bank, { triState: { concepts: { __empty__: 'checked' } } }).viaStorage.indexOf('base') !== -1);
checkTrue('empty concepts exclude tagged concept', applyBoth(bank, { triState: { concepts: { __empty__: 'checked' } } }).viaStorage.indexOf('concept') === -1);
parity('concepts exclude empty', bank, {
    triState: { concepts: { __empty__: 'excluded' } }
}, null);
checkTrue('exclude empty concepts drops base', applyBoth(bank, { triState: { concepts: { __empty__: 'excluded' } } }).viaStorage.indexOf('base') === -1);
checkTrue('exclude empty concepts keeps 需求', applyBoth(bank, { triState: { concepts: { __empty__: 'excluded' } } }).viaStorage.indexOf('concept') !== -1);

parity('patterns checked', bank, { triState: { patterns: { '圖表': 'checked' } } }, ['concept']);
parity('stemPatterns checked', bank, { triState: { stemPatterns: { '資料回應': 'checked' } } }, ['concept']);
parity('patterns empty sentinel treats dash as empty', bank, {
    triState: { patterns: { __empty__: 'checked' } }
}, null);
checkTrue('dash pattern counts as empty', applyBoth(bank, { triState: { patterns: { __empty__: 'checked' } } }).viaStorage.indexOf('empty-concept') !== -1);

parity('paper stringifies numeric 2', bank, { triState: { paper: { '2': 'checked' } } }, ['paper2']);
parity('section checked', bank, { triState: { section: { B: 'checked' } } }, ['paper2']);

parity('graph confirmed-none is not the empty sentinel', bank, {
    triState: { graph: { '沒有圖': 'checked' } }
}, null);
checkTrue('沒有圖 matches base', applyBoth(bank, { triState: { graph: { '沒有圖': 'checked' } } }).viaStorage.indexOf('base') !== -1);
checkTrue('沒有圖 does not match blank', applyBoth(bank, { triState: { graph: { '沒有圖': 'checked' } } }).viaStorage.indexOf('graph-blank') === -1);
parity('graph empty sentinel', bank, {
    triState: { graph: { __empty__: 'checked' } }
}, ['graph-blank']);
parity('graph checked bar', bank, { triState: { graph: { '棒形圖': 'checked' } } }, ['graph-bar']);
parity('table excluded confirmed-none', bank, {
    triState: { table: { '沒有表格': 'excluded' } }
}, null);
checkTrue('excluding 沒有表格 drops base', applyBoth(bank, { triState: { table: { '沒有表格': 'excluded' } } }).viaStorage.indexOf('base') === -1);
parity('calculation checked', bank, {
    triState: { calculation: { '沒有計算': 'checked' } }
}, null);
checkTrue('沒有計算 keeps base', applyBoth(bank, { triState: { calculation: { '沒有計算': 'checked' } } }).viaStorage.indexOf('base') !== -1);

parity('multipleSelection empty sentinel', bank, {
    triState: { multipleSelection: { __empty__: 'checked' } }
}, []);

parity('feature Out syl excluded', bank, {
    triState: { feature: { 'Out syl': 'excluded' } }
}, null);
checkTrue('Out syl excluded drops out', applyBoth(bank, { triState: { feature: { 'Out syl': 'excluded' } } }).viaStorage.indexOf('out') === -1);
checkTrue('Out syl excluded keeps base', applyBoth(bank, { triState: { feature: { 'Out syl': 'excluded' } } }).viaStorage.indexOf('base') !== -1);

parity('feature AND across keys', bank, {
    triState: { feature: { '有分題': 'checked', '已刪除': 'checked' } }
}, ['deleted']);
parity('有分題 is filled parts only', bank, {
    triState: { feature: { '有分題': 'checked' } }
}, null);
const partsIds = applyBoth(bank, { triState: { feature: { '有分題': 'checked' } } }).viaStorage;
checkTrue('有分題 keeps parts', partsIds.indexOf('parts') !== -1);
checkTrue('有分題 keeps deleted parts', partsIds.indexOf('deleted') !== -1);
checkTrue('有分題 drops MC', partsIds.indexOf('mc') === -1);
checkTrue('有分題 drops pending SQ', partsIds.indexOf('pending') === -1);

context.accessRights.admin = false;
parity('admin blank ignored for non-admin', bank, {
    triState: { adminBlank: { '題目空白': 'checked' } }
}, null);
check('non-admin blank filter length', applyBoth(bank, { triState: { adminBlank: { '題目空白': 'checked' } } }).viaStorage.length, bank.length);
parity('admin key stashed under feature is ignored', bank, {
    triState: { feature: { '題目空白': 'checked' } }
}, null);
check('feature admin key does not filter', applyBoth(bank, { triState: { feature: { '題目空白': 'checked' } } }).viaStorage.length, bank.length);

context.accessRights.admin = true;
parity('admin blank 題目空白', bank, {
    triState: { adminBlank: { '題目空白': 'checked' } }
}, ['blank']);
parity('admin 尚未輸入分題', bank, {
    triState: { adminBlank: { '尚未輸入分題': 'checked' } }
}, ['pending']);

parity('part performance AND across checked values', bank, {
    triState: { partPerformance: { '優異': 'checked', '良好': 'checked' } }
}, ['perf']);
parity('part performance excluded', bank, {
    triState: { partPerformance: { '良好': 'excluded' } }
}, null);
checkTrue('excluding 良好 drops parts row', applyBoth(bank, { triState: { partPerformance: { '良好': 'excluded' } } }).viaStorage.indexOf('parts') === -1);
checkTrue('excluding 良好 keeps base', applyBoth(bank, { triState: { partPerformance: { '良好': 'excluded' } } }).viaStorage.indexOf('base') !== -1);

context.idSetFilter = { active: true, ids: { base: true, out: true }, label: 'set', source: 'test' };
parity('omitted idSet inherits window', bank, {}, ['base', 'out']);
parity('explicit inactive idSet does not inherit', bank, {
    idSetFilter: { active: false, ids: null, label: '', source: '' }
}, null);
check('explicit inactive idSet length', applyBoth(bank, {
    idSetFilter: { active: false, ids: null, label: '', source: '' }
}).viaStorage.length, bank.length);
parity('active empty id map matches nothing', bank, {
    idSetFilter: { active: true, ids: {}, label: '', source: '' }
}, []);
context.idSetFilter = { active: false, ids: null, label: '', source: '' };

context.advancedFilter = {
    active: true,
    conditions: [{ include: true, field: 'text', value: '通脹' }],
    label: 'adv'
};
parity('omitted advanced inherits window', bank, {
    idSetFilter: { active: false, ids: null, label: '', source: '' }
}, ['inflation']);
parity('explicit inactive advanced does not inherit', bank, {
    idSetFilter: { active: false, ids: null, label: '', source: '' },
    advancedFilter: { active: false, conditions: [], label: '' }
}, null);
check('explicit inactive advanced length', applyBoth(bank, {
    advancedFilter: { active: false, conditions: [], label: '' }
}).viaStorage.length, bank.length);
context.advancedFilter = { active: false, conditions: [], label: '' };
parity('advanced AND of two conditions', bank, {
    advancedFilter: {
        active: true,
        conditions: [
            { include: true, field: 'text', value: '通脹' },
            { include: true, field: 'concepts', value: '不會有' }
        ],
        label: 'and'
    }
}, []);
parity('advanced text include', bank, {
    advancedFilter: {
        active: true,
        conditions: [{ include: true, field: 'text', value: '超綱' }],
        label: 'syl'
    }
}, ['out']);

parity('search AND feature intersect', bank, {
    search: '超綱',
    searchScope: 'content',
    triState: { feature: { 'Out syl': 'checked' } }
}, ['out']);

if (aiLoaded) {
    context.AiExplanation.store.byQuestion.aiShort = {
        explanations: [{ id: 'e1', questionId: 'aiShort', detailLevel: 'short', text: 's' }]
    };
    context.AiExplanation.store.byQuestion.aiBoth = {
        explanations: [
            { id: 'e2', questionId: 'aiBoth', detailLevel: 'short', text: 's' },
            { id: 'e3', questionId: 'aiBoth', detailLevel: 'detailed', text: 'd' }
        ]
    };
} else {
    context.__aiValues = {
        aiShort: ['有AI解釋', '簡短'],
        aiBoth: ['有AI解釋', '簡短', '詳盡']
    };
}
const aiBank = [
    q({ id: 'aiShort' }),
    q({ id: 'aiBoth' }),
    q({ id: 'aiNone' })
];
parity('AI checked values are AND', aiBank, {
    triState: { ai: { '簡短': 'checked', '詳盡': 'checked' } }
}, ['aiBoth']);
parity('AI 有AI解釋', aiBank, {
    triState: { ai: { '有AI解釋': 'checked' } }
}, ['aiShort', 'aiBoth']);
parity('AI excluded 沒有AI解釋', aiBank, {
    triState: { ai: { '沒有AI解釋': 'excluded' } }
}, ['aiShort', 'aiBoth']);
parity('AI checked 沒有AI解釋', aiBank, {
    triState: { ai: { '沒有AI解釋': 'checked' } }
}, ['aiNone']);
parity('empty AI map is unrestricted', aiBank, { triState: { ai: {} } }, ['aiShort', 'aiBoth', 'aiNone']);

const savedStorage = context.storage;
context.storage = null;
context.accessRights.mockTests = false;
const fallbackIds = idsOf(context.__SFC__.applyQuestionsFilterContract(bank, context.__SFC__.emptyQuestionsContract()));
checkTrue('permission fallback drops MT id', fallbackIds.indexOf('MT12') === -1);
checkTrue('permission fallback drops non-HKEAA', fallbackIds.indexOf('pub') === -1);
checkTrue('permission fallback keeps base', fallbackIds.indexOf('base') !== -1);
context.storage = savedStorage;
context.accessRights.mockTests = true;

const emptyContract = context.__SFC__.emptyQuestionsContract();
const emptyIds = idsOf(context.__SFC__.applyQuestionsFilterContract(bank, emptyContract));
const emptyLegacy = context.FilterContract.questionsContractToLegacy(emptyContract);
parity('empty contract legacy matches reference', bank, emptyLegacy, emptyIds);
checkTrue('empty contract does not exclude Out syl', emptyIds.indexOf('out') !== -1);
check('empty contract version', emptyContract.version, 1);
check('empty contract surface', emptyContract.surface, 'questions');
check('empty contract search', emptyContract.search, '');
check('empty feature map', emptyContract.triState.feature, {});

context.filterLogic = { curriculum: 'AND', chapter: 'AND' };
const orContract = context.__SFC__.emptyQuestionsContract();
orContract.triState.curriculum = { 'B 廠商與生產': 'checked' };
orContract.filterLogic = { curriculum: 'OR', chapter: 'OR' };
const orIds = idsOf(context.__SFC__.applyQuestionsFilterContract(bank, orContract));
check('self-contained contract OR ignores window AND', orIds, ['ch-both']);
const andLegacy = context.storage.applyFilters(bank, {
    triState: { curriculum: { 'A 基本經濟概念': 'checked', 'B 廠商與生產': 'checked' } }
});
check('legacy omit filterLogic still uses window AND', idsOf(andLegacy), ['ch-both']);
context.filterLogic = { curriculum: 'OR', chapter: 'OR' };

const outContract = context.__SFC__.emptyQuestionsContract();
outContract.triState.feature = { 'Out syl': 'excluded' };
check(
    'contract Out syl matches legacy apply',
    idsOf(context.__SFC__.applyQuestionsFilterContract(bank, outContract)),
    idsOf(context.referenceApplyFilters(bank, context.FilterContract.questionsContractToLegacy(outContract), perm))
);

const idContract = context.__SFC__.emptyQuestionsContract();
idContract.idSet = { active: true, ids: ['base', 'cal'], label: '兩題', source: 'agent' };
check(
    'contract idSet membership',
    idsOf(context.__SFC__.applyQuestionsFilterContract(bank, idContract)),
    ['base', 'cal']
);
const emptyIdContract = context.__SFC__.emptyQuestionsContract();
emptyIdContract.idSet = { active: true, ids: [], label: '', source: '' };
check(
    'contract active empty id list matches nothing',
    idsOf(context.__SFC__.applyQuestionsFilterContract(bank, emptyIdContract)),
    []
);

context.idSetFilter = { active: true, ids: { base: true }, label: 'live', source: 'ui' };
const noInherit = idsOf(context.__SFC__.applyQuestionsFilterContract(bank, context.__SFC__.emptyQuestionsContract()));
checkTrue('contract apply does not inherit window idSet', noInherit.indexOf('out') !== -1 && noInherit.length === bank.length);
context.idSetFilter = { active: false, ids: null, label: '', source: '' };

const statsState = {
    search: '  通脹  ',
    searchScope: 'name',
    triState: {
        feature: { 'Out syl': 'excluded' },
        year: { '2020': 'checked' },
        curriculum: {},
        chapter: {}
    },
    logic: { curriculum: 'AND', chapter: 'OR' },
    percentage: { min: 10, max: 90, active: true },
    marks: { min: 0, max: 30, active: false },
    qnum: { min: 1, max: 60, active: false }
};
const statsLegacy = context.statsStateToFilters(statsState);
const referenceStats = vm.runInContext('(' + function referenceStatsStateToFilters(state, omitKey) {
    const tri = JSON.parse(JSON.stringify(state.triState));
    if (omitKey && tri[omitKey]) tri[omitKey] = {};
    const filters = {
        search: '',
        searchScope: 'all',
        triState: tri,
        percentageFilter: state.percentage,
        marksFilter: state.marks,
        questionNumberFilter: state.qnum,
        filterLogic: {
            curriculum: state.logic.curriculum || 'OR',
            chapter: state.logic.chapter || 'OR'
        },
        idSetFilter: (typeof emptyIdSetFilter === 'function')
            ? emptyIdSetFilter()
            : { active: false, ids: null, label: '', source: '' },
        advancedFilter: (typeof emptyAdvancedFilter === 'function')
            ? emptyAdvancedFilter()
            : { active: false, conditions: [], label: '' }
    };
    const term = (state.search || '').trim();
    if (term && state.searchScope && state.searchScope !== 'name') {
        filters.search = term;
        filters.searchScope = state.searchScope;
    }
    return filters;
} + ')', context);
check('stats name scope legacy search', statsLegacy.search, '');
check('stats name scope legacy scope', statsLegacy.searchScope, 'all');
check(
    'statsStateToFilters matches pre-contract projection',
    statsLegacy,
    referenceStats(statsState)
);
const contentState = Object.assign({}, statsState, { searchScope: 'content' });
check('stats content scope trims search', context.statsStateToFilters(contentState).search, '通脹');
check(
    'stats content projection matches reference',
    context.statsStateToFilters(contentState),
    referenceStats(contentState)
);
check(
    'stats omitKey clears that tri map',
    context.statsStateToFilters(statsState, 'year').triState.year,
    {}
);
check(
    'stats omitKey projection matches reference',
    context.statsStateToFilters(statsState, 'year'),
    referenceStats(statsState, 'year')
);
check('stats legacy idSet inactive', statsLegacy.idSetFilter, { active: false, ids: null, label: '', source: '' });
check('stats legacy advanced inactive', statsLegacy.advancedFilter, { active: false, conditions: [], label: '' });
check('stats logic AND passed through', statsLegacy.filterLogic.curriculum, 'AND');

context.idSetFilter = { active: true, ids: { base: true }, label: 'should-not-apply', source: 'ui' };
const statsContract = context.FilterContract.normalizeStatsContract({
    version: 1,
    surface: 'stats',
    search: '通脹',
    searchScope: 'name',
    triState: { feature: { 'Out syl': 'excluded' } },
    filterLogic: { curriculum: 'OR', chapter: 'OR' },
    ranges: {
        percentage: { active: false, min: 0, max: 100 },
        marks: { active: false, min: 0, max: 30 },
        questionNumber: { active: false, min: 1, max: 60 }
    }
});
const statsApplied = idsOf(context.__SFC__.applyStatsFilterContract(bank, statsContract));
checkTrue('stats name search does not filter question text', statsApplied.indexOf('inflation') !== -1 && statsApplied.indexOf('base') !== -1);
checkTrue('stats contract still applies Out syl', statsApplied.indexOf('out') === -1);
checkTrue('stats contract does not inherit question idSet', statsApplied.indexOf('cal') !== -1);
const statsContent = context.__SFC__.applyStatsFilterContract(bank, Object.assign({}, statsContract, {
    searchScope: 'content'
}));
check('stats content scope filters text', idsOf(statsContent), ['inflation']);
context.idSetFilter = { active: false, ids: null, label: '', source: '' };

const yearStats = context.__SFC__.emptyStatsContract();
yearStats.triState.year = { '2020': 'checked' };
yearStats.triState.feature = { 'Out syl': 'checked' };
check(
    'applyStats omitKey drops the year restriction',
    idsOf(context.__SFC__.applyStatsFilterContract(bank, yearStats, 'year')),
    idsOf(context.__SFC__.applyStatsFilterContract(
        bank,
        Object.assign({}, yearStats, { triState: { year: {}, feature: { 'Out syl': 'checked' } } })
    ))
);

els.search = { value: '  hi  ' };
context.searchScope = 'concepts';
context.triStateFilters = {
    feature: { 'Out syl': 'excluded' },
    year: { '2024': 'checked' },
    curriculum: {},
    chapter: {},
    adminBlank: {},
    partPerformance: {},
    publisher: {},
    exam: {},
    qtype: {},
    section: {},
    paper: {},
    concepts: {},
    patterns: {},
    stemPatterns: {},
    ai: {},
    multipleSelection: {},
    graph: {},
    table: {},
    calculation: {}
};
context.filterLogic = { curriculum: 'AND', chapter: 'OR' };
context.percentageFilter = { min: 20, max: 80, active: true };
context.marksFilter = { min: 0, max: 30, active: false };
context.questionNumberFilter = { min: 1, max: 60, active: false };
context.idSetFilter = { active: true, ids: { base: true, cal: true }, label: '兩題', source: 'ui' };
context.advancedFilter = {
    active: true,
    conditions: [{ include: true, field: 'text', value: '題幹' }],
    label: '文字'
};
const live = context.gatherFilterState();
checkTrue('gatherFilterState returns live triState', live.triState === context.triStateFilters);
checkTrue('gatherFilterState returns live idSet', live.idSetFilter === context.idSetFilter);
check('gather search', live.search, '  hi  ');
check('gather scope', live.searchScope, 'concepts');
const snap = context.__SFC__.readQuestionsFromUI();
check('read search keeps spaces', snap.search, '  hi  ');
check('read scope', snap.searchScope, 'concepts');
check('read Out syl default-style exclusion', snap.triState.feature['Out syl'], 'excluded');
check('read year', snap.triState.year, { '2024': 'checked' });
check('read logic AND', snap.filterLogic.curriculum, 'AND');
check('read percentage active', snap.ranges.percentage, { active: true, min: 20, max: 80 });
check('read id list sorted', snap.idSet.ids, ['base', 'cal']);
check('read id active', snap.idSet.active, true);
check('read advanced value', snap.advanced.conditions[0].value, '題幹');
const roundLegacy = context.FilterContract.questionsContractToLegacy(snap);
check(
    'snapshot legacy matches live apply',
    idsOf(context.storage.applyFilters(bank, roundLegacy)),
    idsOf(context.storage.applyFilters(bank, live))
);

const initialStats = context.__SFC__.readStatsFromUI();
check('fresh stats UI excludes Out syl', initialStats.triState.feature['Out syl'], 'excluded');
check('fresh stats search scope is name', initialStats.searchScope, 'name');
check(
    'fresh stats read matches questionsMatchingStatsFilters',
    idsOf(context.questionsMatchingStatsFilters('stats', bank)),
    idsOf(context.__SFC__.applyStatsFilterContract(bank, initialStats))
);
checkTrue('fresh stats drop Out syl row', idsOf(context.questionsMatchingStatsFilters('stats', bank)).indexOf('out') === -1);

context.__storageWrites = 0;
const imported = context.__SFC__.importFilterJSON(JSON.stringify({
    version: 1,
    app: 'econ-database2',
    questions: {
        version: 1,
        surface: 'questions',
        search: 'GDP',
        searchScope: 'id',
        triState: { feature: { '有分題': 'checked' } },
        filterLogic: { curriculum: 'OR', chapter: 'AND' },
        ranges: {
            percentage: { active: false, min: 0, max: 100 },
            marks: { active: true, min: 1, max: 5 },
            questionNumber: { active: false, min: 1, max: 60 }
        },
        idSet: { active: false, ids: [], label: '', source: '' },
        advanced: { active: false, conditions: [], label: '' }
    },
    stats: {
        version: 1,
        surface: 'stats',
        search: '名稱',
        searchScope: 'name',
        triState: { year: { '2020': 'checked' } },
        filterLogic: { curriculum: 'AND', chapter: 'OR' },
        ranges: {
            percentage: { active: false, min: 0, max: 100 },
            marks: { active: false, min: 0, max: 30 },
            questionNumber: { active: true, min: 3, max: 9 }
        }
    }
}));

Promise.resolve(imported).then(function (bundle) {
    check('import returns bundle app', bundle.app, 'econ-database2');
    check('import writes question search', context.gatherFilterState().search, 'GDP');
    check('import writes question scope', context.searchScope, 'id');
    check('import clears Out syl when feature map omits it', bundle.questions.triState.feature['Out syl'] || '', '');
    check('import writes 有分題', context.triStateFilters.feature['有分題'], 'checked');
    check('import writes chapter logic', context.filterLogic.chapter, 'AND');
    check('import writes marks range', context.marksFilter, { active: true, min: 1, max: 5 });
    check('import does not persist filter JSON', context.__storageWrites, 0);
    check('import writes stats search', context.__SFC__.readStatsFromUI().search, '名稱');
    check('import writes stats year', context.__SFC__.readStatsFromUI().triState.year, { '2020': 'checked' });
    check('import writes stats qnum', context.__SFC__.readStatsFromUI().ranges.questionNumber, { active: true, min: 3, max: 9 });
    check('stats page resets on write', context.getStatsTabState('stats').page, 1);

    const exported = JSON.parse(context.__SFC__.exportFilterJSON());
    check('export version', exported.version, 1);
    check('export app', exported.app, 'econ-database2');
    check('export questions search', exported.questions.search, 'GDP');
    check('export stats scope', exported.stats.searchScope, 'name');

    return context.__SFC__.importFilterJSON({
        version: 1,
        surface: 'questions',
        search: '',
        triState: { feature: { 'Out syl': 'excluded' } }
    });
}).then(function () {
    check('single-surface import restores Out syl', context.triStateFilters.feature['Out syl'], 'excluded');
    check('single-surface import clears search', els.search.value, '');
    let versionError = '';
    try {
        context.__SFC__.importFilterJSON({ version: 2, surface: 'questions' });
    } catch (err) {
        versionError = err.message;
    }
    checkTrue('version 2 is rejected', versionError.indexOf('Unsupported filter contract version') !== -1);

    const scopeSelect = {
        value: 'all',
        options: [{ value: 'all', textContent: '全部欄位' }],
        appendChild: function (opt) { this.options.push(opt); }
    };
    els['search-scope'] = scopeSelect;
    context.document.createElement = function () {
        return { value: '', textContent: '' };
    };
    const previousFilterQuestions = context.filterQuestions;
    context.filterQuestions = function () {
        context.searchScope = scopeSelect.value;
        return Promise.resolve();
    };
    return context.__SFC__.writeQuestionsToUI({
        version: 1,
        surface: 'questions',
        search: 'kept',
        searchScope: 'id',
        triState: { feature: { 'Out syl': 'excluded' } }
    }).then(function () {
        check('scope select accepts a contract scope that was missing', scopeSelect.value, 'id');
        check('searchScope survives filterQuestions copying the select', context.searchScope, 'id');
        check('search text kept while fixing scope', els.search.value, 'kept');
        context.filterQuestions = previousFilterQuestions;
        delete els['search-scope'];

    const api = Object.keys(context.__SFC__).sort();
    ['importFilterJSON', 'exportFilterJSON', 'readQuestionsFromUI', 'writeQuestionsToUI', 'readStatsFromUI', 'writeStatsToUI', 'applyQuestionsFilterContract', 'applyStatsFilterContract'].forEach(function (name) {
        checkTrue('__SFC__.' + name, typeof context.__SFC__[name] === 'function');
    });
    checkTrue('__SFC__ version', context.__SFC__.version === 1);
    check('api list contains the contract methods', api.indexOf('importFilterJSON') !== -1, true);

    console.log('Shared Filter Contract tests');
    console.log('passed: ' + passed);
    console.log('failed: ' + failed);
    if (failed) {
        console.error(failures.join('\n\n'));
        process.exit(1);
    }
    });
}).catch(function (err) {
    console.error(err);
    console.log('Shared Filter Contract tests');
    console.log('passed: ' + passed);
    console.log('failed: ' + (failed + 1));
    process.exit(1);
});
