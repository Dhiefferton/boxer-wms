import { useAuth } from '../auth/AuthContext.jsx';

// Envolve uma rota que exige um cargo especifico. 'admin' sempre
// passa, mesmo sem estar na lista - mesma regra do backend
// (exigirCargo em wms-api/auth.js).
export default function RotaProtegida({ cargos, children }) {
    const { colaborador } = useAuth();
    const permitido =
        !cargos || cargos.length === 0 || colaborador.cargo === 'admin' || cargos.includes(colaborador.cargo);

    if (!permitido) {
        return (
            <div className="card" style={{ maxWidth: 480 }}>
                <h2 style={{ marginBottom: 8 }}>Acesso restrito</h2>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                    Seu nível de acesso não permite ver esta página. Se você acha que isso é um erro, fale com um
                    administrador.
                </p>
            </div>
        );
    }

    return children;
}
