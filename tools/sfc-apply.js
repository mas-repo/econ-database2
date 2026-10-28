#!/usr/bin/env node
'use strict';

// Headless Shared Filter Contract apply.
//
// Loads the same browser scripts the page uses and calls
// applyQuestionsFilterContract / applyStatsFilterContract. There is no
// second filter engine. This file does not write shards and does not
// submit classification proposals.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Same order as index.html for the apply stack (UI scripts omitted).
const APPLY_SCRIPTS = [
    'js/constants.js',
    'js/storage-core.js',
    'js/filter-contract.js',
    'js/storage-filters.js',
    'js/question-fields.js',
    'js/condition-match.js',
    'js/ai-explanation.js'
];

const WORKSET_VERSION = 1;
const WORKSET_KIND = 'classification-workset';

// Caller already has the shard files. The page's emptyAccessRights() stays
// closed until the proxy replies; that default would hide 雅集 rows the
// operator just passed on the command line. Lock it down with
// --no-mock-tests / --no-admin when reproducing a logged-out browser.
const DEFAULT_ACCESS_RIGHTS = Object.freeze({
    admin: true,
    ai: true,
    githubSync: false,
    mockTests: true
});

// Projection keys, in output order. Filtering still sees the full row.
const WORKSET_QUESTION_KEYS = [
    'id',
    'shard',
    'publisher',
    'examination',
    'year',
    'paper',
    'section',
    'questionNumber',
    'questionType',
    'topic',
    'questionTextChi',
    'questionTextEng',
    'plainText',
    'concepts',
    'stemPatterns',
    'patterns',
    'graphType',
    'tableType',
    'calculationType',
    'multipleSelectionType',
    'curriculumClassification',
    'AristochapterClassification',
    'questionParts',
    'partsStatus',
    'outSyl',
    'inlineDiagrams',
    'inlineDiagramPaths',
    'originalQuestionImage',
    'originalQuestionImageEng',
    'originalAnswerImage',
    'originalAnswerImageEng'
];

function createDocumentStub() {
    return {
        getElementById: function () { return null; },
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        createElement: function () {
            return {
                style: {},
                appendChild: function () {},
                setAttribute: function () {},
                classList: { add: function () {}, remove: function () {}, toggle: function () {} }
            };
        },
        addEventListener: function () {},
        removeEventListener: function () {},
        body: {
            classList: {
                add: function () {},
                remove: function () {},
                toggle: function () {},
                contains: function () { return false; }
            },
            appendChild: function () {}
        }
    };
}

function loadScript(context, rel) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    try {
        vm.runInContext(code, context, { filename: rel });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw new Error('無法載入 ' + rel + '：' + message);
    }
}

function loadFilterRuntime() {
    const context = {
        console: {
            log: function () {},
            info: function () {},
            debug: function () {},
            warn: function () {
                process.stderr.write(Array.from(arguments).join(' ') + '\n');
            },
            error: function () {
                process.stderr.write(Array.from(arguments).join(' ') + '\n');
            }
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        document: createDocumentStub()
    };
    context.window = context;
    context.global = context;
    context.globalThis = context;
    vm.createContext(context);
    APPLY_SCRIPTS.forEach(function (rel) { loadScript(context, rel); });
    vm.runInContext('storage = new IndexedDBStorage();', context);
    if (!context.__SFC__ || typeof context.__SFC__.applyQuestionsFilterContract !== 'function') {
        throw new Error('filter-contract.js 沒有掛上 __SFC__.applyQuestionsFilterContract');
    }
    if (typeof context.questionFeatureOn !== 'function') {
        throw new Error('question-fields.js 沒有掛上 questionFeatureOn');
    }
    if (!context.ConditionMatch || typeof context.ConditionMatch.matchesAllConditions !== 'function') {
        throw new Error('condition-match.js 沒有掛上 ConditionMatch');
    }
    context.accessRights = copyAccessRights(DEFAULT_ACCESS_RIGHTS);
    context.authManager = null;
    return context;
}

function copyAccessRights(raw) {
    const source = raw || {};
    return {
        admin: source.admin === true,
        ai: source.ai === true,
        githubSync: source.githubSync === true,
        mockTests: source.mockTests === true
    };
}

function resolveAccessRights(options) {
    const base = copyAccessRights(DEFAULT_ACCESS_RIGHTS);
    const override = options && options.accessRights;
    if (override && typeof override === 'object') {
        ['admin', 'ai', 'githubSync', 'mockTests'].forEach(function (key) {
            if (override[key] != null) base[key] = override[key] === true;
        });
    }
    if (options && options.mockTests != null) base.mockTests = !!options.mockTests;
    if (options && options.admin != null) base.admin = !!options.admin;
    return base;
}

function parseContractText(text, label) {
    const name = label || '篩選合約';
    const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
    if (!raw) throw new Error(name + '是空的');
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        throw new Error(name + '不是合法 JSON');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(name + '不是物件');
    }
    return data;
}

function readJsonFile(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        throw new Error('無法讀取 ' + filePath + '：' + (err && err.code ? err.code : err.message));
    }
    return parseContractText(text, filePath);
}

function questionsFromShardPayload(payload, filePath) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && Array.isArray(payload.questions)) {
        return payload.questions;
    }
    throw new Error(filePath + ' 不是題目分片（需要 questions 陣列，或頂層就是陣列）');
}

function expandShardInputs(inputs) {
    if (!inputs || !inputs.length) {
        throw new Error('請提供至少一個分片檔或目錄');
    }
    const files = [];
    inputs.forEach(function (input) {
        if (!input) throw new Error('分片路徑是空的');
        if (!fs.existsSync(input)) throw new Error('找不到分片：' + input);
        const stat = fs.statSync(input);
        if (stat.isDirectory()) {
            const found = fs.readdirSync(input)
                .filter(function (name) { return name.endsWith('.json') && name.charAt(0) !== '.'; })
                .sort(function (a, b) { return a.localeCompare(b, 'en'); })
                .map(function (name) { return path.join(input, name); });
            if (!found.length) throw new Error('目錄沒有 .json 分片：' + input);
            found.forEach(function (file) { files.push(file); });
        } else if (stat.isFile()) {
            files.push(input);
        } else {
            throw new Error('不是檔案或目錄：' + input);
        }
    });
    return files;
}

function loadShardFile(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        throw new Error('無法讀取 ' + filePath + '：' + (err && err.code ? err.code : err.message));
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let payload;
    try {
        payload = JSON.parse(text);
    } catch (err) {
        throw new Error(filePath + ' 不是合法 JSON');
    }
    return {
        path: filePath,
        questions: questionsFromShardPayload(payload, filePath)
    };
}

function loadShards(inputs) {
    return expandShardInputs(inputs).map(loadShardFile);
}

function tagQuestions(files) {
    const tagged = [];
    files.forEach(function (file, index) {
        file.questions.forEach(function (question) {
            if (question && typeof question === 'object') {
                tagged.push(Object.assign({}, question, { __sfcShard: index }));
            } else {
                tagged.push(question);
            }
        });
    });
    return tagged;
}

function resolveSurface(contract, requested) {
    if (requested != null && requested !== '' && requested !== 'questions' && requested !== 'stats') {
        throw new Error('surface 必須是 questions 或 stats');
    }
    if (requested === 'stats' || requested === 'questions') {
        return requested;
    }
    if (contract && contract.surface === 'stats') return 'stats';
    if (contract && contract.surface === 'questions') return 'questions';
    if (contract && contract.stats && !contract.questions && !contract.triState && !contract.surface) {
        return 'stats';
    }
    return 'questions';
}

function seedAiExplanations(runtime, payloadOrPath) {
    if (!runtime.AiExplanation || !runtime.AiExplanation.store) {
        throw new Error('AI解釋索引尚未載入');
    }
    const payload = typeof payloadOrPath === 'string' ? readJsonFile(payloadOrPath) : payloadOrPath;
    const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const byQuestion = data.byQuestion;
    const store = runtime.AiExplanation.store;
    store.version = typeof data.version === 'number' ? data.version : 1;
    store.updatedAt = String(data.updatedAt || '');
    store.byQuestion = (byQuestion && typeof byQuestion === 'object' && !Array.isArray(byQuestion))
        ? byQuestion
        : {};
    store.loaded = true;
    store.loadError = '';
}

function storedText(value) {
    return value == null ? '' : value;
}

function copyList(value) {
    if (!Array.isArray(value)) return [];
    return value.slice();
}

// Same path rules as diagramSrcs() in js/render.js (comma-separated,
// drop empty, "..", and scheme URLs). Original-image fields stay separate.
function inlineDiagramPaths(question) {
    return String(question && question.inlineDiagrams || '')
        .split(',')
        .map(function (part) { return part.trim(); })
        .filter(function (part) {
            return part && part.indexOf('..') === -1 && !/^[a-z]+:/i.test(part);
        });
}

function projectQuestion(runtime, question, shardPath) {
    const normalizeParts = runtime.normalizeQuestionParts;
    const resolveParts = runtime.resolvePartsStatus;
    const parts = typeof normalizeParts === 'function'
        ? normalizeParts(question && question.questionParts)
        : copyList(question && question.questionParts);
    const partsStatus = typeof resolveParts === 'function'
        ? resolveParts(question)
        : (question && question.partsStatus != null ? String(question.partsStatus) : '');
    return {
        id: question && question.id != null ? String(question.id) : '',
        shard: shardPath || '',
        publisher: storedText(question && question.publisher),
        examination: storedText(question && question.examination),
        year: storedText(question && question.year),
        paper: storedText(question && question.paper),
        section: storedText(question && question.section),
        questionNumber: storedText(question && question.questionNumber),
        questionType: storedText(question && question.questionType),
        topic: storedText(question && question.topic),
        questionTextChi: storedText(question && question.questionTextChi),
        questionTextEng: storedText(question && question.questionTextEng),
        plainText: storedText(question && question.plainText),
        concepts: copyList(question && question.concepts),
        stemPatterns: copyList(question && question.stemPatterns),
        patterns: copyList(question && question.patterns),
        graphType: storedText(question && question.graphType),
        tableType: storedText(question && question.tableType),
        calculationType: storedText(question && question.calculationType),
        multipleSelectionType: storedText(question && question.multipleSelectionType),
        curriculumClassification: copyList(question && question.curriculumClassification),
        AristochapterClassification: copyList(question && question.AristochapterClassification),
        questionParts: parts.map(function (part) {
            return {
                label: part && part.label != null ? String(part.label) : '',
                marks: part && part.marks != null ? part.marks : null,
                performance: part && part.performance != null ? String(part.performance) : ''
            };
        }),
        partsStatus: partsStatus,
        outSyl: storedText(question && question.outSyl),
        inlineDiagrams: storedText(question && question.inlineDiagrams),
        inlineDiagramPaths: inlineDiagramPaths(question),
        originalQuestionImage: storedText(question && question.originalQuestionImage),
        originalQuestionImageEng: storedText(question && question.originalQuestionImageEng),
        originalAnswerImage: storedText(question && question.originalAnswerImage),
        originalAnswerImageEng: storedText(question && question.originalAnswerImageEng)
    };
}

function applyContract(runtime, questions, contract, surface, omitKey) {
    if (surface === 'stats') {
        if (omitKey) return runtime.__SFC__.applyStatsFilterContract(questions, contract, omitKey);
        return runtime.__SFC__.applyStatsFilterContract(questions, contract);
    }
    if (omitKey) throw new Error('--omit-key 只用於統計面（--surface stats）');
    return runtime.__SFC__.applyQuestionsFilterContract(questions, contract);
}

function buildWorkset(options) {
    const settings = options || {};
    const runtime = settings.runtime || loadFilterRuntime();
    const contract = settings.contract;
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        throw new Error('篩選合約不是物件');
    }
    const surface = resolveSurface(contract, settings.surface);
    const rights = resolveAccessRights(settings);
    runtime.accessRights = rights;
    if (settings.aiExplanations != null) seedAiExplanations(runtime, settings.aiExplanations);

    const files = settings.files || loadShards(settings.shards || []);
    const tagged = tagQuestions(files);
    const omitKey = settings.omitKey ? String(settings.omitKey) : '';
    const filtered = applyContract(runtime, tagged, contract, surface, omitKey);
    const matched = files.map(function () { return 0; });
    const questions = filtered.map(function (question) {
        const index = question && typeof question.__sfcShard === 'number' ? question.__sfcShard : -1;
        if (index >= 0 && index < matched.length) matched[index] += 1;
        const shardPath = index >= 0 && files[index] ? files[index].path : '';
        return projectQuestion(runtime, question, shardPath);
    });
    let inputCount = 0;
    const sources = files.map(function (file, index) {
        inputCount += file.questions.length;
        return {
            path: file.path,
            count: file.questions.length,
            matched: matched[index]
        };
    });
    return {
        version: WORKSET_VERSION,
        app: 'econ-database2',
        kind: WORKSET_KIND,
        surface: surface,
        filterContractVersion: runtime.__SFC__.version,
        omitKey: omitKey || null,
        accessRights: rights,
        inputCount: inputCount,
        count: questions.length,
        sources: sources,
        questions: questions
    };
}

function helpText() {
    return [
        '用法：node tools/sfc-apply.js --contract <file|-> [--surface questions|stats] [--omit-key <triKey>] [--out <file>] [--access-rights <json>] [--no-mock-tests] [--no-admin] [--ai-explanations <file>] <shard-or-dir>...',
        '',
        '用與瀏覽器相同的 applyQuestionsFilterContract／applyStatsFilterContract',
        '過濾題目分片，印出分類 workset（id、題幹、現有標籤、圖表／表格路徑）。',
        '不寫分片，也不送 submitClassificationProposal。',
        '',
        '  --contract <file>     篩選合約 JSON。- 或省略則讀 stdin',
        '  --surface <name>      questions（預設）或 stats。bundle 會取該一面',
        '  --omit-key <triKey>   只給統計面：套用前清掉這一維（與 applyStatsFilterContract 相同）',
        '  --out <file>          寫入檔案，不印到 stdout',
        '  --access-rights <json>  覆寫權限物件（admin／ai／githubSync／mockTests）',
        '  --mock-tests / --no-mock-tests',
        '  --admin / --no-admin  布林旗標覆寫 --access-rights',
        '  --ai-explanations <file>  AI解釋 side-file（byQuestion），供 triState.ai',
        '  --shards <path>       分片檔或目錄，可重複。其餘位置參數也是分片',
        '',
        '目錄只讀該層 *.json（檔名排序，不遞迴）。每個檔必須是 { questions: [] } 或頂層陣列。',
        '預設權限是 mockTests 與 admin 都開，因為分片已在本機。',
        '對齊未授權頁面：--no-mock-tests --no-admin。',
        '',
        '例子：',
        '  node tools/sfc-apply.js --contract contract.json --shards database-hkeaa.json database-aristo.json',
        '  node tools/sfc-apply.js --contract contract.json --shards ./shards --out workset.json',
        '  node tools/sfc-apply.js --surface stats --omit-key year --shards shard.json < contract.json'
    ].join('\n');
}

function parseArgs(argv) {
    const opts = {
        contractPath: null,
        contractSet: false,
        surface: null,
        omitKey: null,
        outPath: null,
        accessRightsJson: null,
        mockTests: null,
        admin: null,
        aiExplanations: null,
        shards: [],
        help: false
    };
    const args = argv.slice(2);
    function needValue(flag) {
        if (index + 1 >= args.length) throw new Error('缺少參數值：' + flag);
        index += 1;
        return args[index];
    }
    let index = 0;
    for (; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') opts.help = true;
        else if (arg === '--contract') {
            opts.contractPath = needValue(arg);
            opts.contractSet = true;
        } else if (arg === '--surface') opts.surface = needValue(arg);
        else if (arg === '--omit-key') opts.omitKey = needValue(arg);
        else if (arg === '--out') opts.outPath = needValue(arg);
        else if (arg === '--access-rights') opts.accessRightsJson = needValue(arg);
        else if (arg === '--ai-explanations') opts.aiExplanations = needValue(arg);
        else if (arg === '--shards') opts.shards.push(needValue(arg));
        else if (arg === '--mock-tests') opts.mockTests = true;
        else if (arg === '--no-mock-tests') opts.mockTests = false;
        else if (arg === '--admin') opts.admin = true;
        else if (arg === '--no-admin') opts.admin = false;
        else if (arg === '--') {
            opts.shards.push.apply(opts.shards, args.slice(index + 1));
            break;
        } else if (arg.indexOf('--') === 0) throw new Error('不認識的參數：' + arg);
        else opts.shards.push(arg);
    }
    return opts;
}

function accessRightsFromJson(text) {
    const data = parseContractText(text, '--access-rights');
    return data;
}

async function readStdin() {
    const chunks = [];
    process.stdin.on('data', function (chunk) { chunks.push(chunk); });
    return new Promise(function (resolve, reject) {
        process.stdin.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        process.stdin.on('error', reject);
    });
}

async function main(argv) {
    const opts = parseArgs(argv || process.argv);
    if (opts.help) {
        process.stdout.write(helpText() + '\n');
        return 0;
    }
    let contractText;
    if (!opts.contractSet || opts.contractPath === '-') {
        if (process.stdin.isTTY) throw new Error('請用 --contract 指定篩選合約，或從 stdin 傳入');
        contractText = await readStdin();
    } else {
        contractText = fs.readFileSync(opts.contractPath, 'utf8');
    }
    const contract = parseContractText(contractText, opts.contractPath && opts.contractPath !== '-' ? opts.contractPath : '篩選合約');
    const workset = buildWorkset({
        contract: contract,
        shards: opts.shards,
        surface: opts.surface,
        omitKey: opts.omitKey,
        accessRights: opts.accessRightsJson ? accessRightsFromJson(opts.accessRightsJson) : null,
        mockTests: opts.mockTests,
        admin: opts.admin,
        aiExplanations: opts.aiExplanations
    });
    const json = JSON.stringify(workset, null, 2) + '\n';
    if (opts.outPath) {
        fs.writeFileSync(opts.outPath, json);
        process.stderr.write(
            'classification workset: ' + workset.count + '/' + workset.inputCount
            + ' (' + workset.surface + ') → ' + opts.outPath + '\n'
        );
    } else {
        process.stdout.write(json);
    }
    return 0;
}

module.exports = {
    APPLY_SCRIPTS: APPLY_SCRIPTS,
    DEFAULT_ACCESS_RIGHTS: DEFAULT_ACCESS_RIGHTS,
    WORKSET_QUESTION_KEYS: WORKSET_QUESTION_KEYS,
    WORKSET_VERSION: WORKSET_VERSION,
    loadFilterRuntime: loadFilterRuntime,
    resolveAccessRights: resolveAccessRights,
    resolveSurface: resolveSurface,
    expandShardInputs: expandShardInputs,
    loadShards: loadShards,
    questionsFromShardPayload: questionsFromShardPayload,
    inlineDiagramPaths: inlineDiagramPaths,
    projectQuestion: projectQuestion,
    seedAiExplanations: seedAiExplanations,
    buildWorkset: buildWorkset,
    parseArgs: parseArgs,
    helpText: helpText,
    main: main
};

if (require.main === module) {
    main(process.argv).then(function (code) {
        process.exit(code || 0);
    }).catch(function (err) {
        process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
        process.exit(1);
    });
}
