import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// O atalho do Desktop reconhece a aba do painel pelo título (scripts/abrir-hub.ps1).
// Rodando o Vite, o título muda para não confundir as duas: a aba do dev, na 4001, e a
// do hub de verdade, na 4000, ficariam idênticas — e o atalho traria a errada para a
// frente. Em produção este bloco não sobrevive ao build.
if (import.meta.env.DEV) {
  document.title = 'sankhya-hub (dev)';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
