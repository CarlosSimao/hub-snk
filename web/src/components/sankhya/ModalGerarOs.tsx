import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OrdemCriada, PreparoOrdem, TarefaExperience } from '../../types.ts';
import { enviar } from '../../lib/api.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

interface Props {
  clienteId: number;
  dia: string;
  tarefas: TarefaExperience[];
  aberto: boolean;
  onFechar: () => void;
  onCriada: () => void;
  toast: Avisar;
}

/**
 * O modal que lança a OS.
 *
 * Duas coisas que ele NÃO faz por conta própria: mandar o e-mail de aprovação (a caixa
 * nasce desmarcada) e submeter sem confirmação. Criar OS é visível para o cliente e o
 * hub não desfaz — o caminho seguro tem que ser o caminho preguiçoso.
 */
export function ModalGerarOs({
  clienteId,
  dia,
  tarefas,
  aberto,
  onFechar,
  onCriada,
  toast,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [preparo, setPreparo] = useState<PreparoOrdem | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviarAprovacao, setEnviarAprovacao] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    let cancelado = false;
    setCarregando(true);
    setErro(null);
    setPreparo(null);
    setEnviarAprovacao(false);

    void (async () => {
      const { ok, body } = await enviar<PreparoOrdem>('/api/experience/os/preparar', {
        clienteId,
        tarefaIds: tarefas.map((t) => t.id),
      });
      if (cancelado) return;

      if (ok) setPreparo(body as PreparoOrdem);
      else setErro(body.error ?? 'não consegui preparar a OS');
      setCarregando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [aberto, clienteId, tarefas]);

  const aoSubmeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    const horaInicio = String(dados.get('horaInicio') ?? '');
    const horaFim = String(dados.get('horaFim') ?? '');

    const resumo = [
      `Lançar OS de ${dia.split('-').reverse().join('/')}, das ${horaInicio} às ${horaFim}.`,
      enviarAprovacao
        ? 'O cliente VAI RECEBER e-mail pedindo aprovação. Isso não tem desfazer pelo hub.'
        : 'A OS fica lançada SEM aceite e sem e-mail.',
      'Confirmar?',
    ].join('\n\n');
    if (!window.confirm(resumo)) return;

    setSalvando(true);
    try {
      const { ok, body } = await enviar<OrdemCriada>('/api/experience/os', {
        clienteId,
        tarefaIds: tarefas.map((t) => t.id),
        dia,
        horaInicio,
        horaFim,
        intervalo: String(dados.get('intervalo') ?? '01:00'),
        observacoes: String(dados.get('observacoes') ?? ''),
        notas: '',
        enviarParaAprovacao: enviarAprovacao,
      });

      if (!ok) {
        toast('Não consegui lançar a OS', 'err', body.error);
        return;
      }

      const criada = body as OrdemCriada;
      toast(
        `OS ${criada.numos || criada.orderId} lançada` +
          (criada.emailEnviado ? ' e enviada para aprovação.' : ' (sem aceite).'),
        'ok',
      );
      onCriada();
      onFechar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <dialog className="modal modal-largo" ref={dialogRef} onClose={onFechar}>
      <form onSubmit={(e) => void aoSubmeter(e)}>
        <header className="modal-head">
          <div>
            <h2>Gerar OS — {dia.split('-').reverse().join('/')}</h2>
            <p>
              {tarefas.length} tarefa(s): {tarefas.map((t) => t.procedimento).join(' · ')}
            </p>
          </div>
          <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          {carregando && <p className="detail-empty">Carregando dados da OS…</p>}
          {erro && (
            <div className="warning">
              <span>⚠</span>
              <span>{erro}</span>
            </div>
          )}

          {preparo && (
            <>
              {preparo.avisoValidacao && (
                <div className="warning">
                  <span>⚠</span>
                  <span>
                    A pré-validação da Experience falhou: <em>{preparo.avisoValidacao}</em>
                    <br />
                    Não impede lançar — quem valida de verdade é o lançamento —, mas vale
                    conferir pela tela da Experience antes.
                  </span>
                </div>
              )}

              {preparo.ordensExistentes.length > 0 && (
                <div className="warning">
                  <span>⚠</span>
                  <span>
                    Já existe(m) {preparo.ordensExistentes.length} OS para esta combinação de
                    processo e etapa. Confira antes de lançar outra.
                  </span>
                </div>
              )}

              <div className="periodo">
                <label className="campo">
                  <span className="campo-nome">Hora inicial</span>
                  <input type="time" name="horaInicio" defaultValue="08:00" required />
                </label>
                <label className="campo">
                  <span className="campo-nome">Hora final</span>
                  <input type="time" name="horaFim" defaultValue="18:00" required />
                </label>
                <label className="campo">
                  <span className="campo-nome">Intervalo</span>
                  <input type="time" name="intervalo" defaultValue="01:00" required />
                </label>
              </div>

              <label className="campo">
                <span className="campo-nome">Tarefas realizadas</span>
                <textarea name="observacoes" rows={6} defaultValue={preparo.observacoes} required />
                <small className="campo-dica">
                  Vem preenchido pela Experience — complete com o que foi feito de fato.
                </small>
              </label>

              {preparo.aprovadores.length > 0 && (
                <div className="aprovadores">
                  <span className="campo-nome">Aprovadores do aceite</span>
                  {preparo.aprovadores.map((a) => (
                    <div className="linha-agenda" key={a.personId}>
                      <span className="linha-titulo">{a.nome}</span>
                      <span className="linha-meta">{a.email}</span>
                    </div>
                  ))}
                </div>
              )}

              {/*
                Desmarcada por padrão de propósito: marcar manda e-mail para o cliente, e
                o hub não desfaz. O caminho seguro tem que ser o que exige menos ação.
              */}
              <label className="campo-inline destaque">
                <input
                  type="checkbox"
                  checked={enviarAprovacao}
                  onChange={(e) => setEnviarAprovacao(e.target.checked)}
                />
                Enviar para o cliente aprovar (dispara e-mail)
              </label>
            </>
          )}
        </div>

        <footer className="modal-foot">
          <p className="modal-nota">
            Sem marcar a caixa acima, a OS é lançada e fica aguardando — é o equivalente a
            responder "Não" no popup da Experience.
          </p>
          <div className="modal-acoes">
            <button className="btn tiny ghost" type="button" onClick={onFechar}>
              Cancelar
            </button>
            <button className="btn tiny" type="submit" disabled={salvando || !preparo}>
              {salvando ? 'Lançando…' : 'Lançar OS'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
