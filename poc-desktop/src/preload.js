'use strict';

/**
 * Bridge mínima, só para a UI local confiável (index.html carregado por loadFile).
 * Nenhuma aba remota (Hub/ERP/Experience) recebe este preload — ver main.js.
 * Cada método mapeia 1:1 para um canal IPC fixo; nenhum eval genérico é exposto.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  tabs: {
    mostrar: (id) => ipcRenderer.invoke('tabs:mostrar', id),
    recarregar: (id) => ipcRenderer.invoke('tabs:recarregar', id),
  },
  agenda: {
    fetch: (de, ate) => ipcRenderer.invoke('agenda:fetch', { de, ate }),
  },
  experience: {
    capturarToken: () => ipcRenderer.invoke('experience:capturarToken'),
    tarefas: (projetoId, personId) => ipcRenderer.invoke('experience:tarefas', { projetoId, personId }),
  },
  diag: {
    cookiesErp: () => ipcRenderer.invoke('diag:cookiesErp'),
    statusExperienceToken: () => ipcRenderer.invoke('diag:statusExperienceToken'),
    limparSessaoExperience: () => ipcRenderer.invoke('diag:limparSessaoExperience'),
    isolamentoBridge: () => ipcRenderer.invoke('diag:isolamentoBridge'),
    definirBackendIndisponivel: (valor) => ipcRenderer.invoke('diag:definirBackendIndisponivel', valor),
  },
  report: {
    registrar: (testeId, status, detalhe) => ipcRenderer.invoke('report:registrar', { testeId, status, detalhe }),
    log: (evento, dados) => ipcRenderer.invoke('report:log', { evento, dados }),
  },
  links: {
    abrirExterno: (url) => ipcRenderer.invoke('links:abrirExterno', url),
    fecharAbaCliente: () => ipcRenderer.invoke('links:fecharAbaCliente'),
    aoAbrirAbaCliente: (cb) => ipcRenderer.on('links:aba-aberta', (_e, url) => cb(url)),
    aoFecharAbaCliente: (cb) => ipcRenderer.on('links:aba-fechada', () => cb()),
  },
  layout: {
    definirAlturaTopo: (altura) => ipcRenderer.invoke('layout:definirAlturaTopo', altura),
  },
  os: {
    preparar: (clienteId, tarefaIds) => ipcRenderer.invoke('os:preparar', { clienteId, tarefaIds }),
    criar: (payload) => ipcRenderer.invoke('os:criar', payload),
    gerarAceite: (orderId, clienteId, enviarEmail) =>
      ipcRenderer.invoke('os:gerarAceite', { orderId, clienteId, enviarEmail }),
  },
});
