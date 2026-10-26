export interface ReleaseState {
  currentVersion: string;
  previousVersion: string;
  npmPublished: boolean | string;
  tagExists: boolean | string;
  releaseExists: boolean | string;
}

export interface ReleaseDecision {
  changed: boolean;
  shouldRelease: boolean;
  reason: string;
}

export function decideReleaseAction(state: ReleaseState): ReleaseDecision;
