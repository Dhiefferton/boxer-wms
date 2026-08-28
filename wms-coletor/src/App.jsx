import { HashRouter, Routes, Route } from 'react-router-dom';
import Menu from './pages/Menu.jsx';
import Separacao from './pages/Separacao.jsx';
import SeparacaoErp from './pages/SeparacaoErp.jsx';
import Reposicao from './pages/Reposicao.jsx';
import Inventario from './pages/Inventario.jsx';
import Picking from './pages/Picking.jsx';
import NfImportacao from './pages/NfImportacao.jsx';
import ConferenciaErp from './pages/ConferenciaErp.jsx';
export default function App() {
return (
<HashRouter>
<Routes>
<Route path="/" element={<Menu />} />
<Route path="/separacao" element={<Separacao />} />
<Route path="/separacao-erp" element={<SeparacaoErp />} />
<Route path="/reposicao" element={<Reposicao />} />
<Route path="/inventario" element={<Inventario />} />
<Route path="/picking" element={<Picking />} />
<Route path="/nf-importacao" element={<NfImportacao />} />
<Route path="/conferencia-erp" element={<ConferenciaErp />} />
</Routes>
</HashRouter>
);
}
