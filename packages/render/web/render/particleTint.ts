import * as THREE from 'three';

/**
 * The FX look's tint and glow on template particles (SF-FB-014). Particle sprites and quads are made while a clip
 * is built, after the renderer set the look, and their colour is keyframed (a fire ramp cooling from white-hot to
 * red), so multiplying the material colour once does nothing. Instead every particle material reads these shared
 * uniforms in its shader, so changing the tint re-colours every particle without rebuilding a clip.
 *
 * Modes, set per material by the template:
 *   fire      the keyframed colour is a heat ramp (white-hot → yellow → orange → dark red). With a tint, the hot end
 *             stays white and the cool end takes the tint's hue: each channel of the tint is raised to sqrt(1 - heat),
 *             so a red tint passes through orange and yellow to white like real flames, a blue one through pale blue.
 *   multiply  the colour is multiplied by the tint (smoke, dust, flashes, rings).
 * A grey or white tint has no hue to give, so fire keeps its own ramp (the Studio's default tint is white).
 * `--glow` scales the particles' brightness relative to the default (1.4 = as designed).
 */
export type ParticleTintMode = 'fire' | 'multiply';

/** Default FX brightness: particles at this glow render as designed. */
export const DEFAULT_GLOW = 1.4;

const uniforms = {
  /** Tint with its brightest channel at 1 (linear). */
  uSsgTint: { value: new THREE.Color(1, 1, 1) },
  /** 0..1: how much hue the tint has (0 = grey or white: fire keeps its ramp). */
  uSsgTintSat: { value: 0 },
  /** Brightness factor (glow / 1.4). */
  uSsgGain: { value: 1 },
};

/** Set the look the particles render with (null or disabled: as designed). */
export function setParticleTint(look: { enabled: boolean; tint?: string; intensity?: number } | null | undefined) {
  const on = !!look?.enabled;
  const c = new THREE.Color(on && look?.tint ? look.tint : '#ffffff');
  const max = Math.max(c.r, c.g, c.b);
  if (max > 1e-6) c.multiplyScalar(1 / max);
  else c.setRGB(1, 1, 1);
  uniforms.uSsgTint.value.copy(c);
  uniforms.uSsgTintSat.value = 1 - Math.min(c.r, c.g, c.b);
  uniforms.uSsgGain.value = on && look?.intensity !== undefined ? look.intensity / DEFAULT_GLOW : 1;
}

/** Current uniform values (tests). */
export function particleTintState() {
  return { tint: uniforms.uSsgTint.value.clone(), sat: uniforms.uSsgTintSat.value, gain: uniforms.uSsgGain.value };
}

/**
 * The recolour the shader does, on the CPU (tests and docs): `c` is the keyframed linear colour.
 * Kept in step with the GLSL below.
 */
export function tintColour(c: THREE.Color, mode: ParticleTintMode, state = particleTintState()): THREE.Color {
  const { tint, sat, gain } = state;
  if (mode === 'multiply') return c.clone().multiply(tint).multiplyScalar(gain);
  const v = Math.max(c.r, c.g, c.b);
  if (v <= 0) return c.clone();
  const heat = smoothstep(0.25, 0.95, c.g / Math.max(c.r, 1e-4));
  const e = Math.sqrt(1 - heat);
  const fire = new THREE.Color(Math.max(tint.r, 1e-3) ** e, Math.max(tint.g, 1e-3) ** e, Math.max(tint.b, 1e-3) ** e).multiplyScalar(v);
  return c.clone().lerp(fire, sat).multiplyScalar(gain);
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const GLSL = `
uniform vec3 uSsgTint; uniform float uSsgTintSat; uniform float uSsgGain;
vec3 ssgTint(vec3 c) {
#ifdef SSG_TINT_FIRE
  float v = max(max(c.r, c.g), c.b);
  if (v <= 0.0) return c;
  float heat = smoothstep(0.25, 0.95, c.g / max(c.r, 1e-4));
  vec3 fire = v * pow(max(uSsgTint, vec3(1e-3)), vec3(sqrt(1.0 - heat)));
  return mix(c, fire, uSsgTintSat) * uSsgGain;
#else
  return c * uSsgTint * uSsgGain;
#endif
}
`;

/** Make a particle material (SpriteMaterial or MeshBasicMaterial) follow the FX look's tint and glow. */
export function tintParticleMaterial(m: THREE.SpriteMaterial | THREE.MeshBasicMaterial, mode: ParticleTintMode) {
  m.userData.ssgTint = mode;
  if (mode === 'fire') m.defines = { ...(m.defines ?? {}), SSG_TINT_FIRE: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${GLSL}\nvoid main() {`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = ssgTint(diffuseColor.rgb);\n#include <map_fragment>');
  };
  m.customProgramCacheKey = () => `ssg-tint-${mode}`;
  m.needsUpdate = true;
  return m;
}
