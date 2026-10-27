Evidence (from `omm evidence deployment` and the files it lists):

- `.github/workflows/release.yml`: job `release` runs `pnpm publish --provenance` to registry.npmjs.org and `gh release`, on pushes to `main` that change `package.json`.
- `package.json`: package `@al-kheder/oh-my-mermaid`, command `omm` (`dist/cli.js`), Node.js 18 or later.
- `src/server/index.ts`: the viewer listens on 127.0.0.1 by default (`DEFAULT_HOST`); `src/commands/view.ts`: port 3000 by default.
- `src/lib/cloud.ts`: cloud sync needs `OMM_API_URL`; the login token is stored in `~/.omm/credentials.json`.
- `src/lib/platforms/`: `omm setup` installs the Claude Code plugin with `claude plugin marketplace add`, and copies skills to `~/.agents/skills`, `~/.openclaw/skills`, `~/.gemini/antigravity/skills` and the project's `.cursor-plugin` folder.
- README and CHANGELOG: until the first npm release, install with `npm install -g github:al-kheder/omm`.
