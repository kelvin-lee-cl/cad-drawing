type LoginScreenProps = {
  loading: boolean
  onSignIn: () => void
  error?: string | null
}

export function LoginScreen({ loading, onSignIn, error }: LoginScreenProps) {
  return (
    <div className="loginScreen">
      <div className="loginCard">
        <h1 className="loginTitle">Simple CAD</h1>
        <p className="loginText">
          Sign in with Google to open the shared drawing. Only one person can edit at a time; everyone
          else can view the latest saved version.
        </p>
        {error && <p className="loginError">{error}</p>}
        <button type="button" className="cadBtn loginBtn" disabled={loading} onClick={onSignIn}>
          {loading ? 'Loading…' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  )
}
