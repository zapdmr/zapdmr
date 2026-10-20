package br.radio.zapdmr;

import android.content.Context;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Drives the GPL codec helper as a separate Android child process. */
final class VocoderHelper {
    private static final String TAG = "ZapDMRVocoder";
    private Process process;
    private InputStream input;
    private OutputStream output;

    synchronized boolean isAlive() {
        if (process == null) return false;
        try { process.exitValue(); return false; }
        catch (IllegalThreadStateException running) { return true; }
    }

    synchronized boolean start(Context context, File firmware, File core) {
        if (isAlive()) return true;
        File executable = new File(context.getApplicationInfo().nativeLibraryDir, "libqso_dmr_vocoder_helper.so");
        if (!executable.isFile() || !executable.canExecute()) {
            Log.w(TAG, "Vocoder helper ARM não está instalado/execução não permitida: " + executable);
            return false;
        }
        try {
            FirmwareBundle.ensure(context,false,null);
            process = new ProcessBuilder(executable.getAbsolutePath()).start();
            input = new BufferedInputStream(process.getInputStream());
            output = new BufferedOutputStream(process.getOutputStream());
            Thread logs = new Thread(() -> drainLogs(process.getErrorStream()), "ZapDMR-Vocoder-Logs");
            logs.setDaemon(true); logs.start();
            output.write('I'); writePath(firmware.getAbsolutePath()); writePath(core.getAbsolutePath()); output.flush();
            int status = input.read();
            if (status != 0) { Log.e(TAG, "Codec init/self-test rejeitado com código " + status); stop(); return false; }
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Não foi possível iniciar o vocoder ARM", error); stop(); return false;
        }
    }

    synchronized byte[] encodeFec(byte[] pcmLittleEndian) throws IOException {
        if (pcmLittleEndian.length != 320) throw new IOException("Quadro PCM inválido; esperado 320 bytes.");
        writeCommand('G', pcmLittleEndian); byte[] result = new byte[9]; readFully(result); return result;
    }

    synchronized byte[] decodeFec(byte[] ambe) throws IOException {
        if (ambe.length != 9) throw new IOException("Quadro AMBE FEC inválido.");
        writeCommand('F', ambe); byte[] pcm = new byte[320]; readFully(pcm); return pcm;
    }

    synchronized void stop() {
        try { if (output != null) { output.write('Q'); output.flush(); } } catch (Exception ignored) { }
        try { Thread.sleep(150); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        if (isAlive()) process.destroy();
        process = null; input = null; output = null;
    }

    private void writeCommand(int command, byte[] bytes) throws IOException {
        if (!isAlive() || input == null || output == null) throw new IOException("Vocoder ARM indisponível.");
        output.write(command); output.write(bytes); output.flush();
    }

    private void writePath(String path) throws IOException {
        byte[] bytes = path.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1023) throw new IOException("Caminho do firmware longo demais.");
        output.write(bytes.length & 255); output.write((bytes.length >>> 8) & 255); output.write(bytes);
    }

    private void readFully(byte[] bytes) throws IOException {
        int offset=0; while(offset<bytes.length){int count=input.read(bytes,offset,bytes.length-offset);if(count<0)throw new IOException("Processo vocoder terminou durante o quadro.");offset+=count;}
    }

    private void drainLogs(InputStream stream) {
        try (DataInputStream reader = new DataInputStream(stream)) {
            String line; while ((line = reader.readLine()) != null) Log.i(TAG, line);
        } catch (Exception ignored) { }
    }
}
