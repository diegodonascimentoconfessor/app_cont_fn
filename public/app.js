const $ = id => document.getElementById(id);
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = new Date().toISOString().slice(0, 10);
let grafico;
let cache = [];

$('mes').value = hoje.slice(0, 7);
$('data').value = hoje;

const qs = () => ($('mes').value ? `?mes=${$('mes').value}` : '');

async function api(url, opts) {
  const r = await fetch(url, opts && { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { location.href = '/login/'; throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Erro na requisição');
  return r.status === 204 ? null : r.json();
}


// ===== EFEITOS =====
let totalAtual = 0;
function animarTotal(destino) {
  const ini = totalAtual, t0 = performance.now(), dur = 700;
  const el = $('total');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = brl(destino); totalAtual = destino; return; }
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  (function passo(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = brl(ini + (destino - ini) * e);
    if (k < 1) requestAnimationFrame(passo); else totalAtual = destino;
  })(t0);
}
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const r = document.createElement('span'), d = Math.max(b.clientWidth, b.clientHeight), rc = b.getBoundingClientRect();
  r.className = 'ripple'; r.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - rc.left - d/2}px;top:${e.clientY - rc.top - d/2}px`;
  b.appendChild(r); setTimeout(() => r.remove(), 600);
});

async function carregar() {
  const [gastos, resumo] = await Promise.all([api('/api/gastos' + qs()), api('/api/resumo' + qs())]);
  cache = gastos;

  animarTotal(resumo.total);
  const max = Math.max(...resumo.porCategoria.map(c => c.total), 1);
  $('categorias').innerHTML = resumo.porCategoria.length
    ? resumo.porCategoria.map(c => `<div class="cat"><div class="cat-top"><span>${esc(c.categoria)} <small style="color:#6b7280">(${c.qtd})</small></span><strong>${brl(c.total)}</strong></div><div class="bar"><i data-w="${(c.total / max * 100).toFixed(1)}"></i></div></div>`).join('')
    : '<div class="vazio">Sem dados</div>';
  requestAnimationFrame(() => requestAnimationFrame(() =>
    document.querySelectorAll('.bar > i').forEach(i => i.style.width = i.dataset.w + '%')));

  $('lista').innerHTML = gastos.map((g, i) => `
    <tr style="animation-delay:${Math.min(i, 12) * 40}ms">
      <td data-label="Data">${g.data.split('-').reverse().join('/')}</td>
      <td data-label="Descrição">${esc(g.descricao)}</td>
      <td data-label="Categoria">${esc(g.categoria)}</td>
      <td class="v" data-label="Valor">${brl(g.valor)}</td>
      <td class="v acoes-td">
        <div class="acoes">
          <button class="edit" data-edit="${esc(g.id)}">Editar</button>
          <button class="del" data-del="${esc(g.id)}">Excluir</button>
        </div>
      </td>
    </tr>`).join('');
  $('vazio').hidden = gastos.length > 0;

  $('cats').innerHTML = resumo.porCategoria.map(c => `<option value="${esc(c.categoria)}">`).join('');
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
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' },
      tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } } } }
  });
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function limparForm() {
  $('form').reset(); $('id').value = ''; $('data').value = hoje;
  $('salvar').textContent = 'Adicionar'; $('cancelar').hidden = true;
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const corpo = JSON.stringify({
    descricao: $('descricao').value, categoria: $('categoria').value,
    valor: $('valor').value, data: $('data').value
  });
  try {
    const id = $('id').value;
    await api(id ? `/api/gastos/${id}` : '/api/gastos', { method: id ? 'PUT' : 'POST', body: corpo });
    toast(id ? 'Gasto atualizado ✓' : 'Gasto adicionado ✓'); limparForm(); carregar();
  } catch (err) { alert(err.message); }
});

$('lista').addEventListener('click', async e => {
  const b = e.target;
  if (b.dataset.del) {
    if (confirm('Excluir este gasto?')) {
      const tr = b.closest('tr'); tr.classList.add('saindo');
      await api(`/api/gastos/${b.dataset.del}`, { method: 'DELETE' });
      setTimeout(() => { toast('Gasto excluído'); carregar(); }, 280);
    }
  } else if (b.dataset.edit) {
    const g = cache.find(x => x.id === b.dataset.edit);
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
$('csv').onclick = () => { location.href = '/api/export.csv' + qs(); };

$('sair').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login/'; };

carregar();
