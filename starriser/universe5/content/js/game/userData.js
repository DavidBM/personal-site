var UserDataCache = function (data) {
	this.init(data);
};

UserDataCache.prototype.init = function(data) {

	this.planets = [];
	this.updating = true;
	this.callbacks = [];
	if(data.callback) this.callbacks.push({type: data.type, callback: data.callback});
	this.updateInfo();

};

UserDataCache.prototype.updateInfo = function() {
	var self = this;
	this.updating = true;
	setTimeout(function () {
		var data = TempDateBetaUser.planets;
		self.setData(data);
		self.updating = false;
		self.completeCallbacks();
	}, 1000);
};

UserDataCache.prototype.setData = function(data) {
	var isIn = false;
	for (var i = data.length - 1; i >= 0; i--) {
		isIn = false;
		for (var j = this.planets.length - 1; j >= 0; j--) {
			if(this.planets[j].id === data[i].id){
				this.updatePlanet(this.planets[j], data[i]);
				isIn = true;
			}
		}
		if(isIn === false){
			this.setPlanet(data[i]);
		}
	}
};

UserDataCache.prototype.updatePlanet = function(planet, data) {
	if(planet.name !== data.name) planet.name = data.name;
	if(planet.orbit !== data.orbit) planet.orbit = data.orbit;
	if(planet.population !== data.population) planet.population = data.population;
	if(planet.resources.n !== data.resources.n) planet.resources.n = data.resources.n;
	if(planet.resources.a !== data.resources.a) planet.resources.a = data.resources.a;
	if(planet.resources.b !== data.resources.b) planet.resources.b = data.resources.b;
	if(planet.resources.c !== data.resources.c) planet.resources.c = data.resources.c;

	if(planet.buildingLevel.a !== data.buildingLevel.a) planet.buildingLevel.a = data.buildingLevel.a;
	if(planet.buildingLevel.b !== data.buildingLevel.b) planet.buildingLevel.b = data.buildingLevel.b;
	if(planet.buildingLevel.n !== data.buildingLevel.n) planet.buildingLevel.n = data.buildingLevel.n;
	if(planet.buildingLevel.lab !== data.buildingLevel.lab) planet.buildingLevel.lab = data.buildingLevel.lab;
	if(planet.buildingLevel.shield !== data.buildingLevel.shield) planet.buildingLevel.shield = data.buildingLevel.shield;
	if(planet.buildingLevel.shipYard !== data.buildingLevel.shipYard) planet.buildingLevel.shipYard = data.buildingLevel.shipYard;
	if(planet.buildingLevel.defense !== data.buildingLevel.defense) planet.buildingLevel.defense = data.buildingLevel.defense;
	if(planet.buildingLevel.port !== data.buildingLevel.port) planet.buildingLevel.port = data.buildingLevel.port;


	planet.nextChange = data.nextChange;
	if(planet.intervalId !== false) clearInterval(planet.intervalId);
	planet.intervalId = false;

	this.setTimeout(planet);
};

UserDataCache.prototype.setPlanet = function(t) {
	var planet = {
		index: this.planets.length,
		name: t.name,
		orbit: t.orbit,
		id: t.id,
		cumulusId: t.cumulusId,
		systemId: t.systemId,
		populationM: t.populationM,
		populationC: t.populationC,
		populationT: t.populationT,
		nextChange: t.nextChange,
		resources: {
			n: t.resources.n,
			a: t.resources.a,
			b: t.resources.b,
			c: t.resources.c,
			d: t.resources.d,
			e: t.resources.e,
			f: t.resources.f
		}, buildingLevel: {
			a: t.buildingLevel.a,
			b: t.buildingLevel.b,
			n: t.buildingLevel.n,
			lab: t.buildingLevel.lab,
			shield: t.buildingLevel.shield,
			shipYard: t.buildingLevel.shipYard,
			defense: t.buildingLevel.defense,
			port: t.buildingLevel.port
		}, mines: {
			a: t.mines.a,
			b: t.mines.b,
		},
		intervalId: false,
		resourcesLastUpdate: new Date().getTime()
	};

	this.planets[this.planets.length] = planet;

	this.setTimeout(planet);
};

UserDataCache.prototype.completeCallbacks = function() {
	var len = this.callbacks.length;
	var type, callback;
	for (var i = 0; i < len; i++) {
		type = this.callbacks[i].type;
		callback = this.callbacks[i].callback;

		if(type === "AP")
			this.getPlanets(callback);
		else if(type === "OP"){
			this.getPlanet(this.callbacks[i].id, callback);
		}else{
			setTimeout(( function (callback) {
				return function () {
					callback();
				};
			} )(callback) );
		}
	}
	this.callbacks.length = 0;
};

UserDataCache.prototype.setTimeout = function(planet) {
	var self = this;
	if(planet.nextChange !== false){
		planet.intervalId = setTimeout(function () {
			self.updateInfo();
		}, planet.nextChange * 1000);
	}
};

UserDataCache.prototype.getPlanets = function(callback) {
	if(this.updating === true){
		this.callbacks.push({type: "AP", callback: callback}); //AllPlanets
	}else{
		var self = this;
		setTimeout(function () {
			callback(self.planets);
		});
	}
};

UserDataCache.prototype.getPlanet = function(id, callback) {
	if(this.updating === true){
		this.callbacks.push({type: "OP", id: id, callback: callback}); //OnePlanet
	}else{
		var self = this;
		if(this.planets[id]) setTimeout(function () {
			callback(self.planets[id]);
		}, 0);
	}
};

UserDataCache.prototype.updatePlanetInfo = function(id) {
	var planet = this.planets[id];
	var resources = planet.resources;
	var time = (new Date().getTime() - planet.resourcesLastUpdate) / 1000;
	for(var key in resources){
		resources[key][0] += time * resources[key][1];
	}

	planet.resourcesLastUpdate = new Date().getTime();
};

UserDataCache.prototype.updatePlanetsInfo = function() {
	for (var i = this.planets.length - 1; i >= 0; i--) {
		this.updatePlanetInfo(this.planets[i]);
	}
};

UserDataCache.prototype.updateAndGetPlanet = function(id, callback) {
	this.updatePlanetInfo(id);
	this.getPlanet(id, callback);
};

var UserData;

/*
API:

{
	planets: [
		{
			name: "couldron",
			orbit: 10,
			id: 129864,
			cumulusId: 33,
			systemId: 5045,
			populationM: 24872013,
			populationC: 54781,
			populationT: 25478,
			nextChange: 30, //(seconds) false if not
			resources: {
				n: 1284,
				a: 1011,
				b: 184,
				c: 975,
				d: 5698,
				e: 52,
				f: 547
			}, buildingLevel: {
				a: 3,
				b: 5,
				n: 6,
				lab: 5,
				shield: 10,
				shipYard: 5,
				defense: 8,
				port: 3
			}, mines: {
				a: "a",
				b: "d",
			}
		}
	],
	fleets: [
		{
			systemId: ,
			cumulusId: ,
			route: [],
			fleetId: ,
			ships: [],
		}
	]
}
 */

var TempDateBetaUser = {
	planets: [
		{	
			id_planet_user: 1,
			rad: 1.45634,
			angular_speed: 5,
			ring: 0,
			sector: "E",
			name: "couldron",
			orbit: 10,
			id: 129864,
			cumulusId: 2,
			systemId: 78,
			populationM: 24872013,
			populationC: 54781,
			populationT: 25478,
			nextChange: 30, //(seconds) false if not
			resources: {
				n: [1284, 23],
				a: [1011, 24],
				b: [184, 18],
				c: [975, 4],
				d: [5698, 8],
				e: [52, 21],
				f: [547, 20]
			}, buildingLevel: {
				a: 3,
				b: 5,
				n: 6,
				lab: 5,
				shield: 10,
				shipYard: 5,
				defense: 8,
				port: 3
			}, mines: {
				a: "a",
				b: "d",
			}
		}
	]
};