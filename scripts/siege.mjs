/**
 * Plays a real siege match through the browser, to answer the one question unit
 * tests cannot: can a human open this and play?
 *
 * It drives the actual UI — Enter Hall, guest sign-in, Battle, wait out the
 * queue, click a card, click the arena — and reads the WebSocket traffic in the
 * page to confirm the server accepted the summon. Needs both dev servers up:
 *   npm run dev:server   # :8080
 *   npm run dev          # :5173
 *   node scripts/siege.mjs
 *
 * Set CHROME_PATH to use an installed browser instead of Playwright's own (the
 * same escape hatch the other scripts here take).
 */
import { chromium } from 'playwright';

const url = process.env.SIEGE_URL || 'http://localhost:5173/';
/** The queue's bot fallback plus a beat for the sweep to run. */
const QUEUE_WAIT_MS = 16_000;

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const problems = [];
let exitCode = 0;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  // Record the wire from inside the page: what the client sent, what it got.
  await page.addInitScript(() => {
    window.__wire = { sent: [], snapshots: [], types: [], found: null };
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            window.__wire.types.push(msg.type);
            if (msg.type === 'snapshot') window.__wire.snapshots.push(msg);
            if (msg.type === 'match_found') window.__wire.found = msg;
          } catch {
            /* not JSON */
          }
        });
      }
      send(data) {
        try {
          window.__wire.sent.push(JSON.parse(data));
        } catch {
          /* not JSON */
        }
        return super.send(data);
      }
    };
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  await page.getByRole('button', { name: 'Enter Hall' }).click();
  await page.getByRole('textbox').first().fill('Smoke Conjuror');
  await page.getByRole('button', { name: /^(Continue|Enter|Sign in|Play)/ }).click();

  await page.getByRole('button', { name: /Battle/ }).click();
  step('queued', await page.getByText(/Finding an opponent/).isVisible());

  // No second human is searching, so the server hands the other side to an AI.
  await page.waitForFunction(() => window.__wire.types.includes('match_start'), null, {
    timeout: QUEUE_WAIT_MS,
  });
  step('match started', true);

  await page.waitForFunction(() => window.__wire.snapshots.length > 3, null, { timeout: 10_000 });
  const first = await page.evaluate(() => window.__wire.snapshots.at(-1));
  step(`structures on the wire: ${first.structures.length}`, first.structures.length === 6);
  step(`hand on the wire: ${JSON.stringify(first.hand)}`, first.hand.length === 4);
  step(`mana ${first.mana}`, typeof first.mana === 'number');

  // The card bar has to be real DOM a human can click, not just wire data.
  const cards = page.locator('button:has-text("Tanque"), button:has-text("Dano"), button:has-text("Suporte")');
  await cards.first().waitFor({ timeout: 10_000 });
  step(`cards drawn: ${await cards.count()}`, (await cards.count()) === 4);

  const affordable = cards.filter({ hasNot: page.locator('[disabled]') });
  await affordable.first().click();

  const before = await page.evaluate(() => window.__wire.snapshots.at(-1));
  const myTeam = await page.evaluate(() => window.__wire.found.yourTeam);

  // Click our own half of the arena: that is the deploy zone (GDD §5).
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.5);

  await page.waitForFunction(() => window.__wire.sent.some((m) => m.type === 'cast'), null, {
    timeout: 5_000,
  });
  const cast = await page.evaluate(() => window.__wire.sent.find((m) => m.type === 'cast'));
  step(`cast sent: ${cast.cardId} at (${cast.position.x.toFixed(1)}, ${cast.position.y.toFixed(1)})`, true);

  // The server is the judge, and only a unit on *our* team proves it: the AI
  // commander is summoning at the same time on the other side.
  const mine = await page
    .waitForFunction((team) => window.__wire.snapshots.at(-1).mages.some((m) => m.team === team), myTeam, {
      timeout: 8_000,
    })
    .then(() => true)
    .catch(() => false);
  step(`our own unit is in the arena (team ${myTeam})`, mine);

  const after = await page.evaluate(() => window.__wire.snapshots.at(-1));
  step(`mana paid: ${before.mana} -> ${after.mana}`, after.mana < before.mana);
  step(`hand cycled: ${before.hand[0]} -> ${after.hand.join(', ')}`, !after.hand.includes(cast.cardId));

  const errors = await page.evaluate(() =>
    window.__wire.types.filter((t) => t === 'error').length,
  );
  step(`server errors: ${errors}`, errors === 0);

  const last = await page.evaluate(() => window.__wire.snapshots.at(-1));
  console.log(
    `\nlast snapshot: tick ${last.tick} · elapsed ${last.elapsed.toFixed(1)}s · mana ${last.mana} · ` +
      `units ${last.mages.length} · hand ${last.hand.join(', ')}`,
  );

  await page.screenshot({ path: 'siege-smoke.png' });
  console.log('screenshot: siege-smoke.png');
} catch (err) {
  problems.push(`threw: ${err.message}`);
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(` - ${p}`);
  exitCode = 1;
}
process.exit(exitCode);

function step(label, ok) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) problems.push(label);
}
