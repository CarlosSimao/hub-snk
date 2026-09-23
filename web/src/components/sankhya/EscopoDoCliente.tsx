import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type {
  Cliente,
  DocumentoEscopo,
  EstadoTarefa,
  PrioridadeTarefa,
  TarefaEscopo,
  TipoTarefa,
} from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { useEscopo, type EntradaTarefa } from '../../hooks/useEscopo.ts';

/** Ordem das colunas. `Record` obriga a cobrir todo estado que o backend conhece. */
const COLUNAS: Record<EstadoTarefa, { rotulo: string; dica: string }> = {
  backlog: { rotulo: 'Backlog', dica: 'Levantado, ainda não planejado' },
  a_fazer: { rotulo: 'A fazer', dica: 'Planejado para agora' },
  em_andamento: { rotulo: 'Em andamento', dica: 'Alguém está fazendo' },
  em_revisao: { rotulo: 'Em revisão', dica: 'Pronto, aguardando revisão ou homologação' },
  concluido: { rotulo: 'Concluído', dica: 'Entregue' },
};
const ORDEM_COLUNAS = Object.keys(COLUNAS) as EstadoTarefa[];

const TIPOS: Record<TipoTarefa, string> = {
  backend: 'Backend',
  frontend: 'Tela',
  dados: 'Dados',
  relatorio: 'Relatório',
  bi: 'BI',
  integracao: 'Integração',
  configuracao: 'Configuração',
  teste: 'Teste',
  documentacao: 'Documentação',
  outro: 'Outro',
};

const PRIORIDADES: Record<PrioridadeTarefa, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

const STATUS_DOC: Record<DocumentoEscopo['status'], string> = {
  enviado: 'enviado',
  analisando: 'analisando…',
  analisado: 'analisado',
  falhou: 'falhou',
};

function horas(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Edicao = { tarefa: TarefaEscopo | null; estado: EstadoTarefa } | null;

/**
 * Escopo do cliente: o documento entra, a IA quebra em tarefas, e o quadro acompanha.
 *
 * O quadro é o objeto principal da aba — o documento é só a origem. Por isso tarefa
 * criada à mão convive com a gerada, e remover ou reanalisar um documento nunca leva o
 * andamento junto (ver `src/sankhya/escopo.ts`).
 */
export function EscopoDoCliente({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const escopo = useEscopo(cliente.id, toast);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [busca, setBusca] = useState('');
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<{ estado: EstadoTarefa; indice: number } | null>(null);

  const grupos = useMemo(
    () => [...new Set(escopo.tarefas.map((t) => t.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [escopo.tarefas],
  );

  const porColuna = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const mapa = Object.fromEntries(ORDEM_COLUNAS.map((e) => [e, [] as TarefaEscopo[]])) as Record<
      EstadoTarefa,
      TarefaEscopo[]
    >;
    for (const t of escopo.tarefas) {
      if (filtroGrupo && t.grupo !== filtroGrupo) continue;
      if (termo && !`${t.titulo} ${t.descricao} ${t.grupo}`.toLowerCase().includes(termo)) continue;
      mapa[t.estado]?.push(t);
    }
    for (const lista of Object.values(mapa)) lista.sort((a, b) => a.ordem - b.ordem);
    return mapa;
  }, [escopo.tarefas, filtroGrupo, busca]);

  const totais = useMemo(() => {
    const total = escopo.tarefas.reduce((s, t) => s + t.estimativaHoras, 0);
    const feitas = escopo.tarefas.filter((t) => t.estado === 'concluido').reduce((s, t) => s + t.estimativaHoras, 0);
    return { total, feitas, pct: total ? Math.round((feitas / total) * 100) : 0 };
  }, [escopo.tarefas]);

  async function aoEscolherArquivo(arquivo: File | undefined): Promise<void> {
    if (!arquivo) return;
    const doc = await escopo.enviarDocumento(arquivo);
    if (entradaArquivo.current) entradaArquivo.current.value = '';
    // Enviar sem analisar é o caso raro; o comum é querer as tarefas.
    if (doc) await escopo.analisar(doc.id);
  }

  // --- arrastar e soltar ---------------------------------------------------------------

  /**
   * Onde o cartão cairia: antes ou depois do cartão sob o ponteiro, pela metade da altura
   * dele. O índice é na coluna FILTRADA — o que o usuário vê — e é convertido para a
   * coluna inteira na hora de soltar.
   */
  function sobreCartao(evento: DragEvent<HTMLElement>, estado: EstadoTarefa, indice: number): void {
    evento.preventDefault();
    evento.stopPropagation();
    const caixa = evento.currentTarget.getBoundingClientRect();
    const depois = evento.clientY > caixa.top + caixa.height / 2;
    const novo = { estado, indice: indice + (depois ? 1 : 0) };
    if (!alvo || alvo.estado !== novo.estado || alvo.indice !== novo.indice) setAlvo(novo);
  }

  function sobreColuna(evento: DragEvent<HTMLElement>, estado: EstadoTarefa): void {
    evento.preventDefault();
    if (!alvo || alvo.estado !== estado) setAlvo({ estado, indice: porColuna[estado].length });
  }

  function soltar(evento: DragEvent<HTMLElement>, estado: EstadoTarefa): void {
    evento.preventDefault();
    const id = arrastando ?? Number(evento.dataTransfer.getData('text/plain'));
    const destino = alvo && alvo.estado === estado ? alvo : { estado, indice: porColuna[estado].length };
    setArrastando(null);
    setAlvo(null);
    if (!id) return;

    const atual = escopo.tarefas.find((t) => t.id === id);
    if (!atual) return;

    // O índice do alvo foi medido na lista visível COM o cartão arrastado nela. Descendo
    // na mesma coluna, tudo abaixo dele sobe uma posição quando ele sai — sem este ajuste
    // o cartão cairia um lugar abaixo de onde foi solto.
    const naTela = porColuna[estado];
    const deOnde = naTela.findIndex((t) => t.id === id);
    const indiceNaTela = deOnde >= 0 && destino.indice > deOnde ? destino.indice - 1 : destino.indice;

    // Com filtro ativo, "antes do cartão X" na tela vira a posição real de X na coluna
    // completa — senão soltar numa coluna filtrada jogaria o cartão no lugar errado.
    const vizinho = naTela.filter((t) => t.id !== id)[indiceNaTela];
    const completa = escopo.tarefas
      .filter((t) => t.estado === estado && t.id !== id)
      .sort((a, b) => a.ordem - b.ordem);
    const indiceReal = vizinho ? completa.findIndex((t) => t.id === vizinho.id) : completa.length;

    const posicaoAtual = completa.filter((t) => t.ordem < atual.ordem).length;
    const mesmaPosicao = atual.estado === estado && indiceReal === posicaoAtual;
    if (!mesmaPosicao) void escopo.mover(id, estado, indiceReal);
  }

  if (escopo.carregando) return <p className="detail-empty">Carregando escopo…</p>;

  return (
    <div className="escopo">
      <section className="card escopo-docs">
        <header className="escopo-docs-head">
          <div>
            <h3>Documento de escopo</h3>
            <p className="painel-nota">
              Envie o escopo (.docx, .pdf, .md ou .txt). A IA lê o documento, gera as tarefas no Backlog e aponta o
              que ficou ambíguo. Reanalisar troca só as tarefas que ainda estão no Backlog.
            </p>
          </div>
          <input
            ref={entradaArquivo}
            type="file"
            accept=".docx,.pdf,.md,.markdown,.txt"
            hidden
            onChange={(e) => void aoEscolherArquivo(e.target.files?.[0])}
          />
          <button
            className="btn"
            type="button"
            disabled={escopo.enviando}
            onClick={() => entradaArquivo.current?.click()}
          >
            {escopo.enviando ? 'Enviando…' : 'Enviar documento'}
          </button>
        </header>

        {escopo.documentos.length === 0 && <p className="painel-nota">Nenhum documento enviado para este cliente.</p>}

        {escopo.documentos.map((doc) => (
          <article key={doc.id} className={`escopo-doc status-${doc.status}`}>
            <div className="escopo-doc-linha">
              <strong className="escopo-doc-nome">{doc.nome}</strong>
              <span className="escopo-doc-meta">
                {doc.tipo.toUpperCase()} · {tamanho(doc.bytes)} · enviado{' '}
                {new Date(doc.enviadoEm).toLocaleString('pt-BR')}
              </span>
              <span className={`escopo-status ${doc.status}`}>{STATUS_DOC[doc.status]}</span>
              <span className="escopo-sep" />
              <button
                className="btn tiny"
                type="button"
                disabled={doc.status === 'analisando'}
                onClick={() => void escopo.analisar(doc.id)}
              >
                {doc.status === 'analisado' || doc.status === 'falhou' ? 'Reanalisar' : 'Analisar'}
              </button>
              <button
                className="btn tiny ghost danger"
                type="button"
                disabled={doc.status === 'analisando'}
                onClick={() => void escopo.removerDocumento(doc.id)}
                title="Remove o documento; as tarefas continuam no quadro"
              >
                Remover
              </button>
            </div>
            {doc.status === 'analisando' && (
              <p className="painel-nota">A IA está lendo o documento — escopos grandes levam alguns minutos.</p>
            )}
            {doc.status === 'falhou' && doc.erro && <p className="escopo-erro">{doc.erro}</p>}
            {doc.resumo && (
              <details className="escopo-resumo" open={escopo.documentos[0]?.id === doc.id}>
                <summary>Resumo da análise</summary>
                <p>{doc.resumo}</p>
              </details>
            )}
          </article>
        ))}
      </section>

      <section className="escopo-quadro-barra">
        <div className="escopo-progresso" title={`${horas(totais.feitas)} de ${horas(totais.total)} concluídas`}>
          <span>
            <strong>{escopo.tarefas.length}</strong> tarefa(s) · <strong>{horas(totais.total)}</strong> estimadas ·{' '}
            {totais.pct}% concluído
          </span>
          <span className="escopo-barra">
            <span style={{ width: `${totais.pct}%` }} />
          </span>
        </div>
        <input type="search" placeholder="Buscar tarefa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)}>
          <option value="">Todas as funcionalidades</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button className="btn tiny" type="button" onClick={() => setEdicao({ tarefa: null, estado: 'backlog' })}>
          Nova tarefa
        </button>
      </section>

      <div className="kanban">
        {ORDEM_COLUNAS.map((estado) => {
          const lista = porColuna[estado];
          const soma = lista.reduce((s, t) => s + t.estimativaHoras, 0);
          return (
            <section
              key={estado}
              className={`kanban-coluna ${alvo?.estado === estado ? 'alvo' : ''}`}
              onDragOver={(e) => sobreColuna(e, estado)}
              onDrop={(e) => soltar(e, estado)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAlvo(null);
              }}
            >
              <header className="kanban-coluna-head" title={COLUNAS[estado].dica}>
                <span>{COLUNAS[estado].rotulo}</span>
                <span className="kanban-contagem">
                  {lista.length} · {horas(soma)}
                </span>
                <button
                  className="btn-icone"
                  type="button"
                  aria-label={`Nova tarefa em ${COLUNAS[estado].rotulo}`}
                  onClick={() => setEdicao({ tarefa: null, estado })}
                >
                  +
                </button>
              </header>

              <div className="kanban-cartoes">
                {lista.map((t, i) => (
                  <div key={t.id}>
                    {alvo?.estado === estado && alvo.indice === i && arrastando !== null && (
                      <div className="kanban-marca" />
                    )}
                    <article
                      className={`kanban-cartao prioridade-${t.prioridade} ${arrastando === t.id ? 'arrastando' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(t.id));
                        e.dataTransfer.effectAllowed = 'move';
                        setArrastando(t.id);
                      }}
                      onDragEnd={() => {
                        setArrastando(null);
                        setAlvo(null);
                      }}
                      onDragOver={(e) => sobreCartao(e, estado, i)}
                      onClick={() => setEdicao({ tarefa: t, estado: t.estado })}
                    >
                      {t.grupo && <span className="kanban-grupo">{t.grupo}</span>}
                      <p className="kanban-titulo">{t.titulo}</p>
                      <footer className="kanban-rodape">
                        <span className={`kanban-tipo tipo-${t.tipo}`}>{TIPOS[t.tipo]}</span>
                        {t.estimativaHoras > 0 && <span>{horas(t.estimativaHoras)}</span>}
                        <span className="kanban-sep" />
                        {/* Mover sem arrastar: teclado, touchpad ruim, ou cartão no fim de uma coluna longa. */}
                        <select
                          aria-label="Mover para"
                          value={t.estado}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            const destino = e.target.value as EstadoTarefa;
                            void escopo.mover(t.id, destino, Number.MAX_SAFE_INTEGER);
                          }}
                        >
                          {ORDEM_COLUNAS.map((e2) => (
                            <option key={e2} value={e2}>
                              {COLUNAS[e2].rotulo}
                            </option>
                          ))}
                        </select>
                      </footer>
                    </article>
                  </div>
                ))}
                {alvo?.estado === estado && alvo.indice >= lista.length && arrastando !== null && (
                  <div className="kanban-marca" />
                )}
                {lista.length === 0 && arrastando === null && <p className="kanban-vazio">Nada aqui.</p>}
              </div>
            </section>
          );
        })}
      </div>

      {edicao && (
        <ModalTarefa
          edicao={edicao}
          grupos={grupos}
          onFechar={() => setEdicao(null)}
          onSalvar={async (entrada, estado) => {
            const ok = edicao.tarefa
              ? await escopo.atualizarTarefa(edicao.tarefa.id, entrada)
              : await escopo.criarTarefa(entrada, estado);
            // Na edição, trocar a coluna pelo formulário também move o cartão.
            if (ok && edicao.tarefa && estado !== edicao.tarefa.estado) {
              await escopo.mover(edicao.tarefa.id, estado, Number.MAX_SAFE_INTEGER);
            }
            if (ok) setEdicao(null);
          }}
          onExcluir={
            edicao.tarefa
              ? async () => {
                  await escopo.removerTarefa(edicao.tarefa!.id);
                  setEdicao(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function ModalTarefa({
  edicao,
  grupos,
  onFechar,
  onSalvar,
  onExcluir,
}: {
  edicao: NonNullable<Edicao>;
  grupos: string[];
  onFechar: () => void;
  onSalvar: (entrada: EntradaTarefa, estado: EstadoTarefa) => Promise<void>;
  onExcluir: (() => Promise<void>) | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = edicao.tarefa;
  const [titulo, setTitulo] = useState(t?.titulo ?? '');
  const [descricao, setDescricao] = useState(t?.descricao ?? '');
  const [grupo, setGrupo] = useState(t?.grupo ?? '');
  const [tipo, setTipo] = useState<TipoTarefa>(t?.tipo ?? 'backend');
  const [estimativa, setEstimativa] = useState(String(t?.estimativaHoras ?? ''));
  const [prioridade, setPrioridade] = useState<PrioridadeTarefa>(t?.prioridade ?? 'media');
  const [criterios, setCriterios] = useState(t?.criteriosAceite ?? '');
  const [estado, setEstado] = useState<EstadoTarefa>(edicao.estado);
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!titulo.trim()) return;
    setSalvando(true);
    try {
      await onSalvar(
        {
          titulo,
          descricao,
          grupo,
          tipo,
          estimativaHoras: Number(estimativa.replace(',', '.')) || 0,
          prioridade,
          criteriosAceite: criterios,
        },
        estado,
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <dialog className="modal modal-largo" ref={dialogRef} onClose={onFechar}>
      <form onSubmit={(e) => void aoSubmeter(e)}>
        <header className="modal-head">
          <h2>{t ? 'Tarefa' : 'Nova tarefa'}</h2>
          {t?.documentoId === null && t && <p>Criada à mão.</p>}
        </header>

        <div className="modal-body escopo-form">
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Título</span>
            <input value={titulo} maxLength={200} required autoFocus onChange={(e) => setTitulo(e.target.value)} />
          </label>
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Descrição</span>
            <textarea rows={5} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-nome">Funcionalidade</span>
            <input list="escopo-grupos" value={grupo} maxLength={100} onChange={(e) => setGrupo(e.target.value)} />
            <datalist id="escopo-grupos">
              {grupos.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <label className="campo">
            <span className="campo-nome">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoTarefa)}>
              {(Object.keys(TIPOS) as TipoTarefa[]).map((k) => (
                <option key={k} value={k}>
                  {TIPOS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-nome">Estimativa (horas)</span>
            <input inputMode="decimal" value={estimativa} onChange={(e) => setEstimativa(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-nome">Prioridade</span>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as PrioridadeTarefa)}>
              {(Object.keys(PRIORIDADES) as PrioridadeTarefa[]).map((k) => (
                <option key={k} value={k}>
                  {PRIORIDADES[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-nome">Coluna</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoTarefa)}>
              {ORDEM_COLUNAS.map((k) => (
                <option key={k} value={k}>
                  {COLUNAS[k].rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Critérios de aceite (um por linha)</span>
            <textarea rows={4} value={criterios} onChange={(e) => setCriterios(e.target.value)} />
          </label>
        </div>

        <footer className="modal-foot">
          <div className="modal-acoes">
            {onExcluir &&
              (confirmarExclusao ? (
                <button className="btn danger" type="button" onClick={() => void onExcluir()}>
                  Confirmar exclusão
                </button>
              ) : (
                <button className="btn ghost danger" type="button" onClick={() => setConfirmarExclusao(true)}>
                  Excluir
                </button>
              ))}
            <span className="modal-acoes-spacer" />
            <button className="btn ghost" type="button" onClick={onFechar}>
              Cancelar
            </button>
            <button className="btn" type="submit" disabled={salvando || !titulo.trim()}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
