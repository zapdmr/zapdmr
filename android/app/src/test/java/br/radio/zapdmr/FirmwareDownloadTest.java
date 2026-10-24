package br.radio.zapdmr;

import java.io.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class FirmwareDownloadTest {
    @Test public void bundledFilesAreAcceptedAndSameSizeCorruptionIsRejected() throws Exception {
        File directory=new File(System.getProperty("zapdmr.firmwareAssets"));
        assertTrue(FirmwareDownload.valid(new File(directory,"D002.032.bin"),"application"));
        assertTrue(FirmwareDownload.valid(new File(directory,"d02032-core.img"),"core"));
        File corrupt=File.createTempFile("zapdmr-firmware-test-",".img");
        try {
            try(FileOutputStream output=new FileOutputStream(corrupt)){output.write(new byte[131072]);}
            assertFalse(FirmwareDownload.valid(corrupt,"core"));
        } finally {corrupt.delete();}
    }
    @Test public void acceptsOnlyHttpsAndKnownTargets() throws Exception {
        assertEquals("example.org",FirmwareDownload.secureUrl("https://example.org/file.bin").getHost());
        for(String value:new String[]{"http://example.org/file","file:///tmp/file","https://user:secret@example.org/file"}) {
            try {FirmwareDownload.secureUrl(value);fail("Unsafe URL accepted");}catch(IOException expected){}
        }
        assertEquals(994304,FirmwareDownload.size("application"));
        assertEquals(131072,FirmwareDownload.size("core"));
        try{FirmwareDownload.name("../../escape");fail();}catch(IllegalArgumentException expected){}
    }
    @Test public void verifiesContentDigestAndExactSize() throws Exception {
        byte[] data="abc".getBytes("UTF-8");
        String sha="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        FirmwareDownload.verifyCopy(new ByteArrayInputStream(data),output,3,sha,null);
        assertArrayEquals(data,output.toByteArray());
        for(int size:new int[]{2,4})try{FirmwareDownload.verifyCopy(new ByteArrayInputStream(data),new ByteArrayOutputStream(),size,sha,null);fail();}catch(IOException expected){}
        try{FirmwareDownload.verifyCopy(new ByteArrayInputStream(data),new ByteArrayOutputStream(),3,"wrong",null);fail();}catch(IOException expected){}
    }
}
