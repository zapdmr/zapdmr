package br.radio.zapdmr;
import org.junit.Test;
import static org.junit.Assert.*;
public class CarTxGainTest {
 @Test public void lowVoiceGetsRequestedBoost(){assertEquals(1300,CarTxGain.apply((short)1000,130,true));assertEquals(-1300,CarTxGain.apply((short)-1000,130,true));assertEquals(0,CarTxGain.apply((short)1000,0,true));}
 @Test public void loudPeaksStayBelowDigitalClipping(){for(int input=-32768;input<=32767;input+=71){int result=CarTxGain.apply((short)input,260,true);assertTrue(Math.abs(result)<=32500);if(input>-32768)assertEquals(-result,CarTxGain.apply((short)-input,260,true),1);}}
 @Test public void normalModeKeepsExistingIntegerGain(){for(int input=-32768;input<=32767;input+=53){int expected=Math.max(-32768,Math.min(32767,input*130/100));assertEquals(expected,CarTxGain.apply((short)input,130,false));}}
}
