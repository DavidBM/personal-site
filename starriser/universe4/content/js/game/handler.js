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

	var ntimesF = new NtimeEvent(3, function () {
		ResourcesImg.g().add("", "allFontsLoaded");
		self.setCanvasSize();
	});

	ResourcesImg.g().load('content/img/CTSprite.png');
	this.images.planets = ResourcesImg.g().load('content/img/planetas.jpg', ntimesP);
	this.images.planetMask = ResourcesImg.g().load('content/img/planetMask.png', ntimesP);
	ResourcesImg.g().load('content/img/sun1.png');
	ResourcesImg.g().load('content/img/sun2.png');
	ResourcesImg.g().load('content/img/sun3.png');
	ResourcesImg.g().load("content/img/sectors.png");
	this.images.galaxy = ResourcesImg.g().load('content/img/galaxia.jpg', ntimesG);
	this.images.galaxyMask = ResourcesImg.g().load('content/img/galaxiaMask.png', ntimesG);

	$(document).ready(function(){ 
		fontdetect.onFontLoaded('sansationbold', ntimesF.handler, false, {msTimeout: 10000});
		fontdetect.onFontLoaded('sansationlight', ntimesF.handler, false, {msTimeout: 10000});
		fontdetect.onFontLoaded('sansationregular', ntimesF.handler, false, {msTimeout: 10000});
	});

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

	this.obj.loading = new LoadingAnimation(200);
};

Handler.prototype.setCanvasSize = function() {
	var size = Utils.getWindowSize(document.getElementById("body"));

	this.data.canvasWidth  = this.dom.dCanvas.width  = this.dom.sCanvas.width  = size.x;
	this.data.canvasHeight = this.dom.dCanvas.height = this.dom.sCanvas.height = size.y;

	this.obj.galaxy.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.cumulus.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	this.obj.system.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);

	this.obj.loading.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);

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
		if(this.mode.zoneWorkMode !== Utils.enums.zoneWorkMode.ZOOM){
			if(this.mode.zoneWorkMode === data){//Ya estamos, así que llamamos a la función que nos han pasado y finalizamos.
				if(funct) funct();
				return;
			}
			//this.mapModeInitChange(data, 800, funct, false, false, true);
			this.executeAnimation([{
				type: "mapZoom",
				duration: 800,
				funct: funct,
				to: {
					level: data
				}
			}]);
		}
	}else if(type === Utils.enums.interfaceActions.getState){
		return this.mode.zoneWorkMode;
	}else if( type === Utils.enums.interfaceActions.scrollPlanetInterface){
		this.obj.system.setPlanetFollowScroll(data);
	}else if(type === Utils.enums.interfaceActions.stopCanvasRefresh){
		this.stopCanvas();
	}else if(type === Utils.enums.interfaceActions.startCanvasRefresh){
		this.startCanvas();
	}else if(type === 9999){
		var self = this;
		setTimeout(function () {
			self.data.ownPlanetSelected = data;
			//Miramos donde estamos y decidimos que animaciones de zoom tenemos que hacer
			self.executeAnimation([{
				type: "mapZoom",
				duration: 6000,
				to: {
					level: Utils.enums.zoneWorkMode.CUMULUS
				}
			},{
				type: "mapZoom",
				duration: 3000,
				to: {
					level: Utils.enums.zoneWorkMode.SYSTEM
				}
			}]);
		}, 5000);
	}
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
		this.obj.loading.draw(this.dCanvas);
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

/*
asdsahhre kmasdiomjnn dehoi ui "  " hdsappepa 

" ddsadjh,kkpokññkjdsad 

""" >>> > dfsdjfnkjn>>Z rtebbhdasdsaduiortebbb 2*2 hds9raantelemntet 

    $function() { "label", modificacion de la consulta del   formulariojjfs } 

dsfdgmg iejegeagfdijhj  idajij ij $function() { hola mundo }fdaflllll llddd

SOY PROGRAMADOR: http://www.youtube.com/watch?v=OgIRAjnnJzI
*/