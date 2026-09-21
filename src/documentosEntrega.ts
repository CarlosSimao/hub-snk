/**
 * Acha os documentos de entrega ja' gerados nos repositorios de um cliente.
 *
 * A skill `sankhya:sankhya-doc-entrega` grava em
 * `{repositorio}/Documentacao/Entrega - {nome}.{html|docx}`. Depois de gerar, o proximo
 * passo quase sempre e' mandar por e-mail — entao a tela de e-mail do cliente mostra o
 * que existe e ja' vem com o mais recente marcado, em vez de obrigar a procurar o arquivo
 * no disco e anexar a mao.
 *
 * O caminho de cada documento vem SEMPRE desta busca, nunca do pedido de envio: e' isso
 * que impede que um caminho arbitrario, mandado direto na API, vire anexo de e-mail.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CartaoClientes } from './sankhya/cartao.ts';
import type { DocumentoEntregaCliente } from './types.ts';

/** Onde a skill grava, dentro do repositorio. */
const PASTA_DOCUMENTOS = 'Documentacao';

/** O que a skill produz. O backup dela (`.bak`) fica de fora de proposito. */
const EXTENSOES = ['.html', '.docx'];

export type DocumentoEntrega = DocumentoEntregaCliente;

function documentosDaPasta(repositorio: string, nomeRepo: string): DocumentoEntrega[] {
  const pasta = join(repositorio, PASTA_DOCUMENTOS);
  if (!existsSync(pasta)) return [];

  let arquivos: string[];
  try {
    arquivos = readdirSync(pasta, { withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => entrada.name);
  } catch {
    return [];
  }

  const achados: DocumentoEntrega[] = [];
  for (const arquivo of arquivos) {
    const minusculo = arquivo.toLowerCase();
    if (!EXTENSOES.some((extensao) => minusculo.endsWith(extensao))) continue;
    // A skill nomeia como "Entrega - <customizacao>"; qualquer outro HTML que alguem
    // tenha deixado na pasta nao e' documento de entrega.
    if (!minusculo.startsWith('entrega')) continue;

    const caminho = join(pasta, arquivo);
    try {
      const info = statSync(caminho);
      achados.push({
        caminho,
        nome: arquivo,
        repositorio: nomeRepo || basename(repositorio),
        bytes: info.size,
        modificadoEm: info.mtime.toISOString(),
      });
    } catch {
      // Arquivo removido entre a listagem e o `stat`.
    }
  }
  return achados;
}

/** Documentos de todos os repositorios do cliente, do mais recente para o mais antigo. */
export function documentosDoCliente(cartao: CartaoClientes, clienteId: number): DocumentoEntrega[] {
  const achados: DocumentoEntrega[] = [];
  for (const repo of cartao.repos(clienteId)) {
    if (!repo.caminhoLocal.trim()) continue;
    achados.push(...documentosDaPasta(repo.caminhoLocal, repo.nome));
  }
  return achados.sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm));
}

/** Tipo MIME do anexo, pela extensao — o e-mail precisa dele para abrir no lugar certo. */
export function tipoMime(nome: string): string {
  return nome.toLowerCase().endsWith('.docx')
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'text/html';
}
