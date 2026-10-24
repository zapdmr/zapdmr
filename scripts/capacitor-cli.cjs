// Some restricted Windows build sessions cannot query the account through libuv.
const os = require('node:os');
const originalUserInfo = os.userInfo;
os.userInfo = (options) => {
  try { return originalUserInfo(options); }
  catch (error) {
    if (error?.info?.syscall !== 'uv_os_get_passwd') throw error;
    return { uid: -1, gid: -1, username: process.env.USERNAME || 'builder',
      homedir: process.env.USERPROFILE || process.cwd(), shell: process.env.COMSPEC || 'cmd.exe' };
  }
};
require('../node_modules/@capacitor/cli/bin/capacitor');
