import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Cliente, ClienteEntrada } from '../../types.ts';
import { plural } from '../../lib/format.ts';
import { useClientes } from '../../hooks/useClientes.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { TabBar, type Aba } from '../TabBar.tsx';
import { GitDoCliente } from './GitDoCliente.tsx';
import { AgendaDoCliente } from './AgendaDoCliente.tsx';
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
                onSalvar={(entrada) => salvar(selecionado.id, entrada)}
                onRemover={async () => {
                  if (await remover(selecionado)) setSelecao(null);
                }}
              />
            )}

            {abaCliente === 'agenda' && <AgendaDoCliente key={selecionado.id} cliente={selecionado} />}

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
  if (!cliente.repositorioLocal) faltando.push('repositório');

  return faltando.length ? `falta: ${faltando.join(', ')}` : 'cadastro completo';
}

interface PropsFormulario {
  cliente: Cliente | undefined;
  onSalvar: (entrada: ClienteEntrada) => void | Promise<unknown>;
  onRemover?: () => void | Promise<unknown>;
  onCancelar?: () => void;
}

function FormularioCliente({ cliente, onSalvar, onRemover, onCancelar }: PropsFormulario) {
  const [salvando, setSalvando] = useState(false);

  const aoSubmeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    const texto = (nome: string) => String(dados.get(nome) ?? '').trim();

    setSalvando(true);
    try {
      await onSalvar({
        nome: texto('nome'),
        // String vazia vira null no backend: o cadastro nasce incompleto de propósito,
        // já que o `person_id` da Experience ainda não é descoberto automaticamente.
        experienceProjetoId: texto('experienceProjetoId') === '' ? null : Number(texto('experienceProjetoId')),
        experiencePersonId: texto('experiencePersonId') === '' ? null : Number(texto('experiencePersonId')),
        agendaRecursoUsuario: texto('agendaRecursoUsuario'),
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
          <Campo nome="nome" rotulo="Nome" valor={cliente?.nome ?? ''} obrigatorio
            dica="Como aparece no Sankhya Experience" />
          <Campo nome="experienceProjetoId" rotulo="ID do projeto (Experience)" tipo="number"
            valor={cliente?.experienceProjetoId ?? ''} dica="O número da URL da tela do projeto, ex.: 10269" />
          <Campo nome="experiencePersonId" rotulo="person_id (Experience)" tipo="number"
            valor={cliente?.experiencePersonId ?? ''} dica="Seu ID de usuário nesse projeto, ex.: 21986" />
          <Campo nome="agendaRecursoUsuario" rotulo="Recurso na Agenda (ERP)"
            valor={cliente?.agendaRecursoUsuario ?? ''} dica="Username do recurso, ex.: FLAVIANO.SANTOS" />
          <Campo nome="repositorioLocal" rotulo="Repositório local"
            valor={cliente?.repositorioLocal ?? ''} dica="Pasta no Windows, ex.: C:\projetos\cliente" />
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
    </article>
  );
}

function Campo({
  nome,
  rotulo,
  valor,
  dica,
  tipo = 'text',
  obrigatorio = false,
}: {
  nome: string;
  rotulo: string;
  valor: string | number;
  dica?: string;
  tipo?: string;
  obrigatorio?: boolean;
}) {
  return (
    <label className="campo">
      <span className="campo-nome">
        {rotulo}
        {obrigatorio && <span className="selo falta">obrigatório</span>}
      </span>
      <input
        type={tipo}
        name={nome}
        defaultValue={valor}
        autoComplete="off"
        spellCheck={false}
        required={obrigatorio}
      />
      {dica && <small className="campo-dica">{dica}</small>}
    </label>
  );
}
