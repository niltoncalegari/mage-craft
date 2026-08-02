---
name: session-handover
description: Generate a handover note summarizing what changed, key decisions and open next steps at the end of a Mage Craft work session. Use when the user asks for a session handover/summary, or when wrapping up a long work session on this project so a future session/agent can resume without re-exploring the codebase from scratch.
disable-model-invocation: true
---

# Session Handover

Produces a short, high-signal note so the next session (you or another agent) can resume this project without re-reading the whole history.

## Workflow

1. Look at the current git diff/status and the active plan file (if any in `.cursor/plans/` or `.claude/plans/` referenced this session) to ground the summary in real changes, not memory.
2. Write (or append to) `HANDOVER.md` at the repo root using the template below.
3. If a plan is in progress, reference its todo state (done / in progress / pending) instead of re-describing it.
4. Keep it under ~40 lines. Link to files with their real paths so they're easy to open.

## Template

```markdown
# Handover — <date>

## What changed this session
- <bullet per meaningful change, file-scoped when possible>

## Key decisions (and why)
- <decision> — <one-line rationale>

## Plan / todo status
- Plan: <path to .plan.md, or "none">
- Done: <todo ids/names>
- In progress: <todo id/name + exact next step>
- Pending: <todo ids/names>

## Known issues / risks
- <anything half-done, untested, or a deliberate shortcut>

## Next steps
1. <concrete next action>
2. <concrete next action>
```

## Rules

- Do not restate the entire conversation — only decisions and state that change what the next session needs to do.
- Prefer overwriting the "What changed this session" / "Next steps" sections over accumulating stale history; keep a single current `HANDOVER.md`, not a growing log.
- If nothing decision-worthy happened (pure exploration, no changes), say so briefly instead of forcing a full template.
