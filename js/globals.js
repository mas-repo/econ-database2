// Global variables - must be initialized first
var storage = null;
var currentTab = 'questions';
var editingId = null;
var searchScope = 'all';

var triStateFilters = {
    curriculum: {},
    feature: { 'Out syl': 'excluded' },
    chapter: {},
    publisher: {},
    exam: {},
    qtype: {},
    section: {},
    concepts: {},
    patterns: {},
    stemPatterns: {},
    ai: {},
    multipleSelection: {},
    graph: {},
    table: {},
    calculation: {}
};
var filterLogic = {
    chapter: 'OR',
    curriculum: 'OR'
};
var paginationState = {
    questions: { page: 1, itemsPerPage: 20 }
};