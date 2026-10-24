param([Parameter(Mandatory=$true)][ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
$inputValue=[Console]::In.ReadToEnd()
if($Mode -eq 'Protect'){
  $plainBytes=[Text.Encoding]::UTF8.GetBytes($inputValue)
  try{[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plainBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))}finally{[Array]::Clear($plainBytes,0,$plainBytes.Length)}
}else{
  $cipherBytes=[Convert]::FromBase64String($inputValue)
  $plainBytes=[Security.Cryptography.ProtectedData]::Unprotect($cipherBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))}finally{[Array]::Clear($plainBytes,0,$plainBytes.Length)}
}
