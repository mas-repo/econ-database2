# Architecture review — econ-database2 (2026-10-09)

Scope: `mas-repo/econ-database2` **main** after PR #12, plus coupling notes for Apps Script and the private data repo (`mas-repo/econ-database-data`).

**Constraint of this review:** recommendations only. No user-visible feature, layout, wording, or CSS behavior changes are proposed as “do now” unless marked **safe no-UX**. When a change might affect filter counts, Escape handling, or deploy gates, it stays **recommendation / care**.

---

## 1. System sketch

```
Browser (Pages: econ-database2)
  ├─ IndexedDB bank copy + filter UI (題目 / 統計 / 進階篩選)
  ├─ Apps Script /exec  (POE_PROXY_WEB_APP_URL)
  │     ├─ role check (admin / ai / githubSync / mockTests / known)
  │     ├─ AI proxy (Poe / OpenRouter) → generate / explain / stem review
  │     └─ GitHub write token → shared side files + bank upload
  └─ Optional direct GitHub read (issueSharedReadToken) → large assets / bank / side JSON
         │
         ▼
Private data repo (econ-database-data)
  shared/data/database.json          ← bank + schemaVersion
  shared/data/ai-explanations.json   ← AI解釋
  shared/data/issue-reports.json     ← 回報問題
  shared/data/data-checks.json       ← 資料檢查 (ken/admin)
  shared/diagrams|originals|papers…
  users/<user>/…                     ← personal AI出題 backups
```

The public site never holds the write PAT. Capability is entirely role flags from Apps Script plus which shared paths the client is allowed to read.

---

## 2. Client module map (by concern)

| Concern | Primary files | Notes |
| --- | --- | --- |
| Boot / load order | `index.html`, `js/main.js`, `js/ui-bootstrap.js` | ~50 scripts; order is load-bearing |
| Auth / rights | `js/auth.js`, `js/access-rights.js` | Rights from `checkAccess`; UI gates (`poe-ai-allowed`, admin btn) |
| Bank storage | `js/storage-core.js`, `js/storage-sync.js`, `js/schema-version.js` | IndexedDB + sync stamp |
| Field semantics | `js/question-fields.js`, `js/constants.js` | partsStatus, blanks, year normalize |
| 題目 filters | `js/filters.js`, `js/filter-modal.js`, `js/storage-filters.js` | UI → `applyFilters` |
| 進階篩選 / 資料檢查 matcher | `js/condition-match.js`, `js/advanced-filter.js`, `js/data-checks.js`, `js/question-list-filter.js` | Shared ConditionMatch; data-checks is remote side file |
| 統計 | `js/stats-filters.js`, `js/stats-explore.js`, `js/statistics.js`, `js/tabs.js` | Same `applyFilters` engine; large UI duplicate of 題目 filters |
| Cards / form / bulk | `js/render.js`, `js/forms.js`, `js/bulk-edit.js` | Admin edit vs everyone else |
| AI出題 | `js/poe-generate-*.js` (8 files) | Settings, proxy, history, compose, run |
| AI解釋 | `js/ai-explanation.js` | Modal + side-file index; admin UI can delegate |
| 回報問題 | `js/report-issue.js` | Modal + combined「回饋／回報」hub |
| Stem review | `js/stem-pattern-review.js` | AI-gated; uses Poe proxy |
| Git / assets | `js/github-sync.js`, `js/shared-assets.js` | Upload/download + direct read |
| CSS | `css/main.css` → many imports; **`poe-modal.css` also holds AI解釋 + 回報問題 styles** | Naming drift |

Approximate weight (LOC): `Code.gs` ~5k · `stats-filters.js` ~1.7k · `filters.js` ~1.6k · `data-checks.js` ~1.3k · `poe-generate-compose.js` ~1.2k · `bulk-edit.js` ~1.1k · `poe-modal.css` ~2k.

---

## 3. Apps Script action surface

Entry: `doPost` → `handlePost_` (`apps-script/Code.gs`).

| Action | Gate (typical) | Persistence |
| --- | --- | --- |
| `checkAccess` / `checkRights`, `logLogin` | known hash lists | none / log |
| `generateQuestions`, `continueGeneration`, `testModel` | `ai` (+ key rules) | usage log; optional AI backup under `users/` |
| `generateAiExplanation`, `voteAiExplanation`, `feedbackAiExplanation` | `ai` | `shared/data/ai-explanations.json` |
| `deleteAiExplanation` | `admin` | `shared/data/ai-explanations.json` |
| `listAiExplanationFeedback` | `admin` | read side file |
| `reportIssue` | `known` | `shared/data/issue-reports.json` |
| `listIssueReports` | `admin` | read side file |
| `reviewStemPatterns` | `ai` | none (reply only) |
| `listAiBackups`, `getAiBackup` | owner (+ admin paths) | `users/…` |
| `listAiUsageRecords` | `admin` | backups listing |
| `syncDataUpload` / `syncDataDownload` | `githubSync` | `shared/data/database.json` (+ schema gate) |
| `syncDataChecksUpload` / `Download` | ken + `githubSync` | `shared/data/data-checks.json` |
| `issueSharedReadToken`, `fetchSharedAsset`, `listSharedData` | `known` | read-only shared tree |

**Coupling note:** AI解釋 mutate path is abstracted (`mutateAiExplanationsStore_`). Issue reports and data-checks repeat the same lock + slot + read/write pattern inline. Bank upload adds `schemaVersion` stale checks that side-file writes do not use.

**Gap in file banners:** after issue-reports (~L1453) there is a long unbannered region (`handleTest_`, stem review, AI backup helpers) before “Admin bank Git sync”. The header action map is still accurate; the mid-file `// ===` comments are not.

---

## 4. Data-repo / schemaVersion coupling

| Artifact | Version field | Who bumps today |
| --- | --- | --- |
| `shared/data/database.json` | root `schemaVersion` (client `SCHEMA_VERSION`, now **5**) | Client stamp on upload; private-repo stamp follow-up |
| `ai-explanations.json` | store `version: 1` | Apps Script / client store shape |
| `issue-reports.json` | store `version: 1` | Apps Script |
| `data-checks.json` | own shape | data-checks sync |

**Policy smell:** bank `SCHEMA_VERSION` comments claim bumps for **side-file contracts** (v3 AI解釋, v5 回報問題) even when `database.json` columns did not change. That uses the bank upload gate as a coarse “app capability” signal: older clients cannot overwrite a stamped bank after a side-file-only feature ships.

- **Pro:** forces Pages + Code.gs redeploy before writes.
- **Con:** blocks bank uploads for clients that never touch AI解釋/回報; inconsistent with data-checks (also a side file, **not** reflected in `SCHEMA_VERSION`).

**Private-repo ops** (not doable from this public-site agent without data-repo access): stamp `schemaVersion: 5` on the live bank; ensure empty `issue-reports.json` exists if first `reportIssue` should not rely solely on create-on-write.

---

## 5. Filter / condition engines (owned boundaries)

Already healthy:

- **One apply engine:** `IndexedDBStorage.applyFilters` (`storage-filters.js`) is used by 題目 and 統計 (`statsStateToFilters` → same pipeline).
- **One condition matcher:** `condition-match.js` shared by 進階篩選 and 資料檢查.
- **idSet layer:** `question-list-filter.js` for stats jumps / data-checks “篩選全部待處理”.

Debt:

1. **`questionFeatureOn` (stats-filters.js ~611) vs `featureIsOn` (condition-match.js ~183)** — twin implementations. Condition-match prefers global `questionFeatureOn` at runtime but keeps a full fallback because it **loads before** stats-filters in `index.html`. Drift risk on 特徵 / 有分題 / 尚未輸入分題.
2. **題目 filters (~1.6k) vs 統計 filters (~1.7k)** — parallel tri-state / modal UI. Engine is shared; presentation is not. Unifying UI is **not** a no-UX guarantee (default `Out syl` excluded, optional filter visibility, etc.).
3. **AI解釋 filter** depends on an in-memory side-file index (`AiExplanation.store`), not bank fields — fine, but another path into `applyFilters` via `questionMatchesAiFilter`.

---

## 6. AI / feedback / admin hubs

| Feature | Access | Proxy | Admin surface |
| --- | --- | --- | --- |
| AI出題 | `accessRights.ai` + `poe-ai-allowed` | `Poe.proxyRequest` only | Usage tab inside Poe modal |
| AI解釋 | same AI gate | `Poe.proxyRequest` only (no git fallback) | Was standalone; now **delegates** to report-issue hub |
| 回報問題 | any signed-in known user | Prefer Poe, else `gitProxyRequest` | Combined「回饋／回報」 |
| 資料檢查 | ken + admin path | `gitProxyRequest` only | Own overlay |
| Stem review | AI gate | Poe | Own overlay |

**Three HTTP policies for one `/exec` URL** is the main boundary smell. Retries, cancel, and error codes differ between Poe and git helpers.

Modal Escape: `main.js` only closes Poe / stats-filter / filter-modal overlays. AI解釋, 回報問題, data-checks, bulk-edit bind Escape privately — workable today, easy to get wrong if consolidating.

---

## 7. CSS / JS duplication (concrete)

**Quick / safe no-UX candidates**

| Item | Where | Suggestion |
| --- | --- | --- |
| Local `esc` / `escapeHtml` | `ai-explanation.js`, `report-issue.js`, `data-checks.js`, `advanced-filter.js`, … | Use `utils.js` `escapeHTML` / `escapeAttr` |
| `formatWhen` | `ai-explanation.js`, `report-issue.js` (+ similar in Poe/stem) | One `formatDateTimeZhHk` |
| Non-Poe CSS inside `poe-modal.css` | `.ai-explain-*`, `.report-issue-*`, `.feedback-hub-*` | Split files; **same selectors** → no UX change |
| Code.gs missing mid-file banner | after issue-reports | Comment-only `// ===` |
| Script dependency comments | `index.html` | Document “ai-explanation after poe-*; feature helper should precede condition-match” |

**Medium / mostly safe (verify with filter + generate smoke)**

| Item | Suggestion | Care |
| --- | --- | --- |
| Username helpers | Single `currentUsername()` used everywhere | Empty-user edge cases |
| Shared proxy error table | Merge overlapping Traditional Chinese maps | Keep feature-specific strings |
| Move `questionFeatureOn` earlier (e.g. `question-fields.js`) | Delete `featureIsOn` duplicate | 特徵 / partsStatus regression |
| `mutateSharedJson_` for issue reports | Match AI explanations pattern | Auth + size limits stay per action |

**Large / recommendation only (not invisible)**

| Item | Why not “just do it” |
| --- | --- |
| Unify `Poe.proxyRequest` + `gitProxyRequest` | Retry/cancel/status UI differ |
| Shared modal shell + Escape ownership | z-index and Esc can change “what closes” |
| Merge 題目 vs 統計 filter UI | Counts / defaults / optional visibility |
| Stop bumping bank `SCHEMA_VERSION` for side-file-only features | Changes who may upload after deploy — ops policy |
| Split `Code.gs` into multiple `.gs` files | Redeploy process / Apps Script project layout |

---

## 8. Load order (`index.html`) — fragility

Actual order groups:

1. **Core:** globals → constants → config  
2. **Data:** auth → storage-core → storage-filters → schema-version → question-fields → storage-sync → **condition-match** → question-list-filter  
3. **Templates** → ui-bootstrap  
4. **UI logic:** utils → filters → … → **stats-filters** (defines `questionFeatureOn`) → … → github-sync → access-rights → shared-assets → data-checks → **poe-\*** → **ai-explanation** → **report-issue** → stem → **main**

Hard requirements today:

- `ai-explanation.js` **after** `poe-generate-client.js` (hard `Poe.proxyRequest`).
- `report-issue.js` after access-rights; prefers Poe but can fall back to git.
- Feature matching at **runtime** needs `questionFeatureOn` or the condition-match fallback — do not delete the fallback until the helper is loaded earlier.

Cache-bust `?v=` strings are uneven across files (ops only; not logic).

---

## 9. Prioritized recommendations

### P0 — Document / ops (no code)

1. Keep Apps Script redeploy checklist aligned with action map (AI解釋 + 回報問題 + bank schema gate).
2. Data-repo: stamp `schemaVersion: 5`; ensure `shared/data/issue-reports.json` bootstrap (this public agent cannot write that repo).
3. Decide SCHEMA policy: bank shape only vs “app contract” — document in README so future bumps are intentional.

### P1 — Quick wins (safe no-UX if done carefully)

1. Extract shared `formatDateTimeZhHk` + drop local `esc` wrappers.  
2. Split AI解釋 / 回報問題 CSS out of `poe-modal.css` (selectors unchanged).  
3. Comment-only: Code.gs section banner; `index.html` dependency notes.  
4. Add `mutateIssueReportsStore_` mirroring AI explanations (behavior-identical extract).

### P2 — Medium consolidations (tests / smoke required)

1. Own `questionFeatureOn` in an early module; remove `featureIsOn` duplicate.  
2. One username helper; shared base error map for proxy codes.  
3. Thin `proxyRequest` façade with Poe/git adapters (preserve generate cancel + git sync retries).

### P3 — Larger refactors (plan separately; UX risk)

1. Modal framework + Escape stack.  
2. Stats vs 題目 filter UI consolidation.  
3. Split Apps Script into multiple files / libraries.  
4. Decouple side-file contracts from bank `SCHEMA_VERSION`.

---

## 10. Explicit non-goals (this review)

- No wording, layout, color, or interaction changes.
- No new features.
- No data-repo commits from this site agent (no access).
- No Apps Script redeploy from this agent (manual paste → New version).

---

## 11. Suggested follow-up PR shape (if/when coding)

| PR | Scope | Must say in body |
| --- | --- | --- |
| A | CSS file split + shared date/escape helpers | **Strictly no UX change** |
| B | `questionFeatureOn` move + delete duplicate | No UX; smoke 特徵 + 分題狀態 filters |
| C | Code.gs `mutateIssueReportsStore_` extract + banner | Redeploy note; behavior-identical |
| D | SCHEMA policy doc only (README) | Ops; no runtime change |

Prefer shipping the **doc** first; open A–D only with explicit no-UX confirmation and a short smoke list.
