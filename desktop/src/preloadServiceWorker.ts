/**
 * Preload dos service workers do painel de comunicação (WhatsApp, Gmail, Google Chat).
 *
 * O WhatsApp Web mostra a notificação de mensagem pelo service worker, e o clique nela só
 * chega a ele (`notificationclick`): o `client.focus()` que ele faz em seguida não mostra o
 * painel escondido nem avisa o processo principal. Este preload escuta o mesmo evento e
 * avisa o shell, que abre o painel do serviço (`comunicacao.ts`).
 *
 * O preload roda num contexto à parte, com um `self` próprio que não recebe os eventos do
 * service worker. Por isso o ouvinte é registrado no contexto do próprio service worker,
 * com uma função que só envia um aviso fixo, sem dados — nada fica exposto a ele.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Precisa ser o mesmo canal que `comunicacao.ts` escuta. */
const CANAL_DA_NOTIFICACAO_CLICADA = 'comunicacao:notificacaoClicada';

declare const self: {
  addEventListener(tipo: 'notificationclick', ouvinte: () => void): void;
};

contextBridge.executeInMainWorld({
  // Roda no contexto do service worker: só enxerga o que vier em `args`.
  func: (avisarClique: () => void) => {
    self.addEventListener('notificationclick', () => avisarClique());
  },
  args: [() => ipcRenderer.send(CANAL_DA_NOTIFICACAO_CLICADA)],
});
