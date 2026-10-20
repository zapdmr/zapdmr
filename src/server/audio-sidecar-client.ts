import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';

export const AudioSidecarMessage = {
  hello: 0x01,
  startAudio: 0x02,
  stopAudio: 0x03,
  selectCapture: 0x04,
  selectRender: 0x05,
  setPtt: 0x06,
  rxFec: 0x07,
  listDevices: 0x08,
  encodeSilence: 0x09,
  txFec: 0x10,
  silenceFec: 0x11,
  audioLevel: 0x12,
  setTxGain: 0x13,
  setRxVolume: 0x14,
  audioTest: 0x15,
  encodePcm: 0x16,
  rxPcm: 0x17,
  setRemoteAudio: 0x18,
  clearRx: 0x19,
  status: 0x80,
  deviceList: 0x81,
  error: 0x82
} as const;

export interface AudioSidecarError {
  ok: false;
  code: string;
  message: string;
}

export interface AudioSidecarMessageFrame {
  type: number;
  payload: Buffer;
}

export interface AudioSidecarLaunchOptions {
  pipeName?: string;
  connectTimeoutMs?: number;
  retryIntervalMs?: number;
  onMessage?: (message: AudioSidecarMessageFrame) => void;
  onStatus?: (status: string) => void;
  onSidecarError?: (error: AudioSidecarError | { ok: false; code: 'INVALID_ERROR_FRAME'; message: string }) => void;
  onStderr?: (text: string) => void;
}

/** Windows named-pipe client for ZapDMRAudio.exe. */
export class AudioSidecarClient extends EventEmitter {
  private socket?: Socket;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private connected = false;

  private constructor(
    readonly child: ChildProcess,
    private readonly pipeName: string,
    callbacks: AudioSidecarLaunchOptions
  ) {
    super();
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      this.emit('stderr', text);
      callbacks.onStderr?.(text);
    });
    if (callbacks.onMessage) this.on('message', callbacks.onMessage);
    if (callbacks.onStatus) this.on('status', callbacks.onStatus);
    if (callbacks.onSidecarError) this.on('sidecarError', callbacks.onSidecarError);
    child.once('error', (error) => this.emit('processError', error));
    child.once('exit', (code, signal) => this.emit('exit', { code, signal }));
  }

  /** Spawn the sidecar and connect while it creates its named-pipe server. */
  static async launch(
    executablePath: string,
    args: string[] = [],
    options: AudioSidecarLaunchOptions = {}
  ): Promise<AudioSidecarClient> {
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    const client = new AudioSidecarClient(
      child,
      options.pipeName ?? '\\\\.\\pipe\\ZapDMR.Audio.v1',
      options
    );
    try {
      await client.connectWithRetry(options.connectTimeoutMs ?? 15_000, options.retryIntervalMs ?? 150);
      return client;
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  send(type: number, payload: Buffer = Buffer.alloc(0)): void {
    if (!this.socket || !this.connected) throw new Error('ZapDMRAudio named pipe is not connected.');
    const bodyLength = payload.length + 1;
    if (bodyLength > 64 * 1024) throw new Error('Audio sidecar message exceeds 64 KiB.');
    const frame = Buffer.allocUnsafe(4 + bodyLength);
    frame.writeUInt32LE(bodyLength, 0);
    frame[4] = type & 0xff;
    payload.copy(frame, 5);
    this.socket.write(frame);
  }

  sendText(type: number, text: string): void {
    this.send(type, Buffer.from(text, 'utf8'));
  }

  close(killChild = false): void {
    this.connected = false;
    this.socket?.end();
    if (killChild && this.child.exitCode === null) this.child.kill();
  }

  private async connectWithRetry(timeoutMs: number, retryIntervalMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`ZapDMRAudio exited before the pipe connected (code ${this.child.exitCode}).`);
      }
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code && !['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
    const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
    throw new Error(`Timed out connecting to ZapDMRAudio named pipe.${detail}`);
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.pipeName);
      this.socket = socket;
      let settled = false;
      const onInitialError = (error: Error) => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(error);
        } else {
          this.emit('transportError', error);
        }
      };
      socket.once('error', onInitialError);
      socket.once('connect', () => {
        settled = true;
        this.connected = true;
        socket.off('error', onInitialError);
        socket.on('error', (error) => this.emit('transportError', error));
        socket.on('data', (chunk: Buffer) => this.consume(chunk));
        socket.on('close', () => {
          this.connected = false;
          this.emit('pipeClose');
        });
        resolve();
      });
    });
  }

  private consume(chunk: Buffer): void {
    this.receiveBuffer = this.receiveBuffer.length
      ? Buffer.concat([this.receiveBuffer, chunk])
      : chunk;
    while (this.receiveBuffer.length >= 4) {
      const bodyLength = this.receiveBuffer.readUInt32LE(0);
      if (bodyLength < 1 || bodyLength > 64 * 1024) {
        this.socket?.destroy(new Error(`Invalid sidecar frame size: ${bodyLength}.`));
        return;
      }
      if (this.receiveBuffer.length < 4 + bodyLength) return;
      const type = this.receiveBuffer[4];
      const payload = Buffer.from(this.receiveBuffer.subarray(5, 4 + bodyLength));
      this.receiveBuffer = this.receiveBuffer.subarray(4 + bodyLength);
      const message = { type, payload } satisfies AudioSidecarMessageFrame;
      this.emit('message', message);
      if (type === AudioSidecarMessage.status) this.emit('status', payload.toString('utf8'));
      if (type === AudioSidecarMessage.error) this.emit('sidecarError', this.parseError(payload));
    }
  }

  private parseError(payload: Buffer): AudioSidecarError | { ok: false; code: 'INVALID_ERROR_FRAME'; message: string } {
    try {
      const value: unknown = JSON.parse(payload.toString('utf8'));
      if (typeof value === 'object' && value !== null &&
          (value as Partial<AudioSidecarError>).ok === false &&
          typeof (value as Partial<AudioSidecarError>).code === 'string' &&
          typeof (value as Partial<AudioSidecarError>).message === 'string') {
        return value as AudioSidecarError;
      }
    } catch { /* convert malformed JSON into a structured client-side error */ }
    return { ok: false, code: 'INVALID_ERROR_FRAME', message: payload.toString('utf8') };
  }
}
