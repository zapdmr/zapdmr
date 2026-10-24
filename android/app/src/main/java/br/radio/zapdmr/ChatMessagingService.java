package br.radio.zapdmr;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
/** Background notification+data messages are shown by Android; foreground messages use a silent channel. */
public final class ChatMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message){ChatPushPlugin.show(this,message.getData().get("zapdmrPeer"),message.getData().get("zapdmrMessage"));}
    // Registration token is fetched on every opted-in foreground resume, never printed or stored in clear text.
    @Override public void onNewToken(String token){getSharedPreferences("zapdmr_chat_push",MODE_PRIVATE).edit().putBoolean("registration_dirty",true).apply();}
}
