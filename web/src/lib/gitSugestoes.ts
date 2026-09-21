/**
 * Traduz a saída crua do git (em `AVISO: push falhou -> ...`) num motivo em português e,
 * quando dá, um comando pra copiar. Cobre os casos mais comuns — o resto cai no motivo
 * genérico, sem comando, e a saída completa continua disponível no toast/detalhe.
 */
export interface SugestaoFalha {
  motivo: string;
  comando?: string;
}

const REGRAS: { padrao: RegExp; sugestao: SugestaoFalha }[] = [
  {
    padrao: /non-fast-forward|fetch first|rejected.*(fast-forward|non-fast)/i,
    sugestao: {
      motivo: 'O remoto tem commits que este repositório ainda não tem.',
      comando: 'git pull --rebase',
    },
  },
  {
    padrao: /has no upstream branch/i,
    sugestao: {
      motivo: 'A branch local não está associada a nenhuma branch remota.',
      comando: 'git push --set-upstream origin HEAD',
    },
  },
  {
    padrao: /protected branch|denied.*hook declined|GH006/i,
    sugestao: {
      motivo: 'A branch remota é protegida — push direto não é permitido.',
    },
  },
  {
    padrao: /permission denied \(publickey\)|could not read username|authentication failed|403/i,
    sugestao: {
      motivo: 'Credencial do remoto expirou ou não está configurada nesta máquina.',
    },
  },
  {
    padrao: /could not resolve host|network is unreachable|timed out|timeout/i,
    sugestao: {
      motivo: 'O remoto não respondeu — sem rede ou VPN/servidor fora do ar.',
    },
  },
  {
    padrao: /conflict|merge conflict/i,
    sugestao: {
      motivo: 'Há conflito entre as alterações locais e o remoto.',
      comando: 'git status',
    },
  },
];

/** `null` quando a mensagem não bate com nenhum padrão conhecido — não há o que sugerir. */
export function sugerirFalha(mensagem: string): SugestaoFalha | null {
  for (const regra of REGRAS) {
    if (regra.padrao.test(mensagem)) return regra.sugestao;
  }
  return null;
}
