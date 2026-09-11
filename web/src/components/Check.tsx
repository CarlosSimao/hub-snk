import { useState } from 'react';
import type { ActionDescriptor, CheckSnapshot } from '../types.ts';
import { relativeTime } from '../lib/format.ts';
import { enviar, rotaCheck } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';
import { Semaphore } from './Semaphore.tsx';
import { HistoryBars } from './HistoryBars.tsx';
import { Sparkline } from './Sparkline.tsx';
import { ComponentPills, IndicatorPills } from './Pills.tsx';
import { ActionButtons } from './ActionButtons.tsx';

interface Props {
  check: CheckSnapshot;
  actions: ActionDescriptor[];
  flash: boolean;
  infoAberta: boolean;
  acoesAbertas: boolean;
  onToggleInfo: () => void;
  onToggleAcoes: () => void;
  onAbrirSettings: () => void;
  onCheckAtualizado: (snapshot: CheckSnapshot) => void;
  toast: Avisar;
}

export function Check({
  check,
  actions,
  flash,
  infoAberta,
  acoesAbertas,
  onToggleInfo,
  onToggleAcoes,
  onAbrirSettings,
  onCheckAtualizado,
  toast,
}: Props) {
  const [testando, setTestando] = useState(false);

  const uptime =
    check.uptimePct === null ? '—' : `${check.uptimePct.toFixed(check.uptimePct >= 99.95 ? 2 : 1)}%`;

  const testar = async () => {
    setTestando(true);
    try {
      const { ok, body } = await enviar<CheckSnapshot>(
        rotaCheck(check.serviceId, check.checkId, 'run'),
      );
      if (ok) onCheckAtualizado(body as CheckSnapshot);
      else toast('Não consegui executar o check', 'err');
    } catch (err) {
      toast(`Falha ao executar: ${(err as Error).message}`, 'err');
    } finally {
      setTestando(false);
    }
  };

  const classes = [
    'check',
    check.muted ? 'muted' : '',
    check.disabled ? 'disabled' : '',
    flash ? 'flash' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-status={check.status}>
      <div className="check-left">
        <div className="check-main">
          <Semaphore status={check.status} extra="vertical" />
          <div className="check-id">
            <div className="check-name">
              <strong>{check.name}</strong>
              <span className="check-type">{check.type}</span>
              <button
                className="btn-info"
                aria-expanded={infoAberta}
                title="Como o monitor verifica este serviço"
                onClick={onToggleInfo}
              >
                i
              </button>
              {check.muted && <span className="badge-muted">silenciado</span>}
              {check.disabled && <span className="badge-disabled">desabilitado</span>}
            </div>
            <div className="check-status-row">
              <p className="check-msg">
                {check.message} · {relativeTime(check.ts)}
              </p>
              <div className="viz-top">
                <div className="uptime" title="Disponibilidade na janela de retenção">
                  <b>{uptime}</b>uptime
                </div>
                <Sparkline history={check.history} />
              </div>
            </div>
            {/*
              Só entra no DOM quando aberta — renderizar escondido repetiria o bug do
              `hidden` vencido por uma regra de `display`.
            */}
            {infoAberta && check.explicacao.length > 0 && (
              <div className="check-info">
                <ul>
                  {check.explicacao.map((linha) => (
                    <li key={linha}>{linha}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="viz">
          <HistoryBars history={check.history} />
        </div>
        <ComponentPills components={check.components} />
        <IndicatorPills indicators={check.indicators} />
        {acoesAbertas && actions.length > 0 && (
          <div className="actions-panel inline">
            <ActionButtons serviceId={check.serviceId} actions={actions} toast={toast} />
          </div>
        )}
      </div>

      <div className="check-actions">
        <button
          className="btn tiny ghost"
          disabled={check.disabled || testando}
          title={
            check.disabled ? 'Habilite o monitoramento para rodar agora' : 'Executar este check agora'
          }
          onClick={() => void testar()}
        >
          Testar
        </button>
        <button
          className="btn tiny ghost"
          aria-expanded={acoesAbertas}
          disabled={!actions.length}
          title={actions.length ? 'Ações deste serviço' : 'Nenhuma ação disponível para este check'}
          onClick={onToggleAcoes}
        >
          Ações
        </button>
        <button
          className="btn tiny ghost"
          title="Intervalo, timeout e habilitar/desabilitar este check"
          onClick={onAbrirSettings}
        >
          Configurações
        </button>
      </div>
    </div>
  );
}
