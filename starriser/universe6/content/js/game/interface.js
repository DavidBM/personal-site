"use strict";
var Interface = function (zone, handler, handlerContext, eventHandler) { //Gestiona los objetos de la interfaz y se comunica con el handler si hace falta.
	this.init(zone, handler, handlerContext, eventHandler);
};

Interface.prototype.init = function(zone, handler, handlerContext, eventHandler) {

	var self = this;

	this.interfaceBlocked = true;

	this.zone = zone;
	this.handler = handler;
	this.handlerContext = handlerContext;
	this.eventHandler = eventHandler;
	this.container = document.createElement("div");
	this.container.className = "interfaceContainerScrollable";
	this.body = document.getElementById("body");

	this.body.appendChild(this.container);

	/*Zona de planeta seleccionado*/
	this.nodeView = new NodeView();
	this.body.appendChild(this.nodeView.getDom());
	

	/*Onjeto que se encarga del panel superior que tiene el movimiento por el mapa y los asistentes*/
	this.assistPanel = new AssistPanel(this.assistPanelHadler, this);
	this.assistPanel.bindEvents();
	this.container.appendChild(this.assistPanel.getDom());

	/*Objeto que se encarga de mostrar la interfaz del planeta.*/
	this.planetView = new PlanetView();
	this.container.appendChild(this.planetView.getDom());

	/*Objeto que se encarga de mostrar la interfaz para cambiar entre los planetas propios*/
	self.planetChange = false;
	UserData.getPlanets(function (planets) {
		self.planetChange = new PlanetChange({planets: planets, eventHandler: self.eventHandler});
		self.body.appendChild(self.planetChange.getDom());
		self.planetChange.calculateSizes();
	});


	/*Objeto que se encarga de mostrar la vetnana principal donde irán los asistentes y otras ventanas.*/
	this.mainWindow = new MainWindow(this.mainWindowsHandler, this);
	this.container.appendChild(this.mainWindow.getDom());
	//this.mainWindow.initWindow(Utils.enums.assistants.militar);


	/*Datos*/
	this.data = {};
	this.data.nodeViewVisible = false;
	this.data.planetViewVisible = false;
	this.data.isInScrollMode = false;
	this.data.scroll = 0;

	this.bindEvents();
};

Interface.prototype.bindEvents = function() {
	var self = this;
	this.container.onscroll = function (e){
		self.onScroll(e);
	};
};

Interface.prototype.onScroll = function(e) {
	if(this.data.isInScrollMode){
		this.handler.call(this.handlerContext, Utils.enums.interfaceActions.scrollPlanetInterface, $(this.container).scrollTop());
	}
};

Interface.prototype.draw = function() {
	//this.planetView.draw();
	return false;
};

Interface.prototype.showScroll = function() {
	this.nodeView.hide();
	this.data.nodeViewVisible = false;

	this.data.isInScrollMode = true;
	this.container.style.height = "100%";
	this.container.style.overflowY = "scroll";
	this.container.style.overflowX = "hidden";
	if(this.planetChange) this.planetChange.scrollMode(true);
};

Interface.prototype.hideScroll = function() {
	if(this.data.nodeViewVisible === false){
		this.data.nodeViewVisible = true;
		this.nodeView.show();
	}

	this.data.isInScrollMode = false;
	this.container.style.height = "";
	this.container.style.overflowY = "";
	this.container.style.overflowX = "";
	if(this.planetChange) this.planetChange.scrollMode(false);
};

Interface.prototype.unblockButtons = function() {
	this.interfaceBlocked = false;
};

Interface.prototype.blockButtons = function() {
	this.interfaceBlocked = true;
};

Interface.prototype.assistPanelHadler = function(type, data) {
	var self = this;
	if(this.interfaceBlocked !== true){
		var zone = this.handler.call(this.handlerContext, Utils.enums.interfaceActions.getState);
		if(type === Utils.enums.interfaceActions.zoom && zone !== Utils.enums.zoneWorkMode.ZOOM){
			if (data === Utils.enums.zoomLevels.planet) {
				this.showScroll();
				if(this.data.planetViewVisible === false){
					this.planetView.show(this.handler.call(this.handlerContext, Utils.enums.interfaceActions.getSelectedPlanet));
					this.data.planetViewVisible = true;
				}
			}else{
				if(this.data.planetViewVisible === true){
					this.data.planetViewVisible = false;
					this.planetView.hide();
				}
				this.hideScroll();
			}
			this.handler.call(this.handlerContext, type, data);
		}else if(type === Utils.enums.interfaceActions.assistantOpen){
			if (zone === Utils.enums.zoomLevels.planet) {
				if(this.data.planetViewVisible === true){
					this.data.planetViewVisible = false;
					this.planetView.hide();
				}
			}

			var funct = function () {
				self.handler.call(self.handlerContext, Utils.enums.interfaceActions.stopCanvasRefresh);
			};

			this.previousZone = zone;
			this.handler.call(this.handlerContext, Utils.enums.interfaceActions.zoom, Utils.enums.zoomLevels.galaxy, funct);

			this.mainWindow.clearWindow();
			this.mainWindow.initWindow(data);

			this.showScroll();
			this.nodeView.hide();
			this.mainWindow.show();

			this.data.nodeViewVisible = false;
		}else{
			return false;
		}

		return true;
	}
	return false;
};

Interface.prototype.mainWindowsHandler = function(type, data) {
	if(type === Utils.enums.interfaceActions.hiddeWindow){ //Se ha cerrado una ventana. Eso quiere decir que, siempre que no hayan más cosas en la interfaz, quitamos el scroll
		
		this.handler.call(this.handlerContext, Utils.enums.interfaceActions.startCanvasRefresh);

		if(this.handler.call(this.handlerContext, Utils.enums.interfaceActions.getState) !== Utils.enums.zoneWorkMode.PLANET){ //Miramos si estamos en el planeta, si no es así, quitamos el scroll.
			this.hideScroll();
			this.handler.call(this.handlerContext, Utils.enums.interfaceActions.zoom, this.previousZone);
		}
		if(this.previousZone === Utils.enums.zoomLevels.planet && this.data.planetViewVisible === false){
			this.planetView.show();
			this.data.planetViewVisible = true;
		}
	}else if(type === Utils.enums.interfaceActions.unHiddeWindow){ //Se pone un ventana, así que ponemos el scroll
		this.showScroll()
	}
};