/**
 * Bridge mínima, só para a UI local confiável (index.html, carregado por loadFile).
 * Nenhuma aba remota (Hub/ERP/Experience/Link) recebe este preload.
 *
 * Sem `agenda.fetch`/`experience.*`/`os.*`: essas operações continuam sendo chamadas
 * HTTP normais feitas pela própria tela React (rodando dentro da aba Hub) contra o
 * backend, como hoje — o shell não duplica esse caminho, só dá a barra de abas e o
 * status.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hub', {
  tabs: {
    mostrar: (id: string) => ipcRenderer.invoke('tabs:mostrar', id),
    recarregar: (id: string) => ipcRenderer.invoke('tabs:recarregar', id),
  },
  links: {
    listar: () => ipcRenderer.invoke('links:lista'),
    fechar: (origin: string) => ipcRenderer.invoke('links:fechar', origin),
    aoAtualizarLista: (cb: (lista: Array<{ origin: string; titulo: string }>) => void) =>
      ipcRenderer.on('links:lista', (_e, lista) => cb(lista)),
  },
  layout: {
    definirAlturaTopo: (altura: number) => ipcRenderer.invoke('layout:definirAlturaTopo', altura),
  },
  diag: {
    status: () => ipcRenderer.invoke('diag:status'),
  },
});
