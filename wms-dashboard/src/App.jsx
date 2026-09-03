import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { TemaProvider } from './theme/TemaContext.jsx';
import { TituloPaginaProvider } from './contexts/TituloPaginaContext.jsx';
import Topbar from './components/Topbar.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import Login from './pages/Login.jsx';
import TrocarSenha from './pages/TrocarSenha.jsx';
import MapaRuas from './pages/MapaRuas.jsx';
import Pedidos from './pages/Pedidos.jsx';
import Divergencias from './pages/Divergencias.jsx';
import Produtos from './pages/Produtos.jsx';
import CadastroProduto from './pages/CadastroProduto.jsx';
import EntradasManuais from './pages/EntradasManuais.jsx';
import Historico from './pages/Historico.jsx';
import Unidades from './pages/Unidades.jsx';
import Colaboradores from './pages/Colaboradores.jsx';
import ReposicaoKanban from './pages/ReposicaoKanban.jsx';

function ConteudoApp() {
    const { colaborador, carregando } = useAuth();

    if (carregando) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                Carregando...
            </div>
        );
    }

    if (!colaborador) {
        return <Login />;
    }

    // Senha definida por um admin (cadastro novo ou reset) - obriga a
    // troca antes de liberar qualquer outra tela do sistema.
    if (colaborador.precisaTrocarSenha) {
        return <TrocarSenha obrigatorio />;
    }

    return (
        <TituloPaginaProvider>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Topbar />
            <main style={{ flex: 1, padding: '1.5rem 2rem' }}>
                <Routes>
                    <Route path="/" element={<MapaRuas />} />
                    <Route path="/pedidos" element={<Pedidos />} />
                    <Route path="/divergencias" element={<Divergencias />} />
                    <Route path="/produtos" element={<Produtos />} />
                    <Route path="/produtos/novo" element={<CadastroProduto />} />
                    <Route
                        path="/entradas-manuais"
                        element={
                            <RotaProtegida cargos={['recebimento_reposicao']}>
                                <EntradasManuais />
                            </RotaProtegida>
                        }
                    />
                    <Route path="/historico" element={<Historico />} />
                    <Route
                        path="/reposicao-kanban"
                        element={
                            <RotaProtegida cargos={['recebimento_reposicao']}>
                                <ReposicaoKanban />
                            </RotaProtegida>
                        }
                    />
                    <Route path="/unidades" element={<Unidades />} />
                    <Route
                        path="/colaboradores"
                        element={
                            <RotaProtegida cargos={['admin']}>
                                <Colaboradores />
                            </RotaProtegida>
                        }
                    />
                </Routes>
            </main>
        </div>
        </TituloPaginaProvider>
    );
}

export default function App() {
    return (
        <TemaProvider>
            <AuthProvider>
                <HashRouter>
                    <ConteudoApp />
                </HashRouter>
            </AuthProvider>
        </TemaProvider>
    );
}
