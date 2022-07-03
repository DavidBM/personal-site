"use strict";
var MainWindow = function (handler, context) {
	this.init(handler, context);
};
MainWindow.prototype.init = function(handler, context) {
	this.data = {};
	this.dom = {};
	this.handler = handler;
	this.context = context;

	this.createDom();

	this.data.show = false;
	this.actualWindow = false;

	this.bindEvents();
};

MainWindow.prototype.bindEvents = function() {
	var self = this;
	$(this.dom.closeButton).click(function () {
		self.close();
	});
};

MainWindow.prototype.createDom = function() {
	this.dom.container = document.createElement("div").setClass("mainWindow container");
	this.dom.closeButton = document.createElement("p").setClass("mainWindow closeButton").setHtml("Volver al mapa");
	this.dom.background = document.createElement("div").setClass("mainWindow background");
	this.dom.subContainer = document.createElement("div").setClass("mainWindow subContainer");

	this.dom.container.addChild(this.dom.closeButton).addChild(this.dom.background).addChild(this.dom.subContainer);
};

MainWindow.prototype.getDom = function() {
	return this.dom.container;
};

MainWindow.prototype.initWindow = function(type, data) {
	if(this.actualWindow !== false){
		this.clearWindow();
	}
	this.actualWindow = false;
	switch(type){
		case Utils.enums.assistants.militar: //Militar
			this.actualWindow = new MilitaryAssistant();
		break;
		case Utils.enums.assistants.social: //Social
			this.actualWindow = new SocialAssistant();
		break;
		case Utils.enums.assistants.diplomatic: //Diplomático
			this.actualWindow = new DiplomaticAssistant();
		break;
		case Utils.enums.assistants.commercial: //Comercial
			this.actualWindow = new CommercialAssistant();
		break;
		case Utils.enums.assistants.tecnologic: //Tecnológico
			this.actualWindow = new TechnologyAssistant();
		break;
	}

	if(this.actualWindow){
		this.dom.subContainer.appendChild(this.actualWindow.getDom());
	}

};

MainWindow.prototype.close = function(noEmmitEvent) {
	this.clearWindow();

	this.hide(true);
	this.handler.call(this.context, Utils.enums.interfaceActions.hiddeWindow);
};

MainWindow.prototype.hide = function(noAnimate) {
	if(noAnimate){
		this.dom.container.style.display = "none";
		this.dom.container.style.opacity = 0;
	}else{
		$(this.dom.container).animate({opacity: 0},{duration: 300, queue: false, complete: function(){
			this.style.display = "none";
		}});
	}

	this.data.show = false;
};

MainWindow.prototype.show = function() {
	if(this.dom.container.style.display != "block"){
		this.dom.container.style.display = "block";
		this.dom.container.style.opacity = 0;
	}

	$(this.dom.container).animate({opacity: 1},{duration: 300, queue: false});

	this.data.show = true;

	this.handler.call(this.context, Utils.enums.interfaceActions.unHiddeWindow);

};

MainWindow.prototype.clearWindow = function() {
	if(this.actualWindow !== false){
		$(this.actualWindow.getDom()).remove();
		this.dom.subContainer.innerHTML = "";
		this.actualWindow.clear();
		this.actualWindow = false;
	}

};