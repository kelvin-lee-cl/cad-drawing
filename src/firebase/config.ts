import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyANWHMOHzSYsTkkN0ZRzc_KpK-JF0NZmOg',
  authDomain: 'cad-dra.firebaseapp.com',
  projectId: 'cad-dra',
  storageBucket: 'cad-dra.firebasestorage.app',
  messagingSenderId: '987338566811',
  appId: '1:987338566811:web:d368f07b555250003b6a3e',
  measurementId: 'G-32GHH2T458',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
