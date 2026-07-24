import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted display typeface (§7 visual language) — no runtime font CDN, the
// app is fully client-side. 600 is the regular weight, 800 the display weight;
// 400/700 cover any not-yet-restyled surfaces.
import '@fontsource/bricolage-grotesque/latin-400.css'
import '@fontsource/bricolage-grotesque/latin-600.css'
import '@fontsource/bricolage-grotesque/latin-700.css'
import '@fontsource/bricolage-grotesque/latin-800.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
