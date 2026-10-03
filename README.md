# Dashboard de Gastos Pessoais (pronto para publicar)

Express + Firestore (Admin SDK) + HTML/JS. Login por senha, sessão em cookie httpOnly.

## 1. Segredos (NUNCA no código/GitHub)
Copie `.env.example` e preencha (local) ou cadastre as mesmas variáveis no painel da hospedagem:
- `NODE_ENV=production`
- `APP_PASSWORD` (mín. 12 caracteres, única)
- `SESSION_SECRET` (mín. 32 aleatórios): `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `FIREBASE_SERVICE_ACCOUNT` = chave de serviço em base64 (PowerShell:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json"))`)

## 2. Firestore
Regras bloqueadas (só o servidor acessa, via Admin SDK):
```
rules_version = '2';
service cloud.firestore { match /databases/{db}/documents { match /{document=**} { allow read, write: if false; } } }
```

## 3. Rodar local
```
npm install
# crie .env a partir do .env.example (use NODE_ENV=development e coloque serviceAccountKey.json na raiz)
npm run dev
```
Teste sem Firebase: `DB_DRIVER=memory` (bloqueado em produção).

## 4. Publicar (ex.: Render)
1. Suba o projeto no GitHub (o .gitignore já protege chaves e .env).
2. Render > New Web Service > repositório. Build: `npm ci --omit=dev`. Start: `npm start`.
3. Cadastre as variáveis do passo 1. Health check: `/healthz`. HTTPS vem automático.
Também funciona via Dockerfile (Railway, Fly.io, Cloud Run).
