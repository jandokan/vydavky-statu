// Minimálny ZIP reader bez závislostí (stačí na exporty CRZ a GeoNames).
import { inflateRawSync } from 'node:zlib';

export function unzip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Nie je to ZIP súbor');
  const count = b.readUInt16LE(e + 10);
  let p = b.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Poškodený ZIP (central directory)');
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32);
    const lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    const start = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28);
    const data = b.subarray(start, start + csize);
    files[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
  }
  return files;
}
