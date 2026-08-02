# Handover — 2026-08-02 (Cursor — join-as-spectator + bots no create)

## What changed this session
- **Protocolo**: `fillBots`/`botDifficulty` em `create_room`; `list_rooms` /
  `room_list`; `claim_slot`; `room_state` com `spectators`, `youRole`,
  `pendingClaimPlayerId`.
- **Room/Session**: `JoinAsSpectator`, `ClaimSlot`, `FillEmptyWithBots`,
  rematch após `round_end` (`ApplyClaims` + `ResetToLobby`) — não fica em
  `ended` permanente.
- **mageserver**: handlers + restart de `RunLoop` no rematch; auto-fill bots
  no `select_element` quando a sala foi criada com `fillBots`.
- **magesmoke** + integration test cobrem fillBots + spectator claim.
- **Cliente**: `src/net/{protocol,NetworkClient,lobbyBridge,OnlineMatch}.ts`;
  UI create com checkbox de bots; lista live; join mid-match como espectador;
  claim de bot; Start online com render de snapshots.

## Key decisions (and why)
- Join mid-match = **espectador** até o fim da rodada; claim só aplica no
  rematch (bot continua jogando). Mais simples e alinhado ao pedido do user.
- `round_end` → lobby de rematch (não sala morta), para o late joiner entrar.
- Ownership desta fatia: **Cursor** (ver `AGENTS.md`).

## Plan / todo status
- Done: protocolo, room/session/rematch, mageserver, magesmoke, NetworkClient,
  UI create/list/spectator/claim, OnlineMatch snapshots, AGENTS/HANDOVER.
- Pending polish: host explícito no server; interpolação de snapshots;
  POV-relative colors no OnlineMatch; forfeit/disconnect bot-takeover mid-round.

## Known issues / risks
- OnlineMatch é render mínimo (capsules + projéteis), não o pipeline SP completo.
- `isHost` no client é “quem criou”; server ainda deixa qualquer um dar Start.
- Create/join com server offline cai no lobby local (demos / practice).
- Dois agentes: Claude deve coordenar antes de tocar `src/**` ou
  `server/internal/{room,match,protocol}` / `cmd/mageserver`.

## Next steps
1. Jogar manualmente: `go run ./cmd/mageserver` + Vite; create com bots →
   Start → 2º browser join live → claim → esperar round_end → Start rematch.
2. `go test ./...` no server (já verde na entrega).
3. Claude (se retomar UI): polish HUD/POV online em cima de `OnlineMatch` /
   NetworkClient sem reescrever o protocolo.
