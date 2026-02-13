import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // webUtils.getPathForFile replaces File.path (removed in Electron 32)
  // Must be called synchronously on the raw File object from the drop event
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openVideo: () => ipcRenderer.invoke('open-video'),
  saveProject: (project: any) => ipcRenderer.invoke('save-project', project),
  loadProject: () => ipcRenderer.invoke('load-project'),
  getVideoInfo: (filePath: string) => ipcRenderer.invoke('get-video-info', filePath),
  saveTempPng: (dataUrl: string, filename: string) => ipcRenderer.invoke('save-temp-png', dataUrl, filename),
  exportVideo: (project: any, textOverlays: any[]) => ipcRenderer.invoke('export-video', project, textOverlays),
  onExportProgress: (cb: (line: string) => void) => {
    const handler = (_event: any, line: string) => cb(line)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  }
})
