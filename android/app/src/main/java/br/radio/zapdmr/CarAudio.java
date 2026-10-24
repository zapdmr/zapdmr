package br.radio.zapdmr;

import android.content.*;
import android.media.*;
import android.os.Build;
import org.json.JSONObject;

/** Preferred routes on the existing recorder/player, never a second audio engine. */
final class CarAudio {
    private static Integer previousMode;private static AudioDeviceInfo previousCommunication;
    static AudioDeviceInfo device(Context context,int id,boolean input){
        AudioManager manager=(AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
        for(AudioDeviceInfo d:manager.getDevices(input?AudioManager.GET_DEVICES_INPUTS:AudioManager.GET_DEVICES_OUTPUTS))if(d.getId()==id)return d;return null;
    }
    static boolean configure(Context context){
        AudioManager audio=(AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
        if(!CarModeState.active){if(previousMode!=null){if(Build.VERSION.SDK_INT>=31){if(previousCommunication!=null)audio.setCommunicationDevice(previousCommunication);else audio.clearCommunicationDevice();}audio.setMode(previousMode);previousMode=null;previousCommunication=null;}return false;}
        if(CarModeState.outputId==0&&CarModeState.inputId==0){if(previousMode!=null){if(Build.VERSION.SDK_INT>=31){if(previousCommunication!=null)audio.setCommunicationDevice(previousCommunication);else audio.clearCommunicationDevice();}audio.setMode(previousMode);previousMode=null;previousCommunication=null;}return audio.getMode()==AudioManager.MODE_IN_COMMUNICATION;}
        if(previousMode==null){previousMode=audio.getMode();if(Build.VERSION.SDK_INT>=31)previousCommunication=audio.getCommunicationDevice();}
        AudioDeviceInfo d=device(context,CarModeState.outputId,false);
        boolean communication=d!=null&&(d.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_SCO||Build.VERSION.SDK_INT>=31&&d.getType()==AudioDeviceInfo.TYPE_BLE_HEADSET);
        if(communication){audio.setMode(AudioManager.MODE_IN_COMMUNICATION);if(Build.VERSION.SDK_INT>=31){if(!audio.setCommunicationDevice(d))throw new IllegalStateException("O Android recusou esta rota de comunicação.");}else{audio.startBluetoothSco();audio.setBluetoothScoOn(true);}}
        else{if(Build.VERSION.SDK_INT>=31)audio.clearCommunicationDevice();else{audio.stopBluetoothSco();audio.setBluetoothScoOn(false);}audio.setMode(AudioManager.MODE_NORMAL);}
        return communication;
    }
    static void output(Context context,AudioTrack track){if(CarModeState.active){AudioDeviceInfo d=device(context,CarModeState.outputId,false);if(d!=null&&!track.setPreferredDevice(d))throw new IllegalStateException("A saída de áudio selecionada não foi aceita.");track.addOnRoutingChangedListener(router->report(context,((AudioTrack)router).getRoutedDevice(),"output"),null);}}
    static void input(Context context,AudioRecord record){if(CarModeState.active){AudioDeviceInfo d=device(context,CarModeState.inputId,true);if(d!=null&&!record.setPreferredDevice(d))throw new IllegalStateException("O microfone selecionado não foi aceito.");record.addOnRoutingChangedListener(router->report(context,((AudioRecord)router).getRoutedDevice(),"input"),null);}}
    private static void report(Context context,AudioDeviceInfo device,String direction){try{JSONObject data=new JSONObject().put("direction",direction).put("confirmed",device!=null).put("id",device==null?0:device.getId()).put("name",device==null?"Rota aguardando confirmação":device.getProductName().toString());context.sendBroadcast(new Intent(RadioSessionService.ACTION_EVENT).setPackage(context.getPackageName()).putExtra(RadioSessionService.EXTRA_EVENT,"carAudio").putExtra(RadioSessionService.EXTRA_DATA,data.toString()));}catch(Exception ignored){}}
}
