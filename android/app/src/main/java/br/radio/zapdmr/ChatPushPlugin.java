package br.radio.zapdmr;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/** Chat notifications never start the radio service, request audio focus or synthesize PTT. */
@CapacitorPlugin(name="ZapChatPush",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public final class ChatPushPlugin extends Plugin {
    static final String CHANNEL="zapchat_messages";
    static void channel(Context context){if(Build.VERSION.SDK_INT>=26){NotificationChannel channel=new NotificationChannel(CHANNEL,"Mensagens ZapChat",NotificationManager.IMPORTANCE_LOW);channel.setSound(null,null);channel.enableVibration(false);context.getSystemService(NotificationManager.class).createNotificationChannel(channel);}}
    @Override public void load(){channel(getContext());}
    @PluginMethod public void status(PluginCall call){
        boolean configured=!FirebaseApp.getApps(getContext()).isEmpty();boolean enabled=getContext().getSharedPreferences("zapdmr_chat_push",Context.MODE_PRIVATE).getBoolean("enabled",false);
        call.resolve(new JSObject().put("configured",configured).put("enabled",enabled).put("allowed",NotificationManagerCompat.from(getContext()).areNotificationsEnabled()));
    }
    @PluginMethod public void enable(PluginCall call){
        if(FirebaseApp.getApps(getContext()).isEmpty()){call.reject("Notificações aguardam a configuração do Firebase.","FCM_NOT_CONFIGURED");return;}
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"permissionResult");return;}
        token(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call){if(getPermissionState("notifications")==PermissionState.GRANTED)token(call);else call.reject("Autorize as notificações para receber avisos.","NOTIFICATION_PERMISSION_DENIED");}
    private void token(PluginCall call){FirebaseMessaging.getInstance().setAutoInitEnabled(true);FirebaseMessaging.getInstance().getToken().addOnSuccessListener(value->{getContext().getSharedPreferences("zapdmr_chat_push",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).apply();call.resolve(new JSObject().put("token",value));}).addOnFailureListener(error->call.reject("Não foi possível registrar as notificações.","FCM_REGISTRATION_FAILED"));}
    @PluginMethod public void disable(PluginCall call){getContext().getSharedPreferences("zapdmr_chat_push",Context.MODE_PRIVATE).edit().putBoolean("enabled",false).apply();if(!FirebaseApp.getApps(getContext()).isEmpty()){FirebaseMessaging.getInstance().setAutoInitEnabled(false);FirebaseMessaging.getInstance().deleteToken();}call.resolve();}
    @PluginMethod public void consumeOpen(PluginCall call){Intent intent=getActivity().getIntent();String peer=intent==null?null:intent.getStringExtra("zapdmrPeer");if(intent!=null){intent.removeExtra("zapdmrPeer");intent.removeExtra("zapdmrMessage");}call.resolve(new JSObject().put("peerId",validPeer(peer)?peer:""));}
    static boolean validPeer(String peer){return peer!=null&&peer.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");}
    static void show(Context context,String peer,String id){
        if(!validPeer(peer)||id==null||!id.matches("(?i)[a-f0-9-]{32,64}")||!context.getSharedPreferences("zapdmr_chat_push",Context.MODE_PRIVATE).getBoolean("enabled",false))return;
        if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        channel(context);Intent intent=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("zapdmrPeer",peer).putExtra("zapdmrMessage",id);
        PendingIntent pending=PendingIntent.getActivity(context,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        NotificationManagerCompat.from(context).notify(id.hashCode(),new NotificationCompat.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle("ZapDMR · ZapChat").setContentText("Você tem uma nova mensagem. Toque para abrir.").setContentIntent(pending).setAutoCancel(true).setSilent(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
    }
}
