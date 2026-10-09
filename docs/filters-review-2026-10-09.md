# Filters review — prioritized improvements (2026-10-09)

Checkout: `main` @ `30d228f` (after #15 safe consolidations).  
Detail map (architecture, symbols, edge cases): [`docs/filter-system-map.md`](./filter-system-map.md).  
**Constraint:** recommendations only. No drive-by 題目↔統計 UI merge. Fix clear bugs with tiny, behavior-scoped patches.

---

## Snapshot (what is already healthy)

| Layer | Owner | Shared? |
| --- | --- | --- |
| Apply engine | `IndexedDBStorage.applyFilters` (`storage-filters.js`) | Yes — 題目 + 統計 |
| 特徵 / partsStatus truth | `questionFeatureOn` (`question-fields.js`) | Yes — ConditionMatch delegates |
| Condition AND matcher | `condition-match.js` | Yes — 進階篩選 + 資料檢查 |
| ID-set / advanced layers | `question-list-filter.js` → `window.idSetFilter` / `advancedFilter` | 題目 list only (by intent) |
| EMPTY「尚未輸入」 | `EMPTY_FIELD_SENTINEL` in modal fields | Shared constant; ≠ admin「題目空白」 |
| AI解釋 filter | `triState.ai` → `questionMatchesAiFilter` (side-file index) | Optional / `requiresAi` |

---

## P0 — Clear bugs (fix first; small patches)

### 1. 統計 inherits 題目 `idSet` / 進階篩選 via window fallback

`statsStateToFilters` omits those keys; `applyFilters` does `filters.idSetFilter || window.idSetFilter` (and same for advanced) — `storage-filters.js` ~584–593.

**Effect:** Active 資料檢查 ID set or 進階篩選 on 題目 **narrows 統計 counts** (and any bare `getQuestions()` / empty filters object).

**Fix direction:** Make stats filters self-contained — pass inactive layers explicitly, or only fall back to `window.*` when the caller intends 題目 context (`'idSetFilter' in filters` / dedicated flag). Do not change default Out syl or tri-state UX.

### 2. Stats → 題目 jump leaves 進階篩選 active

`finishJumpToQuestions` resets `idSetFilter` then may set a new one; **never** clears `advancedFilter` (`stats-filters.js` ~1519–1530).

**Effect:** Jump list can be a subset of the stats cell (prior 進階 AND still applied).

**Fix direction:** `clearAdvancedConditionFilter({ silent: true })` (or equivalent) at jump start. Prefer clear over “document intersection.”

### 3. Esc on 題目 clears filters under other overlays

`main.js` ~431 closes Poe / `sf-overlay` / `mf-overlay`, else `clearFilters()`. Missing `#advanced-filter-overlay`; AI解釋 / 回報問題 / data-checks listeners do not stop the document handler.

**Effect:** Esc can wipe 題目 filters while 進階篩選 (or another modal) is still open.

**Fix direction:** Teach Esc about `af-overlay` first; longer-term a single topmost-modal stack (care: z-index / what closes).

### 4. Admin-blank cleanup skips 統計 state

`clearAdminBlankFeatureFilters` only mutates `window.triStateFilters.feature` (`question-fields.js` ~98). Apply already ignores admin blanks for non-admin; stats UI can still show stale chips.

**Fix direction:** Also clear those keys in `statsFilterState` from `applyAccessRights` / the same helper.

---

## P1 — UX clarity (small, intentional; not a chrome rewrite)

| # | Issue | Recommendation |
| --- | --- | --- |
| 5 | **Invisible default:** `Out syl` excluded on 題目 + 統計, hidden from badges | Keep behavior; add a quiet persistent hint (or show in badge strip when only this default is on). Do not silently change default without product OK. |
| 6 | **Feature / AI multi-check is AND** (engine loops / `checked.every`) | Optional one-line hint near 特徵 / AI解釋:「多選＝同時符合」. Checking 有分題+沒有分題 → empty is correct but surprising. |
| 7 | **統計 search default `name`** only filters row labels | Label the control more clearly, or remember last scope per session — do not silently switch default to `all`. |
| 8 | **Two emptiness vocabularies** | Document in UI help: modal「尚未輸入」(`EMPTY_FIELD_SENTINEL`) vs feature「題目空白／尚未輸入分題」vs stored「沒有圖／並非複選型」. No rename without copy pass. |
| 9 | **Esc asymmetry** | 題目 bare Esc = clear; 統計 Esc ≠ reset. Decide product rule once Esc stack exists (P0 #3). |

---

## P2 — Code quality (consolidate without UX change)

| # | Issue | Recommendation |
| --- | --- | --- |
| 10 | Tri-state default `{ feature: { 'Out syl': 'excluded' } }` copied in `globals.js`, `filters.clearFilters`, `emptyStatsTriState` | Single `emptyFeatureTriState()` / `emptyTriStateFilters()` factory — same defaults. |
| 11 | Parallel 題目 (`filters.js` + `filter-modal.js`) vs 統計 (`stats-filters.js`) cycle/badge/modal helpers | Extract **shared helpers only** (cycle, empty-field row, Out syl hide). **Do not** merge chrome or optional-filter visibility. |
| 12 | `renderQuestions` rebuilds filter object vs `gatherFilterState()` | Always use `gatherFilterState()` (or one builder) so idSet/advanced/search cannot drift. |
| 13 | Condition row UI duplicated in `advanced-filter.js` + `data-checks.js` | Shared row renderer; keep sync boundary (進階 local-only vs data-checks GitHub). |
| 14 | Stale note in `architecture-review-2026-10-09.md` §5 (`questionFeatureOn` still described as living in stats-filters) | One-line doc fix — already moved in #15. |
| 15 | AI filter depends on in-memory side-file load | Ensure load-before-first-filter (or empty-index toast); losing `ai` right should clear **stats** `triState.ai` too (mirrors 題目 `clearAiTriFilters`). |

---

## P3 — Do later / product decisions (not invisible)

- Full 題目 ↔ 統計 filter UI unify — large UX risk (defaults, optional dims, Out syl, AI gate).
- Shared modal Escape ownership across Poe / AI / report / data-checks / bulk-edit.
- OR mode for 特徵 / AI multi-select (would change counts).
- Changing SCHEMA / bank fields for AI解釋 (correctly stays a side-file index today).

---

## Suggested verify order (when fixing P0)

1. Apply 進階篩選 on 題目 → open 統計 → counts must match unfiltered-by-advanced universe (permission only + stats tri).
2. Apply 進階 → 統計 cell jump → 題目 list must match cell (no leftover advanced).
3. Open 進階篩選 → Esc → dialog closes, **filters unchanged**.
4. Admin on → set「題目空白」on 統計 → demote admin → chip gone / ignored.

---

## Out of scope (this note)

No wording/layout/color changes shipped here. No proxy/modal shell unify. No SCHEMA policy change.
