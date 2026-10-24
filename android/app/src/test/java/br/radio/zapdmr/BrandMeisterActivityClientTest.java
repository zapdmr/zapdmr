package br.radio.zapdmr;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class BrandMeisterActivityClientTest {
    @Test public void decodesNestedMqttPayloadAndCaller() throws Exception {
        JSONObject call = new JSONObject().put("DestinationID",72422).put("SourceID",7246584)
            .put("SourceCall","PU5RZS").put("SourceName","Cesar").put("Event","Session-Start");
        JSONObject envelope = new JSONObject().put("topic","LH").put("payload",call.toString());
        JSONObject result = BrandMeisterActivityClient.decode(envelope.toString(),null,0);
        assertEquals(72422,result.getInt("talkgroupId"));
        assertEquals("PU5RZS",result.getString("lastCallerCallsign"));
        assertEquals("Session-Start",result.getString("event"));
    }
    @Test public void decodesDoubleEncodedStringAndVoiceTopic() throws Exception {
        JSONObject call = new JSONObject().put("SourceCall","PU2TEST").put("Stop",true);
        JSONObject envelope = new JSONObject().put("topic","DMR/Voice/724907").put("payload",JSONObject.quote(call.toString()));
        JSONObject result=BrandMeisterActivityClient.decode(envelope,null,0);
        assertEquals(724907,result.getInt("talkgroupId"));
        assertEquals("Session-Stop",result.getString("event"));
    }
    @Test public void rejectsPrivateAndUnrelatedRecords() throws Exception {
        assertNull(BrandMeisterActivityClient.decode(new JSONObject().put("DestinationID",91).put("Type","Private").put("SourceID",123),null,0));
        assertNull(BrandMeisterActivityClient.decode(new JSONObject().put("topic","Location").put("data","not json"),null,0));
    }
}
