import { useState, type CSSProperties } from 'react';
import type { CheckSnapshot, ServiceSnapshot } from '../types.ts';
import { enviar, rotaServico } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';
import { Semaphore } from './Semaphore.tsx';
import { Avatar, ConfigPendente, ResumoServico } from './ServiceIdentity.tsx';
import { ActionButtons } from './ActionButtons.tsx';
import { Check } from './Check.tsx';

interface Props {
  service: ServiceSnapshot;
  flashes: ReadonlySet<string>;
  infoAbertas: ReadonlySet<string>;
  acoesServicoAbertas: ReadonlySet<string>;
  acoesProjetoAbertas: ReadonlySet<string>;
  onToggleInfo: (chave: string) => void;
  onToggleAcoesServico: (chave: string) => void;
  onToggleAcoesProjeto: (serviceId: string) => void;
  onAbrirConfig: (serviceId: string) => void;
  onAbrirCaminhosWildfly: () => void;
  onAbrirCheckSettings: (serviceId: string, checkId: string) => void;
  onCheckAtualizado: (snapshot: CheckSnapshot) => void;
  toast: Avisar;
}

export function Detail(props: Props) {
  return (
    <section className="detail">
      <DetailCard {...props} />
    </section>
  );
}

function DetailCard({
  service,
  flashes,
  infoAbertas,
  acoesServicoAbertas,
  acoesProjetoAbertas,
  onToggleInfo,
  onToggleAcoesServico,
  onToggleAcoesProjeto,
  onAbrirConfig,
  onAbrirCaminhosWildfly,
  onAbrirCheckSettings,
  onCheckAtualizado,
  toast,
}: Props) {
  const [alterandoServico, setAlterandoServico] = useState(false);

  const acoesDoProjeto = service.actions.filter((a) => !a.checkId);
  const acoesProjetoAberto = acoesProjetoAbertas.has(service.id);

  const alternarServico = async () => {
    const enabled = Boolean(service.disabled); // estava desabilitado -> este clique habilita
    setAlterandoServico(true);
    try {
      const { ok, body } = await enviar(rotaServico(service.id, 'enabled'), { enabled });
      if (!ok) toast(body.error ?? 'Não consegui alterar o projeto', 'err');
      // Sucesso: o servidor recarrega e o SSE manda um `snapshot` novo — a tela se
      // atualiza sozinha, sem precisar remendar o estado aqui.
    } catch (err) {
      toast(`Falha ao alterar o projeto: ${(err as Error).message}`, 'err');
    } finally {
      setAlterandoServico(false);
    }
  };

  return (
    <article
      className={`card detail-card${service.disabled ? ' disabled' : ''}`}
      data-status={service.status}
      style={service.accent ? ({ '--accent-color': service.accent } as CSSProperties) : undefined}
    >
      <div className="detail-head">
        <Avatar service={service} />
        <div className="card-title">
          <h2>
            {service.name}
            {service.disabled && <span className="badge-disabled">desabilitado</span>}
            <ConfigPendente service={service} />
          </h2>
          {service.description && <p title={service.description}>{service.description}</p>}
          <p className="card-summary">
            <ResumoServico service={service} />
          </p>
          {service.tags.length > 0 && (
            <div className="tags">
              {service.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <Semaphore status={service.status} extra="vertical lg" />
        <div className="detail-actions">
          {acoesDoProjeto.length > 0 && (
            <button
              className="btn tiny ghost"
              aria-expanded={acoesProjetoAberto}
              title="Ações do projeto"
              onClick={() => onToggleAcoesProjeto(service.id)}
            >
              Ações
            </button>
          )}
          {/*
            Os `links` do services.yaml (ex.: o Sankhya local em localhost:8080/mge). No
            shell desktop, endereço local abre numa aba do próprio app — ver o tratamento
            de loopback em desktop/src/tabs.ts; no navegador comum, uma aba normal.
          */}
          {service.links.map((link) => (
            <a
              key={link.url}
              className="btn tiny ghost"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.url}
            >
              {link.label} ↗
            </a>
          ))}
          {/*
            Fica junto das ações e não no cabeçalho porque configurar é tarefa ocasional
            — o cabeçalho recolhido precisa do espaço para status, que é o que se olha o
            tempo todo. Único ponto de entrada pro formulário de variáveis.
          */}
          {service.envVars.length > 0 && (
            <button
              className="btn tiny ghost"
              title="Informar as variáveis que este projeto usa"
              onClick={() => onAbrirConfig(service.id)}
            >
              Variáveis
            </button>
          )}
          {/*
            Só aparece para quem tem WildFly. Os caminhos são desta máquina e de quem os
            lê são os helpers em PowerShell, não o hub — por isso não cabem no
            `services.yaml`, que é versionado e o mesmo em vários computadores.
          */}
          {service.checks.some((c) => c.checkId === 'wildfly') && (
            <button
              className="btn tiny ghost"
              title="Onde está a instalação do WildFly e o server.log desta máquina"
              onClick={() => onAbrirCaminhosWildfly()}
            >
              Caminhos
            </button>
          )}
          <button
            className="btn tiny ghost"
            disabled={alterandoServico}
            title={
              service.disabled
                ? 'Reativar o monitoramento deste projeto'
                : 'Pausar o monitoramento deste projeto — os checks param de rodar'
            }
            onClick={() => void alternarServico()}
          >
            {service.disabled ? '▶ Habilitar' : '⏸ Desabilitar'}
          </button>
        </div>
      </div>

      <div className="project-actions">
        {acoesProjetoAberto && (
          <div className="actions-panel">
            <ActionButtons serviceId={service.id} actions={acoesDoProjeto} toast={toast} />
          </div>
        )}
      </div>

      <div className="checks">
        {service.checks.map((check) => {
          const chave = `${service.id}:${check.checkId}`;
          return (
            <Check
              key={check.checkId}
              check={check}
              actions={service.actions.filter((a) => a.checkId === check.checkId)}
              flash={flashes.has(chave)}
              infoAberta={infoAbertas.has(chave)}
              acoesAbertas={acoesServicoAbertas.has(chave)}
              onToggleInfo={() => onToggleInfo(chave)}
              onToggleAcoes={() => onToggleAcoesServico(chave)}
              onAbrirSettings={() => onAbrirCheckSettings(service.id, check.checkId)}
              onCheckAtualizado={onCheckAtualizado}
              toast={toast}
            />
          );
        })}
      </div>
    </article>
  );
}
