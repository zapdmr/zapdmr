package br.radio.zapdmr;

import android.Manifest;
import android.app.KeyguardManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Serial PTT buttons only. Audio routes and Bluetooth media buttons remain service-owned. */
final class BluetoothSppController {
    private static final UUID SERIAL_PORT = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static BluetoothSppController instance;
    static synchronized BluetoothSppController get(Context context) {
        if (instance == null) instance = new BluetoothSppController(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> new Thread(r, "ZapDMR-SPP"));
    private volatile JSONObject options = new JSONObject();
    private volatile BluetoothSocket socket;
    private volatile long generation;
    private volatile boolean connected;
    private volatile boolean closing=true;
    private volatile String state = "disabled", message = "Botão série SPP desativado.";
    private volatile String selectedAddress = "", selectedName = "", lastToken = "", learning = "";
    private volatile long learnedUntil, lastInputAt;
    private volatile boolean serialPttHeld;

    private BluetoothSppController(Context context) { this.context = context; }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean permitted() {
        return Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    JSONArray devices() {
        if (!permitted()) throw new SecurityException("Permita Dispositivos próximos para escolher o botão SPP.");
        JSONArray result = new JSONArray();
        BluetoothAdapter adapter = adapter();
        if (adapter == null) return result;
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            result.put(json("address", device.getAddress(), "name", device.getName() == null ? device.getAddress() : device.getName()));
        }
        return result;
    }

    synchronized void configure(JSONObject value) {
        closing=!RadioSessionService.running;
        options = copy(value);
        boolean enabled = options.optBoolean("sppEnabled", false);
        String address = options.optString("sppDeviceAddress", "").trim().toUpperCase(Locale.ROOT);
        String framing = options.optString("sppFraming", "byte");
        String configKey = enabled + ":" + address + ":" + framing;
        String previous = stateKey;
        stateKey = configKey;
        if (configKey.equals(previous) && (!enabled || socket != null || "retrying".equals(state))) { emitStatus(); return; }
        long version = ++generation;
        cancelLearning();
        closeSocket();
        releasePtt();
        connected = false;
        selectedAddress = address;
        selectedName = "";
        if (!enabled) { update("disabled", "Botão série SPP desativado."); return; }
        if (!BluetoothAdapter.checkBluetoothAddress(address)) { update("unselected", "Escolha um dispositivo SPP já emparelhado nas definições do Android."); return; }
        if (!RadioSessionService.running) { update("idle", "Ligue o rádio para manter o botão SPP em segundo plano."); return; }
        if (!permitted()) { update("permission", "Permita Dispositivos próximos para ligar o botão SPP."); return; }
        update("connecting", "A ligar ao botão SPP…");
        worker.execute(() -> connectionLoop(version, address));
    }

    private String stateKey = "";

    private void connectionLoop(long version, String address) {
        int failures = 0;
        while (version == generation && options.optBoolean("sppEnabled") && RadioSessionService.running) {
            BluetoothSocket current = null;
            try {
                if (!permitted()) throw new SecurityException("Permissão de Bluetooth revogada.");
                BluetoothAdapter adapter = adapter();
                if (adapter == null || !adapter.isEnabled()) throw new IOException("Ative o Bluetooth do dispositivo.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                if (device.getBondState() != BluetoothDevice.BOND_BONDED) throw new IOException("Emparelhe primeiro o botão nas definições Bluetooth do Android.");
                selectedName = device.getName() == null ? address : device.getName();
                current = device.createRfcommSocketToServiceRecord(SERIAL_PORT);
                synchronized (this) { if (version != generation) { current.close(); return; } socket = current; }
                update("connecting", "A ligar a " + selectedName + "…");
                // No discovery is started: only paired devices are used, requiring CONNECT, not SCAN.
                current.connect();
                if (version != generation) return;
                connected = true;
                failures = 0;
                update("connected", "Botão SPP ligado: " + selectedName);
                readInput(current.getInputStream(), version);
                throw new IOException("O botão SPP terminou a ligação.");
            } catch (Exception error) {
                if (version != generation) return;
                connected = false;
                cancelLearning();
                releasePtt();
                update("retrying", (error.getMessage() == null ? "Ligação SPP perdida." : error.getMessage()) + " A tentar novamente…");
            } finally {
                if (current != null) try { current.close(); } catch (IOException ignored) { }
                synchronized (this) { if (socket == current) socket = null; }
            }
            long delay = Math.min(30000L, 2000L << Math.min(4, failures++));
            long deadline = SystemClock.elapsedRealtime() + delay;
            while (version == generation && SystemClock.elapsedRealtime() < deadline) {
                try { Thread.sleep(200); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
            }
        }
    }

    private void readInput(InputStream input, long version) throws IOException {
        byte[] buffer = new byte[256];
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        boolean discardLine = false;
        int count;
        while (version == generation && (count = input.read(buffer)) >= 0) {
            if (version != generation) return;
            boolean lines = "line".equals(options.optString("sppFraming", "byte"));
            for (int i = 0; i < count; i++) {
                int b = buffer[i] & 255;
                if (!lines) accept("hex:" + String.format(Locale.ROOT, "%02X", b));
                else if (b == 10 || b == 13) {
                    if (!discardLine && line.size() > 0) accept("line:" + new String(line.toByteArray(), StandardCharsets.UTF_8));
                    line.reset(); discardLine = false;
                } else if (line.size() < 128 && !discardLine) line.write(b);
                else { line.reset(); discardLine = true; }
            }
        }
    }

    synchronized JSONObject learn(String action) {
        if (!connected) throw new IllegalStateException("Ligue o rádio e o botão SPP antes de aprender uma tecla.");
        if (!isAction(action)) throw new IllegalArgumentException("Associação SPP inválida.");
        releasePtt();
        learning = action;
        learnedUntil = SystemClock.elapsedRealtime() + 15000;
        handler.postDelayed(() -> { synchronized (BluetoothSppController.this) { if (!learning.isEmpty() && SystemClock.elapsedRealtime() >= learnedUntil) { learning = ""; emit("sppLearned", json("ok", false, "message", "Tempo esgotado. Prima Aprender e depois o botão do dispositivo.")); emitStatus(); } } }, 15100);
        emitStatus();
        return status();
    }

    synchronized void cancelLearning() { learning = ""; learnedUntil = 0; }

    private void accept(String token) {
        lastToken = token;
        long now = SystemClock.elapsedRealtime();
        synchronized (this) {
            if (!learning.isEmpty() && now <= learnedUntil) {
                String action = learning; cancelLearning();
                try {
                    JSONObject updated = new JSONObject(context.getSharedPreferences("zapdmr_controls", Context.MODE_PRIVATE).getString("operation", options.toString()));
                    JSONObject bindings = updated.optJSONObject("sppBindings");
                    if (bindings == null) bindings = new JSONObject();
                    // A token has one action. Remove previous assignments to avoid a stuck down/up pair.
                    for (String candidate : new String[]{"pttDown", "pttUp", "pttToggle", "scan"}) if (token.equals(bindings.optString(candidate))) bindings.remove(candidate);
                    bindings.put(action, token); updated.put("sppBindings", bindings);
                    options = updated;
                    context.getSharedPreferences("zapdmr_controls", Context.MODE_PRIVATE).edit().putString("operation", updated.toString()).apply();
                    emit("sppLearned", json("ok", true, "action", action, "token", token, "operation", copy(updated)));
                    emit("systemLog",RadioNotifications.record("bluetooth","SPP: associação "+action+" aprendida ("+token+")."));
                } catch (Exception error) { emit("sppLearned", json("ok", false, "message", "Não foi possível guardar a tecla SPP.")); }
                emitStatus(); return;
            }
        }
        JSONObject bindings = options.optJSONObject("sppBindings");
        if (bindings == null) return;
        if (token.equals(bindings.optString("pttUp"))) { releasePtt(); hardwareInput("pttUp",token); return; }
        if (!remoteAllowed(false)) return;
        if (token.equals(bindings.optString("pttDown"))) {
            if (remoteAllowed(true) && !serialPttHeld) { serialPttHeld = true; dispatch(RadioSessionService.ACTION_PTT_DOWN); hardwareInput("pttDown",token); }
        } else if (token.equals(bindings.optString("pttToggle"))) {
            if (remoteAllowed(true) && now - lastInputAt > 250) { serialPttHeld = !serialPttHeld; dispatch(RadioSessionService.ACTION_PTT_TOGGLE); hardwareInput("pttToggle",token); }
        } else if (token.equals(bindings.optString("scan")) && now - lastInputAt > 250) { emit("hardwareScan", json("source", "spp", "token", token)); hardwareInput("scan",token); }
        lastInputAt = now;
    }

    private boolean remoteAllowed(boolean microphone) {
        if (closing || !RadioSessionService.running || (microphone && ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)) return false;
        KeyguardManager lock = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return options.optBoolean("allowLocked") || lock == null || !lock.isKeyguardLocked();
    }

    private void dispatch(String action) {
        if (!closing && RadioSessionService.running) context.startService(new Intent(context, RadioSessionService.class).setAction(action).putExtra("source", "spp"));
    }

    private void releasePtt() { if (serialPttHeld) { serialPttHeld = false; dispatch(RadioSessionService.ACTION_PTT_UP); } }
    private void closeSocket() { BluetoothSocket current = socket; socket = null; if (current != null) try { current.close(); } catch (IOException ignored) { } }

    synchronized void close() {
        // Service teardown already stops its own transmitter. Sending startService(PTT_UP)
        // here could resurrect that service while Android is destroying it.
        closing = true; ++generation; stateKey = ""; cancelLearning(); closeSocket(); serialPttHeld = false; connected = false;
        update("idle", "Ligação ao botão SPP terminada.");
    }

    synchronized JSONObject status() {
        return json("supported", adapter() != null, "enabled", options.optBoolean("sppEnabled"), "connected", connected, "state", state, "message", message,
            "address", selectedAddress, "name", selectedName, "framing", options.optString("sppFraming", "byte"), "learning", learning, "lastToken", lastToken,
            "bindings", options.optJSONObject("sppBindings") == null ? new JSONObject() : copy(options.optJSONObject("sppBindings")));
    }

    private static boolean isAction(String action) { return "pttDown".equals(action) || "pttUp".equals(action) || "pttToggle".equals(action) || "scan".equals(action); }
    private void update(String value, String detail) { state = value; message = detail; emitStatus();emit("systemLog",RadioNotifications.record("bluetooth","SPP: "+detail)); }
    private void hardwareInput(String action,String token){emit("hardwareInput",json("source","spp","action",action,"token",token));emit("systemLog",RadioNotifications.record("key","SPP "+token+" → "+action));}
    private void emitStatus() { emit("sppStatus", status()); }
    private void emit(String event, JSONObject data) { context.sendBroadcast(new Intent(RadioSessionService.ACTION_EVENT).setPackage(context.getPackageName()).putExtra(RadioSessionService.EXTRA_EVENT, event).putExtra(RadioSessionService.EXTRA_DATA, data.toString())); }
    private static JSONObject copy(JSONObject source) { try { return new JSONObject(source == null ? "{}" : source.toString()); } catch (Exception ignored) { return new JSONObject(); } }
    private static JSONObject json(Object... pairs) { JSONObject result = new JSONObject(); try { for (int i = 0; i < pairs.length; i += 2) result.put(String.valueOf(pairs[i]), pairs[i + 1]); } catch (Exception ignored) { } return result; }
}
