package br.radio.zapdmr;

public final class ReceiveGuardTest {
    static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    public static void main(String[] args) throws Exception {
        ReceiveGuard guard=new ReceiveGuard();
        check(!guard.busy(1000),"Initially free");guard.voice(1,1000);
        for(String source:new String[]{"screen","physical","Bluetooth","SPP","VOX"})check(guard.busy(1100),source+" denied by same interlock");
        for(int type:new int[]{0x911,0x920})check(guard.blocksPacket(OpenTerminal.packet(type,0,new byte[12],1),1100),"ODTP header/audio blocked at UDP boundary");
        check(!guard.blocksPacket(OpenTerminal.packet(0x912,0,new byte[12],1),1100),"ODTP terminator always allowed");
        check(!guard.blocksPacket(OpenTerminal.packet(0x901,0,new byte[8],0),1100),"ODTP subscription is not PTT");
        byte[] hbp=new byte[55];System.arraycopy(new byte[]{'D','M','R','D'},0,hbp,0,4);
        for(int flags:new int[]{0x21,0x10,0,1,2,3,4,5}){hbp[15]=(byte)flags;check(guard.blocksPacket(hbp,1100),"HBP header/audio blocked");}
        hbp[15]=0x22;check(!guard.blocksPacket(hbp,1100),"HBP terminator always allowed");
        guard.end(1,1300);check(guard.busy(1799),"Protection lasts 500ms");check(!guard.busy(1800),"Unlock at 500ms");
        guard.voice(2,1900);guard.end(2,2000);guard.voice(3,2490);guard.end(2,2500);
        check(guard.busy(3000),"New call during protection remains blocked; stale end ignored");
        guard.end(3,3100);check(!guard.busy(3600),"New call end releases");
        guard.voice(4,4000);check(guard.busy(5699)&&!guard.busy(5700),"Lost terminator expires after packet watchdog plus protection");
        guard.voice(5,6000);guard.reset();check(!guard.busy(6001),"TG switch/disconnect reset");
        guard.configure(1000);guard.voice(6,7000);guard.end(6,7100);check(guard.busy(8099)&&!guard.busy(8100),"Configurable protection");
        guard.configure(500);guard.reset();
        java.util.concurrent.CountDownLatch locked=new java.util.concurrent.CountDownLatch(1),go=new java.util.concurrent.CountDownLatch(1);
        Thread rx=new Thread(()->{synchronized(guard){guard.voice(7,9000);locked.countDown();try{go.await();}catch(InterruptedException e){throw new RuntimeException(e);}}});
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        rx.start();locked.await();Thread tx=new Thread(()->{synchronized(guard){check(guard.busy(9001),"Final UDP boundary sees concurrent RX");}});tx.setUncaughtExceptionHandler((thread,error)->failure.set(error));tx.start();go.countDown();rx.join();tx.join();check(failure.get()==null,"Concurrent guard assertion");
        System.out.println("PASS local RX guard: all command sources, end +500ms, renewed RX, lost terminator, reset, configuration and concurrent send boundary.");
    }
}
