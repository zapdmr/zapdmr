param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[^@\s]+@[^@\s]+\.[^@\s]+$')]
  [string]$To,

  [string]$SecretPath = 'C:\Users\User\.codex\secrets\zapdmr-brevo-experimental.dpapi.xml',

  [switch]$Send
)

$ErrorActionPreference = 'Stop'

function Read-DpapiSecret {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'Credencial experimental da Brevo não encontrada.'
  }

  $secure = Import-Clixml -LiteralPath $Path
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$payload = [ordered]@{
  sender = [ordered]@{
    name  = 'ZapDMR Ativação'
    email = 'ativacao@auth.zapdmr.com.br'
  }
  to = @(
    [ordered]@{
      email = $To
      name  = 'Administrador ZapDMR'
    }
  )
  subject = 'ZapDMR — teste experimental de ativação por e-mail'
  textContent = @'
Este é um teste controlado do envio de códigos de ativação do ZapDMR.

Ambiente: experimental
Nenhuma versão oficial foi alterada ou publicada.
'@
  htmlContent = @'
<h2>ZapDMR — teste experimental</h2>
<p>Este é um teste controlado do envio de códigos de ativação do ZapDMR.</p>
<p><strong>Ambiente:</strong> experimental</p>
<p>Nenhuma versão oficial foi alterada ou publicada.</p>
'@
  headers = [ordered]@{
    'X-ZapDMR-Environment' = 'experimental'
  }
  tags = @('zapdmr-activation-experimental')
}

if (-not $Send) {
  [pscustomobject]@{
    DryRun = $true
    To = $To
    Sender = $payload.sender.email
    Subject = $payload.subject
    SecretPresent = Test-Path -LiteralPath $SecretPath -PathType Leaf
  }
  return
}

$apiKey = Read-DpapiSecret -Path $SecretPath
try {
  if ($apiKey -notmatch '^xkeysib-') {
    throw 'A credencial experimental da Brevo não tem o formato esperado.'
  }

  $headers = @{
    'api-key' = $apiKey
    'Accept' = 'application/json'
    'Content-Type' = 'application/json'
  }

  $response = Invoke-RestMethod `
    -Uri 'https://api.brevo.com/v3/smtp/email' `
    -Method Post `
    -Headers $headers `
    -Body ($payload | ConvertTo-Json -Depth 8 -Compress)

  [pscustomobject]@{
    Sent = $true
    MessageId = [string]$response.messageId
    To = $To
    Sender = $payload.sender.email
  }
}
finally {
  $apiKey = $null
  Remove-Variable apiKey -ErrorAction SilentlyContinue
}
