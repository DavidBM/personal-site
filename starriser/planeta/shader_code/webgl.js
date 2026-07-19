var WebGLPlanet = (function () {

	var stage = new PIXI.Container(0x000000);
	stage.interactive = true;

	// Sizing:
	//   - canvas = viewport (full window, always)
	//   - the filtered sprite ALSO covers the full window, so the planet and its
	//     atmosphere are never clipped by a sprite-sized filter buffer
	//   - the shader places a circle of `diameter` px centered at (cx, cy)
	// Planet rim diameter = a fraction of window WIDTH (0.65–0.70 looks good).
	var PLANET_WIDTH_RATIO = 0.65;
	function viewportSize () { return { w: window.innerWidth, h: window.innerHeight }; }
	function planetLayout (vp) {
		return {
			diameter: Math.floor(vp.w * PLANET_WIDTH_RATIO),
			cx: vp.w / 2,
			cy: vp.h / 2
		};
	}

	var vp = viewportSize();
	var layout = planetLayout(vp);

	var renderer = PIXI.autoDetectRenderer({
		width: vp.w,
		height: vp.h
	});

	document.body.appendChild(renderer.view);

	var resizeRaf = null;
	window.addEventListener('resize', function () {
		if (resizeRaf) cancelAnimationFrame(resizeRaf);
		resizeRaf = requestAnimationFrame(function () {
			vp = viewportSize();
			layout = planetLayout(vp);
			renderer.resize(vp.w, vp.h);
			sprite.forEach(function (sp, i) {
				sp.width = vp.w;
				sp.height = vp.h;
				filter[i].uniforms.uScreen = [vp.w, vp.h];
				filter[i].uniforms.planetCenter = [layout.cx, layout.cy];
				filter[i].uniforms.planetDiameter = layout.diameter;
				filter[i].uniforms.width = layout.diameter;
			});
		});
	});

	var desplazamiento = 0;
	var container;
	var filter = [];
	var sprite = [];
	var startTime = window.performance.now();

	// --- realistic rotation -------------------------------------------------
	// Three independent motions, all constant-rate (no speed-up):
	//   spin       = the planet turning on its own axis (the "day")
	//   obliquity  = the axis tilted away from vertical, like Earth's 23.5 deg
	//   precession = that tilt direction slowly sweeping around (axis rotating)
	var OBLIQUITY_DEG          = 23.5;
	var SPIN_DEG_PER_MS        = 360 / 28000;   // one rotation / 28 s
	var PRECESSION_DEG_PER_MS  = 360 / 90000;   // axis sweeps around / 90 s
	// --- drag (arcball) -----------------------------------------------------
	// Grab a point on the globe and it follows the cursor. We accumulate a
	// view-space rotation as a quaternion (x,y,z,w) and hand the shader the
	// matching mat3 (column-major), applied before the auto rotation.
	var dragQuat = [0, 0, 0, 1];                              // identity
	var dragMat  = new Float32Array([1,0,0, 0,1,0, 0,0,1]);  // mat3 uniform

	// --- light: intro sweep, then a realistic "sun on Earth" cycle ----------
	// Intro: the sun enters high (top, a touch front) and eases down into a
	// near-equatorial path. Rest state mimics real sunlight: it sits close to the
	// equatorial plane, its latitude (declination) drifting only within +/- the
	// axial tilt (the seasons), while it circles in longitude (the day).
	var LIGHT_INTRO_MS        = 4200;
	var SUN_LAT_START = 74,  SUN_LON_START = 8;          // intro start: high + a touch front
	var SUN_DECLINATION_DEG   = 23.5;                    // == obliquity: sun stays within the tropics
	var SEASON_RAD_PER_MS     = (2 * Math.PI) / 120000;  // one declination (season) cycle / 120 s
	var SUN_DAY_MS            = 5670;                     // one light rotation (~5.67s); 1.5x slower than the 3.78s pace
	var SUN_ORBIT_DEG_PER_MS  = 360 / SUN_DAY_MS;

	function clamp01 (t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
	function easeOutCubic (t) { return 1 - Math.pow(1 - t, 3); }

	// Map a page pixel to a unit vector on the displayed sphere, using the same
	// geometry the shader uses (x right, y up, z toward viewer). Outside the
	// disc, clamp to the rim.
	function spherePoint (px, py) {
		var r = layout.diameter * 0.5;
		var x = (px - layout.cx) / r;
		var y = -(py - layout.cy) / r;
		var d2 = x * x + y * y;
		if (d2 > 1.0) { var inv = 1.0 / Math.sqrt(d2); return [x * inv, y * inv, 0.0]; }
		return [x, y, Math.sqrt(1.0 - d2)];
	}

	// Quaternion (x,y,z,w) rotating unit vector a onto unit vector b.
	function quatBetween (a, b) {
		var d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
		if (d >= 0.999999) return [0, 0, 0, 1];
		if (d <= -0.999999) {                       // 180 deg: any axis perp to a
			var ax = Math.abs(a[0]) < 0.9 ? [1,0,0] : [0,1,0];
			var p = [a[1]*ax[2]-a[2]*ax[1], a[2]*ax[0]-a[0]*ax[2], a[0]*ax[1]-a[1]*ax[0]];
			var pl = Math.hypot(p[0],p[1],p[2]) || 1;
			return [p[0]/pl, p[1]/pl, p[2]/pl, 0];
		}
		var c = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
		var q = [c[0], c[1], c[2], 1 + d];
		var l = Math.hypot(q[0],q[1],q[2],q[3]) || 1;
		return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
	}

	// Hamilton product a*b, quaternions as (x,y,z,w).
	function quatMul (a, b) {
		return [
			a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
			a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
			a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
			a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
		];
	}

	// One drag step: the grabbed point moves from sphere point p0 to p1. The
	// shader matrix is uDragRot = (accumulated) * inverse(p0->p1), so we
	// post-multiply dragQuat by the conjugate of that rotation.
	function applyDragStep (p0, p1) {
		var qr = quatBetween(p0, p1);
		dragQuat = quatMul(dragQuat, [-qr[0], -qr[1], -qr[2], qr[3]]);
		var l = Math.hypot(dragQuat[0],dragQuat[1],dragQuat[2],dragQuat[3]) || 1;
		dragQuat = [dragQuat[0]/l, dragQuat[1]/l, dragQuat[2]/l, dragQuat[3]/l];
	}

	// Rebuild the column-major mat3 the shader uses from the drag quaternion.
	function updateDragMat () {
		var x=dragQuat[0], y=dragQuat[1], z=dragQuat[2], w=dragQuat[3];
		var xx=x*x, yy=y*y, zz=z*z, xy=x*y, xz=x*z, yz=y*z, wx=w*x, wy=w*y, wz=w*z;
		dragMat[0]=1-2*(yy+zz); dragMat[1]=2*(xy+wz);   dragMat[2]=2*(xz-wy);
		dragMat[3]=2*(xy-wz);   dragMat[4]=1-2*(xx+zz); dragMat[5]=2*(yz+wx);
		dragMat[6]=2*(xz+wy);   dragMat[7]=2*(yz-wx);   dragMat[8]=1-2*(xx+yy);
	}

	var computeMove = false;

	window.addEventListener('mousedown', (event) => {
		computeMove = true;
		console.log("mousedown");
	}, {capture: true});

	window.addEventListener('mouseup', (event) => {
		computeMove = false;
		lastEvent = null;
		lastTouchEvent = null;
		console.log("mouseup");
	}, {capture: true});

	window.addEventListener('touchend', (event) => {
		computeMove = false;
		lastTouchEvent = null;
		lastEvent = null;
	}, {capture: true});

	window.addEventListener('touchstart', (event) => {
		computeMove = true;
	}, {capture: true});

	function loadImage (url, callback) {
		var imageLoader = new PIXI.ImageLoader(url, true);
		imageLoader.addEventListener("loaded", callback);
		imageLoader.load();
	}

	function webGLStart() {
		makePlanet();
		/*var cb = new MultipleCallbacks(9, makePlanet);

		loadImage("textura2.png", cb);
		loadImage("textura3.png", cb);
		loadImage("earth/earthlights.jpg", cb);
		loadImage("textura3ligths.png", cb);
		loadImage("cloud.png", cb);
		loadImage("moon512.jpg", cb);
		loadImage("earth/earthmap.jpg", cb);
		loadImage("earth/earthspec.jpg", cb);
		loadImage("earth/earthnormal.png", cb);*/

	}

	function makePlanet (argument) {
		var cloud = PIXI.Texture.from("cloud.png");

		var ligth = PIXI.Texture.from("earth/earthlights.jpg");
		var earthColor = PIXI.Texture.from("earth/earthmap.jpg");
		var earthSpec = PIXI.Texture.from("earth/earthspec.jpg");
		var earthNormal = PIXI.Texture.from("earth/earthnormal.png");

		// Wrap REPEAT so the longitude seam (texture left edge meets right edge)
		// blends continuously, and turn mipmaps OFF: at that seam the UV derivative
		// spikes, which would otherwise make the GPU pick the coarsest mip (the
		// texture's average ~gray) and draw a thin gray line down the seam.
		[cloud, ligth, earthColor, earthSpec, earthNormal].forEach(function (t) {
			t.baseTexture._powerOf2 = true;
			t.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
			t.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
			t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
		});

		stage.addChild(createPlanet(earthColor, cloud, earthSpec, earthNormal, ligth, vp, layout));
		
		stage.on("touchmove", function (event) {
			console.log("touch move!");
			if(computeMove) computeTouch(event);
		});

		stage.on("mousemove", function (event) {
			console.log("mouse move!");
			if(computeMove) computeMouse(event);
		});

		requestAnimationFrame(animate);
	}

	function createPlanet(planet, cloud, dif, normal, ligth, vp, layout) {
		var nm = getMyShader(planet, cloud, dif, normal, ligth);
		filter.push(nm);

		sp = new PIXI.Sprite(ligth);
		sprite.push(sp);
		sp.filters = [nm];

		// Sprite spans the whole window; the planet's position/size live in the
		// shader uniforms, so nothing gets clipped against the sprite's bounds.
		sp.position.set(0, 0);
		sp.width = vp.w;
		sp.height = vp.h;

		nm.uniforms.uScreen = [vp.w, vp.h];
		nm.uniforms.planetCenter = [layout.cx, layout.cy];
		nm.uniforms.planetDiameter = layout.diameter;
		nm.uniforms.width = layout.diameter;

		return sp
	}

	var time = 0;

	function animate() {
		var new_time = window.performance.now();
		overlay_fps.innerHTML = "FPS: " + Math.round(1000 / (new_time - time));
		time = new_time;

		var elapsed = time - startTime;

		var spin       = SPIN_DEG_PER_MS * elapsed;
		var obliquity  = OBLIQUITY_DEG;
		var precession = PRECESSION_DEG_PER_MS * elapsed;

		// Light: ease from the high intro position into an Earth-like path -
		// latitude drifts within +/- the axial tilt (declination/seasons), while
		// longitude circles steadily (the day), 1.2x slower than before.
		var le = easeOutCubic(clamp01(elapsed / LIGHT_INTRO_MS));
		var declination = SUN_DECLINATION_DEG * Math.sin(elapsed * SEASON_RAD_PER_MS);
		var sunLat = SUN_LAT_START + (declination - SUN_LAT_START) * le;
		var sunLon = SUN_LON_START + SUN_ORBIT_DEG_PER_MS * elapsed;

		updateDragMat();

		for (var i = filter.length - 1; i >= 0; i--) {
			filter[i].uniforms.uSpin = spin;
			filter[i].uniforms.uObliquity = obliquity;
			filter[i].uniforms.uPrecession = precession;
			filter[i].uniforms.sunLat = sunLat;
			filter[i].uniforms.sunLon = sunLon;
			filter[i].uniforms.uDragRot = dragMat;
		}
		renderer.render(stage);
		requestAnimationFrame(animate);
	}

	var lastEvent = null;

	function computeMouse (event) {
		let originalEvent = event.data.originalEvent;
		if(lastEvent){
			applyDragStep(
				spherePoint(lastEvent.pageX, lastEvent.pageY),
				spherePoint(originalEvent.pageX, originalEvent.pageY)
			);

		}
		
		lastEvent = originalEvent;
	}

	var lastTouchEvent = null;

	function computeTouch (event) {
		let originalEvent = event.data.originalEvent;
		var touchobj = originalEvent.changedTouches[0];

		if (lastTouchEvent) {

			applyDragStep(
				spherePoint(lastTouchEvent.pageX, lastTouchEvent.pageY),
				spherePoint(touchobj.pageX, touchobj.pageY)
			);
		}

		lastTouchEvent = touchobj;
	}

	function relativeCoords (position, sprite) {
		var newPos = {x: 0, y: 0};

		var spriteNewPos = {
			x: sprite.position.x + sprite.width / 2,
			y: sprite.position.y + sprite.height / 2
		};

		newPos.x = (position.x - spriteNewPos.x) / 30;
		newPos.y = (position.y - spriteNewPos.y) / 30;

		return newPos;
	}

	let last_known_scroll_position = 0;
	let previous_scroll = 0;
	let ticking = false;

	function scrollHandler(scroll_pos) {
		var dif = (last_known_scroll_position - previous_scroll) * 100;

		// Zoom = change the planet's diameter in the shader; the sprite stays
		// full-window and the planet stays centered.
		layout.diameter = Math.max(1, layout.diameter + dif);

		filter.forEach(function (f) {
			f.uniforms.planetDiameter = layout.diameter;
			f.uniforms.width = layout.diameter;
		});

		previous_scroll = last_known_scroll_position;
	}

	window.addEventListener('wheel', function(e) {
	  e.stopPropagation();
	  e.preventDefault();
	  last_known_scroll_position += e.deltaY * -0.1;

	  //console.log("HOLA scrool", e);

	  if (!ticking) {
	    window.requestAnimationFrame(function() {
	      scrollHandler(last_known_scroll_position);
	      ticking = false;
	    });

	    ticking = true;
	  }
	}, {capture: true});

	return webGLStart;
})();

var overlay_fps;

(function () {
    var overlay, lastCount, lastTime, timeoutFun;

    overlay = document.createElement('div');
    overlay.style.background = 'rgba(0, 0, 0, .7)';
    overlay.style.bottom = '0';
    overlay.style.color = '#fff';
    overlay.style.display = 'inline-block';
    overlay.style.fontFamily = 'Arial';
    overlay.style.fontSize = '10px';
    overlay.style.lineHeight = '12px';
    overlay.style.padding = '5px 8px';
    overlay.style.position = 'fixed';
    overlay.style.right = '0';
    overlay.style.zIndex = '1000000';
    overlay.innerHTML = 'FPS: -';
    document.body.appendChild(overlay);

    overlay_fps = overlay;

    lastCount = window.mozPaintCount;
    lastTime = performance.now();

    timeoutFun = function () {
        var curCount, curTime;

        curCount = window.mozPaintCount;
        curTime = performance.now();
        overlay.innerHTML = 'FPS: ' + ((curCount - lastCount) / (curTime - lastTime) * 1000).toFixed(2);
        lastCount = curCount;
        lastTime = curTime;
        setTimeout(timeoutFun, 1000);
    };

    setTimeout(timeoutFun, 1000);
}())
