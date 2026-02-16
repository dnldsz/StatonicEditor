import { useState, useEffect } from 'react'

interface ProjectInfo {
  name: string
  filePath: string
  thumbnailPath: string | null
  modifiedAt: string
}

interface ProjectPickerProps {
  accountId: string
  onSelect: (filePath: string) => void
  onClose: () => void
}

export function ProjectPicker({ accountId, onSelect, onClose }: ProjectPickerProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProjects()
  }, [accountId])

  const loadProjects = async () => {
    setLoading(true)
    const result = await window.api.getProjectsList(accountId)
    setProjects(result)
    setLoading(false)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return `${days} days ago`
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content project-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Open Project</h2>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="project-picker-body">
          {loading ? (
            <div className="project-picker-loading">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="project-picker-empty">
              <p>No projects yet</p>
              <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                Create a new project to get started
              </p>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => (
                <div
                  key={project.filePath}
                  className="project-card"
                  onClick={() => onSelect(project.filePath)}
                >
                  <div className="project-thumbnail">
                    {project.thumbnailPath ? (
                      <img src={`file://${project.thumbnailPath}`} alt={project.name} />
                    ) : (
                      <div className="project-thumbnail-placeholder">
                        <span>📄</span>
                      </div>
                    )}
                  </div>
                  <div className="project-info">
                    <div className="project-name">{project.name}</div>
                    <div className="project-date">{formatDate(project.modifiedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
