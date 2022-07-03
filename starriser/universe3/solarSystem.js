"use strict";
var SolarSystem = function (sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) {
	this.init(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler);
};

SolarSystem.prototype.init = function(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) { //Initialize variables. Wait for draw calls or what-is-there calls

	var self = this;

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

	this.zoom = 1;
	this.globalAlpha = 1;
	this.desplacedX = 0;
	this.desplacedY = 0;
	this.sunRotation = 0;
	this.centerX = 0;
	this.centerY = 0;

	this.dragData = {};
	this.dragData.hoverPlanet = -1;
	this.dragData.hoverOrbit = -1;
	this.dragData.selectedPlanet = -1;

	this.animationData = {
		imagesLoaded: {
			planetMask: false,
			planets: false,
			sun1: false,
			sun2: false,
			sun3: false
		}
	};

	this.animationData.followingPlanetZoom = 0;
	this.animationData.followingPlanetDesX = 0;
	this.animationData.followingPlanetDesY = 0;

	this.animationData.followingPlanet = false;
	this.animationData.planetOnZoom = false;
	this.animationData.initAutoZoomData = {};
	this.animationData.initAutoZoomData.initialZoom = 0;
	this.animationData.initAutoZoomData.finalZoom = 0;
	this.animationData.initAutoZoomData.x = 0;
	this.animationData.initAutoZoomData.y = 0;
	this.animationData.initAutoZoomData.time = 0;
	this.animationData.initAutoZoomData.duration = 0;
	this.animationData.initAutoZoomData.initialAlpha = 1;
	this.animationData.initAutoZoomData.finalAlpha = 1;
	this.animationData.scroll = 0;

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

	this.cumulusSize = 0;

	this.semiTransparentBackground = document.createElement("canvas");
	this.semiTransparentBackground.width = 1;
	this.semiTransparentBackground.height = 1;

};

SolarSystem.prototype.setData = function(data) {
	this.nodes = data.nodes;
	var i;

	//Adaptando datos
	for (i = this.nodes.length - 1; i >= 0; i--) {
		this.nodes[i].conn = [];
		this.nodes[i].x = 0;
		this.nodes[i].y = 0;
		this.nodes[i].planetPosition = this.nodes[i].ip;
		//this.nodes[i].r;
	}
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
	this.requestStaticFrameFunction();
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
};

SolarSystem.prototype.requestStaticFrameFunction = function() {
	this.handler.call(this.handlerContext, Utils.enums.systemActions.requestStaticFrameFunction);
};

SolarSystem.prototype.staticDraw = function() {

	this.sCanvasC.save();

	if(this.animationData.followingPlanet !== false){ //Estamos siguiendo un planeta, así que tendremos que repintar la parte statica cada frame.
		this.followPlanet(this.animationData.followingPlanet);
	}

	if(this.animationData.planetOnZoom !== false){
		this.autoZoom();
	}
	this.sCanvasC.globalAlpha = this.globalAlpha;
	this.sCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );

	this.drawSolarOrbits();


	this.sCanvasC.restore();
};

SolarSystem.prototype.dynamicDraw = function() {

	this.dCanvasC.save();

	this.sCanvasC.globalAlpha = this.globalAlpha;
	this.dCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );
	if(this.loads.planets) this.drawSolarPlanets();
	if(this.loads.suns) this.drawSun();

	this.dCanvasC.restore();
};

SolarSystem.prototype.drawSolarPlanets = function() {
	var i;
	var ctx = this.dCanvasC;

	ctx.save();
	ctx.fillStyle = "#fff";

	for (i = this.nodes.length - 1; i >= 0; i--) {

		if(i !== this.animationData.followingPlanet && i !== this.animationData.planetOnZoom){
			//Pintamos el planeta con la posición que calculamos la última vez. Esto es por la función de seguir con la cámara un planeta que se hace antes de esto y luego el planeta se pintaba en otro sitio*/
			this.drawPlanet(i, ctx);
			/*Ahora calculamos la proxima posición*/
			this.calculatePlanetNextPosition(i);
		}
	}

	if(this.animationData.followingPlanet !== false || this.animationData.planetOnZoom !== null && this.animationData.planetOnZoom !== false){
		var planet = (this.animationData.followingPlanet) ? this.animationData.followingPlanet : this.animationData.planetOnZoom;
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
	
	if( ResourcesImg.g().isLoaded(this.images.finishedPlanets) ){
		ctx.save();
		ctx.translate(this.nodes[i].x, this.nodes[i].y);
		ctx.rotate(this.nodes[i].planetPosition * this.nodes[i].ro - 1.05);
		ctx.translate(-this.nodes[i].x, -this.nodes[i].y);
		ctx.drawImage( ResourcesImg.g().get(this.images.finishedPlanets), positionI * 200, positionJ * 200, 200, 200, this.nodes[i].x - this.nodes[i].s/2, this.nodes[i].y - this.nodes[i].s/2, this.nodes[i].s, this.nodes[i].s);
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

	var planet = Math.max(this.dragData.hoverPlanet, this.dragData.hoverOrbit);
	if(planet == i){
		ctx.strokeStyle = "#555";
		ctx.lineWidth =  2 / this.zoom;
		ctx.beginPath();
		ctx.arc(this.nodes[i].x, this.nodes[i].y, this.nodes[i].s/2, 0, Math.PI*2, false);
		//Sustituit por panel de mensaje de planeta con sus datos.
		ctx.stroke();
	}

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
	this.unbindEvents();
	this.requestStaticFrameFunction();

	if(initialZoom === null) initialZoom = this.zoom;

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
	this.animationData.planetOnZoom = false;
	if(this.animationData.initAutoZoomData.finishFunction)
		this.animationData.initAutoZoomData.finishFunction();
};

SolarSystem.prototype.autoZoom = function() {
	var finalZoom, initialZoom, animationTimeZoomEnd, date, zoom, animationCenter, globalAlpha, backgroundOpacity;
	date = new Date().getTime() - this.animationData.initAutoZoomData.time;
	finalZoom = this.animationData.initAutoZoomData.finalZoom;

	animationTimeZoomEnd = this.animationData.initAutoZoomData.duration;

	if(this.animationData.planetOnZoom === null) animationCenter = {x: 0, y: 0};
	else animationCenter = {x: this.nodes[this.animationData.planetOnZoom].x, y: this.nodes[this.animationData.planetOnZoom].y};

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

	}else{
		this.globalAlpha = this.animationData.initAutoZoomData.finalAlpha;
		this.globalAlpha = (this.globalAlpha > 1) ? 1 : (this.globalAlpha < 0) ? 0 : this.globalAlpha;
		this.canvasTrasnform[0] = this.zoom = finalZoom;
		this.canvasTrasnform[3] = this.zoom;
		this.canvasTrasnform[4] = this.desplacedX = -animationCenter.x * finalZoom + this.animationData.initAutoZoomData.desX;
		this.canvasTrasnform[5] = this.desplacedY = -animationCenter.y * finalZoom + this.animationData.initAutoZoomData.desY;

		if(this.animationData.initAutoZoomData.followPlanet === true){
			this.startFollowPlanet(this.animationData.planetOnZoom, finalZoom, this.animationData.initAutoZoomData.desX, this.animationData.initAutoZoomData.desY, false);
		}
		if(this.animationData.initAutoZoomData.semiTransparentBackground){
			this.reDraw1x1background(this.animationData.initAutoZoomData.semiTransparentBackgroundMaxOpacity);
		}
		this.endAutoZoom(false);
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

	if(temp !== false && Utils.actualStateCursorBlockedByInterface !== true){
		if(Utils.actualStateCursorBlockedByInterface !== true && Utils.actualStateCursor != Utils.enums.cursors.POINTER) {
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
		if(temp !== false && Utils.actualStateCursorBlockedByInterface !== true){
			if(Utils.actualStateCursorBlockedByInterface !== true && Utils.actualStateCursor != Utils.enums.cursors.POINTER) {
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
			if(Utils.actualStateCursorBlockedByInterface !== true && Utils.actualStateCursor != Utils.enums.cursors.NORMAL) {
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