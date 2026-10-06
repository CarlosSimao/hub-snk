/**
 * Explorador de arquivos locais do cliente e de cada projeto: navegar, criar, renomear,
 * excluir, enviar e abrir arquivos dentro de uma pasta que o usuário escolhe.
 *
 * A pasta raiz fica guardada aqui e nunca vem na requisição de arquivo: toda rota recebe
 * só o caminho RELATIVO a ela, e `exploradorDeArquivos.ts` recusa o que escapa.
 */
import { stat } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CaminhoForaDaPastaError,
  ItemJaExisteError,
  ItemNaoEncontradoError,
  NomeInvalidoError,
  criarArquivo,
  criarPasta,
  excluir,
  listarPasta,
  renomear,
  resolverDentro,
} from '../arquivos/exploradorDeArquivos.ts';
import type { PastasDoExplorador } from '../arquivos/pastasDoExplorador.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import {
  abrirArquivoNoSistema,
  abrirPastaNoSistema,
  GerenciadorDeArquivosIndisponivelError,
} from '../sistema/processos/abrirPasta.ts';
import { garantirQueEhPasta, PastaNaoEncontradaError } from '../sistema/pasta.ts';

const LIMITE_DO_ENVIO_BYTES = 30 * 1024 * 1024;
/** Base64 pesa ~4/3 do arquivo; a folga cobre o resto do JSON. */
const LIMITE_DO_CORPO_BYTES = Math.ceil(LIMITE_DO_ENVIO_BYTES * 1.4);

/** Abrir daria ao HUB o poder de executar programa: esses vão só por "Mostrar na pasta". */
const EXTENSOES_QUE_EXECUTAM = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.hta',
  '.jar',
  '.lnk',
  '.reg',
  '.sh',
  '.app',
]);

const esquemaDeParametros = z.object({
  id: z.string().min(1),
  idProjeto: z.string().min(1).optional(),
});
const esquemaDeConsulta = z.object({ caminho: z.string().default('') });
const esquemaDaPasta = z.object({ pasta: z.string().trim().min(1).nullable() });
const esquemaDeNome = z.object({ caminho: z.string().default(''), nome: z.string() });
const esquemaDeCaminho = z.object({ caminho: z.string().default('') });
const esquemaDeEnvio = z.object({
  caminho: z.string().default(''),
  nome: z.string(),
  conteudoBase64: z.string(),
});

function tratarErro(erro: unknown, resposta: FastifyReply): FastifyReply {
  if (erro instanceof ItemNaoEncontradoError || erro instanceof PastaNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: erro.message });
  }
  if (erro instanceof ItemJaExisteError) {
    return resposta.status(409).send({ mensagem: erro.message });
  }
  if (erro instanceof NomeInvalidoError || erro instanceof CaminhoForaDaPastaError) {
    return resposta.status(400).send({ mensagem: erro.message });
  }
  if (erro instanceof GerenciadorDeArquivosIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message });
  }
  throw erro;
}

export function registrarRotasDeArquivos(
  servidor: FastifyInstance,
  clientes: RepositorioClientes,
  pastas: PastasDoExplorador,
): void {
  /** Cliente (e projeto, se for o caso) existem; devolve a chave da pasta no armazenamento. */
  async function chaveDoEscopo(
    requisicao: { params: unknown },
    resposta: FastifyReply,
  ): Promise<string | null> {
    const parametros = esquemaDeParametros.safeParse(requisicao.params);
    if (!parametros.success) {
      void resposta.status(400).send({ mensagem: 'Identificador inválido.' });
      return null;
    }
    const cliente = await clientes.buscarPorId(parametros.data.id);
    if (!cliente) {
      void resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
      return null;
    }
    const { idProjeto } = parametros.data;
    if (!idProjeto) return `cliente:${cliente.id}`;
    if (!cliente.projetos.some((projeto) => projeto.id === idProjeto)) {
      void resposta.status(404).send({ mensagem: 'Projeto não encontrado.' });
      return null;
    }
    return `projeto:${cliente.id}:${idProjeto}`;
  }

  /** A raiz vinculada, ou 409 explicando que ainda não há pasta. */
  async function raizDoEscopo(chave: string, resposta: FastifyReply): Promise<string | null> {
    const raiz = await pastas.obter(chave);
    if (!raiz) {
      void resposta.status(409).send({ mensagem: 'Nenhuma pasta escolhida para o explorador.' });
      return null;
    }
    return raiz;
  }

  /**
   * Rota que altera a pasta: confere o escopo, valida o corpo e entrega a raiz. Erros
   * conhecidos viram a resposta HTTP certa; o resto sobe.
   */
  function rotaDeAlteracao<T>(
    caminhoDaRota: string,
    esquema: z.ZodType<T>,
    executar: (raiz: string, dados: T) => Promise<void>,
    opcoes: { bodyLimit?: number } = {},
  ): void {
    servidor.post(caminhoDaRota, opcoes, async (requisicao, resposta) => {
      const chave = await chaveDoEscopo(requisicao, resposta);
      if (!chave) return resposta;
      const corpo = esquema.safeParse(requisicao.body);
      if (!corpo.success) return resposta.status(400).send({ mensagem: 'Dados inválidos.' });
      const raiz = await raizDoEscopo(chave, resposta);
      if (!raiz) return resposta;
      try {
        await executar(raiz, corpo.data);
        return resposta.status(204).send();
      } catch (erro) {
        return tratarErro(erro, resposta);
      }
    });
  }

  function registrar(prefixo: string): void {
    servidor.get(prefixo, async (requisicao, resposta) => {
      const chave = await chaveDoEscopo(requisicao, resposta);
      if (!chave) return resposta;
      const consulta = esquemaDeConsulta.safeParse(requisicao.query);
      if (!consulta.success) return resposta.status(400).send({ mensagem: 'Caminho inválido.' });

      const raiz = await pastas.obter(chave);
      if (!raiz) return { pasta: null, caminho: '', itens: [], cortada: false, existe: false };
      try {
        await garantirQueEhPasta(raiz);
      } catch {
        return { pasta: raiz, caminho: '', itens: [], cortada: false, existe: false };
      }
      try {
        const { itens, cortada } = await listarPasta(raiz, consulta.data.caminho);
        return { pasta: raiz, caminho: consulta.data.caminho, itens, cortada, existe: true };
      } catch (erro) {
        return tratarErro(erro, resposta);
      }
    });

    servidor.put(`${prefixo}/pasta`, async (requisicao, resposta) => {
      const chave = await chaveDoEscopo(requisicao, resposta);
      if (!chave) return resposta;
      const corpo = esquemaDaPasta.safeParse(requisicao.body);
      if (!corpo.success) return resposta.status(400).send({ mensagem: 'Pasta inválida.' });
      try {
        if (corpo.data.pasta) await garantirQueEhPasta(corpo.data.pasta);
        await pastas.definir(chave, corpo.data.pasta);
        return resposta.status(204).send();
      } catch (erro) {
        return tratarErro(erro, resposta);
      }
    });

    rotaDeAlteracao(`${prefixo}/criar-pasta`, esquemaDeNome, (raiz, dados) =>
      criarPasta(raiz, dados.caminho, dados.nome),
    );
    rotaDeAlteracao(`${prefixo}/criar-arquivo`, esquemaDeNome, (raiz, dados) =>
      criarArquivo(raiz, dados.caminho, dados.nome),
    );
    rotaDeAlteracao(`${prefixo}/renomear`, esquemaDeNome, (raiz, dados) =>
      renomear(raiz, dados.caminho, dados.nome),
    );
    rotaDeAlteracao(`${prefixo}/excluir`, esquemaDeCaminho, (raiz, dados) =>
      excluir(raiz, dados.caminho),
    );
    rotaDeAlteracao(
      `${prefixo}/enviar`,
      esquemaDeEnvio,
      async (raiz, dados) => {
        const conteudo = Buffer.from(dados.conteudoBase64, 'base64');
        if (conteudo.length > LIMITE_DO_ENVIO_BYTES) {
          throw new NomeInvalidoError('O arquivo passa de 30 MB: copie-o direto pela pasta.');
        }
        await criarArquivo(raiz, dados.caminho, dados.nome, conteudo);
      },
      { bodyLimit: LIMITE_DO_CORPO_BYTES },
    );

    /*
     * `mostrar` abre a pasta do item (ou a própria pasta) no gerenciador de arquivos do
     * sistema; `abrir` abre o item no programa padrão — pasta cai no gerenciador também.
     */
    for (const acao of ['abrir', 'mostrar'] as const) {
      rotaDeAlteracao(`${prefixo}/${acao}`, esquemaDeCaminho, async (raiz, dados) => {
        const alvo = await resolverDentro(raiz, dados.caminho);
        let informacoes;
        try {
          informacoes = await stat(alvo);
        } catch {
          throw new ItemNaoEncontradoError();
        }
        if (informacoes.isDirectory()) {
          await abrirPastaNoSistema(alvo);
        } else if (acao === 'mostrar') {
          await abrirPastaNoSistema(dirname(alvo));
        } else if (EXTENSOES_QUE_EXECUTAM.has(extname(alvo).toLowerCase())) {
          throw new NomeInvalidoError(
            'Programas e scripts não abrem por aqui. Use "Mostrar na pasta" e execute pelo sistema.',
          );
        } else {
          await abrirArquivoNoSistema(alvo);
        }
      });
    }
  }

  registrar('/api/clientes/:id/arquivos');
  registrar('/api/clientes/:id/projetos/:idProjeto/arquivos');
}
