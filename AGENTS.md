# AGENTS — ownership para trabalho paralelo

Este repo costuma ter **dois agentes** (Cursor e Claude Code) ativos ao mesmo
tempo. Para evitar colisões, cada agente só edita a sua zona. Antes de
escrever num arquivo fora da sua zona, parar e coordenar.

## Zonas atuais (2026-08-02)

| Zona | Paths | Owner sugerido |
| --- | --- | --- |
| Cliente / UI + net | `src/**` (incl. `src/net/**`), `index.html`, `public/**`, `package.json`, Vite/CSS | Cursor (fatia join-spectator / bots-no-create) |
| Simulação + lobby + match | `server/internal/game/**`, `server/internal/bot/**`, `server/internal/room/**`, `server/internal/match/**` | Cursor (mesma fatia — spectator/claim/rematch) |
| Composition root do server | `server/cmd/mageserver/**` | Cursor (mesma fatia) |
| Protocolo + transporte | `server/internal/protocol/**`, `server/internal/ws/**` | Cursor (contrato estendido nesta sessão) |
| Docs de produto | `GDD.md`, `multiplayer-plan.md` | Coordenar antes de editar |
| Ferramentas / smoke / handover | `server/cmd/magesmoke/**`, `AGENTS.md`, `HANDOVER.md`, `.cursor/skills/**` | Cursor |

## Regras

1. **Arquivos novos > editar arquivos quentes.** Preferir criar paths novos
   (`server/cmd/magesmoke/`, `src/net/`, `HANDOVER.md`) a mexer em arquivos
   que o outro agente está reescrevendo sem coordenar.
2. **Branch/worktree separado** quando os dois agentes forem escrever ao
   mesmo tempo. Exemplo deste setup:
   - working tree principal: Claude Code
   - worktree `../mage-craft-cursor` na branch `cursor/safe-parallel`: Cursor
3. **Não reescrever** um pacote que o outro agente acabou de criar. Se o
   teste e a implementação divergirem (já aconteceu em `internal/room`),
   parar e alinhar a API em vez de sobrescrever.
4. **Atualizar `HANDOVER.md`** ao fim da sessão (skill `session-handover`).

## Como validar o server sem ser o cliente

```bash
cd server
go test ./...
go run ./cmd/mageserver          # PORT=8080 por default
go run ./cmd/magesmoke -addr ws://localhost:8080/ws
```

Cliente (Vite): `VITE_WS_URL=ws://localhost:8080/ws` (default se omitido).
