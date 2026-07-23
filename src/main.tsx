import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import App from './App'
import './index.css'

// Адрес бэкенда Convex из .env.local (локально) или из переменных Vercel (прод).
// Срезаем пробелы и завершающие слэши: иначе Convex строит WebSocket-адрес
// с двойным слэшем и соединение падает (код 1006) — «вечная загрузка».
const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '')
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (!convex) {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'Fira Sans, sans-serif',
        color: '#3a3d44',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Бэкенд Convex не настроен</h1>
        <p style={{ color: '#9498a1' }}>
          Задайте переменную <code>VITE_CONVEX_URL</code>, и приложение подключится к базе.
        </p>
      </div>
    </div>,
  )
} else {
  root.render(
    <React.StrictMode>
      <ConvexAuthProvider client={convex}>
        <App />
      </ConvexAuthProvider>
    </React.StrictMode>,
  )
}
