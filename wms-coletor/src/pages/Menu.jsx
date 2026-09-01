import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import TrocarSenha from './TrocarSenha.jsx';

const ROTULOS_CARGO = {
    admin: 'Admin',
    conferente: 'Conferente',
    picking: 'Picking',
    recebimento_reposicao: 'Recebimento / Repositor Picking',
};

export default function Menu() {
    const navigate = useNavigate();
    const { colaborador, sair } = useAuth();
    const [contadores, setContadores] = useState({ separacao: 0, reposicao: 0 });
    const [trocandoSenha, setTrocandoSenha] = useState(false);

    useEffect(() => {
        Promise.all([
            api.get('/tarefas/separacao?status=pendente'),
            api.get('/tarefas/reposicao?status=pendente'),
        ]).then(([sep, rep]) => {
            setContadores({ separacao: sep.length, reposicao: rep.length });
        });
    }, []);

    // "cargos" ausente = qualquer colaborador logado ve a opcao.
    // 'admin' sempre ve tudo, mesmo sem estar na lista - mesma regra
    // do backend (exigirCargo, em wms-api/auth.js).
    const opcoes = [
        { rota: '/nf-importacao', label: 'Recebimento (NF)', contador: null, cor: 'accent', cargos: ['recebimento_reposicao'] },
        { rota: '/separacao', label: 'Separação', contador: contadores.separacao, cor: 'accent', cargos: ['picking'] },
        { rota: '/separacao-erp', label: 'Separação (novo fluxo)', contador: null, cor: 'accent', cargos: ['picking'] },
        { rota: '/conferencia-erp', label: 'Conferência de embarque', contador: null, cor: 'accent', cargos: ['conferente'] },
        { rota: '/reposicao', label: 'Reposição', contador: contadores.reposicao, cor: 'warning', cargos: ['recebimento_reposicao'] },
        { rota: '/picking', label: 'Picking (repor)', contador: null, cargos: ['recebimento_reposicao'] },
        { rota: '/inventario', label: 'Contagem de inventário', contador: null },
    ];

    const opcoesVisiveis = opcoes.filter(
        (op) => !op.cargos || colaborador.cargo === 'admin' || op.cargos.includes(colaborador.cargo)
    );

    return (
        <div className="tela">
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
