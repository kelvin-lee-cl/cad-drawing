import './App.css'
import { AuthProvider } from './auth/AuthProvider'
import { CadWorkspace } from './CadWorkspace'

function App() {
  return (
    <div className="appRoot">
      <AuthProvider>
        <CadWorkspace />
      </AuthProvider>
    </div>
  )
}

export default App
