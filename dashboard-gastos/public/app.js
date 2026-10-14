const $ = id => document.getElementById(id);
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = new Date().toISOString().slice(0, 10);
let grafico;

/* ---------- Armazenamento local (localStorage), separado por cliente ---------- */
const K_CLIENTES = 'gastos:clientes';
const K_ATUAL = 'gastos:cliente-atual';
const kDados = id => `gastos:dados:${id}`;

function ler(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; }
  catch { return padrao; }
}
function gravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
  catch { alert('Não foi possível salvar no navegador (armazenamento cheio ou bloqueado).'); return false; }
}
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let clientes = ler(K_CLIENTES, []);
if (!clientes.length) { clientes = [{ id: novoId(), nome: 'Cliente 1' }]; gravar(K_CLIENTES, clientes); }
let clienteId = localStorage.getItem(K_ATUAL);
if (!clientes.some(c => c.id === clienteId)) clienteId = clientes[0].id;

const getGastos = () => ler(kDados(clienteId), []);
const setGastos = lista => gravar(kDados(clienteId), lista);

/* ---------- Clientes ---------- */
function renderClientes() {
  $('cliente').innerHTML = clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  $('cliente').value = clienteId;
  localStorage.setItem(K_ATUAL, clienteId);
}

$('cliente').onchange = () => { clienteId = $('cliente').value; localStorage.setItem(K_ATUAL, clienteId); limparForm(); carregar(); };

$('novoCliente').onclick = () => {
  const nome = (prompt('Nome do novo cliente:') || '').trim();
  if (!nome) return;
  const c = { id: novoId(), nome };
  clientes.push(c); gravar(K_CLIENTES, clientes);
  clienteId = c.id; renderClientes(); limparForm(); carregar();
};

$('renomear').onclick = () => {
  const atual = clientes.find(c => c.id === clienteId);
  const nome = (prompt('Novo nome:', atual.nome) || '').trim();
  if (!nome) return;
  atual.nome = nome; gravar(K_CLIENTES, clientes); renderClientes();
};

$('excluirCliente').onclick = () => {
  if (clientes.length === 1) return alert('Precisa existir pelo menos um cliente.');
  const atual = clientes.find(c => c.id === clienteId);
  if (!confirm(`Excluir o cliente "${atual.nome}" e todos os gastos dele?`)) return;
  try { localStorage.removeItem(kDados(clienteId)); } catch {}
  clientes = clientes.filter(c => c.id !== clienteId); gravar(K_CLIENTES, clientes);
  clienteId = clientes[0].id; renderClientes(); limparForm(); carregar();
};

/* ---------- Dados ---------- */
const mesAtual = () => $('mes').value;
const filtrar = lista => mesAtual() ? lista.filter(g => g.data.slice(0, 7) === mesAtual()) : lista;

function resumir(gastos) {
  const mapa = {};
  gastos.forEach(g => {
    const m = mapa[g.categoria] || (mapa[g.categoria] = { categoria: g.categoria, total: 0, qtd: 0 });
    m.total += g.valor; m.qtd++;
  });
  const porCategoria = Object.values(mapa)
    .map(c => ({ ...c, total: Math.round(c.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
  const total = Math.round(porCategoria.reduce((s, c) => s + c.total, 0) * 100) / 100;
  return { total, porCategoria };
}

function carregar() {
  const gastos = filtrar(getGastos()).sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));
  const resumo = resumir(gastos);

  $('total').textContent = brl(resumo.total);
  $('categorias').innerHTML = resumo.porCategoria.length
    ? resumo.porCategoria.map(c => `<div class="cat"><span>${esc(c.categoria)} <small style="color:#6b7280">(${c.qtd})</small></span><strong>${brl(c.total)}</strong></div>`).join('')
    : '<div class="vazio">Sem dados</div>';

  $('lista').innerHTML = gastos.map(g => `
    <tr>
      <td data-label="Data">${g.data.split('-').reverse().join('/')}</td>
      <td data-label="Descrição">${esc(g.descricao)}</td>
      <td data-label="Categoria">${esc(g.categoria)}</td>
      <td class="v" data-label="Valor">${brl(g.valor)}</td>
      <td class="v">
        <button class="edit" data-edit="${esc(g.id)}">Editar</button>
        <button class="del" data-del="${esc(g.id)}">Excluir</button>
      </td>
    </tr>`).join('');
  $('vazio').hidden = gastos.length > 0;

  const cats = resumir(getGastos()).porCategoria;
  $('cats').innerHTML = cats.map(c => `<option value="${esc(c.categoria)}">`).join('');
  desenharGrafico(resumo.porCategoria);
}

function desenharGrafico(dados) {
  if (grafico) grafico.destroy();
  if (!window.Chart) return;
  grafico = new Chart($('grafico'), {
    type: 'doughnut',
    data: {
      labels: dados.map(d => d.categoria),
      datasets: [{ data: dados.map(d => d.total),
        backgroundColor: ['#4f46e5','#06b6d4','#f59e0b','#ef4444','#10b981','#8b5cf6','#ec4899','#64748b'] }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: window.innerWidth < 600 ? 'bottom' : 'right' },
      tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } } } }
  });
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function limparForm() {
  $('form').reset(); $('id').value = ''; $('data').value = hoje;
  $('salvar').textContent = 'Adicionar'; $('cancelar').hidden = true;
}

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const g = {
    descricao: $('descricao').value.trim(), categoria: $('categoria').value.trim(),
    valor: Number($('valor').value), data: $('data').value
  };
  if (!g.descricao || !g.categoria) return alert('Descrição e categoria são obrigatórias.');
  if (!(g.valor > 0)) return alert('Valor deve ser maior que zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.data)) return alert('Data inválida.');

  const lista = getGastos();
  const id = $('id').value;
  if (id) {
    const i = lista.findIndex(x => x.id === id);
    if (i >= 0) lista[i] = { id, ...g };
  } else {
    lista.push({ id: novoId(), ...g });
  }
  if (setGastos(lista)) { limparForm(); carregar(); }
});

$('lista').addEventListener('click', e => {
  const b = e.target;
  if (b.dataset.del) {
    if (confirm('Excluir este gasto?')) { setGastos(getGastos().filter(g => g.id !== b.dataset.del)); carregar(); }
  } else if (b.dataset.edit) {
    const g = getGastos().find(x => x.id === b.dataset.edit);
    if (!g) return;
    $('id').value = g.id; $('descricao').value = g.descricao; $('categoria').value = g.categoria;
    $('valor').value = g.valor; $('data').value = g.data;
    $('salvar').textContent = 'Salvar'; $('cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

$('cancelar').onclick = limparForm;
$('mes').onchange = carregar;
$('todos').onclick = () => { $('mes').value = ''; carregar(); };

$('csv').onclick = () => {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const linhas = filtrar(getGastos()).sort((a, b) => a.data.localeCompare(b.data))
    .map(g => [g.data, q(g.descricao), q(g.categoria), String(g.valor).replace('.', ',')].join(';'));
  const csv = '\uFEFF' + ['data;descricao;categoria;valor', ...linhas].join('\n');
  const nome = clientes.find(c => c.id === clienteId).nome.replace(/[^\w-]+/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `gastos-${nome}${mesAtual() ? '-' + mesAtual() : ''}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};

/* ---------- Início ---------- */
$('mes').value = hoje.slice(0, 7);
$('data').value = hoje;
renderClientes();
carregar();
