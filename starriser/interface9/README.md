# Galaxy

A browser space-strategy prototype with a WebGPU map, worker-based client, Rust
authority and local SQLite persistence. You can explore the offline sandbox or
run a local multiplayer universe. Economy, combat and public signup are future
features; the playable multiplayer slice is ship movement and system transfers.

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
server, watches TypeScript changes and opens **http://127.0.0.1:8000/**. The root
page lists every source HTML page with a description and search. Choose
**Explore the galaxy** for the offline editor, or **Play online** for multiplayer.
The offline game now lives at `/galaxy.html`.

```sh
./start.sh --no-open                 # Print the URL without opening a browser
./start.sh --skip-build              # Reuse the existing build
./start.sh --port 8001 --no-watch    # Choose another port and disable watching
```

Ctrl+C stops this frontend server and its watcher. Restart `./start.sh` after
changing Rust rules; the TypeScript watcher does not rebuild Rust.

## Start a local multiplayer universe

```sh
./start.sh online --users 2
```

One command builds TypeScript, the shared Rust/WASM rules and the native backend,
generates a new connected galaxy, creates one account and ship per player, and
starts both servers. Cargo reuses its incremental build cache. The terminal prints
each player's access code and a link that signs in automatically. The first link
opens in your browser. Online mode uses frontend port **8001**, leaving the offline
launchpad on port 8000 available; backend ports are assigned automatically.

The local galaxy preset is in [config/local-galaxy.json](config/local-galaxy.json):
150 cluster placement attempts, 80 systems per cluster, three connections, size
30,000, center bias 0.6 and minimum spacing 1,500. Seed 20260907 produces **64
clusters and 2,706 systems** after placement constraints. New saves use this preset;
restarting an existing save preserves its world. Each generated save records its
settings, counts and topology hash in `galaxy.json`.

```sh
./start.sh online --users 4 --data-dir "$HOME/.local/share/galaxy-friends"
./start.sh online --users 2 --no-open --no-watch
./start.sh online --users 2 --port 0   # Choose an available frontend port
```

Without `--data-dir`, saves live under `~/.local/share/galaxy-dev/<checkout-id>`.
Restart the same command to resume that universe with the same accounts. An
existing save with a different account count is rejected; choose a new directory
for another universe. Saves must be outside the repository and frontend build
folder because they contain SQLite data and private account credentials.
`--users` accepts 1–128, subject to the backend's bounded configuration size.

Ctrl+C stops this launcher's frontend, TypeScript watcher and backend, preserving
the save. Restart after changing Rust or WASM rules. `--skip-build` is available
when the matching client and native binaries are already built.

Treat printed links like access codes. Their secret is in a URL fragment, consumed
and removed before the application starts; it is never sent in an HTTP request or
saved in browser storage. Automatic sign-in accepts only the literal loopback
WebSocket endpoint on a page served from `http://127.0.0.1`. It is a development
convenience for browser windows on this machine, not remote account signup.

## Play with two people or browser windows

1. Run `./start.sh online --users 2` and open the two player links in separate
   browser windows. Each account controls its own ship.
2. To connect manually, open the printed online page, leave **Server** at its
   default, paste the printed backend URL into **Fallback server**, and paste a
   player access code.
   The generated accounts can view every system in this local universe.
3. Select a ship. Use **Follow selected ship** to find it. Inside a solar system,
   drag to pan freely and scroll to zoom. Click a planet or ship, or choose a fleet
   from the **System** panel, to orbit it. Selection keeps your viewing angle.
   **Free camera**, Escape, or clicking empty space releases the selection.
4. Enter small local coordinates, for example **X 0.025, Z 0.015**. **Preview** runs
   the shared rules without submitting an order; **Move** asks the server to commit
   it. Wait for arrival before issuing another movement.
5. Choose a **Route destination**, then **Preview route**. The preview shows the
   path, travel time and next jump. **Jump** sends that one leg. A departure receipt
   confirms departure; the ship appears in the destination system after import.
6. Select the destination under **Choose a system**, then **View system** to see
   the arriving ship. Jumps take 15 seconds, followed by a 30-second cooldown
   before the next jump. Local movement remains available during cooldown.
   Multi-hop routes require a new explicit jump for each leg.

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
- No ships: choose the system where your account's ship currently lives.
- A stale save lock after a crash: verify no backend uses that save before removing
  the `.lock` file named in the error. Never run two launchers against one save.

## Checks and further reading

The managed multiplayer test runners also need the `sqlite3` command on `PATH`.

```sh
cargo test --workspace --locked
./build.sh --wasm --out-dir /tmp/galaxy-test-build
node tests/network-session/prepare.mjs --dist-dir /tmp/galaxy-test-build
node tests/multiplayer-host/run-ui.mjs --headed --server-bin target/debug/galaxy-server --dist-dir /tmp/galaxy-test-build
```

Some HTML pages are test fixtures needing a managed peer or prepared WASM vectors;
use their runner rather than expecting every fixture to run standalone. See the
[test guide](tests/README.md), [development commands](docs/development.md),
[multiplayer setup](docs/multiplayer-local.md), [backend guide](crates/server/README.md)
and [implementation status](docs/multiplayer-plan/execution.md).
