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
    @PluginMethod public void openWhatsApp(PluginCall call){
        String phone=call.getString("phone","");
        if(!phone.matches("\\+[1-9][0-9]{7,14}")){call.reject("Número WhatsApp inválido.");return;}
        try{getContext().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://wa.me/"+phone.substring(1))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));call.resolve();}
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
        if(tx<0||tx>200||rx<0||rx>200){call.reject("Ganho e volume devem estar entre 0 e 200%.");return;}
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

    @PluginMethod public void saveRadioConfig(PluginCall call) {
        try {
            JSONObject value=call.getData();
            String encrypted=encrypt(value==null?"{}":value.toString());
            getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(CONFIG_KEY,encrypted).apply();
            call.resolve(new JSObject().put("saved",true));
        } catch(Exception error) { call.reject("Não foi possível guardar o perfil protegido pelo Android.","SECURE_STORAGE_FAILED",error); }
    }

    @PluginMethod public void loadRadioConfig(PluginCall call) {
        try {
            String encrypted=getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(CONFIG_KEY,null);
            call.resolve(encrypted==null?new JSObject():JSObject.fromJSONObject(new JSONObject(decrypt(encrypted))));
        } catch(Exception error) { call.reject("Não foi possível ler o perfil protegido.","SECURE_STORAGE_FAILED",error); }
    }

    @PluginMethod public void connectRadio(PluginCall call) {
        try {
            JSObject settings=call.getObject("settings",new JSObject());
            String password=call.getString("password","");
            boolean autoReconnect=call.getBoolean("autoReconnect",false);
            Intent intent=new Intent(getContext(),RadioSessionService.class).setAction(RadioSessionService.ACTION_CONNECT)
                .putExtra("settings",settings.toString()).putExtra("password",password).putExtra("autoReconnect",autoReconnect);
            if(Build.VERSION.SDK_INT>=26)ContextCompat.startForegroundService(getContext(),intent);else getContext().startService(intent);
            call.resolve(new JSObject().put("accepted",true));
        } catch(Exception error) { call.reject("Não foi possível iniciar a sessão HBP nativa.","RADIO_START_FAILED",error); }
    }

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
        if(pendingAudioTest!=null){pendingAudioTest.reject("Teste cancelado: aplicação encerrada.");pendingAudioTest=null;}
        databaseWorker.shutdownNow();
        firmwareWorker.shutdownNow();
        if(activityClient!=null){activityClient.close();activityClient=null;}
        if(receiver!=null){try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}receiver=null;}
        if(pendingPttCall!=null){pendingPttCall.reject("Plugin encerrado.");pendingPttCall=null;}
        super.handleOnDestroy();
    }
}
