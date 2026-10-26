import { execSync } from 'node:child_process';

/** Current git commit and branch, recorded in meta.yaml as the baseline for each write */
export function getGitInfo(cwd: string): { commit?: string; branch?: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
    const branch = execSync('git branch --show-current', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
    return { commit: commit || undefined, branch: branch || undefined };
  } catch {
    return {};
  }
}
