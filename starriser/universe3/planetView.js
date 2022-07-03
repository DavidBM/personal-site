"use strict";
var PlanetView = function () {
	this.init();
};

PlanetView.prototype.init = function() {
	var i;
	
	this.dom = {};

	this.dom.contenedor = document.createElement("div");
	this.dom.contenedor.className = "planetView container";

	this.dom.buttons = new Array(8);

	var clases = ["Lab", "MineB", "Shield", "MineA", "Defense", "MineN", "Shipyard", "Commerce"];

	for(i = 0; i < 8; i++){
		this.dom.buttons[i] = document.createElement("div");
		this.dom.buttons[i].className = "planetView button" + clases[i];
		this.dom.contenedor.appendChild(this.dom.buttons[i]);
	}

	var temp = document.createElement("div");
	temp.className = "planetView button_extension";
	this.dom.buttons[6].appendChild(temp);

	temp = document.createElement("div");
	temp.className = "planetView button_extension";
	this.dom.buttons[7].appendChild(temp);

	this.data = {};
	this.data.showed = false;

};

PlanetView.prototype.getDom = function() {
	return this.dom.contenedor;
};

PlanetView.prototype.show = function() {
	this.data.showed = true;
	var displacement = 1;
	var self = this;
	var temp = this.dom.buttons.length;
	for (var i = 0; i < temp; i++) {
		if(i % 2 === 0){
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().css({left: -200 * displacement, opacity: 0, display: "block"}).animate({left: 0, opacity: 1}, {duration: 400, queue: false});
				};
			})(i) , 100*Math.floor((this.dom.buttons.length - i + 1)/2));
		}else{
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().css({right: -200 * displacement, opacity: 0, display: "block"}).animate({right: 0, opacity: 1}, {duration: 400, queue: false});
				};
			})(i) , 100*Math.floor((this.dom.buttons.length - i + 1)/2));
		}
	}

	$(this.dom.contenedor).css({display: "block"});

};

PlanetView.prototype.hide = function() {
	this.data.showed = false;
	var self = this;
	var ntimes = new NtimeEvent(8, function () {
		if(self.data.showed === false) $(self.dom.contenedor).css({display: "none"});
	});
	var self = this;
	var temp = this.dom.buttons.length;
	for (var i = 0; i < temp; i++) {
		if(i % 2 === 0){
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().animate({left: -200, opacity: 0}, {duration: 300, queue: false, complete: function () {
						ntimes.handler.call(ntimes.context);
					}});
				};
			})(i) , 75*Math.floor(i/2) );
		}else{
			setTimeout( (function  (i) {
				return function () {
					$(self.dom.buttons[i]).stop().animate({right: -200, opacity: 0}, {duration: 300, queue: false, complete: function () {
						ntimes.handler.call(ntimes.context);
					}});
				};
			})(i) , 75*Math.floor(i/2) );
		}
	}
};