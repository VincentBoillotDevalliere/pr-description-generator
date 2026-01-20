Epic 1 — Génération de description PR depuis le diff (MVP)
US-1 — Générer une description PR depuis les changements staged

En tant que développeur
Je veux lancer une commande VS Code qui génère une description PR à partir de git diff --staged
Afin de gagner du temps et standardiser mes PR.

Critères d’acceptation

Une commande apparaît dans la Command Palette : PRD: Generate PR Description (staged).

Si aucun workspace n’est ouvert → message clair “Open a folder”.

Si le workspace n’est pas un repo git → message clair “Not a git repository”.

Si aucun changement staged → message clair “No staged changes”.

Sinon, l’extension :

récupère git status --porcelain et git diff --staged

génère du Markdown structuré

ouvre le résultat dans un nouvel onglet (document non enregistré)

(option) copie le Markdown dans le presse-papier si setting activé.

Détails d’implémentation

Utiliser child_process.exec avec cwd = workspaceRoot.

Limiter la taille du diff analysé avec un setting prd.maxDiffLines.

Ne jamais bloquer l’UI (async/await).

US-2 — Générer une description PR par diff contre une branche de base

En tant que développeur
Je veux générer une description PR depuis un diff contre main/master (ou une base configurable)
Afin de préparer une PR sans forcément “stager” les changements.

Critères d’acceptation

Une commande apparaît : PRD: Generate PR Description (against base branch).

La base est configurable via prd.baseBranch (défaut main).

L’extension utilise git diff <baseBranch>...HEAD (ou équivalent) pour inclure tous les commits de la branche.

Message d’erreur clair si la branche de base n’existe pas localement.

Détails

Optionnel : si main n’existe pas, essayer master en fallback.

US-3 — Produire un template Markdown standard et lisible

En tant que développeur
Je veux une description PR structurée (sections fixes)
Afin de réduire les aller-retours en review.

Critères d’acceptation

Le Markdown généré contient au minimum :

## Summary (liste à puces)

## Changes (liste à puces)

## Testing (checklist)

## Risk / Impact (niveau + zones impactées)

## Rollout / Backout

Si setting prd.includeFilesSection = true :

ajouter ## Files changed avec la liste des fichiers.

Détails

Template géré dans un module séparé (template.ts) pour itération rapide.

Epic 2 — Extraction d’informations depuis Git (utilité immédiate)
US-4 — Lister précisément les fichiers modifiés et leur type de changement

En tant que développeur
Je veux voir la liste des fichiers changés (A/M/D/R)
Afin de aider le reviewer à comprendre la portée.

Critères d’acceptation

Les fichiers sont extraits de git status --porcelain ou git diff --name-status.

Support des statuts : Added, Modified, Deleted, Renamed.

Les renames affichent old → new.

Détails

Normaliser les chemins en relatif au repo.

US-5 — Déduire des “Changes” à partir du diff (heuristiques simples)

En tant que développeur
Je veux une proposition de bullets “Changes” basée sur le diff
Afin de ne pas partir d’une page blanche.

Critères d’acceptation

L’extension produit au moins 3 types de bullets :

“Updated X files” (résumé global)

bullets par dossier/module (ex: api/, ui/, infra/)

bullets pour fichiers “signals” (package.json, migrations, config)

Le résultat reste stable même si diff est très grand (truncation + analyse partielle).

Détails

Heuristique : grouper par top-level folder.

Heuristique : détecter changements “sensibles” (config/auth/db).

US-6 — Détecter automatiquement si des tests sont impactés / modifiés

En tant que développeur
Je veux que la section “Testing” se pré-remplisse en fonction des fichiers
Afin de éviter d’oublier des tests.

Critères d’acceptation

Si fichiers test détectés (test, tests, __tests__, spec) :

cocher “Unit tests” (ou ajouter bullet “Tests updated”)

Si aucun test détecté :

laisser les cases décochées + ajouter un rappel “Please describe manual testing”.

Détails

Détection path-based + extension-based (ex: .spec.ts, .test.py).

Epic 3 — Qualité UX VS Code (pour que les gens l’adoptent)
US-7 — UX : affichage dans un nouvel onglet + copy clipboard

En tant que développeur
Je veux que le résultat s’ouvre dans VS Code et soit copiable instantanément
Afin de coller dans GitHub/GitLab en 10 secondes.

Critères d’acceptation

Ouvrir un document in-memory (language markdown).

Titre/nom du fichier virtuel : PR_DESCRIPTION.md (ou “untitled”).

Si prd.copyToClipboard = true :

copier le Markdown après génération

afficher une notification “Copied to clipboard”.

US-8 — Messages d’erreur clairs et actionnables

En tant que développeur
Je veux comprendre pourquoi ça ne marche pas
Afin de corriger en 30 secondes.

Critères d’acceptation

Cas gérés :

pas de workspace

pas un repo git

git non installé / non accessible

commande git échoue (afficher stderr)

diff vide

Les notifications ne spamment pas : 1 message par exécution.

US-9 — Performance : limiter l’analyse et rester réactif

En tant que développeur
Je veux que l’extension soit rapide même sur gros diffs
Afin de l’utiliser sur des vrais PR.

Critères d’acceptation

Setting prd.maxDiffLines appliqué.

Si diff dépasse la limite :

l’extension indique dans la description que l’analyse est partielle.

Génération < 1 seconde pour diffs raisonnables.

Epic 4 — “Polish” (Nice-to-have mais rentable)
US-10 — Détecter le niveau de risque automatiquement

En tant que développeur
Je veux une estimation “Low/Medium/High”
Afin de attirer l’attention sur les zones critiques.

Critères d’acceptation

High si :

migrations DB (migrations/, *.sql, prisma, flyway)

auth/security (auth, jwt, oauth, permissions)

infra (terraform, helm, k8s, .github/workflows)

Medium si :

config (.env, config, yaml)

Low sinon

La section “Areas impacted” liste les catégories détectées.

US-11 — Action “Insert into current file”

En tant que développeur
Je veux insérer la description à l’endroit du curseur
Afin de l’utiliser dans un fichier PR template ou release notes.

Critères d’acceptation

Nouvelle commande PRD: Insert PR Description Here

Insère le Markdown au curseur (ou remplace la sélection).

US-12 — Support multi-root workspaces

En tant que développeur
Je veux choisir le repo cible si j’ai plusieurs dossiers
Afin de utiliser l’extension sur mon mono-workspace.

Critères

Si plusieurs workspace folders :

QuickPick pour choisir le dossier

Le reste fonctionne pareil.
