# filter-contract.kb.md — Shared Filter Contract

> 程式：`js/filter-contract.js`（合約＋`applyLegacyFilters`）；薄包裝 `js/storage-filters.js` 的 `applyFilters`  
> 規格：[`FILTER-SPEC.md`](../FILTER-SPEC.md)  
> 地圖：[`docs/filter-system-map.md`](../docs/filter-system-map.md)；題目 UI：[`js/filters.kb.md`](filters.kb.md)

## 流程

```mermaid
flowchart TD
  UI[題目 UI / 統計 UI]
  SFC["window.__SFC__"]
  CLI["node tools/sfc-apply.js"]
  Legacy[gatherFilterState / statsStateToFilters]
  Apply[applyLegacyFilters]
  List[題目列表 / 統計列]
  Workset[分類 workset JSON]

  UI --> Legacy --> Apply --> List
  SFC --> Apply
  SFC --> UI
  CLI --> Apply --> Workset
```

- 人繼續用現有篩選控件。瀏覽器裡的代理呼叫 `window.__SFC__`。沒有 `window` 時用 [`tools/sfc-apply.js`](../tools/sfc-apply.js)（同一套 apply，見 [`FILTER-SPEC.md`](../FILTER-SPEC.md) 第 10 節）。
- 空欄（空字串、空 tri map、`active: false`、空條件）＝不限制。
- 畫面初次的 `feature['Out syl']='excluded'` 是有值的預設，不是空合約。
- 篩選 JSON 是 session／query 狀態。不寫 IndexedDB、GitHub sync、題目匯入／匯出。

## 架構取捨／決策

| 選項 | 選擇 | 原因 |
| --- | --- | --- |
| 第二套篩選引擎 | **否** | `applyLegacyFilters` 就是原本 `applyFilters` 的本體 |
| Copy／Paste JSON 按鈕 | **否** | 代理用 `importFilterJSON`／`exportFilterJSON` |
| 題目與統計 | **同一 schema、`surface` 分開** | 統計的 `name` 搜尋不進題目文字；idSet／進階只在題目面 |
| 省略 idSet 的舊呼叫 | **仍繼承 `window.idSetFilter`** | `getQuestions({})` 等既有行為。合約套用本身不繼承 |
| 權限 | **仍先套 mock 權限** | 與 `applyPermissionFilter` 相同 |
| 無頭套用 | **載入同一批瀏覽器腳本**，呼叫 `applyQuestionsFilterContract`／`applyStatsFilterContract` | 不複製引擎。CLI 預設 `mockTests`＋`admin` 開，因為分片已在本機；`--no-mock-tests`／`--no-admin` 對齊未授權頁面 |
| 分類寫入 | **不經 CLI** | 仍只 `submitClassificationProposal` → staging |

## 修改史（決策型）

| 方向 | 說明 |
| --- | --- |
| v1 | 題目＋統計篩選 JSON；`__SFC__` 讀寫；引擎從 `storage-filters.js` 移入本檔 |
| 無頭 apply | `tools/sfc-apply.js` 載入本檔，產出分類 workset；不改 `applyLegacyFilters` 語意 |

## 待辦

- [ ] 統計模組仍未有專屬 `.kb.md`（篩選投影已走本合約）

## 文字版 E2E 測試描述

1. 開頁後 `window.__SFC__.readQuestionsFromUI().triState.feature['Out syl']` 為 `excluded`（使用者設定未改預設時）。  
2. `emptyQuestionsContract()` 套到含 Out syl 的列時，該列仍在（空＝不限制）。  
3. `importFilterJSON` 寫入 `有分題: checked` 後，題目列表只剩有分題；沒有 Copy／Paste 按鈕。  
4. 統計 `searchScope: 'name'` 的合約不依題幹文字縮小 `applyStatsFilterContract` 的結果。  
5. 題目 tab 有 idSet 時，統計計數不跟著縮小（統計投影帶停用的 idSet）。  
6. `node tests/filter-contract.test.js` 通過，並印出 `passed`。  
7. `node tools/sfc-apply.js --contract contract.json --shards database-hkeaa.json` 印出的 workset id 與同一合約的 `applyQuestionsFilterContract` 相同。`node tests/filter-contract-cli.test.js` 通過。
