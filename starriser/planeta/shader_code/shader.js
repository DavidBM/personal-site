function getMyShader(planetTexture, cloudTexture, difTexture, normalTexture, ligthTexture) {
    let filter =  new PIXI.Filter(document.getElementById('shader-vs').innerHTML, FRAGMENT_SHADER, {
        planetTexture: planetTexture,
        cloudTexture: cloudTexture,
        difTexture: difTexture,
        normalTexture: normalTexture,
        ligthTexture: ligthTexture,
        desplazamiento: 0,
        width: 0,
        lightPositionX: 5,
        lightPositionY: 5,
        lightPositionZ: 10,
        uSpin: 0,
        uObliquity: 23.5,
        uPrecession: 0,
        sunLat: 72,
        sunLon: 10,
        uDragRot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        uScreen: [1, 1],
        planetCenter: [0, 0],
        planetDiameter: 1
    });

    return filter;
};
