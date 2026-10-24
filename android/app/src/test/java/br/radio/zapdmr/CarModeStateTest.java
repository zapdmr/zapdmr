package br.radio.zapdmr;
import org.junit.Test;
import static org.junit.Assert.*;
public class CarModeStateTest {
 @Test public void explicitDestinationAndRuntimeReset(){CarModeState.mode(true);assertFalse(CarModeState.allowsTx(724,1));CarModeState.confirmedTarget=724;CarModeState.confirmedSlot=1;assertTrue(CarModeState.allowsTx(724,1));assertFalse(CarModeState.allowsTx(72444,1));assertFalse(CarModeState.allowsTx(724,2));CarModeState.invalidate();assertFalse(CarModeState.allowsTx(724,1));CarModeState.mode(false);assertTrue(CarModeState.allowsTx(72444,2));}
 @Test public void pointerLeaseCannotStick(){CarModeState.mode(true);CarModeState.pointer(true,1000);assertFalse(CarModeState.expired(2600));assertTrue(CarModeState.expired(2601));CarModeState.pointer(false,2700);assertFalse(CarModeState.expired(9000));CarModeState.mode(false);}
}
