package br.radio.zapdmr;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;

/** Bounded HTTPS downloads; fixed known firmware digests reject cloud HTML/error pages. */
final class FirmwareDownload {
    interface Progress { void update(long bytes, long total); }
    static String name(String target) {
        if ("application".equals(target)) return "D002.032.bin";
        if ("core".equals(target)) return "d02032-core.img";
        throw new IllegalArgumentException("Tipo de firmware inválido.");
    }
    static long size(String target) { name(target); return "application".equals(target) ? 994304L : 131072L; }
    static String hash(String target) {
        name(target);
        return "application".equals(target)
            ? "c0351f250a834660641bca3b06be931c80cc1ed0ef808356c550b99cd0f4c632"
            : "d40398183e9aa8db6288a62d9a0e0c233cb143ef5633680abd829cc03c719f66";
    }
    static boolean valid(File file, String target) {
        if(!file.isFile() || file.length()!=size(target))return false;
        try(InputStream input=new FileInputStream(file)) {
            verifyCopy(input,new OutputStream(){
                @Override public void write(int value){}
                @Override public void write(byte[] bytes,int offset,int length){}
            },size(target),hash(target),null);
            return true;
        } catch(Exception error){return false;}
    }
    static URL secureUrl(String value) throws IOException {
        URL url = new URL(value);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getHost().isEmpty() || url.getUserInfo()!=null)
            throw new IOException("Informe um link direto HTTPS sem credenciais no endereço.");
        return url;
    }
    static void verifyCopy(InputStream input, OutputStream output, long expected, String digest, Progress progress) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] bytes = new byte[32768]; long total = 0, lastUpdate = 0; int read;
        while ((read = input.read(bytes)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Download cancelado.");
            total += read;
            if (total > expected) throw new IOException("O download excede o tamanho esperado do firmware.");
            output.write(bytes,0,read); sha.update(bytes,0,read);
            if (progress!=null && (System.currentTimeMillis()-lastUpdate>250 || total==expected)) {
                progress.update(total,expected); lastUpdate=System.currentTimeMillis();
            }
        }
        if (total != expected) throw new IOException("Download incompleto ou link incorreto: tamanho inesperado.");
        StringBuilder actual = new StringBuilder();
        for(byte b:sha.digest()) actual.append(String.format(java.util.Locale.ROOT,"%02x",b & 255));
        if (!actual.toString().equalsIgnoreCase(digest)) throw new IOException("O SHA-256 não corresponde ao firmware exigido pelo ZapDMR.");
    }
    static void fetch(String value, String target, File destination, Progress progress) throws Exception {
        URL url = secureUrl(value); name(target);
        for(int redirects=0;redirects<=5;redirects++) {
            HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent","ZapDMR-Android/1.1.1");
            connection.setRequestProperty("Accept","application/octet-stream");
            try {
                int status=connection.getResponseCode();
                if(status==301||status==302||status==303||status==307||status==308){
                    String location=connection.getHeaderField("Location");
                    if(location==null)throw new IOException("Redirecionamento sem destino.");
                    url=secureUrl(new URL(url,location).toString()); continue;
                }
                if(status!=200)throw new IOException("O servidor recusou o download (HTTP "+status+"). Use o link direto do binário.");
                long length=connection.getContentLengthLong();
                if(length>0&&length!=size(target))throw new IOException("O link não devolveu o tamanho exato do firmware.");
                try(InputStream input=connection.getInputStream(); FileOutputStream output=new FileOutputStream(destination)){
                    verifyCopy(input,output,size(target),hash(target),progress);output.getFD().sync();
                }
                return;
            } finally { connection.disconnect(); }
        }
        throw new IOException("O link possui demasiados redirecionamentos.");
    }
}
