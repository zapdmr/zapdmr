package br.radio.zapdmr;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.AtomicFile;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Opt-in APRS-IS client. Its TCP session and GPS belong to this visible service, not a WebView. */
public final class AprsService extends Service {
    static final String CONNECT="br.radio.zapdmr.aprs.CONNECT", DISCONNECT="br.radio.zapdmr.aprs.DISCONNECT", EVENT="br.radio.zapdmr.aprs.EVENT";
    private static final String CHANNEL="zapdmr-aprs";
    private static final int NOTIFICATION=7245;
    private static volatile AprsService active;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService network=Executors.newSingleThreadExecutor(r -> new Thread(r,"ZapDMR-APRS-network"));
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor(r -> new Thread(r,"ZapDMR-APRS-timer"));
    private final Object writeLock=new Object();
    private volatile Socket socket;
    private volatile boolean wanted,verified;
    private volatile long generation;
    private volatile JSONObject config=new JSONObject();
    private volatile String passcode="",state="disconnected",error="";
    private volatile long rxBytes,txBytes,lastBeaconAt;
    private int sequence=new SecureRandom().nextInt(90000)+1;
    private final ArrayList<JSONObject> history=new ArrayList<>();
    private final LinkedHashMap<String,Pending> pending=new LinkedHashMap<>();
    private final LinkedHashMap<String,Long> seen=new LinkedHashMap<>();
    private final LinkedHashMap<String,JSONObject> stations=new LinkedHashMap<>();
    private LocationManager locations;
    private ConnectivityManager connectivity;
    private volatile Network activeNetwork;
    private long notificationAt;
    private String notificationState="";
    private double beaconLatitude=Double.NaN,beaconLongitude=Double.NaN;
    private final ConnectivityManager.NetworkCallback networkCallback=new ConnectivityManager.NetworkCallback(){
        @Override public void onAvailable(Network network){if(activeNetwork!=null&&!activeNetwork.equals(network))closeNetworkSocket();activeNetwork=network;}
        @Override public void onLost(Network network){if(network.equals(activeNetwork)){activeNetwork=null;closeNetworkSocket();}}
    };
    private final LocationListener locationListener=new LocationListener(){
        @Override public void onLocationChanged(Location location){if(!timer.isShutdown())timer.execute(()->{try{position(location.getLatitude(),location.getLongitude());}catch(Exception ignored){}});}
        @Override public void onProviderDisabled(String provider){error="GPS desativado; a última posição válida é mantida.";publish();}
        @Override public void onProviderEnabled(String provider){}
        @Override public void onStatusChanged(String provider,int status,Bundle extras){}
    };

    private static final class Pending {
        JSONObject message; final String packet; long at; int tries=1;
        Pending(JSONObject message,String packet){this.message=message;this.packet=packet;at=System.currentTimeMillis();}
    }
    static AprsService current(){return active;}
    static boolean validStation(String value){return value!=null&&value.length()<=9&&value.matches("[A-Z0-9]{3,6}(?:-(?:[0-9]|1[0-5]))?");}
    static String station(String value){String clean=value==null?"":value.trim().toUpperCase(Locale.ROOT);return clean.endsWith("-0")?clean.substring(0,clean.length()-2):clean;}
    static JSONObject cleanConfig(JSONObject raw){
        String callsign=station(raw.optString("callsign"));
        if(!validStation(callsign))throw new IllegalArgumentException("Indicativo APRS inválido (máximo 9 caracteres com SSID).");
        String host=raw.optString("host","rotate.aprs2.net").trim();
        if(!host.matches("[a-zA-Z0-9.-]{1,180}"))throw new IllegalArgumentException("Servidor APRS inválido.");
        JSONObject value=json("callsign",callsign,"host",host,"port",bound(raw.optInt("port",14580),1,65535),"messages",raw.optBoolean("messages",true),"map",raw.optBoolean("map",true),"beacon",raw.optBoolean("beacon",false),"smartBeacon",raw.optBoolean("smartBeacon",false),"intervalMinutes",bound(raw.optInt("intervalMinutes",5),1,60),"rangeKm",bound(raw.optInt("rangeKm",250),1,500),"symbol","phone".equals(raw.optString("symbol"))||"$".equals(raw.optString("symbol"))?"$":java.util.Arrays.asList("[","-",">").contains(raw.optString("symbol"))?raw.optString("symbol"):"[");
        double lat=raw.optDouble("latitude",Double.NaN),lon=raw.optDouble("longitude",Double.NaN);
        if(validPosition(lat,lon))try{value.put("latitude",lat);value.put("longitude",lon);}catch(Exception ignored){}
        return value;
    }
    static void validatePasscode(String passcode){if(passcode==null||!passcode.matches("-?\\d{1,5}"))throw new IllegalArgumentException("Introduza o passcode APRS-IS ou -1 para somente receber.");}

    @Override public void onCreate(){
        super.onCreate();active=this;history.addAll(loadHistory(this));
        connectivity=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);activeNetwork=connectivity.getActiveNetwork();try{connectivity.registerDefaultNetworkCallback(networkCallback);}catch(Exception ignored){}
        if(Build.VERSION.SDK_INT>=26){NotificationChannel channel=new NotificationChannel(CHANNEL,"Sessão APRS-IS",NotificationManager.IMPORTANCE_LOW);channel.setDescription("Estado da sessão de mensagens e posição APRS-IS");getSystemService(NotificationManager.class).createNotificationChannel(channel);}
        timer.scheduleAtFixedRate(()->{try{tick();}catch(Exception ignored){}},1,1,TimeUnit.SECONDS);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null||DISCONNECT.equals(intent.getAction())){disconnect();stopSelf();return START_NOT_STICKY;}
        if(CONNECT.equals(intent.getAction())){
            try{
                JSONObject next=cleanConfig(new JSONObject(intent.getStringExtra("config")==null?"{}":intent.getStringExtra("config")));
                String secret=intent.getStringExtra("passcode");intent.removeExtra("passcode");validatePasscode(secret);
                disconnect();config=next;passcode=secret;wanted=true;error="";state="connecting";
                startVisible();configureLocation();long version=++generation;network.execute(()->connectionLoop(version));publish();
            }catch(Exception failure){error=failure.getMessage()==null?"Não foi possível iniciar APRS-IS.":failure.getMessage();state="error";publish();stopSelf();}
        }
        return START_NOT_STICKY;
    }
    private void startVisible(){
        int type=0;
        if(Build.VERSION.SDK_INT>=34)type=ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING;
        if(config.optBoolean("beacon")&&hasLocationPermission()&&Build.VERSION.SDK_INT>=29)type|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        if(Build.VERSION.SDK_INT>=29&&type!=0)startForeground(NOTIFICATION,notification(),type);else startForeground(NOTIFICATION,notification());
    }
    private Notification notification(){
        Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent end=new Intent(this,AprsService.class).setAction(DISCONNECT);
        int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0);
        String label=verified?"Ligado":state.equals("receive-only")?"Somente receção":state.equals("reconnecting")?"A religar":"A ligar";
        return new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle("ZapDMR · APRS-IS "+config.optString("callsign")).setContentText(label+(config.optBoolean("beacon")?" · posição periódica ativa":" · mensagens e escuta")).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(PendingIntent.getActivity(this,0,open,flags)).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Desligar APRS",PendingIntent.getService(this,1,end,flags)).build();
    }
    private void connectionLoop(long version){
        int retry=0;
        while(wanted&&version==generation){
            Socket current=null;
            try{
                verified=false;state=retry==0?"connecting":"reconnecting";publish();
                InetAddress address=null;for(InetAddress candidate:InetAddress.getAllByName(config.getString("host")))if(candidate instanceof Inet4Address){address=candidate;break;}
                if(address==null)throw new IOException("Servidor APRS sem endereço IPv4 disponível.");
                current=new Socket();synchronized(this){if(version!=generation){current.close();return;}socket=current;}
                current.setKeepAlive(true);current.setTcpNoDelay(true);current.setSoTimeout(20000);current.connect(new InetSocketAddress(address,config.optInt("port",14580)),15000);
                boolean loggedIn=false;ByteArrayOutputStream line=new ByteArrayOutputStream();int input;boolean discard=false;
                BufferedInputStream incoming=new BufferedInputStream(current.getInputStream(),8192);
                while(wanted&&version==generation&&(input=incoming.read())>=0){
                    rxBytes++;
                    if(input==10){
                        String text=new String(line.toByteArray(),StandardCharsets.ISO_8859_1).replaceFirst("\\r$","");line.reset();
                        if(!discard){
                            if(!loggedIn&&text.startsWith("#")){String filter=config.optBoolean("map")&&hasPosition()?" filter r/"+config.optDouble("latitude")+"/"+config.optDouble("longitude")+"/"+config.optInt("rangeKm"):"";write("user "+config.getString("callsign")+" pass "+passcode+" vers ZapDMR 1.3.1"+filter);loggedIn=true;}
                            line(text);if(state.equals("connected")||state.equals("receive-only")){current.setSoTimeout(180000);retry=0;}
                        }
                        discard=false;
                    }else if(line.size()<511&&!discard)line.write(input);else{line.reset();discard=true;}
                }
                throw new IOException("Ligação APRS-IS encerrada.");
            }catch(Exception failure){if(version!=generation)return;error=failure.getMessage()==null?"Ligação APRS perdida.":failure.getMessage();}
            finally{if(current!=null)try{current.close();}catch(IOException ignored){}synchronized(this){if(socket==current)socket=null;}}
            if(!wanted||version!=generation)return;verified=false;state="reconnecting";publish();
            long deadline=android.os.SystemClock.elapsedRealtime()+Math.min(60000,3000L*++retry);
            while(wanted&&version==generation&&android.os.SystemClock.elapsedRealtime()<deadline)try{Thread.sleep(200);}catch(InterruptedException end){Thread.currentThread().interrupt();return;}
        }
    }
    private void write(String line)throws IOException{
        if(line.indexOf('\r')>=0||line.indexOf('\n')>=0||line.getBytes(StandardCharsets.ISO_8859_1).length>510)throw new IOException("Pacote APRS inválido.");
        byte[] bytes=(line+"\r\n").getBytes(StandardCharsets.ISO_8859_1);
        synchronized(writeLock){Socket current=socket;if(current==null||current.isClosed()||!current.isConnected())throw new IOException("Ligue primeiro ao APRS-IS.");current.getOutputStream().write(bytes);current.getOutputStream().flush();txBytes+=bytes.length;}
    }
    private String packet(String body){if(!verified)throw new IllegalStateException("O servidor APRS ainda não confirmou um login verificado.");return config.optString("callsign")+">APZDMR,TCPIP*:"+body;}
    synchronized JSONObject sendMessage(String recipient,String text)throws IOException{
        String to=station(recipient);
        if(!validStation(to))throw new IllegalArgumentException("Indique o indicativo APRS com SSID correto.");
        if(!config.optBoolean("messages"))throw new IllegalStateException("Ative Mensagens APRS nas definições.");
        if(text==null||!text.matches("[\\x20-\\x7e]{1,67}")||text.matches(".*[\\{|~].*"))throw new IllegalArgumentException("APRS aceita até 67 caracteres ASCII, sem {, | ou ~.");
        if(pending.size()>=5)throw new IllegalStateException("Aguarde as mensagens pendentes (máximo 5).");
        String id=String.valueOf(sequence++%99999);String outbound=packet(":"+pad(to)+":"+text+"{"+id);write(outbound);
        JSONObject row=json("id",id,"from",config.optString("callsign"),"to",to,"text",text,"direction","out","state","pending","at",System.currentTimeMillis());
        pending.put(id,new Pending(row,outbound));record(row);return copy(row);
    }
    synchronized void position(double latitude,double longitude)throws IOException{
        if(!validPosition(latitude,longitude))throw new IllegalArgumentException("Posição GPS inválida.");
        if(config.optString("callsign").isEmpty())throw new IllegalStateException("Configure a sessão APRS.");
        try{config.put("latitude",latitude);config.put("longitude",longitude);}catch(Exception ignored){}
        if(socket!=null&&socket.isConnected()&&!socket.isClosed()&&("connected".equals(state)||"receive-only".equals(state))&&config.optBoolean("map"))write("#filter r/"+latitude+"/"+longitude+"/"+config.optInt("rangeKm",250));
        publish();
    }
    synchronized void beacon()throws IOException{
        if(!config.optBoolean("beacon"))throw new IllegalStateException("Ative Envio APRS-IS para publicar a sua posição.");
        if(!hasPosition())throw new IllegalStateException("Obtenha primeiro uma posição GPS válida.");
        double lat=config.optDouble("latitude"),lon=config.optDouble("longitude");String symbol=config.optString("symbol","[");
        write(packet("="+coordinate(lat,true)+"/"+coordinate(lon,false)+symbol+"ZapDMR"));lastBeaconAt=System.currentTimeMillis();beaconLatitude=lat;beaconLongitude=lon;publish();
    }
    private static String coordinate(double value,boolean latitude){
        // Work in hundredths of a minute so 59.999 minutes carries into the next degree.
        long total=Math.round(Math.abs(value)*6000);long degrees=total/6000,minutes=total%6000;
        return String.format(Locale.ROOT,latitude?"%02d%02d.%02d%c":"%03d%02d.%02d%c",degrees,minutes/100,minutes%100,latitude?(value<0?'S':'N'):(value<0?'W':'E'));
    }
    private synchronized void line(String line)throws IOException{
        if(line.startsWith("#")){
            Matcher response=Pattern.compile("^#\\s*logresp\\s+([A-Za-z0-9-]+)\\s+(verified|unverified)\\b",Pattern.CASE_INSENSITIVE).matcher(line);
            if(response.find()&&station(response.group(1)).equals(config.optString("callsign"))){verified="verified".equalsIgnoreCase(response.group(2));state=verified?"connected":"receive-only";error=verified?"":"Login APRS não verificado: apenas receção.";publish();}
            return;
        }
        Matcher frame=Pattern.compile("^([A-Za-z0-9-]+)>[^:]+:(.*)$").matcher(line);if(!frame.matches())return;String from=station(frame.group(1)),body=frame.group(2);if(!validStation(from))return;
        if(body.startsWith(":")&&body.length()>=11&&body.charAt(10)==':'){
            String to=station(body.substring(1,10).trim()),text=body.substring(11);if(!to.equals(config.optString("callsign"))||!config.optBoolean("messages"))return;
            Matcher ack=Pattern.compile("^(ack|rej)([A-Za-z0-9]{1,5})(?:}|$)").matcher(text);
            if(ack.find()){Pending item=pending.get(ack.group(2));if(item!=null&&item.message.optString("to").equals(from)){pending.remove(ack.group(2));JSONObject row=copy(item.message);put(row,"state","ack".equals(ack.group(1))?"acknowledged":"rejected");record(row);}return;}
            int split=text.lastIndexOf('{');String id=split>=0?text.substring(split+1).split("}",2)[0]:"";if(!id.isEmpty()&&!id.matches("[A-Za-z0-9]{1,5}"))return;
            if(!id.isEmpty()&&verified)write(packet(":"+pad(from)+":ack"+id));String key=from+":"+(id.isEmpty()?text:id);if(seen.containsKey(key))return;seen.put(key,System.currentTimeMillis());if(seen.size()>2000)seen.remove(seen.keySet().iterator().next());
            record(json("id",id.isEmpty()?String.valueOf(System.currentTimeMillis()):id,"from",from,"to",to,"text",split>=0?text.substring(0,split):text,"direction","in","state","received","at",System.currentTimeMillis()));return;
        }
        if(body.isEmpty()||"=/@!".indexOf(body.charAt(0))<0)return;int start=body.charAt(0)=='/'||body.charAt(0)=='@'?8:1;if(body.length()<=start)return;
        Matcher position=Pattern.compile("^(\\d{2})(\\d{2}\\.\\d{2})([NS]).(\\d{3})(\\d{2}\\.\\d{2})([EW])").matcher(body.substring(start));if(!position.find())return;
        double latMinutes=Double.parseDouble(position.group(2)),lonMinutes=Double.parseDouble(position.group(5));if(latMinutes>=60||lonMinutes>=60)return;
        double latitude=(Double.parseDouble(position.group(1))+latMinutes/60)*(position.group(3).equals("S")?-1:1),longitude=(Double.parseDouble(position.group(4))+lonMinutes/60)*(position.group(6).equals("W")?-1:1);if(!validPosition(latitude,longitude))return;
        JSONObject station=json("callsign",from,"latitude",latitude,"longitude",longitude,"at",System.currentTimeMillis());stations.put(from,station);if(stations.size()>500)stations.remove(stations.keySet().iterator().next());emit("station",station);
    }
    private synchronized void tick(){
        long now=System.currentTimeMillis();Iterator<Map.Entry<String,Long>> duplicates=seen.entrySet().iterator();while(duplicates.hasNext())if(now-duplicates.next().getValue()>3600000)duplicates.remove();
        for(String id:new ArrayList<>(pending.keySet())){Pending item=pending.get(id);if(item==null||now-item.at<30000)continue;if(item.tries>=3||!wanted){pending.remove(id);JSONObject row=copy(item.message);put(row,"state","failed");record(row);}else if(verified)try{write(item.packet);item.tries++;item.at=now;}catch(Exception ignored){}else if(now-item.at>180000){pending.remove(id);JSONObject row=copy(item.message);put(row,"state","failed");record(row);}}
        if(wanted&&verified&&config.optBoolean("beacon")&&hasPosition()){
            long interval=config.optInt("intervalMinutes",5)*60000L;
            if(config.optBoolean("smartBeacon")&&Double.isFinite(beaconLatitude)){float[] distance=new float[1];Location.distanceBetween(beaconLatitude,beaconLongitude,config.optDouble("latitude"),config.optDouble("longitude"),distance);if(distance[0]>=500)interval=Math.min(interval,60000);}
            if(now-lastBeaconAt>=interval)try{beacon();}catch(Exception failure){error=failure.getMessage();publish();}
        }
    }
    private boolean hasLocationPermission(){return ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private void configureLocation(){
        if(!config.optBoolean("beacon")||!hasLocationPermission())return;
        try{locations=(LocationManager)getSystemService(LOCATION_SERVICE);if(locations.isProviderEnabled(LocationManager.GPS_PROVIDER)&&ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,30000,25,locationListener,Looper.getMainLooper());if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,60000,50,locationListener,Looper.getMainLooper());}catch(Exception failure){error="Não foi possível acompanhar o GPS: "+failure.getMessage();publish();}
    }
    synchronized JSONObject snapshot(){JSONArray rows=new JSONArray();for(JSONObject row:history)rows.put(copy(row));JSONArray nearby=new JSONArray();for(JSONObject row:stations.values())nearby.put(copy(row));return json("state",state,"verified",verified,"station",config.optString("callsign"),"lastBeaconAt",lastBeaconAt==0?JSONObject.NULL:lastBeaconAt,"rxBytes",rxBytes,"txBytes",txBytes,"error",error,"messages",rows,"stations",nearby,"latitude",config.has("latitude")?config.optDouble("latitude"):JSONObject.NULL,"longitude",config.has("longitude")?config.optDouble("longitude"):JSONObject.NULL);}
    static JSONObject snapshot(Context context){AprsService service=active;if(service!=null)return service.snapshot();JSONArray rows=new JSONArray();for(JSONObject row:loadHistory(context))rows.put(row);return json("state","disconnected","verified",false,"station","","lastBeaconAt",JSONObject.NULL,"rxBytes",0,"txBytes",0,"error","","messages",rows,"stations",new JSONArray());}
    private synchronized void record(JSONObject row){int match=-1;for(int i=0;i<history.size();i++){JSONObject old=history.get(i);if(old.optString("id").equals(row.optString("id"))&&old.optString("from").equals(row.optString("from"))&&old.optString("to").equals(row.optString("to"))&&old.optString("direction").equals(row.optString("direction"))){match=i;break;}}if(match>=0)history.set(match,copy(row));else history.add(copy(row));while(history.size()>500)history.remove(0);saveHistory();emit("message",row);}
    private void saveHistory(){AtomicFile file=new AtomicFile(new File(getFilesDir(),"aprs-history.json"));FileOutputStream output=null;try{JSONArray rows=new JSONArray();for(JSONObject row:history)rows.put(row);output=file.startWrite();output.write(rows.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(output);}catch(Exception failure){if(output!=null)file.failWrite(output);error="Não foi possível guardar o histórico APRS.";}}
    private static ArrayList<JSONObject> loadHistory(Context context){ArrayList<JSONObject> rows=new ArrayList<>();try(FileInputStream input=new AtomicFile(new File(context.getFilesDir(),"aprs-history.json")).openRead()){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))>0){if(bytes.size()+count>1024*1024)throw new IOException("Histórico excessivo");bytes.write(buffer,0,count);}JSONArray array=new JSONArray(new String(bytes.toByteArray(),StandardCharsets.UTF_8));for(int i=Math.max(0,array.length()-500);i<array.length();i++){JSONObject row=array.optJSONObject(i);if(row==null||!validStation(row.optString("from"))||!validStation(row.optString("to"))||row.optString("text").length()>512)continue;if("pending".equals(row.optString("state")))put(row,"state","failed");rows.add(row);}}catch(Exception ignored){}return rows;}
    private void publish(){emit("status",snapshot());if(wanted){String key=state+":"+config.optString("callsign")+":"+config.optBoolean("beacon");long now=android.os.SystemClock.elapsedRealtime();synchronized(this){if(key.equals(notificationState)&&now-notificationAt<30000)return;notificationState=key;notificationAt=now;}main.post(()->{if(!wanted)return;try{getSystemService(NotificationManager.class).notify(NOTIFICATION,notification());}catch(Exception ignored){}});}}
    private void emit(String event,JSONObject data){sendBroadcast(new Intent(EVENT).setPackage(getPackageName()).putExtra("event",event).putExtra("data",data.toString()));}
    synchronized void disconnect(){wanted=false;++generation;verified=false;passcode="";state="disconnected";Socket current=socket;socket=null;if(current!=null)try{current.close();}catch(IOException ignored){}if(locations!=null)try{locations.removeUpdates(locationListener);}catch(Exception ignored){}for(Pending item:pending.values()){JSONObject row=copy(item.message);put(row,"state","failed");record(row);}pending.clear();publish();}
    private void closeNetworkSocket(){Socket current=socket;if(current!=null)try{current.close();}catch(IOException ignored){}}
    @Override public void onDestroy(){disconnect();try{if(connectivity!=null)connectivity.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}timer.shutdownNow();network.shutdownNow();main.removeCallbacksAndMessages(null);active=null;super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
    private boolean hasPosition(){return validPosition(config.optDouble("latitude",Double.NaN),config.optDouble("longitude",Double.NaN));}
    private static boolean validPosition(double lat,double lon){return Double.isFinite(lat)&&Double.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
    private static int bound(int value,int min,int max){return Math.max(min,Math.min(max,value));}
    private static String pad(String value){return String.format(Locale.ROOT,"%-9s",value);}
    private static JSONObject copy(JSONObject value){try{return new JSONObject(value.toString());}catch(Exception ignored){return new JSONObject();}}
    private static void put(JSONObject object,String key,Object value){try{object.put(key,value);}catch(Exception ignored){}}
    private static JSONObject json(Object... pairs){JSONObject value=new JSONObject();try{for(int i=0;i<pairs.length;i+=2)value.put(String.valueOf(pairs[i]),pairs[i+1]);}catch(Exception ignored){}return value;}
}
