package br.radio.zapdmr;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public boolean dispatchKeyEvent(android.view.KeyEvent event){
        try{
            org.json.JSONObject options=new org.json.JSONObject(getSharedPreferences("zapdmr_controls",MODE_PRIVATE).getString("operation","{}"));
            String key=options.optString("hardwareKey","F9");
            int code=event.getKeyCode();
            boolean media=code==android.view.KeyEvent.KEYCODE_HEADSETHOOK||code==android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            boolean matches=(key.equals("VolumeUp")&&code==android.view.KeyEvent.KEYCODE_VOLUME_UP)||(key.equals("VolumeDown")&&code==android.view.KeyEvent.KEYCODE_VOLUME_DOWN)||(key.equals("F9")&&code==android.view.KeyEvent.KEYCODE_F9);
            if(RadioSessionService.running&&(matches||(media&&options.optBoolean("bluetoothPtt")))){
                String mode=options.optString("pttMode","hold");
                if(event.getRepeatCount()==0&&(event.getAction()==android.view.KeyEvent.ACTION_DOWN||mode.equals("hold"))){
                    String action=mode.equals("toggle")?RadioSessionService.ACTION_PTT_TOGGLE:event.getAction()==android.view.KeyEvent.ACTION_DOWN?RadioSessionService.ACTION_PTT_DOWN:RadioSessionService.ACTION_PTT_UP;
                    startService(new android.content.Intent(this,RadioSessionService.class).setAction(action));
                }
                return true;
            }
        }catch(Exception ignored){}
        return super.dispatchKeyEvent(event);
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileAudioPlugin.class);
        registerPlugin(AprsPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        super.onCreate(savedInstanceState);
        android.webkit.WebView webView=getBridge().getWebView();
        String agent=webView.getSettings().getUserAgentString();
        if(!agent.contains("ZapDMR/"))webView.getSettings().setUserAgentString(agent+" ZapDMR/1.4.0");
    }
}
