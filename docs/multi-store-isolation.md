# Isolamento de dados e permissões multi-loja

## Contexto de autorização

Os dados operacionais continuam em `companies/{companyId}` e nas subcoleções existentes. `userProfiles/{uid}.companyId` é o vínculo ativo da conta; um membership ativo, sozinho, não autoriza acesso a outro `companyId`.

As Firestore Security Rules agora exigem simultaneamente:

- conta autenticada;
- perfil próprio apontando para o `companyId` consultado;
- membership ativo nesse tenant.

Essa condição vale também para acessos diretos ao próprio documento de membro, participante de pesquisa e checklist/resultado atribuído ao usuário. Claims ou valores de `companyId` enviados pelo navegador não substituem o perfil e o membership.

As APIs server-side de avaliações, pesquisas, convites, promoções e administração de avaliações de clientes verificam o mesmo vínculo antes de ler ou modificar dados. A publicação agendada de checklists também ignora memberships ativos cujo perfil já aponta para outra empresa. A aceitação de convites continua vinculando uma conta a uma única empresa, e a repetição de um convite aceito só retorna sucesso se o perfil e o membership ainda estiverem ativos e consistentes.

## Avaliações de clientes

Para empresas legadas sem `organizationId` e `storeId`, o comportamento histórico permanece disponível e seus dados não são atribuídos automaticamente a uma loja.

Para uma empresa vinculada a uma loja da organização, o contexto só é aceito quando:

- a organização está ativa;
- `organizations/{organizationId}/stores/{storeId}` confirma o mesmo `companyId`;
- a loja está ativa e `companyMappingStatus` é `CONFIRMED`.

Nesse caso, criação/consulta de QR Code, caixas, respostas recentes e indicadores ficam restritos ao mercado correspondente ao `storeId`. A exceção temporária e explícita é o tenant legado `companies/hb-avalia`, confirmado pelo responsável como pertencente integralmente à Matriz: ele mantém os mercados e `marketId` históricos existentes, bem como respostas recentes sem `marketId` e o local `general` sem mercado. A exceção só opera dentro do `companyId` legado; não consulta dados de outras empresas/tenants, não altera os `marketId` existentes e não inventa novos. Empresas independentes das demais lojas continuam restritas ao próprio mercado. Uma unidade ainda pendente de mapeamento não pode operar avaliações de clientes. A rota pública continua sem login e resolve apenas o tenant associado ao token aleatório ativo; os dados e rate limits permanecem privados no servidor.

## Cadastros, convites e transferências

O perfil DIRETOR permanece uma concessão organizacional server-side, independente de `ADMIN`, e não recebe permissões diretas de Firestore. Operações organizacionais passam por APIs autenticadas e revalidam a concessão, a loja ativa, o mapeamento `CONFIRMED` e a correspondência entre `organizations/{organizationId}/stores/{storeId}` e `companies/{companyId}`.

Administradores locais só podem convidar `LEADER` e `EMPLOYEE` da própria empresa; o backend rejeita convites locais com papel `ADMIN`, mesmo que um cliente altere a solicitação. O Diretor pode convidar administradores apenas para lojas operacionais confirmadas. O convite guarda a organização, loja e empresa resolvidas no servidor; a aceitação revalida o vínculo da loja e continua exigindo e-mail verificado, token válido e conta vinculada a no máximo uma empresa ativa. Listagem, reenvio e cancelamento de convites de administrador são exclusivos do Diretor e revalidam a autorização no servidor.

Transferências são exclusivas do Diretor e feitas em transação: validam os dois mapeamentos, o perfil ativo na origem, o membership de origem, a inexistência de membership no destino e as equipes ativas escolhidas. A transação inativa o membership e remove os rosters da origem, cria o membership/rosters no destino, atualiza `userProfiles/{uid}.companyId` e registra uma auditoria em `organizations/{organizationId}/transfers/{transferId}`. Avaliações, PDIs, promoções e demais históricos não são movidos nem apagados: permanecem na loja de origem.

A interface do Diretor oferece cadastro e gerenciamento dos convites de administradores e transferência entre lojas confirmadas. Lojas sem mapeamento operacional confirmado permanecem indisponíveis para essas ações. Selecionar uma loja não altera o vínculo do próprio Diretor nem concede a ele um membership operacional.

## Validação

Os testes do emulador verificam que um membership duplicado em outra empresa não supera o vínculo do perfil, incluindo leituras pessoais de checklists e participantes; verificam também convites de administradores restritos ao Diretor, transferências, rosters, bloqueio de mapeamentos pendentes e preservação do histórico. Testes de avaliação de clientes confirmam que empresas vinculadas veem e aceitam somente o próprio mercado, enquanto o tenant legado mantém o comportamento anterior. As regras continuam negando leitura direta do registro organizacional ao navegador.

Nenhum documento ou regra de produção é alterado por estes testes.
