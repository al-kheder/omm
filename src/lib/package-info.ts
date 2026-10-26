/** Identity of this fork — the single place to change when the package is renamed or published. */
export const PACKAGE_NAME = '@al-kheder/oh-my-mermaid';
export const REPO_SLUG = 'al-kheder/oh-my-mermaid';
export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/** npm install spec. Points at GitHub until the package is published to npm. */
export const INSTALL_SPEC = `github:${REPO_SLUG}`;

/** Claude Code marketplace name (must match .claude-plugin/marketplace.json "name") */
export const CLAUDE_MARKETPLACE = 'al-kheder-omm';
export const CLAUDE_PLUGIN = 'oh-my-mermaid';
