package br.radio.zapdmr;

/** Android AudioDeviceInfo type classification; virtual/telephony inputs are not microphones. */
final class CarAudioTypes {
    static boolean bluetooth(int type){return type==7||type==26;}
    static boolean microphone(int type){return type==3||type==7||type==11||type==12||type==15||type==22||type==26;}
    static String label(int type){switch(type){case 7:return "Bluetooth SCO / HFP";case 8:return "Bluetooth A2DP · reprodução";case 15:return "Microfone integrado";case 18:return "Telefonia · interface interna";case 25:return "remote-submix · interface virtual";case 26:return "Bluetooth LE headset";case 3:return "Headset com fio";case 11:case 12:case 22:return "Áudio USB";default:return "Dispositivo Android tipo "+type;}}
}
