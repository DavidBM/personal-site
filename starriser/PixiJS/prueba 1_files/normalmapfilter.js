

PIXI.NormalMapFilter = function(texture,texture2)
{
  PIXI.AbstractFilter.call( this );
  this.passes = [this];
  texture.baseTexture._powerOf2 = true;
  texture2.baseTexture._powerOf2 = true;
  this.uniforms = {
	displacementMap: {type: 'sampler2D', value:texture},
	cloudMap: {type: 'sampler2D', value:texture2},
	mapDimensions:   {type: '2f', value:{x:1, y:1}},
	desplazamiento:   {type: '1f', value:varRota}
  };
  if(texture.baseTexture.hasLoaded)
	{
		this.uniforms.mapDimensions.value.x = texture.width;
		this.uniforms.mapDimensions.value.y = texture.height;
	}
	else
	{
		this.boundLoadedFunction = this.onTextureLoaded.bind(this);
		texture.baseTexture.on("loaded", this.boundLoadedFunction);
	}
  this.fragmentSrc = [
  	"precision lowp float;",
  	"uniform sampler2D displacementMap;",
  	"varying vec2 vTextureCoord;",
  	"uniform float desplazamiento;",
	"uniform sampler2D cloudMap;",
	"float modulo,moduloLight,moduloLightBlack;",
	"float angulo;",
	"float nuevoRadio;",
	"float cambioLuz;",
	"vec2 coordLightBlack;",
	"vec4 miColor,origColor,cloudTex,cloudShadowTex;",
	"vec2 coordLight;",
  	"void main(void) { ",
  		"vec2 miTextura=vec2(vTextureCoord.s-0.5,vTextureCoord.t-0.5);",
	    "coordLight = vec2(vTextureCoord.s-1.0, vTextureCoord.t-1.0);",
	    "moduloLight=sqrt(coordLight.s*coordLight.s+coordLight.t*coordLight.t);",
	    "coordLightBlack = vec2(vTextureCoord.s, vTextureCoord.t);",
	    "moduloLightBlack=sqrt(coordLightBlack.s*coordLightBlack.s+coordLightBlack.t*coordLightBlack.t);",
	    "modulo=sqrt(miTextura.s*miTextura.s+miTextura.t*miTextura.t);",

	    "nuevoRadio = 0.5 * asin(modulo / 0.5);",

	    "angulo = atan(miTextura.s, miTextura.t);",

	    "miTextura.t = nuevoRadio * cos(angulo);",
	    "miTextura.s = nuevoRadio * sin(angulo) + desplazamiento;",

	    

  		"if(modulo<0.495){",
  			"miColor=texture2D(displacementMap,1.0-miTextura+0.5);",
  			"cloudTex=texture2D(cloudMap,vec2(miTextura.s-1.5*desplazamiento, miTextura.t)-0.5);",
  			"cloudShadowTex=texture2D(cloudMap,vec2(miTextura.s-1.5*desplazamiento+0.01, miTextura.t+0.01)-0.5);",
  			"miColor+=cloudTex;",
  			
  			"origColor=miColor;",
  			"if(moduloLight<0.5){",
  				"miColor.rgb-=cloudShadowTex.rgb/2.0;",
  				"miColor=miColor*1.2;",
  			"}else if(moduloLight >= 0.5 && moduloLight < 0.8){",
  				"cambioLuz=0.2+(((0.8-moduloLight)/(0.8-0.5)));",
  				"miColor.rgb-=cambioLuz*cloudShadowTex.rgb/2.0;",
		    	"miColor.x*=cambioLuz;//min(1.0, max(origColor.x,miColor.x+());",
		    	"miColor.y*=cambioLuz;//min(1.0, max(origColor.y,miColor.y+((0.5-moduloLight)*2.0)));",
		    	"miColor.z*=cambioLuz;//min(1.0, max(origColor.z,miColor.z+((0.5-moduloLight)*2.0)));",
		    "}if(moduloLight >= 0.8 && moduloLight < 0.85){",
		    	"cambioLuz=1.0-(((0.85-moduloLight)/(0.85-0.8)));",
		    	"miColor.rgb-=cambioLuz*cloudShadowTex.rgb/2.0;",
		    	"miColor.x=miColor.x*0.2;miColor.y=miColor.y*0.2;miColor.z=miColor.z*0.2;",
		    	"miColor.g+=cambioLuz/15.0;miColor.r+=cambioLuz/10.0;", //franja naranja
		    "}else if(moduloLight >= 0.85 && moduloLight < 0.9){",
		    	"cambioLuz=(((0.9-moduloLight)/(0.9-0.85)));",
		    	"miColor.rgb-=cambioLuz*cloudShadowTex.rgb/2.0;",
		    	"miColor.x=miColor.x*0.2;miColor.y=miColor.y*0.2;miColor.z=miColor.z*0.2;",
		    	"miColor.g+=cambioLuz/15.0;miColor.r+=cambioLuz/10.0;", //franja naranja
	    	"}else if(moduloLight >=0.84){", //franja de noche
	    		"miColor.x=miColor.x*0.2;miColor.y=miColor.y*0.2;miColor.z=miColor.z*0.2;",
	    		
	    	"}",
	    	"if(moduloLightBlack < 0.2){", //zona oscura (pero ahora no hay)
		    	"miColor.x=min(1.0, max(0.0,miColor.x-((1.0-moduloLightBlack*2.0))));",
		    	"miColor.y=min(1.0, max(0.0,miColor.y-((1.0-moduloLightBlack*2.0))));",
		    	"miColor.z=min(1.0, max(0.0,miColor.z-((1.0-moduloLightBlack*2.0))));",
	    	"}",
	    	"if( modulo > 0.49){",
		    	"float porcent = (modulo - 0.49) / 0.005;",
			    "miColor.r-=porcent;miColor.g-=porcent;miColor.b-=porcent;",
		    "}",
  		"}else if( modulo > 0.495){",
		    	"float porcent = (modulo - 0.495) / 0.005;", //franja negra alrededor
			    "miColor.r-=porcent;miColor.g-=porcent;miColor.b-=porcent;miColor.a=1.0-porcent;",
		    "}",
		"else{",
  			"miColor=vec4(0,0,0,0);",
  		"}",

  		"gl_FragColor=miColor;",
  	"}"
  ];

  this.vertexSrc = [
  	"attribute vec2 aTextureCoord;",
  	"varying vec2 vTextureCoord;",
  	"void main(void){",
  		"vTextureCoord = aTextureCoord;",
  	"}"
  ];

}


PIXI.NormalMapFilter.prototype = Object.create( PIXI.AbstractFilter.prototype );
PIXI.NormalMapFilter.prototype.constructor = PIXI.NormalMapFilter;

PIXI.NormalMapFilter.prototype.onTextureLoaded = function()
{
	
	this.uniforms.mapDimensions.value.x = this.uniforms.displacementMap.value.width;
	this.uniforms.mapDimensions.value.y = this.uniforms.displacementMap.value.height;

	this.uniforms.displacementMap.value.baseTexture.off("loaded", this.boundLoadedFunction)

}

Object.defineProperty(PIXI.NormalMapFilter.prototype, 'map', {
    get: function() {
        return this.uniforms.displacementMap.value;
    },
    set: function(value) {
    	this.uniforms.displacementMap.value = value;
    }
});