# AI question proxy (admin setup)

The site button **AI出題** is hidden until `checkAccess` returns `ai: true` for the signed-in user. It sends either the currently filtered questions or questions the user pasted, the instruction for the chosen 出題模式 (the user may still edit it), `provider` (`poe` | `openrouter`), and a model id to this Apps Script web app. The script calls Poe (`https://api.poe.com/v1/chat/completions`) or OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) and appends a row to the spreadsheet. The browser never receives the server API key. Users may send their own `poeApiKey` or `openRouterApiKey` from localStorage (settings modal). Script property `POE_API_KEY` is a shared Poe fallback **only for the admin role**; optional `OPENROUTER_API_KEY` is the same for OpenRouter. Other AI users must supply their own browser key or calls return `missing_api_key`. The public repository does not contain the allowlist or any key.

**After this change is merged**, paste the updated `Code.gs` from this repo into the live Apps Script project and create a **new deployment version** (Deploy → Manage deployments → Edit → Version: New version → Deploy). Keep the existing `/exec` URL. An older deployment ignores `testModel`, the model allowlist, and the backup tab.

Git sync and the shared question bank use the same sign-in, with different flags. Only `githubSync` can upload or download the **shared** question bank under `shared/data/…`. Any known username (a hash on one of the three role lists) can load shared diagrams, the question bank, and paper files through this web app. A restricted role receives the bank with mock-test questions removed. The script talks to GitHub. The browser does not.

GitHub Pages is a static host. A private repository’s raw file URL answers 404 unless a token is sent, and the token must not be in the page. `fetchSharedAsset` and `listSharedData` are how the site reads those files. Questions load only from the private repository `mas-repo/econ-database-data`. The question bank is not committed under `econ-database/data/`, and a failed private-repo read does not fall back to a file in this repo.

`Code.gs` in this repository is the source of truth. If the copy already deployed in Apps Script has drifted, replace it with this file and **redeploy** (section 4). Property-only edits apply immediately. Code changes, including the editable 出題指示, do not: an old deployment ignores the client `instruction` field until you deploy a new version.

## Security model

- `POE_API_KEY`, optional `OPENROUTER_API_KEY`, the allowlist, and every `GITHUB_*` value live only in **Apps Script → Project Settings → Script properties**.
- The page calls `POST` on the web app URL. It does not call the upstream API host or `api.github.com`.
- Never commit the token, the GitHub owner, or the private repository name into this public site. Not in JavaScript, HTML, README examples, or `js/config.js`. The `/exec` URL is the only client setting, and it is not a secret.
- `checkAccess` (alias `checkRights`) returns `{ "ok": true, "admin": false, "ai": false, "githubSync": false, "mockTests": false, "allowed": false }`. It does not return a username, a hash, or a role name. `allowed` mirrors `githubSync` only (admin). An older page that still checks `data.allowed` therefore shows the GitHub panel only for admin; AI出題 must use the `ai` flag on the current page. The current page uses `ai`, `githubSync`, `admin`, and `mockTests` and ignores `allowed`.
- `generateQuestions` and `testModel` require `ai`. GitHub upload and download require `githubSync`. Shared reads require a known username. A refused call does not reveal who is listed.
- The modal sends `provider` and `model`. For Poe, the script accepts only `Claude-Sonnet-5.5`, `GPT-6.1-Sol`, and `Gemini-3.8-Flash` (else `Claude-Sonnet-5.5` / optional `POE_MODEL`). For OpenRouter, the script accepts a validated free-text model id (else `openai/gpt-4o-mini` / optional `OPENROUTER_MODEL`).
- `appsscript.json` limits `UrlFetchApp` to `https://api.poe.com/`, `https://openrouter.ai/`, and `https://api.github.com/`.
- Do not commit real usernames, hashes of real usernames, or the API key. Examples below use placeholders such as `user_a` and an obviously fake hash. Never paste a production hash into git.

## 1. Open the spreadsheet

Use the spreadsheet that should store the log:

https://docs.google.com/spreadsheets/d/1b_Z5jVXh_P0t97CuQoMRUg5u0saCuGawbEcgb12hfgI/edit

**Extensions → Apps Script**. If a bound project already exists, paste into that project. Binding the project lets the script use the active spreadsheet without `SPREADSHEET_ID`.

Set the Apps Script timezone and the spreadsheet timezone to `Asia/Hong_Kong` so daily limits match the log timestamps.

## 2. Paste the project

- Replace the default `Code.gs` with `econ-database/apps-script/Code.gs` from this repo.
- **Project Settings → tick “Show appsscript.json”**, then replace that file with `econ-database/apps-script/appsscript.json`.
- Save, then reload the spreadsheet so the **出題代理** menu appears.

After every pull, compare the deployed script with this repo. If they differ, paste the repo file again and redeploy a new version (section 4). Do not keep a private fork of `Code.gs` as the source of truth.

You can ignore the editor’s run dropdown until the properties below exist. `selfTestPromptShape` checks the default instruction, the length cap, the model allowlist, the mode ids, the role flags, and the sheet-cell truncation helper. It does not call the upstream API.

## 3. Script properties

**Project Settings → Script properties**. Names must match. Values are not in git.

Production roles are **only** these three hash lists. Do not store plaintext usernames. The script does not read `ALLOWED_USER_HASHES` or `ALLOWED_USERS`. Delete those properties on the live project after the three lists below are set, or a leftover plaintext name sits in Project Settings even though it no longer grants access.

### Roles (production): hashes only

1. Open the bound spreadsheet linked above.
2. Reload the spreadsheet after `Code.gs` is saved so **出題代理** is on the menu bar.
3. Choose **出題代理 → 計算使用者名稱雜湊**.
4. For each person, paste the username into that dialog. Do this privately. The dialog does not write the name into the sheet or into the repo. It lowercases and trims the name, then shows only the SHA-256 hex.
5. Copy that hex into exactly one Script property:
   - `ALLOWED_ADMIN_HASHES` — full rights: AI出題, GitHub upload/download and the Auto-sync checkbox, 管理員模式 (edit, import, export), and mock tests.
   - ALLOWED_AI_HASHES — AI出題 and mock tests; no GitHub; no admin edit.
- ALLOWED_MOCK_HASHES — mock tests only; no AI出題; no GitHub; no admin edit.
- ALLOWED_AI_HASHES (detail) — AI出題 (filter, paste, modes, models, and 測試) and mock tests. No GitHub buttons, no Auto-sync, no 管理員模式.
   - `ALLOWED_RESTRICTED_HASHES` — browse the site like a student or teacher. No AI出題, no GitHub buttons, no Auto-sync, and no mock-test questions. Everyone on this list has the same rights.
6. Separate hashes in one property with commas, newlines, or spaces. If the same hash is in more than one list, the highest role wins: admin, then AI editor, then restricted.
7. Delete `ALLOWED_USER_HASHES` and `ALLOWED_USERS` if they are still set.

A value that is not 64 hex characters never matches, so a plaintext username in a property does not grant a role. If all three lists are empty, nobody is known. `checkAccess` does not say which property matched, and it does not echo the username or any hash.

`checkAccess` and `checkRights` return only:

```json
{ "ok": true, "admin": false, "ai": false, "githubSync": false, "mockTests": false, "allowed": false }
```

An unknown username gets every flag false. The page then hides AI出題, GitHub, edit, and mock-test controls. Shared fetch, AI, and GitHub calls return `feature_unavailable`. A restricted user is known, so shared fetch works, but `ai`, `githubSync`, and `mockTests` are false: the bank loads with mock rows removed.

A hash is 64 hex characters. This is a fake shape only — do not paste it into Script properties:

```
0000000000000000000000000000000000000000000000000000000000000000
```

To check the menu output on your own machine, hash a placeholder name and do not commit the result:

```bash
printf '%s' 'user_a' | shasum -a 256
```

Changing properties does **not** require a new deployment. Changing `Code.gs` does.

| Property | Required | Placeholder / default |
| --- | --- | --- |
| `POE_API_KEY` | admin-only fallback | Shared upstream key for the **admin** role only (`resolvePoeApiKey_` gates on `lookupRights_(username).admin`, which matches `githubSync` / `ALLOWED_ADMIN_HASHES`). Prefer non-empty `poeApiKey` from the modal for any AI user; else if admin and this property is set, use it; else return `missing_api_key` (AI editors and other non-admin users never receive this fallback). Never log or store the body key. |
**Shared Poe key gate:** `resolvePoeApiKey_` does not compare a plaintext username. It allows Script property `POE_API_KEY` only when `lookupRights_(username).admin === true` (same membership as `githubSync`). In production that admin hash list is the single shared-key operator; every other AI user must send `poeApiKey` from the browser.

| `ALLOWED_ADMIN_HASHES` | for full rights | SHA-256 hex list from the menu above. Example placeholder subject: `user_a`. |
| `ALLOWED_AI_HASHES` | for AI出題 without GitHub | SHA-256 hex list. Same menu. No GitHub sync and no admin edit. |
| `ALLOWED_RESTRICTED_HASHES` | for browse without mocks | SHA-256 hex list. Same menu. No AI出題, no GitHub, no mock tests. |
| `POE_MODEL` | no | Fallback only when the client omits `model`, and only if the value is `Claude-Sonnet-5.5`, `GPT-6.1-Sol`, or `Gemini-3.8-Flash`. Other values are ignored. Default: `Claude-Sonnet-5.5`. |
| `POE_MAX_REFERENCES` | no | `40` (hard cap 80) |
| `POE_MAX_REFERENCE_CHARS` | no | `80000` |
| `POE_MIN_INTERVAL_SECONDS` | no | `20` (`0` disables the cooldown) |
| `POE_DAILY_LIMIT` | no | `40` successful generations per username per day (`0` disables) |
| `POE_MAX_TOKENS` | no | empty; a low value cuts long answers short |
| `POE_TEMPERATURE` | no | empty |
| `SPREADSHEET_ID` | only if the script is not bound | the id in the sheet URL |
| `LOG_SHEET_NAME` | no | `UsageLog` |
| `BACKUP_SHEET_NAME` | no | `GenerationBackup`. Do not point this at `UsageLog` or a data tab. If it matches the log tab name, the script uses `GenerationBackup` anyway. |
| `GITHUB_TOKEN` | for Git sync | fine-grained PAT; Contents read and write on the private data repository only |
| `GITHUB_OWNER` | for Git sync | GitHub user or organization that owns the private data repository |
| `GITHUB_REPO` | for Git sync | private repository name |
| `GITHUB_BRANCH` | no | `main` when this property is empty |
| `GITHUB_DATA_PATH` | for Git sync | path under the shared prefix, such as `data/database.json`. Stored as `shared/data/database.json` (joined with `GITHUB_SHARED_PREFIX`). Username is not in this path. |
| `GITHUB_AI_BACKUP_DIR` | for Git sync | directory inside each user's folder, such as `ai-backups`. Stored as `users/<username>/ai-backups/`. Personal AI出題 history only. |
| `GITHUB_SHARED_PREFIX` | no | `shared` when this property is empty. Shared diagrams, JSON, and papers live under this prefix. Do not set it to `users` or a path under `users`. |

Usernames are trimmed and lowercased before the hash check. The site already stores the signed-in name that way.

Do not paste real owner, repository, or token values into this file. The path examples above are shapes, not an identity.

## 4. Deploy the web app

**Deploy → New deployment → Select type: Web app**.

- Execute as: **Me** (the account that owns the key and can edit the sheet).
- Who has access: **Anyone**.

Copy the URL that ends in `/exec`.

The first deployment asks you to authorize Sheets and external requests. Approve that as the deploying account.

When you later edit the script, including after pulling a new `Code.gs`: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. Keep the same `/exec` URL. Modes, the model dropdown, `testModel`, and reply backup are ignored by a deployment that still runs an older script. Paste this repo’s `Code.gs` into the live project before you create that new version.

## 5. Point the site at the web app

In `econ-database/js/config.js`, set `POE_PROXY_WEB_APP_URL` to that `/exec` URL. It is not a secret. The key stays in Script properties.

Reload the site and sign in. **AI出題** appears only when `ai` is true. **管理員模式** appears only when `admin` is true. The GitHub panel appears only when `githubSync` is true. Mock-test questions and the mock publisher filter appear only when `mockTests` is true. A failed check leaves those controls hidden and does not say why.

Opening the `/exec` URL in a browser should return JSON like `{ "ok": true, "service": "question-proxy", "configured": true, "gitConfigured": false, "sharedConfigured": false }`. `configured` only means a Poe key is present. `gitConfigured` is true only when the token, owner, repository, data path, and backup directory are all non-empty and well formed. `sharedConfigured` is true when the token, owner, repository, branch, and shared prefix are well formed. An empty `GITHUB_SHARED_PREFIX` still counts as configured, because the script uses `shared`. The response does not list users and does not contain the token, owner, repository name, or the prefix.

## GitHub sync

Only `githubSync` (the admin role) sees **自動同步**, **上傳到 GitHub**, and **從 GitHub 載入**. AI editors and restricted users do not see that panel. The checkbox is stored only in that browser’s `localStorage`. It is not sent to the server.

- **上傳到 GitHub** sends the current question bank to `syncDataUpload`.
- **從 GitHub 載入** calls `syncDataDownload` and replaces the browser’s IndexedDB copy.
- With **自動同步** on, opening the page tries to load the private copy. Saving, deleting, importing, or exporting a question uploads the current bank. Clearing the database does not upload by itself.
- Reloading the page loads questions only from the private repository `mas-repo/econ-database-data` through the Apps Script proxy. If that read fails, the page stays without questions and does not use a local copy.

Both actions require `githubSync` before any GitHub read or write. A refused call returns `feature_unavailable` and does not say whether GitHub is configured.

### Token

Create a **fine-grained** personal access token:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Resource owner: the account that owns the private data repository.
3. Repository access: **Only select repositories**, and select only that private data repository. Do not include the public site repository.
4. Permissions: **Contents → Read and write**. Leave every other permission at No access. Contents covers the file API and, for a question bank larger than the Contents API accepts, the Git Data API this script uses as a fallback.
5. Copy the token into Script property `GITHUB_TOKEN` only. Do not put it in the sheet, the page, or git.

Then set `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_DATA_PATH`, and `GITHUB_AI_BACKUP_DIR`. Set `GITHUB_BRANCH` if it is not `main`.

### Shared question bank vs personal AI backups

The script builds every GitHub path. The browser does not send paths, and the page never contains the owner or repository name.

| What | Where | Who |
| --- | --- | --- |
| **Shared question bank** (Upload / Download / Auto-sync) | `<GITHUB_SHARED_PREFIX>/<GITHUB_DATA_PATH>` — default `shared/data/database.json` when `GITHUB_DATA_PATH` is `data/database.json` | Every `githubSync` user reads and writes the **same** file. Username is required for auth only and must **not** appear in the bank path. Paths under `users/` are rejected. |
| **Personal AI出題 history** (model-reply backups) | `users/<username>/<GITHUB_AI_BACKUP_DIR>/<timestamp>-….json` | Per signed-in user only. Unchanged. |

Recommended Script property: `GITHUB_DATA_PATH` = `data/database.json` (not under `users/`). If the property value already starts with the shared prefix (for example `shared/data/database.json`), the script does not double-prefix.

`<username>` for AI backups is the signed-in name after trimming and lowercasing. A space in that name is written as a hyphen. The name has to be one path segment. A slash, a backslash, or `..` is rejected; an AI backup is skipped in that case, but the generation or test reply is still returned.

The private repository needs at least one commit on that branch (a README created with the repository is enough). The script never creates the repository.

## Shared assets

GitHub Pages cannot read a private repository. Requesting a private raw file without a token returns 404. Putting the token in the page would expose the whole private repository, so the page never does that. `fetchSharedAsset` and `listSharedData` use the Script properties token and return only the file, or a directory listing, to a known username.

`GITHUB_SHARED_PREFIX` defaults to `shared` when the property is empty. It must not be `users` or a path under `users`. The client sends a path relative to that prefix. The script joins the two and refuses `..`, a leading slash, and any path whose first folder is not one of `data`, `diagrams`, `originals`, `papers`, or `build`.

Expected layout inside the private repository:

- `shared/data/database.json` — question bank
- `shared/data/vocabulary.json` — label list
- `shared/diagrams/` — inline diagrams. Question field `inlineDiagrams` stays `diagrams/...`
- `shared/originals/` — question, answer, and report images. Those fields stay `originals/...`
- `shared/papers/mock-tests/` — mock-paper packs
- `shared/papers/past-papers/` — past-paper packs
- `shared/build/` — classification JSON used by the import scripts

`users/<username>/` holds personal AI出題 backups only and is not readable through these shared-asset actions. Question-bank sync writes the shared bank under `shared/data/…`, not under `users/`.

`fetchSharedAsset` returns `{ "ok": true, "path", "encoding", "mediaType", "bytes", "content" }`. Text files (`.json`, `.js`, `.jsonl`, `.txt`, `.md`) use `encoding: "utf8"`. Images and other allowed files use `encoding: "base64"`. The path in the response is the client-relative path, not a GitHub URL. Files larger than 9 MB return `payload_too_large`. The question bank and the images are under that cap. Some past-paper PDFs are larger; `listSharedData` still lists them, and they are read from the private checkout by the import scripts rather than streamed through the web app.

`listSharedData` takes `path` (a directory such as `papers/mock-tests`, or empty for the shared root) and optional `recursive: true`. It returns `{ "ok": true, "path", "truncated", "entries": [{ "path", "type", "size" }] }` with at most 8000 entries. `type` is `file` or `dir`.

Both actions require a known username (admin, AI editor, or restricted). They do not require `ai` or `githubSync`. Without `mockTests`, `data/database.json` is returned with mock-test rows removed, and `data/database.js`, `build/`, `diagrams/`, `papers/mock-tests/`, and numbered `originals/<digits>/` folders return `feature_unavailable`. `originals/dse/` and `papers/past-papers/` stay available. An unknown username gets `feature_unavailable` and does not receive the bank. A refused call does not say whether GitHub is configured. There is a per-username cap of 120 shared reads per minute (`rate_limited`). The page loads the bank once, then loads each diagram or original image when it is shown.

`sharedConfigured` on a GET of `/exec` is true when a shared read can be attempted. It does not reveal the prefix.

Copy the files into a local checkout of the private repository with `econ-database/scripts/stage_shared_assets.py`, then commit them there. That script does not contain a token. After `Code.gs` changes, paste this file into the live Apps Script project and deploy a new version. Property-only edits, including `GITHUB_SHARED_PREFIX`, apply immediately.

The public site must not commit these assets. When publishing `econ-database/` to the public Pages repository `mas-repo/econ-database2`, do not restore `data/database.json`, `diagrams/`, `originals/`, `MockTests/`, or `PastPaper/` from an older public commit.

The public question file is several megabytes, which is over the Contents API blob limit. Small files, including each AI backup, use the Contents API. The question bank uses the Git Data API when it is larger. The browser still only sees `ok` or `error`, and maybe a commit `sha` and the relative `path`.

### Model reply backup

A successful `generateQuestions` or `testModel` call still returns the reply to the browser. It also:

- appends a row to `GenerationBackup` (column list under GenerationBackup below)
- writes the reply JSON under `users/<username>/<GITHUB_AI_BACKUP_DIR>/`, in a new timestamped file, when the GitHub properties are set

`generateQuestions` files record `source` / `referenceSource` as `filter` or `paste`, plus `modeId`, `modeName`, and a clipped `instruction` (max 4000 characters) when the generate handler has them. Older files may omit those fields. The sheet cell is clipped. The GitHub file keeps the reply (up to one million characters). Backup failure does not fail the generation or the test.

### Cross-device AI history (`listAiBackups` / `getAiBackup`)

AI editors (`ai: true`) can reload their own personal backups into the AI出題 modal on another computer. These actions do **not** require `githubSync`.

- `listAiBackups` — `{ "action": "listAiBackups", "username" }` → `{ "ok": true, "backups": [ … ] }`. Lists only that user's `users/<username>/<GITHUB_AI_BACKUP_DIR>/` folder, newest first, one page of 30 `generateQuestions` files. Optional string `after` (or `afterName`) is a `.json` basename already returned as `nextAfter` and continues with the next 30; the response adds `pageSize`, `hasMore`, and `nextAfter` (no total count). A bad `after` is `bad_request`. The call still cannot name another user. Each file has `name`, `action`, `model`, `createdAt`, counts, `source` / `referenceSource`, `modeId`, `modeName`, `instruction`, and `content`. If GitHub backup is not configured, or the folder is missing/empty, the response is a soft empty page `{ "ok": true, "backups": [], "pageSize": 30, "hasMore": false, "nextAfter": "" }` (not an error).
- `getAiBackup` — `{ "action": "getAiBackup", "username", "name": "<basename>.json" }` → `{ "ok": true, "backup": { … } }`. Reads one file from that same user folder only. `name` must be a single `.json` basename (no `/`, `..`, or other paths).

- `listAiUsageRecords` ? admin only (`rights.admin`). `{ "action": "listAiUsageRecords", "username" }` plus optional `afterName` / `afterUser` (or `after: { name, username }`) ? `{ "ok": true, "records": [ ? ], "pageSize": 30, "hasMore": false, "nextAfter": { "name", "username" } | null }`. Reads only the fixed folders `ryan` and `user57`, never the caller's own folder, and never a username the request picks as a target. `afterUser` must be one of those two folders and must not be the caller. Order is newest file name first, then username. One page is 30 merged records. Backup bodies before the cursor are not downloaded. Search in the modal filters the current page only.

Neither response includes the token, owner, repository name, or another user's folder. Shared bank upload/download rules are unchanged.

Protect `GenerationBackup` the same way as `UsageLog`.

After changing `Code.gs` or `appsscript.json` (the new `api.github.com` whitelist entry), redeploy a new version. Property-only edits apply immediately.

## What gets logged

The script creates a tab named `UsageLog` (or `LOG_SHEET_NAME`) with:

`timestamp | username | action | success | metadata`

- `login` — once per username about every 30 minutes, after someone signs in on the site.
- `generateQuestions` — success or failure, with model, mode id, `source` (`filter` or `paste`), counts, duration, and the length of the 出題指示 (`instructionChars`, plus `instructionProvidedChars` for the raw client length). The instruction text and the question text are not written to this tab. The reply itself goes to `GenerationBackup` and, when configured, to the private repository.
- `testModel` — the **測試** button. Success means the model returned the expected short ping (`正常`). The metadata has the model, duration, and a short `replyPreview`. It requires `ai`. It does not count toward `POE_DAILY_LIMIT`. It has its own cooldown of `POE_MIN_INTERVAL_SECONDS`, separate from generation. A successful reply is also written to `GenerationBackup` and, when configured, to the private repository.
- `syncDataUpload` / `syncDataDownload` — success or failure when `githubSync` is true. The log stores a byte count or an error code, not the question text and not the token.

Protect the `UsageLog` tab (**Data → Protect sheets and ranges**) so casual editors cannot clear it. The web app still appends rows because it runs as the deploying account.

### GenerationBackup

On a successful upstream reply, the script also appends a row to `GenerationBackup` (or `BACKUP_SHEET_NAME`):

`timestamp | username | action | model | modeId | modeName | instruction | filteredCount | sentCount | responseTruncated | responseText | metadata`

- `generateQuestions` stores the instruction that was sent, the mode id and name, the filtered and sent counts, and the model’s full reply.
- `testModel` stores the fixed ping prompt, an empty mode, and the short reply. `passed` in `metadata` says whether the reply matched `正常`.
- A cell is cut at 45,000 characters (instructions at 8,000). `responseTruncated` is `yes` when the reply was cut, and `metadata.truncation` lists `response_truncated` and/or `instruction_truncated`.
- Reference stems are not copied into the sheet. The reply can still contain newly written questions.

Protect `GenerationBackup` the same way as `UsageLog`.

The sheet is the audit log, so usernames of people who sign in or generate questions will appear there. That is outside the public git repo. Narrow the spreadsheet’s share list when you can; site visitors do not need edit access.

Login and denied-generation rows are deduped so a public `/exec` URL cannot fill the tab as quickly. Successful generations are always logged.

## How a generation is built

The user message starts with the 出題指示, then the reference questions (stem plus explanation when one was sent).

The modal can send the current filter or questions the user pasted. The request field `source` is `filter` or `paste`. Anything else is stored as `filter`. UsageLog metadata, the `GenerationBackup` sheet, and the private GitHub reply file record that value. The pasted text itself is not written to the usage log.

The modal has four 出題模式. Choosing one fills 出題指示 with that mode’s prompt. The user can still edit the textarea. **回復預設** restores the prompt of the mode that is currently selected. The last edit, mode, and model are kept in that browser’s `localStorage`. The request fields are `instruction`, `modeId`, `provider`, `model`, and optional `poeApiKey` or `openRouterApiKey` (per-browser key for the chosen provider; required for non-admin AI users; never written to UsageLog, GenerationBackup, or GitHub backups). Provider, keys, and models are edited in **API／模型設定**, not the main generate modal. Non-admin clients block **測試** / **出題** early when the local key is empty, and open that settings modal on `missing_api_key`.

The mode prompts live in `POE_GENERATION_MODES` in `js/poeGenerateModal.js`. The server does not store those prompts. It records `modeId` only when it is one of `style-continue`, `vary-examples`, `add-novelty`, or `different-types`.

| Mode | id | What it asks for |
| --- | --- | --- |
| 風格延續・求新 | `style-continue` | The default prompt below. New questions in the reference style, with a little novelty called out. |
| 改例子／數字 | `vary-examples` | Keep the question type. Change only examples or numbers. Examples must be understandable to secondary-school students, with no specialist science jargon. |
| 題型加新意 | `add-novelty` | Keep the screened question types as the base and add modest novelty in wording or approach. |
| 截然不同題型 | `different-types` | Every item must use a question type that does not appear in the filtered set. |

The script keeps a client instruction only when it is a non-empty string after trimming and control-character stripping, and it caps the length at 4000 characters. An empty or missing instruction uses the server default (the same sentence as 風格延續・求新). The page sends the selected mode’s prompt when the textarea is blank, so a chosen mode is not silently replaced by that default:

> 參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。

The browser may send up to 60 questions. The script then applies `POE_MAX_REFERENCES` and `POE_MAX_REFERENCE_CHARS`. The upstream call is `POST https://api.poe.com/v1/chat/completions` or `POST https://openrouter.ai/api/v1/chat/completions`, chosen from `provider`. The full reply is returned to the modal (Apps Script does not stream the body back to the browser). The modal keeps past replies in IndexedDB on that browser, keyed by the signed-in username and time, and falls back to `localStorage` if IndexedDB is unavailable.

## Local pages

`file://` pages often cannot `fetch` the web app because the origin is `null`. Use the hosted site (or any `http`/`https` origin) when you try the button.
