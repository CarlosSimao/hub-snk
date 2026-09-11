import { Fragment, type ReactNode } from 'react';
import type { ServiceSnapshot } from '../types.ts';
import { STATUS_LABEL, plural } from '../lib/format.ts';

/**
 * Logo do projeto quando o YAML define `image`, senão o emoji do `icon`, senão a
 * inicial do nome. A cadeia de fallback importa: um caminho de imagem errado não
 * pode deixar o card sem identidade visual nenhuma.
 *
 * `loading="eager"`: são duas imagens acima da dobra, e o lazy faria o avatar
 * piscar vazio a cada re-render do card.
 */
export function Avatar({ service }: { service: ServiceSnapshot }) {
  return (
    <div className="avatar">
      {service.image ? (
        <img src={service.image} alt="" loading="eager" decoding="async" />
      ) : (
        service.icon || service.name.slice(0, 1).toUpperCase()
      )}
    </div>
  );
}

/**
 * Sinal discreto de "falta configurar", ao lado do nome do projeto.
 *
 * Deliberadamente só um símbolo com tooltip: os nomes das variáveis ficam na linha do
 * check que precisa delas, dentro do card. Repetir a lista aqui reconstruiria o banner
 * global que este sinal veio substituir — só que dentro do card.
 */
export function ConfigPendente({ service }: { service: ServiceSnapshot }) {
  const pendentes = service.checks.filter((c) => c.needsConfig);
  if (!pendentes.length) return null;

  const nomes = pendentes.map((c) => c.name).join(', ');
  const titulo =
    pendentes.length === 1
      ? `${nomes}: aguardando configuração — abra o card para ver quais variáveis`
      : `${pendentes.length} checks aguardando configuração (${nomes}) — abra o card para ver quais variáveis`;

  return (
    <span className="cfg-pendente" title={titulo} aria-label={titulo}>
      ⚠
    </span>
  );
}

/** Uma linha honesta sobre o serviço, sem precisar abrir o card. */
export function ResumoServico({ service }: { service: ServiceSnapshot }) {
  const considerados = service.checks.filter((c) => !c.muted && !c.disabled);
  const conta = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const c of considerados) conta[c.status] += 1;

  const partes: ReactNode[] = [];
  if (conta.down) partes.push(<span className="bad">{conta.down} fora do ar</span>);
  if (conta.degraded) {
    partes.push(
      <span className="warn">
        {conta.degraded} {plural(conta.degraded, 'degradado', 'degradados')}
      </span>,
    );
  }
  if (conta.unknown) partes.push(`${conta.unknown} sem dados`);
  if (!partes.length) partes.push(`${conta.up} operacionai${conta.up === 1 ? 'l' : 's'}`);

  const silenciados = service.checks.filter((c) => c.muted && !c.disabled).length;
  const desabilitados = service.checks.filter((c) => c.disabled).length;
  const sufixo: string[] = [];
  if (silenciados) sufixo.push(`${silenciados} ${plural(silenciados, 'silenciado', 'silenciados')}`);
  if (desabilitados) {
    sufixo.push(`${desabilitados} ${plural(desabilitados, 'desabilitado', 'desabilitados')}`);
  }

  const total = service.checks.length;
  return (
    <>
      {total} {plural(total, 'check', 'checks')} ·{' '}
      {partes.map((parte, indice) => (
        <Fragment key={indice}>
          {indice > 0 && ' · '}
          {parte}
        </Fragment>
      ))}
      {sufixo.length > 0 && ` · ${sufixo.join(' · ')}`}
    </>
  );
}

/** Um ponto por check — dá para ver qual está fora sem abrir o card. */
export function Dots({ service }: { service: ServiceSnapshot }) {
  return (
    <div className="dots">
      {service.checks.map((c) => {
        const classes = [c.status, c.muted ? 'muted' : '', c.disabled ? 'disabled' : '']
          .filter(Boolean)
          .join(' ');
        const sufixo = c.disabled ? ' (desabilitado)' : c.muted ? ' (silenciado)' : '';
        return (
          <i key={c.checkId} className={classes} title={`${c.name}: ${STATUS_LABEL[c.status]}${sufixo}`} />
        );
      })}
    </div>
  );
}
