var WebGLPlanet = (function () {

	var stage = new PIXI.Container(0x000000);
	stage.interactive = true;

	// First-principles sizing:
	//   - canvas = viewport (so PIXI can draw anywhere on screen)
	//   - sprite is square; the sphere shader fades alpha to 0 at the sprite edges
	//   - sprite diameter <= min(vw, vh) so the sprite always fits in the canvas
	//     and there are no hard cuts where canvas slices through solid planet
	function viewportSize () { return { w: window.innerWidth, h: window.innerHeight }; }
	function planetLayout (vp) {
		// Planet diameter = 65% of the smaller window dimension. The smaller
		// dim guarantees the sprite always fits in the canvas (no hard cuts);
		// 65% leaves visible space around it.
		var size = Math.floor(Math.min(vp.w, vp.h) * 0.65);
		var x = Math.floor((vp.w - size) / 2);
		var y = Math.floor((vp.h - size) / 2);
		return { size: size, x: x, y: y };
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
				sp.width = sp.height = layout.size;
				sp.position.x = layout.x;
				sp.position.y = layout.y;
				filter[i].uniforms.width = sp.width;
			});
		});
	});

	var desplazamiento = 0;
	var container;
	var filter = [];
	var sprite = [];
	var startTime = window.performance.now();

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

		earthNormal.baseTexture._powerOf2 = true;
		earthSpec.baseTexture._powerOf2 = true;
		earthColor.baseTexture._powerOf2 = true;
		cloud.baseTexture._powerOf2 = true;
		ligth.baseTexture._powerOf2 = true;

		stage.addChild(createPlanet(earthColor, cloud, earthSpec, earthNormal, ligth, layout.size, layout.x, layout.y));
		
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

	function createPlanet(planet, cloud, dif, normal, ligth, size, x, y) {
		var nm = getMyShader(planet, cloud, dif, normal, ligth);
		filter.push(nm);

		sp = new PIXI.Sprite(ligth);
		sprite.push(sp);
		sp.filters = [nm];

		sp.height = sp.width = size;
		nm.uniforms.width = sp.width;

		sp.position.x = x;
		sp.position.y = y;

		return sp
	}

	var time = 0;

	function animate() {
		var new_time = window.performance.now();
		overlay_fps.innerHTML = "FPS: " + Math.round(1000 / (new_time - time));
		time = new_time;

		for (var i = filter.length - 1; i >= 0; i--) {
			desplazamiento = 0.000005 * (time - startTime);
			filter[i].uniforms.desplazamiento = desplazamiento;
		}
		renderer.render(stage);
		requestAnimationFrame(animate);
	}

	var lastEvent = null;

	function computeMouse (event) {
		let originalEvent = event.data.originalEvent;
		if(lastEvent){
			let movement = {x: originalEvent.pageX - lastEvent.pageX, y: originalEvent.pageY - lastEvent.pageY};

			for (var i = sprite.length - 1; i >= 0; i--) {

				//var coord = relativeCoords({x: event.pageX, y: event.pageY}, sprite[i]);

				filter[i].uniforms.lightPositionX += movement.x / 2;
				filter[i].uniforms.lightPositionY += movement.y / 2;
			}

		}
		
		lastEvent = originalEvent;
	}

	var lastTouchEvent = null;

	function computeTouch (event) {
		let originalEvent = event.data.originalEvent;
		var touchobj = originalEvent.changedTouches[0];

		if (lastTouchEvent) {

			let movement = {x: touchobj.pageX - lastTouchEvent.pageX, y: touchobj.pageY - lastTouchEvent.pageY};

			for (var i = sprite.length - 1; i >= 0; i--) {

				//var coord = relativeCoords({x: touchobj.pageX, y: touchobj.pageY}, sprite[i]);

				filter[i].uniforms.lightPositionX += movement.x / 2;
				filter[i].uniforms.lightPositionY += movement.y / 2;
			}
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

		sprite.forEach((sprite, i) => {
			sprite.height += dif;
			sprite.width += dif;
			sprite.position.x -= dif/2;
			sprite.position.y -= dif/2;
			filter[i].uniforms.width += dif;
			sprite.calculateTrimmedVertices();
			sprite. _calculateBounds();
			console.log(filter[i].uniforms.width)
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
