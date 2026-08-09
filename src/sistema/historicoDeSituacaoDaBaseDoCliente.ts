/**
 * Histórico das checagens de situação de cada base de cliente, em memória —
 * alimenta o gráfico de uptime da base na tela do cliente. Mesmo padrão de
 * `historicoDeSituacaoDaBase.ts` (base local): cada chamada à rota de situação
 * (automática ou forçada pelo botão) vira um ponto nesse histórico; não há
 * varredura própria em segundo plano, é o polling do front que gera as
 * amostras.
 *
 * Fica só em memória — reinicia com o servidor. Um desktop tool de um usuário
 * só não precisa persistir isso em disco.
 */

export interface AmostraDeSituacaoDaBaseDoCliente {
  em: string;
  urlOk: boolean;
}

const QUANTIDADE_MAXIMA_DE_AMOSTRAS = 200;

const historicoPorBase = new Map<string, AmostraDeSituacaoDaBaseDoCliente[]>();

export function registrarAmostraDaBaseDoCliente(
  idDaBase: string,
  amostra: AmostraDeSituacaoDaBaseDoCliente,
): void {
  const amostras = historicoPorBase.get(idDaBase) ?? [];
  amostras.push(amostra);

  if (amostras.length > QUANTIDADE_MAXIMA_DE_AMOSTRAS) {
    amostras.splice(0, amostras.length - QUANTIDADE_MAXIMA_DE_AMOSTRAS);
  }

  historicoPorBase.set(idDaBase, amostras);
}

export function obterHistoricoDaBaseDoCliente(idDaBase: string): AmostraDeSituacaoDaBaseDoCliente[] {
  return historicoPorBase.get(idDaBase) ?? [];
}

export function limparHistoricoDaBaseDoCliente(idDaBase: string): void {
  historicoPorBase.delete(idDaBase);
}
