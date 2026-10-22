(() => {
  const capacitor = window.Capacitor;
  let plugin;
  let exiting=false;
  try { plugin = capacitor?.Plugins?.MobileAudio ?? capacitor?.registerPlugin?.('MobileAudio'); }
  catch { plugin = undefined; }

  const isAndroid = () => {
    try { return capacitor?.getPlatform?.() === 'android' && Boolean(plugin); }
    catch { return false; }
  };

  window.ZapDMRMobileAudio = {
    isAndroid,
    async setAudioLevels(txGainPercent, rxVolumePercent) { return plugin.setAudioLevels({ txGainPercent, rxVolumePercent }); },
    async audioTest(microphone = false) { return plugin.audioTest({ microphone }); },
    async dmrDatabase(action = 'stats', ids = []) { return plugin.dmrDatabase({ action, ids }); },
    async configureOperation(operation,console,radioSettings) { if (isAndroid()) return plugin.configureOperation({ operation,...(console?{console}:{}),...(radioSettings?{radioSettings}:{}) }); },
    async bluetoothSpp(options={action:'status'}) { if(isAndroid())return plugin.bluetoothSpp(options); },
    async radioControl(options) { if(isAndroid())return plugin.radioControl(options); },
    async participantAction(callsign,action) { if(isAndroid())return plugin.participantAction({callsign,action}); },
    async openWhatsApp(phone,text='') { if(isAndroid())return plugin.openWhatsApp({phone,text}); },
    async requestOperationPermission(alias) { if (isAndroid()) return plugin.requestOperationPermission({ alias }); },
    async saveCommunityProfile(community) { return plugin.saveCommunityProfile({community}); },
    async batterySettings() { if (isAndroid()) return plugin.batterySettings(); },
    async initialize(onEvent) {
      if (!isAndroid()) return false;
      await plugin.addListener('radioEvent', (packet) => onEvent?.(packet));
      return plugin.initialize();
    },
    async saveRadioConfig(config) {
      if (!isAndroid()) return;
      return plugin.saveRadioConfig(config);
    },
    async loadRadioConfig() {
      return isAndroid() ? plugin.loadRadioConfig() : {};
    },
    async connectRadio(settings, password, startupReceiveOnly=false) {
      if(exiting)throw new Error("ZapDMR está saindo.");
      if (!isAndroid()) throw new Error('A ligação HBP nativa está disponível apenas no APK Android.');
      return plugin.connectRadio({ settings, password, autoReconnect: Boolean(settings?.autoReconnect),startupReceiveOnly });
    },
    async takeQuickExitResume() { return isAndroid()&&!exiting ? plugin.takeQuickExitResume() : {resume:false}; },
    async prepareAppUpdate() {if(!isAndroid())return;exiting=true;try{return await plugin.quickExit({forUpdate:true});}catch(error){exiting=false;throw error;}},
    async resumeAfterAppUpdate() {await plugin.resumeAfterAppUpdate();exiting=false;},
    async quickExit() {if(!isAndroid())return;exiting=true;try{return await plugin.quickExit();}catch(error){exiting=false;throw error;}},
    async disconnectRadio() {
      if (isAndroid()) return plugin.disconnectRadio();
    },
    async unlinkTalkgroup() { if(isAndroid())return plugin.unlinkTalkgroup(); },
    async tuneTalkgroup(talkgroupId, slot) {
      if (isAndroid()) return plugin.tuneTalkgroup({ talkgroupId, slot });
    },
    async startPtt(talkgroupId, slot) {
      if (isAndroid()) return plugin.startPtt({ talkgroupId, slot });
    },
    async stopPtt() {
      if (isAndroid()) return plugin.stopPtt();
    },
    async firmwareStatus() {
      return isAndroid() ? plugin.firmwareStatus() : { ready: false };
    },
    async watchTalkgroups(ids) {
      if (isAndroid()) return plugin.watchTalkgroups({ ids });
    },
    async activateFirmware(target = 'all') {
      if (!isAndroid()) throw new Error('A ativação local está disponível no Android.');
      return plugin.activateFirmware({ target });
    },
    async downloadFirmware(target, url) {
      if (!isAndroid()) throw new Error('O download de firmware está disponível no Android.');
      return plugin.downloadFirmware({ target, url });
    },
    async importFirmware(target) {
      if (!isAndroid()) throw new Error('A importação de firmware está disponível apenas no Android.');
      return plugin.importFirmware({ target });
    }
  };
})();
