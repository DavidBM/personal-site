"use strict";
var ZoomPanel = function (handler, context) {
	this.init(handler, context);
};

ZoomPanel.prototype.init = function(handler, context) {

	//Data
	var self = this;
	var zoomLevels = Utils.enums.zoneWorkMode;
	this.zoomLevels = [zoomLevels.GALAXY, zoomLevels.CUMULUS, zoomLevels.SYSTEM, zoomLevels.PLANET];

	//DOM
	this.background = document.createElement("div");
	this.background.className = "background zoomLevel";

	this.buttons = new Array(4);
	var l = this.buttons.length;
	for (var i = 0; i < l; i++) {
		this.buttons[i] = document.createElement("div");
		this.buttons[i].className = "button button"+i;
		this.background.appendChild(this.buttons[i]);
		$(this.buttons[i]).click((function (i) {
			return function () {
				handler.call(context, self.zoomLevels[i], self.zoomLevels[i]);
			}
		})(i));
	};
};

ZoomPanel.prototype.getDom = function() {
	return this.background;
};