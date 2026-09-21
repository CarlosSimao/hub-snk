/**
 * E-mail interno: GP, consultor e lider de cada cliente, mais os dois contatos fixos
 * (lider imediato, responsavel pelo orcamento) que entram em TODO envio.
 *
 * Mesmo banco (`sankhya.db`) e mesmo mecanismo de senha de `cartao.ts`: a senha do app
 * do Gmail e cifrada pelo `hub-helper.ps1` (DPAPI) via `/secret/encrypt`, nunca gravada
 * em claro, e so decifrada aqui dentro, na hora de montar o transporte SMTP — nao existe
 * rota que devolva a senha, do mesmo jeito que `Credenciais.revelar()`.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { HubHelper } from './helper.ts';
import { Cifra } from './cifra.ts';
import type { EvidenciaIa } from '../evidenciaIa.ts';

import type { Experience } from './experience.ts';
import {
  PAPEIS_CONTATO_EMAIL,
  type AgenteIA,
  type AnexoEmail,
  type ConfigEmail,
  type ConfigEmailEntrada,
  type ContatoEmailCliente,
  type ContatoEmailClienteEntrada,
  type PapelContatoEmail,
  type SugestaoContatoEmail,
} from '../types.ts';

/** So o suficiente do transporte do nodemailer para o modulo funcionar e o teste trocar por um fake. */
export interface TransporteEmail {
  verify(): Promise<true>;
  sendMail(mensagem: {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  }): Promise<unknown>;
}

export type FabricaTransporte = (opcoes: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => TransporteEmail;

const FABRICA_PADRAO: FabricaTransporte = (opcoes) =>
  nodemailer.createTransport(opcoes) as unknown as TransporteEmail;

function ehPapel(valor: string): valor is PapelContatoEmail {
  return (PAPEIS_CONTATO_EMAIL as readonly string[]).includes(valor);
}

export class EmailInterno {
  readonly #db: DatabaseSync;
  readonly #helper: HubHelper;
  readonly #cifra: Cifra;
  readonly #evidencia: EvidenciaIa | undefined;
  readonly #criarTransporte: FabricaTransporte;

  constructor(
    dataDir: string,
    helper: HubHelper,
    criarTransporte: FabricaTransporte = FABRICA_PADRAO,
    cifra?: Cifra,
    evidencia?: EvidenciaIa,
  ) {
    mkdirSync(dataDir, { recursive: true });
    // Mesmo arquivo que `Clientes` — as tabelas sao criadas la, junto do resto do schema.
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#helper = helper;
    // Sem `cifra`, o comportamento e' exatamente o de antes: tudo pelo helper.
    this.#cifra = cifra ?? new Cifra(helper);
    // Sem `evidencia`, o caminho e o de antes: gerar pelo hub-helper.ps1.
    this.#evidencia = evidencia;
    this.#criarTransporte = criarTransporte;
  }

  /* ------------------------------ contatos -------------------------------- */

  contatos(clienteId: number): ContatoEmailCliente[] {
    const linhas = this.#db
      .prepare('SELECT * FROM cliente_contatos_email WHERE cliente_id = ? ORDER BY ordem, id')
      .all(clienteId) as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      clienteId: Number(l['cliente_id']),
      papel: ehPapel(String(l['papel'])) ? (String(l['papel']) as PapelContatoEmail) : 'consultor',
      nome: String(l['nome']),
      email: String(l['email']),
      ordem: Number(l['ordem']),
    }));
  }

  /**
   * Substitui a lista inteira de contatos do cliente — nao e CRUD linha a linha.
   *
   * A tela edita um rascunho local e manda tudo de uma vez no Salvar (mesmo espirito do
   * `definirHorarios` do git-autosync): mais simples que replicar o CRUD de bases/repos
   * para uma lista pequena que troca inteira a cada edicao.
   */
  salvarContatos(clienteId: number, lista: ContatoEmailClienteEntrada[]): ContatoEmailCliente[] {
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare('DELETE FROM cliente_contatos_email WHERE cliente_id = ?').run(clienteId);
      const inserir = this.#db.prepare(
        `INSERT INTO cliente_contatos_email (cliente_id, papel, nome, email, ordem)
         VALUES (?, ?, ?, ?, ?)`,
      );
      lista.forEach((contato, indice) => {
        inserir.run(clienteId, contato.papel, contato.nome, contato.email, indice);
      });
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    return this.contatos(clienteId);
  }

  /**
   * Melhor esforco: nome de quem aparece como coordenador/lancador nas OS mais recentes
   * do cliente na Experience. NUNCA e-mail — nenhuma fonte hoje devolve nome e e-mail
   * casados para GP/consultor/lider (so para aprovador do lado do cliente). Quem usa a
   * sugestao completa o e-mail e escolhe o papel na tela.
   */
  async sugestaoContatos(
    experience: Experience,
    projetoId: number,
    janelaDias = 120,
  ): Promise<SugestaoContatoEmail[]> {
    const hoje = new Date();
    const ate = hoje.toISOString().slice(0, 10);
    const de = new Date(hoje.getTime() - janelaDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const ordens = await experience.ordens(projetoId, null, de, ate);
    const nomes: string[] = [];
    for (const ordem of [...ordens].sort((a, b) => b.dia.localeCompare(a.dia))) {
      for (const nome of [ordem.coordenador, ordem.pessoa]) {
        if (nome && !nomes.includes(nome)) nomes.push(nome);
      }
    }
    return nomes.slice(0, 5).map((nome) => ({ nome }));
  }

  /* -------------------------- configuracao global -------------------------- */

  obterConfig(): ConfigEmail {
    const linha = this.#linhaConfig();
    return {
      smtpHost: String(linha['smtp_host']),
      smtpPorta: Number(linha['smtp_porta']),
      smtpUsuario: String(linha['smtp_usuario']),
      smtpRemetente: String(linha['smtp_remetente']),
      temSenha: String(linha['smtp_senha_cifrada']) !== '',
      assinatura: String(linha['assinatura']),
      liderImediato: { nome: String(linha['lider_nome']), email: String(linha['lider_email']) },
      responsavelOrcamento: { nome: String(linha['orcamento_nome']), email: String(linha['orcamento_email']) },
      resumoAnotacoes: {
        ativo: Number(linha['resumo_ativo'] ?? 0) === 1,
        hora: String(linha['resumo_hora'] ?? '08:00'),
      },
    };
  }

  /** `senha` ausente = mantem a cifrada atual; `''` = apaga; valor = cifra e grava. */
  async salvarConfig(entrada: ConfigEmailEntrada, senha?: string): Promise<ConfigEmail> {
    this.#garantirLinhaConfig();
    const cifrada = await this.#cifrarOpcional(senha);

    this.#db
      .prepare(
        `UPDATE email_config
            SET smtp_host = ?, smtp_porta = ?, smtp_usuario = ?, smtp_remetente = ?, assinatura = ?,
                lider_nome = ?, lider_email = ?, orcamento_nome = ?, orcamento_email = ?,
                resumo_ativo = ?, resumo_hora = ?
                ${cifrada === undefined ? '' : ', smtp_senha_cifrada = ?'}
          WHERE id = 1`,
      )
      .run(
        entrada.smtpHost,
        entrada.smtpPorta,
        entrada.smtpUsuario,
        entrada.smtpRemetente,
        entrada.assinatura,
        entrada.liderImediato.nome,
        entrada.liderImediato.email,
        entrada.responsavelOrcamento.nome,
        entrada.responsavelOrcamento.email,
        entrada.resumoAnotacoes.ativo ? 1 : 0,
        entrada.resumoAnotacoes.hora,
        ...(cifrada === undefined ? [] : [cifrada]),
      );

    return this.obterConfig();
  }

  /** So testa a conexao (`verify`) — nao manda e-mail nenhum. */
  async testarConexao(): Promise<{ ok: boolean; mensagem: string }> {
    try {
      const transporte = await this.#transporte();
      if (!transporte) return { ok: false, mensagem: 'configure host, usuário e senha antes de testar' };
      await transporte.verify();
      return { ok: true, mensagem: 'conexão SMTP ok' };
    } catch (err) {
      return { ok: false, mensagem: (err as Error).message };
    }
  }

  /**
   * Manda o e-mail para os contatos do cliente + os dois fixos.
   *
   * Os fixos entram aqui, nao so na tela: e a regra de negocio "sempre vao os dois", como
   * rede de seguranca contra uma tela que esqueca de manda-los. Dedupe por e-mail em
   * minusculo evita destinatario duplicado quando um contato do cliente e tambem um fixo.
   */
  /**
   * Envia para UM endereco explicito, sem passar pelos contatos do cliente.
   *
   * O `enviar` normal monta a lista a partir do cadastro (GP, consultor, lider). O
   * resumo diario das anotacoes e' outra coisa: e' lembrete pessoal de quem usa o hub,
   * e vai so' para o e-mail configurado no SMTP.
   */
  async enviarPara(destinatario: string, mensagem: { assunto: string; corpo: string }): Promise<void> {
    const transporte = await this.#transporte();
    if (!transporte) throw new Error('e-mail não configurado — configure o SMTP antes de enviar');
    if (!destinatario.trim()) throw new Error('sem destinatário para o resumo');

    const config = this.obterConfig();
    const remetente = config.smtpRemetente
      ? `"${config.smtpRemetente}" <${config.smtpUsuario}>`
      : config.smtpUsuario;

    await transporte.sendMail({
      from: remetente,
      to: destinatario,
      subject: mensagem.assunto,
      text: config.assinatura ? `${mensagem.corpo}

--
${config.assinatura}` : mensagem.corpo,
    });
  }

  /** Data (YYYY-MM-DD) do ultimo resumo enviado; vazio quando nunca houve. */
  ultimoResumoEm(): string {
    return String(this.#linhaConfig()['resumo_enviado_em'] ?? '');
  }

  registrarResumoEnviado(dia: string): void {
    this.#garantirLinhaConfig();
    this.#db.prepare('UPDATE email_config SET resumo_enviado_em = ? WHERE id = 1').run(dia);
  }

  async enviar(
    clienteId: number,
    mensagem: { assunto: string; corpo: string; anexo?: AnexoEmail },
  ): Promise<{ destinatarios: string[] }> {
    const transporte = await this.#transporte();
    if (!transporte) throw new Error('e-mail não configurado — configure o SMTP antes de enviar');

    const config = this.obterConfig();
    const candidatos = [
      ...this.contatos(clienteId).map((c) => ({ nome: c.nome, email: c.email })),
      config.liderImediato,
      config.responsavelOrcamento,
    ];

    const vistos = new Set<string>();
    const destinatarios: string[] = [];
    for (const candidato of candidatos) {
      const email = candidato.email.trim();
      if (!email) continue;
      const chave = email.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      destinatarios.push(email);
    }

    if (destinatarios.length === 0) {
      throw new Error('nenhum destinatário com e-mail cadastrado');
    }

    const remetente = config.smtpRemetente
      ? `"${config.smtpRemetente}" <${config.smtpUsuario}>`
      : config.smtpUsuario;

    // A assinatura mora na config, nao no corpo digitado: quem escreve o e-mail nao
    // precisa colar a mesma assinatura toda hora, e trocar a assinatura nao exige reeditar
    // e-mails em rascunho.
    const corpo = config.assinatura ? `${mensagem.corpo}\n\n--\n${config.assinatura}` : mensagem.corpo;

    await transporte.sendMail({
      from: remetente,
      to: destinatarios.join(', '),
      subject: mensagem.assunto,
      text: corpo,
      ...(mensagem.anexo
        ? {
            attachments: [
              {
                filename: mensagem.anexo.nomeArquivo,
                content: Buffer.from(mensagem.anexo.conteudoBase64, 'base64'),
                contentType: mensagem.anexo.tipoMime || undefined,
              },
            ],
          }
        : {}),
    });

    return { destinatarios };
  }

  /**
   * Resumo do que foi feito no repositorio, num periodo, gerado pelo agente de IA ja
   * configurado no git-autosync (mesma preferencia da tela "Mensagem do commit
   * automático") — nao existe uma segunda configuracao de agente so para isto.
   *
   * Quem le o diff e monta o prompt e o `hub-helper.ps1` (`POST ia/evidencia`): o commit
   * e o diff nunca saem da maquina do usuario para o container, so o texto final volta.
   */
  async gerarEvidencia(
    caminho: string,
    desde: string,
    ate: string,
    agente: AgenteIA,
  ): Promise<{ texto: string }> {
    // Nativo no Windows roda o agente aqui mesmo; em container continua pelo helper.
    if (this.#evidencia) {
      return { texto: await this.#evidencia.gerar(caminho, desde, ate, agente) };
    }

    return this.#helper.requisitar<{ texto: string }>(
      '/ia/evidencia',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caminho, desde, ate, agente }),
      },
      // O agente local pode levar até 120s (mesmo timeout do `hub-helper.ps1`); o
      // timeout padrão do helper (10s, pensado para consulta rápida) sempre estouraria.
      { timeoutMs: 130_000 },
    );
  }

  close(): void {
    this.#db.close();
  }

  /* -------------------------------- helpers -------------------------------- */

  #linhaConfig(): Record<string, unknown> {
    this.#garantirLinhaConfig();
    return this.#db.prepare('SELECT * FROM email_config WHERE id = 1').get() as unknown as Record<
      string,
      unknown
    >;
  }

  #garantirLinhaConfig(): void {
    this.#db.exec('INSERT OR IGNORE INTO email_config (id) VALUES (1)');
  }

  /** Monta o transporte a partir da config gravada; `null` quando falta host/usuario/senha. */
  async #transporte(): Promise<TransporteEmail | null> {
    const linha = this.#linhaConfig();
    const host = String(linha['smtp_host']);
    const usuario = String(linha['smtp_usuario']);
    const cifrada = String(linha['smtp_senha_cifrada']);
    if (!host || !usuario || !cifrada) return null;

    const senha = await this.#decifrar(cifrada);
    if (!senha) return null;

    const porta = Number(linha['smtp_porta']) || 465;
    return this.#criarTransporte({
      host,
      port: porta,
      secure: porta === 465,
      auth: { user: usuario, pass: senha },
    });
  }

  /** `undefined` passa direto (= nao mexe) e `''` tambem (= apaga), sem chamar o helper. */
  async #cifrarOpcional(valor: string | undefined): Promise<string | undefined> {
    if (valor === undefined) return undefined;
    if (valor === '') return '';
    return this.#cifrar(valor);
  }

  #cifrar(valor: string): Promise<string> {
    return this.#cifra.cifrar(valor);
  }

  #decifrar(cifrada: string): Promise<string | null> {
    return this.#cifra.decifrar(cifrada);
  }
}
