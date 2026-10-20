package br.radio.zapdmr;
import java.util.*;
import java.nio.*;
import java.security.*;

public class OpenTerminalTest {
    static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
    static int type(byte[] packet){return ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN).getShort(8)&65535;}
    static byte[] body(byte[] packet){return Arrays.copyOfRange(packet,18,packet.length);}
    static byte[] subscription(int id){return ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(7).putInt(id).array();}
    public static void main(String[] args) throws Exception {
        List<byte[]> sent=new ArrayList<>();List<Integer> voices=new ArrayList<>();List<String> states=new ArrayList<>();
        OpenTerminal client=new OpenTerminal(1234567,"fixture",sent::add,new OpenTerminal.Listener(){
            public void authenticated(){states.add("authenticated");}
            public void reception(String state,int target,String message){states.add(state);}
            public void voice(int source,int destination,boolean privateCall,byte[][] words){check(words.length==3&&words[0].length==9,"AMBE FEC words");voices.add(destination);}
        });
        byte[] empty=new byte[0],challenge={1,2,3,4};
        client.start(91);check(type(sent.get(0))==0&&sent.get(0)[22]==0x21,"ODTP service 0x21");
        client.receive(OpenTerminal.packet(0,0,empty,0));check(!states.contains("authenticated"),"Unsolicited keepalive cannot authenticate");
        client.receive(OpenTerminal.packet(2,1,challenge,0));check(type(sent.get(1))==3,"Challenge response");
        MessageDigest hash=MessageDigest.getInstance("SHA-256");hash.update(challenge);hash.update("fixture".getBytes("UTF-8"));check(Arrays.equals(body(sent.get(1)),hash.digest()),"Password digest");
        client.receive(OpenTerminal.packet(0,2,empty,0));check(type(sent.get(2))==0x902,"Cancel previous subscriptions");
        client.receive(OpenTerminal.packet(0x902,3,empty,0));check(type(sent.get(3))==0x901,"Subscribe TG");
        client.receive(OpenTerminal.packet(0x901,4,subscription(91),0));check(client.state().equals("ready"),"Identified ACK");
        client.receive(OpenTerminal.packet(0x911,5,OpenTerminal.header(91,2345678,false),1));client.receive(OpenTerminal.packet(0x920,6,new byte[27],1));check(voices.equals(Arrays.asList(91)),"RX before PTT");
        client.select(7244,false);client.select(91,false);client.select(72426,false);
        client.receive(OpenTerminal.packet(0x902,7,empty,0));check(type(sent.get(sent.size()-1))==0x902,"Discard stale cancellation and reconcile current choice");
        client.receive(OpenTerminal.packet(0x902,8,empty,0));check(ByteBuffer.wrap(body(sent.get(sent.size()-1))).order(ByteOrder.LITTLE_ENDIAN).getInt(4)==72426,"Latest target wins");
        client.receive(OpenTerminal.packet(0x901,9,subscription(72426),0));
        client.receive(OpenTerminal.packet(0x911,10,OpenTerminal.header(91,2345678,false),1));client.receive(OpenTerminal.packet(0x920,11,new byte[27],1));check(voices.size()==1,"Reject old TG");
        client.receive(OpenTerminal.packet(0x911,12,OpenTerminal.header(72426,2345678,false),1));client.receive(OpenTerminal.packet(0x920,13,new byte[27],1));check(voices.equals(Arrays.asList(91,72426)),"RX on new TG");
        check(sent.stream().noneMatch(p->type(p)==0x911||type(p)==0x920||type(p)==0x912),"Never simulate PTT");
        client.transmit(0x911,OpenTerminal.header(72426,1234567,false));client.transmit(0x920,new byte[27]);client.transmit(0x912,OpenTerminal.header(72426,1234567,false));
        client.select(915,false);client.receive(OpenTerminal.packet(0x902,14,empty,0));client.receive(OpenTerminal.packet(0x901,15,empty,0));check(client.state().equals("awaiting-traffic"),"Empty ACK does not falsely confirm TG");
        client.select(91,false);java.lang.reflect.Field deadline=OpenTerminal.class.getDeclaredField("deadline");deadline.setAccessible(true);deadline.setLong(client,System.currentTimeMillis()-1);client.tick();check(client.state().equals("error"),"Missing ACK fails visibly");
        client.close();check(type(sent.get(sent.size()-1))==1,"ODTP close, not HBP/TG4000");
        System.out.println("PASS Android ODTP core: handshake, exact ACK, empty ACK, RX before PTT, rapid selection, old TG rejected, explicit TX only, timeout and close (pure JVM, no device audio).");
    }
}
