import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { createEmptyDoc } from '../cad/serialize'
import type { CadDoc } from '../cad/types'
import {
  isLockActive,
  renewEditLock,
  releaseEditLock,
  saveProject,
  subscribeEditLock,
  subscribeProject,
  subscribeSaveLogs,
  tryAcquireEditLock,
  type EditLock,
  type ProjectSnapshot,
  type SaveLogEntry,
} from '../firebase/projectService'

const LOCK_HEARTBEAT_MS = 30_000

export type CadProjectState = {
  loading: boolean
  canEdit: boolean
  readOnly: boolean
  loadedDoc: CadDoc | null
  loadedDocKey: number
  project: ProjectSnapshot | null
  lock: EditLock | null
  saveLogs: SaveLogEntry[]
  saving: boolean
  saveError: string | null
  lastSavedMessage: string | null
  save: (doc: CadDoc) => Promise<void>
}

export function useCadProject(user: User | null): CadProjectState {
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [project, setProject] = useState<ProjectSnapshot | null>(null)
  const [lock, setLock] = useState<EditLock | null>(null)
  const [saveLogs, setSaveLogs] = useState<SaveLogEntry[]>([])
  const [loadedDoc, setLoadedDoc] = useState<CadDoc | null>(null)
  const [loadedDocKey, setLoadedDocKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null)

  const canEditRef = useRef(canEdit)
  const lastAppliedVersionRef = useRef(-1)
  const userRef = useRef(user)
  canEditRef.current = canEdit
  userRef.current = user

  const applyRemoteProject = useCallback((next: ProjectSnapshot | null, force = false) => {
    if (!next) {
      setProject(null)
      return
    }

    setProject(next)

    const shouldApply = force || !canEditRef.current || next.version !== lastAppliedVersionRef.current
    if (!shouldApply) return

    lastAppliedVersionRef.current = next.version
    setLoadedDoc(structuredClone(next.doc))
    setLoadedDocKey(next.version)
  }, [])

  useEffect(() => {
    if (!user) {
      setLoading(false)
      setInitialized(false)
      setCanEdit(false)
      setProject(null)
      setLock(null)
      setSaveLogs([])
      setLoadedDoc(null)
      lastAppliedVersionRef.current = -1
      return
    }

    let cancelled = false
    setLoading(true)
    setInitialized(false)

    void tryAcquireEditLock(user).then((acquired) => {
      if (cancelled) {
        if (acquired) void releaseEditLock(user)
        return
      }
      setCanEdit(acquired)
      setLoading(false)
    })

    const unsubProject = subscribeProject((next) => {
      if (!next) {
        setProject(null)
        if (lastAppliedVersionRef.current < 0) {
          lastAppliedVersionRef.current = 0
          setLoadedDoc(createEmptyDoc())
          setLoadedDocKey(0)
        }
        setInitialized(true)
        return
      }

      const isInitial = lastAppliedVersionRef.current < 0
      applyRemoteProject(next, isInitial || !canEditRef.current)
      setInitialized(true)
    })

    const unsubLock = subscribeEditLock(setLock)
    const unsubLogs = subscribeSaveLogs(setSaveLogs)

    return () => {
      cancelled = true
      unsubProject()
      unsubLock()
      unsubLogs()
      void releaseEditLock(user)
      setCanEdit(false)
    }
  }, [user, applyRemoteProject])

  useEffect(() => {
    if (!user || !canEdit) return

    const heartbeat = window.setInterval(() => {
      void renewEditLock(user)
    }, LOCK_HEARTBEAT_MS)

    const onUnload = () => {
      void releaseEditLock(user)
    }
    window.addEventListener('beforeunload', onUnload)

    return () => {
      window.clearInterval(heartbeat)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [user, canEdit])

  useEffect(() => {
    if (!user || canEdit || !project) return
    if (project.version === lastAppliedVersionRef.current) return
    applyRemoteProject(project, true)
  }, [user, canEdit, project, applyRemoteProject])

  const save = useCallback(
    async (doc: CadDoc) => {
      const currentUser = userRef.current
      if (!currentUser || !canEditRef.current) return

      setSaving(true)
      setSaveError(null)
      try {
        const version = await saveProject(currentUser, doc)
        lastAppliedVersionRef.current = version
        setLastSavedMessage(`Saved v${version} by ${currentUser.email ?? 'you'}`)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed')
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const activeLock = isLockActive(lock) ? lock : null
  const readOnly = !canEdit

  return {
    loading: loading || !initialized,
    canEdit,
    readOnly,
    loadedDoc,
    loadedDocKey,
    project,
    lock: activeLock,
    saveLogs,
    saving,
    saveError,
    lastSavedMessage,
    save,
  }
}
