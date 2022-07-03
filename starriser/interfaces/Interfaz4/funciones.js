"use strict";
/*GENERADORES RANDOM!!!*/

function generar_planeta () {
	var matriz_planetas = new Array(9);
	matriz_planetas[0] = Math.round(Math.random()*4,49);						//[0] si está deshabitado, 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
	matriz_planetas[1] = Math.random()*2*Math.PI;								//[1] Radianes de posición de planeta
	if(matriz_planetas[0] != 0){ 												//Si está habitado ponemos...
		matriz_planetas[2] = "Nombre_usu"+parseInt(Math.random()*10000000000); 	//[2] El nombre del usuario
		matriz_planetas[3] = Math.round(Math.random()*1);						//[3] Si pertenece a una alianza
		if(matriz_planetas[3] == 1)	{											//Si pertenece a una alianza ponemos...
			matriz_planetas[4] = "Alianza"+parseInt(Math.random()*10000000000);	//[4] El nombre de la alianza
		 	matriz_planetas[5] = Math.round(Math.random()*2)					//[5] 0 Alianza neutral, 1 Alianza aliada, 2 Alianza enemiga, 3 Alianza propia 
		}
		matriz_planetas[6] = parseInt(Math.random()*100000)*100000;				//[6] Población del planeta
		matriz_planetas[7] = "Nombre_pla"+parseInt(Math.random()*10000000000);	//[7] Nombre del planeta
		matriz_planetas[8] = parseInt(Math.random()*10000000000);				//[8] Puntuación del jugador
		matriz_planetas[9] = parseInt(Math.random()*10000000000);				//[9] ID del jugador
	}
	return matriz_planetas;
}




var selector_opcion_tactil = new Function();

selector_opcion_tactil.prototype.init = function(data) { //Data = {clase: "la clase", opciones: [vector de opciones cada posicion contiene {texto: "el texto a mostrar", check: aquí va true si está definido, si no está, directamente no se pone este valor o se pone en false}]}
	var self = this;
	this.contenedor = $("<div>").addClass("selector_opcion_tactil_contenedor");
	this.opcion = new Array(data.opciones.length);
	this.select = -1;
	this.datos = data;

	if(data.clase){
		this.contenedor.addClass(data.clase); 
	}
	var clase = "";
	for(var i = data.opciones.length-1; i >= 0; i--){
		var clase = "selector_opcion_tactil_central";

		if(i == data.opciones.length-1) clase = "selector_opcion_tactil_final";
		else if(i == 0) clase = "selector_opcion_tactil_inicio";

		this.opcion[i] = $("<div>").attr("class",clase).append($("<p>").text(data.opciones[i].texto) );
		if(data.opciones[i].check && data.opciones[i].check == true){
			this.opcion[i].addClass(this.opcion[i].attr("class")+"_active");
			this.select = i;
		}
		this.contenedor.prepend(this.opcion[i]);

		this.opcion[i].bind("click touchend",((function (i, self) {
			return function () {
				self.set_option(i);
			}
		})(i, self)));

	}
};

selector_opcion_tactil.prototype.get_dom = function() {
	return this.contenedor;
};

selector_opcion_tactil.prototype.set_option = function(i) {
	if(this.select == 0) 						this.opcion[this.select].removeClass("selector_opcion_tactil_inicio_active");
	else if(this.select == this.datos.opciones.length-1) 	this.opcion[this.select].removeClass("selector_opcion_tactil_final_active");
	else this.opcion[this.select].removeClass("selector_opcion_tactil_central_active");

	this.opcion[i].addClass(this.opcion[i].attr("class")+"_active");
	this.select = i;
};

selector_opcion_tactil.prototype.get_option = function(i) {
	return this.select;
};





var lista_checks = new Function();

lista_checks.prototype.init = function(data) { //Data = {clase: "la clase", opciones: [vector de opciones cada posicion contiene {texto: "el texto a mostrar", check: aquí va true si está definido, si no está, directamente no se pone este valor o se pone en false}]}
	var self = this;
	this.contenedor = $("<div>").addClass("selector_check_contenedor");
	this.opcion = new Array(data.opciones.length);
	this.select = -1;
	this.datos = data;
	this.names = "radio_randname_"+Math.round(Math.random()*10000);

	if(data.clase){
		this.contenedor.addClass(data.clase); 
	}
	var clase = "";
	for(var i = data.opciones.length-1; i >= 0; i--){
		var clase = "selector_check_opcion";


		this.opcion[i] = $("<label>").attr("class",clase).text(data.opciones[i].texto).append($('<input type="radio">').attr("name",this.names).change((function (i, self) {
			return function () {
				if($(this).is(":checked")) self.set_option(i);
			}	
		})(i, self)));

		if(data.opciones[i].check && data.opciones[i].check == true){
			this.opcion[i].prop('checked', true);
			this.select = i;
		}
		this.contenedor.prepend(this.opcion[i]);

	}
};

lista_checks.prototype.get_dom = function() {
	return this.contenedor;
};

lista_checks.prototype.set_option = function(i) {
	this.select = i;
};

lista_checks.prototype.get_option = function(i) {
	return this.select;
};



var select_option = Function();

select_option.prototype.init = function(data) {//Data = {clase: "la clase", opciones: [vector de opciones cada posicion contiene {texto: "el texto a mostrar", check: aquí va true si está seleccionado}]}
	var self = this;
	this.call_function_changue = 0;
	this.contenedor = $("<div>").addClass("selector_select_contenedor");
	this.mostrado = 0;

	this.icono ="▼";
	this.icono = $("<p>"+this.icono+"</p>").addClass("selector_select_select_icono");

	this.select = $("<div>").addClass("selector_select_select");
	this.options_select = $("<div>").addClass("selector_select_options");
	
	this.opcion = new Array(data.opciones.length);
	this.selecionada = -1;
	this.datos = data;

	if(data.clase){
		this.contenedor.addClass(data.clase); 
	}

	this.select.html($("<p>").text(traducciones_menu_select[0]));

	var clase = "";
	for(var i = data.opciones.length-1; i >= 0; i--){

		this.opcion[i] = $("<p>").text(data.opciones[i].texto);

		if(data.opciones[i].check && data.opciones[i].check == true){
			this.select.html($("<p>").text(this.datos.opciones[i].texto));
			this.selecionada = i;
		}

		this.opcion[i].bind("click touchend", (function (i, self) {
			return function () {
				self.set_option(i);
			}
		})(i, self))

		this.options_select.prepend(this.opcion[i]);
	}

	this.select.bind("click touchend", function () {
		if(self.mostrado == 0) self.mostrar_lista();
		else self.ocultar_lista();
	});

	this.icono.bind("click touchend", function () {
		if(self.mostrado == 0) self.mostrar_lista();
		else self.ocultar_lista();
	});

	this.contenedor.append(this.select).append(this.options_select).append(this.icono);
};

select_option.prototype.onchangue = function(funct, parent) {
	this.call_function_changue = funct;
	this.call_function_changue_contex = parent;
};

select_option.prototype.set_option = function(i) {
	this.select.html($("<p>").text(this.datos.opciones[i].texto));
	var seleccionado = this.selecionada;
	this.selecionada = i;
	this.ocultar_lista();
	if(i != seleccionado && this.call_function_changue != 0) this.call_function_changue.call(this.call_function_changue_contex, this.selecionada);
};

select_option.prototype.mostrar_lista = function() {
	this.options_select.css({display: "block"}).animate({height: 300},{duration: 200, queue: false});
	this.mostrado = 1;
};

select_option.prototype.ocultar_lista = function() {
	this.options_select.animate({height: 0},{duration: 200, queue: false, complete: function(){
		$(this).css({display: "none"})
	}});
	this.mostrado = 0;
};

select_option.prototype.get_option = function(i) {
	return this.select;
};

select_option.prototype.get_dom = function() {
	return this.contenedor;
};


var slide_numerico = new Function();

slide_numerico.prototype.init = function(data) { //max: el maximo valor que se puede poner, clase: la clase que tendrá la barrita, init: donde se inica el slide, step: la funcion que se llamará al mover la barria , param_step: parametros que se le pasaran al step, padre_step: el objeto (contexto) padre donde se ejecutará la función del step usando call()
	var self = this;
	//console.log(data)
	if(data.max) 
		this.max = data.max;
	else this.max = 0;
	if(data.ini) 
		this.ini = data.ini;
	else this.ini = 0;
	this.ini_input = (this.ini/100) * this.max;
	if(data.step) 
		this.step = data.step;
	else this.step = 0;
	if(data.param_step) 
		this.param_step = data.param_step;
	else this.param_step = 0;
	if(data.padre_step) 
		this.padre_step = data.padre_step;
	else this.padre_step = this;

	this.ajuste_inicio = 8;
	this.ajuste_final  = 10;
	self.resultado = 0;
	this.porcentaje = 0;

	if(data.clase) this.clase = data.clase;
	else this.clase = "";

	this.arrastrar_iniciado = 0;
	this.contenedor = $("<div>").addClass("slide_numerico_contenedor").addClass(this.clase);
	this.barra = $("<div>").addClass("slide_numerico_barra");
	this.arrastre = $("<div>").addClass("slide_numerico_arrastre");
	this.input_div = $("<div>").addClass("slide_numerico_input_div");
	this.input_input = $("<input>").attr("type","text").addClass("slide_numerico_input_input").val(this.ini_input);
	this.borde_inicio = $("<div>").addClass("slide_numerico_borde_inicio");

	this.contenedor.append(this.input_div.append(this.input_input)).append(this.barra.append(this.arrastre)).append(this.borde_inicio);

	this.arrastre.bind("mousedown touchstart", function (evento) {
		self.arrastrar_iniciado = 1;
		if(evento.originalEvent.touches){
			var posicion_raton_X_temp 	= evento.originalEvent.touches[0].pageX;
		}else{
			var posicion_raton_X_temp 	= evento.pageX;
		}
		self.pos_rel_raton_arrastre = posicion_raton_X_temp - self.arrastre.offset().left;
	});

	this.barra.bind("mousedown touchstart", function (evento) {
		self.eventos_acceso_rapido(evento);
	});

	this.borde_inicio.bind("mousedown touchstart", function (evento) {
		self.eventos_acceso_rapido(evento);
	});

	$(document).bind("mouseup touchend", function () {
		self.arrastrar_iniciado = 0;
	});

	$(document).bind("mousemove touchmove", function (evento) {
		if(self.arrastrar_iniciado == 1){
			var posicion_barra = self.barra.offset().left - self.ajuste_inicio;
			var tamano_barra   = self.barra.width() + self.ajuste_inicio + self.ajuste_final;
			var tamano_arrastre= self.arrastre.width();
			if(evento.originalEvent.touches){
				var posicion_raton_X_temp 	= evento.originalEvent.touches[0].pageX;
			}else{
				var posicion_raton_X_temp 	= evento.pageX;
			}

			if(posicion_raton_X_temp - self.pos_rel_raton_arrastre >= posicion_barra && posicion_raton_X_temp - self.pos_rel_raton_arrastre + tamano_arrastre <= posicion_barra + tamano_barra){ //estamos entre el 0 y el 100
				self.arrastre.css({left: posicion_raton_X_temp - posicion_barra - self.pos_rel_raton_arrastre - self.ajuste_inicio});
				this.porcentaje = (posicion_raton_X_temp - posicion_barra - self.pos_rel_raton_arrastre) / (tamano_barra - tamano_arrastre) 
			}else if(posicion_raton_X_temp - self.pos_rel_raton_arrastre >= posicion_barra){ //Estamos en 100
				self.arrastre.css({left: tamano_barra - self.ajuste_inicio - tamano_arrastre});
				this.porcentaje = 1;
			}else{ //Estamos en 0
				self.arrastre.css({left: -self.ajuste_inicio});
				this.porcentaje = 0;
			}

			if(self.step != 0){
				self.step.call(self.padre_step, self.param_step);
			}

			self.input_input.val(Math.round((this.porcentaje) * self.max));
			self.resultado = this.porcentaje * self.max;

		}
		return false;
	});

	this.input_input.keyup(function (event) {
		var tamano_barra    = self.barra.width() + self.ajuste_inicio + self.ajuste_final;
		var tamano_arrastre = self.arrastre.width();
		var valor = $(this).val();
		valor = parseFloat(valor);

		if(!isNaN(valor)){
			if(valor < 0) valor = 0;
			else if(valor > self.max) valor = self.max;	
		}else{
			valor = 0;
		}
		self.input_input.val(parseInt(valor));
		self.resultado = valor;

		this.porcentaje = valor / self.max;

		self.arrastre.css({left: (tamano_barra - tamano_arrastre) * this.porcentaje - self.ajuste_inicio});	

		if(self.step != 0){
			self.step.call(self.padre_step, self.param_step);
		}	
	});

	this.input_input.keydown(function (event) {
		var tamano_barra    = self.barra.width() + self.ajuste_inicio + self.ajuste_final;
		var tamano_arrastre = self.arrastre.width();
		var valor = $(this).val();
		valor = parseFloat(valor);

		if(event.which == 38)
			valor++;
		else if(event.which == 40)
			valor--;

		if(!isNaN(valor)){
			if(valor < 0) valor = 0;
			else if(valor > self.max) valor = self.max;	
		}else{
			valor = 0;
		}
		self.input_input.val(parseInt(valor));
		self.resultado = valor;

		this.porcentaje = valor / self.max;

		self.arrastre.css({left: (tamano_barra - tamano_arrastre) * this.porcentaje - self.ajuste_inicio});	
		
		if(self.step != 0){
			self.step.call(self.padre_step, self.param_step);
		}		
	});
};

slide_numerico.prototype.eventos_acceso_rapido = function(evento) {
	this.arrastrar_iniciado = 1;
	if(evento.originalEvent.touches){
		var posicion_raton_X_temp 	= evento.originalEvent.touches[0].pageX;
	}else{
		var posicion_raton_X_temp 	= evento.pageX;
	}
	this.pos_rel_raton_arrastre = this.arrastre.width() / 2;
	(evento.type == "mousedown") ? evento.type = "mousemove" : evento.type = "touchmove";
	$(document).trigger(evento);
};

slide_numerico.prototype.recalc = function(data) {
	var self = this;
	if(data){
		if(data.max) 
			this.max = data.max;
		if(data.ini) 
			this.ini = data.ini;
		this.ini_input = (this.ini/100) * this.max;
	}

	this.porcentaje = this.ini / this.max;

	this.arrastre.css("left",(self.ajuste_inicio + self.barra.width() + self.ajuste_final - self.arrastre.width()) * (this.ini/100) - self.ajuste_inicio);
	self.resultado = this.porcentaje * self.max;
};

slide_numerico.prototype.get_dom = function() {
	return this.contenedor;
};

slide_numerico.prototype.get_val = function() {
	return this.resultado;
};



var campo_batalla = new Function();

campo_batalla.prototype.init = function(usuario) {
	this.iniciar(usuario);
};

campo_batalla.prototype.iniciar = function(usuario) {
	(usuario == 1) ? this.usuario = 1 : this.usuario = 0;
	(usuario == 1) ? this.usuario_texto = "atacante" : this.usuario_texto = "defensor";

	this.v_cuadros = new Array(38);
	this.contador_cuadros = 0;
	this.campo_html = new Array(4);
	this.zona = new Array();
	this.zona[0] = $('<div class="campo_batalla_izquierda"></div>');
	this.zona[1] = $('<div class="campo_batalla_centro"></div>');
	this.zona[2] = $('<div class="campo_batalla_derecha"></div>');
	this.zona[3] = $('<div class="campo_batalla_trasero"></div>');

	this.crear_campo_html_bucle(this.usuario);

	this.contenedor = $("<div>").append(this.zona[0]).append(this.zona[1]).append(this.zona[2]).append(this.zona[3]).addClass("campo_batalla_contenedor").addClass("campo_batalla_"+this.usuario_texto);

	this.contenedor.append('<div class="clear"></div>');
	this.contenedor_padre = $("<div>").addClass("campo_batalla_contenedor_padre")
	this.contenedor_padre.append(this.contenedor);
};

campo_batalla.prototype.crear_campo_html_bucle = function(usuario){ //Usuario == 1 -> Atacante, 0 -> Defensor
	var temp; 
	var self = this;
	//Lateral izquierdo
	var zona = 0;
	this.campo_html[0] = new Array(3);
	for (var i = 0; i < 3; i++) {
		this.campo_html[0][i] = new Array(3);

		for (var j = 0; j < 3; j++) {
			this.campo_html[zona][i][j] = new cuadro(this.zona[zona], self);

			this.v_cuadros[self.contador_cuadros++] = this.campo_html[zona][i][j];

		};
	};
	//Centro
	zona = 1;
	this.campo_html[zona] = new Array(4);
	for (var i = 0; i < 4; i++) { 
		temp = 4;
		if(i==0) temp = 6;

		this.campo_html[zona][i] = new Array(temp);

		for (var j = 0; j < temp; j++) {
			this.campo_html[zona][i][j] = new cuadro(this.zona[zona], self);
			this.v_cuadros[self.contador_cuadros++] = this.campo_html[zona][i][j];
		};

	};
	//Lateral derecho;
	zona = 2;
	this.campo_html[zona] = new Array(3);
	for (var i = 0; i < 3; i++) {
		this.campo_html[zona][i] = new Array(3);

		for (var j = 0; j < 3; j++) {				
			this.campo_html[zona][i][j] = new cuadro(this.zona[zona], self);
			
			this.v_cuadros[self.contador_cuadros++] = this.campo_html[zona][i][j];
		};
	};
	//Traseros
	zona = 3;
	this.campo_html[zona] = new Array([],[]);
	for (var i = 0; i < 2; i++) {
		this.campo_html[zona][0][i] = new cuadro(this.zona[zona], self);
		this.v_cuadros[self.contador_cuadros++] = this.campo_html[zona][0][i];
	};

	if(usuario == 0){
		this.v_cuadros[9] .set_clase_extra("centro_unico_primera_fila_izquierda");
		this.v_cuadros[14].set_clase_extra("centro_unico_primera_fila_derecha");
	}else{
		this.v_cuadros[9] .set_clase_extra("centro_unico_primera_fila_derecha");
		this.v_cuadros[14].set_clase_extra("centro_unico_primera_fila_izquierda");
	}
}

campo_batalla.prototype.get_dom = function() {
	return this.contenedor_padre;
};



function cuadro (padre, obj_p) {
	this.init(padre, obj_p);
}

cuadro.prototype.init = function(padre, obj_p, clase_extra) {
	this.padre = obj_p;
	this.html_padre = padre;
	if(typeof(clase_extra) == "undefined") this.clase_extra = clase_extra
	else this.clase_extra = "";
	this.clase = "";
	//this.cuadro = $('<div class="cuadro_campo"><p>'+(this.padre.contador_cuadros)+'</p></div>');
	this.cuadro = $('<div class="cuadro_campo"></div>');
	if(obj_p.usuario == 1) this.html_padre.append(this.cuadro);
	else this.html_padre.prepend(this.cuadro);
};

cuadro.prototype.set_clase_extra = function(clase_extra) {
	this.clase_extra = clase_extra
};

cuadro.prototype.set_tipo = function(tipo) {
	if(tipo != -1){
		this.tipo = tipo;
		this.cuadro.removeClass(this.clase);
		if(this.clase_extra != "") this.clase = this.clase_extra + " ";
		else this.clase = "";
		this.clase += "nave_cuadro_campo_"+tipo;
		this.cuadro.addClass(this.clase);
	}else{
		this.clase = "";
		if(this.clase_extra != "")
			this.cuadro.attr("class", "cuadro_campo " + this.clase_extra);
		else
			this.cuadro.attr("class", "cuadro_campo");
	}
};

cuadro.prototype.get_tipo = function() {
	return this.tipo;
};

cuadro.prototype.get_dom = function() {
	return this.cuadro;
};





//Herencia del campo base

var campo_batalla_estrategia = new Function();

campo_batalla_estrategia.prototype = new campo_batalla();

campo_batalla_estrategia.prototype.init = function(usuario, naves) {
	this.iniciar(usuario);
	var self = this;
	//Hacer el sistema de botones de las naves y el como ponerlas.
	this.cuadro_naves = $("<div>").addClass("campo_batalla_estrategia_cuadro_naves");
	this.cuadros_seleccionados = new Array();
	this.seleccionados = 0;
	//Hacer sistema de selección de cuadros. Osea, el bucle para poner el cuadrito que los selecciona.
	//Empieza el caos, esto es para seleccionar los cuadros. Creo un evento por cada cuadro y además tengo que usar 2 closures para poder ver las variables bien...
	for (var i = this.campo_html.length - 1; i >= 0; i--) {
		for (var j = this.campo_html[i].length - 1; j >= 0; j--) {
			for (var k = this.campo_html[i][j].length - 1; k >= 0; k--) {
				(function (i, j, k, self) {
					return self.campo_html[i][j][k].get_dom().bind("click touchend", (function (e) {
						return function (e) {
							//Seleccionar un cuadro. Esto es tan guarro porque para pasar variables con eventos a jquery que ya le pasa sus propias variables a la función hay que hacer (o creo a falta de ver una mejor forma) 2 closures nuevos.
							var temp = $('<div>').addClass("cuadro_marcador_cuadro_seleccionado");
							if(!e.ctrlKey){
								for(var l = 0; l < self.seleccionados; l++){
									self.cuadros_seleccionados[l].cuadro.remove();
									delete self.cuadros_seleccionados[l];
								}
								self.cuadros_seleccionados[0] = {zona: i, fila: j, columna: k, cuadro: temp};
								self.seleccionados = 1;
							}else{
								for(var m = 0; m < self.seleccionados; m++){
									if(self.cuadros_seleccionados[m].zona == i && self.cuadros_seleccionados[m].fila == j && self.cuadros_seleccionados[m].columna == k){
										/*self.cuadros_seleccionados[m].cuadro.remove(); //Hay que hacer que esto deseleccione un cuadro, pero tiene un error y estoy cansado
										self.cuadros_seleccionados.splice(m);
										self.seleccionados--;*/
										return false;
									}
								}
								self.cuadros_seleccionados[self.seleccionados++] = {zona: i, fila: j, columna: k, cuadro: temp};
							}

							var por_zona_x = 0;
							var por_zona_y = 0;
							if(i == 1){ por_zona_x = 205; if(j == 0) por_zona_x = 156;}
							else if(i == 2){ por_zona_x = 459;}
							else if(i == 3){ por_zona_x = 254; por_zona_y = 197}


							temp.css({left: por_zona_x + k*49 - 1, top: por_zona_y + j*49 - 1});
							self.contenedor.append(temp);
						}
					})());
				})(i, j, k, self);
			};
		};
	};

	this.cuadros_naves_a_poner = new Array();
	var j = 0;
	for (var i = naves.length - 1; i >= 0; i--) {
		this.cuadros_naves_a_poner[j] = $('<div>').addClass("cuadro_campo_a_poner").append($("<div>").addClass("cuadro_campo nave_cuadro_campo_"+i));
		this.cuadros_naves_a_poner[j].bind("click touchend", (function (i) {
			return function(){
				var zona = 0;
				var fila = 0;
				var columna = 0;
				for(var j = 0; j < self.seleccionados; j++){
					zona = self.cuadros_seleccionados[j].zona;
					fila = self.cuadros_seleccionados[j].fila;
					columna = self.cuadros_seleccionados[j].columna;
					self.campo_html[zona][fila][columna].set_tipo(i);
				}
			}
		})(i));
		this.cuadro_naves.prepend(this.cuadros_naves_a_poner[j]);	
	};

	this.contenedor_padre.append(this.cuadro_naves);
};

campo_batalla_estrategia.prototype.set_estrategia = function(ships) {
	for (var i = ships.length - 1; i >= 0; i--) {
		this.v_cuadros[i].set_tipo(ships[i]);
	};
};

/*jQuery.preloadImages = function() {
	for(var i = 0; i<arguments.length; i++)
		jQuery("<img>").attr("src", arguments[i]);
};*/
//$.preloadImages("pics/pic1.jpg","pics/pic2.jpg","pics/pic3.jpg");

/*function rand_pos_neg() {
	var temp = Math.random()*2-1;
	if(temp >= 0) return 1;
	return -1;
}*/

/*function posicion_Y_circunferencia_for_jquery_css (R, rad) {
	var desvio_centro_menos_tam_planeta = 49.5;
	var X 	= R*Math.cos(rad);
	var Y 	= R*Math.sin(rad);

	return {left: X+desvio_centro_menos_tam_planeta+"%", top: Y+desvio_centro_menos_tam_planeta+"%"};
}*/
//radi = 1.08;
function posicion_Y_circunferencia_rand_neg_pos_rand_X_for_jquery_css (R, rad) { 
	//R = 0;
	//radi = radi + 0.4188789333333333;
	//rad = radi;
	var desvio_centro_menos_tam_planeta = 47.5;
	var X 	= R*Math.cos(rad);
	var Y 	= R*Math.sin(rad);

	return {left: X+desvio_centro_menos_tam_planeta+"%", top: Y+desvio_centro_menos_tam_planeta+"%"};
}

function seg2str(tiempo2){
	var tiempo = parseInt(tiempo2);
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
}
