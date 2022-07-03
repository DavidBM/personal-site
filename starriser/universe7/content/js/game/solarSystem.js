"use strict";
var SolarSystem = function (sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) {
	this.init(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler);
};

SolarSystem.prototype.init = function(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) { //Initialize variables. Wait for draw calls or what-is-there calls

	var self = this;

	this.nodes = [];

	this.data = {};
	this.sCanvasD = sCanvasDom;
	this.dCanvasD = dCanvasDom;

	this.sCanvasC = sCanvasCtx;
	this.dCanvasC = dCanvasCtx;

	this.handler = Handler;
	this.handlerContext = handlerContext;
	this.eventHandler = eventHandler;

	this.canvasWidth = this.dCanvasD.width;
	this.canvasHeight = this.dCanvasD.height;
	this.canvasTrasnform = new Array(6);

	this.dragData = {};

	this.animationData = {
		imagesLoaded: {
			planetMask: false,
			planets: false,
			sun1: false,
			sun2: false,
			sun3: false
		}
	};

	this.isHide = false;
	this.animationData.followingPlanetZoom = 0;
	this.animationData.followingPlanetDesX = 0;
	this.animationData.followingPlanetDesY = 0;

	this.animationData.initAutoZoomData = {};
	this.userNamesCanvasCache = {};
	this.userNamesCanvasCache.images = [];

	this.resetData();

	this.loads = {};
	this.loads.planets = false;
	this.loads.suns = false;

	var ntimes = new NtimeEvent(3, function () {
		self.loads.suns = true;
	});

	this.images = {
		planetMask: ResourcesImg.g().load('content/img/planetMask.png'),
		planets: ResourcesImg.g().load('content/img/planetas.jpg'),
		sun1: ResourcesImg.g().load('content/img/sun1.png', ntimes),
		sun2: ResourcesImg.g().load('content/img/sun2.png', ntimes),
		sun3: ResourcesImg.g().load('content/img/sun3.png', ntimes),
		finishedPlanets: ResourcesImg.g().wait("finishedPlanets", {
			handler: function () {
				self.loads.planets = true;
			}
		})
	};

	this.events = {
		drag: false,
		click: false,
		resize: false
	};

	this.semiTransparentBackground = document.createElement("canvas");
	this.semiTransparentBackground.width = 1;
	this.semiTransparentBackground.height = 1;

};

SolarSystem.prototype.setData = function(nodes) {
	this.nodes = nodes;
	var i;

	//Adaptando datos
	for (i = this.nodes.length - 1; i >= 0; i--) {
		this.nodes[i].conn = [];
		this.nodes[i].x = 0;
		this.nodes[i].y = 0;
		this.nodes[i].planetPosition = this.nodes[i].ip;
		//this.nodes[i].r;
	}
	this.generateNamesCanvasCache();
};

SolarSystem.prototype.resetData = function() {
	this.globalAlpha = 1;
	this.sunRotation = 0;
	this.centerX = 0;
	this.centerY = 0;

	this.dragData.hoverPlanet = -1;
	this.dragData.hoverOrbit = -1;
	this.dragData.selectedPlanet = -1;

	this.animationData.followingPlanet = false;
	this.animationData.planetOnZoom = false;
	this.animationData.planetOnZoomIndex = false;

	this.animationData.initAutoZoomData.initialZoom = 0;
	this.animationData.initAutoZoomData.finalZoom = 0;
	this.animationData.initAutoZoomData.x = 0;
	this.animationData.initAutoZoomData.y = 0;
	this.animationData.initAutoZoomData.time = 0;
	this.animationData.initAutoZoomData.duration = 0;
	this.animationData.initAutoZoomData.initialAlpha = 1;
	this.animationData.initAutoZoomData.finalAlpha = 1;
	this.animationData.scroll = 0;

	this.userNamesCanvasCache.ready = false;
	this.userNamesCanvasCache.images.length = 0;
};

SolarSystem.prototype.setCanvasSize = function(w, h) {
	this.canvasWidth = w;
	this.canvasHeight = h;

	this.zoom = 0.01;
	this.desplacedX = w/2;
	this.desplacedY = h/2;

	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[0] = this.zoom;
	this.canvasTrasnform[1] = 0;
	this.canvasTrasnform[2] = 0;
	this.canvasTrasnform[3] = this.zoom;
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	this.requestStaticFrameFunction();
};

SolarSystem.prototype.updateCanvasSize = function(w, h) {
	var desplacedX = (this.canvasWidth - w) / 2;
	var desplacedY = (this.canvasHeight - h) / 2;

	this.canvasWidth = w;
	this.canvasHeight = h;

	this.canvasTrasnform[4] -= desplacedX;
	this.canvasTrasnform[5] -= desplacedY;

	if(this.animationData.followingPlanet !== false){
		this.animationData.followingPlanetDesX -= desplacedX;
		//this.animationData.followingPlanetDesY -= desplacedY;
	}

	this.desplacedX = this.canvasTrasnform[4];
	this.desplacedY = this.canvasTrasnform[5];
	this.generateNamesCanvasCache();
};

SolarSystem.prototype.bindEvents = function() {
	var self = this;

	$(this.dCanvasD).bind('mousedown.system touchstart.system', function (e) {
		e.preventDefault();
	});

	this.events.drag = this.eventHandler.bind("drag", this.dCanvasD, function (data, event) {
		self.moveSystem(data.pageX, data.pageY);
	});

	this.events.click = this.eventHandler.bind("click", this.dCanvasD, function (data, event) {
		self.mapClick(data.pageX, data.pageY);
	});

	this.events.resize = this.eventHandler.bind("resize", this.dCanvasD, function (data, event) {
		self.zoomSystem(data.factor, data.center[0], data.center[1]);
	});

	$(this.dCanvasD).bind('mousemove.system', function (e) {
		self.checkHoverAndSetPointer(e);
	});
};

SolarSystem.prototype.unbindEvents = function() {
	$(this.dCanvasD).unbind(".system");
	this.eventHandler.unbind(this.events.drag);
	this.eventHandler.unbind(this.events.click);
	this.eventHandler.unbind(this.events.resize);
};


SolarSystem.prototype.moveSystem = function(desplacedX, desplacedY) {
	this.desplacedX += desplacedX;
	this.desplacedY += desplacedY;

	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	this.requestStaticFrameFunction();

	this.handler.call(this.handlerContext, Utils.enums.systemActions.parallaxScrolling, {x: desplacedX, y: desplacedY});

	return 0;
};

SolarSystem.prototype.zoomSystem = function(growth, x, y) {

	var zoom = this.zoom * growth

	if(zoom > Utils.configuration.maxSystemZoom) zoom = Utils.configuration.maxSystemZoom;
	else if(zoom < Utils.configuration.minSystemZoom) zoom = Utils.configuration.minSystemZoom;

	growth = zoom / this.zoom;

	this.zoom *= growth;
	this.desplacedX += (x - this.desplacedX) - (x - this.desplacedX) * growth;
	this.desplacedY += (y - this.desplacedY) - (y - this.desplacedY) * growth;
	
	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[0] = this.zoom;
	this.canvasTrasnform[3] = this.zoom;
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	this.requestStaticFrameFunction();
	this.generateNamesCanvasCache();
};

SolarSystem.prototype.requestStaticFrameFunction = function() {
	this.handler.call(this.handlerContext, Utils.enums.systemActions.requestStaticFrameFunction);
};

SolarSystem.prototype.hide = function(hide) {
	this.isHide = hide;
};

SolarSystem.prototype.showUserInfoFunction = function(show) {
	this.showUserInfo = show;
	if(show) this.generateNamesCanvasCache();
};

SolarSystem.prototype.staticDraw = function() {

	if(this.isHide !== true){
		this.sCanvasC.save();

		if(this.animationData.followingPlanet !== false){ //Estamos siguiendo un planeta, así que tendremos que repintar la parte statica cada frame.
			this.followPlanet(this.animationData.followingPlanet);
		}

		if(this.animationData.planetOnZoomIndex !== false){
			this.autoZoom();
		}
		this.sCanvasC.globalAlpha = this.globalAlpha;
		this.sCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );

		this.drawSolarOrbits();


		this.sCanvasC.restore();
	}
};

SolarSystem.prototype.dynamicDraw = function() {

	if(this.isHide !== true){
		this.dCanvasC.save();

		this.sCanvasC.globalAlpha = this.globalAlpha;
		this.dCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );
		if(this.loads.suns) this.drawSun();
		if(this.loads.planets) this.drawSolarPlanets();

		this.dCanvasC.restore();
	}
};

SolarSystem.prototype.drawSolarPlanets = function() {
	var i;
	var ctx = this.dCanvasC;

	ctx.save();
	ctx.fillStyle = "#fff";

	for (i = this.nodes.length - 1; i >= 0; i--) {

		if(i !== this.animationData.followingPlanet && i !== this.animationData.planetOnZoomIndex){
			//Pintamos el planeta con la posición que calculamos la última vez. Esto es por la función de seguir con la cámara un planeta que se hace antes de esto y luego el planeta se pintaba en otro sitio*/
			this.drawPlanet(i, ctx);
			/*Ahora calculamos la proxima posición*/
			this.calculatePlanetNextPosition(i);
		}
	}

	if(this.animationData.followingPlanet !== false || this.animationData.planetOnZoomIndex !== null && this.animationData.planetOnZoomIndex !== false){
		var planet = (this.animationData.followingPlanet) ? this.animationData.followingPlanet : this.animationData.planetOnZoomIndex;
		ctx.save();
		ctx.setTransform(1,0,0,1,0,0);
		ctx.drawImage( this.semiTransparentBackground, 0, 0, this.canvasWidth, this.canvasHeight);
		ctx.restore();

		this.drawPlanet(planet, ctx);
		/*Ahora calculamos la proxima posición*/
		this.calculatePlanetNextPosition(planet);
	}


	ctx.restore();

};

SolarSystem.prototype.drawPlanet = function(i, ctx) {
	var positionI = i%5;
	var positionJ = Math.floor(i/5);
	var planetSize = 400;
	//Draw user info
	var planet = Math.max(this.dragData.hoverPlanet, this.dragData.hoverOrbit);
	if(planet == i){
		ctx.strokeStyle = "#555";
		ctx.lineWidth =  2 / this.zoom;
		ctx.beginPath();
		ctx.arc(this.nodes[i].x, this.nodes[i].y, this.nodes[i].s/2, 0, Math.PI*2, false);
		//Sustituit por panel de mensaje de planeta con sus datos.
		ctx.stroke();
	}

	if(this.showUserInfo === true && this.userNamesCanvasCache.ready === true && this.userNamesCanvasCache.images[i] !== false)
		ctx.drawImage(
			this.userNamesCanvasCache.images[i], 
			this.nodes[i].x + Math.cos(Math.PI/3) * (this.nodes[i].s/2), 
			this.nodes[i].y - Math.sin(Math.PI/3) * (this.nodes[i].s/2), 
			this.userNamesCanvasCache.images[i].width / this.zoom, 
			this.userNamesCanvasCache.images[i].height / this.zoom
		);
	
	if( ResourcesImg.g().isLoaded(this.images.finishedPlanets) ){
		ctx.save();
		ctx.translate(this.nodes[i].x, this.nodes[i].y);
		ctx.rotate(this.nodes[i].planetPosition * this.nodes[i].ro - 1.05);
		ctx.translate(-this.nodes[i].x, -this.nodes[i].y);
		ctx.drawImage( ResourcesImg.g().get(this.images.finishedPlanets), positionI * planetSize, positionJ * planetSize, planetSize, planetSize, this.nodes[i].x - this.nodes[i].s/2, this.nodes[i].y - this.nodes[i].s/2, this.nodes[i].s, this.nodes[i].s);
		ctx.restore();
	}

	/*ctx.rect(this.nodes[i].x - this.nodes[i].s/2, this.nodes[i].y - this.nodes[i].s/2, this.nodes[i].s, this.nodes[i].s);
	ctx.strokeStyle = "#fff";
	ctx.lineWidth =  1 / this.zoom;
	ctx.stroke();*/

	ctx.save();
	ctx.translate(this.nodes[i].x, this.nodes[i].y);
	ctx.rotate(this.nodes[i].planetPosition - 1.05);
	ctx.translate(-this.nodes[i].x, -this.nodes[i].y);
	ctx.drawImage(ResourcesImg.g().get(this.images.planetMask), 500, 0, 500, 500, this.nodes[i].x - this.nodes[i].s/2, this.nodes[i].y - this.nodes[i].s/2, this.nodes[i].s, this.nodes[i].s);
	ctx.restore();



};

SolarSystem.prototype.calculatePlanetNextPosition = function(i) {

	var x = -this.nodes[i].d * Math.cos(this.nodes[i].r);
	var y = this.nodes[i].d * Math.sin(this.nodes[i].r);


	var point = Utils.getPointEllipsePolarAngle(this.nodes[i].planetPosition, this.nodes[i].w/2, this.nodes[i].h/2, x, y, -this.nodes[i].r);

	this.nodes[i].x = point[0] + this.nodes[i].w/2;
	this.nodes[i].y = point[1] + this.nodes[i].h/2;

	var vAngular = this.nodes[i].v / (15000000, Math.sqrt( ( (point[0] + this.nodes[i].w/2)*(point[0] + this.nodes[i].w/2) ) + ( (point[1] + this.nodes[i].h/2) * (point[1] + this.nodes[i].h/2) ) ) );
	if(this.nodes[i].planetPosition +  vAngular > Math.PI * 2){
		this.nodes[i].planetPosition = (this.nodes[i].planetPosition + vAngular) - Math.PI * 2;
	}else{
		this.nodes[i].planetPosition += vAngular;
	}
};

SolarSystem.prototype.drawSolarOrbits = function() {

	this.sCanvasC.save();
	this.sCanvasC.fillStyle = "#fff";
	//this.sCanvasC.strokeStyle = "#282828";
	this.sCanvasC.lineWidth =  1 / this.zoom;

	var x, y, i;
	for (i = 14; i >= 0; i--) {
		this.sCanvasC.strokeStyle = Utils.configuration.orbitsColors[i];
		Utils.drawEllipse(this.sCanvasC, 0, 0, this.nodes[i].w, this.nodes[i].h, this.nodes[i].r, this.nodes[i].d);
		this.sCanvasC.stroke();
	}

	if(this.dragData.hoverPlanet !== -1){
		//this.sCanvasC.strokeStyle = Utils.configuration.selectedOrbitsColors[this.dragData.hoverPlanet];
		this.sCanvasC.strokeStyle = "rgba(255,255,255,0.2)";
		this.sCanvasC.lineWidth =  2 / this.zoom;
		Utils.drawEllipse(this.sCanvasC, 0, 0, this.nodes[this.dragData.hoverPlanet].w, this.nodes[this.dragData.hoverPlanet].h, this.nodes[this.dragData.hoverPlanet].r, this.nodes[this.dragData.hoverPlanet].d);
		this.sCanvasC.stroke();
	}

	if(this.dragData.hoverOrbit !== -1){
		//this.sCanvasC.strokeStyle = Utils.configuration.selectedOrbitsColors[this.dragData.hoverOrbit];
		this.sCanvasC.strokeStyle = "rgba(255,255,255,0.2)";
		this.sCanvasC.lineWidth =  2 / this.zoom;
		Utils.drawEllipse(this.sCanvasC, 0, 0, this.nodes[this.dragData.hoverOrbit].w, this.nodes[this.dragData.hoverOrbit].h, this.nodes[this.dragData.hoverOrbit].r, this.nodes[this.dragData.hoverOrbit].d);
		this.sCanvasC.stroke();
	}

	this.sCanvasC.restore();
};

SolarSystem.prototype.drawSun = function() {
	this.sunRotation += 0.002;
	this.dCanvasC.save();
	this.dCanvasC.fillStyle = "#fff";
	this.dCanvasC.beginPath();
	//this.dCanvasC.arc(0, 0, 1000, 0, 2*Math.PI, false);

	this.dCanvasC.rotate(this.sunRotation);
	this.dCanvasC.drawImage(ResourcesImg.g().get(this.images.sun1), -35000, -35000, 70000, 70000);

	this.dCanvasC.rotate(-2 * this.sunRotation);
	this.dCanvasC.drawImage(ResourcesImg.g().get(this.images.sun2), -35000, -35000, 70000, 70000);
	
	this.dCanvasC.rotate(this.sunRotation);
	this.dCanvasC.drawImage(ResourcesImg.g().get(this.images.sun3), -35000, -35000, 70000, 70000);


	//this.dCanvasC.fill();
	this.dCanvasC.restore();
};

SolarSystem.prototype.startFollowPlanet = function(planet, zoom, desX, desY, semiTransparentBackground) {
	this.animationData.followingPlanet = planet;
	this.animationData.followingPlanetZoom = zoom;
	this.animationData.followingPlanetDesX = desX;
	this.animationData.followingPlanetDesY = desY;

	if(semiTransparentBackground === true){
		this.animationData.semiTransparentBackground = true;
		this.animationData.semiTransparentBackgroundInit = new Date().getTime();
		this.animationData.semiTransparentBackgroundTime = 2000;
		this.animationData.semiTransparentBackgroundMaxOpacity = 0.8;
	}else{
		this.animationData.semiTransparentBackground = false;
	}

	this.dragData.hoverPlanet = -1;
	this.dragData.hoverOrbit = -1;
	this.unbindEvents();
	this.requestStaticFrameFunction();
};

SolarSystem.prototype.endFollowPlanet = function() {
	this.bindEvents();
	this.animationData.followingPlanet = false;
	this.animationData.scroll = 0;
	this.requestStaticFrameFunction();
};

SolarSystem.prototype.followPlanet = function() {
	var planet = this.animationData.followingPlanet;
	var rang;
	this.zoom = this.animationData.followingPlanetZoom;
	this.canvasTrasnform[0] = this.zoom;
	this.canvasTrasnform[3] = this.zoom;
	this.canvasTrasnform[4] = this.desplacedX = -this.nodes[planet].x * this.zoom + this.animationData.followingPlanetDesX;
	this.canvasTrasnform[5] = this.desplacedY = -this.nodes[planet].y * this.zoom + this.animationData.followingPlanetDesY - this.animationData.scroll;

	if(this.animationData.semiTransparentBackground === true){
		if(this.animationData.semiTransparentBackgroundInit + this.animationData.semiTransparentBackgroundTime > new Date().getTime()){ 
			rang = Utils.transformRang(
				this.animationData.semiTransparentBackgroundInit,
				this.animationData.semiTransparentBackgroundInit + this.animationData.semiTransparentBackgroundTime,
				new Date().getTime() - this.animationData.semiTransparentBackgroundInit,
				0,
				this.animationData.semiTransparentBackgroundMaxOpacity
			);
			this.reDraw1x1background(rang);
		}else{
			this.reDraw1x1background(this.animationData.semiTransparentBackgroundMaxOpacity);
			this.animationData.semiTransparentBackground = false;
		}
	}

	this.requestStaticFrameFunction();
};

SolarSystem.prototype.setPlanetFollowScroll = function(pixels) {
	this.animationData.scroll = pixels;
};

SolarSystem.prototype.reDraw1x1background = function(opacity) {
	var tempCtx = this.semiTransparentBackground.getContext("2d");
	tempCtx.clearRect(0,0,1,1);
	tempCtx.fillStyle = "#000";
	tempCtx.globalAlpha = opacity;
	tempCtx.fillRect(0,0,1,1);
};

SolarSystem.prototype.startAutoZoom = function(node, initialZoom, finalZoom, duration, desX, desY, initialAlpha, finalAlpha, funct, functMode, finishFunction, followPlanet, semiTransparentBackground) {
	if(this.animationData.planetOnZoomIndex !== false) this.endAutoZoom(false);
	this.unbindEvents();
	this.requestStaticFrameFunction();
	if(initialZoom === null) initialZoom = this.zoom;

	this.animationData.planetOnZoomIndex = (Utils.isObject(node)) ? null : node;
	this.animationData.planetOnZoom = node;
	this.animationData.initAutoZoomData.initialZoom = initialZoom;
	this.animationData.initAutoZoomData.finalZoom = finalZoom;
	this.animationData.initAutoZoomData.x = this.canvasTrasnform[4];
	this.animationData.initAutoZoomData.y = this.canvasTrasnform[5];
	this.animationData.initAutoZoomData.time = new Date().getTime();
	this.animationData.initAutoZoomData.duration = duration;
	this.animationData.initAutoZoomData.desX = desX;
	this.animationData.initAutoZoomData.desY = desY;
	this.animationData.initAutoZoomData.finishFunction = finishFunction;
	this.animationData.initAutoZoomData.followPlanet = (typeof followPlanet !== "undefined") ? followPlanet : false;
	this.animationData.initAutoZoomData.semiTransparentBackground = (typeof semiTransparentBackground !== "undefined") ? semiTransparentBackground : false;

	if(this.animationData.initAutoZoomData.semiTransparentBackground){
		this.animationData.initAutoZoomData.semiTransparentBackgroundMaxOpacity = 0.65;
	}

	this.animationData.initAutoZoomData.initialAlpha = initialAlpha;
	this.animationData.initAutoZoomData.finalAlpha = finalAlpha;
	this.animationData.initAutoZoomData.funct = funct;
	this.animationData.initAutoZoomData.functMode = functMode;

};

SolarSystem.prototype.endAutoZoom = function(bind) {
	if(bind) this.bindEvents();
	this.animationData.planetOnZoomIndex = false;
	if(this.animationData.initAutoZoomData.finishFunction)
		this.animationData.initAutoZoomData.finishFunction();
};

SolarSystem.prototype.autoZoom = function() {
	var finalZoom, initialZoom, animationTimeZoomEnd, date, zoom, animationCenter, globalAlpha, backgroundOpacity;
	date = new Date().getTime() - this.animationData.initAutoZoomData.time;
	finalZoom = this.animationData.initAutoZoomData.finalZoom;

	animationTimeZoomEnd = this.animationData.initAutoZoomData.duration;

	if(this.animationData.planetOnZoom === null) animationCenter = {x: 0, y: 0};
	else if(!Utils.isObject(this.animationData.planetOnZoom)) animationCenter = {x: this.nodes[this.animationData.planetOnZoom].x, y: this.nodes[this.animationData.planetOnZoom].y};

	if(date < animationTimeZoomEnd){

		initialZoom = this.animationData.initAutoZoomData.initialZoom;

		zoom = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, initialZoom, finalZoom, this.animationData.initAutoZoomData.functMode);
		this.globalAlpha = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.initialAlpha, this.animationData.initAutoZoomData.finalAlpha, this.animationData.initAutoZoomData.functMode);

		this.globalAlpha = (this.globalAlpha > 1) ? 1 : (this.globalAlpha < 0) ? 0 : this.globalAlpha;
		
		this.canvasTrasnform[0] = this.zoom = zoom;
		this.canvasTrasnform[3] = this.zoom;
		this.canvasTrasnform[4] = this.desplacedX = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.x, -animationCenter.x * finalZoom + this.animationData.initAutoZoomData.desX, this.animationData.initAutoZoomData.functMode);
		this.canvasTrasnform[5] = this.desplacedY = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.y, -animationCenter.y * finalZoom + this.animationData.initAutoZoomData.desY, this.animationData.initAutoZoomData.functMode);

		if(this.animationData.initAutoZoomData.semiTransparentBackground){
			backgroundOpacity = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, 0, this.animationData.initAutoZoomData.semiTransparentBackgroundMaxOpacity, this.animationData.initAutoZoomData.functMode);
			this.reDraw1x1background(backgroundOpacity);
		}
		if(this.showUserInfo) this.generateNamesCanvasCache();
	}else{
		this.globalAlpha = this.animationData.initAutoZoomData.finalAlpha;
		this.globalAlpha = (this.globalAlpha > 1) ? 1 : (this.globalAlpha < 0) ? 0 : this.globalAlpha;
		this.canvasTrasnform[0] = this.zoom = finalZoom;
		this.canvasTrasnform[3] = this.zoom;
		this.canvasTrasnform[4] = this.desplacedX = -animationCenter.x * finalZoom + this.animationData.initAutoZoomData.desX;
		this.canvasTrasnform[5] = this.desplacedY = -animationCenter.y * finalZoom + this.animationData.initAutoZoomData.desY;

		if(this.animationData.initAutoZoomData.followPlanet === true){
			this.startFollowPlanet(this.animationData.planetOnZoomIndex, finalZoom, this.animationData.initAutoZoomData.desX, this.animationData.initAutoZoomData.desY, false);
		}
		if(this.animationData.initAutoZoomData.semiTransparentBackground){
			this.reDraw1x1background(this.animationData.initAutoZoomData.semiTransparentBackgroundMaxOpacity);
		}
		this.endAutoZoom(false);
		if(this.showUserInfo) this.generateNamesCanvasCache();
	}

	this.requestStaticFrameFunction();
};

SolarSystem.prototype.moveTo = function(data1, data2, data3, data4) { //Usage (index, zoom, desX, desY) or (x, y, zoom, desX, desY)

	var x, y, zoom, desX, desY;

	if(arguments.length === 3){ //Si le pasamos un X e Y quiere decir que queremos poner el (0, 0) a X e Y respectivamente. Osea, modificamos el desplacedX y desplacedY
		zoom = data3;

		this.canvasTrasnform[4] = this.desplacedX = -this.centerX * zoom + data1;
		this.canvasTrasnform[5] = this.desplacedY = -this.centerY * zoom + data2;
	}else if(arguments.length === 4){ //Si le pasamos un index y un desX y desY quiere decir que queremos que nodes[index] esté en desX y desY
		zoom = data2;
		desX = data3;
		desY = data4;
		x = this.nodes[data1].x * zoom;
		y = this.nodes[data1].y * zoom;

		this.canvasTrasnform[4] = this.desplacedX = -x + desX;
		this.canvasTrasnform[5] = this.desplacedY = -y + desY;
	}

	this.canvasTrasnform[0] = this.zoom = zoom;
	this.canvasTrasnform[3] = this.zoom;

	this.requestStaticFrameFunction();
	this.generateNamesCanvasCache();
};

SolarSystem.prototype.getPositionAndData = function(index) {
	if(index === null)
		return {x: this.centerX, y: this.centerY, zoom: this.zoom, desplacedX: this.desplacedX, desplacedY: this.desplacedY};
	else
		return {x: this.nodes[index].x, y: this.nodes[index].y, zoom: this.zoom, desplacedX: this.desplacedX, desplacedY: this.desplacedY};
};

SolarSystem.prototype.checkHoverAndSetPointer = function(e) {
	Utils.getPointerCoordinates(e);
	var temp = this.isPlanet(Utils.mouseLocation.x, Utils.mouseLocation.y);

	if(temp !== false && Utils.actualStateCursorBlocked !== true){
		if(Utils.actualStateCursorBlocked !== true && Utils.actualStateCursor != Utils.enums.cursors.POINTER) {
			Utils.actualStateCursor = Utils.enums.cursors.POINTER;
			this.dCanvasD.style.cursor = "pointer";
		}
		if(this.dragData.hoverPlanet != temp){
			this.dragData.hoverPlanet = temp;
			this.dragData.hoverOrbit = -1;
			this.requestStaticFrameFunction();
		}
	}else{
		temp = this.isOrbit(Utils.mouseLocation.x, Utils.mouseLocation.y); //Miramos si toca una orbita. Suponemos orbitas redondas.
		if(temp !== false && Utils.actualStateCursorBlocked !== true){
			if(Utils.actualStateCursorBlocked !== true && Utils.actualStateCursor != Utils.enums.cursors.POINTER) {
				Utils.actualStateCursor = Utils.enums.cursors.POINTER;
				this.dCanvasD.style.cursor = "pointer";
			}
			if(this.dragData.hoverOrbit != temp){
				this.dragData.hoverOrbit = temp;
				this.requestStaticFrameFunction();
			}
			if(this.dragData.hoverPlanet !== -1){
				this.dragData.hoverPlanet = -1;
				this.requestStaticFrameFunction();
			}
		}else{
			if(Utils.actualStateCursorBlocked !== true && Utils.actualStateCursor != Utils.enums.cursors.NORMAL) {
				Utils.actualStateCursor = Utils.enums.cursors.NORMAL;
				this.dCanvasD.style.cursor = "";
			}
			if(this.dragData.hoverPlanet !== -1){
				this.dragData.hoverPlanet = -1;
				this.requestStaticFrameFunction();
			}
			if(this.dragData.hoverOrbit !== -1){
				this.dragData.hoverOrbit = -1;
				this.requestStaticFrameFunction();
			}
		}
	}
};

SolarSystem.prototype.isPlanet = function(mouseX, mouseY) {
	var planet, i;
	for (i = this.nodes.length - 1; i >= 0; i--) {
		planet = this.nodes[i];
		if(Math.abs(planet.x * this.zoom + this.desplacedX - mouseX) <= planet.s/1.5 * this.zoom && Math.abs(planet.y * this.zoom + this.desplacedY - mouseY) <= planet.s/1.5 * this.zoom){
			return i;
		}
	}
	return false;
};

SolarSystem.prototype.isOrbit = function(mouseX, mouseY) {
	var planet, centerX, centerY;
	for (var i = this.nodes.length - 1; i >= 0; i--) {
		planet = this.nodes[i];
		centerX = this.desplacedX;
		centerY = this.desplacedY;
		if( Math.abs(Math.sqrt( (centerX - mouseX)*(centerX - mouseX) + (centerY - mouseY)*(centerY - mouseY) ) - planet.w/2 * this.zoom) < 10 ){
			return i;
		}
	}
	return false;
};

SolarSystem.prototype.mapClick = function(x, y) {
	var cumulus = this.isPlanet(x, y);
	if(cumulus !== false){
		//Ahora toca llamar a quien dedice que se hace cuando se hace click en un cúmulo.
		this.handler.call(this.handlerContext, Utils.enums.systemActions.nodeClick, cumulus);
	}else{
		this.handler.call(this.handlerContext, Utils.enums.systemActions.voidClick, cumulus);
	}
	this.requestStaticFrameFunction();
};

SolarSystem.prototype.selectPlanet = function(cumulus) {
	this.dragData.selectedPlanet = cumulus;
};

SolarSystem.prototype.unselectPlanet = function() {
	this.dragData.selectedPlanet = -1;
};

SolarSystem.prototype.generateNamesCanvasCache2 = function() {
	var ctx, len, user, height, radius;
	var angle = Math.PI/3;
	var maxHeight = 75;
	for (var i = this.nodes.length - 1; i >= 0; i--) {
		user = this.nodes[i];
		radius = ((user.s / 2) * this.zoom);
		height = Math.floor(Math.sin(angle) * radius);

		if(height > 0 && (height < maxHeight || typeof this.userNamesCanvasCache.images[i] === "undefined")){
			ctx = document.createElement("canvas").getContext("2d");
			this.userNamesCanvasCache.images[i] = ctx.canvas;

			if(height >= maxHeight) height = maxHeight;

			ctx.font = Math.round(height * 0.9 ) + "px sansation";
			ctx.canvas.width = Math.ceil(ctx.measureText(user.nm).width) + 5 + radius - Math.cos(angle) * radius + 5;
			ctx.canvas.height = height;
			ctx.font = Math.round(height * 0.9 ) + "px sansation";

			ctx.strokeStyle = "#444";
			ctx.lineWidth = 1;

			ctx.beginPath();
			ctx.moveTo(0, 0.5);
			ctx.lineTo(ctx.canvas.width - 5,  0.5);
			ctx.lineTo(ctx.canvas.width - 0.5, 5);
			ctx.lineTo(ctx.canvas.width - 0.5,  ctx.canvas.height - 0.5);
			ctx.lineTo(radius - Math.cos(angle) * radius,  ctx.canvas.height- 0.5);
			ctx.stroke();
			ctx.lineTo(radius - Math.cos(angle) * radius - (1 - Math.cos(angle / 2)) * radius,  Math.sin(angle / 2) * radius);

			ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
			ctx.fill();

			ctx.lineWidth = 2;
			ctx.strokeStyle = "#aaa";
			ctx.fillStyle = "#eee";

			ctx.beginPath();
			ctx.arc(- Math.cos(angle) * radius, height, radius, 0, 0.25*Math.PI, true);
			ctx.stroke();
			ctx.fillText(user.nm, radius - Math.cos(angle) * radius + 5, height -  Math.round(height * 0.1));


		}else if(height >= maxHeight){
			this.userNamesCanvasCache.images[i] = this.userNamesCanvasCache.images[i];
		}else if(height >= 0){
			this.userNamesCanvasCache.images[i] = false;
		}
	}

	this.userNamesCanvasCache.ready = true;
};

SolarSystem.prototype.generateNamesCanvasCache = function() {

	var planet, ctx, cumulusRadius, cosSize, sinSize, pathAngle, finalAngle;

	var initialFontSize = 16;

	var initAngle = Math.PI / 3;
	var fontSize = initialFontSize;
	var fontTop = 5;
	var height = fontSize + fontTop + 3;
	var procentFontSize = initialFontSize / height;
	var procentFontTop = fontTop / height;
	for (var i = this.nodes.length - 1; i >= 0; i--) {
		planet = this.nodes[i];
		cumulusRadius = (planet.s / 2) * this.zoom;
		sinSize = cumulusRadius * Math.sin(initAngle);
		if(height >= sinSize * 2){
			height = sinSize * 2;
			pathAngle = initAngle * 2;
			fontSize = Math.round(procentFontSize * height);
			fontTop = Math.round(procentFontTop * height);
		}else{
			if(height < sinSize){
				pathAngle = initAngle - Math.asin((sinSize - height) / cumulusRadius);
			}else{
				pathAngle = initAngle + Math.asin((height - sinSize) / cumulusRadius);
			}
		}

		finalAngle = -initAngle + pathAngle;

		ctx = document.createElement("canvas").getContext("2d");
		ctx.canvas.height = height;

		ctx.font = Math.round(fontSize) + "px sansation";
		ctx.canvas.width = Math.ceil(ctx.measureText(planet.nm).width) + 10 + height;
		ctx.font = Math.round(fontSize) + "px sansation";

		if(height < 5){
			this.userNamesCanvasCache.images[i] = false;
			continue;
		}else{
			this.userNamesCanvasCache.images[i] = ctx.canvas;
		}

		//ctx.lineWidth = 1;
		ctx.strokeStyle = "#aaa";
		ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
		//ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		ctx.beginPath();
		ctx.moveTo(0, 0.5);
		ctx.lineTo(ctx.canvas.width - 5,  0.5);
		ctx.lineTo(ctx.canvas.width - 0.5, 5);
		ctx.lineTo(ctx.canvas.width - 0.5,  height - 0.5);
		ctx.lineTo(Math.cos(finalAngle) * cumulusRadius - Math.cos(initAngle) * cumulusRadius,  height - 0.5);
		//ctx.stroke();
		//ctx.lineTo(cumulusRadius - Math.cos(angle) * radius - (1 - Math.cos(angle / 2)) * radius,  Math.sin(angle / 2) * radius);
		ctx.fill();

		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(-Math.cos(initAngle) * cumulusRadius, cumulusRadius * Math.sin(initAngle), cumulusRadius, -initAngle, finalAngle, false);
		ctx.stroke();

		ctx.fillStyle = "#eee";
		ctx.textBaseline="top";
		ctx.fillText(planet.nm, height + 5, fontTop);

	}

	this.userNamesCanvasCache.ready = true;
};