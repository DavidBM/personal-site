"use strict";
var SocialAssistant = function () {
	this.init();
};

SocialAssistant.prototype.init = function() {
	
	this.dom = {};
	this.data = {};

	this.data.timers = [];

	this.dom.population = {};
	this.dom.events = {};

	this.dom.population.populationGraphs = [];


	this.tabs = new MinTabs();
	this.tabs.addTab("Población de planetas", [
		createElement("div").setClass("assistant assistantContainer").saveIn(this.dom.population, "container").addChild([
			createElement("div").setClass("loading").saveIn(this.dom.population, "loading"),
			createElement("div").setClass("clear")
		])
	]);
	this.tabs.addTab("Lista de eventos", [
		createElement("div").setClass("assistant assistantContainer").saveIn(this.dom.events, "container").addChild([
			createElement("div").setClass("loading").saveIn(this.dom.events, "loading"),
			createElement("div").setClass("clear")
		])
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

	this.dom.population.container.deleteChild(this.dom.population.loading).addChild(this.createHistoryPopulation());

	this.dom.events.container.deleteChild(this.dom.events.loading).addChild(this.createHistoryEvents());

	/*this.data.timers.push(setInterval(function () {
		self.updateTimes();
	}, 1000));*/
};

SocialAssistant.prototype.createHistoryPopulation = function() {
	var charData = [];
	var populationGraphs = this.dom.population.populationGraphs;

	var data = this.data.data.population;
	var len = data.length;
	for (var i = 0; i < len; i++) {
		populationGraphs[populationGraphs.length] = this.createPopulationPlanetCard(data[i]);
		charData[i] = populationGraphs[populationGraphs.length - 1];
	}

	return charData;
};

SocialAssistant.prototype.createPopulationPlanetCard = function(data) {

	var container = createElement("div").setClass("assistant card");

	var today = new Date().getTime();
	var tags = [];
	for (var i = data.populationC.length - 1; i >= 0; i--) {
		tags[i] = new Date(today - 86400000 * i).toISOString().split("T")[0];
	}

	var populationData = {
		labels: tags,
		datasets: [
			{
				fillColor: "rgba(128,163,111,0.1)",
				strokeColor: "rgba(128,163,111,1)", //A36F6F
				pointColor : "#49A61E",
				scaleFontColor : "#ccc",
				labelColor: "#ccc",
				data : data.populationC
			},
			{
				fillColor: "rgba(163,111,111,0.1)",
				strokeColor: "rgba(163,111,111,1)",
				pointColor : "#A61E1E",
				scaleFontColor : "#ccc",
				labelColor: "#ccc",
				data : data.populationM
			},
			{
				fillColor: "rgba(111,140,163,0.1)",
				strokeColor: "rgba(111,140,163,1)",
				pointColor : "#368ED6",
				scaleFontColor : "#ccc",
				labelColor: "#ccc",
				data : data.populationT
			},
		]
	};

	var canvas = createElement("canvas").setClass("populationLineChart");
	canvas.width = 730;
	canvas.height = 200;

	container.addChild(canvas).addChild(createElement("div").setClass("clear"));

	this.dom.population.populationGraphs.push(new Chart(canvas.getContext("2d"), {
		tooltips: {
			labelTemplate: "<%=value%>",
			showHighlight: false,
			offset: {
				left: 15,
				top: 0,
			},padding: {
				top: 5,
				right: 5,
				bottom: 5,
				left: 5
			}
		}
	}).Line(populationData, {
		bezierCurve: false,
		scaleFontColor : "#ccc",
		scaleGridLineColor : "rgba(0,0,0,0.2)",
		pointDotRadius : 3,
		pointDotStrokeWidth : 1,
		datasetStrokeWidth : 1,
		animation: false
	}));

	container.addChild(createElement("div").setClass("populationCardData")
		.addChild(createElement("p").addChild(createTextNode("Mejora militar: " + data.improvementM + "%")))
		.addChild(createElement("p").addChild(createTextNode("Mejora comercial: " + data.improvementC + "%")))
		.addChild(createElement("p").addChild(createTextNode("Mejora tecnológica: " + data.improvementT + "%")))
	);


	return container;
	
};

SocialAssistant.prototype.createHistoryEvents = function() {
	var charData = [];

	var data = this.data.data.events;
	var len = data.length;
	for (var i = 0; i < len; i++) {
		charData[i] = this.createEventPlanetCard(data[i]);
	}

	return charData;
};

SocialAssistant.prototype.createEventPlanetCard = function(data) {
	var container = createElement("div").setClass("assistant card")
		.addChild( createElement("img").setVariable("src", Utils.conversions.routeToBuildingImages + "building" + data.buildingType + ".jpg") )
		.addChild( createElement("p").addChild( createTextNode("El edificio " + Utils.conversions.buildingNames[data.buildingType] + " ha acabado de actualizarse" ) ).setClass("buildingCardText") )
		.addChild( createElement("p").addChild( createTextNode("Hora: " + (new Date(new Date().getTime() - data.pasTime)).toISOString().replace(/[TZ]/g, " ") ) ) );


	return container;
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
			buildingType: 0,
		},/*{
			eventType: "upgrading",
			remTime: 12353,
			buildingType: 1,
		},{
			eventType: "downgrading",
			remTime: 12353,
			buildingType: 2,
		},{
			eventType: "dowgraded",
			pasTime: 12353,
			buildingType: 3,
		}*/
	],
	population: [
		{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},{
			idNode: 49,
			nodeName: "miCadaPapaChulo",
			orbit: 2,
			populationC: [755,3813,2840,1584,1602,1049,4520,3927,567,2662,2132,4175,749,3628,3977,1680,4128,2500,17],
			populationM: [1647,2229,3958,4119,4860,2915,2028,2186,3774,2555,3330,3536,1558,1123,2081,3031,4137,636,4],
			populationT: [4151,4951,4394,3621,1242,2583,2515,690,1893,3481,2323,3144,3569,4842,1358,2914,3858,4033,86],
			improvementC: 5,
			improvementM: 15,
			improvementT: -10
		},
	]
};