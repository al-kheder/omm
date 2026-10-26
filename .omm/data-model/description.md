The on-disk data model of oh-my-mermaid. Everything lives in a `.omm/` directory in the project. `config.yaml` sits at its root, and every other directory is an **element**: top-level directories are perspectives, and nested directories are child elements. Each element stores up to seven field files and an auto-managed `meta.yaml`.

Source: `src/lib/store.ts` (paths, fields, meta), `src/types.ts` (`FIELD_FILES`, `ClassMeta`, `OmmConfig`).
