# AGENTS.md — Agents

Agents is a desktop app on the just-apps platform (`@justanarthur/modo-ui` + Tauri). This repo (`just-agents-desktop`) is mounted at `apps/agents` in just-apps and builds only there: read `../../AGENTS.md` first, it has the platform's layout, rules and checks.

- Here: the app's screens and logic (`src/`), its config (`app.json`), its own native commands (`src-tauri/src/main.rs`). Everything generic (window chrome, settings window, command palette, store, Tauri setup) comes from the platform; a capability other apps could use goes there, not here.
- Never edit `src-tauri/tauri.conf.json` or `src-tauri/capabilities/` by hand: `bun run app sync agents` (from the just-apps root) writes them from `app.json`.
- Run: `bun run app dev agents` (desktop) or `bun run dev` here (browser, web host).
- Releases: Conventional Commits scoped to `just-agents-desktop`, `agents`, `app`, `ui` or `native` bump `package.json` and tag `just-agents-desktop@x.y.z`, which builds the macOS app (see `.github/workflows/build-macos-on-tag.yml`). After committing here, commit the new submodule pointer in just-apps.
