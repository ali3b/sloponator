import * as THREE from 'three';
import { syncFadeMaterials } from './fades';
import { DEFAULT_GLOW, setParticleTint } from './particleTint';
import type { SecondaryMotion } from '@slop/sprites';
import { newSpring, stepSpring, type SpringState } from './secondary';
import { DEFAULT_QUALITY, putAwayDuring, releaseModeOf, releasedBy, type ReleaseMode, computeFraming, lightTint, resolveLight, yawForAngle, type SpriteLight, type Framing, type QualityConfig, type ViewConfig } from '@slop/sprites';

export type { Framing };

/** What a render pass produces: the sprite, or a data layer aligned with it (same camera and framing). */
export type RenderLayer = 'color' | 'normal' | 'depth' | 'uv' | 'shadow';

/**
 * One pass of a layered export: which things draw. Everything else is either hidden or, with `occlude`, turned
 * into a depth-only occluder so the pixels it covers are cut out of what does draw.
 */
export interface RenderPass {
  /** Draw the main asset's own meshes (anything under the pivot that is not inside an attachment holder). */
  body: boolean;
  /** Attachment holders drawn in this pass; every other holder is hidden. */
  holders: THREE.Object3D[];
  /** Hidden geometry becomes a depth-only occluder (colour layer only). */
  occlude: boolean;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The single renderer used by the Studio preview, the direction grid and the sheet exporter, so what
 * you preview is exactly what gets exported. One asset + one clip at a time; directions are produced
 * by yawing the asset (lights stay fixed in the world, like they would in a game).
 */
/** A holder as putAwayDuring sees it (FB-074): its group, whether a clip brought it, and whether it is held in a hand. */
export function heldInfo(h: THREE.Object3D) {
  const item = h.userData.item as { perClip?: boolean; target?: string } | undefined;
  const target = String(h.userData.target ?? item?.target ?? '');
  return { cls: h.userData.cls as string | undefined, perClip: !!item?.perClip, handHeld: !!h.userData.cls || /hand/i.test(target) };
}

export class SpriteRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  readonly perspCamera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  /** Yawed per direction; the loaded asset sits inside it. */
  readonly pivot = new THREE.Group();
  /** Scaled x = -1 to render a mirrored direction exactly as an engine's horizontal flip would show it. */
  private readonly mirror = new THREE.Group();
  private asset: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private shadowPlane: THREE.Mesh;
  /** Supersampling target and the box-filter pass that averages it down into the canvas. */
  private ssTarget: THREE.WebGLRenderTarget | null = null;
  private downsample = new THREE.ShaderMaterial({
    uniforms: {
      src: { value: null }, factor: { value: 1 }, texel: { value: new THREE.Vector2() },
      pixelMode: { value: 0 }, levels: { value: 0 }, outline: { value: 0 }, outlineColor: { value: new THREE.Color() },
      palette: { value: null }, paletteSize: { value: 0 }, encode: { value: 1 },
      premul: { value: 0 }, tonemap: { value: 0 }, softAlpha: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // Box filter over factor×factor source texels in linear light with premultiplied alpha (no dark
    // fringes). Pixel mode then hardens it into pixel art: solid silhouette, solid ground shadow,
    // optional posterised colours and a 1 px outline from the neighbouring blocks' coverage.
    fragmentShader: `
      uniform sampler2D src; uniform int factor; uniform vec2 texel; varying vec2 vUv;
      uniform int pixelMode; uniform float levels; uniform int outline; uniform vec3 outlineColor;
      uniform sampler2D palette; uniform int paletteSize; uniform int encode;
      uniform int premul; uniform int tonemap; uniform int softAlpha;
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      // ACES filmic (Narkowicz fit): bright FX roll off instead of clipping to flat colour.
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      // On the brightest channel, scaling all three alike (SF-FB-014): per channel, a bright orange's red clipped
      // while its green kept climbing, so #ff7a20 came out yellow. Only where light piles up far past white (the
      // dense heart of a fire) does it bleed to white-hot.
      vec3 tonemapHue(vec3 x) {
        float m = max(max(x.r, x.g), x.b);
        if (m <= 0.0) return x;
        float t = aces(vec3(m)).r;
        return mix(x * (t / m), vec3(t), 0.85 * smoothstep(3.0, 10.0, m));
      }
      // Nearest palette colour (sRGB, weighted towards green like the eye).
      vec3 snap(vec3 srgb) {
        vec3 best = srgb; float bestD = 1e9;
        for (int i = 0; i < 512; i++) {
          if (i >= paletteSize) break;
          vec3 p = texture2D(palette, vec2((float(i) + 0.5) / float(paletteSize), 0.5)).rgb;
          vec3 d = (p - srgb) * vec3(0.3, 0.59, 0.11);
          float dd = dot(d, d);
          if (dd < bestD) { bestD = dd; best = p; }
        }
        return best;
      }
      vec4 block(vec2 centre) {
        vec2 base = centre - texel * (float(factor) * 0.5 - 0.5);
        vec4 sum = vec4(0.0);
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
          if (x >= factor || y >= factor) continue;
          vec4 c = texture2D(src, base + texel * vec2(float(x), float(y)));
          // Additive FX are rendered premultiplied (rgb already weighted by alpha).
          sum += premul == 1 ? c : vec4(c.rgb * c.a, c.a);
        }
        return sum / float(factor * factor);
      }
      void main() {
        vec4 sum = block(vUv);
        vec3 lin = sum.a > 0.0 ? sum.rgb / sum.a : vec3(0.0);
        // Coverage, never over 1: the colour is written back multiplied by it and would clip.
        float a = min(sum.a, 1.0);
        if (tonemap == 1) lin = tonemapHue(lin);
        if (encode == 0) {
          // Data layers (normal/depth/uv): averaged as data, never colour-encoded or palette-snapped.
          if (pixelMode == 1) a = a >= 0.5 ? 1.0 : 0.0;
          gl_FragColor = vec4(lin * a, a);
          return;
        }
        if (pixelMode == 1 && softAlpha == 1) {
          // Soft FX in pixel art: keep the glow, in four alpha steps, no outline or shadow snapping.
          a = floor(a * 4.0 + 0.5) / 4.0;
          vec3 srgb = toSRGB(lin);
          if (levels > 1.0) srgb = floor(srgb * (levels - 1.0) + 0.5) / (levels - 1.0);
          gl_FragColor = vec4(srgb * a, a);
          return;
        }
        if (pixelMode == 1) {
          float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
          if (a >= 0.5) a = 1.0;
          else if (a > 0.1 && luma < 0.02) { a = 0.35; lin = vec3(0.0); }  // ground shadow: one solid tone
          else a = 0.0;
          if (a < 0.5 && outline == 1) {
            vec2 step1 = texel * float(factor);
            float n = max(max(block(vUv + vec2(step1.x, 0.0)).a, block(vUv - vec2(step1.x, 0.0)).a),
                          max(block(vUv + vec2(0.0, step1.y)).a, block(vUv - vec2(0.0, step1.y)).a));
            if (n >= 0.5) { gl_FragColor = vec4(outlineColor, 1.0); return; }
          }
          vec3 srgb = toSRGB(lin);
          if (paletteSize > 0 && a > 0.9) srgb = snap(srgb);
          else if (levels > 1.0) srgb = floor(srgb * (levels - 1.0) + 0.5) / (levels - 1.0);
          gl_FragColor = vec4(srgb * a, a);
          return;
        }
        // Clean style, cel shading (toon): opaque pixels snap to the model's palette bands.
        vec3 srgb = toSRGB(lin);
        if (paletteSize > 0 && a > 0.9) srgb = snap(srgb);
        gl_FragColor = vec4(srgb * a, a);
      }`,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.NoBlending,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downsample);
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quality: QualityConfig = DEFAULT_QUALITY;
  /** Camera of the last render() call (for projecting sockets into the frame). */
  lastCamera: THREE.Camera | null = null;
  private normalMat = new THREE.MeshNormalMaterial();
  private depthMat = new THREE.MeshDepthMaterial();
  /** UV layer: the palette texture coordinate per pixel (R = u, G = v), so engines can recolour by swapping palettes. */
  private uvMat = new THREE.ShaderMaterial({
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec2 vUv2;
      void main() {
        vUv2 = uv;
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }`,
    fragmentShader: 'varying vec2 vUv2; void main() { gl_FragColor = vec4(fract(vUv2), 0.0, 1.0); }',
  });
  /** Shadow layer: the asset stays invisible but keeps casting its shadow on the ground. */
  private invisibleMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  /** Composite attachments (weapon in hand, driver in seat, FX at a muzzle), each with its own clip. */
  private attachments: { holder: THREE.Object3D; mixer: THREE.AnimationMixer | null; duration: number }[] = [];
  /** Secondary-motion springs per holder (reset when the clip changes). */
  private springs = new WeakMap<THREE.Object3D, SpringState>();
  /** Layered exports: depth-only stand-in for geometry that must occlude but not draw. */
  private occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  private pass: RenderPass | null = null;
  /** Holders not shown at all right now (weapons of another class during this clip). */
  private hiddenHolders = new Set<THREE.Object3D>();
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  /** The key light's x for an unmirrored render (render() reflects it for mirrored directions). */
  private keyX = -4;
  /** The light's tint over day (linear, per channel) for the model palette, and its cache key part. */
  private lightTintRgb: [number, number, number] = [1, 1, 1];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setScissorTest(true);

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x7a7068, 1.9);
    this.scene.add(this.hemiLight);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.keyLight.position.set(-4, 8, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0005;
    const sc = this.keyLight.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    this.scene.add(this.keyLight, this.keyLight.target);

    // Ground that only shows the shadow, so sprites get a contact shadow but no floor.
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.receiveShadow = true;
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.mirror.add(this.pivot);
    this.scene.add(this.shadowPlane, this.mirror);
  }

  /**
   * The scene lights (FB-060): a preset (dusk, night…) with overrides, or null for day. Day is exactly the light
   * sprites always had: hemisphere #ffffff / #7a7068 at 1.9, white key light 1.6 at (-4, 8, 6), shadow 0.28.
   */
  setLight(light: SpriteLight | null | undefined) {
    const r = resolveLight(light);
    this.hemiLight.color.set(r.ambient);
    this.hemiLight.groundColor.set(r.ground);
    this.hemiLight.intensity = r.ambientIntensity;
    this.keyLight.color.set(r.key);
    this.keyLight.intensity = r.keyIntensity;
    this.keyX = r.position[0];
    this.keyLight.position.set(r.position[0], r.position[1], r.position[2]);
    (this.shadowPlane.material as THREE.ShadowMaterial).opacity = r.shadowOpacity;
    this.lightTintRgb = lightTint(light);
  }

  /** Apply quality settings (texture filtering and shadows apply to the loaded asset and attachments). */
  setQuality(q: QualityConfig = DEFAULT_QUALITY) {
    this.quality = q;
    const size = q.shadow === 'high' ? 4096 : 1024;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null as never;
    }
    this.keyLight.shadow.radius = q.shadow === 'high' ? 3 : 1;
    this.keyLight.castShadow = q.shadow !== 'off';
    this.shadowPlane.visible = q.shadow !== 'off' && this.shadowWanted;
    const filter = q.textureFilter === 'linear';
    this.pivot.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        const tex = mat.map;
        if (!tex) continue;
        const min = filter ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
        const mag = filter ? THREE.LinearFilter : THREE.NearestFilter;
        if (tex.minFilter !== min || tex.magFilter !== mag) {
          tex.minFilter = min;
          tex.magFilter = mag;
          tex.generateMipmaps = filter;
          tex.needsUpdate = true;
        }
      }
    });
  }

  private shadowWanted = true;
  private paletteCache: { key: string; tex: THREE.DataTexture } | null = null;

  /**
   * The model's own colours: sample its palette texture at every vertex UV (Synty meshes are flat-shaded
   * with each face on one swatch), then add shade steps so lit and shadowed sides snap to bands of the
   * same swatch. Covers attachments too. Cached until the meshes change.
   */
  private modelPalette(steps: number): THREE.DataTexture | null {
    const meshes: THREE.Mesh[] = [];
    this.pivot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) meshes.push(m);
    });
    const tint = this.lightTintRgb;
    const key = `${steps}|${tint.join(',')}|${meshes.map((m) => m.uuid).join(',')}`;
    if (this.paletteCache?.key === key) return this.paletteCache.tex;
    const swatches = new Map<number, [number, number, number]>();
    const canvases = new Map<THREE.Texture, ImageData>();
    for (const m of meshes) {
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const uv = m.geometry.attributes.uv;
      const map = mat?.map;
      if (!map?.image || !uv) {
        if (mat?.color) swatches.set(mat.color.getHex(), [mat.color.r, mat.color.g, mat.color.b]);
        continue;
      }
      if (!canvases.has(map)) {
        const img = map.image as CanvasImageSource & { width: number; height: number };
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        canvases.set(map, ctx.getImageData(0, 0, c.width, c.height));
      }
      const data = canvases.get(map)!;
      for (let i = 0; i < uv.count; i++) {
        let u = uv.getX(i) % 1, v = uv.getY(i) % 1;
        if (u < 0) u += 1;
        if (v < 0) v += 1;
        // glTF textures are not flipped: v maps straight to image rows.
        const x = Math.min(data.width - 1, Math.floor(u * data.width));
        const y = Math.min(data.height - 1, Math.floor((map.flipY ? 1 - v : v) * data.height));
        const o = (y * data.width + x) * 4;
        const r = data.data[o], g = data.data[o + 1], b = data.data[o + 2];
        swatches.set(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), [r / 255, g / 255, b / 255]);
      }
    }
    if (!swatches.size) return null;
    // Shade steps in linear light (what the lighting does), stored as sRGB for the shader.
    const factors = Array.from({ length: Math.max(1, steps) }, (_, i) => (steps <= 1 ? 1 : 0.45 + (0.75 * i) / (steps - 1)));
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
    const colours: number[] = [];
    for (const [r, g, b] of [...swatches.values()].slice(0, Math.floor(512 / factors.length))) {
      // Under a light other than day the swatches take its tint (tint is [1, 1, 1] by day).
      for (const f of factors) colours.push(...[r, g, b].map((c, ch) => Math.min(1, enc(lin(c) * f * tint[ch]))), 1);
    }
    const n = colours.length / 4;
    const tex = new THREE.DataTexture(new Float32Array(colours), n, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.paletteCache?.tex.dispose();
    this.paletteCache = { key, tex };
    return tex;
  }

  /** Originals of materials changed by the FX look (restored when it is turned off or the asset changes). */
  private fxSaved = new Map<THREE.Material, Record<string, unknown>>();
  private fxSavedMeshes = new Map<THREE.Mesh, boolean>();
  /** FX look state: additive blending and tone mapping in the downsample pass. */
  private fxOn = false;
  private fxAdd = false;
  /** Tint uniform shared by every FX material (changing the tint does not recompile shaders). */
  private fxTint = { value: new THREE.Color(1, 1, 1) };

  /**
   * Glowing FX rendering for fireballs, magic, muzzle flashes and particles: materials become self-lit
   * (texture alpha kept, white sprites/unlit FX meshes tinted, a hot core fading to the rim for volume), drawn
   * additively so overlaps brighten like they will in the engine, and tone-mapped so highlights roll off.
   * Materials are changed in place so animation bindings (opacity fades, colour ramps) keep working.
   */
  setFx(look: { enabled: boolean; tint?: string; intensity?: number; blend?: 'add' | 'normal' } | null | undefined) {
    for (const [m, o] of this.fxSaved) {
      const mm = m as THREE.MeshStandardMaterial;
      if (o.color && mm.color) mm.color.copy(o.color as THREE.Color);
      if (o.emissive && mm.emissive) mm.emissive.copy(o.emissive as THREE.Color);
      if ('emissiveMap' in mm) mm.emissiveMap = (o.emissiveMap as THREE.Texture | null) ?? null;
      if (o.emissiveIntensity !== undefined) mm.emissiveIntensity = o.emissiveIntensity as number;
      Object.assign(m, {
        blending: o.blending, blendSrc: o.blendSrc, blendDst: o.blendDst, blendSrcAlpha: o.blendSrcAlpha, blendDstAlpha: o.blendDstAlpha,
        blendEquation: o.blendEquation, depthWrite: o.depthWrite, transparent: o.transparent, alphaTest: o.alphaTest,
        onBeforeCompile: o.onBeforeCompile, customProgramCacheKey: o.customProgramCacheKey,
      });
      m.needsUpdate = true;
    }
    for (const [mesh, cast] of this.fxSavedMeshes) mesh.castShadow = cast;
    this.fxSaved.clear();
    this.fxSavedMeshes.clear();
    this.fxOn = !!look?.enabled && !!this.asset;
    this.fxAdd = this.fxOn && (look?.blend ?? 'add') === 'add';
    // Template particles (built later, colour keyframed) take the tint and glow in their own shaders (SF-FB-014).
    setParticleTint(this.fxOn ? look : null);
    if (!this.fxOn) return;
    this.fxTint.value.set(look!.tint ?? '#ffffff').multiplyScalar(look!.intensity ?? DEFAULT_GLOW);
    this.fxApplyAll();
  }

  /**
   * The FX look on every material of the asset not done yet: setFx, and every setClip after it, since a clip's
   * particle stage (shard copies of the model) is made when the clip is built, after the look was set.
   */
  private fxApplyAll() {
    if (!this.fxOn || !this.asset) return;
    const tint = this.fxTint;
    this.asset.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.Sprite).isSprite) return;
      if (mesh.isMesh && !this.fxSavedMeshes.has(mesh)) {
        this.fxSavedMeshes.set(mesh, mesh.castShadow);
        mesh.castShadow = false;
      }
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.applyFxMaterial(m, tint);
    });
  }

  private applyFxMaterial(m: THREE.Material, tint: { value: THREE.Color }) {
    // Template particles keep their own blending and follow the tint through particleTint.
    if (this.fxSaved.has(m) || m.userData?.ssgTint) return;
    const mm = m as THREE.MeshStandardMaterial;
    this.fxSaved.set(m, {
      color: mm.color?.clone(), emissive: mm.emissive?.clone(), emissiveMap: mm.emissiveMap ?? null, emissiveIntensity: mm.emissiveIntensity,
      blending: m.blending, blendSrc: m.blendSrc, blendDst: m.blendDst, blendSrcAlpha: m.blendSrcAlpha, blendDstAlpha: m.blendDstAlpha,
      blendEquation: m.blendEquation, depthWrite: m.depthWrite, transparent: m.transparent, alphaTest: m.alphaTest,
      onBeforeCompile: m.onBeforeCompile, customProgramCacheKey: m.customProgramCacheKey,
    });
    m.transparent = true;
    m.depthWrite = false;
    m.alphaTest = 0;
    if (this.fxAdd) {
      // rgb accumulates (premultiplied add); alpha is the union coverage, so the PNG's alpha means "how much".
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.SrcAlphaFactor;
      m.blendDst = THREE.OneFactor;
      m.blendSrcAlpha = THREE.OneFactor;
      m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    if (mm.emissive) {
      // White particle sprites glow with their own texture; palette meshes (dark Synty atlases) and unlit FX
      // meshes glow with the tint alone. Diffuse is off: no lighting on fire.
      const sprite = mm.userData?.ssg_fx === 'sprite';
      mm.emissiveMap = sprite ? mm.map : null;
      mm.emissive.setRGB(1, 1, 1);
      mm.emissiveIntensity = 1;
      mm.color.setRGB(0, 0, 0);
      mm.onBeforeCompile = (shader) => {
        shader.uniforms.uFxTint = tint;
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform vec3 uFxTint;\nvoid main() {')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            vec3 fxView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
            float fxFacing = abs(dot(normalize(normal), fxView));
            totalEmissiveRadiance *= uFxTint * mix(0.45, 1.25, pow(fxFacing, 0.7));`,
          );
      };
      mm.customProgramCacheKey = () => 'ssg-fx';
    } else if ((m as THREE.SpriteMaterial).isSpriteMaterial || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
      (m as THREE.MeshBasicMaterial).color.multiply(tint.value);
    }
    m.needsUpdate = true;
  }

  get fxEnabled() {
    return this.fxOn;
  }

  /** Restrict the next renders to one layer of a layered export (null = everything, the normal case). */
  setPass(p: RenderPass | null) {
    this.pass = p;
  }

  /** Attachments that must not appear at all (not even as occluders) until changed again. */
  setHidden(holders: THREE.Object3D[]) {
    this.hiddenHolders = new Set(holders);
  }

  /** Apply the current pass around one scene render; returns the undo. The palette and measuring never see it. */
  private applyPass(layer: RenderLayer): () => void {
    const pass = this.pass;
    const undo: (() => void)[] = [];
    for (const h of this.hiddenHolders) {
      const was = h.visible;
      h.visible = false;
      undo.push(() => (h.visible = was));
    }
    if (!pass || !this.asset) return () => undo.forEach((u) => u());
    const inHolder = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'attachment') return true;
      return false;
    };
    const hide = (root: THREE.Object3D, occlude: boolean) => {
      // Data layers use a scene override material, which would replace the occluder: hide outright there.
      if (occlude && layer === 'color') {
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const mat = m.material, order = m.renderOrder;
            m.material = this.occluderMat;
            m.renderOrder = -1000; // depth written before anything that draws
            undo.push(() => ((m.material = mat), (m.renderOrder = order)));
          } else if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) {
            const was = o.visible;
            o.visible = false;
            undo.push(() => (o.visible = was));
          }
        });
      } else {
        const was = root.visible;
        root.visible = false;
        undo.push(() => (root.visible = was));
      }
    };
    // Other attachments are hidden, never occluders: a layered export's items are worn in any combination (hair
    // without the helmet, the hat instead of it), so only the body may cut pixels out of a part. The engine
    // orders the parts among themselves with the manifest's per-frame z.
    for (const a of this.attachments) if (!pass.holders.includes(a.holder) && !this.hiddenHolders.has(a.holder)) hide(a.holder, false);
    if (!pass.body) {
      this.asset.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m.isMesh || (o as THREE.Sprite).isSprite) && !inHolder(o)) hide(o, pass.occlude);
      });
    }
    return () => {
      for (const u of undo.reverse()) u();
    };
  }

  /** Camera-space depth of a world point in the last rendered frame (larger = nearer the camera). */
  viewDepth(world: THREE.Vector3): number | null {
    if (!this.lastCamera) return null;
    return world.clone().applyMatrix4(this.lastCamera.matrixWorldInverse).z;
  }

  setShadow(enabled: boolean) {
    this.shadowWanted = enabled;
    this.shadowPlane.visible = enabled && this.quality.shadow !== 'off';
  }

  /** Object states: several models under one asset root, one shown per clip (setStateModels / setClipModel). */
  private stateModels: THREE.Object3D[] = [];
  private clipModels = new WeakMap<THREE.AnimationClip, THREE.Object3D[]>();

  /**
   * Object states: these children of the asset are alternative models (intact, damaged, destroyed…). Only one is
   * visible at a time: the one registered for the current clip, else the first. Measuring, the footprint and
   * rendering only see visible meshes, so each state's frames show its own model at the shared framing.
   */
  setStateModels(models: THREE.Object3D[]) {
    this.stateModels = models;
    models.forEach((m, i) => (m.visible = i === 0));
  }

  /**
   * Object states: show `model` while `clip` plays, and `also` with it (a transition shows its destination state's
   * model too, which it fades in: see endOnState).
   */
  setClipModel(clip: THREE.AnimationClip, model: THREE.Object3D, ...also: THREE.Object3D[]) {
    this.clipModels.set(clip, [model, ...also]);
  }

  /**
   * Materials faded by a clip (opacityTracks) are transparent without depth writes only while they are see-through;
   * at full opacity they get their own settings (and shadows) back, so a still or the end of a crossfade renders
   * exactly like the model without any fade. Meshes nearly invisible cast no shadow.
   *
   * In a states export a fading model shows its front surface only (FB-043): its meshes draw first among the
   * transparent ones (before the dust, which stays in front), and before the first of them draws, every fading
   * mesh's depth is laid down (fadePrepass), so each pixel blends the model's nearest surface over what is behind
   * it (the opaque destination state) instead of its far walls and floor seen through the near ones.
   */
  private syncFades() {
    this.fading = syncFadeMaterials(this.asset, this.stateModels.length > 0, this.fadePrepass);
  }

  /** Meshes of a state model fading right now (syncFades), and the render call whose depth prepass is done. */
  private fading: THREE.Mesh[] = [];
  private prepassDone = '';
  private prepassMats = new WeakMap<THREE.Material, THREE.MeshBasicMaterial>();

  /** A depth-only stand-in for a fading material (same sides, same alpha cut-outs). */
  private prepassMat(mat: THREE.Material) {
    let d = this.prepassMats.get(mat);
    const m = mat as THREE.MeshStandardMaterial;
    if (!d) {
      d = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
      this.prepassMats.set(mat, d);
    }
    if (d.side !== m.side || d.alphaTest !== m.alphaTest || d.map !== (m.alphaTest > 0 ? m.map ?? null : null)) {
      d.side = m.side;
      d.alphaTest = m.alphaTest;
      d.map = m.alphaTest > 0 ? m.map ?? null : null;
      d.needsUpdate = true;
    }
    return d;
  }

  /**
   * material.onBeforeRender of a fading state model (syncFades): the first time one draws in a render call, lay
   * down the depth of every fading mesh, so each draws its nearest surface only. Called by three after the object's
   * matrices are set; the others' are computed here.
   */
  private fadePrepass = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    const token = `${renderer.info.render.frame}:${camera.uuid}`;
    if (this.prepassDone === token) return;
    this.prepassDone = token;
    for (const m of this.fading) {
      let shown = true;
      for (let o: THREE.Object3D | null = m; o; o = o.parent) if (!o.visible) shown = false;
      if (!shown || !m.layers.test(camera.layers)) continue;
      m.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, m.matrixWorld);
      m.normalMatrix.getNormalMatrix(m.modelViewMatrix);
      const geo = m.geometry;
      if (Array.isArray(m.material)) {
        for (const g of geo.groups) {
          const mat = m.material[g.materialIndex ?? 0];
          if (mat?.visible && mat.opacity > 0.001) renderer.renderBufferDirect(camera, scene, geo, this.prepassMat(mat), m, g);
        }
      } else if (m.material.visible && m.material.opacity > 0.001) renderer.renderBufferDirect(camera, scene, geo, this.prepassMat(m.material), m, null);
    }
  };

  setAsset(root: THREE.Object3D) {
    this.stateModels = [];
    this.setFx(null);
    this.clearAttachments();
    if (this.asset) this.pivot.remove(this.asset);
    this.asset = root;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // skinned bounds are unreliable mid-animation
      }
    });
    this.restLocal.clear();
    root.traverse((o) => this.restLocal.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
    this.pivot.add(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.action = null;
  }

  /**
   * SF-FB-024: draw the model (and everything it holds) this many times its real size. The factor sits on the turn
   * pivot, so the model's own space (templates, grips and placement offsets, all relative to the pivot) is unchanged
   * while everything measured in the world (framing, sockets, footprint, ground speed) grows with it.
   */
  setModelScale(factor: number | null | undefined) {
    const f = factor && Number.isFinite(factor) && factor > 0 ? factor : 1;
    if (this.pivot.scale.x === f && this.pivot.scale.y === f && this.pivot.scale.z === f) return;
    this.pivot.scale.setScalar(f);
    this.pivot.updateMatrixWorld(true);
  }

  /** The model's own size factor (setModelScale; 1 = real size). */
  get modelScale() {
    return this.pivot.scale.x;
  }

  /** Bone-local units per metre for a node (bones in Synty rigs are often in centimetres). */
  unitsPerMetre(node: THREE.Object3D) {
    node.updateWorldMatrix(true, false);
    this.pivot.updateWorldMatrix(true, false);
    const rel = new THREE.Matrix4().copy(this.pivot.matrixWorld).invert().multiply(node.matrixWorld);
    return 1 / new THREE.Vector3().setFromMatrixScale(rel).x;
  }

  /**
   * A placement fix (userData.fix: rotation about the item's own axes, offset in the bone's units, scale) on top of
   * the holder's grip for the current clip; userData.basePos/baseScale/baseMatrix keep the unfixed placement.
   */
  static applyFix(h: THREE.Object3D) {
    const fix = h.userData.fix as { q: THREE.Quaternion; p: THREE.Vector3; s: number } | undefined;
    if (!h.matrixAutoUpdate) {
      const base = h.userData.baseMatrix as THREE.Matrix4 | undefined;
      if (base) h.matrix.copy(base);
      // Offset in the bone's frame (before the modelled placement), turn and scale about the item's own axes (after).
      if (fix) h.matrix.premultiply(new THREE.Matrix4().makeTranslation(fix.p.x, fix.p.y, fix.p.z)).multiply(new THREE.Matrix4().compose(new THREE.Vector3(), fix.q, new THREE.Vector3(fix.s, fix.s, fix.s)));
      h.matrixWorldNeedsUpdate = true;
      return;
    }
    const basePos = h.userData.basePos as THREE.Vector3 | undefined, baseScale = h.userData.baseScale as THREE.Vector3 | undefined;
    if (basePos) h.position.copy(basePos);
    if (baseScale) h.scale.copy(baseScale);
    if (!fix) return;
    h.quaternion.multiply(fix.q);
    h.position.add(fix.p);
    h.scale.multiplyScalar(fix.s);
  }

  /** Holder rotations that differ for one clip (a weapon held its own way in a procedural pose). */
  private clipGrips = new WeakMap<THREE.AnimationClip, Map<THREE.Object3D, THREE.Quaternion>>();

  /** Hold a weapon (its holder) differently while `clip` plays; other clips keep the holder's default grip. */
  /** The holder rotation a clip holds an item with (setClipGrip), if it has its own. */
  clipGrip(clip: THREE.AnimationClip, holder: THREE.Object3D) {
    return this.clipGrips.get(clip)?.get(holder);
  }

  /** Forget a clip's bindings after its tracks were changed in place (the next setClip binds them again). */
  uncacheClip(clip: THREE.AnimationClip) {
    if (this.action?.getClip() === clip) this.action = null;
    this.mixer?.uncacheClip(clip);
  }

  setClipGrip(clip: THREE.AnimationClip, holder: THREE.Object3D, q: THREE.Quaternion) {
    const m = this.clipGrips.get(clip) ?? new Map<THREE.Object3D, THREE.Quaternion>();
    m.set(holder, q.clone());
    this.clipGrips.set(clip, m);
  }

  setClip(clip: THREE.AnimationClip | null) {
    this.springs = new WeakMap();
    this.restoreReleased();
    if (this.stateModels.length) {
      const show = (clip && this.clipModels.get(clip)) || [this.stateModels[0]];
      for (const m of this.stateModels) m.visible = show.includes(m);
    }
    // Each clip's weapon grips: its own where it has one, else the holder's default.
    const grips = clip ? this.clipGrips.get(clip) : undefined;
    for (const a of this.attachments) {
      const def = a.holder.userData.gripDefault as THREE.Quaternion | undefined;
      const q = grips?.get(a.holder) ?? def ?? (a.holder.userData.baseQ as THREE.Quaternion | undefined);
      if (q) a.holder.quaternion.copy(q);
      SpriteRenderer.applyFix(a.holder);
    }
    // The clip's particle stage may hold copies of the model made after the FX look was set.
    this.fxApplyAll();
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.action = clip ? this.mixer.clipAction(clip) : null;
    this.action?.play();
    this.syncFades();
  }

  get duration() {
    return this.action?.getClip().duration ?? 0;
  }

  /**
   * Attach `object` under `target` (a bone or part of the main asset, or the asset root). The holder cancels
   * the target's world scale so offsets are in metres whatever units the rig uses.
   */
  addAttachment(
    target: THREE.Object3D,
    object: THREE.Object3D,
    offset: { pos: THREE.Vector3; rot: THREE.Euler; scale: number },
    clip: THREE.AnimationClip | null,
    /** Inverse of the target's rest transform in asset space: keeps the object where it was modelled. */
    modelledFrom?: THREE.Matrix4,
  ) {
    const holder = new THREE.Group();
    holder.name = 'attachment';
    if (modelledFrom) {
      // Synty character attachments are modelled in character space: hold them at that placement relative
      // to the bone's rest pose, so they sit right and then follow the bone.
      const local = new THREE.Matrix4().compose(offset.pos, new THREE.Quaternion().setFromEuler(offset.rot), new THREE.Vector3(offset.scale, offset.scale, offset.scale));
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(modelledFrom).multiply(local);
    } else {
      target.updateWorldMatrix(true, false);
      this.pivot.updateWorldMatrix(true, false);
      const rel = new THREE.Matrix4().copy(this.pivot.matrixWorld).invert().multiply(target.matrixWorld);
      const s = new THREE.Vector3().setFromMatrixScale(rel);
      holder.scale.set(1 / s.x, 1 / s.y, 1 / s.z).multiplyScalar(offset.scale);
      holder.position.copy(offset.pos).divide(s);
      holder.rotation.copy(offset.rot);
    }
    holder.add(object);
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    target.add(holder);
    let mixer: THREE.AnimationMixer | null = null;
    if (clip) {
      mixer = new THREE.AnimationMixer(object);
      mixer.clipAction(clip).play();
    }
    this.attachments.push({ holder, mixer, duration: clip?.duration ?? 0 });
    return holder;
  }

  /**
   * Skinned attachments (e.g. SK_Chr_Attach armour) are made for the same skeleton: rebind their meshes to the
   * main character's bones (matched by name) so they deform with every animation.
   */
  addSkinnedAttachment(object: THREE.Object3D) {
    const bones = new Map<string, THREE.Bone>();
    this.asset?.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    const holder = new THREE.Group();
    holder.name = 'attachment';
    holder.add(object);
    this.asset?.add(holder);
    object.updateMatrixWorld(true);
    object.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
        return;
      }
      const mapped = m.skeleton.bones.map((b) => bones.get(b.name) ?? b);
      m.bind(new THREE.Skeleton(mapped, m.skeleton.boneInverses), m.bindMatrix);
      m.castShadow = true;
      m.frustumCulled = false;
    });
    this.attachments.push({ holder, mixer: null, duration: 0 });
    return holder;
  }

  /** Node transforms as loaded (the rest pose), captured before any clip moves them. */
  private restLocal = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();

  /** Put the asset back in its rest pose (as loaded); the next setTime re-poses it. */
  restPose() {
    for (const [o, r] of this.restLocal) {
      o.position.copy(r.p);
      o.quaternion.copy(r.q);
      o.scale.copy(r.s);
    }
    this.asset?.updateMatrixWorld(true);
  }

  clearAttachments() {
    for (const a of this.attachments) {
      a.mixer?.stopAllAction();
      a.holder.removeFromParent();
    }
    this.attachments = [];
    this.release = null;
    this.releasePose = null;
    this.releaseSaved.clear();
    this.releaseHidden.clear();
  }

  setTime(t: number) {
    this.restoreReleased();
    for (const a of this.attachments) {
      if (!a.mixer) continue;
      // Triggered items (a muzzle flash on "shoot") play from their event time; one-shots hide outside it.
      const off = a.holder.userData.clipOffset as number | undefined;
      if (off === undefined) {
        a.mixer.setTime(t);
        continue;
      }
      const lt = t - off;
      const shown = lt >= 0 && (!a.holder.userData.oneShot || lt <= a.duration + 1e-6);
      a.holder.visible = shown;
      a.mixer.setTime(Math.max(0, Math.min(lt, Math.max(0, a.duration - 1e-4))));
    }
    if (this.mixer && this.action) this.mixer.setTime(t);
    const fired = this.shotAt !== null && t >= this.shotAt - 1e-6;
    for (const a of this.attachments) for (const o of (a.holder.userData.projectiles as THREE.Object3D[] | undefined) ?? []) o.visible = !fired;
    this.syncFades();
    this.pivot.updateMatrixWorld(true);
    this.applyRelease(t);
    this.applySecondary(t);
  }

  /**
   * Show only the weapons of one moveset: holders tagged with another style (userData.cls) are hidden, as
   * the exporter does per clip, so a rifle never appears in unarmed or sword moves. No style = show everything.
   */
  showClass(cls: string | null | undefined, perClip = false) {
    // Per-clip `with` (FB-074): clip-only items outside their clips, other hand-held items during a clip that brings its own.
    const away = (h: THREE.Object3D) => putAwayDuring({ cls: cls ?? undefined, perClip }, heldInfo(h));
    this.setHidden(this.holders.filter((h) => { const c = h.userData.cls as string | undefined; return (!!cls && !!c && c !== cls) || away(h); }));
  }

  /**
   * The renderer's own state that changes pixels besides the scene and the view (FB-121: part of a frame cache key
   * for exports that did not set it up from a spec, i.e. the Studio): the resolved lights and the FX look.
   */
  renderState() {
    const c = (x: THREE.Color) => x.getHexString();
    return {
      light: [c(this.hemiLight.color), c(this.hemiLight.groundColor), this.hemiLight.intensity, c(this.keyLight.color), this.keyLight.intensity, ...this.keyLight.position.toArray(), (this.shadowPlane.material as THREE.ShadowMaterial).opacity, ...this.lightTintRgb],
      fx: this.fxOn ? { add: this.fxAdd, tint: this.fxTint.value.toArray() } : null,
    };
  }

  /** Attachment holders (for exports that set triggers or read parts). */
  get holders() {
    return this.attachments.map((a) => a.holder);
  }

  /** The loaded model's root (every state model under it), null before setAsset. */
  get assetRoot(): THREE.Object3D | null {
    return this.asset;
  }

  /**
   * When the current clip fires (its `shoot` event, in clip seconds; null = never): held items' projectile parts
   * (the rocket in a launcher, FB-072) are drawn until then and hidden from that time on.
   */
  setShotTime(t: number | null) {
    this.shotAt = t;
  }
  private shotAt: number | null = null;

  /**
   * When the current clip lets go of its own items (its `release` event, in clip seconds; FB-103) and how: `hide` draws
   * them until then only (a thrown grenade, a placed charge: the game spawns its own); `drop` lets them fall from the
   * hand there and lie where they land (on the ground, in the character's frame). null = they stay in the hand.
   */
  setRelease(r: { t: number; mode: 'hide' | 'drop'; holders: THREE.Object3D[] } | null) {
    this.restoreReleased();
    for (const h of this.releaseHidden) h.visible = true;
    this.releaseHidden.clear();
    this.release = r && r.holders.length ? r : null;
    this.releasePose = null;
  }
  /** setRelease from a clip's own events (seconds) and its per-clip `with` (the Studio preview; exports use frames). */
  releaseClip(c: { events?: { t: number; name: string }[]; cls?: string; perClip?: boolean; release?: ReleaseMode } | null) {
    const e = c?.events?.find((x) => x.name === 'release');
    const mode = c ? releaseModeOf(c) : 'keep';
    this.setRelease(c && e && mode !== 'keep' ? { t: e.t, mode, holders: this.holders.filter((h) => releasedBy(c, heldInfo(h))) } : null);
  }
  private release: { t: number; mode: 'hide' | 'drop'; holders: THREE.Object3D[] } | null = null;
  private releaseHidden = new Set<THREE.Object3D>();
  /** Dropped items: their pose in the pivot's frame at the release and their lowest point then. */
  private releasePose: Map<THREE.Object3D, { rel: THREE.Matrix4; minY: number }> | null = null;
  /** Dropped items' own placement (bone-relative) before the drop moved them, restored before every pose. */
  private releaseSaved = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3; m: THREE.Matrix4 }>();

  private restoreReleased() {
    for (const [h, b] of this.releaseSaved) {
      h.position.copy(b.p);
      h.quaternion.copy(b.q);
      h.scale.copy(b.s);
      h.matrix.copy(b.m);
      h.matrixWorldNeedsUpdate = true;
    }
    this.releaseSaved.clear();
  }

  /** Called at the end of setTime (the pose is up to date): hide or drop the released items. */
  private applyRelease(t: number) {
    const r = this.release;
    if (!r) return;
    const gone = t >= r.t - 1e-6;
    if (r.mode === 'hide') {
      for (const h of r.holders) {
        if (gone) {
          if (h.visible) this.releaseHidden.add(h);
          h.visible = false;
        } else if (this.releaseHidden.delete(h)) h.visible = true;
      }
      return;
    }
    if (!gone) return;
    const pivotInv = () => this.pivot.matrixWorld.clone().invert();
    if (!this.releasePose) {
      // The items' pose at the release moment: evaluate the clip there once, then go back to t.
      this.mixer?.setTime(r.t);
      this.pivot.updateMatrixWorld(true);
      this.releasePose = new Map();
      for (const h of r.holders) {
        const rel = pivotInv().multiply(h.matrixWorld);
        const box = new THREE.Box3().setFromObject(h).applyMatrix4(pivotInv());
        this.releasePose.set(h, { rel, minY: box.isEmpty() ? rel.elements[13] : box.min.y });
      }
      this.mixer?.setTime(t);
      this.pivot.updateMatrixWorld(true);
    }
    const dt = t - r.t;
    for (const h of r.holders) {
      const at = this.releasePose.get(h);
      if (!at || !h.parent) continue;
      // Falls freely (g = 9.8 m/s², in the pivot's metres) until its lowest point reaches the ground (y = 0).
      const fall = Math.min(0.5 * 9.8 * dt * dt, Math.max(0, at.minY));
      const world = this.pivot.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, -fall, 0).multiply(at.rel));
      const local = h.parent.matrixWorld.clone().invert().multiply(world);
      this.releaseSaved.set(h, { p: h.position.clone(), q: h.quaternion.clone(), s: h.scale.clone(), m: h.matrix.clone() });
      if (h.matrixAutoUpdate) local.decompose(h.position, h.quaternion, h.scale);
      else h.matrix.copy(local);
      h.updateMatrixWorld(true);
    }
  }

  /** Set, for every triggered attachment, when its animation starts in the current clip (null = never). */
  setTriggerTimes(resolve: (eventName: string) => number | null) {
    for (const a of this.attachments) {
      const trig = a.holder.userData.trigger as string | undefined;
      if (!trig) continue;
      const t = resolve(trig);
      a.holder.userData.clipOffset = t === null ? Number.POSITIVE_INFINITY : t;
    }
  }

  /** Whether any mounted item swings on a spring (its pose depends on the frames posed before it). */
  get hasSecondary() {
    return this.attachments.some((a) => a.holder.userData.secondary);
  }

  /**
   * Pose the model for a direction and time without drawing, exactly as render() does first: a frame taken from the
   * frame cache (FB-121) still steps the springs, so the frames rendered after it swing the same as without a cache.
   */
  pose(worldAngle: number, time: number) {
    this.pivot.rotation.y = yawForAngle(worldAngle);
    this.mirror.scale.x = 1;
    this.setTime(time);
  }

  /** Run the secondary-motion springs over the sample times once (so loops start settled). */
  warmSecondary(times: number[]) {
    if (!this.attachments.some((a) => a.holder.userData.secondary)) return;
    for (const t of times) this.setTime(t);
  }

  /**
   * Hair, capes, pouches…: a spring lags each marked holder behind its bone's motion (measured in the asset's
   * own frame so every direction swings the same way), applied as a rotation about the bone.
   */
  private applySecondary(t: number) {
    const inv = new THREE.Matrix4().copy(this.pivot.matrixWorld).invert();
    const bonePos = new THREE.Vector3();
    const qPivot = this.pivot.getWorldQuaternion(new THREE.Quaternion());
    const qParent = new THREE.Quaternion();
    for (const a of this.attachments) {
      const cfg = a.holder.userData.secondary as SecondaryMotion | undefined;
      const parent = a.holder.parent;
      if (!cfg || !parent) continue;
      let st = this.springs.get(a.holder);
      if (!st) {
        st = newSpring();
        this.springs.set(a.holder, st);
        a.holder.userData.restQuat = a.holder.quaternion.clone();
        a.holder.userData.restMatrix = a.holder.matrix.clone();
      }
      parent.getWorldPosition(bonePos).applyMatrix4(inv);
      const [lx, lz] = stepSpring(st, t, [bonePos.x, bonePos.y, bonePos.z], cfg, this.duration);
      const angle = Math.hypot(lx, lz);
      const rest = a.holder.userData.restQuat as THREE.Quaternion;
      const restM = a.holder.userData.restMatrix as THREE.Matrix4;
      if (angle < 1e-5) {
        if (a.holder.matrixAutoUpdate) a.holder.quaternion.copy(rest);
        else a.holder.matrix.copy(restM);
      } else {
        // Rotate about the bone so the hanging item swings towards the lag direction.
        const dir = new THREE.Vector3(lx, 0, lz).normalize();
        const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, -1, 0), dir).normalize();
        parent.getWorldQuaternion(qParent);
        const axisLocal = axis.applyQuaternion(qPivot).applyQuaternion(qParent.clone().invert()).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axisLocal, angle);
        if (a.holder.matrixAutoUpdate) a.holder.quaternion.copy(q).multiply(rest);
        else a.holder.matrix.copy(new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(restM));
      }
      a.holder.updateMatrixWorld(true);
    }
  }

  /** Vertical extent and horizontal radius over the given sample times (precise, includes skinning). */
  measure(times: number[]) {
    const v = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity, radius = 0;
    this.pivot.rotation.y = 0;
    const sp = new THREE.Vector3(), ss = new THREE.Vector3();
    for (const t of times.length ? times : [0]) {
      this.setTime(t);
      // Only what this frame shows: hidden particle stages of other clips are skipped; sprites count with
      // their size (they always face the camera).
      this.asset?.traverseVisible((o) => {
        const s = o as THREE.Sprite;
        if (s.isSprite) {
          const op = (s.material as THREE.SpriteMaterial).opacity;
          if (op <= 0.01) return;
          s.getWorldPosition(sp);
          s.getWorldScale(ss);
          const r = Math.max(ss.x, ss.y) / 2;
          minY = Math.min(minY, sp.y - r);
          maxY = Math.max(maxY, sp.y + r);
          radius = Math.max(radius, Math.hypot(sp.x, sp.z) + r);
          return;
        }
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          m.getVertexPosition(i, v);
          v.applyMatrix4(m.matrixWorld);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
          radius = Math.max(radius, Math.hypot(v.x, v.z));
        }
      });
    }
    return { minY: Math.min(minY, 0), maxY, radius };
  }

  /**
   * The model's ground shape at one time of the current clip: every visible mesh vertex projected onto the ground
   * (x, z in metres around the origin, unturned), deduplicated to the millimetre, with the lowest height (y) of the
   * vertices at each point, plus its vertical extent. Feeds the export manifest's object footprint, collision hull
   * and ground-slice collision.
   */
  groundShape(time: number, opts: { tris?: boolean } = {}): { points: [number, number][]; heights: number[]; minY: number; maxY: number; tris?: number[] } {
    const v = new THREE.Vector3();
    const yaw = this.pivot.rotation.y, flip = this.mirror.scale.x;
    this.pivot.rotation.y = 0;
    this.mirror.scale.x = 1;
    this.mirror.updateMatrixWorld(true);
    this.setTime(time);
    const seen = new Map<string, number>();
    const points: [number, number][] = [];
    const heights: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    // With `tris` (collision "concave", FB-099): every triangle's corners too, 9 numbers each (x, y, z).
    const tris: number[] | undefined = opts.tris ? [] : undefined;
    this.asset?.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      const world: number[] | undefined = tris ? new Array(pos.count * 3) : undefined;
      for (let i = 0; i < pos.count; i++) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        if (world) {
          world[3 * i] = v.x;
          world[3 * i + 1] = v.y;
          world[3 * i + 2] = v.z;
        }
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        const x = Math.round(v.x * 1000) / 1000, z = Math.round(v.z * 1000) / 1000;
        const key = `${x},${z}`;
        const at = seen.get(key);
        if (at !== undefined) {
          if (v.y < heights[at]) heights[at] = v.y;
          continue;
        }
        seen.set(key, points.length);
        points.push([x, z]);
        heights.push(v.y);
      }
      if (tris && world) {
        const index = m.geometry.index;
        const n = index ? index.count : pos.count;
        for (let k = 0; k + 2 < n; k += 3)
          for (let c = 0; c < 3; c++) {
            const at = 3 * (index ? index.getX(k + c) : k + c);
            tris.push(world[at], world[at + 1], world[at + 2]);
          }
      }
    });
    this.pivot.rotation.y = yaw;
    this.mirror.scale.x = flip;
    this.mirror.updateMatrixWorld(true);
    return { points, heights, minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 0, ...(tris ? { tris } : {}) };
  }

  /** Sample times for a clip at the preset's fps (an empty clip still yields one frame). */
  sampleTimes(fps: number) {
    const d = this.duration;
    const n = Math.max(1, Math.round(d * fps));
    return Array.from({ length: n }, (_, i) => (i / n) * d);
  }

  /** Union of bounds over several clips (an export shares one framing across all its clips). */
  measureClips(list: { clip: THREE.AnimationClip | null; times: number[] }[]) {
    let minY = 0, maxY = -Infinity, radius = 0;
    for (const { clip, times } of list) {
      this.setClip(clip);
      const b = this.measure(times);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
      radius = Math.max(radius, b.radius);
    }
    return { minY, maxY, radius };
  }

  frame(cfg: ViewConfig, times: number[]): Framing {
    const f = computeFraming(this.measure(times), cfg);
    this.shadowPlane.scale.setScalar(Math.max(f.viewHalfW, f.viewHalfH) * 6);
    return f;
  }

  /**
   * Render one frame into a rectangle of the canvas (CSS-pixel coordinates, origin top-left).
   * `mirrored` renders the horizontal flip of `worldAngle` (asset and key light reflected), which is what
   * an engine shows for a mirrored direction.
   */
  render(cfg: ViewConfig, framing: Framing, worldAngle: number, time: number, rect: FrameRect, mirrored = false, layer: RenderLayer = 'color') {
    const pitch = (Math.min(Math.max(cfg.pitch, 0), 89.9) * Math.PI) / 180;
    this.pivot.rotation.y = yawForAngle(worldAngle);
    this.mirror.scale.x = mirrored ? -1 : 1;
    // A mirrored direction is the flip of the unmirrored one: its key light comes from the other side.
    this.keyLight.position.x = mirrored ? -this.keyX : this.keyX;
    this.setTime(time);

    // Camera axes: up u = (0, cos p, -sin p), looking along d = (0, -sin p, -cos p). The view is centred
    // on u * centreY so the framing (computed in camera space) is identical for both projections.
    const up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
    const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const target = up.clone().multiplyScalar(framing.centreY);
    if (framing.centreX) target.x += framing.centreX; // the camera's right is world +x
    let cam: THREE.Camera;
    if (cfg.projection === 'persp') {
      const pc = this.perspCamera;
      pc.fov = cfg.fov;
      pc.aspect = framing.viewHalfW / framing.viewHalfH;
      const dist = framing.viewHalfH / Math.tan(((cfg.fov / 2) * Math.PI) / 180) + framing.viewHalfW;
      pc.position.copy(target).addScaledVector(back, dist);
      pc.near = Math.max(0.01, dist - framing.viewHalfW * 4);
      pc.far = dist + framing.viewHalfW * 4;
      pc.up.set(0, 1, 0);
      pc.lookAt(target);
      pc.updateProjectionMatrix();
      cam = pc;
    } else {
      const oc = this.camera;
      oc.left = -framing.viewHalfW;
      oc.right = framing.viewHalfW;
      oc.top = framing.viewHalfH;
      oc.bottom = -framing.viewHalfH;
      oc.position.copy(target).addScaledVector(back, 100);
      // Depth layer: a tight range around the asset so depth uses the full 0..1 (white = nearest).
      const reach = Math.max(framing.viewHalfW, framing.viewHalfH);
      oc.near = layer === 'depth' ? Math.max(0.01, 100 - reach) : 0.01;
      oc.far = layer === 'depth' ? 100 + reach : 1000;
      oc.up.set(0, 1, 0);
      oc.lookAt(target);
      oc.updateProjectionMatrix();
      cam = oc;
    }

    this.lastCamera = cam;
    const r = this.renderer;
    // Data layers: override materials, no colour encoding.
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const shadowWas = this.shadowPlane.visible;
    const prevSpace = r.outputColorSpace;
    if (layer !== 'color') {
      r.outputColorSpace = THREE.LinearSRGBColorSpace;
      if (layer === 'shadow') {
        this.pivot.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            swapped.push([m, m.material]);
            m.material = this.invisibleMat;
          }
        });
      } else {
        this.shadowPlane.visible = false;
        this.scene.overrideMaterial = layer === 'normal' ? this.normalMat : layer === 'depth' ? this.depthMat : this.uvMat;
      }
    }
    const restore = () => {
      for (const [m, mat] of swapped) m.material = mat;
      this.scene.overrideMaterial = null;
      this.shadowPlane.visible = shadowWas;
      r.outputColorSpace = prevSpace;
    };
    const h = r.domElement.height / r.getPixelRatio();
    const y = h - rect.y - rect.height; // WebGL viewport origin is bottom-left
    const pixel = this.quality.style === 'pixel';
    const toon = !pixel && !!this.quality.stylize?.toon?.steps;
    const ss = this.quality.supersample ?? 1;
    if (ss <= 1 && !pixel && !this.fxOn && !toon) {
      r.setViewport(rect.x, y, rect.width, rect.height);
      r.setScissor(rect.x, y, rect.width, rect.height);
      const undoPass = this.applyPass(layer);
      r.render(this.scene, cam);
      undoPass();
    } else {
      // Render at ss× into an offscreen target, then box-filter it down into this cell.
      const w = Math.round(rect.width * ss), hh = Math.round(rect.height * ss);
      if (!this.ssTarget || this.ssTarget.width !== w || this.ssTarget.height !== hh) {
        this.ssTarget?.dispose();
        this.ssTarget = new THREE.WebGLRenderTarget(w, hh, { type: THREE.HalfFloatType, samples: 0 });
      }
      r.setRenderTarget(this.ssTarget);
      r.setViewport(0, 0, w, hh);
      r.setScissor(0, 0, w, hh);
      r.setClearColor(0x000000, 0);
      r.clear();
      const undoPass = this.applyPass(layer);
      r.render(this.scene, cam);
      undoPass();
      r.setRenderTarget(null);
      this.downsample.uniforms.src.value = this.ssTarget.texture;
      this.downsample.uniforms.factor.value = ss;
      this.downsample.uniforms.texel.value.set(1 / w, 1 / hh);
      const u = this.downsample.uniforms;
      u.pixelMode.value = pixel ? 1 : 0;
      const pal = pixel ? (this.quality.palette ?? 'model') : toon ? 'model' : 'full';
      u.levels.value = pal === 'levels' ? (this.quality.colorLevels ?? 6) : 0;
      const tex = pal === 'model' ? this.modelPalette(pixel ? (this.quality.shadeSteps ?? 4) : this.quality.stylize!.toon!.steps) : null;
      u.palette.value = layer === 'color' ? tex : null;
      u.paletteSize.value = tex && layer === 'color' ? tex.image.width : 0;
      u.encode.value = layer === 'color' || layer === 'shadow' ? 1 : 0;
      const soft = this.fxOn || this.quality.alphaThreshold === 'soft';
      u.outline.value = layer === 'color' && pixel && this.quality.outline && !soft ? 1 : 0;
      u.softAlpha.value = soft && layer === 'color' ? 1 : 0;
      // three's alpha blending into the cleared target already leaves premultiplied colour (rgb = C·a), so the
      // filter must not weight by alpha again (that darkened every fading edge and semi-transparent puff).
      u.premul.value = 1;
      u.tonemap.value = this.fxOn && layer === 'color' ? 1 : 0;
      (u.outlineColor.value as THREE.Color).set(this.quality.outlineColor ?? '#1a1418');
      r.setViewport(rect.x, y, rect.width, rect.height);
      r.setScissor(rect.x, y, rect.width, rect.height);
      r.render(this.quadScene, this.quadCam);
    }
    restore();
    this.mirror.scale.x = 1;
  }

  /** Pixel position (from the rect's top-left) of a world point in the last rendered frame. */
  project(world: THREE.Vector3, rect: { width: number; height: number }) {
    if (!this.lastCamera) return null;
    const v = world.clone().project(this.lastCamera);
    return { x: +(((v.x + 1) / 2) * rect.width).toFixed(1), y: +(((1 - v.y) / 2) * rect.height).toFixed(1) };
  }

  clear() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setScissor(0, 0, size.x, size.y);
    r.clear();
  }

  /**
   * The drawing buffer as a 2D canvas, read straight out of WebGL. Copying the WebGL canvas with drawImage
   * instead comes back empty for about every eighth frame in headless Chromium on NVIDIA's EGL (the copy can
   * land between a frame's clear and its render); readPixels is synchronous and exact. Pixels are flipped the
   * right way up and un-premultiplied, exactly what drawImage would have produced.
   */
  snapshot(): { canvas: HTMLCanvasElement; blank: boolean } {
    const r = this.renderer;
    const gl = r.getContext();
    const w = r.domElement.width, h = r.domElement.height;
    const buf = new Uint8Array(w * h * 4);
    r.setRenderTarget(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    let blank = true;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * row, dst = y * row;
      for (let i = 0; i < row; i += 4) {
        const a = buf[src + i + 3];
        if (a === 0) continue;
        blank = false;
        const k = a === 255 ? 1 : 255 / a;
        out[dst + i] = buf[src + i] * k;
        out[dst + i + 1] = buf[src + i + 1] * k;
        out[dst + i + 2] = buf[src + i + 2] * k;
        out[dst + i + 3] = a;
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(out, w, h), 0, 0);
    return { canvas: c, blank };
  }
}
