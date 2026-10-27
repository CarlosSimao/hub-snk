/**
 * Ponte do seletor de tela (seletorDeTela.html) — só o que ele precisa: receber as fontes,
 * escolher uma ou cancelar. Nenhuma outra página recebe este preload.
 */
import { contextBridge, ipcRenderer } from 'electron';

interface FonteParaATela {
  id: string;
  nome: string;
  tipo: 'tela' | 'janela';
  miniatura: string;
  icone: string;
}

contextBridge.exposeInMainWorld('seletorDeTela', {
  aoMostrar: (cb: (dados: { fontes: FonteParaATela[]; oferecerAudio: boolean }) => void) =>
    ipcRenderer.on('seletorDeTela:mostrar', (_e, dados) => cb(dados)),
  escolher: (id: string, comAudio: boolean) =>
    ipcRenderer.send('seletorDeTela:escolher', id, comAudio),
  cancelar: () => ipcRenderer.send('seletorDeTela:cancelar'),
});
