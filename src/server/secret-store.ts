import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Store with Windows DPAPI user scope, falling back to machine scope if the user profile is unavailable. */
export async function saveWindowsSecret(filePath: string, secret: string): Promise<void> {
  const encrypted = await runPowerShell(
    `${DPAPI_SOURCE}\n$plain=[Console]::In.ReadToEnd(); $bytes=[System.Text.Encoding]::UTF8.GetBytes($plain); $scope='user'; try { $protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser) } catch { $scope='machine'; $protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine) }; [Console]::Out.Write(('dpapi-'+$scope+':'+[Convert]::ToBase64String($protected)))`,
    secret
  );
  const value = encrypted.trim();
  if (!value) throw new Error('O Windows não devolveu um valor protegido para a senha.');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export async function loadWindowsSecret(filePath: string): Promise<string | undefined> {
  let encrypted: string;
  try {
    encrypted = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!encrypted.trim()) return undefined;
  return runPowerShell(
    `${DPAPI_SOURCE}\n$stored=[Console]::In.ReadToEnd().Trim(); if ($stored -notmatch '^dpapi-(user|machine):([A-Za-z0-9+/=]+)$') { throw 'Formato de senha protegida inválido.' }; $scope=if ($Matches[1] -eq 'user') { [System.Security.Cryptography.DataProtectionScope]::CurrentUser } else { [System.Security.Cryptography.DataProtectionScope]::LocalMachine }; $bytes=[Convert]::FromBase64String($Matches[2]); $plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))`,
    encrypted
  );
}

const DPAPI_SOURCE = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;";

function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== 'win32')
    return Promise.reject(new Error('A proteção local da senha requer Windows DPAPI.'));

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.stdin.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else reject(new Error(`Falha ao proteger/ler a senha com DPAPI (código ${code}): ${stderr.trim() || 'PowerShell encerrou com erro.'}`));
    });
    child.stdin.end(input, 'utf8');
  });
}
