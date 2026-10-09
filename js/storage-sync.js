// Dependencies: storage-core.js, auth.js, shared-assets.js (fetchSharedQuestionBank)
// Loads the question bank from the private repository through Apps Script.
// A user can still import a JSON file they choose. This site does not ship a bank.

class QuestionJsonSource {
    constructor() {
        this.lastSyncTime = null;
        this.availableFields = new Set();
    }

    isValidValue(value) {
        if (value === null || value === undefined) return false;
        const trimmed = String(value).trim();
        return trimmed !== '' && trimmed !== '-';
    }

    normalizeQuestion(raw) {
        const question = {
            dateAdded: raw.dateAdded || new Date().toISOString(),
            dateModified: raw.dateModified || new Date().toISOString()
        };

        Object.keys(raw).forEach((fieldName) => {
            let value = raw[fieldName];
            if (value === null || value === undefined || value === '') {
                if (['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns', 'stemPatterns'].includes(fieldName)) {
                    question[fieldName] = [];
                }
                return;
            }

            switch (fieldName) {
                case 'marks':
                case 'correctPercentage': {
                    const num = parseFloat(String(value).trim());
                    if (!isNaN(num)) question[fieldName] = num;
                    break;
                }
                case 'curriculumClassification':
                case 'AristochapterClassification':
                case 'concepts':
                case 'patterns':
                case 'stemPatterns':
                    if (Array.isArray(value)) {
                        question[fieldName] = value.map(s => String(s).trim()).filter(Boolean);
                    } else {
                        question[fieldName] = String(value).split(',').map(s => s.trim()).filter(Boolean);
                    }
                    break;
                case 'multipleSelectionType':
                case 'graphType':
                case 'tableType':
                case 'calculationType':
                    question[fieldName] = String(value).trim() || '-';
                    break;
                case 'year':
                    question[fieldName] = (typeof normalizeYear === 'function')
                        ? normalizeYear(value)
                        : String(value).trim();
                    break;
                default:
                    question[fieldName] = typeof value === 'string' ? value.trim() : value;
            }
        });

        if (question.year != null && question.year !== '' && typeof normalizeYear === 'function') {
            question.year = normalizeYear(question.year);
        }

        ['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns', 'stemPatterns'].forEach(field => {
            if (!question[field]) question[field] = [];
        });

        if (Object.prototype.hasOwnProperty.call(raw, 'questionParts') || Array.isArray(question.questionParts)) {
            question.questionParts = (typeof normalizeQuestionParts === 'function')
                ? normalizeQuestionParts(question.questionParts || raw.questionParts)
                : (Array.isArray(question.questionParts) ? question.questionParts : []);
        }

        // plainText is the question wording column. Keep questionTextChi in sync
        // so existing search and card rendering still show the text.
        if (!question.plainText && question.questionTextChi) {
            question.plainText = question.questionTextChi;
        }
        if (!question.questionTextChi && question.plainText) {
            question.questionTextChi = question.plainText;
        }
        if (!question.topic) {
            const concepts = question.concepts || [];
            question.topic = concepts.length ? concepts.join('；') : '未分類';
        }

        return question;
    }

    questionsFromPayload(payload) {
        const list = Array.isArray(payload) ? payload : payload.questions;
        if (!Array.isArray(list)) {
            throw new Error('無效的 JSON：需要 questions 陣列');
        }

        const questions = [];
        list.forEach((raw) => {
            if (!raw || typeof raw !== 'object') return;
            const question = this.normalizeQuestion(raw);
            Object.keys(question).forEach(key => this.availableFields.add(key));
            if (this.isValidValue(question.examination) && this.isValidValue(question.id)) {
                questions.push(question);
            }
        });
        window.availableFields = this.availableFields;
        return questions;
    }

    async fetchPayload() {
        // The question bank comes only from the private repository through
        // Apps Script. A failed proxy call leaves the page without questions.
        if (window.databaseReady) {
            const pending = window.databaseReady;
            window.databaseReady = null;
            return pending;
        }
        if (typeof fetchSharedQuestionBank !== 'function') {
            throw new Error('無法讀取題庫');
        }
        return fetchSharedQuestionBank();
    }

    async syncOnLoad() {
        try {
            console.log('🔄 開始從 JSON 載入題目...');
            const payload = await this.fetchPayload();
            if (typeof guardIncomingBankPayload === 'function') {
                guardIncomingBankPayload(payload);
            }
            const questions = this.questionsFromPayload(payload);

            if (questions.length === 0) {
                console.log('⚠️  沒有找到有效的題目資料');
                return { success: false, count: 0 };
            }

            await window.storage.clear();
            await window.storage.addQuestions(questions);

            this.lastSyncTime = new Date();
            localStorage.setItem('lastSyncTime', this.lastSyncTime.toISOString());
            console.log(`✅ 同步完成！成功匯入 ${questions.length} 題`);

            return {
                success: true,
                count: questions.length,
                lastSyncTime: this.lastSyncTime
            };
        } catch (error) {
            console.error('❌ JSON 載入失敗:', error);
            throw error;
        }
    }

    async importPayload(payload, options) {
        options = options || {};
        if (!options.skipSchemaGuard && typeof guardIncomingBankPayload === 'function') {
            guardIncomingBankPayload(payload, options);
        }
        const questions = this.questionsFromPayload(payload);
        if (questions.length === 0) {
            throw new Error('JSON 內沒有有效題目（每題需要 id 與 examination）');
        }
        await window.storage.clear();
        await window.storage.addQuestions(questions);
        this.lastSyncTime = new Date();
        return questions.length;
    }
}

window.questionJsonSource = null;
