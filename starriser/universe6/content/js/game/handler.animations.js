Handler.prototype.mapModeInitChange = function(to, duration, funct, _toNode, toNodeZoom, last) {

	var self = this;
	var x, y, data, selectedNodeData;

	if(typeof last === "undefined") last = true;

	var InterfaceCenterDisplacement = 50;
	var ntimes = 2;


	var ntimesf = new NtimeEvent(2, function () {
		self.endModeChange(to, last);
		if(typeof funct !== "undefined") funct();
	});
	var functToNtimes = function () {
		ntimesf.handler.call(ntimesf.context);
	};

	var fromNode, toNode, from, selectedNode, fromSuperiorNode = false;
	from = this.mode.zoneWorkMode;
	if(from < to){ //Zoom+ //Como he definido los enum yo, se que un nivel superior de zoom es un valor menor.
		selectedNode = fromNode = this.selectZoneData(from).nodeSelected;
		toNode = null;
	}else{
		fromNode = null;
		selectedNode = toNode = this.selectZoneData((to > 0) ? to-1 : to).nodeSelected;
	}

	if(_toNode !== false) toNode = _toNode;

	this.mode.zoneWorkMode = Utils.enums.zoneWorkMode.ZOOM;
	this.zoomAnimationData.time = new Date().getTime();
	this.zoomAnimationData.duration = duration;

	this.selectDrawCall(from).unbindEvents();
	this.selectDrawCall(to).unbindEvents();

	if(from === Utils.enums.zoneWorkMode.GALAXY){
		data = this.obj.galaxy.getPositionAndData(fromNode);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;
		if(to === Utils.enums.zoneWorkMode.CUMULUS){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.1;
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			Cache.load("cumulus", fromNode, function (data) {
				self.obj.cumulus.resetData();
				self.obj.cumulus.setData(data);
				self.obj.cumulus.moveTo(x, y, 0.000001);
				self.obj.cumulus.hide(false);
				self.obj.cumulus.startAutoZoom(null, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 1, 1, Utils.transformRangEaseIn, "sixt", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.cumulus.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.01;
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			Cache.load("system", fromNode, function (data) {
				self.obj.system.resetData();
				self.obj.system.setData(data);
				self.obj.system.moveTo(x, y, 0.000001);
				self.obj.system.hide(false);
				self.obj.system.startAutoZoom(null, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 0, 1, Utils.transformRangEaseIn, "sixt", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.system.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;
		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.085;
			this.obj.galaxy.startAutoZoom(fromNode, null, 10, duration/3, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseIn, "sixt", functToNtimes);

			Cache.load("system", fromNode, function (data) {
				self.obj.system.resetData();
				self.obj.system.setData(data);
				self.obj.system.moveTo(x, y, 0.000001);
				self.obj.system.hide(false);
				self.obj.system.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseIn, "sixt", functToNtimes, true, true);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.system.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.GALAXY;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;
		}
	}else if(from === Utils.enums.zoneWorkMode.CUMULUS){
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.09;
			data = this.obj.cumulus.getPositionAndData(null);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;
			if(toNode !== null){
				selectedNodeData = null;
			}else{
				selectedNodeData = this.obj.galaxy.getPositionAndData(selectedNode);
				selectedNodeData.x = (this.obj.galaxy.centerX - selectedNodeData.x) * toNodeZoom / 0.0001;
				selectedNodeData.y = (this.obj.galaxy.centerY - selectedNodeData.y) * toNodeZoom / 0.0001;
			}
			this.obj.cumulus.startAutoZoom(selectedNodeData, null, 0.0001, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "sixt", functToNtimes);

			Cache.load("galaxy", null, function (data) {
				self.obj.galaxy.resetData();
				self.obj.galaxy.setData(data);
				self.obj.galaxy.moveTo(selectedNode, 10, x, y);
				self.obj.galaxy.hide(false);
				self.obj.galaxy.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 0, 1, Utils.transformRangEaseOut, "sixt", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;

		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.01;
			data = this.obj.cumulus.getPositionAndDataById(fromNode);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;

			this.obj.cumulus.startAutoZoom(this.obj.cumulus.getIndexById(fromNode), null, 10, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, -1, Utils.transformRangEaseInOut, "third", functToNtimes);

			Cache.load("system", fromNode, function (data) {
				self.obj.system.resetData();
				self.obj.system.setData(data);
				self.obj.system.moveTo(x, y, 0.000001);
				self.obj.system.hide(false);
				self.obj.system.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.system.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;

		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.085;
			data = this.obj.cumulus.getPositionAndData(fromNode);
			x = data.x * data.zoom + data.desplacedX;
			y = data.y * data.zoom + data.desplacedY;

			this.obj.cumulus.startAutoZoom(fromNode, null, 10, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, -1, Utils.transformRangEaseInOut, "third", functToNtimes);

			Cache.load("system", fromNode, function () {
				self.obj.system.moveTo(x, y, 0.000001);
				self.obj.system.hide(false);
				self.obj.system.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes, true, true);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.system.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.CUMULUS;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;

		}
	}else if(from === Utils.enums.zoneWorkMode.SYSTEM){
		data = this.obj.system.getPositionAndData(null);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.1;
			if(toNode !== null){
				selectedNodeData = null;
			}else{
				selectedNodeData = this.obj.galaxy.getPositionAndData(selectedNode);
				selectedNodeData.x = (this.obj.galaxy.centerX - selectedNodeData.x) * toNodeZoom / 0.0001;
				selectedNodeData.y = (this.obj.galaxy.centerY - selectedNodeData.y) * toNodeZoom / 0.0001;
			}

			this.obj.system.startAutoZoom(selectedNodeData, null, 0, duration/2, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseInOut, "third", functToNtimes);
			
			Cache.load("galaxy", null, function (data) {
				self.obj.galaxy.resetData();
				self.obj.galaxy.setData(data);
				self.obj.galaxy.moveTo(selectedNode, 10, x, y);
				self.obj.galaxy.hide(false);
				self.obj.galaxy.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 0, 1, Utils.transformRangEaseOut, "sixt", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.galaxy.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;
		}else if(to === Utils.enums.zoneWorkMode.CUMULUS){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.1;
			this.obj.system.startAutoZoom(null, null, 0.00001, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "sixt", functToNtimes);

			Cache.load("cumulus", toNode, function (data) {
				self.obj.cumulus.resetData();
				self.obj.cumulus.setData(data);
				self.obj.cumulus.moveTo(toNode, 10, x, y);
				self.obj.cumulus.hide(false);
				self.obj.cumulus.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, 0, 1, Utils.transformRangEaseOut, "sixt", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.cumulus.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.PLANET){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.085;

			this.obj.system.showUserInfoFunction(false);
			this.obj.system.startAutoZoom(toNode, null, toNodeZoom, duration, this.data.canvasWidth/2 - InterfaceCenterDisplacement, 300, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes, true, true);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.SYSTEM;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.PLANET;

			ntimes = 1;
		}
	}else if(from === Utils.enums.zoneWorkMode.PLANET){
		data = this.obj.system.getPositionAndData(fromNode);
		x = data.x * data.zoom + data.desplacedX;
		y = data.y * data.zoom + data.desplacedY;

		this.obj.system.endFollowPlanet(false);
		
		if(to === Utils.enums.zoneWorkMode.GALAXY){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.1;
			if(toNode !== null){
				selectedNodeData = null;
			}else{
				selectedNodeData = this.obj.galaxy.getPositionAndData(selectedNode);
				selectedNodeData.x = (this.obj.galaxy.centerX - selectedNodeData.x) * toNodeZoom / 0.0001;
				selectedNodeData.y = (this.obj.galaxy.centerY - selectedNodeData.y) * toNodeZoom / 0.0001;
			}

			this.obj.system.startAutoZoom(selectedNodeData, null, 0, duration/3, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.obj.galaxy.moveTo(selectedNode, 85, x, y);
			this.obj.galaxy.startAutoZoom(toNode, null, toNodeZoom, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.GALAXY;
		}else if(to === Utils.enums.zoneWorkMode.CUMULUS){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.1;
			this.zoomAnimationData.duration = duration = duration/1.5;
			this.obj.system.startAutoZoom(null, null, 0, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 1, 0, Utils.transformRangEaseOut, "third", functToNtimes);

			Cache.load("cumulus", fromNode, function () {
				self.obj.cumulus.moveTo(toNode, 85, x, y);
				self.obj.cumulus.hide(false);
				self.obj.cumulus.startAutoZoom(toNode, null, toNodeZoom, duration, self.data.canvasWidth/2, self.data.canvasHeight/2, -1, 1, Utils.transformRangEaseOut, "third", functToNtimes);
				self.obj.loading.stop();
			}, function(){
				self.obj.loading.start();
			});

			this.obj.cumulus.hide(true);
			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.CUMULUS;
		}else if(to === Utils.enums.zoneWorkMode.SYSTEM){
			toNodeZoom = (typeof toNodeZoom !== "undefined" && toNodeZoom !== false) ? toNodeZoom : 0.01;
			this.zoomAnimationData.duration = duration = duration/2;
			this.obj.system.showUserInfoFunction(true);
			this.obj.system.startAutoZoom(null, null, toNodeZoom, duration, this.data.canvasWidth/2, this.data.canvasHeight/2, 0, 1, Utils.transformRangEaseInOut, "third", functToNtimes);

			this.mode.zoomMode.from = Utils.enums.zoneWorkMode.PLANET;
			this.mode.zoomMode.to = Utils.enums.zoneWorkMode.SYSTEM;

			ntimes = 1;
		}
	}

	ntimesf.context.changeTimesToFire(ntimes);

};



Handler.prototype.endModeChange = function(to, last) {
	this.requestStaticFrameFunction();
	this.mode.zoneWorkMode = this.mode.zoomMode.to;
	if(this.mode.zoneWorkMode !== Utils.enums.zoneWorkMode.PLANET && last === true) this.selectDrawCall(this.mode.zoneWorkMode).bindEvents();
};

/*
API:
[
	{
		type: "mapZoom", 
		duration: 800,
		funct: funct / "undefined",
		to: {
			level: Utils.enums.zoneWorkMode.?,
			zoom (optional): 1.05 / "undefined" / false,
			node: 17 / "undefined" / null (for center)
		}
	}
]
 */
Handler.prototype.executeAnimation = function(animation, funct, step) {

	if(typeof step === "undefined") step = 0;

	var last = (step >= animation.length - 1) ? true : false;

	var self = this;
	var a = animation[step];

	switch (a.type){
		case "mapZoom":
			this.mapModeInitChange(
				a.to.level,
				a.duration,
				function(){
					if(last && typeof funct !== "undefined") funct();
					else if(!last) self.executeAnimation(animation, funct, step + 1);
				},
				(typeof a.to.node !== "undefined") ? a.to.node : false,
				(typeof a.to.zoom !== "undefined") ? a.to.zoom : false,
				last);
		break;
	}
};