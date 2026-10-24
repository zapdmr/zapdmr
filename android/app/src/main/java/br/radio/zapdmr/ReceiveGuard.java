package br.radio.zapdmr;

/** Local packet interlock. Callers synchronize this object across the actual UDP send. */
final class ReceiveGuard {
    private long stream, until;
    private boolean receiving;
    private int protectionMs=500;
    synchronized void configure(int milliseconds){protectionMs=Math.max(0,Math.min(3000,milliseconds));}
    synchronized void voice(long call,long now){stream=call;receiving=true;until=now+1200+protectionMs;}
    synchronized void end(long call,long now){if(receiving&&stream==call){receiving=false;until=now+protectionMs;}}
    synchronized boolean busy(long now){return now<until;}
    synchronized boolean blocksPacket(byte[] bytes,long now){
        if(!busy(now))return false;
        boolean hbp=bytes.length==55&&bytes[0]=='D'&&bytes[1]=='M'&&bytes[2]=='R'&&bytes[3]=='D';
        boolean odtp=bytes.length>=18&&bytes[0]=='R'&&bytes[1]=='E'&&(bytes[10]&1)!=0;
        int kind=hbp?(bytes[15]&0x3f):odtp?((bytes[8]&255)|((bytes[9]&255)<<8)):0;
        // Closing an existing transmission is always allowed; keepalive/subscriptions are not TX.
        return hbp&&kind!=0x22||odtp&&kind!=0x912;
    }
    synchronized void reset(){receiving=false;until=0;stream=0;}
}
