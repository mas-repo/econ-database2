// Dependencies: storage-core.js (IndexedDBStorage), filter-contract.js
// (applyLegacyFilters, EMPTY_FIELD_SENTINEL, normalizeYearFilterKey).
//
// Bank-row filtering goes through the Shared Filter Contract. This file
// keeps mock-paper permission on IndexedDBStorage and a thin applyFilters
// wrapper so getQuestions / 題目 / 統計 keep the same call shape.
// Omitted idSetFilter / advancedFilter still inherit window.* inside
// applyLegacyFilters. Callers that pass those keys (statsStateToFilters)
// stay self-contained.

// Helper to extract unique values from a dataset for a specific field
IndexedDBStorage.prototype.getUniqueValues = function(questions, field) {
    const values = new Set();
    questions.forEach(q => {
        if (q[field] && q[field] !== '-' && q[field] !== '') {
            values.add(q[field]);
        }
    });
    return Array.from(values).sort();
};

// Add filter logic to IndexedDBStorage
IndexedDBStorage.prototype.isMockQuestion = function(q) {
    const id = String(q && q.id ? q.id : '');
    if (/^MT?\d/i.test(id)) return true;
    const publisher = String(q && q.publisher ? q.publisher : '');
    return publisher !== '' && publisher !== 'HKEAA' && publisher !== '-';
};

IndexedDBStorage.prototype.applyPermissionFilter = function(questions) {
    // Prefer window.accessRights.mockTests (same source as mock UI chrome) so a
    // mid-render isAuthenticated()/signed-in check cannot desync the list count.
    if (window.accessRights) {
        if (window.accessRights.mockTests === true) return questions;
        return questions.filter(q => !this.isMockQuestion(q));
    }
    if (!window.authManager || window.authManager.canViewMockTests()) {
        return questions;
    }
    return questions.filter(q => !this.isMockQuestion(q));
};

// Legacy filters object → Shared Filter Contract apply.
IndexedDBStorage.prototype.applyFilters = function(questions, filters) {
    return applyLegacyFilters(questions, filters || {}, this.applyPermissionFilter.bind(this));
};
