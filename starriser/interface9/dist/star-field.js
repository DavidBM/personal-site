import * as THREE from "./vendor/three.js";
export class StarField {
    constructor(scene, camera, numStars = 5000) {
        this.scene = scene;
        this.camera = camera;
        this.numStars = numStars;
        // Parameters
        this.minDistance = 500;
        this.maxDistance = 250000;
        this.movementFactor = 0.0; // Tracks camera movement intensity
        this.movementDecay = 0.9; // How quickly movement effect fades
        // Track camera movement
        this.lastCameraPosition = new THREE.Vector3();
        this.cameraVelocity = new THREE.Vector3();
        this.positions = new Float32Array(0);
        this.baseColors = new Float32Array(0);
        this.sizes = new Float32Array(0);
        this.geometry = new THREE.BufferGeometry();
        this.uniforms = {
            pointTexture: { value: new THREE.CanvasTexture(document.createElement("canvas")) },
            movementFactor: { value: 0.0 },
            cameraPosition: { value: new THREE.Vector3() },
        };
        this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms });
        this.stars = new THREE.Points(this.geometry, this.material);
        this.lastMaxTime = null;
        this.localMaxVelocity = 0;
        this.init();
    }
    init() {
        // Create geometry for stars
        this.positions = new Float32Array(this.numStars * 3);
        this.baseColors = new Float32Array(this.numStars * 3);
        this.sizes = new Float32Array(this.numStars);
        // Create stars at random positions
        for (let i = 0; i < this.numStars; i++) {
            // Use cube distribution to avoid center clustering that happens with sphere distribution
            // Generate positions in a cube and reject those outside our desired volume
            let x = 0;
            let y = 0;
            let z = 0;
            let radius = 0;
            // Use rejection sampling to get a more uniform distribution
            do {
                // Generate point in cube
                x = (Math.random() * 2 - 1) * this.maxDistance;
                y = (Math.random() * 2 - 1) * this.maxDistance;
                z = (Math.random() * 2 - 1) * this.maxDistance;
                // Calculate distance from center
                const distSq = x * x + y * y + z * z;
                radius = Math.sqrt(distSq);
            } while (radius < this.minDistance || radius > this.maxDistance);
            // Set positions
            const idx = i * 3;
            this.positions[idx] = x;
            this.positions[idx + 1] = y;
            this.positions[idx + 2] = z;
            // Apply density falloff - stars farther from center are less likely to be bright
            const distanceFactor = 1.0 -
                (radius - this.minDistance) / (this.maxDistance - this.minDistance);
            const densityFactor = Math.pow(distanceFactor, 0.5); // Adjust power for different density distributions
            // Set base colors (mostly white with slight variations)
            const intensity = 0.4 + densityFactor * 0.3 + Math.random() * 0.3;
            const r = intensity * (0.7 + Math.random() * 0.3);
            const g = intensity * (0.7 + Math.random() * 0.3);
            const b = intensity * (0.7 + Math.random() * 0.3);
            this.baseColors[idx] = r;
            this.baseColors[idx + 1] = g;
            this.baseColors[idx + 2] = b;
            // 95% of stars are 1px, 5% are 2px
            this.sizes[i] = Math.random() < 0.05 ? 2.5 : 1.5;
        }
        // Create geometry and set attributes
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute("color", new THREE.BufferAttribute(this.baseColors.slice(), 3));
        this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
        // Create material with custom shader
        this.uniforms = {
            pointTexture: { value: this.createStarTexture() },
            movementFactor: { value: 0.0 },
            cameraPosition: { value: new THREE.Vector3() },
        };
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                uniform float movementFactor;

                void main() {
                    // Base color from attribute
                    vec3 baseColor = color;

                    // Brighten during movement
                    vColor = baseColor * (1.0 + movementFactor * 0.7);

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    // Keep consistent pixel size regardless of distance
                    gl_PointSize = size * (1.0 + movementFactor / 4.0);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;

                void main() {
                    gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
                    if (gl_FragColor.a < 0.1) discard;
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
        });
        // Create the star points
        this.stars = new THREE.Points(this.geometry, this.material);
        this.stars.frustumCulled = false; // Ensure stars are always rendered
        this.stars.renderOrder = -1; // Render behind everything else
        this.scene.add(this.stars);
        // Initialize last camera position
        this.lastCameraPosition.copy(this.camera.position);
    }
    createStarTexture() {
        // Create a simple circular texture for stars
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const context = canvas.getContext("2d");
        if (!context) {
            return new THREE.CanvasTexture(canvas);
        }
        const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.5, "rgba(255,255,255,0.8)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 16, 16);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }
    update(deltaTime) {
        // Initialize tracking properties if they don't exist
        if (this.lastMaxTime === null) {
            this.lastMaxTime = performance.now();
            this.localMaxVelocity = 0;
        }
        // Calculate camera velocity
        this.cameraVelocity.subVectors(this.camera.position, this.lastCameraPosition);
        const velocity = this.cameraVelocity.length();
        const currentTime = performance.now();
        // Reset local max if more than 3 seconds have passed
        if (currentTime - this.lastMaxTime > 3000) {
            this.localMaxVelocity = velocity;
            this.lastMaxTime = currentTime;
        }
        // Update local max if current velocity is higher
        if (velocity > this.localMaxVelocity) {
            this.localMaxVelocity = velocity;
            this.lastMaxTime = currentTime;
        }
        // Only count velocities over 10% of local max
        const velocityThreshold = this.localMaxVelocity * 0.1;
        // Update movement factor based on camera velocity
        if (velocity > velocityThreshold) {
            // Increase movement factor when moving
            this.movementFactor = Math.min(1.0, Math.max(0.1, this.movementFactor) + deltaTime / 60);
            this.movementFactor = 1;
        }
        else if (this.movementFactor > 0) {
            // Decrease movement factor when stationary
            this.movementFactor = Math.max(0, this.movementFactor - deltaTime / 120);
        }
        // Apply movement effect
        this.uniforms.movementFactor.value = this.movementFactor;
        this.uniforms.cameraPosition.value.copy(this.camera.position);
        // Save current camera position for next frame
        this.lastCameraPosition.copy(this.camera.position);
    }
    dispose() {
        this.scene.remove(this.stars);
        this.geometry.dispose();
        this.material.dispose();
        const texture = this.uniforms.pointTexture.value;
        if (texture) {
            texture.dispose();
        }
    }
}
//# sourceMappingURL=star-field.js.map