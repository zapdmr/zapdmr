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
    private AudioManager.OnCommunicationDeviceChangedListener communicationListener;
    private PluginCall routeCall;private long routeGeneration;private int routeExpectedInput,routeExpectedOutput;
    private PluginCall voxCall;private long voxCallGeneration;
    private PluginCall tuneCall;private String tuneId;
    private String outputName="",inputName="";private int outputType,inputType;private boolean priorKeepAwake;private float priorBrightness=-1;private boolean maximumBrightness;
    private final Runnable watchdog=new Runnable(){public void run(){if(CarModeState.expired(SystemClock.elapsedRealtime()))releasePointer();if(CarModeState.voxArmed&&!CarModeState.voxLeaseValid(SystemClock.elapsedRealtime()))disableVox("Interface sem resposta; VOX desligado.");if(CarModeState.active)handler.postDelayed(this,250);}};
    private boolean bluetoothAllowed(){return Build.VERSION.SDK_INT<31||ContextCompat.checkSelfPermission(getContext(),Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED;}
    private AudioManager audio(){return (AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);}
    private void command(String action){if(RadioSessionService.running)getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(action));}
    private void disableVox(String reason){if(voxCall!=null){PluginCall pending=voxCall;voxCall=null;pending.reject(reason);}CarModeState.disarmVox();if(RadioSessionService.running)getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_CAR_VOX).putExtra("enabled",false).putExtra("reason",reason));}
    private void releasePointer(){CarModeState.pointer(false,SystemClock.elapsedRealtime());command(RadioSessionService.ACTION_PTT_UP);}
    @Override public void load(){
        android.content.SharedPreferences saved=getContext().getSharedPreferences("zapdmr_car_routes",Context.MODE_PRIVATE);outputName=saved.getString("outputName","");inputName=saved.getString("inputName","");outputType=saved.getInt("outputType",0);inputType=saved.getInt("inputType",0);
        receiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){
            if(RadioSessionService.ACTION_EVENT.equals(intent.getAction())){
                try{JSONObject packet=new JSONObject(intent.getStringExtra(RadioSessionService.EXTRA_DATA));
                    if("carVox".equals(intent.getStringExtra(RadioSessionService.EXTRA_EVENT))&&voxCall!=null&&(packet.optLong("generation",-1)==voxCallGeneration||!packet.optBoolean("armed")&&packet.optLong("generation",-1)==voxCallGeneration+1)){if(!packet.optBoolean("armed")){PluginCall pending=voxCall;voxCall=null;pending.reject(packet.optString("message","VOX não iniciou."));}else if(packet.optBoolean("initialized")&&RadioSessionService.carVoxInitializationConfirmed(voxCallGeneration)){PluginCall pending=voxCall;voxCall=null;pending.resolve(JSObject.fromJSONObject(packet));}}
                    if("carTuneResult".equals(intent.getStringExtra(RadioSessionService.EXTRA_EVENT))&&tuneCall!=null&&Objects.equals(tuneId,packet.optString("requestId"))){PluginCall pending=tuneCall;tuneCall=null;tuneId=null;pending.resolve(JSObject.fromJSONObject(packet));}
                }catch(Exception ignored){}return;
            }
            if(Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())){notifyListeners("power",new JSObject().put("charging",intent.getIntExtra(BatteryManager.EXTRA_PLUGGED,0)!=0));return;}
            if(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(intent.getAction())){CarAudio.legacyScoConnected=intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE,-1)==AudioManager.SCO_AUDIO_STATE_CONNECTED;notifyDevices();return;}
            if(!bluetoothAllowed())return;
            BluetoothDevice device=intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if(device!=null)try{boolean connected=BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction());notifyListeners("bluetooth",new JSObject().put("address",device.getAddress()).put("name",device.getName()).put("connected",connected));if(!connected){if(CarModeState.voxArmed)disableVox("Bluetooth desconectado; VOX suspenso.");if(CarModeState.pointerHeld)releasePointer();}}catch(SecurityException ignored){}
        }};
        IntentFilter filter=new IntentFilter(RadioSessionService.ACTION_EVENT);filter.addAction(Intent.ACTION_BATTERY_CHANGED);filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        ContextCompat.registerReceiver(getContext(),receiver,filter,ContextCompat.RECEIVER_EXPORTED);
        // RadioSessionService events are package-scoped; tune request IDs are random and single-flight.
        deviceCallback=new AudioDeviceCallback(){@Override public void onAudioDevicesAdded(AudioDeviceInfo[] devices){restoreRoute();notifyDevices();}@Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices){if(CarModeState.active){if(CarModeState.voxArmed)disableVox("Dispositivo de áudio removido; VOX suspenso.");releasePointer();command(RadioSessionService.ACTION_PTT_UP);for(AudioDeviceInfo d:devices){if(d.getId()==CarModeState.inputId)CarModeState.inputId=0;if(d.getId()==CarModeState.outputId)CarModeState.outputId=0;}command(RadioSessionService.ACTION_CAR_REFRESH);}notifyDevices();}};
        audio().registerAudioDeviceCallback(deviceCallback,handler);
        if(Build.VERSION.SDK_INT>=31){communicationListener=device->{if(CarModeState.active&&CarAudio.requestedBluetooth(getContext())!=null&&!CarAudio.communicationConfirmed(getContext())){disableVox("Rota Bluetooth alterada; VOX desligado.");releasePointer();}notifyDevices();};audio().addOnCommunicationDeviceChangedListener(getContext().getMainExecutor(),communicationListener);}
    }
    private void restoreRoute(){if(!CarModeState.active)return;if(CarModeState.voxArmed)disableVox("Dispositivos de áudio mudaram; VOX desligado para nova calibração.");int outputs=0,inputs=0,newOutput=0,newInput=0;for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){if(d.isSink()&&d.getType()!=18&&d.getType()!=25&&d.getType()==outputType&&d.getProductName().toString().equals(outputName)){outputs++;newOutput=d.getId();}if(d.isSource()&&CarAudioTypes.microphone(d.getType())&&d.getType()==inputType&&d.getProductName().toString().equals(inputName)){inputs++;newInput=d.getId();}}CarModeState.outputId=outputs==1?newOutput:0;CarModeState.inputId=inputs==1?newInput:0;command(RadioSessionService.ACTION_CAR_REFRESH);final int expectedInput=CarModeState.inputId,expectedOutput=CarModeState.outputId;handler.postDelayed(()->{if(CarModeState.active&&routeCall==null&&CarModeState.inputId==expectedInput&&CarModeState.outputId==expectedOutput&&CarAudio.requestedBluetooth(getContext())!=null&&!CarAudio.communicationConfirmed(getContext()))routeFailed("Reconexão Bluetooth não confirmada; padrão restaurado. Tente novamente nos Ajustes.");},4500);}
    private void notifyDevices(){try{notifyListeners("devices",snapshot());}catch(Exception ignored){}}
    private JSObject snapshot() throws Exception {
        JSArray outputs=new JSArray(),inputs=new JSArray(),paired=new JSArray(),diagnosticDevices=new JSArray(),communication=new JSArray();
        for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){JSObject item=new JSObject().put("id",d.getId()).put("name",d.getProductName().toString()).put("type",d.getType());item.put("typeLabel",CarAudioTypes.label(d.getType())).put("source",d.isSource()).put("sink",d.isSink());diagnosticDevices.put(item);if(d.isSink()&&d.getType()!=25&&d.getType()!=18)outputs.put(item);if(d.isSource()&&CarAudioTypes.microphone(d.getType()))inputs.put(item);}
        if(bluetoothAllowed()){BluetoothManager manager=(BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);BluetoothAdapter adapter=manager==null?null:manager.getAdapter();if(adapter!=null)for(BluetoothDevice device:adapter.getBondedDevices())paired.put(new JSObject().put("address",device.getAddress()).put("name",device.getName()==null?"Bluetooth":device.getName()));}
        if(Build.VERSION.SDK_INT>=31&&bluetoothAllowed())for(AudioDeviceInfo d:audio().getAvailableCommunicationDevices())communication.put(new JSObject().put("id",d.getId()).put("name",CarAudio.describe(d)));
        Intent battery=getContext().registerReceiver(null,new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        return new JSObject().put("charging",battery!=null&&battery.getIntExtra(BatteryManager.EXTRA_PLUGGED,0)!=0).put("diagnostic",CarAudio.diagnostic(getContext())).put("diagnosticDevices",diagnosticDevices).put("communicationDevices",communication).put("outputs",outputs).put("inputs",inputs).put("paired",paired).put("bluetoothPermission",bluetoothAllowed()).put("active",CarModeState.active).put("observedOutput",CarAudio.observedOutput).put("observedInput",CarAudio.observedInput).put("outputId",CarModeState.outputId).put("inputId",CarModeState.inputId).put("voxArmed",CarModeState.voxArmed).put("vadAvailable",WebRtcVad.available());
    }
    @PluginMethod public void devices(PluginCall call){try{call.resolve(snapshot());}catch(Exception error){call.reject("Não foi possível consultar os dispositivos de áudio/Bluetooth.");}}
    @PluginMethod public void setActive(PluginCall call){
        if(RadioSessionService.profileBusy()){call.reject("Encerre a transmissão ou teste antes de trocar de interface.");return;}
        getActivity().runOnUiThread(()->{boolean enable=Boolean.TRUE.equals(call.getBoolean("active",false));
        if(enable&&!CarModeState.active){priorBrightness=getActivity().getWindow().getAttributes().screenBrightness;}
        maximumBrightness=Boolean.TRUE.equals(call.getBoolean("maximumBrightness",false));
        if(enable&&!CarModeState.active)priorKeepAwake=(getActivity().getWindow().getAttributes().flags&android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0;
        CarModeState.txGainPercent=Math.max(0,Math.min(300,call.getInt("txGainPercent",260)));CarModeState.keepScreenOn=Boolean.TRUE.equals(call.getBoolean("keepScreenOn",true));CarModeState.mode(enable);CarModeState.visible=true;if(enable){applyScreen();restoreRoute();}else restoreScreen();handler.removeCallbacks(watchdog);if(CarModeState.active)handler.post(watchdog);command(RadioSessionService.ACTION_CAR_REFRESH);call.resolve(new JSObject().put("active",CarModeState.active));});
    }
    private void restoreScreen(){android.view.WindowManager.LayoutParams attributes=getActivity().getWindow().getAttributes();attributes.screenBrightness=priorBrightness;getActivity().getWindow().setAttributes(attributes);if(priorKeepAwake)getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
    private void applyScreen(){getActivity().runOnUiThread(()->{if(!CarModeState.active||!CarModeState.visible){restoreScreen();return;}if(CarModeState.keepScreenOn)getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);android.view.WindowManager.LayoutParams attributes=getActivity().getWindow().getAttributes();attributes.screenBrightness=maximumBrightness?1f:priorBrightness;getActivity().getWindow().setAttributes(attributes);});}
    @PluginMethod public void txGain(PluginCall call){if(!CarModeState.active||RadioSessionService.profileBusy()){call.reject("Termine a transmissão ou teste antes de ajustar o ganho.");return;}CarModeState.txGainPercent=Math.max(0,Math.min(300,call.getInt("percent",260)));call.resolve(new JSObject().put("percent",CarModeState.txGainPercent));}
    @PluginMethod public void vox(PluginCall call){
        boolean enabled=Boolean.TRUE.equals(call.getBoolean("enabled",false));if(enabled&&!BuildConfig.EXPERIMENTAL_CAR_VOX){disableVox("VOX reservado ao desenvolvimento experimental.");call.reject("VOX indisponível nesta candidata de estabilização.");return;}if(!enabled){disableVox("VOX desligado pelo operador.");call.resolve(new JSObject().put("armed",false));return;}
        boolean diagnostic=Boolean.TRUE.equals(call.getBoolean("diagnostic",false));if(voxCall!=null){call.reject("Aguarde a inicialização do VOX.");return;}
        if(!CarModeState.active||!CarModeState.visible||RadioSessionService.profileBusy()||(!diagnostic&&(RadioSessionService.receptionBusy()||!RadioSessionService.carTargetMatches(CarModeState.confirmedTarget,CarModeState.confirmedSlot)))||!WebRtcVad.available()){call.reject("Confirme a TG, aguarde RX/TX terminar e use uma versão com VAD disponível.");return;}
        if(ContextCompat.checkSelfPermission(getContext(),Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){call.reject("Autorize o microfone para ativar VOX.");return;}
        CarModeState.voxSensitivity=Math.max(0,Math.min(2,call.getInt("sensitivity",1)));CarModeState.voxHangMs=Math.max(400,Math.min(3000,call.getInt("hangMs",1200)));CarModeState.voxDiagnostic=diagnostic;CarModeState.voxEcho=Boolean.TRUE.equals(call.getBoolean("echo",true));CarModeState.voxNoise=Boolean.TRUE.equals(call.getBoolean("noise",true));CarModeState.armVox(SystemClock.elapsedRealtime());voxCall=call;voxCallGeneration=CarModeState.voxGeneration;final long generation=voxCallGeneration;
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_CAR_VOX).putExtra("enabled",true));handler.postDelayed(()->{if(voxCall!=null&&voxCallGeneration==generation)disableVox("O microfone/VAD não confirmou inicialização em 5 segundos. Consulte o diagnóstico.");},5000);
    }
    @PluginMethod public void voxHeartbeat(PluginCall call){if(CarModeState.active&&CarModeState.visible&&CarModeState.voxArmed)CarModeState.voxTick=SystemClock.elapsedRealtime();call.resolve();}
    @PluginMethod public void screenPreference(PluginCall call){CarModeState.keepScreenOn=Boolean.TRUE.equals(call.getBoolean("enabled",true));maximumBrightness=Boolean.TRUE.equals(call.getBoolean("maximumBrightness",false));if(CarModeState.active)applyScreen();call.resolve();}
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
        for(AudioDeviceInfo d:audio().getDevices(AudioManager.GET_DEVICES_ALL)){if(d.isSink()&&d.getId()==output)outOk=true;if(d.isSource()&&CarAudioTypes.microphone(d.getType())&&d.getId()==input)inOk=true;}
        AudioDeviceInfo requestedOut=CarAudio.device(getContext(),output,false),requestedIn=CarAudio.device(getContext(),input,true);
        if(requestedOut!=null&&CarAudioTypes.bluetooth(requestedOut.getType())&&requestedIn!=null&&!CarAudioTypes.bluetooth(requestedIn.getType())){call.reject("HFP/SCO usa entrada e saída em par. Para microfone do celular, escolha saída Padrão do Android/A2DP.");return;}
        if(!outOk||!inOk){call.reject("Dispositivo não disponível. Selecione novamente após reconectar.");return;}
        if(routeCall!=null){call.reject("Aguarde a confirmação de áudio em andamento.");return;}
        if(CarModeState.voxArmed)disableVox("Rota alterada; reative o VOX após testar o microfone.");
        CarModeState.outputId=output;CarModeState.inputId=input;AudioDeviceInfo out=CarAudio.device(getContext(),output,false),in=CarAudio.device(getContext(),input,true);outputName=out==null?"":out.getProductName().toString();outputType=out==null?0:out.getType();inputName=in==null?"":in.getProductName().toString();inputType=in==null?0:in.getType();getContext().getSharedPreferences("zapdmr_car_routes",Context.MODE_PRIVATE).edit().putString("outputName",outputName).putString("inputName",inputName).putInt("outputType",outputType).putInt("inputType",inputType).apply();routeCall=call;routeExpectedInput=input;routeExpectedOutput=output;long generation=++routeGeneration;
        try{CarAudio.configure(getContext());command(RadioSessionService.ACTION_CAR_REFRESH);awaitRoute(generation,android.os.SystemClock.elapsedRealtime()+4000);}catch(Exception error){routeFailed(error.getMessage());}
    }
    private void awaitRoute(long generation,long deadline){if(routeCall==null||routeGeneration!=generation)return;
        if(!CarModeState.active){routeFailed("Modo Carro encerrado.");return;}if(CarModeState.inputId!=routeExpectedInput||CarModeState.outputId!=routeExpectedOutput){routeFailed("Dispositivo removido ou rota alterada antes da confirmação.");return;}
        if(CarAudio.communicationConfirmed(getContext())){PluginCall pending=routeCall;routeCall=null;JSObject result=new JSObject().put("requested",true).put("communicationConfirmed",true).put("message",CarAudio.routeStatus);pending.resolve(result);notifyDevices();return;}
        if(android.os.SystemClock.elapsedRealtime()>=deadline){routeFailed("Android não confirmou HFP/SCO em 4 segundos. RX padrão restaurado; use o microfone do celular ou tente novamente após reconectar.");return;}
        handler.postDelayed(()->awaitRoute(generation,deadline),150);
    }
    private void routeFailed(String reason){CarModeState.inputId=0;CarModeState.outputId=0;try{CarAudio.release(getContext());}catch(Exception ignored){}CarAudio.routeStatus=reason;command(RadioSessionService.ACTION_CAR_REFRESH);PluginCall pending=routeCall;routeCall=null;if(pending!=null)pending.reject(reason);notifyDevices();}
    @PluginMethod public void tone(PluginCall call){
        if(!RadioSessionService.profileBusy()&&!RadioSessionService.receptionBusy()){ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,18);tone.startTone(ToneGenerator.TONE_PROP_BEEP,65);handler.postDelayed(tone::release,120);}call.resolve();
    }
    @Override protected void handleOnPause(){if(CarModeState.voxArmed)disableVox("Aplicativo em segundo plano; reative o VOX ao voltar.");if(CarModeState.pointerHeld)releasePointer();CarModeState.visible=false;if(CarModeState.active)applyScreen();}
    @Override protected void handleOnDestroy(){disableVox("Aplicativo encerrado; VOX desligado.");releasePointer();if(routeCall!=null)routeFailed("Aplicativo encerrado.");if(Build.VERSION.SDK_INT>=31&&communicationListener!=null)audio().removeOnCommunicationDeviceChangedListener(communicationListener);handler.removeCallbacksAndMessages(null);if(receiver!=null)try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}if(deviceCallback!=null)audio().unregisterAudioDeviceCallback(deviceCallback);if(CarModeState.active)restoreScreen();CarModeState.mode(false);command(RadioSessionService.ACTION_CAR_REFRESH);}
}
