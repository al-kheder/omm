import { ensureOmmForRead, listClasses, listAllElements, readField, readMeta } from '../lib/store.js';

export function commandStatus(): void {
  if (!ensureOmmForRead()) return;
  const classes = listClasses();

  if (classes.length === 0) {
    process.stdout.write('No perspectives found. Run /omm-scan to generate.\n');
    return;
  }

  process.stdout.write(`Perspectives: ${classes.length}\n\n`);

  const allElements = listAllElements();
  for (const cls of classes) {
    const meta = readMeta(cls);
    const updated = meta?.updated ? new Date(meta.updated).toLocaleString() : 'unknown';
    const count = meta?.update_count ?? 0;

    const elements = allElements.filter(e => e === cls || e.startsWith(`${cls}/`));
    const withDiagram = elements.filter(e => readField(e, 'diagram')).length;
    const withDescription = elements.filter(e => readField(e, 'description')).length;

    process.stdout.write(`  ${cls}\n`);
    process.stdout.write(`    updated: ${updated} (${count} updates)\n`);
    process.stdout.write(`    elements: ${elements.length} (${withDiagram} with diagram, ${withDescription} with description)\n`);
  }
}
