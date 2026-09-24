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
import { requisitar } from '../../lib/api.ts';

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

/** Qual quadro está na tela: todas as demandas juntas, só as avulsas, ou uma demanda (id do documento). */
type Demanda = 'todas' | 'avulsas' | number;

function lerDemanda(chave: string): Demanda {
  try {
    const v = localStorage.getItem(chave);
    if (v === 'avulsas') return 'avulsas';
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 'todas';
  } catch {
    return 'todas';
  }
}

function daDemanda(t: TarefaEscopo, demanda: Demanda): boolean {
  if (demanda === 'todas') return true;
  if (demanda === 'avulsas') return t.documentoId === null;
  return t.documentoId === demanda;
}

function hora(iso: string): string {
  return iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}

async function copiar(texto: string, toast: Avisar, oQue: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast(`${oQue} copiado`, 'ok');
  } catch {
    toast(`Não consegui copiar — ${oQue.toLowerCase()}: ${texto}`, 'err');
  }
}

/** Mesma regra do hub (`nomeSugerido` em escopoCompartilhado.ts): o servidor normaliza de novo ao salvar. */
function nomeSugerido(demanda: string): string {
  const slug = demanda
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'tarefas'}.json`;
}

function juntar(pasta: string, nome: string): string {
  const sep = pasta.includes('/') && !pasta.includes('\\') ? '/' : '\\';
  return `${pasta.replace(/[\\/]+$/, '')}${sep}${nome}`;
}

function instrucaoParaIa(arquivo: string): string {
  return (
    `As tarefas desta demanda estão em ${arquivo}. Leia o arquivo e siga o que está em "comoAtualizar". ` +
    'Comece pelas tarefas em "a_fazer" (ou pelas do "backlog", em ordem de prioridade, se não houver nenhuma) e, ' +
    'conforme trabalhar, atualize "estado" e "notas" de cada tarefa nesse mesmo arquivo — é assim que o quadro do ' +
    'Development Switch acompanha o andamento.'
  );
}

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
  const [visor, setVisor] = useState<DocumentoEscopo | null>(null);
  const chaveDemanda = `escopo-demanda-${cliente.id}`;
  const [demandaEscolhida, setDemandaEscolhida] = useState<Demanda>(() => lerDemanda(chaveDemanda));

  // Demanda lembrada que foi removida (aqui ou em outra janela) volta para "todas".
  const demanda: Demanda =
    typeof demandaEscolhida === 'number' && !escopo.documentos.some((d) => d.id === demandaEscolhida)
      ? 'todas'
      : demandaEscolhida;

  function escolherDemanda(d: Demanda): void {
    setDemandaEscolhida(d);
    try {
      localStorage.setItem(chaveDemanda, String(d));
    } catch {
      /* sem storage: a escolha vale só nesta sessão */
    }
  }

  const doQuadro = useMemo(() => escopo.tarefas.filter((t) => daDemanda(t, demanda)), [escopo.tarefas, demanda]);

  const grupos = useMemo(
    () => [...new Set(doQuadro.map((t) => t.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [doQuadro],
  );

  const progressoPorDemanda = useMemo(() => {
    const mapa = new Map<number, { total: number; feitas: number }>();
    for (const t of escopo.tarefas) {
      if (t.documentoId === null) continue;
      const p = mapa.get(t.documentoId) ?? { total: 0, feitas: 0 };
      p.total += 1;
      if (t.estado === 'concluido') p.feitas += 1;
      mapa.set(t.documentoId, p);
    }
    return mapa;
  }, [escopo.tarefas]);
  const avulsas = escopo.tarefas.filter((t) => t.documentoId === null).length;

  const porColuna = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const mapa = Object.fromEntries(ORDEM_COLUNAS.map((e) => [e, [] as TarefaEscopo[]])) as Record<
      EstadoTarefa,
      TarefaEscopo[]
    >;
    for (const t of doQuadro) {
      if (filtroGrupo && t.grupo !== filtroGrupo) continue;
      if (termo && !`${t.titulo} ${t.descricao} ${t.grupo}`.toLowerCase().includes(termo)) continue;
      mapa[t.estado]?.push(t);
    }
    for (const lista of Object.values(mapa)) lista.sort((a, b) => a.ordem - b.ordem);
    return mapa;
  }, [doQuadro, filtroGrupo, busca]);

  const totais = useMemo(() => {
    const total = doQuadro.reduce((s, t) => s + t.estimativaHoras, 0);
    const feitas = doQuadro.filter((t) => t.estado === 'concluido').reduce((s, t) => s + t.estimativaHoras, 0);
    return { total, feitas, pct: total ? Math.round((feitas / total) * 100) : 0 };
  }, [doQuadro]);

  async function aoEscolherArquivo(arquivo: File | undefined): Promise<void> {
    if (!arquivo) return;
    const doc = await escopo.enviarDocumento(arquivo);
    if (entradaArquivo.current) entradaArquivo.current.value = '';
    if (!doc) return;
    // Demanda nova: o quadro já passa a mostrá-la, que é o que a pessoa vai querer ver.
    escolherDemanda(doc.id);
    // Enviar sem analisar é o caso raro; o comum é querer as tarefas.
    await escopo.analisar(doc.id);
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
            <h3>Demandas</h3>
            <p className="painel-nota">
              Cada documento de escopo (.docx, .pdf, .md ou .txt) é uma demanda com o próprio quadro. A IA lê o
              documento, gera as tarefas no Backlog e aponta o que ficou ambíguo. Reanalisar troca só as tarefas que
              ainda estão no Backlog.
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
            {escopo.enviando ? 'Enviando…' : 'Nova demanda'}
          </button>
        </header>

        {escopo.documentos.length === 0 && <p className="painel-nota">Nenhuma demanda para este cliente.</p>}

        {escopo.documentos.map((doc) => (
          <CartaoDemanda
            key={doc.id}
            doc={doc}
            ativa={demanda === doc.id}
            progresso={progressoPorDemanda.get(doc.id) ?? { total: 0, feitas: 0 }}
            abrirResumo={escopo.documentos[0]?.id === doc.id}
            pastaSugerida={escopo.pastaSugerida}
            toast={toast}
            onVerQuadro={() => escolherDemanda(demanda === doc.id ? 'todas' : doc.id)}
            onVer={() => setVisor(doc)}
            onAnalisar={() => void escopo.analisar(doc.id)}
            onRemover={() => void escopo.removerDocumento(doc.id)}
            onRenomear={(nome) => escopo.renomearDemanda(doc.id, nome)}
            onCompartilhar={(pasta, nome, criarPastaTarefas, ignorarNoGit) =>
              escopo.compartilhar(doc.id, pasta, nome, criarPastaTarefas, ignorarNoGit)
            }
          />
        ))}
      </section>

      <section className="escopo-quadro-barra">
        <div className="escopo-progresso" title={`${horas(totais.feitas)} de ${horas(totais.total)} concluídas`}>
          <span>
            <strong>{doQuadro.length}</strong> tarefa(s) · <strong>{horas(totais.total)}</strong> estimadas ·{' '}
            {totais.pct}% concluído
          </span>
          <span className="escopo-barra">
            <span style={{ width: `${totais.pct}%` }} />
          </span>
        </div>
        <select
          aria-label="Demanda"
          value={String(demanda)}
          onChange={(e) => {
            const v = e.target.value;
            escolherDemanda(v === 'todas' || v === 'avulsas' ? v : Number(v));
            setFiltroGrupo('');
          }}
        >
          <option value="todas">Todas as demandas</option>
          {escopo.documentos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.demanda}
            </option>
          ))}
          {(avulsas > 0 || demanda === 'avulsas') && <option value="avulsas">Avulsas (sem demanda)</option>}
        </select>
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
                      {demanda === 'todas' && escopo.documentos.length > 1 && (
                        <span className="kanban-demanda">
                          {escopo.documentos.find((d) => d.id === t.documentoId)?.demanda ?? 'Avulsa'}
                        </span>
                      )}
                      {t.grupo && <span className="kanban-grupo">{t.grupo}</span>}
                      <p className="kanban-titulo">{t.titulo}</p>
                      {t.notas && (
                        <p className="kanban-notas" title={t.notas}>
                          {t.notas}
                        </p>
                      )}
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

      {visor && <VisorDocumento doc={visor} onFechar={() => setVisor(null)} />}

      {edicao && (
        <ModalTarefa
          edicao={edicao}
          grupos={grupos}
          documentos={escopo.documentos}
          demandaPadrao={typeof demanda === 'number' ? demanda : null}
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
  documentos,
  demandaPadrao,
  onFechar,
  onSalvar,
  onExcluir,
}: {
  edicao: NonNullable<Edicao>;
  grupos: string[];
  documentos: DocumentoEscopo[];
  demandaPadrao: number | null;
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
  const [notas, setNotas] = useState(t?.notas ?? '');
  const [documentoId, setDocumentoId] = useState<number | null>(t ? t.documentoId : demandaPadrao);
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
          notas,
          documentoId,
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
        </header>

        <div className="modal-body escopo-form">
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Título</span>
            <input value={titulo} maxLength={200} required autoFocus onChange={(e) => setTitulo(e.target.value)} />
          </label>
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Demanda</span>
            <select
              value={documentoId === null ? '' : String(documentoId)}
              onChange={(e) => setDocumentoId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Avulsa (sem demanda)</option>
              {documentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.demanda}
                </option>
              ))}
            </select>
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
          <label className="campo escopo-form-largo">
            <span className="campo-nome">Notas de andamento (o que foi feito, onde, o que bloqueia)</span>
            <textarea rows={3} value={notas} maxLength={4000} onChange={(e) => setNotas(e.target.value)} />
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

function CartaoDemanda({
  doc,
  ativa,
  progresso,
  abrirResumo,
  pastaSugerida,
  toast,
  onVerQuadro,
  onVer,
  onAnalisar,
  onRemover,
  onRenomear,
  onCompartilhar,
}: {
  doc: DocumentoEscopo;
  ativa: boolean;
  progresso: { total: number; feitas: number };
  abrirResumo: boolean;
  pastaSugerida: string;
  toast: Avisar;
  onVerQuadro: () => void;
  onVer: () => void;
  onAnalisar: () => void;
  onRemover: () => void;
  onRenomear: (nome: string) => Promise<boolean>;
  onCompartilhar: (pasta: string, nome?: string, criarPastaTarefas?: boolean, ignorarNoGit?: boolean) => Promise<boolean>;
}) {
  const [nome, setNome] = useState<string | null>(null);
  const [pasta, setPasta] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [criarPastaTarefas, setCriarPastaTarefas] = useState(true);
  const [ignorarNoGit, setIgnorarNoGit] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const situacao = doc.compartilhamento;

  function abrirFormulario(): void {
    if (pasta !== null) {
      setPasta(null);
      return;
    }
    setPasta(doc.compartilharEm || pastaSugerida);
    setNomeArquivo(doc.compartilharNome || nomeSugerido(doc.demanda));
    setCriarPastaTarefas(true);
    setIgnorarNoGit(true);
  }

  // Prévia do caminho final: é o que a pessoa vai colar na IA, melhor ver antes de salvar.
  const destino = pasta?.trim()
    ? `${juntar(
        criarPastaTarefas && !/[\\/]tarefas[\\/]?$/i.test(pasta.trim()) ? juntar(pasta.trim(), 'Tarefas') : pasta.trim(),
        nomeArquivo.trim() ? (/\.json$/i.test(nomeArquivo.trim()) ? nomeArquivo.trim() : `${nomeArquivo.trim()}.json`) : '…',
      )}`
    : '';

  async function salvarNome(): Promise<void> {
    if (nome === null) return;
    if (!nome.trim() || nome.trim() === doc.demanda) {
      setNome(null);
      return;
    }
    if (await onRenomear(nome)) setNome(null);
  }

  async function ligar(): Promise<void> {
    if (!pasta?.trim() || !nomeArquivo.trim()) return;
    setSalvando(true);
    try {
      if (await onCompartilhar(pasta.trim(), nomeArquivo.trim(), criarPastaTarefas, ignorarNoGit)) setPasta(null);
    } finally {
      setSalvando(false);
    }
  }

  async function desligar(): Promise<void> {
    setSalvando(true);
    try {
      if (await onCompartilhar('')) setPasta(null);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <article className={`escopo-doc status-${doc.status} ${ativa ? 'ativa' : ''}`}>
      <div className="escopo-doc-linha">
        {nome === null ? (
          <button
            className="escopo-doc-nome"
            type="button"
            title={ativa ? 'Mostrar todas as demandas no quadro' : 'Mostrar só esta demanda no quadro'}
            onClick={onVerQuadro}
          >
            {doc.demanda}
          </button>
        ) : (
          <input
            className="escopo-doc-renomear"
            value={nome}
            maxLength={120}
            autoFocus
            aria-label="Nome da demanda"
            onChange={(e) => setNome(e.target.value)}
            onBlur={() => void salvarNome()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void salvarNome();
              if (e.key === 'Escape') setNome(null);
            }}
          />
        )}
        <button className="btn-icone" type="button" title="Renomear demanda" onClick={() => setNome(doc.demanda)}>
          ✎
        </button>
        <span className="escopo-doc-meta">
          {progresso.feitas}/{progresso.total} concluída(s)
        </span>
        <span className={`escopo-status ${doc.status}`}>{STATUS_DOC[doc.status]}</span>
        {doc.compartilharEm && <span className="escopo-status compartilhado">compartilhada com IA</span>}
        <span className="escopo-sep" />
        <button className="btn tiny ghost" type="button" onClick={onVer}>
          Ver documento
        </button>
        <button className="btn tiny" type="button" disabled={doc.status === 'analisando'} onClick={onAnalisar}>
          {doc.status === 'analisado' || doc.status === 'falhou' ? 'Reanalisar' : 'Analisar'}
        </button>
        <button
          className="btn tiny ghost"
          type="button"
          onClick={abrirFormulario}
          title="Mantém um arquivo JSON com as tarefas que outras IAs leem e atualizam"
        >
          {doc.compartilharEm ? 'Compartilhamento' : 'Compartilhar com IA'}
        </button>
        <button
          className="btn tiny ghost danger"
          type="button"
          disabled={doc.status === 'analisando'}
          onClick={onRemover}
          title="Remove o documento; as tarefas continuam no quadro, como avulsas"
        >
          Remover
        </button>
      </div>
      <span className="escopo-doc-meta">
        {doc.nome} · {doc.tipo.toUpperCase()} · {tamanho(doc.bytes)} · enviado{' '}
        {new Date(doc.enviadoEm).toLocaleString('pt-BR')}
      </span>

      {doc.status === 'analisando' && (
        <p className="painel-nota">A IA está lendo o documento — escopos grandes levam alguns minutos.</p>
      )}
      {doc.status === 'falhou' && doc.erro && <p className="escopo-erro">{doc.erro}</p>}

      {situacao && (
        <div className="escopo-compartilhado">
          <div className="escopo-doc-linha">
            <code className="escopo-caminho">{situacao.arquivo}</code>
            <span className="escopo-sep" />
            <button
              className="btn tiny ghost"
              type="button"
              onClick={() => void copiar(situacao.arquivo, toast, 'Caminho')}
            >
              Copiar caminho
            </button>
            <button
              className="btn tiny"
              type="button"
              title="Texto pronto para colar no Claude, Codex, Copilot…"
              onClick={() => void copiar(instrucaoParaIa(situacao.arquivo), toast, 'Instrução para a IA')}
            >
              Copiar instrução para a IA
            </button>
          </div>
          <span className="escopo-doc-meta">
            Sincronizado às {hora(situacao.sincronizadoEm)}
            {situacao.importadoEm &&
              ` · ${situacao.mudancasImportadas} mudança(s) recebida(s) da IA às ${hora(situacao.importadoEm)}`}
          </span>
          {situacao.erro && <p className="escopo-erro">{situacao.erro}</p>}
        </div>
      )}

      {pasta !== null && (
        <div className="escopo-compartilhar-form">
          <p className="painel-nota">
            O hub mantém um JSON com as tarefas desta demanda e o reescreve a cada mudança no quadro (tarefa criada,
            editada, movida ou excluída). Qualquer IA que edite arquivos (Claude Code, Codex, Copilot…) lê ali o que
            fazer e muda <code>estado</code> e <code>notas</code> de cada tarefa — o quadro acompanha em poucos
            segundos. Com a subpasta <code>Tarefas</code>, os arquivos de todas as demandas ficam juntos.
          </p>
          <label className="campo">
            <span className="campo-nome">Pasta (o repositório do cliente costuma ser o melhor lugar)</span>
            <input
              className="escopo-pasta"
              value={pasta}
              placeholder="C:\caminho\do\repositorio"
              onChange={(e) => setPasta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ligar();
              }}
            />
          </label>
          <label className="escopo-check">
            <input
              type="checkbox"
              checked={criarPastaTarefas}
              onChange={(e) => setCriarPastaTarefas(e.target.checked)}
            />
            Criar (ou usar) a subpasta <code>Tarefas</code> dentro dela
          </label>
          <label className="campo">
            <span className="campo-nome">Nome do arquivo</span>
            <input
              className="escopo-pasta"
              value={nomeArquivo}
              maxLength={105}
              placeholder="portal-do-cliente.json"
              onChange={(e) => setNomeArquivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ligar();
              }}
            />
          </label>
          <label className="escopo-check" title="Sem isto o arquivo entra nos commits (inclusive do git-autosync) a cada cartão movido">
            <input type="checkbox" checked={ignorarNoGit} onChange={(e) => setIgnorarNoGit(e.target.checked)} />
            Adicionar {criarPastaTarefas ? <>a pasta <code>Tarefas</code></> : 'o arquivo'} ao <code>.gitignore</code> do
            repositório
          </label>
          {destino && (
            <span className="escopo-doc-meta">
              Será gravado em <code className="escopo-caminho">{destino}</code>
            </span>
          )}
          <div className="escopo-doc-linha">
            <button
              className="btn tiny"
              type="button"
              disabled={salvando || !pasta.trim() || !nomeArquivo.trim()}
              onClick={() => void ligar()}
            >
              {doc.compartilharEm ? 'Salvar' : 'Compartilhar'}
            </button>
            {doc.compartilharEm && (
              <button
                className="btn tiny ghost danger"
                type="button"
                disabled={salvando}
                title="Para de sincronizar e apaga o arquivo"
                onClick={() => void desligar()}
              >
                Parar de compartilhar
              </button>
            )}
            <button className="btn tiny ghost" type="button" onClick={() => setPasta(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {doc.resumo && (
        <details className="escopo-resumo" open={abrirResumo}>
          <summary>Resumo da análise</summary>
          <p>{doc.resumo}</p>
        </details>
      )}
    </article>
  );
}

/**
 * O documento de escopo dentro do hub. PDF o navegador (e o shell Electron) desenha
 * sozinho; .md/.txt aparecem como texto; .docx pelo texto extraído — reproduzir a
 * formatação do Word pediria uma biblioteca inteira, e o original fica a um clique.
 */
function VisorDocumento({ doc, onFechar }: { doc: DocumentoEscopo; onFechar: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const url = `/api/escopo/documentos/${doc.id}/arquivo`;

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (doc.tipo === 'pdf') return;
    let vivo = true;
    void requisitar<{ texto: string }>(`/api/escopo/documentos/${doc.id}/texto`).then(({ ok, body }) => {
      if (!vivo) return;
      if (ok) setTexto(body.texto ?? '');
      else setErro(body.error ?? 'não consegui ler o documento');
    });
    return () => {
      vivo = false;
    };
  }, [doc.id, doc.tipo]);

  return (
    <dialog className="modal modal-largo escopo-visor" ref={dialogRef} onClose={onFechar}>
      <header className="modal-head escopo-visor-head">
        <div>
          <h2>{doc.demanda}</h2>
          <p>
            {doc.nome}
            {doc.tipo === 'docx' && ' · prévia em texto, sem a formatação do Word'}
          </p>
        </div>
        <span className="escopo-sep" />
        <a className="btn tiny ghost" href={`${url}?baixar=1`} download={doc.nome}>
          Baixar original
        </a>
        <button className="btn tiny ghost" type="button" onClick={() => dialogRef.current?.close()}>
          Fechar
        </button>
      </header>
      <div className="escopo-visor-corpo">
        {doc.tipo === 'pdf' ? (
          <iframe className="escopo-visor-pdf" src={url} title={doc.nome} />
        ) : erro ? (
          <p className="escopo-erro">{erro}</p>
        ) : texto === null ? (
          <p className="painel-nota">Carregando…</p>
        ) : texto.trim() ? (
          <pre className="escopo-visor-texto">{texto}</pre>
        ) : (
          <p className="painel-nota">O documento não tem texto legível — use "Baixar original".</p>
        )}
      </div>
    </dialog>
  );
}
