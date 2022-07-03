function TriangleRow (quantity, x, y, lateralLength, stage) {

	this.triangles = [];

	for (var i = 0; i < quantity; i++) {
		this.triangles.push( new Triangle(
			lateralLength,
			Math.PI / 2,
			x + lateralLength / 2 + (lateralLength * i),
			y + Math.sqrt(3) / 6 * lateralLength,
			0x226C7A
		) );

		stage.addChild( this.triangles[this.triangles.length - 1].get() );
	}
}
