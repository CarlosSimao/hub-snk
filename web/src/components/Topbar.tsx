import type { ServiceSnapshot, Status } from '../types.ts';
import { plural, worst } from '../lib/format.ts';
import type { EstadoConexao } from '../hooks/useHubStream.ts';

const CONEXAO_LABEL: Record<EstadoConexao, string> = {
  connecting: 'conectando',
  live: 'ao vivo',
  down: 'reconectando',
};

interface Props {
  services: ServiceSnapshot[];
  /** Falso até o primeiro `snapshot` chegar — sem isto a tela abriria dizendo que não há serviço. */
  carregado: boolean;
  conexao: EstadoConexao;
  notificacoes: { suportado: boolean; permissao: NotificationPermission; onClique: () => void };
  onRecarregar: () => void;
  recarregando: boolean;
  onAlternarTema: () => void;
}

export function Topbar({
  services,
  carregado,
  conexao,
  notificacoes,
  onRecarregar,
  recarregando,
  onAlternarTema,
}: Props) {
  const { overall, resumo } = resumoGlobal(services);
  const { permissao } = notificacoes;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" data-status={overall}>
          <i className="lamp red" />
          <i className="lamp amber" />
          <i className="lamp green" />
        </span>
        <div className="brand-text">
          <h1>
            Sankhya<span>Hub</span>
          </h1>
          <p>{carregado ? resumo : 'conectando…'}</p>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="conn" data-state={conexao}>
          <span className="conn-dot" />
          <span className="conn-label">{CONEXAO_LABEL[conexao]}</span>
        </div>

        {notificacoes.suportado && (
          <button
            className="btn ghost"
            id="btn-notify"
            data-state={permissao === 'granted' ? 'on' : permissao === 'denied' ? 'blocked' : 'off'}
            title={
              permissao === 'denied'
                ? 'Bloqueadas no navegador — libere no cadeado da barra de endereço'
                : 'Notificações do Windows quando algo cair'
            }
            onClick={notificacoes.onClique}
          >
            <span className="rotulo">
              {permissao === 'granted'
                ? 'Notificações ativas'
                : permissao === 'denied'
                  ? 'Notificações bloqueadas'
                  : 'Ativar notificações'}
            </span>
            <span className="so-estreito" aria-hidden="true">
              🔊
            </span>
          </button>
        )}

        <button
          className="btn ghost"
          disabled={recarregando}
          title="Relê o services.yaml sem reiniciar o hub"
          onClick={onRecarregar}
        >
          <span className="rotulo">Recarregar config</span>
          <span className="so-estreito" aria-hidden="true">
            ↻
          </span>
        </button>

        <button
          className="btn ghost icon"
          title="Alternar tema"
          aria-label="Alternar tema"
          onClick={onAlternarTema}
        >
          ◐
        </button>
      </div>
    </header>
  );
}

/** Projeto desabilitado não pinta o semáforo global nem entra na contagem por status. */
function resumoGlobal(services: ServiceSnapshot[]): { overall: Status; resumo: string } {
  const habilitados = services.filter((s) => !s.disabled);
  const statuses = habilitados.map((s) => s.status);

  const counts = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const status of statuses) counts[status] += 1;

  const total = services.length;
  const desabilitados = total - habilitados.length;

  const partes: string[] = [];
  if (counts.up) partes.push(`${counts.up} ok`);
  if (counts.degraded) {
    partes.push(`${counts.degraded} ${plural(counts.degraded, 'degradado', 'degradados')}`);
  }
  if (counts.down) partes.push(`${counts.down} fora do ar`);
  if (counts.unknown) partes.push(`${counts.unknown} sem dados`);
  if (desabilitados) {
    partes.push(`${desabilitados} ${plural(desabilitados, 'desabilitado', 'desabilitados')}`);
  }

  return {
    overall: worst(statuses),
    resumo: total
      ? `${total} ${plural(total, 'serviço', 'serviços')} — ${partes.join(' · ')}`
      : 'nenhum serviço configurado',
  };
}
