"use strict";
var Ventana = new Function();

Ventana.prototype.iniciar = function(datos) {
	var self = this;
	this.universo = datos.universo;

	if(datos && datos.padre) this.padre = datos.padre;
	else 			this.padre  = $("body");
	this.padre_contenedor = $("<div>").addClass("ventana_principal_padre_contenedor");
	this.fondo 		= $("<div>").addClass("ventana_principal_fondo");
	this.titulo		= $("<div>Titulo ventana con lo que sea</div>").addClass("ventana_principal_titulo"); 
	this.cerrar_div	= $("<div>").addClass("ventana_principal_cerrar"); 
	//this.contenedor = $("<div>").addClass("ventana_principal_contenedor").css({height: this.padre.height() - 168});
	this.contenedor = $("<div>").addClass("ventana_principal_contenedor");
	this.contenedor_scroll = $("<div>").addClass("");
	this.fondo_fondo = $('<div>').addClass("ventana_principal_fondo_fondo");
	this.fondo_footer = $('<div>').addClass("ventana_principal_fondo_footer");


	this.padre.append(this.padre_contenedor.append(this.fondo.append(this.titulo).append(this.contenedor.append(this.contenedor_scroll).append($('<div>').addClass("clear"))).append(this.cerrar_div).append(this.fondo_footer)).append(this.fondo_fondo));

	this.cerrar_div.bind("click touchend",(function () {
		self.cerrar();
	}));

};

Ventana.prototype.remove = function() {
	this.fondo.remove();
	this.fondo_fondo.remove();
	this.universo.css({display: "block"});
	window.is_unselect_allowed = true;
};

Ventana.prototype.cerrar = function() {
	var self = this;
	this.universo.css({display: "block"});
	this.padre_contenedor.animate({opacity: 0}, {duration: 200, complete: function () {
			self.padre_contenedor.css({display: "none"});
			self.borrar_inner();
	}});
	window.is_unselect_allowed = true;
};

Ventana.prototype.borrar_inner = function() {
	this.contenedor_scroll.html("");
};

Ventana.prototype.ocultar = function() {
	var self = this;
	this.universo.css({display: "block"});
	this.padre_contenedor.animate({opacity: 0}, {duration: 200, complete: function () {
			self.padre_contenedor.css({display: "none"});
	}});
	window.is_unselect_allowed = true;
};

Ventana.prototype.mostrar = function() {
	var self = this;
	this.padre_contenedor.css({opacity: 0, display: "block"}).animate({opacity: 1}, {duration: 200, complete: function () {
		self.universo.css({display: "none"});
	}});
	window.is_unselect_allowed = false;
};

Ventana.prototype.append = function (data) {
	this.contenedor_scroll.append(data);
};

Ventana.prototype.prepend = function (data) {
	this.contenedor_scroll.prepend(data);
};

Ventana.prototype.titulo = function(data) {
	this.titulo.text();
};