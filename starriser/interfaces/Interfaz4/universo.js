"use strict";
function univers(data){ //Objeto padre

	//Valores para 25*25 soles por sistema
	var MAX_ZOOM 		= 4096;
	var MIN_ZOOM 		= 1;
	var NUM_SOLES_EJE 	= 14;
	this.NUM_SOLES_EJE 	= NUM_SOLES_EJE;
	var NUM_SECTORES_X 	= 11;
	var NUM_SECTORES_Y 	= 9;


	var supreme_commander_zoom_mode = 1; //Esto hace que al alejar la vista, tome como referencia el centro de la pantalla y no donde está el raton. Viene bien para desplazarse usando el raton
	var zoom_rueda_acercar 		= 1.3;
	var zoom_rueda_alejar		= 0.7;
	var niveles_de_zoom			= [10,60];

	var es_IE 					= 0;
	var es_IE_tonto				= 0;
	var es_IE_ver				= 0;
	var univers_number 			= 0;
	var univers_sectores_select = "";
	var univers_marcadores_select = "";
	var univers_contenedor_todo = "";
	var univers_drag 			= "";
	var univers_image 			= {image: {}, opacity: 1};
	data.univers_sector_size 	= 0; //Tamaño de cada sección del mapa.
	data.univers_sector_size_original = 0;
	var zoom 					= 1;
	var mouse_down 				= 0;
	var resize_on 				= 0;
	var posicion_raton_X 		= 0;
	var posicion_raton_Y 		= 0;
	var posicion_raton_X_temp 	= 0;
	var posicion_raton_Y_temp 	= 0;
	var en_zoom 				= 0;
	var zoom_anterior			= 0;
	var arrastrar_iniciado		= false;
	var self 					= this;
	self.interval_movimiento	= 0;
	self.soles_mostrados 		= [[], 0];
	//self.marcadores_mostrados 	= [[], 0];
	self.vector_marcadores_superpuestos = [[], 0];
	var pos_X_ini_s				= 0;
	var pos_X_fin_s				= 0;
	var pos_Y_ini_s				= 0;
	var pos_Y_fin_s				= 0;
	self.movimiento_ejecucion 	= 0;
	var interfaz 				= data.interfaz;
	this.sol_remarcado_activo	= [0,0,0,0,0];
	this.datos 					= data;
	this.distancia_dedos		= 0;
	self.buscandoreglasactivo   = 0;

	this.reglas_css = document.styleSheets[0];
	this.reglas_css = this.reglas_css.cssRules || this.reglas_css.rules;
	this.interval_temp = setInterval(function () {
		if(self.reglas_css.length != 0 && self.buscandoreglasactivo == 0){
			self.buscandoreglasactivo = 1;
			for (var i = self.reglas_css.length - 1; i >= 0; i--) {
				if(self.reglas_css[i].selectorText.search("nombre_planeta_en_galaxia") != -1){ 
					self.reglas_css_texto = self.reglas_css[i];
					clearInterval(self.interval_temp);
					break;
				}
			};
			self.buscandoreglasactivo = 0;
		}
	}, 50);


	window.is_unselect_allowed = true;

	function getInternetExplorerVersion()
    // Returns the version of Internet Explorer or a -1 for other browsers.
    {
    	var rv = -1;
    	if (navigator.appName == 'Microsoft Internet Explorer')
    	{
    		var ua = navigator.userAgent;
    		var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})");
    		if (re.exec(ua) != null)
    			rv = parseFloat( RegExp.$1 );
    	}
    	return rv;
    }



	if(typeof(data)				== "undefined" )	var data 		= new Object(); //Si no se han introducidos opciones, creamos el objeto de opciones para rellenarlo con las variables predefinidas
	if(typeof(data.clas)		== "undefined" )	data.clas 		= ""; //Clase del contenedor del universo
	if(typeof(data.id)			== "undefined" )	data.id 		= ""; //ID del contenedor del universo
	if(typeof(data.padre)		== "undefined" )	data.padre 		= $("body"); //ID del contenedor del universo
	if(typeof(data.sectores_x)	== "undefined" )	data.sectores_x = NUM_SECTORES_X; //ID del contenedor del universo
	if(typeof(data.sectores_y)	== "undefined" )	data.sectores_y = NUM_SECTORES_Y; //ID del contenedor del universo
	if(typeof(data.margen_sup)	== "undefined" )	data.margen_sup = 15; //margen superior
	if(typeof(data.margen_inf)	== "undefined" )	data.margen_inf = 15; //margen inferior
	if(typeof(data.margen_der)	== "undefined" )	data.margen_der = 15; //margen derecho
	if(typeof(data.margen_izq)	== "undefined" )	data.margen_izq = 15; //margen izquierdo

	data.padre_height 		= data.padre.height();
	data.padre_width 		= data.padre.width();
	if (data.padre_width < 1001) data.padre_width = 1000;


	//Calculamos el tamaño de cada sector en zoom 1, para ello sacamos el alto y el ancho que le corresponde a cada sector en base al contenedor del universo y usamos el minimo de los 2 para hacer los cuadrados.
	data.TsectorsY 			= (data.padre_height - data.margen_sup - data.margen_inf)/data.sectores_y;
	data.TsectorsX 			= (data.padre_width  - data.margen_der - data.margen_izq)/data.sectores_x;

	if(data.TsectorsY < data.TsectorsX) {
		data.univers_sector_size = (data.padre_height - (data.margen_sup + data.margen_inf)) / data.sectores_y;
		data.univers_sector_size_original = data.univers_sector_size;
		data.orientation_cut = "Y";
		data.uni_height 		= data.univers_sector_size * data.sectores_y;
		data.uni_width 			= data.uni_height * 1.75;
	}else {
		data.univers_sector_size = (data.padre_width  - (data.margen_der + data.margen_izq)) / data.sectores_x;
		data.univers_sector_size_original = data.univers_sector_size;
		data.orientation_cut = "X";
		data.uni_width 			= data.univers_sector_size * data.sectores_x;
		data.uni_height 		= data.uni_width * 0.57142;
	}



	var correcion_tam_y = 69;
	var correcion_tam_x = 48;
	var correcion_pos_y = 13.9;
	var correcion_pos_x = 25.2;

	if(data.TsectorsY < data.TsectorsX) {
		data.uni_height 		/= correcion_tam_y/100;
		data.uni_width 			/= correcion_tam_y/100;
	}else {
		data.uni_height 		/= correcion_tam_x/100;
		data.uni_width 			/= correcion_tam_x/100;
	}

	data.original_uni_height= data.uni_height;
	data.original_uni_width = data.uni_width;


	//sacamos el % de ancho y alto que ocupa cada sector en el universo, así solo ponemos % y no medidas concretas. Dejando mucha parte de la redimensión fuera del JavaScript
	data.porcen_sec_x 		= 100 / data.sectores_x;
	data.porcen_sec_y 		= 100 / data.sectores_y;	
	
	//Creamos el objeto que contendrá el universo.
	data.JqueryDOMobject 	= $('<div id="'+data.id+'" class="'+data.clas+'" style="background-position: 0 0"><div class="univers_contenedor_todo"><div class="univer_background"></div><div class="univers_image"><img src="contenido/galaxia.png" ondragstart="return false" onselectstart="return false"></img></div><div class="univer_marcadores"></div></div></div>');
	data.JqueryDOMobject.css({height: "100%", width: "100%", border: "none", margin: 0, padding: 0, overflow: "hidden", position: "absolute"}); //Añadimos el css necesario para que funciones bien.
	data.JqueryDOMobject[0].onselectstart = function () { return false; };

	univers_contenedor_todo			= data.JqueryDOMobject.children(".univers_contenedor_todo");
	univers_sectores_select 		= univers_contenedor_todo.children(".univer_background");
	this.univers_sectores_select 	= univers_sectores_select;
	univers_image.image				= univers_contenedor_todo.children(".univers_image");
	univers_marcadores_select		= univers_contenedor_todo.children(".univer_marcadores");
	this.univers_marcadores_select	= univers_marcadores_select;

	univers_sectores_select.css(	{height: correcion_tam_y+"%", left: correcion_pos_x+"%", top: correcion_pos_y+"%", width: correcion_tam_x+"%"});
	univers_marcadores_select.css(	{height: correcion_tam_y+"%", left: correcion_pos_x+"%", top: correcion_pos_y+"%", width: correcion_tam_x+"%"});

	univers_contenedor_todo.css({width:(data.uni_width)+'px', height:(data.uni_height)+'px', position:"relative"});
	univers_image.image.css({'z-index': 0});

	//Te juro explorer, que un día te mataré, a ti y a toda tu descendencia... (es por tener que poner el ondragstart="return false" onselectstart="return false" en la imagen de galaxia)

	

	if(getInternetExplorerVersion() != -1){ 
		es_IE = 1; 
		if(es_IE_ver = getInternetExplorerVersion() < 10) es_IE_tonto = 1;

		MAX_ZOOM = Math.floor(1533917 / data.uni_width);
	}

	if(es_IE == 1){
		var unselect = function(){ 
			if(window.is_unselect_allowed) document.selection.empty();
		}
	}else{
		var unselect = function(){
			if(window.is_unselect_allowed){
				var myRange = document.getSelection();                                        
				myRange.removeAllRanges();
			}
		}
	}

	
	this.show_univers 		= function() {
		data.padre.append(data.JqueryDOMobject);
		calc_tam();		
		show_view();
		init_marc();
		return false;
	};


	function calc_tam(){
		data.vista_width 	= data.JqueryDOMobject.width();
		data.vista_height	= data.JqueryDOMobject.height();
		var tam_temp_uni_x = data.uni_width * (correcion_tam_x/100);
		var tam_temp_uni_y = data.uni_height * (correcion_tam_y/100);
		data.posXunivers	= -(tam_temp_uni_x/2 - (data.vista_width  - data.margen_izq - data.margen_der)/2) + data.margen_izq - data.uni_width  * (correcion_pos_x/100);
		data.posYunivers	= -(tam_temp_uni_y/2 - (data.vista_height - data.margen_sup - data.margen_inf)/2) + data.margen_sup - data.uni_height * (correcion_pos_y/100);
		data.posXunivers_inicial	= data.posXunivers;
		data.posYunivers_inicial	= data.posYunivers;

		univers_contenedor_todo.css({top:data.posYunivers,left:data.posXunivers});
		return false;
	}

	function show_view(){ //Creamos todos los sectores
		data.sectores = new Array(data.sectores_x);
		for(var i = data.sectores_x - 1; i >= 0; i--){
			data.sectores[i] = new Array(data.sectores_y);
			for(var j = data.sectores_y - 1; j >= 0; j--){
				data.sectores[i][j] = new univers_sector({x: i, y: j, size_porcentual_x: data.porcen_sec_x, size_porcentual_y: data.porcen_sec_y, padre: univers_sectores_select, NUM_SOLES_EJE:NUM_SOLES_EJE, padre_obj: self, interfaz: interfaz}); //Creamos un sector
				//data.sectores[i][j].poner_html_sector();
			};
		};
		return false;
	}

	this.poner_marcador 	= function(datos) {
		var sectorX = Math.floor(datos.x / NUM_SOLES_EJE);
		var sectorY = Math.floor(datos.y / NUM_SOLES_EJE);
		var posX = datos.x - sectorX * NUM_SOLES_EJE;
		var posY = datos.y - sectorY * NUM_SOLES_EJE;
		datos.nombre = datos.nombre.replace("%posX%",datos.x).replace("%posY%",datos.y);
		data.sectores[sectorX][sectorY].poner_marcador(datos);
	}

	function init_marc() {
		//PETICIÓN AJAX
		//Aquí el php pondrá los marcadores o los pediré con una función ajax.
		self.vector_marcadores = [[	
		{id: 1, x: 80, y: 80, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "morado",  orbita: 12},
		{id: 2, x: 85, y: 84, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "rojo", 	  orbita: 2},
		{id: 3, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 0},
		{id: 4, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 1},
		{id: 5, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 2},
		{id: 6, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 3},
		{id: 7, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 4},
		{id: 8, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 5},
		{id: 9, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 6},
		{id: 10, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 7},
		{id: 11, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 8},
		{id: 12, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 9},
		{id: 13, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 10},
		{id: 14, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 11},
		{id: 15, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 12},
		{id: 16, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 13},
		{id: 17, x: 102,y: 73, tipo: "planeta",	nombre: "%posX%/%posY%", 			color: "celeste", orbita: 14},
		{id: 18, x: 12, y: 63, tipo: "planeta", nombre: "Planeta (%posX%/%posY%)",  color: "celeste", orbita: 6},
		{id: 19, x: 25, y: 32, tipo: "sol", 	nombre: "%posX%/%posY%", 			color: "amarillo"},
		{id: 20, x: 23, y: 34, tipo: "sol", 	nombre: "Colonia (%posX%/%posY%)",  color: "azul"},
		{id: 21, x: 65, y: 12, tipo: "sol", 	nombre: "%posX%/%posY%", 			color: "naranja"},
		{id: 22, x: 28, y: 12, tipo: "sol", 	nombre: "Planeta (%posX%/%posY%)",  color: "verde"},
		{id: 23, x: 80, y: 80, tipo: "sol",	 	nombre: "%posX%/%posY%", 			color: "morado"},
		{id: 24, x: 12, y: 63, tipo: "sol", 	nombre: "Enemigo (%posX%/%posY%)", 	color: "rojo"}
		], 0];

		for (var i = self.vector_marcadores[0].length - 1; i >= 0; i--) {
			if(self.vector_marcadores[0][i].tipo == "planeta") self.vector_marcadores[0][i].datos_extra = generar_planeta();
		};

		self.vector_marcadores[1] = self.vector_marcadores[0].length;

		for (var i = self.vector_marcadores[1] - 1; i >= 0; i--) {
			self.vector_marcadores[0][i].i = i;
		};
		

		//Mostrar marcadores apuntando al centro del sistema
		var posX, posY, sectorX, sectorY;
		for (var i = 0; i < self.vector_marcadores[1]; i++) {
			self.poner_marcador(self.vector_marcadores[0][i]);
		};
	}

	function resize(event, acercar, zoom_pasado){
		if(en_zoom == 0){
			en_zoom = 1;
			var duracion = 100;
			if(acercar > 1) duracion = 300;
			zoom = zoom * acercar;
			if(zoom_pasado != 0) zoom = zoom_pasado;
			if(zoom > MAX_ZOOM) zoom = MAX_ZOOM;
			if(zoom < MIN_ZOOM) zoom = MIN_ZOOM;
			//console.log(zoom+" Tamaño universo antes: "+data.uni_width+" Tamaño universo después: "+data.original_uni_width * zoom);

			var posicion_raton_X_temp 	= event.pageX;
			var posicion_raton_Y_temp 	= event.pageY;	

			var porcent_click_X			= (posicion_raton_X_temp - data.posXunivers) / data.uni_width; //Calculamos en que % de x y que % de y hemos hecho click. Esto sirve para hacer zoom con foco en el ratón
			var porcent_click_Y			= (posicion_raton_Y_temp - data.posYunivers) / data.uni_height;

			var tam_final_universo_X	= Math.ceil(data.original_uni_width * zoom); //Calculamos el nuevo tamaño del universo en X después de hacer zoom
			var crecimiento_universo_X	= tam_final_universo_X - data.uni_width; //Sacamos lo que crece el universo en X

			var tam_final_universo_Y	= Math.ceil(data.original_uni_height * zoom); //Calculamos el nuevo tamaño del universo en X después de hacer zoom
			var crecimiento_universo_Y	= tam_final_universo_Y - data.uni_height; //Sacamos lo que crece el universo en X

			if(acercar < 1){ //Estamos acercandonos el mapa
				if(supreme_commander_zoom_mode == 1){ //Esto hace que al alejar la vista, tome como referencia el centro de la pantalla y no donde está el raton. Viene bien para desplazarse usando el raton
					var posicion_raton_X_temp 	= data.padre_width/2;
					var posicion_raton_Y_temp 	= data.padre_height/2;	

					var porcent_click_X			= (posicion_raton_X_temp - data.posXunivers) / data.uni_width; //Calculamos en que % de x y que % de y hemos hecho click. Esto sirve para hacer zoom con foco en el ratón
					var porcent_click_Y			= (posicion_raton_Y_temp - data.posYunivers) / data.uni_height;
				}
			}

			var final_left			= Math.ceil(data.posXunivers - crecimiento_universo_X * porcent_click_X);
			var final_top			= Math.ceil(data.posYunivers - crecimiento_universo_Y * porcent_click_Y);
			if(final_left <= data.padre_width/2 && final_left + tam_final_universo_X >= data.padre_width/2 && final_top <= data.padre_height/2 && final_top + tam_final_universo_Y >= data.padre_height/2 ){//todos los bordes quedan a menos de media pantalla del borde de la pantalla al final de la animación, se procede a animar normalmente
				if(es_IE != 1){
					univers_contenedor_todo.stop().animate({left: final_left, top: final_top, width: tam_final_universo_X, height: tam_final_universo_Y},{duration: duracion, queue: false, step: function(actual, fx){
						if(fx.prop == "width"){
							var temp = 0.00003 * actual;
							//if(temp > 24) temp = 24
							//else if(temp < 8) temp = 8;
							self.reglas_css_texto.style.fontSize = temp + "px";
						}
					}, complete: function () {
						en_zoom = 0;
					}} );
				}else{
					univers_contenedor_todo.css({left: final_left, top: final_top, width: tam_final_universo_X, height: tam_final_universo_Y});
					self.reglas_css_texto.style.fontSize =  0.00003 * tam_final_universo_X + "px";
					en_zoom = 0;
				}

				data.posXunivers	= final_left;
				data.posYunivers	= final_top;
				data.uni_width		= tam_final_universo_X;
				data.uni_height		= tam_final_universo_Y;
				data.univers_sector_size = tam_final_universo_X*(correcion_tam_x/100) / data.sectores_x;


				univers_image.opacity = 1/zoom; 
				if(univers_image.opacity < 0.1) 
					univers_image.image.animate({"opacity": 0},{duration: 200, queue: false, complete: function () {
						$(this).css({display: "none"});
					}});
				else if(univers_image.opacity > 0.1) 
					univers_image.image.animate({"opacity": univers_image.opacity},{duration: 200, queue: false, complete: function () {
						$(this).css({display: "block"});
					}});
				else if(univers_image.opacity > 1) 
					univers_image.image.animate({"opacity": 1},{duration: 200, queue: false, complete: function () {
						$(this).css({display: "block"});
					}});

				mostrar_info_niveles(acercar);	
			}else{
				en_zoom = 0;
				return 0;
			}
		}
		return false;
	}
	

	this.init_drag = function(){
		data.JqueryDOMobject.bind('mousedown touchstart',function(e){ //console.log("Touch START ("+e.type+"): "+e.which);
			e.preventDefault();
			if((e.which == 1 || (e.originalEvent.touches && e.which == 0)) &&  mouse_down == 0){
				mouse_down 			= 1;
				arrastrar_iniciado  = false;
				clearInterval(self.interval_movimiento);
				unselect(e);
				if(e.originalEvent.touches){
					posicion_raton_X 	= e.originalEvent.touches[0].pageX;
					posicion_raton_Y 	= e.originalEvent.touches[0].pageY;
				}else{
					posicion_raton_X 	= e.pageX;
					posicion_raton_Y 	= e.pageY;
				}//console.log(posicion_raton_X + " - " + posicion_raton_Y);
				$(body).css({cursor:"move"});
			}
			return false;
		});

		data.JqueryDOMobject.mousewheel(function(event, delta, deltaX, deltaY) {
			if(mouse_down == 0){
				if(delta > 0){
					if (zoom < MAX_ZOOM) resize(event, zoom_rueda_acercar, 0);
				}else{
					if(zoom > MIN_ZOOM) resize(event, zoom_rueda_alejar, 0);
				}
			}
			return false;
		});

		$(document).bind('mouseup touchend',function(e){ //console.log("Touch FINISH ("+e.type+"): "+e.which);
			e.preventDefault();
			if(e.which == 1 || (e.originalEvent.touches && e.which == 0)){
				mouse_down 			= 0;
				arrastrar_iniciado 	= false;
				clearInterval(self.interval_movimiento);
				unselect(e);
				posicion_raton_X 	= -1;
				self.distancia_dedos = 0;
			}
			return false;
		});
		data.JqueryDOMobject.bind('mouseup touchend',function(e){ //console.log("Touch FINISH ("+e.type+"): "+e.which);
			unselect(e);
		});
		$(document).keydown(function(e){
			if(e.which == 27){
				mouse_down 			= 0;
				arrastrar_iniciado 	= false;
				clearInterval(self.interval_movimiento);
				unselect(e);
				posicion_raton_X 	= -1;
				self.distancia_dedos = 0;
				return false;
			}
		});
		$(document).blur(function(e){
			mouse_down 			= 0;
			arrastrar_iniciado 	= false;
			clearInterval(self.interval_movimiento);
			unselect(e);
			posicion_raton_X 	= -1;
			this.distancia_dedos = 0;
			return false;
		});
		$(document).bind('mousemove touchmove', function(e){
			e.preventDefault();
			self.evento = e;		
			if(mouse_down == 1 && arrastrar_iniciado == false){
				arrastrar_iniciado = true;
				self.mover_mapa();
				self.interval_movimiento = setInterval(function () {
					if(self.movimiento_ejecucion == 0) self.mover_mapa();					
				}, 5);
			}
			return false;
		});
		return false;
	};

	this.mover_mapa = function(){
		self.movimiento_ejecucion = 1;
		var evento = self.evento;
		if(!evento.originalEvent.touches || evento.originalEvent.touches.length < 2){ //Evitamos que el mapa se mueva cuando hay más de un dedo. otra opción sería poner el centro de los 2 dedos como punto de movimiento
			unselect(evento);
			var reload 					= 0;
			var contenedor 				= data.JqueryDOMobject;
			var contenedor_mov 			= univers_contenedor_todo;
			if(evento.originalEvent.touches){
				var posicion_raton_X_temp 	= evento.originalEvent.touches[0].pageX;
				var posicion_raton_Y_temp 	= evento.originalEvent.touches[0].pageY;
			}else{
				var posicion_raton_X_temp 	= evento.pageX;
				var posicion_raton_Y_temp 	= evento.pageY;
			}
			//console.log("Touch MOVE: "+posicion_raton_X_temp + " - " + posicion_raton_Y_temp);
			var tempX 					= data.posXunivers - (posicion_raton_X - posicion_raton_X_temp);
			var tempY 					= data.posYunivers - (posicion_raton_Y - posicion_raton_Y_temp);


			var position_background 	= new Array(3);
			position_background[0] 		= 0;
			position_background[1] 		= 0;
			position_background[3]		= data.JqueryDOMobject.css("background-position").replace(/px/,"").split(" ");
			position_background[3][0]	= parseFloat(position_background[3][0]);
			position_background[3][1]	= parseFloat(position_background[3][1]);

			posicion_raton_X 			= posicion_raton_X_temp;
			posicion_raton_Y 			= posicion_raton_Y_temp;

			if(tempX + data.uni_width >= data.padre_width/2 && tempX <= data.padre_width/2){ //Miramos si un lateral se aleja mucho del borde de la pantalla					
				position_background[0] 	= (tempX - data.posXunivers)/20;
				data.posXunivers 		= tempX;
				reload = 1;
			}
			if(tempY + data.uni_height >= data.padre_height/2 && tempY <= data.padre_height/2){ //Miramos si un vertical se aleja mucho del borde de la pantalla
				position_background[1] 	= (tempY - data.posYunivers)/20;
				data.posYunivers 		= tempY;
				reload = 1;
			}

			if(reload  == 1){ // Si no nos hemos movido, no hace falta actualizar la pantalla

				if(zoom >= niveles_de_zoom[0] && zoom < niveles_de_zoom[1]){
					recargar_vista_sol(0);
				}else if(zoom >= niveles_de_zoom[1]){
					recargar_vista_sol(1);
				}

				contenedor_mov.css({left:data.posXunivers, top: data.posYunivers});					

				data.JqueryDOMobject.css({backgroundPosition: (position_background[0] + position_background[3][0]) + "px " + (position_background[1] + position_background[3][1]) + "px"});

			}
			unselect(evento);
		}else if(evento.originalEvent.touches.length > 1) { //Si hay más de un dedo, llamamos a la función que se encarga de zoom con multitouch
			var punto_central = [0,0];
			punto_central = zoom_multitouch(evento);
		} 
		self.movimiento_ejecucion = 0;
		return false;
	};

	var zoom_multitouch = function (evento) {
		var distancia_dedos = Math.sqrt(Math.pow(evento.originalEvent.touches[0].pageX-evento.originalEvent.touches[1].pageX,2)+Math.pow(evento.originalEvent.touches[0].pageY-evento.originalEvent.touches[1].pageY,2));
		if(self.distancia_dedos == 0){ 
			self.distancia_dedos = distancia_dedos;
			this.zoom_multitouch_primero = zoom;
			return false;
		}
		var porcent = distancia_dedos / self.distancia_dedos;
		if(porcent > 1) porcent = (porcent - 1) / 2 + 1;
		else porcent = 1 - ((1 - porcent) / 2);

		resize({pageX:(evento.originalEvent.touches[0].pageX + evento.originalEvent.touches[1].pageX)/2, pageY:(evento.originalEvent.touches[0].pageY + evento.originalEvent.touches[1].pageY)/2}, 0, this.zoom_multitouch_primero*porcent); 
		return false;
	}

	function recargar_vista_sol(planetas){
		var tempX1 = data.posXunivers + data.uni_width  * (correcion_pos_x/100);
		var tempY1 = data.posYunivers + data.uni_height * (correcion_pos_y/100);

		if(tempX1 > 0) 	var lefts = 0;
		else 			var lefts = tempX1;

		if(tempY1  > 0) 	var tops  = 0;
		else 				var tops  = tempY1;

		data.univers_sector_size_sol = data.univers_sector_size / NUM_SOLES_EJE;

		pos_X_ini_s	= Math.floor(Math.abs(lefts) / data.univers_sector_size_sol) - 1;
		pos_X_fin_s	= pos_X_ini_s + Math.ceil(data.vista_width / data.univers_sector_size_sol) + 1;

		pos_Y_ini_s	= Math.floor(Math.abs(tops) / data.univers_sector_size_sol) - 1;
		pos_Y_fin_s	= pos_Y_ini_s + Math.ceil(data.vista_height / data.univers_sector_size_sol) + 1;

		//console.log(pos_X_ini_s + " | " + pos_X_fin_s + " || " + pos_Y_ini_s + " | " + pos_Y_fin_s + " -- " + data.univers_sector_size_sol);

		if(pos_X_ini_s < 0) pos_X_ini_s = 0;
		if(pos_Y_ini_s < 0) pos_Y_ini_s = 0;
		if(pos_X_fin_s >= data.sectores_x * NUM_SOLES_EJE) pos_X_fin_s = data.sectores_x * NUM_SOLES_EJE-1;
		if(pos_Y_fin_s >= data.sectores_y * NUM_SOLES_EJE) pos_Y_fin_s = data.sectores_y * NUM_SOLES_EJE-1;

		var pos_Y, pos_X, pos_sub_X, pos_sub_Y, planet = 0;

		for(var i = 0; i < self.soles_mostrados[1]; i++){ //Borramos soles que se salen de lo que vemos (si el sol tiene un planeta se borra solo tambien)
			pos_X = self.soles_mostrados[0][i][0] * NUM_SOLES_EJE + self.soles_mostrados[0][i][2];
			pos_Y = self.soles_mostrados[0][i][1] * NUM_SOLES_EJE + self.soles_mostrados[0][i][3];
			if(pos_X < pos_X_ini_s || pos_X > pos_X_fin_s || pos_Y < pos_Y_ini_s || pos_Y > pos_Y_fin_s)
				data.sectores[self.soles_mostrados[0][i][0]][self.soles_mostrados[0][i][1]].borrar_sol(i);
		}

		for (var i = pos_X_ini_s; i <= pos_X_fin_s; i++) { //Mostramos los soles que tocan
			for (var j = pos_Y_ini_s; j <= pos_Y_fin_s; j++) {
				pos_X 		= Math.floor(i/NUM_SOLES_EJE);
				pos_Y 		= Math.floor(j/NUM_SOLES_EJE);
				pos_sub_X	= i - pos_X * NUM_SOLES_EJE;
				pos_sub_Y	= j - pos_Y * NUM_SOLES_EJE;
				data.sectores[pos_X][pos_Y].mostrar_sol(pos_sub_X, pos_sub_Y);
			};
		};
		if(planetas == 1){ //Mostramos los planetas que tocan
			/*for(var i = 0; i < self.soles_mostrados[1]; i++){
				data.sectores[self.soles_mostrados[0][i][0]][self.soles_mostrados[0][i][1]].mostrar_planeta(self.soles_mostrados[0][i][2], self.soles_mostrados[0][i][3])
			}*/
			for (var i = pos_X_ini_s; i <= pos_X_fin_s; i++) { //Mostramos los soles que tocan
				for (var j = pos_Y_ini_s; j <= pos_Y_fin_s; j++) {
					pos_X 		= Math.floor(i/NUM_SOLES_EJE);
					pos_Y 		= Math.floor(j/NUM_SOLES_EJE);
					pos_sub_X	= i - pos_X * NUM_SOLES_EJE;
					pos_sub_Y	= j - pos_Y * NUM_SOLES_EJE;
					data.sectores[pos_X][pos_Y].mostrar_planeta(pos_sub_X, pos_sub_Y);
					data.sectores[pos_X][pos_Y].ajustar_marcador_planeta(pos_sub_X, pos_sub_Y);
				};
			};
		}
		return false;
	}

	function mostrar_info_niveles(acercar) { 
		if(acercar > 1){ //Si estamos ampliando
			if(zoom >= niveles_de_zoom[0] && zoom <= niveles_de_zoom[1]){
				recargar_vista_sol(0);
			}else if(zoom > niveles_de_zoom[1]){
				recargar_vista_sol(1);
			}
		}else if(acercar < 1){
			if(zoom < niveles_de_zoom[0]){
				var temp = self.soles_mostrados[1];
				for(var i = temp-1; i >= 0; i--) //Si nos salimos del rango de mostrar soles y no tenemos que mostrar nada
					data.sectores[self.soles_mostrados[0][i][0]][self.soles_mostrados[0][i][1]].borrar_sol(i);
			}else if(zoom >= niveles_de_zoom[0] && zoom > niveles_de_zoom[1]){ //Si estamos en el rango de solo soles.
				recargar_vista_sol(0);
			}else if(zoom <= niveles_de_zoom[1]){
				for(var i = 0; i < self.soles_mostrados[1]; i++){ //Si nos salimos del rango de planetas y ponemos solo soles
					data.sectores[self.soles_mostrados[0][i][0]][self.soles_mostrados[0][i][1]].borrar_planeta(self.soles_mostrados[0][i][2], self.soles_mostrados[0][i][3]);
				};
				recargar_vista_sol(0);
			}
		}
		en_zoom = 0;
	}

	this.zoom_sol_pos = function(x,y) {
		en_zoom  = 1;
		
		if(data.orientation_cut == "X"){
			data.univers_sector_size_original
			var tam_pantalla = (data.padre_width  - (data.margen_der + data.margen_izq)) / data.sectores_x;
			var multiplicador =  tam_pantalla / (data.univers_sector_size_original/(NUM_SOLES_EJE*data.sectores_y));
		}else{
			data.univers_sector_size_original
			var tam_pantalla = (data.padre_height  - (data.margen_sup + data.margen_inf)) / data.sectores_y;
			var multiplicador =  tam_pantalla / (data.univers_sector_size_original/(NUM_SOLES_EJE*data.sectores_y));
		}

		zoom = multiplicador;

		var tam_universo_X = data.sectores_x * data.univers_sector_size_original * multiplicador / (correcion_tam_x / 100);
		var tam_universo_Y = data.sectores_y * data.univers_sector_size_original * multiplicador / (correcion_tam_y / 100);
		var tam_un_sistema_x = (tam_universo_X * (correcion_tam_x / 100)) / (data.sectores_x*NUM_SOLES_EJE);
		var tam_un_sistema_y = (tam_universo_Y * (correcion_tam_y / 100)) / (data.sectores_y*NUM_SOLES_EJE);
		var pos_X = -(tam_un_sistema_x * x) + data.margen_izq - tam_universo_X * (correcion_pos_x / 100);
		var pos_Y = -(tam_un_sistema_y * y) + data.margen_sup - tam_universo_Y * (correcion_pos_y / 100);

		data.posXunivers	= pos_X;
		data.posYunivers	= pos_Y;
		data.uni_width		= tam_universo_X;
		data.uni_height		= tam_universo_Y;
		data.univers_sector_size = data.univers_sector_size_original * multiplicador;
		univers_image.opacity = univers_image.opacity = 1/zoom; 

		univers_image.image.animate({"opacity": univers_image.opacity},{duration: 500, queue: false});
		univers_contenedor_todo.animate({left: pos_X, top: pos_Y, width: tam_universo_X, height: tam_universo_Y},{duration: 1000, queue: false, step: function(actual, fx){
			if(fx.prop == "width"){
				var temp = 0.00003 * actual;
				//if(temp > 24) temp = 24
				//else if(temp < 8) temp = 8;
				self.reglas_css_texto.style.fontSize = temp + "px";
			}
		}, complete: function () {
			en_zoom = 0;
		}});
		recargar_vista_sol(1);

		pos_X 			= Math.floor(x/NUM_SOLES_EJE);
		pos_Y 			= Math.floor(y/NUM_SOLES_EJE);
		var pos_sub_X	= x - pos_X * NUM_SOLES_EJE;
		var pos_sub_Y	= y - pos_Y * NUM_SOLES_EJE;
		data.sectores[pos_X][pos_Y].remarcar_sol(pos_sub_X, pos_sub_Y);

	}

	return false;
};