import { useCallback, useEffect, useRef, useState } from 'react'
import type { PreviewBounds, PreviewState, Project, ProjectChange, ProjectChanges, TaskRecord, WorkReport } from './officeApi'

const stopped: PreviewState = { status: 'stopped' }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PreviewPane({ project, internStatus, task, reports = [] }: { project: Project | null; internStatus: string; task?: TaskRecord; reports?: WorkReport[] }) {
  const [preview, setPreview] = useState<PreviewState>(stopped)
  const [working, setWorking] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [changes, setChanges] = useState<ProjectChanges | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [selected, setSelected] = useState<ProjectChange | null>(null)
  const [reviewWorking, setReviewWorking] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const lastBounds = useRef('')

  const loadChanges = useCallback(async () => {
    const api = window.officeApi
    if (!api || !project) return
    setReviewWorking(true)
    setReviewError('')
    try {
      const result = await api.listProjectChanges()
      setChanges(result)
      setSelected(null)
    } catch (error) {
      setReviewError(message(error))
    } finally {
      setReviewWorking(false)
    }
  }, [project])

  useEffect(() => {
    const api = window.officeApi
    if (!api) return
    let active = true
    void api.getPreviewState().then(state => { if (active) setPreview(state) }).catch(error => { if (active) setPreviewError(message(error)) })
    const unsubscribe = api.subscribePreview(state => { if (active) setPreview(state) })
    return () => { active = false; unsubscribe(); void api.setPreviewBounds(null) }
  }, [])

  useEffect(() => { void loadChanges() }, [loadChanges, internStatus])

  useEffect(() => {
    const api = window.officeApi
    if (!api) return
    if (preview.status !== 'running') {
      lastBounds.current = ''
      void api.setPreviewBounds(null)
      return
    }
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const node = viewport.current
        const clip = node?.closest('.panel-body')
        if (!node || !clip) return
        const area = node.getBoundingClientRect()
        const visible = clip.getBoundingClientRect()
        const x = Math.ceil(Math.max(area.left, visible.left))
        const y = Math.ceil(Math.max(area.top, visible.top))
        const right = Math.floor(Math.min(area.right, visible.right))
        const bottom = Math.floor(Math.min(area.bottom, visible.bottom))
        const bounds: PreviewBounds | null = right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
        const key = JSON.stringify(bounds)
        if (key !== lastBounds.current) {
          lastBounds.current = key
          void api.setPreviewBounds(bounds).catch(error => setPreviewError(message(error)))
        }
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (viewport.current) observer.observe(viewport.current)
    const panelBody = viewport.current?.closest('.panel-body')
    if (panelBody) observer.observe(panelBody)
    window.addEventListener('resize', update)
    panelBody?.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      panelBody?.removeEventListener('scroll', update)
      lastBounds.current = ''
      void api.setPreviewBounds(null)
    }
  }, [preview.status])

  const control = async (action: 'runPreview' | 'stopPreview' | 'refreshPreview') => {
    const api = window.officeApi
    if (!api) return
    setWorking(true)
    setPreviewError('')
    try { setPreview(await api[action]()) }
    catch (error) { setPreviewError(message(error)) }
    finally { setWorking(false) }
  }

  const openChange = async (path: string) => {
    const api = window.officeApi
    if (!api) return
    setReviewError('')
    try { setSelected(await api.readProjectChange(path)) }
    catch (error) { setReviewError(message(error)) }
  }

  return <div className="preview-workspace">
    <p className="intro">Run your site when you are ready to inspect it. The preview stays off until you click Run.</p>
    {task && <div className="notice"><strong>Reviewing task: {task.title}</strong><span>Status: {task.status} · plan version {task.planVersion}</span><span>Acceptance criteria: {task.acceptanceCriteria}</span><span>{reports.filter(report => report.taskId === task.id).length ? `Intern report: ${reports.filter(report => report.taskId === task.id).at(-1)?.outcome}` : 'The intern has not submitted a work report for this task yet.'}</span></div>}
    <div className="preview-toolbar">
      <div><strong>Website preview</strong><span className={`preview-state ${preview.status}`}>{preview.status}</span></div>
      <div className="preview-controls">
        <button className="primary-button" disabled={!project || working || preview.status === 'running' || preview.status === 'starting'} onClick={() => void control('runPreview')}>Run</button>
        <button className="secondary-button" disabled={working || preview.status !== 'running'} onClick={() => void control('refreshPreview')}>Refresh</button>
        <button className="secondary-button" disabled={working || (preview.status !== 'running' && preview.status !== 'starting')} onClick={() => void control('stopPreview')}>Stop</button>
      </div>
    </div>
    {(previewError || preview.error) && <div className="error-notice" role="alert">{previewError || preview.error}</div>}
    <div className="preview-viewport" ref={viewport} aria-label="Website preview viewport">
      {preview.status !== 'running' && <div className="preview-placeholder"><span className="preview-symbol">◫</span><strong>{preview.status === 'starting' ? 'Starting website…' : project ? 'Preview is stopped' : 'Create a project first'}</strong><p>{preview.status === 'error' ? 'Review the error above, then try Run again.' : project ? 'Click Run to start the local website.' : 'Open the boss’s desk to create a website project.'}</p></div>}
    </div>
    <section className="change-review" aria-label="Changed files review">
      <div className="review-heading"><div><h3>Changed files</h3><p>{task ? `Project changes shown for your review of ${task.title}. Compare them with the task report and acceptance criteria above.` : 'Inspect the intern’s edits before you decide what to do next.'}</p></div><button className="secondary-button" disabled={!project || reviewWorking} onClick={() => void loadChanges()}>Refresh files</button></div>
      {reviewError && <div className="error-notice" role="alert">{reviewError}</div>}
      {!project ? <p className="review-empty">Create a project to review its files.</p> : reviewWorking && !changes ? <p className="review-empty">Reading project changes…</p> : !changes?.files.length ? <p className="review-empty">{changes?.truncated ? 'The file scan was incomplete. Refresh files to try again; changed files may be missing.' : 'No changed files yet.'}</p> : <>
        <div className="change-list">{changes.files.map(file => <button className={selected?.path === file.path ? 'change-file selected' : 'change-file'} key={file.path} onClick={() => void openChange(file.path)}><span className={`change-status ${file.status}`}>{file.status}</span><span>{file.path}</span></button>)}</div>
        {changes.truncated && <p className="review-note">Only the first set of changed files is shown.</p>}
      </>}
      {selected && <article className="change-detail"><div className="change-detail-title"><strong>{selected.path}</strong><span>{selected.status}</span></div><div className="change-columns"><section><h4>Before</h4><pre>{selected.before ?? '(file did not exist)'}</pre></section><section><h4>After</h4><pre>{selected.after ?? '(file deleted)'}</pre></section></div></article>}
    </section>
  </div>
}
