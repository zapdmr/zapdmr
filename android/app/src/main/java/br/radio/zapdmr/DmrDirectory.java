package br.radio.zapdmr;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import java.io.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.util.*;

/** Private, transactional offline directory. No database is published or bundled. */
final class DmrDirectory extends SQLiteOpenHelper {
    private final Context context;
    DmrDirectory(Context context){super(context,"dmr-directory.sqlite",null,1);this.context=context;}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE users(id TEXT PRIMARY KEY,callsign TEXT,name TEXT,city TEXT,state TEXT,country TEXT)");
        db.execSQL("CREATE INDEX users_callsign ON users(callsign)");
        db.execSQL("CREATE TABLE meta(updatedAt TEXT)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){}
    synchronized JSObject stats(){
        SQLiteDatabase db=getReadableDatabase(); long count=0;String updated=null;
        try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM users",null)){if(c.moveToFirst())count=c.getLong(0);}
        try(Cursor c=db.rawQuery("SELECT updatedAt FROM meta LIMIT 1",null)){if(c.moveToFirst())updated=c.getString(0);}
        return new JSObject().put("records",count).put("bytes",context.getDatabasePath("dmr-directory.sqlite").length()).put("updatedAt",updated);
    }
    synchronized JSObject lookup(JSONArray ids) throws Exception {
        JSONArray records=new JSONArray();SQLiteDatabase db=getReadableDatabase();int remoteRequests=0;
        for(int i=0;i<Math.min(ids.length(),100);i++){
            String id=ids.optString(i).toUpperCase(Locale.ROOT); if(!id.matches("[A-Z0-9/]{2,16}"))continue;
            try(Cursor c=db.rawQuery("SELECT id,callsign,name,city,state,country FROM users WHERE "+(id.matches("\\d+")?"id":"callsign")+"=? LIMIT 1",new String[]{id})){
                if(c.moveToFirst()){JSObject row=new JSObject();for(int n=0;n<c.getColumnCount();n++)row.put(c.getColumnName(n),c.getString(n));records.put(row);continue;}
            }
            if(remoteRequests++<4){JSObject remote=remoteLookup(id);if(remote!=null)records.put(remote);}
        }
        return new JSObject().put("records",records);
    }
    private final java.util.Map<String,Long> remoteAttempts=new java.util.HashMap<>();
    private JSObject remoteLookup(String id){
        if(System.currentTimeMillis()-remoteAttempts.getOrDefault(id,0L)<3600000)return null;
        remoteAttempts.put(id,System.currentTimeMillis());HttpsURLConnection connection=null;
        try{
            URL url=new URL("https://radioid.net/api/dmr/user/?"+(id.matches("\\d+")?"id=":"callsign=")+java.net.URLEncoder.encode(id,"UTF-8"));
            connection=(HttpsURLConnection)url.openConnection();connection.setConnectTimeout(4000);connection.setReadTimeout(4000);
            if(connection.getResponseCode()!=200)return null;
            StringBuilder json=new StringBuilder();try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),"UTF-8"))){String line;while((line=reader.readLine())!=null){json.append(line);if(json.length()>200000)return null;}}
            JSONArray rows=new org.json.JSONObject(json.toString()).optJSONArray("results");if(rows==null)return null;
            for(int i=0;i<rows.length();i++){
                org.json.JSONObject row=rows.getJSONObject(i);String radioId=row.optString("id"),call=row.optString("callsign").toUpperCase(Locale.ROOT);
                if(!id.equals(radioId)&&!id.equals(call))continue;
                ContentValues values=new ContentValues();values.put("id",radioId);values.put("callsign",call);values.put("name",row.optString("name",row.optString("fname")));values.put("city",place(row.optString("city")));values.put("state",place(row.optString("state")));values.put("country",place(row.optString("country")));
                getWritableDatabase().insertWithOnConflict("users",null,values,SQLiteDatabase.CONFLICT_REPLACE);
                JSObject result=new JSObject();for(String key:new String[]{"id","callsign","name","city","state","country"})result.put(key,values.getAsString(key));return result;
            }
        }catch(Exception ignored){}finally{if(connection!=null)connection.disconnect();}return null;
    }
    synchronized JSObject clear(){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.delete("users",null,null);db.delete("meta",null,null);db.setTransactionSuccessful();}finally{db.endTransaction();}db.execSQL("VACUUM");return stats();}
    synchronized JSObject update() throws Exception {
        URL url=new URL("https://radioid.net/static/user.csv");HttpsURLConnection connection=null;
        for(int hop=0;hop<5;hop++){
            connection=(HttpsURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent","ZapDMR/1.2 amateur-radio offline ID lookup");
            int code=connection.getResponseCode();
            if(code==301||code==302||code==307||code==308){String next=connection.getHeaderField("Location");connection.disconnect();url=FirmwareDownload.secureUrl(new URL(url,next).toString());continue;}
            if(code!=200){connection.disconnect();throw new IOException("RadioID indisponível (HTTP "+code+").");}break;
        }
        if(connection==null)throw new IOException("Falha na ligação ao RadioID.");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),"UTF-8"))){
            String header=reader.readLine();if(header==null||!header.replace("\uFEFF","").startsWith("RADIO_ID,CALLSIGN,"))throw new IOException("Formato RadioID inesperado; base anterior preservada.");
            db.delete("users",null,null);long bytes=0;int count=0;String line;
            android.database.sqlite.SQLiteStatement insert=db.compileStatement("INSERT OR REPLACE INTO users VALUES(?,?,?,?,?,?)");
            try{
                while((line=reader.readLine())!=null){
                    bytes+=line.length()*2L;if(bytes>80L*1024*1024||count>600000)throw new IOException("Base excede o limite permitido.");
                    if(Thread.currentThread().isInterrupted())throw new IOException("Atualização cancelada.");
                    List<String> cells=csv(line);if(cells.size()<7||!cells.get(0).matches("\\d{1,8}"))continue;
                    String[] values={cells.get(0),cells.get(1).toUpperCase(Locale.ROOT),(cells.get(2)+" "+cells.get(3)).trim(),place(cells.get(4)),place(cells.get(5)),place(cells.get(6))};
                    for(int i=0;i<values.length;i++)insert.bindString(i+1,values[i]);insert.executeInsert();insert.clearBindings();count++;
                }
            }finally{insert.close();}
            if(count==0)throw new IOException("A base descarregada está vazia.");
            db.delete("meta",null,null);ContentValues meta=new ContentValues();meta.put("updatedAt",new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",Locale.US).format(new Date()));db.insertOrThrow("meta",null,meta);
            db.setTransactionSuccessful();
        }finally{db.endTransaction();connection.disconnect();}
        return stats();
    }
    private static String place(String text){return text.matches(".*\\p{L}.*")?text.trim():"";}
    private static List<String> csv(String line){List<String> cells=new ArrayList<>();StringBuilder cell=new StringBuilder();boolean quote=false;for(int i=0;i<line.length();i++){char ch=line.charAt(i);if(ch=='"'){if(quote&&i+1<line.length()&&line.charAt(i+1)=='"'){cell.append('"');i++;}else quote=!quote;}else if(ch==','&&!quote){cells.add(cell.toString().trim());cell.setLength(0);}else cell.append(ch);}cells.add(cell.toString().trim());return cells;}
}
