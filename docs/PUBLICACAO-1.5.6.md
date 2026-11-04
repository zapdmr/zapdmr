# Publicação ZapDMR 1.5.6

Publicada em 04/11/2026 após autorização e testes físicos aprovados pelo responsável no Android e Windows.

## Endereços oficiais

- Site: https://www.zapdmr.com.br/
- Release: https://github.com/zapdmr/zapdmr/releases/tag/v1.5.6
- Manifesto estável: https://www.zapdmr.com.br/updates/stable.json
- Android: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/ZapDMR-Android-1.5.6.apk
- Windows: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/ZapDMR-Windows-1.5.6.exe
- Pacote do atualizador Windows: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/zapdmr-1.5.6-full.nupkg
- Manifesto Squirrel: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/RELEASES
- Fontes Android: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/ZapDMR-Android-1.5.6-source.zip
- Fontes Windows: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/ZapDMR-Windows-1.5.6-source.zip
- Checksums: https://github.com/zapdmr/zapdmr/releases/download/v1.5.6/SHA256SUMS-1.5.6.txt

## Integridade confirmada

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `ZapDMR-Android-1.5.6.apk` | 13.779.788 | `7974f7b7049878cd790483c18ca963fb86dd4ffb5fd47abcaf039453d470b8d3` |
| `ZapDMR-Windows-1.5.6.exe` | 165.372.416 | `99a07a14583391e9ec6afd0e5612bf814e2008c03695eb48c8c94b971fdbf500` |
| `zapdmr-1.5.6-full.nupkg` | 164.338.523 | `680004fc5f2f59cb8d26524e1cb5662311a40dfc5e98438b8861f96f195a094b` |
| `RELEASES` | 75 | `03e459550076eca75da4c91e31a28738816c0840fc3be26602371a4a3011618d` |
| `ZapDMR-Android-1.5.6-source.zip` | 49.325.711 | `32094b8fdef8388c490e57db3af43a1725cd952e3112c353828798d2661087c0` |
| `ZapDMR-Windows-1.5.6-source.zip` | 49.325.711 | `32094b8fdef8388c490e57db3af43a1725cd952e3112c353828798d2661087c0` |

O GitHub informou estado `uploaded` e os mesmos digests. Todos os sete links responderam HTTP 200 após os redirecionamentos oficiais.

## Verificações de atualização

- Android publicado como `br.radio.zapdmr`, versionName 1.5.6, versionCode 28, assinatura v2/v3 e certificado igual ao da 1.5.5.
- O manifesto mantém a atualização opcional (`minSupportedCode: 0`) e não desativa versões anteriores.
- Android oferece somente versionCode superior, valida tamanho, SHA-256, packageId e certificado e adia a atualização durante TX/RX.
- Windows oferece somente versão semântica superior, valida SHA-256 e SHA-1/RELEASES e recusa reiniciar durante transmissão PTT.
- Perfis, configurações, credenciais, mensagens e userData não são apagados pelo fluxo de atualização.
- DMR, XLX026, Modo Carro, ZapChat e a interface existente não foram alterados nesta publicação.

## Resultado pós-publicação

- Página oficial respondeu HTTP 200 e anuncia Android/Windows 1.5.6.
- Manifesto público respondeu 1.5.6 / versionCode 28 para Android e 1.5.6 para Windows.
- APK, EXE, nupkg, RELEASES, fontes e checksums responderam HTTP 200.
- Release 1.5.4 continua pública com seus sete arquivos preservados.
- Implantação Cloudflare: `4f4c66c1-33bf-4511-903e-ca14bb60241f`.
- Branch de release: `release/1.5.6`; tag imutável usada na publicação: `v1.5.6`.

Nenhuma atualização foi tornada obrigatória e nenhuma alteração de layout foi incluída.
