// The browser's ad block list format, shared by the build script and the tests. The app (browser/
// AdBlock.kt) reads the same file: "OPB1", a count, then the sorted 64-bit FNV-1a hashes of each domain.

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** FNV-1a 64 of the UTF-8 bytes, as a signed 64-bit number (Kotlin's Long). */
export function fnv1a64(s: string): bigint {
  let h = OFFSET;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * PRIME) & MASK;
  }
  return BigInt.asIntN(64, h);
}

/** One domain per line; "# comments", blank lines and anything that isn't a domain are skipped. */
export function parseDomains(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^\*\./, '').replace(/^\|\|/, '').replace(/\^$/, '').toLowerCase();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.includes(' ') || !line.includes('.')) continue;
    out.push(line);
  }
  return out;
}

export function encodeBlocklist(domains: string[]): Uint8Array {
  const hashes = [...new Set(domains.map(fnv1a64))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const buf = new Uint8Array(8 + hashes.length * 8);
  const view = new DataView(buf.buffer);
  view.setInt32(0, 0x4f504231);
  view.setInt32(4, hashes.length);
  hashes.forEach((h, i) => view.setBigInt64(8 + i * 8, h));
  return buf;
}
