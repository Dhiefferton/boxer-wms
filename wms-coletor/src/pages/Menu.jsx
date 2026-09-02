import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import TrocarSenha from './TrocarSenha.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

const ROTULOS_CARGO = {
    admin: 'Admin',
    conferente: 'Conferente',
    picking: 'Picking',
    recebimento_reposicao: 'Recebimento / Repositor Picking',
};

export default function Menu() {
    const navigate = useNavigate();
    const { colaborador, sair } = useAuth();
    const [contadores, setContadores] = useState({ reposicao: 0 });
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    useEffect(() => {
        api.get('/tarefas/reposicao?status=pendente').then((rep) => {
            setContadores({ reposicao: rep.length });
        });
    }, []);

    // "cargos" ausente = qualquer colaborador logado ve a opcao.
    // 'admin' sempre ve tudo, mesmo sem estar na lista - mesma regra
    // do backend (exigirCargo, em wms-api/auth.js).
    // "Separação" (fluxo antigo, tarefas_separacao) e "Reposição"
    // (fila avulsa) saíram do menu: a primeira foi substituída pelo
    // "Separação (novo fluxo)", e a segunda foi incorporada dentro
    // de "Picking (repor)" - que agora mostra a fila automática de
    // reposição primeiro, com o modo avulso como alternativa.
    const opcoes = [
        { rota: '/nf-importacao', label: 'Recebimento (NF)', contador: null, cor: 'accent', cargos: ['recebimento_reposicao'] },
        { rota: '/separacao-erp', label: 'Separação', contador: null, cor: 'accent', cargos: ['picking'] },
        { rota: '/conferencia-erp', label: 'Conferência de embarque', contador: null, cor: 'accent', cargos: ['conferente'] },
        { rota: '/picking', label: 'Picking (repor)', contador: contadores.reposicao, cor: 'warning', cargos: ['recebimento_reposicao'] },
        { rota: '/inventario', label: 'Contagem de inventário', contador: null },
        { rota: '/reimprimir-etiquetas', label: 'Reimprimir etiquetas', contador: null, cargos: ['admin'] },
    ];

    const opcoesVisiveis = opcoes.filter(
        (op) => !op.cargos || colaborador.cargo === 'admin' || op.cargos.includes(colaborador.cargo)
    );

    return (
        <div className="tela">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={logoBoxer} alt="Boxer" style={{ width: 34, height: 34, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                    <h1 style={{ fontSize: 16, margin: 0, lineHeight: 1.2 }}>Boxer WMS</h1>
                    <p style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                        Gestão de armazém
                    </p>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Colaborador</p>
                    <p style={{ fontSize: 18, fontWeight: 600, margin: '2px 0 0' }}>{colaborador.nome}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                        {ROTULOS_CARGO[colaborador.cargo] || colaborador.cargo}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button
                        onClick={() => setTrocandoSenha(true)}
                        title="Trocar senha"
                        style={{ padding: 8, minHeight: 'auto' }}
                    >
                        <Lock size={18} />
                    </button>
                    <button onClick={sair} title="Sair" style={{ padding: 8, minHeight: 'auto' }}>
                        <LogOut size={18} />
                    </button>
                </div>
            </div>

            {trocandoSenha && <TrocarSenha aoFechar={() => setTrocandoSenha(false)} />}

            {opcoesVisiveis.map((op) => (
                <button
                    key={op.rota}
                    onClick={() => navigate(op.rota)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
                >
                    <span>{op.label}</span>
                    {op.contador !== null && (
                        <span className={`badge ${op.cor}`}>{op.contador}</span>
                    )}
                </button>
            ))}

            {opcoesVisiveis.length === 0 && (
                <div className="card">
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                        Seu nível de acesso não tem nenhuma tela disponível aqui ainda. Fale com um administrador.
                    </p>
                </div>
            )}
        </div>
    );
}
