"use strict";
function Enemies (enemies, objs, interfaz, canvas) { //Que esto tenga que ser una clase independiente y no estar en interfaz es discutible. Pero por claridad prefiero así
	this.constructor(enemies, objs, interfaz, canvas);
};

Enemies.prototype.constructor = function(enemies, objs, interfaz, canvas) {
	//Creamos todas las instancias de los enemigos. Cada enemigo una clase distinta.
	//Los enemigos base son:
	//	Suponiento tu como el jugador:
	//	- walker: Camina cada 3 turno hacia ti. Si te toca el cuerpo muere el caminante a no ser que te de a la cabeza. En ese caso mueres el jugador
	//	- shooter: Camina random y te dispara a ti. Al menos en la dirección más proxima a ti.
	//	- beast: Como un caminante normal, solo que se dirige a un isotopo. En caso de conseguir uno se vuelve rojo y camina cada 2, te dispara y si te da en la cola la rompe y muere 
	this.data = {
		cuantity: enemies.length,
		enemies: new Array(enemies.length),
		types: new Array(enemies.length),
		objs: objs,
		interfaz: interfaz,
		enemies_raw: enemies,
		next_enemies: new Array(enemies.length),
		next_enemies_cuantity: 0,
		turn: 0,
		evil_events: [],
		canvas: canvas,
		positions_enemies: []
	};

	var obj_temp;
	for (var i = 0; i < this.data.cuantity; i++) {//inicializamos a los enemigos, les damos el campo y les decimos donde van.
		if(enemies[i].type == "walker") obj_temp = new Walker_enemy(objs, this.data.enemies_raw[i], canvas, interfaz)
		//else if(enemies[i].type == "shooter") obj_temp = new Shooter_enemy(objs, this.data.enemies_raw[i], canvas, interfaz)
		else if(enemies[i].type == "beast") obj_temp = new Beast_enemy(objs, this.data.enemies_raw[i], canvas, interfaz)

		this.data.enemies[i] = obj_temp;
		this.data.types[i] = enemies[i].type;
	};
};

Enemies.prototype.step = function() { //Ejecuta un turno de lo enemigos. Esto tiene que devolver si el jugador ha muerto o no. True -> muere. False -> sigue vivo. Además en caso de que hayan pocos enemigos pone más. Siempre lo hará a un minimo de 5 cuadros del jugador
	this.data.evil_events[this.data.turn] = 0;
	var result;
	
	this.data.positions_enemies = [];
	for (var i = 0; i < this.data.cuantity; i++) {
		this.data.positions_enemies[this.data.positions_enemies.length] = this.data.enemies[i].nextPosition();
		result = this.data.enemies[i].step();

		if(result == "gameover"){ //El jugador ha muerto. Acabamos la ejecución y devolvemos true.
			return true;
		}else if(result == "dead"){ //El enemigo ha muerto. Llamamos a su destructor, lo borramos del vector, reordenamos todo el vector y restamos en uno la cantidad de enemigos. A la vez también apuntamos que necesitamos crear en un futuro un enemigo para reemplazarlo.
			this.data.enemies[i].destructor();
			delete this.data.enemies[i]; //no se muy bien si esto ayuda a liberar memoria al motor de JS. Espero que no me la lie a mi.

			this.data.next_enemies[this.data.next_enemies_cuantity++] = this.data.types[i]; //Decimos que un enemigo de X tipo ha muerto y lo apuntamos para reemplazo

			this.data.enemies.splice(i, 1); //Borramos del array el elemento y creamos una posición al final para que el tamaño del array no descienda
			this.data.enemies[this.data.cuantity-1] = 0;
			this.data.types.splice(i, 1); //Borramos del array el elemento y creamos una posición al final para que el tamaño del array no descienda
			this.data.types[this.data.cuantity--] = 0;
			i--;
		}else if(result == "impact"){ //El jugador ha recibido daño
			this.data.evil_events[this.data.turn]++; //Apuntamos que el jugador ha recibido para intentar controlar en un futuro el nivel de stress de la partida haciendo oleadas (gracias comentarios del director de left 4 dead 2)
		}
	};

	//Aquí irá la IA que se encargará de ver si hay que poner más enemigos o no. El director del juego


	return false;
};

Enemies.prototype.isEnemy = function(coord) {
	var counter = 0;
	for (var i = this.data.positions_enemies.length - 1; i >= 0; i--) {
		if(this.data.positions_enemies[i][0] == coord[0] && this.data.positions_enemies[i][1] == coord[1]) return true; 
	};
	return false;
};