"use strict";

var Utils = {};
Utils.configuration = {};
Utils.configuration.maxGalaxyZoom = 2;
Utils.configuration.minGalaxyZoom = 0.01;
Utils.configuration.maxCumulusZoom = 1;
Utils.configuration.minCumulusZoom = 0.07;
Utils.configuration.maxSystemZoom = 0.065;
Utils.configuration.maxSystemZoom = 5;
Utils.configuration.minSystemZoom = 0.003;
Utils.configuration.cumulusSize = 200;
Utils.configuration.zoomToSmallCumulusIcon = 0.038;
Utils.configuration.systemsInCumulus = 35;
Utils.configuration.jumpColor = ["#ffffff", "#e8f9fe", "#c4f0fe", "#9ce6fe", "#72dcfc", "#50d3f7", "#3acded", "#37cbdf", "#46cfc7", "#62d7a9", "#85e189", "#a9e46a", "#cbe44e", "#e2e43a", "#efd830", "#f2bf30", "#f2a030", "#f27e30", "#f25e30", "#f24330", "#f23130"];
Utils.configuration.maxJumpColorShow = 10;
Utils.configuration.distanceColorJump = Math.floor(Utils.configuration.jumpColor.length / Utils.configuration.maxJumpColorShow);
Utils.configuration.orbitsColors = ["#402c2c", "#3e2e2c", "#3c302c", "#38342c", "#36382c", "#323c2c", "#303e2c", "#2c402c", "#2c402c", "#2c3e30", "#2c3c32", "#2c3836", "#2c3438", "#2c303c", "#2c2e3e"];
Utils.configuration.selectedOrbitsColors = ["#720b0b", "#67160b", "#5c1e0b", "#47310b", "#3c470b", "#295c0b", "#1e670b", "#0b720b", "#0b720b", "#0b671e", "#0b5c29", "#0b473c", "#0b3147", "#0b1e5c", "#0b1667"];

Utils.enums = {};
Utils.enums.zoneWorkMode = {GALAXY: 0, CUMULUS: 1, SYSTEM: 2, PLANET: 3, ZOOM: 4};
Utils.enums.galaxyActions = {requestStaticFrameFunction: 0, nodeClick: 1, voidClick: 2, contextMenu: 3, parallaxScrolling: 4};

Utils.enums.cumulusActions = {requestStaticFrameFunction: 0, nodeClick: 1, voidClick: 2, contextMenu: 3, parallaxScrolling: 4};

Utils.enums.systemActions = {requestStaticFrameFunction: 0, nodeClick: 1, voidClick: 2, contextMenu: 3, parallaxScrolling: 4};
Utils.enums.zoomLevels = {galaxy: 0, cumulus: 1, system: 2, planet: 3};
Utils.enums.interfaceActions = {zoom: 0, getState: 1, scrollPlanetInterface: 2, pause: 3, unPause: 4, hiddeWindow: 5, unhideWindow: 6, assistantOpen: 7, stopCanvasRefresh: 8, startCanvasRefresh: 9, getSelectedPlanet: 10};
Utils.enums.interfaceButtonAction = {COLONIZE: 0, MESSAGE: 1, DEPLOY: 2, SEND: 3, ATACK: 4, BLOCK: 5, OCCUPY: 6, SPY: 7, INFO: 8};

Utils.enums.assistants = {militar: 0, civil: 1, diplomatic: 2, commercial: 3, tecnologic: 4};

Utils.enums.cursors = {NORMAL: 0, POINTER: 1, MOVE: 2};
Utils.actualStateCursor = -1;
Utils.actualStateCursorBlocked = false;

Utils.conversions = {};

Utils.conversions.routeToBuildingImages = "content/img/buildingsImages";
Utils.conversions.buildingNames = [
	"Centro de mando",
	"Almacenes",
	"Extractores",
	"Sintetizador",
	"Astillero estelar",
	"Puerto estelar",
	"Central electrica",
	"Centro de espionaje",
	"Centro de investigación"
];


Utils.transformRang = function(R1I, R1F, P, R2I, R2F){ //Transform one point in a rang to other rang
	return (P / (R1F - R1I)) * (R2F - R2I) + R2I;
};
Utils.transformRangEaseIn = function(R1I, R1F, P, R2I, R2F, ease){ //Transform one point in a rang to other rang
	return EaseAnimation[ease](P / (R1F - R1I)) * (R2F - R2I) + R2I;
};
Utils.transformRangEaseOut = function(R1I, R1F, P, R2I, R2F, ease){ //Transform one point in a rang to other rang
	return EaseAnimation.makeEaseOut(ease)(P / (R1F - R1I)) * (R2F - R2I) + R2I;
};
Utils.transformRangEaseInOut = function(R1I, R1F, P, R2I, R2F, ease){ //Transform one point in a rang to other rang
	var funct = EaseAnimation.makeEaseInOut(ease);
	return EaseAnimation.makeEaseInOut(ease)(P / (R1F - R1I)) * (R2F - R2I) + R2I;
};
Utils.distance = function(x1, y1, x2, y2){
	return Math.sqrt( (x1-x2)*(x1-x2) + (y1-y2)*(y1-y2) );
};
/*Utils.sizeZoomRanges = function(maxZoom, minZoom, zoom, maxRange, minRange){
	return (zoom / (maxZoom - minZoom)) * (maxRange - minRange) + minRange;
};*/
Utils.drawEllipse = function(ctx, x, y, w, h, rad, desp) {
	var xp = desp;
	x = x - w/2;
	y = y - h/2;
	var kappa = 0.5522848,
	ox = (w / 2) * kappa,	// control point offset horizontal
	oy = (h / 2) * kappa,	// control point offset vertical
	xe = x + w,				// x-end
	ye = y + h,				// y-end
	xm = x + w / 2,			// x-middle
	ym = y + h / 2;			// y-middle

	ctx.rotate(-rad);

	ctx.beginPath();
	ctx.moveTo(x - xp, ym);
	ctx.bezierCurveTo(x - xp		, ym - oy	, xm - ox	- xp	, y			, xm - xp	, y);
	ctx.bezierCurveTo(xm + ox - xp	, y			, xe - xp			, ym - oy	, xe - xp	, ym);
	ctx.bezierCurveTo(xe - xp		, ym + oy	, xm + ox	- xp	, ye		, xm - xp	, ye);
	ctx.bezierCurveTo(xm - ox - xp	, ye		, x	- xp			, ym + oy	, x	- xp	, ym);
	ctx.closePath();

	ctx.rotate(rad);

};
Utils.getPointEllipse = function (rad, a, b, x, y) { //http://math.stackexchange.com/questions/22064/calculating-a-point-that-lies-on-an-ellipse-given-an-angle
	var pX = a * Math.cos(rad);
	var pY = b * Math.sin(rad);
	return [pX + x, pY + y];
};
Utils.getPointEllipsePolarAngle = function (rad, a, b, desx, desy, ellipseRotation) { //http://math.stackexchange.com/questions/22064/calculating-a-point-that-lies-on-an-ellipse-given-an-angle
	desx = desx - a;
	desy = desy - b;
	var xpi, ypi;
	var pX = (a*b) / ( Math.sqrt( b*b + (a*a)*(Math.tan(rad)*Math.tan(rad)) ) );
	var pY = (a*b*Math.tan(rad)) / ( Math.sqrt( b*b + (a*a)*(Math.tan(rad)*Math.tan(rad)) ) );

	if(rad > Math.PI/2 && rad < 1.5 * Math.PI){
		pX = -pX;
		pY = -pY;
	}

	xpi = pX * Math.cos(ellipseRotation) - pY * Math.sin(ellipseRotation);
	ypi = pX * Math.sin(ellipseRotation) + pY * Math.cos(ellipseRotation);

	/*xpi = ((pX - desx) * Math.cos(ellipseRotation)) - ((desy - pY) * Math.sin(ellipseRotation)) + desx;
	ypi = ((desy - pY) * Math.cos(ellipseRotation)) - ((pX - desx) * Math.sin(ellipseRotation)) + desy;*/

	return [xpi + desx, ypi + desy];
};
Utils.canvasPolygon = function(cxt, Xcenter, Ycenter, radius, numberOfSides, rotation) {
	var size = radius;
	cxt.beginPath();
	cxt.moveTo (Xcenter +  size * Math.cos(rotation), Ycenter +  size *  Math.sin(rotation));

	for (var i = 1; i <= numberOfSides;i += 1) {
		cxt.lineTo (Xcenter + size * Math.cos(rotation + i * (2 * Math.PI / numberOfSides)), Ycenter + size * Math.sin(rotation + i * (2 * Math.PI / numberOfSides)));
	}
	cxt.closePath();
};
Utils.getRandomInt = function (min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
};
Utils.getRandomArbitary = function (min, max) {
	return Math.random() * (max - min) + min;
};
Utils.suffle = function (array) {
	var tmp, current, top = array.length;

	if(top) while(--top) {
		current = Math.floor(Math.random() * (top + 1));
		tmp = array[current];
		array[current] = array[top];
		array[top] = tmp;
	}

	return array;
};
Utils.mouseLocation = {x: 0, y: 0, type: ""};
Utils.getPointerCoordinates = function (e) {
	if(e.originalEvent.touches){
		if(e.type == "touchend"){
			this.mouseLocation.x = e.originalEvent.changedTouches[0].pageX;
			this.mouseLocation.y = e.originalEvent.changedTouches[0].pageY;
			this.mouseLocation.type = e.type;
		}else{
			this.mouseLocation.x = e.originalEvent.touches[0].pageX;
			this.mouseLocation.y = e.originalEvent.touches[0].pageY;
			this.mouseLocation.type = e.type;
		}
	}else{
		this.mouseLocation.x = e.pageX;
		this.mouseLocation.y = e.pageY;
		this.mouseLocation.type = e.type;
	}
};
Utils.setPointerCoordinates = function (x, y, type) {
	this.mouseLocation.x = x;
	this.mouseLocation.y = y;
	this.mouseLocation.type = type;
};
Utils.isMultitouch = function (e) {
	if(e.originalEvent.touches && e.originalEvent.touches.length > 1) return true;
	else return false;
};
Utils.getMultitouchPointers = function (e) {
	if(e.originalEvent.touches){
		var touchesPositions = new Array(e.originalEvent.touches.length);
		for (var i = e.originalEvent.touches.length - 1; i >= 0; i--) {
			touchesPositions[i] = [e.originalEvent.touches[i].pageX, e.originalEvent.touches[i].pageY];
		}
		return touchesPositions;
	}else
	return false;
};
Utils.lineIntersect = function(x1,y1,x2,y2, x3,y3,x4,y4) {
	var x=((x1*y2-y1*x2)*(x3-x4)-(x1-x2)*(x3*y4-y3*x4))/((x1-x2)*(y3-y4)-(y1-y2)*(x3-x4));
	var y=((x1*y2-y1*x2)*(y3-y4)-(y1-y2)*(x3*y4-y3*x4))/((x1-x2)*(y3-y4)-(y1-y2)*(x3-x4));
	if (isNaN(x)||isNaN(y)) {
		return false;
	}else if(x3 == x1 || x2 == x4 || x2 == x3 || x1 == x4){
		return false;
	} else {
		if (x1>=x2) {
			if (!(x2<=x&&x<=x1)) {return false;}
		} else {
			if (!(x1<=x&&x<=x2)) {return false;}
		}
		if (y1>=y2) {
			if (!(y2<=y&&y<=y1)) {return false;}
		} else {
			if (!(y1<=y&&y<=y2)) {return false;}
		}
		if (x3>=x4) {
			if (!(x4<=x&&x<=x3)) {return false;}
		} else {
			if (!(x3<=x&&x<=x4)) {return false;}
		}
		if (y3>=y4) {
			if (!(y4<=y&&y<=y3)) {return false;}
		} else {
			if (!(y3<=y&&y<=y4)) {return false;}
		}
	}
	return true;
};
Utils.getWindowSize = function(element) {
	var myWidth = 0, myHeight = 0;
	if(typeof element === "undefined"){
		if( typeof( window.innerWidth ) == 'number' ) {
			//Non-IE
			myWidth = window.innerWidth;
			myHeight = window.innerHeight;
		} else if( document.documentElement && ( document.documentElement.clientWidth || document.documentElement.clientHeight ) ) {
			//IE 6+ in 'standards compliant mode'
			myWidth = document.documentElement.clientWidth;
			myHeight = document.documentElement.clientHeight;
		}
	}else{
		myWidth = element.offsetWidth;
		myHeight = element.offsetHeight;
	}
	return {x: myWidth, y: myHeight};
};

Utils.isArray = function (data) {
	return Object.prototype.toString.call(data) === "[object Array]";
};

Utils.isObject = function (data) {
	return Object.prototype.toString.call(data) === "[object Object]";
};

Utils.getHiddenElementSize = function (element) {
	var display, visibility, position, top, left, w, h;

	element = element.cloneNode();

	element.style.display = "block";
	element.style.visibility = "hidden";
	element.style.position = "absolute";
	element.style.top = "-10000px";
	element.style.left = "-10000px";

	document.body.appendChild(element);
	w = element.offsetWidth;
	h = element.offsetHeight;

	document.body.removeChild(element);

	return {w: w, h: h};
};

Utils.parseTime = function (time) {
	var tiempo = Math.round(time);
	var tiempo_texto = "";
	var dias, horas, tiempo_texto, minutos, segundos;

	if(tiempo > 86400){
		dias = parseInt(tiempo/86400);
		horas = tiempo%86400;
		horas = parseInt(horas/3600);
		
		tiempo_texto = dias + "d " + horas+"h";
	}else if(tiempo > 3600){
		horas = parseInt(tiempo/3600);
		minutos = tiempo%3600;
		minutos = parseInt(minutos/60);
		
		tiempo_texto = horas+"h "+minutos+"m";
	}else if(tiempo > 60){
		minutos = parseInt(tiempo/60);
		segundos = tiempo%60;
		tiempo_texto = minutos+"m "+segundos+"s";

	}else{ 
		tiempo_texto = tiempo +"s";
	}

	return tiempo_texto;
};

Utils.pathFinding = function(start, end, excluded, nodes) { //Dijkstra

	start = nodes[start];
	end = nodes[end];

	for (var i = nodes.length - 1; i >= 0; i--) { //Borramos cualquier ratro de una ejecución anterior.
		nodes[i].pathFindingData = false;
	}
	/*Dijkstra Start*/
	start.pathFindingData = {referer: start.in, weight: 0, closed: false, refererConn: -1}; //iniciamos el primero
	var waitingFix = [start.in];
	var actual = start;
	var modifyNode = false;
	var tempWeight = 0;

	while(waitingFix.length > 0){

		actual.pathFindingData.closed = true;

		for (var i = actual.conn.length - 1; i >= 0; i--) {
			if(actual.conn[i].n1 === actual.in){
				modifyNode = nodes[actual.conn[i].n2];
			}else{
				modifyNode = nodes[actual.conn[i].n1];
			}

			if(modifyNode.pathFindingData === false){
				modifyNode.pathFindingData = { weight: -1, referer: -1, closed: false };
			}

			if(modifyNode.pathFindingData.closed === false && excluded.indexOf(modifyNode.in) === -1){
				tempWeight = actual.pathFindingData.weight + actual.conn[i].w;

				if(modifyNode.pathFindingData.weight > tempWeight || modifyNode.pathFindingData.weight === -1){
					modifyNode.pathFindingData.weight = tempWeight;
					modifyNode.pathFindingData.referer = actual.in;
					modifyNode.pathFindingData.refererConn = actual.conn[i].in;
				}

				if(waitingFix.indexOf(modifyNode.in) === -1) waitingFix.push(modifyNode.in);
			}
		}

		waitingFix.shift();

		waitingFix.sort(function (a, b) {
			return nodes[a].pathFindingData.weight - nodes[b].pathFindingData.weight;
		});

		actual = nodes[ waitingFix[0] ];
	};
	/*Dijkstra End*/
	/*En teoría con esto ya están resueltas las referencias. Ahora lo que haremos es sacar la ruta partiendo de end.*/

	var cumulusCuantity = nodes.length;
	var temp = 0;
	var way = [];
	actual = end;

	if(actual.pathFindingData === false) return false;

	while(actual.in != start.in && temp <= cumulusCuantity){
		way.push(actual.pathFindingData.refererConn);
		actual = nodes[actual.pathFindingData.referer];
		temp++;
	}; //Y con esto en teoría ya tenemos el camino... Veremos a ver que sale.

	return way; //Pd: Funciona!
};

Utils.getPointOfPath = function(actualDistance, links, distances, nodes, start) {

	if(actualDistance < 0) return false;

	var acumulative = 0;
	var index = 0;

	while(acumulative < actualDistance){
		acumulative += distances[index];
		index++;
	}
	if(index > 0) index--;

	acumulative -= distances[index];
	var distance = distances[index];

	/*percentage = (this.animationData.pathFindingActualDistance - acumulative) / distances[index];*/
	distance = (actualDistance - acumulative);

	//tenemos el índice y el porcentaje dentro del rango. Pasamos a sacar la posición X e Y

	var conn1, conn2, conn = links[index];

	//Detectar el orden de n1 y n2
	if(links.length > 1){
		if(index === 0){
			if(conn.n2 === links[1].n1 || conn.n2 === links[1].n2){
				conn1 = conn.n1;
				conn2 = conn.n2;
			}else{
				conn1 = conn.n2;
				conn2 = conn.n1;
			}
		}else{
			if(conn.n1 === links[index-1].n1 || conn.n1 === links[index-1].n2){
				conn1 = conn.n1;
				conn2 = conn.n2;
			}else{
				conn1 = conn.n2;
				conn2 = conn.n1;
			}
		}
	}else{ //Solo hay una conexión, pasamos a comprobar cual es al conexión de inicio.
		if(conn.n1 === start){
			conn1 = conn.n1;
			conn2 = conn.n2;
		}else{
			conn1 = conn.n2;
			conn2 = conn.n1;
		}
	}

	var rad = Math.atan2(nodes[conn2].y - nodes[conn1].y, nodes[conn2].x - nodes[conn1].x);

	var x = distance * Math.cos(rad) + nodes[conn1].x;
	var y = distance * Math.sin(rad) + nodes[conn1].y;

	return [x, y, rad];
};


(function () {
	var rv = -1;
	if (navigator.appName === 'Microsoft Internet Explorer'){
		var ua = navigator.userAgent;
		var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})");
		if (re.exec(ua) !== null)
			rv = parseFloat( RegExp.$1 );
	}

	if(rv < 10 && rv > 0){
		Utils.unselect = function(){
			if(window.is_unselect_allowed) document.selection.empty();
		};
	}else{
		Utils.unselect = function(){
			if(window.is_unselect_allowed){
				var myRange = document.getSelection();
				myRange.removeAllRanges();
			}
		};
	}
})();


(function () {
	var myRequestAnimationFrame =  window.requestAnimationFrame ||
	window.webkitRequestAnimationFrame ||
	window.mozRequestAnimationFrame    ||
	window.oRequestAnimationFrame      ||
	window.msRequestAnimationFrame     ||
	function(callback) {
		window.setTimeout(callback, 10);
	};
	window.requestAnimationFrame=myRequestAnimationFrame;
})();



var EaseAnimation = {};

EaseAnimation.elastic = function (progress) {
	return Math.pow(2, 10 * (progress-1)) * Math.cos(20*Math.PI*1.5/3*progress);
};

EaseAnimation.linear = function (progress) {
	return progress;
};

EaseAnimation.quad = function (progress) {
	return Math.pow(progress, 2);
};

EaseAnimation.third = function (progress) {
	return Math.pow(progress, 3);
};

EaseAnimation.fourth = function (progress) {
	return Math.pow(progress, 4);
};

EaseAnimation.quint = function (progress) {
	return Math.pow(progress, 5);
};

EaseAnimation.sixt = function (progress) {
	return Math.pow(progress, 6);
};

EaseAnimation.octa = function (progress) {
	return Math.pow(progress, 8);
};

EaseAnimation.circ = function (progress) {
	return 1 - Math.sin(Math.acos(progress));
};

EaseAnimation.back = function (progress) {
	return Math.pow(progress, 2) * ((1.5 + 1) * progress - 1.5);
};


EaseAnimation.bounce = function (progress) {
	for(var a = 0, b = 1, result; 1; a += b, b /= 2) {
		if (progress >= (7 - 4 * a) / 11) {
			return -Math.pow((11 - 6 * a - 11 * progress) / 4, 2) + Math.pow(b, 2);
		}
	}
};

EaseAnimation.makeEaseInOut = function (delta) {
	return function(progress) {
		if (progress < 0.5)
			return EaseAnimation[delta](2*progress) / 2;
		else
			return (2 - EaseAnimation[delta](2*(1-progress))) / 2;
	};
};


EaseAnimation.makeEaseOut = function (delta) {
	return function(progress) {
		return 1 - EaseAnimation[delta](1 - progress);
	};
};

/*
*   Stack implementation in JavaScript
*/

/*function Stack(){
	this.top = null;
	this.count = 0;

	this.getCount = function(){
		return this.count;
	}

	this.getTop = function(){
		return this.top;
	}

	this.push = function(data){
		var node = {
			data : data,
			next : null
		}

		node.next = this.top;
		this.top = node;

		this.count++;
	}

	this.peek = function(){
		if(this.top === null){
			return null;
		}else{
			return this.top.data;
		}
	}

	this.pop = function(){
		if(this.top === null){
			return null;
		}else{
			var out = this.top;
			this.top = this.top.next;
			if(this.count>0){
				this.count--;
			}

			return out.data;
		}
	}

	this.displayAll = function(){
		if(this.top === null){
			return null;
		}else{
			var arr = new Array();

			var current = this.top;
			//console.log(current);
			for(var i = 0;i<this.count;i++){
				arr[i] = current.data;
				current = current.next;
			}

			return arr;
		}
	}
}*/

(function () { //VERY BASIC DOM EXTENSION. NOT PRETEND TO SUPPORT EXPLORER 7 AND EARLIER. This allows to write faster dom.
	Element.prototype.setVariable = function(variable, text) {
		this[variable] = text;
		return this;
	};

	Element.prototype.setStyle = function(rule, text) {
		this.style[rule] = text;
		return this;
	};

	Element.prototype.setClass = function(clas) {
		this.className = clas;
		return this;
	};

	Element.prototype.addChild = function(child) {
		if(Object.prototype.toString.call(child) === "[object Array]"){
			var len = child.length;
			for (var i = 0; i < len; i++) {
				this.appendChild(child[i]);
			}
		}else{
			this.appendChild(child);
		}
		return this;
	};

	Element.prototype.deleteChild = function(child) {
		if(Object.prototype.toString.call(child) === "[object Array]"){
			var len = child.length;
			for (var i = 0; i < len; i++) {
				this.removeChild(child[i]);
			}
		}else{
			this.removeChild(child);
		}
		return this;
	};

	Element.prototype.setHtml = function(html) {
		this.innerHTML = html;
		return this;
	};

	Text.prototype.setText = function(text) {
		this.nodeValue = text;
		return this;
	};

	window.createElement = function (element, clas, html, obj, name) {
		var dom = document.createElement(element);
		//if( typeof dom.saveInObject === "undefined") //Faltaría añadir todas las funciones para soportar navegadores viejos.
		if(clas) dom.className = clas;
		if(obj) obj[name] = dom;
		if(html) dom.innerHTML = html;

		return dom;
	};

	window.createTextNode = function (text) {
		return document.createTextNode(text);
	};

	Element.prototype.saveInObject = function (obj, name) {
		if(obj !== null) obj[name] = this;
		return this;
	};

	Text.prototype.saveInObject = Element.prototype.saveInObject;

	Element.prototype.saveIn = Element.prototype.saveInObject;
	Text.prototype.saveIn = Text.prototype.saveInObject;
})();