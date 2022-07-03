"use strict";

function enviar_mensaje() {
	var contenedor = $("<div>").addClass("escribir_mensaje");
	var textarea = $("<textarea>").addClass("mensaje_texto_input");
	var ali_usu = new selector_opcion_tactil();
	ali_usu.init({
		clase: "enviar_mensaje_selector_unico_ali_usu",
		opciones: [{
				texto: traducciones_enviar_mensaje[2]
			}, {
				texto: traducciones_enviar_mensaje[1],
				check: true
			}
		]
	});
	var input_nombre = $("<input>");
	var checks = new lista_checks();
	checks.init({
		clase: "escribir_mensaje_radix",
		opciones: [{
				texto: traducciones_enviar_mensaje[4]
			}, {
				texto: traducciones_enviar_mensaje[5]
			}, {
				texto: traducciones_enviar_mensaje[6]
			}, {
				texto: traducciones_enviar_mensaje[7]
			}
		]
	});
	contenedor.append($("<div>").addClass("escribir_mensaje_controles").append($("<div>").addClass("enviar_mensaje_destinatario").append("<p>" + traducciones_enviar_mensaje[0] + ": </p>").append(ali_usu.get_dom())).append($("<div>").addClass("enviar_mensaje_input_nombre").append("<p>" + traducciones_enviar_mensaje[3] + ": </p>").append(input_nombre)).append(checks.get_dom()).append($("<div>").addClass("boton_enviar_mensaje_g"))).append(textarea);
	this.get_dom = function () {
		return contenedor;
	}
}



var enviar_tropas = Function();

enviar_tropas.prototype.init = function (datos_planeta_json) {
	var self = this;
	/*Hacer ajax*/
	setTimeout(function () {
		self.datos = [
			"Nombre jugador", //Nombre del jugador
			"Nombre planeta", //Nombre del planeta atacado
			"Nombre Alianza", //Nombre de la alizanza
			"Distancia", 	  //Distancia del planeta
			"Tiempo llegada", //Tiempo llegada
			0, //Planeta donde atacas (0 deshabitado, 1 neutral, 2 aliado, 3 enemigo, 4 propio)
			0, //Alianza donde atacas (0 no hay alianza, 1 neutral, 2 aliado, 3 enemigo, 4 propio)
			[10, 11, 12, 13, 100487, 5420, 16, 17, 6547, 19, 250], //Cantidad de naves de las que dispone el jugador
			[
				[
					"Plantilla 1", 
					[7, 8, 9, 3, 10, 2, 4, 5, 6, 2, 5, 10, 12, 11, 2, 3, 5, 6, 7, 1, 8, 9, 5, 4, 2, -1, -1, -1, -1, -1, -1, -1, -1, 2, 3, 4, 5, 6]
				],[
					"Plantilla 2",
					[1, 8, 9, 5, 4, 2, -1, -1, -1, -1, -1, -1, -1, -1, 2, 3, 4, 5, 6, 7, 8, 9, 3, 10, 2, 4, -1, -1, -1, -1, -1, -1, -1, 2, 3, 5, 6, 7]
				],[
					"Plantilla 3",
					[]
				]
			]
		];
		//"Nombre jugador", "Nombre planeta", "Nombre Alianza", "Distancia", "Tiempo llegada", aliado el jugador?, aliado la alizanza?, la cantidad de naves de cada tipo, Plantillas y su nombre, en un futuro tambien su distribusción
		self.poner_datos();
	}, 200);
	/*Fin ajax*/
	this.datos_planeta_json = datos_planeta_json;
	this.contenedor = $("<div>");
	this.datos_planeta = $("<div>").addClass("cuadro_un_tercio_menu enviar_tropas_info");
	this.datos_plantilla = $("<div>").addClass("cuadro_un_tercio_menu");
	this.datos_enviar_ataque = $("<div>").addClass("cuadro_un_tercio_menu");
	this.datos_crear_estrategia = $("<div>").addClass("cuadro_completo_menu estrategia_tropas_info");
	this.datos_numero_naves = $("<div>").addClass("cuadro_completo_menu");
	this.contenedor.append(this.datos_planeta).append(this.datos_plantilla).append(this.datos_enviar_ataque).append(this.datos_crear_estrategia).append(this.datos_numero_naves);
}
enviar_tropas.prototype.poner_datos = function () { //aquí mostramos todo después de la llamada ajax
	var self = this;

	if(this.datos[2] == -1)
		var usuario = $("<span>" + traducciones_interfaz_generica[0] + "</span>");
	else
		var usuario = $("<span>" + this.datos[0] + "</span>");

	if(this.datos[2] == -1)
		var planeta = $("<span>" + traducciones_interfaz_generica[18] + "</span>");
	else
		var planeta = $("<span>" + this.datos[1] + "</span>");

	if(this.datos[3] == -1)
		var alianza = $("<span>").text(traducciones_interfaz_generica[2]);
	else 
		var alianza = $("<span>" + this.datos[2] + "</span>");

	this.datos_planeta_nombre_jugador = $("<p>").text(traducciones_interfaz_generica[9] + ": ").append(usuario);
	this.datos_planeta_nombre_planeta = $("<p>").text(traducciones_interfaz_generica[8] + ": ").append(planeta);
	this.datos_planeta_nombre_alianza = $("<p>").text(traducciones_interfaz_generica[10] + ": ").append(alianza);
	if(this.datos[3] != -1) 
		this.datos_planeta_distancia = $("<p>").html(traducciones_enviar_tropas[0] + ": <span>" + this.datos[3] + "</span>");
	else
		this.datos_planeta_distancia = $("<p>").html(traducciones_enviar_tropas[0] + ": <span>" + traducciones_interfaz_generica[2] + "</span>");
	this.datos_planeta_tiempo = $("<p>").html(traducciones_enviar_tropas[1] + ": <span>" + this.datos[4] + "</span>");
	
	if(this.datos[5] == 2) {
		usuario.addClass("texto_verde");
		planeta.addClass("texto_verde");
	} else if(this.datos[5] == 3) {
		usuario.addClass("texto_rojo");
		planeta.addClass("texto_rojo");
	} else if(this.datos[5] == 4) {
		usuario.addClass("texto_azul");
		planeta.addClass("texto_azul");
	}

	if(this.datos[6] == 2) alianza.addClass("texto_verde");
	else if(this.datos[6] == 3) alianza.addClass("texto_rojo");
	else if(this.datos[6] == 4) alianza.addClass("texto_azul");

	var temp = {
		clase: "select_enviar_tropas",
		opciones: Array(this.datos[8].length)
	};


	for(var i = this.datos[8].length - 1; i >= 0; i--) {
		temp.opciones[i] = {
			texto: this.datos[8][i][0],
			check: false
		};
	};

	var selects = new select_option();
	selects.init(temp);
	selects.onchangue(this.cambiar_estrategia, this);

	this.datos_plantilla.append(selects.get_dom());
	var boton_editar_estrategia = $("<div>").append("<p>" + traducciones_enviar_tropas[2] + "</p>").addClass("boton_editar_estrategia");
	this.datos_plantilla.append(boton_editar_estrategia);
	boton_editar_estrategia.bind("click touchend", function () {
		self.datos_crear_estrategia.css({
			height: 0,
			display: "block"
		}).animate({
			height: 250
		}, {
			duration: 400,
			queue: false
		});
	});

	//Aquí toca poner el botón de editar estrategia.
	//Aquí poner el botón de enviar ataque
	//Aquí iniciar un campo para editar una estrategia
	this.campo_estrategia_enviar_naves = new campo_batalla_estrategia();
	this.campo_estrategia_enviar_naves.init(1, this.datos[7]);
	this.datos_crear_estrategia.append(this.campo_estrategia_enviar_naves.get_dom());
	
	/*var campo_estrategia_enviar_naves1 = new campo_batalla_estrategia(); 
	campo_estrategia_enviar_naves1.init(1);
	this.datos_crear_estrategia.append(campo_estrategia_enviar_naves1.get_dom());*/
	this.datos_crear_estrategia.append('<div class="clear"></div>');
	//Aquí poner las barras del número de naves
	var cantidad_naves = this.datos[7];
	this.naves_numero = new Array(cantidad_naves.length);
	this.naves_div = new Array(cantidad_naves.length);
	this.imagenes_naves_div = new Array(cantidad_naves.length);
	this.titulos = new Array(cantidad_naves.length);
	for(i = 0; i < cantidad_naves.length; i++) {
		if(cantidad_naves[i] > 0) {
			this.naves_div[i] = $("<div>").addClass("contenedor_cantidad_naves_enviar");
			this.imagenes_naves_div = $("<div>").addClass("icono_grande_" + i).addClass("imagen_cantidad_naves_enviar");
			this.titulos[i] = $("<p>").addClass("titulo_cantidad_naves_enviar").text(vector_traducciones_nombres_naves[i]);
			this.naves_numero[i] = new slide_numerico();
			this.naves_numero[i].init({
				clase: "slide_cantidad_naves_enviar",
				max: cantidad_naves[i],
				predef: 0
			});
			this.naves_div[i].append(this.titulos[i]).append(this.naves_numero[i].get_dom()).append(this.imagenes_naves_div);
			this.datos_numero_naves.append(this.naves_div[i]);
		}
	}
	this.datos_planeta.append(this.datos_planeta_nombre_jugador).append(this.datos_planeta_nombre_planeta).append(this.datos_planeta_nombre_alianza).append(this.datos_planeta_distancia).append(this.datos_planeta_tiempo);
}
enviar_tropas.prototype.cambiar_estrategia = function(option) {
	this.campo_estrategia_enviar_naves.set_estrategia(this.datos[8][option][1]);
};
enviar_tropas.prototype.get_dom = function () {
	return this.contenedor;
}





var abrir_planeta = Function();

abrir_planeta.prototype.init = function (datos_planeta, recursos) {
	var self = this;
	this.recursos = recursos;
	this.datos_planeta = datos_planeta;
	setTimeout(function () {
		self.datos = {
			niveles: [0, 0, 0, 0, 0, 0, 0, 0, 0], //El nivel de cada edificio
			costes: [
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3],
				[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3]
			], //Los costes en mineral de cada edificio para subir al proximo nivel
			actualizando: 1, //El edificio que se está actualizando
			hora: [1234, 0, 0, 0, 0, 0, 0, 0, 0], //El tiempo que tarda X edificio en actualizarse
			acabar: 12445253523523, //El tiempo que falta para que el edificio actualizandose se actualize.
			pos_XY: {
				x: 23,
				y: 78
			}
		};
		self.poner_datos();
	}, 200);
	if(datos_planeta.orbita < 5) var clase_planeta = "caliente";
	else if(datos_planeta.orbita < 10) var clase_planeta = "templado";
	else var clase_planeta = "frio";
	this.contenedor = $("<div>");
	this.contenedor_padre = $("<div>");
	this.fondo_planeta = $('<div>').addClass("planeta_menu_principal_planeta").addClass("planeta_menu_principal_planeta" + datos_planeta.orbita);
	this.fondo_edificios = $('<div>').addClass("edificios_menu_principal_planeta");
	this.contenedor_padre.append(this.contenedor.append(this.fondo_planeta).append(this.fondo_edificios));
};
abrir_planeta.prototype.set_html = function () {
	this.contenedor_padre.append(this.contenedor.append(this.fondo_planeta).append(this.fondo_edificios));
};
abrir_planeta.prototype.poner_datos = function () {
	var edificios = new Array(9);
	var self = this;
	edificios[0] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_centro")		.append($('<p>').text(traducciones_nombre_edificios[0]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[1] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_almacen")		.append($('<p>').text(traducciones_nombre_edificios[1]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[2] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_extractor")		.append($('<p>').text(traducciones_nombre_edificios[2]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[3] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_sintetizador")	.append($('<p>').text(traducciones_nombre_edificios[3]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[4] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_astillero")		.append($('<p>').text(traducciones_nombre_edificios[4]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[5] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_puerto")		.append($('<p>').text(traducciones_nombre_edificios[5]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[6] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_electrica")		.append($('<p>').text(traducciones_nombre_edificios[6]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[7] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_espionaje")		.append($('<p>').text(traducciones_nombre_edificios[7]).addClass("texto_nombre_edificio_menu_planeta"));
	edificios[8] = $('<div>').addClass("click_edificio_menu_planeta").addClass("click_edificio_menu_planeta_investigacion")	.append($('<p>').text(traducciones_nombre_edificios[8]).addClass("texto_nombre_edificio_menu_planeta"));
	for(var i = edificios.length - 1; i >= 0; i--) {
		edificios[i].bind("click touchend", (function (i) {
			return function () {
				self.mostrar_seccion_edificio(i)
			};
		})(i));
	};
	for(var i = edificios.length - 1; i >= 0; i--) {
		this.fondo_edificios.append(edificios[i]);
	};
};
abrir_planeta.prototype.mostrar_seccion_edificio = function (edificio) {
	var self = this;
	this.contenedor.detach();
	this.titulo_edificio = new zona_datos_edificio_actualizar();
	this.titulo_edificio.init({
		orbita: this.datos_planeta.orbita,
		edificio: edificio,
		actualizar: {
			actualizable: actualizable,
			costes: this.datos.costes[edificio],
			hora: this.datos.hora[edificio],
			acabar: this.acabar,
			edificio: this.datos.actualizando
		}
	}, this.recursos, self);
	if(edificio == 0) this.menu_html = new edificio_centro_mando(); //Centro de mando
	else if(edificio == 1) this.menu_html = new edificio_almacen(); //Almacen
	else if(edificio == 2) this.menu_html = new edificio_extractor(); //Extractor
	else if(edificio == 3) this.menu_html = new edificio_sintetizador(); //Sintetizador
	else if(edificio == 4) this.menu_html = new edificio_astillero(); //Astillero
	else if(edificio == 5) this.menu_html = new edificio_puerto(); //Puerto
	else if(edificio == 6) this.menu_html = new edificio_electrica(); //Central electrica
	else if(edificio == 7) this.menu_html = new edificio_espionaje(); //Espionaje
	else if(edificio == 8) this.menu_html = new edificio_investigacion(); //Investigación
	this.menu_html.init({
		hora: this.datos.hora[edificio],
		posXY: this.datos.pos_XY
	});
	var actualizable = 1;
	//Hacer que compruebe si hay algún edificio que se stá actualizando y si no que mire si hay recursos suficientes.
	this.contenedor_padre.append(this.titulo_edificio.get_dom()).append(this.menu_html.get_dom());
};
abrir_planeta.prototype.restaurar = function () {
	this.contenedor_padre.html(this.contenedor);
	delete this.titulo_edificio;
};
abrir_planeta.prototype.get_dom = function () {
	return this.contenedor_padre;
};


var zona_datos_edificio_actualizar = Function();

zona_datos_edificio_actualizar.prototype.init = function function_name(datos, recursos, padre) { //{orbita: orbita planeta, edificio: numero del edificio, actualizar: {actualizable: 0-1, recursos: [213,43,325,124,2134,53,12,0], hora: tiempo que tarda en actualizarse ese edificio, acabar: tiempo en el que se podrá actualizar algo, edificio: edificio que se esta actualizando}}
	this.datos = datos;
	this.recursos = recursos;
	var self = this;
	this.cerrado = 0;
	this.contenedor = $("<div>");
	this.imagen_edificio = $('<div>').addClass("cuadro_un_tercio_menu").append($("<img>").attr({
		src: "contenido/imagenes_edificios_vista_interna_" + this.datos.edificio + ".jpg",
		alt: traducciones_nombre_edificios[this.datos.edificio],
		title: traducciones_descripciones_edificios[this.datos.edificio]
	}));
	this.titulo_edificio = $('<div>').addClass("cuadro_dos_tercio_menu_d").append($("<p>").text(traducciones_nombre_edificios[this.datos.edificio]).addClass("zona_datos_edificio_actualizar_titulo"));
	this.actual_edificio = $('<div>').addClass("cuadro_dos_tercio_menu_d");
	this.boton_volver_planeta = $("<p>").addClass("boton_volver_planeta_desde_edificio").text("« " + traducciones_interfaz_generica[17]);
	this.boton_minimizar = $("<p>").addClass("boton_volver_minimizar").text("∧");
	this.titulo_edificio.prepend(this.boton_volver_planeta).prepend(this.boton_minimizar);
	var recurso_p = $("<p>").addClass("zona_datos_edificio_actualizar_recursos_recurso");
	var recurso_temp;
	this.recursos_actualizar = $("<div>");
	for(var i = this.datos.actualizar.costes.length - 1; i >= 0; i--) {
		recurso_temp = recurso_p.clone().text(this.datos.actualizar.costes[i]);
		if(this.datos.actualizar.costes[i] <= this.recursos.get_recurso(i)) recurso_temp.addClass("texto_verde");
		else recurso_temp.addClass("texto_rojo");
		this.recursos_actualizar.append(recurso_temp);
	};
	recurso_temp = recurso_p.clone().text(this.datos.actualizar.hora);
	this.recursos_actualizar.append(recurso_temp);
	this.actual_edificio.append(this.recursos_actualizar);
	this.boton_volver_planeta.bind("click touchend", function () {
		self.remove();
		padre.restaurar();
	});
	this.boton_minimizar.bind("click touchend", function () {
		if(self.cerrado == 0) {
			self.contenedor.animate({
				height: 61
			}, {
				duration: 200,
				queue: false
			});
			self.imagen_edificio.css({
				display: "none"
			});
			self.cerrado = 1;
			self.boton_minimizar.text("∨");
		} else {
			self.contenedor.animate({
				height: 341
			}, {
				duration: 200,
				queue: false
			});
			self.imagen_edificio.css({
				display: "block"
			});
			self.cerrado = 0;
			self.boton_minimizar.text("∧");
		}
	});
	this.contenedor.css({
		overflow: "hidden"
	});
	this.contenedor.append(this.imagen_edificio).append(this.titulo_edificio).append(this.actual_edificio).append('<div class="clear"></div>');;
}
zona_datos_edificio_actualizar.prototype.get_dom = function () {
	return this.contenedor;
};
zona_datos_edificio_actualizar.prototype.remove = function () {
	this.contenedor.remove();
};


var edificio_almacen = Function();

edificio_almacen.prototype.init = function () {
	var self = this;
	setTimeout(function () {
		self.datos = [
			[124, 12, 54, 22, 35, 0, 4523, 2, 235, 3], //Recursos alamecenados
			[500, 500, 500, 500, 500, 500, 500, 500, 500, 500], //Recursos seguros
			[5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000] //Maximo espacio del almacén
		];
		self.poner_datos();
	}, 200);
	this.contenedor = $("<div>").addClass("cuadro_completo_menu");
};
edificio_almacen.prototype.poner_datos = function () {
	this.tbody = $("<tbody>");
	this.table = $("<table>").append($("<thead>").append($("<tr>").append($("<th>")).append($("<th>").text("Cantidad almacenada")).append($("<th>").text("Cantidad protegida ante robo")).append($("<th>").text("Capacidad máxima")))).append(this.tbody);
	for(var i = this.datos[0].length - 1; i >= 0; i--) {
		this.tbody.prepend($("<tr>").append($("<td>").text(traducciones_nombre_recursos[i])).append($("<td>").text(this.datos[0][i])).append($("<td>").text(this.datos[1][i])).append($("<td>").text(this.datos[2][i])));
	};
	this.contenedor.append(this.table);
};
edificio_almacen.prototype.get_dom = function () {
	return this.contenedor;
};


var edificio_centro_mando = Function();

edificio_centro_mando.prototype.init = function () {
	var self = this;
	setTimeout(function () {
		self.datos = {
			nombre: "Nombre planeta", //El nombre del planeta que se tiene que poder guardar
			poblacion: 235235, //La población del planeta
			crecimiento: 23, //El crecimiento de población por hora
			produccion: 34, //Dinero que produce el planeta
			construccion: [
				[0, 234],
				[4, 235],
				[8, 234]
			], //Id edificio, tiempo para acabar (el primer edificio dice el tiempo que le falta para acabar, el resto lo que le cuesta según la bda. Con lo que para sacar el tiempo total hay que sumar los tiempos)
			reparacion: [
				[2, 450],
				[5, 34]
			] //Id edificio, tiempo para repararlo
		};
		self.poner_datos();
	}, 200);
	this.contenedor = $("<div>").addClass("cuadro_completo_menu");
};
edificio_centro_mando.prototype.poner_datos = function () {
	//COLUMNA IZQUIERDA
	this.columna_i = $("<div>").addClass("columna_50_i"); //Aqui va el nombre del planeta, población y crecimiento de población
	//poner el nombre del planeta
	this.nombre_planeta_texto = $("<p>").addClass("nombre_planeta_texto").text(this.datos.nombre); //La parte que dice el nombre del planeta
	this.nombre_planeta_texto_presentacion = $("<p>").addClass("nombre_planeta_texto_presentacion").text(traducciones_centro_planeta[0] + ": ");
	this.nombre_planeta = $("<div>").addClass("nombre_planeta_contenedor");
	//poner la población del planeta
	this.poblacion_planeta_texto = $("<p>").addClass("poblacion_planeta_texto").text(this.datos.poblacion + " + " + this.datos.crecimiento + " " + traducciones_centro_planeta[2]); //La parte que dice la poblacion que hay y el crecimiento
	this.poblacion_planeta_texto_presentacion = $("<p>").addClass("poblacion_planeta_texto_presentacion").text(traducciones_centro_planeta[1] + ": ");
	this.poblacion_planeta = $("<div>").addClass("poblacion_planeta_contenedor");
	this.columna_i.append(this.nombre_planeta.append(this.nombre_planeta_texto_presentacion).append(this.nombre_planeta_texto)).append(this.poblacion_planeta.append(this.poblacion_planeta_texto_presentacion).append(this.poblacion_planeta_texto));
	//COLUMNA DERECHA
	this.columna_d = $("<div>").addClass("columna_50_d"); //Aquí van las colas. Sean de reparación o construcción.
	//Creamos la cola de edificios en construcción
	this.cola_construccion_texto = $("<p>").addClass("centro_mando_cola_texto").text(traducciones_centro_planeta[3]);
	this.cola_construccion_caja = $("<div>").addClass("centro_mando_cola_caja");
	this.edificios_construccion = new Array(this.datos.construccion.length);
	var temp = 0;
	for(var i = this.datos.construccion.length - 1; i >= 0; i--) {
		this.edificios_construccion[i] = {
			caja: $("<div>").addClass("cola_edificios_caja"),
			nombre: $("<p>").addClass("cola_edificios_nombre").text(traducciones_nombre_edificios[this.datos.construccion[i][0]]),
			tiempo: $("<p>").addClass("cola_edificios_tiempo").text(seg2str(this.datos.construccion[i][1] + temp)),
		}
		temp += this.datos.construccion[i][1];
		this.cola_construccion_caja.append(this.edificios_construccion[i].caja.append(this.edificios_construccion[i].nombre).append(this.edificios_construccion[i].tiempo));
	};
	//Creamos la cola de edificios en reparación
	this.cola_reparacion_texto = $("<p>").addClass("centro_mando_cola_texto").text(traducciones_centro_planeta[4]);
	this.cola_reparacion_caja = $("<div>").addClass("centro_mando_cola_caja");
	this.edificios_reparacion = new Array(this.datos.reparacion.length);
	var temp = 0;
	for(var i = this.datos.reparacion.length - 1; i >= 0; i--) {
		this.edificios_reparacion[i] = {
			caja: $("<div>").addClass("cola_edificios_caja"),
			nombre: $("<p>").addClass("cola_edificios_nombre").text(traducciones_nombre_edificios[this.datos.reparacion[i][0]]),
			tiempo: $("<p>").addClass("cola_edificios_tiempo").text(seg2str(this.datos.reparacion[i][1] + temp))
		}
		temp += this.datos.reparacion[i][1];
		this.cola_reparacion_caja.append(this.edificios_reparacion[i].caja.append(this.edificios_reparacion[i].nombre).append(this.edificios_reparacion[i].tiempo));
	};
	this.columna_d.append(this.cola_construccion_texto).append(this.cola_construccion_caja).append(this.cola_reparacion_texto).append(this.cola_reparacion_caja)
	//Es hora de ponerlo todo dentro del padre.
	this.contenedor.append(this.columna_i).append(this.columna_d);
	//Ahora faltan los eventos para hacer que haya una cuenta atras en las cosas de los edificios.
};
edificio_centro_mando.prototype.get_dom = function () {
	return this.contenedor;
};


var edificio_extractor = Function();

edificio_extractor.prototype.init = function () {
	var self = this;
	setTimeout(function () {
		self.datos = [
			[256, 95], //Datos del edificio este nivel (Producción de masa por hora, Consumo de energía)
			[365, 105], //Datos del edificio del proximo nivel (Producción de masa por hora, Consumo de energía)
			85 //Rendimiento del extractor dependiendo de la energia que le llega. (Energía que le llega)
		];
		self.poner_datos();
	}, 200);
	this.contenedor = $("<div>");
	this.lateral_izquierdo = $("<div>").addClass("cuadro_un_tercio_menu");
	this.lateral_derecho = $("<div>").addClass("cuadro_dos_tercio_menu_d");
	this.contenedor.append(this.lateral_izquierdo).append(this.lateral_derecho);
};
edificio_extractor.prototype.poner_datos = function () {
	//Sacamos los valores de producción real
	this.produccion = {};
	this.produccion.porcentaje_actual = this.datos[2] / this.datos[0][1];
	this.produccion.porcentaje_siguiente = this.datos[2] / this.datos[1][1];
	if(this.produccion.porcentaje_actual > 1) this.produccion.porcentaje_actual = 1;
	if(this.produccion.porcentaje_siguiente > 1) this.produccion.porcentaje_siguiente = 1;
	this.produccion.actual = this.produccion.porcentaje_actual * this.datos[0][0];
	this.produccion.siguiente = this.produccion.porcentaje_siguiente * this.datos[1][0];
	//poner la produccion de masa por hora
	this.produccion_masa_texto = $("<p>").addClass("texto_datos").text(this.produccion.actual.toFixed(2) + " " + traducciones_extractor[0]);
	this.produccion_masa_texto_presentacion = $("<p>").addClass("texto_presentancion").text(traducciones_extractor[1] + ": ");
	this.produccion_masa = $("<div>").addClass("produccion_masa_contenedor");
	this.produccion_masa.append(this.produccion_masa_texto_presentacion).append(this.produccion_masa_texto);
	//poner el rendimiento
	this.rendimiento_masa_texto = $("<p>").addClass("texto_datos").text((this.produccion.porcentaje_actual.toFixed(2) * 100) + "%");
	this.rendimiento_masa_texto_presentacion = $("<p>").addClass("texto_presentancion").text(traducciones_extractor[2] + ": ");
	this.rendimiento_masa = $("<div>").addClass("rendimiento_contenedor");
	this.produccion_masa.append(this.rendimiento_masa_texto_presentacion).append(this.rendimiento_masa_texto);
	//poner el consumo de energia
	this.consumo_energia_texto = $("<p>").addClass("texto_datos").text(this.datos[0][1] + " " + traducciones_extractor[3]);
	this.consumo_energia_texto_presentacion = $("<p>").addClass("texto_presentancion").text(traducciones_extractor[4] + ": ");
	this.consumo_energia = $("<div>").addClass("consumo_energia_contenedor");
	this.produccion_masa.append(this.consumo_energia_texto_presentacion).append(this.consumo_energia_texto);
	//FALTA LO DEL SIGUIENTE NIVEL
	this.lateral_izquierdo.append(this.produccion_masa).append(this.rendimiento_masa).append(this.consumo_energia);
	//Ponemos la barrita que indica la cantidad de energía que recibe
	this.barrita_energia_titulo = $("<p>").addClass("barrita_energia_titulo").text(traducciones_extractor[5]);
	this.barrita = new slide_numerico();
	this.barrita.init({
		max: 100
	});
	this.lateral_derecho.append(this.barrita_energia_titulo).append(this.barrita.get_dom());
};
edificio_extractor.prototype.get_dom = function () {
	return this.contenedor;
};


var edificio_electrica = Function();

edificio_electrica.prototype.init = function () {
	var self = this;
	setTimeout(function () {
		self.datos = [
			[100, 100, 50, 0, 0], //La energía que va a cada edificio
			250, //Producción energía este nivel
			550, //Producción energía siguiente nivel
			[250, 350, 50, 75, 125], //Lo que pide cada edificio de energía
			[1, 2, 3, 4, 5] //La id de cada edificio
		];
		self.poner_datos();
	}, 0);
	this.contenedor = $("<div>");
	this.lateral_izquierdo = $("<div>").addClass("cuadro_un_tercio_menu");
	this.lateral_derecho = $("<div>").addClass("cuadro_dos_tercio_menu_d");
	this.contenedor.append(this.lateral_izquierdo).append(this.lateral_derecho);
};
edificio_electrica.prototype.poner_datos = function () {
	var self = this;
	this.menus_electrica = new Array(this.datos[4].length);
	for(var i = this.datos[4].length - 1; i >= 0; i--) {
		this.menus_electrica[i] = {
			contenedor: $("<div>"),
			foto: $("<img>").addClass("imagen_edificio_electrica").attr("src", "contenido/imagenes_edificios_vista_interna_" + this.datos[4][i] + ".jpg"),
			titulo: $("<p>").addClass("titulo_edificio_electrica").text(traducciones_nombre_edificios[i]),
			slide: new slide_numerico(),
			info_energia: $("<p>").text(traducciones_electrica[0] + ": " + this.datos[3][i] + " - " + traducciones_electrica[1] + ": "),
			info_ener_spam: $("<span>").text(this.datos[0][i]),
			info_ener_spam_porcent: $("<span>").text(" (" + this.datos[0][i] + "%)")
		};
		this.menus_electrica[i].info_energia.append(this.menus_electrica[i].info_ener_spam).append(this.menus_electrica[i].info_ener_spam_porcent);
		this.menus_electrica[i].slide.init({
			max: 100,
			clase: "slide_edificio_electrica",
			ini: this.datos[0][i],
			step: this.mov_slide,
			param_step: {
				slide: i
			},
			padre_step: this
		});
		this.menus_electrica[i].contenedor.append(this.menus_electrica[i].foto).append(this.menus_electrica[i].titulo).append(this.menus_electrica[i].slide.get_dom()).append(this.menus_electrica[i].info_energia).append('<div class="clear"></div>');
		this.lateral_derecho.append(this.menus_electrica[i].contenedor).append('<div class="clear"></div>');
		setTimeout((function (i) { //Esto se hace porque la barra no se puede poner en la posición que le toca del slide sin antes saber como de ancha será. Dado que lo pone el objeto padre, se retrasa su calculo. //Es una chapuza creo... molaría eventos o algo... Igual se pude hacer algo. Pero entonces los slides tendrían que escuchar algún tipo de evento especial... Puede que en body esté la clave... 
			return function () {
				self.menus_electrica[i].slide.recalc();
				self.mov_slide();
			}
		})(i), 250);
	};
	this.energia_consumida_total = {
		contenedor: $("<div>"),
		energia_gen: $("<p>"),
		energia_ped: $("<p>"),
	};
	this.lateral_izquierdo.append(this.energia_consumida_total.contenedor.append(this.energia_consumida_total.energia_ped).append(" / ").append(this.energia_consumida_total.energia_gen).append(" " + traducciones_electrica[3]));
	this.energia_total_pedida = 0;
	for(var i = this.datos[3].length - 1; i >= 0; i--) {
		this.energia_total_pedida += this.datos[3][i];
	};
};
edificio_electrica.prototype.mov_slide = function (data) {
	var temp;
	//Aquí supongo que habría que calcular la suma de todas las energías de todos los edificios y una vez sumadas sacar si se cumple los requisitos o no. 
	this.piden_tota_edificios = 0;
	for(var i = this.datos[0].length - 1; i >= 0; i--) {
		this.piden_tota_edificios += this.datos[3][i];
	};
	//Si no se cumplen sacar el % que es la energia entrante con respecto a la necesitada y entonces poner todos los edificios a ese porcentaje (teniendo en cuenta el valor de los slides).
	this.piden_tota_edificios_slide = 0;
	for(var i = this.datos[0].length - 1; i >= 0; i--) {
		this.piden_tota_edificios_slide += this.datos[3][i] * this.menus_electrica[i].slide.get_val();
	};
	this.porcentaje_energia_todos_edificios = this.piden_tota_edificios_slide / this.piden_tota_edificios;
	var energia_generada = this.datos[1]; //Guardamos la cantidad de energía que generamos en una variable human friendly
	var energia_pedida = 0;
	var energia_pedida_este = 0;
	var energia_sobrante = energia_generada;
	//Ahora tenemos que saber si sobra o no energía. 
	for(var i = this.menus_electrica.length - 1; i >= 0; i--) {
		energia_pedida += this.datos[3][i] * (this.menus_electrica[i].slide.get_val() / 100);
		energia_sobrante -= this.datos[3][i] * (this.menus_electrica[i].slide.get_val() / 100);
	};
	//Si sobra entonces todos los edificios que esten al 100% bien y si hay uno por debajo bajamos su rendimiento en consonancia a ese %
	//Si falta energía hay que ver cuanta falta y entonces distribuir esa falta entre todos los edificios.
	if(energia_sobrante < 0) { //Falta energía //Hay que hacer que la energía se reparte proporcionalmente en base a lo que pida. No que vaya a cada edificio de forma equitatia. Para eso mejor sacar un % de lo que es cada edificio.
		energia_sobrante = Math.abs(energia_sobrante);
		for(var i = this.menus_electrica.length - 1; i >= 0; i--) {
			//Tengo que sacar la energía total que me piden y sacar el % que representa cada uno respecto a eso.
			energia_pedida_este = (this.datos[3][i] * (this.menus_electrica[i].slide.get_val() / 100)) / energia_pedida; //Con este % se cuanta energia le quitaré a cada uno respecto lo que pide.
			//La energia final es lo que pide menos lo que falta / el numero de edificios que piden * el % que representa cada uno de lo pedido total.
			temp = energia_generada * energia_pedida_este;
			//temp = ((this.datos[3][i] * (this.menus_electrica[i].slide.get_val()/100)) / this.energia_total_pedida) * this.datos[3][i]; //Es el % que representa ese edificio respecto al total pedido.
			this.menus_electrica[i].info_ener_spam.text((temp).toFixed(1));
			this.menus_electrica[i].info_ener_spam_porcent.text(" (" + ((temp) / this.datos[3][i] * 100).toFixed(1) + "%)");
		};
	} else { //Sobra energía
		for(var i = this.menus_electrica.length - 1; i >= 0; i--) {
			temp = (this.datos[3][i] * (this.menus_electrica[i].slide.get_val() / 100)).toFixed(1);
			this.menus_electrica[i].info_ener_spam.text((this.datos[3][i] * (this.menus_electrica[i].slide.get_val() / 100)).toFixed(1));
			this.menus_electrica[i].info_ener_spam_porcent.text(" (" + (temp / this.datos[3][i] * 100).toFixed(1) + "%)");
		};
	}
	this.energia_consumida_total.energia_gen.text(energia_generada.toFixed(1) + " " + traducciones_electrica[2]);
	if(energia_pedida > energia_generada) energia_pedida = energia_generada;
	this.energia_consumida_total.energia_ped.text(energia_pedida.toFixed(1) + " " + traducciones_electrica[2]);
};
edificio_electrica.prototype.get_dom = function () {
	return this.contenedor;
};


var edificio_espionaje = Function();

edificio_espionaje.prototype.init = function () {
	var self = this;
	setTimeout(function () {
		self.datos = [23, //Sondas en mi priopio planeta 0
			45, //Sondas en total, sumando todas las sondas. 1
			[ //Los planetas que tiene sondas tuyas en el. 2
				{
					nombre: "Planeta 1",
					cantidad: 2,
					id_planeta: 32436253,
					jugador: "Jugador 1"
				}, {
					nombre: "Planeta 2",
					cantidad: 1,
					id_planeta: 32935235,
					jugador: "Jugador 1"
				}, {
					nombre: "Planeta 3",
					cantidad: 5,
					id_planeta: 32935235,
					jugador: "Jugador 1"
				}
			],
			[ //Sondas de camino a un planeta 3
				{
					nombre: "Planeta 1",
					cantidad: 2,
					id_planeta: 32436253,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}, {
					nombre: "Planeta 2",
					cantidad: 1,
					id_planeta: 32935235,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}, {
					nombre: "Planeta 3",
					cantidad: 5,
					id_planeta: 32935235,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}
			],
			[ //Sondas de camino a casa 4
				{
					nombre: "Planeta 1",
					cantidad: 2,
					id_planeta: 32436253,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}, {
					nombre: "Planeta 2",
					cantidad: 1,
					id_planeta: 32935235,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}, {
					nombre: "Planeta 3",
					cantidad: 5,
					id_planeta: 32935235,
					tiempo_llegada: 325923548,
					jugador: "Jugador 1",
				}
			]
		];
		self.poner_datos();
	}, 1000);
	this.contenedor = $("<div>");
	this.col_izquie = $("<div>").addClass("cuadro_mitad_menu");
	this.col_derech = $("<div>").addClass("cuadro_mitad_menu");
	this.crear_sondas = $("<div>").addClass("espionaje_crear_sondas").addClass("cuadro_completo_menu");
	this.crear_sondas_casa = $("<div>").addClass("columna_50_i");
	this.crear_sondas_crea = $("<div>").addClass("columna_50_d");
	this.crear_sondas.append(this.crear_sondas_casa).append(this.crear_sondas_crea);
	this.contenedor.append(this.crear_sondas).append(this.col_izquie).append(this.col_derech);
};
edificio_espionaje.prototype.poner_datos = function () {
	//Primero el resumen de las sondas en casa
	this.sondas_en_casa = {
		p_patru: $("<p>").addClass("edificio_espionaje_sondas_casa").text(traducciones_espionaje[0] + ": " + this.datos[0] + " / " + this.datos[1]),
		p_fuera: $("<p>").addClass("edificio_espionaje_sondas_fuera").text(traducciones_espionaje[1] + ": " + (this.datos[1] - this.datos[0]) + " / " + this.datos[1])
	};
	var temp = 0;
	for(var i = this.datos[3].length - 1; i >= 0; i--) {
		temp += this.datos[3][i].cantidad;
	};
	for(var i = this.datos[4].length - 1; i >= 0; i--) {
		temp += this.datos[4][i].cantidad;
	};
	this.crear_sondas.append(this.sondas_en_casa.p_fuera).append(this.sondas_en_casa.p_patru);
	//Y ahora las sondas en camino.
	this.sondas_camino = {
		titulo: $("<p>").addClass("edificio_espionaje_sondas_camino_titulo").text(traducciones_espionaje[2] + ": " + temp + " / " + this.datos[1]),
		contenedor: $("<div>").addClass("edificio_espionaje_sondas_camino_contenedor"),
		datos_casa: new Array(),
		datos_fuera: new Array()
	};
	var cantidad, tiempo, jugador, planeta, contenedor, ida_vuelta;
	for(var i = this.datos[3].length - 1; i >= 0; i--) {
		planeta = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_planeta").text(this.datos[3][i].nombre);
		jugador = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_jugador").text(this.datos[3][i].jugador);
		tiempo = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_tiempo").text(seg2str(this.datos[3][i].tiempo_llegada)); //Hay que hacer que la cuenta atras se haga. Hay que hacer un objeto contador que lleve las correcciones de tiempo.
		cantidad = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_cantidad").text(this.datos[3][i].cantidad);
		ida_vuelta = $("<div>").addClass("edificio_espionaje_sondas_camino_sonda_ida");
		contenedor = $("<div>").addClass("edificio_espionaje_sondas_camino_sonda");
		contenedor.append(planeta.append("(").append(jugador).append(")")).append(tiempo).append(cantidad).append(ida_vuelta);
		this.sondas_camino.datos_fuera.push({
			contenedor: contenedor,
			planeta: planeta,
			jugador: jugador,
			tiempo: tiempo,
			cantidad: cantidad,
			ida_vuelta: ida_vuelta
		});
		this.sondas_camino.contenedor.append(contenedor);
	};
	for(var i = this.datos[4].length - 1; i >= 0; i--) {
		planeta = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_planeta").text(this.datos[4][i].nombre);
		jugador = $("<span>").addClass("edificio_espionaje_sondas_camino_sonda_jugador").text(this.datos[4][i].jugador);
		tiempo = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_tiempo").text(seg2str(this.datos[4][i].tiempo_llegada)); //Hay que hacer que la cuenta atras se haga. Hay que hacer un objeto contador que lleve las correcciones de tiempo.
		cantidad = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_cantidad").text(this.datos[4][i].cantidad);
		ida_vuelta = $("<div>").addClass("edificio_espionaje_sondas_camino_sonda_vuelta");
		contenedor = $("<div>").addClass("edificio_espionaje_sondas_camino_sonda");
		contenedor.append(planeta.append("(").append(jugador).append(")")).append(tiempo).append(cantidad).append(ida_vuelta);
		this.sondas_camino.datos_casa.push({
			contenedor: contenedor,
			planeta: planeta,
			jugador: jugador,
			tiempo: tiempo,
			cantidad: cantidad,
			ida_vuelta: ida_vuelta
		});
		this.sondas_camino.contenedor.append(contenedor);
	};
	this.col_izquie.append(this.sondas_camino.titulo).append(this.sondas_camino.contenedor);
	//Sondas en planetas ajenos
	this.sondas_mision = {
		titulo: $("<p>").addClass("edificio_espionaje_sondas_camino_titulo").text(traducciones_espionaje[3] + ": " + temp + " / " + this.datos[1]),
		contenedor: $("<div>").addClass("edificio_espionaje_sondas_camino_contenedor"),
		datos_casa: new Array(),
		datos_fuera: new Array()
	};
	for(var i = this.datos[2].length - 1; i >= 0; i--) {
		planeta = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_planeta").text(this.datos[2][i].nombre);
		jugador = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_jugador").text(this.datos[2][i].jugador);
		cantidad = $("<p>").addClass("edificio_espionaje_sondas_camino_sonda_cantidad").text(this.datos[2][i].cantidad);
		contenedor = $("<div>").addClass("edificio_espionaje_sondas_camino_sonda");
		contenedor.append(planeta.append("(").append(jugador).append(")")).append(cantidad);
		this.sondas_mision.datos_fuera.push({
			contenedor: contenedor,
			planeta: planeta,
			jugador: jugador,
			cantidad: cantidad
		});
		this.sondas_mision.contenedor.append(contenedor);
	};
	this.col_derech.append(this.sondas_mision.titulo).append(this.sondas_mision.contenedor);
};
edificio_espionaje.prototype.get_dom = function () {
	return this.contenedor;
};


var edificio_puerto = Function();

edificio_puerto.prototype.init = function (data) {
	var self = this;
	this.posXY = data.posXY;
	this.datos_base = data;
	setTimeout(function () { //Poner datos de compras
		self.datos_compra = [ //Objetos que la gente quiere comprar
			[2, 45000, 23, 45, 56, 3], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 46000, 23, 45, 56, 4], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 47000, 35, 45, 45, 5], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 48000, 23, 45, 56, 6], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 49000, 23, 45, 12, 2], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 40000, 22, 45, 56, 13], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
		];
		self.poner_datos_compra();
	}, 1000);
	setTimeout(function () { //Poner datos de compras
		self.datos_compra = [ //Objetos que la gente quiere vender
			[2, 45000, 23, 45, 56, 3], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 46000, 23, 45, 56, 4], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 47000, 35, 45, 45, 5], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 48000, 23, 45, 56, 6], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 49000, 23, 45, 12, 2], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
			[2, 40000, 22, 45, 56, 13], //Tipo material, cantidad, precio unidad, coordenada X, coordenada Y, metros cubicos
		];
		self.poner_datos_venta();
	}, 1000);
	setTimeout(function () { //Poner datos para obejtos a ofrecer
		self.datos_ofrecer = {
			objVenta: [{
					nombre: "objeto tipo 1",
					id: 234,
					cantidad: 54,
					precio: 234,
					volumen: 234
				}, //Objetos a la venta
				{
					nombre: "objeto tipo 2",
					id: 234,
					cantidad: 54,
					precio: 234,
					volumen: 234
				}, //Objetos a la venta
				{
					nombre: "objeto tipo 4",
					id: 234,
					cantidad: 234,
					precio: 4678,
					volumen: 234
				}, //Objetos a la venta
				{
					nombre: "objeto tipo 5",
					id: 234,
					cantidad: 12,
					precio: 234,
					volumen: 234
				}, //Objetos a la venta
			],
			maxDistancia: 12512
		}
		self.poner_datos_ofrecer();
	}, 1000);
	this.tabla_compra = $('<table>');
	this.tabla_venta = $('<table>');
	this.contenedor = $("<div>");
	this.compra = $("<div>").addClass("cuadro_completo_menu").append(this.tabla_compra);
	this.venta = $("<div>").addClass("cuadro_completo_menu").append(this.tabla_venta);
	//Creamos la parte de poner una oferta nueva
	this.select_objeto = $("<select>").addClass("edificio_puerto_input_objeto");
	this.input_cantidad = $("<input>").addClass("edificio_puerto_input_cantidad");
	this.input_precio = $("<input>").addClass("edificio_puerto_input_precio");
	this.input_distancia = $("<select>").addClass("edificio_puerto_input_distancia");
	this.input_distancia = $("<p>").addClass("edificio_puerto_input_maximo");
	this.ofrece = $("<div>").addClass("cuadro_completo_menu").append(this.select_objeto).append(this.input_cantidad).append(this.input_precio).append(this.input_distancia);
	this.contenedor.append(this.ofrece).append(this.compra).append(this.venta);
};
edificio_puerto.prototype.poner_datos_ofrecer = function (first_argument) {
	this.select_objeto_option = new Array(this.datos_ofrecer.objVenta.length);
	this.select_objeto.append($("<option>").attr("value", -1).text(traducciones_puerto[0]));
	for(var i = this.datos_ofrecer.objVenta.length - 1; i >= 0; i--) {
		this.select_objeto_option[i] = $("<option>").attr("value", i).text(this.datos_ofrecer.objVenta[i].nombre); /*Aquí (en attr) se pone i para saber donde acceder cuando queramos su id*/
		this.select_objeto.append(this.select_objeto_option[i]);
	};
	this.select_objeto.change(function () {
		var index = parseInt($(this).val());
		//una vez sabido el id del objeto. Tenemos que sacar el valor medio por unidad del objeto y su volumen.
		var volumen = this.datos_ofrecer.objVenta[index].volumen;
		var precio = this.datos_ofrecer.objVenta[index].precio;
		//Ahora ponemos la distancia al la que puedes vender cosas. Asumimos que va de incrementos de 10000
		var max_distancia = this.datos_ofrecer.maxDistancia; //FALTA POR HACER//No se muy bien como hacer esto. Así que lo dejo a falta de definir como el servidor hará los calculos para ver que ofertas ver y mostrar
	});
};
edificio_puerto.prototype.poner_datos_compra = function (first_argument) {
	this.tabla_compra.dataTable({
		"aaData": this.datos_compra,
		"aoColumns": [{
				"sTitle": "Objeto / Material"
			}, {
				"sTitle": "Cantidad"
			}, {
				"sTitle": "Precio unidad"
			}, {
				"sTitle": "Distancia X"
			}, {
				"sTitle": "Distancia Y"
			}, {
				"sTitle": "Metros cúbicos"
			},
		]
	});
};
edificio_puerto.prototype.poner_datos_venta = function (first_argument) {
	this.tabla_venta.dataTable({
		"aaData": this.datos_compra,
		"aoColumns": [{
				"sTitle": "Objeto / Material"
			}, {
				"sTitle": "Cantidad"
			}, {
				"sTitle": "Precio unidad"
			}, {
				"sTitle": "Distancia X"
			}, {
				"sTitle": "Distancia Y"
			}, {
				"sTitle": "Metros cúbicos"
			},
		]
	});
};
edificio_puerto.prototype.get_dom = function (first_argument) {
	return this.contenedor;
};


var edificio_astillero = Function();

edificio_astillero.prototype.init = function () {
	var self = this;
	setTimeout(function () { //Poner datos de compras
		self.datos = [ //Objetos que la gente quiere comprar
			[ //Las naves y lo que cuestan (según tecnoligías).
				[5, 235, 6547, 85, 6547, 654], //Recursos... en el orden que sean. Aún por definir. Puede que al final sea un objeto y pongamos nombres.
				[5, 235, 6547, 85, 6547, 654],
				[5, 235, 6547, 85, 6547, 654],
				[5, 235, 6547, 85, 6547, 654],
				[5, 235, 6547, 85, 6547, 654],
				[5, 235, 6547, 85, 6547, 654],
				[5, 235, 6547, 85, 6547, 654],
			],
			[1, 3, 4, 5, 6], //Las id de las naves que se pueden construir ordenadas. 
			[ //Colas, las colas de construcción y el tiempo que tardarán.
				[3, 56, 435] //id del tipo de nave, cantidad, tiempo que tardará
				[4, 56, 435] //id del tipo de nave, cantidad, tiempo que tardará
			]
		];
		self.poner_datos();
	}, 1000);
	this.contenedor = $("<div>");
	this.contruir_naves = $("<div>").addClass("cuadro_completo_menu")
};
edificio_astillero.prototype.poner_datos = function () {
	this.naves_construccion = new Array(this.datos[1].length);
	for(var i = this.datos[1].length - 1; i >= 0; i--) {};
};
edificio_astillero.prototype.get_dom = function () {
	return contenedor;
};