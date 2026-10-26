# Project Rules

## README Localization

- `README.md` (English) is the source of truth
- Maintain translations: `README.tr.md`, `README.ko.md`, `README.ja.md`, `README.zh.md`
- Every README (including English) must have language links at the top:
  ```
  [English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)
  ```
- Translated READMEs include a disclaimer at the top:
  > This document was translated from the English README. Some phrasing may be unnatural.
- When updating `README.md`, update all translations in the same commit
- Translations can be machine-generated but should be reviewed for obvious errors

## Package Manager

- Use pnpm for development: `pnpm install`, `pnpm test`, `pnpm build`, `pnpm typecheck`. The version is pinned in `package.json` `packageManager`; run `corepack enable` to get it.
- Don't add a `package-lock.json` or `yarn.lock`. `pnpm-lock.yaml` is the only lockfile.
- Keep lifecycle scripts (`prepare`, `prepublishOnly`) free of `pnpm`/`npm` calls. Users install the CLI with `npm install -g github:al-kheder/omm`, and `prepare` runs under their npm.
- Packages with install scripts must be listed in `pnpm.onlyBuiltDependencies`.

## Versioning

- Follow [Semantic Versioning](https://semver.org/)
- Sync version across: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/)
- Co-author tag for AI-assisted commits

## Terminology

- "element" — any architectural unit in `.omm/`
- "perspective" — top-level element only
- "group" — element with children (rendered as expandable box in viewer)
- "leaf" — element without children
- Do not use "class" in user-facing strings (internal code names like `listClasses` are fine)
