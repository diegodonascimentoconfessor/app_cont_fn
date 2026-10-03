document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const b = document.getElementById('b'), er = document.getElementById('erro');
  b.disabled = true; er.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: document.getElementById('senha').value }) });
    if (r.ok) return (location.href = '/');
    er.textContent = (await r.json().catch(() => ({}))).erro || 'Erro ao entrar.';
  } catch { er.textContent = 'Sem conexão com o servidor.'; }
  b.disabled = false;
});
