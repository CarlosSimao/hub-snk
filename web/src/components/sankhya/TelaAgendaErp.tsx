import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { EstadoAgendaRecursos, RecursoComTotal } from '../../types.ts';
import { enviar, requisitar } from '../../lib/api.ts';
import { relativeTime } from '../../lib/format.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

/**
 * Carga da Agenda de Recursos por colagem manual.
 *
 * Não é preguiça de automatizar: a ACL do `service.sbr` nega a chamada direta para este
 * usuário, então enquanto o admin do Sankhya não liberar o serviço não há como o hub
 * buscar sozinho. O passo a passo fica na tela porque é feito de vez em quando, e
 * ninguém lembra de cabeça em qual requisição olhar.
 */
export function TelaAgendaErp({ toast }: { toast: Avisar }) {
  const [estado, setEstado] = useState<EstadoAgendaRecursos | null>(null);
  const [recursos, setRecursos] = useState<RecursoComTotal[]>([]);
  const [importando, setImportando] = useState(false);

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

  return (
    <section className="painel">
      <p className="painel-nota">
        Esta tela é o Sankhya ERP, não o Experience. A carga é manual porque a ACL do{' '}
        <code>service.sbr</code> nega a chamada direta para o seu usuário — enquanto o admin
        não liberar <code>AgendaRecursosSP.carregarAgendas</code>, o hub não consegue buscar
        sozinho.
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
              <h2>Importar captura</h2>
              <p>Substitui o snapshot inteiro — não acumula com o anterior.</p>
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
    </section>
  );
}
