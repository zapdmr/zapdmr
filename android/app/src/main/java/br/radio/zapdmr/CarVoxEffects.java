package br.radio.zapdmr;
import android.media.AudioRecord;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
/** Device-dependent effects, never assumed to prove physical echo cancellation. */
final class CarVoxEffects implements AutoCloseable {
 private AcousticEchoCanceler aec;private NoiseSuppressor ns;boolean echo,noise;
 CarVoxEffects(AudioRecord record){this(record,true,true);}
 CarVoxEffects(AudioRecord record,boolean allowEcho,boolean allowNoise){try{if(allowEcho&&AcousticEchoCanceler.isAvailable()){aec=AcousticEchoCanceler.create(record.getAudioSessionId());if(aec!=null){aec.setEnabled(true);echo=aec.getEnabled();}}}catch(Exception ignored){}try{if(allowNoise&&NoiseSuppressor.isAvailable()){ns=NoiseSuppressor.create(record.getAudioSessionId());if(ns!=null){ns.setEnabled(true);noise=ns.getEnabled();}}}catch(Exception ignored){} }
 public void close(){if(aec!=null){try{aec.release();}catch(RuntimeException ignored){}aec=null;}if(ns!=null){try{ns.release();}catch(RuntimeException ignored){}ns=null;}}
}
