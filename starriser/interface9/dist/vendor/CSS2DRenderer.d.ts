import { Object3D } from "./three.js";

export class CSS2DObject extends Object3D {
  constructor(element: HTMLElement);
  element: HTMLElement;
}

export class CSS2DRenderer {
  domElement: HTMLElement;
  setSize(width: number, height: number): void;
  render(scene: Object3D, camera: Object3D): void;
}
