package br.radio.zapdmr;
/** Native WebRTC VAD; 8 kHz mono PCM, 20 ms frames, no network/model downloads. */
final class WebRtcVad implements AutoCloseable {
 private static final boolean AVAILABLE;static{boolean loaded=false;try{System.loadLibrary("zapcarvad");loaded=true;}catch(UnsatisfiedLinkError ignored){}AVAILABLE=loaded;}
 private long handle;static boolean available(){return AVAILABLE;}
 WebRtcVad(int mode){if(!AVAILABLE)throw new IllegalStateException("VAD nativo indisponível neste aparelho.");handle=create(mode);if(handle==0)throw new IllegalStateException("VAD não iniciou.");}
 boolean speech(short[] frame){int value=process(handle,frame);if(value<0)throw new IllegalStateException("Quadro de áudio inválido para VAD.");return value==1;}
 public void close(){if(handle!=0){destroy(handle);handle=0;}}
 private static native long create(int mode);private static native int process(long handle,short[] pcm);private static native void destroy(long handle);
}
