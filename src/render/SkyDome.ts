import * as THREE from 'three';
import { SKY } from '../core/Constants';

/**
 * Tall vertical-gradient sky (zenith -> warm horizon -> ground wash) rendered on
 * the inside of a large sphere. This is the Forza-Horizon "photoreal sky" read in
 * its cheapest honest form: a smooth atmospheric gradient with a warm horizon band,
 * not a flat background fill. Also exposes a PMREM environment map built from the
 * same gradient so car paint and metals pick up believable reflections.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.SphereGeometry;
  private envTexture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;

  constructor() {
    this.geometry = new THREE.SphereGeometry(SKY.RADIUS, 32, 16);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(SKY.ZENITH) },
        uHorizon: { value: new THREE.Color(SKY.HORIZON) },
        uGround: { value: new THREE.Color(SKY.GROUND_TINT) },
        uHorizonBlend: { value: SKY.HORIZON_BLEND },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(world.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldDir;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform float uHorizonBlend;
        void main() {
          float h = vWorldDir.y; // -1 down .. +1 up
          vec3 col;
          if (h >= 0.0) {
            // horizon -> zenith, with the warm band concentrated near the horizon
            float t = pow(clamp(h / max(uHorizonBlend, 0.001), 0.0, 1.0), 0.75);
            col = mix(uHorizon, uZenith, t);
          } else {
            // horizon -> ground wash
            float t = clamp(-h * 2.2, 0.0, 1.0);
            col = mix(uHorizon, uGround, t);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Build a PMREM environment map from the sky gradient for reflective materials. */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    scene.add(this.mesh);
    this.envTexture = this.pmrem.fromScene(scene, 0.04).texture;
    // mesh is reparented by the caller after this; keep a reference-safe state
    scene.remove(this.mesh);
    return this.envTexture;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
  }
}
