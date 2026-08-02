# Contas, ranking, logs de partida e dashboard do jogador

**Status:** implementação inicial (v1) — cobre o modo SP-vs-AI já existente no
client; PvP via `server/` (Go) entra depois, seguindo o mesmo contrato.
**Referência no GDD:** §19 — Contas, ranking e dashboard.

---

## 1. Objetivo

Dar ao jogador uma conta persistente, um histórico de partidas, um ranking
global e um dashboard com estatísticas (KDR, elemento mais jogado, uso de
habilidades) — hoje alimentado pelo modo SP-vs-AI, e pronto para receber
partidas PvP do servidor Go assim que a sala/lobby (`server/internal/room`)
estiver pronta.

Fora de escopo nesta etapa (ver `GDD.md` §14/§10 para o estado do servidor
Go): o servidor Go **não** está integrado a este backend ainda — ele não
reporta partidas automaticamente. Isso fica documentado como contrato (§4)
para a sessão/fase que terminar o lobby de salas ligar o fio.

## 2. Arquitetura

```
Client (Vite/Preact, src/)  --REST+JWT-->  api/ (Node/TS + Express)  -->  MongoDB
        |                                        ^
        └── reporta partidas SP-vs-AI ───────────┘  (POST /api/matches)

server/ (Go, salas/PvP)  --(futuro) POST /api/matches com API key-->  api/
```

- **`api/`**: serviço Node/TypeScript novo, independente do servidor Go de
  jogo (`server/`). Stack: Express + Mongoose + bcrypt + jsonwebtoken.
- **MongoDB**: banco único, coleções `users` e `matchlogs`.
- **Client**: novas telas em `src/ui/` (aba `account`, `dashboard`,
  `ranking`) e novos módulos `src/net/ApiClient.ts`,
  `src/net/MatchReporter.ts`, `src/engine/AuthSession.ts`.

## 3. Modelo de dados (MongoDB)

### `users`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `username` | string | único, exibido no ranking |
| `email` | string | único, usado no login |
| `passwordHash` | string | bcrypt |
| `createdAt` | date | |

### `matchlogs`

| Campo | Tipo | Notas |
| --- | --- | --- |
| `userId` | ObjectId | ref `users` |
| `mode` | `'sp-vs-ai' \| 'pvp'` | hoje só `sp-vs-ai`; `pvp` é o contrato futuro |
| `won` | boolean | |
| `kills` | number | inimigos derrotados na partida |
| `deaths` | number | vezes que o próprio jogador foi derrotado (vidas gastas) |
| `score` | number | reaproveita a pontuação já calculada pelo client (`src/game/score.ts`) |
| `difficulty` | `'easy' \| 'normal' \| 'hard'` | |
| `timeSeconds` | number | duração da partida |
| `livesSpent` | number | |
| `map` | string | nome do arquivo em `public/maps/` |
| `elements` | `Array<{ elementId: string; casts: number; hits: number; kills: number; damageDealt: number }>` | uso por elemento; hoje sempre `[{ elementId: 'fire', ... }]` (só um elemento existe no client — ver `GDD.md` §8); genérico o bastante para o catálogo completo quando o client ganhar múltiplos elementos |
| `createdAt` | date | |

O campo `elements` é a fonte dos gráficos de "habilidades utilizadas" e do
"elemento mais jogado" no dashboard. Como o client hoje só lança `SNOWBALL`
(equivalente a `fire`), cada log de SP-vs-AI tem uma única entrada nesse
array — o schema já suporta N elementos por partida sem migração quando o
catálogo completo (`fire, ice, lightning, poison, stone, arcane, wind`)
chegar ao client.

## 4. API (`api/`)

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | — | `{ username, email, password }` → cria usuário, retorna JWT |
| POST | `/api/auth/login` | — | `{ email, password }` → retorna JWT |
| GET | `/api/me` | JWT (`Authorization: Bearer <token>`) | perfil + stats agregados: `wins`, `losses`, `kills`, `deaths`, `kdr`, `favoriteElement` |
| GET | `/api/me/matches?page=&limit=` | JWT | histórico de partidas, mais recente primeiro |
| GET | `/api/me/stats/elements` | JWT | `[{ elementId, casts, hits, kills, damageDealt }]` agregado de todas as partidas — dado bruto para o gráfico do dashboard |
| GET | `/api/ranking?page=&limit=&sort=wins\|kdr` | opcional | leaderboard global |
| POST | `/api/matches` | API key (`X-Api-Key`, env `MATCH_INGEST_API_KEY`) | ingest de um `MatchLog` completo — hoje chamado pelo client autenticado por JWT (o client troca o JWT por uma chamada assinada com a API key de servidor, feita pelo backend `api/` para si mesmo — ver nota abaixo) |
| GET | `/healthz` | — | liveness check (Docker) |

> **Nota sobre `POST /api/matches`:** o client autenticado (JWT) chama
> `POST /api/matches` normalmente com seu próprio token — a rota aceita tanto
> JWT de usuário (client hoje) quanto API key de servidor (para o servidor Go
> reportar partidas PvP no futuro, sem precisar de um JWT de usuário por
> jogador). Isso evita duplicar endpoints quando o PvP chegar.

## 5. Cliente

- `src/engine/AuthSession.ts` guarda `{ token, username }` em `localStorage`
  (mesmo padrão de `src/engine/Settings.ts`), fora do save de gameplay.
- `src/net/ApiClient.ts` é o único ponto que fala com `api/` via `fetch`
  (`VITE_API_URL`, default `http://localhost:4000` em dev).
- `src/net/MatchReporter.ts` assina os eventos já existentes em
  `src/core/events.ts` (`SnowballThrown`, `PlayerHit`, `PlayerDefeated`,
  `RoundEnded`) para montar o `MatchLog` sem tocar na simulação, e só chama
  `ApiClient.reportMatch` quando há sessão ativa — offline continua
  funcionando exatamente como hoje (`Settings.ts` local) se o jogador não
  estiver logado.
- Abas novas em `src/ui/Menus.tsx`: `account` (login/registro/logout),
  `dashboard` (KDR, W/L, elemento favorito, histórico recente,
  `ElementUsageChart`), `ranking` (leaderboard global).

## 6. Deploy (Docker / VPS)

Ver `docker-compose.yml` na raiz do repo: serviços `mongo`, `api`,
`gameserver` (Go, `server/Dockerfile`) e `client` (Nginx servindo o build do
Vite, proxy para `api` e para o WebSocket do `gameserver`). Variáveis em
`.env` (ver `.env.example`).

## 7. Próximos passos

- Ligar `server/` (Go) ao `POST /api/matches` quando `internal/room`
  (lobby/partida PvP) estiver pronto — reportar `mode: 'pvp'`, kills/deaths
  reais por jogador do time, e uso por elemento do catálogo completo.
- Quando o client ganhar múltiplos elementos (GDD §7, fase Beta/Release),
  `MatchReporter` passa a reportar `elements` com mais de uma entrada por
  partida — nenhuma mudança de schema necessária.
- Rating/matchmaking (fora de escopo do GDD v1, §10.3) usaria as mesmas
  coleções (`matchlogs`) como base de cálculo.
