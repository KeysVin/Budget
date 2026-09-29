# Clair — suivi de patrimoine

Application HTML statique en français. Aucun compte bancaire ni serveur de stockage : les actifs et l’historique sont enregistrés dans le `localStorage` du navigateur.

Les supports d’assurance-vie peuvent être saisis séparément : fonds en euros à valeur manuelle, puis autant d’unités de compte avec ISIN, quantité et prix moyen d’achat que nécessaire. L’option « valeur globale » reste disponible pour les contrats que vous ne souhaitez pas détailler.

## Utiliser en local

Ouvrir `index.html` pour saisir et suivre les actifs manuels. Pour obtenir les cours automatiques en local, lancer `netlify dev` dans ce dossier (la CLI Netlify doit être installée). L’app est alors accessible à l’adresse indiquée par Netlify Dev.

## Déployer sur Netlify

1. Dans Netlify : **Add new project → Import an existing project → GitHub**, choisir le dépôt et la branche `main`.
2. Garder le dossier de base à la racine. Le fichier `netlify.toml` fournit la commande de build, le dossier publié `dist` et la fonction de prix. Déployer le site.
3. Pour les ETF, créer une clé API Twelve Data puis définir `TWELVE_DATA_API_KEY` dans les variables d’environnement Netlify, avec accès aux fonctions. Relancer un déploiement après l’ajout de la variable. Une clé gratuite ne suffit pas forcément pour les ETF cotés à Paris : vérifier que le plan donne accès à Euronext Paris (`XPAR`).
4. Le cours BTC/EUR vient de l’API publique Kraken et ne demande pas de clé.

Les ETF et unités de compte sont identifiés par ISIN. Twelve Data peut exiger son option payante ISIN ; le champ ticker sert alors de référence de cotation. Utiliser le ticker de la bonne place boursière et vérifier la devise. Pour `FR001400U5Q4`, l’application connaît le ticker parisien `DCAM`. Les prix peuvent être différés et dépendent du plan API. Certains supports d’assurance-vie n’ont aucun cours disponible chez ce fournisseur ; saisir alors un **cours actuel de secours** dans l’actif. Ce cours n’est pas actualisé automatiquement. Les frais du contrat et l’éventuelle différence entre valeur liquidative et valeur réelle du contrat ne sont pas inclus dans le cours.

## Calculs et sauvegarde

Pour les livrets, PEL, fonds en euros et assurance-vie globale : performance = valeur saisie − total versé. Pour ETF, unités de compte et BTC : montant investi = quantité × prix moyen d’achat ; valeur = quantité × dernier cours EUR (ou cours de secours) ; performance = valeur − montant investi. Si tout cours manque, le montant investi sert temporairement d’estimation et l’interface le signale. Chaque achat de BTC peut aussi être enregistré comme une ligne distincte.

Le graphique enregistre un point par jour à partir de la première utilisation. Il ne reconstruit pas le passé avant les saisies, et la variation du total peut inclure des dépôts/retraits. Le pourcentage de performance, lui, compare la valeur actuelle aux montants versés pour les positions actuellement présentes. Exporter régulièrement les données JSON ; elles ne se synchronisent pas entre appareils ou navigateurs. L’import remplace les données locales après confirmation.
