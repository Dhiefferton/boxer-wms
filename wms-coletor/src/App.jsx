import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import Login from './pages/Login.jsx';
import TrocarSenha from './pages/TrocarSenha.jsx';
import Menu from './pages/Menu.jsx';
import SeparacaoErp from './pages/SeparacaoErp.jsx';
import Inventario from './pages/Inventario.jsx';
import Picking from './pages/Picking.jsx';
import NfImportacao from './pages/NfImportacao.jsx';
import ConferenciaErp from './pages/ConferenciaErp.jsx';
import ReimprimirEtiquetas from './pages/ReimprimirEtiquetas.jsx';

function ConteudoApp() {
    const { colaborador, carregando } = useAuth();

    if (carregando) {
        return (
            <div className="tela" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>Carregando...</p>
            </div>
        );
    }

    if (!colaborador) {
        return <Login />;
    }

    // Senha definida por um admin (cadastro novo ou reset) - obriga a
    // troca antes de liberar qualquer outra tela do coletor.
    if (colaborador.precisaTrocarSenha) {
        return <TrocarSenha obrigatorio />;
    }

    return (
        <Routes>
            <Route path="/" element={<Menu />} />
            <Route
                path="/separacao-erp"
                element={
                    <RotaProtegida cargos={['picking']}>
                        <SeparacaoErp />
                    </RotaProtegida>
                }
            />
            <Route path="/inventario" element={<Inventario />} />
            <Route
                path="/picking"
                element={
                    <RotaProtegida cargos={['recebimento_reposicao']}>
                        <Picking />
                    </RotaProtegida>
                }
            />
            <Route
                path="/nf-importacao"
                element={
                    <RotaProtegida cargos={['recebimento_reposicao']}>
                        <NfImportacao />
                    </RotaProtegida>
                }
            />
            <Route
                path="/conferencia-erp"
                element={
                    <RotaProtegida cargos={['conferente']}>
                        <ConferenciaErp />
                    </RotaProtegida>
                }
            />
            <Route
                path="/reimprimir-etiquetas"
                element={
                    <RotaProtegida cargos={['admin']}>
                        <ReimprimirEtiquetas />
                    </RotaProtegida>
                }
            />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <HashRouter>
                <ConteudoApp />
            </HashRouter>
        </AuthProvider>
    );
}
