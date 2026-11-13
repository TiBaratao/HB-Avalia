# Base organizacional multi-loja

## Resultado do inventário somente de leitura

Em 09/11/2026, foi consultado o projeto Firebase `hb-avalia2` usando somente operações de leitura:

- Existe **uma** empresa: `companies/hb-avalia`, nome `Hiper Baratao`, criada em 26/10/2026.
- Ela não possui `organizationId` nem `storeId`; a organização `hipermercado-baratao` ainda não existe em produção.
- O tenant contém 135 documentos nas coleções e subcoleções operacionais. Nenhum contém o campo `storeId`.
- Há 6 membros ativos (3 `ADMIN`, 1 `LEADER`, 2 `EMPLOYEE`), 6 perfis vinculados e 3 convites (2 aceitos, 1 cancelado). Nenhuma identidade pessoal foi copiada para o manifesto.
- As contagens por coleção e subcoleção constam em [`config/organization-store-mapping.json`](../config/organization-store-mapping.json).
- O ID proposto anteriormente `hb-avalia-matriz` não será usado operacionalmente; `hb-avalia` foi preservado para a Matriz. `hb-avalia-loja-2` e `hb-avalia-summit` foram criados como empresas vazias e independentes.

**Atualização do mapeamento (10/11/2026):** o responsável pelo sistema confirmou explicitamente que todos os dados existentes no HB-Avalia pertencem à Matriz: os usuários, documentos operacionais, avaliações internas, PDIs, promoções e históricos, além das duas respostas de clientes sem `marketId` e dos registros associados ao local legado `general`. Essa confirmação foi aplicada somente aos metadados organizacionais; os registros operacionais foram preservados.

**Mapeamento observado nas avaliações de clientes:** há locais ativos `market-matriz`, `market-loja-2` e `market-summit`. Das 6 respostas existentes, 1 tem `marketId=matriz`, 1 `loja-2`, 2 `summit` e 2 não têm `marketId`. Pela confirmação do responsável, as duas respostas sem mercado e o local `general` (“Supermercado”) também são atribuídos à Matriz no planejamento. O `marketId` dessas respostas e do local permanece ausente; não será inventado nem preenchido durante essa migração.

**Provisionamento de produção (11/11/2026):** em `hb-avalia2`, foi criada a organização `hipermercado-baratao`, vinculada a Matriz ao documento existente `companies/hb-avalia` e criadas as empresas vazias `hb-avalia-loja-2` e `hb-avalia-summit`. A inspeção posterior confirmou os três vínculos e os mesmos números de documentos nas coleções diretas da Matriz observados antes da escrita. O backup recursivo prévio contém 156 documentos da árvore da empresa existente; esse total atualizado difere do inventário histórico de 135, sem que nenhum documento operacional tenha sido movido ou modificado. Nenhum usuário, membership, perfil, convite ou grant de Diretor foi criado ou alterado. As Firestore Rules já publicadas em `hb-avalia2` não foram modificadas nesta execução.

## Identificadores propostos

O manifesto técnico está em [`config/organization-store-mapping.json`](../config/organization-store-mapping.json):

| Organização | Loja (`storeId`) | `companyId` planejado |
|---|---|---|
| `hipermercado-baratao` | `matriz` | `hb-avalia` (companyId existente recomendado para preservação) |
| `hipermercado-baratao` | `loja-2` | `hb-avalia-loja-2` |
| `hipermercado-baratao` | `summit` | `hb-avalia-summit` |

**Identificadores confirmados:** o projeto Firebase de destino é `hb-avalia2` (projeto/ambiente selecionado no Firebase CLI e indicado por `companyInventory.projectId`). `companies/hb-avalia` é um documento de empresa dentro desse projeto, ou seja, um `companyId`/tenant operacional, não um Firebase project ID. O responsável confirmou `hb-avalia` como tenant da Matriz. O inventário disponível registra esse tenant e seus dados; sua existência e contagens devem ser revalidadas ao vivo antes de qualquer escrita em produção.

O manifesto atualizado em [`config/organization-store-mapping.json`](../config/organization-store-mapping.json) separa a confirmação do mapa de migração do modelo de provisionamento de teste existente. A Matriz preserva `companies/hb-avalia` como seu `companyId`; Loja 2 e Summit usam os IDs próprios `hb-avalia-loja-2` e `hb-avalia-summit`. `hb-avalia-matriz` não será usado operacionalmente, evitando duplicação da empresa ou cópia dos dados da Matriz.

A associação da Matriz foi aplicada e verificada no Firestore: `companies/hb-avalia` agora contém `organizationId=hipermercado-baratao` e `storeId=matriz`. Os registros correspondentes em `organizations/hipermercado-baratao/stores/{storeId}` estão com `companyMappingStatus: CONFIRMED`.

## Formato no Firestore

- `organizations/{organizationId}` guarda o nome, estado, versão da estrutura e o identificador reservado `directorRole: "DIRECTOR"`.
- `organizations/{organizationId}/stores/{storeId}` guarda o nome oficial, o `companyId` pretendido e o estado de confirmação do mapeamento.
- Os dados operacionais continuam em `companies/{companyId}` e suas subcoleções atuais.
- `CompanyDocument.organizationId` e `CompanyDocument.storeId` são campos opcionais para compatibilidade retroativa. A Matriz aponta para `hb-avalia`; somente esses metadados do documento da empresa e o registro da loja foram vinculados, sem mover documentos operacionais.
- `DIRECTOR` é apenas um tipo/identificador de papel organizacional preparado para uma etapa futura. Não é adicionado a `FirebaseRole`, a membros, a perfis, a Firebase Authentication claims ou às regras de acesso.

## Provisionamento seguro no emulador

O comando exige `FIRESTORE_EMULATOR_HOST` local e um project ID `demo-*`; recusa conexões com produção:

```powershell
npm run provision:organization:emulator
npm run test:organization-structure
```

O provisionamento é idempotente: cria a organização e as três lojas somente se ainda não existirem, valida identidades existentes e não cria membros, perfis, convites ou dados operacionais. Uma divergência ou colisão interrompe a transação sem associar dados. No manifesto, `stores[].mappingStatus` conserva o valor de entrada esperado pelo provisionador (`PENDING_CONFIRMATION`); `stores[].productionStatus`, `companyInventory.productionProvisioning` e os campos de aplicação registram o estado verificado em produção.

Para exercitar a associação confirmada do tenant Matrix exclusivamente no emulador, há a opção explícita `--apply-confirmed-mappings`, por exemplo `firebase emulators:exec --only firestore --project demo-hb-avalia-org "node scripts/provision-organization.mjs --apply-confirmed-mappings"`. O script ainda recusa qualquer projeto fora de `demo-*` e endereço que não seja loopback; essa opção não é um mecanismo de migração para produção.

## Estratégia recomendada e pendências da migração

Recomendação: preservar `hb-avalia` como `companyId` operacional da Matriz. O modelo atual já usa `companies/{companyId}` como tenant, e o diretório organizacional permite apontar uma loja a um `companyId` existente; não há requisito estrutural de que o identificador contenha o nome da loja. Assim, os memberships, `userProfiles`, IDs de documentos, subcoleções, referências e históricos mantêm seus caminhos atuais. Nenhum dado deve ser copiado para `hb-avalia-matriz`.

No provisionamento organizacional já realizado:

1. Fazer e validar backup/exportação antes da escrita.
2. Verificar que `organizations/hipermercado-baratao/stores/matriz` aponta para `hb-avalia`, com `companyMappingStatus: CONFIRMED`.
3. Atualizar apenas `companies/hb-avalia.organizationId` e `companies/hb-avalia.storeId` para confirmar a associação organizacional. **Concluído e verificado.**
4. Manter `hb-avalia-loja-2` e `hb-avalia-summit` como tenants independentes. **Criados vazios e verificados.**
5. Validar contagens, IDs, relações, memberships e acesso autorizado após a alteração, sem modificar usuários, convites, regras ou históricos durante a vinculação.
6. Manter os dois feedbacks sem `marketId` e o documento `general` sem `marketId`; confirmar sua atribuição à Matriz no plano não justifica inventar um mercado técnico.

O provisionamento seguro em produção está separado do script de emulador em `scripts/provision-organization-production.mjs`. Ele exige o projeto literal `hb-avalia2`, credenciais de serviço correspondentes, a configuração exata das três lojas, uma inspeção somente leitura e caminho de backup antes de aplicar. O modo de aplicação só aceita o mapeamento Matriz já confirmado e a criação das empresas vazias de Loja 2 e Summit. Colisões ou vínculos inesperados interrompem a execução; o script não cria diretores, admins, membros, perfis, convites ou dados operacionais. Uma transação cria/vincula os documentos e a verificação posterior confirma os três mapeamentos. O script do emulador continua recusando projetos fora de `demo-*`.

Para inspecionar, em ambiente seguro que já tenha as credenciais Admin correspondentes a `hb-avalia2`, execute:

```powershell
node scripts/provision-organization-production.mjs --project hb-avalia2 --inspect
```

Após conferir o destino, vínculos e contagens, a aplicação exige um arquivo de backup ainda inexistente:

```powershell
node scripts/provision-organization-production.mjs --project hb-avalia2 --apply --apply-confirmed-mappings --provision-new-stores --backup-path "C:\caminho\seguro\organization-before.json"
```

O provisionador grava o backup antes da primeira escrita: inclui metadados existentes da organização e lojas, além do documento-raiz de cada empresa alvo e de todos os documentos alcançáveis recursivamente em suas coleções e subcoleções. O arquivo inclui contagem de documentos e checksum SHA-256, é reaberto e validado antes do provisionamento, deve estar fora do repositório e não pode sobrescrever um arquivo existente. Tipos Firestore como timestamps, referências, GeoPoints e bytes são serializados com marcadores explícitos. Não coloque credenciais no repositório, não use outro project ID e não conceda grants de Diretor por esse procedimento.

Também foi adicionada compatibilidade específica para `companies/hb-avalia` vinculado à Matriz no módulo de avaliação de clientes: mantém os mercados e `marketId` existentes, lista respostas recentes sem mercado e permite preservar o QR e o local `general` sem atribuir um novo `marketId`. Essa exceção é restrita ao `companyId` legado e não alarga o escopo dos tenants independentes de Loja 2 e Summit. Os valores `marketId=loja-2` e `marketId=summit` permanecem inalterados como metadados das respostas/localizações dentro do tenant Matriz; não são usados para mover documentos ou criar associação de empresa.

**Estado após provisionamento:** as três lojas estão vinculadas e Loja 2 e Summit estão vazias. Após autorização explícita do responsável, a mesma conta foi mantida como `ADMIN` da Matriz e recebeu um grant `DIRECTOR` independente. Um grant existente com UID correto estava salvo em documento com ID incorreto; foi movido atomicamente para `organizations/hipermercado-baratao/directors/{uid}`. A verificação posterior confirmou o caminho esperado e que as três lojas estão operacionais. Nenhum membership, perfil, dado operacional ou regra foi alterado nessa correção. A exportação integral prévia está salva localmente fora do repositório. Permanecem pendentes as contas de acesso às lojas novas e a validação funcional ponta a ponta com usuários reais de cada perfil.

Os testes do emulador cobrem associação idempotente de uma empresa legada, recusa sem opção explícita, preservação de documentos e subcoleções, visibilidade das três categorias de feedback existentes, respostas com `marketId` ausente/nulo e envio pelo local `general`. O inventário e estes testes não executaram migração em produção nem concederam permissões organizacionais.

## Acesso organizacional do Diretor

O acesso organizacional agora é resolvido no servidor por um documento separado em `organizations/hipermercado-baratao/directors/{uid}`. O registro precisa conter o mesmo `uid`, o e-mail vinculado à conta autenticada e `status: "ACTIVE"`; a organização também precisa estar ativa. Esse mecanismo é independente do papel `ADMIN`. A conta autorizada mantém seu membership `ADMIN` na Matriz e também possui um grant `DIRECTOR`; conceder um papel não remove o outro. O grant não altera `FirebaseRole`, `userProfiles`, memberships, claims nem as regras do Firestore.

O endpoint autenticado `/api/access` retorna um tipo explícito (`DIRECTOR` ou `COMPANY`). Para Diretor, ele lista os metadados das lojas da organização, valida os vínculos com os documentos `companies/{companyId}` quando existirem e indica se o mapeamento operacional foi confirmado. A seleção de loja é apenas de contexto visual: não abre `Workspace`, não cria permissões de leitura e não habilita acesso a dados operacionais. A conta local continua recebendo o acesso de empresa existente.

Na interface, lojas inativas não podem ser selecionadas. Lojas sem mapeamento confirmado ou sem documento de empresa são identificadas como indisponíveis para dados operacionais. Para testes locais, `npm run provision:director:emulator` cria a organização e um grant idempotente para `DIRECTOR_UID` e `DIRECTOR_EMAIL`; assim como os demais provisionadores de teste, recusa conexões que não sejam ao Firestore Emulator em projeto `demo-*`. O grant autorizado de produção foi criado/corrigido por processo administrativo privilegiado, nunca por endpoint público ou alteração do cliente. Os testes cobrem grants ativos/inativos, comparação de e-mail, vínculos inconsistentes e lojas ainda sem associação operacional usando apenas o Firestore Emulator.

O acesso `ADMIN` da Matriz pode ser provisionado por operador somente após autorização explícita para a identidade. `scripts/provision-authorized-matrix-admin.mjs` exige o projeto `hb-avalia2`, e-mail autorizado, conta Auth ativa/verificada, associação organizacional confirmada da Matriz e uma flag de confirmação separada para escrever. A operação cria apenas os documentos `companies/hb-avalia/members/{uid}` e `userProfiles/{uid}`; rejeita vínculos conflitantes e é idempotente.

Um grant `DIRECTOR` em produção exige autorização explícita para a identidade e é provisionado por `scripts/provision-authorized-director.mjs`, que restringe projeto, e-mail, organização, conta autenticada e vínculos operacionais das três lojas. O script tem modo de inspeção sem escrita, exige confirmação separada para aplicar, não modifica membership/perfil ADMIN e interrompe se encontrar grants conflitantes. Se houver um grant ativo para o mesmo UID/e-mail em caminho de documento diferente do UID, ele repara o caminho atomicamente preservando os campos existentes; não reatribui grants a outro UID.
