"use strict";
function MapEditor (interfaz) {
	this.constructor(interfaz);
}

MapEditor.prototype.constructor = function(interfaz) {
	//Crear botones e inputs para: tamaño del mapa, poner paredes, poner bichos, exportar mapa, importar mapa.

	this.data = {
		interfaz: interfaz,
		width: 60,
		height: 30,
		blockTipe: 1,
		map: new Array(60),
		importDisplay: false,
		exportDisplay: false
	};

	for (var i = this.data.map.length - 1; i >= 0; i--) {
		this.data.map[i] = new Array(this.data.height);
		for (var j = this.data.map[i].length - 1; j >= 0; j--) {
			this.data.map[i][j] = 1;
		};
	};


	this.dom = {
		container: $("<div>"),
		canvas: $("<div>").addClass("ventana_juego_editor").css({width: this.data.width * this.data.interfaz.data.ancho_cuadro, height: this.data.height * this.data.interfaz.data.alto_cuadro}),
		menu: $("<div>").addClass("menu_map_editor"),
		button: {
			width: $("<input>").attr({placeholder: "Map width"}).val(this.data.width),
			height: $("<input>").attr({placeholder: "Mp he"}).val(this.data.height),
			setMapDimensions: $("<p>").text("Set map dimensions"),
			winnerpoint: $("<p>").text("Win Point"),
			longPoint: $("<input>").attr({placeholder: "Win Length"}).addClass("editor_map_input_name_r"),
			initialLength: $("<input>").attr({placeholder: "Initial Length"}).addClass("editor_map_input_name_r"),
			mapName: $("<input>").addClass("editor_map_input_name").attr({placeholder: "Nombre del mapa"}),
			p_playerWay: $("<p>").text("Initial way: ").addClass("information_map_editor"),
			playerWay: $("<select>").attr({placeholder: "Dirección inicial"}).append($("<option>").text("Right").val("d")).append($("<option>").text("Up").val("w")).append($("<option>").text("Left").val("a")).append($("<option>").text("Down").val("s")) ,
			blockTipe: [
				$("<p>").text("Empty").css({clear: "left"}),
				$("<p>").text("Wall").addClass("active"),
				$("<p>").text("Startpoint"),
				$("<p>").text("Walker"),
				$("<p>").text("Shooter"),
				$("<p>").text("Beast")
			],
			save: $("<p>").text("Save"),
			exportData: $("<p>").text("Export").css({clear: "left"}),
			importData: $("<p>").text("Import"),
			inportDataDom: {
				caja: $("<div>").css({display: "none"}).addClass("import_map_menu"),
				textarea: $("<textarea>"),
				aceptar: $("<p>").text("Aceptar"),
				cancelar: $("<p>").text("Cancelar")
			},
			exportDataDom: {
				caja: $("<div>").css({display: "none"}).addClass("import_map_menu").append("Si quieres guardarte el mapa para pasarselo a otro amigo, guardate este texto y pasaselo entero:"),
				textarea: $("<textarea>"),
				aceptar: $("<p>").text("Aceptar")
			},
			exit: $("<p>").text("Exit")
		} 
	};

	this.setEvents();

	this.dom.button.inportDataDom.caja.append(this.dom.button.inportDataDom.textarea).append(this.dom.button.inportDataDom.aceptar).append(this.dom.button.inportDataDom.cancelar).append($('<div class="clear"></div>'));
	this.dom.button.exportDataDom.caja.append(this.dom.button.exportDataDom.textarea).append(this.dom.button.exportDataDom.aceptar).append($('<div class="clear"></div>'));

	this.dom.menu.append(this.dom.button.width).append(this.dom.button.height).append(this.dom.button.setMapDimensions).append(this.dom.button.mapName).append(this.dom.button.p_playerWay).append(this.dom.button.playerWay).append(this.dom.button.blockTipe[0]).append(this.dom.button.blockTipe[1]).append(this.dom.button.blockTipe[2]).append(this.dom.button.winnerpoint).append(this.dom.button.blockTipe[3]).append(this.dom.button.blockTipe[5]).append(this.dom.button.longPoint).append(this.dom.button.exportData).append(this.dom.button.importData).append(this.dom.button.save).append(this.dom.button.exit).append(this.dom.button.initialLength);
	this.dom.container.append(this.dom.menu).append(this.dom.canvas).append(this.dom.button.inportDataDom.caja).append(this.dom.button.exportDataDom.caja);
	
	var temp = this.dom.canvas.clone(); //Puto chrome
	$("body").append(temp);
	this.data.canvasBorder = [
		parseInt(temp.css("border-left-width")),
		parseInt(temp.css("border-top-width"))
	];
	temp.remove();

};

MapEditor.prototype.setEvents = function() {
	//Eventos de ratón en el campo y eventos de botones.
	//Eventos de botones
	var self = this;
	this.dom.button.blockTipe[0].click(function () { //Empty
		self.data.blockTipe = 0;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[0].addClass("active");
	});
	this.dom.button.blockTipe[1].click(function () { //Wall
		self.data.blockTipe = 1;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[1].addClass("active");
	});
	this.dom.button.blockTipe[3].click(function () { //Walker
		self.data.blockTipe = 2;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[3].addClass("active");
	});
	this.dom.button.blockTipe[4].click(function () { //Shooter
		self.data.blockTipe = 3;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[4].addClass("active");
	});
	this.dom.button.blockTipe[5].click(function () { //Beast
		self.data.blockTipe = 4;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[5].addClass("active");
	});
	this.dom.button.blockTipe[2].click(function () { //Starpoint
		self.data.blockTipe = 5;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.blockTipe[2].addClass("active");
	});
	this.dom.button.winnerpoint.click(function () { //Starpoint
		self.data.blockTipe = 6;
		self.dom.menu.children(".active").removeClass("active");
		self.dom.button.winnerpoint.addClass("active");
	});

	this.dom.button.setMapDimensions.click(function () {
		self.setMapDimensions((self.dom.button.width.val()), self.dom.button.height.val());
	});

	this.dom.canvas.mousemove(function (event, ClickEvent) {
		if(self.mousePress && !self.data.importDisplay){
			//sacamos X e Y para poner el cuadro que toque.
			if(ClickEvent){
				var x = Math.floor((ClickEvent.pageX - self.dom.canvas.offset().left - self.data.canvasBorder[0]) / self.data.interfaz.data.ancho_cuadro); //El 10 es or el borde
				var y = Math.floor((ClickEvent.pageY - self.dom.canvas.offset().top - self.data.canvasBorder[1]) / self.data.interfaz.data.alto_cuadro);
			}else{
				var x = Math.floor((event.pageX - self.dom.canvas.offset().left - self.data.canvasBorder[0]) / self.data.interfaz.data.ancho_cuadro); //El 10 es or el borde
				var y = Math.floor((event.pageY - self.dom.canvas.offset().top - self.data.canvasBorder[1]) / self.data.interfaz.data.alto_cuadro);
			}
			//console.log(x+" "+y);
			if(self.data.map[x] && self.data.map[x][y]){
				if(self.data.blockTipe == 0){ //Queremos borrar un bloque
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
						self.data.map[x][y] = 1;
					}
				}else if(self.data.blockTipe == 1){ //Queremos añadir/cambiar pared
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
					}
					self.data.map[x][y] = self.createBlock(x, y, self.data.blockTipe);
					self.dom.canvas.append(self.data.map[x][y].dom);
				}else if(self.data.blockTipe == 2){ //Queremos añadir walker
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
					}
					self.data.map[x][y] = self.createBlock(x, y, self.data.blockTipe);
					self.dom.canvas.append(self.data.map[x][y].dom);
				}else if(self.data.blockTipe == 4){ //Queremos añadir beast
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
					}
					self.data.map[x][y] = self.createBlock(x, y, self.data.blockTipe);
					self.dom.canvas.append(self.data.map[x][y].dom);
				}else if(self.data.blockTipe == 5){ //Queremos añadir starpoint
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
					}
					if(self.data.starpoint && self.data.map[self.data.starpoint[0]][self.data.starpoint[1]] != 1){
						self.data.map[self.data.starpoint[0]][self.data.starpoint[1]].dom.remove();
						self.data.map[self.data.starpoint[0]][self.data.starpoint[1]] = 1;
					}
					self.data.map[x][y] = self.createBlock(x, y, self.data.blockTipe);
					self.dom.canvas.append(self.data.map[x][y].dom);
					self.data.starpoint = [x, y];
				}else if(self.data.blockTipe == 6){ //Queremos añadir winnerpoint
					if(self.data.map[x][y] != 1){
						self.data.map[x][y].dom.remove();
					}
					if(self.data.winnerpoint && self.data.map[self.data.winnerpoint[0]][self.data.winnerpoint[1]] != 1){
						self.data.map[self.data.winnerpoint[0]][self.data.winnerpoint[1]].dom.remove();
						self.data.map[self.data.winnerpoint[0]][self.data.winnerpoint[1]] = 1;
					}
					self.data.map[x][y] = self.createBlock(x, y, self.data.blockTipe);
					self.dom.canvas.append(self.data.map[x][y].dom);
					self.data.winnerpoint = [x, y];
				}
			}
		}
	});

	$(document).bind("mouseup blur", function (event) {
		self.mousePress = false;
	});

	$(document).mousedown(function (event) {
		self.mousePress = true;
		//event.preventDefault();
		self.dom.canvas.trigger('mousemove', event);
	});

	this.dom.button.importData.click(function () {
		self.dom.button.inportDataDom.caja.css({display: "block"});
		self.dom.button.inportDataDom.textarea.val("");
		self.data.importDisplay = true;
	});

	this.dom.button.inportDataDom.cancelar.click(function () {
		self.dom.button.inportDataDom.caja.css({display: "none"});
		self.data.importDisplay = false;
	});

	this.dom.button.inportDataDom.aceptar.click(function (event) {
		event.preventDefault();
		event.stopPropagation();
		//parseamos el json que se ha escrito.
		console.log(self.dom.button.inportDataDom.textarea.val());
		var temp = jQuery.parseJSON(self.dom.button.inportDataDom.textarea.val());
		self.importMap(temp);
		self.dom.button.inportDataDom.caja.css({display: "none"});
		self.data.importDisplay = false;
	});

	this.dom.button.exportData.click(function () {
		self.dom.button.exportDataDom.caja.css({display: "block"}).css({width: 1000, left: 100});
		var temp = self.getMapFile();
		self.dom.button.exportDataDom.textarea.val(JSON.stringify(temp)).css({width: 995, height: 300});;
		self.data.importDisplay = true;
	});

	this.dom.button.exportDataDom.aceptar.click(function (event) {
		event.preventDefault();
		event.stopPropagation();
		//parseamos el json que se ha escrito.
		self.dom.button.exportDataDom.caja.css({display: "none"});
		self.data.exportDisplay = false;
	});

	this.dom.button.save.click(function () {
		//alert("Si quieres guardarte el mapa para pasarselo a otro amigo, guardate este texto y pasaselo entero: \n\n"+JSON.stringify(temp));
		var temp = self.getMapFile();
		if(typeof(Storage)!=="undefined"){
			var temp2 = jQuery.parseJSON(localStorage.savedMaps);
			temp2[temp2.length] = temp;
			localStorage.savedMaps = JSON.stringify(temp2);
		}
		self.data.interfaz.data.levels[self.data.interfaz.data.levels.length] = temp;
	});

	this.dom.button.exit.click(function () {
		//mostramos el menú principal otra vez
		self.data.interfaz.displayMenu();
	});
};

MapEditor.prototype.getMapFile = function() {
	var temp = new Array(this.data.map.length);
	for (var i = this.data.map.length - 1; i >= 0; i--) {
		temp[i] = new Array(this.data.height);
		for (var j = this.data.map[i].length - 1; j >= 0; j--) {
			if(this.data.map[i][j] == 1) temp[i][j] = 0;
			else temp[i][j] = this.data.map[i][j].type;
		};
	};
	//Ya tenemos el vector de los cuadros. Ahora hacemos el fichero que tiene una estructura distinta.
/*			name: "Nivel 1",
			wall: [[0,0], [5,5], [6,6], [5,6], [5, 4]], 
			enemies: [
				{type: "walker", x: 23, y: 12},
				{type: "walker", x: 48, y: 22},
				{type: "walker", x: 52, y: 22},
				{type: "walker", x: 12, y: 27},
				{type: "walker", x: 1,  y: 5},
			],
			initial_position: [25,25, "w"],
			width: 60,
			height: 30*/

	var fileMap = {
		width: this.data.width,
		height: this.data.height,
		name: this.dom.button.mapName.val(),
		initial_position: [0 , 0, this.dom.button.playerWay.val()],
		end_position: [-5 , -5]
	};
	//Nos falta recorrer todo el mapa y poner en cada vector lo que toque.
	var walls = [];
	var enemies = [];
	var temp23;
	for (var i = this.data.map.length - 1; i >= 0; i--) {
		for (var j = this.data.map[i].length - 1; j >= 0; j--) {
			if(this.data.map[i][j] != 1){//Si hay algún tipo de cosa en el cuadro...
				if(this.data.map[i][j].type == 1){ //Es una pared
					walls[walls.length] = [i, j]
				}else if(this.data.map[i][j].type > 1 && this.data.map[i][j].type < 5){ //Es un enemigo
					if(this.data.map[i][j].type == 2) temp23 = "walker";
					else if(this.data.map[i][j].type == 3) temp23 = "shooter";
					else if(this.data.map[i][j].type == 4) temp23 = "beast";
					
					enemies[enemies.length] = {
						type: temp23,
						x: i,
						y: j
					};

				}else if(this.data.map[i][j].type == 5){//Es el punto de inicio
					fileMap.initial_position[0] = i;
					fileMap.initial_position[1] = j;
				}else if(this.data.map[i][j].type == 6){//Es el punto de de final
					fileMap.end_position[0] = i;
					fileMap.end_position[1] = j;
				}
			}
		};
	};
	fileMap.wall = walls;
	fileMap.enemies = enemies;
	if(this.dom.button.longPoint.val().replace(" ","") != "" && !isNaN(parseInt(this.dom.button.longPoint.val().replace(" ",""))) ) fileMap.winLength = parseInt(this.dom.button.longPoint.val().replace(" ",""));
	else fileMap.winLength = 1000000;
	
	if(this.dom.button.initialLength.val().replace(" ","") != "" && !isNaN(parseInt(this.dom.button.initialLength.val().replace(" ",""))) ) fileMap.initial_length = parseInt(this.dom.button.initialLength.val().replace(" ",""));
	else fileMap.initial_length = 2;
	//fileMap.official = false;
	return fileMap;

};

MapEditor.prototype.importMap = function(map) {
	this.dom.canvas.html("");
	var width = map.width;
	var height = map.height;

	this.setMapDimensions(width, height, true);

	var map_temp = new Array(width);
	for (var i = width - 1; i >= 0; i--) {
		map_temp[i] = new Array(height);
		for (var j = height - 1; j >= 0; j--) {
			map_temp[i][j] = 1;
		};
	};
	
	for (var i = map.wall.length - 1; i >= 0; i--) {
		map_temp[map.wall[i][0]][map.wall[i][1]] = this.createBlock(map.wall[i][0], map.wall[i][1], 1);
		this.dom.canvas.append(map_temp[map.wall[i][0]][map.wall[i][1]].dom);
	};
	var type;
	for (var i = map.enemies.length - 1; i >= 0; i--) {
		if(map.enemies[i].type == "walker") type = 2;
		else if(map.enemies[i].type == "shooter") type = 3;
		else if(map.enemies[i].type == "beast") type = 4;

		map_temp[map.enemies[i].x][map.enemies[i].y] = this.createBlock(map.enemies[i].x, map.enemies[i].y, type);
		this.dom.canvas.append(map_temp[map.enemies[i].x][map.enemies[i].y].dom);
	};

	this.dom.button.playerWay.val(map.initial_position[2]);
	this.dom.button.mapName.val(map.name);
	//map_temp.initial_position = [map.initial_position[0], map.initial_position[1]];
	
	map_temp[map.initial_position[0]][map.initial_position[1]] = this.createBlock(map.initial_position[0], map.initial_position[1], 5);
	this.dom.canvas.append(map_temp[map.initial_position[0]][map.initial_position[1]].dom);
	this.data.starpoint = [map.initial_position[0],map.initial_position[1]];
	
	if(map.end_position[0] != -5){
		map_temp[map.end_position[0]][map.end_position[1]] = this.createBlock(map.end_position[0], map.end_position[1], 6);
		this.dom.canvas.append(map_temp[map.end_position[0]][map.end_position[1]].dom);
		this.data.winnerpoint = [map.end_position[0],map.end_position[1]];
	}


	this.dom.canvas.css({
		height: this.data.interfaz.data.alto_cuadro * height,
		width: this.data.interfaz.data.ancho_cuadro * width
	});
	this.dom.button.width.val(width);
	this.dom.button.height.val(height);
	this.data.width = width;
	this.data.height = height;
	if(map.winLength > 100000) this.dom.button.longPoint.val("");
	else this.dom.button.longPoint.val(map.winLength);
	if(map.winLength > 100000) this.dom.button.longPoint.val("");
	else this.dom.button.longPoint.val(map.winLength);
	
	this.dom.button.initialLength.val(map.initial_length);
	this.data.map = map_temp;
};

MapEditor.prototype.setMapDimensions = function(width, height, erase) {
	//Hacemos un mapa nuevo
	if($.isNumeric(width) && $.isNumeric(height)){
		width = parseInt(width);
		height = parseInt(height);
		var map_temp = new Array(width);
		for (var i = width - 1; i >= 0; i--) {
			map_temp[i] = new Array(height);
			for (var j = height - 1; j >= 0; j--) {
				map_temp[i][j] = 1;
			};
		};
		//Copiamos el mapa anterior (lo que quepa)
		var width_temp =  (width  < this.data.width) ? width  : this.data.width;
		var height_temp = (height < this.data.height) ? height : this.data.height;

		//Dejo este comentario aquí en honor al Joan que me ayudó en algo que parecía absurdo

		//console.log(width+"|"+this.data.width+"="+width_temp+" "+height+"|"+this.data.height+"="+height_temp);
		for (var i = this.data.map.length - 1; i >= 0; i--) {
			for (var j = this.data.map[i].length - 1; j >= 0; j--) {
				if(this.data.map[i][j] != 1) this.data.map[i][j].dom.remove();
			};
		};
		if(!erase){
			for (var i = width_temp - 1; i >= 0; i--) {
				for (var j = height_temp - 1; j >= 0; j--) {
					if(this.data.map[i][j] != 1){ 
						map_temp[i][j] = this.createBlock(i, j, this.data.map[i][j].type);
						this.dom.canvas.append(map_temp[i][j].dom);
					}
				};
			};
		}
		this.dom.canvas.css({
			height: this.data.interfaz.data.alto_cuadro * height,
			width: this.data.interfaz.data.ancho_cuadro * width
		})
		this.data.width = width;
		this.data.height = height;
		this.data.map = map_temp;
	}
};

MapEditor.prototype.createBlock = function(x, y, type) {
	//Creamos DOM y asignamos el dom y el tipo
	var clas = "";
	if(type == 1) clas = "cuadro_pared_normal";
	else if(type == 2) clas = "walker_block";
	//else if(type == 3) clas = "walker_block";
	else if(type == 4) clas = "beast_block";
	else if(type == 5) clas = "cuadro_isotope";
	else if(type == 6) clas = "cuadro_winnerpoint";
	var temp = {
		type: type,
		dom: $("<div>").addClass(clas).css({width: this.data.interfaz.data.ancho_cuadro, height:this.data.interfaz.data.alto_cuadro, left: this.data.interfaz.data.ancho_cuadro * x, top: this.data.interfaz.data.alto_cuadro * y})
	};
	return temp;
};

MapEditor.prototype.get_dom = function() {
	return this.dom.container;
};