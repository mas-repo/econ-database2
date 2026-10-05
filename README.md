# econ-database — Agent notes / AI 代理說明

## Purpose / 用途

First-bank JSON question database for HKDSE / related Economics past papers.
The question bank is not in this folder. Questions load from the private repository [mas-repo/econ-database-data](https://github.com/mas-repo/econ-database-data) (`shared/data/database.json`). After sign-in, Apps Script validates the username and may issue a short-lived **read-only** GitHub credential (`issueSharedReadToken`); the browser then fetches the bank and images from GitHub directly. If issuance is not configured, the page falls back to `fetchSharedAsset` through Apps Script. Diagrams and original crops use the same path. If the private-repo load fails, the page stays without questions and does not use a local copy.

Future agents editing mock papers or bulk fields: read this file first.
Records with reviewedByAI equal to Y must not be overwritten by builders that fill other fields. stemPatterns fills are additive (merge / union), not a wipe-and-replace of reviewed rows.

---

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

The button **AI出題** is hidden until Apps Script returns `ai: true` for the signed-in username. The modal sends an editable 出題指示 with either the filtered questions or questions the user pasted. It has four 出題模式 and a **測試** button that only pings the selected model. **API／模型設定** (separate modal) chooses provider **Poe** or **OpenRouter**, stores the matching personal API key, and picks the model (Poe allowlist, or OpenRouter preset + optional free-text model id). localStorage keys: `econ_ai_provider_v1`, `econ_poe_api_key_v1`, `econ_openrouter_api_key_v1`, `econ_ai_model_poe_v1`, `econ_ai_model_openrouter_v1`. Requests send `provider`, `model`, and either `poeApiKey` or `openRouterApiKey`. Apps Script routes to `api.poe.com` or `openrouter.ai` accordingly. Script property `POE_API_KEY` remains an admin-only Poe fallback; optional `OPENROUTER_API_KEY` is the same for OpenRouter. Non-admin users must enter their own browser key before **測試** or **出題** (`missing_api_key` otherwise). Keys are never written to UsageLog, GenerationBackup, GitHub AI backups, or response bodies. Result markdown is rendered by `js/poe-markdown.js`; use **放大檢視** for a near-fullscreen result pane. Follow `apps-script/README.md`. Put the deployed `/exec` URL in `js/config.js` as `POE_PROXY_WEB_APP_URL`. After a proxy change is merged, paste `apps-script/Code.gs` (and update `appsscript.json` whitelist) into the live Apps Script project and deploy a new version of the existing `/exec` URL.

`js/data-checks.js` is ken + admin only (not the normal question-list UI). Condition matching is shared with 進階篩選 via `js/condition-match.js`. Each check card’s **篩選全部待處理** applies an internal ID-set filter (`window.idSetFilter` / `js/question-list-filter.js`) for all pending IDs — not the comma search box — then lands on the 題目 tab. Remote sync (`syncDataChecksDownload` / `syncDataChecksUpload` → `shared/data/data-checks.json`) stays data-checks only.

## 進階篩選 / Advanced filter (題目 tab)

**進階篩選** (`js/advanced-filter.js`) is an independent modal on the 題目 tab for every signed-in user. Rows are 包含／不包括 + field + value (AND), using the same `ConditionMatch` fields as 資料檢查. Applied conditions live in `window.advancedFilter` and intersect with search, tri-state, and range filters in `storage.applyFilters`. Local-only: memory and optional `localStorage` key `econ_advanced_filter_v1` for this browser — no GitHub / Apps Script / `syncDataChecks*` persistence. Clear with the green badge ✕, the modal’s **清除進階篩選**, or **重置篩選條件** (full reset). Bulk ID-set filters from 資料檢查 clear the same way (badge type 題目集合 / full reset).

**過往紀錄 (cross-device):** Successful generations still save in this browser (`IndexedDB` / `localStorage`). When GitHub AI backups are configured, opening the modal also calls `listAiBackups` (auth: `ai`, not `githubSync`) and merges that user's private `users/<username>/<GITHUB_AI_BACKUP_DIR>/` replies into the same list (deduped). List pages are lean (preview only); opening a row loads the full reply with `getAiBackup`, including chunked reads for very long text. Long `generateQuestions` replies may also arrive with `contentViaBackup` so the browser fetches the backup instead of parsing an oversized web-app body. Each request returns 30 backups, newest first; the modal can open older pages. Search matches only the page on screen. Remote failures stay non-blocking. Incomplete runs still stay in 使用紀錄. Details: `apps-script/README.md`.

## GitHub sync buttons (admin only)

**自動同步**, **上傳到 GitHub**, and **從 GitHub 載入** appear only when Apps Script returns githubSync: true. That flag is the admin role (ALLOWED_ADMIN_HASHES). In production the admin role only (`ALLOWED_ADMIN_HASHES`). AI editors and restricted users must never see these controls. AI出題 uses the separate i flag. Do not show GitHub UI based on a combined legacy llowed flag.

## Git sync / Git 同步

**自動同步**, **上傳到 GitHub**, and **從 GitHub 載入** appear only when `githubSync` is true. That flag is the admin role. An AI editor can use AI出題 and mock tests and does not see this panel. The checkbox is stored only in that browser. The page POSTs the question JSON to the same Apps Script `/exec` URL. It does not call GitHub and it must not contain a token, owner, or repository name.

Set `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_DATA_PATH`, and `GITHUB_AI_BACKUP_DIR` in Apps Script Script properties, then redeploy. `GITHUB_TOKEN` is a fine-grained PAT with Contents **read and write** on the private data repository only — used only on the server for uploads and AI backups; never sent to the browser. For direct browser reads of large shared files, also set either the GitHub App trio (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`) or a separate Contents:**Read** PAT as `GITHUB_READ_TOKEN`. Never commit those values. Question-bank upload/download uses the **shared** path `<GITHUB_SHARED_PREFIX>/<GITHUB_DATA_PATH>` (recommended `GITHUB_DATA_PATH` = `data/database.json` → `shared/data/database.json`). Every `githubSync` user reads and writes that same file; username is for auth only and must not appear in the bank path. Personal AI出題 reply backups stay under `users/<username>/` plus `GITHUB_AI_BACKUP_DIR`. `<username>` is the trimmed, lowercased signed-in name. The page does not choose those paths.

`GITHUB_SHARED_PREFIX` is optional and defaults to `shared`. A known username (admin, AI editor, or restricted) can read `shared/data/database.json`, `shared/diagrams/`, `shared/originals/`, and `shared/papers/` after Apps Script issues a read credential (or via `fetchSharedAsset` / `listSharedData` fallback). Those actions never return the write token. An unknown username does not receive the bank or a read token. Without `mockTests`, the client (or proxy) strips mock-test rows from `database.json` and refuses mock-only paths (`diagrams/`, `papers/mock-tests/`, numbered `originals/` folders, `build/`, and `database.js`). Past papers under `originals/dse/` and `papers/past-papers/` stay available. Details: `apps-script/README.md`.

## Import scripts / 匯入腳本

Under scripts/:

- apply_stem_patterns_import.py — apply classifications from the Excel taxonomy into the JSON bank / vocabulary.
- auto_assign_stem_patterns.py (auto_assign) — high-confidence automatic assignment pass.
- fuzzy_assign_stem_patterns.py (fuzzy_assign) — fuzzy matching assign pass.
- merge_stem_pattern_classifications.py — merge classification outputs.
- classify_chunks/ — chunked classification work products.

stemPatterns fills from these tools are additive. Builders that update unrelated fields must not clear or replace reviewedByAI Y records.
