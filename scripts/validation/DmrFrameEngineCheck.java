package br.radio.zapdmr;

import java.util.Arrays;
import java.util.List;
import java.util.Random;

/** Host-side interoperability checks against the existing desktop frame format. */
public final class DmrFrameEngineCheck {
    public static void main(String[] args) {
        checkHex(DmrFrameEngine.fullLc(724, 7246584, false), "0653059219d41e286bb0a921846dff57d75df5de31ac23d07c80d1a02a82d480ad");
        checkHex(DmrFrameEngine.fullLc(724, 7246584, true), "063c054619641e506bc0a98184adff57d75df5d964b820e87be0dde02282cd809e");
        Random random = new Random(7242);
        for (int trial = 0; trial < 1000; trial++) {
            byte[][] input = {new byte[9], new byte[9], new byte[9]};
            for (byte[] word : input) random.nextBytes(word);
            for (boolean sync : new boolean[]{true, false}) {
                byte[] burst = DmrFrameEngine.voiceBurst(Arrays.asList(input), sync);
                byte[][] decoded = DmrFrameEngine.extractVoice(burst);
                if (!Arrays.deepEquals(input, decoded)) throw new AssertionError("Voice payload damaged around sync/EMB area");
            }
        }
        System.out.println("PASS: desktop LC vectors and 2000 voice burst round trips");
    }
    private static void checkHex(byte[] actual, String expected) {
        StringBuilder hex = new StringBuilder();
        for (byte value : actual) hex.append(String.format("%02x", value & 255));
        if (!hex.toString().equals(expected)) throw new AssertionError("Full LC does not match desktop format: " + hex);
    }
}
