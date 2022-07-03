var FakeScroll = function (data) {
	this.init(data);
};

FakeScroll.prototype.init = function(data) {

	var i, childrens, temp;

	var self = this;

	this.eventHandler = (typeof data.eventHandler !== "undefined") ? data.eventHandler : new EventHandler();

	this.clas = (typeof data.clas !== "undefined") ? data.clas : '';
	this.element = (typeof data.element !== "undefined") ? data.element : false;

	if(this.element === false) return "Give me something like {element: DOM_ELEMENT, clas: CLASS_OF_SCROLL}.";

	this.wrap = document.createElement("div");
	this.wrap.style.position = "relative";

	this.wrap.style.top = 0;

	this.scroll = document.createElement("div");
	this.scroll.style.position = "absolute";
	this.scroll.style.top = 0;
	this.scroll.className = this.clas;


	temp = this.element.style.position;
	if(temp !== "absolute" && temp !== "relative" && temp !== "fixed"){
		temp = "relative";
	}

	this.wrapPosition = 0;

	childrens = new Array(this.element.childNodes.length);
	for (i = childrens.length - 1; i >= 0; i--) {
		childrens[i] = this.element.childNodes[i];
		this.element.removeChild(childrens[i]);
	}

	this.element.appendChild(this.wrap);
	this.element.appendChild(this.scroll);

	for (i = childrens.length - 1; i >= 0; i--) {
		this.wrap.appendChild(childrens[i]);
	}

	this.event = this.eventHandler.bind("drag", this.scroll, this.scrolled, false, this);

	$(this.element).bind("mousewheel", function (e, delta, deltaX, deltaY) {
		delta *= -1;
		self.scrolled({pageY: ((delta > 5) ? 100 : (delta < -5) ? -100 : delta*20)});
	});

};

FakeScroll.prototype.scrolled = function(data) {
	if(typeof this.scrolledButton === "undefined") return 0;
	
	var y = data.pageY;

	this.scrolledButton += y;

	if(this.scrolledButton > this.scrollableButtonZone) this.scrolledButton = this.scrollableButtonZone;
	else if(this.scrolledButton < 0) this.scrolledButton = 0;

	var percent = this.scrolledButton / (this.scrollableButtonZone);

	var top = percent * this.scrollableZone;

	this.wrap.style.top = (-top + 50) + "px";

	this.scroll.style.top = (percent * this.scrollableButtonZone) + "px";


	Utils.unselect();

};

FakeScroll.prototype.calculateSizes = function() {
	this.scrolledButton = 0;

	this.scrollableButtonZone = this.element.offsetHeight - this.scroll.offsetHeight;

	this.scrollableZone = this.wrap.offsetHeight - this.element.offsetHeight + 100;

	this.scrolled({pageY: 0});
};

