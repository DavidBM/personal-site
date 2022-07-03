"use strict";
var LoadingAnimation = function (fadeInTime, displaced) {
	this.init(fadeInTime, displaced);
};

LoadingAnimation.prototype.init = function(fadeInTime, displaced) {
	
	var self = this;

	this.canvas = false;
	this.position = {x: 0, y: 0};
	this.startTime = 0;
	this.onAnimation = false;
	this.fadeInTime = fadeInTime;
	if( typeof displaced !== "undefined" )
		this.displaced = {x: displaced.x, y: displaced.y};
	else
		this.displaced = {x: 0, y: 0};

	this.canvasSize = {x: 0, y: 0};

	this.textCanvas = document.createElement("canvas");
	this.textCtx = this.textCanvas.getContext("2d");

	ResourcesImg.g().wait("allFontsLoaded", {
		handler:function(){
			self.textCtx.font = "50px sansationlight";
			self.textCanvas.width = Math.ceil(self.textCtx.measureText("Loading...").width) + 10;
			self.textCanvas.height = 100;

			self.textCtx.font = "50px sansationlight";
			self.textCtx.fillStyle = "#90b7d9";
			self.textCtx.strokeStyle = "#000";
			self.textCtx.lineWidth = 4;

			//self.textCtx.strokeText("Loading...", 5, 50.5);
			self.textCtx.fillText("Loading...", 5, 50);
			self.setCanvasSize(self.canvasSize.x, self.canvasSize.y);
		}
	});
	
	this.textCanvas.height = 100;
	this.textCanvas.width = 100;

};

LoadingAnimation.prototype.setCanvasSize = function(positionX, positionY) {
	this.canvasSize.x = positionX;
	this.canvasSize.y = positionY;

	this.position.x = positionX / 2 - this.textCanvas.width / 2 - 5 + this.displaced.x;
	this.position.y = positionY / 2 - 25 + this.displaced.y;
};

LoadingAnimation.prototype.start = function() {
	this.startTime = new Date().getTime();
	this.onAnimation = true;
};

LoadingAnimation.prototype.draw = function(ctx) {
	if(this.onAnimation === true){
		var x, alt, time, porcent, animStep, iPercent;

		ctx.save();

		ctx.setTransform(1, 0, 0, 1, 0, 0);

		ctx.strokeStyle = "#90b7d9";
		ctx.lineWidth = 1;
		ctx.fillStyle = "#90b7d9";


		var numSquares = Math.floor(this.textCanvas.width / 9);
		for (var i = 0; i < numSquares; i++) {
			ctx.beginPath();

			x = this.position.x + i * 9 + 0.5;
			ctx.rect(x ,this.position.y , 5, 5);
			ctx.stroke();

			time = (new Date().getTime() - this.startTime) % 1000;
			porcent = time / 1000;
			iPercent = (i + 1) / numSquares;

			alt = (porcent < iPercent - 0.2 || porcent > iPercent + 0.2) ? 0 : 5 - (Math.abs(porcent - iPercent) / 0.2) * 5;
			
			ctx.fillRect(x, this.position.y + 5 - alt , 5, alt);
			ctx.fillStyle = "rgba(203, 225, 255, " + ((alt/5).toFixed(1)) +")";
			ctx.fillRect(x, this.position.y, 5, 5);
		}

		ctx.drawImage(this.textCanvas, this.position.x - 3, this.position.y - 65);
		ctx.restore();
	}
};

LoadingAnimation.prototype.stop = function() {
	this.onAnimation = false;
};