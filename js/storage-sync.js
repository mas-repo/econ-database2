// Dependencies: storage-core.js, auth.js
// Loads the question bank from a JSON document (bundled file or a file the user supplies).
// Replaces the previous Google Sheets / Apps Script sync.

class QuestionJsonSource {
    constructor(jsonUrl) {
        this.jsonUrl = jsonUrl;
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
                default:
                    question[fieldName] = typeof value === 'string' ? value.trim() : value;
            }
        });

        ['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns', 'stemPatterns'].forEach(field => {
            if (!question[field]) question[field] = [];
        });

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
        // index.html starts this fetch as soon as the page loads.
        if (window.databaseReady) {
            const pending = window.databaseReady;
            window.databaseReady = null;
            return pending;
        }
        const response = await fetch(this.jsonUrl, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: 無法讀取 JSON 資料`);
        }
        return response.json();
    }

    async syncOnLoad() {
        try {
            console.log('🔄 開始從 JSON 載入題目...');
            const payload = await this.fetchPayload();
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

    async importPayload(payload) {
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
