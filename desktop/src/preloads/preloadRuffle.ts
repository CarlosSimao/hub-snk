/**
 * Preload das sessões com o Ruffle ligado — ver `ruffle.ts`. Roda no começo de cada
 * frame, antes dos scripts da página, e não expõe nada a ela: só pede o código ao
 * processo principal (vazio quando o frame não é do Sankhya Om) e o executa na página.
 */
import { ipcRenderer, webFrame } from 'electron';

const codigo: unknown = ipcRenderer.sendSync('ruffle:codigo');
if (typeof codigo === 'string' && codigo) {
  webFrame.executeJavaScript(codigo).catch((erro: Error) => {
    console.error('HUB SNK: o Ruffle não carregou nesta página', erro);
  });
}
