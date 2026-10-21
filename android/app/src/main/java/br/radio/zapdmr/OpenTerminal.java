package br.radio.zapdmr;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** ODTP service 0x21, independently framed from the Homebrew transport. */
final class OpenTerminal {
    interface Transport { void send(byte[] data) throws Exception; }
    interface Listener {
        void authenticated();
        default void call(int source,int destination,boolean individual,long stream,boolean end) {}
        void reception(String state,int target,String message);
        void voice(int source,int destination,boolean individual,byte[][] words) throws Exception;
    }
    private final int id;private String password;private final Transport transport;private final Listener listener;
    private int sequence=0,realtime=0,target=0,privatePeer=0,revision=0,pendingRevision=0,pendingType=-1,pendingId=0;
    private long seen=0,pingAt=0,deadline=0;
    private boolean authSent=false,authenticated=false,stopped=false;
    private long callSerial=0;
    synchronized long stream(){return callSerial;}
    private int source=0,destination=0;private boolean individual=false;
    private String receptionState="disconnected",message="ODTP desligado.";
    OpenTerminal(int id,String password,Transport transport,Listener listener){this.id=id;this.password=password;this.transport=transport;this.listener=listener;}
    static byte[] packet(int type,int sequence,byte[] payload,int flags){
        ByteBuffer out=ByteBuffer.allocate(18+payload.length).order(ByteOrder.LITTLE_ENDIAN);
        out.put("REWIND01".getBytes(StandardCharsets.US_ASCII)).putShort((short)type).putShort((short)flags).putInt(sequence).putShort((short)payload.length).put(payload);return out.array();
    }
    static byte[] header(int destination,int source,boolean individual){byte[] data=new byte[12];data[0]=(byte)(individual?3:0);data[2]=4;put24(data,3,destination);put24(data,6,source);return data;}
    private static int read24(byte[] data,int offset){return ((data[offset]&255)<<16)|((data[offset+1]&255)<<8)|(data[offset+2]&255);}
    private static void put24(byte[] data,int offset,int value){data[offset]=(byte)(value>>>16);data[offset+1]=(byte)(value>>>8);data[offset+2]=(byte)value;}
    private void send(int type,byte[] payload) throws Exception{transport.send(packet(type,sequence++,payload,0));}
    private void status(String state,String text){if(state.equals(receptionState)&&text.equals(message))return;receptionState=state;message=text;listener.reception(state,target,text);}
    synchronized String state(){return receptionState;}
    synchronized String message(){return message;}
    synchronized int target(){return target;}
    synchronized void start(int target) throws Exception{this.target=target;seen=System.currentTimeMillis();status("connecting","Conectando ao servidor ODTP…");keepalive();}
    private void keepalive() throws Exception{byte[] description="ZapDMR 1.4.5".getBytes(StandardCharsets.US_ASCII);ByteBuffer data=ByteBuffer.allocate(5+description.length).order(ByteOrder.LITTLE_ENDIAN);data.putInt(id).put((byte)0x21).put(description);send(0,data.array());pingAt=System.currentTimeMillis();}
    synchronized void select(int target,boolean individual) throws Exception{
        int peer=individual?target:0;if(this.target==target&&privatePeer==peer&&!"error".equals(receptionState)&&!"disconnected".equals(receptionState))return;
        this.target=target;privatePeer=peer;revision++;source=destination=0;
        status(authenticated?"subscribing":"connecting",authenticated?(individual?"ID ":"TG ")+target+" — solicitando inscrição…":"Conectando ao servidor ODTP…");
        if(authenticated&&pendingType<0)cancel();
    }
    private void cancel() throws Exception{source=destination=0;pendingType=0x902;pendingId=0;pendingRevision=revision;deadline=System.currentTimeMillis()+5000;send(0x902,new byte[0]);}
    private void subscribe() throws Exception{
        if(target==0){status("unsubscribed","Inscrição ODTP cancelada.");return;}
        pendingType=0x901;pendingId=privatePeer>0?id:target;pendingRevision=revision;deadline=System.currentTimeMillis()+5000;
        send(0x901,ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(privatePeer>0?5:7).putInt(pendingId).array());
    }
    synchronized void tick() throws Exception{
        if(stopped)return;long now=System.currentTimeMillis();
        if(now-seen>15000)throw new java.io.IOException("Servidor ODTP sem resposta; confira suporte, porta e autenticação.");
        if(now-pingAt>=5000)keepalive();
        if(pendingType>=0&&now>deadline){pendingType=-1;source=destination=0;status("error","Servidor não confirmou a inscrição ODTP.");}
    }
    synchronized void receive(byte[] packet) throws Exception{
        if(stopped||packet.length<18||!"REWIND01".equals(new String(packet,0,8,StandardCharsets.US_ASCII)))return;
        ByteBuffer in=ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN);int type=in.getShort(8)&65535,length=in.getShort(16)&65535;
        if(length!=packet.length-18)return;seen=System.currentTimeMillis();byte[] data=Arrays.copyOfRange(packet,18,packet.length);
        if(type==2){if(data.length!=4)return;authenticated=false;pendingType=-1;source=destination=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");digest.update(data);digest.update(password.getBytes(StandardCharsets.UTF_8));authSent=true;status("authenticating","Validando Hotspot Security Password no ODTP…");send(3,digest.digest());return;}
        if(type==0){if(authSent&&!authenticated){authenticated=true;listener.authenticated();status("subscribing","TG "+target+" — solicitando inscrição…");cancel();}return;}
        if(type==1||type==0x929)throw new java.io.IOException("Servidor ODTP encerrou ou recusou a sessão; confira senha e permissões.");
        if(type==pendingType){boolean identified=false;
            if(data.length>=8){ByteBuffer ack=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);identified=(ack.getInt(0)==5||ack.getInt(0)==7)&&ack.getInt(4)==pendingId;}
            if(pendingId>0&&data.length>0&&!identified)return;
            pendingType=-1;if(pendingRevision!=revision){cancel();return;}
            if(type==0x902)subscribe();else status(identified?"ready":"awaiting-traffic",identified?"TG "+target+" — inscrição confirmada pelo servidor.":"TG "+target+" — inscrição respondida; aguardando áudio para confirmar o destino.");return;
        }
        if(!authenticated)return;
        if(type==0x911){if(data.length>=9){callSerial++;individual=(data[0]&63)==3;destination=read24(data,3);source=read24(data,6);listener.call(source,destination,individual,callSerial,false);}return;}
        if(type==0x912){listener.call(source,destination,individual,callSerial,true);source=destination=0;return;}
        if(type==0x928){if(data.length<12)return;ByteBuffer header=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);int session=header.getInt();int src=header.getInt(),dst=header.getInt();if((session!=5&&session!=7)||src<1||src>0xffffff||dst<1||dst>0xffffff)return;callSerial++;individual=session==5;source=src;destination=dst;listener.call(source,destination,individual,callSerial,false);return;}
        if(type==0x920&&data.length==27&&source>0&&pendingType<0){
            boolean matches=privatePeer>0?individual&&source==privatePeer&&destination==id:!individual&&destination==target;
            if(!matches)return;status("receiving","TG "+target+" — áudio recebido pela conexão ODTP.");
            listener.voice(source,destination,individual,new byte[][]{Arrays.copyOfRange(data,0,9),Arrays.copyOfRange(data,9,18),Arrays.copyOfRange(data,18,27)});
        }
    }
    synchronized void transmit(int type,byte[] payload) throws Exception{if(!authenticated||stopped)throw new java.io.IOException("ODTP não autenticado.");transport.send(packet(type,realtime++,payload,1));}
    synchronized void close(){try{if(!stopped){if(authenticated)send(0x902,new byte[0]);send(1,new byte[0]);}}catch(Exception ignored){}finally{stopped=true;authenticated=false;password="";source=destination=0;pendingType=-1;}}
}
