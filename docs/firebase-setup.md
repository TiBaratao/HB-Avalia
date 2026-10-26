# Firebase — HB Avalia

> These instructions describe the original `hb-avalia` project and its Firebase Cloud Functions deployment. For the empty `hb-avalia2` destination on Netlify/Spark, use [NETLIFY-SETUP.md](../NETLIFY-SETUP.md); do not run the Firebase deploy commands below against the destination.

## Projeto e banco

- Projeto: `hb-avalia`
- Firestore: `(default)` em `southamerica-east1` (São Paulo)
- Firebase Authentication: provedor E-mail/Senha habilitado
- Regras e índices: `firestore.rules` e `firestore.indexes.json`
- Identificador da empresa única neste MVP: `hb-avalia` (ajustável por `NEXT_PUBLIC_DEFAULT_COMPANY_ID`)

O banco foi limpo dos dados fictícios. A primeira conta cria a empresa real e vira administradora. Depois disso, cada novo cadastro entra automaticamente nessa empresa como colaborador. Uma administradora pode alterar funções e equipes após o cadastro.

## Coleções

O Firestore não mantém coleções vazias; cada caminho aparece após a primeira gravação.

| Caminho | Uso |
| --- | --- |
| `userProfiles/{uid}` | Empresa associada à conta autenticada |
| `companies/{companyId}` | Nome, proprietário e política de entrada da empresa |
| `companies/{companyId}/members/{uid}` | Pessoas, função, situação e equipes |
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

## Primeiro acesso

1. Cadastre a primeira conta e informe seu nome e o nome real da empresa. Essa conta configura a empresa com ID `hb-avalia` e se torna administradora.
2. Cadastros seguintes informam o nome da pessoa e entram automaticamente na mesma empresa como colaboradores.
3. A administração pode ajustar funções e equipes em Pessoas e equipes. Novos cadastros entram como colaboradores sem equipe; a administração pode ajustar função e equipes depois.
4. Configure setores, equipes, critérios e o ciclo de avaliação. Associe líderes às equipes; eles poderão criar modelos de checklist para colaboradores dessas equipes. A administração também pode atribuir modelos diretamente aos líderes.

## Configuração local e publicação

O cliente usa as variáveis `NEXT_PUBLIC_FIREBASE_*` de `.env.local`; consulte `.env.example`. `NEXT_PUBLIC_DEFAULT_COMPANY_ID` define a empresa única durante este MVP. A configuração pública do SDK não substitui as regras. Nunca coloque uma chave de conta de serviço no navegador.

Para publicar regras e índices com Firebase CLI autenticado:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project hb-avalia
```

Os índices compostos podem levar alguns minutos para terminar de construir. Em produção, sirva o app por HTTPS.

Após qualquer alteração em `firestore.rules`, publique as regras antes de depender das validações no servidor. A configuração local não comprova qual versão está implantada no projeto Firebase; confirme a publicação no Firebase Console ou no histórico de deploy da equipe.

## Publicação automática de checklists

As rotinas estão em `functions/` e usam Cloud Functions for Firebase de 2ª geração com Node.js 22. A função `publishScheduledChecklists` é executada diariamente às 00h05 em `America/Sao_Paulo`; ela publica os modelos habilitados no dia configurado. O projeto Firebase precisa ter o faturamento/plano e as APIs exigidos pelo Cloud Scheduler e Cloud Functions habilitados.

Instale as dependências e publique a rotina junto das regras:

```sh
npm install --prefix functions
firebase deploy --only functions:publishScheduledChecklists,firestore:rules --project hb-avalia
```

Não considere os agendamentos ativos até as funções serem publicadas com sucesso e suas próximas execuções serem confirmadas nos logs do Firebase. Alterações locais de função e regras não publicam nada no projeto remoto.

## Validações do servidor e privacidade

Os envios finais de avaliação, indicação de promoção, decisão administrativa e resposta de pesquisa passam pelas funções autenticadas em `functions/secure-actions.js`, na região `southamerica-east1`. O cliente ainda pode gravar rascunhos de avaliação. As regras do Firestore impedem o cliente de transformar o rascunho em resultado final ou gravar diretamente uma resposta ou indicação.

As médias das avaliações são calculadas pelo servidor a partir dos critérios ativos. A indicação busca até 30 avaliações concluídas do colaborador e recalcula as notas com base nas respostas armazenadas; o navegador não escolhe quais notas anexar. Na resposta de pesquisa, a definição das perguntas é lida do Firestore, cada pergunta é validada e o documento de resposta não recebe UID nem horário de envio. O marcador de participação permanece em uma coleção separada e só pode ser lido pela própria conta.

A interface de administração libera o conteúdo da pesquisa após pelo menos 5 respostas. Esse limite reduz a exposição em grupos pequenos, mas não impede que uma resposta aberta revele a identidade por seu próprio conteúdo. A tela orienta participantes a não informar nomes ou detalhes identificadores. Use “sem identificação direta no app” ao explicar essa proteção; não prometa anonimato absoluto.

## Testes e lint

Com as dependências instaladas, use:

```sh
npm run typecheck
npm run lint
npm test
npm run test:rules
```

`npm test` valida as funções de domínio sem serviços externos. `npm run test:rules` inicia o emulador do Firestore (Java precisa estar instalado e no PATH) e verifica que os clientes só salvam rascunhos, sem publicar resultados finais, respostas ou indicações. O app local também pode usar as funções pelo emulador com `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` e `firebase emulators:start --only auth,firestore,functions`.

## Publicação destas alterações

Antes de abrir a aplicação com dados reais, publique funções, regras e índices no projeto correto:

```sh
firebase deploy --only functions,firestore:rules,firestore:indexes --project hb-avalia
```

Depois, confirme no Firebase Console que as regras foram publicadas e confira `firebase functions:list --project hb-avalia` e os logs das quatro funções callable. As rotas antigas de escrita do cliente deixam de funcionar assim que as regras novas forem publicadas; por isso, publique funções e regras no mesmo release e só então disponibilize a interface atualizada. A verificação remota precisa ser feita com uma conta Firebase autorizada; a presença desses arquivos no workspace não comprova a implantação.
