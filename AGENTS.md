# AGENTS — ownership para trabalho paralelo

Este repo costuma ter **dois agentes** (Cursor e Claude Code) ativos ao mesmo
tempo. Para evitar colisões, cada agente só edita a sua zona. Antes de
escrever num arquivo fora da sua zona, parar e coordenar.

## Zonas atuais (2026-08-04)

O servidor Go foi substituído por um servidor Node que importa a **mesma**
simulação TypeScript do cliente (`sim/`). Os paths mudaram — as zonas abaixo
refletem o novo layout.

| Zona | Paths | Owner sugerido |
| --- | --- | --- |
| Cliente / UI + render | `src/**`, `index.html`, `public/**`, Vite/CSS | Cursor |
| **Simulação compartilhada** | `sim/**` (World, Arena, elements, bot/Brain, protocol) | **Coordenar sempre** — é usada pelos dois lados |
| Servidor Node (lobby/match/transporte) | `server/src/**` | Cursor |
| Build / infra | `package.json`, `vite*.config.ts`, `Dockerfile`, `server/Dockerfile`, `docker-compose.yml`, `nginx.conf` | Coordenar |
| Docs de produto | `GDD.md`, `multiplayer-plan.md` | Coordenar antes de editar |
| Handover | `AGENTS.md`, `HANDOVER.md`, `.cursor/skills/**` | Cursor |

> ⚠️ `sim/**` é a zona mais sensível do repo: uma mudança lá altera practice
> mode **e** partidas online ao mesmo tempo. É esse o ponto — mas significa que
> ninguém edita `sim/` sem avisar.

## Regras

1. **Arquivos novos > editar arquivos quentes.** Preferir criar paths novos
   a mexer em arquivos que o outro agente está reescrevendo sem coordenar.
2. **Branch/worktree separado** quando os dois agentes forem escrever ao
   mesmo tempo. Exemplo deste setup:
   - working tree principal: Claude Code
   - worktree `../mage-craft-cursor` na branch `cursor/safe-parallel`: Cursor
3. **Não reescrever** um pacote que o outro agente acabou de criar. Se o
   teste e a implementação divergirem, parar e alinhar a API em vez de
   sobrescrever.
4. **Atualizar `HANDOVER.md`** ao fim da sessão (skill `session-handover`).

## Como validar

Uma suíte só cobre cliente, sim e servidor:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Rodar o servidor sozinho:

```bash
npm run dev:server        # tsx watch, PORT=8080 por default
npm run start:server      # a partir de dist-server/ (após npm run build:server)
```

Cliente (Vite): `VITE_WS_URL=ws://localhost:8080/ws` (default se omitido).
