# Firebase — HB Avalia

> Estas instruções descrevem o comportamento funcional e o Firestore do projeto `hb-avalia2`. Para variáveis de ambiente, cron e deploy no Vercel, use [VERCEL-SETUP.md](../VERCEL-SETUP.md).

## Projeto e banco

- Projeto: `hb-avalia2`
- Firestore: `(default)` em `southamerica-east1` (São Paulo)
- Firebase Authentication: provedor E-mail/Senha habilitado
- Regras e índices: `firestore.rules` e `firestore.indexes.json`
- Identificador atual da empresa: `hb-avalia` (o vínculo fica no perfil de cada conta)

O painel interno não oferece cadastro público nem associação automática. Uma administradora ativa envia convites individuais; o aceite cria o vínculo no servidor somente após autenticação e verificação do e-mail convidado. A avaliação pública de clientes por QR Code continua separada desse fluxo.

## Coleções

O Firestore não mantém coleções vazias; cada caminho aparece após a primeira gravação.

| Caminho | Uso |
| --- | --- |
| `userProfiles/{uid}` | Empresa associada à conta autenticada |
| `companies/{companyId}` | Nome e proprietário da empresa |
| `companies/{companyId}/members/{uid}` | Pessoas, função, situação e equipes |
| `invitations/{invitationId}` | Convites de uso único, acessíveis apenas pelas APIs de servidor |
| `companies/{companyId}/departments/{id}` | Setores cadastrados |
| `companies/{companyId}/teams/{id}` | Equipes associadas a setores |
| `companies/{companyId}/criteria/{id}` | Critérios para avaliar liderança ou colaboradores |
| `companies/{companyId}/cycles/{id}` | Períodos de avaliação |
| `companies/{companyId}/evaluations/{id}` | Participantes, ciclo, situação e média |
| `companies/{companyId}/evaluations/{id}/answers/{criterionId}` | Notas por critério |
| `companies/{companyId}/surveys/{id}` | Pesquisas avulsas, público e perguntas |
| `companies/{companyId}/surveys/{id}/responses/{id}` | Respostas sem identificação pessoal |
| `companies/{companyId}/surveys/{id}/participants/{uid}` | Controle privado de resposta única |
| `companies/{companyId}/checklistTemplates/{id}` | Modelos de checklist |
| `companies/{companyId}/checklistAssignments/{id}` | Tarefas atribuídas |
| `companies/{companyId}/checklistAssignments/{id}/results/{itemId}` | Progresso por tarefa |

`evaluationType: "EMPLOYEE"` representa a avaliação do líder sobre um colaborador. `evaluationType: "LEADER"` representa o feedback do colaborador sobre seu líder. As regras permitem que apenas administradores leiam feedbacks sobre líderes; líderes leem avaliações de colaboradores da equipe e colaboradores leem as próprias avaliações.

Líderes podem criar e administrar modelos de checklist para as equipes associadas ao próprio perfil e atribuí-los aos colaboradores ativos dessas equipes. Os modelos armazenam `createdById` e `teamIds` para identificar sua autoria e escopo. Administradores visualizam o panorama geral, identificam o líder responsável por cada modelo e podem editar, ativar, desativar ou excluir qualquer modelo. Colaboradores e líderes veem apenas as próprias atribuições na lista pessoal.

Administradores também podem atribuir modelos ativos diretamente a líderes e colaboradores, individualmente ou por perfil. Líderes têm um panorama agregado do progresso das atribuições de colaboradores das próprias equipes; as tarefas pessoais continuam separadas. Avaliações podem ser salvas como rascunho (`status: "DRAFT"`) e retomadas pelo avaliador antes do envio.

Na atribuição manual, administração e liderança escolhem publicar o checklist imediatamente ou no dia seguinte. Atribuições futuras ficam ocultas para os destinatários até a data de publicação; se o aplicativo continuar aberto, ele atualiza as atribuições à meia-noite. Os prazos seguem o período da frequência: diária vence no dia da publicação, semanal vence no último dia da semana (domingo) e mensal vence no último dia do mês. A frequência personalizada mantém um prazo informado manualmente, que não pode ser anterior à data de publicação. Itens incompletos cujo prazo passou aparecem na seção **Expirados**; continuam disponíveis para conclusão e saem dessa seção ao serem concluídos.

Modelos diários, semanais e mensais também podem ser programados para publicação recorrente. A publicação diária ocorre todos os dias às 00h05 no fuso `America/Sao_Paulo`; a semanal permite selecionar o dia da semana, e a mensal permite escolher o dia do mês (dias inexistentes no mês são ajustados para o último dia). Os vencimentos semanais e mensais continuam no último dia da semana ou do mês da publicação. Em cada publicação, o sistema cria uma cópia para cada pessoa ativa elegível nas equipes associadas, conforme o campo de responsabilidade do modelo. A frequência personalizada não permite publicação automática. A criação é idempotente por modelo, pessoa e data local, para impedir duplicatas em novas tentativas da função.

Os ciclos armazenam `startsAtAt` e `endsAtAt` como limites de data/hora, além das datas usadas pela interface. Ao abrir um ciclo pelo aplicativo, os demais ciclos abertos são fechados na mesma operação. As regras locais impedem criar ou enviar avaliações fora do período. Ciclos antigos sem esses limites ainda dependem do status até que sejam editados e salvos novamente.

Em **Configuração → Ciclos**, a administração cria ciclos avulsos de avaliação por critérios, definindo o nome e as datas. Ao abrir um ciclo, os outros ciclos abertos são fechados na mesma operação. A administração pode editar ou fechar ciclos existentes.

Na área **Pesquisas**, a administração também pode criar uma pesquisa avulsa com datas, público (colaboradores, líderes ou ambos) e perguntas de texto livre e/ou nota de 1 a 5. Uma pessoa pode responder uma vez por pesquisa. As respostas ficam separadas de um marcador privado de participação: a interface e as regras não permitem que a administração consulte quem respondeu, e os resultados não mostram nomes ou e-mails.

## Convites e provisionamento inicial

1. Uma pessoa sem convite não pode criar acesso ao painel nem entrar automaticamente na empresa. Peça à administração um convite para o e-mail que será usado na conta.
2. Em **Empresa → Convites de acesso**, a administração informa o e-mail, perfil e, quando aplicável, as equipes. O convite dura sete dias e pode ser cancelado ou reenviado; cada reenvio invalida o link anterior.
3. A pessoa abre o link, cria ou acessa uma conta Firebase para o e-mail convidado, verifica o endereço e aceita o convite. O servidor confere o token, e-mail, validade, empresa, equipes e uso único antes de criar `userProfiles/{uid}` e `companies/{companyId}/members/{uid}`.
4. Configure setores, equipes, critérios e o ciclo de avaliação. Associe líderes às equipes; eles poderão criar modelos de checklist para colaboradores dessas equipes. A administração também pode atribuir modelos diretamente aos líderes.
5. Se for necessário provisionar a primeira administradora, crie a conta no Firebase Authentication Console e execute `scripts/provision-initial-admin.mjs` localmente com `FIREBASE_PROJECT_ID` e `FIREBASE_SERVICE_ACCOUNT_JSON` definidos no ambiente. O script recusa provisionar quando já existe administradora ativa; nunca execute com credenciais expostas ou salvas no repositório.

O envio automático depende de `RESEND_API_KEY` e `INVITATION_FROM_EMAIL` no ambiente do servidor. Sem essas configurações, a administração pode copiar o link gerado e compartilhá-lo manualmente. Consulte [VERCEL-SETUP.md](../VERCEL-SETUP.md) para detalhes.

## Configuração local e publicação

O cliente usa as variáveis `NEXT_PUBLIC_FIREBASE_*` de `.env.local`; consulte `.env.example`. O vínculo do usuário à empresa é lido de `userProfiles/{uid}` no servidor. A configuração pública do SDK não substitui as regras. Nunca coloque uma chave de conta de serviço no navegador.

Para publicar regras e índices com Firebase CLI autenticado:

```sh
npm run deploy:firebase
```

O script usa `--project hb-avalia2`. Os índices compostos podem levar alguns minutos para terminar de construir. Em produção, sirva o app por HTTPS.

Após qualquer alteração em `firestore.rules`, publique as regras antes de depender das validações no servidor. A configuração local não comprova qual versão está implantada no projeto Firebase; confirme a publicação no Firebase Console ou no histórico de deploy da equipe. A criação de empresas, perfis e vínculos de membros é bloqueada para clientes do navegador e feita por provisionamento confiável ou pelo aceite server-side do convite.

## Publicação automática de checklists

A publicação recorrente roda no Vercel Cron, em `/api/cron/publish-scheduled-checklists`, diariamente às 00h05 em `America/Sao_Paulo`. O agendamento e as variáveis necessárias (`CRON_SECRET`, service account) estão descritos em [VERCEL-SETUP.md](../VERCEL-SETUP.md). Não há mais Cloud Functions no fluxo de publicação.

## Validações do servidor e privacidade

Os envios finais de avaliação, indicação de promoção, decisão administrativa e resposta de pesquisa passam pelas rotas autenticadas do Vercel (`/api/evaluations`, `/api/promotion-requests`, `/api/promotion-requests/{requestId}/decision` e `/api/surveys/responses`), que verificam o token do Firebase e gravam com o Admin SDK. O cliente ainda pode gravar rascunhos de avaliação. As regras do Firestore impedem o cliente de transformar o rascunho em resultado final ou gravar diretamente uma resposta ou indicação.

As médias das avaliações são calculadas pelo servidor a partir dos critérios ativos. A indicação busca até 30 avaliações concluídas do colaborador e recalcula as notas com base nas respostas armazenadas; o navegador não escolhe quais notas anexar. Na resposta de pesquisa, a definição das perguntas é lida do Firestore, cada pergunta é validada e o documento de resposta não recebe UID nem horário de envio. O marcador de participação permanece em uma coleção separada e só pode ser lido pela própria conta.

A interface de administração libera o conteúdo da pesquisa após pelo menos 5 respostas. Esse limite reduz a exposição em grupos pequenos, mas não impede que uma resposta aberta revele a identidade por seu próprio conteúdo. A tela orienta participantes a não informar nomes ou detalhes identificadores. Use “sem identificação direta no app” ao explicar essa proteção; não prometa anonimato absoluto.

As avaliações públicas por QR Code aplicam um limite transacional de até 10 envios por endereço identificado por HMAC em uma janela de 10 minutos. Para não depender de TTL ou tarefas agendadas, cada empresa usa no máximo 65.536 documentos de slot fixos. Cada slot guarda contadores individuais identificados pelo HMAC completo; portanto, uma colisão do slot não compartilha nem consome o limite de outro endereço. O mapa mantém até 1.024 origens ativas por slot, um teto conservador que evita documentos Firestore excessivos; entradas vencidas são removidas na próxima gravação. O endereço IP em texto aberto não é persistido, e o segredo HMAC fica em documento privado acessível somente pelo servidor. Documentos legados do limitador não são migrados nem removidos automaticamente.

## Testes e lint

Com as dependências instaladas, use:

```sh
npm run typecheck
npm run lint
npm test
npm run test:rules
```

`npm test` valida as funções de domínio sem serviços externos. `npm run test:rules` inicia o emulador do Firestore (Java precisa estar instalado e no PATH) e verifica que os clientes só salvam rascunhos, sem publicar resultados finais, respostas ou indicações. O app local também pode usar os emuladores com `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` e `firebase emulators:start --only auth,firestore`.

## Publicação destas alterações

Antes de abrir a aplicação com dados reais, publique regras e índices no projeto correto e faça o deploy pelo Vercel:

```sh
npm run deploy:firebase
git push origin main
```

Depois, confirme no Firebase Console que as regras foram publicadas e acompanhe o deploy em [VERCEL-SETUP.md](../VERCEL-SETUP.md). A verificação remota precisa ser feita com uma conta Firebase autorizada; a presença desses arquivos no workspace não comprova a implantação.
