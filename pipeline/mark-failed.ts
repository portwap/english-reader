// Marks a text as failed when its workflow run stopped before process.ts could say so (cancelled or timed out).
// Without this, the text would stay "processing" forever.
//
// Usage: node pipeline/mark-failed.ts --id <text id>   (needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN)

import { parseArgs } from 'node:util';
import { ID_PATTERN } from '../shared/new-text.ts';
import { netlifyStorage } from './store.ts';

/** Sets status "error" on the text if it is still "processing"; a real error message is never overwritten. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { id: { type: 'string' } } });
  const id = values.id ?? '';
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid text id "${id}".`);
  const siteID = process.env.NETLIFY_SITE_ID?.trim();
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  if (!siteID || !token) throw new Error('The settings NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are needed.');

  const storage = netlifyStorage(siteID, token);
  const doc = await storage.getDoc(id);
  if (!doc || doc.status !== 'processing') return;
  const at = new Date().toISOString();
  await storage.saveDoc({
    ...doc,
    status: 'error',
    error: 'The processing run on GitHub stopped before finishing (cancelled or out of time).',
    updatedAt: at,
    log: [...(doc.log ?? []), { type: 'stopped', at }],
  });
  console.log(`Text ${id} marked as failed.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
