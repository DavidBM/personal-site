function triangleMatrix (lateralLength, rows, colums, stage) {
	this.matrix = [];

	this.rows = rows;
	this.colums = colums;

	for (var i = 0; i < rows; i++) {
		for (var j = 0; j < colums; j++) {
			var triangle = new Triangle(
				lateralLength,
				Math.PI / 2,
				x + lateralLength / 2 + (lateralLength * i),
				y + Math.sqrt(3) / 6 * lateralLength,
				0x226C7A
			);

			stage.addChild( this.triangles[this.triangles.length - 1].get() );

			triangle.scale.x = 0;
			triangle.scale.y = 0;

			triangle.scaleAnimation(0, 1, 400);

			this.matrix = triangle;
		}
	}
}
