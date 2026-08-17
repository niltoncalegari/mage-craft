/**
 * Plays a real siege match through the browser, to answer the one question unit
 * tests cannot: can a human open this and play?
 *
 * Since the idle pivot "play" means something else, and so does this script.
 * The old version clicked a card and then clicked the arena; there is nothing
 * to click any more. What it checks now is the stronger claim: the player takes
 * their hands off the controls after pressing Battle, and the match plays
 * itself — mana is spent, the hand cycles, and the HUD names which of their own
 * rules did it.
 *
 * It drives the actual UI — Enter Hall, register, Find Match, wait out the
 * queue — and reads the WebSocket traffic in the page. Playing needs an account
 * now, so it registers a throwaway one per run; that means the API and its
 * Mongo have to be up alongside the two dev servers:
 *   docker compose up -d mongo
 *   cd api && npm run dev   # :4000, proxied at /api by the Vite dev server
 *   npm run dev:server      # :8080
 *   npm run dev             # :5173
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

  // A throwaway account per run: nick, e-mail, password, in that field order.
  const stamp = Date.now().toString().slice(-8);
  await page.getByRole('button', { name: 'Enter Hall' }).click();
  await page.getByRole('button', { name: 'Register' }).click();
  const fields = page.locator('input');
  await fields.nth(0).fill(`Smoke${stamp.slice(-4)}`);
  await fields.nth(1).fill(`smoke${stamp}@example.com`);
  await fields.nth(2).fill('Passw0rd!23');
  await page.getByRole('button', { name: /^(Create account|Register|Sign up)/ }).last().click();
  await page.getByRole('button', { name: /Sign out/ }).waitFor({ timeout: 10_000 });
  step('registered', true);

  await page.getByRole('button', { name: /Find Match/ }).click();

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

  // The card bar has to be real DOM, showing the hand the wire just described —
  // an idle player still reads it to see how far off their next card is. Keyed
  // on the kind label each card carries, which nothing else on screen renders.
  const cards = page.getByText(/^(Blessing|Curse)$/);
  await cards.first().waitFor({ timeout: 10_000 });
  step(`cards drawn: ${await cards.count()}`, (await cards.count()) === 4);

  const myTeam = await page.evaluate(() => window.__wire.found.yourTeam);

  // Nothing is clicked from here on. That is the test.
  const fired = await page
    .waitForFunction(() => window.__wire.snapshots.at(-1)?.firedRule != null, null, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);
  step('a rule fired with nobody touching the page', fired);

  const after = await page.evaluate(() => window.__wire.snapshots.at(-1));
  if (after.firedRule) {
    const r = after.firedRule;
    step(`rule ${r.index + 1} cast ${r.cardId} at ${r.at}`, true);
  }

  // The trace panel is the whole feedback loop of an idle match: if the wire
  // says a rule fired and the screen does not, the player is watching a
  // screensaver.
  const traced = await page
    .getByText(/^Regra \d+ · /)
    .first()
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  step('the HUD names the rule that fired', traced);

  // Asked of the whole recorded history rather than of two sampled snapshots:
  // the first rule fires within a second of match start, so anything captured
  // after the card bar has rendered is already past it.
  const history = await page.evaluate(() =>
    window.__wire.snapshots.map((s) => ({ mana: s.mana, hand: s.hand.join(',') })),
  );
  const manaFell = history.some((s, i) => i > 0 && s.mana < history[i - 1].mana);
  const hands = new Set(history.map((s) => s.hand));
  step(`mana was spent (${history.length} snapshots)`, manaFell);
  step(`hand cycled: ${hands.size} distinct hands`, hands.size > 1);
  step(`our squad is in the arena (team ${myTeam})`, after.mages.some((m) => m.team === myTeam));

  // Clicking the arena has to be inert now — the camera may pan, but no cast
  // may leave the page.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.5);
  const casts = await page.evaluate(() => window.__wire.sent.filter((m) => m.type === 'cast').length);
  step('clicking the arena sends no cast', casts === 0);

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
