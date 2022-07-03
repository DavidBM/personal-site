"use strict";
var SocialAssistant = function () {
	this.init();
};

SocialAssistant.prototype.init = function() {
	
	this.dom = {};
	this.data = {};

	this.data.timers = [];

	this.tabs = new MinTabs();
	this.tabs.addTab("Población de planetas", [
		createElement("div").setClass("loading").saveIn(this.dom, "loading"),
		createElement("div").setClass("clear")
	]);
	this.tabs.addTab("Lista de eventos", [
		createElement("div").setClass("loading").saveIn(this.dom, "loading"),
		createElement("div").setClass("clear")
	]);

	this.loadData();

	this.dom.container = this.tabs.getDom();
};

SocialAssistant.prototype.getDom = function() {
	return this.dom.container;
};

SocialAssistant.prototype.loadData = function() {
	var self = this;

	setTimeout(function () {
		self.dataLoaded(SocialData);
	}, 600);
};

SocialAssistant.prototype.dataLoaded = function(data) {
	var self = this;

	this.data.data = data;

	/*this.data.timers.push(setInterval(function () {
		self.updateMovementsTimes();
	}, 1000));*/
};

SocialAssistant.prototype.clear = function(kill) {
	if(kill){
		this.dom.container.innerHTML = "";
	}
	for (var i = this.data.timers.length - 1; i >= 0; i--) {
		clearInterval(this.data.timers[i]);
	}
};

var SocialData = {
	events: [
		{
			eventType: "upgraded",
			pasTime: 12353,
			buildingType: 0,
		},{
			eventType: "upgraded",
			pasTime: 12353,
			buildingType: 1,
		},{
			eventType: "upgraded",
			pasTime: 12353,
			buildingType: 2,
		},{
			eventType: "upgraded",
			pasTime: 12353,
			buildingType: 3,
		},{
			eventType: "upgraded",
			pasTime: 12353,
			buildingType: 4,
		}
	],
	population: [
		{
			idNode: 23,
			nodeName: "miCadaPapaChulo",
			type: "planet",
			orbit: 2,
			populationC: [1234, 2345, 1783, 2145],
			populationM: [1234, 2345, 1783, 2145],
			populationT: [1234, 2345, 1783, 2145]
		}
	]
};