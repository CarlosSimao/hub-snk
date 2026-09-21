import { useEffect, useState } from 'react';
import type {
  AgenteIA,
  AnexoEmail,
  Cliente,
  ConfigEmail,
  ContatoEmailCliente,
  ContatoEmailClienteEntrada,
  PapelContatoEmail,
  RepoCliente,
} from '../../types.ts';
import { useCartaoCliente } from '../../hooks/useCartaoCliente.ts';
import { useEmailConfig } from '../../hooks/useEmailConfig.ts';
import { useEmailContatos } from '../../hooks/useEmailContatos.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

const ROTULO_PAPEL: Record<PapelContatoEmail, string> = {
  gp: 'GP',
  consultor: 'Consultor',
  lider: 'Líder',
};

/**
 * E-mail para GP/consultor/líder deste cliente, mais os dois contatos fixos (líder
 * imediato, responsável pelo orçamento) que entram em todo envio, de qualquer cliente.
 *
 * A configuração do SMTP e os dois fixos são globais, não deste cliente — moram aqui
 * porque é onde faz sentido editar antes de mandar, do mesmo jeito que o agendamento do
 * git-autosync mora dentro da aba Git mesmo sendo uma coisa só para o hub inteiro.
 */
export function EmailDoCliente({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const config = useEmailConfig(toast);
  const contatosHook = useEmailContatos(cliente.id, toast);
  const cartao = useCartaoCliente(cliente.id, toast);
  // Mesma preferência de agente já configurada na aba Git (Mensagem do commit
  // automático) — "Gerar texto evidência" usa o modelo já cadastrado, não um segundo.
  const git = useGitAutosync(toast);

  if (config.carregando || contatosHook.carregando) return <p className="detail-empty">Carregando…</p>;

  return (
    <div className="painel">
      <ContatosDoCliente contatosHook={contatosHook} />
      <ComporEnviar
        contatosHook={contatosHook}
        config={config.config}
        cliente={cliente}
        repos={cartao.cartao?.repos ?? []}
        agenteIA={paraAgenteIA(git.visao.ia.agente)}
      />
    </div>
  );
}

function paraEntrada(contato: ContatoEmailCliente): ContatoEmailClienteEntrada {
  return { papel: contato.papel, nome: contato.nome, email: contato.email };
}

/** Mesma lista e mesma regra de dedupe que o backend aplica em `EmailInterno.enviar` — só para mostrar quem vai receber antes de confirmar. */
function juntarDestinatarios(contatos: ContatoEmailCliente[], config: ConfigEmail): string[] {
  const candidatos = [
    ...contatos.map((c) => c.email),
    config.liderImediato.email,
    config.responsavelOrcamento.email,
  ];
  const vistos = new Set<string>();
  const destinatarios: string[] = [];
  for (const bruto of candidatos) {
    const email = bruto.trim();
    if (!email) continue;
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    destinatarios.push(email);
  }
  return destinatarios;
}

function ContatosDoCliente({ contatosHook }: { contatosHook: ReturnType<typeof useEmailContatos> }) {
  const [rascunho, setRascunho] = useState<ContatoEmailClienteEntrada[]>(contatosHook.contatos.map(paraEntrada));
  const [sugerindo, setSugerindo] = useState(false);

  useEffect(() => setRascunho(contatosHook.contatos.map(paraEntrada)), [contatosHook.contatos]);

  const alterar = (indice: number, campo: keyof ContatoEmailClienteEntrada, valor: string) =>
    setRascunho((atuais) => atuais.map((contato, i) => (i === indice ? { ...contato, [campo]: valor } : contato)));
  const remover = (indice: number) => setRascunho((atuais) => atuais.filter((_, i) => i !== indice));

  const sugerir = async () => {
    setSugerindo(true);
    const sugestoes = await contatosHook.sugerir();
    setSugerindo(false);
    if (!sugestoes.length) return;

    setRascunho((atuais) => [
      ...atuais,
      ...sugestoes.map((s) => ({ papel: 'consultor' as PapelContatoEmail, nome: s.nome, email: '' })),
    ]);
  };

  return (
    <section className="card detail-card">
      <div className="detail-head">
        <div className="card-title">
          <h2>Contatos deste cliente</h2>
          <p>GP, consultor e líder — o e-mail é sempre confirmado aqui, nenhuma fonte casa nome com e-mail.</p>
        </div>
      </div>

      <div className="form-campos">
        {rascunho.length === 0 && <p className="detail-empty">Nenhum contato cadastrado ainda.</p>}

        {rascunho.map((contato, indice) => (
          <div className="campo-linha" key={indice}>
            <select value={contato.papel} onChange={(e) => alterar(indice, 'papel', e.target.value)}>
              {Object.entries(ROTULO_PAPEL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
            <input
              placeholder="Nome"
              value={contato.nome}
              onChange={(e) => alterar(indice, 'nome', e.target.value)}
            />
            <input
              placeholder="E-mail"
              value={contato.email}
              onChange={(e) => alterar(indice, 'email', e.target.value)}
            />
            <button className="btn tiny ghost danger" type="button" onClick={() => remover(indice)}>
              Remover
            </button>
          </div>
        ))}

        <div className="form-acoes">
          <button
            className="btn tiny ghost"
            type="button"
            onClick={() => setRascunho((atuais) => [...atuais, { papel: 'consultor', nome: '', email: '' }])}
          >
            Adicionar contato
          </button>
          <button className="btn tiny ghost" type="button" disabled={sugerindo} onClick={() => void sugerir()}>
            {sugerindo ? 'buscando…' : 'Sugerir do Sankhya'}
          </button>
          <span className="modal-acoes-spacer" />
          <button
            className="btn tiny"
            type="button"
            disabled={contatosHook.ocupado}
            onClick={() => void contatosHook.salvarContatos(rascunho)}
          >
            Salvar contatos
          </button>
        </div>
      </div>
    </section>
  );
}

/** `desde`/`até` em `YYYY-MM-DD`, para o `<input type="date">` e para a rota de evidência. */
function paraDataIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

const AGENTES_IA_VALIDOS = new Set<AgenteIA>(['auto', 'claude', 'codex', 'opencode']);
function paraAgenteIA(valor: string): AgenteIA {
  return AGENTES_IA_VALIDOS.has(valor as AgenteIA) ? (valor as AgenteIA) : 'auto';
}

/** `arrayBuffer` -> base64, sem depender de lib nenhuma. */
async function paraBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function ComporEnviar({
  contatosHook,
  config,
  cliente,
  repos,
  agenteIA,
}: {
  contatosHook: ReturnType<typeof useEmailContatos>;
  config: ConfigEmail;
  cliente: Cliente;
  repos: RepoCliente[];
  agenteIA: AgenteIA;
}) {
  // Sugestão editável — o padrão do TECH, não um campo travado.
  const [assunto, setAssunto] = useState(
    `TECH | ID ${cliente.agendaDemandaId || '?'} - ${cliente.nome} - Evidência de Entrega`,
  );
  const [corpo, setCorpo] = useState('');
  const [anexo, setAnexo] = useState<AnexoEmail | null>(null);
  const [anexando, setAnexando] = useState(false);

  const [repoId, setRepoId] = useState<number | ''>(repos[0]?.id ?? '');
  const [desde, setDesde] = useState(() => paraDataIso(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [ate, setAte] = useState(() => paraDataIso(new Date()));
  const [gerando, setGerando] = useState(false);

  const destinatarios = juntarDestinatarios(contatosHook.contatos, config);
  const podeEnviar = config.temSenha && destinatarios.length > 0 && assunto.trim() !== '' && corpo.trim() !== '';

  const repoEscolhido = repos.find((r) => r.id === repoId);

  const aoEscolherArquivo = async (evento: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;

    setAnexando(true);
    try {
      setAnexo({
        nomeArquivo: arquivo.name,
        tipoMime: arquivo.type,
        conteudoBase64: await paraBase64(arquivo),
      });
    } finally {
      setAnexando(false);
    }
  };

  const gerarEvidencia = async () => {
    if (!repoEscolhido) return;
    if (corpo.trim() && !window.confirm('Já há texto na mensagem — substituir pelo resumo gerado?')) return;

    setGerando(true);
    try {
      const texto = await contatosHook.gerarEvidencia({
        caminho: repoEscolhido.caminhoLocal,
        desde,
        ate,
        agente: agenteIA,
      });
      if (texto) setCorpo(texto);
    } finally {
      setGerando(false);
    }
  };

  const enviar = async () => {
    const resumo =
      `Enviar e-mail sobre ${cliente.nome} para:\n${destinatarios.join('\n')}\n\n` +
      `Assunto: ${assunto}` +
      (anexo ? `\nAnexo: ${anexo.nomeArquivo}` : '');
    if (!window.confirm(resumo)) return;

    const enviados = await contatosHook.enviarEmail({
      assunto,
      corpo,
      ...(anexo ? { anexo } : {}),
    });
    if (enviados) {
      setCorpo('');
      setAnexo(null);
    }
  };

  return (
    <section className="card detail-card">
      <div className="card-title">
        <h2>Compor e enviar</h2>
        <p>Vai para: {destinatarios.length ? destinatarios.join(', ') : 'ninguém com e-mail cadastrado ainda'}</p>
      </div>

      <div className="form-campos">
        {repos.length > 0 && (
          <div className="campo-linha">
            <select value={repoId} onChange={(e) => setRepoId(Number(e.target.value))}>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.nome || repo.caminhoLocal}
                </option>
              ))}
            </select>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            <button className="btn tiny ghost" type="button" disabled={gerando} onClick={() => void gerarEvidencia()}>
              {gerando ? 'gerando…' : 'Gerar texto evidência'}
            </button>
          </div>
        )}
        {repos.length === 0 && (
          <p className="detail-empty">
            Sem repositório cadastrado neste cliente — sem ele não dá para gerar o texto de
            evidência a partir dos commits. Adicione um em Cadastro › Repositórios.
          </p>
        )}

        <div className="campo">
          <label className="campo-nome" htmlFor="email-assunto">Assunto</label>
          <input id="email-assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-nome" htmlFor="email-corpo">Mensagem</label>
          <textarea id="email-corpo" rows={8} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
          {config.assinatura && (
            <small className="campo-dica">A assinatura configurada acima entra automaticamente, ao final.</small>
          )}
        </div>

        <div className="campo">
          <label className="campo-nome">Anexo</label>
          {anexo ? (
            <div className="campo-linha">
              <span>{anexo.nomeArquivo}</span>
              <button className="btn tiny ghost danger" type="button" onClick={() => setAnexo(null)}>
                Remover anexo
              </button>
            </div>
          ) : (
            <input type="file" onChange={(e) => void aoEscolherArquivo(e)} disabled={anexando} />
          )}
        </div>

        {!config.temSenha && (
          <div className="warning">
            <span>⚠</span>
            <span>Configure o SMTP na seção acima antes de enviar.</span>
          </div>
        )}

        <div className="form-acoes">
          <span className="modal-acoes-spacer" />
          <button
            className="btn tiny"
            type="button"
            disabled={!podeEnviar || contatosHook.ocupado}
            onClick={() => void enviar()}
          >
            Enviar e-mail
          </button>
        </div>
      </div>
    </section>
  );
}

