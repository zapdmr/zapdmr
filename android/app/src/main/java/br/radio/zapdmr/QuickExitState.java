package br.radio.zapdmr;

/** Process-local barrier: late radio/accessory commands cannot restart a closed session. */
final class QuickExitState {
    static final String PREFS="zapdmr_lifecycle", RESUME="resume_after_quick_exit";
    private static int state; // 0 open, 1 shutting down, 2 closed
    static synchronized boolean begin(boolean transmitting){if(transmitting||state==1)return false;state=1;return true;}
    static synchronized void cancel(){if(state==1)state=0;}
    static synchronized void complete(){state=2;}
    static synchronized boolean blocked(){return state!=0;}
    static synchronized boolean closing(){return state==1;}
    static synchronized boolean open(){if(state==1)return false;state=0;return true;}
}
