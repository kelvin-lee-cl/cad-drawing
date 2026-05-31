import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import type { CadDoc } from '../cad/types'
import { deserializeDoc, serializeDoc } from '../cad/serialize'
import { db } from './config'

const PROJECT_PATH = ['cad', 'project'] as const
const LOCK_PATH = ['cad', 'lock'] as const
const LOGS_PATH = ['cad', 'project', 'saveLogs'] as const

const LOCK_TTL_MS = 90_000

export type ProjectSnapshot = {
  doc: CadDoc
  version: number
  updatedByEmail: string
  updatedByName: string
  updatedAt: Date | null
}

export type SaveLogEntry = {
  id: string
  email: string
  name: string
  at: Date
  version: number
}

export type EditLock = {
  uid: string
  email: string
  name: string
  expiresAt: number
}

function projectRef() {
  return doc(db, ...PROJECT_PATH)
}

function lockRef() {
  return doc(db, ...LOCK_PATH)
}

function logsCollection() {
  return collection(db, ...LOGS_PATH)
}

function timestampToDate(value: Timestamp | null | undefined): Date | null {
  return value ? value.toDate() : null
}

function defaultProjectDoc(): CadDoc {
  return {
    units: 'mm',
    worldUnitsLabel: 'mm',
    layers: [{ id: 'layer_default', name: 'Layer 1', color: '#63b3ff', visible: true }],
    activeLayerId: 'layer_default',
    entities: [],
  }
}

export function subscribeProject(onChange: (project: ProjectSnapshot | null) => void): Unsubscribe {
  return onSnapshot(projectRef(), (snap) => {
    if (!snap.exists()) {
      onChange(null)
      return
    }

    const data = snap.data()
    try {
      onChange({
        doc: deserializeDoc(data.payload ?? data.doc ?? data),
        version: typeof data.version === 'number' ? data.version : 0,
        updatedByEmail: typeof data.updatedByEmail === 'string' ? data.updatedByEmail : '',
        updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : '',
        updatedAt: timestampToDate(data.updatedAt as Timestamp | undefined),
      })
    } catch {
      onChange(null)
    }
  })
}

export function subscribeEditLock(onChange: (lock: EditLock | null) => void): Unsubscribe {
  return onSnapshot(lockRef(), (snap) => {
    if (!snap.exists()) {
      onChange(null)
      return
    }

    const data = snap.data()
    onChange({
      uid: String(data.uid ?? ''),
      email: String(data.email ?? ''),
      name: String(data.name ?? ''),
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0,
    })
  })
}

export function subscribeSaveLogs(
  onChange: (logs: SaveLogEntry[]) => void,
  maxEntries = 20,
): Unsubscribe {
  const q = query(logsCollection(), orderBy('savedAt', 'desc'), limit(maxEntries))
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs.map((entry) => {
        const data = entry.data()
        return {
          id: entry.id,
          email: String(data.savedByEmail ?? ''),
          name: String(data.savedByName ?? ''),
          at: timestampToDate(data.savedAt as Timestamp | undefined) ?? new Date(0),
          version: typeof data.version === 'number' ? data.version : 0,
        }
      }),
    )
  })
}

export async function tryAcquireEditLock(user: User): Promise<boolean> {
  const now = Date.now()
  const email = user.email ?? 'unknown'
  const name = user.displayName ?? email

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(lockRef())
    const nextLock = {
      uid: user.uid,
      email,
      name,
      lockedAt: now,
      expiresAt: now + LOCK_TTL_MS,
    }

    if (!snap.exists()) {
      transaction.set(lockRef(), nextLock)
      return true
    }

    const current = snap.data()
    const currentUid = String(current.uid ?? '')
    const expiresAt = typeof current.expiresAt === 'number' ? current.expiresAt : 0

    if (currentUid === user.uid || expiresAt <= now) {
      transaction.set(lockRef(), nextLock)
      return true
    }

    return false
  })
}

export async function renewEditLock(user: User): Promise<void> {
  const now = Date.now()
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(lockRef())
    if (!snap.exists()) return

    const current = snap.data()
    if (String(current.uid ?? '') !== user.uid) return

    transaction.update(lockRef(), { expiresAt: now + LOCK_TTL_MS })
  })
}

export async function releaseEditLock(user: User): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(lockRef())
    if (!snap.exists()) return

    const current = snap.data()
    if (String(current.uid ?? '') !== user.uid) return

    transaction.delete(lockRef())
  })
}

export async function saveProject(user: User, docData: CadDoc): Promise<number> {
  const email = user.email ?? 'unknown'
  const name = user.displayName ?? email
  const payload = serializeDoc(docData)

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(projectRef())
    const nextVersion = snap.exists() ? Number(snap.data().version ?? 0) + 1 : 1

    transaction.set(projectRef(), {
      payload,
      version: nextVersion,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      updatedByEmail: email,
      updatedByName: name,
    })

    return nextVersion
  }).then(async (version) => {
    await addDoc(logsCollection(), {
      savedAt: serverTimestamp(),
      savedBy: user.uid,
      savedByEmail: email,
      savedByName: name,
      version,
    })
    return version
  })
}

export async function loadProjectOnce(): Promise<ProjectSnapshot | null> {
  const snap = await getDoc(projectRef())
  if (!snap.exists()) return null

  const data = snap.data()
  try {
    return {
      doc: deserializeDoc(data.payload ?? data.doc ?? data),
      version: typeof data.version === 'number' ? data.version : 0,
      updatedByEmail: typeof data.updatedByEmail === 'string' ? data.updatedByEmail : '',
      updatedByName: typeof data.updatedByName === 'string' ? data.updatedByName : '',
      updatedAt: timestampToDate(data.updatedAt as Timestamp | undefined),
    }
  } catch {
    return {
      doc: defaultProjectDoc(),
      version: 0,
      updatedByEmail: '',
      updatedByName: '',
      updatedAt: null,
    }
  }
}

export function isLockActive(lock: EditLock | null, now = Date.now()): boolean {
  return !!lock && lock.expiresAt > now
}
