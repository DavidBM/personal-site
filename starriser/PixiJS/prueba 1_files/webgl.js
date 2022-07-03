
// create an new instance of a pixi stage with a grey background
var stage = new PIXI.Stage(0xFF0000);
// create a renderer instance width=640 height=480
var renderer = PIXI.autoDetectRenderer(512,512,null,true,true);
// importing a texture atlas created with texturepacker
// create an empty container
var gameContainer = new PIXI.DisplayObjectContainer();
// add the container to the stage
 stage.addChild(gameContainer);
 // add the renderer view element to the DOM
document.body.appendChild(renderer.view);



var varRota=0;
var filter;
var snakeContainer;


function webGLStart() {
  //Create object
  //PIXI.Sprite.fromFrame('textura.png');
  // build a rope!

  var moon = PIXI.Texture.fromImage("textura3.png");
  var cloud = PIXI.Texture.fromImage("cloud.png");
  filter = new PIXI.NormalMapFilter(moon,cloud);
  strip = new PIXI.Sprite(moon);
  strip.filters=[filter];

  //strip.x = -918/2;
  
  snakeContainer = new PIXI.DisplayObjectContainer();
  snakeContainer.position.x = 0;
  snakeContainer.position.y = 0;

  //snakeContainer.scale.set( window.innerWidth / 1100)
  stage.addChild(snakeContainer);

  snakeContainer.addChild(strip);
  requestAnimFrame(animate);
}

function animate() {
    varRota+=0.0005;
    //snakeContainer.position.x+=5;
    filter.uniforms.desplazamiento.value=varRota;
    renderer.render(stage);
    requestAnimFrame(animate);
   //console.log(filter.uniforms.desplazamiento.value);
}





// function webGLStart() {
//   PhiloGL('lesson01-canvas', {
//     program: {
//       from: 'ids',
//       vs: 'shader-vs',
//       fs: 'shader-fs'
//     },
//     textures: {
//       src: ['textura.png'],
//       parameters: [{
//         name: 'TEXTURE_MAG_FILTER',
//         value: 'LINEAR'
//       }, {
//         name: 'TEXTURE_MIN_FILTER',
//         value: 'LINEAR_MIPMAP_NEAREST',
//         generateMipmap: true
//       }]
//     },
//     onError: function() {
//       alert("An error ocurred while loading the application");
//     },
//     onLoad: function(app) {
//       var gl = app.gl,
//           canvas = app.canvas,
//           program = app.program,
//           camera = app.camera;

//       gl.viewport(0, 0, canvas.width, canvas.height);
//       gl.clearColor(0, 0, 0, 1);
//       gl.clearDepth(1);
//       gl.enable(gl.DEPTH_TEST);
//       gl.depthFunc(gl.LEQUAL);

//       program.setBuffers({
//         'triangle': {
//           attribute: 'aVertexPosition',
//           value: new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]),
//           size: 3,
//           textures: 'textura.png'
//         },

//         'square': {
//           attribute: 'aVertexPosition',
//           value: new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0]),
//           size: 3
//         }
//       });

//       gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
//       camera.view.id();
//       //Draw Triangle
//       camera.view.$translate(-1.5, 0, -7);
//       program.setUniform('uMVMatrix', camera.view);
//       program.setUniform('uPMatrix', camera.projection);
//       program.setBuffer('triangle');
//       gl.drawArrays(gl.TRIANGLES, 0, 3);

//       //Draw Square
//       camera.view.$translate(3, 0, 0);
//       program.setUniform('uMVMatrix', camera.view);
//       program.setUniform('uPMatrix', camera.projection);
//       program.setBuffer('square').setBuffer('textureCoord').setTexture('textura.png');
//       gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
//     }
//   });
// }

