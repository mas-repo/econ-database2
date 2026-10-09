# Filter system map — econ-database2

Checkout: `main` @ `30d228f` (branch `cursor/filters-review-d2f5` tracks `origin/main`).  
**Prioritized improvement list:** [`docs/filters-review-2026-10-09.md`](./filters-review-2026-10-09.md).  
Scope: how 題目 / 統計 / 進階篩選 / ConditionMatch / partsStatus / admin blanks / AI解釋 filters relate.  
Constraint: map + pain points + bugs; prefer consolidations and small fixes over UI rewrites. No drive-by UI rewrite.

---

## 1. Architecture sketch

```
┌─ 題目 UI ─────────────────────────────────────────────────────────┐
│  globals.triStateFilters (+ filterLogic, search, ranges)           │
│  filter-modal.js (graph/table/calc/multi/concepts/patterns/stem)   │
│  utils.populateFeatureFilter / populateCurriculum / chapter / AI   │
│  advanced-filter.js → window.advancedFilter                        │
│  data-checks / stats jump → window.idSetFilter                     │
│  gatherFilterState() / renderQuestions() filters object            │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                               ▼
              IndexedDBStorage.applyFilters  (storage-filters.js)
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
   permission (mock)     tri-state / search     idSet + advanced
         │               ranges / AI map              │
         │                     │                      │
         │              questionFeatureOn             │
         │              questionMatchesAiFilter       ConditionMatch
         │              EMPTY_FIELD_SENTINEL          .matchesAllConditions
         ▼                     ▼                      ▼
                    filtered question list

┌─ 統計 UI ─────────────────────────────────────────────────────────┐
│  statsFilterState[tab] via getStatsTabState / emptyStatsTriState   │
│  statsStateToFilters(state) → same applyFilters                    │
│  questionsMatchingStatsFilters → 一維 / 交叉                       │
│  jump: finishJumpToQuestions copies tri → window.triStateFilters   │
└────────────────────────────────────────────────────────────────────┘

┌─ ConditionMatch (condition-match.js) ─────────────────────────────┐
│  Shared by: advanced-filter.js, data-checks.js                     │
│  Field catalog, normalize, AND match, autocomplete collect         │
│  feature → questionFeatureOn (question-fields.js)                  │
│  Applied on 題目 list via window.advancedFilter in applyFilters    │
└────────────────────────────────────────────────────────────────────┘
```

### Data flow (題目)

1. UI mutates `window.triStateFilters` (`toggleTriState`, `cycleModalOption`, range widgets, search).
2. `filterQuestions()` → `updateDynamicDropdowns()` + `updateSearchInfo()` + `renderQuestions()`.
3. `renderQuestions` / `gatherFilterState` build `{ search, searchScope, triState, ranges, idSetFilter, advancedFilter }`.
4. `storage.getQuestions(filters)` → `applyFilters`.

### Data flow (統計)

1. Per-dimension (actually one shared key `stats`) state in `statsFilterState`.
2. `statsStateToFilters` → `applyFilters` (search only when scope ≠ `name`).
3. Row-name search (`statsNameQuery`) is post-filter on aggregated labels, not `applyFilters`.
4. Jump to 題目: `applyStatDimJumpToTri` + `finishJumpToQuestions` overwrites 題目 globals and calls `filterQuestions`.

### Load order (`index.html`)

Critical chain:

`globals` → `constants` → `storage-filters` → **`question-fields` (`questionFeatureOn`)** → **`condition-match`** → `question-list-filter` → `filters` / `filter-modal` / `advanced-filter` → `stats-filters` → … → **`ai-explanation`** (after Poe) → `main`

`applyFilters` references `questionFeatureOn` / `questionMatchesAiFilter` only at **runtime**, so parse order of those names inside `storage-filters.js` is fine; AI helpers must exist before any AI tri-state is applied meaningfully.

---

## 2. Piece-by-piece map

### 2.1 題目 filters

| File | Role |
| --- | --- |
| `js/globals.js` | Initial `triStateFilters` (includes default `feature['Out syl']='excluded'`), `filterLogic` |
| `js/filters.js` | Tri-state toggle, clear/reset, badges (`updateSearchInfo`), dynamic year/AI grids, `gatherFilterState`, `filterQuestions`, range filters |
| `js/filter-modal.js` | Modal pickers for 7 long lists; state in same `triStateFilters` keys |
| `js/storage-filters.js` | **Only** apply engine for bank rows |
| `js/utils.js` | `populateFeatureFilter`, curriculum/chapter/partPerformance grids |
| `js/templates/template-filters.js` | DOM shell + 進階篩選 button |

### 2.2 統計 filters

| File | Role |
| --- | --- |
| `js/stats-filters.js` | Independent tri-state (`emptyStatsTriState`), modal UI for **all** dims, bins, jump helpers, `STAT_TABS` / `STAT_FILTER_DEFS` |
| `js/stats-explore.js` | Crosstab; reuses `questionsMatchingStatsFilters` + `finishJumpToQuestions` |
| `js/statistics.js` | 1D browse render; filters via `questionsMatchingStatsFilters` |

AI解釋 is **filter-only** on 統計 (`requiresAi: true`); never a `STAT_TABS` grouping dimension.

### 2.3 進階篩選

| File | Role |
| --- | --- |
| `js/advanced-filter.js` | Local-only modal; `localStorage` key `econ_advanced_filter_v1`; never GitHub |
| `js/question-list-filter.js` | `applyAdvancedConditionFilter` → `window.advancedFilter` |
| `js/storage-filters.js` | AND layer after tri-state |

### 2.4 `condition-match.js`

Pure matcher + field catalog. Consumers:

- `advanced-filter.js` (UI + apply)
- `data-checks.js` (check definitions + pending match; sync is separate)
- `bulk-edit.js` / `stem-pattern-review.js` (vocab / autocomplete helpers)

Does **not** own remote sync or exceptions (data-checks does).

### 2.5 `question-list-filter.js`

Two layers on the 題目 list:

- `window.idSetFilter` — exact ID membership (data-checks「篩選全部待處理」, stats idSet jumps)
- `window.advancedFilter` — ConditionMatch AND

Both intersect with tri-state inside `applyFilters`. Helpers refresh via `filterQuestions` / `switchTab('questions')`.

### 2.6 partsStatus / 特徵 / `questionFeatureOn`

Canonical semantics in `js/question-fields.js`:

| Status | Meaning | Feature label |
| --- | --- | --- |
| `filled` | non-empty `questionParts` (always wins) | `有分題` |
| `none` | confirmed no parts | `沒有分題` |
| `pending` | legacy empty / unentered | `尚未輸入分題` |

`questionFeatureOn(q, value)` is the **single** matcher for 題目 tri-state feature, 統計 feature dimension, and ConditionMatch `feature` field.

統計 also exposes derived dimension `hasParts` (`STAT_TABS.hasParts`) with the same three labels; jump maps into `tri.feature[...]`.

Legacy jump bookmark `無分題` (`STAT_HAS_PARTS_NO`) → exclude `有分題` (none + pending).

### 2.7 Admin blank filters

Constants: `ADMIN_BLANK_FEATURE_ITEMS` in `constants.js` (`題目空白` / `答案空白` / `評卷報告空白`).

- Shown only when `accessRights.admin` via `effectiveFeatureItems()`.
- Matched by blank helpers (`isQuestionTextBlank`, etc.) — `-` and whitespace count as blank.
- `applyFilters` **skips** admin-blank keys if not admin (`storage-filters.js` ~548).
- ConditionMatch same gate (`condition-match.js` ~218).
- `clearAdminBlankFeatureFilters()` only clears **`window.triStateFilters.feature`**, not stats state.

These are **not** the same as modal `EMPTY_FIELD_SENTINEL` (`__empty__` / label「尚未輸入」) used for graph/table/calc/multi/concepts/patterns/stemPatterns.

### 2.8 AI解釋 filter

| Piece | Role |
| --- | --- |
| `ai-explanation.js` | Side-file index; `filterValuesForQuestion` → `['有AI解釋', '簡短'?, '詳盡'?]` |
| | `questionMatchesAiFilter(q, triAi)` — checked = AND, excluded = ANY block |
| `storage-filters.js` | `filters.triState.ai` → `questionMatchesAiFilter` |
| `filters.js` | Builds AI dropdown when `accessRights.ai` |
| `stats-filters.js` | `kind: 'ai'` modal; hidden without AI right |

Legacy `question.AIExplanation` URL is ignored (schema v3 comment).

### 2.9 `data-checks.js` + ConditionMatch

- Reuses `ConditionMatch.normalizeCondition` / `matchesAllConditions` / `collectFieldValues`.
- Own overlay UI (nearly parallel row markup to 進階篩選).
-「篩選全部待處理」→ `applyQuestionIdSetFilter` (ID set, not advancedFilter).
- Syncs check definitions to GitHub; advanced filter does not.

---

## 3. Shared vs duplicated (題目 ↔ 統計)

### Shared (good)

- Apply engine: `IndexedDBStorage.applyFilters`
- Feature truth: `questionFeatureOn` / `effectiveFeatureItems` / parts helpers
- Empty-field sentinel + `isModalFieldEmpty` / `partitionEmptySelection`
- Year key: `normalizeYearFilterKey` / `yearFilterLabel`
- Default **Out syl excluded** on both sides
- AI match function (when loaded)
- Jump path reuses 題目 globals rather than a third engine

### Duplicated (drift risk)

| Concern | 題目 | 統計 |
| --- | --- | --- |
| Tri-state default object | `globals.js` + `clearFilters` | `emptyStatsTriState` |
| Cycle UX | `toggleTriState` / `cycleModalOption` | `cycleStatsOption` (+ own modal shell) |
| Feature UI | Grid dropdown (`populateFeatureFilter`) | Same mf-overlay pattern as other stats dims |
| Curriculum/chapter AND\|OR | `#*-logic-toggle` + `window.filterLogic` | Checkbox in stats modal + `state.logic` |
| Badges | `updateSearchInfo` | `updateStatsActiveFilters` |
| Option counts / stale cleanup | `buildOptionData` | `countFilterValues` / `staticFilterUniverse` |
| Search | DOM `#search` + scopes including `all` | Default scope `name` (row labels only); other scopes map into `applyFilters` |
| Clear | Esc / `clearFilters` | `resetStatsFilters` (Esc does **not** reset stats) |

Intentionally separate: stats state must not mutate until jump — correct product choice; the cost is ~parallel UI code.

---

## 4. Surprising defaults & semantics

1. **`Out syl` excluded by default** on 題目 and 統計 (`globals.js:9`, `emptyStatsTriState`, `clearFilters`, stats modal clear). Hidden from badges/indicators so it looks like “no filter” while out-of-syllabus rows are dropped.
2. **統計 search default `name`** does not search question text; only non-`name` scopes hit `applyFilters.search`.
3. **Feature multi-select is AND** across keys (each `Object.entries` filter in `applyFilters`). Checking both `有分題` and `沒有分題` → empty set.
4. **AI checked values are AND** (`questionMatchesAiFilter`); UI hint on「有AI解釋」says 剔選＝有／排除＝無, but combining「簡短」+「詳盡」requires both on one question.
5. **Search scope `all`** omits concepts/patterns/stemPatterns (only dedicated scopes). ConditionMatch「字串」searches 題目+答案+評卷報告 via `questionSearchText`, not topic alone.
6. **Confirmed-none vs 尚未輸入**: stored「沒有圖」≠ modal「尚未輸入」sentinel. Feature「複選」excludes「並非複選型」/「不適用」.
7. **進階篩選 localStorage** survives `clearFilters` of the active layer (draft reopens); active `window.advancedFilter` is cleared by `clearFilters`.

---

## 5. partsStatus / 特徵 / admin blank edge cases

- Non-empty parts always → `filled` (`resolvePartsStatus`); stale `partsStatus: none` cannot win.
- Choosing「有分題」with empty rows on save → stored as `pending` (`applyPartsFields`).
- Sync (`storage-sync.js`): empty parts + missing status → leave pending; do not invent `none`.
- Admin blanks: blank text fields (`-` counts blank); independent of partsStatus.
- Losing admin: `clearAdminBlankFeatureFilters` clears 題目 only; stats can keep stale admin-blank tri keys (ignored by apply for non-admin, but badges/UI may still show until reset).
- 統計 `hasParts` hideOn also hides feature filter when browsing that dimension — users filter parts via the dimension itself.

---

## 6. AI解釋 filter path

```
accessRights.ai
  → populate AI dropdown (filters.js) / show stats ai def
  → triState.ai[有AI解釋|簡短|詳盡] = checked|excluded
  → applyFilters → questionMatchesAiFilter
       → filterValuesForQuestion(id) from AiExplanation.store
```

If side-file not loaded yet: values empty →「有AI解釋」checked matches nothing; excluded matches everyone.  
Losing AI right: `applyAccessRights` / `initAiExplanationFeature` clear **題目** `triState.ai`; stats `ai` map not explicitly cleared (filter def hidden via `requiresAi`).

---

## 7. Concrete pain points

### UX

- Invisible Out syl exclude (power-user surprise).
- Esc on 題目 clears filters; Esc does not reset 統計; Esc with 進階篩選 open still runs `clearFilters` (modal stays).
- Two mental models: 題目 grid+modals mix vs 統計 all-modals.
- Stats jump can leave a prior **進階篩選** active (jump clears idSet then may set new idSet; does not clear `advancedFilter`).
- Naming: `qtype`/`questionType`, `exam`/`examination`, `topics`/`curriculum`, `publishers`/`publisher`, `feature` vs `hasParts`.

### Code quality

- Parallel ~60k+60k filter UI (`filters.js` + `stats-filters.js`) with copy-pasted Out syl / badge / cycle logic.
- `renderQuestions` rebuilds filter object instead of always calling `gatherFilterState` (easy to drift).
- `globals.triStateFilters` historically lacked `year` (filters.js init skipped because globals already set); created lazily — fragile.
- Architecture review (`docs/architecture-review-2026-10-09.md` §5) is partly stale: `questionFeatureOn` already lives in `question-fields.js`; condition-match no longer keeps a full fallback body.
- Escape ownership fragmented (`main.js` vs AI / data-checks / report-issue / advanced-filter).
- Condition row UI duplicated between `advanced-filter.js` and `data-checks.js`.

### Load order

- Documented in `index.html`; still fragile. AI filter functions load late — safe at click-time, wrong if anything applied AI state during early boot.
- `storage-filters` before `question-fields` is OK only because matching is runtime.

---

## 8. Clear bugs / inconsistent semantics

### BUG A — Stats (and bare `getQuestions`) inherit 題目 idSet / advanced layers

`statsStateToFilters` omits `idSetFilter` / `advancedFilter`.  
`applyFilters` then does:

```583:594:js/storage-filters.js
    var idSet = filters.idSetFilter || (typeof window !== 'undefined' ? window.idSetFilter : null);
    ...
    var advanced = filters.advancedFilter || (typeof window !== 'undefined' ? window.advancedFilter : null);
```

So an active data-checks ID set or 進階篩選 on 題目 **narrows 統計 counts** and also any `getQuestions()` / `getQuestions({})` caller that expected “all permission-visible rows” (stats render, advanced-filter autocomplete’s first fetch, etc.).

**Small fix:** prefer explicit keys — e.g. only fall back to `window.*` when the property is absent *and* a flag says so; or have `statsStateToFilters` pass `{ active: false }` for both layers; or change `||` to `'idSetFilter' in filters ? …`.

### BUG B — Stats → 題目 jump does not clear `advancedFilter`

`finishJumpToQuestions` (`stats-filters.js` ~1519) resets `idSetFilter` then may set a new one; **never** calls `clearAdvancedConditionFilter`. Prior 進階條件 keep AND-ing after jump → wrong 題目 list vs stats cell count.

### BUG C — Escape clears 題目 filters while other overlays are open

`main.js` ~431 closes `sf-overlay` / `mf-overlay` / Poe, else `clearFilters()`. Missing:

- `#advanced-filter-overlay` (`af-overlay`) — Esc clears filters under an open 進階篩選 dialog
- AI解釋 / feedback / admin overlays (their document listeners close themselves but do not stop `main.js` from also clearing filters)
- data-checks overlay keydown closes panel but does not `stopPropagation`, so document listener can still `clearFilters`

### BUG D — Admin-blank cleanup incomplete for 統計

`clearAdminBlankFeatureFilters` (`question-fields.js` ~98) only mutates `window.triStateFilters`. After admin demotion, stats may still display blank-feature selections that no longer apply.

### Semantic inconsistency (not always “wrong”, but sharp edges)

- `filterByTag` toggles only checked ↔ off; never excluded. From default Out syl `excluded`, a card-tag click jumps to `checked` (skips neutral).
- Removing Out syl exclude is impossible from badges (intentionally omitted); only via cycling the feature control.
- AI AND-of-checked vs feature AND-of-entries is consistent with engine, easy to misread from tri-state UI.

---

## 9. Preferred consolidations / small fixes (no drive-by UI rewrite)

1. **Fix BUG A** — stop window fallback when caller passes a filters object meant to be self-contained (`statsStateToFilters`, bare `getQuestions` for universes). Prefer `getAllQuestions` + `applyPermissionFilter` for “full bank” autocomplete where appropriate.
2. **Fix BUG B** — `finishJumpToQuestions`: `clearAdvancedConditionFilter({ silent: true })` (or document that jump intersects advanced — but that surprises).
3. **Fix BUG C** — teach `main.js` Esc about `af-overlay` (and ideally a single “topmost modal” stack); AI/data-checks should `stopImmediatePropagation` or register in that stack.
4. **Fix BUG D** — clear admin blanks in `statsFilterState` inside `clearAdminBlankFeatureFilters` or `applyAccessRights`.
5. **Single default factory** for `{ feature: { 'Out syl': 'excluded' }, ... }` used by globals, `clearFilters`, `emptyStatsTriState`.
6. **Keep** `questionFeatureOn` in `question-fields.js` as the only feature matcher (already done); update stale notes in architecture review.
7. Optional later: extract shared tri-cycle + badge helpers; **do not** merge 題目/統計 chrome without an explicit UX pass.

---

## 10. Quick reference — important symbols

| Symbol | File |
| --- | --- |
| `applyFilters` | `js/storage-filters.js` |
| `gatherFilterState` / `filterQuestions` / `clearFilters` | `js/filters.js` |
| `emptyStatsTriState` / `statsStateToFilters` / `finishJumpToQuestions` | `js/stats-filters.js` |
| `questionFeatureOn` / `resolvePartsStatus` / `effectiveFeatureItems` | `js/question-fields.js` |
| `ConditionMatch` | `js/condition-match.js` |
| `applyAdvancedConditionFilter` / `applyQuestionIdSetFilter` | `js/question-list-filter.js` |
| `questionMatchesAiFilter` / `aiExplanationFilterValues` | `js/ai-explanation.js` |
| Esc hotkey | `js/main.js` |
