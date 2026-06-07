import * as THREE from "../vendor/three.js";
import { CSS2DRenderer } from "../vendor/CSS2DRenderer.js";
import { StarField } from "../star-field.js";
import { GraphPathOverlay, ScreenOverlayRegistry, SelectionOverlay, TextBillboardManager, } from "../gfx-utils/ui-overlays.js";
export function createSceneBootstrap(container) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 10, 10000000000);
    camera.position.set(0, 2000, 2000);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, debug: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000015);
    container.appendChild(renderer.domElement);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);
    const uiOverlayLayer = document.createElement("div");
    uiOverlayLayer.className = "webgl-ui-overlay";
    uiOverlayLayer.style.position = "absolute";
    uiOverlayLayer.style.top = "0";
    uiOverlayLayer.style.left = "0";
    uiOverlayLayer.style.width = "100%";
    uiOverlayLayer.style.height = "100%";
    uiOverlayLayer.style.pointerEvents = "none";
    uiOverlayLayer.style.zIndex = "900";
    container.appendChild(uiOverlayLayer);
    const screenOverlayRegistry = new ScreenOverlayRegistry(uiOverlayLayer);
    const selectionOverlay = new SelectionOverlay(scene, screenOverlayRegistry);
    const pathOverlay = new GraphPathOverlay(scene);
    const textOverlay = new TextBillboardManager(scene);
    const starField = new StarField(scene, camera, 3000);
    const galaxyClusterGroup = new THREE.Group();
    scene.add(galaxyClusterGroup);
    addReferencePlane(scene);
    return {
        scene,
        camera,
        renderer,
        labelRenderer,
        uiOverlayLayer,
        screenOverlayRegistry,
        selectionOverlay,
        pathOverlay,
        textOverlay,
        starField,
        galaxyClusterGroup,
    };
}
export function resizeSceneBootstrap(bootstrap, width, height) {
    bootstrap.camera.aspect = width / height;
    bootstrap.camera.updateProjectionMatrix();
    bootstrap.renderer.setSize(width, height);
    bootstrap.labelRenderer.setSize(width, height);
    bootstrap.uiOverlayLayer.style.width = `${width}px`;
    bootstrap.uiOverlayLayer.style.height = `${height}px`;
}
function addReferencePlane(scene) {
    const planeGeometry = new THREE.PlaneGeometry(100000, 100000, 10, 10);
    const planeMaterial = new THREE.MeshBasicMaterial({
        color: 0x334455,
        transparent: true,
        opacity: 0.08,
        wireframe: true,
        side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = Math.PI / 2;
    scene.add(plane);
}
//# sourceMappingURL=scene-bootstrap.js.map