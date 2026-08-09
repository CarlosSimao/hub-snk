import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import {
  BaseLocalNaoEncontradaError,
  BancoLocalNaoEncontradoError,
  type RepositorioLocal,
} from '../repositorio/repositorioLocal.ts';
import {
  iniciarWildfly,
  pararWildfly,
  consultarPaginaInicial,
  reiniciarWildfly,
  WildflyComandoFalhouError,
  WildflyIndisponivelError,
  WildflySemPermissaoDeExecucaoError,
  wildflyEstaRodando,
} from '../sistema/wildfly.ts';
import {
  bancoEstaAcessivel,
  containerEstaRodando,
  DockerComandoFalhouError,
  DockerDesktopIndisponivelError,
  iniciarContainer,
  pararContainer,
  reiniciarContainer,
} from '../sistema/docker.ts';
import {
  limparHistorico,
  obterHistorico,
  registrarAmostra,
} from '../sistema/historicoDeSituacaoDoBanco.ts';
import {
  limparHistoricoDaBase,
  obterHistoricoDaBase,
  registrarAmostraDaBase,
} from '../sistema/historicoDeSituacaoDaBase.ts';
import {
  caminhoDoLogDaBase,
  lerDesdePosicao,
  lerFinalDoLog,
  lerNovoTrechoDoLog,
} from '../sistema/logDaBase.ts';
import {
  estadoDoArquivoMcp,
  gravarConfiguracaoMcp,
  lerConfiguracaoMcp,
} from '../sistema/arquivoMcp.ts';
import { PastaNaoEncontradaError } from '../sistema/pasta.ts';
import { esquemaDeConfiguracaoMcp } from './esquemaDeConfiguracaoMcp.ts';
import { createReadStream, existsSync } from 'node:fs';
import type { BancoLocal, BaseLocal } from '../tipos.ts';

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const TAMANHO_MAXIMO_DO_CONTAINER = 200;
const TAMANHO_MAXIMO_DO_HOST = 200;
const TAMANHO_MAXIMO_DO_SERVICO = 200;
const TAMANHO_MAXIMO_DO_USUARIO = 120;
const TAMANHO_MAXIMO_DA_SENHA = 200;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;
const INTERVALO_DE_POLL_DO_LOG_MS = 1000;
const CARACTERES_DE_ACENTO = /[\u0300-\u036f]/g;
const CARACTERES_FORA_DO_NOME_DE_ARQUIVO = /[^a-zA-Z0-9._-]+/g;
const HIFENS_REPETIDOS = /-{2,}/g;
const HIFENS_NAS_PONTAS = /^-|-$/g;

const esquemaDeDadosDeBaseLocal = z.object({
  nome: z
    .string({ required_error: 'Informe o nome da base.' })
    .trim()
    .min(1, 'Informe o nome da base.')
    .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`),
  caminhoWildfly: z
    .string({ required_error: 'Informe o caminho do WildFly.' })
    .trim()
    .min(1, 'Informe o caminho do WildFly.')
    .max(
      TAMANHO_MAXIMO_DO_CAMINHO,
      `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
    ),
  porta: z.coerce
    .number({ invalid_type_error: 'A porta deve ser um número.' })
    .int('A porta deve ser um número inteiro.')
    .min(PORTA_MINIMA, `A porta deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`)
    .max(PORTA_MAXIMA, `A porta deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`),
});

const esquemaDeDadosDeBancoLocal = z.object({
  container: z
    .string({ required_error: 'Informe o container.' })
    .trim()
    .min(1, 'Informe o container.')
    .max(
      TAMANHO_MAXIMO_DO_CONTAINER,
      `O container deve ter no máximo ${TAMANHO_MAXIMO_DO_CONTAINER} caracteres.`,
    ),
  host: z
    .string({ required_error: 'Informe o host do banco.' })
    .trim()
    .min(1, 'Informe o host do banco.')
    .max(TAMANHO_MAXIMO_DO_HOST, `O host deve ter no máximo ${TAMANHO_MAXIMO_DO_HOST} caracteres.`),
  porta: z.coerce
    .number({ invalid_type_error: 'A porta deve ser um número.' })
    .int('A porta deve ser um número inteiro.')
    .min(PORTA_MINIMA, `A porta deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`)
    .max(PORTA_MAXIMA, `A porta deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`),
  nomeDoServico: z
    .string({ required_error: 'Informe o service name.' })
    .trim()
    .min(1, 'Informe o service name.')
    .max(
      TAMANHO_MAXIMO_DO_SERVICO,
      `O service name deve ter no máximo ${TAMANHO_MAXIMO_DO_SERVICO} caracteres.`,
    ),
  usuario: z
    .string({ required_error: 'Informe o usuário do banco.' })
    .trim()
    .min(1, 'Informe o usuário do banco.')
    .max(
      TAMANHO_MAXIMO_DO_USUARIO,
      `O usuário deve ter no máximo ${TAMANHO_MAXIMO_DO_USUARIO} caracteres.`,
    ),
  senha: z
    .string({ required_error: 'Informe a senha do banco.' })
    .min(1, 'Informe a senha do banco.')
    .max(TAMANHO_MAXIMO_DA_SENHA, `A senha deve ter no máximo ${TAMANHO_MAXIMO_DA_SENHA} caracteres.`),
});

const esquemaDeParametros = z.object({
  id: z.string().uuid('Identificador inválido.'),
});

/**
 * `desde` é a posição em bytes até onde o cliente já leu — usada quando ele
 * retoma o acompanhamento depois de uma pausa, para continuar dali em vez de
 * repetir o snapshot do final do arquivo.
 */
const esquemaDeConsultaDoStream = z.object({
  desde: z.coerce
    .number({ invalid_type_error: 'A posição deve ser um número.' })
    .int('A posição deve ser um número inteiro.')
    .min(0, 'A posição não pode ser negativa.')
    .optional(),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.errors[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

function responderErroDeDominio(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof BaseLocalNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: 'Base local não encontrada.' });
  }

  if (erro instanceof BancoLocalNaoEncontradoError) {
    return resposta.status(404).send({ mensagem: 'Banco local não encontrado.' });
  }

  throw erro;
}

function responderErroDoWildfly(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (
    erro instanceof WildflyIndisponivelError ||
    erro instanceof WildflyComandoFalhouError ||
    erro instanceof WildflySemPermissaoDeExecucaoError
  ) {
    return resposta.status(503).send({ mensagem: erro.message });
  }

  return responderErroDeDominio(resposta, erro);
}

function responderErroDoDocker(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof DockerComandoFalhouError || erro instanceof DockerDesktopIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message });
  }

  return responderErroDeDominio(resposta, erro);
}

/**
 * O nome da base vai no `content-disposition`, então só sobrevivem caracteres
 * seguros para nome de arquivo — acento, espaço e aspas quebrariam o cabeçalho.
 */
function nomeDoArquivoDeLog(nomeDaBase: string): string {
  const nomeNormalizado = nomeDaBase
    .normalize('NFD')
    .replace(CARACTERES_DE_ACENTO, '')
    .replace(CARACTERES_FORA_DO_NOME_DE_ARQUIVO, '-')
    .replace(HIFENS_REPETIDOS, '-')
    .replace(HIFENS_NAS_PONTAS, '')
    .toLowerCase();

  return nomeNormalizado ? `server-${nomeNormalizado}.log` : 'server.log';
}

async function obterBaseOuFalhar(repositorio: RepositorioLocal, id: string): Promise<BaseLocal> {
  const bases = await repositorio.listarBases();
  const base = bases.find((baseLocal) => baseLocal.id === id);
  if (!base) {
    throw new BaseLocalNaoEncontradaError(id);
  }

  return base;
}

async function obterBancoOuFalhar(repositorio: RepositorioLocal, id: string): Promise<BancoLocal> {
  const bancos = await repositorio.listarBancos();
  const banco = bancos.find((bancoLocal) => bancoLocal.id === id);
  if (!banco) {
    throw new BancoLocalNaoEncontradoError(id);
  }

  return banco;
}

/**
 * A situação do `.sankhya-mcp.env` é estado do disco, não do cadastro — por
 * isso é lida a cada listagem, e não gravada junto com a base.
 */
async function comEstadoDoMcp(base: BaseLocal) {
  return { ...base, mcp: await estadoDoArquivoMcp(base.caminhoWildfly) };
}

export function registrarRotasDeLocal(
  servidor: FastifyInstance,
  repositorio: RepositorioLocal,
  repositorioDeConfiguracao: RepositorioConfiguracao,
): void {
  /** Tempo limite das checagens de situação, sempre lido na hora: muda sem reiniciar o servidor. */
  async function tempoLimiteDaChecagemMs(): Promise<number> {
    const { tempoLimiteSegundos } = await repositorioDeConfiguracao.ler();
    return tempoLimiteSegundos * MILISSEGUNDOS_POR_SEGUNDO;
  }

  servidor.get('/api/local/bases', async () => {
    const bases = await repositorio.listarBases();
    return Promise.all(bases.map(comEstadoDoMcp));
  });

  servidor.post('/api/local/bases', async (requisicao, resposta) => {
    const dados = esquemaDeDadosDeBaseLocal.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    const base = await repositorio.criarBase(dados.data);
    return resposta.status(201).send(base);
  });

  servidor.put('/api/local/bases/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeBaseLocal.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizarBase(parametros.data.id, dados.data);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/local/bases/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerBase(parametros.data.id);
      limparHistoricoDaBase(parametros.data.id);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.post('/api/local/bases/:id/iniciar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const base = await obterBaseOuFalhar(repositorio, parametros.data.id);
      await iniciarWildfly(base.caminhoWildfly);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoWildfly(resposta, erro);
    }
  });

  servidor.post('/api/local/bases/:id/reiniciar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const base = await obterBaseOuFalhar(repositorio, parametros.data.id);
      await reiniciarWildfly(base.caminhoWildfly, base.porta);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoWildfly(resposta, erro);
    }
  });

  servidor.post('/api/local/bases/:id/parar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const base = await obterBaseOuFalhar(repositorio, parametros.data.id);
      await pararWildfly(base.caminhoWildfly);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoWildfly(resposta, erro);
    }
  });

  servidor.get('/api/local/bases/:id/situacao', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const base = await obterBaseOuFalhar(repositorio, parametros.data.id);
      const tempoLimiteMs = await tempoLimiteDaChecagemMs();
      const servicoRodando = await wildflyEstaRodando(tempoLimiteMs);
      const { paginaInicialOk, versaoDaPlataforma } = servicoRodando
        ? await consultarPaginaInicial(base.porta, tempoLimiteMs)
        : { paginaInicialOk: false, versaoDaPlataforma: null };

      registrarAmostraDaBase(base.id, {
        em: new Date().toISOString(),
        servicoRodando,
        paginaInicialOk,
      });

      return {
        servicoRodando,
        paginaInicialOk,
        versaoDaPlataforma,
        historico: obterHistoricoDaBase(base.id),
      };
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.get('/api/local/bases/:id/log/stream', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const consulta = esquemaDeConsultaDoStream.safeParse(requisicao.query);
    if (!consulta.success) {
      return responderErroDeValidacao(resposta, consulta.error);
    }

    let base: BaseLocal;
    try {
      base = await obterBaseOuFalhar(repositorio, parametros.data.id);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }

    const caminhoDoLog = caminhoDoLogDaBase(base.caminhoWildfly);

    resposta.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const enviar = (evento: string, dados: string): void => {
      resposta.raw.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    };

    if (!existsSync(caminhoDoLog)) {
      enviar('aviso', `Log ainda não existe em ${caminhoDoLog}. Acompanhando...`);
    }

    const { desde } = consulta.data;
    const inicial =
      desde === undefined
        ? await lerFinalDoLog(caminhoDoLog)
        : await lerDesdePosicao(caminhoDoLog, desde);
    let posicaoAtual = inicial.posicao;
    if (inicial.conteudo) {
      enviar('trecho', inicial.conteudo);
    }
    enviar('posicao', String(posicaoAtual));

    const temporizador = setInterval(() => {
      lerNovoTrechoDoLog(caminhoDoLog, posicaoAtual)
        .then((novoTrecho) => {
          posicaoAtual = novoTrecho.posicao;
          if (novoTrecho.conteudo) {
            enviar('trecho', novoTrecho.conteudo);
            enviar('posicao', String(posicaoAtual));
          }
        })
        .catch((erro: unknown) => {
          enviar('erro', erro instanceof Error ? erro.message : String(erro));
        });
    }, INTERVALO_DE_POLL_DO_LOG_MS);

    requisicao.raw.on('close', () => clearInterval(temporizador));
    resposta.hijack();
  });

  servidor.get('/api/local/bases/:id/log/download', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    let base: BaseLocal;
    try {
      base = await obterBaseOuFalhar(repositorio, parametros.data.id);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }

    const caminhoDoLog = caminhoDoLogDaBase(base.caminhoWildfly);
    if (!existsSync(caminhoDoLog)) {
      return resposta.status(404).send({ mensagem: `Log não encontrado em ${caminhoDoLog}.` });
    }

    return resposta
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeDoArquivoDeLog(base.nome)}"`)
      .send(createReadStream(caminhoDoLog));
  });

  /*
   * A configuração do MCP mora no `.sankhya-mcp.env` dentro da pasta do
   * WildFly da base, não no cadastro — por isso não passa pelo repositório.
   */
  servidor.get('/api/local/bases/:id/mcp', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    let base: BaseLocal;
    try {
      base = await obterBaseOuFalhar(repositorio, parametros.data.id);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }

    try {
      return await lerConfiguracaoMcp(base.caminhoWildfly);
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta
          .status(404)
          .send({ mensagem: `Pasta não encontrada: ${base.caminhoWildfly}` });
      }
      throw erro;
    }
  });

  servidor.put('/api/local/bases/:id/mcp', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeConfiguracaoMcp.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    let base: BaseLocal;
    try {
      base = await obterBaseOuFalhar(repositorio, parametros.data.id);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }

    try {
      await gravarConfiguracaoMcp(base.caminhoWildfly, {
        ...dados.data,
        SANKHYA_DB_PORT: String(dados.data.SANKHYA_DB_PORT),
      });
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta
          .status(404)
          .send({ mensagem: `Pasta não encontrada: ${base.caminhoWildfly}` });
      }
      throw erro;
    }
  });

  servidor.get('/api/local/bancos', async () => repositorio.listarBancos());

  servidor.post('/api/local/bancos', async (requisicao, resposta) => {
    const dados = esquemaDeDadosDeBancoLocal.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    const banco = await repositorio.criarBanco(dados.data);
    return resposta.status(201).send(banco);
  });

  servidor.put('/api/local/bancos/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeBancoLocal.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizarBanco(parametros.data.id, dados.data);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/local/bancos/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerBanco(parametros.data.id);
      limparHistorico(parametros.data.id);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.post('/api/local/bancos/:id/iniciar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const banco = await obterBancoOuFalhar(repositorio, parametros.data.id);
      await iniciarContainer(banco.container);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoDocker(resposta, erro);
    }
  });

  servidor.post('/api/local/bancos/:id/reiniciar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const banco = await obterBancoOuFalhar(repositorio, parametros.data.id);
      await reiniciarContainer(banco.container);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoDocker(resposta, erro);
    }
  });

  servidor.post('/api/local/bancos/:id/parar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const banco = await obterBancoOuFalhar(repositorio, parametros.data.id);
      await pararContainer(banco.container);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoDocker(resposta, erro);
    }
  });

  servidor.get('/api/local/bancos/:id/situacao', async (requisicao, resposta) => {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      const banco = await obterBancoOuFalhar(repositorio, parametros.data.id);
      const tempoLimiteMs = await tempoLimiteDaChecagemMs();
      const containerRodando = await containerEstaRodando(banco.container, tempoLimiteMs);
      const bancoAcessivel = containerRodando
        ? await bancoEstaAcessivel(banco, tempoLimiteMs)
        : false;

      registrarAmostra(banco.id, {
        em: new Date().toISOString(),
        containerRodando,
        bancoAcessivel,
      });

      return { containerRodando, bancoAcessivel, historico: obterHistorico(banco.id) };
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });
}
