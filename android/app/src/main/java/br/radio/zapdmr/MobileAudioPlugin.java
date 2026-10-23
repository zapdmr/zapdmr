package br.radio.zapdmr;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.activity.result.ActivityResult;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Capacitor bridge to the native Android radio service and private firmware storage. */
@CapacitorPlugin(name="MobileAudio", permissions={@Permission(alias="microphone", strings={Manifest.permission.RECORD_AUDIO}),@Permission(alias="bluetooth", strings={Manifest.permission.BLUETOOTH_CONNECT}),@Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})})
public final class MobileAudioPlugin extends Plugin {
    private static final String KEY_ALIAS = "ZapDMR.MobileAudio.Key.v1";
    private static final String PREFS = "zapdmr_mobile_secure";
    private static final String CONFIG_KEY = "radio_config";
    private BroadcastReceiver receiver;
    private PluginCall pendingExit;
    private String exitRequest;
    private PluginCall pendingPttCall;
    private PluginCall pendingAudioTest;
    private String firmwareTarget = "";
    private BrandMeisterActivityClient activityClient;
    private DmrDirectory directory;
    private final java.util.concurrent.ExecutorService databaseWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService firmwareWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean downloading=new java.util.concurrent.atomic.AtomicBoolean();

    @Override public void load() {
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                String event=intent.getStringExtra(RadioSessionService.EXTRA_EVENT);
                String json=intent.getStringExtra(RadioSessionService.EXTRA_DATA);
                JSObject data;
                try { data=JSObject.fromJSONObject(new JSONObject(json==null?"{}":json)); }
                catch(Exception error){data=new JSObject();}
                notifyListeners("radioEvent",new JSObject().put("event",event).put("data",data),false);
                if("quickExitResult".equals(event)&&pendingExit!=null&&exitRequest.equals(data.optString("requestId"))){
                    PluginCall exit=pendingExit;pendingExit=null;exitRequest=null;
                    if(!data.optBoolean("ok")){exit.reject(data.optString("message","Não foi possível sair."));return;}
                    // Stop independent APRS/GPS when the operator explicitly closes the app.
                    AprsService aprs=AprsService.current();if(aprs!=null){aprs.disconnect();getContext().stopService(new Intent(getContext(),AprsService.class));}
                    if(activityClient!=null){activityClient.close();activityClient=null;}
                    exit.resolve(new JSObject().put("closed",true));
                    if(!exit.getBoolean("forUpdate",false))getActivity().runOnUiThread(()->getActivity().finishAndRemoveTask());
                }
                if("status".equals(event)) notifyListeners("radioStatus",data,false);
                if("vocoder".equals(event)) notifyListeners("vocoderStatus",data,false);
                if("audioTest".equals(event)&&pendingAudioTest!=null){PluginCall test=pendingAudioTest;pendingAudioTest=null;if(data.optBoolean("ok"))test.resolve(data);else test.reject(data.optString("message","Falha no teste local."),"AUDIO_TEST_FAILED");}
            }
        };
        IntentFilter filter=new IntentFilter(RadioSessionService.ACTION_EVENT);
        if(Build.VERSION.SDK_INT>=33)getContext().registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(receiver,filter);
    }

    @PluginMethod public void initialize(PluginCall call) {
        if(activityClient==null) activityClient=new BrandMeisterActivityClient((event,data) -> {
            try { notifyListeners("radioEvent",new JSObject().put("event",event).put("data",JSObject.fromJSONObject(data)),false); }
            catch(org.json.JSONException error) { android.util.Log.w("ZapDMR", "Invalid activity event", error); }
        });
        activityClient.start();
        firmwareWorker.execute(() -> {
            try {
                FirmwareBundle.ensure(getContext(),false,null);
                call.resolve(new JSObject().put("nativeRadio",true).put("firmwareReady",true));
            } catch(Exception error){call.reject("Não foi possível preparar o firmware incluído no APK.","FIRMWARE_SETUP_FAILED",error);}
        });
    }

    @PluginMethod public void watchTalkgroups(PluginCall call) {
        java.util.Set<Integer> ids=new java.util.HashSet<>();
        org.json.JSONArray array=call.getArray("ids");
        if(array!=null)for(int i=0;i<array.length();i++){int id=array.optInt(i);if(id>0&&id<=0xffffff)ids.add(id);}
        if(activityClient!=null)activityClient.watch(ids);
        call.resolve();
    }
    @PluginMethod public void dmrDatabase(PluginCall call){
        databaseWorker.execute(() -> {
            try{
                if(directory==null)directory=new DmrDirectory(getContext());
                String action=call.getString("action","stats");
                if("update".equals(action))call.resolve(directory.update());
                else if("delete".equals(action))call.resolve(directory.clear());
                else if("lookup".equals(action))call.resolve(directory.lookup(call.getArray("ids",new com.getcapacitor.JSArray())));
                else call.resolve(directory.stats());
            }catch(Exception error){call.reject(error.getMessage()==null?"Falha na base DMR ID.":error.getMessage(),"DMR_DATABASE_FAILED",error);}
        });
    }
    @PluginMethod public void configureOperation(PluginCall call){
        JSObject options=call.getObject("operation",new JSObject());
        JSObject console=call.getObject("console",new JSObject());
        getContext().getSharedPreferences("zapdmr_controls",Context.MODE_PRIVATE).edit().putString("operation",options.toString()).putString("console",console.toString()).apply();
        getActivity().runOnUiThread(() -> {
            android.view.Window window=getActivity().getWindow();
            if(options.optBoolean("keepScreenOn"))window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if(options.optBoolean("hideStatusBar"))window.addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        });
        if(RadioSessionService.running){Intent update=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_OPTIONS).putExtra("operation",options.toString()).putExtra("console",console.toString());JSObject radioSettings=call.getObject("radioSettings",call.getObject("settings"));if(radioSettings!=null)update.putExtra("radioSettings",radioSettings.toString()).putExtra("settings",radioSettings.toString());getContext().startService(update);}
        call.resolve();
    }
    @PluginMethod public void participantAction(PluginCall call){
        String callsign=call.getString("callsign","").toUpperCase(java.util.Locale.ROOT);
        if(!callsign.matches("(?=.{3,20}$)(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{1,8}(?:/[A-Z0-9]{1,8}){0,2}")){call.reject("Indicativo inválido.");return;}
        String action=call.getString("action","");
        try{if("copy".equals(action)){
            android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Indicativo",callsign));call.resolve();
        }else if("qrz".equals(action)){
            android.net.Uri uri=android.net.Uri.parse("https://www.qrz.com/db/"+android.net.Uri.encode(callsign));
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW,uri));call.resolve();
        }else call.reject("Ação inválida.");}catch(Exception error){call.reject("Não foi possível abrir esta ação.");}
    }
    @PluginMethod public void openWhatsApp(PluginCall call){
        String phone=call.getString("phone","");
        if(phone==null||!phone.matches("\\+[1-9][0-9]{7,14}")){call.reject("Número WhatsApp inválido.");return;}
        String text=call.getString("text","");
        if(text==null)text="";
        if(text.length()>2000){call.reject("Mensagem WhatsApp demasiado longa.");return;}
        Uri.Builder target=new Uri.Builder().scheme("https").authority("wa.me").appendPath(phone.substring(1));
        if(!text.isEmpty())target.appendQueryParameter("text",text);
        try{getContext().startActivity(new Intent(Intent.ACTION_VIEW,target.build()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));call.resolve();}
        catch(Exception error){call.reject("Não foi possível abrir o WhatsApp ou navegador.");}
    }
    @PluginMethod public void radioControl(PluginCall call){
        try{
            String action=call.getString("action","");
            if("logSnapshot".equals(action)){call.resolve(new JSObject().put("entries",RadioNotifications.snapshot()));return;}
            if("logClear".equals(action)){RadioNotifications.clear();call.resolve(new JSObject().put("entries",RadioNotifications.snapshot()));return;}
            if(!RadioSessionService.running){call.reject("Ligue primeiro o rádio.");return;}
            Intent intent=new Intent(getContext(),RadioSessionService.class);
            if("target".equals(action))intent.setAction(RadioSessionService.ACTION_TARGET).putExtra("destinationId",call.getInt("destinationId",0)).putExtra("callType",call.getString("callType","group")).putExtra("slot",call.getInt("slot",1));
            else if("usageReset".equals(action))intent.setAction(RadioSessionService.ACTION_USAGE_RESET);
            else{call.reject("Comando de rádio inválido.");return;}
            getContext().startService(intent);call.resolve(new JSObject().put("accepted",true));
        }catch(Exception error){call.reject(error.getMessage()==null?"Não foi possível executar o comando de rádio.":error.getMessage(),"RADIO_CONTROL_FAILED",error);}
    }
    @PluginMethod public void bluetoothSpp(PluginCall call){
        try {
            BluetoothSppController serial=BluetoothSppController.get(getContext());
            String action=call.getString("action","status");
            if("devices".equals(action))call.resolve(new JSObject().put("devices",serial.devices()).put("status",serial.status()));
            else if("learn".equals(action))call.resolve(JSObject.fromJSONObject(serial.learn(call.getString("binding","pttToggle"))));
            else if("cancelLearn".equals(action)){serial.cancelLearning();call.resolve(JSObject.fromJSONObject(serial.status()));}
            else if("openSettings".equals(action)){getContext().startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));call.resolve();}
            else call.resolve(JSObject.fromJSONObject(serial.status()));
        }catch(Exception error){call.reject(error.getMessage()==null?"Não foi possível gerir o botão Bluetooth SPP.":error.getMessage(),"BLUETOOTH_SPP_FAILED",error);}
    }
    @PluginMethod public void setAudioLevels(PluginCall call){
        int tx=call.getInt("txGainPercent",100),rx=call.getInt("rxVolumePercent",100);
        if(tx<0||tx>260||rx<0||rx>260){call.reject("Ganho e volume devem estar entre 0 e 260%.");return;}
        Intent intent=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_AUDIO_LEVELS).putExtra("txGainPercent",tx).putExtra("rxVolumePercent",rx);
        getContext().startService(intent);call.resolve(new JSObject().put("applied",true).put("txGainPercent",tx).put("rxVolumePercent",rx));
    }
    @PluginMethod public void audioTest(PluginCall call){
        if(pendingAudioTest!=null){call.reject("Já existe um teste local em curso.");return;}
        pendingAudioTest=call;
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_AUDIO_TEST).putExtra("microphone",call.getBoolean("microphone",false)));
    }
    @PluginMethod public void requestOperationPermission(PluginCall call){
        String alias=call.getString("alias","microphone");
        if(!"bluetooth".equals(alias)&&!"microphone".equals(alias)&&!"notifications".equals(alias)){call.reject("Permissão inválida.");return;}
        if("bluetooth".equals(alias)&&Build.VERSION.SDK_INT<31){call.resolve();return;}
        if("notifications".equals(alias)&&Build.VERSION.SDK_INT<33){call.resolve();return;}
        if(getPermissionState(alias)==PermissionState.GRANTED){call.resolve();return;}
        requestPermissionForAlias(alias,call,"operationPermissionResult");
    }
    @PermissionCallback private void operationPermissionResult(PluginCall call){String alias=call.getString("alias","microphone");if(getPermissionState(alias)==PermissionState.GRANTED)call.resolve();else call.reject("Permissão necessária para esta opção.");}
    @PluginMethod public void batterySettings(PluginCall call){
        Intent intent=new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);call.resolve();
    }

    private static final Object CONFIG_LOCK=new Object();
    private static final java.util.concurrent.atomic.AtomicBoolean profileChanging=new java.util.concurrent.atomic.AtomicBoolean();
    private JSONObject readConfig() throws Exception {
        String encrypted=getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(CONFIG_KEY,null);
        return encrypted==null?new JSONObject():new JSONObject(decrypt(encrypted));
    }
    private void writeConfig(JSONObject value) throws Exception {
        if(!getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(CONFIG_KEY,encrypt(value.toString())).commit())throw new java.io.IOException("Secure storage failed");
    }
    @PluginMethod public void saveRadioConfig(PluginCall call) {
        if(profileChanging.get()){call.reject("Aguarde a troca de perfil.");return;}
        try { synchronized(CONFIG_LOCK) {
            if(profileChanging.get())throw new java.io.IOException("Aguarde a troca de perfil.");
            JSONObject value=new JSONObject(call.getData().toString()),stored=readConfig();
            // Radio settings snapshots must not replace a newer community session.
            if(stored.has("community"))value.put("community",stored.getJSONObject("community"));
            ensureProfiles(stored);
            value.put("profiles",stored.getJSONArray("profiles"));value.put("activeProfileId",stored.getString("activeProfileId"));
            syncActiveProfile(value);writeConfig(value);
        } call.resolve(new JSObject().put("saved",true));
        }catch(Exception error){call.reject("Não foi possível guardar o perfil protegido.","SECURE_STORAGE_FAILED",error);}
    }
    private void ensureProfiles(JSONObject value) throws Exception {
        if(value.optJSONArray("profiles")!=null&&value.getJSONArray("profiles").length()>0)return;
        JSONObject setting=value.optJSONObject("settings");if(setting==null)setting=new JSONObject();
        JSONObject profile=new JSONObject().put("id","default").put("name",setting.optString("profileName","BrandMeister")).put("settings",setting).put("hotspotPassword",value.optString("hotspotPassword",""));
        value.put("profiles",new org.json.JSONArray().put(profile)).put("activeProfileId","default");
    }
    private void syncActiveProfile(JSONObject value) throws Exception {
        org.json.JSONArray list=value.getJSONArray("profiles");
        for(int i=0;i<list.length();i++){JSONObject p=list.getJSONObject(i);if(p.getString("id").equals(value.getString("activeProfileId"))){p.put("settings",value.optJSONObject("settings")).put("hotspotPassword",value.optString("hotspotPassword",""));JSONObject setting=value.optJSONObject("settings");if(setting!=null&&!setting.optString("profileName").isEmpty())p.put("name",setting.getString("profileName"));}}
    }
    private JSObject profileResponse(JSONObject value) throws Exception {
        org.json.JSONArray metadata=new org.json.JSONArray(),list=value.getJSONArray("profiles");
        for(int i=0;i<list.length();i++){JSONObject p=list.getJSONObject(i),setting=p.getJSONObject("settings");metadata.put(new JSONObject().put("id",p.getString("id")).put("name",p.getString("name")).put("callsign",setting.optString("callsign")).put("dmrId",setting.optString("dmrId")).put("passwordConfigured",!p.optString("hotspotPassword").isEmpty()));}
        JSONObject active=new JSONObject(value.optJSONObject("settings")==null?"{}":value.getJSONObject("settings").toString());
        active.put("profileId",value.getString("activeProfileId")).put("passwordConfigured",!value.optString("hotspotPassword").isEmpty());
        return new JSObject().put("profiles",metadata).put("activeProfileId",value.getString("activeProfileId")).put("settings",active);
    }
    @PluginMethod public void radioProfiles(PluginCall call){
        String action=call.getString("action","list");
        if(!profileChanging.compareAndSet(false,true)){call.reject("Aguarde a troca de perfil.");return;}
        new Thread(()->{try{
            if(!"list".equals(action)){
                if(RadioSessionService.profileBusy())throw new java.io.IOException("Termine a transmissão ou teste antes de trocar perfil.");
                if(RadioSessionService.running){
                    getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_DISCONNECT));
                    long until=android.os.SystemClock.elapsedRealtime()+6000;
                    while(RadioSessionService.running&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(40);
                    if(RadioSessionService.running)throw new java.io.IOException("A sessão anterior ainda está encerrando; tente novamente.");
                }
            }
            synchronized(CONFIG_LOCK){
                JSONObject value=readConfig();ensureProfiles(value);org.json.JSONArray list=value.getJSONArray("profiles");String id=call.getString("id","");
                if("create".equals(action)){
                    String name=call.getString("name","").trim();if(name.isEmpty()||name.length()>40||list.length()>=50)throw new java.io.IOException("Informe nome de até 40 caracteres; limite de 50 perfis.");
                    id=java.util.UUID.randomUUID().toString();JSONObject setting=call.getObject("settings",new JSObject());setting.put("profileName",name);
                    list.put(new JSONObject().put("id",id).put("name",name).put("settings",setting).put("hotspotPassword",""));
                }else if("delete".equals(action)){
                    if(list.length()<=1)throw new java.io.IOException("Mantenha pelo menos um perfil.");
                    boolean found=false;for(int i=0;i<list.length();i++)if(list.getJSONObject(i).getString("id").equals(id)){list.remove(i);found=true;break;}
                    if(!found)throw new java.io.IOException("Perfil não encontrado.");
                    id=id.equals(value.getString("activeProfileId"))?list.getJSONObject(0).getString("id"):value.getString("activeProfileId");
                }else if(!"activate".equals(action)&&!"list".equals(action))throw new java.io.IOException("Operação inválida.");
                if(!"list".equals(action)){
                    JSONObject selected=null;for(int i=0;i<list.length();i++)if(list.getJSONObject(i).getString("id").equals(id))selected=list.getJSONObject(i);
                    if(selected==null)throw new java.io.IOException("Perfil não encontrado.");
                    JSONObject setting=selected.getJSONObject("settings");setting.put("profileName",selected.getString("name"));
                    value.put("settings",setting).put("hotspotPassword",selected.optString("hotspotPassword","")).put("activeProfileId",id);
                }
                writeConfig(value);call.resolve(profileResponse(value));
            }
        }catch(Exception error){call.reject(error.getMessage(),"PROFILE_FAILED",error);}finally{profileChanging.set(false);}},"ZapDMR-Profiles").start();
    }
    @PluginMethod public void saveCommunityProfile(PluginCall call) {
        try { synchronized(CONFIG_LOCK) { JSONObject value=readConfig();value.put("community",call.getObject("community",new JSObject()));writeConfig(value); }
            call.resolve(new JSObject().put("saved",true));
        }catch(Exception error){call.reject("Não foi possível guardar a sessão protegida.","SECURE_STORAGE_FAILED",error);}
    }
    @PluginMethod public void loadRadioConfig(PluginCall call) {
        try { synchronized(CONFIG_LOCK) { call.resolve(JSObject.fromJSONObject(readConfig())); } }
        catch(Exception error){call.reject("Não foi possível ler o perfil protegido.","SECURE_STORAGE_FAILED",error);}
    }

    @PluginMethod public void connectRadio(PluginCall call) {
        if(profileChanging.get()){call.reject("Aguarde a troca de perfil.");return;}
        if(RadioSessionService.profileBusy()){call.reject("Termine a transmissão ou teste antes de conectar outro perfil.");return;}
        if(QuickExitState.blocked()){call.reject("ZapDMR está saindo. Abra novamente para conectar.");return;}
        try {
            JSObject settings=call.getObject("settings",new JSObject());
            String password=call.getString("password","");
            boolean autoReconnect=call.getBoolean("autoReconnect",false);
            Intent intent=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_CONNECT)
                .putExtra("settings",settings.toString()).putExtra("password",password).putExtra("autoReconnect",autoReconnect).putExtra("startupReceiveOnly",call.getBoolean("startupReceiveOnly",false));
            if(Build.VERSION.SDK_INT>=26)ContextCompat.startForegroundService(getContext(),intent);else getContext().startService(intent);
            call.resolve(new JSObject().put("accepted",true));
        } catch(Exception error) { call.reject(error instanceof SecurityException?"Autorize as permissões do Android necessárias à ligação de rádio.":"Não foi possível iniciar a sessão de rádio nativa.","RADIO_START_FAILED",error); }
    }

    @PluginMethod public void takeQuickExitResume(PluginCall call){
        if(QuickExitState.blocked()){call.resolve(new JSObject().put("resume",false));return;}
        android.content.SharedPreferences prefs=getContext().getSharedPreferences(QuickExitState.PREFS,Context.MODE_PRIVATE);
        boolean resume=prefs.getBoolean(QuickExitState.RESUME,false);
        if(resume&&!prefs.edit().remove(QuickExitState.RESUME).commit()){call.reject("Não foi possível ler o estado da retomada.");return;}
        call.resolve(new JSObject().put("resume",resume));
    }
    @PluginMethod public void quickExit(PluginCall call){
        if(pendingExit!=null){call.reject("A saída já está em andamento.");return;}
        pendingExit=call;exitRequest=java.util.UUID.randomUUID().toString();
        try{getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_QUICK_EXIT).putExtra("requestId",exitRequest));}
        catch(Exception error){pendingExit=null;exitRequest=null;call.reject("Não foi possível encerrar o serviço de rádio.");}
    }
    @PluginMethod public void resumeAfterAppUpdate(PluginCall call){if(!QuickExitState.open()){call.reject("O rádio ainda está encerrando.");return;}call.resolve();}
    @PluginMethod public void disconnectRadio(PluginCall call) {
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_DISCONNECT));
        call.resolve();
    }

    @PluginMethod public void unlinkTalkgroup(PluginCall call) {getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_UNLINK));call.resolve();}

    @PluginMethod public void tuneTalkgroup(PluginCall call) {
        Intent intent=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_TUNE)
            .putExtra("talkgroupId",call.getInt("talkgroupId",0)).putExtra("slot",call.getInt("slot",1));
        getContext().startService(intent); call.resolve();
    }

    @PluginMethod public void startPtt(PluginCall call) {
        if(getPermissionState("microphone")!=PermissionState.GRANTED) {
            pendingPttCall=call;
            requestPermissionForAlias("microphone",call,"microphonePermissionResult");
            return;
        }
        dispatchPttStart(call);
    }

    @PermissionCallback private void microphonePermissionResult(PluginCall call) {
        if(pendingPttCall!=call)return;
        pendingPttCall=null;
        if(getPermissionState("microphone")!=PermissionState.GRANTED) {
            call.reject("Permita o microfone para transmitir PTT.","MICROPHONE_PERMISSION_DENIED"); return;
        }
        dispatchPttStart(call);
    }

    private void dispatchPttStart(PluginCall call) {
        Intent intent=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_PTT_DOWN)
            .putExtra("talkgroupId",call.getInt("talkgroupId",0)).putExtra("slot",call.getInt("slot",1));
        getContext().startService(intent); call.resolve();
    }

    @PluginMethod public void stopPtt(PluginCall call) {
        PluginCall pending=pendingPttCall;pendingPttCall=null;if(pending!=null)pending.reject("PTT cancelado antes da autorização do microfone.","PTT_CANCELLED");
        getContext().startService(new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_PTT_UP));call.resolve();
    }

    @PluginMethod public void firmwareStatus(PluginCall call) {
        File dir=new File(getContext().getFilesDir(),"firmware");File app=new File(dir,"D002.032.bin"),core=new File(dir,"d02032-core.img");
        call.resolve(new JSObject().put("ready",FirmwareBundle.ready(getContext())).put("bundled",true)
            .put("applicationBytes",app.isFile()?app.length():0).put("coreBytes",core.isFile()?core.length():0));
    }

    @PluginMethod public void activateFirmware(PluginCall call) {
        final String target=call.getString("target","all");
        try{if(!"all".equals(target))FirmwareDownload.name(target);}catch(Exception error){call.reject(error.getMessage());return;}
        if(!downloading.compareAndSet(false,true)){call.reject("O vocoder já está a ser preparado.");return;}
        firmwareWorker.execute(() -> {
            try {
                FirmwareBundle.ensure(getContext(),true,"all".equals(target)?null:target);
                call.resolve(new JSObject().put("ready",FirmwareBundle.ready(getContext())).put("bundled",true)
                    .put("verified",true).put("file","all".equals(target)?"vocoder":FirmwareDownload.name(target)));
            } catch(Exception error){call.reject("Falha ao ativar o firmware incluído no APK.","FIRMWARE_SETUP_FAILED",error);}
            finally{downloading.set(false);}
        });
    }

    @PluginMethod public void importFirmware(PluginCall call) {
        String target=call.getString("target","");
        if(!"application".equals(target)&&!"core".equals(target)){call.reject("Selecione o tipo de ficheiro de firmware.");return;}
        firmwareTarget=target;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call,intent,"firmwarePicked");
    }

    @PluginMethod public void downloadFirmware(PluginCall call) {
        final String target=call.getString("target","");
        final String url=call.getString("url","");
        try { FirmwareDownload.name(target); FirmwareDownload.secureUrl(url); }
        catch(Exception error){call.reject(error.getMessage(),"FIRMWARE_URL_INVALID",error);return;}
        if(!downloading.compareAndSet(false,true)){call.reject("Já existe um download de firmware em curso.");return;}
        firmwareWorker.execute(() -> {
            File temp=null;
            try {
                File dir=new File(getContext().getFilesDir(),"firmware");
                if(!dir.isDirectory()&&!dir.mkdirs())throw new java.io.IOException("Não foi possível criar a pasta privada.");
                String name=FirmwareDownload.name(target);
                temp=File.createTempFile("download-",".part",dir);
                FirmwareDownload.fetch(url,target,temp,(bytes,total) -> notifyListeners("radioEvent",
                    new JSObject().put("event","firmwareDownload").put("data",new JSObject().put("file",name).put("percent",bytes*100/total)),false));
                android.util.AtomicFile destination=new android.util.AtomicFile(new File(dir,name));
                FileOutputStream output=null;
                try(InputStream input=new java.io.FileInputStream(temp)){
                    output=destination.startWrite(); byte[] buffer=new byte[32768];int read;
                    while((read=input.read(buffer))!=-1)output.write(buffer,0,read);
                    destination.finishWrite(output);output=null;
                } finally { if(output!=null)destination.failWrite(output); }
                File app=new File(dir,"D002.032.bin"),core=new File(dir,"d02032-core.img");
                call.resolve(new JSObject().put("ready",app.isFile()&&app.length()==994304L&&core.isFile()&&core.length()==131072L)
                    .put("file",name).put("bytes",FirmwareDownload.size(target)).put("verified",true));
            } catch(Exception error){call.reject(error.getMessage()==null?"Falha no download do firmware.":error.getMessage(),"FIRMWARE_DOWNLOAD_FAILED",error);}
            finally {if(temp!=null)temp.delete();downloading.set(false);}
        });
    }

    @ActivityCallback private void firmwarePicked(PluginCall call,ActivityResult result) {
        if(result.getResultCode()!=android.app.Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.reject("Importação de firmware cancelada.","FIRMWARE_IMPORT_CANCELLED");return;}
        Uri uri=result.getData().getData();
        try {
            long expected="application".equals(firmwareTarget)?994304L:131072L;
            File dir=new File(getContext().getFilesDir(),"firmware");if(!dir.exists()&&!dir.mkdirs())throw new java.io.IOException("Não foi possível criar a pasta privada do firmware.");
            String name="application".equals(firmwareTarget)?"D002.032.bin":"d02032-core.img";
            File temp=new File(dir,name+".part"),dest=new File(dir,name);long total=0;
            try(InputStream input=getContext().getContentResolver().openInputStream(uri);FileOutputStream output=new FileOutputStream(temp)){
                if(input==null)throw new java.io.IOException("O Android não abriu o ficheiro escolhido.");
                byte[] buffer=new byte[32768];int n;while((n=input.read(buffer))>=0){total+=n;if(total>expected)throw new java.io.IOException("O ficheiro excede o tamanho esperado para "+name+".");output.write(buffer,0,n);}output.getFD().sync();
            }
            if(total!=expected){temp.delete();throw new java.io.IOException("Tamanho inválido para "+name+": "+total+" bytes; esperado "+expected+".");}
            if(dest.exists()&&!dest.delete())throw new java.io.IOException("Não foi possível substituir o ficheiro anterior.");
            if(!temp.renameTo(dest))throw new java.io.IOException("Não foi possível guardar o firmware na pasta privada.");
            firmwareTarget="";
            File app=new File(dir,"D002.032.bin"),core=new File(dir,"d02032-core.img");
            call.resolve(new JSObject().put("ready",app.isFile()&&app.length()==994304L&&core.isFile()&&core.length()==131072L)
                .put("file",name).put("bytes",total).put("storage",dir.getAbsolutePath()));
        } catch(Exception error){call.reject(error.getMessage()==null?"Falha ao importar firmware.":error.getMessage(),"FIRMWARE_IMPORT_FAILED",error);}
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);java.security.Key existing=store.getKey(KEY_ALIAS,null);
        if(existing instanceof SecretKey)return(SecretKey)existing;
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private String encrypt(String text) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,getOrCreateKey());
        byte[] body=cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(body,Base64.NO_WRAP);
    }
    private String decrypt(String value) throws Exception {
        String[] parts=value.split(":",2);if(parts.length!=2)throw new IllegalArgumentException("Perfil cifrado inválido.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,getOrCreateKey(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }

    @Override protected void handleOnDestroy() {
        if(pendingExit!=null){pendingExit.reject("Interface encerrada durante a saída.");pendingExit=null;exitRequest=null;}
        if(pendingAudioTest!=null){pendingAudioTest.reject("Teste cancelado: aplicação encerrada.");pendingAudioTest=null;}
        databaseWorker.shutdownNow();
        firmwareWorker.shutdownNow();
        if(activityClient!=null){activityClient.close();activityClient=null;}
        if(receiver!=null){try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}receiver=null;}
        if(pendingPttCall!=null){pendingPttCall.reject("Plugin encerrado.");pendingPttCall=null;}
        super.handleOnDestroy();
    }
}
