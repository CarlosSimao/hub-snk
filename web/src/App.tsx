import { useCallback, useEffect, useState } from 'react';
import type { Alert } from './types.ts';
import { SEVERITY_TITLE } from './lib/format.ts';
import { enviar } from './lib/api.ts';
import { alternarTema } from './lib/tema.ts';
import { useHubStream } from './hooks/useHubStream.ts';
import { useToasts } from './hooks/useToasts.ts';
import { useNotificacoes } from './hooks/useNotificacoes.ts';
import { useTick } from './hooks/useTick.ts';
import { Topbar } from './components/Topbar.tsx';
import { TabBar, type Aba } from './components/TabBar.tsx';
import { Footer, Toasts, Warnings } from './components/Chrome.tsx';
import { PainelInfra } from './components/PainelInfra.tsx';
import { PainelSankhya } from './components/sankhya/PainelSankhya.tsx';
import { PainelGit } from './components/git/PainelGit.tsx';
import { PainelConfiguracoes } from './components/ConfiguracoesGerais.tsx';

const CHAVE_SELECIONADO = 'sankhya-hub-selecionado';
const CHAVE_ABA = 'sankhya-hub-aba';

type AbaTopo = 'infra' | 'sankhya' | 'git' | 'config';

const ABAS: Aba<AbaTopo>[] = [
  { id: 'infra', rotulo: 'Infra', titulo: 'Monitoramento de WildFly, Oracle e containers' },
  { id: 'sankhya', rotulo: 'Sankhya', titulo: 'Clientes, credenciais e agenda' },
  { id: 'git', rotulo: 'Git', titulo: 'Repositórios do git-autosync' },
  { id: 'config', rotulo: 'Configurações', titulo: 'Ajustes que valem para o hub inteiro' },
];

function abaSalva(): AbaTopo {
  const valor = localStorage.getItem(CHAVE_ABA);
  return valor === 'sankhya' || valor === 'git' || valor === 'config' ? valor : 'infra';
}

export function App() {
  const { toasts, toast } = useToasts();
  const notificacoes = useNotificacoes();

  const [aba, setAba] = useState<AbaTopo>(abaSalva);

  /**
   * Projeto selecionado na lista lateral, preservado entre recargas.
   *
   * Mora aqui e não no painel de Infra porque um alerta crítico seleciona o projeto que
   * caiu — e isso acontece com qualquer aba na tela.
   */
  const [selecionado, setSelecionado] = useState<string | null>(() =>
    localStorage.getItem(CHAVE_SELECIONADO),
  );

  const aoAlertar = useCallback(
    (alert: Alert) => {
      notificacoes.notificar(alert);
      // Um serviço que CAI traz o painel de Infra para a frente e abre o projeto. É a
      // única navegação automática: quando algo quebra, você quer o detalhe na tela sem
      // ter que caçar a aba e o projeto certos.
      if (alert.severity === 'critical') {
        setAba('infra');
        setSelecionado(alert.serviceId);
      }
      toast(
        `${SEVERITY_TITLE[alert.severity]} — ${alert.serviceName} · ${alert.checkName}`,
        alert.severity === 'recovery' ? 'ok' : 'err',
        alert.detail,
      );
    },
    [notificacoes, toast],
  );

  const { model, conexao, flashes, applyCheck, refresh } = useHubStream(aoAlertar);

  // Os textos "há Xmin" envelhecem sozinhos; um tique mantém a tela honesta mesmo
  // quando nenhum check dispara.
  useTick(5000);

  useEffect(() => {
    localStorage.setItem(CHAVE_ABA, aba);
  }, [aba]);

  useEffect(() => {
    if (selecionado) localStorage.setItem(CHAVE_SELECIONADO, selecionado);
  }, [selecionado]);

  const [recarregando, setRecarregando] = useState(false);

  const recarregar = async () => {
    setRecarregando(true);
    try {
      const { ok, body } = await enviar<{ services: number }>('/api/reload');
      if (ok) {
        toast(`Config recarregada — ${body.services} serviço(s)`, 'ok');
        await refresh();
      } else {
        toast('services.yaml inválido — a config anterior continua ativa', 'err', body.error);
      }
    } catch (err) {
      toast(`Falha ao recarregar: ${(err as Error).message}`, 'err');
    } finally {
      setRecarregando(false);
    }
  };

  const cliqueNotificacoes = () => {
    if (notificacoes.permissao === 'granted') {
      // Já ativo: o clique vira uma prévia, para você ver como aparece.
      notificacoes.notificar({
        severity: 'recovery',
        serviceName: 'sankhya-hub',
        checkName: 'Notificações',
        detail: 'Está funcionando — é assim que um alerta vai aparecer.',
        serviceId: '_test',
        checkId: 'perm',
      });
      return;
    }
    void notificacoes.pedirPermissao();
  };

  const carregado = model.generatedAt > 0;
  const totalChecks = model.services.reduce((soma, s) => soma + s.checks.length, 0);

  return (
    <>
      <div className="aurora" aria-hidden="true" />

      {/*
        Topbar e abas grudam juntas: a altura da topbar muda quando ela quebra em duas
        linhas, então um `top` fixo na barra de abas erraria o offset e ela sumiria por
        baixo. Agrupadas, o sticky é um só e não há offset para acertar.
      */}
      <div className="cabecalho">
        <Topbar
          services={model.services}
          carregado={carregado}
          conexao={conexao}
          notificacoes={{
            suportado: notificacoes.suportado,
            permissao: notificacoes.permissao,
            onClique: cliqueNotificacoes,
          }}
          onRecarregar={() => void recarregar()}
          recarregando={recarregando}
          onAlternarTema={alternarTema}
        />
        <TabBar abas={ABAS} ativa={aba} onTrocar={setAba} />
      </div>

      <main>
        {/* Avisos são do hub inteiro (socket do Docker ausente, etc.), não de uma aba. */}
        <Warnings warnings={model.warnings} />

        {aba === 'infra' && (
          <PainelInfra
            model={model}
            carregado={carregado}
            flashes={flashes}
            applyCheck={applyCheck}
            selecionado={selecionado}
            onSelecionar={setSelecionado}
            toast={toast}
          />
        )}

        {aba === 'sankhya' && <PainelSankhya toast={toast} />}

        {aba === 'git' && <PainelGit toast={toast} />}

        {aba === 'config' && <PainelConfiguracoes toast={toast} />}
      </main>

      <Footer checks={totalChecks} generatedAt={model.generatedAt} />

      <Toasts toasts={toasts} />
    </>
  );
}
