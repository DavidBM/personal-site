"use strict";
function univers_sector (data) { //{x: i, y: j, size_porcentual_x: data.porcen_sec_x, size_porcentual_y: data.porcen_sec_y, padre: univers_sectores_select, NUM_SOLES_EJE:NUM_SOLES_EJE, padre_obj: self}

	this.x = data.x;
	this.y = data.y;
	this.padre_obj = data.padre_obj;
	this.padre = this.padre_obj.univers_sectores_select;
	this.carga_iniciada = false;
	this.NUM_SOLES_EJE = data.NUM_SOLES_EJE;
	this.sector = 0;
	this.soles = -1;
	this.soles_json = 0;
	this.soles_cargados = false;
	//Colas
	this.vector_cola_mostrar_planeta = [];
	this.planetas_a_mostrar = 0;
	this.vector_cola_remarcar_sol = [];
	this.soles_a_remarcar = 0;
	this.vector_marcador_a_ajustar_planeta = [];
	this.marcador_a_ajustar_planeta = 0;
	//Datos para las orbitas
	this.radio_intervalo = 36.2/15;
	this.radio_inicial 	= 14.35;

	this.ajuste_marcador_planeta_x = 0.01;
	this.ajuste_marcador_planeta_y = 0.006;

	this.matriz_marcadores = 0;
	this.interfaz = data.interfaz;


	this.rellenar(data);

	return false;
}

univers_sector.prototype.rellenar = function(data) {
	//if((i==0 && j==0) || (i==1 && j==0) || (i==10 && j==0) || (i==0 && j==1) || (i==10 && j==7) || (i==0 && j==8) || (i==9 && j==8) || (i==10 && j==8)) return 0;
	//if((this.x!=0 || this.y!=0) && (this.x!=1 || this.y!=0) && (this.x!=10 || this.y!=0) && (this.x!=0 || this.y!=1) && (this.x!=10 || this.y!=7) && (this.x!=0 || this.y!=8) && (this.x!=9 || this.y!=8) && (this.x!=10 || this.y!=8) && (this.x!=5 || this.y!=4)) ESTO ES LA LÓGICA DEL ANTERIOR!
	var sistema = this.comprobar_sistema(data.x, data.y, data.size_porcentual_x, data.size_porcentual_y);
	if(sistema == 0){ 
		this.sector = $('<div class="univers_sector univers_number_clas'+data.x+'y'+data.y+'" style="width:'+data.size_porcentual_x+'%;height:'+data.size_porcentual_y+'%; position: absolute; top:'+(data.size_porcentual_y*data.y)+'%;left:'+(data.size_porcentual_x*data.x)+'%; z-index: 1;"></div>');
		this.soles	= $('<div class="soles_sector_padre"></div>');
		this.padre.prepend(this.sector);
		this.sector_vacio_oculto_relleno = 1;
		this.sector.click(function () {
			console.log($(this).attr("class"));
		});
	}else if(sistema == 1){	//Los que no son visibles de las esquinas
		//this.sector = $('<div class="univers_sector univers_sector_no_mostrar univers_number_clas'+data.x+'y'+data.y+'"></div>');
		//this.soles	= $('<div class="soles_sector_padre"></div>');
		//this.padre.prepend(this.sector);
		this.sector_vacio_oculto_relleno = 0;
	}else if(sistema == 2) { //el centro
		this.sector = $('<div class="univers_sector centro_universo_sector univers_number_clas'+data.x+'y'+data.y+'" style="width:'+data.size_porcentual_x+'%;height:'+data.size_porcentual_y+'%; position: absolute; top:'+(data.size_porcentual_y*data.y)+'%;left:'+(data.size_porcentual_x*data.x)+'%; z-index: 1;"></div>');
		this.padre.prepend(this.sector); 
		this.sector_vacio_oculto_relleno = -1;
	}


	//GENERACIÓN ALEATORIA, ESTO SE TENDRÁ QUE BORRAR MÁS ADELANTE
	this.matriz_soles_cuadricula = new Array(this.NUM_SOLES_EJE);
	this.soles_json = new Array();
	for (var i = this.matriz_soles_cuadricula.length - 1; i >= 0; i--) {
		this.matriz_soles_cuadricula[i] = new Array(this.NUM_SOLES_EJE);
		for (var j = this.NUM_SOLES_EJE - 1; j >= 0; j--) {
			if(Math.random() <= 0.35) this.matriz_soles_cuadricula[i][j] = 1;
			else this.matriz_soles_cuadricula[i][j] = 0;
		};
	};
	var k = 0;
	for (var i = this.matriz_soles_cuadricula.length - 1; i >= 0; i--) {
		for (var j = this.matriz_soles_cuadricula[i].length - 1; j >= 0; j--) {
			if(this.matriz_soles_cuadricula[i][j] == 1){
				this.soles_json[k] = [0, i, j]; // id, x, y
				this.matriz_soles_cuadricula[i][j] = this.soles_json[k++];
			}
		};
	};

	/*FIN GENERACIÓN ALEATORIA*/



	this.acceso_soles		= new Array(this.NUM_SOLES_EJE); //Da acceso al objeto DOM del sol, si es 0 es que no es sol
	this.estado_soles 		= new Array(this.NUM_SOLES_EJE); //Esto indica como están los planetas y soles. 	0 -> nada mostrado; 	1 -> sol mostrado
	this.estado_planetas 	= new Array(this.NUM_SOLES_EJE); //Esto indica como están los planetas y soles. 	0 -> planeta no mostrado; 	1 -> planeta mostrado
	this.rand_soles 		= new Array(this.NUM_SOLES_EJE); //Esto es un matriz con las posiciones random de cada sol. para que se puedan acceder rápido sin usar jquery que es muy lento
	this.planetas_cir		= new Array(this.NUM_SOLES_EJE); //Aquí se alamacenarán las posiciones random de cada planeta en cada sol
	for (var i = this.NUM_SOLES_EJE - 1; i >= 0; i--) {
		this.acceso_soles[i] 	= new Array(this.NUM_SOLES_EJE);
		this.estado_soles[i] 	= new Array(this.NUM_SOLES_EJE);
		this.estado_planetas[i] = new Array(this.NUM_SOLES_EJE);
		this.rand_soles[i] 		= new Array(this.NUM_SOLES_EJE);
		this.planetas_cir[i]	= new Array(this.NUM_SOLES_EJE);
		for (var j = this.NUM_SOLES_EJE - 1; j >= 0; j--) {
			this.acceso_soles[i][j] 	= 0;
			this.estado_soles[i][j] 	= 0;
			this.estado_planetas[i][j] 	= 0;
			this.rand_soles[i][j] 		= 0;
			this.planetas_cir[i][j] 	= 0;
		};
	};

	//this.poner_html_sector();

	return false;
};

univers_sector.prototype.comprobar_sistema = function (x, y, porcent_x, porcent_y) { //Para hacer las esquinas redondeadas "redondeadas" de la galaxia. Comprueba que el sector no sea un sector que no se tiene que mostrar.
	var numero_sectores = 100/porcent_x;
	var num_x = this.padre_obj.datos.sectores_x;
	var num_y = this.padre_obj.datos.sectores_y;
	var num_cuadro_quitar_gs = 2;
	var num_cuadro_quitar_ps = 1;
	var num_cuadro_quitar_pi = 1;
	var num_cuadro_quitar_gi = 2;
	//Quitar esquinas arriba izquierda. //calculamos los cuadros que no se mostrarian y si este está entre ellos, damos un 0. Como los cortes de las esquinas siempre son de 45 grados. Lo tenemos facil.
	if(num_cuadro_quitar_gs > x				&& y < num_cuadro_quitar_gs - x) return 1; //Con esto miramos que no esté encima de la esquina superior izquierda
	if(num_x-num_cuadro_quitar_ps <= x		&& y <= num_cuadro_quitar_ps - (num_cuadro_quitar_ps - (x - (num_x - num_cuadro_quitar_ps))) ) return 1; //Con esto miramos que no esté encima de la esquina superior derecha (es más pequeña)
	if(num_cuadro_quitar_gi >= x			&& y >= x + (num_y - num_cuadro_quitar_pi) ) return 1; //Con esto miramos que no esté encima de la esquina inferior izquierda (es más pequeña)
	if(num_x-num_cuadro_quitar_gi-1 <= x	&& x >= (num_x - num_cuadro_quitar_gi) + num_cuadro_quitar_gi - (y - (num_y - num_cuadro_quitar_gi))-1 ) return 1; //Con esto miramos que no esté encima de la esquina superior izquierda

	if(num_x%2 == 0){ //Hay que quitar 2 cuadros en x
		if(num_y%2 == 0){ //Hay que quitar 2 en y
			if((x == num_x/2 ||  x == num_x/2-1) && (y == num_y/2 ||  y == num_y/2-1)) return 2;
		}else{
			if((x == num_x/2 ||  x == num_x/2-1) && y == Math.ceil(num_y/2)-1 ) return 2;
		}
	}else{
		if(num_y%2 == 0){ //Hay que quitar 2 en y
			if(x == Math.ceil(num_x/2)-1 && (y == num_y/2 ||  y == num_y/2-1)) return 2;
		}else{
			if(x == Math.ceil(num_x/2)-1 && y == Math.ceil(num_y/2)-1 ) return 2;
		}
	}


	return 0;
}

univers_sector.prototype.cargar_datos_sector_soles = function() {
	if(this.sector_vacio_oculto_relleno < 1) return false;
	//tipo 0 -> sol, tipo 1 -> satelite, tipo 2 -> fortaleza;
	//[id , x , y , tipo] 
	this.carga_iniciada = true; //indicamos que se van a cargar todos los datos de este sector y que se pongan en cola los planetas a mostrar.
	var self = this;
	setTimeout(function () { //Simulados la asincronidad de ajax
		self.cargar_ajax_datos();
	},2000);

	this.poner_html_sector(); //Ponemos el html de todos los soles en el sector
	return false;
};

univers_sector.prototype.cargar_ajax_datos = function() { //GENERACIÓN ALEATORIA a espera de que el servidor esté listo
	//GENERACIÓN ALEATORIA, ESTO SE TENDRÁ QUE BORRAR MÁS ADELANTE

	var matriz_planetas = new Array(this.NUM_SOLES_EJE);
	for (var i = this.NUM_SOLES_EJE - 1; i >= 0; i--) {
		matriz_planetas[i] = new Array(this.NUM_SOLES_EJE);
		for (var j = this.NUM_SOLES_EJE - 1; j >= 0; j--) {
			matriz_planetas[i][j] = 0;
		};
	};
	var temp = this.soles_json.length;
	for (var i = 0; i < temp; i++) {
		matriz_planetas[this.soles_json[i][1]][this.soles_json[i][2]] = new Array(15);
		for (var j = 0; j < 15; j++) {
			matriz_planetas[this.soles_json[i][1]][this.soles_json[i][2]][j] = generar_planeta();
		};
	};

	//FIN NEGERACIÓN ALEATORIA

	this.planetas_json = matriz_planetas;

	this.soles_cargados = true;
	this.carga_iniciada = false; //Indicamos que ya no hace falta nada especial para mostrar un sol, los datos estan listos y el html tambien

	this.cargar_pendientes();

	return false;
};

univers_sector.prototype.cargar_pendientes = function() { //Creamos el html para los soles (sin el html de los planetas, ese se genera cuando se necesita para nos sobrecargar)
	for (var i = 0; i < this.planetas_a_mostrar; i++) {
		this.mostrar_planeta(this.vector_cola_mostrar_planeta[i][0],this.vector_cola_mostrar_planeta[i][1]); //Mostramos todos los soles de la cola de soles a mostrar
	};
	for (var i = 0; i < this.soles_a_remarcar; i++) {
		this.remarcar_sol(this.vector_cola_remarcar_sol[i][0],this.vector_cola_remarcar_sol[i][1]); //Mostramos todos los soles de la cola de soles a mostrar
	};
	for (var i = 0; i < this.marcador_a_ajustar_planeta; i++) {
		this.ajustar_marcador_planeta(this.vector_marcador_a_ajustar_planeta[i][0],this.vector_marcador_a_ajustar_planeta[i][1]); //Mostramos todos los soles de la cola de soles a mostrar
	};
	return true;
};

univers_sector.prototype.poner_html_sector = function() { //Creamos el html para los soles (sin el html de los planetas, ese se genera cuando se necesita para nos sobrecargar)
	if(this.sector_vacio_oculto_relleno < 1) return false;
	var porcent_sistema 	= 100/this.NUM_SOLES_EJE;

	var soles_DOM = this.soles[0];

	var num_soles 		= this.soles_json.length;
	var sol_temp_cont, sol_temp, planetas_orbita, j, k, temp;
	var elemento_temporal = $('<div class="sector_sol"></div>')[0];
	var rand_X, rand_Y;

	var sol_temp_cont_clone = $('<div class="sol_fondo_contenedor"></div>');
	sol_temp 				= $('<img class="sol_fondo" src="contenido/sol.png" ondragstart="return false" onselectstart="return false"></img>')
	planetas_orbita			= $('<div class="sol_fondo_orbitas"><img src="contenido/orbitas.png" ondragstart="return false" onselectstart="return false"></img></div>').css({display: "none"});
	sol_temp_cont_clone.append(sol_temp).append(planetas_orbita);
	sol_temp_cont_clone = sol_temp_cont_clone[0];
	var x, y;
	for(var i=0; i<num_soles; i++){
		x = this.soles_json[i][1];
		y = this.soles_json[i][2];

		temp = elemento_temporal.cloneNode(true);
		this.acceso_soles[x][y] = $(temp);
		temp.style.left = porcent_sistema * x + "%";
		temp.style.top = porcent_sistema * y + "%";
		temp.style.width = porcent_sistema + "%";
		temp.style.height = porcent_sistema + "%";

		this.rand_soles[x][y] = [Math.random()*40, Math.random()*40];

		sol_temp_cont = sol_temp_cont_clone.cloneNode(true);
		sol_temp_cont.style.left = this.rand_soles[x][y][0] + "%";
		sol_temp_cont.style.top = this.rand_soles[x][y][1] + "%";

		temp.appendChild(sol_temp_cont)
		soles_DOM.appendChild(temp);
		//Ajustamos el marador si lo hay. Primero miramos si hay en el sector y después en el sol.
		if(this.matriz_marcadores != 0 && this.matriz_marcadores[x][y] != 0) this.ajustar_marcador_sol(x, y);
	}
	this.sector[0].appendChild(soles_DOM);
	return true;
};

univers_sector.prototype.remarcar_sol = function (x, y) {
	if(this.sector_vacio_oculto_relleno < 1) return false; //Que no sea un sector de las esquinas que no se muestran
	if(this.soles_cargados == false && this.carga_iniciada == true){ //Esto es que estamos haciendo la petición ajax, por tanto tenemos que poner la petición en cola. Osea, los soles no estan cargados, pero la carga está iniciada 
		this.vector_cola_remarcar_sol[this.soles_a_remarcar++] = [x, y];
		return false;
	}else if(this.soles_cargados == true && this.acceso_soles[x][y] != 0){ //que no sea un posición sin sol y que esten cargados y que el sol no esté mostrado
		this.acceso_soles[x][y].children(".sol_fondo_contenedor").css({outline: "#EB1337 2px solid", borderRadius: "5px"});
		this.padre_obj.sol_remarcado_activo = [1, x, y, this.x, this.y];
		return true;
	}
	return false;
};

univers_sector.prototype.desmarcar_sol = function (x, y) {
	if(this.sector_vacio_oculto_relleno < 1) return false; //Que no sea un sector de las esquinas que no se muestran
	this.acceso_soles[x][y].children(".sol_fondo_contenedor").css({outline: "", borderRadius: ""});
	this.padre_obj.datos.sol_remarcado_activo = [0, x, y, this.x, this.y];
	return true;
	return false;
};

univers_sector.prototype.mostrar_sol = function (x, y) {
	if(this.sector_vacio_oculto_relleno < 1) return false; //Que no sea un sector de las esquinas que no se muestran
	if(this.soles_cargados == false && this.carga_iniciada == false){
		this.cargar_datos_sector_soles();
		return false;
	}
	if(this.acceso_soles[x][y] != 0 && this.estado_soles[x][y] == 0){ //que no sea un posición sin sol y que el sol no esté mostrado
		this.acceso_soles[x][y].css({display:"block"});
		this.estado_soles[x][y] = 1;
		this.padre_obj.soles_mostrados[0][this.padre_obj.soles_mostrados[1]++] = [this.x, this.y, x, y];
		return true;
	}
	return false;
};

univers_sector.prototype.borrar_sol = function (i) {
	var planet = 0;
	var x = this.padre_obj.soles_mostrados[0][i][2];
	var y = this.padre_obj.soles_mostrados[0][i][3];
	if(this.acceso_soles[x][y] == 0) return 0;
	if(this.estado_planetas[x][y] == 2){ 
		this.borrar_planeta(x, y);
		planet = 1;
	}
	this.acceso_soles[x][y].css({display: "none"});
	this.padre_obj.soles_mostrados[0].splice(i, 1);
	this.padre_obj.soles_mostrados[1]--;
	this.estado_soles[x][y] = 0;
	return 1;
};

univers_sector.prototype.mostrar_planeta = function(x, y){ 
	if(this.sector_vacio_oculto_relleno < 1) return false;	
	if(this.soles_cargados == false && this.carga_iniciada == true){
		this.vector_cola_mostrar_planeta[this.planetas_a_mostrar++] = [x, y];
		return false;
	}
	if(this.acceso_soles[x][y] == 0) return true; 
	if(this.estado_soles[x][y] == 3) return true;
	if(this.estado_planetas[x][y] == 0){
		var contenedor_sol = this.acceso_soles[x][y].children(".sol_fondo_contenedor").children(".sol_fondo_orbitas");
		var planetas_planet = new Array(15);
		this.planetas_cir[x][y] = new Array(15);
		var k, self = this;
		for (var i = 0; i < 15; i++) this.planetas_cir[x][y][i] = posicion_Y_circunferencia_rand_neg_pos_rand_X_for_jquery_css(	this.radio_intervalo * i +  this.radio_inicial, this.planetas_json[x][y][i][1])

		var temp_img = $('<img src="contenido/planeta_caliente_'+k+'.png">').attr("ondragstart","return false").attr("onselectstart","return false");
		var temp_div = $('<div class="sol_fondo_planeta">');
		var temp_p = $('<p class="nombre_planeta_en_galaxia">');

		var temp_p_temp;

		for (var j = 0, k = 1; j < 5; j++, k++){ 
			if(this.planetas_json[x][y][j][0] == 0)	temp_p_temp = "";
			else{
				var nombre_temp = this.planetas_json[x][y][j][2];
				if(nombre_temp.length > 13) nombre_temp = nombre_temp.substr(0,11)+"...";
				if(this.planetas_json[x][y][j][0] == 1)	temp_p_temp = temp_p.clone().text( nombre_temp ).attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 2)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_verde").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 3)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_rojo").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 4)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_azul").attr("title",this.planetas_json[x][y][j][2]);
			}
			planetas_planet[j] 		= temp_div.clone().addClass('planeta_c'+k).append(temp_img.clone().attr("src",'contenido/planeta_caliente_'+k+'.png') ).append(temp_p_temp).css(this.planetas_cir[x][y][j]).attr("title",this.planetas_json[x][y][j][2]);
		}
		for (var j = 5, k = 1; j < 10; j++, k++){

			if(this.planetas_json[x][y][j][0] == 0)	temp_p_temp = "";
			else{
				var nombre_temp = this.planetas_json[x][y][j][2];
				if(nombre_temp.length > 13) nombre_temp = nombre_temp.substr(0,11)+"...";
				if(this.planetas_json[x][y][j][0] == 1)	temp_p_temp = temp_p.clone().text( nombre_temp ).attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 2)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_verde").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 3)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_rojo").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 4)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_azul").attr("title",this.planetas_json[x][y][j][2]);
			}
			planetas_planet[j] 		= temp_div.clone().addClass('planeta_t'+k).append( temp_img.clone().attr("src",'contenido/planeta_templado_'+k+'.png') ).append(temp_p_temp).css(this.planetas_cir[x][y][j]).attr("title",this.planetas_json[x][y][j][2]);
		}
		for (var j = 10, k = 1; j < 15; j++, k++){
			if(this.planetas_json[x][y][j][0] == 0)	temp_p_temp = "";
			else{
				var nombre_temp = this.planetas_json[x][y][j][2];
				if(nombre_temp.length > 13) nombre_temp = nombre_temp.substr(0,11)+"...";
				if(this.planetas_json[x][y][j][0] == 1)	temp_p_temp = temp_p.clone().text( nombre_temp ).attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 2)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_verde").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 3)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_rojo").attr("title",this.planetas_json[x][y][j][2]);
				else if(this.planetas_json[x][y][j][0] == 4)	temp_p_temp = temp_p.clone().text( nombre_temp ).addClass("texto_azul").attr("title",this.planetas_json[x][y][j][2]);
			}
			planetas_planet[j] 		= temp_div.clone().addClass('planeta_f'+k).append( temp_img.clone().attr("src",'contenido/planeta_frio_'+k+'.png') ).append(temp_p_temp).css(this.planetas_cir[x][y][j]).attr("title",this.planetas_json[x][y][j][2]);
		}
		for (var i = 0; i < 15; i++) this.planetas_cir[x][y][i] = [parseFloat(this.planetas_cir[x][y][i].left) , parseFloat(this.planetas_cir[x][y][i].top)];

		for(var j = 0; j < 15; j++) contenedor_sol.append(planetas_planet[j]);
		this.estado_planetas[x][y] = 1;
		for (var i = 0; i < 15; i++) {
			planetas_planet[i].bind("click touchend",(function (i) {
				return function () {
					self.interfaz.planeta_seleccionado({x: x+self.NUM_SOLES_EJE*self.x, y: y+self.NUM_SOLES_EJE*self.y, orbita: i, datos_extra: self.planetas_json[x][y][i]});
				} 
			}(i)));
		};
		this.ajustar_marcador_planeta(x, y);
	}
	if(this.estado_planetas[x][y] == 1){
		this.acceso_soles[x][y].children(".sol_fondo_contenedor").children(".sol_fondo_orbitas").css({display:"block", width: "0%", height: "0%", top: "50%", left: "50%"}).animate({width: "100%", height: "100%", top: "0%", left: "0%"},{duration: 400, queue: false, complete: function () {
			this.style.display = "block";			
			this.style.overflow = "";
		}});
		this.acceso_soles[x][y].children(".sol_fondo_contenedor").children(".sol_fondo").attr("src","contenido/sol_alta_resolucion.png");
		this.estado_soles[x][y] = 1;
		this.estado_planetas[x][y] = 2;
		return true;
	}
	return false;
};

univers_sector.prototype.borrar_planeta = function(x, y){
	if(this.sector_vacio_oculto_relleno < 1) return false;
	if(this.estado_planetas[x][y] == 2){
		this.acceso_soles[x][y].children(".sol_fondo_contenedor").children(".sol_fondo_orbitas").animate({width: "0%", height: "0%", top: "50%", left: "50%"},{duration: 400, queue: false, complete: function () {
			this.style.display = "none";
			this.style.overflow = "";
		}});
		this.acceso_soles[x][y].children(".sol_fondo_contenedor").children(".sol_fondo").attr("src","contenido/sol.png");
		this.ajustar_marcador_sol(x,y);
		this.estado_planetas[x][y] = 1;
		return true;
	}
	return false;
};

univers_sector.prototype.poner_marcador = function(datos){
	if(this.sector_vacio_oculto_relleno < 1) return false;
	var temp, self = this;

	var x = datos.x - this.x * this.NUM_SOLES_EJE;
	var y = datos.y - this.y * this.NUM_SOLES_EJE;

	//this.padre_obj.marcadores_mostrados[0][this.padre_obj.marcadores_mostrados[1]++] = [this.x, this.y, x, y, datos];

	var porcent_x = (datos.x / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x) +0.5/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x))*100;
	var porcent_y = (datos.y / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y) +0.5/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y))*100;
	var temp = $('<div class="marcador_galaxia marcador_'+datos.color+'"><p class="marcador_galaxia_titulo">'+datos.nombre+'</p></div>').css({left: porcent_x+"%", top: porcent_y+"%"});
	//creamos el evento para la interfaz
	temp.bind("click touchend", function(){
		self.interfaz.marcador_seleccionado(datos);
	});

	this.padre_obj.univers_marcadores_select.append(temp);
	//Aquí guardamos un acceso directo al marcador para reajustarlo cuando mostrmos un sol.

	if(this.matriz_marcadores == 0){
		this.matriz_multimarcadores = new Array(this.NUM_SOLES_EJE);
		this.matriz_marcadores = new Array(this.NUM_SOLES_EJE);
		for (var i = this.NUM_SOLES_EJE - 1; i >= 0; i--) {
			this.matriz_multimarcadores[i] = new Array(this.NUM_SOLES_EJE);
			this.matriz_marcadores[i] = new Array(this.NUM_SOLES_EJE);
			for (var j = this.NUM_SOLES_EJE - 1; j >= 0; j--) {
				this.matriz_multimarcadores[i][j] = 0;
				this.matriz_marcadores[i][j] = 0;
			};
		};
	}

	if(this.matriz_marcadores[x][y] == 0){
		this.matriz_marcadores[x][y] = new Array();
		this.matriz_marcadores[x][y][0] = [ temp, datos, 0];
	}else{
		this.matriz_marcadores[x][y][this.matriz_marcadores[x][y].length] = [ temp, datos, 0]; //objeto dom, datos del marcador, si no está ajustado, si está ajustado al sol o si al planeta (0, 1, 2)
		//Ahora hay que mirar si hay multimcarcadores. Para ello preguntamos en la matriz...
		if(this.matriz_multimarcadores[x][y] != 0){ //Es que ya hay un multimarcador en el sitio, por lo que solo ponemos el marcador en el sitio y lo ponemos con display: none
			temp.css("display","none");
		}else{ //Es el primer multimarcador de la zona, así que ponemos el resto de marcadores con display none y creamos el multimarcador
			this.matriz_multimarcadores[x][y] = 1;
			temp.css("display","none");
			var temp_multi = $('<div class="marcador_galaxia multimarcador"><p class="marcador_galaxia_titulo">Multimarcador</p></div>').css({left: porcent_x+"%", top: porcent_y+"%"});

			var datos_multimarcador = {x: datos.x, y: datos.y, tipo: "multi", 	nombre: "Multimarcador", i: this.padre_obj.vector_marcadores_superpuestos[1]};

			this.padre_obj.vector_marcadores_superpuestos[0][this.padre_obj.vector_marcadores_superpuestos[1]++] = [temp_multi, datos_multimarcador, 0];
			this.matriz_marcadores[x][y][this.matriz_marcadores[x][y].length] = [temp_multi, datos_multimarcador, 0];

			temp_multi.bind("click touchend",function () { //Ponemos el evento para llamar a la interfaz y así mostrar que es un multimarcador
				self.interfaz.marcador_seleccionado(datos_multimarcador);
			});
			this.padre_obj.univers_marcadores_select.append(temp_multi);
			if(this.estado_planetas[x][y] != 2) this.matriz_marcadores[x][y][0][0].css("display","none");
		}
	}

	this.ajustar_marcador_sol_nuevo(x, y);
	this.ajustar_marcador_planeta(x,y);
	return false;
};

univers_sector.prototype.quitar_marcador = function (x,y, orbita) {
	if(this.sector_vacio_oculto_relleno < 1) return false;

	for (var i = this.matriz_marcadores[x][y].length - 1; i >= 0; i--) {

		if(this.matriz_marcadores[x][y][i][1].orbita == orbita){
			this.matriz_marcadores[x][y][i][0].remove();
			this.matriz_marcadores[x][y].splice(i,1);
			break;
		}
	};
}

univers_sector.prototype.get_marcador_orbita = function (x, y, orbita) {
	var posicion;
	if(this.matriz_marcadores != 0 && this.matriz_marcadores[x][y] != 0)
		for(var i = this.matriz_marcadores[x][y].length - 1; i >= 0; i--){
			//console.log(this.matriz_marcadores[x][y][i][1]);
			if(this.matriz_marcadores[x][y][i][1].orbita == orbita) return i;
		}

	return -1;
}

univers_sector.prototype.ajustar_marcador_sol = function(x, y){
	if(this.matriz_marcadores != 0 && this.acceso_soles[x][y] != 0 && this.matriz_marcadores[x][y] != 0){
		if(this.matriz_marcadores[x][y].length == 1){
			if(this.matriz_marcadores[x][y][0][2] != 1){
				this.matriz_marcadores[x][y][0][0].css({left: 	(this.matriz_marcadores[x][y][0][1].x / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)  + ((this.rand_soles[x][y][0] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)) * 100 +"%" , 
														top: 	(this.matriz_marcadores[x][y][0][1].y / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y) + ((this.rand_soles[x][y][1] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y)) * 100 +"%" });
				this.matriz_marcadores[x][y][0][2] = 1;
			}
		}else{
			for (var i = this.matriz_marcadores[x][y].length - 1; i >= 0; i--) {
				if(this.matriz_marcadores[x][y][i][2] != 1){
					this.matriz_marcadores[x][y][i][0].css({left: 	(this.matriz_marcadores[x][y][i][1].x / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)  + ((this.rand_soles[x][y][0] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)) * 100 +"%" , 
															top: 	(this.matriz_marcadores[x][y][i][1].y / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y) + ((this.rand_soles[x][y][1] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y)) * 100 +"%" });
					this.matriz_marcadores[x][y][i][2] = 1;
				}
				if(this.matriz_marcadores[x][y][i][1].tipo == "multi"){
					this.matriz_marcadores[x][y][i][0].css("display","block");
				}else{
					this.matriz_marcadores[x][y][i][0].css("display","none");
				}

			};
		}
	}
	return false;
};

univers_sector.prototype.ajustar_marcador_sol_nuevo = function(x, y){
	if(this.matriz_marcadores != 0 && this.acceso_soles[x][y] != 0 && this.matriz_marcadores[x][y] != 0){
		for (var i = this.matriz_marcadores[x][y].length - 1; i >= 0; i--) {
			if(this.matriz_marcadores[x][y][i][2] == 0){
				this.matriz_marcadores[x][y][i][0].css({left: 	(this.matriz_marcadores[x][y][i][1].x / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)  + ((this.rand_soles[x][y][0] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x)) * 100 +"%" , 
														top: 	(this.matriz_marcadores[x][y][i][1].y / (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y) + ((this.rand_soles[x][y][1] + 30)/100)/(this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y)) * 100 +"%" });
				this.matriz_marcadores[x][y][i][2] = 1;
			}
			//this.matriz_marcadores[x][y][i][0].css("display","block");
		};
	}
	return false;
};

univers_sector.prototype.ajustar_marcador_planeta = function(x, y){
	if(this.soles_cargados == false && this.carga_iniciada == true){ //Esto es que estamos haciendo la petición ajax, por tanto tenemos que poner la petición en cola. Osea, los soles no estan cargados, pero la carga está iniciada 
		this.vector_marcador_a_ajustar_planeta[this.marcador_a_ajustar_planeta++] = [x, y];
	}else if(this.matriz_marcadores != 0 && this.acceso_soles[x][y] != 0 && this.matriz_marcadores[x][y] != 0 && this.estado_planetas[x][y] == 2){
		var planeta_x, planeta_y, sol_x, sol_y, global_x, global_y, orbita;
		var num_soles_x = (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_x);
		var num_soles_y = (this.NUM_SOLES_EJE * this.padre_obj.datos.sectores_y);
		if(this.matriz_marcadores[x][y].length == 1){
			if(this.matriz_marcadores[x][y][0][1].tipo == "planeta" && this.matriz_marcadores[x][y][0][2] != 2){
				orbita = this.matriz_marcadores[x][y][0][1].orbita;

				planeta_x = parseFloat(this.planetas_cir[x][y][orbita][0]) / num_soles_x * 0.6;
				planeta_y = parseFloat(this.planetas_cir[x][y][orbita][1]) / num_soles_y * 0.6;

				sol_x = this.rand_soles[x][y][0] / num_soles_x;
				sol_y = this.rand_soles[x][y][1] / num_soles_y;

				global_x = this.matriz_marcadores[x][y][0][1].x / num_soles_x*100;
				global_y = this.matriz_marcadores[x][y][0][1].y / num_soles_y*100;
				//console.log(global_x +" "+ sol_x +" "+ planeta_x +" "+ x +" "+ global_y +" "+ sol_y +" "+ planeta_y +" "+ y +" "+ this.planetas_cir[orbita][0] +" "+ this.planetas_cir[orbita][1] +" "+ orbita ); console.log(this);
				this.matriz_marcadores[x][y][0][0].animate({left: global_x + sol_x + planeta_x + this.ajuste_marcador_planeta_x + "%" , 
														top:  global_y + sol_y + planeta_y + this.ajuste_marcador_planeta_y + "%" },{duration: 400, queue: false});
				this.matriz_marcadores[x][y][0][2] = 2;
			}
		}else{
			for (var i = this.matriz_marcadores[x][y].length - 1; i >= 0; i--) {
				if(this.matriz_marcadores[x][y][i][1].tipo == "planeta" && this.matriz_marcadores[x][y][i][2] != 2){
					orbita = this.matriz_marcadores[x][y][i][1].orbita;

					planeta_x = parseFloat(this.planetas_cir[x][y][orbita][0]) / num_soles_x * 0.6;
					planeta_y = parseFloat(this.planetas_cir[x][y][orbita][1]) / num_soles_y * 0.6;

					sol_x = this.rand_soles[x][y][0] / num_soles_x;
					sol_y = this.rand_soles[x][y][1] / num_soles_y;

					global_x = this.matriz_marcadores[x][y][i][1].x / num_soles_x*100;
					global_y = this.matriz_marcadores[x][y][i][1].y / num_soles_y*100;
					//console.log(global_x +" "+ sol_x +" "+ planeta_x +" "+ x +" "+ global_y +" "+ sol_y +" "+ planeta_y +" "+ y +" "+ this.planetas_cir[orbita][0] +" "+ this.planetas_cir[orbita][1] +" "+ orbita ); console.log(this);
					this.matriz_marcadores[x][y][i][0].css("display","block").animate({left: global_x + sol_x + planeta_x + this.ajuste_marcador_planeta_x + "%" , 
															top:  global_y + sol_y + planeta_y + this.ajuste_marcador_planeta_y + "%" },{duration: 400, queue: false});
					this.matriz_marcadores[x][y][i][2] = 2;
				}
				if(this.matriz_marcadores[x][y][i][1].tipo == "sol"){
					this.matriz_marcadores[x][y][i][0].css("display","block");
				}else if(this.matriz_marcadores[x][y][i][1].tipo == "multi"){
					this.matriz_marcadores[x][y][i][0].css("display","none");
				}
			};
		}
	}else if(this.estado_planetas[x][y] != 2){
		this.ajustar_marcador_sol(x,y);
	}
	return false;
};

univers_sector.prototype.marcar_sector = function(x, y) {
	if(this.sector_vacio_oculto_relleno < 1) return false;
	this.sector.css("outline","#fff");
};
