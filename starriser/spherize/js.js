"use strict";
var Spherize = function (imageData, x, y, radius, interpolate, fpixels) {
	return this.init(imageData, x, y, radius, interpolate, fpixels);
};

Spherize.prototype.init = function(imageData, x, y, radius, interpolate, fpixels) {



	return this.spherize(imageData, x, y, radius, interpolate, fpixels, fpixels.width, imageData.width);
};

Spherize.prototype.spherize = function(imageData, centerX, centerY, _radius, interpolate, fpixels, finalWidth, fromWidth) { var counter = 0;
	var distanceToCenter, x, y, angle, angle2, x1, y1, pixel, colorPoints, pointColor, pointColorAreas, j, i, rectW, radius, pixelsPerRad, maxforipixels, ipixels, ipixelsData, fpixelsData, vecPos, maxfor, acos, pi, floor, ceil;

	acos = Math.acos;
	pi = Math.PI;
	floor = Math.floor;
	ceil = Math.ceil;

	ipixelsData = imageData.data;
	fpixelsData = fpixels.data;

	radius = _radius;

	pixelsPerRad = fromWidth / pi;

	maxfor = fpixelsData.length;

	colorPoints = [[0,0], [0,0], [0,0], [0,0]];
	pointColorAreas = [0,0,0,0];
	
	for (i = 0; i < maxfor; i += 4) {
		pixel = i/4;
		y = Math.floor(pixel / finalWidth);
		x = pixel - y * finalWidth;

		distanceToCenter = Math.sqrt( ( x - centerX )*( x - centerX ) + ( y - centerY )*( y - centerY ) );
		if(distanceToCenter <= radius){

			angle = acos(distanceToCenter / radius);

			distanceToCenter = (pi/2 - angle) * pixelsPerRad;

			angle2 = Math.atan2( centerY - y, centerX - x);
			if(angle2 < 0) angle2 += 2*pi;

			x1 = -distanceToCenter * Math.cos(angle2) + fromWidth/2;
			y1 = -distanceToCenter * Math.sin(angle2) + fromWidth/2;

			//Ya tenemos la coordenada, ahora hay que sacar el color dependiendo del resto puntos. 

			if(!interpolate){
				x1 = Math.round(x1); //Sin interpolar
				y1 = Math.round(y1);
				
				vecPos = (y1 * fromWidth + x1) * 4;

				fpixelsData[ i ]     = ipixelsData[ vecPos ];
				fpixelsData[ i + 1 ] = ipixelsData[ vecPos + 1];
				fpixelsData[ i + 2 ] = ipixelsData[ vecPos + 2];
				fpixelsData[ i + 3 ] = ipixelsData[ vecPos + 3]; //Fin sin interpolar*/
			}else{
				if(x1 % 1 === 0) x1 += 0.0000000001;
				if(y1 % 1 === 0) y1 += 0.0000000001;
				//Usaremos interpolación bilineal http://es.wikipedia.org/wiki/Interpolaci%C3%B3n_bilineal
				colorPoints[0][0] = floor(x1); //Segundo cuadrante
				colorPoints[0][1] = floor(y1);

				colorPoints[1][0] = ceil(x1); //Primer cuadrante
				colorPoints[1][1] = floor(y1);

				colorPoints[2][0] = ceil(x1); //Cuarto cuadrante
				colorPoints[2][1] = ceil(y1);

				colorPoints[3][0] = floor(x1); //Tercer cuadrante
				colorPoints[3][1] = ceil(y1);

				//El orden de las areas es el contrario a css, inferior izquierdo a superior izquierdo debido al propio metodo bilineal(recordemos que en gráficos la imagen está volteada en Y, Y hacia abajo y crece)
				pointColorAreas[0] = (colorPoints[2][0] - x1) * (colorPoints[2][1] - y1);
				pointColorAreas[1] = (x1 - colorPoints[3][0]) * (colorPoints[3][1] - y1);
				pointColorAreas[2] = (x1 - colorPoints[0][0]) * (y1 - colorPoints[0][1]);
				pointColorAreas[3] = (colorPoints[1][0] - x1) * (y1 - colorPoints[1][1]);

				for (j = 3; j >= 0; j--) {

					pointColor = (colorPoints[j][0] + colorPoints[j][1] * fromWidth ) * 4;

					fpixelsData[ i ]     += ipixelsData[ pointColor ] * pointColorAreas[j] / 1;
					fpixelsData[ i + 1 ] += ipixelsData[ pointColor + 1] * pointColorAreas[j] / 1;
					fpixelsData[ i + 2 ] += ipixelsData[ pointColor + 2] * pointColorAreas[j] / 1;
					fpixelsData[ i + 3 ] += ipixelsData[ pointColor + 3] * pointColorAreas[j] / 1;
				}
			}
		}
	}

	return fpixels;
};


self.addEventListener('message', function(e) {

	//Ejemplo para 4 workers
	//new Spherize(dataTemp, width/2 - x*(width/2) , height/2 - y*(width/2), width/2, false, dataTemp2, width/2, height/2, width, height);
	/*
	workers[i].postMessage({
		initialImage: dataTemp,
		finalImage: dataTemp2,
		centerX: width/2 - x*(width/2),
		centerY: height/2 - y*(width/2),
		radius: width/2,
		interpolate: false,

	});
	*/

	e = e.data;

	var canvas = new Spherize(e.initialImage, e.centerX, e.centerY, e.radius, e.interpolate, e.finalImage);

	self.postMessage(canvas);

}, false);