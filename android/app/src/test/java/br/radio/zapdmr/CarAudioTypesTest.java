package br.radio.zapdmr;
import org.junit.Test;
import static org.junit.Assert.*;
public class CarAudioTypesTest {
 @Test public void reportedAndroidTypesAreDistinct(){assertTrue(CarAudioTypes.bluetooth(7));assertTrue(CarAudioTypes.microphone(15));assertFalse(CarAudioTypes.microphone(18));assertFalse(CarAudioTypes.microphone(25));assertTrue(CarAudioTypes.label(18).contains("Telefonia"));assertTrue(CarAudioTypes.label(25).contains("virtual"));}
 @Test public void a2dpCannotBeSelectedAsMicrophone(){assertFalse(CarAudioTypes.bluetooth(8));assertFalse(CarAudioTypes.microphone(8));}
 @Test public void supportedPhysicalInputs(){for(int type:new int[]{3,7,11,12,15,22,26})assertTrue(CarAudioTypes.microphone(type));}
 @Test public void unknownInterfacesFailClosed(){for(int type:new int[]{0,1,2,18,25,999})assertFalse(CarAudioTypes.microphone(type));}
}
