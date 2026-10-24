package br.radio.zapdmr;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;

/** Installs the verified offline resources shipped separately from the GPL codec. */
final class FirmwareBundle {
    static synchronized void ensure(Context context, boolean repair, String selectedTarget) throws Exception {
        File dir=new File(context.getFilesDir(),"firmware");
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Não foi possível criar a pasta privada do vocoder.");
        for(String target:new String[]{"application","core"}) {
            if(selectedTarget!=null&&!selectedTarget.equals(target))continue;
            File file=new File(dir,FirmwareDownload.name(target));
            if(!repair && FirmwareDownload.valid(file,target))continue;
            AtomicFile atomic=new AtomicFile(file);
            FileOutputStream output=null;
            try(InputStream input=context.getAssets().open("firmware/"+FirmwareDownload.name(target))) {
                output=atomic.startWrite();
                FirmwareDownload.verifyCopy(input,output,FirmwareDownload.size(target),FirmwareDownload.hash(target),null);
                atomic.finishWrite(output); output=null;
            } finally {if(output!=null)atomic.failWrite(output);}
        }
    }
    static boolean ready(Context context) {
        File dir=new File(context.getFilesDir(),"firmware");
        return FirmwareDownload.valid(new File(dir,"D002.032.bin"),"application")
            && FirmwareDownload.valid(new File(dir,"d02032-core.img"),"core");
    }
}
