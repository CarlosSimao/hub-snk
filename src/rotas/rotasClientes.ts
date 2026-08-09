import type { FastifyInstance, FastifyReply } from 'fastify';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { abrirPastaNoSistema } from '../sistema/abrirPasta.ts';
import { abrirIntelliJNaPasta, IntelliJIndisponivelError } from '../sistema/abrirIntelliJ.ts';
import { abrirShellNaPasta, TerminalIndisponivelError } from '../sistema/abrirShell.ts';
import {
  estadoDoArquivoMcp,
  gravarConfiguracaoMcp,
  lerConfiguracaoMcp,
} from '../sistema/arquivoMcp.ts';
import { PastaNaoEncontradaError } from '../sistema/pasta.ts';
import { esquemaDeConfiguracaoMcp } from './esquemaDeConfiguracaoMcp.ts';
import type { Cliente, RepositorioGit } from '../tipos.ts';
import {
  AcessoDeBaseDuplicadoError,
  BaseJaCadastradaError,
  BaseNaoEncontradaError,
  ClienteNaoEncontradoError,
  FavoritoDuplicadoNaImportacaoError,
  LinkNaoEncontradoError,
  NomeDeClienteDuplicadoError,
  RepositorioDuplicadoNaImportacaoError,
  RepositorioNaoEncontradoError,
  UrlDeLinkDuplicadaError,
  UrlDeRepositorioDuplicadaError,
  type RepositorioClientes,
} from '../repositorio/repositorioClientes.ts';
import { TIPOS_DE_BASE } from '../tipos.ts';
import { consultarBaseDoCliente } from '../sistema/baseDoCliente.ts';
import {
  limparHistoricoDaBaseDoCliente,
  obterHistoricoDaBaseDoCliente,
  registrarAmostraDaBaseDoCliente,
} from '../sistema/historicoDeSituacaoDaBaseDoCliente.ts';

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DA_URL = 300;
const TAMANHO_MAXIMO_DO_USUARIO = 120;
const TAMANHO_MAXIMO_DA_SENHA = 200;
const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const TAMANHO_MAXIMO_DAS_ANOTACOES = 5000;
const TAMANHO_MAXIMO_DO_HOST = 200;
const TAMANHO_MAXIMO_DO_SERVICO = 200;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;
const PROTOCOLOS_ACEITOS = ['http:', 'https:'];
const MILISSEGUNDOS_POR_SEGUNDO = 1000;
const QUANTIDADE_MAXIMA_DE_FAVORITOS_IMPORTADOS = 300;
const QUANTIDADE_MAXIMA_DE_REPOSITORIOS_IMPORTADOS = 300;

function ehUrlHttpValida(valor: string): boolean {
  try {
    return PROTOCOLOS_ACEITOS.includes(new URL(valor).protocol);
  } catch {
    return false;
  }
}

const esquemaDeDadosDeCliente = z.object({
  nome: z
    .string({ required_error: 'Informe o nome do cliente.' })
    .trim()
    .min(1, 'Informe o nome do cliente.')
    .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`),
});

/*
 * Texto livre: nada é aparado no meio, só nas pontas, e a quebra de linha faz
 * parte do conteúdo. O limite existe para o arquivo de cadastro não crescer sem
 * controle, já que ele é lido inteiro a cada carga.
 */
const esquemaDeAnotacoes = z.object({
  anotacoes: z
    .string({ required_error: 'Informe as anotações.' })
    .max(
      TAMANHO_MAXIMO_DAS_ANOTACOES,
      `As anotações devem ter no máximo ${TAMANHO_MAXIMO_DAS_ANOTACOES} caracteres.`,
    )
    .transform((valor) => valor.trim()),
});

const esquemaDeDadosDeBase = z.object({
  url: z
    .string({ required_error: 'Informe a URL da base.' })
    .trim()
    .min(1, 'Informe a URL da base.')
    .max(TAMANHO_MAXIMO_DA_URL, `A URL deve ter no máximo ${TAMANHO_MAXIMO_DA_URL} caracteres.`)
    .refine(ehUrlHttpValida, 'Informe uma URL http ou https válida.'),
  tipo: z.enum(TIPOS_DE_BASE, {
    errorMap: () => ({ message: 'Selecione o tipo da base.' }),
  }),
  /*
   * Usuário e senha são opcionais: nem toda base cadastrada tem credencial
   * anotada — algumas servem só para abrir a URL e acompanhar a situação.
   */
  usuario: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_USUARIO,
      `O usuário deve ter no máximo ${TAMANHO_MAXIMO_DO_USUARIO} caracteres.`,
    )
    .default(''),
  // A senha não é aparada: espaço nas pontas pode ser parte dela.
  senha: z
    .string()
    .max(TAMANHO_MAXIMO_DA_SENHA, `A senha deve ter no máximo ${TAMANHO_MAXIMO_DA_SENHA} caracteres.`)
    .default(''),
});

/*
 * Cada favorito selecionado vira uma base já com o nome do cliente escolhido na
 * tela — o vínculo com o cadastro é resolvido pelo nome, não por id, porque a
 * importação também cria clientes que ainda não existem.
 */
const esquemaDeImportacaoDeFavoritos = z.object({
  bases: z
    .array(
      esquemaDeDadosDeBase.extend({
        nomeDoCliente: esquemaDeDadosDeCliente.shape.nome,
      }),
    )
    .min(1, 'Selecione ao menos um favorito para importar.')
    .max(
      QUANTIDADE_MAXIMA_DE_FAVORITOS_IMPORTADOS,
      `Importe no máximo ${QUANTIDADE_MAXIMA_DE_FAVORITOS_IMPORTADOS} favoritos por vez.`,
    ),
});

const esquemaDeDadosDeRepositorio = z.object({
  nome: z
    .string({ required_error: 'Informe o nome do repositório.' })
    .trim()
    .min(1, 'Informe o nome do repositório.')
    .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`),
  url: z
    .string({ required_error: 'Informe a URL do repositório.' })
    .trim()
    .min(1, 'Informe a URL do repositório.')
    .max(TAMANHO_MAXIMO_DA_URL, `A URL deve ter no máximo ${TAMANHO_MAXIMO_DA_URL} caracteres.`)
    .refine(ehUrlHttpValida, 'Informe uma URL http ou https válida.'),
  // Opcional: só quem clonou o repositório tem pasta local.
  caminhoLocal: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_CAMINHO,
      `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
    )
    .refine(
      (valor) => valor === '' || isAbsolute(valor),
      'Informe o caminho completo da pasta, não um caminho relativo.',
    )
    .optional(),
});

/*
 * Cada repositório da varredura vira um cadastro já com o nome do cliente
 * escolhido na tela. O caminho local é obrigatório aqui — é o que distingue
 * esta importação do cadastro manual, que aceita repositório nunca clonado.
 */
const esquemaDeImportacaoDeRepositorios = z.object({
  repositorios: z
    .array(
      esquemaDeDadosDeRepositorio.extend({
        nomeDoCliente: esquemaDeDadosDeCliente.shape.nome,
        caminhoLocal: z
          .string({ required_error: 'Informe a pasta do repositório.' })
          .trim()
          .min(1, 'Informe a pasta do repositório.')
          .max(
            TAMANHO_MAXIMO_DO_CAMINHO,
            `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
          )
          .refine(isAbsolute, 'Informe o caminho completo da pasta, não um caminho relativo.'),
      }),
    )
    .min(1, 'Selecione ao menos um repositório para importar.')
    .max(
      QUANTIDADE_MAXIMA_DE_REPOSITORIOS_IMPORTADOS,
      `Importe no máximo ${QUANTIDADE_MAXIMA_DE_REPOSITORIOS_IMPORTADOS} repositórios por vez.`,
    ),
});

const esquemaDeDadosDeLink = z.object({
  nome: z
    .string({ required_error: 'Informe o nome do link.' })
    .trim()
    .min(1, 'Informe o nome do link.')
    .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`),
  url: z
    .string({ required_error: 'Informe a URL do link.' })
    .trim()
    .min(1, 'Informe a URL do link.')
    .max(TAMANHO_MAXIMO_DA_URL, `A URL deve ter no máximo ${TAMANHO_MAXIMO_DA_URL} caracteres.`)
    .refine(ehUrlHttpValida, 'Informe uma URL http ou https válida.'),
});

const esquemaDeDadosDeBancoDeDados = z.object({
  host: z
    .string({ required_error: 'Informe o host do banco.' })
    .trim()
    .min(1, 'Informe o host do banco.')
    .max(TAMANHO_MAXIMO_DO_HOST, `O host deve ter no máximo ${TAMANHO_MAXIMO_DO_HOST} caracteres.`),
  // O formulário manda texto; `coerce` evita exigir conversão no frontend.
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


const esquemaDeParametrosDeCliente = z.object({
  id: z.string().uuid('Identificador de cliente inválido.'),
});

const esquemaDeParametrosDeBase = esquemaDeParametrosDeCliente.extend({
  idBase: z.string().uuid('Identificador de base inválido.'),
});

const esquemaDeParametrosDeRepositorio = esquemaDeParametrosDeCliente.extend({
  idRepositorio: z.string().uuid('Identificador de repositório inválido.'),
});

const esquemaDeParametrosDeLink = esquemaDeParametrosDeCliente.extend({
  idLink: z.string().uuid('Identificador de link inválido.'),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.errors[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

function responderErroDeDominio(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof ClienteNaoEncontradoError) {
    return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
  }

  if (erro instanceof BaseNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: 'Base não encontrada.' });
  }

  if (erro instanceof RepositorioNaoEncontradoError) {
    return resposta.status(404).send({ mensagem: 'Repositório não encontrado.' });
  }

  if (erro instanceof LinkNaoEncontradoError) {
    return resposta.status(404).send({ mensagem: 'Link não encontrado.' });
  }

  if (
    erro instanceof NomeDeClienteDuplicadoError ||
    erro instanceof AcessoDeBaseDuplicadoError ||
    erro instanceof BaseJaCadastradaError ||
    erro instanceof FavoritoDuplicadoNaImportacaoError ||
    erro instanceof UrlDeRepositorioDuplicadaError ||
    erro instanceof RepositorioDuplicadoNaImportacaoError ||
    erro instanceof UrlDeLinkDuplicadaError
  ) {
    return resposta.status(409).send({ mensagem: erro.message });
  }

  throw erro;
}

export function registrarRotasDeClientes(
  servidor: FastifyInstance,
  repositorio: RepositorioClientes,
  repositorioDeConfiguracao: RepositorioConfiguracao,
): void {
  /**
   * Localiza o repositório e devolve o caminho local, ou uma resposta de erro
   * já pronta — as duas rotas que mexem com a pasta precisam exatamente disso.
   */
  async function localizarRepositorioComPasta(
    idDoCliente: string,
    idDoRepositorio: string,
    resposta: FastifyReply,
  ): Promise<RepositorioGit | null> {
    const cliente = await repositorio.buscarPorId(idDoCliente);
    if (!cliente) {
      await resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
      return null;
    }

    const repositorioGit = cliente.repositorios.find(
      (candidato) => candidato.id === idDoRepositorio,
    );
    if (!repositorioGit) {
      await resposta.status(404).send({ mensagem: 'Repositório não encontrado.' });
      return null;
    }

    if (!repositorioGit.caminhoLocal) {
      await resposta
        .status(400)
        .send({ mensagem: 'Este repositório não tem caminho local informado.' });
      return null;
    }

    return repositorioGit;
  }

  /*
   * A situação do `.sankhya-mcp.env` de cada repositório é estado do disco, não
   * do cadastro — por isso é anexada aqui e não no repositório de clientes.
   */
  async function comEstadoDoMcp(cliente: Cliente) {
    return {
      ...cliente,
      repositorios: await Promise.all(
        cliente.repositorios.map(async (repositorioGit) =>
          repositorioGit.caminhoLocal
            ? { ...repositorioGit, mcp: await estadoDoArquivoMcp(repositorioGit.caminhoLocal) }
            : repositorioGit,
        ),
      ),
    };
  }

  servidor.get('/api/clientes', async () => {
    const clientes = await repositorio.listar();
    return Promise.all(clientes.map(comEstadoDoMcp));
  });

  /*
   * Releitura de um cliente só. O HUB SNK chama esta rota ao selecionar um
   * cliente e ao usar o botão de recarregar: assim a cor do botão do MCP
   * reflete o disco no momento do clique, sem puxar a lista inteira.
   */
  servidor.get('/api/clientes/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const cliente = await repositorio.buscarPorId(parametros.data.id);
    if (!cliente) {
      return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
    }

    return comEstadoDoMcp(cliente);
  });

  servidor.post('/api/clientes', async (requisicao, resposta) => {
    const dados = esquemaDeDadosDeCliente.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const cliente = await repositorio.criar(dados.data);
      return resposta.status(201).send(cliente);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  /*
   * Importação de favoritos do navegador. O caminho é estático e não conflita
   * com `/api/clientes/:id`, que não atende POST.
   */
  servidor.post('/api/clientes/importacao', async (requisicao, resposta) => {
    const dados = esquemaDeImportacaoDeFavoritos.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const resultado = await repositorio.importarBases(dados.data.bases);
      return resposta.status(201).send(resultado);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  /* Importação dos repositórios já clonados na máquina, varridos pelo sistema. */
  servidor.post('/api/clientes/importacao-de-repositorios', async (requisicao, resposta) => {
    const dados = esquemaDeImportacaoDeRepositorios.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const resultado = await repositorio.importarRepositorios(dados.data.repositorios);
      return resposta.status(201).send(resultado);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.put('/api/clientes/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeCliente.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizar(parametros.data.id, dados.data);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.put('/api/clientes/:id/anotacoes', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeAnotacoes.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.definirAnotacoes(parametros.data.id, dados.data.anotacoes);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/clientes/:id', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.remover(parametros.data.id);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.post('/api/clientes/:id/bases', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeBase.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const base = await repositorio.adicionarBase(parametros.data.id, dados.data);
      return resposta.status(201).send(base);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.put('/api/clientes/:id/bases/:idBase', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeBase.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeBase.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizarBase(parametros.data.id, parametros.data.idBase, dados.data);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/clientes/:id/bases/:idBase', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeBase.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerBase(parametros.data.id, parametros.data.idBase);
      limparHistoricoDaBaseDoCliente(parametros.data.idBase);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  /*
   * Situação da base cadastrada: só a URL responde dentro do tempo limite
   * configurado — sem porta de management separada como na base local, então
   * é um único nível de checagem.
   */
  servidor.get('/api/clientes/:id/bases/:idBase/situacao', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeBase.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const cliente = await repositorio.buscarPorId(parametros.data.id);
    if (!cliente) {
      return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
    }

    const base = cliente.bases.find((candidata) => candidata.id === parametros.data.idBase);
    if (!base) {
      return resposta.status(404).send({ mensagem: 'Base não encontrada.' });
    }

    const { tempoLimiteSegundos } = await repositorioDeConfiguracao.ler();
    const { ok: urlOk, versaoDaPlataforma } = await consultarBaseDoCliente(
      base.url,
      tempoLimiteSegundos * MILISSEGUNDOS_POR_SEGUNDO,
    );

    registrarAmostraDaBaseDoCliente(base.id, { em: new Date().toISOString(), urlOk });

    return { urlOk, versaoDaPlataforma, historico: obterHistoricoDaBaseDoCliente(base.id) };
  });

  /* Uma base tem no máximo um banco: `PUT` vincula ou substitui, sem `POST`. */
  servidor.put('/api/clientes/:id/bases/:idBase/banco', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeBase.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeBancoDeDados.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.definirBancoDeDados(
        parametros.data.id,
        parametros.data.idBase,
        dados.data,
      );
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/clientes/:id/bases/:idBase/banco', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeBase.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerBancoDeDados(parametros.data.id, parametros.data.idBase);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.post('/api/clientes/:id/repositorios', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeRepositorio.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const repositorioGit = await repositorio.adicionarRepositorio(
        parametros.data.id,
        dados.data,
      );
      return resposta.status(201).send(repositorioGit);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.put('/api/clientes/:id/repositorios/:idRepositorio', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeRepositorio.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizarRepositorio(
        parametros.data.id,
        parametros.data.idRepositorio,
        dados.data,
      );
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/clientes/:id/repositorios/:idRepositorio', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerRepositorio(parametros.data.id, parametros.data.idRepositorio);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  /*
   * Links do cliente: só cadastro. Não há rota de abrir porque o endereço é
   * aberto pelo próprio navegador, sem passar pelo servidor.
   */
  servidor.post('/api/clientes/:id/links', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeLink.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const link = await repositorio.adicionarLink(parametros.data.id, dados.data);
      return resposta.status(201).send(link);
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.put('/api/clientes/:id/links/:idLink', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeLink.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeDadosDeLink.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      return await repositorio.atualizarLink(
        parametros.data.id,
        parametros.data.idLink,
        dados.data,
      );
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  servidor.delete('/api/clientes/:id/links/:idLink', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeLink.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    try {
      await repositorio.removerLink(parametros.data.id, parametros.data.idLink);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDeDominio(resposta, erro);
    }
  });

  /*
   * O caminho a abrir vem do registro gravado, nunca do corpo da requisição: a
   * chamada só diz *qual* repositório abrir, não *qual pasta* abrir.
   */
  servidor.post(
    '/api/clientes/:id/repositorios/:idRepositorio/abrir-pasta',
    async (requisicao, resposta) => {
      const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
      if (!parametros.success) {
        return responderErroDeValidacao(resposta, parametros.error);
      }

      const repositorioGit = await localizarRepositorioComPasta(
        parametros.data.id,
        parametros.data.idRepositorio,
        resposta,
      );
      if (!repositorioGit) {
        return resposta;
      }

      const caminhoLocal = repositorioGit.caminhoLocal as string;

      try {
        await abrirPastaNoSistema(caminhoLocal);
        return resposta.status(204).send();
      } catch (erro) {
        if (erro instanceof PastaNaoEncontradaError) {
          return resposta.status(404).send({ mensagem: `Pasta não encontrada: ${caminhoLocal}` });
        }
        throw erro;
      }
    },
  );

  /*
   * Abre a pasta do repositório como projeto do IntelliJ IDEA. Como nas demais
   * ações de sistema, a pasta vem do cadastro e a requisição só diz qual
   * repositório abrir.
   */
  servidor.post(
    '/api/clientes/:id/repositorios/:idRepositorio/abrir-intellij',
    async (requisicao, resposta) => {
      const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
      if (!parametros.success) {
        return responderErroDeValidacao(resposta, parametros.error);
      }

      const repositorioGit = await localizarRepositorioComPasta(
        parametros.data.id,
        parametros.data.idRepositorio,
        resposta,
      );
      if (!repositorioGit) {
        return resposta;
      }

      const caminhoLocal = repositorioGit.caminhoLocal as string;

      try {
        await abrirIntelliJNaPasta(caminhoLocal);
        return resposta.status(204).send();
      } catch (erro) {
        if (erro instanceof PastaNaoEncontradaError) {
          return resposta.status(404).send({ mensagem: `Pasta não encontrada: ${caminhoLocal}` });
        }
        if (erro instanceof IntelliJIndisponivelError) {
          return resposta.status(503).send({ mensagem: erro.message });
        }
        throw erro;
      }
    },
  );

  /*
   * A configuração do MCP mora no arquivo `.sankhya-mcp.env` dentro do próprio
   * repositório, não no cadastro — por isso não passa pelo repositório de
   * clientes.
   */
  servidor.get('/api/clientes/:id/repositorios/:idRepositorio/mcp', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const repositorioGit = await localizarRepositorioComPasta(
      parametros.data.id,
      parametros.data.idRepositorio,
      resposta,
    );
    if (!repositorioGit) {
      return resposta;
    }

    const caminhoLocal = repositorioGit.caminhoLocal as string;

    try {
      return await lerConfiguracaoMcp(caminhoLocal);
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta.status(404).send({ mensagem: `Pasta não encontrada: ${caminhoLocal}` });
      }
      throw erro;
    }
  });

  servidor.put('/api/clientes/:id/repositorios/:idRepositorio/mcp', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }

    const dados = esquemaDeConfiguracaoMcp.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    const repositorioGit = await localizarRepositorioComPasta(
      parametros.data.id,
      parametros.data.idRepositorio,
      resposta,
    );
    if (!repositorioGit) {
      return resposta;
    }

    const caminhoLocal = repositorioGit.caminhoLocal as string;

    try {
      await gravarConfiguracaoMcp(caminhoLocal, {
        ...dados.data,
        SANKHYA_DB_PORT: String(dados.data.SANKHYA_DB_PORT),
      });
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof PastaNaoEncontradaError) {
        return resposta.status(404).send({ mensagem: `Pasta não encontrada: ${caminhoLocal}` });
      }
      throw erro;
    }
  });

  /*
   * Abre o terminal do sistema na pasta do repositório. O script executado é o
   * "Script padrão" da configuração global — nunca um comando vindo da
   * requisição, que só informa qual repositório abrir.
   */
  servidor.post(
    '/api/clientes/:id/repositorios/:idRepositorio/abrir-shell',
    async (requisicao, resposta) => {
      const parametros = esquemaDeParametrosDeRepositorio.safeParse(requisicao.params);
      if (!parametros.success) {
        return responderErroDeValidacao(resposta, parametros.error);
      }

      const repositorioGit = await localizarRepositorioComPasta(
        parametros.data.id,
        parametros.data.idRepositorio,
        resposta,
      );
      if (!repositorioGit) {
        return resposta;
      }

      const caminhoLocal = repositorioGit.caminhoLocal as string;
      const { scriptPadrao } = await repositorioDeConfiguracao.ler();

      try {
        await abrirShellNaPasta(caminhoLocal, scriptPadrao);
        return resposta.status(204).send();
      } catch (erro) {
        if (erro instanceof PastaNaoEncontradaError) {
          return resposta.status(404).send({ mensagem: `Pasta não encontrada: ${caminhoLocal}` });
        }
        if (erro instanceof TerminalIndisponivelError) {
          return resposta.status(503).send({ mensagem: erro.message });
        }
        throw erro;
      }
    },
  );
}
