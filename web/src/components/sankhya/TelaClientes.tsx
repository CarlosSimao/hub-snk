import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AtuacaoCliente, Cliente, ClienteEntrada, ParceiroAgenda } from '../../types.ts';
import { plural } from '../../lib/format.ts';
import { requisitar } from '../../lib/api.ts';
import { useClientes } from '../../hooks/useClientes.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { TabBar, type Aba } from '../TabBar.tsx';
import { GitDoCliente } from './GitDoCliente.tsx';
import { AgendaDoCliente } from './AgendaDoCliente.tsx';
import { SeletorPasta } from './SeletorPasta.tsx';
import type { FocoCliente } from './PainelSankhya.tsx';

type AbaCliente = 'cadastro' | 'agenda' | 'git';

const ABAS_CLIENTE: Aba<AbaCliente>[] = [
  { id: 'cadastro', rotulo: 'Cadastro' },
  { id: 'agenda', rotulo: 'Agenda', titulo: 'Tarefas e ordens de serviço no Experience' },
  { id: 'git', rotulo: 'Git', titulo: 'Repositório deste cliente no git-autosync' },
];

/** `null` = formulário de cadastro novo; nenhum selecionado = tela de boas-vindas. */
type Selecao = { tipo: 'novo' } | { tipo: 'cliente'; cliente: Cliente } | null;

export function TelaClientes({ toast, foco }: { toast: Avisar; foco?: FocoCliente | null }) {
  const { clientes, carregando, salvar, remover } = useClientes(toast);
  const [selecao, setSelecao] = useState<Selecao>(null);
  const [abaCliente, setAbaCliente] = useState<AbaCliente>('cadastro');

  // A Agenda Mensal manda abrir um cliente. Aplicado uma vez por pedido: sem o
  // controle de `seq`, um recarregamento da lista sequestraria a seleção de volta.
  const ultimoFoco = useRef(0);
  useEffect(() => {
    if (!foco || foco.seq === ultimoFoco.current) return;

    const cliente = clientes.find((c) => c.id === foco.id);
    if (!cliente) return;

    ultimoFoco.current = foco.seq;
    setSelecao({ tipo: 'cliente', cliente });
    setAbaCliente('agenda');
  }, [foco, clientes]);

  // O cliente do estado é uma cópia congelada no clique; relê da lista para refletir o
  // que acabou de ser gravado sem precisar clicar de novo.
  const selecionado =
    selecao?.tipo === 'cliente' ? clientes.find((c) => c.id === selecao.cliente.id) : undefined;

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
                setSelecao({ tipo: 'cliente', cliente });
                // Trocar de cliente sempre volta ao cadastro: ficar no Git de um
                // cliente e ver o repositório de outro confundiria mais que ajudaria.
                setAbaCliente('cadastro');
              }}
            >
              <div className="li-title">
                <h2>{cliente.nome}</h2>
                <p className="li-summary">{resumo(cliente)}</p>
              </div>
            </button>
          ))}
        </div>

        <button
          className="btn tiny ghost bloco"
          onClick={() => setSelecao({ tipo: 'novo' })}
          disabled={selecao?.tipo === 'novo'}
        >
          + Novo cliente
        </button>
      </aside>

      <section className="detail">
        {selecao === null && (
          <p className="detail-empty">
            {clientes.length
              ? 'Selecione um cliente ao lado.'
              : 'Nenhum cliente cadastrado ainda — comece por "Novo cliente".'}
          </p>
        )}

        {selecao?.tipo === 'novo' && (
          <FormularioCliente
            key="novo"
            cliente={undefined}
            toast={toast}
            onSalvar={async (entrada) => {
              const criado = await salvar(null, entrada);
              if (criado) setSelecao({ tipo: 'cliente', cliente: criado });
            }}
            onCancelar={() => setSelecao(null)}
          />
        )}

        {selecionado && (
          <>
            <TabBar abas={ABAS_CLIENTE} ativa={abaCliente} onTrocar={setAbaCliente} variante="sub" />

            {abaCliente === 'cadastro' && (
              <FormularioCliente
                key={selecionado.id}
                cliente={selecionado}
                toast={toast}
                onSalvar={(entrada) => salvar(selecionado.id, entrada)}
                onRemover={async () => {
                  if (await remover(selecionado)) setSelecao(null);
                }}
              />
            )}

            {abaCliente === 'agenda' && (
              <AgendaDoCliente key={selecionado.id} cliente={selecionado} toast={toast} />
            )}

            {abaCliente === 'git' && (
              <GitDoCliente key={selecionado.id} cliente={selecionado} toast={toast} />
            )}
          </>
        )}
      </section>
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
  if (!cliente.repositorioLocal) faltando.push('repositório');

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
  const [salvando, setSalvando] = useState(false);

  // Campos controlados: são os que algo além do teclado escreve — o seletor de pastas,
  // a descoberta do person_id, a do parceiro da Agenda e o preenchimento do recurso.
  const [projetoId, setProjetoId] = useState(String(cliente?.experienceProjetoId ?? ''));
  const [personId, setPersonId] = useState(String(cliente?.experiencePersonId ?? ''));
  const [repositorioLocal, setRepositorioLocal] = useState(cliente?.repositorioLocal ?? '');
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [recurso, setRecurso] = useState(cliente?.agendaRecursoUsuario ?? '');
  const [codparc, setCodparc] = useState(String(cliente?.agendaCodparc ?? ''));
  const [sankhyaUrl, setSankhyaUrl] = useState(cliente?.sankhyaUrl ?? '');
  const [seletorAberto, setSeletorAberto] = useState(false);
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
        sankhyaUrl: texto('sankhyaUrl'),
        repositorioLocal: texto('repositorioLocal'),
        repositorioRemoto: texto('repositorioRemoto'),
      });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="card detail-card">
      <form onSubmit={(e) => void aoSubmeter(e)}>
        <div className="detail-head">
          <div className="card-title">
            <h2>{cliente ? cliente.nome : 'Novo cliente'}</h2>
            <p>Liga o projeto na Experience, o recurso na Agenda e o repositório local.</p>
          </div>
        </div>

        <div className="form-campos">
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
          <Campo nome="sankhyaUrl" rotulo="URL do Sankhya do cliente"
            valor={sankhyaUrl} aoMudar={setSankhyaUrl}
            dica="Endereço do ERP deste cliente, ex.: https://cliente.sankhya.com.br"
            acao={
              <button className="btn tiny ghost" type="button" disabled={!sankhyaUrl.trim()}
                onClick={() => window.open(sankhyaUrl, '_blank', 'noopener,noreferrer')}>
                Abrir
              </button>
            } />
          <Campo nome="repositorioLocal" rotulo="Repositório local"
            valor={repositorioLocal} aoMudar={setRepositorioLocal}
            dica="Pasta no Windows — digite o caminho ou procure no disco"
            acao={
              <button className="btn tiny ghost" type="button" onClick={() => setSeletorAberto(true)}>
                Procurar…
              </button>
            } />
          <Campo nome="repositorioRemoto" rotulo="Repositório remoto"
            valor={cliente?.repositorioRemoto ?? ''} dica="URL do remote — informativo, não é usado para autenticar" />
        </div>

        <div className="form-acoes">
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

      {/* Fora do <form>: dialog modal aninhado em formulário atrapalha o Enter e o submit. */}
      <SeletorPasta
        aberto={seletorAberto}
        inicial={repositorioLocal}
        onEscolher={setRepositorioLocal}
        onFechar={() => setSeletorAberto(false)}
      />
    </article>
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
