# Clair — suivi de patrimoine

Application HTML statique en français. Aucun compte bancaire ni serveur de stockage : les actifs et l’historique sont enregistrés dans le `localStorage` du navigateur.

Les supports d’assurance-vie peuvent être saisis séparément : fonds en euros à valeur manuelle, puis autant d’unités de compte avec ISIN, quantité et prix moyen d’achat que nécessaire. L’option « valeur globale » reste disponible pour les contrats que vous ne souhaitez pas détailler.

## Utiliser en local

Ouvrir `index.html` pour saisir et suivre les actifs manuels. Pour obtenir les cours automatiques en local, lancer `netlify dev` dans ce dossier (la CLI Netlify doit être installée). L’app est alors accessible à l’adresse indiquée par Netlify Dev.

## Déployer sur Netlify

1. Dans Netlify : **Add new project → Import an existing project → GitHub**, choisir le dépôt et la branche `main`.
2. Garder le dossier de base à la racine. Le fichier `netlify.toml` fournit la commande de build, le dossier publié `dist` et la fonction de prix. Déployer le site.
3. Pour les ETF, créer une clé gratuite [EODHD](https://eodhd.com/register), puis définir `EODHD_API_KEY` dans **Site configuration → Environment variables** sur Netlify, avec accès aux fonctions. Mettre la clé dans la valeur, sans guillemets. Relancer un déploiement après l’ajout de la variable. L’application accepte encore `EODHD_API_TOKEN` comme alias de compatibilité, mais `EODHD_API_KEY` est désormais le nom recommandé. L’ancienne variable `TWELVE_DATA_API_KEY` n’est plus utilisée.
4. Le cours BTC/EUR vient de l’API publique Kraken et ne demande pas de clé.

Les ETF et unités de compte sont identifiés par ISIN ou ticker. La fonction recherche le titre chez EODHD et utilise son dernier cours de clôture en euros, avec la date affichée dans l’interface. L’application connaît les tickers parisiens `DCAM` (`FR001400U5Q4`), `PAEEM` (`FR0013412020`) et `PNAS` (`FR001400ZGR7`). Les autres tickers parisiens peuvent être précisés avec le suffixe `.PA`. Un titre coté dans une autre devise n’est pas converti automatiquement : saisir un **cours actuel de secours en euros** dans l’actif. Ce cours n’est pas actualisé automatiquement. Les frais du contrat et l’éventuelle différence entre valeur liquidative et valeur réelle du contrat ne sont pas inclus dans le cours.

La formule gratuite d’EODHD autorise 20 appels API par jour. L’application demande chaque cours ETF au plus une fois par séance après 19 h (heure de Paris), sauf si vous cliquez sur « Actualiser les cours » ou modifiez un actif. Le BTC continue à être actualisé toutes les cinq minutes via Kraken. La disponibilité de chaque ETF dépend de la couverture EODHD ; en cas de cours introuvable, vérifier le ticker ou l’ISIN dans leur recherche.

## Calculs et sauvegarde

Pour les livrets, PEL, fonds en euros et assurance-vie globale : performance = valeur saisie − total versé. Pour ETF, unités de compte et BTC : montant investi = quantité × prix moyen d’achat ; valeur = quantité × dernier cours EUR (ou cours de secours) ; performance = valeur − montant investi. Si tout cours manque, le montant investi sert temporairement d’estimation et l’interface le signale. Chaque achat de BTC peut aussi être enregistré comme une ligne distincte.

Le graphique enregistre un point par jour à partir de la première utilisation. Il ne reconstruit pas le passé avant les saisies, et la variation du total peut inclure des dépôts/retraits. Le pourcentage de performance, lui, compare la valeur actuelle aux montants versés pour les positions actuellement présentes. Exporter régulièrement les données JSON ; elles ne se synchronisent pas entre appareils ou navigateurs. L’import remplace les données locales après confirmation.
