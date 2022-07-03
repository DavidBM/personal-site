"use strict";
var PlanetChange = function (data) {
	this.init(data);
};

PlanetChange.prototype.init = function(data) {

	var self = this;
	var temp, domTemp;

	this.scroll = {};

	this.data = {};

	this.data.actualPage = 1;
	this.data.numPlanets = 5;

	this.eventHandler = data.eventHandler

	var ntime = new NtimeEvent(2, function () {
		self.drawPlanets();
	});

	this.data.images = {
		planetMask: ResourcesImg.g().load('content/img/planetMask.png', ntime),
		finishedPlanets: ResourcesImg.g().wait("finishedPlanets", ntime)
	};
	
	this.dom = {};
	this.dom.container = document.createElement("div");
	this.dom.container.className = "planetChange container";
	this.dom.subContainer = document.createElement("div");
	this.dom.subContainer.className = "planetChange subContainer";

	this.dom.pageBakground = document.createElement("div");
	this.dom.pageBakground.className = "planetChange pageBakground";

	this.dom.pageNext = document.createElement("div");
	this.dom.pageNext.className = "planetChange pageNext";

	this.dom.pageBack = document.createElement("div");
	this.dom.pageBack.className = "planetChange pageBack";

	this.dom.pageNumber = document.createElement("p");
	this.dom.pageNumber.className = "planetChange pageNumber";
	this.dom.pageNumber.innerHTML = "1";

	this.dom.planets = new Array(data.planets.length);
	var count = data.planets.length;
	for (var i = 0; i < count; i++) {
		this.dom.planets[i] = {
			container: document.createElement("div"),
			planet: document.createElement("canvas"),
			name: document.createElement("p"),
			orbit: data.planets[i].orbit
		};

		temp = this.dom.planets[i];

		domTemp = document.createElement("div");
		domTemp.className = "planetChange arrow"
		temp.container.appendChild(domTemp);

		temp.container.className = "planetChange planetContainer";
		temp.name.className = "planetChange name";

		temp.planet.width = 80;
		temp.planet.height = 80;

		temp.name.innerHTML = data.planets[i].name;
		

		$(temp.container).click((function (i) {
			return function () {
				self.selectPlanet(i);
			};
		})(i));

		temp.container.appendChild(temp.planet);
		temp.container.appendChild(temp.name);
		this.dom.subContainer.appendChild(temp.container);

	}

	this.dom.container.appendChild(this.dom.subContainer);
	this.dom.container.appendChild(this.dom.pageBakground);
	this.dom.pageBakground.appendChild(this.dom.pageNext);
	this.dom.pageBakground.appendChild(this.dom.pageBack);
	this.dom.pageBakground.appendChild(this.dom.pageNumber);

	//this.fakeScroll = new FakeScroll({element: this.dom.container, clas: "planetChange scroll"});

	this.bindEvents();

};

PlanetChange.prototype.bindEvents = function() {
	var self = this;
	$(window).resize(function(){
		self.calculateSizes();
	});

	$(this.dom.pageNext).click(function () {
		self.showPage(self.data.actualPage+1);
	});

	$(this.dom.pageBack).click(function () {
		self.showPage(self.data.actualPage-1);
	});
};

PlanetChange.prototype.scrollMode = function(scroll) {
	if(scroll){
		this.dom.container.style.right = "24px";
	}else{
		this.dom.container.style.right = "0";
	}
};

PlanetChange.prototype.showPage = function(page) {

	var self = this;
	var p = page - 1;
	var sign = +1;

	if(Math.ceil(this.dom.planets.length / this.data.numPlanets) < page) return false;
	if(page < 1) return false;

	if(page < this.data.actualPage){
		sign = -1;
	}

	$(this.dom.subContainer).stop().animate({left: (-50 -80) * sign, opacity: 0}, {duration: 100, queue: false, complete: function () {
		this.style.display = "none";
		for (var i = self.dom.planets.length - 1; i >= 0; i--) {
			if( p * self.data.numPlanets <= i && p * self.data.numPlanets + self.data.numPlanets > i) self.dom.planets[i].container.style.display = "block";
			else self.dom.planets[i].container.style.display = "none";
		}

		this.style.display = "block";
		this.style.left = ((sign < 0) ? "-" : "") + "130px";
		$(this).stop().animate({left: -80, opacity: 1}, {duration: 100, queue: false});
	}});


	this.data.actualPage = page;

	this.dom.pageNumber.innerHTML = this.data.actualPage;
};

PlanetChange.prototype.calculateSizes = function() {
	var height = Utils.getWindowSize(this.dom.container).y - 35;

	var numPlanets = Math.floor(height/86);

	this.data.numPlanets = numPlanets;

	this.showPage(this.data.actualPage);
};

/*PlanetChange.prototype.makeScrollable = function() {
	var self = this;
	this.fakeScroll.calculateSizes();
	$(window).resize(function () {
		self.fakeScroll.calculateSizes();
	});
};*/

PlanetChange.prototype.getDom = function() {
	return this.dom.container;
};

PlanetChange.prototype.selectPlanet = function(planet) {
	
};

PlanetChange.prototype.drawPlanets = function() {

	var positionI, positionJ, index;
	var planetSize = 400;

	for (var i = this.dom.planets.length - 1; i >= 0; i--) {
		index = this.dom.planets[i].orbit;
		positionI = index%5;
		positionJ = Math.floor(index/5);

		this.dom.planets[i].planet.getContext("2d").drawImage(ResourcesImg.g().get(this.data.images.finishedPlanets), positionI * planetSize, positionJ * planetSize, planetSize, planetSize, 0, 0, 80, 80);
		this.dom.planets[i].planet.getContext("2d").drawImage(ResourcesImg.g().get(this.data.images.planetMask), 500, 0, 500, 500, 0, 0, 80, 80);
	}
};