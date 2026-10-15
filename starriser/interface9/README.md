# Galaxy

A browser space-strategy prototype with a WebGPU map, worker-based client, Rust
authority and local SQLite persistence. You can explore the offline sandbox or
run a local multiplayer universe. Online play includes authoritative curved fleet
movement, transfers and same-shard journeys, turn-based battle controls, and a
small factory/construction chain. The offline sandbox supplies richer visual
battle choreography and authoring tools. Public encounter creation, online 3D
battle choreography, the broader life/economy simulation and open signup remain
unfinished. See the [local/online parity review](docs/reviews/2026-10-09-local-online-parity.md)
for the current differences and decisions awaiting approval.

## Install once

Use Linux, Node.js **22.13+**, npm, Rust via **rustup**, a C compiler/linker, and a
Chromium browser with working WebGPU. The repository pins Rust and the WASM target
in `rust-toolchain.toml`; Cargo/rustup installs that toolchain when needed.

From the repository root:

```sh
npm ci
cargo install wasm-bindgen-cli --version 0.2.128 --locked --root .tmp/wasm-bindgen-cli
```

The first Rust build takes longer because it compiles dependencies.

## Start the frontend

```sh
./start.sh
```

This builds TypeScript and the shared Rust/WASM rules, starts the local HTTP
server, watches TypeScript and JavaScript changes and opens the searchable local
showcase catalog at **http://127.0.0.1:8000/labs.html**. Its galaxy link starts the
local sandbox; **http://127.0.0.1:8000/galaxy.html?runtime=mock** also opens it directly.
The root page remains the private-playtest login landing page. Use `./start.sh
online` for the explicitly configured local backend flow; hosted login is unchanged.

```sh
./start.sh --no-open                 # Print the URL without opening a browser
./start.sh --skip-build              # Reuse the existing build
./start.sh --port 8001 --no-watch    # Choose another port and disable watching
```

Ctrl+C stops this frontend server and its watcher. Restart `./start.sh` after
changing Rust rules; the frontend watcher does not rebuild Rust.

## Ship motion system

The live `galaxy.html` scene uses shared GPU route formations: one guide per
fleet, stable per-ship curve offsets and continuous damped individual motion.
Automatic arrivals, departures and authored moves share obstacle-aware routes.
Planetary rings, heavy-ship escorts, visible speed-boost cues and persistent
trails retain individual identity. Following a ship keeps its fleet alive across
system changes and warp. Normal admission is 10K ships, High FX raises it to
50K, and Super FX reserves up to 200K after reload on supported GPUs. Low memory
uses 2K. Created fleets can contain millions of logical ships; only their admitted
representatives consume ship poses and trails. See [quality and memory limits](docs/render-quality.md).

Start with [how fleets move](docs/fleet-motion.md), [journeys and follow](docs/fleet-navigation.md)
and the [graphics stack](docs/graphics-stack.md). The
[runtime guide](docs/ship-runtime.md) supplies APIs and tuning;
[pipeline inventory](docs/graphics-pipelines.md) lists the actual production passes.
The [performance evidence index](docs/evidence/rendering/README.md) separates
controlled comparisons, isolated simulation timings and user-reported results.
The scene deliberately avoids independent predictive collision searches: stable
slots and shared clearance provide its distribution, with inter-fleet overlap
and abrupt-retarget clearance remaining visual limits.

The [ship flight lab](tests/demo-ship-flight-poc/) and separate
[fleet pilot experiment](fleet-pilot.html) remain useful isolated scenarios.
They do not define all production behavior or establish multiplayer combat
integration. The normal frontend build includes the required shared WASM.
The [research archive](docs/research/ship-motion/archive.md) preserves earlier
studies and evidence; the [agent timeline](agent-to-agent/README.md) provides
dated implementation handoffs.

The offline editor supports [battle strategies and weapon tuning](docs/fleet-battles.md),
right-click **Create fleet**, and **Orbit** orders on a planet for a selected fleet.
The [retained DOM UI](docs/ui-runtime.md) coalesces readouts through explicit,
bounded commits while preserving native controls and text selection.

Use the [documentation index](docs/README.md) to find current contracts, module
owners, labs and evidence without treating historical plans as current behavior.

## Start a local multiplayer universe

For backend development, start with the [Rust backend README](crates/server/README.md).
The [agent handoff](docs/backend/handoff.md) maps current code, measured results and
remaining debugging work; the [full-run report](docs/evidence/multiplayer/2026-09-13-full-player-history-run.md)
records the latest 1,000-user / 100-active API workload.

```sh
./start.sh online --users 2
```

One command builds TypeScript, the shared Rust/WASM rules and the native backend,
generates a new connected galaxy, creates one account and fleet per player, and
starts both servers. Cargo reuses its incremental build cache. The terminal prints
each player's access code and a link that signs in automatically. The first link
opens in your browser. Online mode uses frontend port **8001**, leaving the offline
sandbox server on port 8000 available; backend ports are assigned automatically.

The local galaxy preset is in [config/local-galaxy.json](config/local-galaxy.json):
1,500 cluster placement attempts, 80 systems per cluster, three connections, size
300,000, center bias 0.6 and minimum spacing 3,500. Seed 20260907 produces **846
clusters and 35,371 systems** after placement constraints. Every surviving system
is provisioned and playable. The exporter loads the same compiled generator as
`galaxy.html`; it no longer maintains a separate generator implementation. New saves use this preset;
restarting an existing save preserves its world. Each generated save records its
settings, counts and topology hash in `galaxy.json`. The atlas streams in cacheable
pages of at most 4 KiB. Open **Galaxy atlas**, search for a cluster, then select
one of its systems. The current detail system's cluster remains in the live
view when browsing another cluster, preserving nearby route choices. This is a
bounded view over the full native world; independent system content and live
fleet detail load only for the selected system.

Both entry points instantiate the same `App` and WebGPU renderer. Offline mode
uses local authority; online mode uses the native backend and shared WASM rule
previews. The preset changes world generation, not renderer implementation.

Cold fleet-roster recovery remains a substantial startup operation: the current
schema records all 256 user-partition cuts per system, including empty systems.
For this preset that is 9,054,976 durable cut rows. The host reserves storage based
on world size; empty actors sleep without periodic simulation ticks. This local
two-user demo is functional validation, not a 1,000-user capacity result. See the
[full-world validation record](docs/evidence/gameplay/2026-10-07-full-local-world/README.md).

```sh
./start.sh online --users 4 --data-dir "$HOME/.local/share/galaxy-friends"
./start.sh online --users 2 --no-open --no-watch
./start.sh online --users 2 --port 0   # Choose an available frontend port
```

Without `--data-dir`, saves live under `~/.local/share/galaxy-dev/<checkout-id>-large-v2`.
Earlier default saves remain intact and can be opened explicitly with `--data-dir`.
Restart the same command to resume that universe with the same accounts. An
existing save with a different account count is rejected; choose a new directory
for another universe. Saves must be outside the repository and frontend build
folder because they contain SQLite data and private account credentials.
`--users` accepts 1–128, subject to the backend's bounded configuration size.

Ctrl+C stops this launcher's frontend, watcher and backend, preserving
the save. Restart after changing Rust or WASM rules. `--skip-build` is available
when the matching client and native binaries are already built.

Treat printed links like access codes. Their secret is in a URL fragment, consumed
and removed before the application starts; it is never sent in an HTTP request or
saved in browser storage. Automatic sign-in accepts only the literal loopback
WebSocket endpoint on a page served from `http://127.0.0.1`. It is a development
convenience for browser windows on this machine, not remote account signup.

## Play with two people or browser windows

1. Run `./start.sh online --users 2` and open the two player links in separate
   browser windows. Each account controls its own fleet.
2. To connect manually, open the printed online page and paste a player access
   code. The local launcher fills the loopback backend address.
   The generated accounts can view every system in this local universe.
3. Select a fleet. Use **Follow selected fleet** to find it. Inside a solar system,
   drag to pan freely and scroll to zoom. Click a planet or fleet, or choose a fleet
   from the **System** panel, to orbit it. Selection keeps your viewing angle.
   **Free camera**, Escape, or clicking empty space releases the selection.
4. In the system scene, right-click empty space to move the selected owned fleet;
   hold to set height. The Fleets panel also accepts X/Z coordinates. **Preview**
   runs the shared rules without submitting an order; **Move** asks the server to
   commit it. The destination must fit the system boundary and clear navigation
   bodies. You can retarget while moving: the server starts the new route at the
   analytically evaluated current position and confirms its path and deadline.
5. Choose a **Route destination**, then **Preview route**. The preview shows the
   path, travel time and next jump. **Jump** sends that one leg. A departure receipt
   confirms departure; the fleet appears in the destination system after import.
   **Start journey** continues an accepted route of up to 16 legs automatically
   when the player home and route systems share the supported local shard.
6. Select the destination under **Choose a system**, then **View system** to see
   the arriving fleet. New backend transfers default to **30 seconds jumping and
   seven minutes cooldown**, configurable by the host. Accepted historical work
   retains its original timing. Local movement remains available during cooldown.
   Manual Jump sends one leg; Start journey owns the subsequent legs.

If a connection drops during an order, keep the page open and reconnect. **Check
original order** or **Retry original order** resolves the retained identity.
An unknown result is not a confirmed failure. The page keeps this recovery state
in memory, so avoid reloading while an order is unresolved.

The generated certificate is a local fixture certificate. A normal browser may
reject its WebTransport TLS connection; the explicit loopback WebSocket fallback
lets you test locally without changing browser certificate settings. Testing
trusted WebTransport uses the managed fixture in the [multiplayer guide](docs/multiplayer-local.md).

## Stop, restart and troubleshoot

- Ctrl+C drains accepted backend work and closes SQLite. Restart the same online
  command to continue the existing universe.
- A fresh universe needs another `--data-dir`; startup never resets your save.
  Local play uses explicit loopback WS and needs no browser certificate bypass.
- If a frontend port is busy, use `--port 0` or another port. No startup command
  kills unrelated processes. The launcher sets the current allowed origin in a
  private temporary config; the saved host configuration stays unchanged.
- A blank game page or WebGPU error: use a Chromium browser with hardware
  acceleration and check `chrome://gpu`. The launchpad itself requires no GPU.
- No fleets: choose the system where your account's fleet currently lives.
- A stale save lock after a crash: verify no backend uses that save before removing
  the `.lock` file named in the error. Never run two launchers against one save.

## Checks and further reading

The managed multiplayer test runners also need the `sqlite3` command on `PATH`.

```sh
cargo test --workspace --locked
./build.sh --wasm --out-dir .tmp/galaxy-test-build
node tests/network-session/prepare.mjs --dist-dir .tmp/galaxy-test-build
node tests/multiplayer-host/run-ui.mjs --headed --server-bin target/debug/galaxy-server --dist-dir .tmp/galaxy-test-build
```

Some HTML pages are test fixtures needing a managed peer or prepared WASM vectors;
use their runner rather than expecting every fixture to run standalone. See the
[test guide](tests/README.md), [development commands](docs/development.md),
[multiplayer setup](docs/multiplayer-local.md), [backend guide](crates/server/README.md)
and [messaging/player-view status](docs/multiplayer-plan/messaging-execution.md).
The earlier [multiplayer foundation record](docs/multiplayer-plan/execution.md)
preserves its original integration evidence.
