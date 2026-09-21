/**
 * Recifra, no formato do shell desktop, os segredos que o `hub-helper.ps1` gravou.
 *
 * Sem isto a marca de formato (`src/sankhya/cifra.ts`) resolve a CORRECAO — cada blob
 * continua sendo aberto por quem o cifrou — mas nao resolve a DEPENDENCIA: senha antiga
 * seguiria exigindo o helper PowerShell para sempre, e a Fase 3 nao poderia terminar com
 * ele apagado.
 *
 * Roda no boot, uma vez, e so' quando os dois lados estao no ar: precisa do helper para
 * abrir o blob velho e do shell para gravar o novo. Falhou? Nao mexe em nada e tenta de
 * novo no proximo boot — perder a senha do cliente para "adiantar" a migracao seria o
 * pior negocio possivel.
 *
 * Idempotente: blob ja marcado e' ignorado, entao rodar todo boot nao custa nada depois
 * da primeira vez.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { ehFormatoShell, type Cifra } from './cifra.ts';

/** Onde moram os segredos avulsos: tabela, coluna da chave primaria e coluna cifrada. */
const ALVOS: { tabela: string; chave: string; coluna: string }[] = [
  { tabela: 'cliente_bases', chave: 'id', coluna: 'senha_cifrada' },
  { tabela: 'cliente_bases', chave: 'id', coluna: 'banco_senha_cifrada' },
  { tabela: 'email_config', chave: 'id', coluna: 'smtp_senha_cifrada' },
];

export interface ResultadoMigracao {
  migrados: number;
  pendentes: number;
}

/** A tabela pode nao existir ainda num banco novo — nao e' erro, e' banco sem uso. */
function tabelaExiste(db: DatabaseSync, tabela: string): boolean {
  const linha = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tabela) as { name?: string } | undefined;
  return Boolean(linha?.name);
}

export async function migrarSegredosParaShell(dataDir: string, cifra: Cifra): Promise<ResultadoMigracao> {
  const db = new DatabaseSync(join(dataDir, 'sankhya.db'));
  let migrados = 0;
  let pendentes = 0;

  try {
    for (const alvo of ALVOS) {
      if (!tabelaExiste(db, alvo.tabela)) continue;

      const linhas = db
        .prepare(
          `SELECT ${alvo.chave} AS chave, ${alvo.coluna} AS cifrada
             FROM ${alvo.tabela}
            WHERE ${alvo.coluna} IS NOT NULL AND ${alvo.coluna} <> ''`,
        )
        .all() as { chave: number; cifrada: string }[];

      for (const linha of linhas) {
        if (ehFormatoShell(linha.cifrada)) continue;

        const novo = await cifra.migrar(linha.cifrada);
        if (!novo) {
          pendentes += 1;
          continue;
        }

        db.prepare(`UPDATE ${alvo.tabela} SET ${alvo.coluna} = ? WHERE ${alvo.chave} = ?`).run(
          novo,
          linha.chave,
        );
        migrados += 1;
      }
    }
  } finally {
    db.close();
  }

  return { migrados, pendentes };
}
