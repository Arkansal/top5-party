/* =================================================================
   TOP 5 PARTY — Script client Socket.IO
   Style Rétro Minimaliste + Gestion de session (localStorage 30 min)
   ================================================================= */

// --- Connexion au serveur Socket.IO ---
const socket = io();

// =================================================================
// GESTION DU STOCKAGE LOCAL (PERSISTANCE DE SESSION)
// =================================================================
const SESSION_KEY = 'top5_party_session';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function saveSession(token, roomCode, pseudo) {
  try {
    const data = {
      token,
      roomCode: (roomCode || '').toUpperCase().trim(),
      pseudo: (pseudo || '').trim(),
      timestamp: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Impossible de sauvegarder la session:', err);
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.warn('Impossible de supprimer la session:', err);
  }
}

function getSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.token || !data.roomCode) {
      clearSession();
      return null;
    }
    // Vérifier la péremption (30 minutes max)
    if (Date.now() - data.timestamp > SESSION_TTL_MS) {
      clearSession();
      return null;
    }
    return data;
  } catch (err) {
    clearSession();
    return null;
  }
}

function tryRestoreSession() {
  const session = getSavedSession();
  if (session && session.token && session.roomCode) {
    socket.emit('restore-session', {
      token: session.token,
      roomCode: session.roomCode,
    });
  }
}

// =================================================================
// VARIABLES D'ÉTAT
// =================================================================
let currentScreen = 'home';
let myPseudo = '';
let myRoomCode = '';
let myToken = '';
let isHost = false;
let isCurrentPlayer = false;
let selectedRounds = 5;
let currentRoundNumber = 1;
let currentTotalRounds = 5;

// =================================================================
// RÉFÉRENCES DOM
// =================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Écran d'accueil
const inputPseudo = $('#input-pseudo');
const inputRoomCode = $('#input-room-code');
const btnCreateRoom = $('#btn-create-room');
const btnJoinRoom = $('#btn-join-room');
const inputRounds = $('#input-rounds');
const btnRoundsMinus = $('#btn-rounds-minus');
const btnRoundsPlus = $('#btn-rounds-plus');
const presetButtons = $$('.btn-preset');

// Lobby
const roomCodeDisplay = $('#room-code-display');
const btnCopyCode = $('#btn-copy-code');
const playerCountText = $('#player-count-text');
const playerList = $('#player-list');
const btnStartGame = $('#btn-start-game');
const btnLeaveLobby = $('#btn-leave-lobby');
const lobbyRoundsDisplay = $('#lobby-rounds-display');
const lobbyRoundsControls = $('#lobby-rounds-controls');
const btnLobbyRoundsMinus = $('#btn-lobby-rounds-minus');
const btnLobbyRoundsPlus = $('#btn-lobby-rounds-plus');

// Choix du sujet
const topicCards = $('#topic-cards');
const formCustomTopic = $('#form-custom-topic');
const inputCustomTopic = $('#input-custom-topic');
const btnCustomTopic = $('#btn-custom-topic');

// Attente du sujet
const waitingTopicPseudo = $('#waiting-topic-pseudo');

// Remplir le Top 5
const fillTopicDisplay = $('#fill-topic-display');
const formTop5 = $('#form-top5');
const btnSubmitTop5 = $('#btn-submit-top5');

// Attente du Top 5
const waitingTop5Pseudo = $('#waiting-top5-pseudo');
const waitingTop5Topic = $('#waiting-top5-topic');

// Deviner le Top 5
const guessPseudo = $('#guess-pseudo');
const guessTopicDisplay = $('#guess-topic-display');
const guessContainer = $('#guess-container');
const btnSubmitGuess = $('#btn-submit-guess');

// Attente des devinettes
const guessesCount = $('#guesses-count');
const guessesTotal = $('#guesses-total');

// Résultats de la manche
const resultsTopic = $('#results-topic');
const correctOrderList = $('#correct-order');
const playerResults = $('#player-results');
const leaderboard = $('#leaderboard');
const btnNextRound = $('#btn-next-round');
const btnQuitResults = $('#btn-quit-results');

// Fin de partie
const podium = $('#podium');
const finalLeaderboard = $('#final-leaderboard');
const btnPlayAgain = $('#btn-play-again');
const btnQuit = $('#btn-quit');

// Toast
const toastEl = $('#toast');

// =================================================================
// INITIALISATION & RESTAURATION
// =================================================================
socket.on('connect', () => {
  tryRestoreSession();
});

// =================================================================
// FONCTIONS UTILITAIRES
// =================================================================

function showScreen(screenId) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  const target = $(`#screen-${screenId}`);
  if (target) {
    target.classList.add('active');
    currentScreen = screenId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

let toastTimeout = null;
function showToast(message, duration = 2500) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 80%)`;
}

function getInitials(pseudo) {
  if (!pseudo) return '??';
  return pseudo.substring(0, 2).toUpperCase();
}

function validatePseudo() {
  const value = inputPseudo.value.trim();
  if (!value) {
    showToast('Entre ton pseudo pour jouer');
    inputPseudo.focus();
    return false;
  }
  if (value.length > 20) {
    showToast('Pseudo trop long (20 caractères max)');
    return false;
  }
  return true;
}

function disableTemporarily(btn, ms = 1500) {
  btn.disabled = true;
  setTimeout(() => {
    btn.disabled = false;
  }, ms);
}

function setRounds(value) {
  let val = parseInt(value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 30) val = 30;
  selectedRounds = val;
  currentTotalRounds = val;
  if (inputRounds) inputRounds.value = val;
  presetButtons.forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === val);
  });
}

function updateRoundDisplays(current, total) {
  const roundCurrent = current || currentRoundNumber;
  const roundTotal = total || currentTotalRounds;
  $$('.round-badge-text').forEach((el) => {
    el.textContent = `Tour ${roundCurrent} / ${roundTotal}`;
  });
}

function updateLobbyRoundsDisplay() {
  if (lobbyRoundsDisplay) {
    lobbyRoundsDisplay.textContent = `${currentTotalRounds} tour${currentTotalRounds > 1 ? 's' : ''}`;
  }
  if (lobbyRoundsControls) {
    lobbyRoundsControls.style.display = isHost ? 'flex' : 'none';
  }
}

// Initialisation des boutons de sélection de tours
if (btnRoundsMinus) {
  btnRoundsMinus.addEventListener('click', () => setRounds(selectedRounds - 1));
}
if (btnRoundsPlus) {
  btnRoundsPlus.addEventListener('click', () => setRounds(selectedRounds + 1));
}
if (inputRounds) {
  inputRounds.addEventListener('input', () => setRounds(inputRounds.value));
  inputRounds.addEventListener('change', () => setRounds(inputRounds.value));
}
presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => setRounds(btn.dataset.rounds));
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — ACCUEIL
// =================================================================

btnCreateRoom.addEventListener('click', () => {
  if (!validatePseudo()) return;
  myPseudo = inputPseudo.value.trim();
  disableTemporarily(btnCreateRoom);
  socket.emit('create-room', { pseudo: myPseudo, totalRounds: selectedRounds });
});

btnJoinRoom.addEventListener('click', () => {
  if (!validatePseudo()) return;
  const code = inputRoomCode.value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showToast('Le code doit contenir 6 caractères');
    inputRoomCode.focus();
    return;
  }
  myPseudo = inputPseudo.value.trim();
  disableTemporarily(btnJoinRoom);
  socket.emit('join-room', { pseudo: myPseudo, roomCode: code });
});

inputRoomCode.addEventListener('input', () => {
  inputRoomCode.value = inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — LOBBY
// =================================================================

function copyRoomCode() {
  if (!myRoomCode) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(myRoomCode)
      .then(() => showToast('Code copié dans le presse-papier'))
      .catch(() => fallbackCopy(myRoomCode));
  } else {
    fallbackCopy(myRoomCode);
  }
}

function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast('Code copié dans le presse-papier');
  } catch (err) {
    showToast('Impossible de copier le code');
  }
  document.body.removeChild(textArea);
}

btnCopyCode.addEventListener('click', copyRoomCode);
roomCodeDisplay.addEventListener('click', copyRoomCode);

if (btnLobbyRoundsMinus) {
  btnLobbyRoundsMinus.addEventListener('click', () => {
    if (!isHost) return;
    if (currentTotalRounds > 1) {
      socket.emit('update-rounds', { totalRounds: currentTotalRounds - 1 });
    }
  });
}

if (btnLobbyRoundsPlus) {
  btnLobbyRoundsPlus.addEventListener('click', () => {
    if (!isHost) return;
    if (currentTotalRounds < 30) {
      socket.emit('update-rounds', { totalRounds: currentTotalRounds + 1 });
    }
  });
}

btnStartGame.addEventListener('click', () => {
  disableTemporarily(btnStartGame, 3000);
  socket.emit('start-game', { totalRounds: currentTotalRounds });
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — CHOIX DU SUJET
// =================================================================

if (formCustomTopic) {
  formCustomTopic.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputCustomTopic.value.trim();
    if (!text) {
      showToast('Écris une phrase pour ton Top 5');
      inputCustomTopic.focus();
      return;
    }
    if (text.length < 3) {
      showToast('Le sujet est trop court');
      return;
    }
    // Désactiver les options après choix
    topicCards.querySelectorAll('.topic-card').forEach((c) => {
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.5';
    });
    btnCustomTopic.disabled = true;
    socket.emit('select-topic', { topicId: null, topic: text });
  });
}

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — REMPLIR LE TOP 5
// =================================================================

formTop5.addEventListener('submit', (e) => {
  e.preventDefault();
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const val = $(`#top5-${i}`).value.trim();
    if (!val) {
      showToast(`Remplis la position n°${i}`);
      $(`#top5-${i}`).focus();
      return;
    }
    items.push(val);
  }
  btnSubmitTop5.disabled = true;
  socket.emit('submit-top5', { items });
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — DEVINER LE TOP 5
// =================================================================

btnSubmitGuess.addEventListener('click', () => {
  const dragItems = guessContainer.querySelectorAll('.drag-item');
  const guessedOrder = Array.from(dragItems).map((el) => el.dataset.value);

  if (guessedOrder.length !== 5) {
    showToast('Impossible de valider');
    return;
  }

  btnSubmitGuess.disabled = true;
  btnSubmitGuess.textContent = 'Ordre envoyé (en attente)';
  socket.emit('submit-guess', { guessedOrder });
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — RÉSULTATS / FIN
// =================================================================

function quitGame(showConfirm = false) {
  if (showConfirm && currentScreen !== 'home' && currentScreen !== 'lobby' && currentScreen !== 'game-over') {
    if (!confirm('Veux-tu vraiment quitter la partie en cours ?')) {
      return;
    }
  }

  socket.emit('leave-room');
  clearSession();

  myPseudo = '';
  myRoomCode = '';
  myToken = '';
  isHost = false;
  isCurrentPlayer = false;

  if (inputRoomCode) inputRoomCode.value = '';
  showToast('Tu as quitté la partie');
  showScreen('home');
}

btnNextRound.addEventListener('click', () => {
  disableTemporarily(btnNextRound, 3000);
  socket.emit('next-round');
});

if (btnQuitResults) {
  btnQuitResults.addEventListener('click', () => quitGame(true));
}

if (btnLeaveLobby) {
  btnLeaveLobby.addEventListener('click', () => quitGame(false));
}

btnPlayAgain.addEventListener('click', () => {
  disableTemporarily(btnPlayAgain, 2000);
  socket.emit('play-again');
});

btnQuit.addEventListener('click', () => {
  quitGame(false);
});

// Bouton 'X' (fermer) de chaque fenêtre
$$('.btn-close').forEach((btn) => {
  btn.setAttribute('title', 'Quitter');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentScreen !== 'home') {
      quitGame(currentScreen !== 'lobby' && currentScreen !== 'game-over');
    }
  });
});

// =================================================================
// ÉVÉNEMENTS SOCKET.IO — RÉCEPTION
// =================================================================

// --- Salle créée ---
socket.on('room-created', (data) => {
  myRoomCode = data.roomCode;
  myToken = data.token;
  isHost = true;
  if (data.totalRounds) {
    currentTotalRounds = data.totalRounds;
    selectedRounds = data.totalRounds;
  }
  updateLobbyRoundsDisplay();
  saveSession(myToken, myRoomCode, myPseudo);
  roomCodeDisplay.textContent = myRoomCode;
  btnStartGame.style.display = 'block';
  btnStartGame.disabled = true;
  btnStartGame.textContent = 'En attente de joueurs (min 2)...';
  showScreen('lobby');
});

// --- Salle rejointe ---
socket.on('room-joined', (data) => {
  myRoomCode = data.roomCode;
  myToken = data.token;
  isHost = false;
  btnStartGame.style.display = 'none';
  updateLobbyRoundsDisplay();
  saveSession(myToken, myRoomCode, myPseudo);
  roomCodeDisplay.textContent = myRoomCode;
  showScreen('lobby');
});

// --- Session restaurée après réouverture de page ---
socket.on('session-restored', (data) => {
  myRoomCode = data.roomCode;
  myToken = data.token;
  myPseudo = data.pseudo;
  isHost = (data.isHost === true || (myToken && data.hostToken && myToken === data.hostToken));
  isCurrentPlayer = data.isCurrentPlayer;
  saveSession(myToken, myRoomCode, myPseudo);

  if (data.currentRound !== undefined && data.currentRound !== null) {
    currentRoundNumber = data.currentRound;
  }
  if (data.totalRounds) {
    currentTotalRounds = data.totalRounds;
    selectedRounds = data.totalRounds;
  }
  updateRoundDisplays(currentRoundNumber, currentTotalRounds);
  updateLobbyRoundsDisplay();

  roomCodeDisplay.textContent = myRoomCode;
  showToast('Partie retrouvée et restaurée');

  // Mettre à jour l'écran selon l'état actuel de la partie
  switch (data.state) {
    case 'lobby':
      if (isHost) {
        btnStartGame.style.display = 'block';
        const canStart = (data.players && data.players.length >= 2);
        btnStartGame.disabled = !canStart;
        btnStartGame.textContent = canStart ? 'Lancer la partie' : 'En attente de joueurs (min 2)...';
      } else {
        btnStartGame.style.display = 'none';
      }
      showScreen('lobby');
      break;

    case 'choosing-topic':
      if (data.isCurrentPlayer && data.topics) {
        renderTopicCards(data.topics);
        showScreen('choosing-topic');
      } else {
        waitingTopicPseudo.textContent = data.currentPlayerPseudo || 'Un joueur';
        showScreen('waiting-topic');
      }
      break;

    case 'filling-top5':
      if (data.isCurrentPlayer) {
        fillTopicDisplay.textContent = data.currentTopic || 'Sujet';
        btnSubmitTop5.disabled = false;
        showScreen('fill-top5');
      } else {
        waitingTop5Pseudo.textContent = data.currentPlayerPseudo || 'Le joueur';
        waitingTop5Topic.textContent = data.currentTopic || '';
        showScreen('waiting-top5');
      }
      break;

    case 'guessing':
      if (data.isCurrentPlayer) {
        guessesCount.textContent = data.guessesCount || 0;
        guessesTotal.textContent = data.guessesTotal || 0;
        showScreen('waiting-guesses');
      } else {
        guessPseudo.textContent = data.currentPlayerPseudo || '???';
        guessTopicDisplay.textContent = data.currentTopic || '';
        renderDragItems(data.shuffledItems || []);
        if (data.alreadyGuessed) {
          btnSubmitGuess.disabled = true;
          btnSubmitGuess.textContent = 'Ordre envoyé (en attente)';
        } else {
          btnSubmitGuess.disabled = false;
          btnSubmitGuess.textContent = "Valider l'ordre";
        }
        showScreen('guess-top5');
      }
      break;

    case 'round-results':
      if (data.lastResults) {
        displayRoundResults(data.lastResults);
      }
      break;

    case 'game-over':
      if (data.finalScores) {
        displayGameOver(data.finalScores);
      }
      break;
  }
});

socket.on('restore-session-failed', (data) => {
  clearSession();
  if (data && data.message) {
    showToast(data.message);
  }
  showScreen('home');
});

// --- Mise à jour du lobby ---
socket.on('lobby-update', (data) => {
  const { players, hostId, hostToken, roomCode, totalRounds } = data;

  if (roomCode) {
    myRoomCode = roomCode;
    roomCodeDisplay.textContent = myRoomCode;
  }

  if (totalRounds !== undefined && totalRounds !== null) {
    currentTotalRounds = totalRounds;
    selectedRounds = totalRounds;
    if (inputRounds) inputRounds.value = totalRounds;
    presetButtons.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === totalRounds);
    });
  }

  // Vérification infaillible du statut d'hôte (par token persistant ou par hostId)
  if (myToken && hostToken) {
    isHost = (myToken === hostToken);
  } else if (hostId) {
    isHost = (socket.id === hostId);
  }

  updateLobbyRoundsDisplay();

  if (currentScreen === 'home' || currentScreen === 'game-over') {
    showScreen('lobby');
  }

  // Liste des joueurs
  playerList.innerHTML = '';
  players.forEach((player) => {
    const li = document.createElement('li');

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.style.backgroundColor = stringToColor(player.pseudo);
    avatar.textContent = getInitials(player.pseudo);

    const isMe = (myToken && player.token) ? (myToken === player.token) : (player.id === socket.id);
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.pseudo + (isMe ? ' (toi)' : '');

    li.appendChild(avatar);
    li.appendChild(name);

    const isPlayerHost = (hostToken && player.token) ? (player.token === hostToken) : (player.id === hostId);
    if (isPlayerHost) {
      const badge = document.createElement('span');
      badge.className = 'player-host-badge';
      badge.textContent = 'HÔTE';
      badge.title = 'Hôte de la partie';
      li.appendChild(badge);
    }

    playerList.appendChild(li);
  });

  playerCountText.textContent = `${players.length}/10 joueurs`;

  if (isHost) {
    btnStartGame.style.display = 'block';
    const canStart = players.length >= 2;
    btnStartGame.disabled = !canStart;
    if (!canStart) {
      btnStartGame.title = 'Minimum 2 joueurs requis pour lancer';
      btnStartGame.textContent = 'En attente de joueurs (min 2)...';
    } else {
      btnStartGame.title = 'Lancer la partie';
      btnStartGame.textContent = 'Lancer la partie';
    }
  } else {
    btnStartGame.style.display = 'none';
  }
});

// --- Nouveau tour ---
socket.on('new-round', (data) => {
  const { currentPlayerId, currentPlayerPseudo, topics, roundNumber, totalRounds } = data;
  if (roundNumber !== undefined) currentRoundNumber = roundNumber;
  if (totalRounds !== undefined) currentTotalRounds = totalRounds;
  updateRoundDisplays(currentRoundNumber, currentTotalRounds);

  isCurrentPlayer = (currentPlayerId === socket.id);

  if (isCurrentPlayer) {
    renderTopicCards(topics);
    showScreen('choosing-topic');
  } else {
    waitingTopicPseudo.textContent = currentPlayerPseudo || 'Un joueur';
    showScreen('waiting-topic');
  }
});

// --- Le sujet a été choisi ---
socket.on('fill-top5', (data) => {
  const topicLabel = typeof data === 'object' ? data.topic : data;
  fillTopicDisplay.textContent = topicLabel;
  for (let i = 1; i <= 5; i++) {
    const input = $(`#top5-${i}`);
    input.value = '';
  }
  btnSubmitTop5.disabled = false;
  showScreen('fill-top5');
  $('#top5-1').focus();
});

socket.on('waiting-for-top5', (data) => {
  waitingTop5Pseudo.textContent = data.currentPlayerPseudo || 'Le joueur';
  waitingTop5Topic.textContent = data.topic || '';
  showScreen('waiting-top5');
});

// --- Phase de devinettes ---
socket.on('guess-top5', (data) => {
  const pseudo = data.currentPlayerPseudo || data.currentPlayer || '???';
  const topic = data.topic || '';
  const items = data.shuffledItems || data.shuffledAnswers || [];

  guessPseudo.textContent = pseudo;
  guessTopicDisplay.textContent = topic;
  renderDragItems(items);

  btnSubmitGuess.disabled = false;
  btnSubmitGuess.textContent = "Valider l'ordre";
  showScreen('guess-top5');
});

// --- Attente des devinettes pour le joueur actif ---
socket.on('waiting-guesses', (data) => {
  guessesCount.textContent = data.count || 0;
  guessesTotal.textContent = data.totalGuessers || 0;
  showScreen('waiting-guesses');
});

// --- Mise à jour du compteur de devinettes ---
socket.on('guesses-update', (data) => {
  guessesCount.textContent = data.count;
  if (data.total !== undefined) {
    guessesTotal.textContent = data.total;
  }
});

// --- Résultats de la manche ---
function displayRoundResults(data) {
  const { topic, correctOrder, results, scores } = data;
  resultsTopic.textContent = topic;

  correctOrderList.innerHTML = '';
  correctOrder.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    correctOrderList.appendChild(li);
  });

  playerResults.innerHTML = '';
  results.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const roundScore = r.roundScore !== undefined ? r.roundScore : r.score;
    const header = document.createElement('div');
    header.className = 'result-header';
    header.innerHTML = `
      <span class="result-player-name">${r.pseudo}</span>
      <span class="result-score ${roundScore === 6 ? 'perfect' : ''}">+${roundScore} pts ${roundScore === 6 ? '(SCORE PARFAIT)' : ''}</span>
    `;
    card.appendChild(header);

    const items = document.createElement('div');
    items.className = 'result-items';
    const guessed = r.guessedOrder || r.guess || [];
    guessed.forEach((guess, idx) => {
      const isCorrect = guess === correctOrder[idx];
      const item = document.createElement('div');
      item.className = `result-item ${isCorrect ? 'correct' : 'wrong'}`;
      item.innerHTML = `
        <span>${idx + 1}. ${guess}</span>
        <span class="result-status-tag">${isCorrect ? '[CORRECT]' : '[FAUX]'}</span>
      `;
      items.appendChild(item);
    });
    card.appendChild(items);

    playerResults.appendChild(card);
  });

  renderLeaderboard(leaderboard, scores);

  updateRoundDisplays(currentRoundNumber, currentTotalRounds);
  btnNextRound.style.display = isHost ? 'block' : 'none';
  btnNextRound.disabled = false;
  if (currentRoundNumber >= currentTotalRounds) {
    btnNextRound.textContent = 'Voir le classement final';
  } else {
    btnNextRound.textContent = 'Tour suivant';
  }
  showScreen('round-results');
}

socket.on('round-results', (data) => {
  displayRoundResults(data);
});

// --- Fin de partie ---
function displayGameOver(scores) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  renderPodium(sorted);
  renderLeaderboard(finalLeaderboard, scores);
  btnPlayAgain.style.display = 'block';
  btnPlayAgain.disabled = false;
  btnQuit.style.display = 'block';
  showScreen('game-over');
}

socket.on('game-over', (data) => {
  const scores = (data && data.scores) || data || [];
  displayGameOver(scores);
});

// --- Salle relancée (Rejouer) ---
socket.on('room-restarted', (data) => {
  showToast(`${data.restartedBy || 'Un joueur'} a relancé la partie !`);
  showScreen('lobby');
});

// --- Erreur ---
socket.on('error', (data) => {
  const msg = typeof data === 'string' ? data : (data && data.message);
  showToast(msg || 'Une erreur est survenue');
  btnCreateRoom.disabled = false;
  btnJoinRoom.disabled = false;
  btnStartGame.disabled = false;
  btnSubmitTop5.disabled = false;
  btnSubmitGuess.disabled = false;
});

// =================================================================
// FONCTIONS DE RENDU
// =================================================================

function renderTopicCards(topics) {
  topicCards.innerHTML = '';
  if (inputCustomTopic) inputCustomTopic.value = '';
  if (btnCustomTopic) btnCustomTopic.disabled = false;

  topics.forEach((topic) => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    const label = typeof topic === 'object' ? topic.label : topic;
    const id = typeof topic === 'object' ? topic.id : null;

    card.textContent = label;
    card.addEventListener('click', () => {
      topicCards.querySelectorAll('.topic-card').forEach((c) => {
        c.style.pointerEvents = 'none';
        c.style.opacity = '0.5';
      });
      if (btnCustomTopic) btnCustomTopic.disabled = true;
      card.style.opacity = '1';
      card.style.backgroundColor = 'var(--accent-pink)';
      socket.emit('select-topic', { topicId: id, topic: label });
    });
    topicCards.appendChild(card);
  });
}

function renderDragItems(items) {
  guessContainer.innerHTML = '';
  items.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'drag-item';
    el.setAttribute('draggable', 'true');
    el.dataset.value = item;
    el.innerHTML = `
      <span class="drag-rank">${idx + 1}</span>
      <span class="drag-label">${item}</span>
      <span class="drag-handle">:::</span>
    `;
    guessContainer.appendChild(el);
  });
  initDragAndDrop();
}

function updateDragRanks() {
  guessContainer.querySelectorAll('.drag-item').forEach((el, idx) => {
    const rankEl = el.querySelector('.drag-rank');
    if (rankEl) rankEl.textContent = idx + 1;
  });
}

function renderLeaderboard(tableEl, scores) {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const tbody = tableEl.querySelector('tbody');
  tbody.innerHTML = '';
  sorted.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td>${entry.pseudo}</td>
      <td><strong>${entry.score} PTS</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPodium(sorted) {
  podium.innerHTML = '';
  const placements = [
    { index: 1, cssClass: 'second', label: '2' },
    { index: 0, cssClass: 'first', label: '1' },
    { index: 2, cssClass: 'third', label: '3' },
  ];

  placements.forEach(({ index, cssClass, label }) => {
    if (!sorted[index]) return;
    const player = sorted[index];
    const place = document.createElement('div');
    place.className = `podium-place ${cssClass}`;
    place.innerHTML = `
      <div class="podium-name">${player.pseudo}</div>
      <div class="podium-score">${player.score} PTS</div>
      <div class="podium-bar">${label}</div>
    `;
    podium.appendChild(place);
  });
}

// =================================================================
// DRAG & DROP — Souris + Tactile
// =================================================================

let draggedElement = null;

function initDragAndDrop() {
  const items = guessContainer.querySelectorAll('.drag-item');

  items.forEach((item) => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);

    item.addEventListener('touchstart', handleTouchStart, { passive: false });
    item.addEventListener('touchmove', handleTouchMove, { passive: false });
    item.addEventListener('touchend', handleTouchEnd);
  });
}

function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
}

function handleDragEnd() {
  this.classList.remove('dragging');
  draggedElement = null;
  guessContainer.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  updateDragRanks();
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  if (this !== draggedElement) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave() {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  if (!draggedElement || draggedElement === this) return;

  const allItems = [...guessContainer.querySelectorAll('.drag-item')];
  const draggedIdx = allItems.indexOf(draggedElement);
  const droppedIdx = allItems.indexOf(this);

  if (draggedIdx < droppedIdx) {
    guessContainer.insertBefore(draggedElement, this.nextSibling);
  } else {
    guessContainer.insertBefore(draggedElement, this);
  }
  updateDragRanks();
}

let touchClone = null;

function handleTouchStart(e) {
  draggedElement = this;
  const touch = e.touches[0];

  touchClone = this.cloneNode(true);
  touchClone.style.position = 'fixed';
  touchClone.style.zIndex = '1000';
  touchClone.style.pointerEvents = 'none';
  touchClone.style.opacity = '0.9';
  touchClone.style.width = `${this.offsetWidth}px`;
  touchClone.style.left = `${this.getBoundingClientRect().left}px`;
  touchClone.style.top = `${touch.clientY - this.offsetHeight / 2}px`;
  document.body.appendChild(touchClone);

  this.classList.add('dragging');
}

function handleTouchMove(e) {
  e.preventDefault();
  if (!draggedElement) return;

  const touch = e.touches[0];
  if (touchClone) {
    touchClone.style.top = `${touch.clientY - draggedElement.offsetHeight / 2}px`;
  }

  const afterElement = getDragAfterElement(guessContainer, touch.clientY);
  guessContainer.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

  if (afterElement && afterElement !== draggedElement) {
    afterElement.classList.add('drag-over');
  }
}

function handleTouchEnd(e) {
  if (!draggedElement) return;

  if (touchClone) {
    touchClone.remove();
    touchClone = null;
  }

  const lastTouch = e.changedTouches ? e.changedTouches[0] : null;
  if (lastTouch) {
    const afterElement = getDragAfterElement(guessContainer, lastTouch.clientY);
    if (afterElement) {
      guessContainer.insertBefore(draggedElement, afterElement);
    } else {
      guessContainer.appendChild(draggedElement);
    }
  }

  draggedElement.classList.remove('dragging');
  guessContainer.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  updateDragRanks();
  draggedElement = null;
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.drag-item:not(.dragging)')];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}
