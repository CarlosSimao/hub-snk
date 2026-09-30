/**
 * Bridge mínima, só para a UI local confiável (index.html, carregado por loadFile).
 * Nenhuma aba remota (Hub/ERP/Experience/Link) recebe este preload.
 *
 * Sem `agenda.fetch`/`experience.*`/`os.*`: essas operações continuam sendo chamadas
 * HTTP normais feitas pelo próprio painel (rodando dentro da aba Hub) contra o
 * backend, como hoje — o shell não duplica esse caminho, só dá a barra de abas e o
 * status.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hub', {
  tabs: {
    mostrar: (id: string) => ipcRenderer.invoke('tabs:mostrar', id),
    recarregar: (id: string) => ipcRenderer.invoke('tabs:recarregar', id),
    aoMostrar: (cb: (id: string) => void) => ipcRenderer.on('tabs:ativa', (_e, id) => cb(id)),
  },
  guias: {
    /** Estado das guias de cima (rotulo e se estao visiveis) — a barra redesenha com isto. */
    aoAtualizar: (cb: (guias: Array<{ id: string; rotulo: string; visivel: boolean }>) => void) =>
      ipcRenderer.on('guias:estado', (_e, guias) => cb(guias)),
    estado: () => ipcRenderer.invoke('guias:estado'),
  },
  links: {
    listar: () => ipcRenderer.invoke('links:lista'),
    fechar: (origin: string) => ipcRenderer.invoke('links:fechar', origin),
    aoAtualizarLista: (
      cb: (lista: Array<{ origin: string; titulo: string; visivel: boolean }>) => void,
    ) => ipcRenderer.on('links:lista', (_e, lista) => cb(lista)),
  },
  menu: {
    /** Abre o menu do aplicativo na posição informada (coordenadas da janela). */
    abrir: (x: number, y: number) => ipcRenderer.invoke('menu:abrir', x, y),
  },
  comunicacao: {
    /** Abre o serviço no painel de meia tela, ou o esconde se já estiver aberto. */
    alternar: (servico: string) => ipcRenderer.invoke('comunicacao:alternar', servico),
    ocultar: () => ipcRenderer.invoke('comunicacao:ocultar'),
    /** Serviço aberto no painel, ou `null` quando ele some — a barra destaca o botão. */
    aoMudarAtivo: (cb: (servico: string | null) => void) =>
      ipcRenderer.on('comunicacao:ativo', (_e, servico) => cb(servico)),
    /** Quais botões aparecem na barra — escolha feita no menu da engrenagem. */
    estado: () => ipcRenderer.invoke('comunicacao:estado'),
    aoMudarServicos: (cb: (servicos: Array<{ servico: string; habilitado: boolean }>) => void) =>
      ipcRenderer.on('comunicacao:servicos', (_e, servicos) => cb(servicos)),
    abrirMenu: (x: number, y: number) => ipcRenderer.invoke('comunicacao:abrirMenu', x, y),
    aoMudarNaoLidas: (cb: (dados: { servico: string; quantidade: number }) => void) =>
      ipcRenderer.on('comunicacao:naoLidas', (_e, dados) => cb(dados)),
    /** Só chega quando você não está vendo o serviço: é a hora de tocar o som. */
    aoMensagemNova: (cb: (servico: string) => void) =>
      ipcRenderer.on('comunicacao:mensagemNova', (_e, servico) => cb(servico)),
  },
  layout: {
    definirAlturaTopo: (altura: number) => ipcRenderer.invoke('layout:definirAlturaTopo', altura),
    definirLarguraLateral: (largura: number) =>
      ipcRenderer.invoke('layout:definirLarguraLateral', largura),
  },
});
