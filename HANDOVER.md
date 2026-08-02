# Handover — 2026-08-02

## What changed this session
- Board de tarefas do **mínimo jogável** (integração client ↔ Go), com
  critério de pronto e ownership. Canvas:
  `~/.cursor/projects/.../canvases/mvp-jogavel-tarefas.canvas.tsx`.
- Estado herdado: servidor Go completo; cliente com UI shell + lobby **local**
  (`src/app/roomStore.ts`); SP vs AI jogável; `NetworkClient` ainda não existe.

## Key decisions (and why)
- **MVP = 1v1 online com bot**, não 6x6 nem ranking — o Go já cobre NxN/bots;
  o gap é só o cliente falando o protocolo.
- Contas/`api/`, obstáculos Go, predição e forfeit ficam **P2** — não bloqueiam
  “partida jogável”.
- Critério de pronto: create room → add bot → select element → start →
  snapshots → `round_end` → menu.

## Plan / todo status
- Plan: canvas `mvp-jogavel-tarefas` (substitui o “pending genérico” abaixo)
- Done: Go `game`/`bot`/`room`/`match`/`protocol`/`ws`/`mageserver`;
  `magesmoke`; SP offline; UI shell stub.
- In progress (Claude): UI client — ainda sem fio WS.
- Pending P0: NetworkClient → lobby real → online Game mode → interp →
  input → POV → round_end UI → smoke humano+bot.
- Pending P1: elementos no combate SP; HUD online; UX disconnect; menu
  SP vs Online limpo.
- Pending P2: predição; forfeit/bot-takeover; LoS Go; api PvP; NxN polish.

## Known issues / risks
- `roomStore` é local/demo — criar/entrar por código ainda não bate no Go.
- Picker de elemento no client não muda o projétil SP (`SNOWBALL`).
- Dois agentes: Claude na zona `src/**`; Cursor fora dela (`AGENTS.md`).
- `gh` auth inválida neste ambiente — issues no GitHub não foram criadas.

## Next steps
1. Claude: `src/net/NetworkClient` + tipos do protocolo → ligar lobby do App.
2. Claude: modo online (sem sim local) + interp + input + POV + round_end.
3. Validar: `go run ./cmd/mageserver` + browser, 1v1 vs bot até `round_end`.
4. Cursor: manter-se fora de `src/**`; merge `cursor/safe-parallel` quando ok.
