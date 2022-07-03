"use strict";
function Wall (width, height, block_height, block_width, map, canvas) {
	this.constructor(width, height, block_height, block_width, map, canvas);
}

Wall.prototype.constructor = function(width, height, block_height, block_width, map, canvas) {

	this.data = {
		width: width,
		height: height,
		block_height: block_height,
		block_width: block_width,
		map: map,
		canvas: canvas
	};

	//Creamos la memoria del mapa. || 0 -> vacio, 1 -> pared (en un fururo habrán más)
	this.map = new Array(width);
	for (var i = this.map.length - 1; i >= 0; i--) {
		this.map[i] = new Array(height);
		for (var j = this.map[i].length - 1; j >= 0; j--) {
			this.map[i][j] = {type: 0, dom: 0};
		};
	};

	for (var i = map.length - 1; i >= 0; i--) {
		this.map[ map[i][0] ][ map[i][1] ].type = 1;
		this.map[ map[i][0] ][ map[i][1] ].dom = $("<div>").addClass("cuadro_pared_normal").css({
				left: map[i][0]*this.data.block_width,
				top: map[i][1]*this.data.block_height,
				width: this.data.block_width,
				height: this.data.block_height
			}) 
		canvas.append(this.map[ map[i][0] ][ map[i][1] ].dom);
	};
};

Wall.prototype.get_map = function() {
	return this.map;
};

Wall.prototype.isWall = function(position) {
	if(!position) return false;
	var x = position[0];
	var y = position[1];
	var wall;
	if(this.map[x] && this.map[x][y]){
		if(this.map[x][y].type == 1) return true;
		else return false;
	}else{
		return true;
	}
}

Wall.prototype.set = function(x, y) {
	this.map[x][y].type = 1;
	this.map[ x ][ y ].dom = $("<div>").addClass("cuadro_pared_normal").css({
			left: x*this.data.block_width,
			top: y*this.data.block_height,
			width: this.data.block_width,
			height: this.data.block_height
		}) 
};

Wall.prototype.remove = function(x, y) {
	this.map[x][y].type = 0;
	this.map[ x ][ y ].dom.remove();
	this.map[ x ][ y ].dom = 0;
};