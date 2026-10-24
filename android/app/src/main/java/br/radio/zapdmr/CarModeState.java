package br.radio.zapdmr;

/** Runtime-only car safety overlay. Never rewrites the saved PTT/VOX/TOT preferences. */
final class CarModeState {
    static volatile boolean active, pointerHeld;
    static volatile boolean keepScreenOn=true, visible=true;
    static volatile int txGainPercent=260;
    static volatile boolean voxArmed;static volatile int voxSensitivity=1,voxHangMs=1200;static volatile long voxTick,voxGeneration;
    static synchronized void armVox(long now){voxGeneration++;voxTick=now;voxArmed=true;}
    static synchronized void disarmVox(){voxArmed=false;voxGeneration++;}
    static synchronized boolean disarmVox(long expected){if(voxGeneration!=expected)return false;disarmVox();return true;}
    static boolean voxLeaseValid(long now){return now-voxTick<=1800;}
    static volatile long pointerTick;
    static volatile int confirmedTarget, confirmedSlot, outputId, inputId;
    static synchronized void mode(boolean value){disarmVox();active=value;pointerHeld=false;confirmedTarget=0;confirmedSlot=0;}
    static synchronized void invalidate(){disarmVox();confirmedTarget=0;confirmedSlot=0;}
    static boolean allowsTx(int id,int slot){return !active||confirmedTarget==id&&confirmedSlot==slot;}
    static synchronized void pointer(boolean down,long now){pointerHeld=down;pointerTick=now;}
    static boolean expired(long now){return active&&pointerHeld&&now-pointerTick>1600;}
}
