import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { EstadoAgendaRecursos, RecursoComTotal } from '../../types.ts';
import { enviar, requisitar } from '../../lib/api.ts';
import { relativeTime } from '../../lib/format.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

/** Hoje e daqui a N dias, em `YYYY-MM-DD` no fuso local. */
function emDias(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${String(data.getDate()).padStart(2, '0')}`;
}

/**
 * Carga da Agenda de Recursos.
 *
 * O caminho principal é automático: o hub chama o serviço de dentro da janela de
 * navegador dele, já logada. A ACL do `service.sbr` nega essa chamada quando ela vem de
 * fora, mas a sessão de tela passa — é o mesmo motivo pelo qual a automação de UI
 * funciona. A colagem manual continua como reserva para quando a janela não está logada.
 */
export function TelaAgendaErp({ toast }: { toast: Avisar }) {
  const [estado, setEstado] = useState<EstadoAgendaRecursos | null>(null);
  const [recursos, setRecursos] = useState<RecursoComTotal[]>([]);
  const [importando, setImportando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [de, setDe] = useState(() => emDias(-30));
  const [ate, setAte] = useState(() => emDias(60));
  // Só "Buscar do Sankhya" precisa aparecer no dia a dia — o resto (snapshot lido,
  // colagem manual) é reserva/diagnóstico, então fica recolhido por padrão.
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  const recarregar = useCallback(async () => {
    const [snapshot, lista] = await Promise.all([
      requisitar<EstadoAgendaRecursos>('/api/agenda'),
      requisitar<{ recursos: RecursoComTotal[] }>('/api/agenda/recursos'),
    ]);
    if (snapshot.ok) setEstado(snapshot.body as EstadoAgendaRecursos);
    if (lista.ok) setRecursos(lista.body.recursos ?? []);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const importar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formulario = event.currentTarget;
    const conteudo = String(new FormData(formulario).get('conteudo') ?? '');

    setImportando(true);
    try {
      const { ok, body } = await enviar<EstadoAgendaRecursos>('/api/agenda/importar', { conteudo });
      if (!ok) {
        toast('Não consegui importar', 'err', body.error);
        return;
      }
      formulario.reset();
      await recarregar();
      toast(`Importado: ${body.recursos} recurso(s) e ${body.eventos} evento(s).`, 'ok');
    } finally {
      setImportando(false);
    }
  };

  const buscar = async () => {
    setBuscando(true);
    try {
      const { ok, body } = await enviar<EstadoAgendaRecursos>('/api/agenda/buscar', { de, ate });
      if (!ok) {
        toast('Não consegui buscar do Sankhya', 'err', body.error);
        return;
      }
      await recarregar();
      toast(`Buscado: ${body.recursos} recurso(s) e ${body.eventos} evento(s).`, 'ok');
    } finally {
      setBuscando(false);
    }
  };

  return (
    <section className="painel">
      <article className="card">
        <div className="detail-head">
          <div className="card-title">
            <h2>Buscar do Sankhya</h2>
            <p>Substitui o snapshot inteiro — não acumula com o anterior.</p>
          </div>
        </div>

        <div className="form-campos">
          <div className="periodo">
            <label className="campo">
              <span className="campo-nome">De</span>
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </label>
            <label className="campo">
              <span className="campo-nome">Até</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-acoes">
          <span className="modal-acoes-spacer" />
          <button className="btn tiny" type="button" disabled={buscando} onClick={() => void buscar()}>
            {buscando ? 'Buscando…' : 'Buscar agora'}
          </button>
        </div>
      </article>

      <div className="agenda-erp-avancado">
        <button
          className="btn tiny ghost"
          type="button"
          onClick={() => setAvancadoAberto((aberto) => !aberto)}
        >
          {avancadoAberto ? 'Ocultar' : 'Mais opções'} — snapshot lido e captura manual
        </button>

        {avancadoAberto && (
          <>
            <p className="painel-nota">
              Esta tela é o Sankhya ERP, não o Experience. O hub busca a agenda chamando o
              serviço de dentro da janela de navegador dele — por isso ela precisa estar
              logada no ERP (<strong>Credenciais › Abrir janela de login</strong>).
            </p>

            <article className="card">
              <div className="detail-head">
                <div className="card-title">
                  <h2>
                    Snapshot atual
                    {estado?.importadoEm ? (
                      <span className="selo ok">{estado.eventos} eventos</span>
                    ) : (
                      <span className="selo falta">nunca importado</span>
                    )}
                  </h2>
                  <p>
                    {estado?.importadoEm
                      ? `${estado.recursos} recurso(s) · capturado ${relativeTime(estado.importadoEm)}`
                      : 'Cole a resposta capturada abaixo para começar.'}
                  </p>
                </div>
              </div>

              {recursos.length > 0 && (
                <div className="form-campos">
                  {recursos.map((recurso) => (
                    <div className="linha-agenda" key={recurso.id}>
                      {/* A cor é a mesma que o Sankhya usa para o consultor na timeline. */}
                      <i
                        className="ponto-recurso"
                        style={recurso.corHex ? { background: recurso.corHex } : undefined}
                      />
                      <span className="linha-titulo">{recurso.nomeusu}</span>
                      <span className="linha-meta">
                        {recurso.descrcargo || '—'} · {recurso.totalEventos} evento(s)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="card">
              <form onSubmit={(e) => void importar(e)}>
                <div className="detail-head">
                  <div className="card-title">
                    <h2>Colar captura manual</h2>
                    <p>Reserva, para quando a janela do hub não estiver logada no ERP.</p>
                  </div>
                </div>

                <div className="form-campos">
                  <ol className="passos">
                    <li>
                      Abra a <strong>Agenda de Recursos</strong> no Sankhya, já logado.
                    </li>
                    <li>
                      <kbd>F12</kbd> → aba <strong>Network</strong> → filtro <strong>Fetch/XHR</strong>.
                    </li>
                    <li>
                      <kbd>F5</kbd> para recarregar a tela com o capturador ligado.
                    </li>
                    <li>
                      Ache a requisição a <code>service.sbr</code> com{' '}
                      <code>AgendaRecursosSP.carregarAgendas</code> — costuma ser a de maior{' '}
                      <strong>Size</strong>.
                    </li>
                    <li>
                      Aba <strong>Response</strong> → selecionar tudo → copiar → colar aqui.
                    </li>
                  </ol>

                  <label className="campo">
                    <span className="campo-nome">JSON capturado</span>
                    <textarea
                      name="conteudo"
                      rows={8}
                      required
                      spellCheck={false}
                      placeholder='{"status":"1","serviceName":"AgendaRecursosSP.carregarAgendas",...}'
                    />
                  </label>
                </div>

                <div className="form-acoes">
                  <span className="modal-acoes-spacer" />
                  <button className="btn tiny" type="submit" disabled={importando}>
                    Importar
                  </button>
                </div>
              </form>
            </article>
          </>
        )}
      </div>
    </section>
  );
}
