//Opción: Hacer que click tenga una opción para que si se está haciendo drag o si se está haciendo resize no se dispare el evento.
//Implementar: Hacer que el evento onclick mire si su element tiene algún evento tipo drag y si no, no contemple los steps ni distance. (comparando element == element)
//Implementar: Hacer que al evento de resize se le pueda decir que también responda con mousewheel para compativilizar el zoom.

var EventHandler = function () {
	"use strict";
	this.init();
};

EventHandler.prototype.init = function() {
	"use strict";
	this.eventTypes = ['drag', 'click', 'resize'];
	this.eventInformation = {};


	this.dragOnRandIdentifier = -1;
	this.dragOn = false;

	this.resizeOnIdentifier = -1;
	this.resizeOn = false;
};

EventHandler.prototype.bind = function(event, element, funct, data, context) {
	"use strict";
	var self = this;
	var isEvent = false;
	for (var i = this.eventTypes.length - 1; i >= 0; i--) {
		if(this.eventTypes[i] === event){
			isEvent = true;
			i = -1;
		}
	}

	var config = data ? data : {};

	if(isEvent){
		var randIdentifier = Math.round(Math.random() * 1000000000);

		this.eventInformation[randIdentifier] = {
			randIdentifier: randIdentifier,
			type: event,
			element: element,
			funct: funct,
			context: context ? context : false,
			data: {}
		};

		switch(event){
			case "drag":
				this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;

				$(element).bind("mousedown."+randIdentifier+" "+"touchstart."+randIdentifier, function (e) {
					self.drag(e, self.eventInformation[randIdentifier]);
				});
				$(document).bind("mouseup."+randIdentifier+" "+"touchend."+randIdentifier+" "+"touchmove."+randIdentifier+" "+"mousemove."+randIdentifier, function (e) {
					self.drag(e, self.eventInformation[randIdentifier]);
				});
			break;

			case "click":
				this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;
				this.eventInformation[randIdentifier].notOtherEvents = config.notOtherEvents ? true : false; //Solo se disparará el evento si no se está haciendo drag o resize en el mismo objeto.

				$(element).bind("mousedown."+randIdentifier+" "+"mouseup."+randIdentifier+" "+"mousemove."+randIdentifier+" "+"touchstart."+randIdentifier+" "+"touchend."+randIdentifier+" "+"touchmove."+randIdentifier, function (e) {
					self.click(e, self.eventInformation[randIdentifier]);
				});
			break;

			case "resize":
				this.eventInformation[randIdentifier].autoEvent = (typeof config.autoEvent !== "undefined") ? config.autoEvent : true;
				this.eventInformation[randIdentifier].emulateWithMouseWheel = (typeof config.emulateWithMouseWheel !== "undefined") ? config.emulateWithMouseWheel : true; //se disparará un evento resize con la rueda del ratón?
				this.eventInformation[randIdentifier].wheelZoomInFactor = config.wheelZoomInFactor ? config.wheelZoomInFactor : 1.03; //Cuanto equivale cada golpe de ratón hacia delante
				this.eventInformation[randIdentifier].wheelZoomOutFactor = config.wheelZoomOutFactor ? config.wheelZoomOutFactor : 0.95; //Cuanto equivale cada golpe de ratón hacia atrás

				$(element).bind("touchstart."+randIdentifier+" "+"touchend."+randIdentifier+" "+"touchmove."+randIdentifier, function (e) {
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
};

EventHandler.prototype.unbind = function(randIdentifier) {
	"use strict";
	$(this.eventInformation[randIdentifier].element).unbind("."+randIdentifier);

	this.eventInformation[randIdentifier] = null;
	delete this.eventInformation[randIdentifier];

	if(this.dragOnRandIdentifier === randIdentifier){
		this.dragOnRandIdentifier = -1;
		this.dragOn = false;
	}

	if(this.resizeOnIdentifier === randIdentifier){
		this.resizeOnIdentifier = -1;
		this.resizeOn = false;
	}
};

EventHandler.prototype.drag = function(event, data){
	"use strict";
	var identifier;
	var time = new Date();
	switch(event.type){
		case "mousedown":
			if(!this.dragOn && !this.resizeOn){ //No estamos arrastrando, iniciamos el arrastre
				data.time = time;
				this.dragOn = true;
				data.data.lastPositionX = event.pageX;
				data.data.lastPositionY = event.pageY;
				data.data.desplacedX = 0;
				data.data.desplacedY = 0;
				data.data.pointerID = false;
				this.dragOnRandIdentifier = data.randIdentifier;
				data.time = new Date();
			}
		break;
		case "touchstart":
			if(!this.dragOn && !this.resizeOn){//El evento es tactil. Así que es un poco más complejo. Asumimos que si dragOn !== true no hay más dedos puestos en la pantalla
				data.time = time;
				this.dragOn = true;
				data.data.lastPositionX = event.originalEvent.changedTouches[0].pageX;
				data.data.lastPositionY = event.originalEvent.changedTouches[0].pageY;
				data.data.desplacedX = 0;
				data.data.desplacedY = 0;
				data.data.pointerID = event.originalEvent.changedTouches[0].identifier;
				this.dragOnRandIdentifier = data.randIdentifier;
			}
		break;
		case "mousemove":
			if(this.dragOn && this.dragOnRandIdentifier == data.randIdentifier && time - data.time > 15){ //Estamos en arrastre y además es el evento que disparó el dragOn
				data.time = time;
				data.data.desplacedX += event.pageX - data.data.lastPositionX;
				data.data.desplacedY += event.pageY - data.data.lastPositionY;
				if(data.autoEvent){
					this.call(data.randIdentifier, {pageX: data.data.desplacedX, pageY: data.data.desplacedY}, event.originalEvent);
					data.data.desplacedX = 0;
					data.data.desplacedY = 0;
					data.data.lastPositionX = event.pageX;
					data.data.lastPositionY = event.pageY;
				}
			}
		break;
		case "touchmove":
			if(this.dragOn && this.dragOnRandIdentifier == data.randIdentifier && time - data.time > 15){
				data.time = time;
				identifier = this.getMultitouchIndex(event, data.data.pointerID);
				if(identifier === false) return false;
				
				data.data.desplacedX += event.originalEvent.changedTouches[identifier].pageX - data.data.lastPositionX;
				data.data.desplacedY += event.originalEvent.changedTouches[identifier].pageY - data.data.lastPositionY;
				if(data.autoEvent){
					this.call(data.randIdentifier, {pageX: data.data.desplacedX, pageY: data.data.desplacedY}, event.originalEvent);
					data.data.desplacedX = 0;
					data.data.desplacedY = 0;
					data.data.lastPositionX = event.originalEvent.changedTouches[0].pageX;
					data.data.lastPositionY = event.originalEvent.changedTouches[0].pageY;
				}
			}
		break;
		case "mouseup":
			if(this.dragOn && this.dragOnRandIdentifier == data.randIdentifier){
				data.data.desplacedX += event.pageX - data.data.lastPositionX;
				data.data.desplacedY += event.pageY - data.data.lastPositionY;
				this.call(data.randIdentifier, {pageX: data.data.desplacedX, pageY: data.data.desplacedY}, event.originalEvent);

				this.dragOnRandIdentifier = -1;
				this.dragOn = false;
				
			}
		break;
		case "touchend":
			if(this.dragOn && this.dragOnRandIdentifier == data.randIdentifier){
				identifier = this.getMultitouchIndex(event, data.data.pointerID);
				if(identifier === false) return false;
				
				data.data.desplacedX += event.originalEvent.changedTouches[identifier].pageX - data.data.lastPositionX;
				data.data.desplacedY += event.originalEvent.changedTouches[identifier].pageY - data.data.lastPositionY;
				this.call(data.randIdentifier, {pageX: data.data.desplacedX, pageY: data.data.desplacedY}, event.originalEvent);

				this.dragOnRandIdentifier = -1;
				this.dragOn = false;
			}
		break;
	}
	return false;
};

EventHandler.prototype.click = function(event, data) {
	"use strict";
	var positionX, positionY, identifier, distance;
	switch(event.type){
		case "mousedown":
			data.data.clickOn = true;
			data.data.steps = 0;
			data.data.positionX = event.pageX;
			data.data.positionY = event.pageY;
		break;
		case "touchstart":
			data.data.clickOn = true;
			data.data.steps = 0;
			data.data.positionX = event.originalEvent.changedTouches[0].pageX;
			data.data.positionY = event.originalEvent.changedTouches[0].pageY;
			data.data.fingerIdentifier = event.originalEvent.changedTouches[0].identifier;
		break;
		case "mousemove":
		case "touchmove":
			if(data.data.clickOn)
				data.data.steps++;
		break;
		case "mouseup":
			if(data.data.clickOn && (!data.notOtherEvents || this.dragOn || this.resizeOn)){
				positionX = event.pageX;
				positionY = event.pageY;

				if(this.hasElementDragResizeEvent(data.element)){

					distance = Math.sqrt( (positionX - data.data.positionX)*(positionX - data.data.positionX) + (positionY - data.data.positionY)*(positionY - data.data.positionY) );

					if(data.data.steps > 5 || data.data.distance > 10) return false;
					else this.call(data.randIdentifier, {pageX: positionX, pageY: positionY}, event);
				}else{
					this.call(data.randIdentifier, {pageX: positionX, pageY: positionY}, event);
				}

				data.data.clickOn = false;
			}
		break;
		case "touchend":
			if(data.data.clickOn && (!data.notOtherEvents || this.dragOn || this.resizeOn)){
				identifier = this.getMultitouchIndex(event, data.data.fingerIdentifier);
				if(identifier === false) return false;

				positionX = event.originalEvent.changedTouches[identifier].pageX;
				positionY = event.originalEvent.changedTouches[identifier].pageY;

				if(this.hasElementDragResizeEvent(data.element)){
					distance = Math.sqrt( (positionX - data.data.positionX)*(positionX - data.data.positionX) + (positionY - data.data.positionY)*(positionY - data.data.positionY) );

					if(data.data.steps > 10 || data.data.distance > 15) return false;
					else this.call(data.randIdentifier, {pageX: positionX, pageY: positionY}, event);
				}else{
					this.call(data.randIdentifier, {pageX: positionX, pageY: positionY}, event);
				}

				data.data.clickOn = false;
			}
		break;
	}
	return false;
};

EventHandler.prototype.resize = function(event, data, delta, deltaX, deltaY) {
	"use strict";
	var identifier, touches, i;
	var time = new Date();
	switch(event.type){
		case "touchstart":
			if(event.originalEvent.touches.length > 1 && !this.resizeOn){
				data.time = time;

				//Si empiezo un resize tengo que cancelar el drag.
				this.dragOnRandIdentifier = -1;
				this.dragOn = false;

				this.resizeOn = true;
				this.resizeOnIdentifier = data.identifier;

				data.data.fingersIdentifier = [event.originalEvent.touches[0].identifier, event.originalEvent.touches[1].identifier];
				data.data.fingersPositions = [
					[event.originalEvent.touches[0].pageX, event.originalEvent.touches[0].pageY],
					[event.originalEvent.touches[1].pageX, event.originalEvent.touches[1].pageY],
				];
				data.data.fingersCenter =  [(event.originalEvent.touches[0].pageX + event.originalEvent.touches[1].pageX) / 2, (event.originalEvent.touches[0].pageY + event.originalEvent.touches[1].pageY) / 2];
				data.data.fingersDistance = Math.sqrt( (data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0])*(data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0]) + (data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1])*(data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1]) );
			}
		break;
		case "touchmove":
			if(this.resizeOn && time - data.time > 15){
				data.time = time;
				var x1, y1, x2, y2, distance, centerx, centery, factor;
				touches = [];
				for (i = event.originalEvent.changedTouches.length - 1; i >= 0; i--) { //Obtengo los dedos que se han movido de los que tengo en mi lista
					if(event.originalEvent.changedTouches[i].identifier == data.data.fingersIdentifier[0] || event.originalEvent.changedTouches[i].identifier == data.data.fingersIdentifier[1])
						touches.push(event.originalEvent.changedTouches[i]);
				}

				if(touches.length === 0) return false; //Si no ha cambiado ningún dedo de los que nos interesa, fin.
				else if(touches.length === 1){ //Solo hay un dedo, así que conservamos una coordenada anterior.
					if(touches[0].identifier === data.data.fingersIdentifier[0]){
						x1 = touches[0].pageX;
						y1 = touches[0].pageY;
						x2 = data.data.fingersPositions[1][0];
						y2 = data.data.fingersPositions[1][1];
					}else{
						x1 = data.data.fingersPositions[0][0];
						y1 = data.data.fingersPositions[0][1];
						x2 = touches[0].pageX;
						y2 = touches[0].pageY;
					}
				}else if(touches.length > 1){ //Los 2 han cambiado
					if(touches[0].identifier === data.data.fingersIdentifier[0]){
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

				factor = distance / data.data.fingersDistance;


				if(data.autoEvent && factor !== 1){
					this.call(data.randIdentifier, {
						center: [centerx, centery],
						desplaced: [centerx - data.data.fingersCenter[0], centery - data.data.fingersCenter[1]],
						factor: factor,
						distance: distance,
						rad: Math.atan2(y1-y2, x1-x2),
						fingers: [x1, y1, x2, y2]
					}, event);

					data.data.fingersCenter[0] = centerx;
					data.data.fingersCenter[1] = centery;

					data.data.fingersDistance = distance;

					data.data.fingersPositions[0][0] = x1;
					data.data.fingersPositions[0][1] = y1;
					data.data.fingersPositions[1][0] = x2;
					data.data.fingersPositions[1][1] = y2;
				}

			}
		break;
		case "touchend":
			if(this.resizeOn){
				var touchesRemain, touchSelected;
				touchesRemain = false;
				touches = [];
				for (i = event.originalEvent.changedTouches.length - 1; i >= 0; i--) { //Obtengo los dedos que se han movido de los que tengo en mi lista
					if(event.originalEvent.changedTouches[i].identifier == data.data.fingersIdentifier[0] || event.originalEvent.changedTouches[i].identifier == data.data.fingersIdentifier[0])
						touches.push(event.originalEvent.changedTouches[i]);
				}

				if(touches.length > 0){ //Se ha quitadoun dedo. Miramos si quedan más dedos, si no quedan, cancelamos el resize, si quedan pasamos a usar esos otros.
					if(event.originalEvent.touches.length > 1){ //miramos si quedan al menos 2 dedos. Si quedan 2 o más continuamos con el resize
						for (i = event.originalEvent.touches.length - 1; i >= 0; i--) { //Queda algún dedo de los marcados en touches? si es así solo cambiamos uno, si no, cambiamos los 2.
							if(event.originalEvent.touches[i].identifier == data.data.fingersIdentifier[0]){
								touchesRemain = i;
								touchSelected = 0;
							}else if(event.originalEvent.touches[i].identifier == data.data.fingersIdentifier[1]){
								touchesRemain = i;
								touchSelected = 1;
							}
						}
						if(touchesRemain === false){ //No quedan dedos, así que pasamos a usar los otros 2 dedos.
							data.data.fingersIdentifier = [event.originalEvent.touches[0].identifier, event.originalEvent.touches[1].identifier];
							data.data.fingersPositions[0][0] = event.originalEvent.touches[0].pageX;
							data.data.fingersPositions[0][1] = event.originalEvent.touches[0].pageY;
							data.data.fingersPositions[1][0] = event.originalEvent.touches[1].pageX;
							data.data.fingersPositions[1][1] = event.originalEvent.touches[1].pageY;
	
							data.data.fingersCenter =  [(data.data.fingersPositions[0][0] + data.data.fingersPositions[1][0]) / 2, (data.data.fingersPositions[0][1] + data.data.fingersPositions[1][1]) / 2];
							data.data.fingersDistance = Math.sqrt( (data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0])*(data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0]) + (data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1])*(data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1]) );
						}else{ //Queda un dedo, así que pasamos a sustituir el dedo perdido por otro nuevo.
							if(touchesRemain === 0){ //Como cogemos siempre los 2 primeros asumimos que el repetido es o el [0] o el [1] y cogemos el otro.
								if(touchSelected === 0){
									data.data.fingersPositions[1][0] = event.originalEvent.touches[1].pageX;
									data.data.fingersPositions[1][1] = event.originalEvent.touches[1].pageY;
								}else{
									data.data.fingersPositions[0][0] = event.originalEvent.touches[1].pageX;
									data.data.fingersPositions[0][1] = event.originalEvent.touches[1].pageY;
								}
							}else{
								if(touchSelected === 0){
									data.data.fingersPositions[1][0] = event.originalEvent.touches[0].pageX;
									data.data.fingersPositions[1][1] = event.originalEvent.touches[0].pageY;
								}else{
									data.data.fingersPositions[0][0] = event.originalEvent.touches[0].pageX;
									data.data.fingersPositions[0][1] = event.originalEvent.touches[0].pageY;
								}
							}
							data.data.fingersCenter =  [(data.data.fingersPositions[0][0] + data.data.fingersPositions[1][0]) / 2, (data.data.fingersPositions[0][1] + data.data.fingersPositions[1][1]) / 2];
							data.data.fingersDistance = Math.sqrt( (data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0])*(data.data.fingersPositions[0][0] - data.data.fingersPositions[1][0]) + (data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1])*(data.data.fingersPositions[0][1] - data.data.fingersPositions[1][1]) );

						}
					}else{
						this.resizeOn = false;
						this.resizeOnIdentifier = -1;
					}
				}
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
