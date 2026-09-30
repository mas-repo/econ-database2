# HKDSE Economics Questions Database

A single-page web app for browsing, filtering, and managing a database of
HKDSE / HKCEE / HKALE Economics past-paper questions. Data is loaded from
a JSON file (data/database.json) into IndexedDB for fast client-side
filtering. Users can also import another JSON file with the same shape.
The UI is in Traditional Chinese.

Future agents adding mock papers should read /README.md first. The
Python builder is only the first import. Records with reviewedByAI Y
must not be overwritten. lastReviewDate is the day of that read.

Documentation convention: do NOT use fenced code blocks anywhere in this
Readme. Describe code, file paths, and identifiers inline in prose or in
plain lists instead.

---

## 1. Quick Start

1. Serve the project folder with any static web server (or open
   index.html directly — but a server is recommended so fetch/CORS
   behaves consistently).
2. index.html starts reading data/database.json as soon as the page loads.
   The app shows「載入中...」while it finishes that read and
   writes the questions into IndexedDB.
3. When sync completes, a「✓ 資料載入完成」pill appears in the header
   corner and the question list renders.

All filtering, searching, sorting, and pagination then run entirely
client-side against IndexedDB.

---

## 2. Project Structure

- index.html — App shell. Mounts templates, loads CSS/JS.

CSS (css/):
- variables.css — CSS custom properties (colors, spacing, radii).
- layout.css — Header, container, status pill, scroll-to-top.
- filters.css — Filter panel, dropdowns, tri-state checkboxes, range
  sliders, logic toggles, modal filter triggers, the filter modal
  (bottom-sheet on mobile), responsive rules.
- components.css — Buttons, cards, badges, pagination, tabs.
- responsive.css — Mobile overrides.

JavaScript (js/):
- constants.js — CHAPTER_RANGE, CHAPTER_DESCRIPTIONS, CURRICULUM_ITEMS /
  ORDER, FEATURE_ITEMS, etc.
- globals.js — Shared mutable state (triStateFilters, paginationState,
  sort state, ...).
- storage-core.js — IndexedDB wrapper (window.storage). Questions store
  only; DB version 4 (legacy metadata stores deleted on upgrade).
- auth.js — Login + user groups (Admin / Colleagues / ...).
- utils.js — Clipboard, HTML escaping (escapeHTML — the single escaping
  authority; coerces non-strings), debounce (single source of truth),
  static filter population, panel toggling, scroll helpers.
- filters.js — Filter state machine, context-aware dynamic option
  building (buildOptionData), applyFilters orchestration, active-filter
  badges. All Sheet-sourced values are HTML-escaped before injection.
- filter-modal.js — Modal pickers for the seven long-option filters
  (圖表類型 / 表格類型 / 計算類型 / 複選類型 / 概念類型 / 題型 /
  題幹模式 stemPatterns). State lives directly in window.triStateFilters,
  so tri-state include/exclude, badges, tag-clicks and clearFilters all
  work unchanged.
- render.js — Question card rendering + pagination. Fully XSS-hardened:
  every Sheet field is escaped; image/AI links restricted to http(s).
- statistics.js — Read-only stat aggregations (publishers, topics,
  chapters, concepts, patterns, stemPatterns / 題幹模式).
- tabs.js — Thin delegation layer: tab renderers call statistics.js.
  Kept so switchTab() in main.js needs no changes.
- main.js — Boot sequence, sync flow, switchTab(), debounced search
  wiring, global Esc hotkey.

Templates (js/templates/):
- template-filters.js — renderFiltersTemplate() — full filter panel,
  including the seven modal trigger buttons (ids mf-item-*, mf-trigger-*,
  mf-badge-* must match filter-modal.js).
- template-tabs.js — TAB_DEFINITIONS + renderTabsNavTemplate() +
  renderTabContentsTemplate().
- template-form.js — renderFormTemplate() — admin add/edit form.

---

## 3. Key Behaviors & Conventions

### Tabs
- Tabs are declared in TAB_DEFINITIONS (template-tabs.js). Set
  visible: true to publish a tab. With only one visible tab, the tab
  bar is not rendered at all.
- The statistics tabs (出版商 / 課程分類 / Chapters / 涉及概念 / 題型 /
  題幹模式) may be published or unpublished via TAB_DEFINITIONS. Their
  content containers still exist in the DOM, and their renderers in
  statistics.js are kept working so visibility can flip instantly.

### Filters
- Most filters are tri-state: unselected → ✔ included → ✕ excluded.
- Curriculum and Chapter filters support OR/AND logic via a toggle.
- 答對率, 分數, and 題號 use dual-thumb range sliders (題號 uses the
  last digits of the question id, range from QUESTION_NUMBER_RANGE).
- All seven dynamic long-option filters — 圖表類型, 表格類型, 計算類型,
  複選類型, 概念類型, 題型, 題幹模式 (stemPatterns) — open as a modal
  dialog (bottom sheet on narrow screens) with an in-modal search box,
  per-option counts, and a selected-count badge on the trigger button
  (hidden when the count is zero). Clicking an option cycles 未選 → ✔
  包含 → ✕ 排除. Option ordering is frozen while the modal is open so
  rows don't jump. Triggers are hidden when the dataset has no values
  for that field.
- The input-first dropdown pattern is fully retired; its helpers
  (inputFilter, filterDropdownList, setupInputDropdownListeners,
  populateList) and CSS were removed. Restore from git history if
  needed.
- Search input is debounced (~250ms) and routed through
  filterQuestions(), which resets pagination to page 1.
- Esc key: closes an open filter modal first; only a bare Esc (no modal
  open) clears all filters.
- The collapsible filter wrapper animates with max-height; after
  expanding, toggleFiltersPanel() switches it to overflow visible so
  dropdowns are never clipped by the wrapper.

### Permissions
- Elements with class btn-admin-only are hidden for non-admin users, and
  the 'Colleagues' group never sees chapter names (filter or stats).
- Note: this is UI-level gating only. The JSON file is the source of
  truth; IndexedDB edits last until the next JSON reload.

### Data & Security
- IndexedDB is treated as a disposable cache: it is wiped and rebuilt
  from data/database.json on every load. Do not store user-entered
  data only in IndexedDB (this is why the old 備註 feature was removed).
- Each question record has id, topic (identified syllabus topic) and
  plainText (the question wording). questionTextChi is kept equal to
  plainText so older card code still has the wording.
- XSS policy: every Sheet-sourced value injected into HTML must pass
  through escapeHTML() — body text, attribute values (data-value,
  title), and tag labels alike. URL fields (imageChi, imageEng,
  AIExplanation) must additionally pass the http(s) scheme check
  (safeHttpUrl in render.js) to block javascript: URLs. Never put raw
  Sheet values inside inline onclick strings; use data-* attributes with
  delegated listeners, or JS-escape then HTML-escape (see
  updateSearchInfo in filters.js).
- CSS gotcha worth remembering: an explicit display value on a class
  (e.g. .mf-badge with display inline-block) overrides the browser's
  default hidden-attribute rule. Pair any hidden-attribute usage with an
  explicit selector like .mf-badge[hidden] { display: none !important }.

---

## 4. Known Limitations / TODO

- Mock-test Paper 2 question images omit the barcode header, the
  box around that header, the margin warning in the side columns and
  footer, and the blank answer lines. Recut them with
  capture_from_pdf.py --sq-images.
- HKDSE question images drop the year-and-page footer, such as
  2025-DSE-ECON 1-14, including a footer in the middle of a crop that
  crosses a page. Repeat that cleanup with
  capture_hkeaa.py --strip-footers.
- HKDSE question, written-answer, and report images that could not be
  matched to the stored wording are listed in HKEAA-待補圖片.md in this
  folder. 2013 has no crops yet. Other years from 2012 to 2025 include
  only the crops that matched. Add missing files under
  originals/dse/year/ using the names in that note.
- DSE-題目規律.md in this folder is the organised past-paper pattern
  note. Years whose Paper 2 stems are missing from the bank are left
  blank instead of guessed.

- Topic, curriculum, chapter, and pattern statistics tabs are published
  so the mock-paper topic distribution can be reviewed.
- Range slider thumbs are styled for WebKit only; add the -moz
  range-thumb selector for Firefox.
- Persistent per-question notes would require a write-back endpoint
  (e.g. Apps Script action saveComment) — not implemented.
- statistics.js and storage-sync.js must not reference the removed
  metadata stores (publishers / topics / concepts / patterns) or the
  removed getAllMetadata() / updateMetadata() methods — verify before
  re-enabling the statistics tabs.
- Confirm template-form.js / admin code does not rely on the removed
  .filter-input / .input-dropdown-list CSS classes.

---

## 5. Re-publishing a Hidden Tab (checklist)

1. In template-tabs.js, set the tab's visible flag to true.
2. Confirm its renderer in statistics.js still matches the current data
   schema and does not call the removed metadata APIs.
3. Decide whether stats should refresh on sync (refreshStatistics()) or
   stay lazy (rendered on tab switch only — current behavior).

---

## 6. Changelog

### 2026-09-30 (current)
- Added stemPatterns (題幹模式): seventh modal long-option filter
  (🧩 題幹模式), statistics tab 題幹模式統計, and agent-facing README.md
  for taxonomy / writing rules. Import helpers live under scripts/
  (apply_stem_patterns_import.py, auto_assign, fuzzy_assign,
  merge_stem_pattern_classifications.py, classify_chunks/).
- Added 題號 dual-thumb range slider (last digits of id;
  QUESTION_NUMBER_RANGE).

### 2026-06
- 複選類型 upgraded to a modal long-option filter; all six dynamic
  filters then shared the modal picker. Input-first dropdown machinery
  removed (template helper, filterDropdownList,
  setupInputDropdownListeners, populateList, related CSS).
- Modal trigger count badges are now fully hidden at zero selections
  (fixed display:inline-block overriding the hidden attribute).

### 2026-06 (earlier)
- Long-option filters converted from input-first dropdowns to modal
  pickers (filter-modal.js) with in-modal search, counts, frozen
  ordering, count badges, and bottom-sheet layout on mobile. State
  remains in triStateFilters so all existing filter logic, badges and
  tag-clicks are unchanged.
- Search input debounced at 250ms via filterQuestions() (resets to page
  1; refreshes counts and badges). Duplicate debounce util removed from
  main.js — utils.js is the single source.
- Full XSS hardening pass: render.js escapes every Sheet field including
  tag labels and attributes; image/AI links restricted to http(s);
  filters.js escapes dynamic option lists, year grid, and active-filter
  badges (including inline onclick argument escaping); escapeHTML now
  coerces non-string input (numeric IDs no longer throw).
- storage-core.js cleaned: DB bumped to v4; legacy metadata stores and
  updateMetadata / getMetadata / getAllMetadata removed; clear() now
  clears questions only; legacy stores deleted on upgrade.
- Esc hotkey now closes an open filter modal instead of clearing all
  filters.
- Tabs refactored into a TAB_DEFINITIONS config; statistics tabs
  unpublished; tab bar auto-hides when only one tab is visible.
- Sort dropdown now resets pagination to page 1 via onSortOrderChange().
- Tags-visibility checkbox given an id (show-tags-toggle) so its state
  survives re-renders.

### Previous update
- Fixed filter dropdowns being clipped by the collapsible wrapper
  (overflow released after expand animation; long static lists scroll
  internally at max-height 320px).
- Removed the「添加備註」feature from statistics tabs (comments were
  never persisted — IndexedDB is rebuilt on every sync). tabs.js is now
  a thin delegation layer; saveMetadata() removed.
- 「Chapters統計」cards now show full chapter names from
  CHAPTER_DESCRIPTIONS (hidden for the Colleagues group).
- Fixed oversized「✓ 資料載入完成」status pill (now fit-content, pinned
  in header, hidden when empty) and the「🔄 重置篩選條件」button no
  longer stretches to full width.