package br.radio.zapdmr;

/** Runtime-only car safety overlay. Never rewrites the saved PTT/VOX/TOT preferences. */
final class CarModeState {
    static volatile boolean active, pointerHeld;
    static volatile boolean keepScreenOn=true, visible=true;
    static volatile int txGainPercent=130;
    static volatile long pointerTick;
    static volatile int confirmedTarget, confirmedSlot, outputId, inputId;
    static synchronized void mode(boolean value){active=value;pointerHeld=false;confirmedTarget=0;confirmedSlot=0;}
    static synchronized void invalidate(){confirmedTarget=0;confirmedSlot=0;}
    static boolean allowsTx(int id,int slot){return !active||confirmedTarget==id&&confirmedSlot==slot;}
    static synchronized void pointer(boolean down,long now){pointerHeld=down;pointerTick=now;}
    static boolean expired(long now){return active&&pointerHeld&&now-pointerTick>1600;}
}
