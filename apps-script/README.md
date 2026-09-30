# AI question proxy (admin setup)

The site button **AI出題** is hidden until `checkAccess` allows the signed-in user. It sends either the currently filtered questions or questions the user pasted, the instruction for the chosen 出題模式 (the user may still edit it), and one allowlisted model id to this Apps Script web app. The script calls the upstream question API and appends a row to the spreadsheet. The browser never receives the API key, and the public repository does not contain the allowlist.

**After this change is merged**, paste the updated `Code.gs` from this repo into the live Apps Script project and create a **new deployment version** (Deploy → Manage deployments → Edit → Version: New version → Deploy). Keep the existing `/exec` URL. An older deployment ignores `testModel`, the model allowlist, and the backup tab.

The same allowlist gates **Git 同步**. Allowed users can upload or download the question JSON through this web app. The script talks to GitHub. The browser does not.

Question data still loads from `econ-database/data/database.json` for everyone else. The private GitHub repository is only an admin copy.

`Code.gs` in this repository is the source of truth. If the copy already deployed in Apps Script has drifted, replace it with this file and **redeploy** (section 4). Property-only edits apply immediately. Code changes, including the editable 出題指示, do not: an old deployment ignores the client `instruction` field until you deploy a new version.

## Security model

- `POE_API_KEY`, the allowlist, and every `GITHUB_*` value live only in **Apps Script → Project Settings → Script properties**.
- The page calls `POST` on the web app URL. It does not call the upstream API host or `api.github.com`.
- Never commit the token, the GitHub owner, or the private repository name into this public site. Not in JavaScript, HTML, README examples, or `js/config.js`. The `/exec` URL is the only client setting, and it is not a secret.
- `checkAccess` returns `{ "ok": true, "allowed": true|false }`. A refusal looks the same for every username that is not allowed. The page then leaves the button hidden. Do not show a disabled button in its place.
- `generateQuestions` and `testModel` check the allowlist before they read the API key or call upstream. GitHub upload and download use the same check. A refused call does not reveal who is allowed.
- The modal sends `model`. The script accepts only `Claude-Sonnet-5.5`, `GPT-6.1-Sol`, and `Gemini-3.8-Flash`. Any other string is ignored and the call uses `Claude-Sonnet-5.5`. If the client omits `model`, `POE_MODEL` is used only when it is one of those three ids; otherwise the same default applies.
- `appsscript.json` limits `UrlFetchApp` to `https://api.poe.com/` and `https://api.github.com/`.
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

You can ignore the editor’s run dropdown until the properties below exist. `selfTestPromptShape` checks the default instruction, the length cap, the model allowlist, the mode ids, and the sheet-cell truncation helper. It does not call the upstream API.

## 3. Script properties

**Project Settings → Script properties**. Names must match. Values are not in git.

Production allowlist is **only** `ALLOWED_USER_HASHES`. Do not store plaintext usernames in the production project.

### Allowlist (production): hashes only

1. Open the bound spreadsheet linked above.
2. Reload the spreadsheet after `Code.gs` is saved so **出題代理** is on the menu bar.
3. Choose **出題代理 → 計算使用者名稱雜湊**.
4. For each person, paste the username into that dialog. Do this privately. The dialog does not write the name into the sheet or into the repo. It lowercases and trims the name, then shows only the SHA-256 hex.
5. Copy that hex into Script property `ALLOWED_USER_HASHES`. Separate hashes with commas, newlines, or spaces. Repeat for each person.
6. Leave `ALLOWED_USERS` unset. If it is already set on the production project, delete it after the hashes are in place. Otherwise those plaintext names remain in Project Settings and still grant access.

`ALLOWED_USERS` (comma-separated plaintext names) still works in the script for a local or development project. Do not use it in production, and do not commit names or their real hashes.

If `ALLOWED_USER_HASHES` is empty and `ALLOWED_USERS` is empty, nobody is allowed. `checkAccess` does not say which property matched.

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
| `POE_API_KEY` | yes | key from the upstream API key page |
| `ALLOWED_USER_HASHES` | yes in production | SHA-256 hex list from the menu above. Comma, newline, or space separated. |
| `ALLOWED_USERS` | no; legacy/dev only | `user_a,user_b,user_c`. Leave empty in production. |
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
| `GITHUB_DATA_PATH` | for Git sync | path inside each user's folder, such as `data/questions.json`. Stored as `users/<username>/data/questions.json`. |
| `GITHUB_AI_BACKUP_DIR` | for Git sync | directory inside each user's folder, such as `ai-backups`. Stored as `users/<username>/ai-backups/`. |

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

Reload the site and sign in. People whose username hash is listed see **AI出題** next to **複製篩選題目**. Everyone else does not see the button, and a failed check does not say why.

Opening the `/exec` URL in a browser should return JSON like `{ "ok": true, "service": "question-proxy", "configured": true, "gitConfigured": false }`. `configured` only means a Poe key is present. `gitConfigured` is true only when the token, owner, repository, data path, and backup directory are all non-empty and well formed. The response does not list users and does not contain the token, owner, or repository name.

## GitHub sync

Allowed users see **自動同步**, **上傳到 GitHub**, and **從 GitHub 載入** next to the admin actions. Everyone else does not see that panel. The checkbox is stored only in that browser’s `localStorage`. It is not sent to the server.

- **上傳到 GitHub** sends the current question bank to `syncDataUpload`.
- **從 GitHub 載入** calls `syncDataDownload` and replaces the browser’s IndexedDB copy.
- With **自動同步** on, opening the page tries to load the private copy. Saving, deleting, importing, or exporting a question uploads the current bank. Clearing the database does not upload by itself.
- Reloading the page still starts from `data/database.json`, then replaces it when auto-sync can read the private file.

Both actions check the same username hash allowlist as **AI出題** before any GitHub read or write. A refused call returns `feature_unavailable` and does not say whether GitHub is configured.

### Token

Create a **fine-grained** personal access token:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Resource owner: the account that owns the private data repository.
3. Repository access: **Only select repositories**, and select only that private data repository. Do not include the public site repository.
4. Permissions: **Contents → Read and write**. Leave every other permission at No access. Contents covers the file API and, for a question bank larger than the Contents API accepts, the Git Data API this script uses as a fallback.
5. Copy the token into Script property `GITHUB_TOKEN` only. Do not put it in the sheet, the page, or git.

Then set `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_DATA_PATH`, and `GITHUB_AI_BACKUP_DIR`. Set `GITHUB_BRANCH` if it is not `main`.

Each allowed user gets their own folder. The script builds the path. The browser does not send it, and the page never contains the owner or repository name.

- Question uploads and downloads use `users/<username>/` plus `GITHUB_DATA_PATH`. With the example path above, that is `users/<username>/data/questions.json`.
- Model-reply files use `users/<username>/` plus `GITHUB_AI_BACKUP_DIR`, then a timestamped file name. With the example directory above, that is `users/<username>/ai-backups/<timestamp>-….json`.

`<username>` is the signed-in name after trimming and lowercasing. A space in that name is written as a hyphen. The name has to be one path segment. A slash, a backslash, or `..` is rejected, and that user's upload or download returns an error. An AI backup is skipped in that case; the generation or test reply is still returned. An older shared file at `GITHUB_DATA_PATH` is not read and is not moved.

The private repository needs at least one commit on that branch (a README created with the repository is enough). The script never creates the repository.

The public question file is several megabytes, which is over the Contents API blob limit. Small files, including each AI backup, use the Contents API. The question bank uses the Git Data API when it is larger. The browser still only sees `ok` or `error`, and maybe a commit `sha` and the relative `path`.

### Model reply backup

A successful `generateQuestions` or `testModel` call still returns the reply to the browser. It also:

- appends a row to `GenerationBackup` (column list under GenerationBackup below)
- writes the reply JSON under `users/<username>/<GITHUB_AI_BACKUP_DIR>/`, in a new timestamped file, when the GitHub properties are set

`generateQuestions` files record `source` as `filter` or `paste`. The sheet cell is clipped. The GitHub file keeps the reply (up to one million characters). Backup failure does not fail the generation or the test.

Protect `GenerationBackup` the same way as `UsageLog`.

After changing `Code.gs` or `appsscript.json` (the new `api.github.com` whitelist entry), redeploy a new version. Property-only edits apply immediately.

## What gets logged

The script creates a tab named `UsageLog` (or `LOG_SHEET_NAME`) with:

`timestamp | username | action | success | metadata`

- `login` — once per username about every 30 minutes, after someone signs in on the site.
- `generateQuestions` — success or failure, with model, mode id, `source` (`filter` or `paste`), counts, duration, and the length of the 出題指示 (`instructionChars`, plus `instructionProvidedChars` for the raw client length). The instruction text and the question text are not written to this tab. The reply itself goes to `GenerationBackup` and, when configured, to the private repository.
- `testModel` — the **測試** button. Success means the model returned the expected short ping (`正常`). The metadata has the model, duration, and a short `replyPreview`. It uses the same allowlist. It does not count toward `POE_DAILY_LIMIT`. It has its own cooldown of `POE_MIN_INTERVAL_SECONDS`, separate from generation. A successful reply is also written to `GenerationBackup` and, when configured, to the private repository.
- `syncDataUpload` / `syncDataDownload` — success or failure for an allowed user. The log stores a byte count or an error code, not the question text and not the token.

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

The modal has four 出題模式. Choosing one fills 出題指示 with that mode’s prompt. The user can still edit the textarea. **回復預設** restores the prompt of the mode that is currently selected. The last edit, mode, and model are kept in that browser’s `localStorage`. The request fields are `instruction`, `modeId`, and `model`.

The mode prompts live in `POE_GENERATION_MODES` in `js/poeGenerateModal.js`. The server does not store those prompts. It records `modeId` only when it is one of `style-continue`, `vary-examples`, `add-novelty`, or `different-types`.

| Mode | id | What it asks for |
| --- | --- | --- |
| 風格延續・求新 | `style-continue` | The default prompt below. New questions in the reference style, with a little novelty called out. |
| 改例子／數字 | `vary-examples` | Keep the question type. Change only examples or numbers. Examples must be understandable to secondary-school students, with no specialist science jargon. |
| 題型加新意 | `add-novelty` | Keep the screened question types as the base and add modest novelty in wording or approach. |
| 截然不同題型 | `different-types` | Every item must use a question type that does not appear in the filtered set. |

The script keeps a client instruction only when it is a non-empty string after trimming and control-character stripping, and it caps the length at 4000 characters. An empty or missing instruction uses the server default (the same sentence as 風格延續・求新). The page sends the selected mode’s prompt when the textarea is blank, so a chosen mode is not silently replaced by that default:

> 參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。

The browser may send up to 60 questions. The script then applies `POE_MAX_REFERENCES` and `POE_MAX_REFERENCE_CHARS`. The upstream call is `POST https://api.poe.com/v1/chat/completions`. The full reply is returned to the modal (Apps Script does not stream the body back to the browser). The modal keeps past replies in IndexedDB on that browser, keyed by the signed-in username and time, and falls back to `localStorage` if IndexedDB is unavailable.

## Local pages

`file://` pages often cannot `fetch` the web app because the origin is `null`. Use the hosted site (or any `http`/`https` origin) when you try the button.
