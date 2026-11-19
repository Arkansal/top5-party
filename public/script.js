/* =================================================================
   TOP 5 PARTY — Script client Socket.IO
   ================================================================= */

// --- Connexion au serveur Socket.IO ---
const socket = io();

// =================================================================
// VARIABLES D'ÉTAT
// =================================================================
let currentScreen = 'home';
let myPseudo = '';
let myRoomCode = '';
let isHost = false;
let isCurrentPlayer = false;

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

// Lobby
const roomCodeDisplay = $('#room-code-display');
const btnCopyCode = $('#btn-copy-code');
const playerCountText = $('#player-count-text');
const playerList = $('#player-list');
const btnStartGame = $('#btn-start-game');

// Choix du sujet
const topicCards = $('#topic-cards');

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

// Fin de partie
const podium = $('#podium');
const finalLeaderboard = $('#final-leaderboard');
const btnPlayAgain = $('#btn-play-again');
const btnQuit = $('#btn-quit');

// Toast
const toastEl = $('#toast');

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
  return `hsl(${hue}, 65%, 55%)`;
}

function getInitials(pseudo) {
  if (!pseudo) return '??';
  return pseudo.substring(0, 2).toUpperCase();
}

function validatePseudo() {
  const value = inputPseudo.value.trim();
  if (!value) {
    showToast('⚠️ Entre ton pseudo pour jouer !');
    inputPseudo.focus();
    return false;
  }
  if (value.length > 20) {
    showToast('⚠️ Pseudo trop long (20 caractères max)');
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

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — ACCUEIL
// =================================================================

btnCreateRoom.addEventListener('click', () => {
  if (!validatePseudo()) return;
  myPseudo = inputPseudo.value.trim();
  disableTemporarily(btnCreateRoom);
  socket.emit('create-room', { pseudo: myPseudo });
});

btnJoinRoom.addEventListener('click', () => {
  if (!validatePseudo()) return;
  const code = inputRoomCode.value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showToast('⚠️ Le code doit contenir 6 caractères');
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
      .then(() => showToast('✅ Code copié ! Partage-le à tes amis'))
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
    showToast('✅ Code copié !');
  } catch (err) {
    showToast('❌ Impossible de copier le code');
  }
  document.body.removeChild(textArea);
}

btnCopyCode.addEventListener('click', copyRoomCode);
roomCodeDisplay.addEventListener('click', copyRoomCode);

btnStartGame.addEventListener('click', () => {
  disableTemporarily(btnStartGame, 3000);
  socket.emit('start-game');
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — REMPLIR LE TOP 5
// =================================================================

formTop5.addEventListener('submit', (e) => {
  e.preventDefault();
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const val = $(`#top5-${i}`).value.trim();
    if (!val) {
      showToast(`⚠️ Remplis la position n°${i}`);
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
    showToast('⚠️ Impossible de valider');
    return;
  }

  btnSubmitGuess.disabled = true;
  btnSubmitGuess.textContent = 'Réponse envoyée ! En attente...';
  socket.emit('submit-guess', { guessedOrder });
});

// =================================================================
// GESTION DES ÉVÉNEMENTS UI — RÉSULTATS / FIN
// =================================================================

btnNextRound.addEventListener('click', () => {
  disableTemporarily(btnNextRound, 3000);
  socket.emit('next-round');
});

btnPlayAgain.addEventListener('click', () => {
  disableTemporarily(btnPlayAgain, 3000);
  socket.emit('play-again');
});

btnQuit.addEventListener('click', () => {
  window.location.reload();
});

// =================================================================
// ÉVÉNEMENTS SOCKET.IO — RÉCEPTION
// =================================================================

// --- Salle créée ---
socket.on('room-created', (data) => {
  myRoomCode = data.roomCode;
  isHost = true;
  roomCodeDisplay.textContent = myRoomCode;
  btnStartGame.style.display = 'block';
  showScreen('lobby');
});

// --- Salle rejointe ---
socket.on('room-joined', (data) => {
  myRoomCode = data.roomCode;
  roomCodeDisplay.textContent = myRoomCode;
  showScreen('lobby');
});

// --- Mise à jour du lobby ---
socket.on('lobby-update', (data) => {
  const { players, hostId, roomCode } = data;

  if (roomCode) {
    myRoomCode = roomCode;
    roomCodeDisplay.textContent = myRoomCode;
  }

  isHost = (socket.id === hostId);

  // Basculer vers l'écran lobby si nécessaire (ex: retour à l'accueil ou rejouer)
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

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.pseudo + (player.id === socket.id ? ' (toi)' : '');

    li.appendChild(avatar);
    li.appendChild(name);

    if (player.id === hostId) {
      const badge = document.createElement('span');
      badge.className = 'player-host-badge';
      badge.textContent = '👑';
      badge.title = 'Hôte de la partie';
      li.appendChild(badge);
    }

    playerList.appendChild(li);
  });

  playerCountText.textContent = `${players.length}/10 joueurs`;

  // Bouton lancer
  if (isHost) {
    btnStartGame.style.display = 'block';
    btnStartGame.disabled = players.length < 2;
    if (players.length < 2) {
      btnStartGame.title = 'Minimum 2 joueurs requis pour lancer';
    } else {
      btnStartGame.title = 'Lancer la partie';
    }
  } else {
    btnStartGame.style.display = 'none';
  }
});

// --- Nouveau tour ---
socket.on('new-round', (data) => {
  const { currentPlayerId, currentPlayerPseudo, topics, roundNumber, totalRounds } = data;
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
  btnSubmitGuess.textContent = 'Valider';
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
socket.on('round-results', (data) => {
  const { topic, correctOrder, results, scores } = data;
  resultsTopic.textContent = topic;

  // Ordre correct
  correctOrderList.innerHTML = '';
  correctOrder.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    correctOrderList.appendChild(li);
  });

  // Résultats détaillés
  playerResults.innerHTML = '';
  results.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const roundScore = r.roundScore !== undefined ? r.roundScore : r.score;
    const header = document.createElement('div');
    header.className = 'result-header';
    header.innerHTML = `
      <span class="result-player-name">${r.pseudo}</span>
      <span class="result-score ${roundScore === 6 ? 'perfect' : ''}">+${roundScore} pts ${roundScore === 6 ? '🔥 (Parfait !)' : ''}</span>
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
        <span class="result-icon">${isCorrect ? '✅' : '❌'}</span>
        <span>${idx + 1}. ${guess}</span>
      `;
      items.appendChild(item);
    });
    card.appendChild(items);

    playerResults.appendChild(card);
  });

  // Leaderboard provisoire
  renderLeaderboard(leaderboard, scores);

  // Bouton suivant (hôte)
  btnNextRound.style.display = isHost ? 'block' : 'none';
  btnNextRound.disabled = false;
  showScreen('round-results');
});

// --- Fin de partie ---
socket.on('game-over', (data) => {
  const scores = (data && data.scores) || data || [];
  const sorted = [...scores].sort((a, b) => b.score - a.score);

  renderPodium(sorted);
  renderLeaderboard(finalLeaderboard, scores);

  btnPlayAgain.style.display = isHost ? 'inline-flex' : 'none';
  btnPlayAgain.disabled = false;
  showScreen('game-over');
});

// --- Erreur ---
socket.on('error', (data) => {
  const msg = typeof data === 'string' ? data : (data && data.message);
  showToast(`❌ ${msg || 'Une erreur est survenue'}`);
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
  topics.forEach((topic) => {
    const card = document.createElement('div');
    card.className = 'topic-card';
    const label = typeof topic === 'object' ? topic.label : topic;
    const id = typeof topic === 'object' ? topic.id : null;

    card.textContent = label;
    card.addEventListener('click', () => {
      topicCards.querySelectorAll('.topic-card').forEach((c) => {
        c.style.pointerEvents = 'none';
        c.style.opacity = '0.4';
      });
      card.style.opacity = '1';
      card.style.borderColor = 'var(--success)';
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
      <span class="drag-handle">⠿</span>
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
    let rank = `${idx + 1}`;
    if (idx === 0) rank = '🥇';
    else if (idx === 1) rank = '🥈';
    else if (idx === 2) rank = '🥉';

    tr.innerHTML = `
      <td>${rank}</td>
      <td>${entry.pseudo}</td>
      <td><strong>${entry.score} pts</strong></td>
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
      <div class="podium-score">${player.score} pts</div>
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
    // Souris
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);

    // Tactile (mobile)
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

// Support mobile tactile
let touchClone = null;

function handleTouchStart(e) {
  draggedElement = this;
  const touch = e.touches[0];

  touchClone = this.cloneNode(true);
  touchClone.style.position = 'fixed';
  touchClone.style.zIndex = '1000';
  touchClone.style.pointerEvents = 'none';
  touchClone.style.opacity = '0.85';
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
