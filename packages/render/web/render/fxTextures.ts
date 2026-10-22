import * as THREE from 'three';

/**
 * Particle sprites for the particle templates. The POLYGON Particle FX pack's own sprites (low-poly puff,
 * soft glow, sparkle, ring, flame) are used when the pack is installed (served by /api/fxtextures); otherwise a
 * drawn equivalent. Call loadFxTextures() (and await it) before building particle clips so preview and export
 * use the same images.
 */
export type FxTex = 'glow' | 'puff' | 'spark' | 'ring' | 'flame' | 'disc' | 'streak' | 'soft';
/** Kinds the pack may provide; 'soft' (a soft, cloudy dust puff) is always drawn. */
const KINDS: FxTex[] = ['glow', 'puff', 'spark', 'ring', 'flame', 'disc', 'streak'];

const cache = new Map<FxTex, THREE.Texture>();
let loading: Promise<void> | null = null;

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 128) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return new THREE.Texture();
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function drawn(kind: FxTex): THREE.Texture {
  return canvasTex((g, s) => {
    const h = s / 2;
    const radial = (stops: [number, string][]) => {
      const grd = g.createRadialGradient(h, h, 0, h, h, h);
      for (const [o, c] of stops) grd.addColorStop(o, c);
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    };
    if (kind === 'soft') {
      // A soft cloud: a few overlapping radial blobs, densest in the middle and fading to nothing at the edge, so dust
      // and smoke read as vapour, not as the pack's flat low-poly discs (Sidefighter review: "grey boulders").
      const blobs: [number, number, number, number][] = [[0.5, 0.5, 0.42, 0.55], [0.38, 0.44, 0.26, 0.4], [0.62, 0.42, 0.24, 0.4], [0.46, 0.62, 0.26, 0.35], [0.64, 0.6, 0.22, 0.3]];
      for (const [x, y, r, a] of blobs) {
        const grd = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
        grd.addColorStop(0, `rgba(255,255,255,${a})`);
        grd.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      }
    } else if (kind === 'glow') radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
    else if (kind === 'puff' || kind === 'disc') {
      // Low-poly puff: a heptagon, like the Synty sprites.
      g.fillStyle = kind === 'puff' ? 'rgba(255,255,255,0.95)' : '#fff';
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        const r = h * (0.82 + 0.1 * Math.sin(i * 2.7));
        g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r);
      }
      g.fill();
    } else if (kind === 'spark') {
      radial([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.6)'], [0.4, 'rgba(255,255,255,0)']]);
      g.fillStyle = '#fff';
      g.fillRect(h - 1, 2, 2, s - 4);
      g.fillRect(2, h - 1, s - 4, 2);
    } else if (kind === 'ring') {
      g.strokeStyle = '#fff';
      g.lineWidth = s * 0.06;
      g.beginPath();
      g.arc(h, h, h * 0.85, 0, Math.PI * 2);
      g.stroke();
    } else if (kind === 'flame') {
      const grd = g.createLinearGradient(0, s, 0, 0);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(h * 0.3, s);
      g.quadraticCurveTo(h * 0.2, h, h, 2);
      g.quadraticCurveTo(h * 1.8, h, h * 1.7, s);
      g.fill();
    } else {
      const grd = g.createLinearGradient(0, 0, s, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grd;
      g.fillRect(0, h - s * 0.08, s, s * 0.16);
    }
  });
}

/** Load the pack's sprites once (missing ones keep the drawn fallback). */
export function loadFxTextures(): Promise<void> {
  if (loading) return loading;
  const tl = new THREE.TextureLoader();
  loading = Promise.all(
    KINDS.map((k) =>
      tl.loadAsync(`/slop/fx/${k}`).then(
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          cache.set(k, t);
        },
        () => undefined,
      ),
    ),
  ).then(() => undefined);
  return loading;
}

export function fxTexture(kind: FxTex): THREE.Texture {
  if (!cache.has(kind)) cache.set(kind, drawn(kind));
  return cache.get(kind)!;
}
