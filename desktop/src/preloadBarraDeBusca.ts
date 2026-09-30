/**
 * Ponte da barra do Ctrl+F (barraDeBusca.html) — só o que ela precisa: saber que abriu,
 * buscar, receber o contador e pedir para fechar. Nenhuma outra página recebe este preload.
 */
import { contextBridge, ipcRenderer } from 'electron';

interface ResultadoDaBusca {
  atual: number;
  total: number;
}

contextBridge.exposeInMainWorld('barraDeBusca', {
  aoAbrir: (cb: () => void) => ipcRenderer.on('barraDeBusca:abrir', () => cb()),
  aoResultado: (cb: (resultado: ResultadoDaBusca) => void) =>
    ipcRenderer.on('barraDeBusca:resultado', (_e, resultado) => cb(resultado)),
  buscar: (texto: string, paraTras: boolean) =>
    ipcRenderer.invoke('barraDeBusca:buscar', texto, paraTras),
  fechar: () => ipcRenderer.invoke('barraDeBusca:fechar'),
});
