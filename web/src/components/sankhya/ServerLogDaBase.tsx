import { useCallback, useEffect, useState } from 'react';
import type { InstalacaoServerLog, StatusServerLog } from '../../types.ts';
import { enviar, requisitar } from '../../lib/api.ts';
import { ModalMonitorLog } from './ModalMonitorLog.tsx';

interface Verificacao {
  status: StatusServerLog;
  resumo: string;
  configurado: boolean;
  restante: string[];
  instalacao: InstalacaoServerLog | null;
}

function dataCurta(valor: string): string {
  if (!valor) return '';
  // `YYYY-MM-DD` puro seria lido como UTC e voltaria um dia no fuso de São Paulo.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T12:00:00`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString('pt-BR');
}

/**
 * Monitor de log da base, com a verificação e o prazo de remoção do módulo.
 *
 * O módulo Java `serverlog` é instalado na base DO CLIENTE só durante a demanda. Por isso
 * o cartão não mostra só o botão de abrir o log: mostra se a base está configurada e, se o
 * módulo está lá, até quando pode ficar — e a baixa só é aceita depois que a verificação
 * confirma que ele saiu (ver `src/routesServerLog.ts`).
 */
export function ServerLogDaBase({ url, demandaFim = '' }: { url: string; demandaFim?: string }) {
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    origin = '';
  }

  const [aberto, setAberto] = useState(false);
  const [instalacao, setInstalacao] = useState<InstalacaoServerLog | null>(null);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [removerAte, setRemoverAte] = useState('');
  const [demanda, setDemanda] = useState('');

  const carregar = useCallback(async () => {
    if (!origin) return;
    const { ok, body } = await requisitar<{ instalacao: InstalacaoServerLog | null }>(
      `/api/serverlog/instalacoes?origin=${encodeURIComponent(origin)}`,
    );
    if (!ok) return;
    const i = body.instalacao ?? null;
    setInstalacao(i);
    setRemoverAte(i?.removerAte ?? '');
    setDemanda(i?.demanda ?? '');
  }, [origin]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!origin) return null;

  async function verificar(): Promise<void> {
    setVerificando(true);
    setMensagem(null);
    const { ok, body } = await enviar<Verificacao>('/api/serverlog/verificar', { origin });
    setVerificando(false);
    if (!ok) {
      setMensagem({ tipo: 'erro', texto: body.error ?? 'não consegui verificar a base' });
      return;
    }
    const v = body as Verificacao;
    setVerificacao(v);
    if (v.instalacao) {
      setInstalacao(v.instalacao);
      setRemoverAte(v.instalacao.removerAte);
      setDemanda(v.instalacao.demanda);
    }
  }

  async function salvarPrazo(): Promise<void> {
    setMensagem(null);
    const { ok, body } = await requisitar<{ instalacao: InstalacaoServerLog }>('/api/serverlog/instalacoes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin, removerAte, demanda }),
    });
    if (!ok) {
      setMensagem({ tipo: 'erro', texto: body.error ?? 'não consegui salvar' });
      return;
    }
    if (body.instalacao) setInstalacao(body.instalacao);
    setMensagem({ tipo: 'ok', texto: 'Prazo salvo' });
  }

  async function marcarRemovido(): Promise<void> {
    setVerificando(true);
    setMensagem(null);
    const { ok, body } = await enviar<{ instalacao: InstalacaoServerLog }>('/api/serverlog/removido', { origin });
    setVerificando(false);
    if (!ok) {
      // 409 = a verificação achou algo ainda instalado; a mensagem já diz o quê.
      setMensagem({ tipo: 'erro', texto: body.error ?? 'não consegui confirmar a remoção' });
      return;
    }
    if (body.instalacao) setInstalacao(body.instalacao);
    setVerificacao(null);
    setMensagem({ tipo: 'ok', texto: 'Remoção confirmada na base' });
  }

  const ativa = Boolean(instalacao?.ativa);
  const pill = verificacao
    ? verificacao.configurado
      ? { classe: 'ok', texto: 'log configurado' }
      : { classe: 'aviso', texto: verificacao.resumo }
    : ativa
      ? { classe: 'info', texto: 'módulo serverlog instalado' }
      : null;

  return (
    <div className="serverlog-base">
      <div className="serverlog-linha">
        <button className="btn tiny ghost" type="button" onClick={() => setAberto(true)} title={origin}>
          Monitor de log
        </button>
        <button className="btn tiny ghost" type="button" disabled={verificando} onClick={() => void verificar()}>
          {verificando ? 'Verificando…' : 'Verificar configuração'}
        </button>
        {pill && <span className={`serverlog-pill ${pill.classe}`}>{pill.texto}</span>}
      </div>

      {verificacao && !verificacao.configurado && (
        <ul className="serverlog-checklist">
          <li className={verificacao.status.modulo ? 'feito' : ''}>
            Módulo Java <code>serverlog</code> importado na base
            {verificacao.status.modulo ? ` — ${verificacao.status.modulo.resourceId || verificacao.status.modulo.descricao}` : ''}
          </li>
          <li className={verificacao.status.botaoLer ? 'feito' : ''}>
            Classe <code>LerLogAction</code> registrada como Botão de Ação
            {verificacao.status.botaoLer ? ` — id ${verificacao.status.botaoLer.id}` : ''}
          </li>
          <li className={verificacao.status.leituraOk ? 'feito' : ''}>
            Leitura de teste
            {verificacao.status.leituraOk === false && verificacao.status.erroLeitura
              ? ` — ${verificacao.status.erroLeitura}`
              : ''}
          </li>
        </ul>
      )}

      {ativa && instalacao && (
        <div className={`serverlog-instalacao ${instalacao.vencida ? 'vencida' : ''}`}>
          <p>
            {instalacao.vencida ? (
              <strong>Prazo de remoção vencido.</strong>
            ) : (
              <strong>Módulo instalado na base do cliente.</strong>
            )}{' '}
            Detectado em {dataCurta(instalacao.detectadoEm)}. Ao fim da demanda, retire da base
            {instalacao.modulo ? <> o módulo <code>{instalacao.modulo}</code></> : ' o módulo serverlog'}
            {instalacao.botaoId ? <> e o botão de ação id <code>{instalacao.botaoId}</code></> : ' e o botão de ação'}
            {instalacao.botaoMonitorId ? <> (e o id <code>{instalacao.botaoMonitorId}</code>)</> : ''}.
          </p>
          <div className="serverlog-campos">
            <label>
              <span>Remover até</span>
              <input type="date" value={removerAte} onChange={(e) => setRemoverAte(e.target.value)} />
            </label>
            <label className="serverlog-demanda">
              <span>Demanda</span>
              <input
                type="text"
                value={demanda}
                maxLength={200}
                placeholder="OS, chamado ou motivo"
                onChange={(e) => setDemanda(e.target.value)}
              />
            </label>
            {demandaFim && demandaFim !== removerAte && (
              <button
                className="btn tiny ghost"
                type="button"
                title="O prazo do módulo acompanha o fim da demanda cadastrado no cliente"
                onClick={() => setRemoverAte(demandaFim)}
              >
                Usar fim da demanda ({dataCurta(demandaFim)})
              </button>
            )}
            <button className="btn tiny" type="button" onClick={() => void salvarPrazo()}>
              Salvar prazo
            </button>
            <button className="btn tiny ghost" type="button" disabled={verificando} onClick={() => void marcarRemovido()}>
              Já removi da base
            </button>
          </div>
          {instalacao.ultimaVerificacao && (
            <p className="serverlog-nota">
              Última verificação {new Date(instalacao.ultimaVerificacao).toLocaleString('pt-BR')}: {instalacao.ultimoStatus}
            </p>
          )}
        </div>
      )}

      {!ativa && instalacao?.removidoEm && (
        <p className="serverlog-nota">Módulo removido da base em {dataCurta(instalacao.removidoEm)} (confirmado).</p>
      )}

      {mensagem && <p className={`serverlog-msg ${mensagem.tipo}`}>{mensagem.texto}</p>}

      {aberto && (
        <ModalMonitorLog
          origin={origin}
          titulo={instalacao?.clienteNome || origin}
          aberto={aberto}
          onFechar={() => {
            setAberto(false);
            // A leitura registra a detecção no backend; recarregar faz o prazo aparecer
            // no cartão já na primeira vez que o monitor é usado.
            void carregar();
          }}
        />
      )}
    </div>
  );
}
