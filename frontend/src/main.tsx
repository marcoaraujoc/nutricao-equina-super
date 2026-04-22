import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { GoogleOAuthProvider } from '@react-oauth/google'

const GOOGLE_CLIENT_ID = '1032724797526-vji8mbs4fsjggm0odh8kttudroekeae5.apps.googleusercontent.com'   // ← troque aqui

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)

// Chave Secreta - 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