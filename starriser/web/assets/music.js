/* The site's music: "Hacia un planeta distante", off until the reader turns it on.
 *
 * A button in the corner of every page ([data-music]) starts and stops it with
 * a short fade. Nothing downloads before the first press; the file then streams.
 * Turned on, it carries on while the reader moves between pages of the visit:
 * each page leaves its state and position in sessionStorage, and the next one
 * resumes from there. A browser that wants a gesture on the new page first
 * gets it from the reader's first click or key, and the button shows it is
 * waiting meanwhile. Turned off, it stays off. Classic deferred script.
 */
(function () {
  'use strict';
  var button = document.querySelector('[data-music]');
  if (!button) return;
  var KEY = 'starchad-music', VOLUME = 0.5;
  var audio = null, on = false, ramp = 0;

  function track() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = 0;
    audio.src = button.getAttribute('data-music');
    return audio;
  }
  // timers rather than animation frames, so a fade also ends in a hidden tab
  function fade(to, ms, then) {
    clearInterval(ramp);
    var a = audio, from = a.volume, t0 = Date.now();
    ramp = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      a.volume = from + (to - from) * k;
      if (k < 1) return;
      clearInterval(ramp);
      if (then) then();
    }, 40);
  }
  function show(state) {
    button.dataset.state = state;
    button.setAttribute('aria-pressed', String(state === 'on'));
  }
  function play(at) {
    on = true;
    show('on');
    var a = track();
    if (at) a.currentTime = at;
    return a.play().then(function () {
      if (on) fade(VOLUME, 1500); else a.pause();
    }, function (error) {
      on = false;
      show('off');
      throw error;
    });
  }
  function stop() {
    on = false;
    show('off');
    if (audio) fade(0, 600, function () { if (!on) audio.pause(); });
  }

  button.addEventListener('click', function () {
    if (on) stop();
    else play().catch(function () { /* unplayable here: the button stays off */ });
  });

  addEventListener('pagehide', function () {
    try { sessionStorage.setItem(KEY, JSON.stringify({ on: on, at: audio ? audio.currentTime : 0 })); } catch (e) { /* storage off */ }
  });
  // back to a page from the back/forward cache: its music was paused on the way out
  addEventListener('pageshow', function (e) { if (e.persisted && on && audio && audio.paused) play().catch(function () {}); });

  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* storage off */ }
  button.hidden = false;
  if (!saved || !saved.on) return;
  play(saved.at).catch(function () {
    show('waiting');
    function resume(e) {
      removeEventListener('pointerdown', resume, true);
      removeEventListener('keydown', resume, true);
      // a press on the button itself plays it through its own click
      if (!button.contains(e.target)) play().catch(function () {});
    }
    addEventListener('pointerdown', resume, true);
    addEventListener('keydown', resume, true);
  });
})();
