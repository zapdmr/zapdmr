package br.radio.zapdmr;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.activity.result.ActivityResult;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import javax.net.ssl.HttpsURLConnection;

/** Official, explicit APK updates. Same package + signing certificate; never installs silently. */
@CapacitorPlugin(name="ZapAppUpdate")
public final class AppUpdatePlugin extends Plugin {
    private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean downloading=new java.util.concurrent.atomic.AtomicBoolean();
    private volatile File readyFile;private volatile JSONObject readyManifest;
    private long code(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    private int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    private Signature[] signatures(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.signingInfo.getApkContentsSigners():p.signatures;}
    private PackageInfo installed() throws Exception{return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),flags());}
    @PluginMethod public void info(PluginCall call){try{PackageInfo p=installed();call.resolve(new JSObject().put("version",p.versionName).put("versionCode",code(p)));}catch(Exception e){call.reject("Não foi possível ler a versão instalada.");}}
    private JSONObject manifest() throws Exception {
        HttpsURLConnection c=(HttpsURLConnection)new URL("https://www.zapdmr.com.br/v1/app-releases/android").openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);
        try{if(c.getResponseCode()!=200)throw new IOException("Servidor de atualizações indisponível.");ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>20000)throw new IOException("Manifesto inválido.");bytes.write(b,0,n);}}return new JSONObject(bytes.toString("UTF-8")).optJSONObject("release");}finally{c.disconnect();}
    }
    @PluginMethod public void check(PluginCall call){worker.execute(()->{try{JSONObject release=manifest();call.resolve(new JSObject().put("release",release==null?JSONObject.NULL:release));}catch(Exception e){call.reject("Não foi possível consultar atualizações. Tente novamente quando houver conexão.");}});}
    private URL allowed(String value,boolean first) throws Exception {
        URL url=new URL(value);String host=url.getHost();if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null||url.getPort()!=-1||url.getRef()!=null)throw new IOException("Endereço de atualização inválido.");
        if(first){if(!value.matches("https://github\\.com/zapdmr/zapdmr/releases/download/v[0-9.]+/ZapDMR-Android-[0-9.]+\\.apk"))throw new IOException("Use somente o APK oficial.");}
        else if(!Arrays.asList("github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(host))throw new IOException("Redirecionamento não autorizado.");return url;
    }
    private void validate(File file,JSONObject release) throws Exception {
        if(!file.isFile()||file.length()!=release.getLong("bytes"))throw new IOException("Tamanho do APK incorreto.");
        MessageDigest sha=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)sha.update(b,0,n);}StringBuilder hex=new StringBuilder();for(byte b:sha.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));if(!hex.toString().equals(release.getString("sha256")))throw new IOException("SHA-256 do APK não corresponde ao publicado.");
        PackageManager pm=getContext().getPackageManager();PackageInfo archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags()),current=installed();
        if(archive==null||!getContext().getPackageName().equals(archive.packageName)||code(archive)!=release.getLong("versionCode")||code(archive)<=code(current)||!release.getString("version").equals(archive.versionName))throw new IOException("Pacote ou versão do APK incompatível.");
        Signature[] expected=signatures(current),actual=signatures(archive);if(expected==null||actual==null||expected.length!=actual.length||expected.length==0)throw new IOException("Assinatura do APK inválida.");for(Signature signature:expected){boolean match=false;for(Signature candidate:actual)if(MessageDigest.isEqual(signature.toByteArray(),candidate.toByteArray()))match=true;if(!match)throw new IOException("APK não assinado pelo mesmo responsável desta instalação.");}
    }
    @PluginMethod public void download(PluginCall call){if(!downloading.compareAndSet(false,true)){call.reject("Há um download em andamento.");return;}worker.execute(()->{File temporary=null;try{
        JSONObject release=manifest();if(release==null||release.getLong("versionCode")<=code(installed()))throw new IOException("Nenhuma versão mais recente disponível.");long expected=release.getLong("bytes");if(expected<1024||expected>157286400||!release.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("Manifesto de atualização inválido.");
        URL url=allowed(release.getString("apkUrl"),true);File folder=new File(getContext().getCacheDir(),"app-updates");if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Sem espaço para preparar a atualização.");temporary=new File(folder,"update.part");boolean copied=false;
        for(int redirects=0;redirects<=5;redirects++){HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);try{int status=connection.getResponseCode();if(status>=300&&status<400){url=allowed(new URL(url,connection.getHeaderField("Location")).toString(),false);continue;}if(status!=200)throw new IOException("O download oficial não respondeu.");
            try(InputStream in=connection.getInputStream();OutputStream out=new FileOutputStream(temporary)){FirmwareDownload.verifyCopy(in,out,expected,release.getString("sha256"),(bytes,total)->notifyListeners("progress",new JSObject().put("bytes",bytes).put("total",total)));}copied=true;break;
        }finally{connection.disconnect();}}
        if(!copied)throw new IOException("Redirecionamentos demais no download.");validate(temporary,release);File destination=new File(folder,"ZapDMR-update.apk");if(destination.exists()&&!destination.delete())throw new IOException("Não foi possível substituir o APK temporário.");if(!temporary.renameTo(destination))throw new IOException("Não foi possível preparar o APK.");readyFile=destination;readyManifest=release;call.resolve(new JSObject().put("ready",true).put("version",release.getString("version")));
    }catch(Exception e){if(temporary!=null)temporary.delete();call.reject(e instanceof IOException?e.getMessage():"Não foi possível validar a atualização.");}finally{downloading.set(false);}});}
    @PluginMethod public void install(PluginCall call){
        if(!QuickExitState.blocked()||QuickExitState.closing()){call.reject("Desconecte o rádio antes de instalar.");return;}
        if(readyFile==null||readyManifest==null){call.reject("Baixe e valide a atualização primeiro.");return;}
        if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){Intent intent=new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName()));startActivityForResult(call,intent,"installPermissionResult");return;}launchInstaller(call);
    }
    @ActivityCallback private void installPermissionResult(PluginCall call,ActivityResult result){if(call==null)return;if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){call.reject("Autorize a instalação por este aplicativo para continuar.");return;}launchInstaller(call);}
    private void launchInstaller(PluginCall call){worker.execute(()->{try{validate(readyFile,readyManifest);Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",readyFile);Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);getActivity().runOnUiThread(()->{try{getActivity().startActivity(intent);call.resolve(new JSObject().put("installerOpened",true));}catch(Exception e){call.reject("O instalador do Android não está disponível.");}});}catch(Exception e){call.reject("A atualização não passou na verificação final. Baixe novamente.");}});}
}
