export type AprsCredentialSource = 'automatic' | 'manual';

export interface AprsCredential {
  callsign: string;
  passcode: string;
  source: AprsCredentialSource;
}

export function aprsBaseCallsign(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().split('-', 1)[0];
}

export function aprsPasscode(value: unknown): number {
  const callsign = aprsBaseCallsign(value);
  if (!/^[A-Z0-9]{3,6}$/.test(callsign)) throw new Error('Indicativo APRS inválido para provisionamento automático.');
  let hash = 0x73e2;
  for (let index = 0; index < callsign.length; index += 2) {
    hash ^= callsign.charCodeAt(index) << 8;
    if (index + 1 < callsign.length) hash ^= callsign.charCodeAt(index + 1);
  }
  return hash & 0x7fff;
}

export function automaticAprsAuthorized(
  settings: { callsign?: unknown; dmrId?: unknown },
  community: Record<string, any> | undefined,
  requestedCallsign: unknown
): boolean {
  const account = community?.account;
  const profileCallsign = aprsBaseCallsign(settings.callsign);
  return Boolean(
    account?.verified === true &&
    account?.whatsapp_verified === true &&
    profileCallsign &&
    profileCallsign === aprsBaseCallsign(requestedCallsign) &&
    profileCallsign === aprsBaseCallsign(account.callsign) &&
    /^\d{7}$/.test(String(settings.dmrId ?? '')) &&
    String(settings.dmrId) === String(account.dmrId ?? '')
  );
}
