package br.radio.zapdmr;
/** Pure policy layered over WebRTC VAD, not a volume-only detector. One frame = 20 ms. */
final class CarVoxGate {
 enum Result { WAIT, CALIBRATING, READY, START, SPEAKING, END, RX_BLOCKED, UNSAFE }
 private final int sensitivity,hang;private double noise=-65,steadyDb,steadyZcr;private long quiet,speech,lastVoice,blockedUntil,steady,loud,started;private boolean calibrated,transmitting;private String reason="";
 CarVoxGate(int sensitivity,int hang){this.sensitivity=Math.max(0,Math.min(2,sensitivity));this.hang=Math.max(400,Math.min(3000,hang));}
 synchronized String reason(){return reason;}int mode(){return sensitivity==2?2:3;}
 synchronized void blocked(long now){calibrated=false;speech=0;quiet=0;steady=0;blockedUntil=now+1200;}
 synchronized Result frame(boolean vad,double db,double zcr,boolean eligible,boolean tx,long now){
  if(!eligible){blocked(now);return Result.RX_BLOCKED;}
  if(now<blockedUntil)return Result.WAIT;
  if(db>-18){if(loud==0)loud=now;if(now-loud>=2000){reason="Ruído/entrada excessiva; VOX suspenso. Reduza a sensibilidade e teste novamente.";return Result.UNSAFE;}}else loud=0;
  if(tx){
   if(!transmitting){transmitting=true;started=now;lastVoice=now;steady=0;}
   if(now-started>=180000){reason="Limite VOX de 180 segundos; ative novamente quando estiver seguro.";return Result.UNSAFE;}
   if(vad&&db>noise+4){lastVoice=now;if(steady==0||Math.abs(db-steadyDb)>0.8||Math.abs(zcr-steadyZcr)>0.015){steady=now;steadyDb=db;steadyZcr=zcr;}else if(now-steady>=6000){reason="Sinal constante prolongado; VOX suspenso para evitar TX por ruído.";return Result.UNSAFE;}}
   else steady=0;
   if(now-lastVoice>=hang){transmitting=false;speech=quiet=0;blockedUntil=now+1000;return Result.END;}return Result.SPEAKING;
  }
  transmitting=false;
  if(!vad){noise=Math.max(-80,Math.min(-25,noise*0.96+db*0.04));speech=0;if(quiet==0)quiet=now;if(now-quiet>=800)calibrated=true;return calibrated?Result.READY:Result.CALIBRATING;}
  if(!calibrated)return Result.CALIBRATING;
  int snr=sensitivity==0?12:sensitivity==1?9:6;double floor=sensitivity==0?-40:sensitivity==1?-46:-52;
  if(db<Math.max(floor,noise+snr)){speech=0;return Result.READY;}
  if(speech==0)speech=now;int minimum=sensitivity==0?320:sensitivity==1?240:200;
  if(now-speech>=minimum){lastVoice=now;steady=0;return Result.START;}return Result.WAIT;
 }
 static double db(short[] pcm){double sum=0;for(short s:pcm)sum+=(double)s*s;return 20*Math.log10(Math.max(1e-6,Math.sqrt(sum/pcm.length)/32768));}
 static double zcr(short[] pcm){int count=0;for(int i=1;i<pcm.length;i++)if((pcm[i]<0)!=(pcm[i-1]<0))count++;return count/(double)pcm.length;}
}
