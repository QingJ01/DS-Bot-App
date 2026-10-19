// Gives the DSH Web entry the boot handshake it uses inside an app window.
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke('ds-bot:boot'),
    failed: (message) => ipcRenderer.invoke('ds-bot:boot-failed', String(message)),
  })
}
