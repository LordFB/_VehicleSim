import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { LIGHTING, SKY } from '../core/Constants';

/**
 * Physically-based sky using the Preetham analytic atmospheric-scattering model
 * (Rayleigh + Mie) from three's `Sky` shader, replacing the old painted gradient
 * dome. The sun's scattering is computed for real, so the horizon glows warmly
 * around the sun, the zenith deepens to blue, and the haze band falls out of the
 * physics rather than being hand-keyed.
 *
 * It owns the single source of truth for the sun: {@link sunDirection} is derived
 * here from the configured elevation/azimuth and consumed by the Game to aim the
 * key light and tint the fog, so light, shadow and sky always agree.
 *
 * Like the dome it replaces, it exposes a {@link buildEnvironment} PMREM map so
 * car paint and metals reflect the actual sky.
 */
export class SkyAtmosphere {
  readonly mesh: Sky;
  /** Unit world-space direction FROM the scene TO the sun. */
  readonly sunDirection = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(sunDirection?: THREE.Vector3) {
    this.mesh = new Sky();
    // Sky's box is unit-sized; scale it past the far plane so it always frames
    // the scene. depthWrite is off in the shader, so it never occludes geometry.
    this.mesh.scale.setScalar(SKY.RADIUS * 1.2);
    this.mesh.name = 'sky-atmosphere';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;

    const material = this.mesh.material as THREE.ShaderMaterial;
    const uniforms = material.uniforms;
    // Golden-hour identity: a low sun with modest haze and a warm forward-Mie
    // glow. The Mie terms put that glow around the sun where a low evening sun
    // belongs; Rayleigh keeps a clear blue zenith.
    uniforms.turbidity.value = SKY.TURBIDITY;
    uniforms.rayleigh.value = SKY.RAYLEIGH;
    uniforms.mieCoefficient.value = SKY.MIE_COEFFICIENT;
    uniforms.mieDirectionalG.value = SKY.MIE_DIRECTIONAL_G;

    // The Sky shader emits raw linear HDR; scale it before the renderer's ACES
    // tone-map so the sky balances against the foreground exposure instead of
    // clipping to white. Injected at the final color so it composes with the
    // shader's own output unchanged.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `gl_FragColor = vec4( texColor * ${SKY.EXPOSURE.toFixed(3)}, 1.0 );`,
      );
    };

    // Derive the sun direction from the same vector the key light already uses,
    // so the brightest point of the sky sits exactly where the shadows come from.
    const sun = LIGHTING.SUN_POSITION;
    this.sunDirection.copy(sunDirection ?? new THREE.Vector3(sun.x, sun.y, sun.z)).normalize();
    uniforms.sunPosition.value.copy(this.sunDirection);
  }

  /**
   * Build a PMREM environment map from the rendered sky for image-based lighting
   * and reflections. Renders the Sky into a throwaway scene at PMREM resolution.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // PMREM precompiles the equirect shader so the first fromScene call isn't
    // doing a cold shader compile under the render budget.
    this.pmrem.compileEquirectangularShader();
    const scene = new THREE.Scene();
    // The environment is direction-only, so capture from a unit-scale box at the
    // origin — rendering the 960-unit display box into all six PMREM faces was
    // heavy enough to push first-frame past the boot budget intermittently.
    const previousScale = this.mesh.scale.x;
    this.mesh.scale.setScalar(1);
    scene.add(this.mesh);
    this.envTarget = this.pmrem.fromScene(scene, 0.04);
    scene.remove(this.mesh);
    this.mesh.scale.setScalar(previousScale);
    return this.envTarget.texture;
  }

  /** Approximate horizon colour in the sun's azimuth, for fog tinting. */
  horizonColor(target: THREE.Color): THREE.Color {
    return target.set(SKY.FOG_COLOR);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
  }
}
