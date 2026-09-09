# Migration de smolvm-manager vers Pylon 0.10.0

## Mission de la prochaine session

Faire migrer `/data/smolvm-manager` de Pylon `0.3.355` vers `0.10.0`, valider d'abord sur des bases copiées, puis déployer proprement vers `/var/lib/smolvm-manager` et le service `smolvm-manager.service`.

Le livrable attendu est un dépôt dont :

- `@pylonsync/functions`, `@pylonsync/sdk` et `@pylonsync/sync` sont tous épinglés à `0.10.0` ;
- le binaire Pylon servi en production est réellement `0.10.0` ;
- le manifeste, le client, l'auth, les policies, les fonctions, le transport REST de production et la synchronisation navigateur sont vérifiés ;
- les bases SQLite et sessions sont sauvegardées/restaurables ;
- le service redémarre et répond au health check public ;
- les instructions de build local pour Rocky Linux pointent vers `v0.10.0`.

## État de départ vérifié

- Dépôt de développement : `/data/smolvm-manager`, commit observé `ffed382` lors de l'audit.
- Déploiement : `/var/lib/smolvm-manager`; ce répertoire est distinct du dépôt de développement.
- Service : `/etc/systemd/system/smolvm-manager.service`, actif.
- Commande service : `/usr/local/bin/bun run scripts/start-manager.ts --prod`.
- Pylon actif : PID enfant du service, commande `/usr/local/bin/pylon dev app.ts`.
- Ports actifs : HTTP `4321`, WebSocket `4322`, SSE `4323`.
- Version réellement servie aujourd'hui : `/usr/local/bin/pylon` = `0.3.355`.
- Version compilée compatible glibc disponible : `/root/.local/bin/pylon` = `0.10.0`.
- `ProtectHome=true` empêche le service d'exécuter directement le binaire dans `/root`; la production exige un vrai fichier `/usr/local/bin/pylon`, pas un symlink vers `/root`.
- Les packages npm sont `0.3.355` dans le dépôt de développement **et** dans `/var/lib/smolvm-manager`.
- `.ncurc.json` exclut les trois packages Pylon des mises à jour.
- Base applicative production : `/var/lib/smolvm-manager/data/pylon-app.db` (environ 116 MiB lors de l'audit, WAL actif).
- Base sessions : `/var/lib/smolvm-manager/data/pylon-sessions.db` avec fichiers WAL/SHM.
- Le service configure :

  ```text
  PYLON_URL=http://127.0.0.1:4321
  PYLON_COMMAND=pylon
  PYLON_DB_PATH=/var/lib/smolvm-manager/data/pylon-app.db
  PYLON_SESSION_DB=/var/lib/smolvm-manager/data/pylon-sessions.db
  PYLON_PID_FILE=/var/lib/smolvm-manager/.pylon/pylon.pid
  ```

- `app.ts` utilise le SDK Pylon : 7 entités, 9 queries, 10 actions, 6 policies.
- `MetricsSample` utilise `sync: { limit: 100 }`; `AuditEvent` et `TomlSnapshot` utilisent `sync: false`.
- Le navigateur utilise `createSyncEngine` avec credentials de session et le port Pylon injecté.
- Le serveur choisit `rest` sous Node/Vite preview et `typed` sous Bun. Ce comportement est volontaire : la production Vite preview s'exécute sous Node, même si elle est lancée via `bun x vite preview`.

## État Pylon de la machine

Le build `0.10.0` a réussi sur Rocky Linux contre la glibc native :

```text
/root/.local/bin/pylon --version
pylon 0.10.0
```

- `ldd` ne signale aucune bibliothèque manquante.
- Le symbole glibc maximal requis est `GLIBC_2.34`, égal à la glibc système.
- Ancien binaire sauvegardé : `/root/.local/bin/pylon.backup-20260909-140949` (`0.3.355`).

Attention : ce build n'est pas encore celui exécuté par le service. La bascule production doit copier le fichier vers `/usr/local/bin/pylon` pendant que le service est arrêté.

## Résultats déjà obtenus avec Pylon 0.10.0

Ces constats sont acquis :

1. Preview de la mise à jour :

   ```text
   @pylonsync/functions 0.3.355 -> 0.10.0
   @pylonsync/sdk       0.3.355 -> 0.10.0
   @pylonsync/sync      0.3.355 -> 0.10.0
   ```

2. Codegen 0.10.0 réussi :

   ```bash
   cd /data/smolvm-manager
   /root/.local/bin/pylon codegen app.ts \
     --manifest-out /tmp/smolvm-manager-010.manifest.json \
     --client-out /tmp/smolvm-manager-010.client.ts
   ```

   Résultat : 7 entités, 9 queries, 10 actions.

3. `pylon schema check` accepte le manifeste : 7 entités, 9 queries, 10 actions, 6 policies.

4. Un démarrage direct du binaire 0.10.0 sur des bases temporaires réussit. HTTP, WS, SSE et Studio démarrent ; un avertissement PYL002 est émis pour `User` sans policy d'entité.

5. La base production a été copiée de façon cohérente avec SQLite `.backup`, puis vérifiée et passée dans `schema push` 0.10.0 :

   ```text
   PRAGMA integrity_check = ok
   No operations needed
   Schema applied successfully
   ```

   Aucun changement de schéma n'est actuellement requis.

6. Dans un worktree jetable avec les trois packages npm `0.10.0` :

   - `svelte-kit sync` / `svelte-check` : PASS ;
   - 62 tests ciblant lifecycle Pylon, store client et sync navigateur : PASS ;
   - build Vite/SvelteKit production : PASS.

7. Le package `@pylonsync/sync@0.10.0` exporte encore ses sources TypeScript. Le choix `rest` sous Node production reste donc pertinent tant que le runtime production n'est pas changé.

## Changelog pertinent depuis 0.3.355

Le saut représente 335 commits upstream. Le `CHANGELOG.md` upstream s'arrête à 0.8.0 ; les versions 0.8.1 à 0.10.0 ont été auditées depuis l'historique Git et le code du tag `v0.10.0`.

### Rupture formelle en 0.10.0 : configuration LLM

Les appels `ctx.llm` doivent maintenant choisir un modèle :

- `model` sur l'appel ; ou
- `llm({ defaultModel })` dans le manifeste.

`PYLON_AI_MODEL` et `PYLON_LLM_MODEL` ne sont plus des defaults. `ctx.llm.embed` exige un modèle ou `PYLON_EMBEDDINGS_MODEL`.

**Impact ici : aucun usage `ctx.llm` ni de ces variables n'a été trouvé.** Aucune modification n'est requise tant que le projet n'ajoute pas de fonctions LLM.

### Studio n'utilise plus l'admin token comme login

Depuis 0.3.361, `PYLON_ADMIN_TOKEN` n'ouvre plus Studio. Créer des opérateurs Studio avec :

```bash
pylon admin create
pylon admin list
pylon admin passwd
pylon admin rm
```

**Impact ici :** `PYLON_ADMIN_TOKEN` reste utilisé par les appels serveur du manager. Ne pas le supprimer sous prétexte que Studio ne l'utilise plus.

### Synchronisation et realtime

Évolutions directement pertinentes :

- réplication bornée `sync: { where, limit }`, déjà utilisée pour `MetricsSample` ;
- `syncOmit()` pour les colonnes lourdes ;
- rattrapage delta fortement accéléré, pagination/reconcile corrigés, suppression des writes no-op ;
- reconnexion et changement de tenant améliorés ;
- filtres de policy par client WS/SSE ;
- authentification WS alignée sur HTTP ;
- rôles d'organisation résolus sur WebSocket ;
- relais Durable Objects et parité Swift ajoutés, non requis ici.

Le projet appelle toujours une signature compatible :

```ts
createSyncEngine(baseUrl, {
  appName: 'smolvm-manager',
  persist: true,
  transport: { credentials: 'include' }
});
```

Tester obligatoirement avec un vrai Pylon 0.10.0 : les E2E actuels utilisent `PYLON_AUTH_MOCK=true` et `PYLON_STORE_MOCK=true`, donc ils ne prouvent pas la compatibilité réseau réelle.

### Functions, queries et actions

Pylon a ajouté et renforcé :

- `discoverFunctions()` et un OpenAPI plus exact ;
- streams de fonctions reprenables ;
- timeouts idle-based et annulation plus sûre ;
- workflows durables ;
- scheduler avec propagation d'identité et retries corrigés ;
- `ctx.db.vectorSearch`, `field.vector`, `ctx.llm.embed` ;
- `ctx.error`, `ctx.rooms.broadcast`, `ctx.domains`.

Le manager déclare 9 queries et 10 actions dans le manifeste mais implémente aussi des transports typed/rest. Vérifier chaque famille de mutation, pas seulement le codegen : settings, config VM, snapshots TOML, métriques, audit et préférences UI.

### CLI et schéma

Fonctionnalités nouvelles utiles à la migration :

- `pylon update --dry-run --version 0.10.0` ;
- `pylon verify` pour `/health`, routes statiques et assets Pylon ;
- `pylon codegen` pour manifeste + client ;
- `codegen client`, `codegen openapi` ;
- `schema check`, `schema diff`, `schema push`, `schema inspect`, `schema history` ;
- commandes `migrate`, `test`, `test:security`, `doctor`, `mcp` ;
- diagnostics de policy plus explicites ;
- index de jointures de relations automatiques.

`schema push --dry-run` ne se combine pas avec `--sqlite` en 0.10.0. Utiliser :

```bash
pylon schema push new-manifest.json --from old-manifest.json --dry-run
```

pour comparer des manifestes, ou appliquer sur une copie SQLite pour tester l'introspection live.

### Runtime, auth et sécurité

Évolutions utiles :

- auth rate limits configurables ;
- rôles d'organisation personnalisés et fédération Pylon/OIDC ;
- PKCE OIDC, avatars OAuth, native sessions ;
- sécurité SAML renforcée ;
- fanout horizontal et bus de cluster ;
- gates renforcés sur fonctions streamées et WS/SSE ;
- `PYLON_SECRET` pour le chiffrement de secrets persistés.

Le manifeste actuel laisse `auth.org.disabled` à sa valeur par défaut `false`, mais ne déclare pas les entités `Org`, `OrgMember`, `OrgInvite`. Le runtime 0.10.0 démarre correctement et aucun consommateur des routes `/api/auth/orgs/*` n'a été trouvé dans le projet.

La migration de version doit donc **préserver ce contrat** : ne pas ajouter d'entités organisation ni changer la configuration auth dans le même lot. La désactivation explicite `org: { disabled: true }` peut faire l'objet d'un durcissement séparé après validation fonctionnelle ; elle ferait répondre les routes org avec `501 ORG_NOT_CONFIGURED`.

Le runtime 0.10.0 signale également que `User` n'a pas de policy d'entité. L'auth Pylon peut gérer la table User par ses routes dédiées, mais tout accès `/api/entities/User` est default-deny. Ce comportement est sain. Ajouter une policy uniquement si un besoin consommateur réel existe ; ne pas ouvrir User pour supprimer l'avertissement.

### SSR et frontend

Pylon 0.8 ajoute `pathname` aux props SSR et déprécie `url`. Le manager est une application SvelteKit séparée, pas le frontend SSR natif Pylon. Aucun impact direct n'a été trouvé.

### Nouvelles surfaces facultatives

Depuis la version de départ :

- workflows durables ;
- vector search ;
- agents avec état durable ;
- fonctions streamées reprenables ;
- relais sync Durable Objects ;
- fonctionnalités mobile/React Native et RevenueCat ;
- custom domains dans `ctx.domains` ;
- meilleure intégration Cloud/CLI.

Ces fonctionnalités ne font pas partie de la migration. Ne pas les introduire pendant le bump de version.

## Risques spécifiques à traiter

1. **Le service utilise encore 0.3.355.** Tester `/root/.local/bin/pylon` ne met pas à niveau `/usr/local/bin/pylon`.
2. **Deux répertoires distincts.** Modifier `/data/smolvm-manager` ne modifie pas `/var/lib/smolvm-manager`. Le déploiement doit passer par `scripts/sync-prod.sh` ou un flux Git propre.
3. **Base live de 116 MiB avec WAL actif.** Ne jamais utiliser `cp` seul pendant que le service écrit. Arrêter le service ou utiliser `sqlite3 .backup`.
4. **PID réutilisé.** `startPylon` réutilise tout PID vivant inscrit dans `PYLON_PID_FILE`. Après arrêt, vérifier que le PID a disparu avant le smoke test ; supprimer seulement un fichier PID manifestement stale.
5. **Production Node.** Les routes SvelteKit tournent sous Node avec Vite preview. Préserver le fallback REST ; tester réellement le bundle production, pas seulement Bun dev.
6. **E2E mock.** `bun run gate` ne teste pas Pylon réel pour l'auth/store. Ajouter un smoke séparé avec Pylon 0.10.0.
7. **Policies et service token.** Les writes de fond (métriques/audit) doivent rester authentifiés par `PYLON_SERVICE_TOKEN`; ne pas ouvrir les policies.
8. **Port Pylon exposé au navigateur.** `4321` doit rester joignable pour `/api/sync/ws` et `/api/fn/*`, avec les cookies de session.
9. **Auth implicite.** Conserver le contrat auth pendant le bump ; traiter `org.disabled` en durcissement séparé. Conserver User fermé sauf besoin explicite.
10. **Build script obsolète.** `scripts/build-pylon.sh`, README et `docs/SOURCE_BUILDS.md` nomment encore `v0.3.355`.
11. **Mise à jour atomique du binaire.** Ne jamais écraser un exécutable en cours d'exécution sans arrêter le service et garder une copie rollback.
12. **Secrets.** Ne pas afficher ou copier le contenu de `/etc/smolvm-manager/env` dans les logs. Ne jamais régénérer un éventuel `PYLON_SECRET` à chaque deploy.

## Procédure recommandée

### 1. Baseline et sauvegarde

```bash
cd /data/smolvm-manager
/root/.local/bin/pylon --version
/usr/local/bin/pylon --version
/root/.local/bin/pylon update --dry-run --version 0.10.0
systemctl status smolvm-manager --no-pager
curl -fsS http://127.0.0.1:4173/api/public/health
```

Créer un répertoire daté puis des sauvegardes cohérentes. Option la plus sûre : arrêter le service avant la copie finale.

```bash
stamp=$(date +%Y%m%d-%H%M%S)
backup=/var/backups/smolvm-manager/pylon-$stamp
mkdir -p "$backup"
systemctl stop smolvm-manager

sqlite3 /var/lib/smolvm-manager/data/pylon-app.db \
  ".backup '$backup/pylon-app.db'"
sqlite3 /var/lib/smolvm-manager/data/pylon-sessions.db \
  ".backup '$backup/pylon-sessions.db'"

# Sauvegarder aussi les DB jobs si présentes.
for db in /var/lib/smolvm-manager/data/*.jobs.db; do
  [ -f "$db" ] || continue
  sqlite3 "$db" ".backup '$backup/$(basename "$db")'"
done

sqlite3 "$backup/pylon-app.db" 'PRAGMA integrity_check;'
sqlite3 "$backup/pylon-sessions.db" 'PRAGMA integrity_check;'
```

Ne pas redémarrer encore si la fenêtre de migration production est ouverte. Pour une simple répétition préalable, redémarrer l'ancien service après la sauvegarde et travailler sur des copies sous `/tmp`.

### 2. Mettre à jour les packages du dépôt de développement

```bash
cd /data/smolvm-manager
/root/.local/bin/pylon update --version 0.10.0
```

Puis :

- conserver les versions exactes `0.10.0` ;
- retirer les trois packages Pylon du tableau `reject` de `.ncurc.json` ;
- vérifier `package.json` et `bun.lock` ;
- ne pas inclure d'autres upgrades npm dans ce commit.

### 3. Mettre à jour la source et la documentation de build

Changer le défaut de `scripts/build-pylon.sh` de `v0.3.355` vers `v0.10.0`.

Mettre à jour :

- `README.md` Requirements et section build ;
- `docs/SOURCE_BUILDS.md` ;
- tout exemple `TAG=v0.3.355` ;
- éventuellement `.env.example` et `docs/smolvm-manager.env` si les variables Pylon ont changé après vérification.

Le build local recommandé doit être explicite :

```bash
TAG=v0.10.0 INSTALL_DIR=/root/.local/bin ./scripts/build-pylon.sh
/root/.local/bin/pylon --version
ldd /root/.local/bin/pylon
```

### 4. Préserver le contrat auth

Ne pas modifier `auth(...)` pendant le bump de version : aucun consommateur des routes organisation n'a été trouvé, et le runtime 0.10.0 démarre avec le manifeste actuel.

Après la migration, un lot de durcissement séparé pourra rendre l'absence d'organisations explicite :

```ts
auth({
  // configuration existante
  org: { disabled: true }
});
```

Ce changement ferait répondre `/api/auth/orgs/*` avec `501 ORG_NOT_CONFIGURED`; il doit donc avoir son propre test et sa propre validation. Ne pas ajouter de policy User uniquement pour supprimer PYL002 : les routes d'entité User doivent rester default-deny.

### 5. Régénérer et vérifier le manifeste

```bash
cd /data/smolvm-manager
/root/.local/bin/pylon codegen app.ts \
  --manifest-out pylon.manifest.json \
  --client-out pylon.client.ts
/root/.local/bin/pylon schema check pylon.manifest.json
/root/.local/bin/pylon doctor pylon.manifest.json
```

Comparer avec le manifeste précédent :

```bash
/root/.local/bin/pylon schema push pylon.manifest.json \
  --from /path/to/old-pylon.manifest.json \
  --dry-run
```

Le bump Pylon seul ne doit introduire aucun delta de manifeste involontaire. Tout delta exige une justification distincte avant application.

### 6. Répéter la migration sur la sauvegarde

```bash
cp "$backup/pylon-app.db" /tmp/smolvm-manager-pylon-010.db
sqlite3 /tmp/smolvm-manager-pylon-010.db 'PRAGMA integrity_check;'
/root/.local/bin/pylon schema push pylon.manifest.json \
  --sqlite /tmp/smolvm-manager-pylon-010.db
sqlite3 /tmp/smolvm-manager-pylon-010.db 'PRAGMA integrity_check;'
```

À l'état audité, la migration sans changement `org.disabled` répond `No operations needed`.

### 7. Vérification statique, unitaire et build

```bash
cd /data/smolvm-manager
bun run check
bun run lint
bun run format:check
bun test src
bun run build
```

Tests particulièrement importants :

```bash
bun test \
  src/lib/server/pylon-lifecycle.test.ts \
  src/lib/server/manager-store-client.test.ts \
  src/lib/client/pylon-sync.test.ts
```

### 8. Smoke test réel Pylon 0.10.0

Les E2E standards mockent Pylon. Faire un smoke sur bases jetables avec un port libre :

```bash
cd /data/smolvm-manager
PYLON_DB_PATH=/tmp/smolvm-manager-010-app.db \
PYLON_SESSION_DB=/tmp/smolvm-manager-010-sessions.db \
PYLON_PID_FILE=/tmp/smolvm-manager-010.pid \
/root/.local/bin/pylon dev app.ts --port 4599
```

Vérifier depuis un autre terminal :

```bash
curl -fsS http://127.0.0.1:4599/api/auth/session
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:4599/api/entities/User
```

Résultat attendu pour User anonyme : refus policy, pas 2xx.

Ensuite lancer le manager contre ce Pylon réel. Utiliser une configuration isolée et un port manager libre. Tester manuellement ou avec un petit scénario Playwright non mocké :

- setup du premier admin ;
- login/logout et restauration de session ;
- lecture/écriture ManagerSetting ;
- SavedVmConfig create/update/delete ;
- écriture d'une préférence UI et réception sync ;
- insertion/listing de métriques ;
- audit/service token ;
- redémarrage Pylon avec persistance des données et sessions.

### 9. Gate existante

```bash
bun run gate
```

Cette gate doit passer, mais elle utilise les mocks Pylon pour E2E. Elle complète le smoke réel ; elle ne le remplace pas.

### 10. Déployer le code vers `/var/lib/smolvm-manager`

Le helper actuel préserve `data/`, `.pylon/` et `.env` :

```bash
cd /data/smolvm-manager
./scripts/sync-prod.sh
chown -R smolvm-manager:smolvm-manager /var/lib/smolvm-manager
runuser -u smolvm-manager -- \
  /usr/local/bin/bun install --cwd /var/lib/smolvm-manager
runuser -u smolvm-manager -- \
  bash -lc 'cd /var/lib/smolvm-manager && /usr/local/bin/bun run build'
```

Vérifier que `/var/lib/smolvm-manager/package.json` contient bien les trois `0.10.0`.

### 11. Installer le binaire production atomiquement

Service arrêté :

```bash
systemctl stop smolvm-manager
cp /usr/local/bin/pylon "/usr/local/bin/pylon.backup-$stamp"
install -o root -g root -m 0755 /root/.local/bin/pylon /usr/local/bin/pylon.new
/usr/local/bin/pylon.new --version
ldd /usr/local/bin/pylon.new
mv /usr/local/bin/pylon.new /usr/local/bin/pylon
/usr/local/bin/pylon --version
```

Résultat obligatoire : `pylon 0.10.0`.

Vérifier que le PID file ne référence plus un processus vivant de l'ancien service :

```bash
cat /var/lib/smolvm-manager/.pylon/pylon.pid 2>/dev/null || true
pgrep -af '/usr/local/bin/pylon'
```

Ne supprimer le PID file que si son PID est absent.

### 12. Redémarrer et vérifier la production

```bash
systemctl start smolvm-manager
systemctl status smolvm-manager --no-pager
journalctl -u smolvm-manager -n 200 --no-pager
/usr/local/bin/pylon --version
pgrep -af '/usr/local/bin/pylon'
curl -fsS http://127.0.0.1:4173/api/public/health
curl -fsS http://127.0.0.1:4321/api/auth/session
```

Vérifier que les ports 4321/4322/4323 sont ouverts par le nouveau processus.

Validation navigateur obligatoire :

- ouvrir l'URL production ;
- se connecter ;
- confirmer dashboard, settings, audit et diagnostics ;
- modifier une préférence UI et la voir persister ;
- vérifier l'historique de métriques ;
- rafraîchir la page et confirmer la session ;
- vérifier les erreurs console liées à sync/Pylon ;
- redémarrer une seconde fois le service et confirmer que les données restent présentes.

## Critères d'acceptation

La migration est terminée uniquement si :

- les trois packages npm et `/usr/local/bin/pylon` sont en `0.10.0` ;
- `/root/.local/bin/pylon` et `/usr/local/bin/pylon` ont le même checksum attendu ;
- le codegen et `schema check` réussissent ;
- la migration sur copie conserve `PRAGMA integrity_check = ok` ;
- le contrat auth reste inchangé pendant le bump ; tout changement `org.disabled` est traité séparément ;
- User reste default-deny sauf besoin documenté ;
- check, lint, format check, tests, build et gate passent ;
- un smoke non mocké prouve auth, queries/actions, policies et sync ;
- la production Node utilise le transport REST sans erreur de chargement TS ;
- le service démarre avec le nouveau PID, les ports 4321-4323 et le health check ;
- une session survit aux requêtes normales et les données survivent à un redémarrage ;
- les docs de build nomment `v0.10.0` ;
- les sauvegardes et le binaire rollback sont conservés jusqu'à validation finale.

## Rollback production

Si le health check, l'auth, les policies ou la sync échouent :

```bash
systemctl stop smolvm-manager
```

Puis :

1. restaurer le code pré-migration dans `/var/lib/smolvm-manager` ;
2. restaurer `package.json`/`bun.lock` et lancer `bun install` comme utilisateur `smolvm-manager` ;
3. restaurer l'ancien `/usr/local/bin/pylon` depuis `/usr/local/bin/pylon.backup-$stamp` ;
4. si le runtime 0.10.0 a écrit dans les bases réelles, restaurer les sauvegardes SQLite cohérentes de `$backup` (app, sessions, jobs) avec les bons propriétaire/permissions ;
5. supprimer uniquement un PID file stale ;
6. redémarrer :

   ```bash
   systemctl start smolvm-manager
   /usr/local/bin/pylon --version
   curl -fsS http://127.0.0.1:4173/api/public/health
   ```

7. vérifier login, dashboard et persistance.

Ne pas tenter un rollback binaire tout en conservant des packages npm `0.10.0`, ni l'inverse.

## Références upstream

- Release 0.10.0 : <https://github.com/pylonsync/pylon/releases/tag/v0.10.0>
- Comparaison complète : <https://github.com/pylonsync/pylon/compare/v0.3.355...v0.10.0>
- Changelog du dépôt : <https://github.com/pylonsync/pylon/blob/v0.10.0/CHANGELOG.md>
- Commit breaking LLM : <https://github.com/pylonsync/pylon/commit/9290d55dfee846c56da910fd4f80ad70f0e318f2>
- Dépréciation SSR `url` au profit de `pathname` : <https://github.com/pylonsync/pylon/commit/bf615ffe85cb917520c624d81f8c54f736c784ab>
