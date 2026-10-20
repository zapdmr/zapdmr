package br.radio.zapdmr;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;

/** Local operational log and alerts for actual radio packets, never the global directory feed. */
final class RadioNotifications {
    private static final ArrayDeque<JSONObject> LOG = new ArrayDeque<>();
    private static long logSequence;
    private final Context context;
    private final Map<Long, Long> seenStreams = new LinkedHashMap<>();
    private String lastState = "disconnected";
    private String lastStatusMessage = "";
    private boolean wasConnected;
    private long lastConnectionAlert;

    RadioNotifications(Context context) { this.context = context.getApplicationContext(); }

    static synchronized JSONObject record(String category, String message) {
        JSONObject entry = new JSONObject();
        try {
            entry.put("id", ++logSequence);
            entry.put("timestamp", System.currentTimeMillis());
            entry.put("category", category == null ? "radio" : category);
            // Credentials are never passed by callers. Guard against accidental multiline injection.
            entry.put("message", String.valueOf(message).replaceAll("[\\r\\n]", " ").substring(0, Math.min(600, String.valueOf(message).length())));
        } catch (Exception ignored) { }
        LOG.addLast(entry);
        while (LOG.size() > 500) LOG.removeFirst();
        return entry;
    }

    static synchronized JSONArray snapshot() {
        JSONArray entries = new JSONArray();
        for (JSONObject entry : LOG) entries.put(entry);
        return entries;
    }

    static synchronized void clear() { LOG.clear(); }

    private JSONObject prefs(JSONObject settings) {
        JSONObject console = settings.optJSONObject("console");
        JSONObject value = console == null ? null : console.optJSONObject("notifications");
        return value == null ? new JSONObject() : value;
    }

    /** Returns one sanitized log entry for UI delivery, or null for high-frequency events. */
    JSONObject onEvent(String event, JSONObject data, JSONObject settings) {
        if (data == null) return null;
        if ("status".equals(event)) {
            String state = data.optString("state", "disconnected");
            String message = data.optString("message", "");
            boolean connected = data.optBoolean("connected");
            boolean transition = data.optBoolean("transitionReconnect");
            if (!transition && prefs(settings).optBoolean("connection", true) && !state.equals(lastState)) {
                boolean gained = connected && !"connected".equals(lastState);
                boolean lost = !connected && "connected".equals(lastState) && !"disconnected".equals(state);
                if ((gained || lost) && System.currentTimeMillis() - lastConnectionAlert > 2000) {
                    lastConnectionAlert = System.currentTimeMillis();
                    alert(7250, gained ? (wasConnected ? "Ligação restabelecida" : "Ligado ao master") : "Ligação ao master perdida", message, settings);
                }
            }
            if (connected) wasConnected = true;
            boolean changed = !state.equals(lastState) || !message.equals(lastStatusMessage);
            lastState = state;
            lastStatusMessage = message;
            return changed ? record("network", message) : null;
        }
        if ("ptt".equals(event)) return record("ptt", data.optBoolean("active") ? "TX iniciada · " + data.optString("callType", "group") + " " + data.optInt("talkgroupId") : "TX terminada");
        if ("error".equals(event)) return record("error", data.optString("message", "Erro de rádio"));
        if ("link".equals(event)) return record("network", data.optString("message", "Ligação TG atualizada"));
        if ("vocoder".equals(event) || "audioTest".equals(event) || "audioSettings".equals(event))
            return record("audio", data.optString("message", event + " · pronto=" + data.optBoolean("ready", data.optBoolean("ok", true))));
        if ("selection".equals(event)) return record("target", "Destino selecionado · " + data.optJSONObject("target"));
        return null;
    }

    JSONObject onVoice(int source, int destination, long stream, boolean privateCall, JSONObject settings) {
        long now = System.currentTimeMillis();
        // Key by stream and source: a stream repeats every 60 ms but alerts once per actual call.
        long key = stream ^ ((long)source << 32);
        synchronized (seenStreams) {
            Long seen = seenStreams.get(key);
            if (seen != null && now - seen < 120000) return null;
            seenStreams.put(key, now);
            while (seenStreams.size() > 200) seenStreams.remove(seenStreams.keySet().iterator().next());
        }
        String caller = "ID " + source;
        boolean contactAlert = false;
        JSONObject console = settings.optJSONObject("console");
        JSONArray contacts = console == null ? null : console.optJSONArray("contacts");
        if (contacts != null) for (int i = 0; i < contacts.length(); i++) {
            JSONObject contact = contacts.optJSONObject(i);
            if (contact == null) continue;
            int id = contact.optInt("dmrId", contact.optInt("radioId", contact.optInt("id", 0)));
            if (id != source) continue;
            caller = contact.optString("callsign", caller);
            contactAlert = contact.optBoolean("alert", false);
            break;
        }
        JSONObject entry=record("rx", "Chamada recebida de " + caller + " · " + (privateCall ? "individual" : "TG " + destination));
        JSONObject options = prefs(settings);
        if (options.optBoolean("incoming", false) || (options.optBoolean("contactOnAir", true) && contactAlert))
            alert(7251, caller + (contactAlert ? " no ar" : " · chamada recebida"), privateCall ? "Chamada individual recebida" : "TG " + destination, settings);
        return entry;
    }

    private void alert(int id, String title, String text, JSONObject settings) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        JSONObject options = prefs(settings);
        boolean sound = options.optBoolean("sound", true), vibrate = options.optBoolean("vibrate", true);
        String channelId = "zapdmr-alerts-" + (sound ? "sound" : "quiet") + (vibrate ? "-vibrate" : "");
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channelId, "Alertas de rádio ZapDMR", NotificationManager.IMPORTANCE_DEFAULT);
            channel.enableVibration(vibrate);
            if (vibrate) channel.setVibrationPattern(new long[]{0, 150, 100, 150});
            channel.setSound(sound ? RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) : null,
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            manager.createNotificationChannel(channel);
        }
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done).setContentTitle(title).setContentText(text)
            .setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_STATUS).setTimeoutAfter(15000);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) notification.setContentIntent(PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        if (Build.VERSION.SDK_INT < 26) {
            if (sound) notification.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            if (vibrate) notification.setVibrate(new long[]{0, 150, 100, 150});
        }
        try { manager.notify(id, notification.build()); } catch (SecurityException ignored) { }
    }
}
