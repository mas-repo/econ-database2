// storage-core.js
// IndexedDB wrapper (window.storage). Questions only — IndexedDB is a
// disposable cache rebuilt from data/database.json on every load.
//
// v4: Removed the legacy metadata object stores (publishers / topics /
// concepts / patterns) and their accessor methods (updateMetadata,
// getMetadata, getAllMetadata). They existed only for the removed
// 「添加備註」feature. The version bump triggers onupgradeneeded, which
// deletes the stale stores from existing users' databases.
//
// Dependencies: None (core storage layer).
// Note: applyFilters() and getUniqueValues() are attached to this class
// by storage-filters.js.

class IndexedDBStorage {
    constructor() {
        this.dbName = 'EconQuestionsDB';
        this.version = 4; // v4: legacy metadata stores removed
        this.db = null;
        this.availableFields = new Set(); // populated by sync layer
        this.storeName = 'questions';
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('questions')) {
                    const questionStore = db.createObjectStore('questions', {
                        keyPath: 'id',
                        autoIncrement: true
                    });
                    questionStore.createIndex('exam', 'exam', { unique: false });
                    questionStore.createIndex('year', 'year', { unique: false });
                    questionStore.createIndex('qtype', 'qtype', { unique: false });
                }

                // Clean up legacy stores from version <= 3
                ['publishers', 'topics', 'concepts', 'patterns'].forEach(name => {
                    if (db.objectStoreNames.contains(name)) {
                        db.deleteObjectStore(name);
                    }
                });
            };
        });
    }

    async addQuestion(question) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.add(question);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Batch insert — significantly faster than adding one by one
    async addQuestions(questions) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            questions.forEach(q => {
                store.put(q);
            });

            transaction.oncomplete = () => resolve(questions.length);
            transaction.onerror = (e) => reject(transaction.error || e.target.error);
        });
    }

    async updateQuestion(question) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(question);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Unfiltered bank. Git sync must not drop rows the current user cannot
    // see in the UI, or an upload would erase them from the private copy.
    async getAllQuestions() {
        if (!this.db) return [];
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getQuestions(filters = {}) {
        // Clicks during startup can reach here after `storage` exists and
        // before IndexedDB open finishes. An empty list is safer than throwing.
        if (!this.db) return [];
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                let questions = request.result;
                // applyFilters is attached by storage-filters.js
                if (typeof this.applyFilters === 'function') {
                    questions = this.applyFilters(questions, filters);
                }
                resolve(questions);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteQuestion(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            transaction.objectStore(this.storeName).clear();

            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(transaction.error || e.target.error);
        });
    }
}