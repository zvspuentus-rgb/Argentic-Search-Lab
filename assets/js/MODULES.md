# JS Module Map

This project uses browser-loaded JS modules in strict load order from `AppAgent.html`:

1. `app-core.js`
   - Global state, constants, flow stages, execution mode resolver.
2. `app-state.js`
   - localStorage/session persistence, settings snapshots, UI state restore.
3. `app-utils.js`
   - shared helpers: ranking, dedupe, HTTP wrapper, provider router, JSON parsing, translation helper.
4. `app-research.js`
   - discovery/research pipelines, agents orchestration, synthesis, exports, quick/deep paths.
5. `app-ui.js`
   - UI wiring, chat shell controls, file attachments, events, startup boot.

## Safe upgrade pattern
- Add pure helpers in `app-utils.js`.
- Add persistence-related fields only in `app-state.js`.
- Keep heavy pipeline logic inside `app-research.js`.
- Keep direct DOM event handling inside `app-ui.js`.
- When introducing new globals, verify load order dependencies.
