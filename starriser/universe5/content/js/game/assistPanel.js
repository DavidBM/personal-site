"use strict";
var AssistPanel = function (handler, context) {
	this.init(handler, context);
};

AssistPanel.prototype.init = function(handler, context) {

	var i;
	this.ONLY_PLANET = true;
	this.data = {};
	this.data.zoomZone = -1;
	this.data.assistants = [];

	this.handler = handler;
	this.context = context;

	this.dom = {};

	this.dom.container = createElement("div");
	this.dom.container.className = "assistPanel container";

	var temp;
	if(this.ONLY_PLANET)
		temp = ["assistPanelButtonHome", "assistPanelButtonZoomSystem active"]
	else
		temp = ["assistPanelButtonPlanets", "assistPanelButtonHome", "assistPanelButtonZoomSystem active", "assistPanelButtonZoomCumulus", "assistPanelButtonZoomGalaxy"]

	this.dom.botones = new Array(5);
	for(i = 0; i < 5; i++){
		this.dom.container.addChild(document.createElement("div").setClass(temp[i]).saveIn(this.dom.botones, i));
	}

	createElement("canvas", "assistPanel planet").setVariable("width", 200).setVariable("height", 200).saveInObject(this.dom, "canvas")
	createElement("div", "assistPanel backgroundName").saveInObject(this.dom, "backgroundName");
	createElement("div", "assistPanel background").saveInObject(this.dom, "background")
			.addChild(createElement("div", "assistPanel assistant militar").saveInObject(this.data.assistants, 0))
			.addChild(createElement("div", "assistPanel assistant social").saveInObject(this.data.assistants, 1))
			.addChild(createElement("div", "assistPanel assistant diplomatic").saveInObject(this.data.assistants, 2))
			.addChild(createElement("div", "assistPanel assistant commercial").saveInObject(this.data.assistants, 3))
			.addChild(createElement("div", "assistPanel assistant tecnologic").saveInObject(this.data.assistants, 4));
		

	this.dom.container
		.addChild(this.dom.canvas)
		.addChild(this.dom.background)
		.addChild(this.dom.backgroundName);

	this.data.zoomZone = this.dom.botones[2];

	this.activePlanetCanvasCtx = this.dom.canvas.getContext("2d");

};

AssistPanel.prototype.bindEvents = function() {
	var self = this, buttonsActions;
	if(this.ONLY_PLANET)
		buttonsActions = [Utils.enums.zoomLevels.planet, Utils.enums.zoomLevels.system];
	else
		buttonsActions = ["", Utils.enums.zoomLevels.planet, Utils.enums.zoomLevels.system, Utils.enums.zoomLevels.cumulus, Utils.enums.zoomLevels.galaxy];

	var i;
	var assistantsActions = [Utils.enums.assistants.militar, Utils.enums.assistants.social, Utils.enums.assistants.diplomatic, Utils.enums.assistants.commercial, Utils.enums.assistants.tecnologic];
	
	for (i = 0; i < buttonsActions.length; i++) {
		$(this.dom.botones[i]).click((function (i) {
			return function () {
				if(buttonsActions[i] !== "" && self.handler.call(self.context, Utils.enums.interfaceActions.zoom, buttonsActions[i])){
					if(self.data.zoomZone !== -1) $(self.data.zoomZone).removeClass("active");
					self.data.zoomZone = this;
					$(this).addClass("active");
				}	
			}
		})(i));
	}

	for (i = 0; i < 5; i++) {
		$(this.data.assistants[i]).click( (function (i) {
			return function () {
				self.handler.call(self.context, Utils.enums.interfaceActions.assistantOpen, assistantsActions[i]);	
			};
		})(i));
	}

};

AssistPanel.prototype.getDom = function() {
	return this.dom.container;
};