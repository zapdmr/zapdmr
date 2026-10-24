import dgram from 'node:dgram';
import type { Socket } from 'node:dgram';

export interface UdpTelemetry { type: 'telemetry'; message?: string; signal?: number; receivedAt: string }

/** Local status-only UDP input for a future native sidecar; it does not carry audio. */
export function startUdpTelemetry(port: number, onMessage: (data: UdpTelemetry) => void) {
  return new Promise<{ socket: Socket; port: number }>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const onError = (error: Error) => { socket.close(); reject(error); };
    socket.once('error', onError);
    socket.on('message', (buffer, remote) => {
      if (remote.address !== '127.0.0.1' || buffer.length > 4096) return;
      try {
        const value = JSON.parse(buffer.toString()) as Record<string, unknown>;
        if (value.type !== 'telemetry') return;
        onMessage({ type: 'telemetry',
          message: typeof value.message === 'string' ? value.message.slice(0, 180) : undefined,
          signal: typeof value.signal === 'number' ? value.signal : undefined,
          receivedAt: new Date().toISOString() });
      } catch { /* Ignore malformed local status datagrams. */ }
    });
    socket.bind(port, '127.0.0.1', () => {
      socket.removeListener('error', onError);
      const address = socket.address();
      resolve({ socket, port: typeof address === 'string' ? port : address.port });
    });
  });
}
