import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // webUtils.getPathForFile replaces File.path (removed in Electron 32)
  // Must be called synchronously on the raw File object from the drop event
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openVideo: () => ipcRenderer.invoke('open-video'),
  saveProject: (project: any, thumbnailDataUrl?: string) => ipcRenderer.invoke('save-project', project, thumbnailDataUrl),
  loadProject: (accountId: string) => ipcRenderer.invoke('load-project', accountId),
  getProjectsList: (accountId: string) => ipcRenderer.invoke('get-projects-list', accountId),
  loadProjectFromPath: (filePath: string) => ipcRenderer.invoke('load-project-from-path', filePath),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  renderThumbnail: (projectPath: string, timeSec?: number) => ipcRenderer.invoke('render-thumbnail', projectPath, timeSec),
  getVideoInfo: (filePath: string) => ipcRenderer.invoke('get-video-info', filePath),
  saveTempPng: (dataUrl: string, filename: string) => ipcRenderer.invoke('save-temp-png', dataUrl, filename),
  exportVideo: (project: any, textOverlays: any[]) => ipcRenderer.invoke('export-video', project, textOverlays),
  onExportProgress: (cb: (line: string) => void) => {
    const handler = (_event: any, line: string) => cb(line)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  },
  onProjectFileChanged: (cb: (project: any) => void) => {
    const handler = (_event: any, project: any) => cb(project)
    ipcRenderer.on('project-file-changed', handler)
    return () => ipcRenderer.removeListener('project-file-changed', handler)
  },
  onBatchFileChanged: (cb: (data: { filename: string; project: any }) => void) => {
    const handler = (_event: any, data: { filename: string; project: any }) => cb(data)
    ipcRenderer.on('batch-file-changed', handler)
    return () => ipcRenderer.removeListener('batch-file-changed', handler)
  },
  onFilterRequestChanged: (cb: (filter: { category: string; accountId: string; requestedAt: string }) => void) => {
    const handler = (_event: any, filter: any) => cb(filter)
    ipcRenderer.on('filter-request-changed', handler)
    return () => ipcRenderer.removeListener('filter-request-changed', handler)
  },
  onLoadProjectRequest: (cb: (data: { project: any; path: string }) => void) => {
    const handler = (_event: any, data: any) => cb(data)
    ipcRenderer.on('load-project-request', handler)
    return () => ipcRenderer.removeListener('load-project-request', handler)
  },
  // Clip Library
  importClip: (sourcePath: string, accountId?: string) => ipcRenderer.invoke('import-clip', sourcePath, accountId),
  getClipLibrary: () => ipcRenderer.invoke('get-clip-library'),
  deleteClipFromLibrary: (clipId: string) => ipcRenderer.invoke('delete-clip-from-library', clipId),
  updateClipMetadata: (clipId: string, updates: any) => ipcRenderer.invoke('update-clip-metadata', clipId, updates),
  // Audio Library
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  importAudio: (sourcePath: string, isVideo: boolean) => ipcRenderer.invoke('import-audio', sourcePath, isVideo),
  getAudioLibrary: () => ipcRenderer.invoke('get-audio-library'),
  updateAudioMetadata: (audioId: string, updates: any) => ipcRenderer.invoke('update-audio-metadata', audioId, updates),
  deleteAudioFromLibrary: (audioId: string) => ipcRenderer.invoke('delete-audio-from-library', audioId),
  // Accounts
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  createAccount: (name: string) => ipcRenderer.invoke('create-account', name),
  updateAccount: (accountId: string, updates: any) => ipcRenderer.invoke('update-account', accountId, updates),
  setCurrentAccount: (accountId: string | null) => ipcRenderer.invoke('set-current-account', accountId)
})
