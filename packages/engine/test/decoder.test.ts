import { describe, expect, it } from 'vitest';
import { PACKET_SIZE, TELEMETRY_VECTORS } from '@force/protocol';
import { decodePacket, encodeRawSample } from '../src/decoder.js';

const bytesOf = (hex: string) => Uint8Array.from(hex.split(' ').map((b) => parseInt(b, 16)));

describe('decoder reads the shared worked examples byte for byte', () => {
  for (const v of TELEMETRY_VECTORS) {
    it(`decodes "${v.name}"`, () => {
      const r = decodePacket(bytesOf(v.hex), 1234);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const { arrivalMs, ...fields } = r.sample;
      expect(arrivalMs).toBe(1234);
      expect(fields).toEqual(v.expected);
    });
    it(`re-encodes "${v.name}" to identical bytes`, () => {
      const r = decodePacket(bytesOf(v.hex), 0);
      if (!r.ok) throw new Error('decode failed');
      expect([...encodeRawSample(r.sample)]).toEqual([...bytesOf(v.hex)]);
    });
  }
});

describe('validation', () => {
  const good = bytesOf(TELEMETRY_VECTORS[0]!.hex);

  it('rejects packets shorter than 15 bytes', () => {
    for (let n = 0; n < PACKET_SIZE; n++) {
      expect(decodePacket(good.slice(0, n), 0)).toEqual({ ok: false, reason: 'too_short' });
    }
  });

  it('ignores extra bytes so a longer future packet still parses', () => {
    const longer = new Uint8Array(20);
    longer.set(good);
    longer.fill(0xee, PACKET_SIZE);
    const r = decodePacket(longer, 0);
    expect(r.ok).toBe(true);
  });

  it('rejects a voltage the INA219 cannot report', () => {
    const bad = good.slice();
    new DataView(bad.buffer).setUint16(6, 40000, true);
    expect(decodePacket(bad, 0)).toEqual({ ok: false, reason: 'voltage_out_of_range' });
  });

  it('accepts the INA219 maximum and ignores reserved flag bits', () => {
    const p = good.slice();
    new DataView(p.buffer).setUint16(6, 32764, true);
    p[14] = 0xff;
    const r = decodePacket(p, 0);
    expect(r.ok && r.sample.flags).toBe(0xff);
  });

  it('respects the byteOffset of a view into a larger buffer', () => {
    const big = new Uint8Array(40);
    big.set(good, 11);
    const r = decodePacket(new Uint8Array(big.buffer, 11, 15), 0);
    expect(r.ok && r.sample.seq).toBe(1);
  });

  it('accepts a bare ArrayBuffer (what Web Bluetooth and workers hand over)', () => {
    const r = decodePacket(good.slice().buffer, 0);
    expect(r.ok).toBe(true);
  });
});
