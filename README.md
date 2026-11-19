# 🎮 Top 5 Party

Un jeu web multijoueur en ligne en temps réel pour s'amuser entre amis !

## 🎯 Le Concept
Un joueur est tiré au sort, choisit 1 sujet parmi 5 propositions ("Top 5 de tes films préférés", "Top 5 de tes fast-foods", etc.) et remplit son Top 5 personnel.  
Les autres joueurs reçoivent ses réponses dans le désordre et doivent les **remettre dans le bon ordre en glissant-déposant (Drag & Drop)**.

### 🏆 Système de points
- **+1 point** par élément placé à la bonne position
- **+6 points** si tout le Top 5 est parfaitement trouvé (5 bonnes réponses + 1 point bonus)
- Le nombre de tours correspond au nombre de joueurs dans la room (chacun passe une fois)
- Affichage du podium et du classement final à la fin de la partie !

---

## 🚀 Lancer le jeu en local

Dans votre terminal :

```bash
# 1. Aller dans le dossier du jeu
cd ~/projects/test-jeu

# 2. Lancer le serveur
npm start
# ou en mode rechargement automatique :
npm run dev
```

Puis ouvrez votre navigateur sur :  
👉 **[http://localhost:3000](http://localhost:3000)**

> **Pour tester à plusieurs sur votre machine :**  
> Ouvrez plusieurs onglets ou fenêtres de navigation privée !  
> 1. Un onglet crée une room et obtient un code à 6 lettres (ex: `ABCDEF`).  
> 2. Les autres onglets saisissent un pseudo et ce code pour rejoindre.  
> 3. L'hôte lance la partie dès qu'il y a au moins 3 joueurs.

---

## 🌐 Comment y jouer en ligne avec ses amis ? (Hébergement gratuit)

Comme le jeu repose sur un serveur Node.js et des WebSockets temps réel (Socket.IO), il ne peut pas être hébergé sur les pages GitHub (qui ne supportent que du HTML/JS statique sans backend).

Voici la méthode recommandée, **100% gratuite** et ultra rapide :

### Option 1 : [Render.com](https://render.com) (Recommandé)
1. Poussez ce dossier sur un repo GitHub personnel.
2. Créez un compte gratuit sur [Render.com](https://render.com).
3. Cliquez sur **New +** → **Web Service**.
4. Connectez votre dépôt GitHub.
5. Définissez :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
6. Cliquez sur **Create Web Service**. Vous aurez une URL publique partageable (ex: `https://top5-party.onrender.com`) accessible directement depuis les smartphones et ordinateurs de vos amis !

### Option 2 : [Railway.app](https://railway.app)
1. Créez un compte sur Railway.
2. Cliquez sur **Deploy from GitHub repo**.
3. Railway détecte Node.js automatiquement et génère votre URL publique.

---

## 📁 Structure du projet

```
test-jeu/
├── server.js          # Serveur Express + Socket.IO + logique des tours et du scoring
├── topics.json        # 80 sujets de Top 5 uniques en français
├── package.json       # Dépendances (express, socket.io)
└── public/
    ├── index.html     # Application monopage (tous les écrans du jeu)
    ├── style.css      # Thème sombre moderne, animations, responsive mobile
    └── script.js      # Client Socket.IO + Drag & Drop souris & tactile
```
