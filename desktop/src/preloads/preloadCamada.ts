/**
 * Ponte da camada do HUB (camada.html): a lista de downloads e o aviso de canto. Só o
 * que ela precisa — receber o conteúdo, abrir um download pelo id e pedir para fechar.
 * Nenhuma outra página recebe este preload.
 */
import { contextBridge, ipcRenderer } from 'electron';

interface DownloadVisivel {
  id: number;
  nome: string;
  recebidos: number;
  total: number;
  estado: 'baixando' | 'concluido' | 'cancelado' | 'interrompido';
  sumiu: boolean;
}

interface Conteudo {
  modo: 'downloads' | 'aviso';
  downloads: DownloadVisivel[];
  aviso: { titulo: string; texto: string } | null;
  x: number;
  y: number;
}

contextBridge.exposeInMainWorld('camadaHub', {
  aoMostrar: (cb: (dados: Conteudo) => void) =>
    ipcRenderer.on('camada:mostrar', (_e, dados) => cb(dados)),
  abrirDownload: (id: number) => ipcRenderer.invoke('camada:abrirDownload', id),
  mostrarNaPasta: (id: number) => ipcRenderer.invoke('camada:mostrarNaPasta', id),
  limpar: () => ipcRenderer.invoke('camada:limparDownloads'),
  fechar: () => ipcRenderer.invoke('camada:fechar'),
});
