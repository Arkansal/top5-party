const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

// ─── Initialisation du serveur ───────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir les fichiers statiques depuis ./public
app.use(express.static(path.join(__dirname, "public")));

// Charger les sujets au démarrage
let topics = [];
try {
  topics = JSON.parse(
    fs.readFileSync(path.join(__dirname, "topics.json"), "utf-8")
  );
  console.log(`📚 ${topics.length} sujets chargés`);
} catch (err) {
  console.error("❌ Erreur de chargement de topics.json:", err.message);
  topics = [
    { id: 1, label: "Top 5 de tes films préférés" },
    { id: 2, label: "Top 5 de tes séries préférées" },
    { id: 3, label: "Top 5 de tes plats préférés" },
    { id: 4, label: "Top 5 de tes jeux vidéo préférés" },
    { id: 5, label: "Top 5 de tes sports préférés" },
  ];
}

// ─── Stockage en mémoire ─────────────────────────────────────────────────────

const rooms = {}; // Map de roomCode -> objet room

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Génère un code de salle aléatoire de 6 caractères alphanumériques majuscules.
 */
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

/**
 * Algorithme de Fisher-Yates pour mélanger un tableau.
 * Retourne une nouvelle copie mélangée.
 */
function fisherYatesShuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Trouve la salle à laquelle appartient un socket.
 * Retourne { code, room } ou null si introuvable.
 */
function findRoomBySocketId(socketId) {
  for (const [code, room] of Object.entries(rooms)) {
    if (room.players.some((p) => p.id === socketId)) {
      return { code, room };
    }
  }
  return null;
}

/**
 * Sélectionne N sujets aléatoires parmi ceux non encore utilisés dans la salle.
 */
function pickRandomTopics(room, count = 5) {
  let available = topics.filter((t) => !room.usedTopicIds.includes(t.id));
  if (available.length < count) {
    // Si on a épuisé les sujets, réinitialiser la liste d'utilisation
    room.usedTopicIds = [];
    available = [...topics];
  }
  const shuffled = fisherYatesShuffle(available);
  return shuffled.slice(0, count);
}

/**
 * Envoie la mise à jour du lobby à toute la salle.
 */
function emitLobbyUpdate(code, room) {
  io.to(code).emit("lobby-update", {
    roomCode: code,
    hostId: room.host,
    players: room.players.map((p) => ({ id: p.id, pseudo: p.pseudo, score: p.score })),
  });
}

/**
 * Démarre un nouveau round dans la salle.
 */
function startRound(code, room) {
  room.currentRound++;
  room.state = "choosing-topic";
  room.currentTopic = null;
  room.currentTop5 = [];
  room.shuffledTop5 = [];
  room.guesses = {};

  // Choisir un joueur qui n'a pas encore joué dans cette rotation
  const availablePlayers = room.players.filter(
    (p) => !room.playedPlayers.includes(p.id)
  );

  if (availablePlayers.length === 0) {
    // Fin de partie normale
    room.state = "game-over";
    io.to(code).emit("game-over", { scores: getFinalScores(room) });
    return;
  }

  const randomIndex = Math.floor(Math.random() * availablePlayers.length);
  const chosenPlayer = availablePlayers[randomIndex];
  room.currentPlayerIndex = room.players.findIndex((p) => p.id === chosenPlayer.id);
  room.playedPlayers.push(chosenPlayer.id);

  // Choisir 5 sujets aléatoires
  const roundTopics = pickRandomTopics(room, 5);

  console.log(
    `[Tour ${room.currentRound}/${room.totalRounds}] Salle ${code} — Joueur actif: "${chosenPlayer.pseudo}"`
  );

  // Émettre le début du tour à toute la salle
  io.to(code).emit("new-round", {
    roundNumber: room.currentRound,
    totalRounds: room.totalRounds,
    currentPlayerId: chosenPlayer.id,
    currentPlayerPseudo: chosenPlayer.pseudo,
    topics: roundTopics,
  });
}

/**
 * Calcule les scores finaux triés par ordre décroissant.
 */
function getFinalScores(room) {
  return room.players
    .map((p) => ({ pseudo: p.pseudo, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Calcule les points du tour et diffuse les résultats.
 */
function calculateAndEmitResults(code, room) {
  room.state = "round-results";
  const correctOrder = room.currentTop5;
  const currentPlayer = room.players[room.currentPlayerIndex];

  const results = [];

  for (const [socketId, guess] of Object.entries(room.guesses)) {
    const player = room.players.find((p) => p.id === socketId);
    if (!player) continue;

    let roundScore = 0;
    let correctCount = 0;

    for (let i = 0; i < 5; i++) {
      if (guess[i] === correctOrder[i]) {
        roundScore++;
        correctCount++;
      }
    }

    // Si les 5 sont corrects : 5 + 1 point bonus = 6
    if (correctCount === 5) {
      roundScore = 6;
    }

    player.score += roundScore;

    results.push({
      pseudo: player.pseudo,
      guess: guess,
      guessedOrder: guess,
      score: roundScore,
      roundScore: roundScore,
    });
  }

  const scores = room.players.map((p) => ({
    pseudo: p.pseudo,
    score: p.score,
  }));

  io.to(code).emit("round-results", {
    results,
    correctOrder,
    topic: room.currentTopic ? room.currentTopic.label : "",
    currentPlayer: currentPlayer ? currentPlayer.pseudo : "???",
    scores,
  });
}

// ─── Gestion des connexions Socket.IO ────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[Connexion] Nouveau client connecté: ${socket.id}`);

  // ── Création de salle ──────────────────────────────────────────────────
  socket.on("create-room", (data) => {
    const pseudo = (typeof data === "object" ? data.pseudo : data) || "";
    if (typeof pseudo !== "string" || !pseudo.trim()) {
      socket.emit("error", { message: "Le pseudo est requis." });
      return;
    }

    const code = generateRoomCode();
    const room = {
      host: socket.id,
      players: [{ id: socket.id, pseudo: pseudo.trim(), score: 0 }],
      state: "lobby",
      currentRound: 0,
      totalRounds: 0,
      currentPlayerIndex: null,
      currentTopic: null,
      currentTop5: [],
      shuffledTop5: [],
      guesses: {},
      playedPlayers: [],
      usedTopicIds: [],
    };

    rooms[code] = room;
    socket.join(code);

    console.log(`[Salle créée] Code: ${code} par "${pseudo.trim()}" (${socket.id})`);

    socket.emit("room-created", { roomCode: code });
    emitLobbyUpdate(code, room);
  });

  // ── Rejoindre une salle ────────────────────────────────────────────────
  socket.on("join-room", (data) => {
    const pseudo = (data && data.pseudo) || "";
    const code = ((data && (data.roomCode || data.code)) || "").toUpperCase().trim();

    if (!pseudo || typeof pseudo !== "string" || !pseudo.trim()) {
      socket.emit("error", { message: "Le pseudo est requis." });
      return;
    }

    if (!code || typeof code !== "string") {
      socket.emit("error", { message: "Le code de salle est requis." });
      return;
    }

    const room = rooms[code];
    if (!room) {
      socket.emit("error", { message: "Salle introuvable avec ce code." });
      return;
    }

    if (room.state !== "lobby") {
      socket.emit("error", { message: "La partie a déjà commencé." });
      return;
    }

    if (room.players.some((p) => p.id === socket.id)) {
      socket.emit("error", { message: "Vous êtes déjà dans cette salle." });
      return;
    }

    room.players.push({ id: socket.id, pseudo: pseudo.trim(), score: 0 });
    socket.join(code);

    console.log(`[Joueur rejoint] "${pseudo.trim()}" (${socket.id}) → salle ${code}`);

    socket.emit("room-joined", { roomCode: code });
    emitLobbyUpdate(code, room);
  });

  // ── Lancer la partie ───────────────────────────────────────────────────
  socket.on("start-game", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.host !== socket.id) {
      socket.emit("error", { message: "Seul l'hôte peut lancer la partie." });
      return;
    }

    if (room.state !== "lobby") {
      socket.emit("error", { message: "La partie est déjà en cours." });
      return;
    }

    if (room.players.length < 2) {
      socket.emit("error", { message: "Il faut au moins 2 joueurs pour commencer." });
      return;
    }

    room.totalRounds = room.players.length;
    room.currentRound = 0;
    room.playedPlayers = [];
    room.usedTopicIds = [];
    room.players.forEach((p) => (p.score = 0));

    console.log(
      `[Partie lancée] Salle ${code} — ${room.players.length} joueurs, ${room.totalRounds} tours`
    );

    startRound(code, room);
  });

  // ── Sélection du sujet ─────────────────────────────────────────────────
  socket.on("select-topic", (data) => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.state !== "choosing-topic") {
      socket.emit("error", { message: "Ce n'est pas le moment de choisir un sujet." });
      return;
    }

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("error", { message: "Ce n'est pas votre tour de choisir." });
      return;
    }

    const topicId = typeof data === "object" ? data.topicId : data;
    const topicLabel = typeof data === "object" ? data.topic : null;

    let topic = null;
    if (topicId !== undefined && topicId !== null) {
      topic = topics.find((t) => t.id === topicId);
    }
    if (!topic && topicLabel) {
      topic = topics.find((t) => t.label === topicLabel) || { id: Date.now(), label: topicLabel };
    }

    if (!topic) {
      socket.emit("error", { message: "Sujet introuvable." });
      return;
    }

    room.currentTopic = topic;
    room.usedTopicIds.push(topic.id);
    room.state = "filling-top5";

    console.log(`[Sujet choisi] Salle ${code} — "${topic.label}" par "${currentPlayer.pseudo}"`);

    // Notifier toute la salle du sujet sélectionné
    io.to(code).emit("topic-selected", { topic: topic.label });

    // Envoyer au joueur actif l'écran de remplissage
    socket.emit("fill-top5", { topic: topic.label });

    // Informer les autres joueurs qu'ils doivent attendre
    socket.to(code).emit("waiting-for-top5", {
      currentPlayerPseudo: currentPlayer.pseudo,
      topic: topic.label,
    });
  });

  // ── Soumission du Top 5 ───────────────────────────────────────────────
  socket.on("submit-top5", (data) => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.state !== "filling-top5") {
      socket.emit("error", { message: "Ce n'est pas le moment de soumettre un Top 5." });
      return;
    }

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("error", { message: "Ce n'est pas votre tour." });
      return;
    }

    const answers = Array.isArray(data) ? data : (data && (data.items || data.answers));
    if (
      !Array.isArray(answers) ||
      answers.length !== 5 ||
      answers.some((a) => typeof a !== "string" || !a.trim())
    ) {
      socket.emit("error", { message: "Vous devez renseigner 5 choix complets." });
      return;
    }

    room.currentTop5 = answers.map((a) => a.trim());
    room.shuffledTop5 = fisherYatesShuffle(room.currentTop5);

    // Si par hasard le shuffle donne l'ordre d'origine et qu'il y a des éléments distincts,
    // on reshuffle une fois de plus
    if (
      room.shuffledTop5.join("|||") === room.currentTop5.join("|||") &&
      new Set(room.currentTop5).size > 1
    ) {
      room.shuffledTop5.reverse();
    }

    room.state = "guessing";
    room.guesses = {};

    const guessersCount = room.players.filter((p) => p.id !== currentPlayer.id).length;

    // Prévenir le joueur actif qu'on attend les devinettes
    socket.emit("waiting-guesses", {
      totalGuessers: guessersCount,
      count: 0,
    });

    // Envoyer les données aux devineurs
    const guessData = {
      currentPlayerPseudo: currentPlayer.pseudo,
      currentPlayer: currentPlayer.pseudo,
      topic: room.currentTopic ? room.currentTopic.label : "",
      shuffledItems: room.shuffledTop5,
      shuffledAnswers: room.shuffledTop5,
    };

    room.players.forEach((p) => {
      if (p.id !== currentPlayer.id) {
        io.to(p.id).emit("guess-top5", guessData);
      }
    });

    console.log(`[Top 5 soumis] Salle ${code} par "${currentPlayer.pseudo}", en attente de ${guessersCount} devineurs`);
  });

  // ── Soumission d'une devinette ─────────────────────────────────────────
  socket.on("submit-guess", (data) => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.state !== "guessing") {
      socket.emit("error", { message: "Ce n'est pas le moment de deviner." });
      return;
    }

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer && currentPlayer.id === socket.id) {
      socket.emit("error", { message: "Le joueur actif ne peut pas deviner son propre Top 5." });
      return;
    }

    const orderedAnswers = Array.isArray(data)
      ? data
      : (data && (data.guessedOrder || data.orderedAnswers));

    if (!Array.isArray(orderedAnswers) || orderedAnswers.length !== 5) {
      socket.emit("error", { message: "Vous devez ordonner les 5 éléments." });
      return;
    }

    // Sauvegarder la devinette
    room.guesses[socket.id] = orderedAnswers;

    const guessersCount = room.players.filter((p) => p.id !== currentPlayer.id).length;
    const guessesReceived = Object.keys(room.guesses).length;

    console.log(
      `[Devinette reçue] Salle ${code} (${guessesReceived}/${guessersCount})`
    );

    // Mettre à jour le compteur en temps réel pour le joueur actif
    if (currentPlayer) {
      io.to(currentPlayer.id).emit("guesses-update", {
        count: guessesReceived,
        total: guessersCount,
      });
    }

    if (guessesReceived >= guessersCount) {
      calculateAndEmitResults(code, room);
    }
  });

  // ── Passer au round suivant ────────────────────────────────────────────
  socket.on("next-round", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.host !== socket.id) {
      socket.emit("error", { message: "Seul l'hôte peut passer au tour suivant." });
      return;
    }

    if (room.state !== "round-results") {
      socket.emit("error", { message: "Impossible de passer au tour suivant maintenant." });
      return;
    }

    if (room.currentRound < room.totalRounds) {
      startRound(code, room);
    } else {
      room.state = "game-over";
      io.to(code).emit("game-over", { scores: getFinalScores(room) });
    }
  });

  // ── Rejouer ────────────────────────────────────────────────────────────
  socket.on("play-again", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;

    if (room.host !== socket.id) {
      socket.emit("error", { message: "Seul l'hôte peut relancer une partie." });
      return;
    }

    room.state = "lobby";
    room.currentRound = 0;
    room.totalRounds = 0;
    room.currentPlayerIndex = null;
    room.currentTopic = null;
    room.currentTop5 = [];
    room.shuffledTop5 = [];
    room.guesses = {};
    room.playedPlayers = [];
    room.usedTopicIds = [];
    room.players.forEach((p) => (p.score = 0));

    console.log(`[Rejouer] Salle ${code} réinitialisée au lobby`);

    emitLobbyUpdate(code, room);
  });

  // ── Déconnexion ────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) return;

    const { code, room } = found;
    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;

    const disconnectedPlayer = room.players[playerIndex];
    console.log(
      `[Déconnexion] "${disconnectedPlayer.pseudo}" (${socket.id}) a quitté la salle ${code}`
    );

    room.players.splice(playerIndex, 1);

    if (room.players.length === 0) {
      delete rooms[code];
      console.log(`[Salle supprimée] ${code} (plus aucun joueur)`);
      return;
    }

    // Réassigner l'hôte si c'était l'hôte
    if (room.host === socket.id) {
      room.host = room.players[0].id;
      console.log(`[Nouvel hôte] "${room.players[0].pseudo}" dans la salle ${code}`);
    }

    if (room.state === "lobby") {
      emitLobbyUpdate(code, room);
    } else {
      // En cours de partie
      room.totalRounds = Math.max(room.currentRound, room.players.length);
      room.playedPlayers = room.playedPlayers.filter((id) => id !== socket.id);

      // Si le joueur actif part
      if (room.currentPlayerIndex !== null) {
        const wasCurrentPlayer =
          room.currentPlayerIndex === playerIndex ||
          room.currentPlayerIndex >= room.players.length;

        if (wasCurrentPlayer) {
          if (room.currentRound < room.totalRounds && room.players.length >= 2) {
            startRound(code, room);
          } else {
            room.state = "game-over";
            io.to(code).emit("game-over", { scores: getFinalScores(room) });
          }
          return;
        }

        if (playerIndex < room.currentPlayerIndex) {
          room.currentPlayerIndex--;
        }
      }

      // Si on était en train de deviner, vérifier si on a toutes les réponses restantes
      if (room.state === "guessing") {
        delete room.guesses[socket.id];
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer) {
          const guessersCount = room.players.filter((p) => p.id !== currentPlayer.id).length;
          const guessesReceived = Object.keys(room.guesses).length;

          io.to(currentPlayer.id).emit("guesses-update", {
            count: guessesReceived,
            total: guessersCount,
          });

          if (guessesReceived >= guessersCount && guessersCount > 0) {
            calculateAndEmitResults(code, room);
          }
        }
      }
    }
  });
});

// ─── Démarrage du serveur ────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Serveur Top 5 Party lancé sur le port ${PORT}`);
});
