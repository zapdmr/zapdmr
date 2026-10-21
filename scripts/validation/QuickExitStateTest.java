package br.radio.zapdmr;
public final class QuickExitStateTest {
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    public static void main(String[] args) throws Exception{
        check(QuickExitState.open(),"Initial launch");
        check(!QuickExitState.begin(true)&&!QuickExitState.blocked(),"TX refuses exit without changing lifecycle");
        check(QuickExitState.begin(false),"RX/idle may exit");
        check(QuickExitState.blocked()&&QuickExitState.closing(),"Late connection/accessory commands blocked");
        check(!QuickExitState.begin(false),"Duplicate exit refused");
        Thread relaunch=new Thread(()->check(!QuickExitState.open(),"No reopen during cleanup"));
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        relaunch.setUncaughtExceptionHandler((t,e)->failure.set(e));relaunch.start();relaunch.join();check(failure.get()==null,"Concurrent launch");
        QuickExitState.complete();check(QuickExitState.blocked()&&!QuickExitState.closing(),"Stay disconnected after service stops");
        check(QuickExitState.open()&&!QuickExitState.blocked(),"Fresh launch permits reconnect");
        check(QuickExitState.begin(false),"Second exit");QuickExitState.cancel();check(!QuickExitState.blocked(),"Storage failure may cancel before cleanup");
        System.out.println("PASS quick-exit lifecycle: TX refusal, RX/idle exit, duplicates, concurrent reopen, closed barrier and fresh launch.");
    }
}
