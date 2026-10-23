#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <sddl.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <condition_variable>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <filesystem>
#include <functional>
#include <iostream>
#include <mutex>
#include <memory>
#include <cmath>
#include <span>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

using Microsoft::WRL::ComPtr;

namespace {
constexpr int kQdvAbi = 2;
constexpr DWORD kMaxPipeFrame = 64 * 1024;
constexpr size_t kPcmSamplesPerFrame = 160; // 20 ms at 8 kHz
constexpr size_t kPcmBytesPerFrame = kPcmSamplesPerFrame * sizeof(int16_t);
constexpr size_t kQdvFecBufferBytes = 12;   // ABI comment says 96 bits; implementation currently writes bits 0..71.
constexpr size_t kDmrAmbeCodewordBytes = 9; // 72-bit DMR AMBE codeword; resolve the ABI comment mismatch before release.

// Pipe message types. Every record is [uint32 little-endian body length][type][payload].
enum : uint8_t {
  MSG_HELLO = 0x01,
  MSG_START_AUDIO = 0x02,
  MSG_STOP_AUDIO = 0x03,
  MSG_SELECT_CAPTURE = 0x04, // UTF-8 endpoint ID
  MSG_SELECT_RENDER = 0x05,  // UTF-8 endpoint ID
  MSG_SET_PTT = 0x06,       // active:u8, talkgroup:u32 little-endian
  MSG_RX_FEC = 0x07,        // one 9-byte AMBE FEC codeword (requires a DMR unframer upstream)
  MSG_LIST_DEVICES = 0x08,
  MSG_ENCODE_SILENCE = 0x09, // count:u8; return count codec-generated 20 ms silence codewords
  MSG_TX_FEC = 0x10,        // one 9-byte codeword, not a 33-byte DMR slot
  MSG_SILENCE_FEC = 0x11,   // one or more contiguous 9-byte silence codewords
  MSG_AUDIO_LEVEL = 0x12,   // direction:u8 (1=TX, 2=RX), level:u8 (0-100)
  MSG_SET_TX_GAIN = 0x13,   // gain:u16le (0-260 percent), legacy u8 accepted
  MSG_SET_RX_VOLUME = 0x14,// volume:u8 (0-200 percent)
  MSG_AUDIO_TEST = 0x15,   // encode/decode a short 440 Hz vocoder loopback tone
  MSG_ENCODE_PCM = 0x16,   // 160 little-endian PCM16 samples (20 ms at 8 kHz) from mobile relay
  MSG_SET_REMOTE_AUDIO = 0x18, // enable/disable remote PCM input (suppresses local mic uplink)
  MSG_CLEAR_RX = 0x19, // discard queued playback when changing TG
  MSG_STATUS = 0x80,        // UTF-8 status text
  MSG_DEVICE_LIST = 0x81,
  MSG_ERROR = 0x82,         // UTF-8 JSON: { ok:false, code, message }
  MSG_RX_PCM = 0x17         // one decoded 20 ms frame as 320 PCM16 bytes for mobile playback
};

class SidecarError : public std::runtime_error {
public:
  SidecarError(std::string code, std::string message)
      : std::runtime_error(std::move(message)), code_(std::move(code)) {}
  const std::string& code() const noexcept { return code_; }
private:
  std::string code_;
};

void checkHr(HRESULT hr, const char* what) {
  if (FAILED(hr)) throw std::runtime_error(std::string(what) + " failed (HRESULT=" + std::to_string(static_cast<unsigned long>(hr)) + ")");
}

class ComApartment {
public:
  ComApartment() { checkHr(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "CoInitializeEx"); }
  ~ComApartment() { CoUninitialize(); }
  ComApartment(const ComApartment&) = delete;
  ComApartment& operator=(const ComApartment&) = delete;
};

struct WaveFormatDeleter {
  void operator()(WAVEFORMATEX* format) const { CoTaskMemFree(format); }
};

std::wstring utf8ToWide(std::span<const uint8_t> bytes) {
  if (bytes.empty()) return {};
  if (bytes.size() > 4096) throw std::runtime_error("Device ID too long");
  const int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
      reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), nullptr, 0);
  if (n <= 0) throw std::runtime_error("Invalid UTF-8 in pipe message");
  std::wstring out(static_cast<size_t>(n), L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
      reinterpret_cast<const char*>(bytes.data()), static_cast<int>(bytes.size()), out.data(), n);
  return out;
}

std::string wideToUtf8(const wchar_t* value) {
  if (!value) return {};
  const int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, nullptr, 0, nullptr, nullptr);
  if (n <= 1) return {};
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1, out.data(), n, nullptr, nullptr);
  out.resize(static_cast<size_t>(n - 1));
  return out;
}

std::array<uint8_t, 32> parseSha256(const char* hex) {
  std::array<uint8_t, 32> out{};
  for (size_t i = 0; i < out.size(); ++i) {
    unsigned int byte = 0;
    if (sscanf_s(hex + i * 2, "%2x", &byte) != 1) throw std::runtime_error("Invalid built-in SHA-256");
    out[i] = static_cast<uint8_t>(byte);
  }
  return out;
}

std::array<uint8_t, 32> sha256File(const std::wstring& path) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Cannot open firmware file for SHA-256");

  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::vector<uint8_t> hashObject;
  std::array<uint8_t, 32> digest{};
  try {
    NTSTATUS status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0);
    if (status < 0) throw std::runtime_error("BCryptOpenAlgorithmProvider(SHA-256) failed");
    DWORD objectSize = 0, received = 0;
    status = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
        reinterpret_cast<PUCHAR>(&objectSize), sizeof(objectSize), &received, 0);
    if (status < 0) throw std::runtime_error("BCryptGetProperty failed");
    hashObject.resize(objectSize);
    status = BCryptCreateHash(algorithm, &hash, hashObject.data(), objectSize, nullptr, 0, 0);
    if (status < 0) throw std::runtime_error("BCryptCreateHash failed");

    std::array<uint8_t, 64 * 1024> block{};
    DWORD bytesRead = 0;
    for (;;) {
      if (!ReadFile(file, block.data(), static_cast<DWORD>(block.size()), &bytesRead, nullptr))
        throw std::runtime_error("Error reading firmware during SHA-256");
      if (bytesRead == 0) break;
      status = BCryptHashData(hash, block.data(), bytesRead, 0);
      if (status < 0) throw std::runtime_error("BCryptHashData failed");
    }
    status = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
    if (status < 0) throw std::runtime_error("BCryptFinishHash failed");
  } catch (...) {
    if (hash) BCryptDestroyHash(hash);
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    CloseHandle(file);
    throw;
  }
  if (hash) BCryptDestroyHash(hash);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  CloseHandle(file);
  return digest;
}

void verifyFile(const std::wstring& path, uint64_t expectedSize, const char* expectedHash, const wchar_t* label) {
  WIN32_FILE_ATTRIBUTE_DATA info{};
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &info)) {
    const DWORD error = GetLastError();
    const bool missing = error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
    throw SidecarError(missing ? "ASSET_NOT_FOUND" : "ASSET_UNREADABLE",
        std::string(missing ? "Required asset not found: " : "Cannot inspect required asset: ") +
        wideToUtf8(path.c_str()) + " (Win32=" + std::to_string(error) + ")");
  }
  const uint64_t size = (static_cast<uint64_t>(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
  if (size != expectedSize)
    throw SidecarError("ASSET_SIZE_MISMATCH", std::string("Unexpected file size for ") + wideToUtf8(label));
  std::array<uint8_t, 32> actual{};
  try { actual = sha256File(path); }
  catch (const std::exception& e) {
    throw SidecarError("ASSET_HASH_READ_FAILED", std::string("Could not calculate SHA-256 for ") +
        wideToUtf8(path.c_str()) + ": " + e.what());
  }
  const auto expected = parseSha256(expectedHash);
  if (memcmp(actual.data(), expected.data(), expected.size()) != 0)
    throw SidecarError("ASSET_HASH_MISMATCH", std::string("SHA-256 mismatch for ") + wideToUtf8(label));
  std::wcerr << L"Verified local file: " << label << L"\n";
}

class Vocoder {
public:
  using AbiVersionFn = int (__cdecl*)();
  using BuildIdFn = const char* (__cdecl*)();
  using InitFn = int (__cdecl*)(const char*, const char*);
  using EncodeFecFn = void (__cdecl*)(uint8_t*, const int16_t*);
  using DecodeFecFn = void (__cdecl*)(const uint8_t*, int16_t*);
  using ShutdownFn = void (__cdecl*)();

  void load(const std::wstring& dllPath, const std::wstring& firmwarePath, const std::wstring& corePath) {
    // Validate external firmware/core before loading the codec and before qdv_init.
    verifyFile(firmwarePath, 994304, "c0351f250a834660641bca3b06be931c80cc1ed0ef808356c550b99cd0f4c632", L"D002.032.bin");
    verifyFile(corePath, 131072, "d40398183e9aa8db6288a62d9a0e0c233cb143ef5633680abd829cc03c719f66", L"d02032-core.img");

    module_ = LoadLibraryExW(dllPath.c_str(), nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!module_) throw SidecarError("VOCODER_DLL_LOAD_FAILED",
        "Could not load vocoder DLL '" + wideToUtf8(dllPath.c_str()) +
        "' (Win32=" + std::to_string(GetLastError()) + ")");

    abiVersion_ = symbol<AbiVersionFn>("qdv_abi_version");
    buildId_ = symbol<BuildIdFn>("qdv_build_id");
    init_ = symbol<InitFn>("qdv_init");
    encodeFec_ = symbol<EncodeFecFn>("qdv_encode_fec");
    decodeFec_ = symbol<DecodeFecFn>("qdv_decode_fec");
    shutdown_ = symbol<ShutdownFn>("qdv_shutdown");
    if (abiVersion_() != kQdvAbi) throw SidecarError("VOCODER_ABI_MISMATCH", "Expected vocoder ABI v2");

    const std::string fw = wideToUtf8(firmwarePath.c_str());
    const std::string core = wideToUtf8(corePath.c_str());
    // The ABI accepts char paths. Keep firmware in an ASCII-only path unless the
    // DLL's Windows path conversion has been confirmed for the target build.
    const int rc = init_(fw.c_str(), core.c_str());
    if (rc != 0) throw SidecarError("VOCODER_INIT_FAILED", "qdv_init returned status " + std::to_string(rc));
    initialized_ = true;
    std::cout << "Vocoder ABI " << abiVersion_() << ": " << (buildId_() ? buildId_() : "(unknown build)") << "\n";
  }

  ~Vocoder() {
    if (initialized_ && shutdown_) shutdown_();
    if (module_) FreeLibrary(module_);
  }

  std::array<uint8_t, kDmrAmbeCodewordBytes> encodeFec(const int16_t* pcm) {
    std::array<uint8_t, kQdvFecBufferBytes> output{};
    std::lock_guard lock(codecMutex_); // The emulator behind this ABI has global state.
    encodeFec_(output.data(), pcm);
    std::array<uint8_t, kDmrAmbeCodewordBytes> codeword{};
    std::copy_n(output.begin(), codeword.size(), codeword.begin());
    return codeword;
  }

  std::array<int16_t, kPcmSamplesPerFrame> decodeFec(const uint8_t* codeword) {
    std::array<uint8_t, kQdvFecBufferBytes> input{};
    std::copy_n(codeword, kDmrAmbeCodewordBytes, input.begin());
    std::array<int16_t, kPcmSamplesPerFrame> pcm{};
    std::lock_guard lock(codecMutex_);
    decodeFec_(input.data(), pcm.data());
    return pcm;
  }

  void sanityCheck() {
    std::array<int16_t, kPcmSamplesPerFrame> silence{};
    std::array<uint8_t, kQdvFecBufferBytes> encoded{};
    encoded.fill(0xA5);
    std::array<uint8_t, kQdvFecBufferBytes> decoderInput{};
    std::array<int16_t, kPcmSamplesPerFrame> decoded{};
    constexpr int16_t kPcmCanary = static_cast<int16_t>(0x5A5A);
    decoded.fill(kPcmCanary);
    {
      std::lock_guard lock(codecMutex_);
      encodeFec_(encoded.data(), silence.data());
      if (std::all_of(encoded.begin(), encoded.begin() + kDmrAmbeCodewordBytes,
              [](uint8_t value) { return value == 0xA5; }))
        throw SidecarError("VOCODER_SANITY_FAILED", "qdv_encode_fec did not write the expected codeword buffer");
      // The app's current DMR path consumes 72-bit/9-byte codewords. Zero-pad
      // the ABI input buffer because the published qdv_*_fec size contract is
      // still ambiguous between 9 and 12 bytes.
      std::copy_n(encoded.begin(), kDmrAmbeCodewordBytes, decoderInput.begin());
      decodeFec_(decoderInput.data(), decoded.data());
    }
    if (std::all_of(decoded.begin(), decoded.end(), [](int16_t sample) { return sample == kPcmCanary; }))
      throw SidecarError("VOCODER_SANITY_FAILED", "qdv_decode_fec did not write the PCM output buffer");
  }

private:
  template<class T> T symbol(const char* name) {
    auto proc = reinterpret_cast<T>(GetProcAddress(module_, name));
    if (!proc) throw SidecarError("VOCODER_EXPORT_MISSING", std::string("Missing vocoder export: ") + name);
    return proc;
  }

  HMODULE module_ = nullptr;
  AbiVersionFn abiVersion_ = nullptr;
  BuildIdFn buildId_ = nullptr;
  InitFn init_ = nullptr;
  EncodeFecFn encodeFec_ = nullptr;
  DecodeFecFn decodeFec_ = nullptr;
  ShutdownFn shutdown_ = nullptr;
  bool initialized_ = false;
  std::mutex codecMutex_;
};

bool transferExact(HANDLE pipe, void* data, DWORD length, bool writing) {
  HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!event) return false;
  auto* bytes = static_cast<uint8_t*>(data);
  DWORD done = 0;
  while (done < length) {
    OVERLAPPED overlapped{};
    overlapped.hEvent = event;
    ResetEvent(event);
    DWORD transferred = 0;
    const DWORD remaining = length - done;
    const BOOL started = writing
        ? WriteFile(pipe, bytes + done, remaining, &transferred, &overlapped)
        : ReadFile(pipe, bytes + done, remaining, &transferred, &overlapped);
    if (!started) {
      const DWORD startError = GetLastError();
      if (startError != ERROR_IO_PENDING || WaitForSingleObject(event, INFINITE) != WAIT_OBJECT_0 ||
          !GetOverlappedResult(pipe, &overlapped, &transferred, FALSE)) {
        const DWORD error = GetLastError();
        std::cerr << "ZapDMRAudio: pipe " << (writing ? "WriteFile" : "ReadFile")
                  << " failed (Win32=" << error << ")\n" << std::flush;
        CloseHandle(event);
        return false;
      }
    }
    if (transferred == 0) { CloseHandle(event); return false; }
    done += transferred;
  }
  CloseHandle(event);
  return true;
}

bool readExact(HANDLE pipe, void* data, DWORD length) {
  return transferExact(pipe, data, length, false);
}

bool writeExact(HANDLE pipe, const void* data, DWORD length) {
  return transferExact(pipe, const_cast<void*>(data), length, true);
}

struct OutMessage { uint8_t type; std::vector<uint8_t> payload; };

std::string jsonEscape(const std::string& input) {
  std::string out;
  out.reserve(input.size() + 8);
  for (unsigned char ch : input) {
    switch (ch) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) {
          constexpr char hex[] = "0123456789abcdef";
          out += "\\u00";
          out += hex[ch >> 4];
          out += hex[ch & 0x0f];
        } else out += static_cast<char>(ch);
    }
  }
  return out;
}

class PipeWriter {
public:
  explicit PipeWriter(HANDLE pipe) : pipe_(pipe), thread_([this] { run(); }) {}
  ~PipeWriter() { stop(); }
  void send(uint8_t type, std::span<const uint8_t> payload = {}) {
    std::lock_guard lock(mutex_);
    if (stopping_) return;
    // Bound latency and memory if the UI stops reading. Drop newest voice data;
    // never block the WASAPI capture thread on a stalled Node process.
    if (queue_.size() >= 128 && type == MSG_TX_FEC) return;
    if (queue_.size() >= 256) queue_.pop_front();
    queue_.push_back(OutMessage{type, {payload.begin(), payload.end()}});
    cv_.notify_one();
  }
  void status(const std::string& text) {
    send(MSG_STATUS, std::span(reinterpret_cast<const uint8_t*>(text.data()), text.size()));
  }
  void error(const std::string& code, const std::string& message) {
    const std::string json = "{\"ok\":false,\"code\":\"" + jsonEscape(code) +
        "\",\"message\":\"" + jsonEscape(message) + "\"}";
    send(MSG_ERROR, std::span(reinterpret_cast<const uint8_t*>(json.data()), json.size()));
  }
  void stop() {
    { std::lock_guard lock(mutex_); stopping_ = true; }
    cv_.notify_all();
    if (thread_.joinable()) thread_.join();
  }
private:
  void run() {
    for (;;) {
      OutMessage message;
      {
        std::unique_lock lock(mutex_);
        cv_.wait(lock, [&] { return stopping_ || !queue_.empty(); });
        if (stopping_ && queue_.empty()) return;
        message = std::move(queue_.front()); queue_.pop_front();
      }
      const uint32_t bodyLength = static_cast<uint32_t>(1 + message.payload.size());
      const std::array<uint8_t, 4> prefix = {
        static_cast<uint8_t>(bodyLength), static_cast<uint8_t>(bodyLength >> 8),
        static_cast<uint8_t>(bodyLength >> 16), static_cast<uint8_t>(bodyLength >> 24)
      };
      std::vector<uint8_t> frame;
      frame.reserve(4 + bodyLength);
      frame.insert(frame.end(), prefix.begin(), prefix.end());
      frame.push_back(message.type);
      frame.insert(frame.end(), message.payload.begin(), message.payload.end());
      if (!writeExact(pipe_, frame.data(), static_cast<DWORD>(frame.size()))) {
        std::lock_guard lock(mutex_); stopping_ = true; queue_.clear(); cv_.notify_all(); return;
      }
    }
  }
  HANDLE pipe_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<OutMessage> queue_;
  bool stopping_ = false;
  std::thread thread_;
};

ComPtr<IMMDevice> getEndpoint(EDataFlow flow, const std::wstring& endpointId) {
  ComPtr<IMMDeviceEnumerator> enumerator;
  checkHr(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
      IID_PPV_ARGS(&enumerator)), "Create MMDeviceEnumerator");
  ComPtr<IMMDevice> device;
  if (endpointId.empty()) {
    // Follow the device selected in Windows Sound settings first. The
    // Communications role can still point at an old endpoint after the user
    // changes the ordinary default device.
    HRESULT hr = enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device);
    if (FAILED(hr)) hr = enumerator->GetDefaultAudioEndpoint(flow, eCommunications, &device);
    checkHr(hr, "GetDefaultAudioEndpoint (communications/console)");
  } else checkHr(enumerator->GetDevice(endpointId.c_str(), &device), "GetDevice");
  return device;
}

std::vector<uint8_t> enumerateDevices() {
  ComApartment com;
  ComPtr<IMMDeviceEnumerator> enumerator;
  checkHr(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
      IID_PPV_ARGS(&enumerator)), "Create MMDeviceEnumerator");
  std::vector<uint8_t> out;
  auto append16 = [&](uint16_t v) { out.push_back(static_cast<uint8_t>(v)); out.push_back(static_cast<uint8_t>(v >> 8)); };
  append16(0); // count, patched at end
  uint16_t count = 0;
  for (EDataFlow flow : {eCapture, eRender}) {
    ComPtr<IMMDeviceCollection> devices;
    checkHr(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices), "EnumAudioEndpoints");
    UINT n = 0; checkHr(devices->GetCount(&n), "IMMDeviceCollection::GetCount");
    for (UINT i = 0; i < n; ++i) {
      ComPtr<IMMDevice> device; checkHr(devices->Item(i, &device), "IMMDeviceCollection::Item");
      LPWSTR rawId = nullptr; checkHr(device->GetId(&rawId), "IMMDevice::GetId");
      const std::string id = wideToUtf8(rawId); CoTaskMemFree(rawId);
      ComPtr<IPropertyStore> store; checkHr(device->OpenPropertyStore(STGM_READ, &store), "OpenPropertyStore");
      PROPVARIANT name; PropVariantInit(&name);
      checkHr(store->GetValue(PKEY_Device_FriendlyName, &name), "Get friendly device name");
      const std::string friendly = name.vt == VT_LPWSTR ? wideToUtf8(name.pwszVal) : std::string("Audio device");
      PropVariantClear(&name);
      if (id.size() > UINT16_MAX || friendly.size() > UINT16_MAX) continue;
      out.push_back(flow == eCapture ? 0 : 1);
      append16(static_cast<uint16_t>(id.size())); append16(static_cast<uint16_t>(friendly.size()));
      out.insert(out.end(), id.begin(), id.end()); out.insert(out.end(), friendly.begin(), friendly.end());
      ++count;
    }
  }
  out[0] = static_cast<uint8_t>(count); out[1] = static_cast<uint8_t>(count >> 8);
  return out;
}

class AudioEngine {
public:
  AudioEngine(Vocoder& vocoder, PipeWriter& pipe) : vocoder_(vocoder), pipe_(pipe) {}
  ~AudioEngine() { stop(); }

  void start() {
    if (running_.load()) return;
    if (captureThread_.joinable()) captureThread_.join();
    if (renderThread_.joinable()) renderThread_.join();
    running_.store(true);
    pipe_.status("AUDIO_STARTING; opening default capture/render devices");
    captureThread_ = std::thread([this] { captureLoop(); });
    pipe_.status("CAPTURE_THREAD_CREATED");
    renderThread_ = std::thread([this] { renderLoop(); });
    pipe_.status("RENDER_THREAD_CREATED");
  }
  void stop() {
    const bool wasRunning = running_.exchange(false);
    if (captureThread_.joinable()) captureThread_.join();
    if (renderThread_.joinable()) renderThread_.join();
    ptt_.store(false);
    if (wasRunning) pipe_.status("AUDIO_STOPPED");
  }
  bool running() const { return running_.load(); }
  void setPtt(bool active, uint32_t tg) {
    if (active && (tg == 0 || tg > 0xFFFFFF)) throw std::runtime_error("TalkGroup outside valid range");
    if (active) {
      std::lock_guard lock(playbackMutex_);
      if (rxPlaybackActive_ || GetTickCount64() < rxTailUntil_) {
        pipe_.status("PTT_RX_BLOCKED");
        return;
      }
    }
    talkgroup_.store(active ? tg : 0);
    ptt_.store(active);
    if (!active) {
      const std::array<uint8_t, 2> idle = {1, 0};
      pipe_.send(MSG_AUDIO_LEVEL, idle);
    }
    pipe_.status(active ? "PTT_ARMED; awaiting microphone audio" : "PTT_RELEASED");
  }
  void setRemoteAudioInput(bool enabled) {
    remoteAudioInput_.store(enabled);
    pipe_.status(enabled ? "REMOTE_PCM_INPUT_ENABLED" : "REMOTE_PCM_INPUT_DISABLED");
  }
  void encodeRemotePcm(std::span<const uint8_t> bytes) {
    if (bytes.size() != kPcmBytesPerFrame) throw std::runtime_error("ENCODE_PCM expects one 320-byte PCM frame");
    if (!running_.load() || !ptt_.load()) throw std::runtime_error("Arm PTT before submitting remote PCM");
    std::array<int16_t, kPcmSamplesPerFrame> frame{};
    for (size_t i = 0; i < frame.size(); ++i) {
      const uint16_t raw = static_cast<uint16_t>(bytes[i * 2]) |
          (static_cast<uint16_t>(bytes[i * 2 + 1]) << 8);
      frame[i] = static_cast<int16_t>(raw);
    }
    const double gain = static_cast<double>(txGainPercent_.load()) / 100.0;
    for (auto& sample : frame) sample = static_cast<int16_t>(std::clamp(
        std::lround(static_cast<double>(sample) * gain), -32768L, 32767L));
    reportAudioLevel(1, frame);
    std::array<uint8_t, kDmrAmbeCodewordBytes> codeword{};
    {
      std::lock_guard lock(codecMutex_);
      codeword = vocoder_.encodeFec(frame.data());
    }
    if (ptt_.load() && remoteAudioInput_.load()) pipe_.send(MSG_TX_FEC, codeword);
  }
  std::array<int16_t, kPcmSamplesPerFrame> decodeVoiceCodeword(const uint8_t* codeword) {
    std::lock_guard lock(codecMutex_);
    return vocoder_.decodeFec(codeword);
  }
  void setTxGain(uint16_t percent) {
    if (percent > 260) throw std::runtime_error("TX gain must be between 0 and 260 percent");
    txGainPercent_.store(percent);
    pipe_.status("TX_GAIN_UPDATED");
  }
  void setRxVolume(uint16_t percent) {
    if (percent > 260) throw std::runtime_error("RX volume must be between 0 and 260 percent");
    rxVolumePercent_.store(percent);
    pipe_.status("RX_VOLUME_UPDATED");
  }
  std::array<int16_t, kPcmSamplesPerFrame> loopbackFrame(const std::array<int16_t, kPcmSamplesPerFrame>& frame) {
    std::lock_guard lock(codecMutex_);
    const auto codeword=vocoder_.encodeFec(frame.data());
    return vocoder_.decodeFec(codeword.data());
  }
  void microphoneTest() {
    if (!running_.load() || ptt_.load()) throw std::runtime_error("Stop PTT and start audio before microphone test");
    {std::lock_guard lock(testMutex_);testFrames_.clear();}
    testCapture_.store(true);Sleep(3000);testCapture_.store(false);
    std::vector<std::array<int16_t, kPcmSamplesPerFrame>> frames;
    {std::lock_guard lock(testMutex_);frames.swap(testFrames_);}
    if(frames.empty())throw std::runtime_error("No microphone samples captured. Check Windows microphone permission and input device.");
    for(const auto& frame:frames){const auto decoded=loopbackFrame(frame);reportAudioLevel(2,decoded);enqueuePlayback(decoded);Sleep(20);}
  }
  void selectDevice(EDataFlow flow, std::wstring id) {
    if (id.size() > 2048) throw std::runtime_error("Endpoint ID too long");
    {
      std::lock_guard lock(deviceMutex_);
      (flow == eCapture ? captureId_ : renderId_) = std::move(id);
    }
    if (running()) { stop(); start(); }
  }
  void clearRx() {
    std::lock_guard lock(playbackMutex_);playback_.clear();
    if(rxPlaybackActive_){rxPlaybackActive_=false;rxTailUntil_=GetTickCount64()+500;pipe_.status("RX_PLAYBACK_IDLE");}
    rxDecoding_=false;
    const std::array<uint8_t,2> idle={2,0};pipe_.send(MSG_AUDIO_LEVEL,idle);
  }
  void beginRxDecode() {
    std::lock_guard lock(playbackMutex_);rxDecoding_=true;
    if(!rxPlaybackActive_){rxPlaybackActive_=true;pipe_.status("RX_PLAYBACK_ACTIVE");}
  }
  void endRxDecode() { std::lock_guard lock(playbackMutex_);rxDecoding_=false; }
  void enqueuePlayback(const std::array<int16_t, kPcmSamplesPerFrame>& samples) {
    std::lock_guard lock(playbackMutex_);
    for (int16_t sample : samples) playback_.push_back(sample);
    constexpr size_t maxSamples = 8000; // Keep at most one second of decoded audio.
    while (playback_.size() > maxSamples) playback_.pop_front();
  }

  void reportAudioLevel(uint8_t direction, const std::array<int16_t, kPcmSamplesPerFrame>& samples) {
    if (direction != 1 && direction != 2) return;
    auto& lastSent = direction == 1 ? lastTxAudioLevelAt_ : lastRxAudioLevelAt_;
    const auto now = std::chrono::steady_clock::now();
    if (lastSent.time_since_epoch().count() != 0 && now - lastSent < std::chrono::milliseconds(55)) return;
    lastSent = now;
    long double energy = 0.0;
    for (const int16_t sample : samples) {
      const long double value = static_cast<long double>(sample);
      energy += value * value;
    }
    const double rms = std::sqrt(static_cast<double>(energy / samples.size()));
    const double dbfs = 20.0 * std::log10(std::max(rms / 32768.0, 1e-6));
    const uint8_t level = dbfs <= -54.0 ? 0 : static_cast<uint8_t>(std::clamp(
        std::lround((dbfs + 54.0) * (100.0 / 48.0)), 0L, 100L));
    const std::array<uint8_t, 2> payload = {direction, level};
    pipe_.send(MSG_AUDIO_LEVEL, payload);
  }

private:
  static WAVEFORMATEX pcm8kMono() {
    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1;
    format.nSamplesPerSec = 8000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = 16000;
    return format;
  }
  std::wstring selected(EDataFlow flow) {
    std::lock_guard lock(deviceMutex_);
    return flow == eCapture ? captureId_ : renderId_;
  }
  void captureLoop() {
    try {
      pipe_.status("CAPTURE_INITIALIZING");
      ComApartment com;
      auto device = getEndpoint(eCapture, selected(eCapture));
      pipe_.status("CAPTURE_ENDPOINT_OPENED");
      ComPtr<IAudioClient> client; checkHr(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client), "Activate capture IAudioClient");
      WAVEFORMATEX* rawMixFormat = nullptr;
      checkHr(client->GetMixFormat(&rawMixFormat), "Get capture mix format");
      std::unique_ptr<WAVEFORMATEX, WaveFormatDeleter> mixFormat(rawMixFormat);
      bool isFloat = mixFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
      bool isPcm = mixFormat->wFormatTag == WAVE_FORMAT_PCM;
      if (mixFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
        const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(mixFormat.get());
        isFloat = extensible->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
        isPcm = extensible->SubFormat == KSDATAFORMAT_SUBTYPE_PCM;
      }
      if ((!isFloat && !isPcm) || mixFormat->nSamplesPerSec < 8000 ||
          mixFormat->nChannels == 0 || mixFormat->nBlockAlign == 0 ||
          (isFloat && mixFormat->wBitsPerSample != 32) ||
          (isPcm && mixFormat->wBitsPerSample != 8 && mixFormat->wBitsPerSample != 16 &&
           mixFormat->wBitsPerSample != 24 && mixFormat->wBitsPerSample != 32))
        throw std::runtime_error("Unsupported capture mix format");
      // Open the device at its native mix format; some USB drivers stall when
      // WASAPI is asked to resample to the vocoder's 8 kHz format at Initialize.
      const DWORD flags = 0;
      HRESULT hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 10'000'000, 0, mixFormat.get(), nullptr);
      checkHr(hr, "Initialize capture WASAPI at native mix format");
      ComPtr<IAudioCaptureClient> capture;
      checkHr(client->GetService(IID_PPV_ARGS(&capture)), "Get IAudioCaptureClient");
      checkHr(client->Start(), "Start capture stream");
      pipe_.status("CAPTURE_READY_8K_MONO_S16");
      std::array<int16_t, kPcmSamplesPerFrame> frame{};
      size_t used = 0;
      bool lastPtt = false;
      uint64_t resamplePhase = 0;
      int64_t resampleSum = 0;
      uint32_t resampleCount = 0;
      const size_t bytesPerSample = mixFormat->wBitsPerSample / 8;
      while (running_.load()) {
        UINT32 packetFrames = 0;
        checkHr(capture->GetNextPacketSize(&packetFrames), "Capture GetNextPacketSize");
        while (packetFrames != 0) {
          BYTE* data = nullptr; UINT32 frames = 0; DWORD bufferFlags = 0;
          checkHr(capture->GetBuffer(&data, &frames, &bufferFlags, nullptr, nullptr), "Capture GetBuffer");
          for (UINT32 i = 0; i < frames; ++i) {
            int64_t mono = 0;
            if ((bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT) == 0) {
              const BYTE* inputFrame = data + static_cast<size_t>(i) * mixFormat->nBlockAlign;
              for (UINT16 channel = 0; channel < mixFormat->nChannels; ++channel) {
                const BYTE* sample = inputFrame + static_cast<size_t>(channel) * bytesPerSample;
                double value = 0.0;
                if (isFloat) {
                  float decoded = 0.0f; std::memcpy(&decoded, sample, sizeof(decoded));
                  value = std::clamp(static_cast<double>(decoded), -1.0, 1.0) * 32767.0;
                } else if (mixFormat->wBitsPerSample == 8) {
                  value = (static_cast<int32_t>(sample[0]) - 128) * 256.0;
                } else if (mixFormat->wBitsPerSample == 16) {
                  int16_t decoded = 0; std::memcpy(&decoded, sample, sizeof(decoded)); value = decoded;
                } else if (mixFormat->wBitsPerSample == 24) {
                  int32_t decoded = static_cast<int32_t>(sample[0]) |
                      (static_cast<int32_t>(sample[1]) << 8) | (static_cast<int32_t>(sample[2]) << 16);
                  if (decoded & 0x800000) decoded |= static_cast<int32_t>(0xFF000000);
                  value = (static_cast<double>(decoded) / 8388608.0) * 32767.0;
                } else {
                  int32_t decoded = 0; std::memcpy(&decoded, sample, sizeof(decoded));
                  value = (static_cast<double>(decoded) / 2147483648.0) * 32767.0;
                }
                mono += static_cast<int64_t>(std::lrint(value));
              }
              mono /= mixFormat->nChannels;
            }
            resampleSum += mono;
            ++resampleCount;
            resamplePhase += 8000;
            if (resamplePhase < mixFormat->nSamplesPerSec) continue;
            resamplePhase -= mixFormat->nSamplesPerSec;
            const int16_t converted = static_cast<int16_t>(std::clamp<int64_t>(
                resampleCount ? resampleSum / resampleCount : 0, -32768, 32767));
            resampleSum = 0;
            resampleCount = 0;
            const bool active = ptt_.load();
            if (active != lastPtt) { used = 0; lastPtt = active; }
            frame[used++] = converted;
            if (used == frame.size()) {
              if(testCapture_.load()){
                auto local=frame;const double gain=static_cast<double>(txGainPercent_.load())/100.0;
                for(auto& sample:local)sample=static_cast<int16_t>(std::clamp(std::lround(static_cast<double>(sample)*gain),-32768L,32767L));
                reportAudioLevel(1,local);std::lock_guard lock(testMutex_);if(testFrames_.size()<160)testFrames_.push_back(local);
              }
              if (active && ptt_.load() && !remoteAudioInput_.load()) {
                const double gain = static_cast<double>(txGainPercent_.load()) / 100.0;
                for (auto& sample : frame) sample = static_cast<int16_t>(std::clamp(
                    std::lround(static_cast<double>(sample) * gain), -32768L, 32767L));
                reportAudioLevel(1, frame);
                std::array<uint8_t, kDmrAmbeCodewordBytes> codeword{};
                {
                  std::lock_guard lock(codecMutex_);
                  codeword = vocoder_.encodeFec(frame.data());
                }
                pipe_.send(MSG_TX_FEC, codeword);
              }
              used = 0;
            }
          }
          checkHr(capture->ReleaseBuffer(frames), "Capture ReleaseBuffer");
          checkHr(capture->GetNextPacketSize(&packetFrames), "Capture GetNextPacketSize");
        }
        Sleep(5);
      }
      client->Stop();
    } catch (const std::exception& e) {
      pipe_.status(std::string("CAPTURE_ERROR: ") + e.what());
      ptt_.store(false); // A microphone failure must not terminate passive playback.
    }
  }
  void renderLoop() {
    try {
      pipe_.status("RENDER_INITIALIZING");
      ComApartment com;
      auto device = getEndpoint(eRender, selected(eRender));
      pipe_.status("RENDER_ENDPOINT_OPENED");
      ComPtr<IAudioClient> client; checkHr(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client), "Activate render IAudioClient");
      WAVEFORMATEX format = pcm8kMono();
      HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      if (!event) throw std::runtime_error("CreateEvent(render) failed");
      const DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
      HRESULT hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, &format, nullptr);
      if (FAILED(hr)) { CloseHandle(event); checkHr(hr, "Initialize render WASAPI at 8 kHz mono"); }
      checkHr(client->SetEventHandle(event), "SetEventHandle(render)");
      ComPtr<IAudioRenderClient> render; checkHr(client->GetService(IID_PPV_ARGS(&render)), "Get IAudioRenderClient");
      UINT32 bufferFrames = 0; checkHr(client->GetBufferSize(&bufferFrames), "Get render buffer size");
      checkHr(client->Start(), "Start render stream");
      pipe_.status("RENDER_READY_8K_MONO_S16");
      while (running_.load()) {
        const DWORD wait = WaitForSingleObject(event, 250);
        if (wait == WAIT_TIMEOUT) continue;
        if (wait != WAIT_OBJECT_0) throw std::runtime_error("Render event wait failed");
        UINT32 padding = 0; checkHr(client->GetCurrentPadding(&padding), "Get render padding");
        const UINT32 frames = bufferFrames - padding;
        if (!frames) continue;
        BYTE* destination = nullptr; checkHr(render->GetBuffer(frames, &destination), "Render GetBuffer");
        auto* pcm = reinterpret_cast<int16_t*>(destination);
        std::lock_guard lock(playbackMutex_);
        UINT32 lastReceivedSample=0;
        for (UINT32 i = 0; i < frames; ++i) {
          if (playback_.empty()) pcm[i] = 0;
          else {
            const double volume = static_cast<double>(rxVolumePercent_.load()) / 100.0;
            pcm[i] = static_cast<int16_t>(std::clamp(
                std::lround(static_cast<double>(playback_.front()) * volume), -32768L, 32767L));
            playback_.pop_front();
            lastReceivedSample=i+1;
          }
        }
        checkHr(render->ReleaseBuffer(frames, 0), "Render ReleaseBuffer");
        if(rxPlaybackActive_){
          if(lastReceivedSample)rxRenderedUntil_=GetTickCount64()+(padding+lastReceivedSample+7)/8;
          if(!rxDecoding_&&playback_.empty()&&GetTickCount64()>=rxRenderedUntil_){
            rxPlaybackActive_=false;rxTailUntil_=GetTickCount64()+500;pipe_.status("RX_PLAYBACK_IDLE");
          }
        }
      }
      client->Stop(); CloseHandle(event);
    } catch (const std::exception& e) {
      pipe_.status(std::string("RENDER_ERROR: ") + e.what());
      running_.store(false);
    }
  }

  Vocoder& vocoder_;
  PipeWriter& pipe_;
  std::atomic<bool> running_{false};
  std::atomic<bool> ptt_{false};
  std::atomic<bool> remoteAudioInput_{false};
  std::mutex codecMutex_;
  std::atomic<uint32_t> talkgroup_{0};
  std::atomic<uint16_t> txGainPercent_{100};
  std::atomic<uint16_t> rxVolumePercent_{100};
  std::atomic<bool> testCapture_{false};
  std::mutex testMutex_;
  std::vector<std::array<int16_t,kPcmSamplesPerFrame>> testFrames_;
  std::mutex deviceMutex_;
  std::wstring captureId_;
  std::wstring renderId_;
  std::mutex playbackMutex_;
  std::deque<int16_t> playback_;
  bool rxPlaybackActive_=false,rxDecoding_=false;
  ULONGLONG rxRenderedUntil_=0,rxTailUntil_=0;
  std::thread captureThread_;
  std::thread renderThread_;
  std::chrono::steady_clock::time_point lastTxAudioLevelAt_{};
  std::chrono::steady_clock::time_point lastRxAudioLevelAt_{};
};

std::wstring argValue(int argc, wchar_t** argv, const wchar_t* name) {
  for (int i = 1; i + 1 < argc; ++i) if (_wcsicmp(argv[i], name) == 0) return argv[i + 1];
  return {};
}

struct AssetPaths {
  std::wstring vocoderDll;
  std::wstring firmware;
  std::wstring core;
};

std::filesystem::path executableDirectory() {
  std::vector<wchar_t> buffer(1024);
  for (;;) {
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0) throw SidecarError("EXECUTABLE_PATH_FAILED", "GetModuleFileNameW failed");
    if (length < buffer.size())
      return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
    if (buffer.size() >= 32768)
      throw SidecarError("EXECUTABLE_PATH_FAILED", "ZapDMRAudio.exe path exceeds the Windows limit");
    buffer.resize(std::min<size_t>(buffer.size() * 2, 32768));
  }
}

bool fileExists(const std::filesystem::path& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::filesystem::path resolveRelativeToExe(const std::filesystem::path& path,
    const std::filesystem::path& exeDir) {
  return (path.is_absolute() ? path : exeDir / path).lexically_normal();
}

AssetPaths resolveAssets(int argc, wchar_t** argv) {
  const auto exeDir = executableDirectory();
  const std::wstring assetsArg = argValue(argc, argv, L"--assets-dir");
  const auto assetsDir = assetsArg.empty()
      ? exeDir / L"assets" / L"vocoder"
      : resolveRelativeToExe(std::filesystem::path(assetsArg), exeDir);

  const std::wstring dllArg = argValue(argc, argv, L"--vocoder");
  auto dll = dllArg.empty() ? assetsDir / L"qso_dmr_vocoder.dll"
                            : resolveRelativeToExe(std::filesystem::path(dllArg), exeDir);
  if (dllArg.empty() && !fileExists(dll)) {
    const auto alternate = assetsDir / L"qdv_dmr_vocoder.dll";
    if (fileExists(alternate)) dll = alternate;
  }

  const std::wstring firmwareArg = argValue(argc, argv, L"--firmware");
  const std::wstring coreArg = argValue(argc, argv, L"--core");
  const auto firmware = firmwareArg.empty() ? assetsDir / L"D002.032.bin"
      : resolveRelativeToExe(std::filesystem::path(firmwareArg), exeDir);
  const auto core = coreArg.empty() ? assetsDir / L"d02032-core.img"
      : resolveRelativeToExe(std::filesystem::path(coreArg), exeDir);
  return {dll.wstring(), firmware.wstring(), core.wstring()};
}

HANDLE createPipe(const std::wstring& name) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    throw std::runtime_error("OpenProcessToken failed while securing audio pipe");
  DWORD tokenBytes = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &tokenBytes);
  std::vector<uint8_t> tokenBuffer(tokenBytes);
  if (!GetTokenInformation(token, TokenUser, tokenBuffer.data(), tokenBytes, &tokenBytes)) {
    CloseHandle(token);
    throw std::runtime_error("GetTokenInformation(TokenUser) failed");
  }
  CloseHandle(token);
  LPWSTR sidText = nullptr;
  auto* tokenUser = reinterpret_cast<TOKEN_USER*>(tokenBuffer.data());
  if (!ConvertSidToStringSidW(tokenUser->User.Sid, &sidText))
    throw std::runtime_error("ConvertSidToStringSidW failed");
  const std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sidText) + L")";
  LocalFree(sidText);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
    throw std::runtime_error("Could not create current-user-only pipe ACL");
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  HANDLE pipe = CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
      1, 64 * 1024, 64 * 1024, 0, &security);
  LocalFree(descriptor);
  if (pipe == INVALID_HANDLE_VALUE) throw std::runtime_error("CreateNamedPipeW failed");
  return pipe;
}

void processClient(HANDLE pipe, Vocoder& vocoder, PipeWriter& writer) {
  AudioEngine audio(vocoder, writer);
  writer.status("ZAPDMR_AUDIO_READY abi=2; CODEC=AMBE_FEC");
  for (;;) {
    std::array<uint8_t, 4> prefix{};
    if (!readExact(pipe, prefix.data(), 4)) break;
    const uint32_t length = static_cast<uint32_t>(prefix[0]) |
        (static_cast<uint32_t>(prefix[1]) << 8) | (static_cast<uint32_t>(prefix[2]) << 16) |
        (static_cast<uint32_t>(prefix[3]) << 24);
    if (length == 0 || length > kMaxPipeFrame) { writer.status("ERROR_INVALID_FRAME_LENGTH"); break; }
    std::vector<uint8_t> body(length);
    if (!readExact(pipe, body.data(), length)) break;
    const uint8_t type = body[0];
    std::span<const uint8_t> payload(body.data() + 1, body.size() - 1);
    try {
      switch (type) {
        case MSG_HELLO:
          if (!payload.empty()) throw std::runtime_error("HELLO expects empty payload");
          writer.status("ZAPDMR_AUDIO_READY abi=2; CODEC=AMBE_FEC");
          break;
        case MSG_START_AUDIO:
          if (!payload.empty()) throw std::runtime_error("START_AUDIO expects empty payload");
          audio.start(); break;
        case MSG_STOP_AUDIO:
          if (!payload.empty()) throw std::runtime_error("STOP_AUDIO expects empty payload");
          audio.stop(); break;
        case MSG_SELECT_CAPTURE:
          audio.selectDevice(eCapture, utf8ToWide(payload)); writer.status("CAPTURE_DEVICE_SELECTED"); break;
        case MSG_SELECT_RENDER:
          audio.selectDevice(eRender, utf8ToWide(payload)); writer.status("RENDER_DEVICE_SELECTED"); break;
        case MSG_SET_PTT: {
          if (payload.size() != 5) throw std::runtime_error("SET_PTT expects 5 bytes");
          const bool active = payload[0] != 0;
          const uint32_t tg = static_cast<uint32_t>(payload[1]) | (static_cast<uint32_t>(payload[2]) << 8) |
              (static_cast<uint32_t>(payload[3]) << 16) | (static_cast<uint32_t>(payload[4]) << 24);
          if (active && !audio.running()) throw std::runtime_error("Start audio before arming PTT");
          audio.setPtt(active, tg); break;
        }
        case MSG_SET_TX_GAIN:
          if (payload.size() != 1 && payload.size() != 2) throw std::runtime_error("SET_TX_GAIN expects u8 or u16le");
          audio.setTxGain(static_cast<uint16_t>(payload[0]) | (payload.size()==2 ? static_cast<uint16_t>(payload[1]) << 8 : 0)); break;
        case MSG_SET_RX_VOLUME:
          if (payload.size() != 1 && payload.size() != 2) throw std::runtime_error("SET_RX_VOLUME expects u8 or u16le");
          audio.setRxVolume(static_cast<uint16_t>(payload[0]) | (payload.size()==2 ? static_cast<uint16_t>(payload[1]) << 8 : 0)); break;
        case MSG_ENCODE_PCM:
          audio.encodeRemotePcm(payload); break;
        case MSG_SET_REMOTE_AUDIO:
          if (payload.size() != 1) throw std::runtime_error("SET_REMOTE_AUDIO expects one byte");
          audio.setRemoteAudioInput(payload[0] != 0); break;
        case MSG_CLEAR_RX:
          if(!payload.empty())throw std::runtime_error("CLEAR_RX expects empty payload");
          audio.clearRx();break;
        case MSG_RX_FEC: {
          if (payload.size() != kDmrAmbeCodewordBytes) throw std::runtime_error("RX_FEC expects one 9-byte DMR AMBE codeword");
          if (!audio.running()) throw std::runtime_error("Start audio before sending RX_FEC");
          audio.beginRxDecode();
          std::array<int16_t,kPcmSamplesPerFrame> pcm{};
          try { pcm=audio.decodeVoiceCodeword(payload.data()); }
          catch (...) { audio.endRxDecode(); throw; }
          audio.reportAudioLevel(2, pcm);
          std::array<uint8_t, kPcmBytesPerFrame> pcmBytes{};
          for (size_t index = 0; index < pcm.size(); ++index) {
            const uint16_t sample = static_cast<uint16_t>(pcm[index]);
            pcmBytes[index * 2] = static_cast<uint8_t>(sample & 0xff);
            pcmBytes[index * 2 + 1] = static_cast<uint8_t>(sample >> 8);
          }
          writer.send(MSG_RX_PCM, pcmBytes);
          audio.enqueuePlayback(pcm);
          audio.endRxDecode();
          break;
        }
        case MSG_AUDIO_TEST: {
          if (payload.size()>1) throw std::runtime_error("AUDIO_TEST expects optional microphone flag");
          if (!audio.running()) throw std::runtime_error("Start audio before running the audio test");
          if(!payload.empty()&&payload[0]==1){audio.microphoneTest();writer.status("AUDIO_TEST_COMPLETE");break;}
          constexpr double pi = 3.14159265358979323846;
          std::array<int16_t, kPcmSamplesPerFrame> tone{};
          for (size_t frameIndex = 0; frameIndex < 20; ++frameIndex) {
            for (size_t sampleIndex = 0; sampleIndex < tone.size(); ++sampleIndex) {
              const size_t sample = frameIndex * tone.size() + sampleIndex;
              tone[sampleIndex] = static_cast<int16_t>(std::sin(2.0 * pi * 440.0 * sample / 8000.0) * 7000.0);
            }
            const auto decoded = audio.loopbackFrame(tone);
            audio.enqueuePlayback(decoded);
          }
          writer.status("AUDIO_TEST_COMPLETE");
          break;
        }
        case MSG_LIST_DEVICES: {
          if (!payload.empty()) throw std::runtime_error("LIST_DEVICES expects empty payload");
          const auto devices = enumerateDevices(); writer.send(MSG_DEVICE_LIST, devices); break;
        }
        case MSG_ENCODE_SILENCE: {
          if (payload.size() != 1) throw std::runtime_error("ENCODE_SILENCE expects a one-byte codeword count");
          const uint8_t count = payload[0];
          if (count == 0 || count > 24) throw std::runtime_error("ENCODE_SILENCE count must be between 1 and 24");
          const std::array<int16_t, kPcmSamplesPerFrame> silence{};
          std::vector<uint8_t> codewords;
          codewords.reserve(static_cast<size_t>(count) * kDmrAmbeCodewordBytes);
          for (uint8_t i = 0; i < count; ++i) {
            const auto codeword = vocoder.encodeFec(silence.data());
            codewords.insert(codewords.end(), codeword.begin(), codeword.end());
          }
          writer.send(MSG_SILENCE_FEC, std::span<const uint8_t>(codewords.data(), codewords.size()));
          break;
        }
        default: throw std::runtime_error("Unknown pipe message type");
      }
    } catch (const std::exception& e) {
      writer.status(std::string("COMMAND_ERROR: ") + e.what());
    }
  }
  audio.stop();
}
} // namespace

int wmain(int argc, wchar_t** argv) {
  HANDLE pipe = INVALID_HANDLE_VALUE;
  try {
    const std::wstring pipeName = argValue(argc, argv, L"--pipe").empty()
        ? L"\\\\.\\pipe\\ZapDMR.Audio.v1" : argValue(argc, argv, L"--pipe");
    // Create/connect the pipe first. This lets startup asset/ABI failures reach
    // the Node client instead of disappearing into stderr before it can connect.
    pipe = createPipe(pipeName);
    std::wcerr << L"Waiting for local client on " << pipeName << L"\n";
    OVERLAPPED connectOperation{};
    connectOperation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!connectOperation.hEvent) throw std::runtime_error("CreateEvent(pipe connect) failed");
    BOOL connected = ConnectNamedPipe(pipe, &connectOperation);
    if (!connected) {
      const DWORD error = GetLastError();
      if (error == ERROR_PIPE_CONNECTED) connected = TRUE;
      else if (error == ERROR_IO_PENDING && WaitForSingleObject(connectOperation.hEvent, INFINITE) == WAIT_OBJECT_0) {
        DWORD transferred = 0;
        connected = GetOverlappedResult(pipe, &connectOperation, &transferred, FALSE);
      }
    }
    CloseHandle(connectOperation.hEvent);
    if (!connected) throw SidecarError("PIPE_CONNECT_FAILED",
        "ConnectNamedPipe failed (Win32=" + std::to_string(GetLastError()) + ")");

    int exitCode = 0;
    {
      PipeWriter writer(pipe);
      try {
        const AssetPaths assets = resolveAssets(argc, argv);
        Vocoder vocoder;
        vocoder.load(assets.vocoderDll, assets.firmware, assets.core);
        vocoder.sanityCheck();
        writer.status("VOCODER_READY;abi=2");
        writer.status("VOCODER_SANITY_OK;encode_fec=ok;decode_fec=ok");
        processClient(pipe, vocoder, writer);
      } catch (const SidecarError& e) {
        writer.error(e.code(), e.what());
        std::cerr << "ZapDMRAudio startup error [" << e.code() << "]: " << e.what() << "\n";
        exitCode = 2;
      } catch (const std::exception& e) {
        writer.error("SIDECAR_STARTUP_FAILED", e.what());
        std::cerr << "ZapDMRAudio startup error: " << e.what() << "\n";
        exitCode = 2;
      }
      writer.stop(); // Drain queued startup/error frame before disconnecting.
    }
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
    return exitCode;
  } catch (const std::exception& e) {
    std::cerr << "ZapDMRAudio fatal: " << e.what() << "\n";
    if (pipe != INVALID_HANDLE_VALUE) CloseHandle(pipe);
    return 1;
  }
}
