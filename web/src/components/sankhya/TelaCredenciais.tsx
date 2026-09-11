import { useState, type FormEvent } from 'react';
import type { SistemaSankhya, StatusCredencial } from '../../types.ts';
import { useCredenciais } from '../../hooks/useCredenciais.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

const TITULOS: Record<SistemaSankhya, { nome: string; onde: string }> = {
  'sankhya-erp': { nome: 'Sankhya ERP', onde: 'skw.sankhya.com.br — Agenda de Recursos' },
  'sankhya-experience': {
    nome: 'Sankhya Experience',
    onde: 'experience.sankhya.com.br — Tarefas e Ordens de Serviço',
  },
};

export function TelaCredenciais({ toast }: { toast: Avisar }) {
  const {
    credenciais,
    navegador,
    erroHelper,
    carregando,
    versao,
    gravar,
    remover,
    abrirNavegador,
    capturarSessao,
  } = useCredenciais(toast);

  return (
    <section className="painel">
      <p className="painel-nota">
        O hub entra no Sankhya por uma janela própria de navegador, com perfil separado do
        seu. <strong>Você digita a senha na janela, não aqui</strong> — o hub só lê o cookie
        de sessão que sobra e o guarda cifrado com DPAPI, fora do container e fora do volume
        Docker. Guardar a senha continua possível, mas é opcional e serve só para o hub
        conseguir religar sozinho quando a sessão expirar.
      </p>

      {erroHelper && (
        <div className="warning">
          <span>⚠</span>
          <span>
            {erroHelper}
            <br />
            Suba o helper com{' '}
            <code>powershell -ExecutionPolicy Bypass -File scripts\hub-helper.ps1</code> (ou pelo
            atalho do Desktop) e recarregue a página.
          </span>
        </div>
      )}

      {!erroHelper && !navegador.navegador && !carregando && (
        <div className="warning">
          <span>⚠</span>
          <span>Nenhum Chrome ou Edge encontrado na máquina — o login pela janela não funciona.</span>
        </div>
      )}

      {carregando && !erroHelper && <p className="detail-empty">Carregando…</p>}

      {credenciais.map((credencial) => (
        <CartaoCredencial
          key={`${credencial.sistema}:${versao}`}
          credencial={credencial}
          navegadorDisponivel={navegador.navegador}
          onAbrir={() => abrirNavegador(credencial.sistema)}
          onCapturar={() => capturarSessao(credencial.sistema)}
          onGravar={(usuario, senha) => gravar(credencial.sistema, usuario, senha)}
          onRemover={() => remover(credencial.sistema)}
        />
      ))}
    </section>
  );
}

function CartaoCredencial({
  credencial,
  navegadorDisponivel,
  onAbrir,
  onCapturar,
  onGravar,
  onRemover,
}: {
  credencial: StatusCredencial;
  navegadorDisponivel: boolean;
  onAbrir: () => Promise<void>;
  onCapturar: () => Promise<void>;
  onGravar: (usuario: string, senha: string) => Promise<boolean>;
  onRemover: () => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const titulo = TITULOS[credencial.sistema];

  const comOcupado = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };

  const aoSubmeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);

    setSalvando(true);
    try {
      // Gravar com sucesso remonta este cartão (a `key` carrega a versão), então a senha
      // sai do DOM sozinha — um campo preenchido daria a impressão falsa de que a tela
      // sabe o valor atual, e ela nunca sabe.
      await onGravar(String(dados.get('usuario') ?? '').trim(), String(dados.get('senha') ?? ''));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="card">
      <div className="detail-head">
        <div className="card-title">
          <h2>
            {titulo.nome}
            {credencial.sessaoCapturada ? (
              <span className="selo ok">sessão ativa</span>
            ) : (
              <span className="selo falta">sem sessão</span>
            )}
            {credencial.definido && <span className="selo ok">senha guardada</span>}
          </h2>
          <p>{titulo.onde}</p>
        </div>
      </div>

      <div className="form-campos">
        <div className="passo">
          <b>1.</b> Abra a janela do hub e faça o login nela, como você faria no navegador.
        </div>
        <div className="passo">
          <b>2.</b> Volte aqui e capture a sessão. O hub passa a usar esse acesso sozinho.
        </div>
      </div>

      <div className="form-acoes">
        <button
          className="btn tiny"
          type="button"
          disabled={ocupado || !navegadorDisponivel}
          onClick={() => void comOcupado(onAbrir)}
        >
          Abrir janela de login
        </button>
        <button
          className="btn tiny"
          type="button"
          disabled={ocupado || !navegadorDisponivel}
          onClick={() => void comOcupado(onCapturar)}
        >
          Capturar sessão
        </button>
        <span className="modal-acoes-spacer" />
        {(credencial.definido || credencial.sessaoCapturada) && (
          <button
            className="btn tiny ghost danger"
            type="button"
            disabled={ocupado}
            onClick={() => void comOcupado(onRemover)}
          >
            Apagar tudo
          </button>
        )}
      </div>

      {/*
        A senha fica escondida atrás de um toggle: é o caminho alternativo, e deixá-la
        aberta convidaria a digitar ali em vez de usar a janela — que é justamente o que
        este desenho evita.
      */}
      <div className="form-acoes">
        <button
          className="btn tiny ghost"
          type="button"
          aria-expanded={mostrarSenha}
          onClick={() => setMostrarSenha((v) => !v)}
        >
          {mostrarSenha ? 'Esconder' : 'Guardar senha também (opcional)'}
        </button>
      </div>

      {mostrarSenha && (
        <form onSubmit={(e) => void aoSubmeter(e)}>
          <div className="form-campos">
            <p className="campo-dica">
              Só é necessário se você quiser que o hub refaça o login sozinho quando a sessão
              expirar, sem você por perto. Não funciona se a sua conta exigir segundo fator.
            </p>
            <label className="campo">
              <span className="campo-nome">Usuário</span>
              <input
                type="text"
                name="usuario"
                defaultValue={credencial.usuario}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="campo">
              <span className="campo-nome">Senha</span>
              <input
                type="password"
                name="senha"
                autoComplete="new-password"
                required
                placeholder={credencial.definido ? 'informe de novo para substituir' : 'informe a senha'}
              />
            </label>
          </div>
          <div className="form-acoes">
            <span className="modal-acoes-spacer" />
            <button className="btn tiny" type="submit" disabled={salvando}>
              {credencial.definido ? 'Substituir senha' : 'Guardar senha'}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
