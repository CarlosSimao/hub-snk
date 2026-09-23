import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { enviar } from '../../lib/api.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

interface Props {
  /** Origin da base (https://cliente...). É por ele que o shell acha a aba logada. */
  origin: string;
  titulo: string;
  aberto: boolean;
  onFechar: () => void;
  /** Opcional: o modal é aberto de dentro da linha da base, que não carrega o avisador. */
  toast?: Avisar | undefined;
}

interface RespostaLog {
  linhas: string[];
  novoOffset: number;
  actionId: string;
}

/**
 * Teto de linhas por chamada.
 *
 * NÃO baixar sem entender: no módulo Java o `maxLinhas` é teto de CORTE, não tamanho de
 * leitura. O servidor lê um bloco fixo de ~512 KB e avança o offset o bloco inteiro,
 * devolvendo no máximo `maxLinhas` dele — pedir pouco descarta o resto em silêncio
 * (medido: 50 pediu, 3.680 linhas existiam no bloco, 3.630 sumiram). 20.000 cobre o
 * bloco até em log de linhas curtas.
 */
const MAX_LINHAS = 20_000;

/** O buffer da tela; acima disto as linhas mais velhas saem em lote. */
const BUFFER_MAX = 20_000;
const LOTE_DESCARTE = 4_000;

const INTERVALOS = [2, 3, 5, 10, 30];

/** Cabeçalho de linha do WildFly: `2026-09-22 23:05:46,123 ERROR [logger] (thread) msg`. */
const CABECALHO = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),(\d{3})\s+([A-Z]+)\b/;

const NIVEIS = [
  { id: 'ERROR', rotulo: 'Erro' },
  { id: 'WARN', rotulo: 'Aviso' },
  { id: 'INFO', rotulo: 'Info' },
  { id: 'DEBUG', rotulo: 'Debug' },
  { id: 'TRACE', rotulo: 'Trace' },
  { id: 'OUTRO', rotulo: 'Outro' },
] as const;

interface Linha {
  texto: string;
  /** Epoch em ms, ou `null` quando a linha não tem carimbo próprio nem herdou um. */
  ts: number | null;
  nivel: string;
  /** `false` em linha de continuação (stacktrace) — ela herda carimbo e nível de cima. */
  propria: boolean;
}

/** `FATAL`/`SEVERE` entram como erro; o resto que não é nível conhecido vira `OUTRO`. */
function normalizarNivel(bruto: string): string {
  if (bruto === 'FATAL' || bruto === 'SEVERE') return 'ERROR';
  return (NIVEIS as readonly { id: string }[]).some((n) => n.id === bruto) ? bruto : 'OUTRO';
}

/**
 * Converte o texto cru em linhas com carimbo e nível.
 *
 * Linha sem cabeçalho é continuação (o `at ...` do stacktrace) e HERDA o carimbo e o
 * nível da anterior. Sem isso, filtrar por nível ou por data jogaria fora justamente o
 * corpo da exceção, que é o que se quer ler.
 */
function parsear(textos: string[], anterior: Linha | undefined): Linha[] {
  const saida: Linha[] = [];
  let ultimoTs = anterior?.ts ?? null;
  let ultimoNivel = anterior?.nivel ?? 'OUTRO';

  for (const texto of textos) {
    const m = CABECALHO.exec(texto);
    if (m) {
      const [, a, mes, d, h, min, s, ms, nivelBruto] = m;
      const data = new Date(
        Number(a), Number(mes) - 1, Number(d),
        Number(h), Number(min), Number(s), Number(ms),
      );
      ultimoTs = data.getTime();
      ultimoNivel = normalizarNivel(String(nivelBruto));
      saida.push({ texto, ts: ultimoTs, nivel: ultimoNivel, propria: true });
      continue;
    }
    saida.push({ texto, ts: ultimoTs, nivel: ultimoNivel, propria: false });
  }
  return saida;
}

/** `Date` -> `YYYY-MM-DDTHH:mm`, que é o que `<input type="datetime-local">` aceita. */
function paraInputLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatarMomento(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR');
}

/**
 * Monitor do `server.log` da base, dentro do hub.
 *
 * A leitura sai da aba já logada daquela base, pelo shell desktop (ver
 * `src/routesServerLog.ts`). Não há credencial guardada nem nada instalado por arquivo no
 * cliente: o que existe do outro lado é o módulo Java `serverlog`, importado pela tela do
 * Sankhya, e é ele que expõe a leitura por `offset`.
 */
export function ModalMonitorLog({ origin, titulo, aberto, onFechar, toast }: Props) {
  const avisar: Avisar = toast ?? (() => undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [filtro, setFiltro] = useState('');
  const [niveisOcultos, setNiveisOcultos] = useState<Set<string>>(new Set());
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [quebrar, setQuebrar] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [monitorando, setMonitorando] = useState(false);
  const [intervalo, setIntervalo] = useState(5);
  const [autoScroll, setAutoScroll] = useState(true);
  const [ultima, setUltima] = useState('');

  // Em ref, não em state: o laço de polling lê os dois a cada volta e um `setState` aqui
  // reagendaria o efeito inteiro a cada leitura.
  const offsetRef = useRef(0);
  const actionIdRef = useRef('');
  const monitorandoRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  const ler = useCallback(
    async (offset: number): Promise<RespostaLog | null> => {
      const { ok, body } = await enviar<RespostaLog>('/api/serverlog/ler', {
        origin,
        offset,
        maxLinhas: MAX_LINHAS,
        ...(actionIdRef.current ? { actionId: actionIdRef.current } : {}),
      });
      if (!ok) {
        setErro(body.error ?? 'não consegui ler o log');
        return null;
      }
      setErro('');
      const resposta = body as unknown as RespostaLog;
      if (resposta.actionId) actionIdRef.current = resposta.actionId;
      offsetRef.current = resposta.novoOffset;
      setUltima(new Date().toLocaleTimeString('pt-BR'));
      return resposta;
    },
    [origin],
  );

  const acrescentar = useCallback((novas: string[]) => {
    if (!novas.length) return;
    setLinhas((atuais) => {
      const juntas = atuais.concat(parsear(novas, atuais[atuais.length - 1]));
      return juntas.length > BUFFER_MAX ? juntas.slice(juntas.length - BUFFER_MAX + LOTE_DESCARTE) : juntas;
    });
  }, []);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregando(true);
    setLinhas([]);
    setErro('');
    setDe('');
    setAte('');
    offsetRef.current = 0;
    actionIdRef.current = '';
    void (async () => {
      const r = await ler(0);
      if (cancelado || !r) {
        setCarregando(false);
        return;
      }
      acrescentar(r.linhas);
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [aberto, ler, acrescentar]);

  // Polling. Encadeado por `setTimeout` e não `setInterval`: uma leitura lenta não pode
  // sobrepor a próxima, senão duas chamadas concorrentes avançam o offset uma por cima
  // da outra e o log perde linhas sem erro nenhum aparecer.
  useEffect(() => {
    monitorandoRef.current = monitorando;
    if (!aberto || !monitorando) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelado = false;

    const rodar = async () => {
      if (cancelado || !monitorandoRef.current) return;
      const r = await ler(offsetRef.current);
      if (cancelado) return;
      if (r) acrescentar(r.linhas);
      if (!cancelado && monitorandoRef.current) timer = setTimeout(() => void rodar(), intervalo * 1000);
    };

    timer = setTimeout(() => void rodar(), intervalo * 1000);
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [aberto, monitorando, intervalo, ler, acrescentar]);

  useEffect(() => {
    if (autoScroll) fimRef.current?.scrollIntoView({ block: 'end' });
  }, [linhas, autoScroll]);

  /** Primeiro e último carimbo presentes no buffer — é o período que a tela realmente tem. */
  const periodo = useMemo(() => {
    let min: number | null = null;
    let max: number | null = null;
    for (const l of linhas) {
      if (l.ts === null) continue;
      if (min === null || l.ts < min) min = l.ts;
      if (max === null || l.ts > max) max = l.ts;
    }
    return { min, max };
  }, [linhas]);

  const contagem = useMemo(() => {
    const mapa: Record<string, number> = {};
    // Só linhas com cabeçalho próprio: contar continuação de stacktrace inflaria o número
    // de erros pelo tamanho da pilha, não pela quantidade de ocorrências.
    for (const l of linhas) if (l.propria) mapa[l.nivel] = (mapa[l.nivel] ?? 0) + 1;
    return mapa;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    const deMs = de ? new Date(de).getTime() : null;
    const ateMs = ate ? new Date(ate).getTime() : null;
    return linhas.filter((l) => {
      if (niveisOcultos.has(l.nivel)) return false;
      if (deMs !== null && (l.ts === null || l.ts < deMs)) return false;
      if (ateMs !== null && (l.ts === null || l.ts > ateMs)) return false;
      if (texto && !l.texto.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [linhas, filtro, niveisOcultos, de, ate]);

  function alternarNivel(id: string): void {
    setNiveisOcultos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  async function lerAgora(): Promise<void> {
    setCarregando(true);
    const r = await ler(offsetRef.current);
    if (r) {
      acrescentar(r.linhas);
      if (!r.linhas.length) avisar('Nada novo no log', 'ok');
    }
    setCarregando(false);
  }

  /**
   * Salva o que está na tela. Para o monitoramento antes: o arquivo tem que corresponder
   * ao que o usuário viu no instante do clique, e não a um buffer que seguiu crescendo
   * enquanto o download era montado.
   */
  function salvar(): void {
    setMonitorando(false);
    if (!visiveis.length) {
      avisar('Nada para salvar', 'err');
      return;
    }
    const cabecalho = [
      `# Monitor de log — ${origin}`,
      `# gerado em ${new Date().toLocaleString('pt-BR')} | ${visiveis.length} linha(s)`,
      periodo.min !== null && periodo.max !== null
        ? `# periodo no buffer: ${formatarMomento(periodo.min)} ate ${formatarMomento(periodo.max)}`
        : '# periodo no buffer: sem carimbo de data nas linhas',
      filtro.trim() ? `# filtro de texto: ${filtro.trim()}` : '',
      niveisOcultos.size ? `# niveis ocultos: ${[...niveisOcultos].join(', ')}` : '',
      de || ate ? `# recorte: ${de || 'inicio'} ate ${ate || 'fim'}` : '',
      '',
    ].filter(Boolean);

    const conteudo = cabecalho.concat(visiveis.map((l) => l.texto)).join('\r\n');
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let host = origin;
    try {
      host = new URL(origin).hostname;
    } catch {
      /* origin já validado antes de chegar aqui; no pior caso vira nome de arquivo feio */
    }
    a.href = url;
    a.download = `server-log-${host}-${carimbo}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    avisar('Log salvo', 'ok');
  }

  function copiar(): void {
    void navigator.clipboard
      .writeText(visiveis.map((l) => l.texto).join('\n'))
      .then(() => avisar('Log copiado', 'ok'))
      .catch(() => avisar('Não consegui copiar', 'err'));
  }

  function limparRecorte(): void {
    setDe('');
    setAte('');
    setFiltro('');
    setNiveisOcultos(new Set());
  }

  return (
    <dialog className="modal modal-log" ref={dialogRef} onClose={onFechar}>
      <header className="modal-head">
        <h2>Monitor de log — {titulo}</h2>
        <p>
          Lido do <code>server.log</code> pela aba logada da base, via módulo Java <code>serverlog</code>.
        </p>
      </header>

      <div className="modal-body">
        <div className="log-barra">
          <input
            type="search"
            placeholder="Filtrar linhas…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
          <button className="btn tiny" type="button" disabled={carregando} onClick={() => void lerAgora()}>
            {carregando ? 'Lendo…' : 'Ler agora'}
          </button>
          <button
            className={`btn tiny ${monitorando ? 'danger' : ''}`}
            type="button"
            onClick={() => setMonitorando((v) => !v)}
          >
            {monitorando ? 'Parar' : 'Monitorar'}
          </button>
          <label className="log-campo">
            <span>a cada</span>
            <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))}>
              {INTERVALOS.map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </label>
          <span className="log-sep" />
          <button className="btn tiny" type="button" onClick={salvar}>
            Salvar log
          </button>
          <button className="btn tiny ghost" type="button" onClick={copiar}>
            Copiar
          </button>
          <button className="btn tiny ghost" type="button" onClick={() => setLinhas([])}>
            Limpar
          </button>
        </div>

        <div className="log-barra log-barra-2">
          <div className="log-niveis">
            {NIVEIS.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`log-chip log-chip-${n.id.toLowerCase()} ${niveisOcultos.has(n.id) ? 'off' : ''}`}
                onClick={() => alternarNivel(n.id)}
                title={niveisOcultos.has(n.id) ? 'Mostrar' : 'Ocultar'}
              >
                {n.rotulo} <b>{contagem[n.id] ?? 0}</b>
              </button>
            ))}
          </div>

          <label className="log-campo">
            <span>de</span>
            <input
              type="datetime-local"
              value={de}
              min={periodo.min !== null ? paraInputLocal(periodo.min) : undefined}
              max={periodo.max !== null ? paraInputLocal(periodo.max) : undefined}
              onChange={(e) => setDe(e.target.value)}
            />
          </label>
          <label className="log-campo">
            <span>até</span>
            <input
              type="datetime-local"
              value={ate}
              min={periodo.min !== null ? paraInputLocal(periodo.min) : undefined}
              max={periodo.max !== null ? paraInputLocal(periodo.max) : undefined}
              onChange={(e) => setAte(e.target.value)}
            />
          </label>
          <button
            className="btn tiny ghost"
            type="button"
            disabled={periodo.min === null}
            onClick={() => {
              if (periodo.min !== null) setDe(paraInputLocal(periodo.min));
              if (periodo.max !== null) setAte(paraInputLocal(periodo.max));
            }}
          >
            Período todo
          </button>
          <button className="btn tiny ghost" type="button" onClick={limparRecorte}>
            Limpar filtros
          </button>

          <span className="log-sep" />
          <label className="log-campo">
            <input type="checkbox" checked={quebrar} onChange={(e) => setQuebrar(e.target.checked)} />
            <span>quebrar linha</span>
          </label>
          <label className="log-campo">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            <span>rolar</span>
          </label>
        </div>

        {periodo.min !== null && periodo.max !== null && (
          <p className="log-periodo">
            No buffer: <strong>{formatarMomento(periodo.min)}</strong> até{' '}
            <strong>{formatarMomento(periodo.max)}</strong>
          </p>
        )}

        {erro && <p className="log-erro">{erro}</p>}

        <div className={`log-conteudo ${quebrar ? 'quebra' : ''}`}>
          {visiveis.length === 0 && !carregando && <p className="log-vazio">Nenhuma linha.</p>}
          {visiveis.map((l, i) => (
            <div key={`${i}-${l.texto.slice(0, 24)}`} className={`log-linha log-${l.nivel.toLowerCase()}`}>
              {l.texto}
            </div>
          ))}
          <div ref={fimRef} />
        </div>
      </div>

      <footer className="modal-foot">
        <p className="modal-nota">
          {visiveis.length} de {linhas.length} linha(s)
          {ultima ? ` · atualizado ${ultima}` : ''}
          {monitorando ? ` · monitorando a cada ${intervalo}s` : ''}
        </p>
        <div className="modal-acoes">
          <button className="btn" type="button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </footer>
    </dialog>
  );
}
