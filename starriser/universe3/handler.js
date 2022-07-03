"use strict";
var Handler = function () {
	this.init();
};

Handler.prototype.init = function() {//Create variables. Create initial HTML. Bind basic events. Show loading. Get required data. Instance Objects. Init main loop. 
	//Create variables

	window.is_unselect_allowed = true;

	var self = this;
	this.dom = {};
	this.data = {};

	this.eventHandler = new EventHandler();

	//Set mode variables
	this.mode = {};
	this.mode.zoneWorkMode = Utils.enums.zoneWorkMode.SYSTEM;
	this.mode.zoomMode = {
		from: false,
		to: false
	};

	this.requestStaticFrame = false;
	this.requestStaticFramePetition = false;
	this.canvasStoped = false;

	this.galaxyData = {};
	this.galaxyData.nodeSelected = -1;

	this.cumulusData = {};
	this.cumulusData.nodeSelected = -1;

	this.systemData = {};
	this.systemData.nodeSelected = -1;

	this.planetData = {};
	this.planetData.nodeSelected = -1;

	this.positionBackground = [0, 0];

	this.zoomAnimationData = {};
	this.zoomAnimationData.from = 0;
	this.zoomAnimationData.to = 0;
	this.zoomAnimationData.time = 0;
	this.zoomAnimationData.duration = 0;

	//Load Images
	this.images = {};

	var ntimesP = new NtimeEvent(2, function () {
		self.generatePlanetIcons();
	});

	var ntimesG = new NtimeEvent(2, function () {
		self.generateGalaxy();
	});

	ResourcesImg.g().load('content/img/CTSprite.png');
	this.images.planets = ResourcesImg.g().load('content/img/planetas.jpg', ntimesP);
	this.images.planetMask = ResourcesImg.g().load('content/img/planetMask.png', ntimesP);
	ResourcesImg.g().load('content/img/sun1.png');
	ResourcesImg.g().load('content/img/sun2.png');
	ResourcesImg.g().load('content/img/sun3.png');
	this.images.galaxy = ResourcesImg.g().load('content/img/galaxia.jpg', ntimesG);
	this.images.galaxyMask = ResourcesImg.g().load('content/img/galaxiaMask.png', ntimesG);

	//Insert Dom to document
	this.insertDom();

	//Show Loading. TODO

	//Get required data. TODO
	this.loadInitialData();

	//Instance Objects
	this.instanceObjects();

	//Set canvas size
	this.setCanvasSize();
	$(window).bind("resize.galaxy", function () {
		self.updateCanvasSize();
	});

	this.loopFunction = (
		function(self){
			return function(){
				self.mainLoop();
			};
		}
	)(this);

	//Init main loop
	this.loopFunction();


};

Handler.prototype.loadInitialData = function() {

	//Get data of the user planet.

	this.data.CumulusInGalaxyData  = CumulusInGalaxyData;
	this.data.SystemsInCumulusData = SystemsInCumulusData;
	this.data.planetsInCumulusData = planetsInCumulusData;

	//Temporary global. In the future php will put here the data.

	//TODO: Load in background galaxy and cumulus data

};

Handler.prototype.insertDom = function() {
	this.dom.body = document.getElementById("body");

	//Create variables and initial HTML (two canvas element) and isert on dom
	this.dom.sCanvas = document.createElement("canvas"); //Canvas for event-draw static content
	this.dom.dCanvas = document.createElement("canvas"); //Canvas for frame-draw animated content
	this.dom.background = document.createElement("div"); //Canvas for frame-draw animated content

	this.dom.sCanvas.className = "sCanvas";
	this.dom.dCanvas.className = "dCanvas";
	this.dom.background.className = "canvasBackground";
	this.dom.background.style.backgroundPosition = "0px 0px";

	this.sCanvas = this.dom.sCanvas.getContext('2d');
	this.dCanvas = this.dom.dCanvas.getContext('2d');

	this.dom.body.appendChild(this.dom.background);
	this.dom.body.appendChild(this.dom.sCanvas);
	this.dom.body.appendChild(this.dom.dCanvas);
};

Handler.prototype.instanceObjects = function() {
	var self = this;

	//Instance Objects. TODO
	this.obj = {};
	this.obj.galaxy = new Galaxy(this.dom.sCanvas, this.dom.dCanvas, this.sCanvas, this.dCanvas, this.galaxyAction, this, this.eventHandler);
	this.obj.galaxy.setData(this.data.CumulusInGalaxyData);
	this.obj.cumulus = new Cumulus(this.dom.sCanvas, this.dom.dCanvas, this.sCanvas, this.dCanvas, this.cumulusAction, this, this.eventHandler);
	this.obj.cumulus.setData(this.data.SystemsInCumulusData);
	this.obj.system = new SolarSystem(this.dom.sCanvas, this.dom.dCanvas, this.sCanvas, this.dCanvas, this.systemAction, this, this.eventHandler);
	this.obj.system.setData(this.data.planetsInCumulusData);

	this.obj.interface = new Interface(Utils.enums.zoneWorkMode.SYSTEM, this.interfaceAction, this, this.eventHandler);

	if(this.mode.zoneWorkMode == Utils.enums.zoneWorkMode.GALAXY){
		this.obj.galaxy.bindEvents();
	}else if(this.mode.zoneWorkMode == Utils.enums.zoneWorkMode.CUMULUS){
		this.obj.cumulus.bindEvents();
	}else if(this.mode.zoneWorkMode == Utils.enums.zoneWorkMode.SYSTEM){
		this.obj.system.bindEvents();
	}
};

Handler.prototype.setCanvasSize = function() {
	var size = Utils.getWindowSize(document.getElementById("body"));

	this.data.canvasWidth  = this.dom.dCanvas.width  = this.dom.sCanvas.width  = size.x;
	this.data.canvasHeight = this.dom.dCanvas.height = this.dom.sCanvas.height = size.y;

	this.obj.galaxy.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.cumulus.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.system.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);

	this.draw(true, true);
};

Handler.prototype.updateCanvasSize = function() {
	var size = Utils.getWindowSize(document.getElementById("body"));

	this.data.canvasWidth  = this.dom.dCanvas.width  = this.dom.sCanvas.width  = size.x;
	this.data.canvasHeight = this.dom.dCanvas.height = this.dom.sCanvas.height = size.y;

	this.obj.galaxy.updateCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.cumulus.updateCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.system.updateCanvasSize(this.data.canvasWidth, this.data.canvasHeight);

	this.draw(true, true);
};

Handler.prototype.requestStaticFrameFunction = function(special) {
	this.requestStaticFramePetition = true;
};

Handler.prototype.mainLoop = function() {

	this.draw(false);

	if(this.requestStaticFramePetition === false)
		this.requestStaticFrame = false;
	else{
		this.requestStaticFrame = true;
		this.requestStaticFramePetition = false;
	}

	window.requestAnimationFrame(this.loopFunction);
};

Handler.prototype.galaxyAction = function(type, data) {
	if(type === Utils.enums.galaxyActions.requestStaticFrameFunction){
		this.requestStaticFrameFunction();
	}else if(type === Utils.enums.galaxyActions.nodeClick){
		if(this.galaxyData.nodeSelected !== -1){
			this.obj.galaxy.findPath(this.galaxyData.nodeSelected, data, []);
		}else{
			this.obj.galaxy.selectCumulus(data);
			this.galaxyData.nodeSelected = data;
		}
	}else if(type === Utils.enums.galaxyActions.voidClick){
		this.galaxyData.nodeSelected = -1;
		this.obj.galaxy.unselectCumulus();
	}else if(type === Utils.enums.galaxyActions.parallaxScrolling){
		this.parallaxScrolling(data.x, data.y);
	}
};

Handler.prototype.cumulusAction = function(type, data) {
	if(type === Utils.enums.cumulusActions.requestStaticFrameFunction){
		this.requestStaticFrameFunction();
	}else if(type === Utils.enums.cumulusActions.nodeClick){
		if(this.cumulusData.nodeSelected !== -1){
			this.obj.cumulus.findPath(this.cumulusData.nodeSelected, data, []);
		}else{
			this.obj.cumulus.selectCumulus(data);
			this.cumulusData.nodeSelected = data;
		}
	}else if(type === Utils.enums.cumulusActions.voidClick){
		this.cumulusData.nodeSelected = -1;
		this.obj.cumulus.unselectCumulus();
	}else if(type === Utils.enums.cumulusActions.parallaxScrolling){
		this.parallaxScrolling(data.x, data.y);
	}
};

Handler.prototype.systemAction = function(type, data) {
	if(type === Utils.enums.systemActions.requestStaticFrameFunction){
		this.requestStaticFrameFunction();
	}else if(type === Utils.enums.systemActions.nodeClick){
		/*this.systemData.nodeSelected = data;
		this.mode.zoneWorkMode = Utils.enums.zoneWorkMode.ZOOM;
		this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;
		this.obj.system.unbindEvents();
		this.obj.system.startAutoZoom(data, null, 0.085, 400, this.data.canvasWidth/2, 300, 1, 1, Utils.transformRangEaseInOut, "sixt", true);*/
	}else if(type === Utils.enums.systemActions.voidClick){
		this.systemData.nodeSelected = -1;
		this.obj.system.unselectPlanet();
	}else if(type === Utils.enums.systemActions.parallaxScrolling){
		this.parallaxScrolling(data.x, data.y);
	}
};

Handler.prototype.interfaceAction = function(type, data, funct) {
	if(type === Utils.enums.interfaceActions.zoom){
		if(this.mode.zoneWorkMode !== Utils.enums.zoneWorkMode.ZOOM) this.interfaceActionZoom(data, funct);
	}else if(type === Utils.enums.interfaceActions.getState){
		return this.mode.zoneWorkMode;
	}else if( type === Utils.enums.interfaceActions.scrollPlanetInterface){
		this.obj.system.setPlanetFollowScroll(data);
	}else if(type === Utils.enums.interfaceActions.stopCanvasRefresh){
		this.stopCanvas();
	}else if(type === Utils.enums.interfaceActions.startCanvasRefresh){
		this.startCanvas();
	}
};

Handler.prototype.interfaceActionZoom = function(to, funct) {
	var from = this.mode.zoneWorkMode;
	if(from === to){//Ya estamos, así que llamamos a la función que nos han pasado y finalizamos.
		if(funct) funct();
		return;
	}
	var fromNode, toNode;
	if(from < to){ //Zoom+ //Como he definido los enum yo se que un nivel superior de zoom es un valor menor.
		fromNode = (this.selectZoneData(from).nodeSelected !== -1) ? this.selectZoneData(from).nodeSelected : 1; //Hasta que se implemente la aprte de manterner un planeta seleccionado en todo los niveles de zoom
		toNode = null;
		if(to == Utils.enums.zoneWorkMode.PLANET) toNode = (this.selectZoneData(to).nodeSelected !== -1) ? this.selectZoneData(to).nodeSelected : 1;
	}else{
		fromNode = null;
		toNode = (this.selectZoneData(to).nodeSelected !== -1) ? this.selectZoneData(to).nodeSelected : 1; //Hasta que se implemente la parte de manterner un planeta seleccionado en todo los niveles de zoom
	}

	this.initModeChange(from, to, fromNode, toNode, 800, funct);


};

Handler.prototype.initModeChange = function(from, to, fromNode, toNode, duration, funct) {

	var self = this;
	var x, y, data;

	var InterfaceCenterDisplacement = 50;
	var ntimes = 2;

	var ntimesf = new NtimeEvent(2, function () {
		if(typeof funct !== "undefined") funct();
		self.endModeChange(to);
	});
	var functToNtimes = function () {
		ntimesf.handler.call(ntimesf.context);
	};

	this.mode.zoneWorkMode = Utils.enums.zoneWorkMode.ZOOM;
	this.zoomAnimationData.time = new Date().getTime();
	this.zoomAnimationData.duration = duration;

	this.selectDrawCall(from).unbindEvents();
	this.selectDrawCall(to).unbindEvents();

	if(from === Utils.enums.zoneWorkMode.GALAXY){
		data = this.obj.galaxy.getPositionAndData(fromNode);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;
		if(to === Utils.enums.zoneWorkMode.CUMULUS){
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			this.obj.cumulus.moveTo(x, y, 0.000001);
			this.obj.cumulus.startAutoZoom(null, null, 0.1, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 1, Utils.transformRangEaseIn, "sixt", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			this.obj.system.moveTo(x, y, 0.000001);
			this.obj.system.startAutoZoom(null, null, 0.01, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseIn, "sixt", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;
		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration/3, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			this.obj.system.moveTo(x, y, 0.000001);
			this.obj.system.startAutoZoom(toNode, null, 0.085, duration, this.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseIn, "sixt", functToNtimes, true, true);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;
		}
	}else if(from === Utils.enums.zoneWorkMode.CUMULUS){
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			data = this.obj.cumulus.getPositionAndData(null);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;

			this.obj.cumulus.startAutoZoom(null, null, 0.0001, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "sixt", functToNtimes);

			this.obj.galaxy.moveTo(toNode, 10, x, y);
			this.obj.galaxy.startAutoZoom(toNode, null, 0.09, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseOut, "sixt", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;

		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			data = this.obj.cumulus.getPositionAndData(fromNode);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;

			this.obj.cumulus.startAutoZoom(fromNode, null, 10, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, -1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.obj.system.moveTo(x, y, 0.000001);
			this.obj.system.startAutoZoom(toNode, null, 0.01, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;

		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			data = this.obj.cumulus.getPositionAndData(fromNode);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;

			this.obj.cumulus.startAutoZoom(fromNode, null, 10, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, -1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.obj.system.moveTo(x, y, 0.000001);
			this.obj.system.startAutoZoom(toNode, null, 0.085, duration, this.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes, true, true);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;

		}
	}else if(from === Utils.enums.zoneWorkMode.SYSTEM){
		data = this.obj.system.getPositionAndData(null);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			this.obj.system.startAutoZoom(null, null, 0, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.obj.galaxy.moveTo(toNode, 10, x, y);
			this.obj.galaxy.startAutoZoom(toNode, null, 0.1, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;
		}else if(to === Utils.enums.zoneWorkMode.CUMULUS){
			this.obj.system.startAutoZoom(null, null, 0.00001, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "sixt", functToNtimes);

			this.obj.cumulus.moveTo(toNode, 10, x, y);
			this.obj.cumulus.startAutoZoom(toNode, null, 0.1, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseOut, "sixt", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			this.obj.system.startAutoZoom(toNode, null, 0.085, duration, this.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes, true, true);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;

			ntimes = 1;
		}
	}else if(from === Utils.enums.zoneWorkMode.PLANET){
		data = this.obj.system.getPositionAndData(fromNode);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;

		this.obj.system.endFollowPlanet(false);
		
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			this.obj.system.startAutoZoom(null, null, 0, duration/3, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.obj.galaxy.moveTo(toNode, 85, x, y);
			this.obj.galaxy.startAutoZoom(toNode, null, 0.1, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;
		}else if(to === Utils.enums.zoneWorkMode.CUMULUS){
			this.zoomAnimationData.duration = duration = duration/1.5;
			this.obj.system.startAutoZoom(null, null, 0, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "third", functToNtimes);

			this.obj.cumulus.moveTo(toNode, 85, x, y);
			this.obj.cumulus.startAutoZoom(toNode, null, 0.1, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, -1, 1, Utils.transformRangEaseOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			this.zoomAnimationData.duration = duration = duration/2;
			this.obj.system.startAutoZoom(null, null, 0.01, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;

			ntimes = 1;
		}
	}

	ntimesf.context.changeTimesToFire(ntimes);

};

Handler.prototype.endModeChange = function(to) {
	this.requestStaticFrameFunction();
	this.mode.zoneWorkMode = this.mode.zoomMode.to;
	if(this.mode.zoneWorkMode !== Utils.enums.zoneWorkMode.PLANET) this.selectDrawCall(this.mode.zoneWorkMode).bindEvents();
};

Handler.prototype.parallaxScrolling = function(x, y) {
	this.positionBackground[0] += x/10;
	this.positionBackground[1] += y/10;

	this.dom.background.style.backgroundPosition = this.positionBackground[0] + "px " + this.positionBackground[1] + "px";
};

Handler.prototype.isInZoom = function() {
	return this.mode.zoneWorkMode === Utils.enums.zoneWorkMode.ZOOM;
};

Handler.prototype.stopCanvas = function() {
	this.canvasStoped = true;
};

Handler.prototype.startCanvas = function() {
	this.canvasStoped = false;
};

Handler.prototype.isStopedCanvas = function() {
	return this.canvasStoped;
};

Handler.prototype.isZoneStopable = function() {
	if(this.mode.zoneWorkMode === GALAXY || this.mode.zoneWorkMode === CUMULUS){
		return true;
	}else{
		return false;
	}
};

Handler.prototype.clearCanvas = function(canvas) {
	canvas.save();
	canvas.setTransform(1, 0, 0, 1, 0, 0);
	canvas.clearRect( 0 ,0 , this.data.canvasWidth , this.data.canvasHeight );
	canvas.restore();
};

Handler.prototype.draw = function(force) {

	if(this.canvasStoped === false){
		this.clearCanvas(this.dCanvas);

		if(this.mode.zoneWorkMode === Utils.enums.zoneWorkMode.ZOOM){
			this.clearCanvas(this.sCanvas);
			var to = this.selectDrawCall(this.mode.zoomMode.to);
			var from = this.selectDrawCall(this.mode.zoomMode.from);
			if(from !== to){
				to.staticDraw();
				to.dynamicDraw();
				from.staticDraw();
				from.dynamicDraw();
			}else{
				to.staticDraw();
				to.dynamicDraw();
			}
		}else{
			if(this.requestStaticFrame || force){
				this.clearCanvas(this.sCanvas);
				this.selectDrawCall(this.mode.zoneWorkMode).staticDraw();
			}
			this.selectDrawCall(this.mode.zoneWorkMode).dynamicDraw();
		}
	}

	this.obj.interface.draw();
};

Handler.prototype.selectDrawCall = function(type) {
	if(type === Utils.enums.zoneWorkMode.GALAXY){
		return this.obj.galaxy;
	}else if(type === Utils.enums.zoneWorkMode.CUMULUS){
		return this.obj.cumulus;
	}else if(type === Utils.enums.zoneWorkMode.SYSTEM){
		return this.obj.system;
	}else if(type === Utils.enums.zoneWorkMode.PLANET){
		return this.obj.system;
	}else
	return false;
};

Handler.prototype.selectZoneData = function(type) {
	if(type === Utils.enums.zoneWorkMode.GALAXY){
		return this.galaxyData;
	}else if(type === Utils.enums.zoneWorkMode.CUMULUS){
		return this.cumulusData;
	}else if(type === Utils.enums.zoneWorkMode.SYSTEM){
		return this.systemData;
	}else if(type === Utils.enums.zoneWorkMode.PLANET){
		return this.planetData;
	}else
	return false;
};

Handler.prototype.generatePlanetIcons = function() {

	var sizeX = 1000;
	var sizeY = 600;
	var i, j;


	var canvas = document.createElement("canvas");
	var ctx = canvas.getContext("2d");

	//Pintamos la máscara y el planeta con source-in

	canvas.width = sizeX;
	canvas.height = sizeY;

	for (i = 2; i >= 0; i--) {
		for (j = 4; j >= 0; j--) {
			ctx.drawImage( ResourcesImg.g().get(this.images.planetMask), 0, 0, 500, 500, 200 * j, 200 * i, 200, 200 );
		}
	}


	ctx.globalCompositeOperation = "source-in";

	ctx.drawImage(ResourcesImg.g().get(this.images.planets), 0, 0);

	ResourcesImg.g().add(canvas, "finishedPlanets");

};

Handler.prototype.generateGalaxy = function() {

	var sizeX = 1314;
	var sizeY = 1068;
	var i, j;


	var canvas = document.createElement("canvas");
	var ctx = canvas.getContext("2d");

	//Pintamos la máscara y la galaxya con source-in.

	canvas.width = sizeX;
	canvas.height = sizeY;


	ctx.drawImage( ResourcesImg.g().get(this.images.galaxyMask), 0, 0 );

	ctx.globalCompositeOperation = "source-in";

	ctx.drawImage( ResourcesImg.g().get(this.images.galaxy), 0, 0 );

	ResourcesImg.g().add(canvas, "finishedGalaxy");

};