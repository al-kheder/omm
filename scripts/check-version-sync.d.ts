export interface VersionInfo {
  packageVersion: string;
  pluginVersion: string;
  marketplaceVersion: string | null;
}

export function collectVersionInfo(rootDir?: string): VersionInfo;
export function getVersionMismatchMessages(versions: VersionInfo): string[];
export function runVersionSyncCheck(rootDir?: string): void;
