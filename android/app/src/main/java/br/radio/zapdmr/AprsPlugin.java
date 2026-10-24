package br.radio.zapdmr;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** APRS uses an independent, opt-in native connection and never the radio master password. */
@CapacitorPlugin(name="Aprs",permissions={@Permission(alias="location",strings={Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION}),@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public final class AprsPlugin extends Plugin {
    private BroadcastReceiver receiver;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r -> new Thread(r,"ZapDMR-APRS-bridge"));
    private PluginCall positionCall;
    private LocationManager locations;
    private LocationListener listener;
    private Runnable positionTimeout;

    @Override public void load(){
        receiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){try{JSObject data=JSObject.fromJSONObject(new JSONObject(intent.getStringExtra("data")));notifyListeners("aprsEvent",new JSObject().put("event",intent.getStringExtra("event")).put("data",data),false);}catch(Exception ignored){}}};
        if(Build.VERSION.SDK_INT>=33)getContext().registerReceiver(receiver,new IntentFilter(AprsService.EVENT),Context.RECEIVER_NOT_EXPORTED);else getContext().registerReceiver(receiver,new IntentFilter(AprsService.EVENT));
    }
    @PluginMethod public void initialize(PluginCall call){worker.execute(()->{try{call.resolve(JSObject.fromJSONObject(AprsService.snapshot(getContext())));}catch(Exception error){call.reject("Não foi possível ler o estado APRS.","APRS_STATUS_FAILED",error);}});}
    @PluginMethod public void connect(PluginCall call){
        try{
            JSONObject config=AprsService.cleanConfig(call.getObject("config",new JSObject()));String passcode=call.getString("passcode","");AprsService.validatePasscode(passcode);
            Intent intent=new Intent(getContext(),AprsService.class).setAction(AprsService.CONNECT).putExtra("config",config.toString()).putExtra("passcode",passcode);
            // This method is invoked from a visible screen; Android permits foreground GPS promotion here.
            getActivity().runOnUiThread(()->{try{ContextCompat.startForegroundService(getContext(),intent);call.resolve(new JSObject().put("accepted",true).put("state","connecting"));}catch(Exception error){call.reject("Não foi possível iniciar a sessão APRS-IS.","APRS_START_FAILED",error);}});
        }catch(Exception error){call.reject(error.getMessage()==null?"Configuração APRS inválida.":error.getMessage(),"APRS_CONFIG_INVALID",error);}
    }
    @PluginMethod public void disconnect(PluginCall call){if(AprsService.current()!=null)getContext().startService(new Intent(getContext(),AprsService.class).setAction(AprsService.DISCONNECT));call.resolve();}
    @PluginMethod public void sendMessage(PluginCall call){worker.execute(()->{try{AprsService service=requireService();call.resolve(JSObject.fromJSONObject(service.sendMessage(call.getString("to",""),call.getString("text",""))));}catch(Exception error){call.reject(error.getMessage()==null?"Não foi possível enviar a mensagem APRS.":error.getMessage(),"APRS_MESSAGE_FAILED",error);}});}
    @PluginMethod public void position(PluginCall call){worker.execute(()->{try{AprsService service=requireService();service.position(call.getDouble("latitude",Double.NaN),call.getDouble("longitude",Double.NaN));call.resolve(JSObject.fromJSONObject(service.snapshot()));}catch(Exception error){call.reject(error.getMessage()==null?"Posição GPS inválida.":error.getMessage(),"APRS_POSITION_FAILED",error);}});}
    @PluginMethod public void beacon(PluginCall call){worker.execute(()->{try{AprsService service=requireService();service.beacon();call.resolve(JSObject.fromJSONObject(service.snapshot()));}catch(Exception error){call.reject(error.getMessage()==null?"Não foi possível enviar a posição APRS.":error.getMessage(),"APRS_BEACON_FAILED",error);}});}
    @PluginMethod public void requestNotificationPermission(PluginCall call){if(Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED){call.resolve();return;}requestPermissionForAlias("notifications",call,"notificationResult");}
    @PermissionCallback private void notificationResult(PluginCall call){if(Build.VERSION.SDK_INT<33||getPermissionState("notifications")==PermissionState.GRANTED)call.resolve();else call.reject("As notificações foram desativadas pelo utilizador.","NOTIFICATION_PERMISSION_DENIED");}
    @PluginMethod public void requestPosition(PluginCall call){
        if(positionCall!=null){call.reject("Já existe um pedido de posição em curso.");return;}
        positionCall=call;
        if(!locationPermitted()){requestPermissionForAlias("location",call,"locationResult");return;}
        locate(call);
    }
    @PermissionCallback private void locationResult(PluginCall call){if(positionCall!=call)return;if(!locationPermitted()){positionCall=null;call.reject("Permita a localização para obter uma posição GPS real.","LOCATION_PERMISSION_DENIED");return;}locate(call);}
    private boolean locationPermitted(){return ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private void locate(PluginCall call){getActivity().runOnUiThread(()->{
        try{
            locations=(LocationManager)getContext().getSystemService(Context.LOCATION_SERVICE);
            boolean fine=ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
            boolean gps=fine&&locations.isProviderEnabled(LocationManager.GPS_PROVIDER),network=locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if(!gps&&!network)throw new IllegalStateException("Ative a localização/GPS nas definições do Android.");
            listener=new LocationListener(){@Override public void onLocationChanged(Location location){if(positionCall!=call)return;finishPosition();call.resolve(new JSObject().put("latitude",location.getLatitude()).put("longitude",location.getLongitude()).put("accuracy",location.getAccuracy()).put("at",location.getTime()));}@Override public void onProviderEnabled(String provider){}@Override public void onProviderDisabled(String provider){}@Override public void onStatusChanged(String provider,int status,Bundle extras){}};
            if(gps)locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,0,0,listener,Looper.getMainLooper());
            if(network)locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,0,0,listener,Looper.getMainLooper());
            positionTimeout=()->{if(positionCall!=call)return;finishPosition();call.reject("GPS sem posição atual. Tente novamente com melhor sinal.","LOCATION_TIMEOUT");};handler.postDelayed(positionTimeout,20000);
        }catch(Exception error){finishPosition();call.reject(error.getMessage()==null?"Não foi possível obter uma posição GPS.":error.getMessage(),"LOCATION_FAILED",error);}
    });}
    private void finishPosition(){positionCall=null;if(positionTimeout!=null)handler.removeCallbacks(positionTimeout);positionTimeout=null;if(locations!=null&&listener!=null)try{locations.removeUpdates(listener);}catch(Exception ignored){}listener=null;}
    private AprsService requireService(){AprsService service=AprsService.current();if(service==null)throw new IllegalStateException("Ligue primeiro ao APRS-IS.");return service;}
    @Override protected void handleOnDestroy(){PluginCall call=positionCall;finishPosition();if(call!=null)call.reject("Pedido de posição cancelado.");if(receiver!=null)try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}worker.shutdownNow();super.handleOnDestroy();}
}
