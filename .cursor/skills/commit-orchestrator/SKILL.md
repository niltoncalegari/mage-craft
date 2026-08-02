---
name: commit-orchestrator
description: >-
  Watch the working tree for multi-agent WIP, split it into small reviewable
  commits, and push when asked. Use when the user asks to orchestrate commits,
  split commits, harvest other agents' work, keep main clean, or run a commit
  watcher /loop over dirty git state.
---

# Commit orchestrator

Harvest unfinished work from other agents (or the human) into **small, logical
commits** on the current branch. Prefer shipping often over one mega-commit.

## When this applies

- User asks to orchestrate / split / harvest commits
- A `/loop` tick for commit watching fires
- Working tree has accumulated changes from parallel agents

## Hard rules

- Only commit when the user has authorized committing (this skill's trigger
  counts as authorization for harvest runs). Ask before `git push` unless the
  user already said to push.
- Never `git add .` / `git add -A`. Stage **named paths** only.
- Never commit secrets (`.env`, credentials, private keys). `.env.example` is OK.
- Never destructive git (`reset --hard`, `clean -fdx`, force-push) without
  explicit approval.
- Do not amend pushed commits. Follow the repo commit-message style
  (imperative subject + one why-focused body sentence).
- If another agent is mid-edit on a hot file, prefer waiting one tick over
  committing a half-written file. Skip empty or clearly broken WIP slices and
  report them.

## Watch loop (optional)

When the user wants continuous harvesting in this chat:

```text
/loop 5m harvest dirty tree into split commits and push if clean slices exist
```

Or start a dynamic watcher that wakes on `git status` becoming dirty. On each
tick: run the workflow below; if nothing to commit, reply with one short line
("limpo") and wait for the next tick.

## Workflow (every run)

1. **Snapshot** (recoverable, non-destructive):
   ```bash
   SHA=$(git stash create "pre-orchestrate")
   if [ -n "$SHA" ]; then
     git update-ref "refs/backup/pre-orchestrate-$(date +%s)" "$SHA"
   fi
   ```
2. **Inventory** in parallel:
   - `git status -sb` / untracked list
   - `git diff --stat` + skim of meaningful hunks
   - `git log --oneline -8` for message style
   - Ownership signals: `AGENTS.md`, `.cursor/skills/parallel-ownership/SKILL.md`
3. **Slice** by concern (independent stacks preferred):
   - docs / GDD / plans
   - `server/` (Go game)
   - `api/` (accounts/ranking Node)
   - client feature / rebrand / UI
   - tooling / skills / hooks
   Keep tightly coupled files together (e.g. new module + its tests + wiring).
4. **Propose briefly** (1 line per planned commit) then **execute** unless the
   user asked for a plan-only pass.
5. **Commit each slice** with HEREDOC messages; `git status -sb` after each.
6. **Push** only if authorized; then report commit SHAs + anything left dirty.

## Slice heuristics (Mage Craft)

| Path prefix | Typical slice |
| --- | --- |
| `GDD.md`, `multiplayer-plan.md`, `docs/` | docs |
| `server/` | feat(server) |
| `api/` | feat(api) |
| `src/game/`, `src/engine/`, `src/ui/`, `src/app/`, `src/render/` | feat(client) — split further if unrelated |
| `.cursor/skills/`, `AGENTS.md`, `HANDOVER.md` | chore(tooling) |

If a slice mixes two concerns in one file, commit the file with the dominant
concern and note the mix in the report — do not rewrite agent work to force a
prettier split.

## Report format

Keep it short:

```text
Harvested N commits → pushed|local
- <sha> <subject>
Left dirty: <paths or "none">
Skipped: <reason or "none">
```
