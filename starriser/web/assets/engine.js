/* The live engine behind the page.
 *
 * The game's own showcase page (showcase.html in the game, the real renderer
 * with no interface) plays in a fixed frame behind the page: the whole galaxy,
 * a dive into one system, a ride with a patrolling fleet, and back. Sections
 * are solid; the engine shows through the .window sections. Until its first
 * frame, and wherever it does not run, a still it rendered stands in.
 *
 * It loads on the reader's first scroll (or at once if a window is already in
 * view), so the top of the page is the art direction's, and it pauses whenever
 * no window is on screen or the tab is hidden.
 *
 * It runs wherever it can run well, phones included: WebGPU with a real
 * adapter, at least 4 GB of memory, no reduced-motion or data-saver request.
 * Otherwise the still stays and a line on the page ([data-engine-why]) says why.
 *
 * While it starts, the frame reports each step ({starchad: 'boot', step}) and
 * the page shows them on a loading bar under the caption ([data-engine-live]):
 * one segment per step, filled when the step is done and creeping while it
 * runs. Once live, the frame reports what it is showing ({starchad: 'act'}) and
 * the page captions it ([data-engine-caption]). The reel pauses while the tab
 * is hidden.
 * Classic deferred script, so the page also opens from disk (where it shows the
 * still).
 */
(function () {
  'use strict';
  var host = document.querySelector('.engine[data-engine]');
  if (!host) return;
  var root = document.documentElement;
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  function report(reason, text) {
    document.querySelectorAll('[data-engine-why]').forEach(function (el) { el.textContent = text; el.hidden = !text; });
    if (local) fetch('/__scene-status?reason=' + encodeURIComponent(reason) + '&ua=' + encodeURIComponent(navigator.userAgent)).catch(function () {});
  }

  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  var CAPTION = {
    galaxy: function (d) { return 'The galaxy · ' + fmt(d.clusters) + ' clusters · ' + fmt(d.systems) + ' systems'; },
    dive: function (d) { return 'Descending to ' + d.system; },
    system: function (d) { return d.system + ' · ' + fmt(d.ships) + ' ships on patrol'; },
    fleet: function (d) { return 'Riding with one ship of ' + fmt(d.fleet) + ' · ' + d.system; },
    planet: function (d) { return 'Your planet · ' + d.planet + ' · ' + d.system; },
    tour: function (d) { return 'Touring ' + d.system; },
    rise: function () { return 'Rising back to the galaxy'; },
  };
  function caption(d) { say(CAPTION[d.act] ? CAPTION[d.act](d) : ''); }
  function say(text) {
    document.querySelectorAll('[data-engine-caption]').forEach(function (el) {
      var span = el.querySelector('span');
      if (!span || span.textContent === text) return;
      el.classList.add('swap');
      setTimeout(function () { span.textContent = text; el.classList.remove('swap'); }, 500);
    });
  }

  // Start-up steps, in the order the frame reports them. ms paces the creep
  // while a step runs (half full after ms, still moving long after); w is the
  // step's share of the bar, so the percentage moves at a fairly even pace (the
  // hulls are quick when cached and the longest step on a slow connection).
  var STEPS = [
    { id: 'renderer', name: 'Engine', w: 3, ms: 3000, text: function () { return 'Starting the renderer'; } },
    { id: 'galaxy', name: 'Galaxy', w: 4, ms: 3000, text: function () { return 'Generating the galaxy'; } },
    { id: 'fleets', name: 'Fleets', w: 1.5, ms: 600, text: function (d) { return 'Launching ' + fmt(d.ships) + ' ships in ' + fmt(d.fleets) + ' fleets'; } },
    { id: 'system', name: 'System', w: 1.5, ms: 600, text: function (d) { return 'Entering ' + d.system; } },
    { id: 'hulls', name: 'Hulls', w: 3, ms: 8000, text: function () { return 'Loading the ship hulls'; } },
    { id: 'ride', name: 'Ride', w: 2, ms: 2500, text: function () { return 'Joining the patrol'; } },
  ];
  var WEIGHT = STEPS.reduce(function (n, s) { return n + s.w; }, 0);
  function weightBefore(i) { return STEPS.slice(0, i).reduce(function (n, s) { return n + s.w; }, 0); }

  // The loading bar: one segment per step. A running step creeps towards full
  // without reaching it, slower and slower so a long step never looks stalled;
  // only the frame's next report completes it.
  function loadingBar() {
    var bars = [], step = 0, since = performance.now(), raf = 0, shown = -1;
    document.querySelectorAll('[data-engine-live]').forEach(function (live) {
      var bar = document.createElement('div');
      bar.className = 'boot';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Starting the live engine');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.style.gridTemplateColumns = STEPS.map(function (s) { return 'minmax(0, ' + s.w + 'fr)'; }).join(' ');
      bar.innerHTML = STEPS.map(function (s) { return '<span class="seg"><i></i><small>' + s.name + '</small></span>'; }).join('');
      live.appendChild(bar);
      bars.push({ bar: bar, segs: bar.querySelectorAll('.seg'), pct: live.querySelector('[data-engine-pct]') });
    });
    function paint() {
      var t = performance.now() - since, done = step >= STEPS.length;
      var f = done ? 0 : 0.95 * t / (t + STEPS[step].ms);
      var pct = done ? 100 : Math.floor(100 * (weightBefore(step) + f * STEPS[step].w) / WEIGHT);
      bars.forEach(function (b) {
        b.segs.forEach(function (seg, i) {
          seg.className = 'seg' + (i < step ? ' done' : i === step ? ' now' : '');
          seg.style.setProperty('--f', i < step ? 1 : i === step ? f.toFixed(3) : 0);
        });
        if (pct !== shown) {
          if (b.pct) b.pct.innerHTML = pct + '<small>%</small>';
          b.bar.setAttribute('aria-valuenow', pct);
        }
      });
      shown = pct;
      raf = done ? 0 : requestAnimationFrame(paint);
    }
    say('Loading the engine');
    paint();
    return {
      // a step has begun: every step before it is done
      step: function (d) {
        var i = STEPS.findIndex(function (s) { return s.id === d.step; });
        if (i < 0) return;
        if (i !== step) { step = i; since = performance.now(); }
        say(STEPS[i].text(d));
      },
      // full, then the percentage leaves once the bar has faded (see .boot)
      done: function () {
        step = STEPS.length; cancelAnimationFrame(raf); paint();
        setTimeout(function () { bars.forEach(function (b) { if (b.pct) b.pct.textContent = ''; }); }, 2200);
      },
      stop: function () { cancelAnimationFrame(raf); },
    };
  }

  async function start() {
    if (location.protocol === 'file:') return report('file', 'Opened from disk, the page shows a still frame; served over http the engine runs live.');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return report('reduced-motion', 'Your system asks for reduced motion, so the engine stays still. This frame is what it draws.');
    if (!window.isSecureContext) return report('insecure', 'The live engine needs a secure page (https or localhost).');
    if (!navigator.gpu) return report('no-webgpu', 'Your browser has WebGPU switched off, so this is a still frame instead of the live engine. Chrome, Edge and Safari support it; on Linux it may need enabling.');
    // phones run it too; what stops it is a request to save data (it downloads
    // about 50 MB) or a device with under 4 GB of memory
    if (navigator.connection && navigator.connection.saveData) {
      return report('save-data', 'Your browser asks to save data, so the page shows a frame the engine rendered instead of the live engine.');
    }
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
      return report('low-memory', 'On this device the page shows a frame the engine rendered; the live engine needs more memory.');
    }
    var adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { /* reported below */ }
    if (!adapter) return report('no-adapter', 'Your browser supports WebGPU but found no usable graphics adapter, so this is a still frame instead of the live engine.');

    var frame = document.createElement('iframe');
    frame.src = host.getAttribute('data-engine');
    frame.title = 'StarChad, rendered live';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    var failed = false, loading = loadingBar(), lastAct = null;
    function fail(reason) {
      if (failed) return;
      failed = true;
      loading.stop();
      frame.remove();
      root.classList.remove('gpu', 'gpu-wait');
      report(reason, 'The live engine could not start here, so this is a still frame it rendered.');
    }
    // gives up when the frame goes 45 s without a step (on a slow connection
    // the whole start can take longer than that)
    var timer = 0;
    function patience() { clearTimeout(timer); timer = setTimeout(function () { fail('timeout'); }, 45000); }
    patience();
    // play only while a window onto it is on screen and the tab is visible;
    // until it is ready it prepares regardless (generating the galaxy)
    var seen = new Set(), playing = true, ready = false;
    function sync() {
      if (!ready) return;
      var want = !document.hidden && seen.size > 0;
      if (want === playing || !frame.contentWindow) return;
      playing = want;
      frame.contentWindow.postMessage({ starchad: want ? 'play' : 'pause' }, '*');
    }
    var watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); });
      sync();
    });
    document.querySelectorAll('.window').forEach(function (w) { watch.observe(w); });
    document.addEventListener('visibilitychange', sync);
    addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.starchad === 'boot') { patience(); loading.step(e.data); }
      else if (e.data.starchad === 'ready') {
        clearTimeout(timer); loading.done();
        root.classList.add('gpu'); root.classList.remove('gpu-wait'); report('running', ''); ready = true; sync();
        if (lastAct) caption(lastAct);
      }
      // what the frame shows only becomes the caption once it is on screen
      else if (e.data.starchad === 'act') { if (ready) caption(e.data); else lastAct = e.data; }
      else if (e.data.starchad === 'failed') { clearTimeout(timer); fail('failed'); }
    });
    root.classList.add('gpu-wait');
    host.appendChild(frame);
  }

  // Start on the first scroll, or at once if a window is already in view (a
  // link to #fleet, a reload halfway down); never before the page has loaded.
  function arm() {
    var armed = true;
    function go() {
      if (!armed) return;
      armed = false;
      removeEventListener('scroll', onScroll);
      near.disconnect();
      start();
    }
    function onScroll() { if (scrollY > 40) go(); }
    // a window merely touching the bottom edge does not count: it must show a little
    var near = new IntersectionObserver(function (entries) { if (entries.some(function (e) { return e.intersectionRatio > 0; })) go(); }, { threshold: 0.02 });
    document.querySelectorAll('.window').forEach(function (w) { near.observe(w); });
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  if (document.readyState === 'complete') arm();
  else addEventListener('load', arm);
})();
