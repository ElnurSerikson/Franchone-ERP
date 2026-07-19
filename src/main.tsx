import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App'
import './index.css'

// Адрес бэкенда появится в .env.local после `npx convex dev`.
// Пока его нет — приложение работает на демо-данных из src/data/mock.ts.
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  convex ? <ConvexProvider client={convex}>{tree}</ConvexProvider> : tree,
)
