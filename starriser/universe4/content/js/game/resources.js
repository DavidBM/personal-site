"use strict";
var ResourcesImg = function () {
	if(ResourcesImg.prototype._singletonInstance){
		return ResourcesImg.prototype._singletonInstance;
	}

	ResourcesImg.prototype._singletonInstance = this;
	this.init();
};

ResourcesImg.g = function() {
	var singletonInstance = new ResourcesImg();
	return singletonInstance;
};

ResourcesImg.prototype.init = function() {
	this.count = 0;
	this.resources = [];
	this.loaded = [];
	this.loadedEvents = [];
	this.waitingResources = [];
	//this.freeCount = new Stack();

	//Creating 100x100 pink canvas por missing/not-loaded texture
	this.missingImage = document.createElement("canvas");
	this.missingImage.width = 100;
	this.missingImage.height = 100;
	var ctx = this.missingImage.getContext("2d");
	ctx.fillStyle = "#ff69b4";
	ctx.fillRect(0,0,100,100);
	ctx.fillStyle = "#000000";
	ctx.fillText("Not loaded",25,25);
};

ResourcesImg.prototype.load = function(url, data) {

	var self = this;

	var handler = ( typeof data !== "undefined" && typeof data.handler !== "undefined" ) ? data.handler : false;
	var context = ( typeof data !== "undefined" && typeof data.context !== "undefined" ) ? data.context : false;
	var handlerData = ( typeof data !== "undefined" && typeof data.handlerData !== "undefined" ) ? data.handlerData : false;

	
	for (var i = this.resources.length - 1; i >= 0; i--) {
		if(this.resources[i].id && this.resources[i].id == url){
			if(this.loaded[i] === true){
				this.addToHandlerCall(i, handler, context, handlerData);
				this.handlerCall(i);
			}else{
				this.addToHandlerCall(i, handler, context, handlerData);
			}
			return i;
		}
	}

	var index = this.count;

	var image = new Image();
	image.src = url;

	this.resources[index] = {
		obj: image,
		id: url
	};

	this.loaded[index] = false;
	this.loadedEvents[index] = [];

	this.count++;
	this.addToHandlerCall(index, handler, context, handlerData);
	image.onload = function () {
		self.loadedComplete(index);
	};


	return index;
};

ResourcesImg.prototype.wait = function(id, data) {

	var handler = ( typeof data !== "undefined" && typeof data.handler !== "undefined" ) ? data.handler : false;
	var context = ( typeof data !== "undefined" && typeof data.context !== "undefined" ) ? data.context : false;
	var handlerData = ( typeof data !== "undefined" && typeof data.handlerData !== "undefined" ) ? data.handlerData : false;
	var index = false;
	var WaitingFinded = false;
	var i;

	for (i = this.resources.length - 1; i >= 0; i--) {
		if(this.resources[i].id && this.resources[i].id == id){
			if(this.loaded[i] === true){
				this.addToHandlerCall(i, handler, context, handlerData);
				this.handlerCall(i);
				return i;
			}else{
				this.addToHandlerCall(i, handler, context, handlerData);
				return i;
			}
		}
	}

	for (i = this.waitingResources.length - 1; i >= 0; i--) {
		if( this.waitingResources[i].id == id){
			WaitingFinded = i;
		}
	};

	if(WaitingFinded !== false){
		index = this.waitingResources[WaitingFinded].index;
	}else{
		index = this.count;
		this.count++;
		this.resources[index] = [];
	}

	this.waitingResources.push({
		id: id,
		handler: handler,
		context: context,
		handlerData: handlerData,
		index: index
	});

	return index;

};

ResourcesImg.prototype.get = function (id, getWhitoutLoad) {
	if(typeof id == 'string' || id instanceof String){
		for (var i = this.resources.length - 1; i >= 0; i--) {
			if(this.resources[i].id && this.resources[i].id == id && (this.loaded === true || getWhitoutLoad === true)) return this.resources[i].obj;
		}
		return this.missingImage;
	}else{
		if(this.resources[id]){
			if(this.loaded[id] || getWhitoutLoad === true) return this.resources[id].obj;
			else return this.missingImage;
		}else{
			return this.missingImage;
		}
	}
};

ResourcesImg.prototype.isLoaded = function(id) {
	if(typeof id == 'string' || id instanceof String){
		for (var i = this.resources.length - 1; i >= 0; i--) {
			if(this.resources[i].id && this.resources[i].id == id && this.loaded === true) return true;
		}
		return false;
	}else{
		if(this.resources[id]){
			if(this.loaded[id]) return true;
			else return false;
		}else{
			return false;
		}
	}
};

ResourcesImg.prototype.isRequested = function(id) {
	if(typeof id == 'string' || id instanceof String){
		for (var i = this.resources.length - 1; i >= 0; i--) {
			if(this.resources[i].id && this.resources[i].id == id) return true;
		}
		return false;
	}else{
		if(this.resources[id]){
			return true;
		}else{
			return false;
		}
	}
};

ResourcesImg.prototype.isId = function(id) {
	for (var i = this.resources.length - 1; i >= 0; i--) {
		if(this.resources[i].id && this.resources[i].id == id && this.loaded === true) return true;
	}
	return false;
};

ResourcesImg.prototype.add = function(canvas, artificialSrc){
	var id = this.count;
	var findWaiting = false;
	var i;

	for (i = this.resources.length - 1; i >= 0; i--) {
		if(this.resources[i].id && this.resources[i].id == artificialSrc){
			return false;
		}
	}

	for (i = this.waitingResources.length - 1; i >= 0; i--) {
		if(this.waitingResources[i].id == artificialSrc){
			findWaiting = true;
			id = this.waitingResources[i].index;
		}
	}



	this.resources[id] = {
		obj: canvas,
		id: artificialSrc
	};
	this.loaded[id] = true;

	if(!findWaiting) this.count++;

	this.checkWaiting(artificialSrc);
};

ResourcesImg.prototype.addToHandlerCall = function(index, handler, context, handlerData) {
	if (this.loadedEvents.length < index+1){
		this.loadedEvents.length = index+1;
		this.loadedEvents[index] = [];
	}

	this.loadedEvents[index][this.loadedEvents[index].length] = {
		handler: handler,
		context: context,
		handlerData: handlerData
	};
};

ResourcesImg.prototype.handlerCall = function(index) {

	var handler, context, handlerData;

	for (var i = this.loadedEvents[index].length - 1; i >= 0; i--) {
		
		handler = this.loadedEvents[index][i];
		context = handler.context;
		handlerData = handler.handlerData;
		handler = handler.handler;

		this.call(handler, context, handlerData);
	}

	this.loadedEvents[index] = [];
};

ResourcesImg.prototype.call = function(handler, context, handlerData) {
	if(handler){
		if(context && handlerData) handler.call(context, handlerData);
		else if(context) handler.call(context);
		else if(handlerData) handler.call(window, handlerData);
		else handler.call();
	}
};

ResourcesImg.prototype.loadedComplete = function(index) {
	this.loaded[index] = true;
	this.handlerCall(index);
	this.checkWaiting(this.resources[index].id);
};

ResourcesImg.prototype.checkWaiting = function(id) {
	for (var i = this.waitingResources.length - 1; i >= 0; i--) {
		if(this.waitingResources[i].id == id){
			this.call(this.waitingResources[i].handler, this.waitingResources[i].context, this.waitingResources[i].handlerData);
			this.waitingResources.splice(i, 1);
		}
	}
};














var NtimeEvent = function(n, handler, context, handlerData) {
	return this.init(n, handler, context, handlerData);
};

NtimeEvent.prototype.init = function(n, handler, context, handlerData) {
	var self = this;
	this.times = 0;
	this.ntimes = n;

	this.handler = (typeof handler !== "undefined" ) ? handler : false;
	this.context = (typeof context !== "undefined" ) ? context : false;
	this.handlerData = (typeof handlerData !== "undefined" ) ? handlerData : false;


	return {
		handler: function(){
			self.preHandler();
		},
		context: this
	};
};

NtimeEvent.prototype.changeTimesToFire = function(n) {
	this.ntimes = n;
	if(this.times >= this.ntimes) this.preHandler();
};

NtimeEvent.prototype.preHandler = function() {
	this.times++;
	if(this.times >= this.ntimes){
		if(this.handler){
			if(this.context && this.handlerData) this.handler.call(this.context, this.handlerData);
			else if(this.context) this.handler.call(this.context);
			else if(this.handlerData) this.handler.call(window, this.handlerData);
			else this.handler.call();
		}
	}
};