"use strict";
var Handler = function () {
	this.init();
};

Handler.prototype.init = function() {//Create variables. Create initial HTML. Bind basic events. Show loading. Get required data. Instance Objects. Init main loop. 
	//Create variables
	var self = this;
	this.dom = {};
	this.data = {};

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

	this.eventHandler = new EventHandler();

	//Set mode variables
	this.mode = {};
	this.mode.zoneWorkMode = Utils.enums.zoneWorkMode.GALAXY;

	this.requestStaticFrame = false;

	this.galaxyData = {};
	this.galaxyData.cumulusSelected = -1;

	//Show Loading. TODO


	//Get required data. TODO
	this.loadInitialData();

	//Create events
	this.setCanvasSize();
	$(window).bind("resize.galaxy", function () {
		self.setCanvasSize();
	});
};

Handler.prototype.loadInitialData = function() {

	//Get data of the user planet.

	this.data.CumulusInGalaxyData = CumulusInGalaxyData;

	//Temporary global. In the future php will put here the data.

	//TODO: Load in background galaxy and cumulus data

	this.instanceObjects();
};

Handler.prototype.instanceObjects = function() {
	var self = this;

	//Instance Objects. TODO
	this.obj = {};
	this.obj.galaxy = new Galaxy(this.dom.sCanvas, this.dom.dCanvas, this.sCanvas, this.dCanvas, this.dom.background, this.galaxyAction, this, this.eventHandler);
	this.obj.galaxy.setData(this.data.CumulusInGalaxyData);
	this.obj.galaxy.bindEvents();

	//Init main loop
	this.mainLoop();
};

Handler.prototype.setCanvasSize = function() {
	var size = Utils.getWindowSize();
	this.data.canvasWidth  = this.dom.dCanvas.width  = this.dom.sCanvas.width  = size.x;
	this.data.canvasHeight = this.dom.dCanvas.height = this.dom.sCanvas.height = size.y;

	if(this.obj.galaxy){
		this.obj.galaxy.setCanvasSize(this.data.canvasWidth, this.data.canvasHeight);
	}

	this.draw(true, true);
};

Handler.prototype.requestStaticFrameFunction = function() {
	this.requestStaticFrame = true;
};

Handler.prototype.mainLoop = function() {
	var self = this;

	var clean = false;
	if(this.requestStaticFrame){
		clean = true;
	}

	this.draw(false, clean);

	this.requestStaticFrame = false;


	window.requestAnimationFrame(function () {
		self.mainLoop();
	});
};

Handler.prototype.galaxyAction = function(type, data) {
	if(type === Utils.enums.galaxyActions.requestStaticFrameFunction){
		this.requestStaticFrameFunction();
	}else if(type === Utils.enums.galaxyActions.cumulusClick){
		if(this.galaxyData.cumulusSelected !== -1){
			this.obj.galaxy.findPath(this.galaxyData.cumulusSelected, data, []);
		}else{
			this.obj.galaxy.selectCumulus(data);
			this.galaxyData.cumulusSelected = data;
		}
	}else if(type === Utils.enums.galaxyActions.voidClick){
		this.galaxyData.cumulusSelected = -1;
		this.obj.galaxy.unselectCumulus();
	}
};

Handler.prototype.draw = function(force, clean) {

	this.dCanvas.clearRect( 0 , 0 , this.data.canvasWidth , this.data.canvasHeight );

	if(clean) this.sCanvas.clearRect( 0 , 0 , this.data.canvasWidth , this.data.canvasHeight );

	if(this.mode.zoneWorkMode == Utils.enums.zoneWorkMode.GALAXY){
		this.obj.galaxy.draw(force);
	}




};
