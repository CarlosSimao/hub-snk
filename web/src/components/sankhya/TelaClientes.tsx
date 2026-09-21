import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AtuacaoCliente, Cliente, ClienteEntrada, ParceiroAgenda } from '../../types.ts';
import { plural } from '../../lib/format.ts';
import { requisitar } from '../../lib/api.ts';
import { useClientes } from '../../hooks/useClientes.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { TabBar, type Aba } from '../TabBar.tsx';
import { GitDoCliente } from './GitDoCliente.tsx';
import { AgendaDoCliente } from './AgendaDoCliente.tsx';
import { OrdensDoProjeto } from './OrdensDoProjeto.tsx';
import { CartaoDoCliente } from './CartaoDoCliente.tsx';
import { EmailDoCliente } from './EmailDoCliente.tsx';
import { ImportarFavoritos } from './ImportarFavoritos.tsx';
import type { FocoCliente } from './PainelSankhya.tsx';

type AbaCliente = 'cartao' | 'agenda' | 'os' | 'git' | 'email';

const ABAS_CLIENTE: Aba<AbaCliente>[] = [
  { id: 'cartao', rotulo: 'Cadastro', titulo: 'Bases, repositórios, links, anotações e os IDs do cliente' },
  { id: 'agenda', rotulo: 'Agenda', titulo: 'Tarefas e ordens de serviço no Experience' },
  { id: 'os', rotulo: 'OS', titulo: 'Todas as OS lançadas no projeto, inclusive pelos outros' },
  { id: 'git', rotulo: 'Git', titulo: 'Repositório deste cliente no git-autosync' },
  { id: 'email', rotulo: 'E-mail', titulo: 'E-mail para GP, consultor e líder deste cliente' },
];

/**
 * O formulario de identificacao virou modal, aberto pelo botao Editar do cartao.
 *
 * Antes era uma aba propria ao lado da visao geral, e a divisao nao se sustentava: as
 * duas eram o cadastro do mesmo cliente, so que uma mostrava e a outra deixava mudar.
 * `cliente: undefined` e cadastro novo.
 */
type Editor = { cliente: Cliente | undefined } | null;

export function TelaClientes({
  toast,
  foco,
  onAbrirSkill,
}: {
  toast: Avisar;
  foco?: FocoCliente | null;
  onAbrirSkill?: (pedido: { skill: string; pasta: string }) => void;
}) {
  const { clientes, carregando, salvar, remover, recarregar } = useClientes(toast);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [importador, setImportador] = useState(false);
  const [abaCliente, setAbaCliente] = useState<AbaCliente>('cartao');

  // A Agenda Mensal manda abrir um cliente. Aplicado uma vez por pedido: sem o
  // controle de `seq`, um recarregamento da lista sequestraria a seleção de volta.
  const ultimoFoco = useRef(0);
  useEffect(() => {
    if (!foco || foco.seq === ultimoFoco.current) return;

    const cliente = clientes.find((c) => c.id === foco.id);
    if (!cliente) return;

    ultimoFoco.current = foco.seq;
    setSelecionadoId(cliente.id);
    setAbaCliente('agenda');
  }, [foco, clientes]);

  // Guardar o id, e nao o objeto, e o que faz a tela refletir o que acabou de ser
  // gravado sem precisar clicar no cliente de novo.
  const selecionado = clientes.find((c) => c.id === selecionadoId);

  return (
    <div className="layout">
      <aside className="project-list">
        <div className="project-list-head">
          {carregando
            ? 'carregando…'
            : `${clientes.length} ${plural(clientes.length, 'cliente', 'clientes')}`}
        </div>

        <div className="project-list-items">
          {clientes.map((cliente) => (
            <button
              key={cliente.id}
              type="button"
              className={`project-item${selecionado?.id === cliente.id ? ' active' : ''}`}
              aria-pressed={selecionado?.id === cliente.id}
              onClick={() => {
                setSelecionadoId(cliente.id);
                // Trocar de cliente sempre volta à visão geral: ficar no Git de um
                // cliente e ver o repositório de outro confundiria mais que ajudaria.
                setAbaCliente('cartao');
              }}
            >
              <div className="li-title">
                <h2>
                  {cliente.nome}
                  {cliente.anotacoes.trim() && (
                    <span className="selo-anotacao" title="Tem anotações">📝</span>
                  )}
                  {/* Mesma regra do cartão e do e-mail: cobra do último dia em diante,
                      até o envio ser marcado. Aqui é só para varrer a lista sem abrir
                      cliente por cliente. */}
                  {cliente.demandaFim &&
                    !cliente.emailFinalizacaoEm &&
                    cliente.demandaFim <= new Date().toISOString().slice(0, 10) && (
                      <span className="selo-pendencia" title="E-mail de finalização pendente">
                        ✉
                      </span>
                    )}
                </h2>
                <p className="li-summary">{resumo(cliente)}</p>
              </div>
            </button>
          ))}
        </div>

        <button className="btn tiny ghost bloco" onClick={() => setEditor({ cliente: undefined })}>
          + Novo cliente
        </button>
        {/* Os favoritos ja guardam a URL de cada parceiro; digitar tudo de novo seria
            trabalho repetido. Ver ImportarFavoritos. */}
        <button className="btn tiny ghost bloco" onClick={() => setImportador(true)}>
          Importar dos favoritos
        </button>
      </aside>

      <section className="detail">
        {!selecionado && (
          <p className="detail-empty">
            {clientes.length
              ? 'Selecione um cliente ao lado.'
              : 'Nenhum cliente cadastrado ainda — comece por "Novo cliente" ou traga os do navegador.'}
          </p>
        )}

        {selecionado && (
          <>
            <TabBar abas={ABAS_CLIENTE} ativa={abaCliente} onTrocar={setAbaCliente} variante="sub" />

            {abaCliente === 'cartao' && (
              <CartaoDoCliente
                onAbrirSkill={onAbrirSkill}
                key={selecionado.id}
                cliente={selecionado}
                toast={toast}
                onEditar={() => setEditor({ cliente: selecionado })}
                onRemover={async () => {
                  if (await remover(selecionado)) setSelecionadoId(null);
                }}
                onSalvarCliente={(entrada) => salvar(selecionado.id, entrada)}
              />
            )}

            {abaCliente === 'agenda' && (
              <AgendaDoCliente key={selecionado.id} cliente={selecionado} toast={toast} />
            )}

            {abaCliente === 'os' && (
              <OrdensDoProjeto key={selecionado.id} cliente={selecionado} toast={toast} />
            )}

            {abaCliente === 'git' && (
              <GitDoCliente key={selecionado.id} cliente={selecionado} toast={toast} />
            )}

            {abaCliente === 'email' && (
              <EmailDoCliente key={selecionado.id} cliente={selecionado} toast={toast} />
            )}
          </>
        )}
      </section>

      {editor && (
        <FormularioCliente
          key={editor.cliente?.id ?? 'novo'}
          cliente={editor.cliente}
          toast={toast}
          onSalvar={async (entrada) => {
            const gravado = await salvar(editor.cliente?.id ?? null, entrada);
            if (gravado) {
              setSelecionadoId(gravado.id);
              setEditor(null);
            }
          }}
          onRemover={
            editor.cliente
              ? async () => {
                  if (await remover(editor.cliente as Cliente)) {
                    setSelecionadoId(null);
                    setEditor(null);
                  }
                }
              : undefined
          }
          onCancelar={() => setEditor(null)}
        />
      )}

      <ImportarFavoritos
        aberto={importador}
        jaCadastrados={clientes.map((c) => c.nome)}
        toast={toast}
        onFechar={() => setImportador(false)}
        onImportado={recarregar}
      />
    </div>
  );
}

/** O que falta preencher importa mais que o que já está: é o que trava as fases seguintes. */
function resumo(cliente: Cliente): string {
  const faltando: string[] = [];
  if (cliente.experienceProjetoId === null) faltando.push('projeto');
  if (cliente.experiencePersonId === null) faltando.push('person_id');
  if (!cliente.agendaRecursoUsuario) faltando.push('recurso');
  if (cliente.agendaCodparc === null) faltando.push('parceiro');

  return faltando.length ? `falta: ${faltando.join(', ')}` : 'cadastro completo';
}

interface PropsFormulario {
  cliente: Cliente | undefined;
  toast: Avisar;
  onSalvar: (entrada: ClienteEntrada) => void | Promise<unknown>;
  onRemover?: () => void | Promise<unknown>;
  onCancelar?: () => void;
}

function FormularioCliente({ cliente, toast, onSalvar, onRemover, onCancelar }: PropsFormulario) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [salvando, setSalvando] = useState(false);

  // Montou, abriu: quem decide se o editor existe e a tela, com o estado `editor`.
  useEffect(() => dialogo.current?.showModal(), []);

  // Campos controlados: são os que algo além do teclado escreve — a descoberta do
  // person_id, a do parceiro da Agenda e o preenchimento do recurso.
  const [projetoId, setProjetoId] = useState(String(cliente?.experienceProjetoId ?? ''));
  const [personId, setPersonId] = useState(String(cliente?.experiencePersonId ?? ''));
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [recurso, setRecurso] = useState(cliente?.agendaRecursoUsuario ?? '');
  const [codparc, setCodparc] = useState(String(cliente?.agendaCodparc ?? ''));
  const [demandaId, setDemandaId] = useState(cliente?.agendaDemandaId ?? '');
  const [descobrindo, setDescobrindo] = useState(false);
  const [buscandoParceiro, setBuscandoParceiro] = useState(false);
  const [atuacao, setAtuacao] = useState<AtuacaoCliente | null>(null);

  // O recurso da Agenda é sempre o próprio usuário logado, então um cadastro novo já
  // nasce com ele. Cliente existente mantém o que foi gravado — mexer nisso sozinho
  // trocaria a agenda de um cadastro que já funciona.
  useEffect(() => {
    if (cliente || recurso) return;

    let cancelado = false;
    void requisitar<{ usuario: string }>('/api/sankhya/usuario-agenda').then(({ ok, body }) => {
      if (!cancelado && ok && body.usuario) setRecurso(body.usuario);
    });
    return () => {
      cancelado = true;
    };
  }, [cliente, recurso]);

  /**
   * Acha o parceiro da Agenda de Recursos com o nome do cliente e traz junto os dias de
   * atuação — passados e futuros — que já existem no snapshot importado.
   */
  const descobrirParceiro = async (silencioso = false) => {
    const alvo = nome.trim();
    if (!alvo) {
      if (!silencioso) toast('Preencha o nome do cliente antes de procurar na Agenda.', 'err');
      return;
    }

    setBuscandoParceiro(true);
    const busca = new URLSearchParams({ nome: alvo, usuario: recurso.trim() });
    const { ok, body } = await requisitar<{
      parceiro: ParceiroAgenda | null;
      atuacao: AtuacaoCliente | null;
    }>(`/api/clientes/sugestao?${busca}`);
    setBuscandoParceiro(false);

    if (!ok) {
      if (!silencioso) toast('Não consegui consultar a Agenda.', 'err', body.error);
      return;
    }
    if (!body.parceiro?.codparc) {
      if (!silencioso) {
        toast('Nenhum parceiro da Agenda bate com esse nome.', 'err',
          'Importe a Agenda de Recursos ou informe o código do parceiro à mão.');
      }
      return;
    }

    setCodparc(String(body.parceiro.codparc));
    setAtuacao(body.atuacao ?? null);
    toast(`${body.parceiro.nomeparc} — ${body.atuacao?.dias.length ?? 0} dia(s) de atuação`);
  };

  /**
   * Acha o `person_id` do usuário logado no projeto informado, cruzando o e-mail do JWT
   * da Experience com a lista de pessoas do projeto — poupa ir catar esse número na mão.
   */
  const descobrirPersonId = async () => {
    const projeto = projetoId.trim();
    if (!projeto) {
      toast('Preencha o ID do projeto antes de descobrir o person_id.', 'err');
      return;
    }

    setDescobrindo(true);
    const busca = new URLSearchParams({ projetoId: projeto });
    const { ok, body } = await requisitar<{ personId: number; nome: string }>(
      `/api/experience/person-id?${busca}`,
    );
    setDescobrindo(false);

    if (!ok || body.personId === undefined) {
      toast('Não consegui descobrir o person_id.', 'err', body.error);
      return;
    }

    setPersonId(String(body.personId));
    toast(`person_id ${body.personId} — ${body.nome ?? ''}`.trim());
  };

  const aoSubmeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    const texto = (nome: string) => String(dados.get(nome) ?? '').trim();

    setSalvando(true);
    try {
      await onSalvar({
        nome: texto('nome'),
        // String vazia vira null no backend: o cadastro pode nascer incompleto e ser
        // completado depois, conforme os IDs vão sendo descobertos.
        experienceProjetoId: texto('experienceProjetoId') === '' ? null : Number(texto('experienceProjetoId')),
        experiencePersonId: texto('experiencePersonId') === '' ? null : Number(texto('experiencePersonId')),
        agendaRecursoUsuario: texto('agendaRecursoUsuario'),
        agendaCodparc: texto('agendaCodparc') === '' ? null : Number(texto('agendaCodparc')),
        agendaDemandaId: texto('agendaDemandaId'),
        // Base e repositório se cadastram no cartão, em Bases e Repositórios — estes
        // campos são o que sobrou do cadastro antigo de um só de cada. Vão de volta
        // como estavam porque mandar vazio APAGARIA o que ainda está gravado neles.
        sankhyaUrl: cliente?.sankhyaUrl ?? '',
        repositorioLocal: cliente?.repositorioLocal ?? '',
        repositorioRemoto: cliente?.repositorioRemoto ?? '',
        // Texto livre preserva quebra de linha e espaço — nada de `trim` aqui.
        anotacoes: String(dados.get('anotacoes') ?? ''),
        // A marca de avisar é editada no cartão, não neste formulário: vai de volta como
        // está, senão salvar o cadastro desligaria o aviso sem ninguém pedir.
        anotacoesNotificar: cliente?.anotacoesNotificar ?? false,
        // Mesmo motivo: a finalização é editada no cartão, não neste formulário.
        demandaFim: cliente?.demandaFim ?? '',
        emailFinalizacaoEm: cliente?.emailFinalizacaoEm ?? '',
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <dialog className="modal editor-cadastro" ref={dialogo} onClose={() => onCancelar?.()}>
      <form onSubmit={(e) => void aoSubmeter(e)}>
        <div className="modal-head">
          <div className="card-title">
            <h2>{cliente ? cliente.nome : 'Novo cliente'}</h2>
            <p>Liga o projeto na Experience e o recurso na Agenda. Base, repositório e links ficam no cartão.</p>
          </div>
          <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={() => onCancelar?.()}>✕</button>
        </div>

        <div className="modal-body form-campos">
          <Campo nome="nome" rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio
            dica="Como aparece no Sankhya Experience"
            // Cadastro novo tenta achar o parceiro sozinho ao sair do nome; em silêncio,
            // porque digitar o nome não é pedir uma busca e um erro aqui seria ruído.
            aoSair={cliente || codparc ? undefined : () => void descobrirParceiro(true)} />
          <Campo nome="experienceProjetoId" rotulo="ID do projeto (Experience)" tipo="number"
            valor={projetoId} aoMudar={setProjetoId}
            dica="O número da URL da tela do projeto, ex.: 10269" />
          <Campo nome="experiencePersonId" rotulo="person_id (Experience)" tipo="number"
            valor={personId} aoMudar={setPersonId}
            dica="Seu ID de usuário nesse projeto — o botão acha pelo e-mail da sua sessão da Experience"
            acao={
              <button className="btn tiny ghost" type="button" disabled={descobrindo}
                onClick={() => void descobrirPersonId()}>
                {descobrindo ? 'buscando…' : 'Descobrir'}
              </button>
            } />
          <Campo nome="agendaRecursoUsuario" rotulo="Recurso na Agenda (ERP)"
            valor={recurso} aoMudar={setRecurso}
            dica="Preenchido com o seu usuário do Sankhya — é a lane da agenda, e ela é sua, não do cliente" />
          <Campo nome="agendaCodparc" rotulo="Parceiro na Agenda (ERP)" tipo="number"
            valor={codparc} aoMudar={setCodparc}
            dica="CODPARC do cliente — é ele que separa os dias deste cliente dos demais na sua agenda"
            acao={
              <button className="btn tiny ghost" type="button" disabled={buscandoParceiro}
                onClick={() => void descobrirParceiro()}>
                {buscandoParceiro ? 'buscando…' : 'Procurar na Agenda'}
              </button>
            } />
          {atuacao && atuacao.dias.length > 0 && (
            <p className="campo-dica">
              {atuacao.nomeparc}: {atuacao.dias.length} dia(s) de atuação, de{' '}
              {atuacao.dias[0]?.dia} a {atuacao.dias[atuacao.dias.length - 1]?.dia}.
            </p>
          )}
          <Campo nome="agendaDemandaId" rotulo="ID da demanda (Agenda)"
            valor={demandaId} aoMudar={setDemandaId}
            dica="Codigo da demanda deste cliente na Agenda de Recursos — texto livre, preenchido a mao" />
        </div>

        <div className="modal-foot form-acoes">
          {onRemover && (
            <button className="btn tiny ghost danger" type="button" onClick={() => void onRemover()}>
              Remover
            </button>
          )}
          <span className="modal-acoes-spacer" />
          {onCancelar && (
            <button className="btn tiny ghost" type="button" onClick={onCancelar}>
              Cancelar
            </button>
          )}
          <button className="btn tiny" type="submit" disabled={salvando}>
            Salvar
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Campo de formulário. Sem `aoMudar` ele é não-controlado e o valor sai pelo FormData;
 * com `aoMudar`, quem manda no valor é o React — é o que deixa um botão escrever nele.
 */
function Campo({
  nome,
  rotulo,
  valor,
  dica,
  tipo = 'text',
  obrigatorio = false,
  aoMudar,
  aoSair,
  acao,
}: {
  nome: string;
  rotulo: string;
  valor: string | number;
  dica?: string;
  tipo?: string;
  obrigatorio?: boolean;
  aoMudar?: (valor: string) => void;
  aoSair?: () => void;
  acao?: ReactNode;
}) {
  const id = `campo-${nome}`;
  const input = (
    <input
      id={id}
      type={tipo}
      name={nome}
      {...(aoMudar
        ? { value: valor, onChange: (e: { target: { value: string } }) => aoMudar(e.target.value) }
        : { defaultValue: valor })}
      {...(aoSair ? { onBlur: aoSair } : {})}
      autoComplete="off"
      spellCheck={false}
      required={obrigatorio}
    />
  );

  return (
    <div className="campo">
      <label className="campo-nome" htmlFor={id}>
        {rotulo}
        {obrigatorio && <span className="selo falta">obrigatório</span>}
      </label>
      {acao ? (
        <div className="campo-linha">
          {input}
          {acao}
        </div>
      ) : (
        input
      )}
      {dica && <small className="campo-dica">{dica}</small>}
    </div>
  );
}
