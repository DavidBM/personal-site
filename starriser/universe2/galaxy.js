"use strict";
var Galaxy = function (sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, background, Handler, handlerContext, eventHandler) {
	this.init(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, background, Handler, handlerContext, eventHandler);
};

Galaxy.prototype.init = function(sCanvasDom, dCanvasDom, sCanvasCtx, dCanvasCtx, background, Handler, handlerContext, eventHandler) { //Initialize variables. Wait for draw calls or what-is-there calls
	this.data = {};
	this.sCanvasD = sCanvasDom;
	this.dCanvasD = dCanvasDom;

	this.sCanvasC = sCanvasCtx;
	this.dCanvasC = dCanvasCtx;

	this.handler = Handler;
	this.handlerContext = handlerContext;
	this.background = background;
	this.eventHandler = eventHandler;

	this.positionBackground = this.background.style.backgroundPosition.split(" ");
	this.positionBackground[0] = parseInt(this.positionBackground[0], 10);
	this.positionBackground[1] = parseInt(this.positionBackground[1], 10);

	this.canvasWidth = this.dCanvasD.width;
	this.canvasHeight = this.dCanvasD.height;

	this.zoom = 0.5;
	this.desplacedX = this.canvasWidth / 2 - 30000 * this.zoom / 2;
	this.desplacedY = this.canvasHeight / 2 - 30000 * this.zoom / 2;

	this.dragData = {};
	this.dragData.moveCounter = 0;
	this.dragData.mouseDown = false;
	this.dragData.dragOn = false;
	this.dragData.moveInterval = 0;
	this.dragData.initialMousePosition = {x: 0, y: 0};
	this.dragData.originalDesplaced = {x: 0, y: 0};
	this.dragData.initialBackgroundPosition = {x: 0, y: 0};
	this.dragData.cursorType = Utils.enums.cursors.NORMAL;
	this.dragData.hoverCumulus = -1;
	this.dragData.selectedCumulus = -1;
	this.dragData.multitouch = false;
	this.dragData.multitouchFingerOriginalDistance = 0;
	this.dragData.multitouchOriginalZoom = 0;
	this.dragData.multitouchLastStep = 0;

	this.animationData = {};
	this.animationData.pathFindingDistance = 0;
	this.animationData.pathFindingConnectionsDistances = [];
	this.animationData.pathFindingActualStart = 0;
	this.animationData.pathFindingActualDistance = new Date();

	this.path = {};
	this.path.pathFindingCumulus = [0, 0];
	this.path.pathFindingMarkedLinks = [];

	this.requestStaticFrame = true;

	this.cumulusIcon = {
		canvas: document.createElement('canvas')
	};
	this.cumulusIcon.ctx = this.cumulusIcon.canvas.getContext('2d');
	this.cumulusSize = 0;
	this.generateCumulusIcons();

	this.requestStaticFrameFunction();

};

Galaxy.prototype.setData = function(data) {
	this.graph = data.graph;
	this.nodes = data.nodes;
	var i;

	//Adaptando datos
	for (i = this.nodes.length - 1; i >= 0; i--) {
		this.nodes[i].conn = [];
	}

	for (i = this.graph.length - 1; i >= 0; i--) {
		this.nodes[this.graph[i].n1].conn.push(this.graph[i]);
		this.nodes[this.graph[i].n2].conn.push(this.graph[i]);
	}

	this.cumulusPositionCache = new Array(this.nodes.length);
	for (i = this.cumulusPositionCache.length - 1; i >= 0; i--) {
		this.cumulusPositionCache[i] = {x: 0, y: 0};
	}
	this.updateCumulusPositions();
};

Galaxy.prototype.setCanvasSize = function(w, h) {
	this.canvasWidth = w;
	this.canvasHeight = h;
};

Galaxy.prototype.bindEvents = function() {
	var self = this;

	$(this.dCanvasD).bind('mousedown.galaxy touchstart.galaxy', function (e) {
		e.preventDefault();
	});

	this.eventHandler.bind("drag", this.dCanvasD, function (data, event) {
		self.moveSystem(data.pageX, data.pageY);
	});
	this.eventHandler.bind("click", this.dCanvasD, function (data, event) {
		self.mapClick(data.pageX, data.pageY);
	});

	this.eventHandler.bind("resize", this.dCanvasD, function (data, event) {
		//console.log(data.factor + " | (" + data.fingers[0] + ", " + data.fingers[1] + ") | (" + data.fingers[2] + ", " + data.fingers[3] + ")");
		self.zoomSystem(data.factor, data.center[0], data.center[1]);
	});

	$(this.dCanvasD).bind('mousemove', function (e) {
		self.checkCumulusHoverAndSetPointer(e);
	});
};

/*Galaxy.prototype.unbindEvents = function() {
	this.dom.dCanvas.unbind('.galaxy');
	$(document).unbind('.galaxy');
};*/


Galaxy.prototype.moveSystem = function(desplacedX, desplacedY) {

	this.desplacedX += desplacedX;
	this.desplacedY += desplacedY;

	this.updateCumulusPositions();
	this.requestStaticFrameFunction();

	this.parallaxScrolling(this.positionBackground[0] += desplacedX / 10, this.positionBackground[1] += desplacedY / 10);

	return 0;
};

Galaxy.prototype.zoomSystem = function(growth, x, y) { 

	var zoom = this.zoom * growth

	if(zoom > Utils.configuration.maxGalaxyZoom) zoom = Utils.configuration.maxGalaxyZoom;
	else if(zoom < Utils.configuration.minGalaxyZoom) zoom = Utils.configuration.minGalaxyZoom;

	growth = zoom / this.zoom;

	this.zoom *= growth;
	this.desplacedX += (x - this.desplacedX) - (x - this.desplacedX) * growth;
	this.desplacedY += (y - this.desplacedY) - (y - this.desplacedY) * growth;
		

	this.generateCumulusIcons();
	this.requestStaticFrameFunction();
	this.updateCumulusPositions();
};

Galaxy.prototype.updateCumulusPositions = function() {
	for (var i = this.cumulusPositionCache.length - 1; i >= 0; i--) {
		this.cumulusPositionCache[i].x = Math.round((this.nodes[i].x * this.zoom + this.desplacedX));
		this.cumulusPositionCache[i].y = Math.round((this.nodes[i].y * this.zoom + this.desplacedY));
	}
};

Galaxy.prototype.requestStaticFrameFunction = function() {
	this.requestStaticFrame = true;
	this.handler.call(this.handlerContext, Utils.enums.galaxyActions.requestStaticFrameFunction);
};

Galaxy.prototype.draw = function(force) {

	if(this.requestStaticFrame || force){
		this.drawSystemCumulusLinks();
		this.drawSystemCumulus();
	}

	this.requestStaticFrame = false;

	//Dinamic part

	if(this.animationData.pathFindingDistance !== 0){
		this.pathIndicatorAnimation();
	}

};

Galaxy.prototype.drawSystemCumulus = function() {

	var s, s2, cumulusImage;

	s = this.cumulusSize;
	s2 = Math.round(s / 2 );
	cumulusImage = this.cumulusIcon.canvas;
	
	this.sCanvasC.save();
	this.sCanvasC.font = "8pt Arial";
	this.sCanvasC.lineWidth = 0.2;

	for (var i = this.cumulusPositionCache.length - 1; i >= 0; i--) {
		if(
			this.cumulusPositionCache[i].x + s2 > 0 &&
			this.cumulusPositionCache[i].x - s2 < this.canvasWidth &&
			this.cumulusPositionCache[i].y + s2 > 0 &&
			this.cumulusPositionCache[i].y - s2 < this.canvasHeight){

			if(this.dragData.selectedCumulus === i){
				this.sCanvasC.save();
				this.sCanvasC.strokeStyle = "#C7F1FC";
				this.sCanvasC.lineWidth = 3;
				this.sCanvasC.fillStyle = "rgba(255, 0, 0, 0.2)";

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.5, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.2, 6, 0);
				this.sCanvasC.fill();

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.5, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.2, 6, 0);
				this.sCanvasC.stroke();

				this.sCanvasC.restore();
			}else if(this.dragData.hoverCumulus === i){
				this.sCanvasC.save();
				this.sCanvasC.strokeStyle = "#C7F1FC";
				this.sCanvasC.lineWidth = 3;

				this.sCanvasC.beginPath();
				//this.sCanvasC.arc(this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.8, 0, Math.PI * 2, false);
				Utils.canvasPolygon(this.sCanvasC, this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y, Utils.configuration.cumulusSize * this.zoom / 1.5, 6, 0);
				this.sCanvasC.stroke();

				this.sCanvasC.restore();
			}

			this.sCanvasC.drawImage(
				cumulusImage,
				this.cumulusPositionCache[i].x - s2,
				this.cumulusPositionCache[i].y - s2,
				s,
				s
			);

			/*if(this.eventsnodesNumbersDrawFlag){
				this.sCanvasC.fillText(i, this.cumulusPositionCache[i].x, this.cumulusPositionCache[i].y);
			}*/
		}
	}
	this.sCanvasC.restore();

};

Galaxy.prototype.drawSystemCumulusLinks = function() {

	var multiplier, cumulus1, cumulus2, temp;

	multiplier = (this.zoom * 10 < 0.5) ? this.zoom * 10 : 0.5 ;
	if(multiplier > 1) multiplier = 1;

	this.sCanvasC.save();
	this.sCanvasC.lineWidth = 1 * multiplier;
	this.sCanvasC.strokeStyle = "#F5FFCE";
	this.sCanvasC.beginPath();

	for (var i = this.graph.length - 1; i >= 0; i--) {
		//if(this.graph[i].marked === false){
			cumulus1 = this.cumulusPositionCache[this.graph[i].n1];
			cumulus2 = this.cumulusPositionCache[this.graph[i].n2];
			this.sCanvasC.moveTo(cumulus1.x, cumulus1.y);
			this.sCanvasC.lineTo(cumulus2.x, cumulus2.y);
		//}
	}

	this.sCanvasC.stroke();


	if(this.path.pathFindingMarkedLinks.length > 0){
		this.sCanvasC.save();
		this.sCanvasC.lineWidth = 2;
		this.sCanvasC.strokeStyle = "#4688A0";
		this.sCanvasC.beginPath();

		for (var i = this.path.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
			cumulus1 = this.cumulusPositionCache[this.path.pathFindingMarkedLinks[i].n1];
			cumulus2 = this.cumulusPositionCache[this.path.pathFindingMarkedLinks[i].n2];
			this.sCanvasC.moveTo(cumulus1.x, cumulus1.y);		
			this.sCanvasC.lineTo(cumulus2.x, cumulus2.y);
		};
		this.sCanvasC.stroke();
		this.sCanvasC.restore();
	}

	this.sCanvasC.restore();
};

Galaxy.prototype.generateCumulusIcons = function() {
	var size = Utils.configuration.cumulusSize * this.zoom;
	if(size > 250) size = 250;
	if(size < 2) size = 2;

	var size2 = size/2;
	var size3 = size/3;
	var ctx = this.cumulusIcon.ctx;
	var canvas = this.cumulusIcon.canvas;

	if(this.zoom < Utils.configuration.zoomToSmallCumulusIcon){
		this.cumulusSize = 2;
		canvas.width = 2;
		canvas.height = 2;

		ctx.save();
		ctx.fillStyle = "#ddd";
		ctx.fillRect(0,0,2,2);
		ctx.restore();
	}else{
		this.cumulusSize = size;
		canvas.width = size;
		canvas.height = size;
		ctx.save();

		ctx.clearRect(0,0,size,size);
		ctx.beginPath();
		//ctx.arc(size2, size2, size2/3, 0, 2 * Math.PI, false);
		Utils.canvasPolygon(ctx, size2, size2, size2/3, 6, 0);
		ctx.fillStyle = '#00c0ff';
		ctx.strokeStyle = '#dfdfdf';
		ctx.fill();
		ctx.beginPath();
		//ctx.arc(size2, size2, size2/1.8, 0, 2 * Math.PI, false);
		Utils.canvasPolygon(ctx, size2, size2, size2/1.8, 6, 0);
		ctx.lineWidth = size3/4.5;
		ctx.stroke();
		
		ctx.restore();
	}
};

Galaxy.prototype.parallaxScrolling = function(x, y) {
	this.positionBackground[0] = x;
	this.positionBackground[1] = y;

	this.background.style.backgroundPosition = this.positionBackground[0] + "px " + this.positionBackground[1] + "px";
};

Galaxy.prototype.checkCumulusHoverAndSetPointer = function(e) {
	Utils.getPointerCoordinates(e);
	var temp = this.isCumulus(Utils.mouseLocation.x, Utils.mouseLocation.y);
	if(temp !== false){
		if(this.dragData.cursorType != Utils.enums.cursors.POINTER) {
			this.dragData.cursorType = Utils.enums.cursors.POINTER;
			this.dCanvasD.style.cursor = "pointer";
		}
		if(this.dragData.hoverCumulus != temp){
			this.dragData.hoverCumulus = temp;
			this.requestStaticFrameFunction();
		}
	}else{
		if(this.dragData.cursorType != Utils.enums.cursors.NORMAl) {
			this.dragData.cursorType = Utils.enums.cursors.NORMAl;
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
				//console.log("Cumulus selected: " + i);
				return i;
			}
		}
	}else{
		var s = this.cumulusSize;
		for (i = this.nodes.length - 1; i >= 0; i--) {
			cumulus = this.nodes[i];
			if(Math.abs(cumulus.x * this.zoom + this.desplacedX - mouseX) <= s && Math.abs(cumulus.y * this.zoom + this.desplacedY - mouseY) <= s){
				//console.log("Cumulus selected: " + i);
				return i;
			}
		}
	}
	return false;
};

Galaxy.prototype.mapClick = function(x, y) {
	var cumulus = this.isCumulus(x, y);
	if(cumulus !== false){
		//if(this.dragData.selectedCumulus != -1){ //Esto es para hacer una ruta
		//	this.findPath(this.dragData.selectedCumulus, cumulus);
		//}
		//Ahora toca llamar a quien dedice que se hace cuando se hace click en un cúmulo.
		this.handler.call(this.handlerContext, Utils.enums.galaxyActions.cumulusClick, cumulus);

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
		this.animationData.pathFindingConnectionsDistances.push( Math.sqrt( (this.nodes[conn.n1].x - this.nodes[conn.n2].x)*(this.nodes[conn.n1].x - this.nodes[conn.n2].x) + (this.nodes[conn.n1].y - this.nodes[conn.n2].y)*(this.nodes[conn.n1].y - this.nodes[conn.n2].y) ) );
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
	var percentage = Utils.easeInOutCuad( this.animationData.pathFindingActualDistance / this.animationData.pathFindingDistance );
	var actualDistance = this.animationData.pathFindingDistance * percentage;
	var size = Utils.sizeZoomRanges(Utils.configuration.maxGalaxyZoom, Utils.configuration.minGalaxyZoom, this.zoom, 50, 2);

	if(this.animationData.pathFindingMultiPointerCounter % 10)
	for (var i = this.animationData.pathFindingMultiPointer.length - 1; i >= 1; i--) {
		this.animationData.pathFindingMultiPointer[i] = this.animationData.pathFindingMultiPointer[i-1];
	}

	this.animationData.pathFindingActualDistance += this.animationData.pathFindingDistance * 0.005;
	if(this.animationData.pathFindingActualDistance > this.animationData.pathFindingDistance) this.animationData.pathFindingActualDistance = 0.0001;

	var points = this.getPointOfPath(actualDistance); //[0]: x, [1]: y, [2]: rad




	this.dCanvasC.save();

	this.dCanvasC.fillStyle = "#fff";

	this.dCanvasC.beginPath();
	this.dCanvasC.arc(points[0], points[1], size, 0, 2*Math.PI, false);
	//Utils.canvasPolygon(this.dCanvasC, points[0], points[1], size, 3, points[2]);

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

	x = x * this.zoom + this.desplacedX;
	y = y * this.zoom + this.desplacedY;

	return [x, y, rad];
};