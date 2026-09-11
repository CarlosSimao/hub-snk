import { useState } from 'react';
import type { ActionDescriptor } from '../types.ts';
import { enviar, rotaServico } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';

interface Props {
  serviceId: string;
  actions: ActionDescriptor[];
  toast: Avisar;
}

/**
 * As ações vêm de `service.actions` num único array; `checkId` decide se é ação do
 * projeto (ausente) ou de um serviço específico (aponta um check). Quem chama já
 * filtrou o subconjunto certo — este componente só desenha os botões.
 */
export function ActionButtons({ serviceId, actions, toast }: Props) {
  return (
    <>
      {actions.map((action) => (
        <ActionButton key={action.id} serviceId={serviceId} action={action} toast={toast} />
      ))}
    </>
  );
}

function ActionButton({ serviceId, action, toast }: { serviceId: string; action: ActionDescriptor; toast: Avisar }) {
  const [executando, setExecutando] = useState(false);
  const titulo = action.description ? { title: action.description } : {};

  if (action.kind === 'link') {
    // Popup: janela separada com chrome próprio, não dá pra fazer com <a target>
    // sozinho — precisa de window.open com a string de features.
    if (action.popup) {
      return (
        <button
          className="btn tiny"
          {...titulo}
          onClick={() =>
            window.open(
              action.url,
              `popup-${serviceId}-${action.id}`,
              'width=960,height=640,resizable=yes,scrollbars=yes',
            )
          }
        >
          {action.label} ↗
        </button>
      );
    }
    return (
      <a className="btn tiny" href={action.url} target="_blank" rel="noopener" {...titulo}>
        {action.label} ↗
      </a>
    );
  }

  const executar = async () => {
    if (action.confirm && !window.confirm(`Executar "${action.label}"?`)) return;

    setExecutando(true);
    try {
      const { ok, status, body } = await enviar<{ message: string; detail: string }>(
        rotaServico(serviceId, `actions/${encodeURIComponent(action.id)}`),
      );
      const mensagem = ok
        ? `${action.label}: ${body.message ?? 'ok'}`
        : `${action.label}: ${body.message ?? body.error ?? `HTTP ${status}`}`;
      toast(mensagem, ok ? 'ok' : 'err', body.detail);
    } catch (err) {
      toast(`${action.label}: ${(err as Error).message}`, 'err');
    } finally {
      setExecutando(false);
    }
  };

  return (
    <button
      className={`btn tiny${action.danger ? ' danger' : ''}`}
      disabled={executando}
      {...titulo}
      onClick={() => void executar()}
    >
      {action.label}
    </button>
  );
}
