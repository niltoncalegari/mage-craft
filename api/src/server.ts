import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';

async function main(): Promise<void> {
  await connectDb(config.mongoUri);
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`mage-craft-api: listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error('mage-craft-api: failed to start', err);
  process.exit(1);
});
