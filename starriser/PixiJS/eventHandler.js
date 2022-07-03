//Opción: Hacer que click tenga una opción para que si se está haciendo drag o si se está haciendo resize no se dispare el evento.
//Implementar: Hacer que el evento onclick mire si su element tiene algún evento tipo drag y si no, no contemple los steps ni distance. (comparando element === element)
//Implementar: Hacer que al evento de resize se le pueda decir que también responda con mousewheel para compatibilizar el zoom.

var CrossPlatformEvent = (function(){
	var EventHandler = function () {
		"use strict";
		this.init();
	};

	EventHandler.prototype.init = function() {
		"use strict";
		this.eventTypes = ['drag', 'click', 'resize'];
		this.eventInformation = {};


		this.activedDrags = 0;
		this.activedClicks = 0;
		this.activedResizes = 0;

		this.pointCache = {pageX: 0, pageY: 0};
		this.clickCache = {pageX: 0, pageY: 0, type: 1};

		this.debug = false;
	};

	EventHandler.prototype.bind = function(eventType, element, funct, data, context) {
		"use strict";
		var self = this;
		var isEvent = false;
		for (var i = this.eventTypes.length - 1; i >= 0; i--) {
			if(this.eventTypes[i] === eventType){
				isEvent = true;
				break;
			}
		}

		var config = data ? data : {};

		if(isEvent){
			var randIdentifier = Math.round(Math.random() * 1000000000) + "" + new Date().getTime();

			this.eventInformation[randIdentifier] = {
				randIdentifier: randIdentifier,
				type: eventType,
				element: element,
				funct: funct,
				context: context ? context : false,
				time: new Date(),
				data: {}
			};

			switch(eventType){
				case "drag":
					this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;
					this.eventInformation[randIdentifier].cancelOnResize = (typeof config.cancelOnResize !== "undefined") ? config.cancelOnResize : true;
					this.eventInformation[randIdentifier].data.dragOn = false;

					$(element).bind("mousedown."+randIdentifier+" touchstart."+randIdentifier, function (e) {
						self.drag(e, self.eventInformation[randIdentifier]);
					});
					$(document).bind("mouseup."+randIdentifier+" touchend."+randIdentifier+" touchmove."+randIdentifier+" mousemove."+randIdentifier, function (e) {
						self.drag(e, self.eventInformation[randIdentifier]);
					});
				break;

				case "click":
					this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;
					this.eventInformation[randIdentifier].data.clickOn = false;
					this.eventInformation[randIdentifier].data.lastClick = 0;

					$(element).bind("mousedown."+randIdentifier+" mouseup."+randIdentifier+" mousemove."+randIdentifier+" touchstart."+randIdentifier+" touchend."+randIdentifier+" touchmove."+randIdentifier, function (e) {
						self.click(e, self.eventInformation[randIdentifier]);
					});

					$(document).bind("mouseup."+randIdentifier+" touchend."+randIdentifier, function (e) {
						self.click(e, self.eventInformation[randIdentifier]);
					});
				break;

				case "resize":
					this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;
					this.eventInformation[randIdentifier].emulateWithMouseWheel = (typeof config.emulateWithMouseWheel !== "undefined") ? config.emulateWithMouseWheel : true; //se disparará un evento resize con la rueda del ratón?
					this.eventInformation[randIdentifier].wheelZoomInFactor = config.wheelZoomInFactor ? config.wheelZoomInFactor : 1.05; //Cuanto equivale cada golpe de ratón hacia delante
					this.eventInformation[randIdentifier].wheelZoomOutFactor = config.wheelZoomOutFactor ? config.wheelZoomOutFactor : 0.92; //Cuanto equivale cada golpe de ratón hacia atrás

					this.eventInformation[randIdentifier].data.resizeOn = false;

					$(element).bind("touchstart."+randIdentifier+" touchend."+randIdentifier+" touchmove."+randIdentifier, function (e) {
						self.resize(e, self.eventInformation[randIdentifier]);
					});

					if(this.eventInformation[randIdentifier].emulateWithMouseWheel){
						$(element).bind("mousewheel."+randIdentifier, function (e, delta, deltaX, deltaY) {
							self.resize(e, self.eventInformation[randIdentifier], delta, deltaX, deltaY);
						});
					}
				break;
			}

			return randIdentifier;
		}
		return false;
	};

	EventHandler.prototype.unbind = function(randIdentifier) {
		"use strict";
		$(document).unbind("."+randIdentifier);

		if(!this.eventInformation[randIdentifier]) return;
		$(this.eventInformation[randIdentifier].element).unbind("."+randIdentifier);

		this.eventInformation[randIdentifier] = null;
		delete this.eventInformation[randIdentifier];

	};

	EventHandler.prototype.drag = function(event, data){
		"use strict";
		if(!data) return false;
		var identifier;
		var time = new Date();
		var subData = data.data;
		switch(event.type){
			case "mousedown":
				if(!subData.dragOn && this.activedResizes < 1){ //No estamos arrastrando, iniciamos el arrastre
					data.time = time;
					subData.dragOn = true;
					this.activedDrags++;
					subData.lastPositionX = event.pageX;
					subData.lastPositionY = event.pageY;
					subData.desplacedX = 0;
					subData.desplacedY = 0;
					subData.pointerID = false;
					data.time = new Date();
					event.preventDefault();
					if(this.debug) console.log("DRAG - mousedown");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
			case "touchstart":
				window.__TOUCH_INPUT_DETECTED = true;
				if(!subData.dragOn && this.activedResizes < 1){//El evento es tactil. Así que es un poco más complejo. Asumimos que si dragOn !== true no hay más dedos puestos en la pantalla
					data.time = time;
					subData.dragOn = true;
					this.activedDrags++;
					subData.lastPositionX = event.originalEvent.changedTouches[0].pageX;
					subData.lastPositionY = event.originalEvent.changedTouches[0].pageY;
					subData.desplacedX = 0;
					subData.desplacedY = 0;
					subData.pointerID = event.originalEvent.changedTouches[0].identifier;
					event.preventDefault();
					if(this.debug) console.log("DRAG - touchstart");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
			case "mousemove":
				if(subData.dragOn && time - data.time > 10 && this.activedResizes < 1){ //Estamos en arrastre y además es el evento que disparó el dragOn
					data.time = time;
					subData.desplacedX += event.pageX - subData.lastPositionX;
					subData.desplacedY += event.pageY - subData.lastPositionY;
					if(data.autoEvent && (this.activedResizes < 1 || !data.cancelOnResize)){ //Si hemos puesto que se autodisparen los eventos y no se está haciendo resize
						this.pointCache.pageX = subData.desplacedX;
						this.pointCache.pageY = subData.desplacedY;
						this.call(data.randIdentifier, this.pointCache, event.originalEvent);
						subData.desplacedX = 0;
						subData.desplacedY = 0;
						subData.lastPositionX = event.pageX;
						subData.lastPositionY = event.pageY;
					}
					event.stopPropagation();
					event.preventDefault();
					if(this.debug) console.log("DRAG - mousemove");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
			case "touchmove":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.dragOn && time - data.time > 10 && this.activedResizes < 1){
					data.time = time;
					identifier = this.getMultitouchIndex(event, subData.pointerID);
					if(identifier === false) return false;

					subData.desplacedX += event.originalEvent.changedTouches[identifier].pageX - subData.lastPositionX;
					subData.desplacedY += event.originalEvent.changedTouches[identifier].pageY - subData.lastPositionY;
					if(data.autoEvent && (this.activedResizes < 1 || !data.cancelOnResize)){ //Si hemos puesto que se autodisparen los eventos y no se está haciendo resize
						this.pointCache.pageX = subData.desplacedX;
						this.pointCache.pageY = subData.desplacedY;
						this.call(data.randIdentifier, this.pointCache, event.originalEvent);
						subData.desplacedX = 0;
						subData.desplacedY = 0;
						subData.lastPositionX = event.originalEvent.changedTouches[0].pageX;
						subData.lastPositionY = event.originalEvent.changedTouches[0].pageY;
					}
					event.stopPropagation();
					event.preventDefault();
					if(this.debug) console.log("DRAG - touchmove");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
			case "mouseup":
				if(subData.dragOn && this.activedResizes < 1){
					subData.desplacedX += event.pageX - subData.lastPositionX;
					subData.desplacedY += event.pageY - subData.lastPositionY;
					this.pointCache.pageX = subData.desplacedX;
					this.pointCache.pageY = subData.desplacedY;
					this.call(data.randIdentifier, this.pointCache, event.originalEvent);

					subData.dragOn = false;
					this.activedDrags--;

					if(this.debug) console.log("DRAG - mouseup");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
			case "touchend":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.dragOn && this.activedResizes < 1){
					identifier = this.getMultitouchIndex(event, subData.pointerID);
					if(identifier === false) return false;

					subData.desplacedX += event.originalEvent.changedTouches[identifier].pageX - subData.lastPositionX;
					subData.desplacedY += event.originalEvent.changedTouches[identifier].pageY - subData.lastPositionY;
					this.pointCache.pageX = subData.desplacedX;
					this.pointCache.pageY = subData.desplacedY;
					this.call(data.randIdentifier, this.pointCache, event.originalEvent);

					subData.dragOn = false;
					this.activedDrags--;
					if(this.debug) console.log("DRAG - touchend");
				}
				if(this.activedResizes > 0){
					subData.dragOn = false;
				}
			break;
		}
		return false;
	};

	EventHandler.prototype.click = function(event, data) {
		"use strict";
		if(!data) return false;
		var positionX, positionY, identifier, distance;
		var subData = data.data;
		switch(event.type){
			case "mousedown":
				subData.clickOn = true;
				this.activedClicks++;
				subData.steps = 0;
				subData.positionX = event.pageX;
				subData.positionY = event.pageY;
				if(this.debug) console.log("CLICK - mousedown", subData.clickOn);
			break;
			case "touchstart":
				window.__TOUCH_INPUT_DETECTED = true;
				subData.clickOn = true;
				this.activedClicks++;
				subData.steps = 0;
				subData.positionX = event.originalEvent.changedTouches[0].pageX;
				subData.positionY = event.originalEvent.changedTouches[0].pageY;
				subData.fingerIdentifier = event.originalEvent.changedTouches[0].identifier;
				if(this.debug) console.log("CLICK - touchstart", subData.clickOn);
			break;
			case "mousemove":
				if(subData.clickOn){
					subData.steps++;
					if(subData.steps > 5) subData.clickOn = false;
					if(this.debug) console.log("CLICK - touchmove / mousemove", subData.clickOn);
				}
			case "touchmove":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.clickOn){
					subData.steps++;
					if(subData.steps > 5) subData.clickOn = false;
					if(this.debug) console.log("CLICK - touchmove / mousemove", subData.clickOn);
				}
			break;
			case "mouseup":
				if(subData.clickOn){
					positionX = event.pageX;
					positionY = event.pageY;

					subData.clickOn = false;
					this.activedClicks--;
					if(this.debug) console.log("CLICK - mouseup", subData.clickOn);

					if(this.hasElementDragResizeEvent(data.element)){

						distance = Math.sqrt( (positionX - subData.positionX)*(positionX - subData.positionX) + (positionY - subData.positionY)*(positionY - subData.positionY) );

						if(subData.steps > 5 || distance > 10) return false;
						else{
							if(new Date().getTime() - subData.lastClick < 300){
								this.clickCache.pageX = positionX;
								this.clickCache.pageY = positionY;
								this.clickCache.type = 2;
								this.call(data.randIdentifier, this.clickCache, event);
							}else{
								this.clickCache.pageX = positionX;
								this.clickCache.pageY = positionY;
								this.clickCache.type = 1;
								this.call(data.randIdentifier, this.clickCache, event);
								subData.lastClick = new Date().getTime();
							}
						}
					}else{
						subData.lastClick = new Date().getTime();
						if(new Date().getTime() - subData.lastClick < 300){
							this.clickCache.pageX = positionX;
							this.clickCache.pageY = positionY;
							this.clickCache.type = 2;
							this.call(data.randIdentifier, this.clickCache, event);
						}else{
							this.clickCache.pageX = positionX;
							this.clickCache.pageY = positionY;
							this.clickCache.type = 1;
							this.call(data.randIdentifier, this.clickCache, event);
						}
					}
				}
			break;
			case "touchend":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.clickOn){
					identifier = this.getMultitouchIndex(event, subData.fingerIdentifier);
					if(identifier === false) return false;

					positionX = event.originalEvent.changedTouches[identifier].pageX;
					positionY = event.originalEvent.changedTouches[identifier].pageY;

					subData.clickOn = false;
					this.activedClicks--;
					if(this.debug) console.log("CLICK - touchend", subData.clickOn);

					if(this.hasElementDragResizeEvent(data.element)){
						distance = Math.sqrt( (positionX - subData.positionX)*(positionX - subData.positionX) + (positionY - subData.positionY)*(positionY - subData.positionY) );

						if(subData.steps > 10 || distance > 15) return false;
						else{
							if(new Date().getTime() - subData.lastClick < 300){
								this.clickCache.pageX = positionX;
								this.clickCache.pageY = positionY;
								this.clickCache.type = 2;
								this.call(data.randIdentifier, this.clickCache, event);
							}else{
								this.clickCache.pageX = positionX;
								this.clickCache.pageY = positionY;
								this.clickCache.type = 1;
								this.call(data.randIdentifier, this.clickCache, event);
								subData.lastClick = new Date().getTime();
							}
						}
					}else{
						if(new Date().getTime() - subData.lastClick < 300){
							this.clickCache.pageX = positionX;
							this.clickCache.pageY = positionY;
							this.clickCache.type = 2;
							this.call(data.randIdentifier, this.clickCache, event);
						}else{
							this.clickCache.pageX = positionX;
							this.clickCache.pageY = positionY;
							this.clickCache.type = 1;
							this.call(data.randIdentifier, this.clickCache, event);
							subData.lastClick = new Date().getTime();
						}
					}

				}
			break;
		}
		return false;
	};

	EventHandler.prototype.resize = function(event, data, delta, deltaX, deltaY) {
		"use strict";
		if(!data) return false;
		var identifier, touches, i;
		var time = new Date();
		var subData = data.data;
		switch(event.type){
			case "touchstart":
				window.__TOUCH_INPUT_DETECTED = true;
				if(event.originalEvent.touches.length > 1 && !subData.resizeOn){
					data.time = time;

					subData.resizeOn = true;
					this.activedResizes++;

					subData.fingersIdentifier = [event.originalEvent.touches[0].identifier, event.originalEvent.touches[1].identifier];
					subData.fingersPositions = [
						[event.originalEvent.touches[0].pageX, event.originalEvent.touches[0].pageY],
						[event.originalEvent.touches[1].pageX, event.originalEvent.touches[1].pageY],
					];
					subData.fingersCenter =  [(event.originalEvent.touches[0].pageX + event.originalEvent.touches[1].pageX) / 2, (event.originalEvent.touches[0].pageY + event.originalEvent.touches[1].pageY) / 2];
					subData.fingersDistance = Math.sqrt( (subData.fingersPositions[0][0] - subData.fingersPositions[1][0])*(subData.fingersPositions[0][0] - subData.fingersPositions[1][0]) + (subData.fingersPositions[0][1] - subData.fingersPositions[1][1])*(subData.fingersPositions[0][1] - subData.fingersPositions[1][1]) );
					if(this.debug) console.log("RESIZE - touchstart");
				}
			break;
			case "touchmove":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.resizeOn && time - data.time > 15){
					data.time = time;
					var x1, y1, x2, y2, distance, centerx, centery, factor;
					touches = [];
					for (i = event.originalEvent.changedTouches.length - 1; i >= 0; i--) { //Obtengo los dedos que se han movido de los que tengo en mi lista
						if(event.originalEvent.changedTouches[i].identifier == subData.fingersIdentifier[0] || event.originalEvent.changedTouches[i].identifier == subData.fingersIdentifier[1])
							touches.push(event.originalEvent.changedTouches[i]);
					}

					if(touches.length === 0) return false; //Si no ha cambiado ningún dedo de los que nos interesa, fin.
					else if(touches.length === 1){ //Solo hay un dedo, así que conservamos una coordenada anterior.
						if(touches[0].identifier === subData.fingersIdentifier[0]){
							x1 = touches[0].pageX;
							y1 = touches[0].pageY;
							x2 = subData.fingersPositions[1][0];
							y2 = subData.fingersPositions[1][1];
						}else{
							x1 = subData.fingersPositions[0][0];
							y1 = subData.fingersPositions[0][1];
							x2 = touches[0].pageX;
							y2 = touches[0].pageY;
						}
					}else if(touches.length > 1){ //Los 2 han cambiado
						if(touches[0].identifier === subData.fingersIdentifier[0]){
							x1 = touches[0].pageX;
							y1 = touches[0].pageY;
							x2 = touches[1].pageX;
							y2 = touches[1].pageY;
						}else{
							x1 = touches[1].pageX;
							y1 = touches[1].pageY;
							x2 = touches[0].pageX;
							y2 = touches[0].pageY;
						}
					}

					distance = Math.sqrt( (x1-x2)*(x1-x2) + (y1-y2)*(y1-y2) );

					centerx = (x1+x2) / 2;
					centery = (y1+y2) / 2;

					factor = distance / subData.fingersDistance;


					if(data.autoEvent && factor !== 1){
						this.call(data.randIdentifier, {
							center: [centerx, centery],
							desplaced: [centerx - subData.fingersCenter[0], centery - subData.fingersCenter[1]],
							factor: factor,
							distance: distance,
							rad: Math.atan2(y1-y2, x1-x2),
							fingers: [x1, y1, x2, y2]
						}, event);

						subData.fingersCenter[0] = centerx;
						subData.fingersCenter[1] = centery;

						subData.fingersDistance = distance;

						subData.fingersPositions[0][0] = x1;
						subData.fingersPositions[0][1] = y1;
						subData.fingersPositions[1][0] = x2;
						subData.fingersPositions[1][1] = y2;
					}
					if(this.debug) console.log("RESIZE - touchmove");
				}
			break;
			case "touchend":
				window.__TOUCH_INPUT_DETECTED = true;
				if(subData.resizeOn){
					var touchesRemain, touchSelected;
					touchesRemain = false;
					touches = [];
					for (i = event.originalEvent.changedTouches.length - 1; i >= 0; i--) { //Obtengo los dedos que se han movido de los que tengo en mi lista
						if(event.originalEvent.changedTouches[i].identifier == subData.fingersIdentifier[0] || event.originalEvent.changedTouches[i].identifier == subData.fingersIdentifier[0])
							touches.push(event.originalEvent.changedTouches[i]);
					}

					if(touches.length > 0){ //Se ha quitado un dedo. Miramos si quedan más dedos, si no quedan, cancelamos el resize, si quedan pasamos a usar esos otros.
						if(event.originalEvent.touches.length > 1){ //miramos si quedan al menos 2 dedos. Si quedan 2 o más continuamos con el resize
							for (i = event.originalEvent.touches.length - 1; i >= 0; i--) { //Queda algún dedo de los marcados en touches? si es así solo cambiamos uno, si no, cambiamos los 2.
								if(event.originalEvent.touches[i].identifier == subData.fingersIdentifier[0]){
									touchesRemain = i;
									touchSelected = 0;
								}else if(event.originalEvent.touches[i].identifier == subData.fingersIdentifier[1]){
									touchesRemain = i;
									touchSelected = 1;
								}
							}
							if(touchesRemain === false){ //No quedan dedos, así que pasamos a usar los otros 2 dedos.
								subData.fingersIdentifier = [event.originalEvent.touches[0].identifier, event.originalEvent.touches[1].identifier];
								subData.fingersPositions[0][0] = event.originalEvent.touches[0].pageX;
								subData.fingersPositions[0][1] = event.originalEvent.touches[0].pageY;
								subData.fingersPositions[1][0] = event.originalEvent.touches[1].pageX;
								subData.fingersPositions[1][1] = event.originalEvent.touches[1].pageY;

								subData.fingersCenter =  [(subData.fingersPositions[0][0] + subData.fingersPositions[1][0]) / 2, (subData.fingersPositions[0][1] + subData.fingersPositions[1][1]) / 2];
								subData.fingersDistance = Math.sqrt( (subData.fingersPositions[0][0] - subData.fingersPositions[1][0])*(subData.fingersPositions[0][0] - subData.fingersPositions[1][0]) + (subData.fingersPositions[0][1] - subData.fingersPositions[1][1])*(subData.fingersPositions[0][1] - subData.fingersPositions[1][1]) );
							}else{ //Queda un dedo, así que pasamos a sustituir el dedo perdido por otro nuevo.
								if(touchesRemain === 0){ //Como cogemos siempre los 2 primeros asumimos que el repetido es o el [0] o el [1] y cogemos el otro.
									if(touchSelected === 0){
										subData.fingersPositions[1][0] = event.originalEvent.touches[1].pageX;
										subData.fingersPositions[1][1] = event.originalEvent.touches[1].pageY;
									}else{
										subData.fingersPositions[0][0] = event.originalEvent.touches[1].pageX;
										subData.fingersPositions[0][1] = event.originalEvent.touches[1].pageY;
									}
								}else{
									if(touchSelected === 0){
										subData.fingersPositions[1][0] = event.originalEvent.touches[0].pageX;
										subData.fingersPositions[1][1] = event.originalEvent.touches[0].pageY;
									}else{
										subData.fingersPositions[0][0] = event.originalEvent.touches[0].pageX;
										subData.fingersPositions[0][1] = event.originalEvent.touches[0].pageY;
									}
								}
								subData.fingersCenter =  [(subData.fingersPositions[0][0] + subData.fingersPositions[1][0]) / 2, (subData.fingersPositions[0][1] + subData.fingersPositions[1][1]) / 2];
								subData.fingersDistance = Math.sqrt( (subData.fingersPositions[0][0] - subData.fingersPositions[1][0])*(subData.fingersPositions[0][0] - subData.fingersPositions[1][0]) + (subData.fingersPositions[0][1] - subData.fingersPositions[1][1])*(subData.fingersPositions[0][1] - subData.fingersPositions[1][1]) );

							}
						}else{
							subData.resizeOn = false;
							this.activedResizes--;
						}
					}
					if(this.debug) console.log("RESIZE - touchend");
				}
			break;
			case "mousewheel":

				if(delta > 5) delta = 5;
				else if(delta < -5 ) delta = -5;
				if(time - data.time < 15) return false;
				data.time = time;

				var growth;
				if(delta === 0) return false;
				if(delta > 0){
					growth = Math.pow(data.wheelZoomInFactor, delta);
				}else if(delta < 0) {
					growth = Math.pow(data.wheelZoomOutFactor, -delta);
				}

				this.call(data.randIdentifier, {
					center: [event.pageX, event.pageY],
					desplaced: [0, 0],
					factor: growth,
					distance: 0,
					rad: 0,
					fingers: false
				}, event);
				if(this.debug) console.log("RESIZE - mousewheel");
			break;
		}
		return false;
	};

	EventHandler.prototype.call = function(randIdentifier, data, event) {
		var eventInformation = this.eventInformation[randIdentifier];
		if(eventInformation.context){
			eventInformation.funct.call(eventInformation.context, data, event);
		}else{
			eventInformation.funct(data, event);
		}
	};

	EventHandler.prototype.getMultitouchIndex = function(event, id) {
		var identifier = false;
		for (var i = event.originalEvent.changedTouches.length - 1; i >= 0; i--) {
			if(event.originalEvent.changedTouches[i].identifier === id) identifier = i;
		}
		return identifier;
	};

	EventHandler.prototype.hasElementDragResizeEvent = function(element) {
		var key;
		for (key in this.eventInformation) {
			if(this.eventInformation[key].element == element && this.eventInformation[key].type == "drag" || this.eventInformation[key].type == "resize") return true;
		}
		return false;
	};

	return new EventHandler();

})();
