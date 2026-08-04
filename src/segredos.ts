/**
 * Cofre de variaveis preenchidas pelo painel.
 *
 * Existe para que configurar um projeto seja preencher um formulario, em vez de editar
 * um arquivo e recriar o container. Variavel de ambiente e lida uma unica vez, na
 * criacao do processo — por isso o cofre NAO e um `.env`: e um arquivo lido a cada
 * carga da config, o que permite ao hub aplicar o valor novo com um reload e o semaforo
 * sair do cinza em segundos.
 *
 * Fica no `DATA_DIR` (volume `monitor-data`) e nao em `config/`, por dois motivos: o
 * `config/` e montado read-only, e segredo digitado no painel nao deve cair num
 * diretorio que o usuario versiona por habito.
 *
 * O valor sai daqui para a interpolacao da config e para lugar nenhum mais. Nenhuma
 * rota devolve o conteudo — a API responde apenas se cada nome TEM ou NAO TEM valor.
 *
 * Cada projeto tem o proprio espaco de nomes: `ORACLE_HOST` do Sankhya e outro valor,
 * guardado em outro lugar, que o `ORACLE_HOST` de qualquer outro projeto. E o que
 * permite nomes curtos no YAML sem prefixo de projeto, e impede que configurar um
 * projeto sobrescreva silenciosamente a credencial de outro.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ARQUIVO = 'segredos.json';

/** Só dono lê e escreve. Num volume Docker o processo é o dono, então isto pega. */
const PERMISSAO_RESTRITA = 0o600;

export class Cofre {
  readonly #caminho: string;
  /** `{ idDoProjeto: { NOME: valor } }` — um espaco de nomes por projeto. */
  #porProjeto: Record<string, Record<string, string>> = {};

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#caminho = join(dataDir, ARQUIVO);
    this.#carregar();
  }

  #carregar(): void {
    if (!existsSync(this.#caminho)) return;

    try {
      const bruto: unknown = JSON.parse(readFileSync(this.#caminho, 'utf8'));
      if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return;

      // Aceita so o formato aninhado. Uma chave solta no topo e do formato antigo, de
      // espaco de nomes unico — descartada em vez de adivinhar a qual projeto pertencia,
      // porque atribuir ao projeto errado colocaria a senha de um banco em outro.
      for (const [projeto, valores] of Object.entries(bruto)) {
        if (!valores || typeof valores !== 'object' || Array.isArray(valores)) continue;

        const limpos: Record<string, string> = {};
        for (const [nome, valor] of Object.entries(valores)) {
          if (typeof valor === 'string') limpos[nome] = valor;
        }
        if (Object.keys(limpos).length) this.#porProjeto[projeto] = limpos;
      }
    } catch {
      // Arquivo ilegível é tratado como cofre vazio: os checks afetados voltam a ficar
      // cinza pedindo configuração, que é recuperável. Abortar o boot não seria.
      this.#porProjeto = {};
    }
  }

  /** Cópia dos valores de UM projeto, para interpolar a config dele. */
  valoresDe(serviceId: string): Record<string, string> {
    return { ...this.#porProjeto[serviceId] };
  }

  /** Nomes com valor guardado no projeto — o que a API revela sem expor segredo. */
  nomesDefinidosDe(serviceId: string): string[] {
    return Object.keys(this.#porProjeto[serviceId] ?? {});
  }

  /**
   * Grava (ou apaga) variaveis de um projeto. String vazia REMOVE a variavel, e e
   * assim que o formulario limpa um valor errado sem precisar de outro botao.
   *
   * A escrita e atomica — arquivo temporario e rename. Sem isso, um crash no meio do
   * `writeFile` deixaria um JSON truncado, e o hub subiria sem nenhuma credencial.
   */
  gravar(serviceId: string, entradas: Record<string, string>): void {
    const atual = { ...this.#porProjeto[serviceId] };

    for (const [nome, valor] of Object.entries(entradas)) {
      if (valor === '') delete atual[nome];
      else atual[nome] = valor;
    }

    // Projeto sem nenhuma variavel sai do arquivo: sem isso o JSON acumularia objetos
    // vazios de todo projeto que ja teve configuracao apagada.
    if (Object.keys(atual).length) this.#porProjeto[serviceId] = atual;
    else delete this.#porProjeto[serviceId];

    const temporario = `${this.#caminho}.tmp`;
    writeFileSync(temporario, JSON.stringify(this.#porProjeto, null, 2), {
      encoding: 'utf8',
      mode: PERMISSAO_RESTRITA,
    });
    renameSync(temporario, this.#caminho);
  }
}
