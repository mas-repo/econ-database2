# Archived: Python classification batch workflows

**Status:** retired as day-to-day entry points (2026-10-13).

Do **not** run these (or any local batch) to write `concepts` / `stemPatterns` into `database.json` / publisher shards. The only production write path is:

**分類專員 → staging (`submitClassificationProposal`) → 審批與回報 → 分類審批**

See `docs/classification-proposals.md` and the 「分類提案審批」 section in the root `README.md`.

## What lived here (inventory)

These helpers were historically documented under a top-level `scripts/` path in agent notes. They were **never committed** to this public `econ-database2` tree (no `scripts/**` blobs in git history). Names and roles, preserved so agents do not reintroduce them as live entry points:

| Asset | Role (historical) | Disposition |
| --- | --- | --- |
| `apply_stem_patterns_import.py` | Apply Excel taxonomy classifications into the JSON bank / vocabulary | **Archived / do not run against live bank** |
| `auto_assign_stem_patterns.py` (`auto_assign`) | High-confidence automatic assignment pass | **Archived / do not run against live bank** |
| `fuzzy_assign_stem_patterns.py` (`fuzzy_assign`) | Fuzzy matching assign pass | **Archived / do not run against live bank** |
| `merge_stem_pattern_classifications.py` | Merge classification outputs | **Archived / do not run against live bank** |
| `classify_chunks/` (incl. `vocab.json`) | Chunked classification work products | **Archived**; chunk vocab was a snapshot of Excel-78 patterns — live labels live in private `shared/data/vocabulary.json` |
| `stem_patterns_import.json` | Import payload referenced by stem stats notes | **Archived** if recovered |
| Local “how to run classify” notes that write the DB directly | Operator runbooks | **Superseded** by staging API docs |

If copies of the above are recovered from a private checkout or laptop, place them **under this directory** (do not restore a live `scripts/` entry point at the repo root). Prefer deleting duplicate write helpers that bypass Apps Script.

`stage_shared_assets.py` (asset copy into the private data repo) is **not** a classification writer; it is unrelated packaging and is not part of this archive. It is also absent from this public tree.

## Keep (do not delete; live locations)

| Asset | Where |
| --- | --- |
| `vocabulary.json` + concept / stem conventions | Private **econ-database-data** `shared/data/vocabulary.json`; writing rules in root `README.md` 「Writing rules for AI」 |
| Classification tip / taxonomy notes | Root `README.md` (stemPatterns field + writing rules), `_readme_stem_stats.md` |
| Validation / reconciliation (stats, sampling, id checks) | App: `js/data-checks.js`, `js/stats-*.js`, admin hub; not Python batch DB writers |
| Historical reviewed samples (few-shot / regression) | Bank rows with `reviewedByAI === 'Y'` and curated vocabulary — stay in the data repo; never wipe via builders |
| Staging contract | `docs/classification-proposals.md`, Apps Script `submitClassificationProposal` / approve / reject |

## Why retire

Duplicate write paths that patched the shared bank from Python raced with admin review, bypassed staging intake (incl. the soft ≥200 backlog signal), and could overwrite `reviewedByAI Y` rows. Staging + **分類審批** is the single controlled path.

## Residual risk

Agents with a GitHub PAT to **econ-database-data** can still edit `database.json` / shards outside the app. Policy and docs forbid that for classification; there is no code lock in this public repo against a direct Contents API write. Prefer `submitClassificationProposal` (or a PR only to `classification-proposals.json`).
