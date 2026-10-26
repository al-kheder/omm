import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function readJson(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// pnpm-lock.yaml does not record the package's own version, so only the manifests are compared
export function collectVersionInfo(rootDir = process.cwd()) {
  const pkg = readJson(rootDir, 'package.json');
  const plugin = readJson(rootDir, '.claude-plugin/plugin.json');
  const marketplace = readJson(rootDir, '.claude-plugin/marketplace.json');

  return {
    packageVersion: pkg.version,
    pluginVersion: plugin.version,
    marketplaceVersion: marketplace.plugins?.[0]?.version ?? null,
  };
}

export function getVersionMismatchMessages(versions) {
  const mismatches = [];
  const { packageVersion, pluginVersion, marketplaceVersion } = versions;

  if (packageVersion !== pluginVersion) {
    mismatches.push(`plugin.json version (${pluginVersion}) != package.json (${packageVersion})`);
  }
  if (packageVersion !== marketplaceVersion) {
    mismatches.push(`marketplace.json version (${marketplaceVersion}) != package.json (${packageVersion})`);
  }

  return mismatches;
}

export function runVersionSyncCheck(rootDir = process.cwd()) {
  const versions = collectVersionInfo(rootDir);
  const mismatches = getVersionMismatchMessages(versions);

  if (mismatches.length > 0) {
    for (const mismatch of mismatches) {
      process.stderr.write(`::error::${mismatch}\n`);
    }
    process.stderr.write('\nRun: pnpm version <patch|minor|major> && pnpm sync-version\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`All versions in sync: ${versions.packageVersion} ✓\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVersionSyncCheck();
}
