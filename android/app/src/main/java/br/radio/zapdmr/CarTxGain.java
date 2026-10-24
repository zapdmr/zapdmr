package br.radio.zapdmr;

/** Car-only microphone gain with a soft knee before the AMBE encoder. No RX processing. */
final class CarTxGain {
    static short apply(short input,int percent,boolean car){
        if(!car){int value=input*Math.max(0,Math.min(260,percent))/100;return (short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,value));}
        double value=input*Math.max(0,Math.min(260,percent))/100.0;
        if(car){double magnitude=Math.abs(value);if(magnitude>28000)value=Math.copySign(28000+4500*Math.tanh((magnitude-28000)/4500),value);}
        return (short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,Math.round(value)));
    }
}
