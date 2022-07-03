var LoadCache = function () {
	this.init();
};

LoadCache.prototype.init = function() {
	this.cumulusData = [];
	this.systemsData = [];
};

LoadCache.prototype.load = function(type, id, funct, noOnCacheFunct) {
	if(type === "cumulus" || type === "system"){
		var self = this;
		var d = this.check(type, id);
		if(d !== false && new Date().getTime() - d.time < 5 * 60 * 1000){
			setTimeout(function(){
				funct(d.data);
			}, 0);
		}else{
			var data = (type === "cumulus") ? SystemsInCumulusData : planetsInCumulusData;
			setTimeout(function () {
				if(d !== false)
					self.updateData(type, id, data);
				else
					self.addData(type, id, data);

				funct(data);
			}, 1000);

			if(d === false){
				if(typeof noOnCacheFunct !== "undefined") noOnCacheFunct();
			}
		}
	}
};

LoadCache.prototype.check = function(type, id) {
	var selected;
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
	if(type === "cumulus") selected = this.cumulusData;
	else if(type === "system") selected = this.systemsData;

	selected[selected.length] = {
		index: selected.length,
		id: id,
		data: data,
		time: new Date().getTime()
	};

};

LoadCache.prototype.updateData = function(type, id, data) {
	var selected, tmp;
	if(type === "cumulus") selected = this.cumulusData;
	else if(type === "system") selected = this.systemsData;

	tmp = selected[id];
	tmp.time = new Date().getTime();
	tmp.data = data;
};

var Cache = new LoadCache();