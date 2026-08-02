# E2E (Playwright)

Covers the accounts/ranking/dashboard slice (`docs/accounts-ranking-dashboard.md`)
against the real dockerized stack — not the Vite dev server — so it exercises
the same Nginx→api→Mongo path a VPS deploy uses.

```bash
npm run test:e2e   # docker compose up --build -d, runs the suite, docker compose down
```

To iterate without rebuilding each time:

```bash
docker compose up --build -d
npx playwright test --ui   # or: npx playwright test
docker compose down
```

Gameplay itself (WebGL duel) isn't driven headlessly here — it's slow and
flaky in CI. Match reporting is exercised by calling `POST /api/matches`
directly with the session token, the same payload shape `MatchReporter`
(`src/net/MatchReporter.ts`) sends after a real SP-vs-AI round.
