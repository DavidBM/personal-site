"use strict";
function Isotopes (wall, width, height, block_width, block_height, canvas) {
	this.constructor(wall, width, height, block_width, block_height, canvas);
}

Isotopes.prototype.constructor = function(wall, width, height, block_width, block_height, canvas) {
	this.wall = wall;
	this.data = {
		max_x: width,
		max_y: height,
		block_width: block_width,
		block_height: block_height,
		canvas: canvas
	};
	this.dom = {
		isotope: $("<div>").addClass("cuadro_isotope").css({width: this.data.block_width, height: this.data.block_height })
	};

	//this.generate_isotope();
	//this.put_isotope();
};

Isotopes.prototype.generate_isotope = function() {
	this.data.position = [ Math.floor(Math.random()*(this.data.max_x - 2)) + 1 , Math.floor(Math.random()*(this.data.max_y - 2)) + 1];
	if( this.wall.isWall(this.data.position)) this.generate_isotope();
};

Isotopes.prototype.put_isotope = function() {
	this.dom.isotope.css({
			left: 	this.data.position[0] * this.data.block_width,
			top: 	this.data.position[1] * this.data.block_height,
			width: 	this.data.block_width,
			height: this.data.block_height
		}) 
	this.data.canvas.append(this.dom.isotope);
};

Isotopes.prototype.isIsotope = function(position) {
	if(!this.data.position || (position[0] == this.data.position[0] && position[1] == this.data.position[1]) ) return true;
	else return false;
};

Isotopes.prototype.getPosition = function() {
	if(this.data.position) return this.data.position;
	else return false;
};

