function Triangle (lateralLength, rotation, x, y, color) {
	var radius = Math.sqrt(3) / 2 * lateralLength;

	this.graphics = new PIXI.Graphics();

	this.scaleAnimationData = {on: false};

	this.graphics.beginFill(color);

	var points = [];

	var angle = (2 * Math.PI / numberOfSides);

	points.push(radius * Math.cos(rotation));
	points.push(radius * Math.sin(rotation));

	points.push(radius * Math.cos(rotation + 1 * angle));
	points.push(radius * Math.sin(rotation + 1 * angle));

	points.push(radius * Math.cos(rotation + 2 * angle));
	points.push(radius * Math.sin(rotation + 2 * angle));

	points.push(radius * Math.cos(rotation));
	points.push(radius * Math.sin(rotation));

	this.graphics.drawPolygon(points);

	this.graphics.position.x = x;
	this.graphics.position.y = y;

	var _this = this;
	this._tick = function () {
		_this._animFrame();
	};

	this.scale = this.graphics.scale;
}

Triangle.prototype.get = function() {
	return this.graphics;
};

Triangle.prototype.scaleAnimation = function(from, to, time) {
	var _this = this;
	this.scaleAnimationData.initTime = window.performance.now();
	this.scaleAnimationData.from = from;
	this.scaleAnimationData.to = to;
	this.scaleAnimationData.endTime = this.scaleAnimationData.initTime + time;
	this.scaleAnimationData.duration = time;
	this.scaleAnimationData.on = true;

	window.requestAnimationFrame(this._tick);
};

Triangle.prototype._animFrame = function(now) {
	if(this.scaleAnimationData.on){
		var scale = (now - this.scaleAnimationData.initTime) / this.scaleAnimationData.duration
		this.graphics.scale.x = scale;
		this.graphics.scale.y = scale;
	}
};

