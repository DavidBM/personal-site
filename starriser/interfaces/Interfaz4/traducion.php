"use strict";
var traducciones_descripciones_botones = [//Todo en contexto de acciones que se pueden hacer entre civilizaciones planetarias dentro de una galaxia y ejercitos de naves a lo starwars.
"Coloniza un planeta enviado una nave colonizadora, necesitas tener como mínimo una nave colonizadora",
"Envia un mensaje al jugador propietario del planeta",
"Hace zoom al planeta mostrando todo el sistema",
"Pone un marcador en el planeta seleccionado",
"Borra el marcador seleccionado",
"Envia tropas al planeta para que se queden allí amistosamente. El jugador las mantendrá",
"Envia recursos al planeta",
"Ataca el planeta",
"Posiciona tropas para bloquear el tránsito comercial y militar del planeta",
"Ocupa el planeta militarmente. El jugador seguirá teniendo la propiedad del planeta pero tendrá que pagar las tropas que tengas depositadas en el planeta",
"Espia el planeta",
"Entrar en vista de planeta. El jugador puede ver el estado de su planeta y además puede, si tiene recursos suficientes, subir los edificios, crear naves, desarrollar tecnologías, etc.",
];

var traducciones_interfaz_generica = [
"Planeta sin propietario", //Planeta que no tiene propietario
"Deshabitado", //Planeta que no tiene población / no está habitado
"Sin alianza", //Que no está dentro de ninguna alianza interplanetaría del juego.
"Sin puntuación", //El planeta seleccionado al no tener jugador, no tiene puntuación.

"Nombre del planeta", 
"Nombre del jugador", 
"Alianza del Jugador", 
"Puntuacion del jugador", 

"Planeta", //Refiriendose al nombre del planeta, cada planeta tiene su nombre. Como "Planeta tierra" para la tierra, Ej: Planeta: New earth 2
"Jugador", //Refiriendose al nombre del jugador, Ej: Jugador: Slayerking69
"Alianza",	//Alianza en sentido interplanetario. Después de esto va el nombre de la alianza. Ej: Alianza: Diablos peligrosos
"Puntuación", //Refiriendose a puntos que tiene el juegador: Ej: Puntuación: 200

"Sol", //De estrella que ilumina la tierra
"Posición", //Posición dentro de la grafica en X e Y
"Jugadores", //Jugadores como personas que juagan a este juego
"No aplicable", //Que no hay datos que mostrar en este cuadro ahora mismo y que nose aplica al contexto actual

"Planeta propio", //Se refiere a que el planeta seleccionado es epropio jugador,

"Volver al planeta", //Vuelve a mostrar el menú principal del planeta cuando estás en un submenú de este.

"WTF", //Para ese momento en que en el juego hay un WTF
];

var traducciones_enviar_mensaje = [
"Destinatario", //El destinatario del mensaje que se enviará
"Jugador", //Refiriendose a un jugador del juego único.
"Alianza", //Refiriendose a una alianza de jugadores.
"Dirigido a", //Refiriendose a la persona a la que se dirige el mensaje. Como las cartas. Un sinonimo sería destinatario.
"Mensaje privado", //Refiriendose a un ensaje personal con otro jugador
"Acuerdo comercial", //Un acuerdo comercial entre dos jugadores para intercambiar materias primas.
"Acuerdo Militar", //Acuerdo militar para intercambiar tropas, alojar tropas en el planeta del otro jugador o proteger o escoltar.
"Otro" //Other en ingles, y punto, no hay contexto en esta traducción.
];

var traducciones_enviar_tropas = [
"Distancia", //Distancia entre los planetas que van a tener que recorrer las naves
"Tiempo", //Tiempo entre los planetas que van a tener que recorrer las naves
"Editar / Crear estrategia"
];

var traducciones_menu_select = [
"Seleccione una opción",
];

var vector_traducciones_nombres_naves = [
"Transporte Ligero",
"Trasnporte Pesado", 
"Caza Ligero",
"Caza Pesado", 
"Destructor", 
"Crucero",
"Fragata", 
"Acorazado", 
"Estación",
"Torpedero Grande",
"Bombardero Grande",
"Colonizador",
];

var traducciones_nombre_edificios = [
"Centro de mando", //Edificio que centraliza la gestión del planeta. Centro del laneta y desde donde se controla el planeta.
"Almacenes", //Los almacenes donde se almacenan los recursos y bienes que se tienen en el planeta.
"Extractores", //Maquinaria que extrae el materail basico del planeta. Como son metales, minerales y materia en general. Como mineros.
"Sintetizador",	//Planta industrial - quimica que conbierte los materiales básicos que se sacan del extractor a materiales más valiosos. Como del acero de hierro y el carbón
"Astillero estelar", //Edificio que hace las naves del juegador. 
"Puerto estelar", //Centro comercial del planeta. Aquí llegan los cargamenos de las negociaciones y cualquier tipo de recurso
"Central electrica", //Edificio que se dedica a mantener el resto de los edificios y naves del planeta. Se enncarga de repararlos si están dañados
"Centro de espionaje", //Centro donde se fabrican sondas de espionaje para espiar a los enemigos.
"Centro de investigación", //Centro que se usa para investigar tecnología para el imperio del jugador
];

var traducciones_descripciones_edificios = [
"Este edificio maneja el planeta, su economía y es el centro de gestión.",
"Estos son los alacenes donde se guardan todos tus recursos. Para guardar más tienes que subir el nivel.",
"Aquí minamos la masa del planeta y sacamos materiales en bruto para poder refinarlos.",
"Aquí refinamos los recursos del material que extraemos del planeta.",
"Las naves requieren gran espacio para contruirse y unas instalaciones adapatadas a esta lavor. Por esto se contruyó este monumental edificio.",
"Aquí está el centro comeercial del planeta. Toda compra venta pasa por aquí.",
"Esta planta electrica genera energía para todo el planeta. Desde metodos centralizados como la fusión como metodos descentralizados como las renovables.",
"Para poder adelantarse a acontecimientos se necesita información. Aquí se aplican las tecnicas necesarias para poder conseguir y manejar la información que necesites.",
"Nuestra material gris en cuanto a ciencia, donde se mejoran nuestros sistemas y se desarrollan nuevos tipos de artilugios para mantenernos por delante.",
];

var traducciones_nombre_recursos = [
"Recurso 1",
"Recurso 2",
"Recurso 3",
"Recurso 4",
"Recurso 5",
"Recurso 6",
"Recurso 7",
"Recurso 8",
"Recurso 9",
"Recurso 10",
"Recurso 11",
"Recurso 12",
"Recurso 13",
"Recurso 14",
"Recurso 15",
"Recurso 16",
"Recurso 17",
];

var traducciones_centro_planeta = [
"Nombre del planeta", //El nombre que le he pauesto el jugador al planeta
"Población", //La cantidad de personas que habitan el planeta
"habitantes/h", //Personas que habitan el planeta partido hora (unidad de tiempo) se usa para decir la cantidad de habitantes que nacen en un planeta. 
"Edificios en construcción",
"Edificios en reparación",
];

var traducciones_electrica = [
"Consumo edificio", //La energía que consume el edificio en pleno rendimiento (electricidad)
"Energía suministrada", //La energía que se le suministra al edificio. Puede ser igual o menos que la que necesita. Es malo que sea menor.
"TW/h", // (TeraVatios/h) 1.000.000.000 de Vatios que se generan por hora (electricidad)
"Consumidos", //Refiriendose a TW/h consumidos por X edficio o en total.
];

var traducciones_extractor = [
"KT/h", // (KiloToneladas/h) Millones de kilos que se estraen por hora. Kilo es prefijo que indica 1000 y tonelada sindica 1000, así que kilotonelada es 1.000.000 de kilos. (No quiero una mala traducción de esto)
"Masa extraida", //Masa (termino del campo de la física) que se estrae por hora
"Rendimiento", //Se refiere a si la energia es eficiente. En mecanica un rendimiento de 1 significa que la máquina gasta toda la energia solo en hacer para lo que está diseñada sin emitir calor ni sonido ni nunguna otra forma de energia
traducciones_electrica[2], // Error mio, esto no traducir ni cambiar. (es un parche)
"Consumo de energía", //Consumo de energía del extrator
"Energía destinada al extractor", //La energía que se destina al edificio extractor
];

var traducciones_espionaje = [
"Sondas de patrulla planetaria", //Sondas de espionaje que se han quedado en el planeta propio (el del jugador, el que está manejando ahora mismo)
"Sondas en misión de espionaje", //Sondas que se han enviado a otros planetas. De otros jugadores. Para espiar
"Sondas de camino", //Sondas que están de viaje a una misión de espionaje
"Sondas en misión", //Sondas que están en una misión. Osea, que ya han llegado a un planeta
];

var traducciones_puerto = [
"Selecciona que quieres vender", //Material / Obejeto que quieres poner a la venta en el mercado intergalactio.
];