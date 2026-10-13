# econ-database — Agent notes / AI 代理說明

## Purpose / 用途

First-bank JSON question database for HKDSE / related Economics past papers.
The question bank is not in this folder. Questions load from the private repository [mas-repo/econ-database-data](https://github.com/mas-repo/econ-database-data). **Load (Phase 2 merge-on-load):** when publisher shards exist, `mockTests` users fetch `shared/data/database-hkeaa.json` then `shared/data/database-aristo.json` and concat; non-mock users fetch **HKEAA only**. If shards fail, the client falls back to combined `shared/data/database.json` (plus existing mock strip). **Upload (Phase 3 dirty-shard):** partition IndexedDB by exact `publisher` (`HKEAA` / `雅集出版社`; reject empty/`-`/unknown), compare fingerprints (sorted ids + content) to cloud shards, and write **only dirty shards**. When any shard is dirty, also dual-write combined `database.json` as (local present shards) ∪ (cloud shards for publishers absent locally). **Safety:** if local has zero 雅集 rows, skip the aristo shard entirely (never upload an empty shard over cloud); same for HKEAA. After sign-in, Apps Script validates the username and may issue a short-lived **read-only** GitHub credential (`issueSharedReadToken`); the browser then fetches the bank and images from GitHub directly. If issuance is not configured, the page falls back to `fetchSharedAsset` through Apps Script. Diagrams and original crops use the same path. If the private-repo load fails, the page stays without questions and does not use a local copy.

Future agents editing mock papers or bulk fields: read this file first.
Records with reviewedByAI equal to Y must not be overwritten by builders that fill other fields. stemPatterns fills are additive (merge / union), not a wipe-and-replace of reviewed rows.

---

## 統計 tab

Top-level tabs are **題目** and **統計** (not separate 概念 / 課程分類 / 章節 / 題型 / 題幹模式 tabs). Layout inside **統計** (top → bottom):

1. Heading **統計**.
2. Classification warning (`#stats-classification-warning`): 「注意：目前的題目分類尚未完成，題目分類或會有所錯誤，切勿盡信。」
3. Shared filter bar (`#stats-filters`) — same registry as below.
4. Mode toggle **below the filters** (`aria-label="統計模式"`): **一維瀏覽** | **交叉分析** (`window.statsViewMode`: `browse` | `crosstab`). Switching rebuilds the filter bar (`hideOn` differs by mode).

Then:

- **一維瀏覽** — dimension switcher + cards. **交叉分析** — row/column axes. Both share one registry (`STAT_TABS` / `STAT_DIMENSION_GROUPS` in `js/stats-filters.js`). Groups: 主題標籤 | 試卷／表現／特徵 | 區間／衍生.
- Priority dims: 年份 / 考試 / 卷別 / Section / 題目類型 / 特徵 (admin blank features only when admin) / 分題表現 / 圖表·表格·計算·複選類型 (hidden when unused) / 出版商 + original 概念·課程·章節·題型·題幹模式.
- Binned: 答對率區間 `[0,20)…[80,100]`, 分數區間 `0–2…16+`, 題號區間 from id last digits `1–10…51–60` (plus 無* buckets). Jump uses matching range filters; empty buckets use id-set.
- Derived: 年份種類（日曆年 / Mock(MT) / 其他）, 分題狀態（有分題／沒有分題／尚未輸入分題）, 選項設計（skip if unused）. **Not** a grouping dim: AI解釋 (filter only; `requiresAi`).
- Cards have **詳細統計** and **查看題目**; crosstab cell click jumps with intersection filters. Local aggregation only (`js/stats-explore.js`).
- **詳細統計** modal: sort 題數／項目順序; columns 題數·佔比·MC·文字題·平均答對率／分數; row click jumps like crosstab (parent × secondary); choosable sections from `STAT_TABS` (parent dim auto-hidden); top-N + 展開全部; prefs in `localStorage` (`statsDetailPrefs.v1`).
- Legacy `switchTab('concepts'|…)` aliases open 統計 on that dimension.

---

## Field: year

- Type: string.
- **Calendar exams:** 4-digit years (`2016`, `2025`, …) — never rewritten.
- **Mock papers:** stored as `MT##` (`MT27`–`MT44`). Bare 1–3 digit values (`39`, `27`) are **auto-normalized to `MT##`** on form save, bulk edit, import/sync (`normalizeQuestion`), and IndexedDB write (`prepareQuestionForWrite`). Helper: `normalizeYear` in `js/question-fields.js`.
- Other tokens (`PP`, `SP`) stay as trimmed text.
- Filters/stats still match legacy bare digits and `MT##` via `normalizeYearFilterKey` (canonical key is the digits; UI label is `MT##`).

## Field: stemPatterns (題幹模式)

- Type: array of strings.
- Meaning: abstract stem templates — the reusable question shape, not the story details and not the syllabus topic name.
- Source of truth for the original taxonomy: Past Paper分類表 (2025).xlsx, sheet List, column 題型, and DSE sheet column 題型分析. Do not use the second Sheets bank for this field; that bank has no equivalent column.
- Distinct from patterns (題型標籤): patterns are format tags such as 填空, 複選組合, and similar. stemPatterns are reusable abstracted stems, for example 沒有稀少性，___________。 and (某人進行了某些行為) 需要向香港政府繳交哪些稅項？
- Distinct from concepts: concepts are topic / idea labels, not stem shapes.

Filter UI label: 🧩 題幹模式 (modal tri-state picker, same include / exclude behaviour as patterns).

---

## Writing rules for AI / AI 填寫規則

Derived from reviewing live values in the bank:

- Prefer an exact existing vocabulary string when the question shape matches. The canonical Excel set of 78 templates is still all in use; highest-frequency strings are the safest choices.
- Abstract concrete detail with placeholders: (某人), (某事件), (某物品), (某市場), (某廠商). Use blanks as ___________. Use full-width slash ／ for alternatives (e.g. 增加／減低).
- One reusable ask per template. Do not lock a template to hotel / concert / tunnel story details or to personal names.
- Do not put format tags (patterns) or lone concept names into stemPatterns.
- Leave stemPatterns as [] when question text is missing (currently 85 DSE Paper 2 rows for 2017–2023).
- Prefer merging into an existing high-frequency template over inventing a singleton. Many invented singletons (about 1161) still need curation.
- When builders run for other fields, never overwrite reviewedByAI Y rows; stemPatterns updates for those rows must stay additive.

---

## Related fields / 相關欄位

| Field | Label | Role |
| --- | --- | --- |
| patterns | 題型標籤 | Format / presentation tags (填空, 複選組合, …). Modal filter 🎯 題型. |
| stemPatterns | 題幹模式 | Abstract reusable stem templates. Modal filter 🧩 題幹模式. |
| concepts | 概念類型 | Syllabus / topic idea labels. Modal filter 💡 概念類型. |
| multipleSelectionType | 複選類型 | Single string for multiple-choice selection subtype when applicable. Modal filter 🔍 複選類型. |

---

## Data coverage snapshot / 資料覆蓋現況

- About 1897 questions total.
- About 1812 with nonempty stemPatterns; 85 empty (missing stem text cases above).
- Unique stemPatterns values about 1265, with substantial curation debt (many low-frequency invented templates).

---

## AI generation / 依篩選出題

The button **AI出題** is hidden until Apps Script returns `ai: true` for the signed-in username. The modal sends an editable 出題指示 with either the filtered questions or questions the user pasted. **Each reference sent to the model includes stem + answer** (Chi-first: `plainText` / `questionTextChi`, `answerMC` / `answerChi`; same fields as **複製篩選題目**; packed as `question` + `explanation`). It has four 出題模式 and a **測試** button that only pings the selected model. **API／模型設定** (separate modal) chooses provider **Poe** or **OpenRouter**, stores the matching personal API key, and picks the model (Poe allowlist, or OpenRouter preset + optional free-text model id). localStorage keys: `econ_ai_provider_v1`, `econ_poe_api_key_v1`, `econ_openrouter_api_key_v1`, `econ_ai_model_poe_v1`, `econ_ai_model_openrouter_v1`. Requests send `provider`, `model`, and either `poeApiKey` or `openRouterApiKey`. Apps Script routes to `api.poe.com` or `openrouter.ai` accordingly. Script property `POE_API_KEY` remains an admin-only Poe fallback; optional `OPENROUTER_API_KEY` is the same for OpenRouter. Non-admin users must enter their own browser key before **測試** or **出題** (`missing_api_key` otherwise). Keys are never written to UsageLog, GenerationBackup, GitHub AI backups, or response bodies. Result markdown is rendered by `js/poe-markdown.js`; use **放大檢視** for a near-fullscreen result pane. **追問 / 快捷追問:** after a completed reply, the result pane shows a follow-up composer + chips; turns call Apps Script `continueGeneration` with `messages[]` (same provider/key/model). Follow-ups do **not** re-send the full reference bank unless「一併附上參考題」is checked. Thread (`thread` / `originalContent`) persists on the local generation record; **再生成** starts a fresh generation; **清空追問** keeps the first reply. Follow `apps-script/README.md`. Put the deployed `/exec` URL in `js/config.js` as `POE_PROXY_WEB_APP_URL`. After a proxy change is merged, paste `apps-script/Code.gs` (and update `appsscript.json` whitelist) into the live Apps Script project and deploy a new version of the existing `/exec` URL (required for `continueGeneration`).

## 題幹模式檢視 / Stem-pattern AI review

Independent modal (`js/stem-pattern-review.js`), entry **題幹模式檢視** on the 題目 tab (shown with `ai: true`, next to AI出題 — not inside the AI出題 modal). Multi-select from the **current filtered** list (searchable; shows id + stem snippet + current `stemPatterns`). A switchable bulk-select control (**題幹** default | **題幹模式**) groups loaded rows by normalized stem text or by each `stemPatterns` tag and **adds** matching ids to the selection (alongside 全選可見 / per-row checkboxes). Sends question text + current classifications (`stemPatterns`, `patterns`, `concepts`) plus a sample of existing vocabulary to Apps Script action **`reviewStemPatterns`**, using the **same provider / model / API-key settings** as AI出題 (`Poe.withProviderAndApiKey` / `proxyRequest`). The model is asked whether stemPatterns are correct, whether the selected items should share a template, and to suggest corrected strings (prefer existing vocabulary). **Chat/transcript is local only** (`localStorage` key `econ_stem_review_history_v1`) — this path does **not** call `listAiBackups` / `getAiBackup` / `writeGitAiBackup`, and the server does not write a GenerationBackup sheet row for the reply. UsageLog may record metadata (no content). Anyone with `ai` may run the review; **only `accessRights.admin` may apply** stemPatterns edits (local `storage.updateQuestion`; `reviewedByAI === 'Y'` stays additive / will not wipe). Cap: 20 questions per request. **Redeploy** Apps Script after pulling `Code.gs` so `reviewStemPatterns` is live.

`js/data-checks.js` is ken + admin only (not the normal question-list UI). Condition matching is shared with 進階篩選 via `js/condition-match.js`. Each check has a **mode**: default **普通檢查** (`perQuestion`, omit or explicit) flags every condition match (minus exceptions); **同年跨卷重疊** (`crossPaperSameYear`) still AND-matches conditions, then groups by examination + year and hits only when ≥2 distinct non-empty `paper` values appear in that group — pending IDs are all matching IDs in hit groups minus exceptions. Results for cross-paper mode show a 重疊年份(+exam/卷別) summary plus pending IDs; mock years render as `MT##` (not `HKDSE 29`). Each check card’s **篩選全部待處理** applies an internal ID-set filter (`window.idSetFilter` / `js/question-list-filter.js`) for all pending IDs — not the comma search box — then lands on the 題目 tab. Remote sync (`syncDataChecksDownload` / `syncDataChecksUpload` → `shared/data/data-checks.json`) stays data-checks only; `normalizeCheck` / payload persist `mode`.

## 進階篩選 / Advanced filter (題目 tab)

**進階篩選** (`js/advanced-filter.js`) is an independent modal on the 題目 tab for every signed-in user. Rows are 包含／不包括 + field + value (AND), using the same `ConditionMatch` fields as 資料檢查. Applied conditions live in `window.advancedFilter` and intersect with search, tri-state, and range filters in `storage.applyFilters`. Local-only: memory and optional `localStorage` key `econ_advanced_filter_v1` for this browser — no GitHub / Apps Script / `syncDataChecks*` persistence. Clear with the green badge ✕, the modal’s **清除進階篩選**, or **重置篩選條件** (full reset). Bulk ID-set filters from 資料檢查 clear the same way (badge type 題目集合 / full reset).

**字串** field searches 題目（`questionTextChi` / `questionTextEng` / `plainText`）、答案（`answerMC` / `answerChi` / `answerEng`）、評卷報告（`markersReportChi` / `markersReportEng`）. Saved rows with `field: 'text'` keep working. Also available: **分題表現** / **分題分數** against `questionParts`.

## 分題 / questionParts + partsStatus

SQ/LQ sub-parts store as `questionParts: [{ label, marks, performance }, …]` (`SCHEMA_VERSION` 2). **`marks` (total) stays authoritative** — the form does not auto-sum parts into total. When one or more parts exist, **every part must have numeric `marks` and `sum(part.marks)` must equal total `marks`** (tolerance `0.001`; see `validatePartMarksSum` in `js/question-fields.js`). Empty/absent parts skip the sum check. Validation runs on the single-question form and the admin **批量編輯** modal. `performance` values are exactly: 優異、優良、良好、令人滿意、尚可、欠佳. Filters: 特徵 **有分題**; dropdown **分題表現**; advanced **分題表現** / **分題分數**.

**`partsStatus`** (`pending` \| `none` \| `filled`, `SCHEMA_VERSION` 4) distinguishes 尚未輸入分題 vs 沒有分題 vs 有分題. Nonempty `questionParts` → `filled`. Legacy empty/absent `questionParts` without an explicit status resolves as **`pending`** (not confirmed none). Form radios and stats「分題狀態」use this field. Filter modal「尚未輸入」sentinel is blank/`-`/empty array only; stored values like「沒有圖」「並非複選型」remain confirmed-none options for other feature fields.

## AI解釋

Per-question AI explanations live in the private side file `shared/data/ai-explanations.json` (not on the question object). Legacy question field `AIExplanation` (URL) is **ignored** by the UI. Gated by `accessRights.ai` (same as AI出題). Entry: 🤖 / **AI解釋** on each question card (`js/ai-explanation.js`).

- Generate: Apps Script `generateAiExplanation` (same provider / model / API-key settings as AI出題). Detail levels **簡短** / **詳盡**. Prompt payload always includes **Chinese + English** stem and answers; both detail levels ask for **bilingual** explanations.
- Existing explanations load from the side file (direct shared read preferred). Users with `ai` can **vote** (`voteAiExplanation`) and send text **feedback** (`feedbackAiExplanation`).
- Filter (題目 + 統計): AI解釋 — two-layer 有AI解釋 → indented 詳盡／簡短 → 沒有AI解釋 (`requiresAi`). Stats uses it as a **filter only**, never a grouping dimension.
- Admin can **delete one explanation** (`deleteAiExplanation`) from the AI解釋 modal or the「回饋／回報」AI tab. Admin lists feedback via `listAiExplanationFeedback` (see **回報問題** hub below). Redeploy Apps Script when these handlers change.

## 回報問題 + admin 回饋／回報

**回報問題** (`js/report-issue.js`): any **signed-in known user** can open the button on a question card. Tags: 有錯字 / 圖片未能正確顯示 / 分類不正確 / 其他 (+ optional text). Persists to `shared/data/issue-reports.json` via Apps Script `reportIssue`. Not gated on `ai` or `githubSync`.

**Admin hub:** when `accessRights.admin`, header shows **回饋／回報** (replaces the older standalone「AI解釋 Feedback」button). Tabs: **回報問題** (`listIssueReports`)、**AI解釋 Feedback** (`listAiExplanationFeedback`)、**分題審批** (`listQuestionPartsProposals`)、**分類審批** (`listClassificationProposals`). Newest first; refresh reloads all. Side-file contracts use bank `SCHEMA_VERSION` as a deploy gate (see `js/constants.js`).

## 分題提案審批 (staging)

Bulk fillers / agents must **not** write `questionParts` straight into `database.json`. They call Apps Script `proposeQuestionParts` (`admin` or `githubSync`), which upserts pending rows in `shared/data/question-parts-proposals.json` (one pending proposal per `questionId`). **Propose never touches the bank.**

Admins open **回饋／回報 → 分題審批**:
- **通過** → `approveQuestionPartsProposal` patches the shared bank under lock (`questionParts` + `partsStatus: filled`), validates part-marks sum vs `marks`, then **removes** the staging row. If the live question already has filled parts, the API returns `needsConfirm: true` (current vs proposed); the UI asks for overwrite and re-calls with `confirmOverwrite: true`.
- **拒絕** → `rejectQuestionPartsProposal` removes the staging row only.

Form / 批量編輯 can still edit parts directly on the bank. Redeploy Apps Script after merge. Coordinate staging file creation with **econ-database-data** (`shared/data/question-parts-proposals.json`).

## 分類提案審批 (staging)

**Only write path for classification:** 分類專員 → staging → 審批與回報 → 分類審批. Retired Python batch entry points: `archive/classification-python/`.

AI / review bots must **not** write `concepts` or `stemPatterns` straight into `database.json`. They call Apps Script `submitClassificationProposal` (`admin` or `githubSync`), which upserts pending rows in `shared/data/classification-proposals.json` (one pending proposal per `questionId`). Always-eligible fields: `concepts`, `stemPatterns`, `patterns`, `graphType`, `tableType`, `calculationType`, `multipleSelectionType`. Blank-only (empty bank only): `AristochapterClassification`, `curriculumClassification`, `questionParts`. **Submit never touches the bank.**

**Soft warn at 200:** when pending count ≥ 200, submit still accepts new `questionId`s and returns `{ ok:true, paused:true, pendingCount, pauseThreshold:200, message }` as a reminder for agents. The admin **分類審批** tab shows a warning banner when the backlog is at the threshold. Coordinator briefs 分類專員 when the soft pause is active.

**JSON shape (intake):**
```json
{
  "action": "submitClassificationProposal",
  "username": "…",
  "questionId": "DSE-…",
  "fields": ["concepts", "stemPatterns", "patterns", "graphType"],
  "currentValues": { "concepts": ["…"], "stemPatterns": ["…"], "patterns": [], "graphType": "" },
  "proposedValues": { "concepts": ["…"], "stemPatterns": ["…"], "patterns": ["…"], "graphType": "供求圖" },
  "reason": "optional",
  "confidence": "高|中|低|",
  "createdBy": "Econ 分類審核"
}
```
Batch: `{ "proposals": [ /* same fields */ ] }` (cap 200). Or append via PR to the staging file (same object shape under `proposals[]` with `status:"pending"`).

Admins open **回饋／回報 → 分類審批**:
- **通過** → `approveClassificationProposal` patches only the listed fields on the shared bank under lock, then **removes** the staging row. If any targeted field already has values **or** `reviewedByAI === 'Y'`, the API returns `needsConfirm: true`; the UI asks for overwrite and re-calls with `confirmOverwrite: true`.
- **拒絕** → `rejectClassificationProposal` removes the staging row only.
- Bulk approve / reject mirror 分題審批.

Redeploy Apps Script after merge (paste `apps-script/Code.gs` → New version, same `/exec`). Coordinate empty staging file with **econ-database-data** (`shared/data/classification-proposals.json`).

## 批量編輯 / Bulk edit (admin mode)

**批量編輯** (`js/bulk-edit.js`) is an independent modal shown only with `accessRights.admin` **and** 管理員模式 (`btn-admin-only`). It loads the **current filtered** 題目 list (cap 300 rows), one editable row per question. **Default columns:** 題目 ID (always visible, read-only), Chapters (`AristochapterClassification`), 課程分類 (`curriculumClassification`), total `marks`, and compact `questionParts` (`a,2,良好 | b,3,優良`). **欄位 picker** toggles extra editable fields (concepts, patterns, stemPatterns, graph/table/calculation/multiple-selection types, optionDesign, section, year, paper, publisher, examination, questionType); the choice is stored in this browser’s `localStorage` (`econ_bulk_edit_columns_v1`). List/tag fields use **token autocomplete** (current comma-separated token), reusing vocabulary from `CURRICULUM_ITEMS` / `CHAPTER_RANGE` (`Ch01`…`Ch29`) and `ConditionMatch.collectFieldValues` over the bank. Curriculum still accepts only `CURRICULUM_ITEMS`. Save writes only changed rows after confirm; part-sum validation applies. Uses existing IndexedDB update + optional 自動同步 — no separate upload path.

## 缺圖提醒 + 內嵌圖編輯 / Missing images UX

### Heuristics (缺圖提醒 panel + admin 特徵)

Admin header button **缺圖提醒** (`js/missing-images.js`) lists questions that still look like they need images. Checkboxes filter which heuristics apply (default: 缺內嵌圖 + 缺原題):

| Label | Heuristic |
| --- | --- |
| **缺內嵌圖** | `graphType` is set and not empty / `-` / `沒有圖`, but `inlineDiagrams` is blank. |
| **缺原題** / **缺原題圖片** | Both `originalQuestionImage` and `originalQuestionImageEng` blank (or `-`). |
| **缺答案原圖** | Both `originalAnswerImage` and `originalAnswerImageEng` blank (or `-`). |

Click a question id to open the edit form (admin) or fall back to 題目 ID filter. The same three labels are also admin-only 特徵 filters (`ADMIN_BLANK_FEATURE_ITEMS` in `js/constants.js` / matchers in `js/question-fields.js`).

### Edit form: inline diagrams

When editing a question (`js/templates/template-form.js`, `js/form-diagrams.js`):

- Preview existing `inlineDiagrams` paths via `hydrateSharedImages` / `data-shared-src`.
- **上載並加入** (requires `githubSync`): POST `uploadSharedAsset` → Apps Script writes the file under `shared/diagrams/…` with `GITHUB_TOKEN`, then appends `diagrams/…` to the comma-separated field (schema unchanged).
- Path text field remains for advanced edits; save still stores a string (comma-separated paths).
- Edit save **merges** with the existing IndexedDB row so `original*` / other non-form fields are not wiped.

### AI read image → description

- Buttons **AI 描述** (per preview) / **AI 描述本機檔** require `accessRights.ai` (same gate as AI出題).
- Client sends the image to Apps Script action `describeImage` (Poe/OpenRouter multimodal `image_url` data URL via the existing proxy).
- User must **confirm** before the short Traditional Chinese description is appended to **備註** as `【圖描述】…`. Stem fields are never overwritten.

**Redeploy Apps Script** after merge so `uploadSharedAsset` and `describeImage` exist on the live `/exec` deployment. Details: `apps-script/README.md`.

## Admin blank filters (admin only)

When `accessRights.admin === true`, 特徵 also offers **題目空白** / **答案空白** / **評卷報告空白** / **缺內嵌圖** / **缺原題圖片** / **缺答案原圖** (`js/question-fields.js`). Blank means empty, whitespace-only, or `-`. 題目 = Chi/Eng/plainText; 答案 = answerMC + answerChi/Eng; 評卷報告 = markersReportChi/Eng. Image heuristics: see **缺圖提醒** above. Non-admins do not see or apply these.

**過往紀錄 (cross-device):** Successful generations still save in this browser (`IndexedDB` / `localStorage`). When GitHub AI backups are configured, opening the modal also calls `listAiBackups` (auth: `ai`, not `githubSync`) and merges that user's private `users/<username>/<GITHUB_AI_BACKUP_DIR>/` replies into the same list (deduped). List pages are lean (preview only); opening a row loads the full reply with `getAiBackup`, including chunked reads for very long text. Long `generateQuestions` replies may also arrive with `contentViaBackup` so the browser fetches the backup instead of parsing an oversized web-app body. Each request returns 30 backups, newest first; the modal can open older pages. Search matches only the page on screen. Remote failures stay non-blocking. Incomplete runs still stay in 使用紀錄. Details: `apps-script/README.md`.

## Git sync / Git 同步 (admin only)

**自動同步**, **上傳到 GitHub**, and **從 GitHub 載入** appear only when Apps Script returns `githubSync: true`. That flag is the **admin** role (`ALLOWED_ADMIN_HASHES`). AI editors, mock-only, and restricted users must never see these controls. **AI出題** / **AI解釋** use the separate `ai` flag. Do not show GitHub UI based on the legacy `allowed` flag (`allowed` mirrors `githubSync` only for older Pages builds). An AI editor can use AI出題 and mock tests and does not see this panel. The Auto-sync checkbox is stored only in that browser’s `localStorage`. The page POSTs the question JSON to the same Apps Script `/exec` URL. It does not call GitHub and it must not contain a token, owner, or repository name.

### schemaVersion (shared bank)

Shared bank JSON (`shared/data/database.json`) carries an integer root field `schemaVersion` (client constant `SCHEMA_VERSION` in `js/constants.js`, helpers in `js/schema-version.js`). Bump only when the data shape changes so an older writer would drop fields. **Missing `schemaVersion` is treated as `0`** (banks written before this guard). Distinct from export metadata `version: '1.0'`. Current client stamp: **8** (v8 = 分類提案 staging).

| Version | Shape change |
| --- | --- |
| 2 | `questionParts` `[{ label, marks, performance }]` |
| 3 | AI解釋 side-file contract (`shared/data/ai-explanations.json`); legacy `AIExplanation` URL ignored |
| 4 | `partsStatus` `pending` \| `none` \| `filled` |
| 5 | 回報問題 side-file contract (`shared/data/issue-reports.json`) |
| 6 | issue-reports + AI解釋 feedback `status` (open\|resolved) |
| 7 | 分題提案 staging (`shared/data/question-parts-proposals.json`) |
| 8 | 分類提案 staging (`shared/data/classification-proposals.json`; multi-field; soft warn ≥200) |

- **Upload / auto-sync:** before `syncDataUpload`, the client reads the cloud file and **blocks** if local `SCHEMA_VERSION` &lt; cloud `schemaVersion`, with a Traditional Chinese error (cloud written by a newer app — update before uploading). No merge that strips unknown fields. **Apps Script `handleGitUpload_` enforces the same gate** (`schema_version_stale` + client/cloud versions) and preserves `schemaVersion` / unknown top-level keys on write. Redeploy `Code.gs` after that change.
- **Load / download / file import:** if cloud/file `schemaVersion` &gt; local, show a **warning notification** asking the user to update. If the payload has no usable `questions` array, the load fails clearly instead of half-importing. `syncDataDownload` returns `schemaVersion` for client notify.
- Writes stamp the current `SCHEMA_VERSION`.
- **econ-database-data:** stamp live `shared/data/database.json` with the current client `SCHEMA_VERSION` when ready (private-repo follow-up; this public site does not write it). Feature UX for partsStatus / AI解釋 / 回報問題 is documented in the sections above.

Set `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_DATA_PATH`, and `GITHUB_AI_BACKUP_DIR` in Apps Script Script properties, then redeploy. `GITHUB_TOKEN` is a fine-grained PAT with Contents **read and write** on the private data repository only — used only on the server for uploads and AI backups; never sent to the browser. For direct browser reads of large shared files, also set either the GitHub App trio (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`) or a separate Contents:**Read** PAT as `GITHUB_READ_TOKEN`. Never commit those values. Question-bank upload/download uses the **shared** path `<GITHUB_SHARED_PREFIX>/<GITHUB_DATA_PATH>` (recommended `GITHUB_DATA_PATH` = `data/database.json` → `shared/data/database.json`). Every `githubSync` user reads and writes that same file; username is for auth only and must not appear in the bank path. Personal AI出題 reply backups stay under `users/<username>/` plus `GITHUB_AI_BACKUP_DIR`. `<username>` is the trimmed, lowercased signed-in name. The page does not choose those paths.

`GITHUB_SHARED_PREFIX` is optional and defaults to `shared`. A known username (admin, AI editor, mock, or restricted) can read shared bank JSON (combined `database.json` and publisher shards `database-hkeaa.json` / `database-aristo.json`), `shared/diagrams/`, `shared/originals/`, and `shared/papers/` after Apps Script issues a read credential (or via `fetchSharedAsset` / `listSharedData` fallback). Those actions never return the write token. An unknown username does not receive the bank or a read token. Without `mockTests`, load prefers the HKEAA shard (no 雅集 download); on combined-file fallback the client (or proxy) strips mock-test rows from `database.json`, and mock-only paths are refused (`diagrams/`, `papers/mock-tests/`, numbered `originals/` folders, `build/`, `database.js`, and `database-aristo.json`). Past papers under `originals/dse/` and `papers/past-papers/` stay available. **Phase 3 safety:** uploading with HKEAA-only IndexedDB updates the HKEAA shard (if dirty) and rebuilds combined using cloud 雅集 for the missing publisher — it does **not** wipe `database-aristo.json`. Unknown publishers are rejected. Details: `apps-script/README.md`.

## Classification write path (only) / 分類寫入路徑（唯一）

**Do not write classification fields (`concepts`, `stemPatterns`, `patterns`, type scalars, chapters, curriculum, `questionParts`, …) straight into `database.json` / publisher shards** from Python, local batch scripts, or ad-hoc GitHub Contents API edits.

Canonical path:

1. **分類專員** (or any `admin` / `githubSync` bot) proposes via Apps Script **`submitClassificationProposal`** (batch OK; soft `paused` warn when pending ≥ 200 — intake still open; coordinator briefs 分類專員).
2. Rows land in private **`shared/data/classification-proposals.json`** only — staging never patches the bank.
3. Human opens **回饋／回報 → 分類審批**, then **通過** / **拒絕** (`approveClassificationProposal` / `rejectClassificationProposal` + bulk).

Details: `docs/classification-proposals.md`.

### Deprecated: Python batch / local classify scripts

Old entry points (`apply_stem_patterns_import.py`, `auto_assign_stem_patterns.py`, `fuzzy_assign_stem_patterns.py`, `merge_stem_pattern_classifications.py`, `classify_chunks/`, and any local “how to run classify” that wrote the DB) are **retired**. Inventory and policy: **`archive/classification-python/`**. Those files were documented under `scripts/` but were never shipped in this public tree; do not reintroduce them as live writers.

**Still keep:** `vocabulary.json` + concept/stem conventions, writing-rule / tip notes in this README and `_readme_stem_stats.md`, validation/reconciliation in the app (`js/data-checks.js`, stats), and historical `reviewedByAI Y` samples. stemPatterns updates for reviewed rows remain additive when applied through admin approve or in-app edit — never a wipe-and-replace from a batch builder.
