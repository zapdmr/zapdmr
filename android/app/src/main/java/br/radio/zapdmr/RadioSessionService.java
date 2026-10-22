package br.radio.zapdmr;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import android.net.ConnectivityManager;
import android.net.Network;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Owns the mobile HBP UDP session and keeps it alive in a visible Android foreground service. */
public final class RadioSessionService extends Service {
    static final String ACTION_CONNECT = "br.radio.zapdmr.radio.CONNECT";
    static final String ACTION_QUICK_EXIT = "br.radio.zapdmr.radio.QUICK_EXIT";
    private String quickExitRequest;
    private volatile boolean destroyed;
    private final java.util.Set<android.media.ToneGenerator> activeTones=java.util.concurrent.ConcurrentHashMap.newKeySet();
    private volatile boolean startupReceiveOnly;
    static final String ACTION_DISCONNECT = "br.radio.zapdmr.radio.DISCONNECT";
    static final String ACTION_UNLINK = "br.radio.zapdmr.radio.UNLINK";
    static final String ACTION_TUNE = "br.radio.zapdmr.radio.TUNE";
    static final String ACTION_TARGET = "br.radio.zapdmr.radio.TARGET";
    static final String ACTION_USAGE_RESET = "br.radio.zapdmr.radio.USAGE_RESET";
    static final String ACTION_LOG_SNAPSHOT = "br.radio.zapdmr.radio.LOG_SNAPSHOT";
    static final String ACTION_LOG_CLEAR = "br.radio.zapdmr.radio.LOG_CLEAR";
    static final String ACTION_LOG = "br.radio.zapdmr.radio.LOG";
    static final String ACTION_PTT_DOWN = "br.radio.zapdmr.radio.PTT_DOWN";
    static final String ACTION_PTT_UP = "br.radio.zapdmr.radio.PTT_UP";
    static final String ACTION_PTT_TOGGLE = "br.radio.zapdmr.radio.PTT_TOGGLE";
    static final String ACTION_OPTIONS = "br.radio.zapdmr.radio.OPTIONS";
    static final String ACTION_AUDIO_LEVELS = "br.radio.zapdmr.radio.AUDIO_LEVELS";
    static final String ACTION_AUDIO_TEST = "br.radio.zapdmr.radio.AUDIO_TEST";
    static volatile boolean running;
    private final ReceiveGuard receiveGuard=new ReceiveGuard();
    private volatile boolean txHeaderSent,txStopping;
    private boolean guardAnnounced;
    private final Runnable guardRefresh=()->refreshReceiveGuard();
    private void refreshReceiveGuard(){boolean busy; synchronized(receiveGuard){busy=receiveGuard.busy(android.os.SystemClock.elapsedRealtime());} if(busy!=guardAnnounced){guardAnnounced=busy;emit("rxBusy",json("busy",busy));Log.i(TAG,busy?"Local RX interlock engaged":"Local RX interlock released");}controlsHandler.removeCallbacks(guardRefresh);if(busy)controlsHandler.postDelayed(guardRefresh,100);}
    private void localReception(int source,int destination,boolean individual,int slot,long stream,boolean end){
        synchronized(receiveGuard){
            boolean selected=privateTargetId>0?individual&&destination==settings.optInt("dmrId")&&source==privateTargetId:!individual&&destination==selectedTalkgroup&&slot==selectedSlot;
            if(!connected||!selected||source==settings.optInt("dmrId"))return;
            receiveGuard.configure(controls().optInt("rxProtectionMs",500));
            if(end)receiveGuard.end(stream,android.os.SystemClock.elapsedRealtime());else receiveGuard.voice(stream,android.os.SystemClock.elapsedRealtime());
        }
        controlsHandler.post(guardRefresh);
    }
    private void resetReceiveGuard(){receiveGuard.reset();controlsHandler.post(guardRefresh);}

    static final String ACTION_EVENT = "br.radio.zapdmr.radio.EVENT";
    static final String EXTRA_EVENT = "event";
    static final String EXTRA_DATA = "data";
    private static final String TAG = "ZapDMRRadio";
    private static final String CHANNEL_ID = "zapdmr-radio-session";
    private static final int NOTIFICATION_ID = 7242;
    private static final int RATE = 8000;
    private static final int FRAME_SAMPLES = 160;
    private static final int FRAME_BYTES = 320;
    private final Object socketLock = new Object();
    private final AtomicBoolean ptt = new AtomicBoolean(false);
    private final List<byte[]> txCodewords = new ArrayList<>();
    private volatile DatagramSocket socket;
    private volatile OpenTerminal terminal;
    private boolean useOpenTerminal(){return "odtp".equals(settings.optString("radioProtocol","hbp"));}
    private volatile Network activeNetwork;
    private volatile boolean networkRetry;
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback networkCallback=new ConnectivityManager.NetworkCallback(){
        @Override public void onAvailable(Network network){if(!network.equals(activeNetwork)){activeNetwork=network;recoverNetwork();}}
        @Override public void onLost(Network network){if(network.equals(activeNetwork)){activeNetwork=null;recoverNetwork();}}
    };
    private void recoverNetwork(){
        if(!sessionDesired)return;
        networkRetry=true;reconnectAttempt=0;selectionVersion++;resetReceiveGuard();connected=false;closeSocket();
        controlsHandler.postDelayed(()->{if(sessionDesired&&(networkThread==null||!networkThread.isAlive()))connectHbp();},1000);
    }

    private volatile Thread networkThread;
    private volatile AudioRecord recorder;
    private volatile Thread captureThread;
    private volatile AudioTrack player;
    private final Object playbackLock = new Object();
    private android.media.AudioFocusRequest focusRequest;
    private volatile boolean audioFocusGranted;
    private Boolean bluetoothRoute;
    private boolean bluetoothAudioActive;
    private long lastPlaybackError;
    private long lastCodecFailure;
    private volatile boolean audioFocusDelayed, audioFocusSuspended;
    private volatile long lastFocusRequest;
    private AudioAttributes rxAttributes(){return new AudioAttributes.Builder().setUsage(bluetoothAudioActive?AudioAttributes.USAGE_VOICE_COMMUNICATION:AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();}
    private final android.media.AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        boolean granted=change==android.media.AudioManager.AUDIOFOCUS_GAIN;
        audioFocusGranted=granted;
        audioFocusDelayed=!granted&&change!=android.media.AudioManager.AUDIOFOCUS_LOSS;
        if(!granted)lastFocusRequest=System.currentTimeMillis();
        synchronized(playbackLock){if(player!=null)try{player.pause();player.flush();}catch(Exception error){Log.w(TAG,"Foco RX",error);}}
        audioFocusSuspended=!granted;
        emit("audioFocus",json("available",granted,"message",granted?"Áudio RX retomado automaticamente.":"Áudio RX em pausa pelo Android; a receção continua. A aguardar liberação do foco."));
    };
    private boolean acquireAudioFocus(){
        if(audioFocusGranted)return true;
        long now=System.currentTimeMillis();
        if(audioFocusDelayed||now-lastFocusRequest<3000)return false;
        lastFocusRequest=now;
        android.media.AudioManager manager=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);
        if(manager.getMode()==android.media.AudioManager.MODE_IN_CALL)return false;
        int result;
        try{
            if(Build.VERSION.SDK_INT>=26){
                if(focusRequest==null)focusRequest=new android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(rxAttributes()).setAcceptsDelayedFocusGain(true).setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(focusListener,controlsHandler).build();
                result=manager.requestAudioFocus(focusRequest);
            }else result=manager.requestAudioFocus(focusListener,android.media.AudioManager.STREAM_MUSIC,android.media.AudioManager.AUDIOFOCUS_GAIN);
        }catch(Exception error){Log.w(TAG,"Pedido de foco RX",error);result=android.media.AudioManager.AUDIOFOCUS_REQUEST_FAILED;}
        audioFocusGranted=result==android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        audioFocusDelayed=Build.VERSION.SDK_INT>=26&&result==android.media.AudioManager.AUDIOFOCUS_REQUEST_DELAYED;
        if(!audioFocusGranted&&!audioFocusSuspended){audioFocusSuspended=true;emit("audioFocus",json("available",false,"message","Áudio RX em espera; a receção continua e será retomada quando o Android liberar o foco."));}
        if(audioFocusGranted&&audioFocusSuspended){audioFocusSuspended=false;emit("audioFocus",json("available",true,"message","Áudio RX retomado automaticamente."));}
        return audioFocusGranted;
    }
    private void abandonRxFocus(){
        android.media.AudioManager manager=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);
        if(Build.VERSION.SDK_INT>=26&&focusRequest!=null)manager.abandonAudioFocusRequest(focusRequest);else manager.abandonAudioFocus(focusListener);
        focusRequest=null;audioFocusGranted=false;audioFocusDelayed=false;audioFocusSuspended=false;lastFocusRequest=0;
    }
    private void releasePlayer(){synchronized(playbackLock){AudioTrack track=player;player=null;if(track!=null)try{track.pause();track.flush();track.release();}catch(Exception ignored){}}}

    private volatile VocoderHelper vocoder;
    private volatile JSONObject settings = new JSONObject();
    private volatile String password = "";
    private volatile String state = "disconnected";
    private volatile String stateMessage = "Desligado.";
    private volatile boolean sessionDesired;
    private volatile boolean connected;
    private volatile boolean autoReconnect;
    private volatile int selectedTalkgroup;
    private volatile int privateTargetId;
    private volatile boolean txPrivateCall;
    private volatile int reconnectAttempt;
    private final java.util.concurrent.atomic.AtomicLong usageRxBytes = new java.util.concurrent.atomic.AtomicLong();
    private final java.util.concurrent.atomic.AtomicLong usageTxBytes = new java.util.concurrent.atomic.AtomicLong();
    private long usageSince, lastUsageSaved;
    private RadioNotifications radioNotifications;
    private volatile int selectedSlot = 1;
    private volatile int txTalkgroup;
    private volatile int txSlot = 1;
    private volatile long streamId;
    private volatile int packetSequence;
    private volatile int voiceSequence;
    private volatile long lastMasterSeen;
    private volatile long lastTxMeterEvent;
    private volatile long lastRxMeterEvent;
    private volatile PowerManager.WakeLock wakeLock;
    private final android.os.Handler controlsHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private android.media.session.MediaSession mediaSession;
    private Runnable totCutoff,totWarning;
    private volatile long pttStartedAt;
    private long lastRxTone;
    private volatile boolean voxMonitor,voxTransmitting,voxNeedsSilence;
    private volatile AudioRecord voxRecorder;
    private volatile long voxLastLoud;
    private final AtomicBoolean testingAudio=new AtomicBoolean(false);
    private final AtomicBoolean linking=new AtomicBoolean(false);
    private volatile boolean transitionReconnect;
    private volatile boolean expectedTransitionClose;
    private final java.util.concurrent.atomic.AtomicInteger pendingLinks=new java.util.concurrent.atomic.AtomicInteger();
    private final java.util.concurrent.ExecutorService linkWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private volatile int linkedTalkgroup,linkedSlot=1;
    private volatile long selectionVersion;
    private void requestLink(int tg,int slot){
        if(useOpenTerminal()){OpenTerminal client=terminal;if(client!=null)try{client.select(tg==4000?0:tg,false);}catch(Exception error){emit("error",json("message",safeMessage(error)));}return;}
        final long version=++selectionVersion;
        if(tg<1||tg>0xffffff||!connected||privateTargetId>0)return;
        if(tg!=4000){releasePlayer();emitAudioLevel("RX",new byte[320],tg,0);stateMessage="TG "+tg+" selecionada em modo passivo. Receção depende da TG estática ou do primeiro PTT.";emit("link",json("talkgroupId",tg,"linked",false,"passive",true,"message",stateMessage));emitStatus();return;}
        pendingLinks.incrementAndGet();stopVoxMonitor();releasePlayer();emitAudioLevel("RX",new byte[320],tg,0);stateMessage="A trocar para TG "+tg+"…";emitStatus();
        linkWorker.execute(()->{
            try{
                if(version!=selectionVersion||!connected)return;
                if(ptt.get()||testingAudio.get())throw new java.io.IOException("Termine PTT ou teste antes de trocar TG.");
                linking.set(true);
                VocoderHelper codec=ensureVocoder();if(codec==null)throw new java.io.IOException("Vocoder indisponível para vinculação silenciosa.");
                List<byte[]> silence=new ArrayList<>();for(int i=0;i<18;i++)silence.add(codec.encodeFec(new byte[320]));
                if(tg==4000||networkFlag("unlinkPreviousTalkgroup","unlinkBeforeTalkgroup",true))silentLink(4000,linkedTalkgroup==0?slot:linkedSlot,silence);linkedTalkgroup=0;
                if(tg!=4000&&version==selectionVersion&&connected){
                    transitionReconnect=true;expectedTransitionClose=true;
                    sendHbp(idPacket("RPTCL",Integer.parseInt(settings.getString("dmrId")+settings.getString("essid"))));
                    networkRetry=true;connected=false;closeSocket();
                    long deadline=System.currentTimeMillis()+20000;
                    while(!connected&&sessionDesired&&version==selectionVersion&&System.currentTimeMillis()<deadline)Thread.sleep(50);
                    if(version!=selectionVersion)return;
                    if(!connected)throw new java.io.IOException("Não foi possível renovar a sessão HBP durante a troca.");
                    Thread.sleep(1000);
                }
                if(tg!=4000&&version==selectionVersion&&connected){silentLink(tg,slot,silence);linkedTalkgroup=tg;linkedSlot=slot;}
                if(version==selectionVersion){Log.i(TAG,"TG SWITCH "+tg+" concluído; sem microfone");emit("link",json("talkgroupId",tg,"linked",tg!=4000,"message",tg==4000?"TG dinâmica desconectada.":"TG "+tg+" sincronizada com o master."));}
            }catch(Exception error){Log.e(TAG,"TG SWITCH falhou",error);if(version==selectionVersion)emit("error",json("message","Falha ao trocar TG: "+safeMessage(error)));}
            finally{transitionReconnect=false;linking.set(false);pendingLinks.decrementAndGet();if(pendingLinks.get()==0)controlsHandler.postDelayed(this::startVoxMonitor,500);stateMessage=pendingLinks.get()>0?"A trocar para TG "+selectedTalkgroup+"…":"Ligado ao master; TG "+selectedTalkgroup+" selecionada.";emitStatus();}
        });
    }
    private void silentLink(int tg,int slot,List<byte[]> words)throws Exception{
        int rx=Integer.parseInt(settings.optString("rxFrequencyHz","0")),tx=Integer.parseInt(settings.optString("txFrequencyHz","0"));
        txPrivateCall=false;txTalkgroup=tg;txSlot=rx>0&&rx==tx?1:slot;packetSequence=0;streamId=new SecureRandom().nextInt()&0xffffffffL;if(streamId==0)streamId=1;
        int source=Integer.parseInt(settings.getString("dmrId"));boolean header=false;
        try{
            sendDmr(DmrFrameEngine.fullLc(tg,source,false),0x21);header=true;Thread.sleep(60);
            for(int i=0;i<6;i++){sendDmr(DmrFrameEngine.voiceBurst(words.subList(i*3,i*3+3),i,tg,source,false),i==0?0x10:i);Thread.sleep(60);}
        }finally{if(header&&connected)sendDmr(DmrFrameEngine.fullLc(tg,source,true),0x22);}
    }
    private JSONObject networkControls(){JSONObject console=settings.optJSONObject("console");JSONObject prefs=console==null?null:console.optJSONObject("network");return prefs==null?new JSONObject():prefs;}
    private boolean networkFlag(String rootKey,String consoleKey,boolean fallback){JSONObject console=networkControls();return console.has(consoleKey)?console.optBoolean(consoleKey,fallback):settings.optBoolean(rootKey,fallback);}
    private int maxReconnectAttempts(){JSONObject console=networkControls();return Math.max(1,Math.min(50,console.has("maxReconnectAttempts")?console.optInt("maxReconnectAttempts",5):settings.optInt("maxReconnectAttempts",5)));}
    private JSONObject usageData(){return json("rxBytes",usageRxBytes.get(),"txBytes",usageTxBytes.get(),"since",usageSince);}
    private synchronized void saveUsage(boolean force){long now=System.currentTimeMillis();if(!force&&now-lastUsageSaved<5000)return;lastUsageSaved=now;getSharedPreferences("zapdmr-network-usage",MODE_PRIVATE).edit().putLong("rx",usageRxBytes.get()).putLong("tx",usageTxBytes.get()).putLong("since",usageSince).apply();emit("usage",usageData());}
    private void resetUsage(){usageRxBytes.set(0);usageTxBytes.set(0);usageSince=System.currentTimeMillis();saveUsage(true);emitStatus();}
    private JSONObject controls(){return settings.optJSONObject("operation")==null?new JSONObject():settings.optJSONObject("operation");}
    private void tone(boolean start){
        if(!controls().optBoolean(start?"beepStart":"beepStop",false))return;
        playTone(start?android.media.ToneGenerator.TONE_PROP_BEEP:android.media.ToneGenerator.TONE_PROP_ACK);
    }
    private void playTone(int tone){if(destroyed||QuickExitState.blocked())return;try{android.media.ToneGenerator generator=new android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC,50);activeTones.add(generator);generator.startTone(tone,100);controlsHandler.postDelayed(()->{if(activeTones.remove(generator))generator.release();},200);}catch(Exception ignored){}}

    @Override public void onCreate() {
        super.onCreate();
        running=true;radioNotifications=new RadioNotifications(this);
        android.content.SharedPreferences usage=getSharedPreferences("zapdmr-network-usage",MODE_PRIVATE);usageRxBytes.set(usage.getLong("rx",0));usageTxBytes.set(usage.getLong("tx",0));usageSince=usage.getLong("since",System.currentTimeMillis());
        BluetoothSppController.get(this).configure(controls());
        connectivity=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        activeNetwork=connectivity.getActiveNetwork();
        try{connectivity.registerDefaultNetworkCallback(networkCallback);}catch(Exception error){Log.w(TAG,"Monitor de rede indisponível",error);}
        createNotificationChannel();
        mediaSession=new android.media.session.MediaSession(this,"ZapDMR PTT");
        mediaSession.setFlags(android.media.session.MediaSession.FLAG_HANDLES_MEDIA_BUTTONS|android.media.session.MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new android.media.session.MediaSession.Callback(){
            @Override public boolean onMediaButtonEvent(Intent intent){
                android.view.KeyEvent key=intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if(key==null||!controls().optBoolean("bluetoothPtt")||!remoteAllowed())return false;
                if(key.getKeyCode()!=android.view.KeyEvent.KEYCODE_HEADSETHOOK&&key.getKeyCode()!=android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE&&key.getKeyCode()!=android.view.KeyEvent.KEYCODE_MEDIA_PLAY)return false;
                if(key.getRepeatCount()!=0)return true;
                if(controls().optString("pttMode","toggle").equals("toggle")){if(key.getAction()==android.view.KeyEvent.ACTION_DOWN)togglePtt();}
                else if(key.getAction()==android.view.KeyEvent.ACTION_DOWN)startPtt(selectedTalkgroup,selectedSlot);else stopPtt();
                return true;
            }
        });
        mediaSession.setPlaybackState(new android.media.session.PlaybackState.Builder().setActions(android.media.session.PlaybackState.ACTION_PLAY_PAUSE|android.media.session.PlaybackState.ACTION_PLAY|android.media.session.PlaybackState.ACTION_PAUSE).setState(android.media.session.PlaybackState.STATE_PAUSED,0,1).build());
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if(ACTION_QUICK_EXIT.equals(action)){
            String request=intent.getStringExtra("requestId");
            if(request==null||request.length()!=36)return START_NOT_STICKY;
            if(ptt.get()||txStopping){broadcastEvent("quickExitResult",json("requestId",request,"ok",false,"message","Encerre a transmissão antes de sair."));return START_NOT_STICKY;}
            if(testingAudio.get()){broadcastEvent("quickExitResult",json("requestId",request,"ok",false,"message","Encerre o teste de áudio antes de sair."));return START_NOT_STICKY;}
            if(!QuickExitState.begin(false)){broadcastEvent("quickExitResult",json("requestId",request,"ok",false,"message","A saída já está em andamento."));return START_NOT_STICKY;}
            if(!getSharedPreferences(QuickExitState.PREFS,MODE_PRIVATE).edit().putBoolean(QuickExitState.RESUME,true).commit()){
                QuickExitState.cancel();broadcastEvent("quickExitResult",json("requestId",request,"ok",false,"message","Não foi possível guardar a retomada. Tente sair novamente."));return START_NOT_STICKY;
            }
            quickExitRequest=request;sessionDesired=false;autoReconnect=false;selectionVersion++;
            controlsHandler.removeCallbacksAndMessages(null);linkWorker.shutdownNow();
            stopNetwork(true);BluetoothSppController.get(this).close();
            state="disconnected";stateMessage="ZapDMR desconectado.";emit("status",statusData());
            stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;
        }
        if(QuickExitState.blocked()){stopSelf();return START_NOT_STICKY;}
        if (ACTION_CONNECT.equals(action)) {
            startForegroundCompat(NOTIFICATION_ID, notification("A iniciar sessão HBP…"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            try {
                sessionDesired = false;
                stopNetwork(false);
                settings = new JSONObject(intent.getStringExtra("settings") == null ? "{}" : intent.getStringExtra("settings"));
                configureBluetooth();BluetoothSppController.get(this).configure(controls());
                mediaSession.setActive(controls().optBoolean("bluetoothPtt"));
                if((controls().optBoolean("allowLocked")||controls().optBoolean("voxEnabled"))&&ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
                    startForegroundCompat(NOTIFICATION_ID,notification("A iniciar escuta passiva…"),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                password = intent.getStringExtra("password") == null ? "" : intent.getStringExtra("password");
                autoReconnect = intent.getBooleanExtra("autoReconnect", false);
                startupReceiveOnly=intent.getBooleanExtra("startupReceiveOnly",false);
                sessionDesired = true;reconnectAttempt=0;
                selectedTalkgroup = settings.optInt("selectedTalkgroupId", selectedTalkgroup);
                selectedSlot = settings.optInt("defaultSlot", selectedSlot) == 2 ? 2 : 1;
                prepareVocoder();
                connectHbp();
            } catch (Exception error) {
                fail("INVALID_PROFILE", "Perfil de ligação inválido: " + error.getMessage());
            }
        } else if (ACTION_DISCONNECT.equals(action)) {
            if(ptt.get()||txStopping){emit("error",json("message","Termine a transmissão antes de desconectar."));return START_NOT_STICKY;}
            sessionDesired = false;
            stopNetwork(true);
            state="disconnected";stateMessage="ZapDMR desconectado.";emit("status",statusData());
            stopSelf();
        } else if (ACTION_UNLINK.equals(action)) {
            privateTargetId=0;selectionVersion++;resetReceiveGuard();releasePlayer();
            if(terminal!=null){try{terminal.select(0,false);}catch(Exception error){emit("error",json("message",safeMessage(error)));}}
            else requestLink(4000,selectedSlot);
        } else if (ACTION_TARGET.equals(action)) {
            if(ptt.get()||testingAudio.get()||pendingLinks.get()>0){emit("error",json("message","Termine a transmissão ou troca atual antes de escolher um contacto."));return START_NOT_STICKY;}
            int destination=intent.getIntExtra("destinationId",0);String type=intent.getStringExtra("callType");
            if("group".equals(type)){privateTargetId=0;selectionVersion++;resetReceiveGuard();releasePlayer();stateMessage="TG "+selectedTalkgroup+" selecionada.";if(terminal!=null)try{terminal.select(selectedTalkgroup,false);}catch(Exception error){emit("error",json("message",safeMessage(error)));}emit("selection",statusData());emitStatus();return START_NOT_STICKY;}
            if(!"private".equals(type)||destination<1||destination>0xffffff||destination==settings.optInt("dmrId",0)){emit("error",json("message","O contacto precisa de um Radio ID válido para chamada individual."));return START_NOT_STICKY;}
            privateTargetId=destination;selectionVersion++;resetReceiveGuard();selectedSlot=intent.getIntExtra("slot",selectedSlot)==2?2:1;releasePlayer();emitAudioLevel("RX",new byte[320],destination,0);
            if(terminal!=null)try{terminal.select(destination,true);}catch(Exception error){emit("error",json("message",safeMessage(error)));}
            stateMessage="Contacto "+destination+" selecionado. Prima PTT para chamada individual.";emit("selection",statusData());emitStatus();
            if(sessionDesired&&!connected&&(networkThread==null||!networkThread.isAlive())){reconnectAttempt=0;connectHbp();}
        } else if (ACTION_USAGE_RESET.equals(action)) {
            resetUsage();
        } else if (ACTION_LOG_SNAPSHOT.equals(action)||ACTION_LOG_CLEAR.equals(action)) {
            if(ACTION_LOG_CLEAR.equals(action))RadioNotifications.clear();
            emit("systemLogSnapshot",json("entries",RadioNotifications.snapshot()));
        } else if (ACTION_LOG.equals(action)) {
            emit("systemLog",RadioNotifications.record(intent.getStringExtra("category"),intent.getStringExtra("message")));
        } else if (ACTION_TUNE.equals(action)) {
            // Selecting a destination is passive even for a custom TG 4000.
            // Only the explicit ACTION_UNLINK button may transmit that command.
            if(ptt.get()){emit("error",json("message","Termine a transmissão antes de trocar TG."));return START_NOT_STICKY;}
            synchronized(receiveGuard){
                privateTargetId=0;selectionVersion++;
                selectedTalkgroup = intent.getIntExtra("talkgroupId", 0);
                selectedSlot = intent.getIntExtra("slot", 1) == 2 ? 2 : 1;
                receiveGuard.reset();
            }
            controlsHandler.post(guardRefresh);
            releasePlayer();emitAudioLevel("RX",new byte[320],selectedTalkgroup,0);
            if(terminal!=null)try{terminal.select(selectedTalkgroup,false);}catch(Exception error){emit("error",json("message",safeMessage(error)));}
            stateMessage=useOpenTerminal()?"TG "+selectedTalkgroup+" — solicitando inscrição ODTP…":"Homebrew/HBP não oferece inscrição de TG sem PTT. Use ODTP num master compatível.";
            emit("selection", statusData());emit("link",json("talkgroupId",selectedTalkgroup,"linked",false,"passive",true,"message",stateMessage));emitStatus();
            if(sessionDesired&&!connected&&(networkThread==null||!networkThread.isAlive()))connectHbp();
        } else if (ACTION_PTT_DOWN.equals(action)) {
            startPtt(intent.getIntExtra("talkgroupId", selectedTalkgroup), intent.getIntExtra("slot", selectedSlot));
        } else if (ACTION_PTT_UP.equals(action)) {
            stopPtt();
        } else if (ACTION_PTT_TOGGLE.equals(action)) {
            if(remoteAllowed())togglePtt();
        } else if (ACTION_OPTIONS.equals(action)) {
            try {
                JSONObject updated=new JSONObject(settings.toString());
                if(intent.hasExtra("operation"))updated.put("operation",new JSONObject(intent.getStringExtra("operation")));
                if(intent.hasExtra("console"))updated.put("console",new JSONObject(intent.getStringExtra("console")));
                if(intent.hasExtra("settings")||intent.hasExtra("radioSettings")){
                    JSONObject runtime=new JSONObject(intent.getStringExtra(intent.hasExtra("radioSettings")?"radioSettings":"settings"));
                    for(String key:new String[]{"autoReconnect","maxReconnectAttempts","autoOpenTalkgroup","unlinkPreviousTalkgroup","sendLocationOnConnect","totEnabled","totLimitSeconds","totWarningSeconds","totVisualAlert","totSoundAlert"})if(runtime.has(key))updated.put(key,runtime.get(key));
                }
                settings=updated;autoReconnect=settings.optBoolean("autoReconnect",autoReconnect);
                configureBluetooth();BluetoothSppController.get(this).configure(controls());
                mediaSession.setActive(controls().optBoolean("bluetoothPtt"));
                if(ptt.get())armTot(pttStartedAt);
                if(!controls().optBoolean("voxEnabled")){stopVoxMonitor();if(voxTransmitting)stopPtt();}else startVoxMonitor();
                if(connected&&(controls().optBoolean("allowLocked")||controls().optBoolean("voxEnabled"))&&ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)
                    startForegroundCompat(NOTIFICATION_ID,notification("Escuta passiva · PTT pronto"),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                emitStatus();
            } catch(Exception error){emit("error",json("message","Não foi possível aplicar as opções de rádio: "+safeMessage(error)));}

        } else if(ACTION_AUDIO_LEVELS.equals(action)) {
            try{JSONObject updated=new JSONObject(settings.toString());updated.put("txGainPercent",Math.max(0,Math.min(260,intent.getIntExtra("txGainPercent",100))));updated.put("rxVolumePercent",Math.max(0,Math.min(260,intent.getIntExtra("rxVolumePercent",100))));settings=updated;emit("audioSettings",json("applied",true,"txGainPercent",settings.optInt("txGainPercent"),"rxVolumePercent",settings.optInt("rxVolumePercent")));}catch(Exception ignored){}
        } else if(ACTION_AUDIO_TEST.equals(action)) {
            runAudioTest(intent.getBooleanExtra("microphone",false));
        }
        return START_NOT_STICKY;
    }
    private boolean remoteAllowed(){android.app.KeyguardManager lock=(android.app.KeyguardManager)getSystemService(KEYGUARD_SERVICE);return controls().optBoolean("allowLocked")||lock==null||!lock.isKeyguardLocked();}
    private void togglePtt(){if(ptt.get())stopPtt();else startPtt(selectedTalkgroup,selectedSlot);}
    private void configureBluetooth(){
        boolean enabled=controls().optBoolean("bluetoothPtt");
        if(bluetoothRoute!=null&&bluetoothRoute==enabled)return;
        try{
            android.media.AudioManager audio=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);
            if(controls().optBoolean("bluetoothPtt")){
                if(Build.VERSION.SDK_INT>=31&&ContextCompat.checkSelfPermission(this,Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)return;
                boolean hasSco=false;
                if(Build.VERSION.SDK_INT>=23)for(android.media.AudioDeviceInfo device:audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS))if(device.getType()==android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO)hasSco=true;
                bluetoothAudioActive=hasSco;
                audio.setMode(hasSco?android.media.AudioManager.MODE_IN_COMMUNICATION:android.media.AudioManager.MODE_NORMAL);
                if(hasSco&&Build.VERSION.SDK_INT>=31){for(android.media.AudioDeviceInfo device:audio.getAvailableCommunicationDevices())if(device.getType()==android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO){audio.setCommunicationDevice(device);break;}}
                else if(hasSco){audio.startBluetoothSco();audio.setBluetoothScoOn(true);}
            }else{bluetoothAudioActive=false;if(Build.VERSION.SDK_INT>=31)audio.clearCommunicationDevice();else{audio.stopBluetoothSco();audio.setBluetoothScoOn(false);}audio.setMode(android.media.AudioManager.MODE_NORMAL);}
            bluetoothRoute=enabled;releasePlayer();abandonRxFocus();emit("systemLog",RadioNotifications.record("audio",bluetoothAudioActive?"Rota de áudio Bluetooth SCO ativa":"Rota de áudio multimédia/altifalante ativa"));
        }catch(Exception error){Log.w(TAG,"Rota Bluetooth indisponível",error);}
    }
    private void stopVoxMonitor(){voxMonitor=false;AudioRecord audio=voxRecorder;if(audio!=null)try{audio.stop();}catch(Exception ignored){}}
    private void startVoxMonitor(){
        if(startupReceiveOnly||QuickExitState.blocked())return;
        if(testingAudio.get()||pendingLinks.get()>0||voxMonitor||ptt.get()||!connected||!controls().optBoolean("voxEnabled")||!remoteAllowed()||ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)return;
        voxMonitor=true;
        new Thread(() -> {
            AudioRecord audio=null;boolean trigger=false;
            try{audio=createRecorder();voxRecorder=audio;audio.startRecording();short[] samples=new short[160];long above=0;
                while(voxMonitor&&!ptt.get()&&connected){int count=audio.read(samples,0,samples.length);if(count<=0)break;double sum=0;for(int i=0;i<count;i++)sum+=(double)samples[i]*samples[i];double db=20*Math.log10(Math.max(1e-6,Math.sqrt(sum/count)/32768));
                    if(db<controls().optDouble("voxThreshold",-35)){above=0;voxNeedsSilence=false;}
                    else if(!voxNeedsSilence){if(above==0)above=System.currentTimeMillis();if(System.currentTimeMillis()-above>=150){trigger=true;break;}}
                }
            }catch(Exception error){emit("error",json("message","VOX: "+safeMessage(error)));}
            finally{voxRecorder=null;voxMonitor=false;if(audio!=null){try{audio.stop();}catch(Exception ignored){}audio.release();}}
            if(trigger&&connected&&controls().optBoolean("voxEnabled")){controlsHandler.post(() -> {voxTransmitting=true;voxLastLoud=System.currentTimeMillis();startPtt(selectedTalkgroup,selectedSlot);if(!ptt.get())voxTransmitting=false;});}
        },"ZapDMR-VOX").start();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void prepareVocoder() {
        if (vocoder != null) vocoder.stop();
        try { FirmwareBundle.ensure(this,false,null); }
        catch(Exception error){vocoder=null;emit("vocoder",json("ready",false,"message","Falha ao preparar o firmware incluído no APK. Use Ativar / Reparar vocoder."));return;}
        FilePair files = firmwareFiles();
        if (!files.ready) { vocoder = null; emit("vocoder", json("ready", false, "message", "Use Ativar / Reparar vocoder nas Definições.")); return; }
        VocoderHelper helper = new VocoderHelper();
        if (helper.start(this, files.application, files.core)) {
            vocoder = helper;
            emit("vocoder", json("ready", true, "message", "Vocoder ARM pronto."));
        } else {
            helper.stop(); vocoder = null;
            emit("vocoder", json("ready", false, "message", "O codec Android ARM ainda não foi incluído neste build."));
        }
    }

    private static final class FilePair {
        final java.io.File application, core; final boolean ready;
        FilePair(java.io.File a, java.io.File c) { application=a; core=c; ready=a.isFile()&&a.length()==994304L&&c.isFile()&&c.length()==131072L; }
    }
    private FilePair firmwareFiles() {
        java.io.File dir = new java.io.File(getFilesDir(), "firmware");
        return new FilePair(new java.io.File(dir, "D002.032.bin"), new java.io.File(dir, "d02032-core.img"));
    }

    private synchronized void connectHbp() {
        if(QuickExitState.blocked()||!sessionDesired)return;
        if(networkThread!=null&&networkThread.isAlive())return;
        if (!validProfile()) { fail("INVALID_PROFILE", "Complete indicativo, Radio ID, ESSID, master e palavra-passe nas Definições."); return; }
        state = "resolving"; stateMessage = "A resolver o master "+(useOpenTerminal()?"ODTP":"HBP")+"…"; emitStatus();
        networkThread = new Thread(this::networkLoop, "ZapDMR-HBP-UDP");
        networkThread.start();
    }

    private boolean validProfile() {
        String call = settings.optString("callsign", "").trim();
        String id = settings.optString("dmrId", "").trim();
        String essid = settings.optString("essid", "").trim();
        String host = settings.optString("masterHost", "").trim();
        return call.matches("(?i)[A-Z0-9/ -]{1,8}") && id.matches("\\d{7}") && essid.matches("\\d{2}") &&
            host.matches("[a-zA-Z0-9.-]{1,180}") && !password.isEmpty() && password.length() <= 20;
    }

    private void networkLoop() {
        long retryDelay = 3000;
        while (sessionDesired) {
            try {
                connectAndReceive();
                if (!sessionDesired) break;
                throw new java.io.IOException("A sessão HBP terminou.");
            } catch (Exception error) {
                if (!sessionDesired) break;
                if(connected)retryDelay=3000;
                connected = false;
                state = "error";
                stateMessage = transitionReconnect?"A trocar TG · renovando sessão HBP…":"Ligação "+(useOpenTerminal()?"ODTP":"HBP")+" perdida: " + safeMessage(error);
                stopPtt();
                emitStatus();
                closeSocket();
                boolean retryNetwork=networkRetry||error instanceof java.net.SocketException||safeMessage(error).matches("(?is).*(ENETUNREACH|EHOSTUNREACH|Network is unreachable|No route).*" );
                networkRetry=false;
                boolean plannedClose=transitionReconnect&&expectedTransitionClose;expectedTransitionClose=false;
                if (!autoReconnect&&!retryNetwork&&!transitionReconnect) break;
                if(!plannedClose&&++reconnectAttempt>maxReconnectAttempts()){state="error";stateMessage="Reconexão interrompida após "+maxReconnectAttempts()+" tentativas. Toque em Ligar para tentar novamente.";emit("error",json("code","RECONNECT_LIMIT","message",stateMessage));emitStatus();break;}
                state = "reconnecting";
                stateMessage = plannedClose?"A renovar a sessão HBP para a TG selecionada…":"A tentar restabelecer a sessão HBP em " + (retryDelay / 1000) + " s (tentativa "+reconnectAttempt+"/"+maxReconnectAttempts()+")…";
                emitStatus();
                try { if(!plannedClose)Thread.sleep(retryDelay); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); break; }
                if(!plannedClose)retryDelay = retryDelay == 3000 ? 5000 : Math.min(15000, retryDelay + 5000);
            }
        }
        if (!sessionDesired) { connected = false; state = "disconnected"; stateMessage = "Desligado do master."; emitStatus(); }
    }

    private void connectAndReceive() throws Exception {
        String host = settings.getString("masterHost").trim();
        int port = settings.optInt("masterPort", 62031); if (port < 1 || port > 65535) port = 62031;
        Network network=connectivity==null?null:connectivity.getActiveNetwork();
        InetAddress ipv4=null;
        for(InetAddress candidate:network==null?InetAddress.getAllByName(host):network.getAllByName(host))if(candidate instanceof Inet4Address){ipv4=candidate;break;}
        if(!sessionDesired||QuickExitState.blocked())throw new java.io.IOException("Sessão encerrada antes da resolução do master.");
        if(ipv4==null)throw new java.net.SocketException("O master não tem endereço IPv4 acessível nesta rede.");
        DatagramSocket udp=new DatagramSocket(null);
        try{
            udp.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"),0));
            if(network!=null)network.bindSocket(udp);
            synchronized(socketLock){if(!sessionDesired||QuickExitState.blocked())throw new java.io.IOException("Sessão encerrada.");udp.connect(ipv4,port);udp.setSoTimeout(750);socket=udp;}
            Log.i(TAG,"HBP IPv4: "+ipv4.getHostAddress()+":"+port);
        }catch(Exception error){udp.close();throw error;}
        if(useOpenTerminal()){receiveTerminal(udp);return;}
        int hotspotId = Integer.parseInt(settings.getString("dmrId") + settings.getString("essid"));
        sendHbp(idPacket("RPTL", hotspotId));
        state = "waiting-login"; stateMessage = "A aguardar desafio do master…"; emitStatus();
        long deadline = System.currentTimeMillis() + 15000;
        long lastPing = System.currentTimeMillis();
        long seen = System.currentTimeMillis();
        int phase = 1;
        byte[] buffer = new byte[2048];
        while (sessionDesired && socket == udp) {
            if (phase < 4 && System.currentTimeMillis() > deadline) throw new java.net.SocketTimeoutException("O master não concluiu a autenticação HBP em 15 segundos.");
            if (phase == 4) {
                long now = System.currentTimeMillis();
                if (now - seen > 180000) throw new java.net.SocketTimeoutException("O master deixou de responder aos keepalives HBP.");
                if (now - lastPing >= 60000) { sendHbp(idPacket("RPTPING", hotspotId)); lastPing=now; }
            }
            try {
                DatagramPacket incoming = new DatagramPacket(buffer, buffer.length);
                udp.receive(incoming);usageRxBytes.addAndGet(incoming.getLength());saveUsage(false);
                byte[] packet = java.util.Arrays.copyOfRange(incoming.getData(), incoming.getOffset(), incoming.getOffset()+incoming.getLength());
                if (phase == 4) seen = lastMasterSeen = System.currentTimeMillis();
                String tag = new String(packet,0,Math.min(packet.length,7),StandardCharsets.US_ASCII);
                if (tag.startsWith("MSTNAK")) throw new java.io.IOException("O master rejeitou a sessão HBP; confira Radio ID, ESSID e Hotspot Security Password.");
                if (tag.startsWith("RPTACK")) {
                    if (phase == 1) {
                        if (packet.length < 10) throw new java.io.IOException("RPTACK sem desafio de autenticação.");
                        MessageDigest sha=MessageDigest.getInstance("SHA-256"); sha.update(packet,6,4); sha.update(password.getBytes(StandardCharsets.UTF_8));
                        ByteArrayOutputStream auth=new ByteArrayOutputStream(); auth.write("RPTK".getBytes(StandardCharsets.US_ASCII)); writeInt(auth,hotspotId); auth.write(sha.digest()); sendHbp(auth.toByteArray());
                        phase=2; state="waiting-auth"; stateMessage="A validar Hotspot Security Password…"; emitStatus();
                    } else if (phase == 2) {
                        sendHbp(configPacket(hotspotId)); phase=3; state="waiting-config"; stateMessage="A enviar configuração do hotspot…"; emitStatus();
                    } else if (phase == 3) {
                        phase=4; connected=true;reconnectAttempt=0; controlsHandler.post(this::startVoxMonitor); lastMasterSeen=seen=System.currentTimeMillis(); state="connected";
                        stateMessage="Ligado ao master; escuta passiva da TG selecionada."; linkedTalkgroup=0; acquireWakeLock(); emitStatus();
                    }
                    continue;
                }
                if (tag.startsWith("MSTPONG")) { seen=lastMasterSeen=System.currentTimeMillis(); continue; }
                if (tag.startsWith("MSTCL")) throw new java.io.IOException("O master encerrou a sessão HBP. Confira se outro dispositivo usa o mesmo Radio ID + ESSID.");
                if (phase == 4 && packet.length >= 55 && tag.startsWith("DMRD")) {
                    try{handleDmrFrame(packet);}catch(Exception error){
                        Log.e(TAG,"Quadro RX rejeitado; sessão HBP preservada",error);
                        if(System.currentTimeMillis()-lastCodecFailure>5000){lastCodecFailure=System.currentTimeMillis();emit("error",json("message","Falha no vocoder RX: "+safeMessage(error)));}
                        VocoderHelper broken=vocoder;vocoder=null;if(broken!=null)broken.stop();
                    }
                }
            } catch (java.net.SocketTimeoutException ignored) { }
        }
    }

    private void receiveTerminal(DatagramSocket udp) throws Exception {
        final long loginDeadline=System.currentTimeMillis()+15000;
        OpenTerminal client=new OpenTerminal(Integer.parseInt(settings.getString("dmrId")),password,this::sendHbp,new OpenTerminal.Listener(){
            private long previousCall=-1;
            public void authenticated(){connected=true;reconnectAttempt=0;state="connected";acquireWakeLock();controlsHandler.post(RadioSessionService.this::startVoxMonitor);emitStatus();}
            public void reception(String reception,int target,String message){stateMessage=message;emitStatus();}
            public void call(int source,int destination,boolean individual,long stream,boolean end){localReception(source,destination,individual,selectedSlot,stream,end);}
            public void voice(int source,int destination,boolean individual,byte[][] words) throws Exception {
                OpenTerminal rx=terminal;localReception(source,destination,individual,selectedSlot,rx==null?0:rx.stream(),false);
                boolean selected=privateTargetId>0?individual&&destination==settings.optInt("dmrId")&&source==privateTargetId:!individual&&destination==selectedTalkgroup;
                if(!selected||testingAudio.get()||ptt.get())return;
                emit("activity",json("talkgroupId",individual?source:destination,"lastActivityAt",System.currentTimeMillis(),"sourceId",source,"callType",individual?"private":"group","slot",selectedSlot,"global",false));
                final long selection=selectionVersion;VocoderHelper helper=ensureVocoder();if(helper==null)return;
                OpenTerminal current=terminal;long call=current==null?0:current.stream();
                if(previousCall!=call){previousCall=call;if(controls().optBoolean("beepIncoming"))playTone(android.media.ToneGenerator.TONE_PROP_BEEP);if(radioNotifications!=null){JSONObject log=radioNotifications.onVoice(source,destination,call,individual,settings);if(log!=null)emit("systemLog",log);}}
                try{for(byte[] word:words){byte[] pcm=helper.decodeFec(word);if(selection!=selectionVersion)return;emitAudioLevel("RX",pcm,individual?source:destination,source);playPcm(pcm);}}
                catch(Exception error){if(System.currentTimeMillis()-lastCodecFailure>5000){lastCodecFailure=System.currentTimeMillis();emit("error",json("message","Falha no vocoder RX: "+safeMessage(error)));}VocoderHelper broken=vocoder;vocoder=null;if(broken!=null)broken.stop();}
            }
        });
        terminal=client;client.start(privateTargetId>0?privateTargetId:selectedTalkgroup);if(privateTargetId>0)client.select(privateTargetId,true);
        byte[] data=new byte[2048];
        try{while(sessionDesired&&socket==udp){if(!connected&&System.currentTimeMillis()>loginDeadline)throw new java.io.IOException("ODTP não autenticado em 15 segundos; confira porta e suporte do master.");
            client.tick();try{DatagramPacket packet=new DatagramPacket(data,data.length);udp.receive(packet);usageRxBytes.addAndGet(packet.getLength());saveUsage(false);client.receive(java.util.Arrays.copyOfRange(packet.getData(),packet.getOffset(),packet.getOffset()+packet.getLength()));}catch(java.net.SocketTimeoutException ignored){}
        }}finally{if(terminal==client)terminal=null;client.close();}
    }

    private void handleDmrFrame(byte[] packet) throws Exception {
        int tg = read24(packet, 8);
        int flags = packet[15] & 255;
        boolean individual=(flags&0x40)!=0;int source=read24(packet,5);int ownId=Integer.parseInt(settings.getString("dmrId"));
        boolean selected=privateTargetId>0?individual&&tg==ownId&&source==privateTargetId:!individual&&tg==selectedTalkgroup&&((flags&0x80)==0?1:2)==selectedSlot;
        int kind=flags&0x3f;
        if(kind==0x21||kind==0x22||(flags&0x20)==0) localReception(source,tg,individual,(flags&0x80)==0?1:2,ByteBuffer.wrap(packet,16,4).getInt()&0xffffffffL,kind==0x22);
        if(selected&&(flags&0x3f)==0x21&&controls().optBoolean("beepIncoming")&&System.currentTimeMillis()-lastRxTone>1500){lastRxTone=System.currentTimeMillis();playTone(android.media.ToneGenerator.TONE_PROP_BEEP);}
        if((flags&0x20)!=0)Log.i(TAG,"RX DMRD TG "+tg+" origem "+read24(packet,5));
        JSONObject activity = json("talkgroupId", tg, "lastActivityAt", System.currentTimeMillis(), "sourceId", source, "callType",individual?"private":"group", "slot", (flags & 0x80) == 0 ? 1 : 2);
        emit("activity", activity);
        if(testingAudio.get()||linking.get()||pendingLinks.get()>0)return;
        // Observe all traffic delivered by the master; play only the passively selected TG.
        if (!selected) return;
        if ((flags & 0x20) != 0 || ((flags & 0x10) == 0 && (flags & 0x0f) > 5)) return;
        VocoderHelper helper=ensureVocoder(); if(helper==null) return;
        if(radioNotifications!=null){JSONObject log=radioNotifications.onVoice(source,tg,ByteBuffer.wrap(packet,16,4).getInt()&0xffffffffL,individual,settings);if(log!=null)emit("systemLog",log);}
        byte[] slot=java.util.Arrays.copyOfRange(packet,20,53);
        final long rxSelection=selectionVersion;
        for(byte[] ambe:DmrFrameEngine.extractVoice(slot)) {
            byte[] pcm=helper.decodeFec(ambe);
            if(rxSelection!=selectionVersion)return;
            emitAudioLevel("RX", pcm, individual?source:tg, source);
            playPcm(pcm);
        }
    }

    private void startPtt(int tg,int slot){try{beginPtt(tg,slot);}finally{emit("ptt",json("active",ptt.get(),"direction","TX"));}}
    private void beginPtt(int tg, int slot) {
        if(QuickExitState.blocked())return;
        OpenTerminal receiver=terminal;
        if(receiver!=null&&java.util.Arrays.asList("connecting","subscribing","authenticating","error","unsubscribed").contains(receiver.state())){emit("error",json("message","Aguarde a resposta da inscrição ODTP antes de transmitir."));return;}
        if(privateTargetId>0)tg=privateTargetId;
        if(testingAudio.get()||linking.get()||pendingLinks.get()>0){emit("error",json("message","Aguarde o teste ou vinculação silenciosa terminar."));return;}
        if(!remoteAllowed()){emit("error",json("message","Ative falar com ecrã bloqueado para transmitir nesta condição."));return;}
        if (!connected) { emit("error", json("message", "Ligue primeiro ao master HBP.")); return; }
        if (tg < 1 || tg > 0xffffff) { emit("error", json("message", "Selecione uma TalkGroup válida.")); return; }
        if (ensureVocoder() == null) { emit("error", json("message", "O vocoder ARM não está pronto. Use Ativar / Reparar vocoder nas Definições.")); return; }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            emit("error", json("message", "Autorize o microfone nas permissões do Android e tente novamente.")); return;
        }
        stopVoxMonitor();
        for(int wait=0;voxRecorder!=null&&wait<30;wait++)try{Thread.sleep(10);}catch(InterruptedException error){Thread.currentThread().interrupt();return;}
        if(voxRecorder!=null){emit("error",json("message","Aguarde o microfone VOX ficar disponível."));return;}
        synchronized(receiveGuard){if(txStopping){emit("error",json("message","Aguarde o encerramento do PTT anterior."));return;}if(receiveGuard.busy(android.os.SystemClock.elapsedRealtime())){emit("error",json("message","RX OCUPADO — AGUARDE"));emit("ptt",json("active",false));return;}if (!ptt.compareAndSet(false,true)) return;txHeaderSent=false;startupReceiveOnly=false;}
        try {
            int rx=Integer.parseInt(settings.optString("rxFrequencyHz","0")); int tx=Integer.parseInt(settings.optString("txFrequencyHz","0"));
            txPrivateCall=privateTargetId>0;txTalkgroup=tg; txSlot=(rx>0&&rx==tx)?1:(slot==2?2:1); voiceSequence=0; packetSequence=0;
            streamId=new SecureRandom().nextInt() & 0xffffffffL; if(streamId==0)streamId=1;
            sendDmr(DmrFrameEngine.fullLc(tg,Integer.parseInt(settings.getString("dmrId")),false,txPrivateCall),0x21);
            txHeaderSent=true;
            startForegroundCompat(NOTIFICATION_ID, notification("Transmitindo na TG " + tg), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            tone(true);
            AudioRecord audio=createRecorder(); recorder=audio; audio.startRecording();
            pttStartedAt=System.currentTimeMillis();armTot(pttStartedAt);
            captureThread=new Thread(() -> captureLoop(audio),"ZapDMR-TX-Audio"); captureThread.start();
            emit("ptt",json("active",true,"direction","TX","talkgroupId",tg,"callType",txPrivateCall?"private":"group"));
        } catch(Exception error) { stopRecorder(); stopPtt(); emit("error",json("message","Falha ao iniciar PTT: "+safeMessage(error))); }
    }

    private void armTot(long started){
        if(totCutoff!=null)controlsHandler.removeCallbacks(totCutoff);
        if(totWarning!=null)controlsHandler.removeCallbacks(totWarning);
        boolean enabled=settings.optBoolean("totEnabled",true);
        int limit=Math.max(30,Math.min(900,settings.optInt("totLimitSeconds",180)));
        int warning=Math.max(0,Math.min(limit-1,settings.optInt("totWarningSeconds",10)));
        long elapsed=Math.max(0,System.currentTimeMillis()-started);
        if(enabled){
            totCutoff=()->{voxNeedsSilence=true;stopPtt();emit("tot",json("active",false,"expired",true));};
            controlsHandler.postDelayed(totCutoff,Math.max(0,limit*1000L-elapsed));
            if(warning>0){totWarning=()->{if(settings.optBoolean("totSoundAlert",true))playTone(android.media.ToneGenerator.TONE_PROP_BEEP2);emit("tot",json("active",true,"startedAt",started,"limitSeconds",limit,"warningSeconds",warning,"visual",settings.optBoolean("totVisualAlert",true)));};controlsHandler.postDelayed(totWarning,Math.max(0,(limit-warning)*1000L-elapsed));}
        }
        emit("tot",json("active",enabled,"startedAt",started,"limitSeconds",limit,"warningSeconds",warning,"visual",settings.optBoolean("totVisualAlert",true)));
    }

    private AudioRecord createRecorder() {
        int min=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
        int size=Math.max(FRAME_BYTES*4,min>0?min:FRAME_BYTES*4);
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.M) return new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(size).build();
        return new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size);
    }

    private void captureLoop(AudioRecord audio) {
        short[] samples=new short[FRAME_SAMPLES]; ByteBuffer frame=ByteBuffer.allocate(FRAME_BYTES).order(ByteOrder.LITTLE_ENDIAN);
        try {
            while(ptt.get()) {
                int got=0; while(got<samples.length&&ptt.get()){int count=audio.read(samples,got,samples.length-got,AudioRecord.READ_BLOCKING);if(count<0)throw new java.io.IOException("Falha ao ler microfone: "+count);got+=count;}
                if(!ptt.get()||got!=samples.length)break;
                if(voxTransmitting){double sum=0;for(short sample:samples)sum+=(double)sample*sample;double db=20*Math.log10(Math.max(1e-6,Math.sqrt(sum/samples.length)/32768));if(db>=controls().optDouble("voxThreshold",-35))voxLastLoud=System.currentTimeMillis();if(System.currentTimeMillis()-voxLastLoud>=Math.max(300,Math.min(5000,controls().optInt("voxHangMs",1200))))break;}
                int gain=Math.max(0,Math.min(260,settings.optInt("txGainPercent",100)));
                frame.clear();for(short sample:samples){int amplified=sample*gain/100;frame.putShort((short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,amplified)));}
                emitAudioLevel("TX", frame.array(), txTalkgroup, Integer.parseInt(settings.getString("dmrId")));
                byte[] word=vocoder.encodeFec(frame.array());
                synchronized(txCodewords){txCodewords.add(word);if(txCodewords.size()==3){List<byte[]> burst=new ArrayList<>(txCodewords);txCodewords.clear();byte[] slot=DmrFrameEngine.voiceBurst(burst,voiceSequence,txTalkgroup,Integer.parseInt(settings.getString("dmrId")),txPrivateCall);int flags=voiceSequence==0?0x10:voiceSequence;sendDmr(slot,flags);voiceSequence=(voiceSequence+1)%6;}}
            }
        } catch(Exception error) { if(ptt.get())emit("error",json("message","Falha na captura/codificação TX: "+safeMessage(error))); }
        finally { stopPtt(); }
    }

    private void stopPtt() {
        final boolean closeTransmission;
        synchronized(receiveGuard){if(!ptt.getAndSet(false))return;txStopping=true;closeTransmission=txHeaderSent;txHeaderSent=false;}
        try {
        if(totCutoff!=null)controlsHandler.removeCallbacks(totCutoff);if(totWarning!=null)controlsHandler.removeCallbacks(totWarning);
        pttStartedAt=0;voxTransmitting=false;tone(false);emit("tot",json("active",false));
        controlsHandler.postDelayed(this::startVoxMonitor,700);
        AudioRecord active=recorder; if(active!=null)try{active.stop();}catch(Exception ignored){}
        Thread worker=captureThread; if(worker!=null&&worker!=Thread.currentThread())try{worker.join(500);}catch(InterruptedException error){Thread.currentThread().interrupt();}
        if(active!=null)try{active.release();}catch(Exception ignored){}
        captureThread=null; recorder=null;
        synchronized(txCodewords){txCodewords.clear();}
        try { if(closeTransmission&&connected&&txTalkgroup>0)sendDmr(DmrFrameEngine.fullLc(txTalkgroup,Integer.parseInt(settings.getString("dmrId")),true,txPrivateCall),0x22); } catch(Exception error){Log.w(TAG,"Falha no terminador DMR",error);}
        emit("ptt",json("active",false,"direction","TX"));
        startForegroundCompat(NOTIFICATION_ID,notification(connected?"Ligado · PTT em espera":"Ligação ZapDMR"),(controls().optBoolean("allowLocked")||controls().optBoolean("voxEnabled"))?ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } finally {txStopping=false;}
    }

    private void stopRecorder() { AudioRecord audio=recorder; recorder=null; if(audio!=null){try{audio.stop();}catch(Exception ignored){} try{audio.release();}catch(Exception ignored){}} }

    private boolean playPcm(byte[] pcm) {
        if(destroyed||QuickExitState.blocked())return false;
        synchronized(playbackLock){try {
            if(!acquireAudioFocus())return false; // Drop stale PCM; HBP and vocoder keep receiving while focus is unavailable.
            int volume=Math.max(0,Math.min(260,settings.optInt("rxVolumePercent",100)));
            if(volume!=100){pcm=pcm.clone();for(int i=0;i+1<pcm.length;i+=2){int sample=(short)(((pcm[i+1]&255)<<8)|(pcm[i]&255));int scaled=Math.max(-32768,Math.min(32767,sample*volume/100));pcm[i]=(byte)scaled;pcm[i+1]=(byte)(scaled>>8);}}
            AudioTrack track=player;
            if(track==null||track.getState()!=AudioTrack.STATE_INITIALIZED){
                int min=AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT);
                track=new AudioTrack.Builder().setAudioAttributes(rxAttributes())
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(Math.max(FRAME_BYTES*8,min>0?min:FRAME_BYTES*8)).setTransferMode(AudioTrack.MODE_STREAM).build();
                track.play();player=track;
            }
            if(track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)track.play();
            track.setVolume(1.0f);
            if(track.write(pcm,0,pcm.length,AudioTrack.WRITE_BLOCKING)!=pcm.length)throw new java.io.IOException("A saída não aceitou o áudio PCM.");
            return true;
        } catch(Exception error) { releasePlayer();if(System.currentTimeMillis()-lastPlaybackError>5000){lastPlaybackError=System.currentTimeMillis();emit("error",json("message","Falha na reprodução RX: "+safeMessage(error)));}return false; }}
    }
    private void runAudioTest(boolean microphone){
        if(ptt.get()||linking.get()||pendingLinks.get()>0||!testingAudio.compareAndSet(false,true)){emit("audioTest",json("ok",false,"message","Termine a transmissão ou o teste em curso antes de testar o áudio."));return;}
        stopVoxMonitor();
        new Thread(() -> {
            AudioRecord capture=null;
            try{
                for(int wait=0;voxRecorder!=null&&wait<30;wait++)Thread.sleep(10);
                VocoderHelper codec=ensureVocoder();if(codec==null)throw new java.io.IOException("O vocoder ARM não iniciou. Confira o firmware e a compatibilidade ARM deste dispositivo.");
                List<byte[]> frames=new ArrayList<>();
                if(microphone){
                    if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new java.io.IOException("Permita o microfone para gravar o teste local.");
                    startForegroundCompat(NOTIFICATION_ID,notification("Teste local do microfone · sem transmitir"),ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                    capture=createRecorder();capture.startRecording();
                    for(int f=0;f<150;f++){short[] samples=new short[160];int got=0;while(got<160){int count=capture.read(samples,got,160-got);if(count<=0)throw new java.io.IOException("Não foi possível capturar o microfone.");got+=count;}byte[] pcm=new byte[320];int gain=settings.optInt("txGainPercent",100);for(int i=0;i<160;i++){int sample=Math.max(-32768,Math.min(32767,samples[i]*gain/100));pcm[2*i]=(byte)sample;pcm[2*i+1]=(byte)(sample>>8);}frames.add(pcm);emitAudioLevel("TX",pcm,selectedTalkgroup,0);}
                    capture.stop();capture.release();capture=null;
                }else{
                    for(int f=0;f<30;f++){byte[] pcm=new byte[320];for(int i=0;i<160;i++){int sample=(int)(Math.sin(2*Math.PI*440*(f*160+i)/8000)*7000);pcm[2*i]=(byte)sample;pcm[2*i+1]=(byte)(sample>>8);}frames.add(pcm);}
                }
                for(byte[] pcm:frames){byte[] decoded=codec.decodeFec(codec.encodeFec(pcm));if(!playPcm(decoded))throw new java.io.IOException("A reprodução de áudio local falhou. Confira volume e saída do Android.");emitAudioLevel("RX",decoded,selectedTalkgroup,0);}
                Thread.sleep(250);
                emit("audioTest",json("ok",true,"message",microphone?"Microfone gravado e reproduzido pelo vocoder, sem transmitir. Compare a voz com ganhos diferentes.":"Tom codificado, descodificado e enviado à saída local. Confirme se ouviu o tom; nenhum PTT foi enviado."));
            }catch(Exception error){emit("audioTest",json("ok",false,"message","Teste local: "+safeMessage(error)));}
            finally{if(capture!=null){try{capture.stop();}catch(Exception ignored){}capture.release();}testingAudio.set(false);if(connected)controlsHandler.postDelayed(this::startVoxMonitor,700);else if(!sessionDesired)stopSelf();}
        },"ZapDMR-Audio-Test").start();
    }

    private void sendDmr(byte[] slot,int flags) throws Exception {
        if(!connected||socket==null)throw new java.io.IOException("Sessão HBP desligada.");
        OpenTerminal client=terminal;
        if(useOpenTerminal()&&client==null)throw new java.io.IOException("Sessão ODTP encerrada.");
        if(client!=null){
            int kind=flags&0x3f;
            if(kind==0x21||kind==0x22)client.transmit(kind==0x21?0x911:0x912,OpenTerminal.header(txTalkgroup,Integer.parseInt(settings.getString("dmrId")),txPrivateCall));
            else{ByteArrayOutputStream words=new ByteArrayOutputStream();for(byte[] word:DmrFrameEngine.extractVoice(slot))words.write(word);client.transmit(0x920,words.toByteArray());}
            return;
        }
        byte[] out=new byte[55]; System.arraycopy("DMRD".getBytes(StandardCharsets.US_ASCII),0,out,0,4);
        out[4]=(byte)(packetSequence++ & 255); put24(out,5,Integer.parseInt(settings.getString("dmrId"))); put24(out,8,txTalkgroup);
        long hotspot=Long.parseLong(settings.getString("dmrId")+settings.getString("essid")); put32(out,11,hotspot);
        out[15]=(byte)((flags&0x3f)|(txPrivateCall?0x40:0)|(txSlot==2?0x80:0)); put32(out,16,streamId);
        System.arraycopy(slot,0,out,20,33);
        sendHbp(out);
    }

    private void sendHbp(byte[] bytes) throws Exception {
        if(QuickExitState.blocked()){
            boolean closeHbp=bytes.length>=5&&new String(bytes,0,5,StandardCharsets.US_ASCII).equals("RPTCL");
            int type=bytes.length>=18&&bytes[0]=='R'&&bytes[1]=='E'?((bytes[8]&255)|((bytes[9]&255)<<8)):-1;
            if(!closeHbp&&type!=0x902&&type!=1)throw new java.io.IOException("ZapDMR encerrando a sessão.");
        }
        DatagramSocket active=socket;if(active==null)throw new java.io.IOException("Socket UDP encerrado.");
        synchronized(socketLock){if(socket!=active)throw new java.io.IOException("Sessão UDP encerrada.");try{synchronized(receiveGuard){
            if(receiveGuard.blocksPacket(bytes,android.os.SystemClock.elapsedRealtime()))throw new java.io.IOException("RX OCUPADO — AGUARDE");
            active.send(new DatagramPacket(bytes,bytes.length));usageTxBytes.addAndGet(bytes.length);saveUsage(false);}}catch(java.net.SocketException error){networkRetry=true;selectionVersion++;resetReceiveGuard();connected=false;closeSocket();throw error;}}
    }

    private byte[] idPacket(String tag,int id) { ByteArrayOutputStream out=new ByteArrayOutputStream();try{out.write(tag.getBytes(StandardCharsets.US_ASCII));writeInt(out,id);}catch(Exception ignored){}return out.toByteArray(); }
    private byte[] configPacket(int hotspotId) throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write("RPTC".getBytes(StandardCharsets.US_ASCII));writeInt(out,hotspotId);
        String rx=frequency(settings.optString("rxFrequencyHz","433500000")),tx=frequency(settings.optString("txFrequencyHz","433500000"));
        field(out,settings.optString("callsign","").toUpperCase(),8);field(out,rx,9);field(out,tx,9);field(out,"01",2);field(out,"01",2);
        boolean sendLocation=networkFlag("sendLocationOnConnect","sendLocation",false)&&validLocation();
        field(out,coord(sendLocation?settings.optString("latitude","0"):"0",8,2),8);field(out,coord(sendLocation?settings.optString("longitude","0"):"0",9,3),9);field(out,"001",3);
        field(out,sendLocation?settings.optString("locationName",""):"",20);field(out,"ZapDMR Android hotspot",19);field(out,rx.equals(tx)?"4":"3",1);
        field(out,"",124);field(out,"20261016_ZapDMR",40);field(out,"MMDVM_ZapDMR",40);
        byte[] packet=out.toByteArray(); if(packet.length!=302)throw new java.io.IOException("Pacote RPTC inválido: "+packet.length);return packet;
    }
    private boolean validLocation(){try{if(settings.optString("latitude").trim().isEmpty()||settings.optString("longitude").trim().isEmpty())return false;double lat=Double.parseDouble(settings.optString("latitude")),lon=Double.parseDouble(settings.optString("longitude"));return !Double.isNaN(lat)&&!Double.isNaN(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}catch(Exception error){return false;}}
    private static String frequency(String value){return value.matches("\\d{9}")?value:"433500000";}
    private static String coord(String text,int width,int degreeDigits){try{double value=Double.parseDouble(text);String sign=value<0?"-":"";String[] parts=String.format(java.util.Locale.US,"%.4f",Math.abs(value)).split("\\.");String formatted=sign+String.format(java.util.Locale.US,"%0"+degreeDigits+"d.%s",Integer.parseInt(parts[0]),parts[1]);return String.format(java.util.Locale.US,"%"+width+"s",formatted).replace(' ','0').substring(0,width);}catch(Exception error){return degreeDigits==2?"0.000000":"00.000000";}}
    private static void field(ByteArrayOutputStream out,String value,int size){String clean=value.replaceAll("[^\\x20-\\x7e]","");byte[] b=clean.substring(0,Math.min(clean.length(),size)).getBytes(StandardCharsets.US_ASCII);out.write(b,0,b.length);for(int i=b.length;i<size;i++)out.write(' ');}
    private static void writeInt(ByteArrayOutputStream out,long n){out.write((int)(n>>>24)&255);out.write((int)(n>>>16)&255);out.write((int)(n>>>8)&255);out.write((int)n&255);}
    private static void put24(byte[] out,int offset,long n){out[offset]=(byte)(n>>>16);out[offset+1]=(byte)(n>>>8);out[offset+2]=(byte)n;}
    private static void put32(byte[] out,int offset,long n){out[offset]=(byte)(n>>>24);out[offset+1]=(byte)(n>>>16);out[offset+2]=(byte)(n>>>8);out[offset+3]=(byte)n;}
    private static int read24(byte[] in,int at){return ((in[at]&255)<<16)|((in[at+1]&255)<<8)|(in[at+2]&255);}

    private void startForegroundCompat(int id,Notification notification,int type) {
        if(destroyed||QuickExitState.blocked())return;
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q)startForeground(id,notification,type|ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(id,notification);
    }
    private Notification notification(String text) {
        JSONObject console=settings.optJSONObject("console"),prefs=console==null?null:console.optJSONObject("notifications");
        if(prefs!=null&&!prefs.optBoolean("persistent",true))text="Sessão de rádio em execução";
        else if(connected)text=(privateTargetId>0?"Individual "+privateTargetId:"TG "+selectedTalkgroup)+" · "+text;
        Intent stop=new Intent(this,RadioSessionService.class).setAction(ACTION_DISCONNECT);
        PendingIntent pending=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this,CHANNEL_ID).setSmallIcon(android.R.drawable.stat_sys_upload_done).setContentTitle("ZapDMR · rádio móvel")
            .setContentText(text).setOngoing(true).setCategory(NotificationCompat.CATEGORY_SERVICE).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Desligar",pending).build();
    }
    private void createNotificationChannel(){if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O){NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID,"Sessão de rádio ZapDMR",NotificationManager.IMPORTANCE_LOW));}}
    private void acquireWakeLock(){try{PowerManager pm=(PowerManager)getSystemService(Context.POWER_SERVICE);if(wakeLock==null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ZapDMR:RadioSession");wakeLock.setReferenceCounted(false);}if(!wakeLock.isHeld())wakeLock.acquire();}catch(Exception error){Log.w(TAG,"Wake lock não disponível",error);}}
    private void releaseWakeLock(){try{if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();}catch(Exception ignored){} }
    private JSONObject statusData(){OpenTerminal client=terminal;return json("protocol",useOpenTerminal()?"odtp":"hbp","reception",json("protocol",useOpenTerminal()?"odtp":"hbp","supported",useOpenTerminal(),"state",client!=null?client.state():useOpenTerminal()?state:connected?"unsupported":state,"targetTalkgroupId",client!=null?client.target():selectedTalkgroup,"message",client!=null?client.message():useOpenTerminal()?stateMessage:connected?"Homebrew/HBP não oferece inscrição sem PTT. Use ODTP num master compatível.":stateMessage),"state",state,"connected",connected,"rxBusy",receiveGuard.busy(android.os.SystemClock.elapsedRealtime()),"pttReady",connected&&vocoder!=null&&!linking.get()&&pendingLinks.get()==0,"talkgroupBurstActive",pendingLinks.get()>0,"voiceCodecAvailable",vocoder!=null,"talkgroupId",selectedTalkgroup,"target",json("id",privateTargetId>0?privateTargetId:selectedTalkgroup,"callType",privateTargetId>0?"private":"group"),"usage",usageData(),"reconnectAttempt",reconnectAttempt,"maxReconnectAttempts",maxReconnectAttempts(),"transitionReconnect",transitionReconnect,"message",stateMessage);}
    private void emitStatus(){emit("status",statusData());int type=ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;if(ptt.get()||(connected&&(controls().optBoolean("allowLocked")||controls().optBoolean("voxEnabled"))&&ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED))type|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;startForegroundCompat(NOTIFICATION_ID,notification(stateMessage),type);}
    private void emit(String event,JSONObject data){if(destroyed)return;broadcastEvent(event,data);if(radioNotifications!=null){JSONObject entry=radioNotifications.onEvent(event,data,settings);if(entry!=null)broadcastEvent("systemLog",entry);}}
    private void broadcastEvent(String event,JSONObject data){if(destroyed&&!"quickExitResult".equals(event))return;Intent message=new Intent(ACTION_EVENT).setPackage(getPackageName()).putExtra(EXTRA_EVENT,event).putExtra(EXTRA_DATA,data==null?"{}":data.toString());sendBroadcast(message);}
    private void fail(String code,String message){state="error";stateMessage=message;emit("error",json("code",code,"message",message));emitStatus();}
    private static JSObject json(Object... pairs){JSObject result=new JSObject();for(int i=0;i+1<pairs.length;i+=2)result.put(String.valueOf(pairs[i]),pairs[i+1]);return result;}

    private VocoderHelper ensureVocoder() {
        if(destroyed||QuickExitState.blocked())return null;
        VocoderHelper current = vocoder;
        if (current != null && current.isAlive()) return current;
        java.io.File executable = new java.io.File(getApplicationInfo().nativeLibraryDir, "libqso_dmr_vocoder_helper.so");
        if (!executable.isFile() || !executable.canExecute()) return null;
        prepareVocoder();
        return vocoder;
    }

    private void emitAudioLevel(String direction, byte[] pcm, int tg, int sourceId) {
        long now = System.currentTimeMillis();
        if ("TX".equals(direction)) { if (now - lastTxMeterEvent < 80) return; lastTxMeterEvent = now; }
        else { if (now - lastRxMeterEvent < 80) return; lastRxMeterEvent = now; }
        long sum = 0; int samples = pcm.length / 2;
        for (int i = 0; i + 1 < pcm.length; i += 2) {
            int value = (short)(((pcm[i + 1] & 0xff) << 8) | (pcm[i] & 0xff));
            sum += (long)value * value;
        }
        double rms = Math.sqrt((double)sum / Math.max(1, samples));
        double dbfs=20*Math.log10(Math.max(1e-6,rms/32768.0));
        int level=dbfs<=-54?0:Math.max(0,Math.min(100,(int)Math.round((dbfs+54)*100/48)));
        emit("audioLevel", json("direction", direction, "level", level, "talkgroupId", tg, "sourceId", sourceId,"callType",("TX".equals(direction)?txPrivateCall:privateTargetId>0)?"private":"group"));
    }
    private String safeMessage(Exception e){return e.getMessage()==null?e.getClass().getSimpleName():e.getMessage();}

    private void closeSocket(){DatagramSocket active=socket;socket=null;if(active!=null)active.close();}
    private void stopNetwork(boolean sendClose){
        stopVoxMonitor();stopPtt(); DatagramSocket active=socket;
        OpenTerminal client=terminal;if(client!=null){terminal=null;client.close();}
        if(!useOpenTerminal()&&sendClose&&active!=null&&connected){try{long id=Long.parseLong(settings.getString("dmrId")+settings.getString("essid"));ByteArrayOutputStream close=new ByteArrayOutputStream();close.write("RPTCL".getBytes(StandardCharsets.US_ASCII));writeInt(close,id);synchronized(socketLock){active.send(new DatagramPacket(close.toByteArray(),close.size()));usageTxBytes.addAndGet(close.size());saveUsage(false);}}catch(Exception ignored){}}
        connected=false;closeSocket();Thread t=networkThread;networkThread=null;if(t!=null&&t!=Thread.currentThread()){t.interrupt();try{t.join(750);}catch(InterruptedException error){Thread.currentThread().interrupt();}}releaseWakeLock();
        releasePlayer();abandonRxFocus();
        if(vocoder!=null){vocoder.stop();vocoder=null;}
        resetReceiveGuard();
    }

    @Override public void onDestroy(){destroyed=true;boolean cleaned=false;try{for(android.media.ToneGenerator tone:activeTones)try{tone.release();}catch(Exception ignored){}activeTones.clear();BluetoothSppController.get(this).close();saveUsage(true);try{if(connectivity!=null)connectivity.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}android.media.AudioManager focusManager=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);if(Build.VERSION.SDK_INT>=26&&focusRequest!=null)focusManager.abandonAudioFocusRequest(focusRequest);else focusManager.abandonAudioFocus(focusListener);audioFocusGranted=false;running=false;sessionDesired=false;selectionVersion++;resetReceiveGuard();linkWorker.shutdownNow();stopNetwork(false);controlsHandler.removeCallbacksAndMessages(null);if(mediaSession!=null)mediaSession.release();try{android.media.AudioManager audio=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);if(Build.VERSION.SDK_INT>=31)audio.clearCommunicationDevice();else audio.stopBluetoothSco();audio.setMode(android.media.AudioManager.MODE_NORMAL);}catch(Exception ignored){}cleaned=true;}finally{stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();if(quickExitRequest!=null){QuickExitState.complete();broadcastEvent("quickExitResult",json("requestId",quickExitRequest,"ok",cleaned,"message",cleaned?"Sessão encerrada.":"Não foi possível concluir a limpeza do rádio."));}}}
}
