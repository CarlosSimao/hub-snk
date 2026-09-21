import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AmbienteBase,
  BancoDaBase,
  BaseCliente,
  Cliente,
  ClienteEntrada,
  LinkCliente,
  RepoCliente,
  Sgbd,
  StatusBase,
} from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { useCartaoCliente } from '../../hooks/useCartaoCliente.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import { mesmoCaminho, StatusRepoCompacto } from '../git/DetalheRepo.tsx';
import { SeletorPasta } from './SeletorPasta.tsx';
import { AbrirRepoEm } from './AbrirRepoEm.tsx';

type Editor =
  | { tipo: 'base'; item: BaseCliente | null }
  | { tipo: 'repo'; item: RepoCliente | null }
  | { tipo: 'link'; item: LinkCliente | null }
  | null;

const AMBIENTE: Record<AmbienteBase, string> = {
  producao: 'Produção',
  teste: 'Teste',
  homologacao: 'Homologação',
  outro: 'Outro',
};

const SGBD: Record<Sgbd, string> = {
  oracle: 'Oracle',
  sqlserver: 'SQL Server',
  postgres: 'PostgreSQL',
  outro: 'Outro',
};

/** Porta que o SGBD usa quando ninguém mexeu — vira dica no editor, nunca valor gravado. */
const PORTA_PADRAO: Record<Sgbd, string> = {
  oracle: '1521',
  sqlserver: '1433',
  postgres: '5432',
  outro: '',
};

/** Um banco só aparece no cartão se alguém anotou alguma coisa nele. */
function bancoPreenchido(banco: BancoDaBase): boolean {
  return Boolean(
    banco.sgbd || banco.host || banco.porta || banco.servico || banco.esquema || banco.usuario || banco.temSenha,
  );
}

interface Props {
  cliente: Cliente;
  toast: Avisar;
  onEditar: () => void;
  onRemover: () => void | Promise<unknown>;
  onSalvarCliente: (entrada: ClienteEntrada) => Promise<unknown>;
}

export function CartaoDoCliente({ cliente, toast, onEditar, onRemover, onSalvarCliente }: Props) {
  const dados = useCartaoCliente(cliente.id, toast);
  const git = useGitAutosync(toast);
  const [editor, setEditor] = useState<Editor>(null);
  const [senhas, setSenhas] = useState<Record<number, string>>({});
  const [senhasBanco, setSenhasBanco] = useState<Record<number, string>>({});
  const [anotacoes, setAnotacoes] = useState(cliente.anotacoes);
  const [notificar, setNotificar] = useState(cliente.anotacoesNotificar);
  const [demandaFim, setDemandaFim] = useState(cliente.demandaFim);
  const [salvandoFinalizacao, setSalvandoFinalizacao] = useState(false);
  const [salvandoAnotacoes, setSalvandoAnotacoes] = useState(false);

  useEffect(() => setAnotacoes(cliente.anotacoes), [cliente.anotacoes]);
  useEffect(() => setNotificar(cliente.anotacoesNotificar), [cliente.anotacoesNotificar]);
  useEffect(() => setDemandaFim(cliente.demandaFim), [cliente.demandaFim]);

  const esconderSenha = (id: number) => {
    const tirar = (atuais: Record<number, string>) => {
      const proximas = { ...atuais };
      delete proximas[id];
      return proximas;
    };
    setSenhas(tirar);
    setSenhasBanco(tirar);
  };

  const alternarSenha = async (base: BaseCliente) => {
    if (senhas[base.id] !== undefined) {
      esconderSenha(base.id);
      return;
    }
    const senha = await dados.revelarSenha(base);
    if (senha !== null) setSenhas((atuais) => ({ ...atuais, [base.id]: senha }));
  };

  const copiarSenha = async (base: BaseCliente) => {
    const senha = senhas[base.id] ?? await dados.revelarSenha(base);
    if (senha === null) return;
    try {
      await navigator.clipboard.writeText(senha);
      toast('Senha copiada.', 'ok');
    } catch {
      toast('O navegador bloqueou a cópia da senha.', 'err');
    }
  };

  const alternarSenhaBanco = async (base: BaseCliente) => {
    if (senhasBanco[base.id] !== undefined) {
      setSenhasBanco((atuais) => {
        const proximas = { ...atuais };
        delete proximas[base.id];
        return proximas;
      });
      return;
    }
    const senha = await dados.revelarSenhaBanco(base);
    if (senha !== null) setSenhasBanco((atuais) => ({ ...atuais, [base.id]: senha }));
  };

  const copiarSenhaBanco = async (base: BaseCliente) => {
    const senha = senhasBanco[base.id] ?? await dados.revelarSenhaBanco(base);
    if (senha === null) return;
    try {
      await navigator.clipboard.writeText(senha);
      toast('Senha do banco copiada.', 'ok');
    } catch {
      toast('O navegador bloqueou a cópia da senha.', 'err');
    }
  };

  const hoje = new Date().toISOString().slice(0, 10);
  // Mesma regra do backend (`emailFinalizacaoPendente`): cobra a partir do último dia,
  // e só para quando o envio for marcado.
  const finalizacaoPendente = Boolean(cliente.demandaFim) && !cliente.emailFinalizacaoEm && cliente.demandaFim <= hoje;

  const salvarFinalizacao = async (campos: { demandaFim?: string; emailFinalizacaoEm?: string }) => {
    setSalvandoFinalizacao(true);
    try {
      await onSalvarCliente({ ...cliente, demandaFim, ...campos });
      await dados.recarregar();
    } finally {
      setSalvandoFinalizacao(false);
    }
  };

  const anotacoesAlteradas = anotacoes !== cliente.anotacoes || notificar !== cliente.anotacoesNotificar;

  const salvarAnotacoes = async () => {
    setSalvandoAnotacoes(true);
    try {
      await onSalvarCliente({ ...cliente, anotacoes, anotacoesNotificar: notificar });
      await dados.recarregar();
    } finally {
      setSalvandoAnotacoes(false);
    }
  };

  if (dados.carregando || !dados.cartao) {
    return <p className="detail-empty">Carregando cartão do cliente…</p>;
  }

  return (
    <article className="card cartao-cliente">
      <header className="cartao-cliente-head">
        <div>
          <span>Cliente</span>
          <h2>{cliente.nome}</h2>
        </div>
        <div className="cartao-head-acoes">
          <button className="btn tiny ghost" disabled={dados.carregando} onClick={() => void Promise.all([dados.recarregar(), git.recarregar()])}>Recarregar</button>
          <button className="btn tiny ghost" onClick={onEditar}>Editar</button>
          <button className="btn tiny ghost danger" onClick={() => void onRemover()}>Remover</button>
        </div>
      </header>

      {/* Faixa fixa: fica enquanto o e-mail de finalização não for marcado como enviado.
          É o mesmo aviso que sai por e-mail todo dia — aqui para você resolver na hora. */}
      {finalizacaoPendente && (
        <div className="faixa-pendencia">
          <span>
            <b>E-mail de finalização pendente.</b> A demanda terminou em{' '}
            {cliente.demandaFim.split('-').reverse().join('/')} e o envio ao parceiro ainda não foi
            registrado — o aviso vai por e-mail todo dia até ser marcado.
          </span>
          <button
            className="btn tiny"
            type="button"
            disabled={salvandoFinalizacao}
            onClick={() => void salvarFinalizacao({ emailFinalizacaoEm: hoje })}
          >
            {salvandoFinalizacao ? 'Marcando…' : 'Marcar como enviado'}
          </button>
        </div>
      )}

      <section className="cartao-secao demanda-finalizacao">
        <div className="cartao-secao-head"><h3>Finalização da demanda</h3></div>
        <div className="demanda-campos">
          <label className="campo">
            <span className="campo-nome">Último dia da demanda</span>
            <input
              type="date"
              value={demandaFim}
              onChange={(event) => setDemandaFim(event.target.value)}
              onBlur={() => demandaFim !== cliente.demandaFim && void salvarFinalizacao({})}
            />
          </label>
          <div className="demanda-estado">
            {cliente.emailFinalizacaoEm ? (
              <>
                <span className="pill ok">e-mail enviado</span>
                <small>em {cliente.emailFinalizacaoEm.split('-').reverse().join('/')}</small>
                <button
                  className="btn tiny ghost"
                  type="button"
                  disabled={salvandoFinalizacao}
                  onClick={() => void salvarFinalizacao({ emailFinalizacaoEm: '' })}
                >
                  Desfazer
                </button>
              </>
            ) : (
              <small>
                {cliente.demandaFim
                  ? 'Ainda não registrado como enviado.'
                  : 'Informe o último dia para o hub cobrar o envio.'}
              </small>
            )}
          </div>
        </div>
      </section>

      <Secao titulo="Bases" onAdicionar={() => setEditor({ tipo: 'base', item: null })}>
        {dados.cartao.bases.length === 0 && <Vazio>Nenhuma base cadastrada para este cliente.</Vazio>}
        {dados.cartao.bases.map((base) => (
          <BaseLinha
            key={base.id}
            base={base}
            status={dados.statusBases[base.id]}
            medindo={dados.medindo.has(base.id)}
            senha={senhas[base.id]}
            senhaBanco={senhasBanco[base.id]}
            onSenha={() => void alternarSenha(base)}
            onCopiar={() => void copiarSenha(base)}
            onSenhaBanco={() => void alternarSenhaBanco(base)}
            onCopiarBanco={() => void copiarSenhaBanco(base)}
            onMedir={() => void dados.medirBase(base)}
            onMonitorar={(monitorar) => void dados.salvarBase(base, {
              ambiente: base.ambiente,
              url: base.url,
              usuario: base.usuario,
              monitorar,
              ordem: base.ordem,
            })}
            onEditar={() => setEditor({ tipo: 'base', item: base })}
            onRemover={() => {
              esconderSenha(base.id);
              void dados.removerBase(base);
            }}
          />
        ))}
      </Secao>

      <Secao titulo="Repositórios" onAdicionar={() => setEditor({ tipo: 'repo', item: null })}>
        {dados.cartao.repos.length === 0 && <Vazio>Nenhum repositório cadastrado para este cliente.</Vazio>}
        {dados.cartao.repos.map((repo) => (
          <div className="cartao-repo" key={repo.id}>
            <div className="cartao-item-main">
              <strong>{repo.nome || nomePasta(repo.caminhoLocal)}</strong>
              {repo.remoto && <LinhaUrl url={repo.remoto} />}
              <code>{repo.caminhoLocal}</code>
              <StatusRepoCompacto
                repo={git.visao.repos.find((item) => mesmoCaminho(item.path, repo.caminhoLocal))}
                branch={branchDoRemoto(repo.remoto)}
              />
              {/* Só com caminho cadastrado: sem pasta não há o que abrir. */}
              {repo.caminhoLocal && <AbrirRepoEm caminho={repo.caminhoLocal} toast={toast} />}
            </div>
            <AcoesItem
              onEditar={() => setEditor({ tipo: 'repo', item: repo })}
              onRemover={() => void dados.removerRepo(repo)}
            />
          </div>
        ))}
      </Secao>

      <Secao titulo="Links" onAdicionar={() => setEditor({ tipo: 'link', item: null })}>
        {dados.cartao.links.length === 0 && <Vazio>Nenhum link cadastrado para este cliente.</Vazio>}
        <div className="cartao-links">
          {dados.cartao.links.map((link) => (
            <div className="cartao-link" key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer"><strong>{link.titulo}</strong><span>{link.url}</span></a>
              <AcoesItem
                onEditar={() => setEditor({ tipo: 'link', item: link })}
                onRemover={() => void dados.removerLink(link)}
              />
            </div>
          ))}
        </div>
      </Secao>

      <section
        className={`cartao-secao anotacoes-cliente${cliente.anotacoesNotificar && cliente.anotacoes.trim() ? ' anotacoes-marcadas' : ''}`}
      >
        <div className="cartao-secao-head">
          <h3>Anotações</h3>
          {cliente.anotacoesNotificar && cliente.anotacoes.trim() ? (
            <span className="pill pill-aviso" title="Este cliente aparece no aviso ao abrir o hub e no resumo diário">
              avisando
            </span>
          ) : null}
        </div>
        <textarea
          value={anotacoes}
          onChange={(event) => setAnotacoes(event.target.value)}
          placeholder="Anotações avulsas sobre o cliente: contatos, particularidades, combinados."
          rows={5}
        />
        <label className="anotacoes-avisar">
          <input type="checkbox" checked={notificar} onChange={(event) => setNotificar(event.target.checked)} />
          <span>
            Ativar notificações
            <small>Avisa ao abrir o Sankhya Hub e entra no resumo diário por e-mail.</small>
          </span>
        </label>
        <div className="cartao-anotacoes-foot">
          <span>{anotacoesAlteradas ? 'Alterações ainda não salvas' : 'Sem alterações'}</span>
          <button className="btn tiny" disabled={salvandoAnotacoes || !anotacoesAlteradas} onClick={() => void salvarAnotacoes()}>
            {salvandoAnotacoes ? 'Salvando…' : 'Salvar anotações'}
          </button>
        </div>
      </section>

      {editor?.tipo === 'base' && (
        <EditorBase
          base={editor.item}
          onFechar={() => setEditor(null)}
          onSalvar={(entrada) => dados.salvarBase(editor.item, entrada)}
        />
      )}
      {editor?.tipo === 'repo' && (
        <EditorRepo
          repo={editor.item}
          onFechar={() => setEditor(null)}
          onSalvar={(entrada) => dados.salvarRepo(editor.item, entrada)}
        />
      )}
      {editor?.tipo === 'link' && (
        <EditorLink
          link={editor.item}
          onFechar={() => setEditor(null)}
          onSalvar={(entrada) => dados.salvarLink(editor.item, entrada)}
        />
      )}
    </article>
  );
}

function Secao({ titulo, onAdicionar, children }: { titulo: string; onAdicionar: () => void; children: ReactNode }) {
  return (
    <section className="cartao-secao">
      <div className="cartao-secao-head">
        <h3>{titulo}</h3>
        <button type="button" aria-label={`Adicionar em ${titulo}`} title={`Adicionar em ${titulo}`} onClick={onAdicionar}>+</button>
      </div>
      {children}
    </section>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="cartao-vazio">{children}</p>;
}

function BaseLinha({
  base,
  status,
  medindo,
  senha,
  senhaBanco,
  onSenha,
  onCopiar,
  onSenhaBanco,
  onCopiarBanco,
  onMedir,
  onMonitorar,
  onEditar,
  onRemover,
}: {
  base: BaseCliente;
  status?: StatusBase;
  medindo: boolean;
  senha?: string;
  senhaBanco?: string;
  onSenha: () => void;
  onCopiar: () => void;
  onSenhaBanco: () => void;
  onCopiarBanco: () => void;
  onMedir: () => void;
  onMonitorar: (valor: boolean) => void;
  onEditar: () => void;
  onRemover: () => void;
}) {
  const versao = status?.versao || base.versao;
  return (
    <div className="cartao-base">
      <span className={`ambiente ambiente-${base.ambiente}`}>{AMBIENTE[base.ambiente]}</span>
      <div className="cartao-base-dados">
        <LinhaUrl url={base.url} />
        <div className="credencial-base">
          <span><small>Usuário</small><strong>{base.usuario || 'não informado'}</strong></span>
          <span>
            <small>Senha</small>
            <strong className="senha-base">{senha ?? (base.temSenha ? '••••••••' : 'não informada')}</strong>
            {base.temSenha && <button type="button" className="btn-icone" aria-label={senha === undefined ? 'Revelar senha' : 'Ocultar senha'} onClick={onSenha}>{senha === undefined ? 'Olho' : 'Ocultar'}</button>}
            {base.temSenha && <button type="button" className="btn-icone" aria-label="Copiar senha" onClick={onCopiar}>Copiar</button>}
          </span>
          <span><small>Versão</small><strong>{versao || 'não medida'}</strong></span>
        </div>
        <BancoDaBaseLinha
          banco={base.banco}
          senha={senhaBanco}
          onSenha={onSenhaBanco}
          onCopiar={onCopiarBanco}
          onEditar={onEditar}
        />
      </div>
      <div className="cartao-base-status">
        <span className={`status-base ${status?.status ?? 'unknown'}`}>{medindo ? 'Medindo…' : status?.mensagem || 'Não medido'}</span>
        <button className="btn tiny ghost" disabled={medindo} onClick={onMedir}>{medindo ? 'Aguarde' : 'Remedir'}</button>
        <label className="toggle-monitorar"><input type="checkbox" checked={base.monitorar} onChange={(event) => onMonitorar(event.target.checked)} /><span>Monitorar</span></label>
      </div>
      <AcoesItem onEditar={onEditar} onRemover={onRemover} />
    </div>
  );
}

/**
 * Os dados de conexao do banco daquela base.
 *
 * Fica recolhido num `<details>`: e informacao de consulta ocasional, nao algo que se
 * olhe a cada abertura do cartao como a URL e o status. Base sem nada anotado nao
 * mostra a secao — linha vazia so ocuparia espaco.
 */
function BancoDaBaseLinha({ banco, senha, onSenha, onCopiar, onEditar }: {
  banco: BancoDaBase;
  senha?: string;
  onSenha: () => void;
  onCopiar: () => void;
  onEditar: () => void;
}) {
  const abrirEdicao = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    // `<summary>` alterna o `<details>` em qualquer clique dentro dele — sem parar
    // aqui, clicar no ícone também abriria/fecharia o detalhe por baixo.
    event.preventDefault();
    event.stopPropagation();
    onEditar();
  };

  if (!bancoPreenchido(banco)) {
    return (
      <div className="banco-base banco-base-vazio">
        <span>Banco de dados</span>
        <small>não configurado</small>
        <button type="button" className="btn-icone quadrado" aria-label="Configurar banco de dados" onClick={abrirEdicao}>🗄</button>
      </div>
    );
  }

  const endereco = [banco.host, banco.porta].filter(Boolean).join(':');
  return (
    <details className="banco-base">
      <summary>
        <span>Banco de dados</span>
        <small>{[banco.sgbd ? SGBD[banco.sgbd] : '', endereco, banco.servico].filter(Boolean).join(' · ') || 'sem detalhes'}</small>
        <button type="button" className="btn-icone quadrado" aria-label="Editar banco de dados" onClick={abrirEdicao}>🗄</button>
      </summary>
      <div className="credencial-base">
        <span><small>SGBD</small><strong>{banco.sgbd ? SGBD[banco.sgbd] : 'não informado'}</strong></span>
        <span><small>Host</small><strong>{endereco || 'não informado'}</strong></span>
        <span><small>Serviço / SID</small><strong>{banco.servico || 'não informado'}</strong></span>
        <span><small>Esquema</small><strong>{banco.esquema || 'não informado'}</strong></span>
        <span><small>Usuário</small><strong>{banco.usuario || 'não informado'}</strong></span>
        <span>
          <small>Senha</small>
          <strong className="senha-base">{senha ?? (banco.temSenha ? '••••••••' : 'não informada')}</strong>
          {banco.temSenha && <button type="button" className="btn-icone" aria-label={senha === undefined ? 'Revelar senha do banco' : 'Ocultar senha do banco'} onClick={onSenha}>{senha === undefined ? 'Olho' : 'Ocultar'}</button>}
          {banco.temSenha && <button type="button" className="btn-icone" aria-label="Copiar senha do banco" onClick={onCopiar}>Copiar</button>}
        </span>
      </div>
    </details>
  );
}

function LinhaUrl({ url }: { url: string }) {
  return (
    <div className="linha-url">
      <a href={url} target="_blank" rel="noreferrer">{url}</a>
      <button className="btn tiny ghost" type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Abrir</button>
    </div>
  );
}

function AcoesItem({ onEditar, onRemover }: { onEditar: () => void; onRemover: () => void }) {
  return (
    <div className="cartao-item-acoes">
      <button className="btn tiny ghost" type="button" onClick={onEditar}>Editar</button>
      <button className="btn tiny ghost danger" type="button" onClick={onRemover}>Remover</button>
    </div>
  );
}

function DialogEditor({ titulo, onFechar, onSubmit, children }: {
  titulo: string;
  onFechar: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog className="modal editor-cartao" ref={ref} onClose={onFechar}>
      <form onSubmit={onSubmit}>
        <div className="modal-head"><h2>{titulo}</h2><button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>✕</button></div>
        {children}
      </form>
    </dialog>
  );
}

function CampoEditor({ nome, rotulo, valor = '', tipo = 'text', obrigatorio = false, aoMudar, children }: {
  nome: string;
  rotulo: string;
  valor?: string;
  tipo?: string;
  obrigatorio?: boolean;
  aoMudar?: (valor: string) => void;
  children?: ReactNode;
}) {
  return (
    <label className="campo">
      <span className="campo-nome">{rotulo}{obrigatorio && <span className="selo falta">obrigatório</span>}</span>
      <input
        name={nome}
        type={tipo}
        defaultValue={valor}
        required={obrigatorio}
        autoComplete="off"
        {...(aoMudar ? { onChange: (e) => aoMudar(e.target.value) } : {})}
      />
      {children}
    </label>
  );
}

function EditorBase({ base, onFechar, onSalvar }: {
  base: BaseCliente | null;
  onFechar: () => void;
  onSalvar: (entrada: Parameters<ReturnType<typeof useCartaoCliente>['salvarBase']>[1]) => Promise<unknown>;
}) {
  const [salvando, setSalvando] = useState(false);

  // `null` = ninguém digitou no campo, então a senha guardada fica como está. Qualquer
  // outro valor vai para o backend — inclusive `''`, que é como se apaga uma senha.
  // Precisa ser estado e não FormData: sem saber se o campo foi TOCADO, um campo de
  // senha vazio é ambíguo entre "não mexi" e "quero apagar".
  const [senha, setSenha] = useState<string | null>(null);
  const [senhaBanco, setSenhaBanco] = useState<string | null>(null);

  // Só serve para sugerir a porta do SGBD escolhido; o valor gravado é o do campo.
  const [sgbd, setSgbd] = useState<Sgbd | ''>(base?.banco.sgbd ?? '');

  const submeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    const entrada = {
      ambiente: String(dados.get('ambiente')) as AmbienteBase,
      url: String(dados.get('url') ?? '').trim(),
      usuario: String(dados.get('usuario') ?? '').trim(),
      monitorar: dados.get('monitorar') === 'on',
      ordem: base?.ordem ?? 0,
      ...(senha === null ? {} : { senha }),
      // O editor sempre manda o bloco inteiro: aqui todos os campos do banco estão na
      // tela, então o que está no formulário É o estado desejado. Quem omite `banco` é
      // a gravação parcial (o botão "Monitorar"), e é por isso que ela não apaga nada.
      banco: {
        sgbd: String(dados.get('bancoSgbd') ?? '') as Sgbd | '',
        host: String(dados.get('bancoHost') ?? '').trim(),
        porta: Number(dados.get('bancoPorta')) || null,
        servico: String(dados.get('bancoServico') ?? '').trim(),
        esquema: String(dados.get('bancoEsquema') ?? '').trim(),
        usuario: String(dados.get('bancoUsuario') ?? '').trim(),
        ...(senhaBanco === null ? {} : { senha: senhaBanco }),
      },
    };
    setSalvando(true);
    const salvo = await onSalvar(entrada);
    setSalvando(false);
    if (salvo) onFechar();
  };
  return (
    <DialogEditor titulo={base ? 'Editar base' : 'Nova base'} onFechar={onFechar} onSubmit={(event) => void submeter(event)}>
      <div className="modal-body">
        <label className="campo"><span className="campo-nome">Ambiente</span><select name="ambiente" defaultValue={base?.ambiente ?? 'producao'}>{Object.entries(AMBIENTE).map(([valor, rotulo]) => <option value={valor} key={valor}>{rotulo}</option>)}</select></label>
        <CampoEditor nome="url" rotulo="URL" valor={base?.url} tipo="url" obrigatorio />
        <CampoEditor nome="usuario" rotulo="Usuário" valor={base?.usuario} />
        <CampoEditor nome="senha" rotulo="Senha" tipo="password" aoMudar={setSenha}>
          <small className="campo-dica">{base?.temSenha ? 'Deixe em branco para manter a que está guardada. Digite e apague para remover.' : 'A senha será cifrada pelo helper do Windows.'}</small>
        </CampoEditor>
        <label className="campo-inline"><input name="monitorar" type="checkbox" defaultChecked={base?.monitorar ?? true} /> Monitorar esta base</label>

        <fieldset className="grupo-campos">
          <legend>Banco de dados</legend>
          <p className="campo-dica">
            Anotação de consulta: o painel não abre conexão com o banco do cliente. Deixe em branco o que não souber.
          </p>
          <label className="campo">
            <span className="campo-nome">SGBD</span>
            <select name="bancoSgbd" defaultValue={base?.banco.sgbd ?? ''} onChange={(event) => setSgbd(event.target.value as Sgbd | '')}>
              <option value="">Não informado</option>
              {Object.entries(SGBD).map(([valor, rotulo]) => <option value={valor} key={valor}>{rotulo}</option>)}
            </select>
          </label>
          <CampoEditor nome="bancoHost" rotulo="Host" valor={base?.banco.host} />
          <label className="campo">
            <span className="campo-nome">Porta</span>
            <input
              name="bancoPorta"
              type="number"
              min={1}
              max={65535}
              defaultValue={base?.banco.porta ?? ''}
              placeholder={sgbd ? PORTA_PADRAO[sgbd] : ''}
              autoComplete="off"
            />
          </label>
          <CampoEditor nome="bancoServico" rotulo="Serviço / SID / Database" valor={base?.banco.servico} />
          <CampoEditor nome="bancoEsquema" rotulo="Esquema" valor={base?.banco.esquema}>
            <small className="campo-dica">Owner dos objetos do Sankhya, normalmente SANKHYA.</small>
          </CampoEditor>
          <CampoEditor nome="bancoUsuario" rotulo="Usuário do banco" valor={base?.banco.usuario} />
          <CampoEditor nome="bancoSenha" rotulo="Senha do banco" tipo="password" aoMudar={setSenhaBanco}>
            <small className="campo-dica">{base?.banco.temSenha ? 'Deixe em branco para manter a que está guardada. Digite e apague para remover.' : 'A senha será cifrada pelo helper do Windows.'}</small>
          </CampoEditor>
        </fieldset>
      </div>
      <div className="modal-foot"><div className="modal-acoes"><button className="btn tiny ghost" type="button" onClick={onFechar}>Cancelar</button><button className="btn tiny" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar base'}</button></div></div>
    </DialogEditor>
  );
}

function EditorRepo({ repo, onFechar, onSalvar }: {
  repo: RepoCliente | null;
  onFechar: () => void;
  onSalvar: (entrada: { nome: string; remoto: string; caminhoLocal: string; ordem: number }) => Promise<unknown>;
}) {
  const [caminho, setCaminho] = useState(repo?.caminhoLocal ?? '');
  const [seletor, setSeletor] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const submeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    setSalvando(true);
    const salvo = await onSalvar({
      nome: String(dados.get('nome') ?? '').trim(),
      remoto: String(dados.get('remoto') ?? '').trim(),
      caminhoLocal: caminho.trim(),
      ordem: repo?.ordem ?? 0,
    });
    setSalvando(false);
    if (salvo) onFechar();
  };
  return (
    <>
      <DialogEditor titulo={repo ? 'Editar repositório' : 'Novo repositório'} onFechar={onFechar} onSubmit={(event) => void submeter(event)}>
        <div className="modal-body">
          <CampoEditor nome="nome" rotulo="Nome" valor={repo?.nome}><small className="campo-dica">Vazio usa o nome da pasta.</small></CampoEditor>
          <CampoEditor nome="remoto" rotulo="URL do remoto" valor={repo?.remoto} tipo="url" />
          <label className="campo"><span className="campo-nome">Caminho local <span className="selo falta">obrigatório</span></span><div className="campo-linha"><input value={caminho} onChange={(event) => setCaminho(event.target.value)} required /><button className="btn tiny ghost" type="button" onClick={() => setSeletor(true)}>Procurar…</button></div></label>
        </div>
        <div className="modal-foot"><div className="modal-acoes"><button className="btn tiny ghost" type="button" onClick={onFechar}>Cancelar</button><button className="btn tiny" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar repositório'}</button></div></div>
      </DialogEditor>
      <SeletorPasta aberto={seletor} inicial={caminho} onEscolher={setCaminho} onFechar={() => setSeletor(false)} />
    </>
  );
}

function EditorLink({ link, onFechar, onSalvar }: {
  link: LinkCliente | null;
  onFechar: () => void;
  onSalvar: (entrada: { titulo: string; url: string; ordem: number }) => Promise<unknown>;
}) {
  const [salvando, setSalvando] = useState(false);
  const submeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    setSalvando(true);
    const salvo = await onSalvar({ titulo: String(dados.get('titulo') ?? '').trim(), url: String(dados.get('url') ?? '').trim(), ordem: link?.ordem ?? 0 });
    setSalvando(false);
    if (salvo) onFechar();
  };
  return (
    <DialogEditor titulo={link ? 'Editar link' : 'Novo link'} onFechar={onFechar} onSubmit={(event) => void submeter(event)}>
      <div className="modal-body"><CampoEditor nome="titulo" rotulo="Título" valor={link?.titulo} obrigatorio /><CampoEditor nome="url" rotulo="URL" valor={link?.url} tipo="url" obrigatorio /></div>
      <div className="modal-foot"><div className="modal-acoes"><button className="btn tiny ghost" type="button" onClick={onFechar}>Cancelar</button><button className="btn tiny" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar link'}</button></div></div>
    </DialogEditor>
  );
}

function nomePasta(caminho: string): string {
  return caminho.split(/[\\/]/).filter(Boolean).pop() || caminho;
}

function branchDoRemoto(remoto: string): string | undefined {
  const trecho = /\/-\/tree\/([^?#/]+)|\/tree\/([^?#/]+)/.exec(remoto);
  const valor = trecho?.[1] ?? trecho?.[2];
  return valor ? decodeURIComponent(valor) : undefined;
}
