import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { App } from './App'
import { useProject } from './store/project'
import { useJuntar } from './store/juntar-projetos'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado')

// Em dev, o store fica alcancavel pelo console do devtools. Serve para inspecionar
// estado e para carregar fixtures sem arrastar arquivo a mao a cada recarga.
if (import.meta.env.DEV) {
  Reflect.set(window, 'dangaiStore', useProject)
  // A tela do Juntar projetos, para o teste pelo CDP (scripts/teste/cdp.mjs).
  Reflect.set(window, 'dangaiJuntar', useJuntar)
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
