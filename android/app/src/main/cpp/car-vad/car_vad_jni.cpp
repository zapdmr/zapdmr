#include <jni.h>
#include "webrtc/common_audio/vad/include/webrtc_vad.h"
extern "C" JNIEXPORT jlong JNICALL Java_br_radio_zapdmr_WebRtcVad_create(JNIEnv*,jclass,jint mode){VadInst* p=WebRtcVad_Create();if(!p)return 0;if(WebRtcVad_Init(p)||WebRtcVad_set_mode(p,mode)){WebRtcVad_Free(p);return 0;}return reinterpret_cast<jlong>(p);}
extern "C" JNIEXPORT jint JNICALL Java_br_radio_zapdmr_WebRtcVad_process(JNIEnv* env,jclass,jlong handle,jshortArray pcm){if(!handle||!pcm||env->GetArrayLength(pcm)!=160)return -1;int16_t samples[160];env->GetShortArrayRegion(pcm,0,160,reinterpret_cast<jshort*>(samples));return WebRtcVad_Process(reinterpret_cast<VadInst*>(handle),8000,samples,160);}
extern "C" JNIEXPORT void JNICALL Java_br_radio_zapdmr_WebRtcVad_destroy(JNIEnv*,jclass,jlong handle){if(handle)WebRtcVad_Free(reinterpret_cast<VadInst*>(handle));}
