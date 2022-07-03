var es_IE = 0;
var selector_deslizante_activo = 0;
var clase_selector_deslizante = "";
var recal = 1;
var menu_planetas_mostrado = 0;
var version_IE;
var IE_tonto = 0;
var cuadro_busqueda_usulianza = 0;
var planeta_activo_sistema ="";
var widget_cinema = 0;
var c4d_ratonY = 0;
var valortemp_input = 0;
var jqueryelementotmp;
var cuadro_seleccionado;
var esta_cuadro_seleccionado = 0;
var fila_seleccioanda = 10;
var sector_de_seleccion = "";
var zona_de_seleccion = "";
var volumen_naves_tem = 0;
var multiplicador_volumen = 1;
var volumen_naves_actual = 0;
var volumen_naves_tem = 0;
var equitativa = 1;
var cantidad_naves_temp3;
var naves_infome_global;


cantidad_naves_temp_temp = new Array();
cantidad_naves_temp_temp[0] = 0; 
cantidad_naves_temp_temp[1] = 0; 
cantidad_naves_temp_temp[2] = 0; 
cantidad_naves_temp_temp[3] = 0; 
cantidad_naves_temp_temp[4] = 0; 
cantidad_naves_temp_temp[5] = 0; 
cantidad_naves_temp_temp[6] = 0; 
cantidad_naves_temp_temp[7] = 0; 
cantidad_naves_temp_temp[8] = 0; 
cantidad_naves_temp_temp[9] = 0; 
cantidad_naves_temp_temp[10] = 0; 
cantidad_naves_temp_temp[11] = 0; 
cantidad_naves_temp_temp[12] = 0; 
cantidad_naves_temp_temp[13] = 0; 
cantidad_naves_temp_temp[14] = 0; 

cantidad_naves_temp = new Array();
cantidad_naves_temp[0] = 0; 
cantidad_naves_temp[1] = 0; 
cantidad_naves_temp[2] = 0; 
cantidad_naves_temp[3] = 0; 
cantidad_naves_temp[4] = 0; 
cantidad_naves_temp[5] = 0; 
cantidad_naves_temp[6] = 0; 
cantidad_naves_temp[7] = 0; 
cantidad_naves_temp[8] = 0; 
cantidad_naves_temp[9] = 0; 
cantidad_naves_temp[10] = 0; 
cantidad_naves_temp[11] = 0; 
cantidad_naves_temp[12] = 0; 
cantidad_naves_temp[13] = 0; 
cantidad_naves_temp[14] = 0; 


document.onmouseup = function(){
	if(selector_deslizante_activo == 1 || widget_cinema == 1){
		cancelar_deslizante()
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
	}
	recal = 1;
}

function cancelar_deslizante(){
	selector_deslizante_activo = 0;
	clase_selector_deslizante = "";
	widget_cinema = 0;
	valortemp_input = 0;
}

document.onmousemove = function(e) {
	if(selector_deslizante_activo == 1){
		dragX=$("#"+clase_selector_deslizante).offset().left;
		dragrelX=$("#"+clase_selector_deslizante+" .selector_boton").offset().left;
		if(es_IE == 1){		
			ratonX = event.clientX + document.documentElement.scrollLeft;
		}else{
			ratonX = e.pageX;
		}
		if(recal==1){
			raton_relX=ratonX-dragrelX;
			recal = 0;
		}
		
		porcentagearmas = ((ratonX-raton_relX-16-dragX)/639*100).toFixed();
		
		if(ratonX - raton_relX <= dragX+16 ){
			$("#"+clase_selector_deslizante+" .selector_boton").css("left","0");
			$("#"+clase_selector_deslizante+" .selector_barra_roja").css("width","0");
			$("#"+clase_selector_deslizante+" .selector_armas").html("Armas: 0%");
			$("#"+clase_selector_deslizante+" .selector_escudos").html("Escudo: 100%");
		}else if(ratonX-raton_relX+$("#"+clase_selector_deslizante+" .selector_boton").width() >= (dragX+16+$("#"+clase_selector_deslizante+" .selector_contenedor_barra_boton").width())){
			$("#"+clase_selector_deslizante+" .selector_boton").css("left",$("#"+clase_selector_deslizante+" .selector_contenedor_barra_boton").width()-$("#"+clase_selector_deslizante+" .selector_boton").width());
			$("#"+clase_selector_deslizante+" .selector_barra_roja").css("width",$("#"+clase_selector_deslizante+" .selector_contenedor_barra_boton").width());
			$("#"+clase_selector_deslizante+" .selector_armas").html("Armas: 100%");
			$("#"+clase_selector_deslizante+" .selector_escudos").html("Escudo: 0%");
		}else{
			$("#"+clase_selector_deslizante+" .selector_boton").css("left",(ratonX-raton_relX-16-dragX)+"px");
			$("#"+clase_selector_deslizante+" .selector_barra_roja").css("width",(ratonX-raton_relX-dragX+4)+"px");
			$("#"+clase_selector_deslizante+" .selector_armas").html("Armas: "+porcentagearmas+"%");
			$("#"+clase_selector_deslizante+" .selector_escudos").html("Escudo: "+(100-porcentagearmas)+"%");
		}
	}else if(widget_cinema == 1){

		if(es_IE == 1){		
			ratonY = event.clientY + document.documentElement.scrollTop;
		}else{
			ratonY = e.pageY;
		}
		
		if(recal==1){
			c4d_ratonY=ratonY;
			recal = 0;
		}
		
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
		//alert(jqueryelementotmp);
		temp = jqueryelementotmp.parent().html().search(" ");
		temp2 = jqueryelementotmp.parent().html().substring(0, temp);
		
		volumen_naves_actual = (volumen_naves_tem + (multiplicador_volumen * ((c4d_ratonY-ratonY)*10 +valortemp_input)));
		desplazamiento_actual = (c4d_ratonY-ratonY)*10 +valortemp_input;
		
		
		if(desplazamiento_actual > parseInt(temp2)){
			jqueryelementotmp.val(parseInt(temp2));
			volumen_naves_actual = parseInt(temp2) * multiplicador_volumen + volumen_naves_tem;
		}else if(desplazamiento_actual < 0 ) {
			volumen_naves_actual = volumen_naves_tem;
			jqueryelementotmp.val("0");		
		}else{
			jqueryelementotmp.val(desplazamiento_actual);
		}

		if($("#conf_batalla_vista_menu_naves_actuales > a").length != 0)
		$("#conf_batalla_vista_menu_naves_actuales > a").html("Volumen usado: "+volumen_naves_actual);
		else $("#conf_batalla_vista_menu_naves_actuales").html('<a style="height: 15px; background: #ffa800; width: 100%; display:block; float:left; margin: 10px 0; text-align:center; border-radius: 5px;" class="clear;">Volumen usado: '+volumen_naves_actual+$("#conf_batalla_vista_menu_naves_actuales").html());
		//alert(volumen_naves_tem +"/" +"/"+multiplicador_volumen +"/"+c4d_ratonY+"/"+ratonY+"/"+10 +"/"+valortemp_input+"/"+VOLUMEN_MAX_CUADRO);
	}
}

document.onmousedown=function(e){
	evt2 = e || window.event; //Obtenemos el objeto event
	var elemento = evt2.target || evt2.srcElement; //Obtenemos el elemento que se le dio el click
	//var id_evento = elemento.id; // se obtiene el id
	es_el_padre = 1;
	class_evento=$(elemento).attr("class");
	id_evento=$(elemento).attr("id");
	elemento_prim = elemento;
	elemento_temp = $(elemento);
	
	if(id_evento=="" && elemento.tagName != "BODY"){

		es_el_padre = 0;
		for(i=0;i<5 && id_evento == ""  && elemento_temp.tagName != "BODY";i++){
			elemento_temp = elemento_temp.parent();
			id_evento=elemento_temp.attr("id");
		}
	}
	//alert(id_evento);
	//alert(class_evento);
	/*Lista planetas*/
	if(id_evento=="flecha_menu_planetas"){
		mostrar_menu_planetas($("#"+id_evento));
		menu_planetas_mostrado = 1;
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
	}else if(menu_planetas_mostrado == 1){
		$("#lista_planetas_lista").slideUp(50);
		$("#flecha_menu_planetas_active").attr("id","flecha_menu_planetas");
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
		menu_planetas_mostrado = 0;
	}
	/*Barras de %*/
	if($(elemento_prim).hasClass("selector_boton")){
		clase_selector_deslizante=$(elemento).parent().parent().attr("id");
		selector_deslizante_activo=1;
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
	}else{
		cancelar_deslizante();
	}
	/*Damos soporte para mover la barra a cualquier posicion haciendo un click*/
	if($(elemento_prim).parent().hasClass("selector_contenedor_barra_boton")){
		clase_selector_deslizante=$(elemento).parent().parent().attr("id");
		selector_deslizante_activo=1;
		
		dragX=$(elemento).parent().offset().left;
		if(es_IE == 1){		
			ratonX = event.clientX + document.documentElement.scrollLeft;
		}else{
			ratonX = e.pageX;
		}
		posXrel = ratonX - dragX;
		porcentagearmas = ((ratonX-dragX-20)/639*100).toFixed();
		if(posXrel < 20){
			$(elemento).parent().children(".selector_boton").css("left","0");
			$(elemento).parent().children(".selector_barra_roja").css("width","0");
			$(elemento).parent().parent().children(".selector_armas").html("Armas: 0%");
			$(elemento).parent().parent().children(".selector_escudos").html("Escudo: 100%");
		}else if(posXrel > 659){
			$(elemento).parent().children(".selector_boton").css("left","639px");
			$(elemento).parent().children(".selector_barra_roja").css("width","639px");
			$(elemento).parent().parent().children(".selector_armas").html("Armas: 100%");
			$(elemento).parent().parent().children(".selector_escudos").html("Escudo: 0%");
		}else{
			$(elemento).parent().children(".selector_boton").css("left",(posXrel-20)+"px");
			$(elemento).parent().children(".selector_barra_roja").css("width",posXrel+"px");
			$(elemento).parent().parent().children(".selector_armas").html("Armas: "+porcentagearmas+"%");
			$(elemento).parent().parent().children(".selector_escudos").html("Escudo: "+(100-porcentagearmas)+"%");
		}
	}
	
	/*Cuadros de ayuda de selectores flotantes (solo funcionan en ie8 y superior)*/
	if((es_IE == 0) || IE_tonto == 0){
		
		if(id_evento=="escribir_mensaje_buscar_usuario"){
			if(cuadro_busqueda_usulianza == 0){
				$(".selctor_cuadro_flotante").css("display","none");
				$("#"+id_evento+" .selctor_cuadro_flotante").css("display","block");
				cuadro_busqueda_usulianza = 1;
			}else if(class_evento=="selctor_cuadro_flotante_flechita"){
				$(".selctor_cuadro_flotante").css("display","none");
				cuadro_busqueda_usulianza = 0;
			}		
		}else{
			if($(elemento_prim).hasClass("selctor_boton_cuadro_flotante")){
				$(".selctor_cuadro_flotante").css("display","none");
				$("#"+id_evento+" .selctor_cuadro_flotante").css("display","block");
			}else{
				$(".selctor_cuadro_flotante").css("display","none");
			}
			cuadro_busqueda_usulianza = 0;
		}

	}
	/*Si seleccionamos un planeta de la pantalla de sistema*/
	if(class_evento=="planeta_pequeno planeta_pequeno_azul" || class_evento=="planeta_pequeno planeta_pequeno_rojo"){
		if(planeta_activo_sistema != id_evento){
			if(planeta_activo_sistema != "")	$("#"+planeta_activo_sistema).attr("id",planeta_activo_sistema.replace(/_active/,""));
			$("#"+id_evento).attr("id",id_evento+"_active");
			planeta_activo_sistema = id_evento+"_active";
			$(".sistema_vista_menu_planeta").attr("id","sistema_vista_menu_planeta"+id_evento.replace(/planeta/,""));
			if(parseInt(id_evento.replace(/planeta/,"")) <= 5){ 
				$(".sistema_vista_menu_texto:eq(1) span").html("Caliente");
				$(".sistema_vista_menu_texto:eq(1) span").css("color","#ff4b4b")
			}else if(parseInt(id_evento.replace(/planeta/,"")) <= 10){ 
				$(".sistema_vista_menu_texto:eq(1) span").html("Templado");
				$(".sistema_vista_menu_texto:eq(1) span").css("color","#5dff47")				
			}else  {
				$(".sistema_vista_menu_texto:eq(1) span").html("Frio");
				$(".sistema_vista_menu_texto:eq(1) span").css("color","#00bbff")
			}
			
			if($("#"+id_evento+"_active p").attr("class") == "enemigo"){
				$(".sistema_vista_menu_texto:eq(0) span").html("Enemigo");
				$(".sistema_vista_menu_texto:eq(0) span").css("color","#ff4b4b");
			}else if($("#"+id_evento+"_active p").attr("class") == "aliado"){
				$(".sistema_vista_menu_texto:eq(0) span").html("Aliado");
				$(".sistema_vista_menu_texto:eq(0) span").css("color","#00bbff");
			}else if($("#"+id_evento+"_active p").attr("class") == "propio"){
				$(".sistema_vista_menu_texto:eq(0) span").html("Planeta propio");
				$(".sistema_vista_menu_texto:eq(0) span").css("color","#5dff47");
			}else{
				if($("#"+id_evento+"_active").html() == ""){
					$(".sistema_vista_menu_texto:eq(0) span").html("Sin propietario");
					$(".sistema_vista_menu_texto:eq(0) span").css("color","#fff");
				}else{
					$(".sistema_vista_menu_texto:eq(0) span").html("Neutral");
					$(".sistema_vista_menu_texto:eq(0) span").css("color","#fff");
				}
			}
			
		}
	}
	/*Sector*/

	if($(elemento_prim).hasClass("sol_sector")){
		
		tmp = $(".sol_sector").length;

		for(i=0; i<tmp; i++){
			tmp2 = $(".sol_sector:eq("+i+")").attr("class");
			$(".sol_sector:eq("+i+")").attr("class", tmp2.replace(/_active/,""));
		}
		
		$(elemento_prim).attr("class",$(elemento_prim).attr("class")+"_active");
	}
	
	if($(elemento_prim).hasClass("cuadro_galaxia")){
		
		sector_seleccionado = $(elemento_prim).attr("class").replace(/cuadro_galaxia */,"")
		if(sector_seleccionado != ""){
			$("#selector_sector").remove();	
			$(elemento_prim).html('<div  id="selector_sector"></div>');
			//$(elemento_prim).css("background","#fff") /*Si pones esta linea puedes juagar a rellenar todos los cuadros en blanco, pero es imposible (hay qu ehacerlo siepre como si caminases sin pasar por tus poropios pasos)*/
			/*Hacer llamada ajax*/
		}
		/*Se pueden hacer efectos guays con animate y sacando el cursor de dentro del div del sector*//*para la beta*/
	}
	
	/*Widget estilo cinema 4d del campo de batalla*/
	if($(elemento_prim).hasClass("widget_cinema")){
		widget_cinema = 1
		if(es_IE==1) {
			document.selection.empty();
		}else {// Firefox, Google Chrome, Safari, Opera
			var myRange = window.getSelection ();                                        
			myRange.removeAllRanges ();
		}
		
		jqueryelementotmp = $(elemento_prim).parent().find("input:eq(0)");
		valortemp_input = parseInt($(elemento_prim).parent().find("input:eq(0)").val());
		if(isNaN(valortemp_input)) valortemp_input = 0;
		
		jqueryelementotmp.val("ijk");
		
		for(i=0; i<15; i++) if($("#conf_batalla_vista_menu_naves_nuevas").children().eq(i).find("input:eq(0)").val() == "ijk") var_temp_3 = i;
		
		jqueryelementotmp.val(valortemp_input);
		
		multiplicador_volumen = volumen_naves[var_temp_3];
		if($("#conf_batalla_vista_menu_naves_actuales > a").html()) volumen_naves_tem =  parseInt($("#conf_batalla_vista_menu_naves_actuales > a").html().replace(/Volumen usado: /,"")) - (valortemp_input * multiplicador_volumen);
		else volumen_naves_tem = 0;
		
		//alert($(elemento_prim).parent().find("input:eq(0)").val());
	}
	/*Selecciona un cuadro*/
	if($(elemento_prim).attr("class").search("conf_batalla_vista_campo_cuadro") != -1 && $(elemento_prim).attr("class").search("_selec_") == -1 && $(elemento_prim).attr("class").search("_vacio") == -1 ){
		
		/*Muestra el dibujito que toca en el cuadro anterior al cambiar de cuadro*/
		if(fila_seleccioanda == 10)
		clase_correspondiente_cuadro();
		
		esta_cuadro_seleccionado = 1;
		
		
		/*Reseteo correspondiente del vector de naves seleccionado del cuadro anterior para que no afecte al nuevo*/
		for(i=0;i<15;i++){
			cantidad_naves_temp[i] = 0;
			cantidad_naves_temp_temp[i] = 0;
		}
		
		$(".conf_batalla_vista_campo_cuadro_selec_3").attr("class","conf_batalla_vista_campo_cuadro_selec_1");
		$(".conf_batalla_vista_campo_cuadro_selec_4").attr("class","conf_batalla_vista_campo_cuadro_selec_2");	

		/*Hay que ocultar el boton de anadir naves*/
		$("#conf_batalla_vista_menu_naves_anadir_naves").animate({top: "153", height: "0"});
		
		/*sacamos la fila y columna del cuadro*/
		corde_x = ($(elemento_prim).position().left)/49;
		corde_y = ($(elemento_prim).position().top)/49;
		
				
		/*por si la ventana de anadir naves esta desplegada*/
		este2 = $("#conf_batalla_vista_menu_naves_mas_active")
		$("#conf_batalla_vista_menu_naves_nuevas").html("");
		este2.attr('id','conf_batalla_vista_menu_naves_mas'); 
		$("#seleccion_sistema_repartir_naves").remove();
		este2.parent().animate({width:235});	
		
		/*seleccionamos el cuadro*/
		//$(".conf_batalla_vista_campo_cuadro_active").attr("class","conf_batalla_vista_campo_cuadro");
		//$(elemento_prim).attr("class","conf_batalla_vista_campo_cuadro_active");
		
		/*fila_seleccianda = 10 es que no se ha seleccionado ninguna fila*/
		fila_seleccioanda = 10;
		
		/*Marcamos en que flanco / centro esta el cuadro*/
		sector_de_seleccion = $(elemento_prim).parent().attr("id");
		zona_de_seleccion = $(elemento_prim).parent().parent().attr("id");
		
		$("#cuadro_de_seleccion_de_cuadros").css({width:49,height:49,backgroundPosition:"-245px -98px"});
		
		if(zona_de_seleccion.search("act")!=-1){		
			$("#cuadro_de_seleccion_de_cuadros").css({left:($(elemento_prim).position().left) + ($(elemento_prim).parent().position().left)});
			$("#cuadro_de_seleccion_de_cuadros").css({top:($(elemento_prim).position().top) + ($(elemento_prim).parent().position().top)});
		}else{
			$("#cuadro_de_seleccion_de_cuadros").css({left:($(elemento_prim).position().left) + ($(elemento_prim).parent().position().left) + ($(elemento_prim).parent().parent().position().left)});
			$("#cuadro_de_seleccion_de_cuadros").css({top:($(elemento_prim).position().top) + ($(elemento_prim).parent().position().top) + ($(elemento_prim).parent().parent().position().top)});
		}
		
		if(sector_de_seleccion.search("conf_batalla_vista_campo_def_fl_iz") != -1) $("#conf_batalla_vista_menu_naves_titulo").html("Flanco izquierdo<br/>Cuadro: "+corde_x+" , "+corde_y);
		else if(sector_de_seleccion.search("conf_batalla_vista_campo_def_fl_de") != -1) $("#conf_batalla_vista_menu_naves_titulo").html("Flanco derecho<br/>Cuadro: "+corde_x+" , "+corde_y);
		else $("#conf_batalla_vista_menu_naves_titulo").html("Zona central<br/>Cuadro: "+corde_x+" , "+corde_y);
		
		/*Borramos el cuadro izquierdo con las naves del cuadro / fila seleccionado anterior*/
		$("#conf_batalla_vista_menu_naves_actuales").html("");
		
		/*examinamos y parseamos el cuadro seleccionado, tambien comprobamos si el cuadro tiene naves que parsear*/
		if($(elemento_prim).children("p").length){
			cantidad_de_naves_temp = $(elemento_prim).children("p").html().split(" ");
			
			for(i=0; i<15; i++){
				cantidad_naves_temp[i] = parseInt(cantidad_de_naves_temp[i]);
			}
			
			actualizar_conf_batalla_vista_menu_naves_actuales();
			
		}else {
			for(i=0;i<15;i++){
				cantidad_naves_temp[i] = 0;
				cantidad_naves_temp_temp[i] = 0;
			}
		}
		
		cuadro_seleccionado = $(elemento_prim);
		
	}	
	
	return true; //No se cancela la acción del href.
}

/*%%%%%%%%%%%%%%%%%%%%%%%*/
/*FUNCIONES NORMALES, DE EJECUCION SIMPLE*/
/*%%%%%%%%%%%%%%%%%%%%%%%*/

function informe_poner_datos_cuadro(elemento_prim){

	aux = new Array();

	aux = $(elemento_prim).children("p:first").html().split(" ");
	
	if(aux.length < 10) for(i=0;i>15;i++) aux[i] = "0";
	
	aux2 = new Array();
	
	for(i=0;i<15;i++) aux2[i] = parseInt(aux[i]);
	//alert(parseInt(aux[1]) + " " +aux2[1]);
	
	naves_infome_global = new Array();
	
	for(i=0;i<9;i++) naves_infome_global[i] =  $("#informe_vista_menu p:eq("+i+")").html()
	
	if($(elemento_prim).parent().parent().attr("id") == "informe_vista_campo_def"){
	
		for(i=0;i<9;i++){ 
			$("#informe_vista_menu p:eq("+i+")").html(aux2[i]);
		}
	
	
	}		
	
	if($(elemento_prim).parent().parent().attr("id") == "informe_vista_campo_atc"){
	
		for(i=0;i<9;i++){ 
			$("#informe_vista_menu p:eq("+(i+9)+")").html(aux2[i]);
		}
	
	
	}
}

function informe_quitar_datos_cuadro(elemento_prim){
	for(i=0;i<9;i++){ 
		$("#informe_vista_menu p:eq("+i+")").html(naves_infome_global[i]);
	}
}

function flip_flop_id(var1, clase1, clase2){ // Var 2 y 3 son texto, var 1 es un objeto jquery.
	//Esta funcion mira si en el objeto jquery que se le pasa por var1 tiene algun class clase1 y si es asi la sustituya por la clase clase2, lo mismo a la inversa.
	if(var1.attr("id") == clase1){
		var1.attr("id",clase2);
	}else if(var1.attr("id") == clase2){
		var1.attr("id",clase1);
	}		
}

function flip_flop_class(var1, clase1, clase2){ // Var 2 y 3 son texto, var 1 es un objeto jquery.
	//Esta funcion mira si en el objeto jquery que se le pasa por var1 tiene algun class clase1 y si es asi la sustituya por la clase clase2, lo mismo a la inversa.
	if(var1.hasClass(clase1) == true){
		var1.removeClass(clase1);
		var1.addClass(clase2);
	}else if(var1.hasClass(clase2) == true){
		var1.removeClass(clase2);
		var1.addClass(clase1);
	}		
}

function mostrar_menu_planetas(var1){ //Desplega el menu de los planetas y hace que el boton se quede encendid
	$("#lista_planetas_lista").slideDown(50);
	flip_flop_id(var1,"flecha_menu_planetas","flecha_menu_planetas_active");
	if(es_IE==1) {
		document.selection.empty();
	}else {// Firefox, Google Chrome, Safari, Opera
		var myRange = window.getSelection ();                                        
		myRange.removeAllRanges ();
	}
}

function abrir_mensaje(variable){
	variable.parent().children('.mensaje_cuerpo').slideToggle(200);
	if(variable.hasClass("mensaje_titulo_nuevo")){
		variable.removeClass("mensaje_titulo_nuevo");
		variable.addClass("mensaje_titulo");
		/*ENVIAR A SERVIDOR CON XAJAX QUE EL MENSAJE SE HA LEIDO*/
	}
}

function usuario_alianza(var1){
	if(var1 == "usuario"){
		$("#escribir_mensaje_selector_alianza_active").attr("id","escribir_mensaje_selector_alianza");
		$("#escribir_mensaje_selector_usuario").attr("id","escribir_mensaje_selector_usuario_active");
		$("#usu-alianza-form").attr("value","usuario");
	}else if(var1 == "alianza"){
		$("#escribir_mensaje_selector_usuario_active").attr("id","escribir_mensaje_selector_usuario");
		$("#escribir_mensaje_selector_alianza").attr("id","escribir_mensaje_selector_alianza_active");
		$("#usu-alianza-form").attr("value","alianza");
	}
}

function confi_naves_batalla(este){
	
	/*Hay que comprobar si se ha seleccionado un cuadro del campo de batalla antes de hacer esto*/
	if(esta_cuadro_seleccionado == 1){
		if(este.parent().css("width")=="235px"){
			este.parent().animate({width:450}, 400, function() {
				$("#conf_batalla_vista_menu_naves_nuevas").html("");
				for(i=0;i<cantidad_naves.length;i++){
					if(cantidad_naves[i] > 0){	
						$("#conf_batalla_vista_menu_naves_nuevas").append('<div class="clear"><p>'+(cantidad_naves[i])+'<br/>'+nombres_naves[i]+' <input type="text" value="0" onblur="if(this.value==\'\' || parseInt($(this).parent().html()) < parseInt(this.value)) this.value=\'0\';" onfocus="if(this.value==\'0\') this.value=\'\';"></input></p><div class="widget_cinema"></div><div class="clear"></div></div>');
					} else {
						$("#conf_batalla_vista_menu_naves_nuevas").append('<div class="clear" style="display:none;"><p> <input type="text" value="0"></input></p></div>');
					}
				}
				if(fila_seleccioanda != 10) $("#conf_batalla_vista_menu_naves").append('<form action="" id="seleccion_sistema_repartir_naves"><input id="seleccion_sistema_repartir_naves_equitativo" type="radio" name="accion" value="equitativo" checked="true"><p onclick="$(\'#seleccion_sistema_repartir_naves_equitativo\').attr(\'checked\', true); equitativa=1;">Equitativo</p>'+'<input id="seleccion_sistema_repartir_naves_compacto" type="radio" name="accion" value="compacto"><p onclick="$(\'#seleccion_sistema_repartir_naves_compacto\').attr(\'checked\', true);  equitativa=0;">Compacto</p></form>');

				
				$("#conf_batalla_vista_menu_naves_nuevas > div :eq(0)input").focus();
				este.attr('id','conf_batalla_vista_menu_naves_mas_active'); 		
			});			
		}else{
			tmp = new Array();
			
			for(i=0;i<15;i++){ 
				if(cantidad_naves[i] > 0){ 
					tmp[i] = parseInt($("#conf_batalla_vista_menu_naves_nuevas > div :eq("+i+")input").val());
					if(parseInt($("#conf_batalla_vista_menu_naves_nuevas > div :eq("+i+")input").val()) > 0){
						cantidad_naves_temp_temp[i] += tmp[i];
						cantidad_naves[i] -= tmp[i];
					}
				}
			}

			if(fila_seleccioanda == 10)	actualizar_conf_batalla_vista_menu_naves_actuales();
			else actualizar_conf_batalla_vista_menu_naves_actuales_fila();
			
			$("#conf_batalla_vista_menu_naves_nuevas").html("");
			este.attr('id','conf_batalla_vista_menu_naves_mas'); 

			
			$("#seleccion_sistema_repartir_naves").remove();
			
			/*Reiniciamos las variables que se usan para calcular el volumen de naves en tiempo real*/
			volumen_naves_tem = 0;
			multiplicador_volumen = 1;
			volumen_naves_actual = 0;
			volumen_naves_tem = 0;
			/*Por ultimo, encojemos lateralmente el manu lateral*/
			este.parent().animate({width:235});
			
		}
	}
}

function actualizar_conf_batalla_vista_menu_naves_actuales(){
	$("#conf_batalla_vista_menu_naves_actuales").html("");
	
	var_temp_ = 1;
	vartemp2_ = 0;
		
	for(i=0;i<15;i++){
		vartemp2_ += (cantidad_naves_temp_temp[i] + cantidad_naves_temp[i]) * volumen_naves[i];
	}
	
	for(i=0;i<15;i++){	
		if((cantidad_naves_temp[i] > 0 || cantidad_naves_temp_temp[i] >0) && !(isNaN(cantidad_naves_temp[i]))){
			if(var_temp_ == 1)  $("#conf_batalla_vista_menu_naves_actuales").append('<a style="height: 15px; background: #ffa800; width: 100%; display:block; float:left; margin: 10px 0; text-align:center; border-radius: 5px;" class="clear;">Volumen usado: '+vartemp2_+'</a>');
			var_temp_ = 0;
			$("#conf_batalla_vista_menu_naves_actuales").append('<div class="clear"><p>'+(cantidad_naves_temp[i] + cantidad_naves_temp_temp[i]) +'  '+nombres_naves[i]+'</p><p style="cursor: pointer; color: #f11; float:right;" onclick="borrar_confi_naves('+i+', $(this));">X</p><div class="clear"></div></div>');
		}
	}
}

function actualizar_conf_batalla_vista_menu_naves_actuales_fila(){
	$("#conf_batalla_vista_menu_naves_actuales").html("");
	
	var_temp_ = 1;
	
	vartemp2_ = 0;
		
	for(i=0;i<15;i++){
		vartemp2_ += (cantidad_naves_temp_temp[i] + cantidad_naves_temp[i]) * volumen_naves[i];
	}
	
	for(i=0;i<15;i++){	
		if((cantidad_naves_temp[i] > 0 || cantidad_naves_temp_temp[i] >0) && !(isNaN(cantidad_naves_temp[i]))){
			if(var_temp_ == 1)  $("#conf_batalla_vista_menu_naves_actuales").append('<a style="height: 15px; background: #ffa800; width: 100%; display:block; float:left; margin: 10px 0; text-align:center; border-radius: 5px;" class="clear;">Volumen usado: '+vartemp2_+'</a>');
			var_temp_ = 0;
			$("#conf_batalla_vista_menu_naves_actuales").append('<div class="clear"><p>'+(cantidad_naves_temp[i] + cantidad_naves_temp_temp[i]) +'  '+nombres_naves[i]+'</p><p style="cursor: pointer; color: #f11; float:right;" onclick="borrar_confi_naves_fila('+i+', $(this));">X</p><div class="clear"></div></div>');
		}
	}
}

function borrar_confi_naves_fila(tipo, este){ /*NO BORRA SI NO SE HA RECARGADO EL CUADRO*/

	cantidad_naves_temp[tipo] = 0;
	cantidad_naves_temp_temp[tipo] = 0;

	este.parent().remove();

	/*Cuando borramos hay que actalizar la info de todos los cuadros de la fila asi como su icono*/
	/*Para ello tenemos que saber si estamos en un flanco o no*/
	if(sector_de_seleccion.search("conf_batalla_vista_campo_def_fl_") != -1){ /*Estamos en un flanco*/
		borra_tipo_cuadro(fila_seleccioanda, 0, tipo,3);
		borra_tipo_cuadro(fila_seleccioanda, 1, tipo,3);
		borra_tipo_cuadro(fila_seleccioanda, 2, tipo,3);
	}else {/*Estamos en el centro*/
		if(fila_seleccioanda <= 1){ /*Esta fila solo tiene 2 cuadros*/
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				borra_tipo_cuadro(fila_seleccioanda, 0, tipo,6);
				borra_tipo_cuadro(fila_seleccioanda, 1, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 2, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 3, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 4, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 5, tipo,6);
			}else{
				borra_tipo_cuadro(fila_seleccioanda, 3, tipo,6);
				borra_tipo_cuadro(fila_seleccioanda, 4, tipo,6);
			}
		}else if(fila_seleccioanda >= 5){/*Esta fila tiene 6 cuadros*/
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				borra_tipo_cuadro(fila_seleccioanda, 3, tipo,6);
				borra_tipo_cuadro(fila_seleccioanda, 4, tipo,6);
			}else{
				borra_tipo_cuadro(fila_seleccioanda, 0, tipo,6);
				borra_tipo_cuadro(fila_seleccioanda, 1, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 2, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 3, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 4, tipo,6);	
				borra_tipo_cuadro(fila_seleccioanda, 5, tipo,6);
			}				
		}else{ /*de la fila 2 a la 4 tienen 4 cuadros*/
			borra_tipo_cuadro(fila_seleccioanda, 1, tipo,6);	
			borra_tipo_cuadro(fila_seleccioanda, 2, tipo,6);	
			borra_tipo_cuadro(fila_seleccioanda, 3, tipo,6);	
			borra_tipo_cuadro(fila_seleccioanda, 4, tipo,6);
		}
	}
	
	actualizar_conf_batalla_vista_menu_naves_actuales_fila();
}

function borra_tipo_cuadro(fila, cuadro, tipo, tam_fila){ 
	tmp2 = new Array();
	aux = new Array();
	
	if($("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p").length > 0)
		tmp2 = $("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p").html().split(" ");
	else for(i=0;i<15;i++) tmp2[i] = "0";
	
	for(i=0; i<15; i++) aux[i] = parseInt(tmp2[i]);
	
	cantidad_naves[tipo] += aux[tipo];
	aux[tipo] = 0;
	
	guardar_informacion_de_cuadro(cuadro,tam_fila,aux);

	contador_temporal = 0;
	for(i=0;i<15;i++) if(aux[i] >= aux[contador_temporal] && aux[i] > 0) contador_temporal = i;
	if(contador_temporal > 0){
		cambiar_class_cuadro(fila_seleccioanda, cuadro, "conf_batalla_vista_campo_cuadro_nave"+(contador_temporal+1),tam_fila);
	}else{
		cambiar_class_cuadro(fila_seleccioanda, cuadro, "conf_batalla_vista_campo_cuadro",tam_fila);
	}
}

function borrar_confi_naves(pos, este){
	
	cantidad_naves[pos] += cantidad_naves_temp[pos];
	cantidad_naves_temp[pos] = 0;
	
	este.parent().remove();
	
	/*Cuando borramos hay que actalizar la info del cuadro y el icono*/
	
	guardar_info_naves();
	clase_correspondiente_cuadro();
	actualizar_conf_batalla_vista_menu_naves_actuales();
}

function seleccionar_fila_config_batalla(este,fila){
		
	/*Muestra el dibujito que toca en el cuadro anterior al cambiar de cuadro, tecnicamente sobra, pero no me atrevo a tocarlo*/
	clase_correspondiente_cuadro();
	
	esta_cuadro_seleccionado = 1; 
	fila_seleccioanda = fila;
	sector_de_seleccion = este.parent().attr("id");
	zona_de_seleccion = este.parent().parent().attr("id");

	if(sector_de_seleccion=="conf_batalla_vista_campo_def_fl_iz") $("#conf_batalla_vista_menu_naves_titulo").html("Flanco izquierdo<br/>Fila: "+fila_seleccioanda);
	else if(sector_de_seleccion=="conf_batalla_vista_campo_def_fl_de") $("#conf_batalla_vista_menu_naves_titulo").html("Flanco derecho<br/>Fila: "+fila_seleccioanda);
	else $("#conf_batalla_vista_menu_naves_titulo").html("Zona central<br/>Fila: "+fila_seleccioanda);
	
	
	$("#conf_batalla_vista_menu_naves_actuales").html("");
	
	/*Reseteo correspondiente del vector de naves seleccionado del cuadro anterior para que no afecte al nuevo*/
	for(i=0;i<15;i++){
		cantidad_naves_temp[i] = 0;
		cantidad_naves_temp_temp[i] = 0;
	}	
	$(".conf_batalla_vista_campo_cuadro_selec_3").attr("class","conf_batalla_vista_campo_cuadro_selec_1");
	$(".conf_batalla_vista_campo_cuadro_selec_4").attr("class","conf_batalla_vista_campo_cuadro_selec_2");

	/*Hay que poner el cuadro naraja alrrededor del la fila, para eso sacamos la posicion del absolute y despues, ya en cuando se hace un codigo dependiendo de la zona y la fila se ponen unos tamanos y unos background-position*/
	
	if(zona_de_seleccion.search("act")!=-1){		
		$("#cuadro_de_seleccion_de_cuadros").css({left:este.parent().position().left});
		$("#cuadro_de_seleccion_de_cuadros").css({top:(este.position().top) + (este.parent().position().top)});
	}else{
		$("#cuadro_de_seleccion_de_cuadros").css({left:este.parent().position().left});
		$("#cuadro_de_seleccion_de_cuadros").css({top:(este.position().top) + (este.parent().position().top) + (este.parent().parent().position().top)});
	}
	
	
	

	/*Hay que ocultar el boton de anadir naves*/
	$("#conf_batalla_vista_menu_naves_anadir_naves").animate({top: "153", height: "0"});

	/*Ilumina la flechita de selecciona de fila en el sentido que le toca*/
	if(este.attr("class") == "conf_batalla_vista_campo_cuadro_selec_1") este.attr("class","conf_batalla_vista_campo_cuadro_selec_3");
	else if(este.attr("class") == "conf_batalla_vista_campo_cuadro_selec_2") este.attr("class","conf_batalla_vista_campo_cuadro_selec_4");
	
	/*PARSEA LA INFORMACION DE LOS CUADROS DEPENDIENDO DE SI ESTAMOS EN FLANCO O EN CENTRO Y LA FILA*/
	if(este.parent().attr("id").search("conf_batalla_vista_campo_def_fl_") != -1){ /*estamos en un flanco*/
	
		cargar_informacion_de_cuadro(fila,0,0,3);
		cargar_informacion_de_cuadro(fila,1,1,3);
		cargar_informacion_de_cuadro(fila,2,1,3);
		$("#cuadro_de_seleccion_de_cuadros").css({width:147,height:49,backgroundPosition:"0 -49px"});
		
	}else{ //estamos en el centro
		if(fila_seleccioanda <= 1){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				cargar_informacion_de_cuadro(fila,0,0,6);
				cargar_informacion_de_cuadro(fila,1,1,6);
				cargar_informacion_de_cuadro(fila,2,1,6);
				cargar_informacion_de_cuadro(fila,3,1,6);
				cargar_informacion_de_cuadro(fila,4,1,6);
				cargar_informacion_de_cuadro(fila,5,1,6);
				$("#cuadro_de_seleccion_de_cuadros").css({width:294,height:49,backgroundPosition:"0 -147px"});
			}else{
				cargar_informacion_de_cuadro(fila,2,0,6);
				cargar_informacion_de_cuadro(fila,3,1,6);
				$("#cuadro_de_seleccion_de_cuadros").css({width:196,height:49,backgroundPosition:"0 0"});
			}			
		}else if(fila_seleccioanda >= 5){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				cargar_informacion_de_cuadro(fila,2,0,6);
				cargar_informacion_de_cuadro(fila,3,1,6);
				$("#cuadro_de_seleccion_de_cuadros").css({width:196,height:49,backgroundPosition:"0 0"});
			}else{
				cargar_informacion_de_cuadro(fila,0,0,6);
				cargar_informacion_de_cuadro(fila,1,1,6);
				cargar_informacion_de_cuadro(fila,2,1,6);
				cargar_informacion_de_cuadro(fila,3,1,6);
				cargar_informacion_de_cuadro(fila,4,1,6);
				cargar_informacion_de_cuadro(fila,5,1,6);
				$("#cuadro_de_seleccion_de_cuadros").css({width:294,height:49,backgroundPosition:"0 -147px"});
			}		
		}else{
			
			cargar_informacion_de_cuadro(fila,1,0,6);
			cargar_informacion_de_cuadro(fila,2,1,6);
			cargar_informacion_de_cuadro(fila,3,1,6);
			cargar_informacion_de_cuadro(fila,4,1,6);
			$("#cuadro_de_seleccion_de_cuadros").css({width:245,height:49,backgroundPosition:"0 -98px"});
			
		}
		
	}
	
	vartemp = 0;
	
	actualizar_conf_batalla_vista_menu_naves_actuales_fila();

}


function guardar_informacion_de_cuadro(cuadro, tam_fila, cantidad_naves_temp2){ /*Esta funcion solo se usa para filas*/

	//alert("Fila: "+fila_seleccioanda+"  |  Estoy guardando en :  #"+sector_de_seleccion+" > div:eq("+(((fila_seleccioanda-1)* tam_fila) +cuadro)+")");
	$("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+(((fila_seleccioanda-1)* tam_fila) +cuadro)+")").html("<p style='display:none;'>"+cantidad_naves_temp2[0]+" "+cantidad_naves_temp2[1]+" "+cantidad_naves_temp2[2]+" "+cantidad_naves_temp2[3]+" "+cantidad_naves_temp2[4]+" "+cantidad_naves_temp2[5]+" "+cantidad_naves_temp2[6]+" "+cantidad_naves_temp2[7]+" "+cantidad_naves_temp2[8]+" "+cantidad_naves_temp2[9]+" "+cantidad_naves_temp2[10]+" "+cantidad_naves_temp2[11]+" "+cantidad_naves_temp2[12]+" "+cantidad_naves_temp2[13]+" "+cantidad_naves_temp2[14]+"</p>");

}

function cargar_informacion_de_cuadro(fila, cuadro, sumar, tam_fila){

	if(sumar == 0){
		for(i=0; i<15; i++){
			cantidad_naves_temp[i] = 0;
			cantidad_naves_temp_temp[i] = 0;
		}
	}
	//alert("Estoy lellendo de :  #"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p");
	if($("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p").length != 0){

		cantidad_de_naves_temp = $("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p").html().split(" ");
		
		//alert($("#"+sector_de_seleccion+" > div:eq("+((fila-1)*tam_fila+cuadro)+") p").html());
		
		if (sumar == 0){	
			for(i=0; i<15; i++){
				cantidad_naves_temp[i] = parseInt(cantidad_de_naves_temp[i]);
			}
		}else{
			for(i=0; i<15; i++){
				cantidad_naves_temp[i] += parseInt(cantidad_de_naves_temp[i]);
			}
		}
	}	
}

function cambiar_class_cuadro(fila_seleccioanda, cuadro, clase, tam_cuadro){
	$("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+(((fila_seleccioanda-1)*tam_cuadro)+cuadro)+")").attr("class",clase);
}

function evaluar_anadir_naves_cuadro(tam_fila, cuadro, a_sumar){

	tmp2 = new Array();
	aux = new Array();
	
	if($("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila_seleccioanda-1)*tam_fila+cuadro)+") p").length > 0)
		tmp2 = $("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila_seleccioanda-1)*tam_fila+cuadro)+") p").html().split(" ");
	else for(i=0;i<15;i++) tmp2[i] = "0";
	
	//alert($("#"+zona_de_seleccion+" #"+sector_de_seleccion+" > div:eq("+((fila_seleccioanda-1)*tam_fila+cuadro)+") p").html());
	
	for(i=0; i<15; i++) aux[i] = parseInt(a_sumar[i])+parseInt(tmp2[i]);
	guardar_informacion_de_cuadro(cuadro,tam_fila,aux);

	contador_temporal = 0;
	//alert("HOLA-14: "+aux[13]+" | "+a_sumar[13] +" | "+parseInt(tmp2[13])+" |  HOLA-15: "+aux[14]+" | "+a_sumar[14] +" | "+parseInt(tmp2[14]));
	for(i=1;i<15;i++) if(aux[i] >= aux[contador_temporal] && aux[i] > 0) contador_temporal = i;
	if(contador_temporal > 0){
		cambiar_class_cuadro(fila_seleccioanda, cuadro, "conf_batalla_vista_campo_cuadro_nave"+(contador_temporal+1),tam_fila);
	}else if(contador_temporal == 0 && aux[0] > 0){
		cambiar_class_cuadro(fila_seleccioanda, cuadro, "conf_batalla_vista_campo_cuadro_nave1",tam_fila);
	}else{
		cambiar_class_cuadro(fila_seleccioanda, cuadro, "conf_batalla_vista_campo_cuadro",tam_fila);
	}

}


function guardar_flanco(){

	cantidad_naves_temp2 = new Array();
	tmp2 = new Array();
	aux = new Array();
	
	for(i=0;i<15;i++){ cantidad_naves_temp2[i] = Math.floor(cantidad_naves_temp_temp[i]/3);/* if(cantidad_naves_temp_temp[i] != 0){ alert(cantidad_naves_temp_temp[i]/3 +" | " +(cantidad_naves_temp_temp[i]/3).toFixed()); alert(cantidad_naves_temp2[i]);}*/}

	evaluar_anadir_naves_cuadro(3,0,cantidad_naves_temp2);
	evaluar_anadir_naves_cuadro(3,1,cantidad_naves_temp2);	

	for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - (2* cantidad_naves_temp2[i]);	
	
	evaluar_anadir_naves_cuadro(3,2,cantidad_naves_temp2);	
	
}

function guardar_centro(){

	if(equitativa==1){
		if(fila_seleccioanda <= 1){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				cantidad_naves_temp2 = new Array();
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = Math.floor(cantidad_naves_temp_temp[i]/6);
				evaluar_anadir_naves_cuadro(6,0,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,1,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,5,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,3,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,4,cantidad_naves_temp2);
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - (5*cantidad_naves_temp2[i]);
				evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp2);
			}else{
				cantidad_naves_temp2 = new Array();
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = Math.floor(cantidad_naves_temp_temp[i]/2);
				evaluar_anadir_naves_cuadro(6,3,cantidad_naves_temp2);
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - cantidad_naves_temp2[i];
				evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp2);
			}
		}else if(fila_seleccioanda >= 5){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_atc") != -1){
				cantidad_naves_temp2 = new Array();
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = Math.floor(cantidad_naves_temp_temp[i]/2);
				evaluar_anadir_naves_cuadro(6,3,cantidad_naves_temp2);
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - cantidad_naves_temp2[i];
				evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp2);				
			}else{
				cantidad_naves_temp2 = new Array();
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = Math.floor(cantidad_naves_temp_temp[i]/6);
				evaluar_anadir_naves_cuadro(6,0,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,1,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,5,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,3,cantidad_naves_temp2);
				evaluar_anadir_naves_cuadro(6,4,cantidad_naves_temp2);
				for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - (5*cantidad_naves_temp2[i]);
				evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp2);
			}
		}else{
			cantidad_naves_temp2 = new Array();
			for(i=0;i<15;i++){ cantidad_naves_temp2[i] =Math.floor(cantidad_naves_temp_temp[i]/4);/* if(cantidad_naves_temp2[i] != 0){alert((cantidad_naves_temp_temp[i]/4).toFixed());}*/}
			evaluar_anadir_naves_cuadro(6,1,cantidad_naves_temp2);
			evaluar_anadir_naves_cuadro(6,4,cantidad_naves_temp2);
			evaluar_anadir_naves_cuadro(6,3,cantidad_naves_temp2);
			for(i=0;i<15;i++) cantidad_naves_temp2[i] = cantidad_naves_temp_temp[i] - (3*cantidad_naves_temp2[i]);
			evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp2);
		}
	}else{
		if(fila_seleccioanda <= 1){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_def") != -1){				
				rellenar_fila2_compacto();
			}else{
				rellenar_fila6_compacto();
			}
		}else if(fila_seleccioanda >= 5){
			if(zona_de_seleccion.search("conf_batalla_vista_campo_def") != -1){
				rellenar_fila6_compacto();
			}else{
				rellenar_fila2_compacto();
			}
		}else{
			rellenar_fila4_compacto();	
		}
	}
}

function rellenar_fila4_compacto(){
	numero_naves_distintas=0;
	for(i=0; i<15; i++) if(cantidad_naves_temp_temp[i] != 0) numero_naves_distintas++;
	naves_por_tipo = Math.floor(VOLUMEN_MAX_CUADRO/numero_naves_distintas);
	cantidad_naves_temp2 = new Array();	
	cantidad_naves_temp3 = new Array();
	aux23 = new Array();
	
	for(i=0;i<15;i++) cantidad_naves_temp3[i] = cantidad_naves_temp_temp[i];

	aux23[1]=2;aux23[2]=3;aux23[3]=1;aux23[4]=4;
	
	for(j=1; j<=4; j++){
		numero_naves_distintas = 0;
		for(i=0; i<15; i++) if(cantidad_naves_temp_temp[i] != 0) numero_naves_distintas++;
		cantidad_naves_temp2 = rellenar_cuadro_naves_compacto(naves_por_tipo,cantidad_naves_temp3);				
		evaluar_anadir_naves_cuadro(6,aux23[j],cantidad_naves_temp2);
	}
		
	evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp3);

}

function rellenar_fila2_compacto(){
	numero_naves_distintas=0;
	for(i=0; i<15; i++) if(cantidad_naves_temp_temp[i] != 0) numero_naves_distintas++;
	naves_por_tipo = Math.floor(VOLUMEN_MAX_CUADRO/numero_naves_distintas);
	cantidad_naves_temp2 = new Array();	
	cantidad_naves_temp3 = new Array();
	
	for(i=0;i<15;i++) cantidad_naves_temp3[i] = cantidad_naves_temp_temp[i];
	
	for(j=2; j<=3; j++){
		numero_naves_distintas = 0;
		for(i=0; i<15; i++) if(cantidad_naves_temp_temp[i] != 0) numero_naves_distintas++;
		cantidad_naves_temp2 = rellenar_cuadro_naves_compacto(naves_por_tipo,cantidad_naves_temp3);				
		evaluar_anadir_naves_cuadro(6,j,cantidad_naves_temp2);
	}

	
	evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp3);
}

function rellenar_fila6_compacto(){
	numero_naves_distintas=0;
	for(i=0; i<15; i++) if(cantidad_naves_temp_temp[i] != 0) numero_naves_distintas++;
	naves_por_tipo = Math.floor(VOLUMEN_MAX_CUADRO/numero_naves_distintas);
	
	cantidad_naves_temp2 = new Array();	
	cantidad_naves_temp3 = new Array();	
	aux23 = new Array();
	
	for(i=0;i<15;i++) cantidad_naves_temp3[i] = cantidad_naves_temp_temp[i];
	
	aux23[0]=2;aux23[1]=3;aux23[2]=1;aux23[3]=4;aux23[4]=0;aux23[5]=5;
	
	for(j=0; j<=5; j++){
		cantidad_naves_temp2 = rellenar_cuadro_naves_compacto(naves_por_tipo,cantidad_naves_temp3);				
		evaluar_anadir_naves_cuadro(6,aux23[j],cantidad_naves_temp2);
	}

	evaluar_anadir_naves_cuadro(6,2,cantidad_naves_temp3);

}

function rellenar_cuadro_naves_compacto(naves_por_tipo){
	cantidad_naves_temp2 = new Array();
	for(i=0;i<15;i++) cantidad_naves_temp2[i]=0;
	contador_naves_faltan = 0;
	naves_faltantes = 0;
	
	for(i=0;i<15;i++){
		if((cantidad_naves_temp3[i] * volumen_naves[i]) < naves_por_tipo){
			cantidad_naves_temp2[i] += cantidad_naves_temp3[i];
			numero_naves_distintas--;	
			naves_faltantes += naves_por_tipo - cantidad_naves_temp3[i];
			cantidad_naves_temp3[i] = 0;
		}else{
			cantidad_naves_temp2[i] += parseInt(naves_por_tipo/volumen_naves[i]);
			cantidad_naves_temp3[i] -= parseInt(naves_por_tipo/volumen_naves[i]);
		}
	}
	
	return cantidad_naves_temp2;	
}

function guardar_cuadro(){ /*Esta funcion solo se usa cuando no es un cuadro de una fila, osea se tenia seleccionado un cuadro solo*/

	cuadro_seleccionado.children("p").remove();
	cuadro_seleccionado.append("<p style='display:none;'>"+cantidad_naves_temp[0]+" "+cantidad_naves_temp[1]+" "+cantidad_naves_temp[2]+" "+cantidad_naves_temp[3]+" "+cantidad_naves_temp[4]+" "+cantidad_naves_temp[5]+" "+cantidad_naves_temp[6]+" "+cantidad_naves_temp[7]+" "+cantidad_naves_temp[8]+" "+cantidad_naves_temp[9]+" "+cantidad_naves_temp[10]+" "+cantidad_naves_temp[11]+" "+cantidad_naves_temp[12]+" "+cantidad_naves_temp[13]+" "+cantidad_naves_temp[14]+"</p>");
	clase_correspondiente_cuadro()
}

function clase_correspondiente_cuadro(){
	if(cuadro_seleccionado){ 
		contador_temporal = 0;
		tmp2 = new Array();
		aux = new Array();
		
		if(cuadro_seleccionado.children("p").length > 0)
			tmp2 = cuadro_seleccionado.children("p").html().split(" ");
		else for(i=0;i<15;i++) tmp2[i] = "0";
		
		for(i=0; i<15; i++) aux[i] = parseInt(tmp2[i]);
	
		contador_temporal = 0;
	
		for(i=1;i<15;i++) if(aux[i] >= aux[contador_temporal] && aux[i] > 0) contador_temporal = i;
		if(contador_temporal > 0){
			cuadro_seleccionado.attr("class","conf_batalla_vista_campo_cuadro_nave"+(contador_temporal+1));
		}else if(contador_temporal == 0 && aux[0] > 0){
			cuadro_seleccionado.attr("class","conf_batalla_vista_campo_cuadro_nave1");
		}else{
			cuadro_seleccionado.attr("class","conf_batalla_vista_campo_cuadro");
		}
	}
}

function guardar_info_naves(){

	
	for (i=0; i<15; i++){
		 cantidad_naves_temp[i] +=  cantidad_naves_temp_temp[i];
	}		
	
	/*Si ya hay seleccioando un cuadro guardamos los valores en el propio cuadro*/
	if(esta_cuadro_seleccionado == 1){
		if(fila_seleccioanda== 10){/*Miramos si lo que se tiene que guardar es un cuadro u ona fila*/
			if(cuadro_seleccionado){  /*Guardamos el cuadro seleccionado anteriormente*/			
				guardar_cuadro();
			}
		}else{ /*Guardamos la fila, repartiendo equitativamente las tropas entre los cuadros*/
			if(sector_de_seleccion.search("conf_batalla_vista_campo_def_fl_") != -1){ /*Si es un flanco, siempre son 3 columnas*/
				guardar_flanco();
			}else{ /*Si es el centro hay que saber en que fila estamos*/
				guardar_centro();
			}		
		}
	}
	for(i=0; i<15; i++){
		cantidad_naves_temp_temp[i] = 0;
	}
}
