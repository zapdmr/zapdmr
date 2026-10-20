package br.radio.zapdmr;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/** Saves a user-selected private attachment with Android's permissionless document picker. */
@CapacitorPlugin(name="ZapAttachments")
public final class AttachmentsPlugin extends Plugin {
    private byte[] pendingBytes;
    @PluginMethod public synchronized void save(PluginCall call) {
        if(pendingBytes!=null){call.reject("Há outro arquivo aguardando o local de destino.");return;}
        String name=call.getString("name",""),encoded=call.getString("base64","");
        if(name.isEmpty()||name.length()>140||name.matches(".*[\\\\/\\x00-\\x1f\\x7f].*")||!name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(jpg|jpeg|png|webp|pdf|txt|csv|zip|rar|dat|rdt|bin)$")||encoded.length()>20971520){call.reject("Arquivo inválido ou acima de 15 MB.");return;}
        try{
            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
            if(bytes.length==0||bytes.length>15728640)throw new IllegalArgumentException();
            pendingBytes=bytes;
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,name);
            startActivityForResult(call,intent,"fileCreated");
        }catch(Exception error){pendingBytes=null;call.reject("Não foi possível preparar o arquivo.");}
    }
    @ActivityCallback private void fileCreated(PluginCall call,ActivityResult result){
        final byte[] bytes=pendingBytes;pendingBytes=null;
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.resolve(new JSObject().put("canceled",true));return;}
        final android.net.Uri uri=result.getData().getData();
        getBridge().execute(()->{
            try(OutputStream stream=getContext().getContentResolver().openOutputStream(uri,"w")){
                if(stream==null||bytes==null)throw new java.io.IOException();stream.write(bytes);call.resolve(new JSObject().put("saved",true));
            }catch(Exception error){call.reject("Não foi possível salvar o anexo no destino escolhido.");}
        });
    }
}
