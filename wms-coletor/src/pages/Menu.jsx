import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
export default function Menu() {
const navigate = useNavigate();
const [contadores, setContadores] = useState({ separacao: 0, reposicao: 0 });
useEffect(() => {
Promise.all([
api.get('/tarefas/separacao?status=pendente'),
api.get('/tarefas/reposicao?status=pendente'),
]).then(([sep, rep]) => {
setContadores({ separacao: sep.length, reposicao: rep.length });
});
}, []);
const opcoes = [
{ rota: '/nf-importacao', label: 'Recebimento (NF)', contador: null, cor: 'accent' },
{ rota: '/separacao', label: 'Separação', contador: contadores.separacao, cor: 'accent' },
{ rota: '/separacao-erp', label: 'Separação (novo fluxo)', contador: null, cor: 'accent' },
{ rota: '/conferencia-erp', label: 'Conferência de embarque', contador: null, cor: 'accent' },
{ rota: '/reposicao', label: 'Reposição', contador: contadores.reposicao, cor: 'warning' },
{ rota: '/picking', label: 'Picking (repor)', contador: null },
{ rota: '/inventario', label: 'Contagem de inventário', contador: null },
];
return (
<div className="tela">
<div>
<p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Operador</p>
<p style={{ fontSize: 18, fontWeight: 600 }}>Boxer Soldas</p>
</div>
{opcoes.map((op) => (
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
</div>
);
}
