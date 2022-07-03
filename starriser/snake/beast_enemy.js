"use strict";
function Beast_enemy (objs, myOrders, canvas, interfaz) {
	this.constructor(objs, myOrders, canvas, interfaz);	
}

Beast_enemy.prototype.constructor = function(objs, myOrders, canvas, interfaz) { //Objs (wall, isotopes, enemies, player)
	//Creamos el dom, los data y los contadores.

	this.data = {
		myOrders: myOrders,
		canvas: canvas,
		objs: objs,
		direcciones45: ["d", "w", "w", "a", "a", "s", "s", "d"],
		position: [myOrders.x, myOrders.y],
		widths: [interfaz.data.ancho_cuadro, interfaz.data.alto_cuadro],
		interfaz: interfaz,
		vect_direct: [0,0],
		next_position: [0,0],
		beast: false
	};
	this.dom = {
		enemy: $("<div>").addClass("beast_block").css({left: this.data.position[0] * this.data.widths[0], top: this.data.position[1] * this.data.widths[1], width: this.data.widths[0], height: this.data.widths[1] })
	};
	this.counter = {
		backsteps: 0,
		step: 1,
		velocity: 5,
		next_position_caculated: false
	};
	this.data.canvas.append(this.dom.enemy);
};

Beast_enemy.prototype.step = function() {
	//Se mueve en la dirección más apropiada para alcanzar al jugador. Si está atascado pueda una dirección de 90º, si no da media vuelta y se apunta que para la proxima tiene que hacer una de 90. Si no puede lo hará así hasta 5 veces y después volverá a intentar alcanzar al jugador. Se mueve cada 3 turnos.
	//Sacamos la dirección más apropiada.
	if(this.counter.step % this.counter.velocity <= 0){
		var coord_temp = this.data.next_position;
		var temp, temp2;
		this.move(coord_temp);
		//Ahora, con las coordenadas buenas miramos si choca contra el jugador (sea cabeza o cuerpo).
		temp = this.data.objs.player.next_position();
		temp2 = this.data.objs.player.actual_position();
		if((temp[0] == coord_temp [0] && temp[1] == coord_temp[1]) || (temp2[0] == coord_temp [0] && temp2[1] == coord_temp[1])) { //Hemos chocado con la cabeza del jugador. Hemos matado al jugador
			return "gameover";
		}
		temp = this.data.objs.player.inInPosition(coord_temp[0],coord_temp[1]);
		if(temp != false) return "dead"; //Hemos chocado con su cola. Morimos

		//Y hacemos que se mueva si corresponde (osea, si no ha chocado contra la cola del jugador)
		this.counter.step = 1;
		this.counter.next_position_caculated = false;
	}else{
		this.counter.step++;
		var temp = this.data.objs.player.next_position();
		if(temp[0] == this.data.position[0] && temp[1] == this.data.position[1]) { //Hemos chocado con la cabeza del jugador. Hemos matado al jugador
			//console.log("COLISION");
			return "gameover";
		}
	}
};

Beast_enemy.prototype.nextPosition = function() {
	var coord_temp;
	if(!this.counter.next_position_caculated){
		if(this.counter.backsteps <= 0){
			var rad, temp, coordIso, direc, coord_temp;
			var coord_temp2 = [this.data.position[0],this.data.position[1]];

			coordIso = this.data.objs.isotopes.getPosition();
			if(!coordIso || this.data.beast) coordIso = this.data.objs.player.next_position();

			rad = Math.atan2( coordIso[1] - this.data.position[1], coordIso[0] - this.data.position[0]);
			if(rad < 0) rad += 2*Math.PI;
			coord_temp = [this.data.position[0], this.data.position[1]]; 
			if(rad < Math.PI*0.25 || rad >= Math.PI*1.75){ //Ahora hay que tener cuidado, porque el sistema de referencia está arriba a la izquierda. Es decir, el ángulo dado no es el normal.
				direc = "→";
				coord_temp[0]++;
			}else if(rad < Math.PI*0.75 && rad >= Math.PI*0.25){
				direc = "↓";
				coord_temp[1]++;
			}else if(rad < Math.PI*1.25 && rad >= Math.PI*0.75){
				direc = "←";
				coord_temp[0]--;
			}else if(rad < Math.PI*1.75 && rad >= Math.PI*1.25){
				direc = "↑";
				coord_temp[1]--;
			}


			//console.log(direc+" "+rad);
			//Ahora tenemos en coord_temp la dirección más adecuada para ir a por el jugador. Pero antes tenemos que mirar 2 cosas. Si la dirección está bloqueada (y corregir en ese caso) y si hemos impactado contra el.
			if(this.data.objs.wall.isWall(coord_temp) || this.data.objs.enemies.isEnemy(coord_temp)){ //Nos hemos encontrado contra un muro, así que corregimos. Iremos aleatoriamente a la derecha o a la izquierda. Y si no se puede. Hacia atrás. Y si no se puede. Entonces borramos este enemigo porque está bloqueado.
				if(this.counter.eluding){
					coord_temp2[1] += this.data.vect_direct[1];
					coord_temp2[0] += this.data.vect_direct[0];
				}else{
					temp = Math.random();
					if(this.data.position[1] == coord_temp[1]){ //Si el desplazamiento es en Y (y por tanto las coordenadas X son iguales). Como tenemos que girar lo hacemos en X
						if(temp > 0.5) coord_temp2[1]++;
						else  coord_temp2[1]--;
					}else{
						if(temp > 0.5) coord_temp2[0]++;
						else  coord_temp2[0]--;
					}
					this.counter.eluding = true;
				}
				if(this.data.objs.wall.isWall(coord_temp2) || this.data.objs.enemies.isEnemy(coord_temp2)){ //Si la nueva posición también está bloqueada... cogemos la otra.
					this.counter.eluding = false;
					if(this.data.position[1] == coord_temp[1] ){
						coord_temp2[1] = this.data.position[1] + (this.data.position[1] - coord_temp2[1]); //Esto es, si de has movido en una dirección, ahora es la contraria. Se hace la resta y como da si nos hemos movido pero en negativo pues se le suma directamente a la posición inicial
					}else{
						coord_temp2[0] = this.data.position[0] + (this.data.position[0] - coord_temp2[0]);
					}
					if(this.data.objs.wall.isWall(coord_temp2) || this.data.objs.enemies.isEnemy(coord_temp2)){//Quiere decir que alante, derecha e izquierda estan bloqueados. Comprobamos a ver si hacia atras funciona y activamos el contador para hacerlo 5 veces.
						if(this.data.position[1] == coord_temp[1]){ //Usamos coord_temp y no coord_temp2 porque coord_temp tiene el movimiento inicial, osea, el de adelante.
							coord_temp2[1] = this.data.position[1] + (this.data.position[1] - coord_temp[1]);
						}else{
							coord_temp2[0] = this.data.position[0] + (this.data.position[0] - coord_temp[0]);
						}
						if(this.data.objs.wall.isWall(coord_temp2) || this.data.objs.enemies.isEnemy(coord_temp2)){ return [this.data.position[0],this.data.position[1]];} //FIN, Matar bicho. Llamar destructor. (Espero haber hecho bien lo de arriba...)
						else{ 
							coord_temp = coord_temp2;
							this.counter.backsteps = 4; //Le decimos que de 4 pasos hacia a atrás.
						}
					}else coord_temp = coord_temp2;
				}else coord_temp = coord_temp2;
			}else{
				this.counter.eluding = false;
			}
			this.data.vect_direct = [ coord_temp[0] - this.data.position[0] , coord_temp[1] - this.data.position[1] ];
		}else{
			coord_temp = [ this.data.position[0] + this.data.vect_direct[0] , this.data.position[1] + this.data.vect_direct[1] ];
			if(this.data.objs.wall.isWall(coord_temp) || this.data.objs.enemies.isEnemy(coord_temp)){ //Hay una enemigo. Ergo paramos y volvemos a andar normal
				this.counter.backsteps = 0;
				coord_temp = this.data.position;
			}else{
				this.counter.backsteps--;
			}
		}
		this.counter.next_position_caculated = true;
		this.data.next_position = coord_temp;
	}
	return this.data.next_position;
};

Beast_enemy.prototype.move = function(coordinates) {
	this.data.position = coordinates;
	Ctx.fillStyle = "#6D111D";
	Ctx.fillRect(this.data.position[0] * this.data.widths[0], this.data.position[1] * this.data.widths[1], this.data.widths[0], this.data.widths[1]);
	if(this.data.objs.isotopes.getPosition()){
		var coordIso = this.data.objs.isotopes.getPosition();
		if(coordinates[0] == coordIso[0] && coordinates[1] == coordIso[1]){ //hemos pillado un isotopo.Así que pasamos a modo beast y corremos más. Además, matamos el isotopo.
			this.data.objs.isotopes.generate_isotope();
			this.data.objs.isotopes.put_isotope();
			this.data.beast = true;
			this.counter.velocity = 2;
		}
	}
};


Beast_enemy.prototype.destructor = function() {
	
	this.dom.enemy.remove();

	return "dead";
};