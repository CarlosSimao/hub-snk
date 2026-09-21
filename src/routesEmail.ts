/**
 * E-mail interno: contatos (GP/consultor/lider) por cliente, configuracao global do SMTP
 * e dos dois contatos fixos, e o envio propriamente dito.
 *
 * Enviar e uma acao irreversivel (manda e-mail de verdade) — por isso fica em POST,
 * pede assunto e corpo explicitos, e a tela pede confirmacao antes de chamar a rota.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError } from './sankhya/helper.ts';
import { SessaoExpiradaError, type Experience } from './sankhya/experience.ts';
import { EvidenciaUsoError } from './evidenciaIa.ts';
import { paraLembrar, type ResumoAnotacoes } from './resumoAnotacoes.ts';
import type { EmailInterno } from './sankhya/emailInterno.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { CartaoClientes } from './sankhya/cartao.ts';
import { documentosDoCliente, tipoMime } from './documentosEntrega.ts';
import { readFileSync } from 'node:fs';
import {
  PAPEIS_CONTATO_EMAIL,
  type AgenteIA,
  type AnexoEmail,
  type ContatoEmailClienteEntrada,
  type PapelContatoEmail,
} from './types.ts';

/** Um arquivo de tamanho normal em base64 — bem acima do que um documento de entrega pesa. */
const LIMITE_ANEXO_BYTES = 20 * 1024 * 1024;

const AGENTES_IA = ['auto', 'claude', 'codex', 'opencode'] as const;
function ehAgenteIA(valor: unknown): valor is AgenteIA {
  return typeof valor === 'string' && (AGENTES_IA as readonly string[]).includes(valor);
}

/** Um dia `YYYY-MM-DD`. */
function ehDia(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export interface RouteEmailDeps {
  /** Cartao do cliente — e dele que saem os repositorios onde os documentos moram. */
  cartao: CartaoClientes;
  /** Resumo diario das anotacoes — so' para o disparo manual da tela. */
  resumo?: ResumoAnotacoes;
  emailInterno: EmailInterno;
  clientes: Clientes;
  experience: Experience;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  // Geracao nativa da evidencia (Fase 3): periodo sem commit e caminho que nao e
  // repositorio sao erro do usuario. O helper devolvia 400/404 nesses casos, e cair no
  // 502 generico aqui esconderia o motivo.
  if (err instanceof EvidenciaUsoError) {
    return reply.code(400).send({ error: err.message });
  }
  if (err instanceof SessaoExpiradaError) {
    return reply.code(409).send({ error: err.message, sessaoExpirada: true });
  }
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  return reply.code(502).send({ error: (err as Error).message });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ehPapel(valor: unknown): valor is PapelContatoEmail {
  return typeof valor === 'string' && (PAPEIS_CONTATO_EMAIL as readonly string[]).includes(valor);
}

/** Valida e normaliza a lista de contatos do corpo da requisicao. `null` quando invalida. */
function lerContatos(corpo: unknown): ContatoEmailClienteEntrada[] | null {
  const dados = (corpo ?? {}) as { contatos?: unknown };
  if (!Array.isArray(dados.contatos)) return null;

  const contatos: ContatoEmailClienteEntrada[] = [];
  for (const item of dados.contatos) {
    const linha = (item ?? {}) as { papel?: unknown; nome?: unknown; email?: unknown };
    const papel = ehPapel(linha.papel) ? linha.papel : null;
    const nome = typeof linha.nome === 'string' ? linha.nome.trim() : '';
    const email = typeof linha.email === 'string' ? linha.email.trim() : '';
    if (!papel) return null;
    if (email && !EMAIL_REGEX.test(email)) return null;
    contatos.push({ papel, nome, email });
  }
  return contatos;
}

export function registerRoutesEmail(app: FastifyInstance, deps: RouteEmailDeps): void {
  const { emailInterno, clientes, experience, resumo, cartao } = deps;

  app.get<{ Params: { id: string } }>('/api/clientes/:id/email/contatos', async (request, reply) => {
    const clienteId = Number(request.params.id);
    if (!clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });
    return { contatos: emailInterno.contatos(clienteId) };
  });

  app.put<{ Params: { id: string } }>('/api/clientes/:id/email/contatos', async (request, reply) => {
    const clienteId = Number(request.params.id);
    if (!clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });

    const contatos = lerContatos(request.body);
    if (!contatos) return reply.code(400).send({ error: 'envie { contatos: [{ papel, nome, email }] }' });

    return { contatos: emailInterno.salvarContatos(clienteId, contatos) };
  });

  /**
   * Sugestao de NOME (nunca e-mail) a partir das OS mais recentes do cliente na
   * Experience. Melhor esforco: sem projeto vinculado, devolve lista vazia em vez de erro
   * — o cadastro manual continua funcionando sem Experience nenhuma.
   */
/**
   * Documentos de entrega ja' gerados nos repositorios do cliente.
   *
   * A tela de e-mail usa para oferecer o anexo pronto logo depois de a skill gerar o
   * documento — e e' esta lista que autoriza o envio: caminho que nao esta' aqui nao
   * vira anexo (ver a rota de envio).
   */
  app.get<{ Params: { id: string } }>('/api/clientes/:id/email/documentos', async (request, reply) => {
    const clienteId = Number(request.params.id);
    if (!clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });
    return { documentos: documentosDoCliente(cartao, clienteId) };
  });

  app.get<{ Params: { id: string } }>('/api/clientes/:id/email/sugestao', async (request, reply) => {
    const cliente = clientes.obter(Number(request.params.id));
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });
    if (!cliente.experienceProjetoId) return { sugestoes: [] };

    try {
      return { sugestoes: await emailInterno.sugestaoContatos(experience, cliente.experienceProjetoId) };
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.get('/api/config/email', async (_request, _reply) => {
    return emailInterno.obterConfig();
  });

  app.post<{
    Body: {
      smtpHost?: unknown;
      smtpPorta?: unknown;
      smtpUsuario?: unknown;
      smtpRemetente?: unknown;
      smtpSenha?: unknown;
      assinatura?: unknown;
      liderImediato?: unknown;
      responsavelOrcamento?: unknown;
      resumoAnotacoes?: unknown;
    };
  }>('/api/config/email', async (request, reply) => {
    const corpo = request.body ?? {};
    const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');
    const contatoFixo = (valor: unknown) => {
      const item = (valor ?? {}) as { nome?: unknown; email?: unknown };
      return { nome: texto(item.nome), email: texto(item.email) };
    };

    const liderImediato = contatoFixo(corpo.liderImediato);
    const responsavelOrcamento = contatoFixo(corpo.responsavelOrcamento);
    for (const contato of [liderImediato, responsavelOrcamento]) {
      if (contato.email && !EMAIL_REGEX.test(contato.email)) {
        return reply.code(400).send({ error: `e-mail inválido: ${contato.email}` });
      }
    }

    const smtpUsuario = texto(corpo.smtpUsuario);
    if (smtpUsuario && !EMAIL_REGEX.test(smtpUsuario)) {
      return reply.code(400).send({ error: `e-mail inválido: ${smtpUsuario}` });
    }

    const senha = typeof corpo.smtpSenha === 'string' ? corpo.smtpSenha : undefined;

    // Hora do resumo diario das anotacoes. Formato errado vira erro de tela, nao um
    // agendamento silenciosamente morto.
    const bruto = (corpo.resumoAnotacoes ?? {}) as { ativo?: unknown; hora?: unknown };
    const hora = typeof bruto.hora === 'string' && bruto.hora.trim() ? bruto.hora.trim() : '08:00';
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(hora)) {
      return reply.code(400).send({ error: `horário inválido: ${hora} — use HH:MM` });
    }
    const resumo = { ativo: bruto.ativo === true, hora };

    try {
      const config = await emailInterno.salvarConfig(
        {
          smtpHost: texto(corpo.smtpHost) || 'smtp.gmail.com',
          smtpPorta: Number(corpo.smtpPorta) || 465,
          smtpUsuario,
          smtpRemetente: texto(corpo.smtpRemetente),
          assinatura: typeof corpo.assinatura === 'string' ? corpo.assinatura : '',
          resumoAnotacoes: resumo,
          liderImediato,
          responsavelOrcamento,
        },
        senha,
      );
      return config;
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.post('/api/config/email/testar', async (_request, reply) => {
    try {
      const resultado = await emailInterno.testarConexao();
      return resultado.ok ? resultado : reply.code(502).send(resultado);
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.post<{
    Params: { id: string };
    Body: { assunto?: unknown; corpo?: unknown; anexo?: unknown; documentos?: unknown };
  }>(
    '/api/clientes/:id/email/enviar',
    // Corpo maior que o padrão do Fastify por causa do anexo em base64 — só nesta rota,
    // as demais continuam com o limite padrão.
    { bodyLimit: LIMITE_ANEXO_BYTES },
    async (request, reply) => {
      const clienteId = Number(request.params.id);
      if (!clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });

      const assunto = typeof request.body?.assunto === 'string' ? request.body.assunto.trim() : '';
      const corpo = typeof request.body?.corpo === 'string' ? request.body.corpo.trim() : '';
      if (!assunto || !corpo) return reply.code(400).send({ error: 'envie { assunto, corpo }, sem vazio' });

      const anexo = lerAnexo(request.body?.anexo);
      if (anexo === false) {
        return reply.code(400).send({ error: 'anexo inválido — envie { nomeArquivo, tipoMime, conteudoBase64 }' });
      }

      // Os documentos vem por CAMINHO, e cada um e' conferido contra a lista real do
      // cliente antes de ser lido. Sem essa conferencia, a rota viraria um jeito de
      // mandar qualquer arquivo da maquina por e-mail informando o caminho.
      const pedidos = Array.isArray(request.body?.documentos)
        ? (request.body.documentos as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];

      const disponiveis = new Map(documentosDoCliente(cartao, clienteId).map((doc) => [doc.caminho, doc]));
      const anexos: AnexoEmail[] = [];
      for (const caminho of pedidos) {
        const documento = disponiveis.get(caminho);
        if (!documento) return reply.code(400).send({ error: `documento não é deste cliente: ${caminho}` });
        try {
          anexos.push({
            nomeArquivo: documento.nome,
            tipoMime: tipoMime(documento.nome),
            conteudoBase64: readFileSync(documento.caminho).toString('base64'),
          });
        } catch (err) {
          return reply.code(409).send({ error: `não consegui ler ${documento.nome}: ${(err as Error).message}` });
        }
      }

      try {
        const resultado = await emailInterno.enviar(clienteId, {
          assunto,
          corpo,
          ...(anexo ? { anexo } : {}),
          ...(anexos.length ? { anexos } : {}),
        });
        return { ok: true, ...resultado };
      } catch (err) {
        if (err instanceof HelperError || err instanceof HelperIndisponivelError || err instanceof SessaoExpiradaError) {
          return responderErro(reply, err);
        }
        return reply.code(502).send({ error: (err as Error).message });
      }
    },
  );

  /**
   * Resumo por IA a partir de commits/diff de um repositório, num período — o `caminho`
   * vem do cartão do cliente (a tela já sabe os repositórios cadastrados), não é validado
   * contra o cadastro aqui: quem lê o diff de verdade é o `hub-helper.ps1`, do lado de
   * fora do container, sobre um caminho do sistema de arquivos do Windows.
   */
  app.post<{
    Params: { id: string };
    Body: { caminho?: unknown; desde?: unknown; ate?: unknown; agente?: unknown };
  }>('/api/clientes/:id/email/evidencia', async (request, reply) => {
    if (!clientes.obter(Number(request.params.id))) {
      return reply.code(404).send({ error: 'cliente não encontrado' });
    }

    const caminho = typeof request.body?.caminho === 'string' ? request.body.caminho.trim() : '';
    const desde = request.body?.desde;
    const ate = request.body?.ate;
    if (!caminho) return reply.code(400).send({ error: 'envie { caminho }' });
    if (!ehDia(desde) || !ehDia(ate)) return reply.code(400).send({ error: 'envie { desde, ate } em YYYY-MM-DD' });

    const agente = ehAgenteIA(request.body?.agente) ? request.body.agente : 'auto';

    try {
      return await emailInterno.gerarEvidencia(caminho, desde, ate, agente);
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  /**
   * As anotacoes que pedem lembrete, para o shell avisar na abertura.
   *
   * Fica aqui, e nao em `/api/clientes`, porque o shell so precisa disto: nome e texto,
   * sem o cadastro inteiro de cada cliente.
   */
  app.get('/api/email/lembretes', async () => ({
    lembretes: paraLembrar(clientes.listar()).map((c) => ({
      id: c.id,
      nome: c.nome,
      anotacoes: c.anotacoes.trim(),
    })),
  }));

  /** O texto que o resumo de hoje teria, sem enviar nada. */
  app.get('/api/email/resumo/previa', async (_request, reply) => {
    if (!resumo) return reply.code(503).send({ error: 'resumo não disponível nesta instância' });
    try {
      return await resumo.previa();
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  /** Dispara o resumo agora, ignorando horario e o "ja enviei hoje" — botao de teste. */
  app.post('/api/email/resumo/testar', async (_request, reply) => {
    if (!resumo) return reply.code(503).send({ error: 'resumo não disponível nesta instância' });
    try {
      return await resumo.tentarEnviar(new Date(), true);
    } catch (err) {
      return responderErro(reply, err);
    }
  });
}

/** `undefined` = sem anexo (valido). `false` = veio algo, mas invalido. */
function lerAnexo(valor: unknown): AnexoEmail | undefined | false {
  if (valor === undefined) return undefined;
  const item = (valor ?? {}) as { nomeArquivo?: unknown; tipoMime?: unknown; conteudoBase64?: unknown };
  const nomeArquivo = typeof item.nomeArquivo === 'string' ? item.nomeArquivo.trim() : '';
  const conteudoBase64 = typeof item.conteudoBase64 === 'string' ? item.conteudoBase64 : '';
  if (!nomeArquivo || !conteudoBase64) return false;
  return { nomeArquivo, tipoMime: typeof item.tipoMime === 'string' ? item.tipoMime : '', conteudoBase64 };

}
