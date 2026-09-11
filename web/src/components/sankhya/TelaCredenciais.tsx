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
  const { credenciais, erroHelper, carregando, versao, gravar, remover } = useCredenciais(toast);

  return (
    <section className="painel">
      <p className="painel-nota">
        Usadas pelo hub para se autenticar sozinho nos dois sistemas. A senha é cifrada com
        DPAPI pelo <code>hub-helper.ps1</code>, fora do container e fora do volume Docker —
        nem esta tela nem a API do hub conseguem lê-la de volta.
      </p>

      {erroHelper && (
        <div className="warning">
          <span>⚠</span>
          <span>
            {erroHelper}
            <br />
            Suba o helper com <code>powershell -ExecutionPolicy Bypass -File scripts\hub-helper.ps1</code>
            {' '}(ou pelo atalho do Desktop) e recarregue a página.
          </span>
        </div>
      )}

      {carregando && !erroHelper && <p className="detail-empty">Carregando…</p>}

      {credenciais.map((credencial) => (
        <CartaoCredencial
          key={`${credencial.sistema}:${versao}`}
          credencial={credencial}
          onGravar={(usuario, senha) => gravar(credencial.sistema, usuario, senha)}
          onRemover={() => remover(credencial.sistema)}
        />
      ))}
    </section>
  );
}

function CartaoCredencial({
  credencial,
  onGravar,
  onRemover,
}: {
  credencial: StatusCredencial;
  onGravar: (usuario: string, senha: string) => Promise<boolean>;
  onRemover: () => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);
  const titulo = TITULOS[credencial.sistema];

  const aoSubmeter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);

    setSalvando(true);
    try {
      // Gravar com sucesso remonta este formulário (a `key` carrega a versão), então a
      // senha sai do DOM sozinha — um campo preenchido daria a impressão falsa de que a
      // tela sabe o valor atual, e ela nunca sabe.
      await onGravar(String(dados.get('usuario') ?? '').trim(), String(dados.get('senha') ?? ''));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <article className="card">
      <form onSubmit={(e) => void aoSubmeter(e)}>
        <div className="detail-head">
          <div className="card-title">
            <h2>
              {titulo.nome}
              {credencial.definido ? (
                <span className="selo ok">guardada</span>
              ) : (
                <span className="selo falta">não configurada</span>
              )}
            </h2>
            <p>{titulo.onde}</p>
            {credencial.definido && (
              <p className="card-summary">
                usuário atual: <code>{credencial.usuario}</code>
              </p>
            )}
          </div>
        </div>

        <div className="form-campos">
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
            <input type="password" name="senha" autoComplete="new-password" required
              placeholder={credencial.definido ? 'informe de novo para substituir' : 'informe a senha'} />
          </label>
        </div>

        <div className="form-acoes">
          {credencial.definido && (
            <button className="btn tiny ghost danger" type="button" onClick={() => void onRemover()}>
              Remover
            </button>
          )}
          <span className="modal-acoes-spacer" />
          <button className="btn tiny" type="submit" disabled={salvando}>
            {credencial.definido ? 'Substituir' : 'Guardar'}
          </button>
        </div>
      </form>
    </article>
  );
}
