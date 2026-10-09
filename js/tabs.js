// tabs.js
// Tab content renderers for the statistics views.
//
// Unified 「統計」tab: renderStats() refreshes the active dimension / mode.
// Legacy names (renderConcepts, …) remain for switchTab aliases.
//
// Dependencies: statistics.js, stats-explore.js, stats-filters.js

async function renderStats() {
    if (typeof initStatsExplore === 'function') initStatsExplore();
    if (window.statsViewMode === 'crosstab' && typeof renderStatsCrosstab === 'function') {
        await renderStatsCrosstab();
        return;
    }
    const dim = (typeof getStatsActiveDimension === 'function')
        ? getStatsActiveDimension()
        : 'concepts';
    if (typeof renderGroupedStats === 'function') await renderGroupedStats(dim);
}

async function renderPublishers() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('publishers');
    await renderStats();
}

async function renderTopics() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('topics');
    await renderStats();
}

async function renderChapters() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('chapters');
    await renderStats();
}

async function renderConcepts() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('concepts');
    await renderStats();
}

async function renderPatterns() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('patterns');
    await renderStats();
}

async function renderStemPatterns() {
    if (typeof setStatsActiveDimension === 'function') setStatsActiveDimension('stemPatterns');
    await renderStats();
}
