import { useMemo, useState } from 'react';
import { useResumoMes, type LinhaResumo } from '../../hooks/useResumoMes.ts';
import {
  DIAS_SEMANA,
  ROTULO_CRUZAMENTO,
  deslocarMes,
  mesAtual,
  montarGradeConsolidada,
  nomeDoMes,
  resumirMes,
  type DiaConsolidado,
  type ResumoMes,
  type StatusCliente,
} from '../../lib/calendario.ts';
import { Semaphore } from '../Semaphore.tsx';
import { PreVisualizador, type ArquivoPrevia } from './PreVisualizador.tsx';
import { TabBar, type Aba } from '../TabBar.tsx';
import type { EstadoSincronizacao, SolicitacaoServico, Status } from '../../types.ts';

type Visao = 'calendario' | 'clientes';

const VISOES: Aba<Visao>[] = [
  { id: 'calendario', rotulo: 'Calendário', titulo: 'O mês inteiro, com todos os clientes juntos' },
  { id: 'clientes', rotulo: 'Por cliente', titulo: 'Um cartão de resumo para cada cliente' },
];

/** O semáforo do painel é o mesmo da Infra — reaproveita a leitura que já está no olho. */
const COMO_SEMAFORO: Record<StatusCliente, Status> = {
  ok: 'up',
  atencao: 'degraded',
  atraso: 'down',
};

export function AgendaMensal({ onAbrirCliente }: { onAbrirCliente: (clienteId: number) => void }) {
  const [mes, setMes] = useState(mesAtual);
  const [visao, setVisao] = useState<Visao>('calendario');
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [previa, setPrevia] = useState<ArquivoPrevia | null>(null);
  const { linhas, carregando, erro, sessaoExpirada, sincronizacao, atualizarDoErp } = useResumoMes(mes);

  // Solicitações de todos os clientes num lugar só: o detalhe do dia procura pela demanda.
  const solicitacoes = useMemo(() => {
    const porCodigo = new Map<string, SolicitacaoServico>();
    for (const l of linhas) for (const s of l.solicitacoes ?? []) porCodigo.set(String(s.codigo), s);
    return porCodigo;
  }, [linhas]);

  const resumos = useMemo(
    () =>
      linhas.map((linha) => ({
        linha,
        resumo: linha.agenda ? resumirMes(mes, linha.agenda, linha.eventos ?? []) : null,
      })),
    [linhas, mes],
  );

  const grade = useMemo(() => montarGradeConsolidada(mes, linhas), [mes, linhas]);
  const selecionado = grade.find((d) => d.dia === diaAberto);

  const comAtraso = resumos.filter((r) => r.resumo?.status === 'atraso').length;
  const comAtencao = resumos.filter((r) => r.resumo?.status === 'atencao').length;

  return (
    <section className="painel">
      {previa && <PreVisualizador arquivo={previa} onFechar={() => setPrevia(null)} />}
      <div className="mensal-cabecalho">
        <div>
          <h2>{nomeDoMes(mes)}</h2>
          <p className="painel-nota">
            {carregando
              ? 'carregando…'
              : comAtraso || comAtencao
                ? `${comAtraso} cliente(s) com atraso · ${comAtencao} com trabalho sem OS`
                : `${resumos.length} cliente(s), nada pendente`}
          </p>
          <p className="painel-nota" title={sincronizacao?.erro || undefined}>
            {rotuloSincronizacao(sincronizacao)}
          </p>
        </div>
        <div className="detail-actions">
          <button
            className="btn tiny ghost"
            disabled={sincronizacao?.rodando}
            title="Busca de novo a Agenda de Recursos e as Solicitações de Serviços no ERP"
            onClick={() => void atualizarDoErp()}
          >
            {sincronizacao?.rodando ? 'atualizando…' : 'Atualizar do ERP'}
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, -1))}>
            ‹
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(mesAtual())}>
            Mês atual
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, 1))}>
            ›
          </button>
        </div>
      </div>

      {erro && (
        <div className="warning">
          <span>⚠</span>
          <span>
            {erro}
            {sessaoExpirada && (
              <>
                <br />
                Vá em <strong>Credenciais</strong>, abra a janela de login e capture a sessão de
                novo.
              </>
            )}
          </span>
        </div>
      )}

      {!erro && !carregando && resumos.length === 0 && (
        <p className="detail-empty">
          Nenhum cliente cadastrado ainda — comece em <strong>Clientes</strong>.
        </p>
      )}

      {resumos.length > 0 && <TabBar abas={VISOES} ativa={visao} onTrocar={setVisao} variante="sub" />}

      {visao === 'calendario' && resumos.length > 0 && (
        <article className="card">
          <div className="calendario calendario-geral">
            {DIAS_SEMANA.map((dia) => (
              <div className="cal-cabecalho" key={dia}>
                {dia}
              </div>
            ))}

            {grade.map((dia) => (
              <CelulaGeral
                key={dia.dia}
                dia={dia}
                aberto={dia.dia === diaAberto}
                onAbrir={() => setDiaAberto(dia.dia === diaAberto ? null : dia.dia)}
              />
            ))}
          </div>

          {selecionado && (
            <DetalheGeral
              dia={selecionado}
              solicitacoes={solicitacoes}
              onAbrirCliente={onAbrirCliente}
              onPrevisualizar={setPrevia}
            />
          )}

          <p className="painel-nota calendario-nota">
            Cada dia mostra os clientes com algo nele, um chip por demanda. A cor vem do
            cruzamento entre a Agenda de Recursos do ERP e a Experience; descrição, horas
            estimadas e anexos vêm da Solicitação de Serviços DS. Clientes sem o parceiro amarrado
            no cadastro aparecem só pelo lado da Experience.
          </p>
        </article>
      )}

      {visao === 'clientes' &&
        resumos.map(({ linha, resumo }) => (
          <CartaoCliente
            key={linha.cliente.id}
            linha={linha}
            resumo={resumo}
            onAbrir={() => onAbrirCliente(linha.cliente.id)}
          />
        ))}
    </section>
  );
}

/** Um dia da visão consolidada: o número e quem teve trabalho nele. */
function CelulaGeral({
  dia,
  aberto,
  onAbrir,
}: {
  dia: DiaConsolidado;
  aberto: boolean;
  onAbrir: () => void;
}) {
  const classes = ['cal-dia', dia.doMes ? '' : 'fora', dia.hoje ? 'hoje' : '', aberto ? 'aberto' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={aberto}
      disabled={dia.clientes.length === 0}
      onClick={onAbrir}
    >
      <span className="cal-numero">{dia.numero}</span>
      <span className="cal-clientes">
        {dia.clientes.map((c) => (
          <i
            key={`${c.clienteId}-${c.demanda}`}
            className={`chip-cliente cruz-${c.cruzamento}`}
            title={`${c.nome}${c.demanda ? ` · demanda ${c.demanda}` : ''} — ${ROTULO_CRUZAMENTO[c.cruzamento]}`}
          >
            <span className="chip-nome">{c.nome}</span>
            {c.demanda && <b className="chip-demanda">{c.demanda}</b>}
          </i>
        ))}
      </span>
    </button>
  );
}

function DetalheGeral({
  dia,
  solicitacoes,
  onAbrirCliente,
  onPrevisualizar,
}: {
  dia: DiaConsolidado;
  solicitacoes: Map<string, SolicitacaoServico>;
  onAbrirCliente: (clienteId: number) => void;
  onPrevisualizar: (arquivo: ArquivoPrevia) => void;
}) {
  return (
    <div className="dia-detalhe">
      <h3>{new Date(`${dia.dia}T12:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'full' })}</h3>

      {dia.clientes.map((c) => (
        <div className="linha-demanda" key={`${c.clienteId}-${c.demanda}`}>
        <div className="linha-agenda">
          <span className={`selo-cruzamento ${c.cruzamento}`}>
            <i className={`marca-cruzamento ${c.cruzamento}`} />
            {ROTULO_CRUZAMENTO[c.cruzamento]}
          </span>
          <span className="linha-titulo">
            {c.nome}
            {c.demanda && <span className="linha-meta"> · demanda {c.demanda}</span>}
          </span>
          <span className="linha-meta">
            {[
              c.eventos ? `${c.eventos} evento(s)` : '',
              c.tarefas ? `${c.tarefas} tarefa(s)` : '',
              c.ordens ? `${c.ordens} OS` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button className="btn tiny ghost" onClick={() => onAbrirCliente(c.clienteId)}>
            Abrir
          </button>
        </div>
        {c.demanda && (
          <DetalheSolicitacao
            codigo={c.demanda}
            solicitacao={solicitacoes.get(c.demanda)}
            onPrevisualizar={onPrevisualizar}
          />
        )}
        {c.textosEventos.length > 0 && (
          <details className="detalhe-eventos">
            <summary>Observação do evento na Agenda de Recursos</summary>
            {[...new Set(c.textosEventos)].map((t) => (
              <pre key={t}>{t}</pre>
            ))}
          </details>
        )}
        </div>
      ))}
    </div>
  );
}

/** O que a Solicitação de Serviços DS diz da demanda: descrição, horas e arquivos. */
function DetalheSolicitacao({
  codigo,
  solicitacao,
  onPrevisualizar,
}: {
  codigo: string;
  solicitacao?: SolicitacaoServico;
  onPrevisualizar: (arquivo: ArquivoPrevia) => void;
}) {
  if (!solicitacao) {
    return (
      <p className="painel-nota detalhe-solicitacao">
        Solicitação {codigo} ainda não foi lida do ERP. Ela entra na próxima atualização, ou
        agora em Atualizar do ERP.
      </p>
    );
  }

  const arquivo = (nuAttach?: number) =>
    `/api/solicitacoes/${solicitacao.codigo}/arquivo${nuAttach ? `?nuAttach=${nuAttach}` : ''}`;

  return (
    <div className="detalhe-solicitacao">
      <div className="pills">
        {solicitacao.horasEstimadas !== null && (
          <span className="pill">
            horas estimadas <b>{formatarHoras(solicitacao.horasEstimadas)}</b>
          </span>
        )}
        {solicitacao.statusOrcamento && <span className="pill">{solicitacao.statusOrcamento}</span>}
        {solicitacao.tipo && <span className="pill">{solicitacao.tipo}</span>}
      </div>
      {solicitacao.descricao && <p className="solicitacao-descricao">{solicitacao.descricao}</p>}
      {(solicitacao.anexo || solicitacao.anexos.length > 0) && (
        <ul className="solicitacao-anexos">
          {solicitacao.anexo && (
            <li>
              <LinhaArquivo nome={solicitacao.anexo.nome} url={arquivo()} onPrevisualizar={onPrevisualizar} />
              <span className="linha-meta"> campo Anexo{tamanho(solicitacao.anexo.tamanho)}</span>
            </li>
          )}
          {solicitacao.anexos.map((a) => (
            <li key={a.nuAttach}>
              {a.link ? (
                <a href={a.link} target="_blank" rel="noreferrer">
                  🔗 {a.nome || a.link}
                </a>
              ) : (
                <LinhaArquivo nome={a.nome} url={arquivo(a.nuAttach)} onPrevisualizar={onPrevisualizar} />
              )}
              {a.descricao && <span className="linha-meta"> {a.descricao}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="painel-nota">Lida do ERP {hora(solicitacao.lidoEm)}</p>
    </div>
  );
}

/** Nome do arquivo abre a pré-visualização; o ícone ao lado baixa direto. */
function LinhaArquivo({
  nome,
  url,
  onPrevisualizar,
}: {
  nome: string;
  url: string;
  onPrevisualizar: (arquivo: ArquivoPrevia) => void;
}) {
  return (
    <>
      <button type="button" className="link-arquivo" title="Pré-visualizar" onClick={() => onPrevisualizar({ nome, url })}>
        📎 {nome}
      </button>
      <a className="btn tiny ghost" href={url} download={nome} title="Baixar">
        ⤓
      </a>
    </>
  );
}

function formatarHoras(horas: number): string {
  return `${horas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
}

function tamanho(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? ` · ${(bytes / 1024 / 1024).toFixed(1)} MB` : ` · ${Math.ceil(bytes / 1024)} KB`;
}

function hora(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "ERP atualizado seg. 28, 11:02 · próxima seg. 28, 15:02" — ou o erro da tentativa. */
function rotuloSincronizacao(s: EstadoSincronizacao | null): string {
  if (!s) return '';
  if (s.rodando) return 'atualizando do ERP…';
  if (s.erro && !s.ultimaEm) return `ERP não atualizado: ${s.erro}`;
  const partes = [s.ultimaEm ? `ERP atualizado ${hora(s.ultimaEm)}` : 'ERP ainda não atualizado'];
  if (s.erro) partes.push('última tentativa falhou');
  if (s.proximaEm && s.ultimaEm) partes.push(`próxima ${hora(s.proximaEm)}`);
  return partes.join(' · ');
}

function CartaoCliente({
  linha,
  resumo,
  onAbrir,
}: {
  linha: LinhaResumo;
  resumo: ResumoMes | null;
  onAbrir: () => void;
}) {
  return (
    <article className="card mensal-cliente" data-status={resumo ? COMO_SEMAFORO[resumo.status] : 'unknown'}>
      <div className="detail-head">
        {resumo ? (
          <Semaphore status={COMO_SEMAFORO[resumo.status]} extra="vertical" />
        ) : (
          <Semaphore status="unknown" extra="vertical" />
        )}

        <div className="card-title">
          <h2>{linha.cliente.nome}</h2>
          {linha.erro ? (
            <p className="card-summary">{linha.erro}</p>
          ) : (
            resumo && <p className="card-summary">{frase(resumo)}</p>
          )}
        </div>

        <div className="detail-actions">
          <button className="btn tiny ghost" onClick={onAbrir}>
            Abrir agenda
          </button>
        </div>
      </div>

      {resumo && (
        <div className="pills mensal-pills">
          <span className="pill">
            dias com atuação <b>{resumo.diasComAtuacao}</b>
          </span>
          <span className="pill">
            tarefas <b>{resumo.tarefas}</b>
          </span>
          <span className={`pill${resumo.tarefasAtrasadas ? ' bad' : ''}`}>
            atrasadas <b>{resumo.tarefasAtrasadas}</b>
          </span>
          <span className="pill">
            OS no mês <b>{resumo.ordens}</b>
          </span>
          <span className={`pill${resumo.diasSemOs ? ' warn' : ''}`}>
            dias sem OS <b>{resumo.diasSemOs}</b>
          </span>
        </div>
      )}

      {(linha.demandas ?? []).length > 0 && (
        <div className="pills mensal-pills">
          {(linha.demandas ?? []).map((id) => {
            const s = linha.solicitacoes?.find((x) => String(x.codigo) === id);
            return (
              <span className="pill" key={id} title={s?.descricao || undefined}>
                demanda <b>{id}</b>
                {s?.horasEstimadas != null && ` · ${formatarHoras(s.horasEstimadas)}`}
                {s?.statusOrcamento && ` · ${s.statusOrcamento}`}
              </span>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** A frase que resume o cartão — o mesmo critério do semáforo, em português. */
function frase(resumo: ResumoMes): string {
  if (resumo.tarefasAtrasadas) {
    return `${resumo.tarefasAtrasadas} tarefa(s) atrasada(s)`;
  }
  if (resumo.status === 'atraso') {
    return 'OS de dia passado sem aceite gerado';
  }
  if (resumo.diasSemOs) {
    return `${resumo.diasSemOs} dia(s) com tarefa e nenhuma OS lançada`;
  }
  return resumo.diasComAtuacao ? 'tudo em dia no mês' : 'sem atuação no mês';
}
