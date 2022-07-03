"use strict";
var NodeView = function () {
	this.init();
};

NodeView.prototype.init = function() {
	var i;
	var self = this;

	this.dom = {};
	this.dom.container = document.createElement("div");
	this.dom.container.className = "nodeview container";

	this.dom.planetBackground = document.createElement("canvas");
	this.dom.planetBackground.width = 53;
	this.dom.planetBackground.height = 106;
	this.dom.planetBackground.className = "nodeview planetBackground";
	this.dom.container.appendChild(this.dom.planetBackground);

	this.dom.planetBackgroundCtx = this.dom.planetBackground.getContext("2d");

	this.dom.infoBox = document.createElement("div");
	this.dom.infoBoxUserName = document.createElement("p");
	this.dom.infoBoxPlanetName = document.createElement("p");
	this.dom.infoBoxEnd = document.createElement("div");
	this.dom.infoBoxEnd.className = "nodeview infoBoxEnd";

	this.dom.infoBox.className = "nodeview infoBox";

	this.dom.infoBox.appendChild(this.dom.infoBoxUserName);
	this.dom.infoBox.appendChild(this.dom.infoBoxPlanetName);
	this.dom.infoBox.appendChild(this.dom.infoBoxEnd);

	this.dom.container.appendChild(this.dom.infoBox);

	this.dom.buttonsContainer = document.createElement("div");
	this.dom.buttonsContainer.className = "nodeview buttonsContainer";
	this.dom.container.appendChild(this.dom.buttonsContainer);

	this.dom.buttonsContainerEnd = document.createElement("div");
	this.dom.buttonsContainerEnd.className = "nodeview buttonsContainerEnd";
	this.dom.buttonsContainer.appendChild(this.dom.buttonsContainerEnd);


	this.animationData = {};
	this.animationData.draw = false;

	

	/***********/
	this.images = {};

	var ntime = new NtimeEvent(2, function () {
		self.animationData.draw = true;
		self.drawPlanet(0);
	});

	this.images.planetMask = ResourcesImg.g().load('content/img/planetMask.png', ntime);
	this.images.planets = ResourcesImg.g().wait('finishedPlanets', ntime);
	/***********/	

	this.buttonsClass = [
		"interfaceButton_Colonizar",
		"interfaceButton_Mensaje",
		"interfaceButton_Desplegar",
		"interfaceButton_Enviar_recursos",
		"interfaceButton_Atacar",
		"interfaceButton_Bloquear",
		"interfaceButton_Espiar",
		"interfaceButton_Informacion",
	];

	this.buttonActions = [
		Utils.enums.interfaceButtonAction.COLONIZE,
		Utils.enums.interfaceButtonAction.MESSAGE,
		Utils.enums.interfaceButtonAction.DEPLOY,
		Utils.enums.interfaceButtonAction.SEND,
		Utils.enums.interfaceButtonAction.ATACK,
		Utils.enums.interfaceButtonAction.BLOCK,
		Utils.enums.interfaceButtonAction.SPY,
		Utils.enums.interfaceButtonAction.INFO
	];	
		
	this.buttons = new Array(this.buttonActions.length);
	for (var i = this.buttons.length - 1; i >= 0; i--) {
		this.buttons[i] = document.createElement("div");
		this.buttons[i].className = this.buttonsClass[i];
		this.dom.buttonsContainer.appendChild(this.buttons[i]);
	}

	//this.draw();
	this.bindEvents();
};

NodeView.prototype.bindEvents = function() {
	var self = this;
};

NodeView.prototype.getDom = function() {
	return this.dom.container;
};

NodeView.prototype.drawPlanet = function(planet) {
	if(this.animationData.draw === true){
		var positionI = planet%5;
		var positionJ = Math.floor(planet/5);

		this.dom.planetBackgroundCtx.drawImage(ResourcesImg.g().get(this.images.planets), positionI * 200 + 100, positionJ * 200, 100, 200, 0, 0, 53, 106);
		this.dom.planetBackgroundCtx.drawImage(ResourcesImg.g().get(this.images.planetMask), 500, 0, 500, 500, -53, 0, 106, 106);
	}
};

NodeView.prototype.hide = function() {
	$(this.dom.container).animate({bottom: -124}, {duration: 400, queue: false, complete: function(){
		$(this).css({display: "none"});
	}});
};

NodeView.prototype.show = function() {
	$(this.dom.container).css({display: "block"}).animate({bottom: 0}, {duration: 400, queue: false});
};