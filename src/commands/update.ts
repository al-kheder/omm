import { execFileSync, execSync } from 'node:child_process';
import { INSTALL_SPEC } from '../lib/package-info.js';

export async function commandUpdate(): Promise<void> {
  // Step 1: Reinstall the package (git installs can't be updated with `npm update`)
  process.stderr.write('Updating oh-my-mermaid CLI...\n');
  try {
    const out = execSync(`npm install -g ${INSTALL_SPEC} 2>&1`, { encoding: 'utf-8' }).trim();
    if (out) process.stderr.write(`  ${out}\n`);
    process.stderr.write('  CLI updated.\n');
  } catch (err: any) {
    process.stderr.write(`  npm install failed: ${err.message}\n`);
    process.stderr.write(`  Try manually: npm install -g ${INSTALL_SPEC}\n`);
    return;
  }

  // Step 2: Re-run setup through the freshly installed CLI
  process.stderr.write('\nUpdating platform plugins...\n');
  try {
    execFileSync('omm', ['setup'], { stdio: 'inherit' });
  } catch (err: any) {
    process.stderr.write('  Updated the npm package, but failed to re-run `omm setup`.\n');
    throw err;
  }
}
