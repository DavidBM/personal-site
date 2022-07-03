"use strict";
function Player (initial_position, block_height, block_width, initial_length) {

	var MAX_LENGHT = 50;
	this.dom = {};
	this.dom.container = $("<div>").css({width: 0, height: 0});
	this.dom.block = $("<div>").addClass("snake_block").addClass("").css({width: block_width, height: block_height});

	this.data = { //Ponemos la cantidad de 
		blocks: initial_length,
		positions: new Array(MAX_LENGHT),
		direction: initial_position[2],
		direction_anterior: initial_position[2],
		block_data: {
			width: block_width,
			height: block_height
		},
		levels_radiosity: [0, 5, 9, 13],
		levels_radiosity_class: ["0BE39B", "39FABA", "BAFFE8", "DBFFF3"],
		level_radiosity: 0,
		velocity: 7,
		counter_step_velocity: 1,
		nextDirection: false
	};

	//Crear la serpiente
	for (var i = 0; i < this.data.blocks; i++) {
		this.data.positions[i] = [initial_position[0], initial_position[1]]
	}
	this.set_radiosity();
	this.set_velocity();
}

Player.prototype.get_positions = function() {
	var temp = new Array(this.data.blocks);
	for (var i = 0; i < this.data.blocks; i++) {
		temp[i] = [this.data.positions[i][0], this.data.positions[i][1]];
	}
	return temp;
};

Player.prototype.inInPosition = function(x, y) {
	var positions = this.get_positions();
	for (var i = positions.length - 1; i >= 0; i--) {
		if(positions[i][0] == x && positions[i][1] == y) return i;
	}
	return false;
};

Player.prototype.next_position = function() {
	if(this.data.direction == "d"){ //derecha
		return [ this.data.positions[0][0] + 1 , this.data.positions[0][1] ];
	}else if(this.data.direction == "w"){ //arriba
		return [ this.data.positions[0][0] , this.data.positions[0][1] - 1 ];
	}else if(this.data.direction == "a"){ //izquierda
		return [ this.data.positions[0][0] - 1 , this.data.positions[0][1] ];
	}else if(this.data.direction == "s"){ //abajo
		return [ this.data.positions[0][0] , this.data.positions[0][1] + 1 ];
	}
};

Player.prototype.next_position_vel = function() {
	if(this.data.counter_step_velocity % this.data.velocity <= 0){
		if(this.data.direction == "d"){ //derecha
			return [ this.data.positions[0][0] + 1 , this.data.positions[0][1] ];
		}else if(this.data.direction == "w"){ //arriba
			return [ this.data.positions[0][0] , this.data.positions[0][1] - 1 ];
		}else if(this.data.direction == "a"){ //izquierda
			return [ this.data.positions[0][0] - 1 , this.data.positions[0][1] ];
		}else if(this.data.direction == "s"){ //abajo
			return [ this.data.positions[0][0] , this.data.positions[0][1] + 1 ];
		}
	}
	else return false;
};

Player.prototype.actual_position = function() {
	return this.data.positions[0];
};

Player.prototype.set_direction = function(direction) {
	if(!this.data.nextDirection){
		if(direction == "d" && this.data.direction_anterior == "a"){ //derecha
			return 0;
		}else if(direction == "w" && this.data.direction_anterior == "s"){ //arriba
			return 0;
		}else if(direction == "a" && this.data.direction_anterior == "d"){ //izquierda
			return 0;
		}else if(direction == "s" && this.data.direction_anterior == "w"){ //abajo
			return 0;
		}
		this.data.direction = direction;
		this.data.nextDirection = true;
	}else{
		if(direction == "d" && this.data.direction == "a"){ //derecha
			return 0;
		}else if(direction == "w" && this.data.direction == "s"){ //arriba
			return 0;
		}else if(direction == "a" && this.data.direction == "d"){ //izquierda
			return 0;
		}else if(direction == "s" && this.data.direction == "w"){ //abajo
			return 0;
		}
		if(direction == this.data.direction) return 0;
		
		this.data.nextDirection = direction;
	}
};

Player.prototype.move = function() {
	if(this.data.counter_step_velocity % this.data.velocity <= 0){
		this.data.direction_anterior = this.data.direction;
		for (var i = this.data.blocks - 1; i >= 1; i--) {
			this.data.positions[i] = this.data.positions[i-1];
			//this.dom.snake[i].css({ left: this.data.positions[i-1][0] * this.data.block_data.width , top: this.data.positions[i-1][1] * this.data.block_data.height });
		}

		this.data.positions[0] = this.next_position();
		//this.dom.snake[0].css({ left: this.data.positions[0][0] * this.data.block_data.width , top: this.data.positions[0][1] * this.data.block_data.height });
		this.data.counter_step_velocity = 1;
		if(this.data.nextDirection !== false && this.data.nextDirection !== true){
			this.data.direction = this.data.nextDirection;
			this.data.nextDirection = true;
		}else{
			this.data.nextDirection = false;
		}
	}else{
		this.data.counter_step_velocity++;
	}
};

Player.prototype.set_velocity = function() {
	var size = this.data.blocks;
	if(size < 4){
		this.data.velocity = 7;
	}else if(size < 7){
		this.data.velocity = 6;
	}else if(size < 10){
		this.data.velocity = 5;
	}else if(size < 14){
		this.data.velocity = 4;
	}else if(size < 16){
		this.data.velocity = 3;
	}else if(size < 18){
		this.data.velocity = 2;
	}else if(size < 20){
		this.data.velocity = 1;
	}
};

Player.prototype.grow = function(grow) {

	if(grow){
		for (var j = this.data.blocks; j < this.data.blocks + grow; j++) {
			this.data.positions[j] = this.data.positions[j-1];
			//this.dom.snake[j] = this.dom.block.clone().css({left: this.data.positions[j-1][0] * this.data.block_data.height, top: this.data.positions[j-1][1] * this.data.block_data.width});
		}
		this.data.blocks += grow;
	}else{
		this.data.positions[this.data.blocks] = this.data.positions[this.data.blocks-1];
		//this.dom.snake[this.data.blocks] = this.dom.block.clone().css({left: this.data.positions[this.data.blocks-1][0] * this.data.block_data.height, top: this.data.positions[this.data.blocks-1][1] * this.data.block_data.width});
		//this.dom.container.append(this.dom.snake[this.data.blocks]);
		this.data.blocks++;
	}
	//mirar nivel del gusano para ver si hay que cambiarle los cuadros de color
	this.set_radiosity();
	this.set_velocity();

};

Player.prototype.cut = function(cut) { //Poner en un futuro que se quden como pared los cuadros que se han cortado?
	for (var i = this.data.blocks - 1; i >= cut; i--) {
		//this.dom.snake[i].remove();
	}
	this.data.blocks = cut; //Cut es el indice del cuadro al que le pegan, osea, que es en base 0. Por eso la cantidad se le suma uno con respecto a cut. 
	this.set_velocity();
	this.set_radiosity();
};

Player.prototype.set_radiosity = function() {
	var level;
	for (var i = this.data.levels_radiosity.length - 1; i >= 0; i--) {
		if(this.data.blocks >= this.data.levels_radiosity[i]){
			level = i;
			break;
		}
	}
	if(level != this.data.level_radiosity){ //Entonces cambiamos el nivel de fluorescencia
		for (var i = this.data.blocks - 1; i >= 0; i--) {
			//this.dom.snake[i].attr("class","snake_block").addClass(this.data.levels_radiosity_class[level]);
		}
		//this.dom.block.attr("class","snake_block").addClass(this.data.levels_radiosity_class[level]);
	}
	this.data.level_radiosity = level;
};

Player.prototype.get_length = function() {
	return this.data.blocks;
};

Player.prototype.draw = function() {
	var block_width = this.data.block_data.width;
	var block_height = this.data.block_data.height;
	Ctx.fillStyle = "#" + this.data.levels_radiosity_class[this.data.level_radiosity];
	for (var i = 0; i < this.data.blocks; i++) {
		Ctx.fillRect(this.data.positions[i][0] * block_width, this.data.positions[i][1] * block_height, block_width, block_height);
	}
};