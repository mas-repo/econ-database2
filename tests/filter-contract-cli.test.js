#!/usr/bin/env node
// Headless Shared Filter Contract apply: CLI workset ids must match the
// browser __SFC__ apply path on the same questions, contract, and accessRights.
// Run: node tests/filter-contract-cli.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cliPath = path.join(root, 'tools', 'sfc-apply.js');
const sfc = require(cliPath);

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
    return (list || []).map(function (row) { return row.id; });
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function row(partial) {
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
        answerChi: '答案不應進 workset',
        answerEng: '',
        markersReportChi: '報告不應進 workset',
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
        inlineDiagrams: '',
        originalQuestionImage: '',
        originalQuestionImageEng: '',
        originalAnswerImage: '',
        originalAnswerImageEng: ''
    }, partial);
}

const hkeaaQuestions = [
    row({ id: 'base' }),
    row({ id: 'out', outSyl: 'Y', plainText: '超綱題', questionTextChi: '超綱題' }),
    row({
        id: 'y2020',
        year: '2020',
        concepts: ['需求'],
        stemPatterns: ['資料回應'],
        patterns: ['圖表'],
        plainText: '需求上升',
        questionTextChi: '需求上升',
        topic: '需求',
        curriculumClassification: ['A 基本經濟概念', 'B 廠商與生產'],
        AristochapterClassification: ['Ch01', 'Ch02'],
        tableType: '供求表'
    }),
    row({ id: 'parts', questionParts: [{ label: 'a', marks: 2, performance: '良好' }], partsStatus: 'filled' }),
    row({
        id: 'blank',
        questionTextChi: '-',
        questionTextEng: '',
        plainText: '',
        topic: '',
        answerMC: '-',
        answerChi: '-',
        answerEng: '-'
    }),
    row({ id: 'graph-blank', graphType: '-' }),
    row({
        id: 'graph-bar',
        graphType: '棒形圖',
        inlineDiagrams: 'diagrams/bar.png, ../secret, https://evil.example/x.png',
        originalQuestionImage: 'originals/q.png',
        originalAnswerImageEng: 'originals/a-en.png'
    }),
    row({ id: 'DSE-2024-P1-07', questionNumber: '' }),
    row({ id: 'inflation', plainText: '通脹上升', questionTextChi: '通脹上升', topic: '物價' }),
    row({ id: 'mc', questionType: 'MC', questionParts: [], partsStatus: '' }),
    row({ id: 'MT12', publisher: 'HKEAA' }),
    row({ id: 'has-ai', plainText: '有解釋的題', questionTextChi: '有解釋的題' })
];

const aristoQuestions = [
    row({ id: 'aristo', publisher: '雅集出版社', examination: 'Mock', year: '2020', plainText: '模擬題', questionTextChi: '模擬題' })
];

const aiPayload = {
    version: 1,
    updatedAt: '2026-10-28',
    byQuestion: {
        'has-ai': { explanations: [{ id: 'e1', detailLevel: 'short', model: 'test' }] }
    }
};

function documentStub() {
    return {
        getElementById: function () { return null; },
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        createElement: function () {
            return { style: {}, appendChild: function () {}, setAttribute: function () {}, classList: { add: function () {}, remove: function () {}, toggle: function () {} } };
        },
        addEventListener: function () {},
        removeEventListener: function () {},
        body: { classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } }, appendChild: function () {} }
    };
}

// Independent of tools/sfc-apply.js: same bundle shape as tests/filter-contract.test.js.
function loadBrowserApply() {
    const context = {
        console: { log: function () {}, info: function () {}, debug: function () {}, warn: function () {}, error: function () {} },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        document: documentStub()
    };
    context.window = context;
    context.global = context;
    context.globalThis = context;
    vm.createContext(context);
    function load(rel) {
        vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), context, { filename: rel });
    }
    load('js/globals.js');
    const bundle = ['js/constants.js', 'js/storage-core.js', 'js/filter-contract.js', 'js/storage-filters.js']
        .map(function (rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); })
        .join('\n;\n') + '\n;window.IndexedDBStorage = IndexedDBStorage;\n';
    vm.runInContext(bundle, context, { filename: 'filter-bundle.js' });
    load('js/question-fields.js');
    load('js/condition-match.js');
    load('js/ai-explanation.js');
    vm.runInContext('storage = new IndexedDBStorage();', context);
    context.authManager = null;
    return context;
}

function seedBrowser(browser, payload) {
    const store = browser.AiExplanation.store;
    store.byQuestion = payload.byQuestion;
    store.loaded = true;
    store.version = payload.version;
    store.updatedAt = payload.updatedAt;
}

function browserIds(browser, questions, contract, surface, omitKey, rights) {
    browser.accessRights = sfc.resolveAccessRights(rights || {});
    if (surface === 'stats') {
        return idsOf(browser.__SFC__.applyStatsFilterContract(questions, contract, omitKey || undefined));
    }
    return idsOf(browser.__SFC__.applyQuestionsFilterContract(questions, contract));
}

function runCli(args, input) {
    return spawnSync(process.execPath, [cliPath].concat(args), {
        cwd: root,
        input: input,
        encoding: 'utf8'
    });
}

const cliSource = fs.readFileSync(cliPath, 'utf8');
checkTrue('cli loads filter-contract.js', cliSource.indexOf('js/filter-contract.js') !== -1);
checkTrue('cli calls applyQuestionsFilterContract', cliSource.indexOf('applyQuestionsFilterContract') !== -1);
checkTrue('cli calls applyStatsFilterContract', cliSource.indexOf('applyStatsFilterContract') !== -1);
checkTrue('cli does not fork applyLegacyFilters', cliSource.indexOf('function applyLegacyFilters') === -1);
checkTrue('cli does not copy the apply body', cliSource.indexOf('Mock papers are omitted') === -1);
checkTrue('cli has no Copy JSON handover', cliSource.indexOf('Copy JSON') === -1 && cliSource.indexOf('Paste JSON') === -1);

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
checkTrue('page does not load the CLI', indexHtml.indexOf('sfc-apply') === -1);

const runtime = sfc.loadFilterRuntime();
const browser = loadBrowserApply();
sfc.seedAiExplanations(runtime, aiPayload);
seedBrowser(browser, aiPayload);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-apply-'));
const hkeaaPath = path.join(tmp, 'database-hkeaa.json');
const aristoPath = path.join(tmp, 'database-aristo.json');
writeJson(hkeaaPath, { schemaVersion: 1, questions: hkeaaQuestions });
writeJson(aristoPath, { questions: aristoQuestions });
const shardArgs = [hkeaaPath, aristoPath];
const files = sfc.loadShards(shardArgs);
const untagged = [];
files.forEach(function (file) {
    file.questions.forEach(function (question) { untagged.push(question); });
});

function worksetIds(contract, extra) {
    const workset = sfc.buildWorkset(Object.assign({
        runtime: runtime,
        contract: contract,
        files: files
    }, extra || {}));
    return { workset: workset, ids: idsOf(workset.questions) };
}

function parity(name, contract, extra, expected) {
    const surface = extra && extra.surface;
    const omitKey = extra && extra.omitKey;
    const rights = {
        accessRights: extra && extra.accessRights,
        mockTests: extra && extra.mockTests,
        admin: extra && extra.admin
    };
    const fromBrowser = browserIds(browser, untagged, contract, surface, omitKey, rights);
    const built = worksetIds(contract, extra);
    check(name + ' workset vs browser', built.ids, fromBrowser);
    if (expected) check(name + ' expected ids', built.ids, expected);
    return built;
}

const empty = runtime.__SFC__.emptyQuestionsContract();
const allIds = untagged.map(function (question) { return question.id; });
parity('empty contract keeps every shard row', empty, null, allIds);
checkTrue('empty contract keeps Out syl row', allIds.indexOf('out') !== -1);

const yearAndSyl = runtime.__SFC__.emptyQuestionsContract();
yearAndSyl.triState.year = { '2020': 'checked' };
yearAndSyl.triState.feature = { 'Out syl': 'excluded' };
parity('year 2020 and Out syl excluded', yearAndSyl, null, ['y2020', 'aristo']);

const concepts = runtime.__SFC__.emptyQuestionsContract();
concepts.triState.concepts = { '需求': 'checked' };
parity('concepts OR', concepts, null, ['y2020']);

const graphEmpty = runtime.__SFC__.emptyQuestionsContract();
graphEmpty.triState.graph = { '__empty__': 'checked' };
parity('graph sentinel is blank only', graphEmpty, null, ['graph-blank']);

const idSet = runtime.__SFC__.emptyQuestionsContract();
idSet.idSet = { active: true, ids: ['inflation', 'base'] };
parity('idSet preserves shard order', idSet, null, ['base', 'inflation']);

const emptyIdSet = runtime.__SFC__.emptyQuestionsContract();
emptyIdSet.idSet = { active: true, ids: [] };
parity('active empty idSet matches nothing', emptyIdSet, null, []);

const advanced = runtime.__SFC__.emptyQuestionsContract();
advanced.advanced = { active: true, conditions: [{ include: true, field: 'text', value: '通脹' }] };
parity('advanced text condition', advanced, null, ['inflation']);

const chapterAnd = runtime.__SFC__.emptyQuestionsContract();
chapterAnd.triState.chapter = { '01': 'checked', '02': 'checked' };
chapterAnd.filterLogic = { curriculum: 'OR', chapter: 'AND' };
parity('chapter AND', chapterAnd, null, ['y2020']);

const blankOnly = runtime.__SFC__.emptyQuestionsContract();
blankOnly.triState.adminBlank = { '題目空白': 'checked' };
parity('admin blank when admin is on', blankOnly, null, ['blank']);
parity('admin blank ignored when admin is off', blankOnly, { admin: false }, allIds);

parity('mock gate drops 雅集 and MT ids', empty, { mockTests: false }, allIds.filter(function (id) {
    return id !== 'aristo' && id !== 'MT12';
}));

const qnum = runtime.__SFC__.emptyQuestionsContract();
qnum.ranges.questionNumber = { active: true, min: 7, max: 7 };
parity('question number from id tail', qnum, null, ['DSE-2024-P1-07']);

const parts = runtime.__SFC__.emptyQuestionsContract();
parts.triState.feature = { '有分題': 'checked' };
parity('feature 有分題', parts, null, ['parts']);

const inline = runtime.__SFC__.emptyQuestionsContract();
inline.triState.feature = { '有內嵌圖': 'checked' };
parity('feature 有內嵌圖', inline, null, ['graph-bar']);

const aiChecked = runtime.__SFC__.emptyQuestionsContract();
aiChecked.triState.ai = { '有AI解釋': 'checked' };
parity('AI tri-state uses the side-file store', aiChecked, { aiExplanations: aiPayload }, ['has-ai']);

const statsName = runtime.__SFC__.emptyStatsContract();
statsName.search = '需求';
statsName.searchScope = 'name';
parity('stats name search does not filter stems', statsName, { surface: 'stats' }, allIds);

const statsContent = runtime.__SFC__.emptyStatsContract();
statsContent.search = '需求';
statsContent.searchScope = 'content';
parity('stats content search uses the question engine', statsContent, { surface: 'stats' }, ['y2020']);

const statsYear = runtime.__SFC__.emptyStatsContract();
statsYear.triState.year = { '2020': 'checked' };
parity('stats omitKey year stops that dimension filtering', statsYear, { surface: 'stats', omitKey: 'year' }, allIds);
parity('stats year without omitKey', statsYear, { surface: 'stats' }, ['y2020', 'aristo']);

const bundle = {
    version: 1,
    app: 'econ-database2',
    questions: yearAndSyl,
    stats: statsContent
};
parity('bundle defaults to the questions side', bundle, null, ['y2020', 'aristo']);
parity('bundle stats side', bundle, { surface: 'stats' }, ['y2020']);

const projected = worksetIds(inline, null);
const graphRow = projected.workset.questions[0];
check('workset field order', Object.keys(graphRow), sfc.WORKSET_QUESTION_KEYS);
check('inline diagram paths follow render.js rules', graphRow.inlineDiagramPaths, ['diagrams/bar.png']);
check('original question image kept', graphRow.originalQuestionImage, 'originals/q.png');
check('original answer image kept', graphRow.originalAnswerImageEng, 'originals/a-en.png');
check('current graph tag kept', graphRow.graphType, '棒形圖');
check('stem kept', graphRow.questionTextChi, '題幹');
checkTrue('answer text is not a workset field', Object.prototype.hasOwnProperty.call(graphRow, 'answerChi') === false);
checkTrue('markers report is not a workset field', Object.prototype.hasOwnProperty.call(graphRow, 'markersReportChi') === false);
check('workset count', projected.workset.count, 1);
check('workset input count', projected.workset.inputCount, allIds.length);
check('matched source counts', projected.workset.sources.map(function (source) { return source.matched; }), [1, 0]);

const mcRow = worksetIds(empty, null).workset.questions.filter(function (question) { return question.id === 'mc'; })[0];
check('MC partsStatus resolves to none', mcRow.partsStatus, 'none');
const partsRow = worksetIds(empty, null).workset.questions.filter(function (question) { return question.id === 'parts'; })[0];
check('parts projection', partsRow.questionParts, [{ label: 'a', marks: 2, performance: '良好' }]);
check('filled partsStatus', partsRow.partsStatus, 'filled');

check('directory sort', sfc.expandShardInputs([tmp]), [path.join(tmp, 'database-aristo.json'), path.join(tmp, 'database-hkeaa.json')]);

const contractPath = path.join(tmp, 'contract.json');
writeJson(contractPath, yearAndSyl);
const cli = runCli(['--contract', contractPath, '--shards', hkeaaPath, '--shards', aristoPath]);
check('cli exit 0', cli.status, 0);
check('cli stderr empty', cli.stderr, '');
const cliWorkset = JSON.parse(cli.stdout);
check('cli ids match browser', idsOf(cliWorkset.questions), ['y2020', 'aristo']);
check('cli kind', cliWorkset.kind, 'classification-workset');
check('cli surface', cliWorkset.surface, 'questions');
check('cli version', cliWorkset.version, 1);
check('cli access default mockTests', cliWorkset.accessRights.mockTests, true);
check('cli access default admin', cliWorkset.accessRights.admin, true);

const outPath = path.join(tmp, 'workset.json');
const cliOut = runCli(['--contract', contractPath, '--out', outPath, hkeaaPath, aristoPath]);
check('cli --out exit 0', cliOut.status, 0);
check('cli --out stdout empty', cliOut.stdout, '');
checkTrue('cli --out stderr names the file', cliOut.stderr.indexOf(outPath) !== -1);
check('cli --out file matches stdout mode', JSON.parse(fs.readFileSync(outPath, 'utf8')), cliWorkset);

const dir = path.join(tmp, 'shards');
fs.mkdirSync(dir);
writeJson(path.join(dir, 'b.json'), [{ id: 'from-b', publisher: 'HKEAA', year: '2024', questionTextChi: 'b', plainText: 'b' }]);
writeJson(path.join(dir, 'a.json'), { questions: [{ id: 'from-a', publisher: 'HKEAA', year: '2024', questionTextChi: 'a', plainText: 'a' }] });
const dirCli = runCli(['--contract', contractPath, '--shards', dir]);
check('directory contract still filters', idsOf(JSON.parse(dirCli.stdout).questions), []);
const dirEmpty = path.join(tmp, 'empty-contract.json');
writeJson(dirEmpty, runtime.__SFC__.emptyQuestionsContract());
const dirOrder = runCli(['--contract', dirEmpty, dir]);
check('directory filename order', idsOf(JSON.parse(dirOrder.stdout).questions), ['from-a', 'from-b']);

const stdinCli = runCli(['--surface', 'stats', '--shards', hkeaaPath, aristoPath], JSON.stringify(statsContent));
check('stdin stats exit', stdinCli.status, 0);
check('stdin stats ids', idsOf(JSON.parse(stdinCli.stdout).questions), ['y2020']);

const omitCli = runCli(['--surface', 'stats', '--omit-key', 'year', '--contract', contractPath, hkeaaPath, aristoPath]);
check('questions contract rejected as stats surface', omitCli.status, 1);
checkTrue('questions contract rejection names the surface', omitCli.stderr.indexOf('Expected stats filter contract') !== -1);
const omitContract = {
    version: 1,
    surface: 'stats',
    triState: { year: { '2020': 'checked' } }
};
writeJson(path.join(tmp, 'stats-year.json'), omitContract);
const omitCli2 = runCli(['--surface', 'stats', '--omit-key', 'year', '--contract', path.join(tmp, 'stats-year.json'), hkeaaPath, aristoPath]);
check('omit-key cli ids', idsOf(JSON.parse(omitCli2.stdout).questions), allIds);
check('omit-key recorded', JSON.parse(omitCli2.stdout).omitKey, 'year');

const locked = runCli([
    '--contract', dirEmpty,
    '--no-mock-tests',
    '--no-admin',
    '--access-rights', JSON.stringify({ mockTests: true, admin: true, ai: false }),
    hkeaaPath,
    aristoPath
]);
const lockedIds = idsOf(JSON.parse(locked.stdout).questions);
check('flags override access-rights json', lockedIds.indexOf('aristo') === -1 && lockedIds.indexOf('MT12') === -1, true);
checkTrue('flags keep an HKEAA row', lockedIds.indexOf('base') !== -1);

const aiFile = path.join(tmp, 'ai.json');
writeJson(aiFile, aiPayload);
const aiContract = path.join(tmp, 'ai-contract.json');
writeJson(aiContract, aiChecked);
const aiCli = runCli(['--contract', aiContract, '--ai-explanations', aiFile, hkeaaPath, aristoPath]);
check('cli AI ids', idsOf(JSON.parse(aiCli.stdout).questions), ['has-ai']);

writeJson(path.join(tmp, 'v2.json'), { version: 2, surface: 'questions' });
const v2 = runCli(['--contract', path.join(tmp, 'v2.json'), hkeaaPath]);
check('unsupported version exits 1', v2.status, 1);
checkTrue('unsupported version message', v2.stderr.indexOf('Unsupported filter contract version') !== -1);

const notShard = path.join(tmp, 'notes.json');
writeJson(notShard, { ok: true });
const badShard = runCli(['--contract', dirEmpty, notShard]);
check('non-shard exits 1', badShard.status, 1);
checkTrue('non-shard message', badShard.stderr.indexOf('不是題目分片') !== -1);

const noShards = runCli(['--contract', dirEmpty]);
check('missing shards exits 1', noShards.status, 1);

const omitOnQuestions = runCli(['--omit-key', 'year', '--contract', dirEmpty, hkeaaPath]);
check('omit-key on questions exits 1', omitOnQuestions.status, 1);

const help = runCli(['--help']);
check('help exit 0', help.status, 0);
checkTrue('help names the apply function', help.stdout.indexOf('applyQuestionsFilterContract') !== -1);
checkTrue('help does not add Copy JSON', help.stdout.indexOf('Copy JSON') === -1);

fs.rmSync(tmp, { recursive: true, force: true });

if (failed) {
    console.error('Shared Filter Contract CLI tests');
    failures.forEach(function (failure) { console.error(failure); });
    console.error('passed: ' + passed);
    console.error('failed: ' + failed);
    process.exit(1);
}

console.log('Shared Filter Contract CLI tests');
console.log('passed: ' + passed);
console.log('failed: 0');
