var LoadCache = function () {
	this.init();
};

LoadCache.prototype.init = function() {
	this.cumulusData = [];
	this.systemsData = [];
	this.galaxy = false;
};

LoadCache.prototype.load = function(type, id, funct, noCacheFunct) {
	if(type === "cumulus" || type === "system" || type === "galaxy"){
		var self = this;
		var d = this.check(type, id);
		if(d !== false && (new Date().getTime() - d.time < 5 * 60 * 1000 || type === "galaxy")){
			setTimeout(function(){
				funct(d.data, false);
			}, 0);
		}else{
			var data = (type === "cumulus") ? CumulusInGalaxyData.nodes[id] : (type === "galaxy") ? CumulusInGalaxyData : planetDataSystemBeta;

			setTimeout(function () {
				if(d !== false)
					self.updateData(d, data);
				else
					self.addData(type, id, data);

				funct(data, true);
			}, 250);

			if(typeof noCacheFunct !== "undefined") noCacheFunct();
		}
	}
};

LoadCache.prototype.check = function(type, id) {
	var selected;
	if(type === "galaxy"){
		if(this.galaxy !== false) return this.galaxy;
		else return false;
	}

	if(type === "cumulus") selected = this.cumulusData;
	else if(type === "system") selected = this.systemsData;

	for (var i = selected.length - 1; i >= 0; i--) {
		if(selected[i].id === id){
			return selected[i];
		}
	}

	return false;
};

LoadCache.prototype.addData = function(type, id, data) {
	var selected, tmp;

	if(type === "galaxy"){
		this.galaxy = {
			data: data,
			time: new Date().getTime(),
			index: 0,
			id: 0
		};
		return true;
	}else if(type === "cumulus")
		selected = this.cumulusData;
	else if(type === "system")
		selected = this.systemsData;

	selected[selected.length] = {
		index: selected.length,
		id: id,
		data: data,
		time: new Date().getTime()
	};
};

LoadCache.prototype.updateData = function(d, data) {
	d.time = new Date().getTime();
	d.data = data;
};

var Cache;


var planetDataSystemBeta = [
	{"w":28318.773854651776,"h":28318.773854651776,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":2.9321531433504733,	"id":0,"nm":"nombre0.7807674560569001"},
	{"w":37226.34852152968,"h":37226.34852152968,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":3.3510321638291125,	"id":1,"nm":"nombre0.31429320494706847"},
	{"w":45609.193667297746,"h":45609.193667297746,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":3.7699111843077517,	"id":2,"nm":"nombre0.2628861980417482"},
	{"w":53868.01331141308,"h":53868.01331141308,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":0,					"id":3,"nm":"nombre0.8937999857018315"},
	{"w":61431.25342943195,"h":61431.25342943195,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":1.6755160819145563,	"id":4,"nm":"nombre0.010961594483019144"},
	{"w":85419.6190963891,"h":85419.6190963891,"d":0,"r":0,"ro":0,		"s":4000,"i":0,"v":5,"ip":4.1887902047863905,	"id":5,"nm":"nombre0.05948643555581967"},
	{"w":93269.17979293237,"h":93269.17979293237,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":0.8377580409572781,	"id":6,"nm":"nombre0.49620901136237205"},
	{"w":101540.94776445784,"h":101540.94776445784,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":2.5132741228718345,	"id":7,"nm":"nombre0.005071571908543571"},
	{"w":109813.50252204298,"h":109813.50252204298,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":5.864306286700947,	"id":8,"nm":"nombre0.7591860554330301"},
	{"w":118064.0690895996,"h":118064.0690895996,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":0.41887902047863906,	"id":9,"nm":"nombre0.25925489330823337"},
	{"w":141610.28006997512,"h":141610.28006997512,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":5.445427266222308,	"id":10,"nm":"nombre0.6359955844535278"},
	{"w":149795.7635421169,"h":149795.7635421169,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":4.607669225265029,	"id":11,"nm":"nombre0.9705843441812054"},
	{"w":157529.25279027285,"h":157529.25279027285,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":5.026548245743669,	"id":12,"nm":"nombre0.643360635292141"},
	{"w":165978.29667909423,"h":165978.29667909423,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":1.2566370614359172,	"id":13,"nm":"nombre0.9016871643665141"},
	{"w":174068.8750726891,"h":174068.8750726891,"d":0,"r":0,"ro":0,	"s":4000,"i":0,"v":5,"ip":2.0943951023931953,	"id":14,"nm":"nombre0.3806334219183751"}
];