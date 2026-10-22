# 分類提案 staging

**Canonical write path:** 分類專員 → Apps Script `submitClassificationProposal` (staging) → admin **回饋／回報 → 分類審批**. Do **not** write classification fields into `database.json` / shards from Python batch scripts or other bypasses. Retired Python entry points: [`../archive/classification-python/`](../archive/classification-python/).

## Staging path

`shared/data/classification-proposals.json` in **econ-database-data**

```json
{
  "schemaVersion": 1,
  "updatedAt": "",
  "proposals": []
}
```

## Field key mapping (bank names)

### Always-eligible（可覆寫；已有值時審批需確認）

| UI label | Bank field | Kind | Notes |
| --- | --- | --- | --- |
| 概念 | `concepts` | string[] | existing |
| 題幹模式 | `stemPatterns` | string[] | existing |
| 題型 | `patterns` | string[] | **not** `questionType`（MC／文字題） |
| 圖表類型 | `graphType` | string | scalar（非 `diagramTypes`） |
| 表格類型 | `tableType` | string | scalar（非 `tableTypes`） |
| 計算類型 | `calculationType` | string | scalar（非 `calculationTypes`） |
| 複選類型 | `multipleSelectionType` | string | scalar（非 `multipleSelectionTypes`） |

### Blank-only（僅當題庫此欄空白／missing 才可提案或通過）

| UI label | Bank field | Kind | Empty means |
| --- | --- | --- | --- |
| Chapters | `AristochapterClassification` | string[] | `[]` / missing |
| 課程分類 | `curriculumClassification` | string[] | `[]` / missing |
| 分題 | `questionParts` | `{label,marks,performance}[]` | no parts / `partsStatus` not `filled` |

Approve UI shows a **空白才寫** pill and disables **通過此欄** when `currentValues` already have data. Apps Script **refuses overwrite** for blank-only fields even with `confirmOverwrite` (`blank_only_filled`); those fields are dropped from the staging row.

On submit, if `currentValues` for a blank-only field is non-empty, that field is **soft-skipped** (other fields in the same proposal still stage).

## Intake (preferred): Apps Script

`POST` action `submitClassificationProposal` (`admin` or `githubSync`).

- Upserts **one pending row per `questionId`**.
- Never writes `database.json` / shards.
- When `proposals.length >= 200`, submit **still accepts** new `questionId`s. Response includes a soft signal:

```json
{ "ok": true, "paused": true, "pendingCount": 200, "pauseThreshold": 200, "message": "…" }
```

Agents should treat `paused:true` as a backlog reminder (not a hard reject). Coordinator briefs 分類專員 when the soft pause is active.

### Single proposal body

| Field | Notes |
| --- | --- |
| `questionId` | required |
| `fields` | bank keys from the tables above (inferred from `proposedValues` / top-level convenience keys if omitted) |
| `currentValues` | optional snapshot; used for blank-only soft skip + approve UI |
| `proposedValues` | required for targeted fields. Lists = `string[]` (empty clears). Scalars = `string` (empty clears; `["x"]` also accepted). `questionParts` = parts array (empty clears → `partsStatus: none`) |
| `reason` | optional string |
| `confidence` | `高` / `中` / `低` / empty |
| `createdBy` | optional agent name (defaults to username) |

Convenience: top-level `concepts`, `stemPatterns`, `patterns`, `graphType`, …, `questionParts` map into `proposedValues` when omitted there.

Batch: `{ "proposals": [ … ] }` (cap 200 per call).

### Alternate: file PR (staging file only)

Append objects to `proposals[]` with the same fields plus `id`, `createdAt`, `status:"pending"`. Prefer the API so upsert + soft `paused` signal stay consistent. **Never** PR direct edits to `database.json` / shards for classification.

## Human review

Admin → **回饋／回報 → 分類審批**:

- Per-field controls: **通過此欄** / **保留原值** for each staged field; row-level **通過全部欄位** / **全部保留原值** still available.
- Proposed values are editable before approve (`approveFields` + `values`). Empty list/scalar/parts **clears** that bank field (UI **清空** pill + confirm).
- **保留原值** → `rejectClassificationProposal` with optional `rejectFields`: drop those fields from staging (or the whole row); does **not** write the bank.
- Partial approve/reject leaves remaining fields on the staging row until all are decided.
- Always-eligible overwrite confirm when a targeted approve field is already non-empty **or** `reviewedByAI === 'Y'` (`confirmOverwrite: true`).
- Blank-only: UI + server enforce empty-only; no overwrite path.
- Approve bank writes patch the **owning publisher shard only**. Combined `database.json` is obsolete and is not written.
- Warning banner when pending ≥ 200 (intake still open).

## Redeploy

After merging app changes that touch `apps-script/Code.gs`, paste into the bound Apps Script project and **Manage deployments → Edit → New version** (keep the same `/exec` URL), or `clasp push` + deploy new version when clasp is configured.

## Living classification index (neighbors)

Classifiers (**分類專員**) should consult the living index in the private data repo before proposing:

- **File:** `econ-database-data` / `shared/data/classification-index.json` (auto-derived; rebuild after approve batches)
- **SOP:** `shared/data/CLASSIFICATION_INDEX_SOP.md`
- **Legacy:** `vocabulary.json` is a flat snapshot only - prefer the index for counts + `exemplarIds`

### Classifier rules (2026-10-14)

1. **Seek neighbors** - load index labels and sample exemplar / same curriculum·chapter questions when classifying.
2. **Prefer canonical** labels from the index when a match exists.
3. **New values allowed** - if no good precedent, create a clear new concept / stemPattern / pattern / graphType / tableType / calculationType / multipleSelectionType; set `confidence` appropriately.
4. **`reason` is optional** - omit when empty; do not invent filler. Schema validation must not require it.
5. **`nearestExamples` (optional)** - question ids consulted as neighbors may be included for reviewers; not required.
6. Write path unchanged: only `submitClassificationProposal` to staging; never write the bank or the index by hand.
\n