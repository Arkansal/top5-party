const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Initialisation du serveur ───────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir les fichiers statiques depuis ./public
app.use(express.static(path.join(__dirname, "public")));

// Durée de validité des sessions / tokens : 30 minutes (1/2 heure)
const TOKEN_TTL_MS = 30 * 60 * 1000;

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
 * Génère un identifiant unique de session pour le joueur (token persistant).
 */
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

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
    room.usedTopicIds = [];
    available = [...topics];
  }
  const shuffled = fisherYatesShuffle(available);
  return shuffled.slice(0, count);
}

/**
 * Vérifie et s'assure qu'un joueur connecté est désigné comme hôte.
 */
function ensureActiveHost(room, code) {
  if (!room || !room.players || room.players.length === 0) return false;
  const currentHost = room.players.find((p) => p.token === room.hostToken);
  if (!currentHost || !currentHost.connected) {
    const nextConnected = room.players.find((p) => p.connected);
    if (nextConnected && nextConnected.token !== room.hostToken) {
      room.hostToken = nextConnected.token;
      room.host = nextConnected.id;
      console.log(`[Hôte transféré] "${nextConnected.pseudo}" devient l'hôte de la salle ${code}`);
      return true;
    }
  }
  return false;
}

/**
 * Envoie la mise à jour du lobby à toute la salle.
 */
function emitLobbyUpdate(code, room) {
  ensureActiveHost(room, code);
  io.to(code).emit("lobby-update", {
    roomCode: code,
    hostId: room.host,
    hostToken: room.hostToken,
    totalRounds: room.totalRounds || 5,
    players: room.players.map((p) => ({
      id: p.id,
      token: p.token,
      pseudo: p.pseudo,
      score: p.score,
      connected: p.connected,
    })),
  });
}

/**
 * Démarre un nouveau tour dans la salle.
 */
function startRound(code, room) {
  if (room.currentRound >= room.totalRounds) {
    room.state = "game-over";
    io.to(code).emit("game-over", { scores: getFinalScores(room) });
    return;
  }

  room.currentRound++;
  room.state = "choosing-topic";
  room.currentTopic = null;
  room.currentTop5 = [];
  room.shuffledTop5 = [];
  room.guesses = {};

  // Choisir un joueur qui n'a pas encore joué dans cette rotation
  let availablePlayers = room.players.filter(
    (p) => !room.playedTokens.includes(p.token)
  );

  // Si tous les joueurs ont déjà joué dans cette rotation, on démarre un nouveau cycle
  if (availablePlayers.length === 0) {
    room.playedTokens = [];
    const connectedPlayers = room.players.filter((p) => p.connected);
    availablePlayers = connectedPlayers.length > 0 ? connectedPlayers : [...room.players];
  }

  if (availablePlayers.length === 0) {
    room.state = "game-over";
    io.to(code).emit("game-over", { scores: getFinalScores(room) });
    return;
  }

  // Éviter de sélectionner deux fois consécutivement le même joueur s'il y a d'autres options
  let candidatePlayers = availablePlayers;
  if (
    availablePlayers.length > 1 &&
    room.currentPlayerIndex !== null &&
    room.players[room.currentPlayerIndex]
  ) {
    const lastPlayedToken = room.players[room.currentPlayerIndex].token;
    const filtered = availablePlayers.filter((p) => p.token !== lastPlayedToken);
    if (filtered.length > 0) {
      candidatePlayers = filtered;
    }
  }

  const randomIndex = Math.floor(Math.random() * candidatePlayers.length);
  const chosenPlayer = candidatePlayers[randomIndex];
  room.currentPlayerIndex = room.players.findIndex((p) => p.token === chosenPlayer.token);
  room.playedTokens.push(chosenPlayer.token);

  room.currentRoundTopics = pickRandomTopics(room, 5);

  console.log(
    `[Tour ${room.currentRound}/${room.totalRounds}] Salle ${code} — Joueur actif: "${chosenPlayer.pseudo}"`
  );

  io.to(code).emit("new-round", {
    roundNumber: room.currentRound,
    totalRounds: room.totalRounds,
    currentPlayerId: chosenPlayer.id,
    currentPlayerPseudo: chosenPlayer.pseudo,
    topics: room.currentRoundTopics,
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

  for (const [token, guess] of Object.entries(room.guesses)) {
    const player = room.players.find((p) => p.token === token);
    if (!player) continue;

    let roundScore = 0;
    let correctCount = 0;

    for (let i = 0; i < 5; i++) {
      if (guess[i] === correctOrder[i]) {
        roundScore++;
        correctCount++;
      }
    }

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

  const resultsPayload = {
    results,
    correctOrder,
    topic: room.currentTopic ? room.currentTopic.label : "",
    currentPlayer: currentPlayer ? currentPlayer.pseudo : "???",
    scores,
  };

  room.lastResults = resultsPayload;
  io.to(code).emit("round-results", resultsPayload);
}

// Nettoyage régulier des salles inactives depuis plus de 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    const allDisconnected = room.players.every((p) => !p.connected);
    const expired = (now - room.lastActivity) > TOKEN_TTL_MS;
    if (allDisconnected && expired) {
      delete rooms[code];
      console.log(`[Nettoyage] Salle expirée ${code} supprimée`);
    }
  }
}, 60 * 1000);

// ─── Gestion des connexions Socket.IO ────────────────────────────────────────

io.on("connection", (socket) => {
  // ── Restauration de session (localStorage) ─────────────────────────────
  socket.on("restore-session", (data) => {
    const token = data && data.token;
    const rawCode = data && data.roomCode;
    const code = rawCode ? rawCode.toUpperCase().trim() : "";

    if (!token || !code) {
      socket.emit("restore-session-failed", { message: "Session invalide." });
      return;
    }

    const room = rooms[code];
    if (!room) {
      socket.emit("restore-session-failed", { message: "Salle introuvable ou fermée." });
      return;
    }

    const player = room.players.find((p) => p.token === token);
    if (!player) {
      socket.emit("restore-session-failed", { message: "Session expirée." });
      return;
    }

    const now = Date.now();
    if (now - player.lastSeen > TOKEN_TTL_MS) {
      socket.emit("restore-session-failed", { message: "Session expirée (> 30 min)." });
      return;
    }

    // Réattacher le nouveau socket au joueur
    player.id = socket.id;
    player.connected = true;
    player.lastSeen = now;
    room.lastActivity = now;

    // Si c'est l'hôte, actualiser son socket ID
    if (room.hostToken === player.token) {
      room.host = socket.id;
    }

    socket.join(code);
    console.log(`[Session restaurée] "${player.pseudo}" (${socket.id}) dans la salle ${code}`);

    const currentPlayer = room.players[room.currentPlayerIndex];
    const isCurrentPlayer = (currentPlayer && currentPlayer.token === player.token);

    // Envoyer l'état complet du jeu au joueur qui revient
    socket.emit("session-restored", {
      token: player.token,
      roomCode: code,
      pseudo: player.pseudo,
      isHost: (room.hostToken === player.token),
      hostToken: room.hostToken,
      state: room.state,
      players: room.players.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        score: p.score,
        connected: p.connected,
      })),
      hostId: room.host,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      isCurrentPlayer: !!isCurrentPlayer,
      currentPlayerPseudo: currentPlayer ? currentPlayer.pseudo : null,
      topics: isCurrentPlayer && room.state === "choosing-topic" ? room.currentRoundTopics : null,
      currentTopic: room.currentTopic ? room.currentTopic.label : null,
      shuffledItems: room.shuffledTop5,
      alreadyGuessed: !!room.guesses[player.token],
      guessesCount: Object.keys(room.guesses).length,
      guessesTotal: room.players.filter((p) => p.token !== currentPlayer?.token).length,
      lastResults: room.lastResults,
      finalScores: room.state === "game-over" ? getFinalScores(room) : null,
    });

    emitLobbyUpdate(code, room);
  });

  // ── Création de salle ──────────────────────────────────────────────────
  socket.on("create-room", (data) => {
    const pseudo = (typeof data === "object" ? data.pseudo : data) || "";
    if (typeof pseudo !== "string" || !pseudo.trim()) {
      socket.emit("error", { message: "Le pseudo est requis." });
      return;
    }

    let totalRounds = 5;
    if (typeof data === "object" && data.totalRounds !== undefined) {
      const parsed = parseInt(data.totalRounds, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
        totalRounds = parsed;
      }
    }

    const code = generateRoomCode();
    const token = generateToken();
    const now = Date.now();

    const room = {
      hostToken: token,
      host: socket.id,
      players: [{
        id: socket.id,
        token: token,
        pseudo: pseudo.trim(),
        score: 0,
        connected: true,
        lastSeen: now,
      }],
      state: "lobby",
      currentRound: 0,
      totalRounds: totalRounds,
      currentPlayerIndex: null,
      currentRoundTopics: [],
      currentTopic: null,
      currentTop5: [],
      shuffledTop5: [],
      guesses: {},
      playedTokens: [],
      usedTopicIds: [],
      lastResults: null,
      createdAt: now,
      lastActivity: now,
    };

    rooms[code] = room;
    socket.join(code);

    console.log(`[Salle créée] Code: ${code} par "${pseudo.trim()}" (${totalRounds} tours, token: ${token})`);

    socket.emit("room-created", { roomCode: code, token: token, totalRounds: totalRounds });
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

    const token = generateToken();
    const now = Date.now();

    room.players.push({
      id: socket.id,
      token: token,
      pseudo: pseudo.trim(),
      score: 0,
      connected: true,
      lastSeen: now,
    });
    room.lastActivity = now;
    socket.join(code);

    console.log(`[Joueur rejoint] "${pseudo.trim()}" → salle ${code} (token: ${token})`);

    socket.emit("room-joined", { roomCode: code, token: token });
    emitLobbyUpdate(code, room);
  });

  // ── Lancer la partie ───────────────────────────────────────────────────
  socket.on("start-game", (data) => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;
    const player = room.players.find((p) => p.id === socket.id);
    const isHost = (room.host === socket.id || (player && player.token === room.hostToken));

    if (!isHost) {
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

    if (data && data.totalRounds !== undefined) {
      const parsed = parseInt(data.totalRounds, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
        room.totalRounds = parsed;
      }
    }

    if (!room.totalRounds || room.totalRounds < 1) {
      room.totalRounds = 5;
    }

    room.currentRound = 0;
    room.playedTokens = [];
    room.usedTopicIds = [];
    room.lastActivity = Date.now();
    room.players.forEach((p) => (p.score = 0));

    console.log(
      `[Partie lancée] Salle ${code} — ${room.players.length} joueurs, ${room.totalRounds} tours`
    );

    startRound(code, room);
  });

  // ── Mise à jour du nombre de tours (lobby) ──────────────────────────────
  socket.on("update-rounds", (data) => {
    const found = findRoomBySocketId(socket.id);
    if (!found) return;

    const { code, room } = found;
    const player = room.players.find((p) => p.id === socket.id);
    const isHost = (room.host === socket.id || (player && player.token === room.hostToken));

    if (!isHost) {
      socket.emit("error", { message: "Seul l'hôte peut modifier le nombre de tours." });
      return;
    }

    if (room.state !== "lobby") {
      socket.emit("error", { message: "La partie est déjà en cours." });
      return;
    }

    const rounds = parseInt(data && data.totalRounds, 10);
    if (isNaN(rounds) || rounds < 1 || rounds > 50) {
      socket.emit("error", { message: "Le nombre de tours doit être entre 1 et 50." });
      return;
    }

    room.totalRounds = rounds;
    room.lastActivity = Date.now();
    console.log(`[Configuration] Salle ${code} — Nombre de tours réglé sur ${rounds}`);
    emitLobbyUpdate(code, room);
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
    room.lastActivity = Date.now();

    console.log(`[Sujet choisi] Salle ${code} — "${topic.label}" par "${currentPlayer.pseudo}"`);

    io.to(code).emit("topic-selected", { topic: topic.label });
    socket.emit("fill-top5", { topic: topic.label });

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

    if (
      room.shuffledTop5.join("|||") === room.currentTop5.join("|||") &&
      new Set(room.currentTop5).size > 1
    ) {
      room.shuffledTop5.reverse();
    }

    room.state = "guessing";
    room.guesses = {};
    room.lastActivity = Date.now();

    const guessersCount = room.players.filter((p) => p.token !== currentPlayer.token).length;

    socket.emit("waiting-guesses", {
      totalGuessers: guessersCount,
      count: 0,
    });

    const guessData = {
      currentPlayerPseudo: currentPlayer.pseudo,
      currentPlayer: currentPlayer.pseudo,
      topic: room.currentTopic ? room.currentTopic.label : "",
      shuffledItems: room.shuffledTop5,
      shuffledAnswers: room.shuffledTop5,
    };

    room.players.forEach((p) => {
      if (p.token !== currentPlayer.token && p.connected) {
        io.to(p.id).emit("guess-top5", guessData);
      }
    });

    console.log(`[Top 5 soumis] Salle ${code} par "${currentPlayer.pseudo}"`);
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

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer && currentPlayer.token === player.token) {
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

    // Sauvegarder la devinette indexée par token
    room.guesses[player.token] = orderedAnswers;
    room.lastActivity = Date.now();

    const guessersCount = room.players.filter((p) => p.token !== currentPlayer.token).length;
    const guessesReceived = Object.keys(room.guesses).length;

    console.log(`[Devinette reçue] Salle ${code} (${guessesReceived}/${guessersCount})`);

    if (currentPlayer && currentPlayer.connected) {
      io.to(currentPlayer.id).emit("guesses-update", {
        count: guessesReceived,
        total: guessersCount,
      });
    }

    if (guessesReceived >= guessersCount) {
      calculateAndEmitResults(code, room);
    }
  });

  // ── Passer au tour suivant ─────────────────────────────────────────────
  socket.on("next-round", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;
    const player = room.players.find((p) => p.id === socket.id);
    const isHost = (room.host === socket.id || (player && player.token === room.hostToken));

    if (!isHost) {
      socket.emit("error", { message: "Seul l'hôte peut passer au tour suivant." });
      return;
    }

    if (room.state !== "round-results") {
      socket.emit("error", { message: "Impossible de passer au tour suivant maintenant." });
      return;
    }

    room.lastActivity = Date.now();

    if (room.currentRound < room.totalRounds) {
      startRound(code, room);
    } else {
      room.state = "game-over";
      io.to(code).emit("game-over", { scores: getFinalScores(room) });
    }
  });

  // ── Rejouer (accessible à tous pour relancer avec les mêmes joueurs) ─────
  socket.on("play-again", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) {
      socket.emit("error", { message: "Vous n'êtes dans aucune salle." });
      return;
    }

    const { code, room } = found;
    const player = room.players.find((p) => p.id === socket.id);

    ensureActiveHost(room, code);

    room.state = "lobby";
    room.currentRound = 0;
    room.totalRounds = room.totalRounds || 5;
    room.currentPlayerIndex = null;
    room.currentTopic = null;
    room.currentTop5 = [];
    room.shuffledTop5 = [];
    room.guesses = {};
    room.playedTokens = [];
    room.usedTopicIds = [];
    room.lastResults = null;
    room.lastActivity = Date.now();
    room.players.forEach((p) => (p.score = 0));

    console.log(
      `[Rejouer] Salle ${code} réinitialisée au lobby par "${player ? player.pseudo : 'Un joueur'}"`
    );

    io.to(code).emit("room-restarted", {
      restartedBy: player ? player.pseudo : "Un joueur",
      totalRounds: room.totalRounds,
    });

    emitLobbyUpdate(code, room);
  });

  // ── Quitter la salle volontairement ─────────────────────────────────────
  socket.on("leave-room", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) return;

    const { code, room } = found;
    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    if (playerIndex === -1) return;

    const leavingPlayer = room.players[playerIndex];
    const wasHost = (room.hostToken === leavingPlayer.token || room.host === socket.id);

    // Retirer le joueur de la salle
    room.players.splice(playerIndex, 1);
    socket.leave(code);
    console.log(`[Départ volontaire] "${leavingPlayer.pseudo}" a quitté la salle ${code}`);

    // Si la salle est vide, la supprimer
    if (room.players.length === 0) {
      delete rooms[code];
      console.log(`[Nettoyage] Salle ${code} supprimée car vide`);
      return;
    }

    // Si l'hôte est parti, transférer le rôle à un autre joueur
    if (wasHost && room.players.length > 0) {
      ensureActiveHost(room, code);
    }

    room.lastActivity = Date.now();
    emitLobbyUpdate(code, room);
  });

  // ── Déconnexion temporaire ─────────────────────────────────────────────
  socket.on("disconnect", () => {
    const found = findRoomBySocketId(socket.id);
    if (!found) return;

    const { code, room } = found;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const now = Date.now();
    player.connected = false;
    player.lastSeen = now;
    room.lastActivity = now;

    console.log(
      `[Déconnexion temporaire] "${player.pseudo}" a quitté la salle ${code}. Session active pendant 30 min.`
    );

    // Si l'hôte s'est déconnecté, s'assurer qu'un joueur connecté peut reprendre le rôle
    ensureActiveHost(room, code);

    emitLobbyUpdate(code, room);
  });
});

// ─── Démarrage du serveur ────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Serveur Top 5 Party lancé sur le port ${PORT}`);
});
