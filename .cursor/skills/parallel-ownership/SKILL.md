---
name: parallel-ownership
description: Keep Cursor and Claude Code from colliding when both edit Mage Craft at once. Use when starting a parallel work session, picking a safe slice of work, creating a worktree/branch for dual-agent work, or when two agents might edit the same files.
---

# Parallel ownership (Cursor ↔ Claude Code)

## When this applies

Two agents (or one agent + a human in another tool) are writing in this repo
at the same time.

## Workflow

1. Read `AGENTS.md` at the repo root for the current ownership table.
2. Pick a zone you own. If the task sits in someone else's zone, **stop** and
   ask the user which agent should take it — do not "helpfully" edit hot files.
3. Prefer a **separate git worktree + branch** over sharing a working tree:
   ```bash
   git worktree add -b cursor/safe-parallel ../mage-craft-cursor HEAD
   ```
4. Inside the worktree, prefer **new files** over editing files the other
   agent is actively changing. Good examples: `server/cmd/magesmoke/`,
   `AGENTS.md`, `HANDOVER.md`, skills under `.cursor/skills/`.
5. At the end of the session, update `HANDOVER.md` via the `session-handover`
   skill so the other agent can resume.

## Hard avoid list while the other agent is on the client

Do not edit these unless the user explicitly assigns them to you:

- `src/**`, `index.html`, `public/**`
- `server/cmd/mageserver/**`
- `server/internal/{game,bot,room,match}/**`
- `GDD.md`, `multiplayer-plan.md` (coordinate first)

## Safe default slices

- Smoke / tooling under `server/cmd/<new-tool>/`
- Protocol contract docs / ownership maps
- Handover notes and Cursor skills
- Tests that live in a **new** package and only import stable APIs
  (`internal/protocol`, `internal/ws`)
