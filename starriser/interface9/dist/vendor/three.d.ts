export class Vector2 {
  constructor(x?: number, y?: number);
  x: number;
  y: number;
  set(x: number, y: number): this;
  copy(v: Vector2): this;
  sub(v: Vector2): this;
  subVectors(a: Vector2, b: Vector2): this;
  distanceTo(v: Vector2): number;
  length(): number;
  multiplyScalar(s: number): this;
  equals(v: Vector2): boolean;
}

export class Vector3 {
  constructor(x?: number, y?: number, z?: number);
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
  setScalar(s: number): this;
  copy(v: Vector3): this;
  add(v: Vector3): this;
  sub(v: Vector3): this;
  subVectors(a: Vector3, b: Vector3): this;
  clone(): Vector3;
  multiplyScalar(s: number): this;
  distanceTo(v: Vector3): number;
  length(): number;
  lengthSq(): number;
  lerp(v: Vector3, alpha: number): this;
  equals(v: Vector3): boolean;
  getComponent(index: number): number;
  setComponent(index: number, value: number): this;
  project(camera: Camera): this;
  unproject(camera: Camera): this;
}

export class Euler {
  constructor(x?: number, y?: number, z?: number);
  x: number;
  y: number;
  z: number;
}

export class Color {
  constructor(color?: number | string | [number, number, number] | Color);
  r: number;
  g: number;
  b: number;
  set(color: number | string | [number, number, number] | Color): this;
}

export class Object3D {
  children: Object3D[];
  name: string;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
  userData: Record<string, unknown>;
  visible: boolean;
  frustumCulled: boolean;
  renderOrder: number;
  parent: Object3D | null;
  add(...objects: Object3D[]): this;
  remove(...objects: Object3D[]): this;
}

export class Group extends Object3D {}
export class Scene extends Object3D {}

export class Camera extends Object3D {
  lookAt(x: number | Vector3, y?: number, z?: number): void;
  updateMatrixWorld(): void;
  updateProjectionMatrix(): void;
  aspect: number;
  fov: number;
  near: number;
  far: number;
}

export class PerspectiveCamera extends Camera {
  constructor(fov?: number, aspect?: number, near?: number, far?: number);
}

export class Plane {
  constructor(normal: Vector3, constant: number);
}

export class Ray {
  origin: Vector3;
  direction: Vector3;
  intersectPlane(plane: Plane, target: Vector3): Vector3 | null;
}

export type Intersection = {
  object: Object3D;
};

export class Raycaster {
  ray: Ray;
  setFromCamera(coords: Vector2, camera: Camera): void;
  intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[];
}

export type AttributeArray =
  | Float32Array
  | Uint16Array
  | Uint32Array
  | number[];

export class BufferAttribute {
  constructor(array: AttributeArray, itemSize: number);
  array: AttributeArray;
  itemSize: number;
  needsUpdate: boolean;
}

export class BufferGeometry {
  attributes: Record<string, BufferAttribute>;
  setAttribute(name: string, attribute: BufferAttribute): this;
  setDrawRange(start: number, count: number): void;
  setFromPoints(points: Vector3[]): this;
  dispose(): void;
}

export class Material {
  dispose(): void;
}

export class LineBasicMaterial extends Material {
  constructor(params?: Record<string, unknown>);
  color: Color;
}

export class LineMaterial extends Material {
  constructor(params?: Record<string, unknown>);
  resolution: Vector2;
}

export class LineGeometry extends BufferGeometry {
  setPositions(positions: number[]): void;
}

export class Line extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material);
  geometry: BufferGeometry;
  material: Material;
  computeLineDistances(): void;
}

export class LineLoop extends Line {}
export class LineSegments extends Line {}

export class Line2 extends Line {
  constructor(geometry: LineGeometry, material: LineMaterial);
}

export class MeshBasicMaterial extends Material {
  constructor(params?: Record<string, unknown>);
}

export class SpriteMaterial extends Material {
  constructor(params?: Record<string, unknown>);
  map?: Texture;
}

export class Sprite extends Object3D {
  constructor(material?: SpriteMaterial);
  material: SpriteMaterial;
}

export class CylinderGeometry extends BufferGeometry {
  constructor(
    radiusTop?: number,
    radiusBottom?: number,
    height?: number,
    radialSegments?: number,
  );
}

export class PlaneGeometry extends BufferGeometry {
  constructor(
    width?: number,
    height?: number,
    widthSegments?: number,
    heightSegments?: number,
  );
}

export class Mesh extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material);
  geometry: BufferGeometry;
  material: Material;
}

export class PointsMaterial extends Material {
  constructor(params?: Record<string, unknown>);
}

export class Texture {
  dispose(): void;
}

export class CanvasTexture extends Texture {
  constructor(image: HTMLCanvasElement);
  needsUpdate: boolean;
}

export type Uniform<T> = { value: T };
export type Uniforms = Record<string, Uniform<unknown>>;

export class ShaderMaterial extends Material {
  constructor(params?: Record<string, unknown> & { uniforms?: Uniforms });
  uniforms: Uniforms;
}

export class Points extends Object3D {
  constructor(geometry?: BufferGeometry, material?: Material);
  geometry: BufferGeometry;
  material: Material;
}

export class WebGLRenderer {
  constructor(params?: Record<string, unknown>);
  domElement: HTMLCanvasElement;
  setSize(width: number, height: number): void;
  setClearColor(color: number): void;
  render(scene: Scene, camera: Camera): void;
}

export const MathUtils: {
  degToRad(degrees: number): number;
};

export const AdditiveBlending: number;
export const DoubleSide: number;
