package br.radio.zapdmr;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Profile-scoped APRS credentials encrypted by Android Keystore. */
final class AprsCredentialStore {
    private static final String PREFS="zapdmr_aprs_secure", VALUE="credentials", KEY_ALIAS="ZapDMR.APRS.Key.v1";
    private static final Object LOCK=new Object();
    static final class Resolved {final String passcode,profileId,source,callsign;Resolved(String p,String id,String s,String c){passcode=p;profileId=id;source=s;callsign=c;}JSONObject json(){try{return new JSONObject().put("profileId",profileId).put("source",source).put("callsign",callsign).put("passcode",passcode);}catch(Exception ignored){return new JSONObject();}}}

    static Resolved resolve(Context context,String requested,String manual)throws Exception{
        synchronized(LOCK){JSONObject radio=MobileAudioPlugin.readProtectedConfig(context),settings=radio.optJSONObject("settings"),community=radio.optJSONObject("community");if(settings==null)settings=new JSONObject();String profile=radio.optString("activeProfileId","default"),base=base(requested);
            if(manual!=null&&!manual.trim().isEmpty()){manual=manual.trim();if(!manual.matches("\\d{1,5}"))throw new IllegalArgumentException("O passcode APRS-IS manual deve conter de 1 a 5 algarismos.");return new Resolved(manual,profile,"manual",base);}
            JSONObject stored=read(context).optJSONObject(profile);if(stored!=null&&base.equals(stored.optString("callsign"))&&stored.optString("passcode").matches("\\d{1,5}"))return new Resolved(stored.getString("passcode"),profile,stored.optString("source","manual"),base);
            JSONObject account=community==null?null:community.optJSONObject("account");String accountCallsign=account==null?"":base(account.optString("callsign"));boolean official=community!=null&&"https://www.zapdmr.com.br".equals(community.optString("endpoint").replaceAll("/$",""))&&!community.optString("token").isEmpty();boolean accountVerified=account!=null&&(!account.has("verified")||account.optBoolean("verified"));boolean identityVerified=account!=null&&(account.optBoolean("whatsapp_verified")||account.optBoolean("email_verified"));boolean authorized=official&&accountVerified&&identityVerified&&base.equals(accountCallsign)&&String.valueOf(account.opt("dmrId")).matches("\\d{7}");
            return authorized?new Resolved(String.valueOf(passcode(base)),profile,"automatic",base):new Resolved("-1",profile,"",base);
        }
    }
    static void confirm(Context context,JSONObject candidate)throws Exception{synchronized(LOCK){String profile=candidate.optString("profileId"),base=base(candidate.optString("callsign")),pass=candidate.optString("passcode"),source=candidate.optString("source");if(!profile.matches("[A-Za-z0-9_-]{1,64}")||!base.matches("[A-Z0-9]{3,6}")||!pass.matches("\\d{1,5}")||!("automatic".equals(source)||"manual".equals(source)))throw new IllegalArgumentException("Credencial APRS inválida.");JSONObject all=read(context);all.put(profile,new JSONObject().put("callsign",base).put("passcode",pass).put("source",source));write(context,all);}}
    static JSONObject status(Context context)throws Exception{synchronized(LOCK){JSONObject radio=MobileAudioPlugin.readProtectedConfig(context);String profile=radio.optString("activeProfileId","default");JSONObject value=read(context).optJSONObject(profile);return new JSONObject().put("credentialConfigured",value!=null).put("credentialSource",value==null?"":value.optString("source"));}}
    static String base(String value){return value==null?"":value.trim().toUpperCase(Locale.ROOT).split("-",2)[0];}
    static int passcode(String value){String call=base(value);if(!call.matches("[A-Z0-9]{3,6}"))throw new IllegalArgumentException("Indicativo APRS inválido para provisionamento automático.");int hash=0x73e2;for(int i=0;i<call.length();i+=2){hash^=call.charAt(i)<<8;if(i+1<call.length())hash^=call.charAt(i+1);}return hash&0x7fff;}
    private static JSONObject read(Context context)throws Exception{String value=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(VALUE,null);return value==null?new JSONObject():new JSONObject(decrypt(value));}
    private static void write(Context context,JSONObject value)throws Exception{if(!context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(VALUE,encrypt(value.toString())).commit())throw new java.io.IOException("Secure APRS storage failed");}
    private static SecretKey key()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);java.security.Key existing=store.getKey(KEY_ALIAS,null);if(existing instanceof SecretKey)return(SecretKey)existing;KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());return generator.generateKey();}
    private static String encrypt(String text)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);}
    private static String decrypt(String value)throws Exception{String[] parts=value.split(":",2);if(parts.length!=2)throw new IllegalArgumentException("Credencial APRS cifrada inválida.");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
    private AprsCredentialStore(){}
}
