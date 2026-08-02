# Handover — 2026-08-02

## What changed this session
- Servidor Go completo em `server/`: `protocol`, `ws`, `game`, `bot`, `room`,
  `match`, composition root em `cmd/mageserver` (dispatch + broadcast +
  loop 60Hz). `go test ./...` passa, inclusive `cmd/mageserver` integration.
- GDD 0.2: salas NxN, elemento único por time, pivot Node → Go (§7/§10/§14).
- Skill de projeto `.cursor/skills/session-handover/`.
- Claude Code passou a editar o **cliente** (`src/ui/Menus.tsx`,
  `src/game/elements.ts`, Settings/CSS) enquanto o Cursor isolou trabalho
  seguro na branch `cursor/safe-parallel` (worktree `../mage-craft-cursor`).
- Nesta branch Cursor: `AGENTS.md` (ownership), `HANDOVER.md`, e
  `server/cmd/magesmoke` (CLI de smoke do protocolo, sem tocar no
  composition root).

## Key decisions (and why)
- Servidor Go independente (sem compartilhar código TS) — não há
  reaproveitamento direto entre stacks.
- Pacote `match` como único ponto que une `room` + `game` + `bot`, para
  `room` ficar lobby-only.
- Trabalho paralelo: Cursor só cria paths novos fora das zonas quentes do
  Claude (cliente + `cmd/mageserver` + `internal/{game,bot,room,match}`).

## Plan / todo status
- Plan: `servidor_go_de_salas_por_time_*.plan.md` (home do Cursor)
- Done: GDD update, skill session-handover, `game`, `bot`, `protocol`,
  `ws`, `room`, `match`, wiring em `cmd/mageserver`, integration tests.
- In progress (Claude): integração do cliente Three.js/Preact com o
  protocolo WS.
- Pending: desconexão mid-match (forfeit / bot takeover), obstáculos/LoS,
  persistência/contas.

## Known issues / risks
- Dois agentes no mesmo working tree já quase corromperam `internal/room`
  (teste e implementação com APIs diferentes). Usar worktree/branch.
- `server/README.md` no main pode ainda descrever o wiring como "não
  plugado" — estava desatualizado no momento deste handover.

## Next steps
1. Claude: terminar o cliente falando o protocolo (`create_room` →
   `snapshot` / `round_end`).
2. Cursor: manter-se fora de `src/**` e `cmd/mageserver/**`; mergear
   `cursor/safe-parallel` (magesmoke + AGENTS/HANDOVER) quando conveniente.
3. Atualizar `server/README.md` uma vez só, após o merge, para refletir
   `match` + `magesmoke`.
