"use strict";
var Galaxy = function (sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) {
	this.init(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler);
};

Galaxy.prototype.init = function(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, Handler, handlerContext, eventHandler) { //Initialize variables. Wait for draw calls or what-is-there calls

	var self = this;

	this.data = {};
	this.sCanvasD = sCanvasDom;
	this.dCanvasD = dCanvasDom;

	this.sCanvasC = sCanvasCtx;
	this.dCanvasC = dCanvasCtx;

	this.handler = Handler;
	this.handlerContext = handlerContext;
	this.eventHandler = eventHandler;

	this.canvasWidth = this.dCanvasD.width;
	this.canvasHeight = this.dCanvasD.height;
	this.canvasTrasnform = new Array(6);

	this.zoom = 1;
	this.desplacedX = this.canvasWidth / 2 - 15000;
	this.desplacedY = this.canvasHeight / 2 - 15000;

	this.centerX = 0;
	this.centerY = 0;

	this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);

	this.dragData = {};
	this.dragData.hoverCumulus = -1;
	this.dragData.selectedCumulus = -1;

	this.animationData = {};
	this.animationData.pathFindingDistance = 0;
	this.animationData.pathFindingConnectionsDistances = [];
	this.animationData.pathFindingActualStart = 0;
	this.animationData.pathFindingActualDistance = new Date();
	this.animationData.cumulusOnZoom = false;
	this.animationData.initAutoZoomData = {};
	this.animationData.initAutoZoomData.initialZoom = 0;
	this.animationData.initAutoZoomData.finalZoom = 0;
	this.animationData.initAutoZoomData.x = 0;
	this.animationData.initAutoZoomData.y = 0;
	this.animationData.initAutoZoomData.time = 0;
	this.animationData.initAutoZoomData.duration = 0;
	this.animationData.initAutoZoomData.initialAlpha = 1;
	this.animationData.initAutoZoomData.finalAlpha = 1;

	this.events = {
		drag: false,
		click: false,
		resize: false
	};

	this.loads = {
		galaxy: false
	};

	this.images = {
		finishedGalaxy: ResourcesImg.g().wait("finishedGalaxy", {
			handler: function () {
				self.loads.galaxy = true;
			}
		})
	};


	this.path = {};
	this.path.pathFindingCumulus = [0, 0];
	this.path.pathFindingMarkedLinks = [];

	this.cumulusIcon = {
		canvas: document.createElement('canvas')
	};
	this.cumulusIcon.ctx = this.cumulusIcon.canvas.getContext('2d');
	this.cumulusSize = 0;
	this.generateNodesIcons();

};

Galaxy.prototype.setData = function(data) {
	this.graph = data.graph;
	this.nodes = data.nodes;
	var i, maxX = 0, minX = 0, maxY = 0, minY = 0;

	//Adaptando datos
	for (i = this.nodes.length - 1; i >= 0; i--) {
		this.nodes[i].conn = [];
		if(this.nodes[i].x > maxX) maxX = this.nodes[i].x;
		if(this.nodes[i].y > maxY) maxY = this.nodes[i].y;
		if(this.nodes[i].x < minX) minX = this.nodes[i].x;
		if(this.nodes[i].y < minY) minY = this.nodes[i].y;
	}

	this.centerX = (minX + maxX) / 2;
	this.centerY = (minY + maxY) / 2;

	for (i = this.graph.length - 1; i >= 0; i--) {
		this.nodes[this.graph[i].n1].conn.push(this.graph[i]);
		this.nodes[this.graph[i].n2].conn.push(this.graph[i]);
	}
};

Galaxy.prototype.setCanvasSize = function(w, h) {
	this.canvasWidth = w;
	this.canvasHeight = h;

	this.zoom = 0.015;
	this.desplacedX = w/2 - 200;
	this.desplacedY = h/2 - 200;

	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[0] = this.zoom;
	this.canvasTrasnform[1] = 0;
	this.canvasTrasnform[2] = 0;
	this.canvasTrasnform[3] = this.zoom;
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	this.generateNodesIcons();
};

Galaxy.prototype.updateCanvasSize = function(w, h) {
	var desplacedX = (this.canvasWidth - w) / 2;
	var desplacedY = (this.canvasHeight - h) / 2;

	this.canvasWidth = w;
	this.canvasHeight = h;

	this.canvasTrasnform[4] -= desplacedX;
	this.canvasTrasnform[5] -= desplacedY;

	this.desplacedX = this.canvasTrasnform[4];
	this.desplacedY = this.canvasTrasnform[5];
	this.requestStaticFrameFunction();
};


Galaxy.prototype.bindEvents = function() {
	var self = this;

	$(this.dCanvasD).bind('mousedown.galaxy touchstart.galaxy', function (e) {
		e.preventDefault();
	});

	this.events.drag = this.eventHandler.bind("drag", this.dCanvasD, function (data, event) {
		self.moveSystem(data.pageX, data.pageY);
	});
	this.events.click = this.eventHandler.bind("click", this.dCanvasD, function (data, event) {
		self.mapClick(data.pageX, data.pageY);
	});

	this.events.resize = this.eventHandler.bind("resize", this.dCanvasD, function (data, event) {
		self.zoomSystem(data.factor, data.center[0], data.center[1]);
	});

	$(this.dCanvasD).bind('mousemove.galaxy', function (e) {
		self.checkCumulusHoverAndSetPointer(e);
	});

};

Galaxy.prototype.unbindEvents = function() {
	$(this.dCanvasD).unbind(".galaxy");
	this.eventHandler.unbind(this.events.drag);
	this.eventHandler.unbind(this.events.click);
	this.eventHandler.unbind(this.events.resize);
};


Galaxy.prototype.moveSystem = function(desplacedX, desplacedY) {
	this.desplacedX += desplacedX;
	this.desplacedY += desplacedY;

	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	this.requestStaticFrameFunction();

	this.handler.call(this.handlerContext, Utils.enums.galaxyActions.parallaxScrolling, {x: desplacedX, y: desplacedY});

	return 0;
};

Galaxy.prototype.zoomSystem = function(growth, x, y) { 

	var zoom = this.zoom * growth;

	if(zoom > Utils.configuration.maxGalaxyZoom) zoom = Utils.configuration.maxGalaxyZoom;
	else if(zoom < Utils.configuration.minGalaxyZoom) zoom = Utils.configuration.minGalaxyZoom;

	growth = zoom / this.zoom;

	this.zoom *= growth;
	this.desplacedX += (x - this.desplacedX) - (x - this.desplacedX) * growth;
	this.desplacedY += (y - this.desplacedY) - (y - this.desplacedY) * growth;
	
	//this.sCanvasC.setTransform(this.zoom, 0, 0, this.zoom, this.desplacedX, this.desplacedY);
	this.canvasTrasnform[0] = this.zoom;
	this.canvasTrasnform[3] = this.zoom;
	this.canvasTrasnform[4] = this.desplacedX;
	this.canvasTrasnform[5] = this.desplacedY;

	
	this.generateNodesIcons();
	this.requestStaticFrameFunction();
};

Galaxy.prototype.requestStaticFrameFunction = function() {
	this.handler.call(this.handlerContext, Utils.enums.galaxyActions.requestStaticFrameFunction);
};

Galaxy.prototype.staticDraw = function() {

	this.sCanvasC.save();

	if(this.animationData.cumulusOnZoom !== false){
		this.autoZoom();
	}

	this.sCanvasC.globalAlpha = this.globalAlpha;
	this.sCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );

	this.drawGalaxyBackground();

	this.drawSystemCumulusLinks();
	this.drawSystemCumulus();

	this.sCanvasC.restore();
};

Galaxy.prototype.dynamicDraw = function() {

	this.dCanvasC.save();

	this.sCanvasC.globalAlpha = this.globalAlpha;
	this.dCanvasC.setTransform( this.canvasTrasnform[0], this.canvasTrasnform[1], this.canvasTrasnform[2], this.canvasTrasnform[3], this.canvasTrasnform[4], this.canvasTrasnform[5] );

	if(this.animationData.pathFindingDistance !== 0){
		this.pathIndicatorAnimation();
	}

	this.dCanvasC.restore();
};

Galaxy.prototype.drawSystemCumulus = function() {

	var s, s2, cumulusImage;

	s = this.cumulusSize / this.zoom;
	s2 = Math.round(s / 2 );
	cumulusImage = this.cumulusIcon.canvas;
	
	this.sCanvasC.save();
	this.sCanvasC.font = "8pt Arial";
	this.sCanvasC.lineWidth = 0.2;

	for (var i = this.nodes.length - 1; i >= 0; i--) {
		/*if(
			this.nodes[i].x + s2 > 0 &&
			this.nodes[i].x - s2 < this.canvasWidth &&
			this.nodes[i].y + s2 > 0 &&
			this.nodes[i].y - s2 < this.canvasHeight){*/

			if(this.dragData.selectedCumulus === i){
				this.sCanvasC.save();
				this.sCanvasC.strokeStyle = "#C7F1FC";
				this.sCanvasC.lineWidth = 3 / this.zoom;
				this.sCanvasC.fillStyle = "rgba(255, 0, 0, 0.2)";

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.nodes[i].x, this.nodes[i].y, this.cumulusSize / 1.5, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.nodes[i].x, this.nodes[i].y, this.cumulusSize / this.zoom / 1.2, 6, 0);
				this.sCanvasC.fill();

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.nodes[i].x, this.nodes[i].y, this.cumulusSize / 1.5, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.nodes[i].x, this.nodes[i].y, this.cumulusSize / this.zoom / 1.2, 6, 0);
				this.sCanvasC.stroke();

				this.sCanvasC.restore();
			}else if(this.dragData.hoverCumulus === i){
				this.sCanvasC.save();
				this.sCanvasC.strokeStyle = "#C7F1FC";
				this.sCanvasC.lineWidth = 3 / this.zoom;

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.nodes[i].x, this.nodes[i].y, this.cumulusSize / 1.8, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.nodes[i].x, this.nodes[i].y, this.cumulusSize  / this.zoom/ 1.5, 6, 0);
				this.sCanvasC.stroke();

				this.sCanvasC.restore();
			}

			this.sCanvasC.drawImage(
				cumulusImage,
				this.nodes[i].x - s2,
				this.nodes[i].y - s2,
				s,
				s
			);

			/*if(this.eventsnodesNumbersDrawFlag){
				this.sCanvasC.fillText(i, this.nodes[i].x, this.nodes[i].y);
			}*/
		//}
	}
	this.sCanvasC.restore();

};

Galaxy.prototype.drawSystemCumulusLinks = function() {

	var multiplier, cumulus1, cumulus2, temp;

	var multAlpha = Utils.transformRang(0.025, 0.075, this.zoom - 0.025, 1, 0.7);
	if(multAlpha < 0.7) multAlpha = 0.7;
	else if(multAlpha > 1) multAlpha = 1;

	multiplier = (this.zoom * 10 < 0.5) ? this.zoom * 10 : 0.5 ;
	if(multiplier > 1) multiplier = 1;

	this.sCanvasC.save();
	this.sCanvasC.lineWidth = 1 / this.zoom;
	//this.sCanvasC.strokeStyle = "#6E693E";
	this.sCanvasC.strokeStyle = "#777";
	this.sCanvasC.globalAlpha = multAlpha;
	this.sCanvasC.beginPath();

	for (var i = this.graph.length - 1; i >= 0; i--) {
		//if(this.graph[i].marked === false){
			cumulus1 = this.nodes[this.graph[i].n1];
			cumulus2 = this.nodes[this.graph[i].n2];
			this.sCanvasC.moveTo(cumulus1.x, cumulus1.y);
			this.sCanvasC.lineTo(cumulus2.x, cumulus2.y);
		//}
	}

	this.sCanvasC.stroke();


	if(this.path.pathFindingMarkedLinks.length > 0){
		this.sCanvasC.save();
		this.sCanvasC.lineWidth = 4 / this.zoom;
		this.sCanvasC.strokeStyle = "#222";
		this.sCanvasC.globalAlpha = 1;
		this.sCanvasC.beginPath();

		for (var i = this.path.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
			cumulus1 = this.nodes[this.path.pathFindingMarkedLinks[i].n1];
			cumulus2 = this.nodes[this.path.pathFindingMarkedLinks[i].n2];
			this.sCanvasC.moveTo(cumulus1.x, cumulus1.y);		
			this.sCanvasC.lineTo(cumulus2.x, cumulus2.y);
		};
		this.sCanvasC.stroke();

		this.sCanvasC.beginPath();
		this.sCanvasC.lineWidth = 2 / this.zoom;
		this.sCanvasC.strokeStyle = "#A6E8FF";
		for (var i = this.path.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
			cumulus1 = this.nodes[this.path.pathFindingMarkedLinks[i].n1];
			cumulus2 = this.nodes[this.path.pathFindingMarkedLinks[i].n2];
			this.sCanvasC.moveTo(cumulus1.x, cumulus1.y);		
			this.sCanvasC.lineTo(cumulus2.x, cumulus2.y);
		};
		this.sCanvasC.stroke();
		this.sCanvasC.restore();
	}

	this.sCanvasC.restore();
};

Galaxy.prototype.drawGalaxyBackground = function() {
	if(this.loads.galaxy === true){
		var ctx = this.sCanvasC;
		var mult = 80;
		var multAlpha = Utils.transformRang(0.025, 0.075, this.zoom - 0.025, 0.7, 0);
		if(multAlpha < 0) multAlpha = 0;
		else if(multAlpha > 0.7) multAlpha = 0.7;

		ctx.save();

		ctx.globalAlpha *= multAlpha;
		this.sCanvasC.drawImage(ResourcesImg.g().get(this.images.finishedGalaxy), -37000, -26000, 1314 * mult, 1068 * mult);

		ctx.restore();
		//0.025 to 0.075
	}
};

Galaxy.prototype.generateNodesIcons = function() {
	var size = Utils.configuration.cumulusSize * this.zoom;
	var fakeSize = size;
	if(size > 250) size = 250;
	if(size < 2) size = 2;

	var size2 = size/2;
	var size3 = size/3;
	var ctx = this.cumulusIcon.ctx;
	var canvas = this.cumulusIcon.canvas;

	if(this.zoom < Utils.configuration.zoomToSmallCumulusIcon){
		var sizeTemp = 5;
		this.cumulusSize = sizeTemp;
		canvas.width = sizeTemp;
		canvas.height = sizeTemp;

		ctx.save();

		ctx.fillStyle = "#222";
		ctx.fillRect(0,0,sizeTemp,sizeTemp);

		ctx.fillStyle = "#ddd";
		ctx.fillRect(1,1,sizeTemp-2,sizeTemp-2);

		ctx.restore();
	}else{
		this.cumulusSize = fakeSize;
		canvas.width = size;
		canvas.height = size;

		ctx.clearRect(0,0,size, size);
		ctx.save();

		ctx.clearRect(0,0,size,size);

		ctx.beginPath();
		Utils.canvasPolygon(ctx, size2, size2, size2/1.8, 6, 0);
		ctx.strokeStyle = '#222';
		ctx.lineWidth = (size3 / 4.5 + 2);
		ctx.stroke();

		Utils.canvasPolygon(ctx, size2, size2, size2/3, 6, 0);
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.beginPath();
		//ctx.arc(size2, size2, size2/3, 0, 2 * Math.PI, false);
		Utils.canvasPolygon(ctx, size2, size2, size2/3, 6, 0);
		ctx.fillStyle = '#00c0ff';
		ctx.strokeStyle = '#dfdfdf';
		ctx.fill();
		ctx.beginPath();
		//ctx.arc(size2, size2, size2/1.8, 0, 2 * Math.PI, false);
		Utils.canvasPolygon(ctx, size2, size2, size2/1.8, 6, 0);
		ctx.lineWidth = size3 / 4.5;
		ctx.stroke();
		
		ctx.restore();
	}
};

Galaxy.prototype.startAutoZoom = function(node, initialZoom, finalZoom, duration, desX, desY, initialAlpha, finalAlpha, funct, functMode, finishFunction) {
	this.unbindEvents();
	this.requestStaticFrameFunction();

	if(initialZoom === null) initialZoom = this.zoom;

	this.animationData.cumulusOnZoom = node;
	this.animationData.initAutoZoomData.initialZoom = initialZoom;
	this.animationData.initAutoZoomData.finalZoom = finalZoom;
	this.animationData.initAutoZoomData.x = this.canvasTrasnform[4];
	this.animationData.initAutoZoomData.y = this.canvasTrasnform[5];
	this.animationData.initAutoZoomData.time = new Date().getTime();
	this.animationData.initAutoZoomData.duration = duration;
	this.animationData.initAutoZoomData.desX = desX;
	this.animationData.initAutoZoomData.desY = desY;

	this.animationData.initAutoZoomData.initialAlpha = initialAlpha;
	this.animationData.initAutoZoomData.finalAlpha = finalAlpha;
	this.animationData.initAutoZoomData.funct = funct;
	this.animationData.initAutoZoomData.functMode = functMode;
	this.animationData.initAutoZoomData.finishFunction = finishFunction;
};

Galaxy.prototype.endAutoZoom = function(bind) {
	if(bind) this.bindEvents();
	this.animationData.cumulusOnZoom = false;
	if(this.animationData.initAutoZoomData.finishFunction)
		this.animationData.initAutoZoomData.finishFunction();
};

Galaxy.prototype.autoZoom = function() {
	var finalZoom, initialZoom, animationTimeZoomEnd, date, zoom, animationCenter, globalAlpha;
	date = new Date().getTime() - this.animationData.initAutoZoomData.time;
	finalZoom = this.animationData.initAutoZoomData.finalZoom;

	animationTimeZoomEnd = this.animationData.initAutoZoomData.duration;

	if(this.animationData.cumulusOnZoom === null) animationCenter = {x: this.centerX, y: this.centerY};
	else animationCenter = {x: this.nodes[this.animationData.cumulusOnZoom].x, y: this.nodes[this.animationData.cumulusOnZoom].y};

	if(date < animationTimeZoomEnd){

		initialZoom = this.animationData.initAutoZoomData.initialZoom;

		zoom = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, initialZoom, finalZoom, this.animationData.initAutoZoomData.functMode);
		this.globalAlpha = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.initialAlpha, this.animationData.initAutoZoomData.finalAlpha, this.animationData.initAutoZoomData.functMode);

		this.globalAlpha = (this.globalAlpha > 1) ? 1 : (this.globalAlpha < 0) ? 0 : this.globalAlpha;

		this.canvasTrasnform[0] = this.zoom = zoom;
		this.canvasTrasnform[3] = this.zoom;
		this.canvasTrasnform[4] = this.desplacedX = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.x, -animationCenter.x * finalZoom + this.animationData.initAutoZoomData.desX, this.animationData.initAutoZoomData.functMode);
		this.canvasTrasnform[5] = this.desplacedY = this.animationData.initAutoZoomData.funct(0, animationTimeZoomEnd, date, this.animationData.initAutoZoomData.y, -animationCenter.y * finalZoom + this.animationData.initAutoZoomData.desY, this.animationData.initAutoZoomData.functMode);

	}else{
		this.globalAlpha = this.animationData.initAutoZoomData.finalAlpha;
		this.globalAlpha = (this.globalAlpha > 1) ? 1 : (this.globalAlpha < 0) ? 0 : this.globalAlpha;
		this.canvasTrasnform[0] = this.zoom = finalZoom;
		this.canvasTrasnform[3] = this.zoom;
		this.canvasTrasnform[4] = this.desplacedX = -animationCenter.x * finalZoom + this.animationData.initAutoZoomData.desX;
		this.canvasTrasnform[5] = this.desplacedY = -animationCenter.y * finalZoom + this.animationData.initAutoZoomData.desY;

		this.endAutoZoom(false);
		//this.startFollowPlanet(node, finalZoom, this.animationData.initAutoZoomData.desX, this.animationData.initAutoZoomData.desY);
	}

	this.generateNodesIcons();
	this.requestStaticFrameFunction();
};

Galaxy.prototype.moveTo = function(data1, data2, data3, data4) { //Usage (index, zoom, desX, desY) or (x, y, zoom)

	var x, y, zoom, desX, desY;

	if(arguments.length === 3){ //Si le pasamos un X e Y quiere decir que queremos poner el (0, 0) a X e Y respectivamente. Osea, modificamos el desplacedX y desplacedY
		zoom = data3;

		this.canvasTrasnform[4] = this.desplacedX = -this.centerX * zoom + data1;
		this.canvasTrasnform[5] = this.desplacedY = -this.centerY * zoom + data2;
	}else if(arguments.length === 4){ //Si le pasamos un index y un desX y desY quiere decir que queremos que nodes[index] esté en desX y desY
		zoom = data2;
		desX = data3;
		desY = data4;
		x = this.nodes[data1].x * zoom;
		y = this.nodes[data1].y * zoom;

		this.canvasTrasnform[4] = this.desplacedX = -x + desX;
		this.canvasTrasnform[5] = this.desplacedY = -y + desY;
	}

	this.canvasTrasnform[0] = this.zoom = zoom;
	this.canvasTrasnform[3] = this.zoom;

	this.requestStaticFrameFunction();
};

Galaxy.prototype.getPositionAndData = function(index) {
	if(index === null)
		return {x: this.centerX, y: this.centerY, zoom: this.zoom, desplacedX: this.desplacedX, desplacedY: this.desplacedY};
	else
		return {x: this.nodes[index].x, y: this.nodes[index].y, zoom: this.zoom, desplacedX: this.desplacedX, desplacedY: this.desplacedY};
};

Galaxy.prototype.checkCumulusHoverAndSetPointer = function(e) {
	Utils.getPointerCoordinates(e);
	var temp = this.isCumulus(Utils.mouseLocation.x, Utils.mouseLocation.y);
	if(temp !== false && Utils.actualStateCursorBlockedByInterface !== true){
		if(Utils.actualStateCursorBlockedByInterface !== true && Utils.actualStateCursor != Utils.enums.cursors.POINTER) {
			Utils.actualStateCursor = Utils.enums.cursors.POINTER;
			this.dCanvasD.style.cursor = "pointer";
		}
		if(this.dragData.hoverCumulus != temp){
			this.dragData.hoverCumulus = temp;
			this.requestStaticFrameFunction();
		}
	}else{
		if(Utils.actualStateCursorBlockedByInterface !== true && Utils.actualStateCursor != Utils.enums.cursors.NORMAl) {
			Utils.actualStateCursor = Utils.enums.cursors.NORMAl;
			this.dCanvasD.style.cursor = "";
		}
		if(this.dragData.hoverCumulus !== -1){
			this.dragData.hoverCumulus = -1;
			this.requestStaticFrameFunction();
		}
	}
};

Galaxy.prototype.isCumulus = function(mouseX, mouseY) {
	var cumulus, i;
	if(this.zoom < Utils.configuration.zoomToSmallCumulusIcon){
		for (i = this.nodes.length - 1; i >= 0; i--) {
			cumulus = this.nodes[i];
			if(Math.abs(cumulus.x * this.zoom + this.desplacedX - mouseX - 2) <= 3 && Math.abs(cumulus.y * this.zoom + this.desplacedY - mouseY - 2) <= 3 ){
				return i;
			}
		}
	}else{
		var s = this.cumulusSize;
		for (i = this.nodes.length - 1; i >= 0; i--) {
			cumulus = this.nodes[i];
			if(Math.abs(cumulus.x * this.zoom + this.desplacedX - mouseX) <= s && Math.abs(cumulus.y * this.zoom + this.desplacedY - mouseY) <= s){
				return i;
			}
		}
	}
	return false;
};

Galaxy.prototype.mapClick = function(x, y) {
	var cumulus = this.isCumulus(x, y);
	if(cumulus !== false && Utils.actualStateCursorBlockedByInterface !== true){
		//if(this.dragData.selectedCumulus != -1){ //Esto es para hacer una ruta
		//	this.findPath(this.dragData.selectedCumulus, cumulus);
		//}
		//Ahora toca llamar a quien dedice que se hace cuando se hace click en un cúmulo.
		this.handler.call(this.handlerContext, Utils.enums.galaxyActions.nodeClick, cumulus);

	}else{
		this.handler.call(this.handlerContext, Utils.enums.galaxyActions.voidClick, cumulus);
	}
	this.requestStaticFrameFunction();
};

Galaxy.prototype.selectCumulus = function(cumulus) {
	this.dragData.selectedCumulus = cumulus;
};

Galaxy.prototype.unselectCumulus = function() {
	this.dragData.selectedCumulus = -1;
};

Galaxy.prototype.findPath = function(cumulus1, cumulus2) {

	this.removeFoundPath();

	this.path.pathFindingCumulus[0] = cumulus1;
	this.path.pathFindingCumulus[1] = cumulus2;

	var way = this.pathFinding(cumulus1, cumulus2, []);

	if(way !== false){
		for (var i = way.length - 1; i >= 0; i--) {
			this.graph[way[i]].marked = true;
			this.path.pathFindingMarkedLinks.push(this.graph[way[i]]);
		}
	}

	//Calculamos las distancias para hacer la animación.
	this.animationData.pathFindingDistance = 0;
	this.animationData.pathFindingConnectionsDistances = [];
	var conn;
	var lenght = this.path.pathFindingMarkedLinks.length;
	for (var i = 0; i < lenght; i++) {
		var conn = this.path.pathFindingMarkedLinks[i];
		//this.animationData.pathFindingConnectionsDistances.push( Math.sqrt( (this.nodes[conn.n1].x - this.nodes[conn.n2].x)*(this.nodes[conn.n1].x - this.nodes[conn.n2].x) + (this.nodes[conn.n1].y - this.nodes[conn.n2].y)*(this.nodes[conn.n1].y - this.nodes[conn.n2].y) ) );
		this.animationData.pathFindingConnectionsDistances.push( Utils.distance(this.nodes[conn.n1].x, this.nodes[conn.n1].y, this.nodes[conn.n2].x, this.nodes[conn.n2].y) );
		this.animationData.pathFindingDistance += this.animationData.pathFindingConnectionsDistances[i];
	}
	this.animationData.pathFindingActualStart = this.dragData.selectedCumulus;
	this.animationData.pathFindingActualDistance = 0;
	//Fin de la parte para la animación
};

Galaxy.prototype.pathFinding = function(start, end, excluded) { //Dijkstra

	var self = this;

	start = this.nodes[start];
	end = this.nodes[end];

	for (var i = this.nodes.length - 1; i >= 0; i--) { //Borramos cualquier ratro de una ejecución anterior.
		this.nodes[i].pathFindingData = false;
	}
	/*Dijkstra Start*/
	start.pathFindingData = {referer: start.id, weight: 0, closed: false, refererConn: -1}; //iniciamos el primero
	var waitingFix = [start.id];
	var actual = start;
	var modifyNode = false;
	var tempWeight = 0;

	while(waitingFix.length > 0){

		actual.pathFindingData.closed = true;

		for (var i = actual.conn.length - 1; i >= 0; i--) {
			if(actual.conn[i].n1 === actual.id){
				modifyNode = this.nodes[actual.conn[i].n2];
			}else{
				modifyNode = this.nodes[actual.conn[i].n1];
			}

			if(modifyNode.pathFindingData === false){
				modifyNode.pathFindingData = { weight: -1, referer: -1, closed: false };
			}

			if(modifyNode.pathFindingData.closed === false && excluded.indexOf(modifyNode.id) === -1){
				tempWeight = actual.pathFindingData.weight + actual.conn[i].w;

				if(modifyNode.pathFindingData.weight > tempWeight || modifyNode.pathFindingData.weight === -1){
					modifyNode.pathFindingData.weight = tempWeight;
					modifyNode.pathFindingData.referer = actual.id;
					modifyNode.pathFindingData.refererConn = actual.conn[i].id;
				}

				if(waitingFix.indexOf(modifyNode.id) === -1) waitingFix.push(modifyNode.id);
			}
		}

		waitingFix.shift();

		waitingFix.sort(function (a, b) {
			return self.nodes[a].pathFindingData.weight - self.nodes[b].pathFindingData.weight;
		});

		actual = this.nodes[ waitingFix[0] ];
	};
	/*Dijkstra End*/
	/*En teoría con esto ya están resueltas las referencias. Ahora lo que haremos es sacar la ruta partiendo de end.*/

	var cumulusCuantity = this.nodes.length;
	var temp = 0;
	var way = [];
	actual = end;

	if(actual.pathFindingData === false) return false;

	while(actual.id != start.id && temp <= cumulusCuantity){
		way.push(actual.pathFindingData.refererConn);
		actual = this.nodes[actual.pathFindingData.referer];
		temp++;
	}; //Y con esto en teoría ya tenemos el camino... Veremos a ver que sale.



	return way; //Pd: Funciona!
};

Galaxy.prototype.removePathFindingMarkedLinks = function() {
	//Borramos los links marcados.
	for (var i = this.path.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
		this.path.pathFindingMarkedLinks[i].marked = false;
	}
	//borramos el vector de los links marcados
	this.path.pathFindingMarkedLinks = [];
};

Galaxy.prototype.removeFoundPath = function() {
	this.animationData.pathFindingDistance = 0;
	this.removePathFindingMarkedLinks();
};

Galaxy.prototype.pathIndicatorAnimation = function() {
	var percentage = EaseAnimation.makeEaseInOut("quad")( this.animationData.pathFindingActualDistance / this.animationData.pathFindingDistance );
	var actualDistance = this.animationData.pathFindingDistance * percentage;
	//var size = Utils.sizeZoomRanges(Utils.configuration.maxGalaxyZoom, Utils.configuration.minGalaxyZoom, this.zoom, 50, 2);

	this.animationData.pathFindingActualDistance += this.animationData.pathFindingDistance * 0.005;
	if(this.animationData.pathFindingActualDistance > this.animationData.pathFindingDistance) this.animationData.pathFindingActualDistance = 0.0001;

	var points = this.getPointOfPath(actualDistance); //[0]: x, [1]: y, [2]: rad




	this.dCanvasC.save();


	//Utils.canvasPolygon(this.dCanvasC, points[0], points[1], size, 3, points[2]);
	
	var size = this.cumulusSize / 2;

	if(size < 10){
		size = 10;
	}else{
		size = size;
	}
		this.dCanvasC.fillStyle = "#000";
		this.dCanvasC.beginPath();
		this.dCanvasC.arc(points[0], points[1], (size / 2) / this.zoom, 0, 2*Math.PI, false);
		//Utils.canvasPolygon(this.dCanvasC, points[0], points[1], (size/2) / this.zoom, 3, points[2]);
		this.dCanvasC.fill();

		this.dCanvasC.fillStyle = "#fff";
		this.dCanvasC.beginPath();
		this.dCanvasC.arc(points[0], points[1], (size / 2 - 1) / this.zoom, 0, 2*Math.PI, false);
		//Utils.canvasPolygon(this.dCanvasC, points[0], points[1], (size/2 - 1) / this.zoom, 3, points[2]);
		this.dCanvasC.fill();


	this.dCanvasC.restore();

};

Galaxy.prototype.getPointOfPath = function(actualDistance) {

	if(actualDistance < 0) return false;

	var acumulative = 0;
	var index = 0;

	while(acumulative < actualDistance){
		acumulative += this.animationData.pathFindingConnectionsDistances[index];
		index++;
	}
	if(index > 0) index--;

	acumulative -= this.animationData.pathFindingConnectionsDistances[index];
	var distance = this.animationData.pathFindingConnectionsDistances[index];

	/*percentage = (this.animationData.pathFindingActualDistance - acumulative) / this.animationData.pathFindingConnectionsDistances[index];*/
	distance = (actualDistance - acumulative);

	//tenemos el índice y el porcentaje dentro del rango. Pasamos a sacar la posición X e Y

	var conn1, conn2, conn = this.path.pathFindingMarkedLinks[index];

	//Detectar el orden de n1 y n2
	if(this.path.pathFindingMarkedLinks.length > 1){
		if(index === 0){
			if(conn.n2 === this.path.pathFindingMarkedLinks[1].n1 || conn.n2 === this.path.pathFindingMarkedLinks[1].n2){
				conn1 = conn.n1;
				conn2 = conn.n2;
			}else{
				conn1 = conn.n2;
				conn2 = conn.n1;
			}
		}else{
			if(conn.n1 === this.path.pathFindingMarkedLinks[index-1].n1 || conn.n1 === this.path.pathFindingMarkedLinks[index-1].n2){
				conn1 = conn.n1;
				conn2 = conn.n2;
			}else{
				conn1 = conn.n2;
				conn2 = conn.n1;
			}
		}
	}else{ //Solo hay una conexión, pasamos a comprobar cual es al conexión de inicio.
		if(conn.n1 === this.animationData.pathFindingActualStart){
			conn1 = conn.n1;
			conn2 = conn.n2;
		}else{
			conn1 = conn.n2;
			conn2 = conn.n1;
		}
	}

	var rad = Math.atan2(this.nodes[conn2].y - this.nodes[conn1].y, this.nodes[conn2].x - this.nodes[conn1].x);

	var x = distance * Math.cos(rad) + this.nodes[conn1].x;
	var y = distance * Math.sin(rad) + this.nodes[conn1].y;

	return [x, y, rad];
};