/**
 * Ponte da camada do menu flutuante (menu.html) — só o que ela precisa: receber os
 * itens, escolher um e pedir para fechar. Nenhuma outra página recebe este preload.
 */
import { contextBridge, ipcRenderer } from 'electron';

interface ItemDoMenu {
  id: string;
  tipo: 'titulo' | 'nota' | 'acao' | 'caixa';
  rotulo: string;
  marcado: boolean;
  atalho: string;
}

contextBridge.exposeInMainWorld('menuHub', {
  /** Itens e o ponto (coordenadas da janela) onde o menu abre. */
  aoMostrar: (cb: (dados: { itens: ItemDoMenu[]; x: number; y: number }) => void) =>
    ipcRenderer.on('menuFlutuante:mostrar', (_e, dados) => cb(dados)),
  escolher: (id: string) => ipcRenderer.invoke('menuFlutuante:escolher', id),
  fechar: () => ipcRenderer.invoke('menuFlutuante:fechar'),
});
