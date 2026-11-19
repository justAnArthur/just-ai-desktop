# AGENTS.md — JustAIDesktop

JustAIDesktop is a desktop app on the just-apps platform (`@justanarthur/modo-ui` + Tauri). This repo (`just-ai-desktop`) is mounted at `apps/ai-desktop` in just-apps and builds only there: read `../../AGENTS.md` first, it has the platform's layout, rules and checks.

- Here: the app's screens and logic (`src/`), its config (`app.json`), its own native commands (`src-tauri/src/main.rs`). Everything generic (window chrome, settings window, command palette, store, Tauri setup) comes from the platform; a capability other apps could use goes there, not here.
- Never edit `src-tauri/tauri.conf.json` or `src-tauri/capabilities/` by hand: `bun run app sync ai-desktop` (from the just-apps root) writes them from `app.json`.
- Run: `bun run app dev ai-desktop` (desktop) or `bun run dev` here (browser, web host).
- Releases: Conventional Commits scoped to `just-ai-desktop`, `ai-desktop`, `app`, `ui` or `native` bump `package.json` and tag `just-ai-desktop@x.y.z`, which builds the macOS app (see `.github/workflows/build-macos-on-tag.yml`). After committing here, commit the new submodule pointer in just-apps.
