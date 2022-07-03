var LoadImages = function (data) {
	this.init(data);
};

LoadImages.prototype.init = function(data) {

	var self = this;
	var images = data.images;
	this.data = data;
	this.imageObjective = images.length;
	this.imagesReach = 0;
	this.imagesLoad = new Array(this.imageObjective);

	for (var i = this.imageObjective - 1; i >= 0; i--) {
		this.imagesLoad[i] = new Image();
		this.imagesLoad[i].onload = (function(i){
			return function () {
				self.imageLoaded(i);
				self.imagesLoad[i].onload = null;
			};
		})(i);
		this.imagesLoad[i].src = images[i];
	}
};

LoadImages.prototype.imageLoaded = function(index) {
	this.imagesReach++;
	if( this.imagesReach > this.imageObjective ){
		if(this.data.finishCallback) this.data.finishCallback.call( this.data.finishCallbackContext, this.imagesLoad, index, this.imagesReach);
	}else{
		if(this.data.stepCallback) this.data.stepCallback.call( this.data.stepCallbackContext, this.imagesLoad[index], index, this.imagesReach);
	}

	return 0;
};

/*var LoadJson = function (data) {
	this.init(data);
};

LoadJson.prototype.init = function(data) { //{ requests: [{url, data}] , finishCallback: , finishCallbackContext: , stepCallback: , stepCallbackContext: }
	this.data = data;
	this.requests = data.requests.length;
	this.requestFinish = 0;

	for (var i = this.requests - 1; i >= 0; i--) {
		this.ajaxCall("POST", data.requests[i].url, data.requests[i].data, i);
	}
};

LoadJson.prototype.ajaxCall = function(type, url, ajaxData, index) {
	var self = this;
	$.ajax({
		type: type,
		url: url,
		data: ajaxData,
		dataType: 'json',
		success: function (index) {
			self.jsonLoaded(index, data);
		},
		error: function (jqXHR, status) {
			self.ajaxCall(type, url, data, index);
		}
	});
};

LoadJson.prototype.jsonLoaded = function(index, data) {
	self.requestFinish++;

	if( this.requests > this.requestFinish ){
		if(this.data.finishCallback) this.data.finishCallback.call( this.data.finishCallbackContext, this.imagesLoad, index, this.requests, data);
	}else{
		if(this.data.stepCallback) this.data.stepCallback.call( this.data.stepCallbackContext, this.imagesLoad[index], index, this.requests);
	}
};*/





var Utils = {};
Utils.configuration = {};
Utils.configuration.maxGalaxyZoom = 2;
Utils.configuration.minGalaxyZoom = 0.01;
Utils.configuration.cumulusSize = 150;
Utils.configuration.zoomToSmallCumulusIcon = 0.039;
Utils.configuration.systemsInCumulus = 35;
Utils.configuration.jumpColor = ["#ffffff", "#e8f9fe", "#c4f0fe", "#9ce6fe", "#72dcfc", "#50d3f7", "#3acded", "#37cbdf", "#46cfc7", "#62d7a9", "#85e189", "#a9e46a", "#cbe44e", "#e2e43a", "#efd830", "#f2bf30", "#f2a030", "#f27e30", "#f25e30", "#f24330", "#f23130"];
Utils.configuration.maxJumpColorShow = 10;
Utils.configuration.distanceColorJump = Math.floor(Utils.configuration.jumpColor.length / Utils.configuration.maxJumpColorShow);

Utils.enums = {};
Utils.enums.zoneWorkMode = {GALAXY: 0, CUMULUS: 1, SYSTEM: 2, PLANET: 3};
Utils.enums.cursors = {NORMAL: 0, POINTER: 1, MOVE: 2};
Utils.enums.galaxyActions = {requestStaticFrameFunction: 0, cumulusClick: 1, voidClick: 2, contextMenu: 3};





Utils.sizeZoomRanges = function(maxZoom, minZoom, zoom, maxRange, minRange){
	return (zoom / (maxZoom - minZoom)) * (maxRange - minRange) + minRange;
};
Utils.canvasPolygon = function(cxt, Xcenter, Ycenter, radius, numberOfSides, rotation) {
	var size = radius;
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
Utils.easeInOutCuad = function(p) {
	return p < 0.5 ?
		(( p * 2 )*( p * 2 )) / 2 :
		1 - (( p * -2 + 2 )*( p * -2 + 2 )) / 2;
};
Utils.getWindowSize = function() {
	var myWidth = 0, myHeight = 0;
	if( typeof( window.innerWidth ) == 'number' ) {
		//Non-IE
		myWidth = window.innerWidth;
		myHeight = window.innerHeight;
	} else if( document.documentElement && ( document.documentElement.clientWidth || document.documentElement.clientHeight ) ) {
		//IE 6+ in 'standards compliant mode'
		myWidth = document.documentElement.clientWidth;
		myHeight = document.documentElement.clientHeight;
	}
	return {x: myWidth, y: myHeight};
};


(function () {
	var rv = -1;
	if (navigator.appName == 'Microsoft Internet Explorer')
	{
		var ua = navigator.userAgent;
		var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})");
		if (re.exec(ua) !== null)
			rv = parseFloat( RegExp.$1 );
	}

	if(rv < 10){
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
