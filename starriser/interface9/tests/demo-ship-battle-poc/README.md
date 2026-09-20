# Directed battle POC

For the current system, start with the [runtime integration and tuning guide](../../docs/ship-runtime.md).
It covers engine usage, director events, navigation, pressure, population and recovery;
M1–M4 are complete and integrated into main. M5 production integration and
full production-frame qualification remain deferred. Dated measurements below
retain their original workload and are not new performance results.

The retained [physical scale update](../../docs/research/ship-motion/scale-results.md) makes planets 50× larger and Battleships/Colossi 5× larger, including avoidance and hull-aware spacing.

A standalone visualization of backend-directed battles, 1–8 fleets and six
contrasting ship classes. All interactive demos live on the
[shared flight lab](../demo-ship-flight-poc/README.md). Serve the repository and
open `/tests/demo-ship-flight-poc/?scenario=2`; the old battle URL redirects there.
The lab uses the shared native/WASM planetary model; production renderer and
transport integration remain deferred. The **Complete lifecycle**
scenario (`?scenario=4`) connects the complete lifecycle, type tactics, short
tactical memory and combat presentation. See [Planned complete lifecycle](#planned-complete-lifecycle);
the [original sequence results](../../docs/research/ship-motion/battle-sequence-results.md)
refer to its earlier 60-second checkpoint.

## Inspect the behavior

Select 1,000 or 10,000 actual visual agents. Each fleet contains interceptors,
fighters, bombers, frigates, a few battleships and one colossus. The catalog in
`classes.mjs` owns dimensions, preferred cruise speed, acceleration, jerk, turn
rate and occupancy weight. The colossus is 60 units long and cruises at 0.65
units/s; an interceptor is 0.42 units long and cruises at 9 units/s. Conservative
hull bounds affect target stand-off and planet/capital avoidance. Cruise speed is
a steering preference; avoidance can briefly exceed it without a velocity snap.

Choose a target class and **Attack class**, **Next target**, or **Cycle every 8s**.
The selected fleet receives a mock director order. Target lines show up to 32 sampled
agents' actual GPU-selected opponents. **Follow target** follows a living ship
of the selected enemy class, with camera distance adjusted for its size.

**Report selected fleet lost** removes that fleet only. The live Blue/Orange
counts make this explicit. Opponents without eligible targets brake toward rest;
they remain alive and keep separating. Reporting both fleets lost removes all
hulls. Trails expire on their time clock. **Report 20% losses** uses an 80% baseline report for the initial fixed roster.
After reinforcement, reclamation or regrouping, it reports 80% of each type's
current logical survivors, so repeated clicks apply further losses.

Battle ships pursue live opponents in XYZ with no orbital position writer.
Active attack orders gradually lose outward preference over radii 40–140, with
no inward bias inside radius 40. Tangential travel remains possible. Hold and
explicit withdrawal are not pulled into the battle. Moving planets are obstacles,
never battle attractors. Orbital periods come from the shared model; the lab
selector accounts for the 50× scale factor (fast preset: 25 minutes).

## Close-range engagement

`engagement.mjs` supplies velocity guidance inside existing attack orders.
Frigates, battleships and colossi brake into a hull-aware stand-off band, matching
the target's velocity when it moves. A small quiet band prevents endless tiny
range corrections. Density, contacts and planet avoidance can still displace them.

Interceptors, fighters and bombers blend into tangential flight as they approach.
The tangent is their current target-relative velocity projected perpendicular to
the target direction, preserving the approach's handedness and inclined 3D plane.
A straight-on approach uses the ship's local horizontal axis as a fallback.
Turn distance accounts for hull size, cruise speed and available acceleration;
radial steering gently corrects range while local pressure changes the path.
There is no stored orbit angle, phase clock, assigned ring or position constraint.

Both attack-pass and pursuit orders use this size-dependent close behavior.
Hold, withdrawal, target loss and replacement still preempt it. The one existing
integrator applies all forces and retains acceleration and jerk limits. See
[close-engagement checks](../../docs/research/ship-motion/close-engagement-results.md).

## Density and local separation

All demos use required pressure. The four-fleet scenario also demonstrates
independent scopes and directed merge/split; pressure does not grant battle
permission. **3D shared density** draws the selected scope’s GPU occupancy, blue through orange
as mass increases. The overlay is occupancy, not the acceleration vector: a dense
peak can have zero gradient. A lower display threshold includes light craft.

Each grid uses **64³ cells**. The default battle field has **4-unit cells**
covering a 256-unit cube. Other scopes choose their extent; planet fields track
the planet and enlarge cells to include all rings, hulls and margin. The pool is
bounded to at most 16 fields, and cell count remains capped at 64 per axis. Trilinear deposition/sampling fades near
its edge and excludes out-of-window ships. Density is cleared and rebuilt from
current state before movement every simulation step. The overlay can differ from
the rendered pose by one simulation interval, not an asynchronous density tick.
Capital ships distribute weighted occupancy throughout a rotated hull lattice.
One cooperative GPU workgroup per capital deposits samples no farther apart than
a cell width divided by √3, avoiding holes under rotation. Integer quotas preserve
exact total mass for fully in-bounds hulls. Capital mass scales with hull volume:
a fully occupied four-unit cell receives roughly 64 mass and appears red.
This is actual simulation pressure, not a display-only tint. Force and jerk
limits still bound the response. The profiler lists this as Hull volume.

Density alone cannot separate coincident ships: identical samples produce the
same acceleration. A second, local mechanism builds GPU hash buckets alongside
density. Each ship checks 27 neighboring 4-unit cells, capped at 64 linked entries
per bucket. Actual cell coordinates reject hash collisions. Hull clearance and
relative closing speed produce separation, with stable antisymmetric escape
vectors for coincident peers. Contact escape receives steering priority over
pursuit; the same acceleration/jerk-limited integrator still owns every pose.
The hash operates outside the density window too. Capitals have an additional
bounded size-aware obstacle check, including a nonzero escape at coincidence.

This is soft, predictive separation, not an exact collision solver. A saturated
bucket can omit neighbors, and acceleration limits permit transient penetration.
Large slow hulls encountering rapidly moving obstacles still require route-level
feasibility work. There is no pairwise damage or battle-result calculation.

## Identity and authority

32 type groups per fleet map to six visible classes. Each fleet/type supports up
to 256 retained ordinals, with separate persistent serial ID, catalog index and GPU
slot. Two explicit admission/journey cohorts may contain multiple logical batches.
Live/admitted masks distinguish reserves, survivors and casualties. Fresh births,
reclamation, regrouping and progressive packing preserve these contracts.

The director owns admission, strategy, eligibility, logical casualties and outcomes.
Per-type absolute logical `remaining` reports preserve each batch's representation
ratio; repeated reports cannot resurrect lost representatives. GPU target memory
selects opponents only within explicit battle/team/type permissions. Commands never
upload individual live poses. Use the [director contract](../../docs/research/ship-motion/director-contract.md),
[population contract](../../docs/research/ship-motion/runtime-population.md) and
[regrouping contract](../../docs/research/ship-motion/runtime-regrouping.md).

Multiple battles, pressure-scope lifetime, dynamic growth and address reuse are
implemented. Production transport/rendering and full body-frame aerobatic tactics
remain outside the current lab integration.

## Timing and validation

The FPS panel includes asynchronous GPU timestamps for **Clear / recovery**, **Density +
contacts**, **Hull volume**, **Spatial ordering**, **Contact cache**, **Contact filtering**,
**Pursuer queries**, **Steer + separate + trails**, and **Render**. One sample is taken
per 30 simulation steps without waiting in the frame loop. Compute labels cover
one simulation step; Render covers its frame, including the overlay when enabled.
An unavailable timestamp feature is reported explicitly. These are dispatch/pass
timings, not timings of individual WGSL functions or an end-to-end frame sum.

```sh
./tests/run.sh demo-ship-battle-poc --headed --skip-build \
  --dist-dir /tmp/galaxy-ship-lab-build --query 'test=1' \
  --artifacts-dir /tmp/galaxy-spacing-results
```

Prepare the selected build with `./build.sh --wasm --out-dir /tmp/galaxy-ship-lab-build`
before using `--skip-build`. Current coverage is recorded in the
[completion audit](../../docs/research/ship-motion/runtime-m4-audit.md);
[classes and pressure results](../../docs/research/ship-motion/classes-pressure-results.md)
are an earlier behavior checkpoint.

## Prepared spatial work

The GPU owns a transient permutation of stable ship slots, grouped by the
existing contact hash. Atomic insertion ranks establish contiguous bucket
ranges; a parallel scatter prepares neighbor geometry and metadata. This
changes invocation order, never visual identity or the allowed contact count.

Two independent query kernels prepare conservative first-64 contact masks and
nearest first-16 pursuers for each neighboring cell. Queries are tiled across
32 nearby ships for coherent memory access. Integration consumes answers in
the original cell/contact order and remains the only writer of pose, tactical
memory and trail history. Source queries use the exact post-journey position,
including arrival boundaries; neighbor records use the original density input.

The phase geometry buffer belongs to the engine and uses binding 3 during
cache/query passes. Integration uses a separate bind group with trail history
at that binding. Both resources are destroyed with the engine. CPU-derived
roster/permission tables update only when director reports change; tactical
scoring and choices stay on the GPU.

See the [optimization harness](../demo-ship-optimization/README.md) for exact
reference replay, all-pass rendered timings and the accepted/rejected pass log.

## Shared planetary model (M3 complete)

Build the shared WASM module before opening the active demos. The historical
96-byte flight fixture remains independent; current scenarios use the director
runtime and the shared ephemeris. With the pinned WASM generator installed:

```sh
./build.sh --wasm --out-dir /tmp/galaxy-navigation-build
CARGO_TARGET_DIR=/tmp/galaxy-navigation-target node tests/demo-ship-battle-poc/prepare-navigation.mjs --dist-dir /tmp/galaxy-navigation-build
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=ephemeris'
```

The ephemeris fixture compares native Rust, the real browser worker and the GPU
entry point using the runtime's actual model buffer. The test includes large
server epochs, orbital phase rebasing and live-pose preservation. This verifies
planetary truth. Separate route, event, clock and recovery fixtures below cover
the other completed M3 contracts; the [runtime plan](../../docs/research/ship-motion/runtime-plan.md)
records their evidence.


## Director worker admission

`worker-client.mjs` submits one actual job at a time and retains at most 32
queued jobs on the host. An optional request key keeps only the latest waiting
revision for that key. Supersession rejects the obsolete consumer immediately,
but the running job owns its slot until a reply or worker termination. Unkeyed
jobs retain admission order; overflow rejects explicitly. Inputs are cloned at
admission, and the sequence runtime captures fleet/type alongside tactic input.

A 30-second execution timeout, worker failure, undecodable reply or explicit
teardown terminates the worker and rejects unfinished consumers. A timed-out
worker stays closed; recovery must create a new worker. A remote validation
failure rejects its request and allows queued work to continue. This bounds job
count; local routing has independent native search bounds described below.

`node tests/demo-ship-battle-poc/validate-worker-host.mjs` exercises capacity,
1,000 supersessions and failure/teardown paths with a controlled worker and clock.
The `mode=ephemeris` browser fixture also exercises real worker queuing and tactic
admission into the actual sequence runtime, including mutable caller input,
reset/teardown lifetimes and preservation of GPU state/history at receipt.


## Local corridors (M3 complete)

`crates/game-core/src/navigation/` supplies bounded 3D visibility routing through
`PlanetaryModel.plan_route`. The worker runs that same native/WASM code. A route
uses the translating, nonrotating destination-planet frame; body motion is not
frozen. Each planetary sweep is enclosed by capsules with the curvature bound
`A * dt² / 8`, then inflated for hull clearance and corridor width. A segment is
clear over the whole requested window. This allows individual timing variation,
with the tradeoff of rejecting some routes that could work at a precise time.

Search uses at most 128 nodes, 128 sweep intervals per body and 16 output points.
An exhausted candidate set returns `NoRoute`; it never invents a direct shortcut.
A nominal schedule includes cruise, acceleration, braking, jerk and turning
allowances. It reports whether that schedule fits the requested window. This is
a planning model, not a guarantee against arbitrary initial momentum, off-corridor
entry, extreme frame motion or combat/density delays. Warp corridors are not
searched or checked by this planner.

`local-routes.mjs` admits immutable route records against the current journey,
model, epoch, capability and time window. Each fleet/type/cohort gets a 288-byte
record appended to the existing control buffer. GPU state and trail lifetime are
unchanged. The GPU follows forward flow with a soft corridor boundary; inside the
cleared width it retains individual lateral placement and density response.
Orbital arrival accepts the class ring region, then latches ordinary ring flow.
A ship that misses its local deadline uses the explicit exceptional arrival
correction and frame-history policy described below. Bounded progress summaries
support live replanning without individual CPU pose control.

The approach, post-warp and complete-lifecycle demos use shared-worker plans for
all classes. The complete-lifecycle director authors battle entry after all
inbound windows and final orbit after all return windows. Live event admission
and GPU clock rebasing, bounded per-group events and suspension recovery are
implemented and described below.

After the WASM build and `prepare-navigation.mjs`, run:

```sh
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=routes'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=arrival&count=10000' --timeout 300000
```

The route fixture compares native/worker records, checks a real GPU detour and
arrival, and rejects stale plan admission. Native tests independently sample a
planet crossing between endpoint observations, moving-frame world clearance and
nearly parallel crossing segments. The long arrival fixture checks every live
representative at its class deadline; its conservative demo windows range from
87 to 903 seconds. The old 100-second lifecycle remains an explicitly selected
historical regression fixture (`legacyLifecycle: true`).


## Live local-route replacement

`engine.planApproach({fleet, type, cohort, revision, request})` plans a replacement
while the accepted GPU journey keeps running. The current API accepts an active
or already-started local window; future plans use the scheduled packet API below.
The request supplies a coarse director-owned start,
not an upload of individual GPU positions.

`live-route-planner.mjs` owns one bounded lane per type/cohort and a lazily created
worker. Newer revisions supersede pending results; duplicate identical requests
share the pending promise. A conflicting payload cannot reuse a revision. Failed
work can retry the same unaccepted request. No-route, infeasible, expired and
superseded outcomes leave the accepted journey unchanged. Transport failures
remain explicit errors; a closed worker can be recreated on retry.

Admission validates the complete route before changing either journey intent or
route data. Per-cohort navigation epochs distinguish intervening movement/role
commands, including change-away-and-back races. Casualty, fire and target-only
reports preserve unrelated navigation planning. Reset and teardown revoke the
old runtime lifetime, terminate pending work and prevent late admission.

The real-worker/GPU fixture includes replacement during warp, ordinary derivative
continuity, immutable request snapshots, atomic failure, retry and automatic
post-warp events:

```sh
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=live-routes&count=10000'
node tests/demo-ship-battle-poc/validate-navigation-epochs.mjs
```

## GPU progress and interactive retargeting

`engine.readProgress()` observes current GPU state without changing it. It returns
one 96-byte summary per fleet/type/cohort: live/arrived/warp/unapplied counts,
position bounds, mean position and velocity, maximum speed and acceleration, and
one occupied anchor. The mean can lie inside a planet when ships surround it;
local-route authoring therefore uses the occupied anchor. Neither the anchor nor
the bounds prove clearance for every scattered ship entering a shared corridor.

`progress-gpu.mjs` shares the runtime Ship declaration. A 128-thread group reduces
at most 256 representatives. `progress.mjs` allocates fixed metadata, output and
staging buffers at startup: 32 KiB for two fleets, 128 KiB for eight. Readback is
12/48 KiB respectively. At most one readback is pending; concurrent callers share
its promise. The pass runs only on request, never as mandatory per-frame work.

The readback carries simulation time, runtime lifetime and per-type report epochs.
Reports during mapping mark affected cohorts stale; reset discards the old
lifetime; teardown safely closes a pending read. Authoritative live masks exclude
casualties even before the next movement step. Arrival requires applied intent and
actual arrival state; merely ordering orbit does not count off-ring ships arrived.

`engine.planFromProgress(options, summary?)` authors a local approach from that
snapshot, rejecting empty, stale, future or more-than-250-ms-old sources. Explicit
deadlines remain unchanged. The demo's default deadline adds a conservative
spread allowance, not a proof of arbitrary entry or momentum feasibility.

The Retarget button uses this API for every occupied type/cohort, submitting
sequentially to the bounded worker and refreshing summaries as needed. A newer
click aborts the previous batch immediately; pending old routes cannot commit.
`planApproach(plan, {signal})` supports this cancellation without stopping accepted
motion. All admission remains intent/route data only: GPU pose and trails survive.

```sh
node tests/demo-ship-battle-poc/validate-progress-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=progress&count=10000&fleets=8'
node tests/demo-ship-flight-poc/validate-progress-ui.mjs /tmp/galaxy-progress-ui /tmp/galaxy-navigation-build
```

## Event boundaries and warp deadlines

The finite replay journal snapshots and freezes its events (at most 4096), rejects
conflicting identities, and separates receipt from effective time. Early events
wait for their effective boundary; overdue events apply at the current simulation
clock. The shared `event-runtime.mjs` captures bounded per-group boundaries and
performs one physical pipeline per tick; GPU event/history logic applies the
within-tick transitions. Zero-time calls can flush currently due events. It never
backdates GPU updates to a missed event time. Rewinding the sequence is rejected;
restarting the demo creates a fresh runtime.

Warp retains its director deadline. Late receipt before the deadline compresses
the remaining visual travel from the current GPU pose. Receipt after the deadline
performs an explicit GPU warp-exit correction at admission: no extra grace period,
no interpolation through the skipped space, and no trail joining the old pose to
the exit. Ordinary preemption retains its continuous pose/trail contract. Clear
warp corridors remain assumed.

This covers healthy replay boundaries and a declared overdue-warp correction.
The UI uses a shared scene clock, bounded catch-up and explicit snapshot recovery
for suspension or sustained backlog. It does not silently discard simulation debt.
Live ingress, per-group GPU events and recovery are described below.

```sh
node tests/demo-ship-battle-poc/validate-event-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=deadlines&count=10000'
```

## Planned complete lifecycle

`planned-lifecycle.mjs` runs in the real director worker with the shared planetary
model. It makes 24 native plans (six classes, two fleets, two approach phases),
then publishes a finite sequence with 192 per-type/cohort route records. It has
no individual ship positions as input. The current class speeds and planet scale
produce a 1,886-second demo, including slow capital approaches; time is not sped
up privately for ships. The backend/director owns every battle and loss event.

At each approach boundary the runtime admits the worker's routes, preserving GPU
state and trail ownership. Entry positions, reinforcements and withdrawal orders
use the moving model's declared frame/time. The clear warp corridors remain an
input assumption. This fixture qualifies the two local approach phases; it does
not establish feasibility of every arbitrary departure or combat interruption.

`engine.applyCommands(commands, routes)` preserves ordered, per-report admission
while coalescing uploads for a synchronous event. The 128-cohort return burst
writes the two control buffers once each (84,736 bytes for two fleets). Accepted
reports remain synchronized if a later report throws; this is not a transaction
that rolls back earlier semantic reports. Every route still passes its own
revision/model/window validation before admission.

The full replay audits every occupied cohort at its own route deadline, checks
that the route was actually installed, and retains one GPU state/history lifetime
through orbit, departure, warp, local approach, battle, reinforcement, loss,
withdrawal, return warp, return approach and final orbit.

```sh
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=planned-lifecycle&count=10000' --timeout 300000
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=lifecycle-batch&count=10000'
```

## Long-lived GPU clock

`runtime-clock.mjs` keeps authoritative scene seconds as host doubles. GPU dates
use one shared local epoch for simulation, routes, planetary snapshots, tactics,
effects, trails and drawing. At 256 local seconds, the origin advances in exact
192-second multiples, leaving the current GPU time between 64 and 256 seconds.
The GPU never receives Unix epoch milliseconds as an f32. Ordinary steps reject
invalid or backward clocks before mutation. Rebasing is precision maintenance;
it does not simulate a skipped interval or reconcile a suspended browser.

`clock-gpu.mjs` eagerly compiles one maintenance pass. It changes timestamp fields
in both pose buffers and trail history in place, preserving every other state
bit and every world-space history sample. Expired effect/trail timestamps become
inactive sentinels. Host-owned journey, route and tactic dates are repacked from
their double-precision originals; no live pose is read back or uploaded. Global
target-selection phases and the follow-camera phase retain their original clock.

The origin shift preserves the 16-sample, 60-Hz trail ring indices. Frame uniforms
also carry consecutive host-calculated sample indices: independently rounding
`now` and `now - dt` on the GPU can skip samples at 120 Hz. The GPU interpolates
sample positions between its poses and draws the live head at the emitter. The
actual runtime frame/view uniforms are 64/96 bytes; the historical shader layout
remains 48/80 bytes. The 192-byte Ship and history layout are unchanged.

With timestamp queries available, the panel shows the most recent maintenance
pass separately from ordinary frame stages. It has one fixed query/staging slot
and at most one mapping in flight. Reset and teardown invalidate pending results.
The diagnostic `autoRebase: false` and `rebaseClock()` allow before/after state and
pixel comparisons; ordinary runtime creation rebases automatically.

The clock fixture checks both state buffers, effect/trail/follow pixels, active
warp deadlines, 30/60/120/240-Hz trail sampling, worker route results across an
epoch change, large scene times, invalid clocks and pending-readback lifetimes.
The full planned lifecycle also audits nine automatic rebases through its real
local arrival and battle deadlines.

```sh
node tests/demo-ship-battle-poc/validate-clock-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=clock&count=10000'
```

## Live director packets

Every runtime now owns one `event-runtime.mjs` integration driver. Startup replay
and packets received during motion use this same boundary handling. The lab's
target, membership and loss controls submit live packets; worker-authored tactics
queue their latest result. `flushEvents()` activates due packets at the current
clock, including when the UI is paused. Receipt alone never changes GPU poses or
trails. As before, the director owns battles, losses and permitted tactics.

Bind a receiver once for the producer's runtime lifetime:

```js
const receive = engine.events.receiver();
receive({
  sequence: 1, id: 'blue-departure', effectiveAt: 12,
  lane: 0, revision: 1,
  commands: [{ fleet: 0, journey: {
    mode: 'warp', revision: 1, at: 12, end: 15, exit: [80, 20, 0],
  } }],
});
```

The receiver captures the runtime lifetime. Reset/teardown invalidates it; a
replacement stream binds a new receiver and starts its sequence at 1. The lower
level `receiveEvent(packet, capturedLifetime)` requires that explicit lifetime.
`enqueueEvent` is the lab's convenience producer, assigning the next sequence
and defaulting effect time to the current clock. One producer owns sequencing;
it is not an adapter for mixing independent network and local sequence streams.
Production UI commands will go through the backend transport deferred to M5.

`sequence` is packet identity within that lifetime; `id` is a diagnostic name.
Out-of-order receipt is accepted within a 4096-number window ahead of the
contiguous received prefix. The prefix advances at receipt, independently of
future effect time. Pending duplicate payload conflicts reject; already consumed
receipt numbers are ignored and cannot replay effects. A larger gap rejects
explicitly and requires the implemented current-state snapshot recovery below.

Optional `lane` (0–4095) and positive `revision` identify a director-owned stream
of replaceable pending orders. A newer validated revision cancels the pending
packet in that lane. Existing active motion continues until the new packet's
effect time; other lanes and unkeyed packets remain independent. Each packet in
a lane must represent the complete replacement of the previous pending packet,
not one patch of a partially overlapping order. Omit the lane for events that
must both occur. Population facts cannot use replacement lanes, so admission or
loss reports cannot be discarded by replacing a tactical order.

The inbox caps pending packets at 1024, serialized payloads at 4 MiB in total,
individual packets at 512 KiB, diagnostic history at 256 entries and labels at
256 characters. Receipt gaps store numbers rather than retained payloads. The
4096 lane revisions use a fixed 32 KiB array. Queue/byte overflow rejects before
cancelling a valid pending replacement or consuming its sequence. These are
resource bounds, not proof that a worst-case burst fits a frame's CPU budget.

Commands are structurally validated on receipt. State-dependent rejection at
activation is recorded and does not poison later packets. The current ordered
per-report semantics remain: earlier accepted reports in a packet are not rolled
back if a later report fails. The latest rejected admission is retained separately
from the bounded history and remains visible in the UI until runtime reset.
All due packets in a simulation tick share one director upload batch and the
bounded GPU event frame below. Paused `flushEvents()` still admits all reports
at the current clock in one zero-time activation.

A packet may carry `routes` from the real director worker. Model, capability and
window are validated before queuing. A future route installs when its window
opens; a route whose deadline has elapsed is rejected rather than installed as
current guidance. A fully superseded route receipt consumes its sequence without
cancelling a valid future order or raising a recovery fault. `planApproach` remains
the active-window replanning API; prepare
future plans in the worker and deliver them through the scheduled packet API.
Normal route admission preserves GPU motion ownership; warp corridors stay clear
by assumption.

```sh
node tests/demo-ship-battle-poc/validate-inbox-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=live-events&count=10000'
node tests/demo-ship-flight-poc/validate-live-events-ui.mjs /tmp/galaxy-live-ui /tmp/galaxy-navigation-build
```


## Bounded events inside a simulation tick

`event-runtime.mjs` preflights the due replay/live packets, captures their group
state with `event-frame.mjs`, then submits the physical pipeline once. A group is
one fleet and ship type; its two population cohorts share the same event budget.
Each group may change at four distinct times per tick. Multiple reports at the
same admission time share a row. There is no scene-wide four-event limit: 256
independently timed groups still use one simulation submission.

The GPU processes each ship's own boundaries. Between boundaries it retains the
previous acceleration; warp remains analytic. It evaluates the full tactical and
steering controller once per tick using the final director state. Controller time
uses the whole tick even when the last command is exactly at the endpoint, so
frequent orders cannot starve steering. Density, spatial ordering, contact caches
and pursuer queries also run once. Their neighbors are fixed-step snapshots;
commands do not request a global physical solve at each sub-tick boundary.

The CPU uploads group directives, live masks and both cohort routes. It never
reads or uploads individual boundary poses. `event-motion.mjs` stores the Ship
immediately before and after each boundary in a tail of the existing spatial
links buffer. Drawing chooses the enclosing pair, preserving admission, warp
replacement and casualty timing. Analytic warp pose/mode also survives an endpoint
inside that interval; post-warp cruise interpolation starts at that endpoint.
Both cached poses and directive dates participate in GPU clock rebasing.

The 192-byte Ship layout and 3 x 16 timed trail allocation remain unchanged.
The event cache reserves eight Ships per representative: 1.536 MB at 1k and
15.36 MB at 10k. No compute storage binding is added. Metadata appends to the
control buffer: 343,056 bytes at two fleets, up to 1,372,176 bytes at eight fleets, including bounded recovery anchors. Eventful frames upload the event metadata; recovery writes bounded anchors to
its reserved tail. Ordinary director writes retain their original base size. The next ordinary
step disables the old event frame with a 16-byte header write.

Overflow is explicit before queue consumption, director mutation, clock rebasing
or GPU writes. More than four distinct boundaries in one group, or an eventful
integration interval longer than 32 seconds, requires bounded retry/reconciliation;
packets stay queued. The 32-second limit protects the rebased local epoch and is
not a permitted gameplay physics timestep. Normal simulation remains 1/120 s.
Bounded catch-up and current-state snapshot recovery are implemented below; the
normal lab loop uses both. Exceptional corrections restart future trail history;
the bounded correction journal preserves the pre-correction poses and trail samples
needed to render an earlier point within the retained frame.

```sh
node tests/demo-ship-battle-poc/validate-event-frame-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=event-frames&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=event-budget&count=10000'
```

The event budget fixture records simulation and render GPU timestamps separately
at 0, 1 and 4 boundaries per group, with eight fleets and actual rendering between
steps. This is a short GPU diagnostic under concurrent CPU load, not CPU timing
or presented-FPS qualification.


## Bounded catch-up API and conditional arrivals (M3 complete)

`engine.advanceTo(sceneSeconds, options)` runs at most four ordinary 1/120-second
steps. It retains the remaining debt and returns `status`, `target`, `simulated`,
`debt`, `steps` and render `alpha`. Repeating the same target lets subsequent
frames drain a short backlog without advancing planets ahead of the ships.
Targets are monotonic; repeated floating-point endpoints are clamped to the
requested target. `engine.step` remains the lower-level deterministic test API.

A debt over 250 ms, eight frames of sustained non-decreasing backlog, or a group
whose next tick exceeds the event budget returns `needs-reconciliation` with an
explicit reason. No failing tick is submitted; earlier successful ticks remain
applied. The newest target remains available while poses, trails and planetary
time hold together. Reset revokes the backlog; unknown runtime failures propagate
instead of being mistaken for an ordinary overload. Diagnostic `querySet` options
reserve eight timestamp entries from `queryIndex`, two for each possible step;
render timing is separate.

**The normal lab now uses bounded catch-up and current-state recovery.** Its
mock director reconstructs known semantic events while the GPU resumes the current
phase. The `stalls`, `snapshots`, and `director-recovery` GPU fixtures exercise
the runtime APIs; the UI recovery fixture exercises the actual frame loop. Merely calling `step(target, 0)` is not a
snapshot implementation: it cannot reconstruct the current phase after missed
trips and semantic events. M3 completion includes the recovery and UI evidence,
not just this catch-up helper.

Live receivers accept an optional actual receipt time in the same scene clock:
`receive(packet, sceneReceiptTime)`. Receipt may lead a lagging simulation. The
inbox tracks receipt and admission clocks independently, so a newer receipt does
not prevent an older eligible packet from activating during catch-up. Histories
now distinguish `effectiveAt`, `receivedAt` and `appliedAt`; none is rewritten by
GPU epoch maintenance. The raw engine defaults receipt to `engine.now`; the
interactive lab wrapper supplies its shared scene-clock sample at actual receipt.

The interactive warp scenario now queues its arrival through this shared event
owner; it no longer wraps `step()` with its own boundary integration. Its prepared
routes include an optional `basis` with the journey revision and navigation epoch
that authorized the continuation. New accepted navigation/role orders cancel the
old continuation per group; fire changes do not. A guarded continuation preserves
that navigation epoch while advancing the journey revision, so it cannot cancel a
newer worker replan still in progress. Explicit replacement orders still invalidate
those workers. Authoritative replacement routes may omit the conditional basis.

```sh
node tests/demo-ship-battle-poc/validate-frame-stepper-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=stalls&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=navigation-events&count=10000'
```

The three catch-up frames measure all four actual GPU steps plus separate real
rendering, with density and planets enabled. They can exceed an 8.33 ms frame;
their sum excludes CPU/queue gaps and is not a presented-FPS qualification.


## Current-state snapshot recovery (M3 complete)

`engine.installSnapshot(value, capturedLifetime)` reconciles a suspended runtime
without replaying individual missed motion steps. The caller supplies a complete
current director state at a shared scene time, coarse placement per fleet/type/
cohort, active approach routes, a complete stream watermark and pressure framing.
Only accepted authoritative orders/membership/casualties determine the outcome;
GPU recovery does not infer combat or choose losses.

The version-1 payload is bounded to 8 MiB and has these fields:

- `revision`: positive monotonic recovery revision, independent of packet and
  journey revisions. `at`: scene seconds, no earlier than the current simulation.
- `model`: exact `modelKey(solar)` for the shared planetary model/epoch.
- `director`: the structure produced by `exportDirector()`: complete fleet/team/
  encounter state, two admission cohorts per fleet, per-type tactics/journeys,
  targeting masks and live identity masks. The director payload is version 4 and
  also includes persistent catalog identity/membership, logical batches and residual
  counts. Its population, `sizes` and `split` must match the current catalog and
  layout. Casualties, admissions and accepted intent revisions cannot regress;
  GPU slot indices are never imported.
- `placements`: exactly two `{position:[x,y,z], velocity:[x,y,z], spread}` entries
  per fleet/type group. These are coarse system-space anchors, not individual
  ship poses. Coordinates are bounded to 1e9, velocity components to 1e5 and
  spread to 1e6 system units. Recovery can use current backend/director regions
  without retaining or reading back missed per-ship paths.
- `routes`: at most two validated active approach plans per group. Each must
  match the snapshot's current journey/model and fit its original travel window.
  A planet approach requires its route. Past-deadline routes retain the existing
  explicit missed-deadline/correction policy; recovery does not silently grant
  a new travel window.
- `pressure`: `{scopes:[definition, ...], members:[scopeIndex, ...]}` describes
  current visual coverage and one destination per fleet. Definitions use existing
  fixed/encounter/planet frames. Planet fields expand cells to include every class
  ring plus hull/margin; every field stays 64 cubed. Recovery replaces missed blend
  history, revokes old scope handles, and preserves the existing density buffer.
- `stream`: `{through, lanes, pending}`. `through` covers all receipt sequences
  reflected or scheduled by the snapshot; `lanes` contains 4096 revision
  watermarks. `pending` is the complete authoritative future schedule at that
  cut, in ordinary public packet format, with unique sequences and lane heads.
  Every such packet has `sequence <= through` and `effectiveAt > at`. Previously
  received packets above the cut survive, including their original receipt times;
  newer lane heads replace older future orders, while independent facts remain.
- `replayAt: at` is required if a startup replay journal is installed. It explicitly
  declares that the snapshot covers its missed events; these entries are marked
  reconciled without applying their historical commands again. Future replay stays.

`director-snapshot.mjs` and `runtime-snapshot.mjs` prepare detached state before
any live CPU or GPU mutation. Malformed layout, resurrection, revision conflicts,
missing routes, model mismatch, stale cuts and combined queue/byte overflow leave
the live runtime untouched. Due retained packets are applied to that candidate
under the ordinary report semantics; a rejected report is recorded, earlier valid
reports remain, and the final candidate must still have complete current routes.
The restored inbox retains the existing 1024-packet/4-MiB limits and bounded
receipt/history windows. A captured lifetime from before reset/destruction is
superseded. A duplicate/stale recovery revision rejects without replaying effects.

On commit, the runtime preserves all GPU allocations and persistent identities,
invalidates route workers and group progress reads, and copies only group controls
and anchors. A GPU recovery pass distributes local ships within their coarse
regions and clears expanded planetary spheres; orbit ships resume on the current
class ring. In-progress warp uses the current anchor and original endpoint/deadline;
expired warp resumes at the exit with its individual formation offset. Warp
corridors remain assumed clear. Density/contact work follows placement in the
same submission, then the ordinary zero-duration integration establishes matched
previous/current state. A 350-ms dithered hull reappearance marks the discontinuity;
its timestamp rebases with every other GPU date. Live timed emitters restart at
their recovered source, preventing a trail drawn across missed space.

The receipt callback remains attached to the runtime's new inbox; worker tickets
and pressure handles from before recovery cannot commit later. The API exposes
`engine.events.recovery` with the last recovery revision and cumulative count.
Successful recovery resets the bounded catch-up hold at the snapshot's scene time.
The 32-byte anchor per cohort extends existing event metadata by 4,096 bytes at
two fleets or 16,384 at eight, adding no storage binding or per-ship CPU pose array.

```sh
node tests/demo-ship-battle-poc/validate-director-snapshot-host.mjs
node tests/demo-ship-battle-poc/validate-inbox-snapshot-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=snapshots&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=snapshot-routes'
```

These are real runtime/GPU tests, including active worker completion and draw-pose
inspection. The normal lab now has a complete mock-director snapshot producer, shared
host-clock offset mapping and `advanceTo` integration, described below. Local
deadline correction and pre-correction pose/trail display are also implemented;
their bounded journal is described under Exceptional arrival and frame history.
Production transport/rendering remains deferred to M5.


## Lab clock, director reconstruction and pressure events (M3 complete)

The normal six-scenario lab now uses `lab-presentation.mjs`. It samples one
`scene-clock.mjs` host-to-scene clock and feeds `engine.advanceTo`; elapsed time
is retained without the previous 100-ms clamp or backlog discard. A long stall,
persistent backlog or event/pressure-capacity overflow requests a current snapshot
from `director-recovery.mjs`. Recovery is bounded and synchronous in this mock
server; failed reconstruction retries at most every 250 ms while the matched
planet/ship scene holds. The UI reports recovery count and clock-alignment holds.

The clock has a fixed scene epoch for converting backend event milliseconds.
Revisioned synchronization samples use the host send/receive midpoint as their
clock-offset estimate and expose half the round trip as uncertainty. Positive
corrections advance the requested scene time and may require recovery. Negative
corrections hold monotonically until the estimated source clock catches up; no
ship or planet clock rewinds. Event epoch conversion does not change with the
host offset estimate. Invalid intervals and stale revisions cannot move time.

**Pause stops the lab's mock source clock.** This preserves the demo's existing
pause-and-edit behavior; the last partial tick settles before holding, and live
UI orders activate at that same frozen scene time. Clock-alignment holds also
settle the last partial tick. This is distinct from pausing presentation against
a still-running production server: the eventual M5 adapter must continue receiving
server state and recover on presentation resume. The clock rejects calibration
while its mock source is explicitly paused. `enqueueEvent` accepts an optional
receipt timestamp, and the UI stamps effect/receipt from this same source clock.

`director-recovery.mjs` starts from current accepted CPU director state and merges
missed replay/live events in their existing boundary order. It applies semantic
orders and casualties, validates/routes at their original admission boundary,
preserves future packets and produces current coarse group regions. It never
advances individual physics. Current local approaches use the shared planned route
and moving frame; active warp gets a coarse remaining straight corridor at the
original deadline. Individual placement/clearance remains GPU work. The snapshot
producer is deliberately a **mock authority for known lab events**: a receipt gap
is rejected, never treated as permission to fabricate the missing report. Receiving
the missing packet releases that hold without resetting the simulation.

Pressure changes are now explicit fleet-level `pressure` report fields, e.g.
`{fleet: 0, pressure: {name: 'Battle A', center: [10, 0, 0], halfExtent: 128, blend: 2}}`
or a named planet frame. The four-fleet scope demo uses the shared replay/inbox,
with no private `step` wrapper or executable action callbacks. Region definitions
are normalized and validated before mutation. Equivalent explicit regions share
one field; named separate regions stay independent. Retiring destinations can be
reselected during a blend, and unreferenced old fields are collected. Eight fleets
can crossfade from eight old to eight new fields within the sixteen-field maximum.
Changing pressure membership never changes battle/team permissions.

`pressure-budget.mjs` preflights event bursts against retained/needed fields before
any queue consumption or GPU writes. A burst that cannot fit enters the same
recovery boundary, preserving every packet, including bundled casualties. Snapshot
reconstruction then applies the known semantic facts and final pressure destination
while collapsing the missed blend history. Field size remains 64 cubed, with
larger cells for larger coverage. This explicit overflow policy complements normal
continuous pressure blending; it is not a pathfinding or combat decision.

The frame stepper reports zero-time activation submissions separately as
`activations`. It can flush a due order with no elapsed tick, including at a paused
clock, while retaining the four-submission bound inside `advanceTo`. Lab
pause/clock-hold settling can add one final partial tick and reports `partialSteps`. These maintenance cases must be included when attributing
GPU work; ordinary `steps` remains the number of nominal physics ticks.

A recovery-range regression found that an absent second-cohort journey's zero
range selected the wrong coarse anchor. GPU selection now checks both ends of the
cohort range, exactly as journey selection does. The independent-anchor fixture
verifies primary fallback and distinct admitted cohorts with no CPU pose writes.

```sh
node tests/demo-ship-flight-poc/validate-scene-clock-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=director-recovery&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=pressure-events'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=recovery-anchors'
node tests/demo-ship-flight-poc/validate-recovery-ui.mjs /tmp/galaxy-recovery-ui /tmp/galaxy-navigation-build
```

The real UI fixture exercises a one-second main-thread stall, forward/backward
clock correction, a genuine receipt-gap hold/release, pressure-demo reconstruction,
and rendered recovery. The existing paused live-order fixture still verifies
precise paused activation and correct target selection after resume. User background
CPU load is preserved; these correctness checks do not qualify CPU or presented FPS.
Local-deadline correction and historical trail display are described below.
Population growth, reuse, regrouping and packing are described in the current
[population contract](../../docs/research/ship-motion/runtime-population.md); production integration remains M5.


### Exceptional arrival and frame history

A local approach has an authoritative deadline. At that boundary, the integrator
first advances to the deadline, then admits arrival. An already-arrived ship keeps
its pose. A ship within the arrival region is marked naturally arrived; an overdue
ship outside it receives a GPU-owned visual correction. Planet approaches recover
to their class ring or the installed route endpoint in the current moving frame.
Other local approaches use the encounter-relative destination and formation offset.
Enabled planetary obstacles expand by hull clearance; the existing recovery
projection handles an exceptional obstructed destination. This is presentation
reconciliation and never chooses battle membership, casualties or strategic results.
A later received order corrects at admission; it does not extend the old deadline.
Departure and ordinary battle-local orders remain steering directives, without a
planetary arrival claim. Warp corridors remain assumed clear.

The correction clears acceleration/target memory, sets a 350-ms dithered
reappearance and restarts each timed emitter at its current source. `origin.w`
distinguishes unarrived (0), natural arrival (1), corrected arrival (2) and expired
warp (-1). Group progress exposes `corrected` separately from `arrived`. The full
planned lifecycle fixture requires **zero corrected arrivals**, so recovery cannot
hide an infeasible or broken ordinary approach.

`correction-gpu.mjs` keeps the before/after pose and old emitter ring for each
actual discontinuity in the current simulation frame. Ordinary and event-frame
interpolation select the matching side; trail drawing selects the corresponding
historical ring. Multiple corrections are linked per ship. Both event poses and
correction records rebase with the GPU clock. Snapshot recovery discards the old
presentation interval; it does not build this journal. The next ordinary tick
clears the per-ship directory, so a correction cannot replay on later frames.

The pool reserves two records per population slot in the existing spatial/event
storage buffer. A 1,168-byte record contains two 192-byte poses, 768 bytes of trail
history and 16 bytes of metadata. Including the four-byte per-ship directory, this
adds **2.34 MB at 1k / 23.4 MB at 10k**, plus one four-byte allocation counter.
The 10k combined spatial/event/correction buffer is 42,982,144 bytes. No new storage
binding is needed. Only actual corrections copy records; ordinary ticks clear one
index per ship. Render traversal is bounded to ten records per ship (four event
boundaries with intervening local deadlines fit this limit).

`correction-budget.mjs` conservatively bounds a burst before consuming events or
writing GPU state. It includes current intents, replacements, route-only reports,
f32 epoch quantization and admitted reserved ordinals that fall back to a primary
intent. It may reject a burst that would fit if already-arrived ships were known;
that is the explicit tradeoff for avoiding individual GPU readback. Over-budget
bursts use the existing `needs-reconciliation` boundary, preserving all packets.
The director snapshot reconstructs their semantic effects and final state, or the
caller retries in smaller representable intervals. It never silently overwrites a
record. CPU-authored individual pose uploads remain absent.

```sh
node tests/demo-ship-battle-poc/validate-correction-budget-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=corrections&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-navigation-build --query 'test=1&mode=planned-lifecycle&count=10000' --timeout 300000
```

### Progressive physical packing and population lifetime (M4)

`slot-layout.mjs` separates a fleet/type ordinal from its current physical slot.
The ordinal table lives after the existing group records in the order buffer:
256 unsigned slot-plus-one entries per group, with zero for unused ordinals.
Target selection, capital-volume deposition/avoidance and group progress resolve
this table. Existing numeric ship IDs remain stable through physical moves.
Persistent serials are separate from catalog indices and reusable ordinals.
The current runtime supports admission beyond reservation, reclamation and regrouping.

`packing.request()` puts current survivors before dead/reserved representatives.
`packing.requestOrder(ids)` accepts a complete permutation of existing one-based
ship IDs for stress fixtures. A newer request supersedes the unfinished order.
`packing.advance()` performs at most 64 disjoint swaps by default; callers can
choose 1–128. The lab's **Pack storage** control advances one batch per presented
frame, including while its source clock is paused. Packing changes storage order
without advancing motion or replaying backend facts.

The first GPU pass swaps both pose buffers, all timed emitter history, event poses
and correction-directory entries. A second pass translates tactical target/threat
references in both live buffers and historical poses. Correction records retain
ownership through their moved directory entries. Existing contact scratch is
rebuilt by the next normal simulation step; drawing and group progress remain
valid immediately. The follow selection resolves its persistent `{id,lifetime}`
handle to the current slot each render, so the camera follows the same ship. No CPU live-pose or
trail upload is involved.

There is no whole-population pose staging allocation. GPU scratch is one 32-bit
slot remap per capacity entry, 1,024 bytes for swap pairs and a 16-byte uniform:
41,040 bytes at the bounded 10k maximum, independent of active count. The persistent slot table adds 65,536 bytes for
two fleets or 262,144 for eight. The maintenance timer uses the existing bounded
asynchronous query owner. Reported packing time covers both GPU passes and carries
the sampled batch number/swap count; the most recent submitted batch can differ.
`status` also reports exact metadata-upload bytes. Each batch uploads the remap,
pairs, uniform and updated slot table, rather than individual ship state.

Reset cancels the pending permutation and restores the seed slot mapping.
Teardown rejects later requests. In-flight group progress remains meaningful
because it is already expressed by logical cohort; snapshot recovery preserves
the current slot mapping. GPU tests cover paused packing, active combat, exact
frame/correction history, clock rebasing, snapshots, losses and the follow camera.
The full planned lifecycle has an optional packing workload during navigation and
combat, while retaining its zero-corrected-arrival requirement.

Buffer growth/shrinking, admission beyond reservation, reclamation with fresh
serials, logical/visual accounting and regrouping now share this mapping. See
[population ownership](../../docs/research/ship-motion/runtime-population.md) and
[directed regrouping](../../docs/research/ship-motion/runtime-regrouping.md).
The `population-lifecycle` fixture combines four-fleet transfer, pressure scopes,
packing, reclamation, birth, recovery, stale planner/progress results and twelve
resource-convergence cycles at 1k/10k.

```sh
node tests/demo-ship-battle-poc/validate-slot-layout-host.mjs
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-ship-m4-build --query 'test=1&mode=packing&count=10000'
./tests/run.sh demo-ship-battle-poc --headed --skip-build --dist-dir /tmp/galaxy-ship-m4-build --query 'test=1&mode=planned-lifecycle&packing=1&count=10000' --timeout 300000
node tests/demo-ship-flight-poc/validate-packing-ui.mjs /tmp/galaxy-packing-ui /tmp/galaxy-ship-m4-build
```
