const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const iconBase = path.join(root, 'assets', 'ZapDMR');
const iconIco = `${iconBase}.ico`;
const audioSidecarExe = path.join(root, 'native', 'build', 'audio-sidecar-vs2022', 'bin', 'ZapDMRAudio.exe');
const vocoderAssetsDir = path.join(root, 'assets', 'vocoder');
if (!fs.existsSync(audioSidecarExe)) {
  throw new Error('ZapDMRAudio.exe não foi compilado. Execute scripts/build-audio-sidecar.ps1 antes de empacotar o instalador.');
}
const requiredVocoderAssets = ['D002.032.bin', 'd02032-core.img'];
const hasVocoderDll = ['qso_dmr_vocoder.dll', 'qdv_dmr_vocoder.dll']
  .some((name) => fs.existsSync(path.join(vocoderAssetsDir, name)));
if (!requiredVocoderAssets.every((name) => fs.existsSync(path.join(vocoderAssetsDir, name))) || !hasVocoderDll) {
  throw new Error('Assets incompletos em assets/vocoder. São necessários D002.032.bin, d02032-core.img e qso_dmr_vocoder.dll (ou qdv_dmr_vocoder.dll).');
}

module.exports = {
  packagerConfig: {
    name: 'ZapDMR',
    executableName: 'ZapDMR',
    icon: iconBase,
    asar: true,
    ignore: (file) => {
      const relative = file.replace(/\\/g, '/').replace(/^\//, '');
      if (!relative) return false;
      const root = relative.split('/')[0];
      if (!['package.json','package-lock.json','node_modules','dist','web','data','electron','assets','LICENSE','THIRD_PARTY_NOTICES.md'].includes(root)) return true;
      if (relative.startsWith('assets/vocoder')) return true;
      if (root === 'data' && relative !== 'data' && relative !== 'data/talkgroups-brasil.json') return true;
      return false;
    },
    // Extra resources keep the executable at resources/ZapDMRAudio.exe and
    // the codec assets at resources/vocoder/, both outside app.asar.
    extraResource: [audioSidecarExe, vocoderAssetsDir]
  },
  makers: [{
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'zapdmr',
      authors: 'ZapDMR',
      description: 'Painel DMR e ligação HBP para BrandMeister',
      title: 'ZapDMR',
      setupExe: 'ZapDMR-Setup.exe',
      setupIcon: iconIco,
      noMsi: true
    }
  }]
};
