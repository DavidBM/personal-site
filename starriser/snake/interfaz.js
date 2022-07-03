"use strict";
function Interfaz (dom) {
	this.constructor(dom);
}

//Lo primero es definir el mapa de memoria que representa la cuadricula. Este mapa de memori será compartido. Las colisiones se encargará cada objeto (que sabe donde irá el siguiente turno) de mirarlas. Con lo que todos los objetos tiene que tener una función que dice si sigue o no. Si no, muere. Lo mismo para el jugador. Para los tiempos se usará un bucle con un setTimeout que se llamará a si mismo. Esto puede dar problemas de memoria a largo plazo, no lo se. Depende de js. También se puede hacer que cada elemento tenga una velocidad distinta. Así los disparos pueden ir más o menos rápidos que el jugador. Casi que será lo ideal.

Interfaz.prototype.constructor = function(dom) {

	this.contenedor = dom;

	this.staticData(); //Carga los datos estaticos, como son los mapas (sus formas), la altura y anchura de la ventana, etc

	this.staticDom(); //Carga el dom estatico, como es la ventana principal.

	this.localStorage();

	this.loadMapsStorage();

	this.menu();
};

Interfaz.prototype.menu = function() { //Muestra el menú y te deja elegir nivel. De momento lo dejaremos en un boton para el play y ya.
	var self = this;
	var texto_play = ["I wanna to play now, bitch", "GO GO GO! Let's Play!", "I'm an entertainer", "Zerg rush incoming!", "Don't press the button. No, seriously, press the button", "Radiate!", "I wanna be sterile!"];

	this.dom.menu = {
		cont: $("<div>"),
		play: $("<p>").text(texto_play[ Math.floor((Math.random() * (texto_play.length) )) ]).addClass("boton_menu_play"),
		mapEditor: $("<p>").text("Map editor").addClass("boton_menu_option"),
		mapSelection: $("<p>").text("Map selection").addClass("boton_menu_option"),
		titleImage: $("<div>").addClass("title"),
		easyButton: $("<p>").text("Hard (click)").addClass("boton_dificultad"),
	};

	this.dom.menu.play.click(function () {
		self.data.map_selected = 0;
		self.initializeGame();
	});

	this.dom.menu.mapEditor.click(function () {
		self.initializeMatEditor();
	});

	this.dom.menu.mapSelection.click(function () {
		self.initializeMapSelection();
	});

	this.dom.menu.easyButton.click(function () {
		if(self.data.easy == true){//Poner a dificil
			self.data.easy = false;
			self.dom.menu.easyButton.text("Hard (click)");
		}else{ //Poner en facil
			self.data.easy = true;
			self.dom.menu.easyButton.text("Easy (click)");
		}
	});

	//Creamos la lista de mapas y ponemos sus eventos
	this.dom.menu.contList = $("<div>").css({display: "none"});
	this.dom.menu.mapListOfficial = $("<div>").addClass("div_50_porcien");
	this.dom.menu.mapListUnOfficial = $("<div>").addClass("div_50_porcien");
	this.dom.menu.gotoindex = $("<p>").text("←").addClass("atras_map_menu");
	this.dom.menu.gotoindex.click(function () {
		self.displayMenu();
	});

	this.dom.canvas_menu.append(this.dom.menu.cont.append(this.dom.menu.titleImage).append(this.dom.menu.play).append(this.dom.menu.mapEditor).append(this.dom.menu.mapSelection)).append(this.dom.menu.contList.append(this.dom.menu.gotoindex).append(this.dom.menu.mapListOfficial).append(this.dom.menu.mapListUnOfficial)).append(this.dom.menu.easyButton);
	this.displayMenu();
};

Interfaz.prototype.set_key_events = function() {
	var documento = $("body");
	var self = this;

	documento.keydown(function (e) {
		if(e.which == 87 || e.which == 38){ //Le hemos dado a W
			self.obj.player.set_direction("w");
		}else if(e.which == 83 || e.which == 40){ //Le hemos dado a S
			self.obj.player.set_direction("s");
		}else if(e.which == 65 || e.which == 37){ //Le hemos dado a A
			self.obj.player.set_direction("a");
		}else if(e.which == 68 || e.which == 39){ //Le hemos dado a D
			self.obj.player.set_direction("d");
		}
	});
};

Interfaz.prototype.initializeGame = function(presentation) { //Cargamos todos los modulos y objetos que conforman el juego. Por orden:  Paredes, enemigos, serpientes.
	var self = this;
	if(!presentation){
		this.dom.canvas.html("");
		this.obj.wall = new Wall(this.data.levels[this.data.map_selected].width, this.data.levels[this.data.map_selected].height, this.data.alto_cuadro, this.data.ancho_cuadro, this.data.levels[this.data.map_selected].wall, this.dom.canvas);

		this.displayGame();

		if(this.data.map_selected == 0){
			this.presentation();
			this.showObjective();
			setTimeout(function () {
				self.quitObjective();
				self.initializeGame(true);
			}, 2000)
		}else {
			this.showObjective();
			setTimeout(function () {
				self.quitObjective();
				self.initializeGame(true);
			}, 2000)			
		}
	}else{

		this.obj.isotopes = new Isotopes(this.obj.wall, this.data.levels[this.data.map_selected].width, this.data.levels[this.data.map_selected].height, this.data.ancho_cuadro, this.data.alto_cuadro, this.dom.canvas);

		this.obj.enemies = new Enemies(this.data.levels[this.data.map_selected].enemies, this.obj, this, this.dom.canvas);


		this.obj.player = new Player(this.data.levels[ this.data.map_selected ].initial_position, this.data.alto_cuadro, this.data.ancho_cuadro, this.data.levels[this.data.map_selected].initial_length);
		//this.dom.canvas.append(this.obj.player.get_dom());

		this.set_key_events();
		this.loop();
	}
};

Interfaz.prototype.showObjective = function() {
	//Mostrar un texto de objetivo dependiendo de los parametros del mapa.
	this.dom.objective.css({left: $("body").width()/2 - 270})
	var temp = this.data.levels[this.data.map_selected];
	if(temp.end_position[0] >= 0){
		this.dom.objective.text("Reach the green block").css({display: "block"});
	}else if(temp.winLength < 1000){
		this.dom.objective.text("Eat "+(temp.winLength - temp.initial_length)+" isotopes").css({display: "block"});
	}else{
		this.dom.objective.text("Infinite Play").css({display: "block"});
	}
};

Interfaz.prototype.quitObjective = function() {
	//Mostrar un texto de objetivo dependiendo de los parametros del mapa.
	var temp = this.data.levels[this.data.map_selected];
	this.dom.objective.text("").css({display: "none"});
};

Interfaz.prototype.presentation = function() {
	//Poner isotope
	//Poner gusano
	//moverlo un poco hacia el isotopo.
	//Subir la luz del mapa
};


Interfaz.prototype.loop = function() {
	var self = this;
	var position = 0;
	var collision = false;
	var win = false;
	var positions_blocks = 0;
	var loopExec = false;

	if(this.data.levels[this.data.map_selected].end_position[0] < 0){
		self.obj.isotopes.generate_isotope();
	}
	this.loop_timer = setInterval(function () { //En esta función actualizamos las cosas.
		if(!loopExec){
			Ctx.clearRect(0, 0, self.data.levels[self.data.map_selected].width * self.data.ancho_cuadro, self.data.levels[self.data.map_selected].height * self.data.alto_cuadro);
			Ctx.save();
			loopExec = true;

			//Dibujamos el mapa
			self.obj.wall.draw_wall();
			//Dibujamos el punto final o isotopos
			if(self.data.levels[self.data.map_selected].end_position[0] < 0){
				self.obj.isotopes.put_isotope();
			}else{//ponemos el bloque de final
				Ctx.fillStyle = "#99FF6B";
				Ctx.fillRect(self.data.ancho_cuadro * self.data.levels[self.data.map_selected].end_position[0], self.data.alto_cuadro * self.data.levels[self.data.map_selected].end_position[1], self.data.ancho_cuadro, self.data.alto_cuadro);
			}
			
			//Dibujamos el usuario
			self.obj.player.draw();
			
			//Dibujamos los enemigos

			//primero el player, miramos si el player se puede mover (si puede se mueve), si se ha chocado o si ha cogido un isotopo radioactivo (crece 1 cuadro).
			position = self.obj.player.next_position();

			if(position[0] == self.data.levels[self.data.map_selected].end_position[0] && position[1] == self.data.levels[self.data.map_selected].end_position[1]){ //Hemos ganado por llegar al destino final
				win = true;
			}


			if( self.obj.wall.isWall(self.obj.player.next_position_vel()) && !self.data.easy){ 
				collision = true;
			}
			//Comprobamos que no haya autocolisión
			positions_blocks = self.obj.player.get_positions();
			for(var i in positions_blocks){
				if(position[0] == positions_blocks[i][0] && position[1] == positions_blocks[i][1]) collision = true; 
			}
			//segundo movemos los enemigos y luego miramos si algo ha inpacado contra la cabeza del jugador.
			if(self.obj.enemies.step()){
				collision = true;
			}
			//Ahora habría que comprobar si se ha cogido un isotopo. Pero eso para más adelante.
			if(self.data.levels[self.data.map_selected].end_position[0] < 0 && self.obj.isotopes.isIsotope(self.obj.player.actual_position())){
				self.obj.isotopes.generate_isotope();
				self.obj.isotopes.put_isotope();
				self.obj.player.grow();
				if( self.obj.player.get_length() >= self.data.levels[self.data.map_selected].winLength){ //Hemos ganado
					win = true;
				}
			}
			//if( ! self.obj.wall.isWall(position) ) self.obj.player.move();
			if( !self.obj.wall.isWall(self.obj.player.next_position_vel())){ 
				self.obj.player.move();
			}else{
				if(!self.data.easy){
					collision = true;
				}
			}

			if( collision ){ 
				clearInterval(self.loop_timer);
				self.die();
				loopExec = false;
				self.initializeGame();
			}
			if(win){
				clearInterval(self.loop_timer);
				//alert("You win!")
				//Tenemos que mirar si es campaña. Si es campaña mirar si está desbloqueado el nivel y si no, desbloquearlo. Y después mostrar el menú si o si.
				if(self.data.map_selected <= 5){ //Estamos en un mapa de campaña.
					if(parseInt(localStorage.unlockedLevel) < self.data.map_selected+1){ //Desbloqueamos el mapa.
						localStorage.unlockedLevel = self.data.map_selected+1;
					}
					//Pasamos al proximo mapa
					self.data.map_selected++;
					console.log(self.data.map_selected)
				}
					if(self.data.map_selected < 5) self.initializeGame();
					else self.displayMenu();
				return 0;
			}
			loopExec = false;
			Ctx.restore();
		}
	}, 25);
};


Interfaz.prototype.die = function() {
	//Muestra la pantalla de game over y llama a menu para jugar otra
	//alert("you die");
};

Interfaz.prototype.initializeMatEditor = function() {
	if(this.obj.mapEditor) this.obj.mapEditor.get_dom().remove();
	this.obj.mapEditor = new MapEditor(this);
	this.dom.canvasMapEditor.append(this.obj.mapEditor.get_dom());
	this.displayMapEditor();
};

Interfaz.prototype.initializeMapSelection = function() {
	var self = this;
	//Hay que mirar todos los mapas. Y si tienes oficil == true entonces los ponemos en la lista de los oficiales. Si no, en la lista de los no oficiales.
	this.dom.menu.mapListOfficial.html("");
	this.dom.menu.mapListUnOfficial.html("");
	this.dom.menu.mapListOfficial.append($("<p>").text("Official Maps (Unlockables)").addClass("boton_select_map"));
	this.dom.menu.mapListUnOfficial.append($("<p>").text("Unofficial Maps").addClass("boton_select_map"))

	var temp_counter = 0, temp, temp_counter2 = 0;
	for (var i = 0; i < this.data.levels.length; i++) {
		if(this.data.levels[i].official){ //Es un mapa oficial. Ergo lo ponemos en la lista de mapas oiciales
			if(temp_counter <= this.data.unlockedLevel){
				temp = $("<div>").append($("<p>").text((temp_counter+1)+" - : "+this.data.levels[i].name)).addClass("boton_select_map");
				this.dom.menu.mapListOfficial.append( temp );
				//Ponemos el evento de cargar ese mapa en caso de click
				temp.click((function (i) {
					return function () {
						self.data.map_selected = i;
						self.initializeGame();
					};
				})(i))
				temp_counter++;
			}
		}else{ //No es un mapa oficial
			temp = $("<div>").append($("<p>").text("X").addClass("borrar_mapa")).append($("<p>").text((temp_counter2+1)+" - : "+this.data.levels[i].name)).addClass("boton_select_map");
			this.dom.menu.mapListUnOfficial.append( temp );
			//Ponemos el evento de cargar ese mapa en caso de click
			temp.click((function (i) {
				return function () {
					self.data.map_selected = i;
					self.initializeGame();
				};
			})(i));
			temp.children(".borrar_mapa").click((function (i, temp_counter2) {
				return function (event) {
					event.stopPropagation();
					//Borar el mapa de la lista, de memoria y de local storage
					self.data.levels.splice(i, 1);
					self.dom.menu.mapListUnOfficial.children("div:eq("+i+")").remove();
					//borrar del local storage. Para ello parseamos el local estorage y borramos [temp_counter2].
					if(typeof(Storage)!=="undefined") localStorage.savedMaps = JSON.stringify(jQuery.parseJSON(localStorage.savedMaps).splice(temp_counter2, 1));
				}
			})(i, temp_counter2));
			temp_counter2++;
		}
	};


	this.dom.menu.cont.css({display: "none"});
	this.dom.menu.contList.css({display: "block"});
};

Interfaz.prototype.loadMapsStorage = function() {
	if(typeof(Storage)!=="undefined" && typeof(localStorage.savedMaps) !== "undefined"){ //Si hay web localStorage y existe la variable savedMaps
		//leemos esa variable, la parseamos con json y la ponemos en concatenación del array de mapas normal
		var temp = jQuery.parseJSON(localStorage.savedMaps);
		for (var i = 0; i < temp.length; i++) {
			this.data.levels[this.data.levels.length] = temp[i]; 
		};
	}
};






Interfaz.prototype.displayMapEditor = function() {
	this.dom.canvas.css({display: "none"});
	this.dom.canvasMapEditor.css({display: "block"});
	this.dom.canvas_menu.css({display: "none"});

};

Interfaz.prototype.displayMenu = function() {

	this.dom.canvas.css({display: "none"});
	this.dom.canvasMapEditor.css({display: "none"});
	this.dom.canvas_menu.css({display: "block"}).css({width: this.data.anchura * this.data.ancho_cuadro, height: this.data.altura * this.data.alto_cuadro});
	this.dom.menu.cont.css({display: "block"});
	this.dom.menu.contList.css({display: "none"});

};

Interfaz.prototype.displayGame = function() {

	this.dom.canvas_menu.css({display: "none"});
	this.dom.canvasMapEditor.css({display: "none"});
	this.dom.canvas.css({display: "block"}).css({width: this.data.levels[ this.data.map_selected ].width * this.data.ancho_cuadro, height: this.data.levels[ this.data.map_selected ].height * this.data.alto_cuadro});

};

Interfaz.prototype.staticData = function() {

	this.obj = {};

	this.data = {};
	this.data.altura =  60;
	this.data.anchura = 120;

	this.data.alto_cuadro  = 10;
	this.data.ancho_cuadro = 10;

	this.data.map_selected = 0;
	this.data.easy = false;

	//Esto será e nivel. Tiene la información de las paredes, los enemigos. Etc
	this.data.levels = [
		{"width":40,"height":33,"name":"The beginning","initial_position":[5,16,"d"],"end_position":[-5,-5],"wall":[[35,28],[35,27],[35,26],[35,25],[35,21],[35,20],[35,19],[35,18],[35,14],[35,13],[35,12],[35,11],[35,7],[35,6],[35,5],[35,4],[34,28],[34,27],[34,26],[34,25],[34,21],[34,20],[34,19],[34,18],[34,14],[34,13],[34,12],[34,11],[34,7],[34,6],[34,5],[34,4],[33,28],[33,27],[33,26],[33,25],[33,21],[33,20],[33,19],[33,18],[33,14],[33,13],[33,12],[33,11],[33,7],[33,6],[33,5],[33,4],[32,28],[32,27],[32,26],[32,25],[32,21],[32,20],[32,19],[32,18],[32,14],[32,13],[32,12],[32,11],[32,7],[32,6],[32,5],[32,4],[31,28],[31,27],[31,26],[31,25],[31,21],[31,20],[31,19],[31,18],[31,14],[31,13],[31,12],[31,11],[31,7],[31,6],[31,5],[31,4],[26,28],[26,27],[26,26],[26,25],[26,21],[26,20],[26,19],[26,18],[26,14],[26,13],[26,12],[26,11],[26,7],[26,6],[26,5],[26,4],[25,28],[25,27],[25,26],[25,25],[25,21],[25,20],[25,19],[25,18],[25,14],[25,13],[25,12],[25,11],[25,7],[25,6],[25,5],[25,4],[24,28],[24,27],[24,26],[24,25],[24,21],[24,20],[24,19],[24,18],[24,14],[24,13],[24,12],[24,11],[24,7],[24,6],[24,5],[24,4],[23,28],[23,27],[23,26],[23,25],[23,21],[23,20],[23,19],[23,18],[23,14],[23,13],[23,12],[23,11],[23,7],[23,6],[23,5],[23,4],[22,28],[22,27],[22,26],[22,25],[22,21],[22,20],[22,19],[22,18],[22,14],[22,13],[22,12],[22,11],[22,7],[22,6],[22,5],[22,4],[17,28],[17,27],[17,26],[17,25],[17,21],[17,20],[17,19],[17,18],[17,14],[17,13],[17,12],[17,11],[17,7],[17,6],[17,5],[17,4],[16,28],[16,27],[16,26],[16,25],[16,21],[16,20],[16,19],[16,18],[16,14],[16,13],[16,12],[16,11],[16,7],[16,6],[16,5],[16,4],[15,28],[15,27],[15,26],[15,25],[15,21],[15,20],[15,19],[15,18],[15,14],[15,13],[15,12],[15,11],[15,7],[15,6],[15,5],[15,4],[14,28],[14,27],[14,26],[14,25],[14,21],[14,20],[14,19],[14,18],[14,14],[14,13],[14,12],[14,11],[14,7],[14,6],[14,5],[14,4],[13,28],[13,27],[13,26],[13,25],[13,21],[13,20],[13,19],[13,18],[13,14],[13,13],[13,12],[13,11],[13,7],[13,6],[13,5],[13,4],[8,28],[8,27],[8,26],[8,25],[8,21],[8,20],[8,19],[8,18],[8,14],[8,13],[8,12],[8,11],[8,7],[8,6],[8,5],[8,4],[7,28],[7,27],[7,26],[7,25],[7,21],[7,20],[7,19],[7,18],[7,14],[7,13],[7,12],[7,11],[7,7],[7,6],[7,5],[7,4],[6,28],[6,27],[6,26],[6,25],[6,21],[6,20],[6,19],[6,18],[6,14],[6,13],[6,12],[6,11],[6,7],[6,6],[6,5],[6,4],[5,28],[5,27],[5,26],[5,25],[5,21],[5,20],[5,19],[5,18],[5,14],[5,13],[5,12],[5,11],[5,7],[5,6],[5,5],[5,4],[4,28],[4,27],[4,26],[4,25],[4,21],[4,20],[4,19],[4,18],[4,14],[4,13],[4,12],[4,11],[4,7],[4,6],[4,5],[4,4]],"enemies":[],"winLength":8,"initial_length":2,"official":true},
		{"width":120,"height":30,"name":"The persecution","initial_position":[4,3,"d"],"end_position":[117,13],"wall":[[116,21],[116,20],[116,19],[116,18],[116,17],[115,26],[115,25],[115,24],[115,23],[115,22],[115,21],[115,20],[115,19],[115,18],[115,17],[115,16],[115,15],[115,14],[115,13],[115,12],[115,11],[115,10],[115,9],[115,8],[115,7],[115,6],[115,5],[115,4],[115,3],[115,2],[114,26],[114,25],[114,24],[114,23],[114,22],[114,21],[114,20],[114,19],[114,18],[114,17],[114,16],[114,15],[114,14],[114,13],[114,12],[114,11],[114,10],[114,9],[114,8],[114,7],[114,6],[114,5],[114,4],[114,3],[114,2],[113,26],[113,25],[113,24],[113,23],[113,22],[113,21],[113,20],[113,19],[113,18],[113,17],[113,16],[113,15],[113,14],[113,13],[113,12],[113,11],[113,10],[113,9],[113,8],[113,7],[113,6],[113,5],[113,4],[113,3],[113,2],[112,26],[112,25],[112,24],[112,23],[112,22],[112,21],[112,20],[112,19],[112,18],[112,17],[112,16],[112,15],[112,14],[112,13],[112,12],[112,11],[112,10],[112,9],[112,8],[112,7],[112,6],[112,5],[112,4],[112,3],[112,2],[111,26],[111,25],[111,24],[111,23],[111,22],[111,21],[111,20],[111,19],[111,18],[111,17],[111,16],[111,15],[111,14],[111,13],[111,12],[111,11],[111,10],[111,9],[111,8],[111,7],[111,6],[111,5],[111,4],[111,3],[111,2],[110,26],[110,25],[110,24],[110,23],[110,22],[110,21],[110,20],[110,19],[110,18],[110,17],[110,16],[110,15],[110,14],[110,13],[110,12],[110,11],[110,10],[110,9],[110,8],[110,7],[110,6],[110,5],[110,4],[110,3],[110,2],[109,26],[109,25],[109,24],[109,23],[109,22],[109,21],[109,20],[109,19],[109,18],[109,17],[109,16],[109,15],[109,14],[109,13],[109,12],[109,11],[109,10],[109,9],[109,8],[109,7],[109,6],[109,5],[109,4],[109,3],[109,2],[108,27],[108,26],[108,25],[108,24],[108,23],[108,22],[108,21],[108,20],[108,19],[108,18],[108,17],[108,16],[108,15],[108,14],[108,13],[108,12],[108,11],[108,10],[108,9],[108,8],[108,7],[108,6],[108,5],[108,4],[108,3],[108,2],[107,27],[107,26],[107,25],[107,24],[107,23],[107,22],[107,21],[107,20],[107,19],[107,18],[107,17],[107,16],[107,15],[107,14],[107,13],[107,12],[107,11],[107,10],[107,9],[107,8],[107,7],[107,6],[107,5],[107,4],[107,3],[107,2],[106,28],[106,27],[106,26],[106,25],[106,24],[106,23],[106,22],[106,21],[106,20],[106,19],[106,18],[106,17],[106,16],[106,15],[106,14],[106,13],[106,12],[106,11],[106,10],[106,9],[106,8],[106,7],[106,6],[106,5],[106,4],[106,3],[106,2],[105,28],[105,27],[105,26],[105,23],[105,22],[105,21],[105,20],[105,19],[105,18],[105,17],[105,16],[105,15],[105,14],[105,13],[105,12],[105,11],[105,10],[105,9],[105,8],[105,7],[105,6],[105,3],[105,2],[104,26],[104,20],[104,3],[103,26],[103,20],[103,3],[102,26],[102,23],[102,20],[102,3],[101,29],[101,26],[101,23],[101,20],[101,15],[101,11],[101,3],[100,29],[100,26],[100,23],[100,20],[100,15],[100,11],[100,3],[99,29],[99,26],[99,23],[99,20],[99,15],[99,11],[99,3],[98,29],[98,26],[98,23],[98,17],[98,16],[98,15],[98,11],[98,10],[98,9],[98,3],[97,29],[97,26],[97,23],[97,17],[97,9],[97,3],[96,26],[96,23],[96,22],[96,21],[96,20],[96,19],[96,18],[96,17],[96,15],[96,11],[96,9],[96,3],[95,26],[95,17],[95,16],[95,15],[95,11],[95,10],[95,9],[95,3],[94,26],[94,17],[94,16],[94,15],[94,11],[94,10],[94,9],[94,3],[93,26],[93,17],[93,9],[93,3],[92,27],[92,26],[92,25],[92,24],[92,23],[92,22],[92,21],[92,20],[92,17],[92,15],[92,11],[92,9],[92,3],[91,27],[91,26],[91,20],[91,17],[91,16],[91,15],[91,11],[91,10],[91,9],[91,3],[90,27],[90,26],[90,20],[90,17],[90,16],[90,15],[90,11],[90,10],[90,9],[90,3],[89,27],[89,26],[89,24],[89,20],[89,17],[89,9],[88,27],[88,26],[88,24],[88,20],[88,17],[88,15],[88,11],[88,9],[87,26],[87,24],[87,20],[87,17],[87,16],[87,15],[87,11],[87,10],[87,9],[86,26],[86,24],[86,17],[86,16],[86,15],[86,11],[86,10],[86,9],[86,8],[86,7],[86,6],[86,5],[85,26],[85,24],[85,23],[85,22],[85,21],[85,20],[85,19],[85,17],[85,9],[85,8],[85,7],[85,6],[84,26],[84,19],[84,18],[84,17],[84,15],[84,11],[84,9],[84,8],[84,7],[84,6],[83,26],[83,17],[83,16],[83,15],[83,11],[83,10],[83,9],[83,8],[83,7],[83,6],[82,26],[82,25],[82,24],[82,23],[82,22],[82,21],[82,15],[82,11],[82,10],[82,9],[82,8],[82,7],[82,6],[81,15],[81,11],[81,10],[81,9],[81,8],[81,7],[81,6],[80,15],[80,11],[80,10],[80,9],[80,8],[80,7],[80,6],[79,29],[79,28],[79,27],[79,26],[79,25],[79,24],[79,23],[79,22],[79,21],[79,20],[79,19],[79,18],[79,17],[79,16],[79,15],[79,11],[79,10],[79,9],[79,8],[79,7],[79,6],[79,5],[79,4],[79,3],[79,2],[79,1],[79,0],[77,15],[77,11],[73,15],[73,11],[69,15],[69,11],[65,15],[65,11],[61,15],[61,11],[57,16],[57,15],[57,11],[57,10],[56,16],[56,10],[55,16],[55,10],[54,16],[54,10],[53,16],[53,15],[53,11],[53,10],[52,29],[52,28],[52,27],[52,26],[52,25],[52,23],[52,22],[52,21],[52,20],[52,19],[52,18],[52,17],[52,16],[52,10],[52,9],[52,6],[52,5],[52,4],[52,3],[52,2],[52,1],[52,0],[51,25],[51,24],[51,23],[51,8],[51,7],[51,6],[46,10],[46,9],[46,8],[46,7],[45,11],[45,10],[45,7],[44,11],[44,7],[43,11],[43,7],[42,29],[42,28],[42,27],[42,26],[42,22],[42,21],[42,20],[42,19],[42,18],[42,17],[42,16],[42,15],[42,14],[42,13],[42,12],[42,11],[42,7],[41,26],[41,25],[41,24],[41,23],[41,22],[41,11],[41,7],[41,6],[40,11],[40,6],[39,11],[39,6],[38,11],[38,6],[37,11],[36,11],[35,26],[35,25],[35,24],[35,23],[35,22],[35,21],[35,20],[35,19],[35,18],[35,17],[35,11],[34,17],[34,11],[33,17],[33,11],[32,17],[32,11],[32,6],[31,17],[31,11],[31,6],[30,29],[30,28],[30,27],[30,26],[30,25],[30,24],[30,17],[30,11],[30,6],[29,29],[29,28],[29,27],[29,26],[29,25],[29,24],[29,17],[29,11],[29,10],[29,9],[29,8],[29,7],[29,6],[28,29],[28,28],[28,27],[28,26],[28,25],[28,24],[28,17],[28,6],[27,29],[27,28],[27,27],[27,26],[27,25],[27,24],[27,6],[26,29],[26,28],[26,27],[26,26],[26,25],[26,24],[26,6],[25,29],[25,28],[25,27],[25,26],[25,25],[25,24],[25,6],[24,29],[24,28],[24,27],[24,26],[24,25],[24,24],[24,23],[24,17],[24,16],[24,15],[24,14],[24,13],[24,12],[24,6],[23,13],[23,6],[22,13],[21,13],[20,13],[19,13],[18,24],[18,23],[18,22],[18,21],[18,20],[18,19],[18,18],[18,17],[18,16],[18,15],[18,14],[18,13],[18,12],[18,11],[18,10],[18,9],[18,8],[18,7],[18,6],[18,5],[18,4],[18,3],[18,2],[18,1],[18,0],[14,19],[13,19],[12,19],[12,18],[12,17],[12,16],[12,15],[12,14],[12,13],[12,12],[12,11],[12,10],[12,9],[12,8],[12,5],[11,18],[11,5],[10,18],[10,5],[9,18],[9,5],[8,18],[8,5],[7,18],[7,5],[6,18],[6,5],[5,18],[5,5],[4,18],[4,5],[3,18],[3,5],[2,18],[2,5],[1,5],[0,5]],"enemies":[{"type":"walker","x":104,"y":2},{"type":"walker","x":103,"y":2},{"type":"walker","x":102,"y":2},{"type":"walker","x":96,"y":16},{"type":"walker","x":96,"y":10},{"type":"walker","x":92,"y":16},{"type":"walker","x":92,"y":10},{"type":"walker","x":88,"y":16},{"type":"walker","x":88,"y":10},{"type":"walker","x":85,"y":5},{"type":"walker","x":84,"y":16},{"type":"walker","x":84,"y":10},{"type":"walker","x":84,"y":5},{"type":"walker","x":83,"y":5},{"type":"walker","x":82,"y":5},{"type":"walker","x":81,"y":5},{"type":"walker","x":80,"y":5},{"type":"walker","x":78,"y":28},{"type":"walker","x":77,"y":22},{"type":"walker","x":77,"y":19},{"type":"walker","x":76,"y":19},{"type":"walker","x":74,"y":8},{"type":"walker","x":74,"y":6},{"type":"walker","x":72,"y":22},{"type":"walker","x":72,"y":21},{"type":"walker","x":72,"y":2},{"type":"walker","x":71,"y":20},{"type":"walker","x":69,"y":23},{"type":"walker","x":69,"y":6},{"type":"walker","x":69,"y":0},{"type":"walker","x":66,"y":19},{"type":"walker","x":66,"y":2},{"type":"walker","x":66,"y":1},{"type":"walker","x":65,"y":23},{"type":"walker","x":64,"y":3},{"type":"walker","x":62,"y":2},{"type":"walker","x":61,"y":27},{"type":"walker","x":61,"y":20},{"type":"walker","x":61,"y":8},{"type":"walker","x":60,"y":17},{"type":"walker","x":60,"y":0},{"type":"walker","x":59,"y":27},{"type":"walker","x":58,"y":24},{"type":"walker","x":58,"y":3},{"type":"walker","x":57,"y":21},{"type":"walker","x":57,"y":8},{"type":"walker","x":57,"y":6},{"type":"walker","x":56,"y":18},{"type":"walker","x":55,"y":25},{"type":"walker","x":55,"y":24},{"type":"walker","x":55,"y":21},{"type":"walker","x":49,"y":29},{"type":"walker","x":48,"y":29},{"type":"walker","x":47,"y":29},{"type":"walker","x":46,"y":29},{"type":"walker","x":45,"y":29},{"type":"walker","x":40,"y":10},{"type":"walker","x":39,"y":10},{"type":"walker","x":38,"y":10},{"type":"walker","x":33,"y":10},{"type":"walker","x":32,"y":10},{"type":"walker","x":31,"y":10},{"type":"walker","x":30,"y":10},{"type":"walker","x":23,"y":12},{"type":"walker","x":22,"y":12},{"type":"walker","x":21,"y":12},{"type":"walker","x":20,"y":12},{"type":"walker","x":19,"y":12},{"type":"walker","x":11,"y":19},{"type":"walker","x":10,"y":19},{"type":"walker","x":10,"y":6},{"type":"walker","x":9,"y":19},{"type":"walker","x":9,"y":6},{"type":"walker","x":8,"y":19},{"type":"walker","x":8,"y":6},{"type":"walker","x":7,"y":19},{"type":"walker","x":7,"y":6},{"type":"walker","x":6,"y":19}],"winLength":1000000,"initial_length":6,"official":true},
		{"width":60,"height":60,"name":"The ring","initial_position":[29,3,"s"],"end_position":[-5,-5],"wall":[[59,59],[59,0],[58,58],[58,1],[57,57],[57,2],[56,56],[56,3],[52,52],[52,51],[52,50],[52,49],[52,48],[52,47],[52,46],[52,45],[52,44],[52,43],[52,42],[52,41],[52,40],[52,39],[52,38],[52,37],[52,36],[52,35],[52,24],[52,23],[52,22],[52,21],[52,20],[52,19],[52,18],[52,17],[52,16],[52,15],[52,14],[52,13],[52,12],[52,11],[52,10],[52,9],[52,8],[52,7],[51,52],[51,51],[51,8],[51,7],[50,52],[50,50],[50,9],[50,7],[49,52],[49,49],[49,10],[49,7],[48,52],[48,7],[47,52],[47,7],[46,52],[46,7],[45,52],[45,45],[45,14],[45,7],[44,52],[44,44],[44,15],[44,7],[43,52],[43,43],[43,16],[43,7],[42,52],[42,42],[42,41],[42,40],[42,39],[42,38],[42,37],[42,36],[42,35],[42,34],[42,33],[42,26],[42,25],[42,24],[42,23],[42,22],[42,21],[42,20],[42,19],[42,18],[42,17],[42,7],[41,52],[41,42],[41,17],[41,7],[40,52],[40,42],[40,17],[40,7],[39,52],[39,42],[39,17],[39,7],[38,52],[38,42],[38,38],[38,21],[38,17],[38,7],[37,52],[37,42],[37,37],[37,22],[37,17],[37,7],[36,52],[36,42],[36,36],[36,23],[36,17],[36,7],[35,52],[35,42],[35,35],[35,34],[35,33],[35,32],[35,31],[35,28],[35,27],[35,26],[35,25],[35,24],[35,17],[35,7],[34,42],[34,35],[34,24],[34,17],[33,42],[33,35],[33,24],[33,17],[32,35],[32,24],[31,35],[31,31],[31,28],[31,24],[30,30],[30,29],[29,30],[29,29],[28,35],[28,31],[28,28],[28,24],[27,35],[27,24],[26,42],[26,35],[26,24],[26,17],[25,42],[25,35],[25,24],[25,17],[24,52],[24,42],[24,35],[24,34],[24,33],[24,32],[24,31],[24,28],[24,27],[24,26],[24,25],[24,24],[24,17],[24,7],[23,52],[23,42],[23,36],[23,23],[23,17],[23,7],[22,52],[22,42],[22,37],[22,22],[22,17],[22,7],[21,52],[21,42],[21,38],[21,21],[21,17],[21,7],[20,52],[20,42],[20,17],[20,7],[19,52],[19,42],[19,17],[19,7],[18,52],[18,42],[18,17],[18,7],[17,52],[17,42],[17,41],[17,40],[17,39],[17,38],[17,37],[17,36],[17,35],[17,34],[17,33],[17,26],[17,25],[17,24],[17,23],[17,22],[17,21],[17,20],[17,19],[17,18],[17,17],[17,7],[16,52],[16,43],[16,16],[16,7],[15,52],[15,44],[15,15],[15,7],[14,52],[14,45],[14,14],[14,7],[13,52],[13,7],[12,52],[12,7],[11,52],[11,7],[10,52],[10,49],[10,10],[10,7],[9,52],[9,50],[9,9],[9,7],[8,52],[8,51],[8,8],[8,7],[7,52],[7,51],[7,50],[7,49],[7,48],[7,47],[7,46],[7,45],[7,44],[7,43],[7,42],[7,41],[7,40],[7,39],[7,38],[7,37],[7,36],[7,35],[7,24],[7,23],[7,22],[7,21],[7,20],[7,19],[7,18],[7,17],[7,16],[7,15],[7,14],[7,13],[7,12],[7,11],[7,10],[7,9],[7,8],[7,7],[3,56],[3,3],[2,57],[2,2],[1,58],[1,1],[0,59],[0,0]],"enemies":[{"type":"walker","x":59,"y":58},{"type":"walker","x":59,"y":57},{"type":"walker","x":59,"y":2},{"type":"walker","x":59,"y":1},{"type":"walker","x":58,"y":59},{"type":"walker","x":58,"y":57},{"type":"walker","x":58,"y":56},{"type":"walker","x":58,"y":3},{"type":"walker","x":58,"y":2},{"type":"walker","x":58,"y":0},{"type":"walker","x":57,"y":59},{"type":"walker","x":57,"y":58},{"type":"walker","x":57,"y":56},{"type":"walker","x":57,"y":55},{"type":"walker","x":57,"y":4},{"type":"walker","x":57,"y":3},{"type":"walker","x":57,"y":1},{"type":"walker","x":57,"y":0},{"type":"walker","x":56,"y":58},{"type":"walker","x":56,"y":57},{"type":"walker","x":56,"y":55},{"type":"walker","x":56,"y":4},{"type":"walker","x":56,"y":2},{"type":"walker","x":56,"y":1},{"type":"walker","x":55,"y":57},{"type":"walker","x":55,"y":56},{"type":"walker","x":55,"y":3},{"type":"walker","x":55,"y":2},{"type":"walker","x":51,"y":50},{"type":"walker","x":51,"y":9},{"type":"walker","x":50,"y":51},{"type":"walker","x":50,"y":8},{"type":"walker","x":34,"y":59},{"type":"walker","x":33,"y":59},{"type":"walker","x":32,"y":59},{"type":"walker","x":31,"y":59},{"type":"walker","x":31,"y":30},{"type":"walker","x":31,"y":29},{"type":"walker","x":30,"y":59},{"type":"walker","x":30,"y":31},{"type":"walker","x":30,"y":28},{"type":"walker","x":29,"y":59},{"type":"walker","x":29,"y":31},{"type":"walker","x":29,"y":28},{"type":"walker","x":28,"y":59},{"type":"walker","x":28,"y":30},{"type":"walker","x":28,"y":29},{"type":"walker","x":27,"y":59},{"type":"walker","x":26,"y":59},{"type":"walker","x":25,"y":59},{"type":"walker","x":9,"y":51},{"type":"walker","x":9,"y":8},{"type":"walker","x":8,"y":50},{"type":"walker","x":8,"y":9},{"type":"walker","x":4,"y":57},{"type":"walker","x":4,"y":56},{"type":"walker","x":4,"y":3},{"type":"walker","x":4,"y":2},{"type":"walker","x":3,"y":58},{"type":"walker","x":3,"y":57},{"type":"walker","x":3,"y":55},{"type":"walker","x":3,"y":4},{"type":"walker","x":3,"y":2},{"type":"walker","x":3,"y":1},{"type":"walker","x":2,"y":59},{"type":"walker","x":2,"y":58},{"type":"walker","x":2,"y":56},{"type":"walker","x":2,"y":55},{"type":"walker","x":2,"y":4},{"type":"walker","x":2,"y":3},{"type":"walker","x":2,"y":1},{"type":"walker","x":2,"y":0},{"type":"walker","x":1,"y":59},{"type":"walker","x":1,"y":57},{"type":"walker","x":1,"y":56},{"type":"walker","x":1,"y":3},{"type":"walker","x":1,"y":2},{"type":"walker","x":1,"y":0},{"type":"walker","x":0,"y":58},{"type":"walker","x":0,"y":57},{"type":"walker","x":0,"y":2},{"type":"walker","x":0,"y":1}],"winLength":10,"initial_length":6,"official":true},
		{"width":45,"height":45,"name":"The racer","initial_position":[17,4,"s"],"end_position":[-5,-5],"wall":[[34,34],[34,33],[34,11],[34,10],[33,34],[33,33],[33,11],[33,10],[23,22],[23,21],[22,22],[22,21],[11,34],[11,33],[11,11],[11,10],[10,34],[10,33],[10,11],[10,10]],"enemies":[{"type":"walker","x":43,"y":4},{"type":"walker","x":40,"y":41},{"type":"walker","x":37,"y":23},{"type":"walker","x":23,"y":14},{"type":"walker","x":22,"y":35},{"type":"walker","x":9,"y":21},{"type":"walker","x":5,"y":40},{"type":"walker","x":3,"y":2}],"winLength":16,"initial_length":10,"official":true},
		{"width":50,"height":40,"name":"The fight","initial_position":[40,19,"a"],"end_position":[-5,-5],"wall":[],"enemies":[{"type":"beast","x":49,"y":38},{"type":"beast","x":49,"y":21},{"type":"beast","x":49,"y":17},{"type":"beast","x":49,"y":1},{"type":"beast","x":48,"y":39},{"type":"beast","x":48,"y":0},{"type":"beast","x":26,"y":39},{"type":"beast","x":26,"y":0},{"type":"beast","x":22,"y":39},{"type":"beast","x":22,"y":0},{"type":"beast","x":1,"y":39},{"type":"beast","x":1,"y":0},{"type":"beast","x":0,"y":38},{"type":"beast","x":0,"y":21},{"type":"beast","x":0,"y":17},{"type":"beast","x":0,"y":1},{"type":"beast","x":0,"y":0}],"winLength":20,"initial_length":16,"official":true}
	];
	this.data.unlockedLevel = 5;

	if(typeof(Storage) !== "undefined"){
		if(typeof(localStorage.unlockedLevel)!=="undefined"){
			this.data.unlockedLevel = parseInt(localStorage.unlockedLevel);
		}
	}
};

Interfaz.prototype.staticDom = function() {
	
	this.dom = {
		canvas: $("#canvas").addClass("ventana_juego").css({display: "none"}),
		canvas_menu: $("<div>").addClass("ventana_menu").css({width: this.data.anchura * this.data.ancho_cuadro, height: this.data.altura * this.data.alto_cuadro}),
		canvasMapEditor: $("<div>").addClass("canvas_map_editor").css({display: "none"}),
		objective: $("<p>").text("").addClass("objetivo_pantalla").css({display: "none"})
	};
	this.contenedor.append(this.dom.canvas).append(this.dom.canvas_menu).append(this.dom.canvasMapEditor).prepend(this.dom.objective);
};

Interfaz.prototype.localStorage = function() {
	if(typeof(Storage)!=="undefined"){
		if(typeof(localStorage.unlockedLevel)!=="undefined"){
			this.data.unlockedLevel = parseInt(localStorage.unlockedLevel);
		}else{
			this.data.unlockedLevel = 0;
			localStorage.unlockedLevel = 0;
			localStorage.savedMaps = JSON.stringify(new Array());
		}
	}else{
		alert("No Local Web Storage support. Autosave disabled. \n\nPlease play with modern browser. Ex: Firefox and Chrome")
	}
};