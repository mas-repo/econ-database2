# github-sync.kb.md — 題庫 GitHub 同步

> 程式：`js/github-sync.js`；路徑常數多在 `js/shared-assets.js`／config  
> 部署與角色：[`apps-script/README.md`](../apps-script/README.md)  
> 架構草圖：[`docs/architecture-review-2026-10-09.md`](../docs/architecture-review-2026-10-09.md)

## 流程

### Load（Phase 2 merge-on-load）

```mermaid
flowchart TD
  SignIn[登入／checkAccess] --> Token[issueSharedReadToken 或 proxy]
  Token --> Rights{mockTests?}
  Rights -->|是| Both[抓 database-hkeaa.json<br/>+ database-aristo.json 後 concat]
  Rights -->|否| HOnly[只抓 database-hkeaa.json]
  Both --> OK{成功?}
  HOnly --> OK
  OK -->|否| Err[顯示錯誤／不寫入<br/>無 combined silent fallback]
  OK -->|是| IDB[寫入 IndexedDB]
```

- 真相來源：私有 repo **econ-database-data** 的 `shared/data/…`  
- 本機 IndexedDB = 可丟棄快取（見 [`storage-core.kb.md`](storage-core.kb.md)）

### Upload（Phase 3 dirty-shard）

```mermaid
flowchart TD
  Local[IndexedDB 全量] --> Part[依 publisher 精確分區<br/>HKEAA / 雅集出版社]
  Part --> Reject{未知／空／- ?}
  Reject -->|是| Abort[拒絕上傳 unknown_publisher]
  Reject -->|否| FP[與雲端 shard fingerprint 比較]
  FP --> Dirty[只寫 dirty shards]
  Dirty --> Dual[若有 dirty：dual-write combined<br/>本地有的 shard ∪ 雲端補缺]
  Dirty --> Skip0[本地 0 列之出版社：跳過該 shard]
```

- Client 若本地 `SCHEMA_VERSION` < 雲端 combined `schemaVersion` → 拒傳（`schema_too_new`／stale）  
- 上傳逾時放寬（多 MB JSON；單檔請求）

## 架構取捨／決策

| 選項 | 選擇 | 原因 |
| --- | --- | --- |
| 單一 `database.json` only | **Shards + combined dual-write** | HKEAA／雅集體積與權限（mock）分離 |
| 空本地當空 shard 上傳 | **禁止**（skip／`empty_shard_refused`） | 防誤刪雲端雅集或 HKEAA |
| 寫入 token 放前端 | **否** | 只經 Apps Script；讀可用短命 read token |
| schema gate | client + server 雙查 | 舊頁面不可蓋新 schema |

## 修改史（決策型）

| 方向 | 說明 |
| --- | --- |
| Phase 2 merge-on-load | 分片讀（mock 雙 shard；否則 HKEAA） |
| D2 shards-only download | 取消 silent combined fallback；`downloadQuestionsFromGit`／`syncDataDownload` 走 shards |
| Phase 3 dirty-shard | 只上傳變更分片 + dual-write combined |
| 未知 publisher 硬拒 | 避免靜默寫錯分片 |

## 待辦

- [x] D2：Download／`syncDataDownload` 改 shards-only（無 combined silent fallback）  
- [ ] 上傳進度 UI／可取消

## 文字版 E2E 測試描述

1. mockTests 使用者載入後應同時有 HKEAA + 雅集題（若雲端雙 shard 存在）。  
2. 無 mockTests：只載入 HKEAA shard（不下載 aristo；不 fallback combined）。  
3. 只改 HKEAA 題後上傳：應更新 `database-hkeaa.json`（若 dirty）且 **不** 用空檔蓋 `database-aristo.json`。  
4. 故意把某題 `publisher` 改成未知字串 → 上傳應失敗並提示。  
5. 用舊前端（較低 `SCHEMA_VERSION`）對新 bank 上傳 → 應被 schema gate 擋住。
