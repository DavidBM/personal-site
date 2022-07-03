var MilitaryAssistant = function () {
	this.init();
};

MilitaryAssistant.prototype.init = function() {
	
	this.dom = {};
	this.data = {};

	this.dom.movements = {};
	this.dom.stationed = {};

	this.dom.movements.historyCards = {};

	this.data.stationed = {};

	this.data.timers = [];

	this.data.ETAs = [];

	this.tabs = new MinTabs();
	this.tabs.addTab("Movimientos de tropas", [
		createElement("div").setClass("assistant assistantContainer").saveIn(this.dom.movements, "container").addChild(createElement("div").setClass("loading").saveIn(this.dom.movements, "loading")),
		createElement("div").setClass("clear")
	]);
	this.tabs.addTab("Tropas estacionadas", [
		createElement("div").setClass("assistant assistantContainer").saveIn(this.dom.stationed, "container").addChild(createElement("div").setClass("loading").saveIn(this.dom.stationed, "loading")),
		createElement("div").setClass("clear")
	]);

	this.loadData();

	this.dom.container = this.tabs.getDom();
};

MilitaryAssistant.prototype.getDom = function() {
	return this.dom.container;
};

MilitaryAssistant.prototype.loadData = function() {
	var self = this;

	setTimeout(function () {
		self.dataLoaded(MilitarData);
	}, 600);
};

MilitaryAssistant.prototype.dataLoaded = function(data) {
	var self = this;

	this.data.data = data;

	this.dom.movements.container.deleteChild(this.dom.movements.loading).addChild(this.createHistoryMovement());

	this.dom.stationed.container.deleteChild(this.dom.stationed.loading).addChild(this.createHistoryStationed());

	this.data.timers.push(setInterval(function () {
		self.updateTimes();
	}, 1000));
};

MilitaryAssistant.prototype.createHistoryMovement = function() {
	var data = this.data.data.movements;
	this.dom.movements.historyCards = new Array(data.length);
	this.data.ETAs = [];
	var d;
	var c = this.dom.movements.historyCards;
	var temp = [];

	for (var i = 0; i < data.length; i++) {
		d = data[i];
		c[i] = createElement("div").setClass("assistant shipTravelCard " + d.type)
			.addChild( createElement("p").setClass("text").setHtml(this.historyMovementsCardText(d)) );
		if(typeof d.restTime !== "undefined"){ //Si hay tiempo de llegada, lo ponemos, si no, fuera
			c[i].addChild( createElement("p").setClass("arrivalTime")
				.addChild( createElement("span").setVariable("title", 'Estimated Time of Arrival').setHtml("ETA ") )
				.addChild( createTextNode(Utils.parseTime(d.restTime)).saveIn(temp, 0) ) );

			this.data.ETAs.push({
				initTime: new Date().getTime(),
				restTime: d.restTime,
				dom: temp[0],
			});
		}

		c[i].addChild( createElement("div").setClass("animatedGifContainer") )
			.addChild( this.generateTroopsDom(d) );

	}

	return c;
};

MilitaryAssistant.prototype.generateTroopsDom = function(d) {
	if(this.checkFleet(d.origin) !== false || this.checkFleet(d.destination) !== false ){ //Hay tropas
		var c1 = this.appendTroopsContainer(d.destination);
		var c2 = this.appendTroopsContainer(d.origin);

		return [c2,	c1];
	}else if(this.checkFleet(d) !== false){
		return this.appendTroopsContainer(d);
	}else{ //No hay tropas
		return createElement("div").setClass("shipsContainer").addChild( createElement("p").setClass("noInfo").setHtml("No hay datos del ejercito enemigo") );
	}
};

MilitaryAssistant.prototype.appendTroopsContainer = function(d) {
	var temp = this.checkFleet(d);
	if(temp !== false){
		var c = createElement("div").setClass("shipsContainer" + ((d.type === "battleIn" || d.type === "battleOut") ? " battle" : "") )
			.addChild( createElement("p").setClass("userName").setHtml(temp.userName) );
		this.appendTroopsDom(c, temp.fleet);
		c.addChild( createElement("div").setClass("clear") );
		return c;
	}else{
		return false;
	}
};

MilitaryAssistant.prototype.appendTroopsDom = function(el, tr) {
	var len = tr.length;
	for (var i = 0; i < len; i++) {
		if(tr[i] > 0){
			el.addChild( createElement("div").setClass("ship ship_" + i)
				.addChild( createElement("div").setClass("shipImage") )
				.addChild( createElement("div").setClass("shipCuantity").setHtml(tr[i]) )
			);
		}
	}
};

MilitaryAssistant.prototype.createHistoryStationed = function() {
	var data = this.data.data.stationed;
	this.dom.stationed.historyCards = new Array(data.length);
	var d;
	var c = this.dom.stationed.historyCards;
	var temp = [];

	for (var i = 0; i < data.length; i++) {
		d = data[i];
		c[i] = createElement("div").setClass("assistant shipStationedCard " + d.type)
			.addChild( createElement("p").setClass("text").setHtml(this.historyMovementsCardText(d, true)) );

		c[i].addChild( createElement("div").setClass("animatedGifContainer") )
			.addChild( this.generateTroopsDom(d) );
	}

	return c;
};

MilitaryAssistant.prototype.checkFleet = function(d) {
	if(typeof d !== "undefined" && typeof d.fleet !== "undefined" && typeof d.fleet.fleet !== "undefined" && typeof d.fleet.fleet !== null) return d.fleet;
	else return false;
};

MilitaryAssistant.prototype.historyMovementsCardText = function(d, stationed) {
	if(typeof stationed === "undefined") stationed = false;
	var t = "";
	switch(d.eventType){
		case "atackIn":
			t = "El usuario <span>" + d.origin.fleet.userName + "</span> <span>ataca</span> al planeta <span>" + d.destination.node.nodeName + "</span>";
		break;
		case "atackOut":
			t = "<span>Ataque</span> a <span>" + d.destination.node.nodeName + "</span> del usuario <span>" + d.destination.node.userName + "</span>";
		break;
		case "supportIn":
			if(stationed)
				t = "El usuario <span>" + d.fleet.userName + "</span> tiene tropas en <span>apoyo</span> en <span>" + d.node.nodeName + "</span>";
			else
				t = "El usuario <span>" + d.origin.fleet.userName + "</span> te envia tropas de <span>apoyo</span> a <span>" + d.destination.node.nodeName + "</span>";
		break;
		case "supportOut":
			if(stationed)
				t = "Tienes tropas de <span>Apoyo</span> en el planeta <span>" + d.node.nodeName + "</span> del usuario <span>" + d.fleet.userName + "</span>";
			else
				t = "<span>Apoyo</span> al planeta <span>" + d.destination.node.nodeName + "</span> del usuario <span>" + d.destination.fleet.userName + "</span>";
		break;
		case "battleIn":
			t = "<span>Batalla</span> en el planeta propio <span>" + d.destination.node.nodeName + "</span> contra el usuario <span>" + d.origin.fleet.userName + "</span>";
		break;
		case "battleOut":
			t = "<span>Batalla</span> en el planeta <span>" + d.destination.node.nodeName + "</span> del usuario <span>" + d.destination.node.userName + "</span>";
		break;
		case "stationed":
			t = "<span>Tropas</span> en el " + (d.node.type) + " <span>" + d.node.nodeName + "</span>";
		break;
	}

	return t;
};

MilitaryAssistant.prototype.updateTimes = function() {
	var o = this.data.ETAs;
	var len = o.length;
	for (var i = 0; i < len; i++) {
		o[i].dom.setText(Utils.parseTime( o[i].restTime - (new Date().getTime() - o[i].initTime)/1000 ));
	}
};

MilitaryAssistant.prototype.clear = function(kill) {
	if(kill){
		this.dom.container.innerHTML = "";
	}
	for (var i = this.data.timers.length - 1; i >= 0; i--) {
		clearInterval(this.data.timers[i]);
	}
};

var MilitarData = {
	movements: [
		{
			eventType: "supportIn",
			remTime: 523647,
			origin: {
				fleet: {
					idUser: 547,
					userName: "t3_m4a0_b14ch ORIGIN",
					fleet: [12, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 0, 12, 0, 45, 234, 3000, 3456, 4500, 10000, 90000000]
				}, node: {
					idUser: 478,
					userName: "t3_m4a0_b14ch ORIGIN",
					idNode: 47852,
					nodeName: "n-3424-2 origin"
				}
			},
			destination: {
				fleet: {
					idUser: 547,
					userName: "t3_m4a0_b14ch DESTINATION",
					fleet: [12, 0, 0, 12, 0, 45, 234, 3000, 3456, 4500, 10000, 90000000]
				}, node: {
					idUser: 478,
					userName: "t3_m4a0_b14ch DESTINATION",
					idNode: 47852,
					nodeName: "n-3424-2 destination"
				}
			},
			route: [
				{
					idNode: 23,
					nodeName: "N-2352-1",
					type: "starGate"
				},
				{
					idNode: 24,
					nodeName: "N-2353-1",
					type: "starGate"
				},
				{
					idNode: 25,
					nodeName: "N-2354-1",
					type: "starGate"
				},
				{
					idNode: 26,
					nodeName: "N-2355-1",
					type: "starGate"
				}
			]
		}
	],
	stationed: [
		{
			eventType: "stationed",
			fleet: {
				idUser: 234,
				userName: "mi nombre_molón",
				fleet: [12, 0, 0, 12, 0, 45, 234, 3000, 3456, 4500, 10000, 90000000]
			}, node: {
				idUser: 234,
				userName: "mi nombre_molón",
				idNode: 4578,
				nodeName: "nombre_nodo",
				type: "starGate"
			}
		},
		{
			eventType: "supportOut",
			fleet: {
				idUser: 234,
				userName: "mi nombre_molón",
				fleet: [12, 0, 0, 12, 0, 45, 234, 3000, 3456, 4500, 10000, 90000000]
			}, node: {
				idUser: 234,
				userName: "mi nombre_molón",
				idNode: 4578,
				nodeName: "nombre_nodo",
				type: "starGate"
			}
		},
		{
			eventType: "supportIn",
			fleet: {
				idUser: 234,
				userName: "mi nombre_molón",
				fleet: [12, 0, 0, 12, 0, 45, 234, 3000, 3456, 4500, 10000, 90000000]
			}, node: {
				idUser: 234,
				userName: "mi nombre_molón",
				idNode: 4578,
				nodeName: "nombre_nodo",
				type: "starGate"
			}
		}
	],
};