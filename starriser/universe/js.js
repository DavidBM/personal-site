/*
Falta:
	- Poder seleccionar un cúmulo. ✓
	- Exportar cúmulos. (con la consola) ✓
	- Hacer los grafos de doble sentido. ✓
	- Poner en cada sol una vector de denegaciones de links para ver por que se le ha denegado. ✓
	- Evitar cumulos con demasiadas conexiones. ✓
	- Poder modificar el número de conexiones por bloque. ✓
	- Poner que se puedan mostrar los números de los soles y ocultar. ✓
	- Desordenar el vector de cumulos para que las conexiones se hagan en orden random. ✓
	- Crear sistema de pintado de remarcado de saltos. ✓
	- Hacer sistema de animaciones puntuales o en X zona. ✓/2
	- Poder crear y borrar conexiones. ✓
	- Implementar Dijkstra. ✓
	- Poder entrar en un cúmulo.
*/
"use strict";
var Canvas = function () {
	this.init();
};

Canvas.prototype.init = function() {

	//Recibimos el elemento canvas

	this.jquery = {};
	this.data = {};
	this.canvas = {};
	this.enums = {};


	this.canvas.system = document.getElementById('micanvas');
	this.jquery.system = $(this.canvas.system);



	if (this.canvas.system && this.canvas.system.getContext) {

		this.contexto = this.canvas.system.getContext('2d');

		if (this.contexto) {

			this.setNaturalSize();
			this.events();
			this.loadImages();
			this.start();
			this.requestReDraw();
		}
	}
};

Canvas.prototype.start = function() {
	this.phase1();
};

Canvas.prototype.phase1 = function(first_argument) {
	var self = this;
	this.phase = 0;
	this.data.superCumulus = [];

	this.jquery.system.unbind("mouseup.phase1 touchend.phase1").bind("mouseup.phase1 touchend.phase1", function (e) {
		if(self.isClick(e)){
			Utils.getPointerCoordinates(e);
			self.data.superCumulus.push({
				x: (Utils.mouseLocation.x - self.eventsData.desplacedX) / self.eventsData.zoom_factor,
				y: (Utils.mouseLocation.y - self.eventsData.desplacedY) / self.eventsData.zoom_factor,
				size: Utils.configuration.superCumulusSize
			});
			//console.log(self.data.superCumulus);
			$(".datos").text("Supercúmulos: " + self.data.superCumulus.length);
			self.requestReDraw();
		}
		if(e.type == "touchend"){
			self.data.superCumulusRealTime = false;
		}
	});

	this.jquery.system.unbind("mousemove.phase1 touchmove.phase1").bind("mousemove.phase1 touchmove.phase1", function (e) {
			Utils.getPointerCoordinates(e);
			self.data.superCumulusRealTime = {
				x: (Utils.mouseLocation.x - self.eventsData.desplacedX) / self.eventsData.zoom_factor,
				y: (Utils.mouseLocation.y - self.eventsData.desplacedY) / self.eventsData.zoom_factor,
				size: Utils.configuration.superCumulusSize
			};
			//console.log(self.data.superCumulus);
			self.requestReDraw();
	});


	this.phase = 1;
	this.requestReDraw();

	$(".fase1").unbind().click(function () {
		self.phase1();
	});

	$(".siguiente_fase").unbind().click(function () {
		self.jquery.system.unbind("mousemove.phase1 touchmove.phase1");
		self.jquery.system.unbind("mouseup.phase1 touchend.phase1");
		$(".fase2").css({display: "block"});
		self.phase2();
	});
};

Canvas.prototype.phase2 = function() {

	var self = this;

	this.data.cumulus = [];

	this.phase2GenerateCumulus();

	this.data.cumulusPositionCache = new Array(this.data.cumulus.length);
	for (var i = this.data.cumulusPositionCache.length - 1; i >= 0; i--) {
		this.data.cumulusPositionCache[i] = {x: this.data.cumulus[i].x, y: this.data.cumulus[i].y, w: this.data.cumulus[i].s, h: this.data.cumulus[i].s};
	}

	$(".datos").text("Cúmulos: " + this.data.cumulus.length);
	//console.log(this.data.cumulusPositionCache.length);
	this.phase = 2;
	this.requestReDraw();

	$(".fase2").unbind().click(function () {
		self.phase2();
	});

	$(".siguiente_fase").unbind().click(function () {
		$(".fase3").css({display: "block"});
		self.phase3();
	});
};

Canvas.prototype.phase2GenerateCumulus = function() {
	var cumulus_distance = Utils.configuration.superCumulusSize;
	var cumulus = Utils.configuration.cumulusInSuperCumulus;
	var temp, distance_temp, l, iteratorLimit, tempCumulus;

	l = 0;
	for(var i = 0; i < this.data.superCumulus.length; i++){
		tempCumulus = Utils.configuration.cumulusInSuperCumulus;
		for (var j = 0; j < tempCumulus; j++) {
			iteratorLimit = 0;
			do{
				iteratorLimit++;
				temp = false;

				this.data.cumulus[l] = {
					id: l,
					type: "cumulus",
					superCumulus: i,
					x: this.data.superCumulus[i].x + Math.random() * cumulus_distance - cumulus_distance / 2,
					y: this.data.superCumulus[i].y + Math.random() * cumulus_distance - cumulus_distance / 2,
					s: Utils.configuration.cumulusSize,
					eventsData: {},
					conn: [],
					maximunConnections: 0,
					pathFindingData: false,
					debugData: {}
				};
				var k;
				for (k = 0; k < l; k++) {
					distance_temp = Math.abs(Math.sqrt( Math.pow(this.data.cumulus[l].x - this.data.cumulus[k].x, 2) + Math.pow(this.data.cumulus[l].y - this.data.cumulus[k].y, 2) ) );
					if(distance_temp < 450){
						temp = true;
					}
				}
			}while(temp && iteratorLimit < 1000);

			if(iteratorLimit >= 1000){
				this.data.cumulus.pop();
				break;
			}else{
				l++;
			}
		}
	}
};

Canvas.prototype.phase3 = function() {
	var self = this;
	var connections, v_connections, distance, index, temp, tempIndex, distances, denegated, denegatedTemp;
	var max_vector_jump_index = 500;
	var max_distance = 2000;
	var maxPreJumpDistance = Utils.configuration.superCumulusSize / 2;
	var foo;

	this.data.graph = [];

	max_vector_jump_index = Math.min(this.data.cumulus.length - 1, max_vector_jump_index);

	Utils.suffle(this.data.cumulus);

	for (var i = this.data.cumulus.length - 1; i >= 0; i--){
		this.data.cumulus[i].conn = [];
		this.data.cumulus[i].id = i;
		this.data.cumulus[i].maximunConnections = Utils.getRandomInt(Utils.configuration.minimunConnections, Utils.configuration.maximunConnections);
	}

	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {

		connections = this.data.cumulus[i].maximunConnections;
		v_connections = [];
		temp = 0;

		distances = this.phase3DistanceShort(this.data.cumulus, i);

		//this.data.cumulus[i].debugData.denegated = [];
		//this.data.cumulus[i].debugData.whileExit = [];

		for (var j = 0; j < connections && v_connections.length + this.data.cumulus[i].conn.length < this.data.cumulus[i].maximunConnections; j++) {
			do{
				denegated = false;
				temp++;

				if(this.data.cumulus[distances[temp].index].conn.length >= this.data.cumulus[distances[temp].index].maximunConnections ){
					denegated = true;
					/*this.data.cumulus[i].debugData.denegated.push({
						index: distances[temp].index,
						reason: "Maximum number of connections reached"
					});*/
				}else if( this.phase3LinkToMe(this.data.cumulus[distances[temp].index].conn, i) ){
					denegated = true;
					/*this.data.cumulus[i].debugData.denegated.push({
						index: distances[temp].index,
						reason: "Already connected"
					});*/
				}else if( ( denegatedTemp = this.phase3CheckIntersection(i, temp, distances)) !== false){
					denegated = true;
					/*this.data.cumulus[i].debugData.denegated.push({
						index: distances[temp].index,
						reason: "Intersection between " + denegatedTemp.cumulus1 + " and " + denegatedTemp.cumulus2
					});*/
				}else if(this.phase3CheckconnexionProximity(i, distances[temp].index, this.data.cumulus[i].x, this.data.cumulus[distances[temp].index].x, this.data.cumulus[i].y, this.data.cumulus[distances[temp].index].y )){
					denegated = true;
					/*this.data.cumulus[i].debugData.denegated.push({
						index: distances[temp].index,
						reason: "Conexión proximity"
					});*/
				}

			}while(	temp < max_vector_jump_index && denegated);

			//this.data.cumulus[i].debugData.whileExit.push({temp: temp, max_vector_jump_index: max_vector_jump_index, denegated: denegated});

			if(temp < max_vector_jump_index && distances[temp].distance < maxPreJumpDistance){
				v_connections.push(temp);
				if(distances[temp].distance > max_distance) break;
			}else{
				break;
			}
		}

		//this.data.cumulus[i].debugData.forExit = {j: j, connections: connections, v_connections_length: v_connections.length, this_data_cumulus_conn_length: this.data.cumulus[i].conn.length, this_data_cumulus_maximunConnections: this.data.cumulus[i].maximunConnections};

		temp = v_connections.length;
		//this.data.cumulus[i].debugData.distances = distances;
		//this.data.cumulus[i].debugData.linksCreated = temp;
		for (var k = 0; k < temp; k++) {
			tempIndex = this.data.graph.length;
			this.data.graph.push({firstNode: i, secondNode: distances[v_connections[k]].index, id: tempIndex, marked: false, markedType: {jump: {marked: false, color: 0}, path: { marked: false}}, weight: 1000});

			this.data.cumulus[i].conn.push(this.data.graph[tempIndex]);
			this.data.cumulus[distances[v_connections[k]].index].conn.push(this.data.graph[tempIndex]);
		}

	}

	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
		if(this.data.cumulus[i].conn.length < 2) this.eraseCumulus(i);
	};

	this.phase = 3;
	this.requestReDraw();

	$(".fase3").unbind().click(function () {
		self.phase3();
	});

	$(".siguiente_fase").unbind().click(function () {
		$(".fase4").css({display: "block"});
		self.phase4();
	});
	//$(".siguiente_fase").unbind().css({display: "none"});
};

Canvas.prototype.phase4 = function() {

	for (var i = 0; i < this.data.cumulus.length; i++) {
		this.phase4generateSolarSystems(i);
	};

	this.phase4Jumps();

	this.phase = 4;
	this.requestReDraw();

	$(".fase2").unbind().click(function () {
		self.phase2();
	});
	$(".siguiente_fase").unbind().css({display: "none"});
};

Canvas.prototype.phase4generateSolarSystems = function(i) {
	var radiusZone = 100;
	var nodeTemp, xTemp, yTemp, idTemp, l, starGates, systemsInCumulus, iteratorLimit, temp, distance_temp, angle;

	//Por cada cúmulo, hay que sacar los ángulos de los cúmulos con que contecta, poner un nodo tipo puerta ahí y luego rellenar el cúmulo con nodos en posiciones random y para finalizar aplicar el algoritmo del paso 3 para conectarlos. Comprobar que todos estén conectados y aceptar.

	starGates = [];
	radiusZone = 100;
	l=0;
	xTemp = this.data.cumulus[i].x;
	yTemp = this.data.cumulus[i].y;
	idTemp = this.data.cumulus[i].id;
	for (var j = this.data.cumulus[i].conn.length - 1; j >= 0; j--) {
		if(this.data.cumulus[i].conn[j].firstNode == idTemp) nodeTemp = this.data.cumulus[this.data.cumulus[i].conn[j].secondNode];
		else nodeTemp = this.data.cumulus[this.data.cumulus[i].conn[j].firstNode];

		angle = Math.atan2( nodeTemp.y - yTemp, nodeTemp.x - xTemp );

		starGates[l] = {
			id: l,
			type: "starGate",
			cumulus: i,
			x: xTemp + radiusZone * Math.cos(angle),
			y: yTemp + radiusZone * Math.sin(angle),
			s: 5,
			eventsData: {},
			conn: [],
			maximunConnections: 0,
			pathFindingData: false
		};
		l++;
	}
	radiusZone = 85;
	//Ahora ponemos los puntos sobre la circunferencia.
	systemsInCumulus = Utils.configuration.systemsInCumulus;
	iteratorLimit = 0;
	for (var j = 0; j < systemsInCumulus; j++) {
		do{
			iteratorLimit++;
			temp = false;

			starGates[l] = {
				id: l,
				type: "solarSystem",
				cumulus: i,
				x: xTemp + (Math.random() * radiusZone*2 - radiusZone),
				y: yTemp + (Math.random() * radiusZone*2 - radiusZone),
				s: 1,
				eventsData: {},
				conn: [],
				maximunConnections: 0,
				pathFindingData: false
			};

			var k;
			if(Math.sqrt( Math.pow(xTemp - starGates[l].x, 2) + Math.pow(yTemp - starGates[l].y, 2) ) > radiusZone)
				temp = true;
			else{
				for (k = 0; k < l; k++) {
					if( Math.sqrt( Math.pow(starGates[l].x - starGates[k].x, 2) + Math.pow(starGates[l].y - starGates[k].y, 2) ) < 15 ){
						temp = true;
					}
				}
			}
		}while(temp && iteratorLimit < 1000);

		if(iteratorLimit >= 500){
			starGates.pop();
			break;
		}else{
			l++;
		}
	}
	this.data.cumulus[i].systems = {};
	this.data.cumulus[i].systems.solarSystems = starGates;
	this.data.cumulus[i].systems.graph = [];
};

Canvas.prototype.phase4Jumps = function() {
	var self = this;
	var connections, v_connections, distance, index, temp, tempIndex, distances, denegated, denegatedTemp;
	var max_vector_jump_index = 500;
	var notAllConnected, nodeEmpty, notAllConnectedCounter;

	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {

		max_vector_jump_index = this.data.cumulus[i].systems.solarSystems.length - 1;
		this.data.cumulus[i].systems.graph = [];


		notAllConnectedCounter = 0;
		notAllConnected = true;
		while(notAllConnected && notAllConnectedCounter < 100){
			notAllConnectedCounter++;
			this.data.cumulus[i].systems.graph = [];
			notAllConnected = false;

			Utils.suffle(this.data.cumulus[i].systems.solarSystems);

			for (var j = this.data.cumulus[i].systems.solarSystems.length - 1; j >= 0; j--){
				this.data.cumulus[i].systems.solarSystems[j].conn = [];
				this.data.cumulus[i].systems.solarSystems[j].id = j;
				this.data.cumulus[i].systems.solarSystems[j].maximunConnections = 3;
			}

			for (var h = this.data.cumulus[i].systems.solarSystems.length - 1; h >= 0; h--) {

				connections = this.data.cumulus[i].systems.solarSystems[h].maximunConnections;

				v_connections = [];
				temp = 0;

				distances = this.phase3DistanceShort(this.data.cumulus[i].systems.solarSystems, h);

				for (var j = 0; j < connections && v_connections.length + this.data.cumulus[i].systems.solarSystems[h].conn.length < this.data.cumulus[i].systems.solarSystems[h].maximunConnections; j++) {
					do{
						denegated = false;
						temp++;

						if(this.data.cumulus[i].systems.solarSystems[distances[temp].index].conn.length >= this.data.cumulus[i].systems.solarSystems[distances[temp].index].maximunConnections){
							denegated = true;
						}else if( this.phase3LinkToMe(this.data.cumulus[i].systems.solarSystems[distances[temp].index].conn, h) ){
							denegated = true;
						}else if( ( denegatedTemp = this.phase4CheckIntersection(i, h, temp, distances)) !== false){
							denegated = true;
						}else if(this.phase4CheckconnexionProximity(i, h, distances[temp].index, this.data.cumulus[i].systems.solarSystems[h].x, this.data.cumulus[i].systems.solarSystems[distances[temp].index].x, this.data.cumulus[i].systems.solarSystems[h].y, this.data.cumulus[i].systems.solarSystems[distances[temp].index].y )){
							denegated = true;
						}else if(this.data.cumulus[i].systems.solarSystems[h].type === "starGate" && this.data.cumulus[i].systems.solarSystems[distances[temp].index].type === "starGate" ){
							denegated = true;
						}

					}while(	temp < max_vector_jump_index && denegated);


					if(temp < max_vector_jump_index){
						v_connections.push(temp);
					}else{
						break;
					}
				}

				temp = v_connections.length;
				for (var k = 0; k < temp; k++) {
					tempIndex = this.data.cumulus[i].systems.graph.length;
					this.data.cumulus[i].systems.graph.push({firstNode: h, secondNode: distances[v_connections[k]].index, id: tempIndex, marked: false, markedType: {jump: {marked: false, color: 0}, path: { marked: false}}, weight: 1000});

					this.data.cumulus[i].systems.solarSystems[h].conn.push(this.data.cumulus[i].systems.graph[tempIndex]);
					this.data.cumulus[i].systems.solarSystems[distances[v_connections[k]].index].conn.push(this.data.cumulus[i].systems.graph[tempIndex]);
				}
			}

			nodeEmpty = false;
			for (var j = this.data.cumulus[i].systems.solarSystems.length - 1; j >= 0; j--) {
				if(this.data.cumulus[i].systems.solarSystems[j].conn.length < 2){
					this.phase4generateSolarSystems(i);
					nodeEmpty = true;
					break;
				}
			};

			if(nodeEmpty) notAllConnected = true;
		}

		if(notAllConnectedCounter >= 100) console.log("shit!");
	}
};

Canvas.prototype.phase3LinkToMe = function(v_index, me) {
	for (var i = v_index.length - 1; i >= 0; i--) {
		if(v_index[i].firstNode === me || v_index[i].secondNode === me) return true;
	}
	return false;
};

Canvas.prototype.phase3DistanceShort = function(cumulus, i) {
	var cumulusLength = cumulus.length;
	var distances = new Array(cumulusLength - 1);

	for (var l = 0; l < cumulusLength; l++) { //Rellenamos el vector con las distancias
		distances[l] = {
			index: l,
			distance: Math.sqrt( Math.pow(cumulus[i].x - cumulus[l].x, 2) + Math.pow(cumulus[i].y - cumulus[l].y, 2) )
		};
	}

	distances.sort(function (a, b) {
		return a.distance - b.distance;
	});

	return distances;
};

Canvas.prototype.phase3CheckconnexionProximity = function(index1, index2, x1, x2, y1, y2) {
	var cumulus = this.data.cumulus;
	var temp, eqB, eqA, distancia;
	var distance_min = Utils.configuration.minDistanceCumulusLink;
	var xd1, xd2, yd1, yd2;

	xd1 = x1;
	xd2 = x2;
	yd1 = y1;
	yd2 = y2;

	if(xd2 < xd1){
		temp = xd1;
		xd1 = xd2;
		xd2 = temp;
	}

	if(yd2 < yd1){
		temp = yd1;
		yd1 = yd2;
		yd2 = temp;
	}


	for (var j = cumulus.length - 1; j >= 0; j--) {
		//miramos si el cúmulo en cuestión está dentr del rectangulo que rodea al segmento.
		if(	cumulus[j].x > xd1 - distance_min &&
			cumulus[j].x < xd2 + distance_min &&
			cumulus[j].y > yd1 - distance_min &&
			cumulus[j].y < yd2 + distance_min){ //Ok, entonces procedemos a mirar si el sol está cerca de la línea.

			eqA = (y2 - y1) / (x2 - x1);
			eqB = y1 - (eqA * x1);
			distancia = Math.abs(eqA * cumulus[j].x - cumulus[j].y + eqB ) / Math.sqrt(eqA * eqA + 1);

			//console.log("Posible distance Breaker in cumulus: " + j + ", Distance: " + distancia + ", By: " + index1 + " and " + index2);
			if(distancia < distance_min && j != index1 && j != index2){
				//console.log("---> Distance Breaker in cumulus: " + j + ", Distance: " + distancia + ", By: " + index1 + " and " + index2);
				return true;
			}
		}
	}
	return false;
};

Canvas.prototype.phase3CheckIntersection = function(i, temp, distances) {
	var tempLength = this.data.cumulus.length;
	var tempLength2;
	var intersect = false;

	for (var j = this.data.graph.length - 1; j >= 0; j--) {
		if(this.lineIntersect(
			this.data.cumulus[i].x,
			this.data.cumulus[i].y,
			this.data.cumulus[ distances[temp].index ].x,
			this.data.cumulus[ distances[temp].index ].y,
			this.data.cumulus[ this.data.graph[j].firstNode ].x,
			this.data.cumulus[ this.data.graph[j].firstNode ].y,
			this.data.cumulus[ this.data.graph[j].secondNode ].x,
			this.data.cumulus[ this.data.graph[j].secondNode ].y)
		){
			return {
				cumulus1: this.data.graph[j].firstNode,
				cumulus2: this.data.graph[j].secondNode
			};
		}
	}

	//return intersect;
	return false;
};

Canvas.prototype.phase4CheckconnexionProximity = function(i, index1, index2, x1, x2, y1, y2) {
	var cumulus = this.data.cumulus[i].systems.solarSystems;
	var temp, eqB, eqA, distancia;
	var distance_min = 5;
	var xd1, xd2, yd1, yd2;

	xd1 = x1;
	xd2 = x2;
	yd1 = y1;
	yd2 = y2;

	if(xd2 < xd1){
		temp = xd1;
		xd1 = xd2;
		xd2 = temp;
	}

	if(yd2 < yd1){
		temp = yd1;
		yd1 = yd2;
		yd2 = temp;
	}


	for (var j = cumulus.length - 1; j >= 0; j--) {
		//miramos si el cúmulo en cuestión está dentro del rectangulo que rodea al segmento.
		if(	cumulus[j].x > xd1 - distance_min &&
			cumulus[j].x < xd2 + distance_min &&
			cumulus[j].y > yd1 - distance_min &&
			cumulus[j].y < yd2 + distance_min){ //Ok, entonces procedemos a mirar si el sol está cerca de la línea.

			eqA = (y2 - y1) / (x2 - x1);
			eqB = y1 - (eqA * x1);
			distancia = Math.abs(eqA * cumulus[j].x - cumulus[j].y + eqB ) / Math.sqrt(eqA * eqA + 1);

			//console.log("Posible distance Breaker in cumulus: " + j + ", Distance: " + distancia + ", By: " + index1 + " and " + index2);
			if(distancia < distance_min && j != index1 && j != index2){
				//console.log("---> Distance Breaker in cumulus: " + j + ", Distance: " + distancia + ", By: " + index1 + " and " + index2);
				return true;
			}
		}
	}
	return false;
};

Canvas.prototype.phase4CheckIntersection = function(i, index, temp, distances) {
	var tempLength = this.data.cumulus[i].systems.solarSystems.length;
	var tempLength2;
	var intersect = false;

	for (var j = this.data.cumulus[i].systems.graph.length - 1; j >= 0; j--) {
		if(this.lineIntersect(
			this.data.cumulus[i].systems.solarSystems[ index ].x,
			this.data.cumulus[i].systems.solarSystems[ index ].y,
			this.data.cumulus[i].systems.solarSystems[ distances[temp].index ].x,
			this.data.cumulus[i].systems.solarSystems[ distances[temp].index ].y,
			this.data.cumulus[i].systems.solarSystems[ this.data.cumulus[i].systems.graph[j].firstNode ].x,
			this.data.cumulus[i].systems.solarSystems[ this.data.cumulus[i].systems.graph[j].firstNode ].y,
			this.data.cumulus[i].systems.solarSystems[ this.data.cumulus[i].systems.graph[j].secondNode ].x,
			this.data.cumulus[i].systems.solarSystems[ this.data.cumulus[i].systems.graph[j].secondNode ].y)
		){
			return {
				cumulus1: this.data.cumulus[i].systems.graph[j].firstNode,
				cumulus2: this.data.cumulus[i].systems.graph[j].secondNode
			};
		}
	}

	//return intersect;
	return false;
};

Canvas.prototype.lineIntersect = function(x1,y1,x2,y2, x3,y3,x4,y4) {
	var x=((x1*y2-y1*x2)*(x3-x4)-(x1-x2)*(x3*y4-y3*x4))/((x1-x2)*(y3-y4)-(y1-y2)*(x3-x4));
	var y=((x1*y2-y1*x2)*(y3-y4)-(y1-y2)*(x3*y4-y3*x4))/((x1-x2)*(y3-y4)-(y1-y2)*(x3-x4));
	if (isNaN(x)||isNaN(y)) {
		return false;
	}else if(x3 == x1 || x2 == x4 || x2 == x3 || x1 == x4){
		return false;
	} else {
		if (x1>=x2) {
			if (!(x2<=x&&x<=x1)) {return false;}
		} else {
			if (!(x1<=x&&x<=x2)) {return false;}
		}
		if (y1>=y2) {
			if (!(y2<=y&&y<=y1)) {return false;}
		} else {
			if (!(y1<=y&&y<=y2)) {return false;}
		}
		if (x3>=x4) {
			if (!(x4<=x&&x<=x3)) {return false;}
		} else {
			if (!(x3<=x&&x<=x4)) {return false;}
		}
		if (y3>=y4) {
			if (!(y4<=y&&y<=y3)) {return false;}
		} else {
			if (!(y3<=y&&y<=y4)) {return false;}
		}
	}
	return true;
};

Canvas.prototype.loadImages = function() {

	this.img = {};
	this.eventsData.contentLoaded = false;

	var imageUrls = ["marcador_prueba_cumulo.png"];

	var imageLoader = new LoadImages({
		images: imageUrls,
		finishCallback: this.finishLoadImages,
		finishCallbackContext: this,
	});

	this.img.predefinedCumulusSmall = Utils.createCanvas(2, 2, function (canvas) {
		canvas.save();
		canvas.fillStyle = "#ffffff";
		canvas.beginPath();
		canvas.rect(0, 0, 2, 2);
		canvas.fill();
		canvas.restore();
	});
};

Canvas.prototype.finishLoadImages = function(images, index, cuantity) {
	this.img.predefinedCumulusBig = images[0];
	this.eventsData.contentLoaded = true;
	this.requestReDraw();
};

Canvas.prototype.events = function() {
	var self = this;

	this.drawData = {};
	this.eventsData = {};

	this.eventsData.enum = {};
	this.eventsData.enum.cursors = {normal: 1, pointer: 2, move: 3};

	this.drawData.request = false;
	this.drawData.drawing = false;
	this.drawData.jumpMarkedLinks = [];
	this.drawData.pathFindingMarkedLinks = [];
	this.eventsData.pathFindingCumulus = false;

	this.eventsData.originalDesplacedX = 0;
	this.eventsData.originalDesplacedY = 0;
	this.eventsData.cursorType = this.eventsData.enum.cursors.normal;

	this.eventsData.zoom_factor = Utils.configuration.minZoom;

	this.eventsData.desplacedX = this.data.viewportSize.x / 2 - 30000 * this.eventsData.zoom_factor / 2;
	this.eventsData.desplacedY = this.data.viewportSize.y / 2 - 30000 * this.eventsData.zoom_factor / 2;

	this.eventsData.mouseDown = false;
	this.eventsData.dragOn = false;
	this.eventsData.inDrag = false;
	this.eventsData.moveInterval = null;
	this.eventsData.cumulusNumbersDrawFlag = false;
	this.eventsData.initialMousePosition = { x: 0, y: 0};

	this.eventsData.hoverCumulus = -1;
	this.eventsData.selectedCumulus = -1;

	this.data.desplacedDrag = {x: 0, y: 0};

	self.eventsData.event = null;

	this.data.canvasCache = {};
	this.data.canvasCache.cumulus = {};
	this.data.canvasCache.cumulus.canvas = document.createElement('canvas');
	this.data.canvasCache.cumulus.ctx = this.data.canvasCache.cumulus.canvas.getContext('2d');
	this.data.canvasCache.configuration = {};
	this.data.canvasCache.configuration.lastSize = 0;
	self.generateCumulusIcons();


	this.jquery.system.bind('mousewheel', function (event, delta, deltaX, deltaY) {
		self.zoomSystem(event, delta, deltaX, deltaY);
	});

	this.jquery.system.bind('mousedown touchstart', function (e) {
		self.pointerDown(e);
	});

	$(document).focus(function () {
		self.requestReDraw();
	});

	$(document).bind('mouseup touchend', function mouseup_function (e) {
		self.pointerUp(e);
	});

	//this.jquery.system.bind('mousemove', function (e) {
	$(document).bind('mousemove.system touchmove.system', function (e) {
		self.pointerMove(e);
	});

	self.reDraw();
};

Canvas.prototype.reDraw = function() {
	if(this.drawData.request && !this.drawData.drawing){
		this.drawData.drawing = true;
		this.drawData.request = false;


		if(this.phase > 1) this.updateCumulusPositions();

		this.contexto.clearRect ( 0 , 0 , this.canvas.system.width , this.canvas.system.height );

		this.drawSystem();

		this.drawData.drawing = false;
	}
	requestAnimationFrame(this.reDraw.bind(this));
};

Canvas.prototype.requestReDraw = function() {
	this.drawData.request = true;
	return 0;
};

Canvas.prototype.pointerMove = function(e) {
	if(this.eventsData.dragOn){
		this.eventsData.event = e;
		this.data.moveCounter++;
	}
	if(this.eventsData.mouseDown && !this.eventsData.dragOn){
		var self = this;
		this.eventsData.event = e;
		this.eventsData.dragOn = true;
		this.eventsData.originalDesplacedX = this.eventsData.desplacedX;
		this.eventsData.originalDesplacedY = this.eventsData.desplacedY;
		this.moveSystem();
		this.eventsData.moveInterval = setInterval(function () {
			self.moveSystem();
		}, 5);
	}
	if(!this.eventsData.mouseDown && !this.eventsData.dragOn){ //Si no está el ratón bajado y no estamos arrastrando eso quiere decir que tenemos el ratón suelto. Por lo que miramos si está encima de un cúmulo
		this.checkCumulusHoverAndSetPointer(e);
	}
	return 0;
};

Canvas.prototype.pointerUp = function(e) {
	if(e.which == 1 || e.originalEvent.touches){
		this.data.moveCounter = 0;
		this.eventsData.mouseDown = false;
		this.eventsData.dragOn = false;
		clearInterval(this.eventsData.moveInterval);
		this.checkCumulusHoverAndSetPointer(e);
	}
	if(this.isClick(e)){ //Además de dejar de arrastrar el mapa. Si la acción que se ha hecho es click ejecutamos la parte de click en el mapa.
		this.mapClick(e);
	}
	return 0;
};

Canvas.prototype.pointerDown = function(e) {
	if((e.which == 1 || e.originalEvent.touches) && !this.eventsData.mouseDown){
		this.data.moveCounter = 0;
		e.preventDefault();
		this.eventsData.mouseDown = true;
		this.eventsData.dragOn = false;
		clearInterval(this.eventsData.moveInterval);

		Utils.getPointerCoordinates(e);

		this.eventsData.initialMousePosition.x	= Utils.mouseLocation.x;
		this.eventsData.initialMousePosition.y	= Utils.mouseLocation.y;

		if(this.eventsData.cursorType != this.eventsData.enum.cursors.move) {
			this.eventsData.cursorType = this.eventsData.enum.cursors.move;
			this.canvas.system.style.cursor = "move";
		}
	}
	return 0;
};

Canvas.prototype.checkCumulusHoverAndSetPointer = function(e) {
	Utils.getPointerCoordinates(e);
	var temp = this.isCumulus(Utils.mouseLocation.x, Utils.mouseLocation.y);
	if(temp !== false){
		if(this.eventsData.cursorType != this.eventsData.enum.cursors.pointer) {
			this.eventsData.cursorType = this.eventsData.enum.cursors.pointer;
			this.canvas.system.style.cursor = "pointer";
		}
		if(this.eventsData.hoverCumulus != temp){
			this.eventsData.hoverCumulus = temp;
			this.requestReDraw();
		}
	}else{
		if(this.eventsData.cursorType != this.eventsData.enum.cursors.normal) {
			this.eventsData.cursorType = this.eventsData.enum.cursors.normal;
			this.canvas.system.style.cursor = "";
		}
		if(this.phase == 1 || this.eventsData.hoverCumulus !== -1) this.requestReDraw();
		this.eventsData.hoverCumulus = -1;
	}
};

Canvas.prototype.isClick = function(e) {
	if(e.type != "mouseup" && e.type != "touchend") return false;
	if(this.data.moveCounter > 10) return false;
	Utils.getPointerCoordinates(e);
	if( Math.sqrt(Math.pow(this.eventsData.initialMousePosition.x - Utils.mouseLocation.x, 2) + Math.pow(this.eventsData.initialMousePosition.y - Utils.mouseLocation.y, 2)) < 15 ) return true;
	else return false;
};

Canvas.prototype.changueCumulusNumbersDrawFlag = function(flipflop) {
	this.eventsData.cumulusNumbersDrawFlag = flipflop;
	this.requestReDraw();
};

Canvas.prototype.mapClick = function(e) {
	Utils.getPointerCoordinates(e);
	var temp = this.isCumulus(Utils.mouseLocation.x, Utils.mouseLocation.y);
	if(temp !== false){
		if(e.ctrlKey && e.shiftKey){
			if(this.eventsData.selectedCumulus != -1){
				this.findPath(temp, this.eventsData.selectedCumulus);
			}
		}else if(e.ctrlKey){
			if( this.areCumulusConnected(this.data.cumulus[temp], this.data.cumulus[this.eventsData.selectedCumulus]) ){
				this.disconnectCumulus(this.data.cumulus[temp], this.data.cumulus[this.eventsData.selectedCumulus]);
			}else{
				this.connectCumulus(this.data.cumulus[temp], this.data.cumulus[this.eventsData.selectedCumulus]);
			}
			this.cumulusClick();
		}else if(e.shiftKey){
			this.eraseCumulus(temp);
			this.cumulusClick();
		}else{
			this.eventsData.selectedCumulus = temp;
			//Ahora toca llamar a quien dedice que se hace cuando se llama a un cúmulo.
			this.cumulusClick();
		}
	}else{
		if(e.shiftKey){
			this.createCumulus(Utils.mouseLocation.x, Utils.mouseLocation.y);
		}else{
			this.removeJumpMarkOnCumulus();
			this.eventsData.selectedCumulus = -1;
		}
	}
	this.requestReDraw();
};

Canvas.prototype.isCumulus = function(mouseX, mouseY) {
	if(this.phase >= 2){
		var cumulus;
		if(this.eventsData.zoom_factor < 0.039){
			for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
				cumulus = this.data.cumulus[i];
				if(Math.abs(cumulus.x * this.eventsData.zoom_factor + this.eventsData.desplacedX - mouseX - 2) <= 3 && Math.abs(cumulus.y * this.eventsData.zoom_factor + this.eventsData.desplacedY - mouseY - 2) <= 3 ){
					//console.log("Cumulus selected: " + i);
					return i;
				}
			};
		}else{
			for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
				cumulus = this.data.cumulus[i];
				if(Math.abs(cumulus.x * this.eventsData.zoom_factor + this.eventsData.desplacedX - mouseX) <= cumulus.s / 2 * this.eventsData.zoom_factor && Math.abs(cumulus.y * this.eventsData.zoom_factor + this.eventsData.desplacedY - mouseY) <= cumulus.s / 2 * this.eventsData.zoom_factor ){
					//console.log("Cumulus selected: " + i);
					return i;
				}
			};
		}
	}
	return false;
};

Canvas.prototype.cumulusClick = function() {
	if(this.eventsData.selectedCumulus !== -1){
		//Aquí tenemos que hacer las operaciones correspondientes a cuando se selecciona un cúmulo.
		//Paso 1: Marcar varios saltos (2 de momento) a partir del cúmulo seleccionado. Para eso recorremos con una función recursiva.
		this.removeJumpMarkOnCumulus();

		//marcamos los links a X saltos de distancia (tercer parametro)
		this.graphWalk(this.data.cumulus, this.data.cumulus[this.eventsData.selectedCumulus], Utils.configuration.maxJumpColorShow, this.jumpMarkLink, 0, this.data.cumulus[this.eventsData.selectedCumulus], false, []);

		//Reordenamos el vector de links marcados para que al dibujarlo tengamos que hacer menos cambios de contexto
		this.drawData.jumpMarkedLinks.sort(function (a, b) {
			return a.markedType.jump.color - b.markedType.jump.color;
		});
	}

	return false;
};

Canvas.prototype.findPath = function(cumulus1, cumulus2) {

	this.eventsData.pathFindingCumulus = [cumulus1, cumulus2];

	var way = this.pathFinding(this.data.cumulus[cumulus1], this.data.cumulus[cumulus2], []);

	this.removePathFindingMarkedLinks();

	if(way !== false){
		for (var i = way.length - 1; i >= 0; i--) {
			this.data.graph[way[i]].marked = true;
			this.data.graph[way[i]].markedType.path.marked = true;
			this.drawData.pathFindingMarkedLinks.push(this.data.graph[way[i]]);
		}
	}
};

Canvas.prototype.createCumulus = function(x, y) {
	this.data.cumulus.push({
		id: this.data.cumulus.length,
		type: "cumulus",
		superCumulus: null,
		x: (x - this.eventsData.desplacedX) / this.eventsData.zoom_factor,
		y: (y - this.eventsData.desplacedY) / this.eventsData.zoom_factor,
		w: 150,
		h: 150,
		s: Utils.configuration.cumulusSize,
		eventsData: {},
		conn: [],
		maximunConnections: 0,
		pathFindingData: false,
		debugData: {}
	});
};

Canvas.prototype.eraseCumulus = function(index) {

	for (var i = this.data.cumulus[index].conn.length - 1; i >= 0; i--) {
		if(this.data.cumulus[index].conn[i].firstNode == this.data.cumulus[index].id){
			this.disconnectCumulus(this.data.cumulus[index], this.data.cumulus[this.data.cumulus[index].conn[i].secondNode]);
		}else{
			this.disconnectCumulus(this.data.cumulus[index], this.data.cumulus[this.data.cumulus[index].conn[i].firstNode]);
		}
	}

	this.data.cumulus.splice(index, 1);
	this.reDoCumulusIds();
	/*Reajuste de indices*/
	for (var i = this.data.graph.length - 1; i >= 0; i--) {
		if(this.data.graph[i].firstNode > index) this.data.graph[i].firstNode--;
		if(this.data.graph[i].secondNode > index) this.data.graph[i].secondNode--;
	}
	if(this.eventsData.pathFindingCumulus[0] > index) this.eventsData.pathFindingCumulus[0]--;
	if(this.eventsData.pathFindingCumulus[1] > index) this.eventsData.pathFindingCumulus[1]--;
	if(this.eventsData.selectedCumulus === index){
		this.removeJumpMarkOnCumulus();
		this.eventsData.selectedCumulus = -1;
	}else if(this.eventsData.selectedCumulus > index) this.eventsData.selectedCumulus--;


	this.eventsData.hoverCumulus = -1;

};

Canvas.prototype.connectCumulus = function(cumulus1, cumulus2) {
	if(cumulus1.id == cumulus2.id) return false;
	var tempIndex = this.data.graph.length;
	this.data.graph.push({firstNode: cumulus1.id, secondNode: cumulus2.id, id: tempIndex, marked: false, markedType: {jump: {marked: false, color: 0}, path: { marked: false}}, weight: 1000});

	cumulus1.conn.push(this.data.graph[tempIndex]);
	cumulus2.conn.push(this.data.graph[tempIndex]);

	if(this.eventsData.pathFindingCumulus !== false) this.findPath(this.eventsData.pathFindingCumulus[0], this.eventsData.pathFindingCumulus[1]);
	return false;
};

Canvas.prototype.disconnectCumulus = function(cumulus1, cumulus2) {
	//if(cumulus1.id == cumulus2.id) return false;
	var linkId = -1;

	for (var i = 0; i < cumulus1.conn.length; i++) {
		if(cumulus1.conn[i].firstNode == cumulus2.id || cumulus1.conn[i].secondNode == cumulus2.id){
			linkId = cumulus1.conn[i].id;
			cumulus1.conn.splice(i, 1);
		}
	}

	for (var i = 0; i < cumulus2.conn.length; i++) {
		if(cumulus2.conn[i].firstNode == cumulus1.id || cumulus2.conn[i].secondNode == cumulus1.id){
			cumulus2.conn.splice(i, 1);
		}
	}

	this.removeGraphLink(linkId);
	if(this.eventsData.pathFindingCumulus !== false) this.findPath(this.eventsData.pathFindingCumulus[0], this.eventsData.pathFindingCumulus[1]);
	return false;
};

Canvas.prototype.removeGraphLink = function(linkId) {
	this.data.graph.splice(linkId, 1);

	this.reDoGraphIds();
};

Canvas.prototype.reDoGraphIds = function() {
	for (var i = this.data.graph.length - 1; i >= 0; i--) {
		this.data.graph[i].id = i;
	}
};

Canvas.prototype.reDoCumulusIds = function() {
	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
		this.data.cumulus[i].id = i;
	}
};

Canvas.prototype.areCumulusConnected = function(cumulus1, cumulus2) {
	for (var i = 0; i < cumulus1.conn.length; i++) {
		if(cumulus1.conn[i].firstNode == cumulus2.id || cumulus1.conn[i].secondNode == cumulus2.id ){
			return true;
		}
	}
	return false;
};

Canvas.prototype.isCumulusMarked = function(link) {
	if(link.markedType.jump.marked || link.markedType.path.marked){
		link.marked = true;
		return true;
	} else{
		link.marked = false;
		return false;
	}
};

Canvas.prototype.removePathFindingMarkedLinks = function() {
	//Borramos los links marcados.
	for (var i = this.drawData.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
		this.drawData.pathFindingMarkedLinks[i].markedType.path.marked = false;
		this.isCumulusMarked(this.drawData.pathFindingMarkedLinks[i]);
	}
	//borramos el vector de los links marcados
	this.drawData.pathFindingMarkedLinks = [];
};

Canvas.prototype.removeJumpMarkOnCumulus = function() {
	//Borramos los links marcados.
	for (var i = this.drawData.jumpMarkedLinks.length - 1; i >= 0; i--) {
		this.drawData.jumpMarkedLinks[i].markedType.jump.marked = false;
		this.isCumulusMarked(this.drawData.jumpMarkedLinks[i]);
	}
	//borramos el vector de los links marcados
	this.drawData.jumpMarkedLinks = [];
};

Canvas.prototype.jumpMarkLink = function(actualNode, link, madeJumps) {
	if(link !== false){
		if(link.markedType.jump.marked === false || link.markedType.jump.color > madeJumps){
			link.markedType.marked = true;
			link.markedType.jump.marked = true;
			link.markedType.jump.color = madeJumps;
			this.drawData.jumpMarkedLinks.push(link);
		}
	}
	return false;
};

Canvas.prototype.graphWalk = function(graph, actualNode, maxJumps, funct, madeJumps, prevNode, link) { //madeJumps tiene que ser 0 en la primera llamada. A la funct le pasa this como contexto.
	//Este metodo recorre el grafo recursivamente desde un punto inicial haciendo X saltos y en cada uno ejecuta una función. A esta función le pasa el número de saltos que hay hasta el inicio y el nodo.
	if(typeof(madeJumps) === "undefined") madeJumps = 0;
	if(typeof(prevNode) === "undefined") prevNode = actualNode;

	funct.call(this, actualNode, link, madeJumps);

	if(madeJumps < maxJumps){
		for (var i = actualNode.conn.length - 1; i >= 0; i--) {
			if(actualNode.conn[i].firstNode == actualNode.id){
				this.graphWalk(graph, graph[actualNode.conn[i].secondNode], maxJumps, funct, madeJumps + 1, actualNode, actualNode.conn[i]);
			}else{
				this.graphWalk(graph, graph[actualNode.conn[i].firstNode], maxJumps, funct, madeJumps + 1, actualNode, actualNode.conn[i]);
			}
		}
	}

	return false;
};

Canvas.prototype.pathFinding = function(start, end, excluded) { //Dijkstra

	var self = this;

	for (var i = this.data.cumulus.length - 1; i >= 0; i--) { //Borramos cualquier ratro de una ejecución anterior.
		this.data.cumulus[i].pathFindingData = false;
	}
	/*Dijkstra Start*/
	start.pathFindingData = {referer: start.id, weight: 0, closed: false, refererConn: -1}; //iniciamos el primero
	var waitingFix = [start.id];
	var actual = start;
	var modifyNode = false;
	var tempWeight = 0;

	while(waitingFix.length > 0){

		actual.pathFindingData.closed = true;

		for (var i = actual.conn.length - 1; i >= 0; i--) {
			if(actual.conn[i].firstNode === actual.id){
				modifyNode = this.data.cumulus[actual.conn[i].secondNode];
			}else{
				modifyNode = this.data.cumulus[actual.conn[i].firstNode];
			}

			if(modifyNode.pathFindingData === false){
				modifyNode.pathFindingData = { weight: -1, referer: -1, closed: false };
			}

			if(modifyNode.pathFindingData.closed === false && excluded.indexOf(modifyNode.id) === -1){
				tempWeight = actual.pathFindingData.weight + actual.conn[i].weight;

				if(modifyNode.pathFindingData.weight > tempWeight || modifyNode.pathFindingData.weight === -1){
					modifyNode.pathFindingData.weight = tempWeight;
					modifyNode.pathFindingData.referer = actual.id;
					modifyNode.pathFindingData.refererConn = actual.conn[i].id;
				}

				if(waitingFix.indexOf(modifyNode.id) === -1) waitingFix.push(modifyNode.id);
			}
		}

		waitingFix.shift();

		waitingFix.sort(function (a, b) {
			return self.data.cumulus[a].pathFindingData.weight - self.data.cumulus[b].pathFindingData.weight;
		});

		actual = this.data.cumulus[ waitingFix[0] ];
	};
	/*Dijkstra End*/
	/*En teoría con esto ya están resueltas las referencias. Ahora lo que haremos es sacar la ruta partiendo de end.*/

	var cumulusCuantity = this.data.cumulus.length;
	var temp = 0;
	var way = [];
	actual = end;

	if(actual.pathFindingData === false) return false;

	while(actual.id != start.id && temp <= cumulusCuantity){
		way.push(actual.pathFindingData.refererConn);
		actual = this.data.cumulus[actual.pathFindingData.referer];
		temp++;
	}; //Y con esto en teoría ya tenemos el camino... Veremos a ver que sale.

	return way;
};

Canvas.prototype.zoomSystem = function(e, delta, deltaX, deltaY) {
	var growth;
	if(delta > 0){
		growth = 1 + 0.04 * ((delta > 1) ? delta : 1);

		if(this.eventsData.zoom_factor * growth > Utils.configuration.maxZoom){
			growth =  Utils.configuration.maxZoom / this.eventsData.zoom_factor;
			this.eventsData.zoom_factor = Utils.configuration.maxZoom;
		}else{
			this.eventsData.zoom_factor *= growth;
		}
		this.generateCumulusIcons();
		Utils.getPointerCoordinates(e);
		this.eventsData.desplacedX += (Utils.mouseLocation.x - this.eventsData.desplacedX) - (Utils.mouseLocation.x - this.eventsData.desplacedX) * (growth);
		this.eventsData.desplacedY += (Utils.mouseLocation.y - this.eventsData.desplacedY) - (Utils.mouseLocation.y - this.eventsData.desplacedY) * (growth);
	}else if(delta < 0) {
		growth = 1 + 0.08 * ((delta < -1) ? -delta : 1);

		if(this.eventsData.zoom_factor / growth < Utils.configuration.minZoom){
			growth = this.eventsData.zoom_factor / Utils.configuration.minZoom;
			this.eventsData.zoom_factor = Utils.configuration.minZoom;
		}else{
			this.eventsData.zoom_factor /= growth;
		}
		this.generateCumulusIcons();
		Utils.getPointerCoordinates(e);
		this.eventsData.desplacedX += (Utils.mouseLocation.x - this.eventsData.desplacedX) - (Utils.mouseLocation.x - this.eventsData.desplacedX) / (growth);
		this.eventsData.desplacedY += (Utils.mouseLocation.y - this.eventsData.desplacedY) - (Utils.mouseLocation.y - this.eventsData.desplacedY) / (growth);
	}
	//console.log(this.eventsData.zoom_factor);
	this.requestReDraw();
	return 0;
};

Canvas.prototype.manualZoomInOut = function(zoom) {
	var growth;
	if(zoom == "+"){
		if(this.eventsData.zoom_factor < 150){
			growth = 1 + 0.15;

			if(this.eventsData.zoom_factor * growth > Utils.configuration.maxZoom){
				growth =  Utils.configuration.maxZoom / this.eventsData.zoom_factor;
				this.eventsData.zoom_factor = Utils.configuration.maxZoom;
			}else{
				this.eventsData.zoom_factor *= growth;
			}
			this.generateCumulusIcons();
			this.eventsData.desplacedX += (this.data.viewportSize.x / 2 - this.eventsData.desplacedX) - (this.data.viewportSize.x / 2 - this.eventsData.desplacedX) * (growth);
			this.eventsData.desplacedY += (this.data.viewportSize.y / 2 - this.eventsData.desplacedY) - (this.data.viewportSize.y / 2 - this.eventsData.desplacedY) * (growth);
		}
	}else if(zoom == "-") {
		if(this.eventsData.zoom_factor > 0.015){
			growth = 1 + 0.2;

			if(this.eventsData.zoom_factor / growth < Utils.configuration.minZoom){
				growth = this.eventsData.zoom_factor / Utils.configuration.minZoom;
				this.eventsData.zoom_factor = Utils.configuration.minZoom;
			}else{
				this.eventsData.zoom_factor /= growth;
			}
			this.generateCumulusIcons();
			this.eventsData.desplacedX += (this.data.viewportSize.x / 2 - this.eventsData.desplacedX) - (this.data.viewportSize.x / 2 - this.eventsData.desplacedX) / (growth);
			this.eventsData.desplacedY += (this.data.viewportSize.y / 2 - this.eventsData.desplacedY) - (this.data.viewportSize.y / 2 - this.eventsData.desplacedY) / (growth);
		}
	}
	this.requestReDraw();
};

Canvas.prototype.moveSystem = function() {
	if(!this.eventsData.inDrag){
		//var time = new Date().getTime();
		var e = this.eventsData.event;
		this.eventsData.inDrag = true;

		Utils.getPointerCoordinates(e);
		var mouseX = Utils.mouseLocation.x;
		var mouseY = Utils.mouseLocation.y;

		this.eventsData.desplacedX = this.eventsData.originalDesplacedX + (mouseX - this.eventsData.initialMousePosition.x);
		this.eventsData.desplacedY = this.eventsData.originalDesplacedY + (mouseY - this.eventsData.initialMousePosition.y);

		this.requestReDraw();
		//time = new Date().getTime() - time; ;
		//console.log(time);
		this.eventsData.inDrag = false;
		return 0;
	}
	return 0;
};

Canvas.prototype.setNaturalSize = function() {
	this.canvas.system.width = parseInt(this.jquery.system.width(), 10);
	this.canvas.system.height = parseInt(this.jquery.system.height(), 10);

	this.data.viewportSize = {x: this.canvas.system.width, y: this.canvas.system.height};

};

Canvas.prototype.generateCumulusIcons = function() {
	var size = Utils.configuration.cumulusSize * this.eventsData.zoom_factor;
	if(size > 250) size = 250;
	if(size < 2) size = 2;
	if(this.data.canvasCache.configuration.lastSize === size) return;
	this.data.canvasCache.configuration.lastSize = size;
	var size2 = size/2;
	var size3 = size/3;
	var ctx = this.data.canvasCache.cumulus.ctx;
	var canvas = this.data.canvasCache.cumulus.canvas;

	canvas.width = size;
	canvas.height = size;
	ctx.save();

	ctx.clearRect(0,0,size,size);
	ctx.beginPath();
	//ctx.arc(size2, size2, size2/3, 0, 2 * Math.PI, false);
	Utils.canvasPolygon(ctx, size2, size2, size2/3, 6, 0);
	ctx.fillStyle = '#00c0ff';
	ctx.strokeStyle = '#dfdfdf';
	ctx.fill();
	ctx.beginPath();
	//ctx.arc(size2, size2, size2/1.8, 0, 2 * Math.PI, false);
	Utils.canvasPolygon(ctx, size2, size2, size2/1.8, 6, 0);
	ctx.lineWidth = size3/4.5;
	ctx.stroke();

	ctx.restore();
};

Canvas.prototype.drawSystem = function() {

		if(this.phase > 0) this.drawSystemBoundaries();

		if(this.phase == 1) this.drawSystemSuperCumulus();

		if(this.phase > 2) this.drawSystemCumulusLinks();

		if(this.phase > 1 && this.eventsData.contentLoaded && this.phase < 4) this.drawSystemCumulus();

		if(this.phase > 3) {
			this.drawSystemCumulusSolarSystems();
			this.drawSystemCumulusSolarSystemsLinks()
		}

};

Canvas.prototype.drawSystemBoundaries = function() {

	this.contexto.beginPath();
	this.contexto.lineWidth = 1;
	this.contexto.strokeStyle = 'white';
	this.contexto.rect(-20000 * this.eventsData.zoom_factor + this.eventsData.desplacedX, -20000 * this.eventsData.zoom_factor + this.eventsData.desplacedY,
		72000 * this.eventsData.zoom_factor, 72000 * this.eventsData.zoom_factor);
	this.contexto.stroke();


};

Canvas.prototype.updateCumulusPositions = function() {
	var temp = this.data.cumulus.length;
	if(this.data.cumulusPositionCache.length != temp){
		this.data.cumulusPositionCache = new Array(this.data.cumulus.length);
		for (var i = this.data.cumulusPositionCache.length - 1; i >= 0; i--) {
			this.data.cumulusPositionCache[i] = {x: 0, y: 0, s: 0};
		}
	}

	for (var i = temp - 1; i >= 0; i--) {
		this.data.cumulusPositionCache[i].x = Math.floor((this.data.cumulus[i].x * this.eventsData.zoom_factor + this.eventsData.desplacedX));
		this.data.cumulusPositionCache[i].y = Math.floor((this.data.cumulus[i].y * this.eventsData.zoom_factor + this.eventsData.desplacedY));
		this.data.cumulusPositionCache[i].s = Math.floor(this.data.cumulus[i].s * this.eventsData.zoom_factor);
	}
};

Canvas.prototype.drawSystemCumulusSolarSystems = function() {
	var x, y, s;
	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
		for (var j = this.data.cumulus[i].systems.solarSystems.length - 1; j >= 0; j--) {
			x = this.data.cumulus[i].systems.solarSystems[j].x;
			y = this.data.cumulus[i].systems.solarSystems[j].y;
			s = this.data.cumulus[i].systems.solarSystems[j].s;

			this.contexto.save();
			this.contexto.fillStyle = "#ffffff";
			this.contexto.fillRect( (x - s / 2) * this.eventsData.zoom_factor + this.eventsData.desplacedX , (y - s / 2) * this.eventsData.zoom_factor + this.eventsData.desplacedY, s * this.eventsData.zoom_factor, s * this.eventsData.zoom_factor);
			this.contexto.restore();
		};
	};
};

Canvas.prototype.drawSystemCumulus = function() {

	var s, s2, cumulusImage;
	if(this.data.cumulusPositionCache.length > 0){
		s2 = Math.round(Math.floor(this.data.cumulusPositionCache[0].s / 2));

		if(this.eventsData.zoom_factor < 0.039){
			s2 = 1;
			s = 2;
			cumulusImage = this.img.predefinedCumulusSmall;
		}else{
			s = this.data.cumulusPositionCache[0].s;
			cumulusImage = this.data.canvasCache.cumulus.canvas;
		}

		this.contexto.strokeStyle = "#F5FFCE";
		this.contexto.fillStyle = "#fff";
		this.contexto.font = "8pt Arial";
		this.contexto.lineWidth = 0.2;

		for (var i = this.data.cumulusPositionCache.length - 1; i >= 0; i--) {
			if(
				this.data.cumulusPositionCache[i].x + s2 > 0 &&
				this.data.cumulusPositionCache[i].x - s2 < this.data.viewportSize.x &&
				this.data.cumulusPositionCache[i].y + s2 > 0 &&
				this.data.cumulusPositionCache[i].y - s2 < this.data.viewportSize.y){


				//this.contexto.drawImage(this.img[i].image, this.data.cumulusPositionCache[i].x - w2, this.data.cumulusPositionCache[i].y - h2, this.data.cumulusPositionCache[i].s, this.data.cumulusPositionCache[i].s);
				if(this.eventsData.selectedCumulus === i){
					this.contexto.strokeStyle = "#C7F1FC";
					this.contexto.lineWidth = 3;
					this.contexto.fillStyle = "rgba(255, 0, 0, 0.2)";

					this.contexto.beginPath();
					this.contexto.arc(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, this.data.cumulusPositionCache[i].s / 1.8, 0, Math.PI * 2, false);
					this.contexto.fill();

					this.contexto.beginPath();
					this.contexto.arc(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, this.data.cumulusPositionCache[i].s / 1.8, 0, Math.PI * 2, false);
					this.contexto.stroke();

					this.contexto.strokeStyle = "#F5FFCE";
					this.contexto.lineWidth = 0.2;
				}else if(this.eventsData.hoverCumulus === i){
					this.contexto.strokeStyle = "#C7F1FC";
					this.contexto.lineWidth = 3;

					this.contexto.beginPath();
					this.contexto.arc(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, this.data.cumulusPositionCache[i].s / 1.8, 0, Math.PI * 2, false);
					this.contexto.stroke();

					this.contexto.strokeStyle = "#F5FFCE";
					this.contexto.lineWidth = 0.2;
				}

				this.contexto.beginPath();
				//this.contexto.arc(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, this.data.cumulusPositionCache[i].s / 2, 0, Math.PI * 2, false);
				//this.contexto.rect(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, this.data.cumulusPositionCache[i].s / 2, this.data.cumulusPositionCache[i].s / 2);
				this.contexto.drawImage(
					cumulusImage,
					this.data.cumulusPositionCache[i].x - s2,
					this.data.cumulusPositionCache[i].y - s2,
					s,
					s);
				this.contexto.stroke();




				/*this.contexto.beginPath();
				this.contexto.fillStyle = "rgba(255, 0, 0, 0.2)";
				this.contexto.arc(this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y, Utils.configuration.minDistanceCumulusLink * this.eventsData.zoom_factor, 0, Math.PI * 2, false);
				this.contexto.fill();*/

				if(this.eventsData.cumulusNumbersDrawFlag){
					this.contexto.fillText(i, this.data.cumulusPositionCache[i].x, this.data.cumulusPositionCache[i].y);
				}
			}
		}
	}

};

Canvas.prototype.drawSystemSuperCumulus = function() {
	for (var i = this.data.superCumulus.length - 1; i >= 0; i--) {
		this.contexto.beginPath();
		this.contexto.strokeStyle = "#FFB200";
		this.contexto.fillStyle = "rgba(255, 178, 0, 0.5)";
		this.contexto.lineWidth = 1;
		this.contexto.rect(
			Math.floor(this.data.superCumulus[i].x * this.eventsData.zoom_factor + this.eventsData.desplacedX - this.data.superCumulus[i].size * this.eventsData.zoom_factor / 2),
			Math.floor(this.data.superCumulus[i].y * this.eventsData.zoom_factor + this.eventsData.desplacedY - this.data.superCumulus[i].size * this.eventsData.zoom_factor / 2),
			Math.floor(this.data.superCumulus[i].size * this.eventsData.zoom_factor),
			Math.floor(this.data.superCumulus[i].size * this.eventsData.zoom_factor));
		this.contexto.fill();
		this.contexto.stroke();

	}

	if(this.data.superCumulusRealTime) {
		this.contexto.beginPath();
		this.contexto.strokeStyle = "#FFB200";
		this.contexto.fillStyle = "rgba(255, 178, 0, 0.5)";
		this.contexto.lineWidth = 1;
		this.contexto.rect(
			Math.floor(this.data.superCumulusRealTime.x * this.eventsData.zoom_factor + this.eventsData.desplacedX - this.data.superCumulusRealTime.size * this.eventsData.zoom_factor / 2),
			Math.floor(this.data.superCumulusRealTime.y * this.eventsData.zoom_factor + this.eventsData.desplacedY - this.data.superCumulusRealTime.size * this.eventsData.zoom_factor / 2),
			Math.floor(this.data.superCumulusRealTime.size * this.eventsData.zoom_factor),
			Math.floor(this.data.superCumulusRealTime.size * this.eventsData.zoom_factor));
		this.contexto.fill();
		this.contexto.stroke();
	}

};

Canvas.prototype.drawSystemCumulusLinks = function() {

	var multiplier, cumulus1, cumulus2, temp;

	if(this.eventsData.zoom_factor < 1) multiplier = (this.eventsData.zoom_factor * 10 < 0.5) ? this.eventsData.zoom_factor * 10 : 0.5 ;
	else multiplier = 1;

	this.contexto.lineWidth = 1 * multiplier;
	this.contexto.strokeStyle = "#F5FFCE";
	this.contexto.beginPath();

	for (var i = this.data.graph.length - 1; i >= 0; i--) {
		if(this.data.graph[i].marked === false){
			cumulus1 = this.data.cumulusPositionCache[this.data.graph[i].firstNode];
			cumulus2 = this.data.cumulusPositionCache[this.data.graph[i].secondNode];
			this.contexto.moveTo(cumulus1.x, cumulus1.y);
			this.contexto.lineTo(cumulus2.x, cumulus2.y);
		}
	};

	this.contexto.stroke();

	if(this.drawData.jumpMarkedLinks.length > 0){
		this.contexto.lineWidth = 3 * multiplier;
		temp = 0;

		this.contexto.beginPath();
		this.contexto.strokeStyle = Utils.configuration.jumpColor[temp * Utils.configuration.distanceColorJump];

		for (var i = this.drawData.jumpMarkedLinks.length - 1; i >= 0; i--) {

			if(temp != this.drawData.jumpMarkedLinks[i].markedType.jump.color){

				if(temp != 0) this.contexto.stroke();
				temp = this.drawData.jumpMarkedLinks[i].markedType.jump.color;
				this.contexto.beginPath();
				this.contexto.strokeStyle = Utils.configuration.jumpColor[temp * Utils.configuration.distanceColorJump];

				cumulus1 = this.data.cumulusPositionCache[this.drawData.jumpMarkedLinks[i].firstNode];
				cumulus2 = this.data.cumulusPositionCache[this.drawData.jumpMarkedLinks[i].secondNode];
				this.contexto.moveTo(cumulus1.x, cumulus1.y);
				this.contexto.lineTo(cumulus2.x, cumulus2.y);

			}else{
				cumulus1 = this.data.cumulusPositionCache[this.drawData.jumpMarkedLinks[i].firstNode];
				cumulus2 = this.data.cumulusPositionCache[this.drawData.jumpMarkedLinks[i].secondNode];
				this.contexto.moveTo(cumulus1.x, cumulus1.y);
				this.contexto.lineTo(cumulus2.x, cumulus2.y);
			}
		};

		this.contexto.stroke();
	}

	if(this.drawData.pathFindingMarkedLinks.length > 0){
		this.contexto.lineWidth = 3;
		this.contexto.strokeStyle = "#ffffff";
		this.contexto.beginPath();

		for (var i = this.drawData.pathFindingMarkedLinks.length - 1; i >= 0; i--) {
			cumulus1 = this.data.cumulusPositionCache[this.drawData.pathFindingMarkedLinks[i].firstNode];
			cumulus2 = this.data.cumulusPositionCache[this.drawData.pathFindingMarkedLinks[i].secondNode];
			this.contexto.moveTo(cumulus1.x, cumulus1.y);
			this.contexto.lineTo(cumulus2.x, cumulus2.y);
		};
		this.contexto.stroke();
	}

};

Canvas.prototype.drawSystemCumulusSolarSystemsLinks = function() {
	var multiplier, cumulus1, cumulus2, temp;

	if(this.eventsData.zoom_factor < 1) multiplier = (this.eventsData.zoom_factor * 10 < 0.5) ? this.eventsData.zoom_factor * 10 : 0.5 ;
	else multiplier = 1;

	this.contexto.lineWidth = 1 * multiplier;
	this.contexto.strokeStyle = "#F5FFCE";
	this.contexto.beginPath();

	for (var i = this.data.cumulus.length - 1; i >= 0; i--) {
		for (var j = this.data.cumulus[i].systems.graph.length - 1; j >= 0; j--) {
			if(this.data.cumulus[i].systems.graph[j].marked === false){
				cumulus1 = this.data.cumulus[i].systems.solarSystems[this.data.cumulus[i].systems.graph[j].firstNode];
				cumulus2 = this.data.cumulus[i].systems.solarSystems[this.data.cumulus[i].systems.graph[j].secondNode];
				this.contexto.moveTo(cumulus1.x * this.eventsData.zoom_factor + this.eventsData.desplacedX, cumulus1.y * this.eventsData.zoom_factor + this.eventsData.desplacedY);
				this.contexto.lineTo(cumulus2.x * this.eventsData.zoom_factor + this.eventsData.desplacedX, cumulus2.y * this.eventsData.zoom_factor + this.eventsData.desplacedY);
			}
		};
	};

	this.contexto.stroke();


};





var LoadImages = function (data) {
	this.init(data);
}

LoadImages.prototype.init = function(data) {

	var self = this;
	var images = data.images;
	this.data = data;
	this.imageObjective = images.length;
	this.imagesReach = 0;
	this.imagesLoad = new Array(this.imageObjective);

	for (var i = this.imageObjective - 1; i >= 0; i--) {
		this.imagesLoad[i] = new Image();
		this.imagesLoad[i].onload = (function(i){
			return function () {
				self.imageLoaded(i);
				self.imagesLoad[i].onload = null;
			};
		})(i);
		this.imagesLoad[i].src = images[i];
	};

};

LoadImages.prototype.imageLoaded = function(index) {
	this.imagesReach++;
	if( this.imagesReach >= this.imageObjective ){
		if(this.data.finishCallback) this.data.finishCallback.call( this.data.finishCallbackContext, this.imagesLoad, index, this.imagesReach);
	}else{
		if(this.data.stepCallback) this.data.stepCallback.call( this.data.stepCallbackContext, this.imagesLoad[index], index, this.imagesReach);
	}

	return 0;
};





var Utils = {};
Utils.configuration = {};
Utils.configuration.superCumulusSize = 10000;
Utils.configuration.cumulusInSuperCumulus = 40;
Utils.configuration.minDistanceCumulusLink = 175;
Utils.configuration.maximunConnections = 3;
Utils.configuration.minimunConnections = 3;
Utils.configuration.maxZoom = 2;
Utils.configuration.minZoom = 0.01;
Utils.configuration.cumulusSize = 150;
Utils.configuration.systemsInCumulus = 35;
Utils.configuration.jumpColor = ["#ffffff", "#e8f9fe", "#c4f0fe", "#9ce6fe", "#72dcfc", "#50d3f7", "#3acded", "#37cbdf", "#46cfc7", "#62d7a9", "#85e189", "#a9e46a", "#cbe44e", "#e2e43a", "#efd830", "#f2bf30", "#f2a030", "#f27e30", "#f25e30", "#f24330", "#f23130"];
Utils.configuration.maxJumpColorShow = 10;
Utils.configuration.distanceColorJump = Math.floor(Utils.configuration.jumpColor.length / Utils.configuration.maxJumpColorShow);
Utils.dataContainer = {};
Utils.dataContainer.cumulus = [];
Utils.mouseLocation = {x: 0, y: 0};
Utils.canvasPolygon = function(cxt, Xcenter, Ycenter, radius, numberOfSides, rotation) {
	var size = radius;
	cxt.moveTo (Xcenter +  size * Math.cos(rotation), Ycenter +  size *  Math.sin(rotation));

	for (var i = 1; i <= numberOfSides;i += 1) {
	    cxt.lineTo (Xcenter + size * Math.cos(rotation + i * (2 * Math.PI / numberOfSides)), Ycenter + size * Math.sin(rotation + i * (2 * Math.PI / numberOfSides)));
	}
	cxt.closePath();
};
Utils.getRandomInt = function (min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
};
Utils.getRandomArbitary = function (min, max) {
	return Math.random() * (max - min) + min;
};
Utils.createCanvas = function (width, height, renderFunction) {
    var buffer = document.createElement('canvas');
    buffer.width = width;
    buffer.height = height;
    renderFunction(buffer.getContext('2d'));
    return buffer;
};
Utils.suffle = function (array) {
    var tmp, current, top = array.length;

    if(top) while(--top) {
    	current = Math.floor(Math.random() * (top + 1));
    	tmp = array[current];
    	array[current] = array[top];
    	array[top] = tmp;
    }

    return array;
};
Utils.getPointerCoordinates = function (e) {
	if(e.originalEvent.touches){
		if(e.type == "touchend"){
			this.mouseLocation.x = e.originalEvent.changedTouches[0].pageX
			this.mouseLocation.y = e.originalEvent.changedTouches[0].pageY
		}else{
			this.mouseLocation.x = e.originalEvent.touches[0].pageX
			this.mouseLocation.y = e.originalEvent.touches[0].pageY
		}
	}else{
		this.mouseLocation.x = e.pageX;
		this.mouseLocation.y = e.pageY;
	}
};
Utils.getGalaxy = function (struct, graph) {
	if(typeof struct === "undefined") struct = window.canvas.data.cumulus;
	if(typeof graph === "undefined") graph = window.canvas.data.graph;
	var newStruct = new Array(struct.length);
	var newGraph = new Array(graph.length);

	for (var i = graph.length - 1; i >= 0; i--) { //Creamos al estructura de punteros
		newGraph[i] = {
			n1: graph[i].firstNode,
			n2: graph[i].secondNode,
			id: graph[i].id,
			weight: graph[i].weight
		};
	};

	for (var i = struct.length - 1; i >= 0; i--) { //Por cada cúmulo creamos la estructura con los datos del cúmulo
		newStruct[i] = {
			x: struct[i].x,
			y: struct[i].y,
			id: struct[i].id,
			//subSolarSystemsGraph: new Array(struct[i].systems.graph.length),
			//subSolarSystems: new Array(struct[i].systems.solarSystems.length),
			subSolarSystemsGraph: [null],
			subSolarSystems: [null],
			conn: []
		}
		if(i == struct.length - 1){
			for (var j = struct[i].systems.graph.length - 1; j >= 0; j--) { //Ponemos los datos de cada systema solar del cúmulo
				newStruct[i].subSolarSystemsGraph[j] = {
					n1: struct[i].systems.graph[j].firstNode, //Hay que cambiarlo a puntero
					n2: struct[i].systems.graph[j].secondNode, //Hay que cambiarlo a puntero
					id: struct[i].systems.graph[j].id,
					weight: struct[i].systems.graph[j].weight
				}
			}
			for (var j = struct[i].systems.solarSystems.length - 1; j >= 0; j--) {
				newStruct[i].subSolarSystems[j] = {
					x: struct[i].systems.solarSystems[j].x,
					y: struct[i].systems.solarSystems[j].y,
					id: struct[i].systems.solarSystems[j].id,
					weight: struct[i].systems.solarSystems[j].weight,
					conn: []
				}
			}
		}
		/*for (var j = struct[i].systems.graph.length - 1; j >= 0; j--) { //Ponemos los datos de cada systema solar del cúmulo
			newStruct[i].subSolarSystemsGraph[j] = {
				n1: struct[i].systems.graph[j].firstNode, //Hay que cambiarlo a puntero
				n2: struct[i].systems.graph[j].secondNode, //Hay que cambiarlo a puntero
				id: struct[i].systems.graph[j].id,
				weight: struct[i].systems.graph[j].weight
			}
		}
		for (var j = struct[i].systems.solarSystems.length - 1; j >= 0; j--) {
			newStruct[i].subSolarSystems[j] = {
				x: struct[i].systems.solarSystems[j].x,
				y: struct[i].systems.solarSystems[j].y,
				id: struct[i].systems.solarSystems[j].id,
				weight: struct[i].systems.solarSystems[j].weight,
				conn: []
			}
		}*/
	}

	window.grafo = JSON.stringify(newGraph);
	window.nodos = JSON.stringify(newStruct);
	//Utils.getGalaxy(canvas.data.cumulus, canvas.data.graph);
};

(function () {
	var rv = -1;
	if (navigator.appName == 'Microsoft Internet Explorer')
	{
		var ua = navigator.userAgent;
		var re = new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})");
		if (re.exec(ua) !== null)
			rv = parseFloat( RegExp.$1 );
	}

	if(rv < 10){
		Utils.unselect = function(){
			if(window.is_unselect_allowed) document.selection.empty();
		};
	}else{
		Utils.unselect = function(){
			if(window.is_unselect_allowed){
				var myRange = document.getSelection();
				myRange.removeAllRanges();
			}
		};
	}
})();


(function () {
	var myRequestAnimationFrame =  window.requestAnimationFrame ||
	              window.webkitRequestAnimationFrame ||
	              window.mozRequestAnimationFrame    ||
	              window.oRequestAnimationFrame      ||
	              window.msRequestAnimationFrame     ||
	              function(callback) {
	                  window.setTimeout(callback, 10);
	               };
	window.requestAnimationFrame=myRequestAnimationFrame;
})();

