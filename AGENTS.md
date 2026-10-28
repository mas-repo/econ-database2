# AGENTS.md — econ-database2（AI 代理地圖）

> **地圖／目錄，不是百科。** 細節放在各模組旁的 `*.kb.md` 與既有 `docs/*`。  
> 改完某模組後，**同一 PR 必須更新對應 `.kb.md`**（每個新 chat ≈ 新交接）。

## 這是什麼 repo

| 項目 | 說明 |
| --- | --- |
| 產品 | HKDSE 經濟科題庫前端（GitHub Pages 靜態站） |
| 公開 repo | `mas-repo/econ-database2`（本 repo） |
| 題庫／side files | **私有** `mas-repo/econ-database-data`（`shared/data/…`） |
| 後端代理 | Google Apps Script（`apps-script/Code.gs`）→ Poe／OpenRouter／GitHub |
| Fork 推送 | 需要時用 **OutliersEcon** fork；**合併 PR 用 mas-repo 帳號** |

題目 JSON **不** 放在本 repo。讀寫題庫經 Apps Script／短命 read token。

## 硬規則（Hard rules）

1. **分類欄位禁止直寫共用題庫**  
   `concepts`／`stemPatterns`／`patterns`／類型 scalars／chapters／curriculum／`questionParts` 等，**只** 走 staging：`submitClassificationProposal` → admin 審批。  
   禁止 Python／腳本／Contents API 直接改出版社分片（`database-hkeaa.json`／`database-aristo.json`）。合併 `database.json` 已停用，不要重建。詳見 [`docs/classification-proposals.md`](docs/classification-proposals.md)。

2. **Shard-only 上傳**  
   上傳時依 `publisher`（`HKEAA`／`雅集出版社`）只寫 dirty shard。本地某出版社 0 列 → **跳過** 該 shard（勿用空檔覆蓋雲端）。不寫 combined `database.json`。詳見 [`js/github-sync.kb.md`](js/github-sync.kb.md)。

3. **軟暫停 ≥200 pending 分類提案**  
   `pendingCount >= 200` 時 intake **仍接受** 新 `questionId`；回傳 `paused:true` 僅提醒 backlog，不是硬拒絕。

4. **模組變更 → 更新 `.kb.md`**  
   同一 PR 內更新對應知識檔；新模組則新增 `*.kb.md` 並掛進本地圖。

5. **Docs-only PR 勿bump `APP_VERSION`**（除非真的改了 cache-bust JS／HTML）。

## 知識檔地圖（colocated `*.kb.md`）

| 路徑 | 範圍 |
| --- | --- |
| [`js/report-issue.kb.md`](js/report-issue.kb.md) | 回饋／回報 hub：local-first；關窗立即 hide + 背景 flush（.36）；批次 validate-then-commit flush（.37）；題目卡 ✓／✕（.30）+ 提案預覽（.33）；外層跟「自動同步」`readAutoSync`／chip（.31）；flush 跳過失敗＋`console.error`（.34）；待上傳佇列檢視／撤銷（.35） |
| [`js/filters.kb.md`](js/filters.kb.md) | 題目篩選；特徵 vs admin「空白／缺漏」（含有未審批事項）；考生表現 |
| [`js/filter-contract.kb.md`](js/filter-contract.kb.md) | Shared Filter Contract v1：`window.__SFC__` 讀寫同一套篩選；空欄＝不限制 |
| [`tools/sfc-apply.kb.md`](tools/sfc-apply.kb.md) | 無頭套用：`node tools/sfc-apply.js` 用同一套 apply 把分片濾成分類 workset |
| [`js/github-sync.kb.md`](js/github-sync.kb.md) | 題庫 load／save、shards、dirty upload、schemaVersion |
| [`js/shared-assets.kb.md`](js/shared-assets.kb.md) | 短命 read token、共用資產讀取、shards-only bank load（combined 已停用） |
| [`js/ai-explanation.kb.md`](js/ai-explanation.kb.md) | AI解釋 side-file；`accessRights.ai`；Poe proxy |
| [`js/storage-core.kb.md`](js/storage-core.kb.md) | IndexedDB 本地鏡像 vs GitHub 真相來源 |
| [`js/stats-explore.kb.md`](js/stats-explore.kb.md) | 統計 tab（一維瀏覽／交叉分析）、詳細統計 modal；點背景關閉跟 `shouldCloseOnBackdropClick`／`ui.closeOnBackdropClick`（.38） |
| [`apps-script/AGENTS.md`](apps-script/AGENTS.md) | Apps Script 目錄入口 |
| [`apps-script/Code.kb.md`](apps-script/Code.kb.md) | staging／approve、clasp deploy |
| [`.github/workflows/deploy-pages.kb.md`](.github/workflows/deploy-pages.kb.md) | Pages 部署（runtime-only `_site`、concurrency、pre-deploy checks） |

慣例說明：[`docs/agent-knowledge-convention.md`](docs/agent-knowledge-convention.md)。

## 既有長文 docs（勿整份複製；指向即可）

| 文件 | 用途 |
| --- | --- |
| [`docs/classification-proposals.md`](docs/classification-proposals.md) | 分類 staging SOP、欄位表、soft pause、審批 UI |
| [`FILTER-SPEC.md`](FILTER-SPEC.md) | 篩選合約 v1（人用 UI、代理用 `window.__SFC__`） |
| [`docs/filter-system-map.md`](docs/filter-system-map.md) | 篩選架構地圖（題目／統計／進階／ConditionMatch） |
| [`docs/architecture-review-2026-10-09.md`](docs/architecture-review-2026-10-09.md) | 系統草圖、模組耦合、Apps Script 表面 |
| [`docs/filters-review-2026-10-09.md`](docs/filters-review-2026-10-09.md) | 篩選痛點與改進清單（歷史） |
| [`README.md`](README.md) | 人類／代理長說明（欄位、統計、同步） |
| [`apps-script/README.md`](apps-script/README.md) | 部署、角色 hash、action 清單 |

## 資料 repo 活索引（分類專員）

- Living index：`econ-database-data` / `shared/data/classification-index.json`
- SOP：`shared/data/CLASSIFICATION_INDEX_SOP.md`
- `vocabulary.json` = 舊扁平快照；優先用 index（counts + `exemplarIds`）
- 優先 `concepts` + `stemPatterns`；寫入仍只走 staging

## 已知產品決策（摘要）

| 決策 | 選擇 |
| --- | --- |
| 分類寫入 | staging only；人審後才進 bank |
| Soft pause | ≥200 pending；intake 仍開 |
| 特徵「有分題」 | 特徵內 **只有**「有分題」；「沒有分題」不在 `FEATURE_ITEMS`（狀態用 `partsStatus`／admin 空白） |
| 空白／缺漏 | admin-only `ADMIN_BLANK_FEATURE_ITEMS`，**不** 併入特徵 |
| UI「考生表現」 | 原「分題表現」改名；storage keys 不變（`partPerformance`） |
| Approve unlock | Hub：pendingOps＋關窗立即 hide＋背景 flush（.36）；`.37` `flushStagingApprovals` 批次寫入。題目 tab：跟 `readAutoSync` 即時 flush 或留 queue＋「立即上傳」chip；`beforeunload` 有 pending 時 |
| HKEAA vs 雅集 | 可分屬不同 shard 檔 |
| Bank I/O | shards-only。`database.json` 已停用（D4–D12）；schema／上傳／approve 都不讀寫它 |
| Pages 產物 | 只發布 runtime 靜態前端；pre-deploy 失敗唔上傳／唔上線（見 deploy-pages.kb） |
| PR 流程 | OutliersEcon 推 branch；mas-repo merge |

## 建議閱讀順序（新 chat）

1. 本檔（地圖）  
2. 你要改的模組的 `*.kb.md`  
3. 相關 `docs/*` 長文（需要時）  
4. 程式本體  

## 待補知識檔（尚未 colocate）

`js/stats-filters.js`、`js/poe-generate-*.js`、`js/forms.js`／`bulk-edit.js`、`js/data-checks.js` 等 — 改到時再補 `.kb.md`。