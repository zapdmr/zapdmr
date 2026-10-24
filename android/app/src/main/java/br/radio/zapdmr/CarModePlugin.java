package br.radio.zapdmr;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import android.bluetooth.*;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;
import java.util.*;

/** Device discovery and safety control only; the existing RadioSessionService owns all radio/audio. */
@CapacitorPlugin(name="ZapCarMode")
public final class CarModePlugin extends Plugin {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private BroadcastReceiver receiver;private AudioDeviceCallback deviceCallback;
    private PluginCall tuneCall;private String tuneId;
    private String outputName="",inputName="";private int outputType,inputType;private boolean priorKeepAwake;
    private final Runnable watchdog=new Runnable(){public void run(){if(CarModeState.expired(SystemClock.elapsedRealtime()))releasePointer();if(CarModeState.active)handler.postDelayed(this,250);}};
    private boolean bluetoothAllowed(){return Build.VERSION.SDK_INT<31||ContextCompat.checkSelfPermission(getContext(),Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED;}
    private AudioManager audio(){return (AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);}
    private void command(String action){if(RadioSessionService.running)getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(action));}
    private void releasePointer(){CarModeState.pointer(false,SystemClock.elapsedRealtime());command(RadioSessionService.ACTION_PTT_UP);}
    @Override public void load(){
        android.content.SharedPreferences saved=getContext().getSharedPreferences("zapdmr_car_routes",Context.MODE_PRIVATE);outputName=saved.getString("outputName","");inputName=saved.getString("inputName","");outputType=saved.getInt("outputType",0);inputType=saved.getInt("inputType",0);
        receiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){
            if(RadioSessionService.ACTION_EVENT.equals(intent.getAction())){
                try{JSONObject packet=new JSONObject(intent.getStringExtra(RadioSessionService.EXTRA_DATA));
                    if("carTuneResult".equals(intent.getStringExtra(RadioSessionService.EXTRA_EVENT))&&tuneCall!=null&&Objects.equals(tuneId,packet.optString("requestId"))){PluginCall pending=tuneCall;tuneCall=null;tuneId=null;pending.resolve(JSObject.fromJSONObject(packet));}
                }catch(Exception ignored){}return;
            }
            if(!bluetoothAllowed())return;
            BluetoothDevice device=intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if(device!=null)try{boolean connected=BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction());notifyListeners("bluetooth",new JSObject().put("address",device.getAddress()).put("name",device.getName()).put("connected",connected));if(!connected&&CarModeState.pointerHeld)releasePointer();}catch(SecurityException ignored){}
        }};
        IntentFilter filter=new IntentFilter(RadioSessionService.ACTION_EVENT);filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        ContextCompat.registerReceiver(getContext(),receiver,filter,ContextCompat.RECEIVER_EXPORTED);
        // RadioSessionService events are package-scoped; tune request IDs are random and single-flight.
        deviceCallback=new AudioDeviceCallback(){@Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices){restoreRoute();notifyDevices();}@Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices){if(CarModeState.active){releasePointer();command(RadioSessionService.ACTION_PTT_UP);}notifyDevices();}};
        audio().registerAudioDeviceCallback(deviceCallback,handler);
    }
    private void restoreRoute(){if(!CarModeState.active)return;int outputs=0,inputs=0,newOutput=0,newInput=0;for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){if(d.isSink()&&d.getType()==outputType&&d.getProductName().toString().equals(outputName)){outputs++;newOutput=d.getId();}if(d.isSource()&&d.getType()==inputType&&d.getProductName().toString().equals(inputName)){inputs++;newInput=d.getId();}}if(outputs==1)CarModeState.outputId=newOutput;if(inputs==1)CarModeState.inputId=newInput;command(RadioSessionService.ACTION_CAR_REFRESH);}
    private void notifyDevices(){try{notifyListeners("devices",snapshot());}catch(Exception ignored){}}
    private JSObject snapshot() throws Exception {
        JSArray outputs=new JSArray(),inputs=new JSArray(),paired=new JSArray();
        for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){JSObject item=new JSObject().put("id",d.getId()).put("name",d.getProductName().toString()).put("type",d.getType());if(d.isSink())outputs.put(item);if(d.isSource())inputs.put(item);}
        if(bluetoothAllowed()){BluetoothManager manager=(BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);BluetoothAdapter adapter=manager==null?null:manager.getAdapter();if(adapter!=null)for(BluetoothDevice device:adapter.getBondedDevices())paired.put(new JSObject().put("address",device.getAddress()).put("name",device.getName()==null?"Bluetooth":device.getName()));}
        return new JSObject().put("outputs",outputs).put("inputs",inputs).put("paired",paired).put("bluetoothPermission",bluetoothAllowed()).put("active",CarModeState.active).put("observedOutput",CarAudio.observedOutput).put("observedInput",CarAudio.observedInput).put("outputId",CarModeState.outputId).put("inputId",CarModeState.inputId);
    }
    @PluginMethod public void devices(PluginCall call){try{call.resolve(snapshot());}catch(Exception error){call.reject("Não foi possível consultar os dispositivos de áudio/Bluetooth.");}}
    @PluginMethod public void setActive(PluginCall call){
        if(RadioSessionService.profileBusy()){call.reject("Encerre a transmissão ou teste antes de trocar de interface.");return;}
        getActivity().runOnUiThread(()->{boolean enable=Boolean.TRUE.equals(call.getBoolean("active",false));
        if(enable&&!CarModeState.active)priorKeepAwake=(getActivity().getWindow().getAttributes().flags&android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
        CarModeState.keepScreenOn=Boolean.TRUE.equals(call.getBoolean("keepScreenOn",true));CarModeState.mode(enable);CarModeState.visible=true;if(enable){applyScreen();restoreRoute();}else if(!priorKeepAwake)getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);handler.removeCallbacks(watchdog);if(CarModeState.active)handler.post(watchdog);command(RadioSessionService.ACTION_CAR_REFRESH);call.resolve(new JSObject().put("active",CarModeState.active));});
    }
    private void applyScreen(){getActivity().runOnUiThread(()->{if(CarModeState.active&&CarModeState.visible&&CarModeState.keepScreenOn)getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);});}
    @PluginMethod public void screenPreference(PluginCall call){CarModeState.keepScreenOn=Boolean.TRUE.equals(call.getBoolean("enabled",true));if(CarModeState.active)applyScreen();call.resolve();}
    @Override protected void handleOnResume(){CarModeState.visible=true;if(CarModeState.active)applyScreen();}
    @PluginMethod public void confirmTarget(PluginCall call){
        int id=call.getInt("talkgroupId",0),slot=call.getInt("slot",1);
        if(!CarModeState.active||id<1||id>0xffffff||slot<1||slot>2||!RadioSessionService.carTargetMatches(id,slot)){call.reject("Destino inválido.");return;}
        CarModeState.confirmedTarget=id;CarModeState.confirmedSlot=slot;call.resolve();
    }
    @PluginMethod public void invalidateTarget(PluginCall call){CarModeState.invalidate();call.resolve();}
    @PluginMethod public void pointer(PluginCall call){
        boolean down=Boolean.TRUE.equals(call.getBoolean("down",false));
        if(down&&!CarModeState.active){call.reject("Modo carro desativado.");return;}
        CarModeState.pointer(down,SystemClock.elapsedRealtime());if(!down)command(RadioSessionService.ACTION_PTT_UP);call.resolve();
    }
    @PluginMethod public void pttDown(PluginCall call){
        int tg=call.getInt("talkgroupId",0),slot=call.getInt("slot",1);
        if(!CarModeState.active||!CarModeState.pointerHeld||!CarModeState.allowsTx(tg,slot)||!RadioSessionService.running){call.reject("Confirme o destino e mantenha o PTT pressionado.");return;}
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_PTT_DOWN).putExtra("talkgroupId",tg).putExtra("slot",slot).putExtra("carPointer",true));call.resolve();
    }
    @PluginMethod public void tune(PluginCall call){
        if(!CarModeState.active||!RadioSessionService.running){call.reject("Ligue uma sessão DMR ODTP antes de iniciar o scan.");return;}
        if(tuneCall!=null){call.reject("Aguarde a inscrição em andamento.");return;}
        CarModeState.invalidate();tuneCall=call;tuneId=UUID.randomUUID().toString();final String request=tuneId;
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_TUNE).putExtra("talkgroupId",call.getInt("talkgroupId",0)).putExtra("slot",call.getInt("slot",1)).putExtra("carRequestId",request));
        handler.postDelayed(()->{if(Objects.equals(request,tuneId)&&tuneCall!=null){PluginCall pending=tuneCall;tuneCall=null;tuneId=null;pending.reject("O serviço de rádio não respondeu à seleção.");}},5000);
    }
    @PluginMethod public void route(PluginCall call){
        if(!CarModeState.active||RadioSessionService.profileBusy()||RadioSessionService.receptionBusy()){call.reject("Aguarde o fim do RX/TX antes de mudar o áudio.");return;}
        int output=call.getInt("outputId",0),input=call.getInt("inputId",0);boolean outOk=output==0,inOk=input==0;
        for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){if(d.isSink()&&d.getId()==output)outOk=true;if(d.isSource()&&d.getId()==input)inOk=true;}
        if(!outOk||!inOk){call.reject("Dispositivo não disponível. Selecione novamente após reconectar.");return;}
        CarModeState.outputId=output;CarModeState.inputId=input;AudioDeviceInfo out=CarAudio.device(getContext(),output,false),in=CarAudio.device(getContext(),input,true);outputName=out==null?"":out.getProductName().toString();outputType=out==null?0:out.getType();inputName=in==null?"":in.getProductName().toString();inputType=in==null?0:in.getType();getContext().getSharedPreferences("zapdmr_car_routes",Context.MODE_PRIVATE).edit().putString("outputName",outputName).putString("inputName",inputName).putInt("outputType",outputType).putInt("inputType",inputType).apply();command(RadioSessionService.ACTION_CAR_REFRESH);call.resolve(new JSObject().put("requested",true));
    }
    @PluginMethod public void tone(PluginCall call){
        if(!RadioSessionService.profileBusy()&&!RadioSessionService.receptionBusy()){ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,18);tone.startTone(ToneGenerator.TONE_PROP_BEEP,65);handler.postDelayed(tone::release,120);}call.resolve();
    }
    @Override protected void handleOnPause(){if(CarModeState.pointerHeld)releasePointer();CarModeState.visible=false;if(CarModeState.active)applyScreen();}
    @Override protected void handleOnDestroy(){releasePointer();handler.removeCallbacksAndMessages(null);if(receiver!=null)try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}if(deviceCallback!=null)audio().unregisterAudioDeviceCallback(deviceCallback);CarModeState.mode(false);command(RadioSessionService.ACTION_CAR_REFRESH);}
}
