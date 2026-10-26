# StarChad landing site at /web/

Published 2026-10-26. Authoring source is `/home/david/repos/galaxy/artifacts/starchad`.
Build with `STARCHAD_ENGINE=/web/engine/showcase.html node site/build.mjs` there.
Copy only the generated HTML and `assets/` into `starriser/web/`.
Registration is closed in both editions and all campaign pages: no registration
forms, submit handlers or simulated success messages. The market quantity field
remains a local illustration.

`starriser/web/engine` is a deployment symlink to a frozen, independently
verified static renderer reel at `/srv/starchad/reels/45597ef47945c0f4` on
ovh-claude. This snapshot includes its own build, models, maps, content and
SHA-256 manifest. It runs the editor sandbox for the landing-page background;
it does not replace the canonical online game under `/srv/galaxy/current`.
To preview locally, replace this symlink in a separate staging directory with
the local frozen reel, or use Galaxy's `artifacts/starchad/tools/serve.mjs` with
the default engine URL and build.

Deploy only `starriser/web/` to `/srv/personal-site/starriser/web/`, staging it
outside that path first and renaming into place. The initial publication's
commit uses `[skip ci]`: the existing workflow syncs ALL of `starriser/` with
`--delete`, and the live checkout has unrelated interface9 edits that must be
preserved. Do not run that broad sync to deploy this page. The deployment host's
older root checkout is intentionally not reset or cleaned; GitHub and the laptop
checkout hold the new site's source history.

For subsequent deployments, retain the old web directory as rollback and use
an atomic exchange or symlink activation so readers never see a partial upload.
Keep old reel snapshots while any published pages can still reference them.

## 2026-10-26 engine update

The current page uses `/web/engine-4c02e3b9d5e138f2/showcase.html`, a versioned
symlink to `/srv/starchad/reels/4c02e3b9d5e138f2`. It is built from latest
origin/main `bbd89b47`, plus connectivity/startup fix commit `0ffcff85` (Galaxy
branch `fix/starchad-showcase-connectivity-20261026`). The prior `engine` alias
and its snapshot remain for pages already open. Use this new path in
STARCHAD_ENGINE when rebuilding. Packed textures, split geometry and a freshly
compiled matching WASM module are included. The prior reel's local authored
planet catalog is retained; code and packed delivery assets come from latest main.

Build and focused checks pass. All 50 deterministic placement cases connect,
including two failures reproduced on the previous engine. Repeated real-browser
startup and forced generation-error fallback are exercised before publication.
Each new page imports a versioned reel so activation cannot mix its engine files.
