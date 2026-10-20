/* Embedded LC: adapted from MMDVM-Host, Copyright (C) 2015,2016,2017,2023,2025 Jonathan Naylor G4KLX; GPL-2.0-or-later. ZapDMR integration 2026 under GPL-3.0. See THIRD_PARTY_NOTICES.md and LICENSE. */
const SLOT_BYTES = 33;
const CODEWORD_BYTES = 9;
const BS_AUDIO_SYNC = Buffer.from([0x75, 0x5f, 0xd7, 0xdf, 0x75, 0xf7]);
const BS_DATA_SYNC = Buffer.from([0xdf, 0xf5, 0x7d, 0x75, 0xdf, 0x5d]);
const EMBEDDED_AREA_BITS = 32;

export type FullLcKind = 'header' | 'terminator';
export type DmrCallType = 'group' | 'private';

function getBit(data: Buffer, index: number): number {
  return (data[index >>> 3] >>> (7 - (index & 7))) & 1;
}

function setBit(data: Buffer, index: number, bit: number): void {
  const mask = 1 << (7 - (index & 7));
  if (bit) data[index >>> 3] |= mask;
  else data[index >>> 3] &= ~mask;
}

function bytesToBits(data: Buffer): number[] {
  return Array.from({ length: data.length * 8 }, (_, index) => getBit(data, index));
}

function bitsToBytes(bits: number[]): Buffer {
  const result = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => setBit(result, index, bit));
  return result;
}

function parity(bits: number[]): number {
  return bits.reduce((sum, bit) => sum ^ bit, 0);
}

function encodeHamming15113_2(bits: number[]): void {
  // BPTC196/96 uses the second Hamming (15,11,3) convention used by DMR.
  const [a, b, c, d, e, f, g, h, i, j, k] = bits;
  bits[11] = a ^ b ^ c ^ d ^ f ^ h ^ i;
  bits[12] = b ^ c ^ d ^ e ^ g ^ i ^ j;
  bits[13] = c ^ d ^ e ^ f ^ h ^ j ^ k;
  bits[14] = a ^ b ^ c ^ e ^ g ^ h ^ k;
}

function encodeHamming1393(bits: number[]): void {
  const [a, b, c, d, e, f, g, h, i] = bits;
  bits[9] = a ^ b ^ d ^ f ^ g;
  bits[10] = a ^ b ^ c ^ e ^ g ^ h;
  bits[11] = a ^ b ^ c ^ d ^ f ^ h ^ i;
  bits[12] = a ^ c ^ e ^ f ^ i;
}

function encodeBptc19696(payload: Buffer): number[] {
  if (payload.length !== 12) throw new Error('BPTC196,96 exige exatamente 12 bytes.');
  const dataBits = bytesToBits(payload);
  const matrix = Array<number>(196).fill(0);
  const dataPositions: number[] = [];
  for (let bit = 4; bit <= 11; bit++) dataPositions.push(bit);
  for (const start of [16, 31, 46, 61, 76, 91, 106, 121]) {
    for (let bit = start; bit < start + 11; bit++) dataPositions.push(bit);
  }
  if (dataPositions.length !== 96) throw new Error('Posições BPTC inválidas.');
  dataPositions.forEach((position, index) => { matrix[position] = dataBits[index]; });

  for (let row = 0; row < 9; row++) {
    const offset = row * 15 + 1;
    const rowBits = matrix.slice(offset, offset + 15);
    encodeHamming15113_2(rowBits);
    rowBits.forEach((bit, index) => { matrix[offset + index] = bit; });
  }
  for (let col = 0; col < 15; col++) {
    const column = Array.from({ length: 13 }, (_, row) => matrix[col + 1 + row * 15]);
    encodeHamming1393(column);
    column.forEach((bit, row) => { matrix[col + 1 + row * 15] = bit; });
  }

  const interleaved = Array<number>(196).fill(0);
  for (let index = 0; index < 196; index++) interleaved[(index * 181) % 196] = matrix[index];
  return interleaved;
}

function gfMultiply(a: number, b: number): number {
  let left = a;
  let right = b;
  let product = 0;
  while (right) {
    if (right & 1) product ^= left;
    right >>>= 1;
    left <<= 1;
    if (left & 0x100) left ^= 0x11d;
  }
  return product & 0xff;
}

function encodeRs129(message: Buffer): number[] {
  if (message.length !== 9) throw new Error('RS(12,9) exige 9 bytes de dados.');
  const coefficients = [64, 56, 14, 1];
  const state = [0, 0, 0, 0];
  for (const byte of message) {
    const feedback = byte ^ state[2];
    state[3] = state[2] ^ gfMultiply(coefficients[3], feedback);
    state[2] = state[1] ^ gfMultiply(coefficients[2], feedback);
    state[1] = state[0] ^ gfMultiply(coefficients[1], feedback);
    state[0] = gfMultiply(coefficients[0], feedback);
  }
  return [state[2], state[1], state[0]];
}

function encodeGolay2087(value: number): number[] {
  // Systematic 19-bit Golay code plus its overall even-parity bit.
  let remainder = (value & 0xff) << 11;
  for (let bit = 18; bit >= 11; bit--) {
    if ((remainder & (1 << bit)) !== 0) remainder ^= 0xc75 << (bit - 11);
  }
  const code19 = ((value & 0xff) << 11) | remainder;
  const parityBit = parity(Array.from({ length: 19 }, (_, index) => (code19 >>> (18 - index)) & 1));
  return [...Array.from({ length: 19 }, (_, index) => (code19 >>> (18 - index)) & 1), parityBit];
}

function encodeQr1676(value: number): number[] {
  let remainder = (value & 0x7f) << 8;
  for (let bit = 14; bit >= 8; bit--) {
    if ((remainder & (1 << bit)) !== 0) remainder ^= 0x139 << (bit - 8);
  }
  const code15 = ((value & 0x7f) << 8) | remainder;
  const parityBit = parity(Array.from({ length: 15 }, (_, index) => (code15 >>> (14 - index)) & 1));
  const code16 = [...Array.from({ length: 15 }, (_, index) => (code15 >>> (14 - index)) & 1), parityBit];
  return code16;
}

function putFullLcSlotType(slot: Buffer, colorCode: number, dataType: number): void {
  const slotTypeBits = encodeGolay2087(((colorCode & 0x0f) << 4) | (dataType & 0x0f));
  // DMR slot type uses bits 98..107 and 156..165 around the 48-bit sync.
  slotTypeBits.slice(0, 10).forEach((bit, index) => setBit(slot, 98 + index, bit));
  slotTypeBits.slice(10).forEach((bit, index) => setBit(slot, 156 + index, bit));
}

function makeFullLcPayload(talkgroupId: number, radioId: number, kind: FullLcKind, callType: DmrCallType): Buffer {
  const lc = Buffer.alloc(12);
  lc[0] = callType === 'private' ? 0x03 : 0x00; // ETSI FLCO: user-to-user or group voice.
  lc[1] = 0x00; // ETSI manufacturer ID.
  lc[2] = 0x00; // Options.
  lc.writeUIntBE(talkgroupId, 3, 3);
  lc.writeUIntBE(radioId, 6, 3);
  const check = encodeRs129(lc.subarray(0, 9));
  const mask = kind === 'header' ? 0x96 : 0x99;
  lc[9] = check[0] ^ mask;
  lc[10] = check[1] ^ mask;
  lc[11] = check[2] ^ mask;
  return lc;
}

/** Build a DMR voice-LC header or terminator as 33-byte network slot data. */
export function buildFullLcBurst(
  talkgroupId: number,
  radioId: number,
  colorCode: number,
  kind: FullLcKind,
  callType: DmrCallType = 'group'
): Buffer {
  const payload = makeFullLcPayload(talkgroupId, radioId, kind, callType);
  const bptc = encodeBptc19696(payload);
  const slot = Buffer.alloc(SLOT_BYTES);
  bptc.slice(0, 98).forEach((bit, index) => setBit(slot, index, bit));
  bptc.slice(98).forEach((bit, index) => setBit(slot, index + 166, bit));
  putFullLcSlotType(slot, colorCode, kind === 'header' ? 0x01 : 0x02);
  const sync = BS_DATA_SYNC;
  bytesToBits(sync).forEach((bit, index) => setBit(slot, index + 108, bit));
  return slot;
}

/** Embedded LC layout follows MMDVM-Host DMREmbeddedData, Hamming and CRC
 * (Jonathan Naylor G4KLX, 2015-2025, GPL-2.0-or-later; this application GPL-3.0).
 * https://github.com/g4klx/MMDVM-Host/blob/master/DMREmbeddedData.cpp
 */
function embeddedLcBits(destinationId: number, sourceId: number, callType: DmrCallType): number[] {
  const lc = makeFullLcPayload(destinationId, sourceId, 'header', callType).subarray(0, 9);
  const payload = bytesToBits(lc);
  const checksum = [...lc].reduce((sum, byte) => sum + byte, 0) % 31;
  const matrix = Array<number>(128).fill(0);
  [42, 58, 74, 90, 106].forEach((position, i) => { matrix[position] = (checksum >>> (4 - i)) & 1; });
  let input = 0;
  for (let row = 0; row < 7; row++) {
    const count = row < 2 ? 11 : 10;
    for (let bit = 0; bit < count; bit++) matrix[row * 16 + bit] = payload[input++];
    const bits = matrix.slice(row * 16, row * 16 + 16);
    encodeHamming15113_2(bits);
    bits[15] = bits[0] ^ bits[2] ^ bits[5] ^ bits[6] ^ bits[8] ^ bits[9] ^ bits[10];
    bits.forEach((bit, i) => { matrix[row * 16 + i] = bit; });
  }
  for (let col = 0; col < 16; col++)
    matrix[112 + col] = parity(Array.from({ length: 7 }, (_, row) => matrix[row * 16 + col]));
  let cursor = 0;
  return Array.from({ length: 128 }, () => {
    const bit = matrix[cursor]; cursor += 16;
    if (cursor > 127) cursor -= 127;
    return bit;
  });
}

/** Pack the sidecar's three 9-byte AMBE+2 channel codewords into one 33-byte DMR burst. */
export function buildVoiceBurst(codewords: Buffer[], voiceSync: boolean, colorCode = 1,
  lc?: { destinationId: number; sourceId: number; callType: DmrCallType; sequence: number }): Buffer {
  if (codewords.length !== 3 || codewords.some((word) => word.length !== CODEWORD_BYTES))
    throw new Error('Uma rajada DMR exige três codewords AMBE de 9 bytes.');
  const voiceBits = codewords.flatMap(bytesToBits);
  if (voiceBits.length !== 216) throw new Error('Dados AMBE da rajada inválidos.');
  const slot = Buffer.alloc(SLOT_BYTES);
  voiceBits.slice(0, 108).forEach((bit, index) => setBit(slot, index, bit));
  voiceBits.slice(108).forEach((bit, index) => setBit(slot, index + 156, bit));
  if (voiceSync) {
    bytesToBits(BS_AUDIO_SYNC).forEach((bit, index) => setBit(slot, index + 108, bit));
  } else {
    const fragment = lc && lc.sequence >= 1 && lc.sequence <= 4 ? lc.sequence - 1 : -1;
    const lcss = fragment < 0 ? 0 : fragment === 0 ? 1 : fragment === 3 ? 2 : 3;
    const embeddedSignalling = encodeQr1676(((colorCode & 0x0f) << 3) | lcss);
    embeddedSignalling.slice(0, 8).forEach((bit, index) => setBit(slot, index + 108, bit));
    const embedded = fragment < 0 || !lc ? [] : embeddedLcBits(lc.destinationId, lc.sourceId, lc.callType);
    for (let index = 0; index < EMBEDDED_AREA_BITS; index++) setBit(slot, index + 116, fragment < 0 ? 0 : embedded[fragment * 32 + index]);
    embeddedSignalling.slice(8).forEach((bit, index) => setBit(slot, index + 148, bit));
  }
  return slot;
}

/** Extract the three AMBE+2 codewords from voice DMRD slot data. */
export function extractVoiceCodewords(slot: Buffer): Buffer[] {
  if (slot.length !== SLOT_BYTES) return [];
  const voiceBits = [
    ...Array.from({ length: 108 }, (_, index) => getBit(slot, index)),
    ...Array.from({ length: 108 }, (_, index) => getBit(slot, index + 156))
  ];
  const voice = bitsToBytes(voiceBits);
  return [0, 1, 2].map((index) => Buffer.from(voice.subarray(index * CODEWORD_BYTES, (index + 1) * CODEWORD_BYTES)));
}

export function isVoiceSyncFlag(flags: number): boolean {
  return (flags & 0x30) === 0x10;
}

export function isVoiceFrameFlag(flags: number): boolean {
  return (flags & 0x30) === 0 && (flags & 0x0f) <= 5;
}
