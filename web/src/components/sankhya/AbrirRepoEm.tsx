/**
 * Os três atalhos de cada repositório cadastrado: terminal, IntelliJ IDEA e uma sessão
 * nova do Claude Code, sempre já na pasta do repositório.
 *
 * Ficam no cartão do cliente porque é lá que o caminho da pasta está cadastrado — o
 * trabalho começa escolhendo o cliente, não procurando a pasta no disco.
 *
 * Nenhum dos três depende do git-autosync: é `spawn` de programa local (ver
 * `src/ferramentas.ts`). Quando a ferramenta não está instalada, a resposta do clique
 * diz onde o backend procurou — é por isso que o detalhe do erro vai inteiro para o
 * toast em vez de virar um "não foi possível abrir".
 */
import { useState } from 'react';
import { enviar } from '../../lib/api.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

type Ferramenta = 'terminal' | 'intellij' | 'claude';

const ROTULO: Record<Ferramenta, string> = {
  terminal: 'Abrir terminal na pasta',
  intellij: 'Abrir no IntelliJ IDEA',
  claude: 'Abrir o Claude Code nesta pasta',
};

export function AbrirRepoEm({ caminho, toast }: { caminho: string; toast: Avisar }) {
  const [ocupada, setOcupada] = useState<Ferramenta | null>(null);

  async function abrir(ferramenta: Ferramenta): Promise<void> {
    setOcupada(ferramenta);
    try {
      const { ok, body } = await enviar<{ saida: string }>('/api/ferramentas/abrir', {
        ferramenta,
        caminho,
      });
      if (ok) toast(body.saida ?? ROTULO[ferramenta], 'ok');
      else toast(`Não consegui ${ROTULO[ferramenta].toLowerCase()}`, 'err', body.error);
    } finally {
      setOcupada(null);
    }
  }

  return (
    <div className="abrir-repo-em">
      {(['terminal', 'intellij', 'claude'] as const).map((ferramenta) => (
        <button
          key={ferramenta}
          type="button"
          className="btn-quadrado"
          disabled={ocupada !== null}
          aria-label={ROTULO[ferramenta]}
          title={ROTULO[ferramenta]}
          onClick={() => void abrir(ferramenta)}
        >
          <Icone ferramenta={ferramenta} />
        </button>
      ))}
    </div>
  );
}

/**
 * Ícones em SVG inline, não emoji: emoji muda de desenho conforme a fonte do sistema e
 * não aceita `currentColor`, então não acompanharia o tema nem o estado desabilitado.
 */
function Icone({ ferramenta }: { ferramenta: Ferramenta }) {
  const comum = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  // Terminal: o prompt `>_`.
  if (ferramenta === 'terminal') {
    return (
      <svg {...comum}>
        <path d="M5 8l3.5 3.5L5 15" />
        <path d="M12.5 16h6" />
      </svg>
    );
  }

  // IntelliJ: as chaves `{}`, que é como o próprio ícone do projeto aparece na imagem
  // de referência da tela.
  if (ferramenta === 'intellij') {
    return (
      <svg {...comum}>
        <path d="M10 4.5c-2 0-2.5 1-2.5 3s0 2.8-2 4.5c2 1.7 2 2.5 2 4.5s.5 3 2.5 3" />
        <path d="M14 4.5c2 0 2.5 1 2.5 3s0 2.8 2 4.5c-2 1.7-2 2.5-2 4.5s-.5 3-2.5 3" />
      </svg>
    );
  }

  // Claude Code: o asterisco da marca.
  return (
    <svg {...comum}>
      <path d="M12 4v16" />
      <path d="M5.1 8l13.8 8" />
      <path d="M18.9 8L5.1 16" />
    </svg>
  );
}
