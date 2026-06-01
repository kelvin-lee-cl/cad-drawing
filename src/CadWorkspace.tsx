import { useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { CadApp } from './cad/CadApp'
import { LoginScreen } from './components/LoginScreen'
import { useCadProject } from './hooks/useCadProject'

export function CadWorkspace() {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth()
  const project = useCadProject(user)
  const [authError, setAuthError] = useState<string | null>(null)

  if (authLoading) {
    return <LoginScreen loading onSignIn={() => {}} />
  }

  if (!user) {
    return (
      <LoginScreen
        loading={false}
        error={authError}
        onSignIn={() => {
          setAuthError(null)
          void signInWithGoogle().catch((err: unknown) => {
            setAuthError(err instanceof Error ? err.message : 'Sign-in failed')
          })
        }}
      />
    )
  }

  if (project.loading || !project.loadedDoc) {
    return (
      <div className="loginScreen">
        <div className="loginCard">
          <p className="loginText">Loading the latest saved drawing…</p>
        </div>
      </div>
    )
  }

  return (
    <CadApp
      readOnly={project.readOnly}
      loadedDoc={project.loadedDoc}
      loadedDocKey={project.loadedDocKey}
      userLabel={user.displayName ?? user.email ?? 'Signed in'}
      onSignOut={() => void signOut()}
      canEdit={project.canEdit}
      lockHolder={
        project.readOnly && project.lock
          ? project.lock.name || project.lock.email
          : undefined
      }
      onSave={(doc) => project.save(doc)}
      saving={project.saving}
      saveError={project.saveError}
      lastSavedMessage={project.lastSavedMessage}
      lastSavedBy={project.project?.updatedByName || project.project?.updatedByEmail}
      saveLogs={project.saveLogs}
      onDeleteSaveLog={(logId) => project.deleteSaveLog(logId)}
      onClearSaveLogs={() => project.clearSaveLogs()}
    />
  )
}
