// tabs.js
// Tab content renderers for the statistics views.
//
// REFACTORED: The old metadata-based renderers (with the "添加備註"
// textareas) have been removed. Those comments were stored only in the
// local IndexedDB, which is wiped and rebuilt from the JSON file on every
// load — so they were never actually persisted. The tab functions
// now simply delegate to the read-only stat renderers in statistics.js.
//
// Function names are kept identical (renderPublishers, renderTopics, ...)
// so switchTab() in main.js requires no changes.
//
// Dependencies: statistics.js (renderPublisherStats, renderTopicStats,
//               renderChapterStats, renderConceptStats, renderPatternStats,
//               renderStemPatternStats)

async function renderPublishers() {
    if (typeof renderPublisherStats === 'function') await renderPublisherStats();
}

async function renderTopics() {
    if (typeof renderTopicStats === 'function') await renderTopicStats();
}

async function renderChapters() {
    if (typeof renderChapterStats === 'function') await renderChapterStats();
}

async function renderConcepts() {
    if (typeof renderConceptStats === 'function') await renderConceptStats();
}

async function renderPatterns() {
    if (typeof renderPatternStats === 'function') await renderPatternStats();
}

async function renderStemPatterns() {
    if (typeof renderStemPatternStats === 'function') await renderStemPatternStats();
}