/* Embedded LC: adapted from MMDVM-Host, Copyright (C) 2015,2016,2017,2023,2025 Jonathan Naylor G4KLX; GPL-2.0-or-later. ZapDMR integration 2026 under GPL-3.0. See THIRD_PARTY_NOTICES.md and LICENSE. */
package br.radio.zapdmr;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/** DMR voice-LC and voice-burst framing used by the native HBP service. */
final class DmrFrameEngine {
    private static final byte[] AUDIO_SYNC = {(byte)0x75,0x5f,(byte)0xd7,(byte)0xdf,0x75,(byte)0xf7};
    private static final byte[] DATA_SYNC = {(byte)0xdf,(byte)0xf5,0x7d,0x75,(byte)0xdf,0x5d};

    private DmrFrameEngine() {}

    static byte[] fullLc(int talkgroup, int radioId, boolean terminator) {
        return fullLc(talkgroup, radioId, terminator, false);
    }

    static byte[] fullLc(int talkgroup, int radioId, boolean terminator, boolean privateCall) {
        byte[] lc = new byte[12];
        lc[0] = (byte)(privateCall ? 3 : 0); // ETSI FLCO USER_USER / GROUP.
        write24(lc, 3, talkgroup); write24(lc, 6, radioId);
        int[] rs = rs129(lc, 9);
        int mask = terminator ? 0x99 : 0x96;
        lc[9] = (byte)(rs[0] ^ mask); lc[10] = (byte)(rs[1] ^ mask); lc[11] = (byte)(rs[2] ^ mask);
        int[] coded = bptc19696(lc);
        byte[] slot = new byte[33];
        for (int i = 0; i < 98; i++) setBit(slot, i, coded[i]);
        for (int i = 98; i < 196; i++) setBit(slot, i + 68, coded[i]);
        int type = terminator ? 2 : 1;
        int[] slotType = golay2087((1 << 4) | type);
        for (int i = 0; i < 10; i++) setBit(slot, 98 + i, slotType[i]);
        for (int i = 10; i < 20; i++) setBit(slot, 156 + i - 10, slotType[i]);
        byte[] sync = DATA_SYNC;
        for (int i = 0; i < 48; i++) setBit(slot, 108 + i, bit(sync, i));
        return slot;
    }

    static byte[] voiceBurst(List<byte[]> codewords, boolean voiceSync) {
        if (codewords.size() != 3) throw new IllegalArgumentException("DMR voice burst needs three AMBE frames");
        byte[] slot = new byte[33];
        int out = 0;
        for (byte[] word : codewords) {
            if (word.length != 9) throw new IllegalArgumentException("AMBE FEC frame must be 9 bytes");
            for (int i = 0; i < 72; i++) {
                int position = out < 108 ? out : out + 48;
                setBit(slot, position, bit(word, i));
                out++;
            }
        }
        if (voiceSync) {
            for (int i = 0; i < 48; i++) setBit(slot, 108 + i, bit(AUDIO_SYNC, i));
        } else {
            int[] emb = qr1676(1 << 3);
            for (int i = 0; i < 8; i++) setBit(slot, 108 + i, emb[i]);
            for (int i = 0; i < 32; i++) setBit(slot, 116 + i, 0);
            for (int i = 8; i < 16; i++) setBit(slot, 148 + i - 8, emb[i]);
        }
        return slot;
    }

    static byte[] voiceBurst(List<byte[]> codewords, int sequence, int destination, int source, boolean privateCall) {
        byte[] slot = voiceBurst(codewords, sequence == 0);
        if (sequence == 0) return slot;
        int fragment = sequence >= 1 && sequence <= 4 ? sequence - 1 : -1;
        int lcss = fragment < 0 ? 0 : fragment == 0 ? 1 : fragment == 3 ? 2 : 3;
        int[] emb = qr1676((1 << 3) | lcss);
        for (int i = 0; i < 8; i++) setBit(slot, 108 + i, emb[i]);
        for (int i = 8; i < 16; i++) setBit(slot, 148 + i - 8, emb[i]);
        if (fragment >= 0) {
            int[] embedded = embeddedLc(destination, source, privateCall);
            for (int i = 0; i < 32; i++) setBit(slot, 116 + i, embedded[fragment * 32 + i]);
        }
        return slot;
    }

    /* Embedded LC layout follows MMDVM-Host DMREmbeddedData/Hamming/CRC,
     * Jonathan Naylor G4KLX 2015-2025, GPL-2.0-or-later; application GPL-3.0.
     * https://github.com/g4klx/MMDVM-Host/blob/master/DMREmbeddedData.cpp */
    private static int[] embeddedLc(int destination, int source, boolean privateCall) {
        byte[] lc = new byte[9]; lc[0] = (byte)(privateCall ? 3 : 0);
        write24(lc, 3, destination); write24(lc, 6, source);
        int checksum = 0; for (byte value : lc) checksum += value & 255; checksum %= 31;
        int[] matrix = new int[128];
        int[] positions = {42, 58, 74, 90, 106};
        for (int i = 0; i < 5; i++) matrix[positions[i]] = (checksum >>> (4 - i)) & 1;
        int input = 0;
        for (int row = 0; row < 7; row++) {
            int count = row < 2 ? 11 : 10, offset = row * 16;
            for (int i = 0; i < count; i++) matrix[offset + i] = bit(lc, input++);
            int[] d = new int[16]; System.arraycopy(matrix, offset, d, 0, 16);
            d[11]=d[0]^d[1]^d[2]^d[3]^d[5]^d[7]^d[8];
            d[12]=d[1]^d[2]^d[3]^d[4]^d[6]^d[8]^d[9];
            d[13]=d[2]^d[3]^d[4]^d[5]^d[7]^d[9]^d[10];
            d[14]=d[0]^d[1]^d[2]^d[4]^d[6]^d[7]^d[10];
            d[15]=d[0]^d[2]^d[5]^d[6]^d[8]^d[9]^d[10];
            System.arraycopy(d, 0, matrix, offset, 16);
        }
        for (int col = 0; col < 16; col++) for (int row = 0; row < 7; row++) matrix[112 + col] ^= matrix[row * 16 + col];
        int[] raw = new int[128]; int cursor = 0;
        for (int i = 0; i < 128; i++) { raw[i] = matrix[cursor]; cursor += 16; if (cursor > 127) cursor -= 127; }
        return raw;
    }

    static byte[][] extractVoice(byte[] slot) {
        if (slot.length != 33) return new byte[0][];
        byte[] packed = new byte[27];
        for (int i = 0; i < 108; i++) setBit(packed, i, bit(slot, i));
        for (int i = 0; i < 108; i++) setBit(packed, 108 + i, bit(slot, 156 + i));
        byte[][] words = new byte[3][9];
        for (int w = 0; w < 3; w++) System.arraycopy(packed, w * 9, words[w], 0, 9);
        return words;
    }

    private static int[] bptc19696(byte[] payload) {
        int[] matrix = new int[196];
        List<Integer> positions = new ArrayList<>(96);
        for (int i = 4; i <= 11; i++) positions.add(i);
        for (int start : new int[]{16,31,46,61,76,91,106,121}) for (int i=start;i<start+11;i++) positions.add(i);
        for (int i=0;i<96;i++) matrix[positions.get(i)] = bit(payload, i);
        for (int row=0; row<9; row++) {
            int offset=row*15+1; int[] bits=new int[15]; System.arraycopy(matrix,offset,bits,0,15);
            bits[11]=bits[0]^bits[1]^bits[2]^bits[3]^bits[5]^bits[7]^bits[8];
            bits[12]=bits[1]^bits[2]^bits[3]^bits[4]^bits[6]^bits[8]^bits[9];
            bits[13]=bits[2]^bits[3]^bits[4]^bits[5]^bits[7]^bits[9]^bits[10];
            bits[14]=bits[0]^bits[1]^bits[2]^bits[4]^bits[6]^bits[7]^bits[10];
            System.arraycopy(bits,0,matrix,offset,15);
        }
        for (int col=0; col<15; col++) {
            int[] b=new int[13]; for(int row=0;row<13;row++) b[row]=matrix[col+1+row*15];
            b[9]=b[0]^b[1]^b[3]^b[5]^b[6];
            b[10]=b[0]^b[1]^b[2]^b[4]^b[6]^b[7];
            b[11]=b[0]^b[1]^b[2]^b[3]^b[5]^b[7]^b[8];
            b[12]=b[0]^b[2]^b[4]^b[5]^b[8];
            for(int row=0;row<13;row++) matrix[col+1+row*15]=b[row];
        }
        int[] interleaved=new int[196]; for(int i=0;i<196;i++) interleaved[(i*181)%196]=matrix[i];
        return interleaved;
    }

    private static int[] rs129(byte[] msg, int count) {
        int[] coeff={64,56,14,1}, state={0,0,0,0};
        for(int i=0;i<count;i++) {
            int feedback=(msg[i]&255)^state[2];
            state[3]=state[2]^gf(coeff[3],feedback); state[2]=state[1]^gf(coeff[2],feedback);
            state[1]=state[0]^gf(coeff[1],feedback); state[0]=gf(coeff[0],feedback);
        }
        return new int[]{state[2],state[1],state[0]};
    }

    private static int gf(int a,int b) {
        int product=0,left=a,right=b;
        while(right!=0){if((right&1)!=0)product^=left;right>>>=1;left<<=1;if((left&0x100)!=0)left^=0x11d;}
        return product&255;
    }

    private static int[] golay2087(int value) {
        int rem=(value&255)<<11;
        for(int bit=18;bit>=11;bit--) if((rem&(1<<bit))!=0) rem^=0xc75<<(bit-11);
        int code=((value&255)<<11)|rem; int[] bits=new int[20]; int parity=0;
        for(int i=0;i<19;i++){bits[i]=(code>>>(18-i))&1;parity^=bits[i];} bits[19]=parity; return bits;
    }

    private static int[] qr1676(int value) {
        int rem=(value&0x7f)<<8;
        for(int bit=14;bit>=8;bit--) if((rem&(1<<bit))!=0) rem^=0x139<<(bit-8);
        int code=((value&0x7f)<<8)|rem; int[] bits=new int[16]; int parity=0;
        for(int i=0;i<15;i++){bits[i]=(code>>>(14-i))&1;parity^=bits[i];} bits[15]=parity; return bits;
    }

    private static int bit(byte[] data, int index) { return ((data[index >>> 3] & 255) >>> (7-(index&7)))&1; }
    private static void setBit(byte[] data,int index,int value) {
        int mask=1<<(7-(index&7)); int at=index>>>3;
        data[at]=(byte)(value!=0?(data[at]|mask):(data[at]&~mask));
    }
    private static void write24(byte[] out,int offset,int value) {
        out[offset]=(byte)(value>>>16);out[offset+1]=(byte)(value>>>8);out[offset+2]=(byte)value;
    }
}
