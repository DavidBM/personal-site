"use strict";
var PlanetView = function (data) {
	this.init(data);
};

PlanetView.prototype.init = function(data) {
	var i, self = this;

	this.data = {};
	this.data.showed = false;
	this.data.id = false;

	this.data.buildingLevel = { a: -1, b: -1, n: -1, lab: -1, shield: -1, shipYard: -1, defense: -1, port: -1};

	this.dom = {};

	this.dom.contenedor = document.createElement("div");
	this.dom.contenedor.className = "planetView container";

	this.dom.buttons = new Array(8);

	var clases = ["Lab", "MineB", "Shield", "MineA", "Defense", "MineN", "Shipyard", "Commerce"];
	var buildingNames = ["Laboratorio", "Mina de sector", "Escudo planetario", "Mina de sistema", "Defensas", "Mina planetaria", "Astillero", "Puerto comercial"];
	this.dom.buildingObjectNames = ["a", "b", "n", "lab", "shield", "shipYard", "defense", "port"];
	this.dom.upgradeButtons = [];
	this.dom.buildingLevels = {a: false, b: false, n: false, lab: false, shield: false, shipYard: false, defense: false, port: false};

	for(i = 0; i < 8; i++){
		this.dom.contenedor.addChild(
			createElement("div").setClass( "planetView button" + clases[i] + ( (i%2 === 0) ? " left" : " right") ).saveIn(this.dom.buttons, i)
				.addChild( createElement("p").setClass("planetView buildingName")
					.addChild( createElement("b")
						.addChild( createTextNode(buildingNames[i]) ) 
					).addChild(createTextNode(" - nivel "))
					.addChild( createTextNode(0).saveIn(this.dom.buildingLevels, this.dom.buildingObjectNames[i]) )
				).addChild( createElement("div").setClass("planetView upgradeBuilding").saveIn(this.dom.upgradeButtons, i)
					.addChild( createTextNode("^") )
				)
			);

		$(this.dom.upgradeButtons[i]).click((function (i) {
			return function () {
				//Ajax de actualizar edificio
			}
		})(i));
	}

	this.dom.buildingObjectNames = null;
	delete this.dom.buildingObjectNames;

	var temp = document.createElement("div");
	temp.className = "planetView button_extension";
	this.dom.buttons[6].appendChild(temp);

	temp = document.createElement("div");
	temp.className = "planetView button_extension";
	this.dom.buttons[7].appendChild(temp);

	this.dom.contenedor.addChild( createElement("div").setClass("planetView resourcesContainer").saveIn(this.dom, "resourcesBackground")
		.addChild( createElement("p").setClass("planetView resourceN").saveIn(this.dom, "resourceN") )
	).addChild( createElement("div").setClass("planetView loading").saveIn(this.dom, "loading") );
};

PlanetView.prototype.updatePlanetDataInterval = function() {
	var self = this;
	
	UserData.updateAndGetPlanet(this.data.planetId, function (data) {
		if(self.data.showed){

			var _buildingLevel = self.data.buildingLevel;
			var buildingLevel = data.buildingLevel;

			for(var index in buildingLevel){
				if(buildingLevel[index] !== _buildingLevel[index]){
					self.dom.buildingLevels[index].setText(buildingLevel[index]);
					_buildingLevel[index] = buildingLevel[index];
				}
			}

			self.showLoading(false);
			setTimeout(function () {
				self.updatePlanetDataInterval();
			}, 1000);
		}
	});
};

PlanetView.prototype.updatePlanetInfo = function(planet) {
	this.data.planetId = planet.index;
	this.updatePlanetDataInterval();
};

PlanetView.prototype.getDom = function() {
	return this.dom.contenedor;
};

PlanetView.prototype.showLoading = function(show) {
	if(show === true){
		$(this.dom.loading).css({display: "block"});
	}else{
		$(this.dom.loading).css({display: "none"});
	}
};

PlanetView.prototype.show = function(id) {

	if(typeof id !== "undefined"){
		this.showLoading(true);
		this.updatePlanetInfo(id);
	}

	this.data.showed = true;
	var displacement = 1;
	var self = this;
	var temp = this.dom.buttons.length;
	for (var i = 0; i < temp; i++) {
		if(i % 2 === 0){
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().css({left: -200 * displacement, opacity: 0, display: "block"}).animate({left: 0, opacity: 1}, {duration: 400, queue: false});
				};
			})(i) , 100*Math.floor((this.dom.buttons.length - i + 1)/2));
		}else{
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().css({right: -200 * displacement, opacity: 0, display: "block"}).animate({right: 0, opacity: 1}, {duration: 400, queue: false});
				};
			})(i) , 100*Math.floor((this.dom.buttons.length - i + 1)/2));
		}
	}
	$(this.dom.resourcesBackground).stop().css({display: "block", opacity: 0}).animate({opacity: 1}, {duration: 800, queue: false});
	$(this.dom.contenedor).css({display: "block"});
};

PlanetView.prototype.hide = function() {
	this.data.showed = false;
	var self = this;
	var ntimes = new NtimeEvent(8, function () {
		if(self.data.showed === false) $(self.dom.contenedor).css({display: "none"});
	});
	var self = this;
	var temp = this.dom.buttons.length;
	for (var i = 0; i < temp; i++) {
		if(i % 2 === 0){
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().animate({left: -200, opacity: 0}, {duration: 300, queue: false, complete: function () {
						ntimes.handler.call(ntimes.context);
					}});
				};
			})(i) , 75*Math.floor(i/2) );
		}else{
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().animate({right: -200, opacity: 0}, {duration: 300, queue: false, complete: function () {
						ntimes.handler.call(ntimes.context);
					}});
				};
			})(i) , 75*Math.floor(i/2) );
		}
	}
	$(this.dom.resourcesBackground).stop().animate({opacity: 0}, {duration: 600, queue: false, complete: function () {
		$(this).css({display: "none"});
	}});
};