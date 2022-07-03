"use strict";
var recursos = function (pad) {
	this.init(pad);
}

recursos.prototype.init = function(pad) {
	this.padre = pad;
	var self = this;
	this.contenedor = $('<div>').attr({id: "menu_superior_recursos"});
	this.padre.append(this.contenedor);


	$("body").append(this.contenedor); 
	this.fondo_w2 = this.contenedor.width()/2;
	this.contenedor.remove();

	this.padre.append(this.contenedor);
	this.contenedor.css({left: this.padre.width()/2 - this.fondo_w2});

	$(window).resize(function () {
		self.contenedor.css({left: self.padre.width()/2 - self.fondo_w2});
	});
	recursos = new Array(2352,3434,345768,41,3265,8636,5674);
};

recursos.prototype.get_recurso = function(recurso) {
	return recursos[recurso];
};