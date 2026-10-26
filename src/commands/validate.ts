import { ensureOmmForRead, listAllElements, readField, classExists } from '../lib/store.js';
import { validateDiagram } from '../lib/validate.js';

function validateClass(className: string, allClasses: string[], diagram: string): { errors: number; warnings: number } {
  const result = validateDiagram(diagram, { className, allClasses });
  const errors = result.issues.filter(i => i.level === 'error').length;
  const warnings = result.issues.filter(i => i.level === 'warning').length;

  const status = result.valid
    ? `✓ valid${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`
    : `✗ invalid (${errors} error${errors > 1 ? 's' : ''}${warnings > 0 ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''})`;

  process.stdout.write(`${className}:\n  ${status}\n`);
  for (const issue of result.issues) {
    const loc = issue.line ? ` line ${issue.line}:` : '';
    process.stdout.write(`  ${issue.level} [${issue.rule}]${loc} ${issue.message}\n`);
  }
  process.stdout.write('\n');

  return { errors, warnings };
}

export function commandValidate(className?: string): void {
  if (!ensureOmmForRead()) return;

  const allClasses = listAllElements();

  if (className) {
    if (!classExists(className)) {
      process.stderr.write(`error: element '${className}' not found\n`);
      process.exit(1);
    }
    const diagram = readField(className, 'diagram');
    if (!diagram) {
      process.stdout.write(`${className}:\n  (no diagram)\n\n`);
      return;
    }
    const { errors } = validateClass(className, allClasses, diagram);
    if (errors > 0) process.exit(1);
    return;
  }

  // Validate every element in the tree that has a diagram (leaves usually don't)
  let checked = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const element of allClasses) {
    const diagram = readField(element, 'diagram');
    if (!diagram) continue;
    const { errors, warnings } = validateClass(element, allClasses, diagram);
    checked++;
    totalErrors += errors;
    totalWarnings += warnings;
  }

  process.stdout.write(`${checked} diagram${checked === 1 ? '' : 's'} checked: ${totalErrors} error${totalErrors === 1 ? '' : 's'}, ${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}\n`);
  if (totalErrors > 0) process.exit(1);
}
