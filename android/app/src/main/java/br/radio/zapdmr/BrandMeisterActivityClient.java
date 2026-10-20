package br.radio.zapdmr;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.net.URI;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Read-only public Last Heard feed. It has no reference to the HBP socket or PTT. */
final class BrandMeisterActivityClient {
    interface Listener { void onEvent(String event, JSONObject data); }
    private static final String[] URLS = {
        "wss://api.brandmeister.network/lh/socket.io/?EIO=4&transport=websocket",
        "wss://hose.brandmeister.network/socket.io/?EIO=4&transport=websocket"
    };
    private final Listener listener;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "ZapDMR-LastHeard"); thread.setDaemon(true); return thread;
    });
    private final Map<Integer, Set<String>> sessions = new HashMap<>();
    private final Map<Integer, Long> lastActivity = new HashMap<>();
    private volatile Set<Integer> watched = Collections.emptySet();
    private WebSocketClient socket;
    private ScheduledFuture<?> retry;
    private boolean closed, started, namespaceReady;
    private int endpoint, attempt;
    private long lastPing, pingDeadline = 45000;

    BrandMeisterActivityClient(Listener listener) { this.listener = listener; }
    void watch(Set<Integer> ids) { watched = new HashSet<>(ids); }
    synchronized void start() {
        if (started || closed) return;
        started = true;
        worker.scheduleAtFixedRate(() -> {
            synchronized (this) {
                if (socket != null && System.currentTimeMillis() - lastPing > (namespaceReady ? pingDeadline : 15000)) socket.close();
            }
        }, 5, 5, TimeUnit.SECONDS);
        connect();
    }
    private synchronized void connect() {
        if (closed || socket != null) return;
        status("connecting", "Last Heard global: a ligar…");
        namespaceReady = false; lastPing = System.currentTimeMillis();
        Map<String,String> headers = new HashMap<>();
        headers.put("Origin", "https://brandmeister.network");
        headers.put("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
        try {
            WebSocketClient next = new WebSocketClient(new URI(URLS[endpoint++ % URLS.length]), headers) {
                @Override public void onOpen(ServerHandshake handshake) { }
                @Override public void onMessage(String text) {
                    synchronized (BrandMeisterActivityClient.this) { if (socket == this) handle(text); }
                }
                @Override public void onClose(int code, String reason, boolean remote) {
                    synchronized (BrandMeisterActivityClient.this) {
                        if (socket != this || closed) return;
                        socket = null; clearSessions(); scheduleRetry();
                    }
                }
                @Override public void onError(Exception error) {
                    if (!closed) status("reconnecting", "Last Heard global: ligação pública indisponível; a tentar novamente…");
                }
            };
            next.setConnectionLostTimeout(30);
            socket = next; next.connect();
        } catch (Exception error) { socket = null; scheduleRetry(); }
    }
    private synchronized void scheduleRetry() {
        if (closed || (retry != null && !retry.isDone())) return;
        int[] delays = {3,5,10,15,30}; int delay = delays[Math.min(attempt++,delays.length-1)];
        status("reconnecting", "Last Heard global: nova tentativa em " + delay + " s.");
        retry = worker.schedule(() -> { synchronized (this) { retry = null; connect(); } }, delay, TimeUnit.SECONDS);
    }
    private void send(String packet) { if (socket != null && socket.isOpen()) socket.send(packet); }
    private void handle(String packet) {
        try {
            if (packet.startsWith("0")) {
                JSONObject open = new JSONObject(packet.substring(1));
                pingDeadline = Math.max(10000, open.optLong("pingInterval",25000) + open.optLong("pingTimeout",20000));
                lastPing = System.currentTimeMillis(); send("40"); return;
            }
            if (packet.startsWith("2")) { lastPing = System.currentTimeMillis(); send("3" + packet.substring(1)); return; }
            if (packet.startsWith("40")) {
                namespaceReady = true; attempt = 0; lastPing = System.currentTimeMillis();
                send("42[\"join\",\"everything\"]"); status("connected", "Last Heard global: conectado."); return;
            }
            if (packet.startsWith("41") || packet.equals("1")) { if (socket != null) socket.close(); return; }
            if (!packet.startsWith("42")) return;
            JSONArray envelope = new JSONArray(packet.substring(2));
            if (!"mqtt".equals(envelope.optString(0))) return;
            JSONObject call = decode(envelope.opt(1), null, 0);
            if (call == null && envelope.length() > 2) call = decode(envelope.opt(2), envelope.optString(1), 0);
            if (call == null) return;
            int id = call.optInt("talkgroupId");
            if (!watched.contains(id)) return;
            String action = call.optString("event").toLowerCase(java.util.Locale.ROOT);
            String source = call.optString("sourceId",call.optString("lastCallerCallsign","default"));
            Set<String> active = sessions.computeIfAbsent(id, ignored -> new HashSet<>());
            if (action.equals("session-start") || action.equals("session-update") || action.equals("start") || action.equals("update")) active.add(source);
            if (action.equals("session-stop") || action.equals("stop")) active.remove(source);
            if (active.isEmpty()) sessions.remove(id);
            long now = System.currentTimeMillis(); lastActivity.put(id,now);
            call.put("lastActivityAt",now).put("active",!active.isEmpty()).put("global",true);
            listener.onEvent("activity",call);
        } catch (Exception malformed) { /* Ignore unrelated or malformed public events. */ }
    }
    static JSONObject decode(Object value, String inheritedTopic, int depth) {
        if (depth > 8 || value == null || value == JSONObject.NULL) return null;
        try {
            if (value instanceof String) {
                Object parsed = new JSONTokener((String)value).nextValue();
                if (parsed instanceof String && parsed.equals(value)) return null;
                return decode(parsed,inheritedTopic,depth+1);
            }
            if (value instanceof JSONArray) {
                JSONArray array=(JSONArray)value;
                for(int i=0;i<array.length();i++){JSONObject result=decode(array.opt(i),inheritedTopic,depth+1);if(result!=null)return result;}
                return null;
            }
            if (!(value instanceof JSONObject)) return null;
            JSONObject object=(JSONObject)value;
            String topic=text(field(object,"topic")); if(topic.isEmpty())topic=inheritedTopic==null?"":inheritedTopic;
            for(String key:new String[]{"payload","data","message","call"}){
                JSONObject nested=decode(field(object,key),topic,depth+1);if(nested!=null)return nested;
            }
            Object destination=field(object,"DestinationID","Talkgroup","TG");
            int id=0;
            try { id=Integer.parseInt(text(destination).replaceFirst("(?i)^TG\\s*", "")); } catch(Exception ignored) { }
            if(id==0){java.util.regex.Matcher match=java.util.regex.Pattern.compile("(?:^|/)DMR/Voice/(\\d+)(?:/|$)",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(topic);if(match.find())id=Integer.parseInt(match.group(1));}
            if(id>0&&id<=0xffffff){
                String event=text(field(object,"Event","Action"));
                if(event.isEmpty()){
                    Object stop=field(object,"Stop");
                    if(stop!=null&&!text(stop).equals("0")&&!text(stop).equalsIgnoreCase("false"))event="Session-Stop";
                    else if(field(object,"Start")!=null)event="Session-Start";
                }
                String callType=text(field(object,"CallType","Type"));
                if(callType.toLowerCase(java.util.Locale.ROOT).contains("private"))return null;
                if(event.isEmpty()&&!topic.toLowerCase(java.util.Locale.ROOT).contains("dmr/voice/")&&field(object,"SourceID","SourceCall")==null)return null;
                String city=text(field(object,"SourceCity","City")), state=text(field(object,"SourceState","State","Province"));
                String location=text(field(object,"SourceLocation","Location"));
                if(location.isEmpty())location=city+(city.isEmpty()||state.isEmpty()?"":", ")+state;
                return new JSONObject().put("talkgroupId",id).put("sourceId",text(field(object,"SourceID")))
                    .put("lastCallerCallsign",text(field(object,"SourceCall","SourceCallsign","Callsign")))
                    .put("lastCallerName",text(field(object,"SourceName","Name"))).put("location",location)
                    .put("country",text(field(object,"SourceCountry","Country"))).put("event",event);
            }
            for(String key:new String[]{"payload","data","message","call"}){
                JSONObject nested=decode(field(object,key),topic,depth+1);if(nested!=null)return nested;
            }
        } catch(Exception malformed) { }
        return null;
    }
    private static Object field(JSONObject object,String...names){
        for(String name:names){Iterator<String> keys=object.keys();while(keys.hasNext()){String key=keys.next();if(key.equalsIgnoreCase(name)&&!object.isNull(key))return object.opt(key);}}
        return null;
    }
    private static String text(Object value){return value==null||value==JSONObject.NULL?"":String.valueOf(value).trim();}
    private void status(String state,String message){try{listener.onEvent("lastHeard",new JSONObject().put("state",state).put("message",message));}catch(Exception ignored){}}
    private void clearSessions(){
        for(Integer id:sessions.keySet())try{listener.onEvent("activity",new JSONObject().put("talkgroupId",id).put("active",false).put("global",true).put("lastActivityAt",lastActivity.getOrDefault(id,0L)));}catch(Exception ignored){}
        sessions.clear();
    }
    synchronized void close(){closed=true;if(retry!=null)retry.cancel(false);if(socket!=null)socket.close();socket=null;worker.shutdownNow();sessions.clear();}
}
