import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// Handle OS file drops. File.path was removed in Electron 32 — use webUtils.getPathForFile
// exposed via preload. Must be called synchronously on the raw File objects.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  const videoExts = /\.(mp4|mov|mkv|avi|webm|m4v)$/i
  const files = Array.from(e.dataTransfer?.files ?? [])
  for (const file of files) {
    // getPathForFile is synchronous and must be called here, not in a callback
    const filePath: string = (window as any).api.getPathForFile(file)
    if (filePath && videoExts.test(filePath)) {
      window.dispatchEvent(new CustomEvent('video-file-dropped', { detail: filePath }))
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
