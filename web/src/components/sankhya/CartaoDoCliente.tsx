import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AmbienteBase,
  BaseCliente,
  Cliente,
  ClienteEntrada,
  LinkCliente,
  RepoCliente,
  StatusBase,
} from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { useCartaoCliente } from '../../hooks/useCartaoCliente.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import { mesmoCaminho, StatusRepoCompacto } from '../git/DetalheRepo.tsx';
import { SeletorPasta } from './SeletorPasta.tsx';

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
  const [anotacoes, setAnotacoes] = useState(cliente.anotacoes);
  const [salvandoAnotacoes, setSalvandoAnotacoes] = useState(false);

  useEffect(() => setAnotacoes(cliente.anotacoes), [cliente.anotacoes]);

  const esconderSenha = (id: number) => setSenhas((atuais) => {
    const proximas = { ...atuais };
    delete proximas[id];
    return proximas;
  });

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

  const salvarAnotacoes = async () => {
    setSalvandoAnotacoes(true);
    try {
      await onSalvarCliente({ ...cliente, anotacoes });
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

      <Secao titulo="Bases" onAdicionar={() => setEditor({ tipo: 'base', item: null })}>
        {dados.cartao.bases.length === 0 && <Vazio>Nenhuma base cadastrada para este cliente.</Vazio>}
        {dados.cartao.bases.map((base) => (
          <BaseLinha
            key={base.id}
            base={base}
            status={dados.statusBases[base.id]}
            medindo={dados.medindo.has(base.id)}
            senha={senhas[base.id]}
            onSenha={() => void alternarSenha(base)}
            onCopiar={() => void copiarSenha(base)}
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

      <section className="cartao-secao anotacoes-cliente">
        <div className="cartao-secao-head"><h3>Anotações</h3></div>
        <textarea
          value={anotacoes}
          onChange={(event) => setAnotacoes(event.target.value)}
          placeholder="Anotações avulsas sobre o cliente: contatos, particularidades, combinados."
          rows={5}
        />
        <div className="cartao-anotacoes-foot">
          <span>{anotacoes === cliente.anotacoes ? 'Sem alterações' : 'Alterações ainda não salvas'}</span>
          <button className="btn tiny" disabled={salvandoAnotacoes || anotacoes === cliente.anotacoes} onClick={() => void salvarAnotacoes()}>
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
  onSenha,
  onCopiar,
  onMedir,
  onMonitorar,
  onEditar,
  onRemover,
}: {
  base: BaseCliente;
  status?: StatusBase;
  medindo: boolean;
  senha?: string;
  onSenha: () => void;
  onCopiar: () => void;
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
