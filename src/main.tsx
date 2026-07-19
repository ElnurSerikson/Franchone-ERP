import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App'
import './index.css'

// Адрес бэкенда Convex из .env.local (создаётся командой `npx convex dev`).
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (!convex) {
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'Inter, sans-serif',
        color: '#3a3d44',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Бэкенд Convex не настроен</h1>
        <p style={{ color: '#9498a1' }}>
          Запустите <code>npx convex dev</code> в папке проекта — появится VITE_CONVEX_URL,
          и приложение подключится к базе.
        </p>
      </div>
    </div>,
  )
} else {
  root.render(
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexProvider>
    </React.StrictMode>,
  )
}
