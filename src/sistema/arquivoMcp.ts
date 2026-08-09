import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { garantirQueEhPasta } from './pasta.ts';

/**
 * Configuração do MCP gravada na raiz do repositório local, não no cadastro.
 *
 * O formato é o mesmo do `.sankhya-mcp.env` usado pelo MCP: uma linha por
 * variável, `CHAVE=valor`, sem aspas e sem quebra de linha no fim do arquivo.
 */
export const NOME_DO_ARQUIVO_MCP = '.sankhya-mcp.env';

/**
 * Nome usado pela configuração global, que aponta para a pasta do próprio
 * `sankhya-schema-mcp` — lá o arquivo lido pelo servidor é o `.env` comum.
 */
export const NOME_DO_ARQUIVO_ENV = '.env';

export const CHAVES_DO_MCP = [
  'SANKHYA_DB_HOST',
  'SANKHYA_DB_PORT',
  'SANKHYA_DB_SERVICE_NAME',
  'SANKHYA_DB_USER',
  'SANKHYA_DB_PASSWORD',
] as const;

export type ChaveDoMcp = (typeof CHAVES_DO_MCP)[number];
export type ConfiguracaoMcp = Record<ChaveDoMcp, string>;

export interface ArquivoMcp {
  configuracao: ConfiguracaoMcp;
  existe: boolean;
}

function configuracaoVazia(): ConfiguracaoMcp {
  return Object.fromEntries(CHAVES_DO_MCP.map((chave) => [chave, ''])) as ConfiguracaoMcp;
}

/** A senha pode conter `=`, então só o primeiro separador conta. */
function separarLinha(linha: string): [string, string] | null {
  const posicao = linha.indexOf('=');
  if (posicao <= 0) {
    return null;
  }
  return [linha.slice(0, posicao).trim(), linha.slice(posicao + 1)];
}

interface ConteudoDoArquivo {
  configuracao: ConfiguracaoMcp;
  /** Linhas que não são das chaves conhecidas, preservadas na regravação. */
  outrasLinhas: string[];
  existe: boolean;
}

async function lerConteudo(
  pastaDoRepositorio: string,
  nomeDoArquivo: string,
): Promise<ConteudoDoArquivo> {
  const caminho = join(pastaDoRepositorio, nomeDoArquivo);

  let bruto: string;
  try {
    bruto = await readFile(caminho, 'utf8');
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
      return { configuracao: configuracaoVazia(), outrasLinhas: [], existe: false };
    }
    throw erro;
  }

  const configuracao = configuracaoVazia();
  const outrasLinhas: string[] = [];

  for (const linha of bruto.split(/\r?\n/)) {
    const par = separarLinha(linha);
    if (par && (CHAVES_DO_MCP as readonly string[]).includes(par[0])) {
      configuracao[par[0] as ChaveDoMcp] = par[1];
      continue;
    }

    if (linha.trim() !== '') {
      outrasLinhas.push(linha);
    }
  }

  return { configuracao, outrasLinhas, existe: true };
}

export interface EstadoDoMcp {
  existe: boolean;
  completo: boolean;
}

/**
 * Situação do arquivo para o indicador visual da lista.
 *
 * Não lança: pasta inexistente ou ilegível conta como arquivo ausente, porque
 * isso alimenta a cor de um botão e não pode derrubar a listagem de clientes.
 */
export async function estadoDoArquivoMcp(
  pastaDoRepositorio: string,
  nomeDoArquivo: string = NOME_DO_ARQUIVO_MCP,
): Promise<EstadoDoMcp> {
  try {
    const { configuracao, existe } = await lerConteudo(pastaDoRepositorio, nomeDoArquivo);
    if (!existe) {
      return { existe: false, completo: false };
    }

    const completo = CHAVES_DO_MCP.every((chave) => configuracao[chave].trim() !== '');
    return { existe: true, completo };
  } catch {
    return { existe: false, completo: false };
  }
}

export async function lerConfiguracaoMcp(
  pastaDoRepositorio: string,
  nomeDoArquivo: string = NOME_DO_ARQUIVO_MCP,
): Promise<ArquivoMcp> {
  await garantirQueEhPasta(pastaDoRepositorio);

  const { configuracao, existe } = await lerConteudo(pastaDoRepositorio, nomeDoArquivo);
  return { configuracao, existe };
}

/**
 * Regrava o arquivo inteiro. As chaves conhecidas vêm primeiro, na ordem
 * definida; qualquer outra linha que já estivesse no arquivo é mantida no fim
 * para não sumir sem aviso.
 */
export async function gravarConfiguracaoMcp(
  pastaDoRepositorio: string,
  configuracao: ConfiguracaoMcp,
  nomeDoArquivo: string = NOME_DO_ARQUIVO_MCP,
): Promise<void> {
  await garantirQueEhPasta(pastaDoRepositorio);

  const { outrasLinhas } = await lerConteudo(pastaDoRepositorio, nomeDoArquivo);
  const linhas = [
    ...CHAVES_DO_MCP.map((chave) => `${chave}=${configuracao[chave]}`),
    ...outrasLinhas,
  ];

  const caminho = join(pastaDoRepositorio, nomeDoArquivo);
  const caminhoTemporario = `${caminho}.tmp`;

  await writeFile(caminhoTemporario, linhas.join('\n'), 'utf8');
  await rename(caminhoTemporario, caminho);
}
