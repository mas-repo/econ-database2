# FILTER-SPEC.md — econ-database2 篩選合約 v1

人用畫面上的篩選。代理讀寫**同一套**篩選狀態，只經 `window.__SFC__`。  
空欄代表不限制。這份 JSON 是這一次工作階段的查詢狀態，不是題目資料。

實作：[`js/filter-contract.js`](js/filter-contract.js)。  
引擎仍是原本的 `applyFilters` 本體（現名 `applyLegacyFilters`）。`IndexedDBStorage.applyFilters`、`gatherFilterState`、`statsStateToFilters` 都走它。

測試：`node tests/filter-contract.test.js`

---

## 1. 不在範圍內

| 項目 | 做法 |
| --- | --- |
| 題目 JSON／shards／同步 payload | 不讀、不寫 |
| IndexedDB | 不存放篩選合約 |
| 題目匯入／匯出 | 不夾帶篩選合約 |
| Copy JSON／Paste JSON 按鈕、剪貼簿對話框 | **沒有**。不要加 |
| 進階篩選草稿的既有 `localStorage`（`econ_advanced_filter_v1`） | 維持原產品行為；合約本身不寫入 |

畫面預設「Out syl = excluded」會讓超綱題不出現。那是**有值的欄位**，不是空合約。`emptyQuestionsContract()`／`emptyStatsContract()` 才是完全不限制（仍會先過 mock 試卷權限）。

---

## 2. 版本

`version` 必須是 `1`。缺省當 1。其他數字會拋 `Unsupported filter contract version`。  
不認識的欄位略過。缺的欄位當不限制。

---

## 3. `window.__SFC__`

| 方法 | 作用 |
| --- | --- |
| `importFilterJSON(json)` | 接受 JSON **字串或物件**。寫進對應 UI，並刷新題目列表／統計（函式存在時）。回傳 Promise，解析成下方的 bundle 物件 |
| `exportFilterJSON()` | 回傳 bundle 的 JSON 字串 |
| `readQuestionsFromUI()` | 題目篩選快照（物件） |
| `writeQuestionsToUI(contract)` | 寫入題目篩選。可回傳 `filterQuestions()` 的 Promise |
| `readStatsFromUI()` | 統計篩選快照。第一次讀會建立統計預設狀態（含 Out syl excluded） |
| `writeStatsToUI(contract)` | 寫入共用的統計篩選狀態，頁碼回到 1 |
| `applyQuestionsFilterContract(questions, contract)` | 只依合約過濾，**不**繼承 `window.idSetFilter`／`window.advancedFilter` |
| `applyStatsFilterContract(questions, contract, omitKey?)` | 同統計投影。`omitKey` 只給「打開某一維時不要用自己縮小選項」 |
| `emptyQuestionsContract()` | 題目面的不限制合約 |
| `emptyStatsContract()` | 統計面的不限制合約 |
| `version` | `1` |

`importFilterJSON` 認三種形狀：

1. Bundle：有 `questions` 和／或 `stats`（可帶 `app`）
2. `"surface": "stats"` 的單面合約
3. 其餘物件當題目面

套用函式若收到 bundle，會取對應的那一面。

---

## 4. Bundle

```json
{
  "version": 1,
  "app": "econ-database2",
  "questions": {},
  "stats": {}
}
```

`questions`／`stats` 的形狀見下一節。匯出時兩面都在。

---

## 5. 題目面 `surface: "questions"`

```json
{
  "version": 1,
  "surface": "questions",
  "search": "",
  "searchScope": "all",
  "triState": {
    "curriculum": {},
    "chapter": {},
    "feature": { "Out syl": "excluded" },
    "adminBlank": {},
    "partPerformance": {},
    "publisher": {},
    "exam": {},
    "qtype": {},
    "section": {},
    "paper": {},
    "year": {},
    "concepts": {},
    "patterns": {},
    "stemPatterns": {},
    "ai": {},
    "multipleSelection": {},
    "graph": {},
    "table": {},
    "calculation": {}
  },
  "filterLogic": { "curriculum": "OR", "chapter": "OR" },
  "ranges": {
    "percentage": { "active": false, "min": 0, "max": 100 },
    "marks": { "active": false, "min": 0, "max": 30 },
    "questionNumber": { "active": false, "min": 1, "max": 60 }
  },
  "idSet": { "active": false, "ids": [], "label": "", "source": "" },
  "advanced": { "active": false, "conditions": [], "label": "" }
}
```

上面的 `feature` 示範的是**畫面預設**，不是空合約。空的 `feature: {}` 不會排除 Out syl。

### 5.1 搜尋

| 欄位 | 空值 | 說明 |
| --- | --- | --- |
| `search` | `""` | 不搜尋。只含空白的字串仍會拿去比對（與現有搜尋框一致），統計面則會先 trim |
| `searchScope` | 題目預設 `all` | `all`、`id`、`content`、`publisher`、`exam`、`answer`、`concepts`、`patterns`、`stemPatterns`、`markersReport`、`section` |

`all` 比對 id、考試、section、題號、題幹／課題、出版商、答案、評卷報告。**不**搜 concepts／patterns／stemPatterns；那三個要用對應 scope。

### 5.2 tri-state

每個鍵的值是 `{ "選項": "checked" | "excluded" }`。  
空物件＝這一維不限制。其他狀態字串會在正規化時丟掉。

| 鍵 | 題目欄位 | 勾選 | 排除 |
| --- | --- | --- | --- |
| `publisher` | `publisher` | 任一勾選（OR） | 命中任一即剔除 |
| `exam` | `examination` | OR | 同上 |
| `qtype` | `questionType` | OR | 同上 |
| `paper` | `paper`（會轉成字串，`2` 與 `"2"` 相同） | OR | 同上 |
| `section` | `section` | OR | 同上 |
| `year` | `year` | OR。`39` 與 `MT39` 是同一鍵 | 同上 |
| `curriculum` | `curriculumClassification` | `filterLogic.curriculum` 為 `AND` 或 `OR`（預設 OR） | 命中任一即剔除 |
| `chapter` | `AristochapterClassification`，比對時加前綴 `Ch` | 同上，`filterLogic.chapter` | 同上 |
| `concepts`／`patterns`／`stemPatterns` | 同名陣列 | 勾選之間是 **OR**。可加哨兵 | 同上 |
| `graph`／`table`／`calculation`／`multipleSelection` | `graphType`／`tableType`／`calculationType`／`multipleSelectionType` | OR，可加哨兵 | 同上 |
| `feature` | `questionFeatureOn` | **跨鍵 AND** | 該鍵不成立才留下 |
| `adminBlank` | 同一套 `questionFeatureOn` | 跨鍵 AND | 同上。`accessRights.admin !== true` 時整組略過 |
| `partPerformance` | `questionParts[].performance` | **跨鍵 AND** | 該表現不出現才留下 |
| `ai` | `questionMatchesAiFilter` | 勾選的標籤 **全部**都要在（AND） | 任一排除標籤出現就剔除 |

哨兵鍵是 `"__empty__"`（畫面上的「尚未輸入」）。它不是題庫裡的標籤。`"-"`、空白、空陣列算未輸入。已確認的「沒有圖／沒有表格／沒有計算／並非複選型」是真實值，**不是**哨兵。

`feature` 裡若殘留 admin 空白鍵（例如「題目空白」），套用時略過。請放在 `adminBlank`。

特徵與分題（`questionFeatureOn`）：

| 狀態 | 標籤 |
| --- | --- |
| 有非空 `questionParts` | 有分題 |
| `questionType === "MC"` 且沒有分題 | 沒有分題（不是「尚未輸入分題」） |
| 其他題型、分題仍空 | 尚未輸入分題 |

同時勾「有分題」和「沒有分題」會得到空集（跨鍵 AND）。

AI 標籤（字串要一致）：`有AI解釋`、`簡短`、`詳盡`、`沒有AI解釋`。  
畫面上勾「沒有」會清掉「有」，勾「簡短／詳盡」會連帶「有」。合約只記 tri-state；**比對時勾選仍是 AND**。一題同時要「簡短」和「詳盡」才會在兩邊都勾時留下。

### 5.3 範圍

`active: false`＝不限制（即使 min／max 有數字）。  
`active: true` 時數值要落在閉區間內；答對率、分數、題號缺值的列會被拿掉。

題號取 id 結尾的數字（`DSE-2024-P1-07` → 7）。id 沒有數字時才用 `questionNumber` 開頭的數字。

### 5.4 `idSet` 與 `advanced`

| 欄位 | 不限制 | 有限制 |
| --- | --- | --- |
| `idSet` | `active: false` 或 `ids: []` 且未標成 active | `active: true` 且 `ids` 為題目 id 陣列。空陣列又 `active: true` → 零列 |
| `advanced` | `active: false` 或 `conditions: []` | `active: true` 時，條件以 ConditionMatch **AND** 起來 |

`advanced.conditions[]` 沿用進階篩選／`ConditionMatch` 的物件（`include`、`field`、`value`）。`field: "text"` 搜尋題幹＋答案＋評卷報告。

省略 `active` 時：有 id 或有條件就視為 active；明確 `false` 則停用。

### 5.5 舊呼叫與繼承

`storage.applyFilters(questions, filters)` **沒有** `idSetFilter`／`advancedFilter` 這兩個鍵時，仍改用 `window` 上的那兩層。`getQuestions({})` 因此會帶上題目 tab 目前的 id 集合或進階條件。

統計投影**總是**帶上停用的兩層，所以統計計數不會繼承題目 tab。  
`applyQuestionsFilterContract`／`applyStatsFilterContract` 也總是自足，不繼承 window。

沒有寫進合約的 `filterLogic`，在舊的 `applyFilters` 物件上仍回落到 `window.filterLogic`。合約套用只用合約裡的 `filterLogic`（預設 OR）。

---

## 6. 統計面 `surface: "stats"`

```json
{
  "version": 1,
  "surface": "stats",
  "search": "",
  "searchScope": "name",
  "triState": {},
  "filterLogic": { "curriculum": "OR", "chapter": "OR" },
  "ranges": {
    "percentage": { "active": false, "min": 0, "max": 100 },
    "marks": { "active": false, "min": 0, "max": 30 },
    "questionNumber": { "active": false, "min": 1, "max": 60 }
  }
}
```

| 項目 | 行為 |
| --- | --- |
| `searchScope: "name"` | 只留給統計列名稱的後濾（`statsNameQuery`）。`applyStatsFilterContract` **不**用它搜題幹，`search` 會被看成空 |
| 其他 scope | `content`、`id`、`answer`、`concepts`、`patterns`、`stemPatterns`。會 trim 後送進同一套題目引擎 |
| `triState`／`filterLogic`／`ranges` | 與題目面同一套規則 |
| idSet／進階 | 統計面沒有這兩欄。套用時一律停用 |
| 排序、頁碼、收合 | 不是篩選合約。寫入統計篩選會把頁碼設回 1，不動排序 |

`omitKey`（第三個參數，或既有的 `statsStateToFilters(state, omitKey)`）會把該 tri 鍵清成 `{}` 再套用，方便某一維的選項清單不要被自己縮小。

從統計跳回題目仍走原來的 `finishJumpToQuestions`（寫進題目的 `triStateFilters`）。合約不另外做一條跳轉。

---

## 7. 權限

過濾前先套 mock 試卷權限，與 `applyPermissionFilter` 相同：

- `accessRights.mockTests === true` → 保留 mock
- `accessRights` 存在但未開 mock → 去掉 mock（id 像 `MT…`，或出版商不是 `HKEAA`／空／`-`）
- 沒有 `accessRights` 時，沿用 `authManager.canViewMockTests()`

合約不能用來繞過這道閘。

---

## 8. 給代理的最短例子

只要 2020 年、排除超綱、不要 id 集合：

```js
const contract = __SFC__.emptyQuestionsContract();
contract.triState.year = { "2020": "checked" };
contract.triState.feature = { "Out syl": "excluded" };
await __SFC__.importFilterJSON(contract);
```

只在記憶體裡看會剩哪些列（不改 UI）：

```js
const rows = __SFC__.applyQuestionsFilterContract(questions, contract);
```

把現在畫面上的篩選交出去：

```js
const json = __SFC__.exportFilterJSON();
```

---

## 9. 與 UI 的對應

| 合約 | UI |
| --- | --- |
| `readQuestionsFromUI`／`writeQuestionsToUI` | `#search`、`#search-scope`、`window.triStateFilters`、`window.filterLogic`、三個範圍、`window.idSetFilter`、`window.advancedFilter` |

寫入題目面時，若 `#search-scope` 還沒有該範圍的 `<option>`，會先補上再呼叫 `filterQuestions()`。否則那個函式會把下拉的值讀回 `window.searchScope`，把合約裡的範圍清掉。之後 `populateSearchScope()` 仍會用正式標籤重建選項。
| `readStatsFromUI`／`writeStatsToUI` | `getStatsTabState('stats')`（一維與交叉共用這一組），以及畫面上的 `data-sf-search`／`data-sf-scope` |

寫入題目面之後會呼叫既有的 `filterQuestions()`（若已載入），所以列表、徽章、三態外觀跟用手點是同一條路。
