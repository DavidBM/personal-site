"use strict";
function gestor_interfaz(){

	var self = this;
	var padre;
	var tam_x_padre;
	var tam_y_padre;
	this.galaxia = {};
	var interfaz_peque = 0;
	var planeta, informacion, botones, vector_botones, informacion_datos;
	this.zoom = [77,63]; //Aquí iran los datos de donde hacer zoom cuando le demos al boton.
	this.seleccionado = "";
	this._datos_seleccionado;
	this.altura_de_mas = 106;

	$(document).is_unselect_allowed = true;

	//Iniciamos los datos necesarios para el gestor de interfaz, creamos los contadores de recursos y otras cosas que no son html.
	padre = $("body");
	tam_x_padre = padre.width();
	tam_y_padre = padre.height();

	//INICIAMOS LOS RECURSOS
	this.recursos = new recursos(padre);	

	//INICIAMOS LA GALAXIA
	this.galaxia = new univers({id: "galaxia", margen_inf: 65, margen_sup: 125, margen_der: 15, margen_izq: 245, interfaz: self});
	this.galaxia.show_univers();
	this.galaxia.init_drag();

	//INICIAMOS LA VENTANA
	this.ventana = new Ventana();
	this.ventana.iniciar({universo: this.galaxia.datos.JqueryDOMobject});


	this.crear_interfaz = function (datos) { //Mostramos la interfaz y los contadores de recursos y otras cosas con html.
		
		planeta = $('<div id="interfaz_imagen_planeta"></div>');
		informacion = $('<div id="interfaz_datos_planeta"></div>');
		botones = $('<div id="interfaz_datos_botones"></div>');

		informacion_datos = new Array(4);
		informacion_datos[0] = $('<p class="interfaz_informacion_planeta">'+traducciones_interfaz_generica[4]+'</p>');
		informacion_datos[1] = $('<p class="interfaz_informacion_planeta">'+traducciones_interfaz_generica[5]+'</p>');
		informacion_datos[2] = $('<p class="interfaz_informacion_planeta">'+traducciones_interfaz_generica[6]+'</p>');
		informacion_datos[3] = $('<p class="interfaz_informacion_planeta">'+traducciones_interfaz_generica[7]+'</p>');

		informacion.append(informacion_datos[0], informacion_datos[1], informacion_datos[2], informacion_datos[3]);

		if(padre.height() < 800){
			//Poner la version para motitores pequeños
			planeta.css({background: 'url("contenido/info_planeta_fondo_peque.png") 0 -80px', width: 155, height: 165});
			informacion.css({background: 'url("contenido/info_planeta_fondo_peque.png") -155px -190px', left: 155, height: 55});
			botones.css({height: 112, bottom: 73});
			interfaz_peque = 1;
		}

		var class_botones = [
		"boton_interfaz_colonizar",
		"boton_interfaz_mensaje",
		"boton_interfaz_zoom",
		"boton_interfaz_poner_marcador",
		"boton_interfaz_borrar_marcador",
		"boton_interfaz_desplegar",
		"boton_interfaz_enviar_recursos",
		"boton_interfaz_atacar",
		"boton_interfaz_bloquear",
		"boton_interfaz_ocupar",
		"boton_interfaz_espiar",
		"boton_entrar_planeta",
		];


		var divtemp = $('<div class="boton_interfaz1"></div>');
		vector_botones = new Array(9);
		for (var i = 0; i < 12; i++) {
			vector_botones[i] = divtemp.clone().addClass(class_botones[i]).html('<p class="descripcion_boton_interfaz">'+traducciones_descripciones_botones[i]+'</p>');
			vector_botones[i].css({display: "none"});
			botones.append(vector_botones[i]);
		};

		padre.append(informacion, botones, planeta);

		this.botones_jquery 				= $(".boton_interfaz_colonizar, .boton_interfaz_mensaje, .boton_interfaz_zoom, .boton_interfaz_poner_marcador, .boton_interfaz_borrar_marcador, .boton_interfaz_desplegar, .boton_interfaz_enviar_recursos, .boton_interfaz_atacar, .boton_interfaz_bloquear, .boton_interfaz_ocupar, .boton_interfaz_espiar");
		this.botones_jquery_sol 			= $(".boton_interfaz_zoom, .boton_interfaz_espiar");
		this.botones_jquery_planeta_vacio 	= $(".boton_interfaz_colonizar, .boton_interfaz_zoom");
		this.botones_jquery_planeta_propio 	= $(".boton_interfaz_zoom, .boton_entrar_planeta");
		this.botones_jquery_planeta_neutral = $(".boton_interfaz_mensaje, .boton_interfaz_zoom, .boton_interfaz_enviar_recursos, .boton_interfaz_atacar, .boton_interfaz_bloquear, .boton_interfaz_ocupar, .boton_interfaz_espiar");
		this.botones_jquery_planeta_aliado 	= $(".boton_interfaz_mensaje, .boton_interfaz_zoom, .boton_interfaz_desplegar, .boton_interfaz_enviar_recursos");
		this.botones_jquery_planeta_enemigo = $(".boton_interfaz_mensaje, .boton_interfaz_zoom, .boton_interfaz_atacar, .boton_interfaz_bloquear, .boton_interfaz_ocupar, .boton_interfaz_espiar");
		this.botones_jquery_multi_marcador 	= $(".boton_interfaz_zoom");
		this.botones_jquery_poner_marcador 	= $(".boton_interfaz_poner_marcador");
		this.botones_jquery_quitar_marcador = $(".boton_interfaz_borrar_marcador");



		vector_botones[1].bind("click touchend",function () { //Mensaje
			var menu_html = new enviar_mensaje();
			self.ventana.borrar_inner();
			self.ventana.prepend(menu_html.get_dom());
			self.ventana.mostrar();
		});
		vector_botones[2].bind("click touchend",function () { //Zoom
			self.galaxia.zoom_sol_pos(self.zoom[0], self.zoom[1]);
		});
		vector_botones[3].bind("click touchend",function () { //Poner marcador
			var x_sec = parseInt(self.zoom[0] / self.galaxia.NUM_SOLES_EJE);
			var y_sec = parseInt(self.zoom[1] / self.galaxia.NUM_SOLES_EJE);
			var x_sol = self.zoom[0] - x_sec * self.galaxia.NUM_SOLES_EJE;
			var y_sol = self.zoom[1] - y_sec * self.galaxia.NUM_SOLES_EJE;
			if(typeof(self._datos_seleccionado.orbita) != "undefined") 
				 	self.galaxia.datos.sectores[x_sec][y_sec].poner_marcador({id: "nuesvo_"+parseInt(Math.random()*100000000), x: self.zoom[0],y: self.zoom[1], tipo: "planeta", nombre: "Marcador", color: "celeste", orbita: self._datos_seleccionado.orbita, datos_extra: self.galaxia.datos.sectores[x_sec][y_sec].planetas_json[x_sol][y_sol]}); //Hay que poner si es un planeta o un sol.
			else	self.galaxia.datos.sectores[x_sec][y_sec].poner_marcador({id: 24, x: self.zoom[0], y: self.zoom[1], tipo: "sol", nombre: "Bla bla bla", color: "rojo"}); //Hay que poner si es un planeta o un sol.
			
			if(self._tipo_datos_seleccionado == "planeta"){
				self.botones_jquery_poner_marcador.css({display: "none"});
				self.botones_jquery_quitar_marcador.css({display: "block"});
			}
			//self.galaxia.datos.sectores[x_sec][y_sec].ajustar_marcador_sol_nuevo(x_sol, y_sol); //Hay que poner si es un planeta o un sol.
			//self.galaxia.datos.sectores[x_sec][y_sec].ajustar_marcador_planeta(x_sol, y_sol); //Hay que poner si es un planeta o un sol.
		});
		vector_botones[4].bind("click touchend",function () { //Borrar marcador
			var x_sec = parseInt(self.zoom[0] / self.galaxia.NUM_SOLES_EJE);
			var y_sec = parseInt(self.zoom[1] / self.galaxia.NUM_SOLES_EJE);
			var x_sol = self.zoom[0] - x_sec * self.galaxia.NUM_SOLES_EJE;
			var y_sol = self.zoom[1] - y_sec * self.galaxia.NUM_SOLES_EJE;
			self.galaxia.datos.sectores[x_sec][y_sec].quitar_marcador(x_sol, y_sol, self._datos_seleccionado.orbita); //Hay que poner si es un planeta o un sol.
			if(self._tipo_datos_seleccionado == "planeta"){
				self.botones_jquery_poner_marcador.css({display: "block"});
				self.botones_jquery_quitar_marcador.css({display: "none"});
			}else if(self._tipo_datos_seleccionado == "marcador"){
				self.botones_jquery.css({display:"none"});
				botones.animate({height: 113},{duration: 200, queue: false});
			}
		});
		vector_botones[7].bind("click touchend",function () { //Atacar
			var menu_html = new enviar_tropas(self._datos_seleccionado);
			menu_html.init();			
			self.ventana.borrar_inner();
			self.ventana.prepend(menu_html.get_dom());
			self.ventana.mostrar();
		});
		vector_botones[11].bind("click touchend",function () { //Entrar a planeta
			var menu_html = new abrir_planeta();
			menu_html.init(self._datos_seleccionado, self.recursos);
			self.ventana.borrar_inner();
			self.ventana.prepend(menu_html.get_dom());
			self.ventana.mostrar();
		});

	}

	this.planeta_seleccionado = function (datos) {
		//console.log(datos);
		this.deselecciones();
		var left = parseInt(datos.orbita / 5) + 1;
		var top = -datos.orbita % 5 * 245;
		var foto = $('<div class="info_planeta_planeta"></div>').css({background:'url("contenido/info_planetas_planeta_0'+left+'.png") 0 '+top+"px"});
		if(interfaz_peque == 1){
			foto.css({background:'url("contenido/info_planetas_planeta_peque_0'+left+'.png") 0 '+(top - 80)+"px", width: 155});
		}
		this.zoom = [datos.x, datos.y];

		var x_sec = parseInt(self.zoom[0] / self.galaxia.NUM_SOLES_EJE);
		var y_sec = parseInt(self.zoom[1] / self.galaxia.NUM_SOLES_EJE);
		var x_sol = self.zoom[0] - x_sec * self.galaxia.NUM_SOLES_EJE;
		var y_sol = self.zoom[1] - y_sec * self.galaxia.NUM_SOLES_EJE;

		var marcador = self.galaxia.datos.sectores[x_sec][y_sec].get_marcador_orbita(x_sol, y_sol, datos.orbita);
		if(marcador >= 0) marcador = 1;
		else marcador = 0;
		this.poner_botones("planeta", datos, marcador);
		this._datos_seleccionado = datos;
		this._tipo_datos_seleccionado = "planeta";
		planeta.html(foto);
	}


	this.marcador_seleccionado = function (datos) {
		//console.log(datos);
		//Ahora hay que mostrar las opciones dependiendo de como sea el marcador.
		//console.log(datos);
		this.deselecciones();
		if(datos.tipo == "multi"){ //Hay que mostrar solo el boton de zoom para ver el sistema
			//Mostramos el sol en el cuadro de previsualización
			//Mostramos info relativa al sistema
			//Ponemos el boton de zoom al sistema.
			var foto = $('<div class="info_planeta_sol"></div>');
			if(interfaz_peque == 1){
				foto.css({background: 'url("contenido/info_planetas_soles.png") 0 -325px', height: 165, width: 155});
			}
			this.seleccionado = "multi";
			this.poner_botones("multi", datos, 1);
			planeta.html(foto);
		}else if(datos.tipo == "sol"){  //Hay que mostrar solo el boton de zoom para ver el sistema
			var foto = $('<div class="info_planeta_sol"></div>');
			if(interfaz_peque == 1){
				foto.css({background: 'url("contenido/info_planetas_soles.png") 0 -325px', height: 165, width: 155});
			}
			this.poner_botones("sol", datos, 1);
			this.seleccionado = "marcador sol";
			planeta.html(foto);
		}else if(datos.tipo == "planeta"){ //Hay que mostras las acciones posibles y además el boton de zoom.
			//console.log(datos);
			var left = parseInt(datos.orbita / 5) + 1;
			var top = -datos.orbita % 5 * 245;
			var foto = $('<div class="info_planeta_planeta"></div>').css({background:'url("contenido/info_planetas_planeta_0'+left+'.png") 0 '+top+"px"});
			if(interfaz_peque == 1){
				foto.css({background:'url("contenido/info_planetas_planeta_peque_0'+left+'.png") 0 '+(top - 80)+"px", width: 155});
			}
			this.seleccionado = "marcador planeta";
			this.poner_botones("planeta", datos, 1);
			planeta.html(foto);
		}
		this._datos_seleccionado = datos;
		this._tipo_datos_seleccionado = "marcador";
		this.zoom = [datos.x,datos.y];
	}

	this.deselecciones = function () {
		var x, y, Gx, Gy;
		if(self.galaxia.sol_remarcado_activo[0] == 1)
		self.galaxia.datos.sectores[self.galaxia.sol_remarcado_activo[3]][self.galaxia.sol_remarcado_activo[4]].desmarcar_sol(self.galaxia.sol_remarcado_activo[1], self.galaxia.sol_remarcado_activo[2])
	}

	this.poner_botones = function (obejtivo, datos, marcador) {
		if(obejtivo == "sol"){ //Solo el boton de hacer zoom
			var altura = 42*3 + self.altura_de_mas;
			this.botones_jquery.css({display: "none"});
			botones.animate({height: altura},{duration: 200, queue: false});

			this.botones_jquery_sol.css({display: "block"});

			if(marcador == 1){
				this.botones_jquery_poner_marcador.css({display: "none"});
				this.botones_jquery_quitar_marcador.css({display: "block"});
			}else{
				this.botones_jquery_poner_marcador.css({display: "block"});
				this.botones_jquery_quitar_marcador.css({display: "none"});
			}
			this.poner_datos_planeta_interfaz(1, datos);

		}else if(obejtivo == "multi"){ //Solo el boton de hacer zoom
			var altura = 42*1 + self.altura_de_mas;
			this.botones_jquery.css({display: "none"});
			botones.animate({height: altura},{duration: 200, queue: false});
			this.botones_jquery_multi_marcador.css({display: "block"});

		}else if(obejtivo == "planeta"){ //Solo el boton de hacer zoom
			if(datos.datos_extra[0] == 0){ //0 Vacio. 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
				var altura = 42*3 + self.altura_de_mas;

				this.botones_jquery.css({display: "none"});

				this.botones_jquery_planeta_vacio.css({display: "block"});	
				
				botones.animate({height: altura},{duration: 200, queue: false});

			}else if(datos.datos_extra[0] == 1){ //0 Vacio. 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
				var altura = 42*8 + self.altura_de_mas;
				this.botones_jquery.css({display: "none"});

				this.botones_jquery_planeta_neutral.css({display: "block"});	
				for (var i = 8; i >= 4; i--) vector_botones[i].css({display: "block"});	

				botones.animate({height: altura},{duration: 200, queue: false});

			}else if(datos.datos_extra[0] == 2){ //0 Vacio. 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
				var altura = 42*5 + self.altura_de_mas;
				this.botones_jquery.css({display: "none"});

				this.botones_jquery_planeta_aliado.css({display: "block"});	
				botones.animate({height: altura},{duration: 200, queue: false});

			}else if(datos.datos_extra[0] == 3){ //0 Vacio. 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
				var altura = 42*7 + self.altura_de_mas;
				this.botones_jquery.css({display: "none"});

				this.botones_jquery_planeta_enemigo.css({display: "block"});	
				botones.animate({height: altura},{duration: 200, queue: false});

			}else if(datos.datos_extra[0] == 4){ //0 Vacio. 1 Neutral, 2 Aliado, 3 Enemigo, 4 Propio
				var altura = 42*3 + self.altura_de_mas;
				this.botones_jquery.css({display: "none"});

				this.botones_jquery_planeta_propio.css({display: "block"});	
				botones.animate({height: altura},{duration: 200, queue: false});

			}
			this.poner_datos_planeta_interfaz(0, datos.datos_extra);
			if(marcador == 1){
				this.botones_jquery_poner_marcador.css({display: "none"});
				this.botones_jquery_quitar_marcador.css({display: "block"});
			}else{
				this.botones_jquery_poner_marcador.css({display: "block"});
				this.botones_jquery_quitar_marcador.css({display: "none"});
			}
		}
	}

	this.poner_datos_planeta_interfaz = function (sol, datos_extra) {
		if(sol == 1){
			//console.log(datos_extra);
			var x_sec = parseInt(datos_extra.x / this.galaxia.NUM_SOLES_EJE);
			var y_sec = parseInt(datos_extra.y / this.galaxia.NUM_SOLES_EJE);
			var x_sol = datos_extra.x - x_sec * this.galaxia.NUM_SOLES_EJE;
			var y_sol = datos_extra.y - y_sec * this.galaxia.NUM_SOLES_EJE;

			informacion_datos[0].html(traducciones_interfaz_generica[12]);
			informacion_datos[1].html(traducciones_interfaz_generica[13]+" X: "+datos_extra.x+" | Y: "+datos_extra.y);
			informacion_datos[2].html(traducciones_interfaz_generica[14]+": "+this.galaxia.datos.sectores[x_sec][y_sec].matriz_soles_cuadricula[x_sol][y_sol][4]);
			informacion_datos[3].html(traducciones_interfaz_generica[15]);
		}else if(datos_extra[0] == 0){ //Planeta vacio
			informacion_datos[0].html(traducciones_interfaz_generica[0]);
			informacion_datos[1].html(traducciones_interfaz_generica[1]);
			informacion_datos[2].html(traducciones_interfaz_generica[2]);
			informacion_datos[3].html(traducciones_interfaz_generica[3]);
		}else if(datos_extra[0] == 1){ //Jugador neutral
			var alianza;
			if(datos_extra[3] == 0) alianza = traducciones_interfaz_generica[2];
			else{ 
				alianza = datos_extra[4]
				if(datos_extra[4] == 1) alianza = '<span class="texto_verde">' + alianza + '</span>';
				else if(datos_extra[4] == 2) alianza = '<span class="texto_rojo">' + alianza + '</span>';
				alianza = traducciones_interfaz_generica[10]+': '+alianza;
			}
			informacion_datos[0].html(traducciones_interfaz_generica[8]+': '+datos_extra[7]);
			informacion_datos[1].html(traducciones_interfaz_generica[9]+': '+datos_extra[2]);
			informacion_datos[2].html(alianza);
			informacion_datos[3].html(traducciones_interfaz_generica[11]+': '+datos_extra[8]);
		}else if(datos_extra[0] == 2){ //Jugador Aliado
			if(datos_extra[3] == 0) alianza = traducciones_interfaz_generica[2];
			else{ 
				alianza = datos_extra[4]
				if(datos_extra[4] == 1) alianza = '<span class="texto_verde">' + alianza + '</span>';
				else if(datos_extra[4] == 2) alianza = '<span class="texto_rojo">' + alianza + '</span>';
				alianza = traducciones_interfaz_generica[10]+': '+alianza;
			}
			informacion_datos[0].html(traducciones_interfaz_generica[8]+': '+datos_extra[7]);
			informacion_datos[1].html(traducciones_interfaz_generica[9]+': <span class="texto_verde"> '+datos_extra[2]+'</span>');
			informacion_datos[2].html(alianza);
			informacion_datos[3].html(traducciones_interfaz_generica[11]+': '+datos_extra[8]);
		}else if(datos_extra[0] == 3){ //Jugador Aliado
			if(datos_extra[3] == 0) alianza = traducciones_interfaz_generica[2];
			else{ 
				alianza = datos_extra[4]
				if(datos_extra[4] == 1) alianza = '<span class="texto_verde">' + alianza + '</span>';
				else if(datos_extra[4] == 2) alianza = '<span class="texto_rojo">' + alianza + '</span>';
				alianza = traducciones_interfaz_generica[10]+': '+alianza;
			}
			informacion_datos[0].html(traducciones_interfaz_generica[8]+': '+datos_extra[7]);
			informacion_datos[1].html(traducciones_interfaz_generica[9]+': <span class="texto_rojo"> '+datos_extra[2]+'</span>');
			informacion_datos[2].html(alianza);
			informacion_datos[3].html(traducciones_interfaz_generica[11]+': '+datos_extra[8]);
		}else if(datos_extra[0] == 4){ //El propio Jugador
			if(datos_extra[3] == 0) alianza = traducciones_interfaz_generica[2];
			else{ 
				alianza = datos_extra[4]
				if(datos_extra[4] == 1) alianza = '<span class="texto_verde">' + alianza + '</span>';
				else if(datos_extra[4] == 2) alianza = '<span class="texto_rojo">' + alianza + '</span>';
				else if(datos_extra[4] == 3) alianza = '<span class="texto_azul">' + alianza + '</span>';
				alianza = traducciones_interfaz_generica[10]+': '+alianza;
			}
			informacion_datos[0].html(traducciones_interfaz_generica[8]+': <span class="texto_azul">'+datos_extra[7]+'</span>');
			informacion_datos[1].html(traducciones_interfaz_generica[9]+': <span class="texto_azul"> '+datos_extra[2]+'</span>');
			informacion_datos[2].html(alianza);
			informacion_datos[3].html(traducciones_interfaz_generica[11]+': '+datos_extra[8]);
		}
	}

	this.crear_interfaz();
}
