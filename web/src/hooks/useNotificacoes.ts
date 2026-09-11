import { useCallback, useState } from 'react';
import type { Alert } from '../types.ts';
import { SEVERITY_TITLE } from '../lib/format.ts';

const SUPORTADO = 'Notification' in window;

/** O que `notificar` precisa — um `Alert` inteiro serve, e a prévia do botão também. */
export type AvisoDesktop = Pick<
  Alert,
  'severity' | 'serviceName' | 'checkName' | 'detail' | 'serviceId' | 'checkId'
>;

export function useNotificacoes() {
  const [permissao, setPermissao] = useState<NotificationPermission>(() =>
    SUPORTADO ? Notification.permission : 'denied',
  );

  /**
   * Levanta o toast nativo do sistema. O Chrome entrega isso à central de notificações
   * do Windows, então aparece mesmo com a aba em segundo plano — só precisa do
   * navegador aberto.
   */
  const notificar = useCallback((alert: AvisoDesktop) => {
    if (!SUPORTADO || Notification.permission !== 'granted') return;

    const notification = new Notification(`${SEVERITY_TITLE[alert.severity]} — ${alert.serviceName}`, {
      body: `${alert.checkName}: ${alert.detail}`,
      // `tag` por check faz uma nova notificação SUBSTITUIR a anterior do mesmo check,
      // em vez de empilhar. Um serviço instável não vira 40 toasts.
      tag: `${alert.serviceId}:${alert.checkId}`,
      // `renotify` saiu da tipagem do DOM mas os navegadores ainda respeitam: sem ele
      // a notificação substituída entra calada.
      renotify: true,
      // Falha fica na tela até você reagir; recuperação some sozinha.
      requireInteraction: alert.severity === 'critical',
      silent: alert.severity === 'recovery',
    } as NotificationOptions);

    // Clicar na notificação traz o painel para a frente; o card do serviço que caiu
    // já foi selecionado por `abrirEmIncidente`, então a informação está na tela.
    notification.addEventListener('click', () => {
      window.focus();
      notification.close();
    });
  }, []);

  const pedirPermissao = useCallback(async () => {
    if (!SUPORTADO) return;
    // A permissão só pode ser pedida a partir de um gesto do usuário.
    setPermissao(await Notification.requestPermission());
  }, []);

  return { suportado: SUPORTADO, permissao, notificar, pedirPermissao };
}
