// Moved from synty-sprite-generator packages/shared/src/hash.ts (P2, ali3b/sloponator#8).
/**
 * SHA-256 in plain TypeScript, fed incrementally (strings and byte arrays). Used for cache keys in the browser too,
 * where `crypto.subtle` is missing on plain-http LAN pages (not a secure context).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8 = new TextEncoder();

export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private block = new Uint8Array(64);
  private fill = 0;
  private length = 0;
  private w = new Uint32Array(64);

  /** Add a string (UTF-8) or bytes; typed arrays of other kinds are hashed as their raw bytes. */
  update(data: string | ArrayBufferView): this {
    const bytes = typeof data === 'string' ? utf8.encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.length += bytes.length;
    let i = 0;
    while (i < bytes.length) {
      const n = Math.min(64 - this.fill, bytes.length - i);
      this.block.set(bytes.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === 64) {
        this.compress();
        this.fill = 0;
      }
    }
    return this;
  }

  private compress() {
    const w = this.w, b = this.block, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (b[i * 4] << 24) | (b[i * 4 + 1] << 16) | (b[i * 4 + 2] << 8) | b[i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }

  /** The digest as lowercase hex (the hasher is spent afterwards). */
  hex(): string {
    const bits = this.length * 8;
    this.block[this.fill++] = 0x80;
    if (this.fill > 56) {
      this.block.fill(0, this.fill);
      this.compress();
      this.fill = 0;
    }
    this.block.fill(0, this.fill, 56);
    const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    for (let i = 0; i < 4; i++) this.block[56 + i] = (hi >>> (24 - i * 8)) & 0xff;
    for (let i = 0; i < 4; i++) this.block[60 + i] = (lo >>> (24 - i * 8)) & 0xff;
    this.compress();
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }
}

export const sha256 = (data: string | ArrayBufferView) => new Sha256().update(data).hex();

/** JSON with object keys sorted at every level, undefined members left out (stable across key order). */
export function canonicalJson(v: unknown): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canon)
      : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((x as Record<string, unknown>)[k])]))
        : x;
  return JSON.stringify(canon(v)) ?? 'null';
}
