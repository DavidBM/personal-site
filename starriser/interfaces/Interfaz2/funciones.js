



function flip_flop_id(var1, var2, var3){ // Var 2 y 3 son texto, var 1 es un objeto jquery.
//Esta funcion mira si en el objeto jquery que se le pasa pro var1 tiene algun class var2 y si es asi la sustituya por la clase var 3, lo mismo a la inversa.
	if(var1.attr("id") == var2){ 	var1.attr("id",var3)}
	else{ var1.attr("id",var2)}
		
}


function mostrar_menu_planetas(var1){ //Desplega el menu de los planetas y hace que el boton se quede encendid

$("#lista_planetas_lista").slideToggle(50);

flip_flop_id(var1,"flecha_menu_planetas","flecha_menu_planetas_active")

}

document.onclick=function(e){
evt2 = e || window.event; //Obtenemos el objeto event
var elemento = evt2.target || evt2.srcElement; //Obtenemos el elemento que se le dio el click
var id_evento = elemento.id; // se obtiene el id

//alert(id_evento);

if(id_evento=="flecha_menu_planetas" || id_evento=="flecha_menu_planetas_active") mostrar_menu_planetas($("#"+id_evento));
else{

$("#lista_planetas_lista").slideUp(50);
$("#flecha_menu_planetas_active").attr("id","flecha_menu_planetas");

}

return true; //No se cancela la acción del href.
}