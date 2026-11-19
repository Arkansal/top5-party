const http = require("http");
const { io: ioClient } = require("socket.io-client");

// We'll run server in-process on an ephemeral port
process.env.PORT = "0"; // random available port
const express = require("express");
const socketIo = require("socket.io");
const crypto = require("crypto");
const topics = require("./topics.json");

// Start server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Require server logic or let's test running server.js directly
let testPassed = true;

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`Test server running on port ${port}`);

  server.close(async () => {
    // Actually let's spawn or fork server.js on port 3456 to test real server.js
    const { spawn } = require("child_process");
    const testPort = 3456;
    const srv = spawn("node", ["server.js"], {
      env: { ...process.env, PORT: testPort.toString() },
      stdio: "pipe",
    });

    srv.stdout.on("data", (d) => console.log(`[SERVER]: ${d.toString().trim()}`));
    srv.stderr.on("data", (d) => console.error(`[SERVER ERR]: ${d.toString().trim()}`));

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      console.log("\n=== TEST 1: Création avec 3 tours & mise à jour à 4 tours dans le lobby ===");
      const hostSocket = ioClient(`http://localhost:${testPort}`);
      const player2Socket = ioClient(`http://localhost:${testPort}`);

      await new Promise((resolve) => hostSocket.on("connect", resolve));
      await new Promise((resolve) => player2Socket.on("connect", resolve));

      let roomCode = null;
      let hostToken = null;

      // Host creates room with 3 rounds
      hostSocket.emit("create-room", { pseudo: "HostPlayer", totalRounds: 3 });

      const roomCreatedData = await new Promise((resolve) => {
        hostSocket.on("room-created", resolve);
      });
      roomCode = roomCreatedData.roomCode;
      hostToken = roomCreatedData.token;
      console.log(`Room created: ${roomCode}, initial totalRounds: ${roomCreatedData.totalRounds}`);
      if (roomCreatedData.totalRounds !== 3) {
        throw new Error(`Expected totalRounds to be 3, got ${roomCreatedData.totalRounds}`);
      }

      // Player 2 joins
      player2Socket.emit("join-room", { pseudo: "GuestPlayer", roomCode: roomCode });
      const joinData = await new Promise((resolve) => player2Socket.on("room-joined", resolve));
      console.log(`Guest joined room: ${joinData.roomCode}`);

      // Host updates rounds to 2
      hostSocket.emit("update-rounds", { totalRounds: 2 });
      const lobbyUpdate = await new Promise((resolve) => {
        player2Socket.on("lobby-update", (data) => {
          if (data.totalRounds === 2) resolve(data);
        });
      });
      console.log(`Lobby updated to totalRounds: ${lobbyUpdate.totalRounds}`);

      // Host starts game
      hostSocket.emit("start-game", { totalRounds: 2 });

      // Round 1
      console.log("\n--- Starting Round 1 ---");
      const round1Data = await new Promise((resolve) => {
        hostSocket.on("new-round", resolve);
      });
      console.log(`Round 1 active player: ${round1Data.currentPlayerPseudo}, round: ${round1Data.roundNumber}/${round1Data.totalRounds}`);
      if (round1Data.roundNumber !== 1 || round1Data.totalRounds !== 2) {
        throw new Error(`Round 1 numbers wrong: ${round1Data.roundNumber}/${round1Data.totalRounds}`);
      }

      // Active player selects topic
      const activeSocket1 = round1Data.currentPlayerPseudo === "HostPlayer" ? hostSocket : player2Socket;
      const guesserSocket1 = activeSocket1 === hostSocket ? player2Socket : hostSocket;

      activeSocket1.emit("select-topic", { topicId: null, topic: "Top 5 fruits" });
      await new Promise((resolve) => activeSocket1.on("fill-top5", resolve));

      // Active player submits top 5
      activeSocket1.emit("submit-top5", { items: ["Pomme", "Banane", "Fraise", "Mangue", "Orange"] });
      const guessData1 = await new Promise((resolve) => guesserSocket1.on("guess-top5", resolve));

      // Guesser submits guess
      guesserSocket1.emit("submit-guess", { guessedOrder: ["Pomme", "Banane", "Fraise", "Mangue", "Orange"] });
      const results1 = await new Promise((resolve) => hostSocket.on("round-results", resolve));
      console.log(`Round 1 finished, results:`, results1.results.map(r => `${r.pseudo}: +${r.score}pts`));

      // Host advances to Round 2
      console.log("\n--- Advancing to Round 2 ---");
      hostSocket.emit("next-round");

      const round2Data = await new Promise((resolve) => {
        hostSocket.once("new-round", resolve);
      });
      console.log(`Round 2 active player: ${round2Data.currentPlayerPseudo}, round: ${round2Data.roundNumber}/${round2Data.totalRounds}`);
      if (round2Data.roundNumber !== 2 || round2Data.totalRounds !== 2) {
        throw new Error(`Round 2 numbers wrong: ${round2Data.roundNumber}/${round2Data.totalRounds}`);
      }

      // The other player should be active in round 2!
      if (round2Data.currentPlayerPseudo === round1Data.currentPlayerPseudo) {
        throw new Error(`Expected different player in round 2! Both were ${round2Data.currentPlayerPseudo}`);
      }

      const activeSocket2 = round2Data.currentPlayerPseudo === "HostPlayer" ? hostSocket : player2Socket;
      const guesserSocket2 = activeSocket2 === hostSocket ? player2Socket : hostSocket;

      activeSocket2.emit("select-topic", { topicId: null, topic: "Top 5 légumes" });
      await new Promise((resolve) => activeSocket2.on("fill-top5", resolve));

      activeSocket2.emit("submit-top5", { items: ["Carotte", "Tomate", "Salade", "Poireau", "Courgette"] });
      await new Promise((resolve) => guesserSocket2.on("guess-top5", resolve));

      guesserSocket2.emit("submit-guess", { guessedOrder: ["Carotte", "Tomate", "Salade", "Poireau", "Courgette"] });
      await new Promise((resolve) => hostSocket.on("round-results", resolve));
      console.log(`Round 2 finished.`);

      // Advancing past round 2 should trigger game-over!
      console.log("\n--- Advancing past final round ---");
      hostSocket.emit("next-round");

      const gameOverData = await new Promise((resolve) => {
        hostSocket.on("game-over", resolve);
      });
      console.log("Game over received! Scores:", gameOverData.scores);

      hostSocket.disconnect();
      player2Socket.disconnect();

      console.log("\n✅ TEST 1 PASSED SUCCESSFULLY!");

      console.log("\n=== TEST 2: 3 tours avec 2 joueurs (test de la réinitialisation de rotation) ===");
      const host2 = ioClient(`http://localhost:${testPort}`);
      const guest2 = ioClient(`http://localhost:${testPort}`);
      await new Promise((r) => host2.on("connect", r));
      await new Promise((r) => guest2.on("connect", r));

      host2.emit("create-room", { pseudo: "Alice", totalRounds: 3 });
      const room2 = await new Promise((r) => host2.on("room-created", r));
      guest2.emit("join-room", { pseudo: "Bob", roomCode: room2.roomCode });
      await new Promise((r) => guest2.on("room-joined", r));

      host2.emit("start-game", { totalRounds: 3 });

      // Round 1
      const r1 = await new Promise((r) => host2.on("new-round", r));
      console.log(`T2 - Round 1/3: Active = ${r1.currentPlayerPseudo}`);
      const s1 = r1.currentPlayerPseudo === "Alice" ? host2 : guest2;
      const g1 = s1 === host2 ? guest2 : host2;
      s1.emit("select-topic", { topicId: null, topic: "Sujet 1" });
      await new Promise((r) => s1.on("fill-top5", r));
      s1.emit("submit-top5", { items: ["1","2","3","4","5"] });
      await new Promise((r) => g1.on("guess-top5", r));
      g1.emit("submit-guess", { guessedOrder: ["1","2","3","4","5"] });
      await new Promise((r) => host2.on("round-results", r));

      // Round 2
      host2.emit("next-round");
      const r2 = await new Promise((r) => host2.once("new-round", r));
      console.log(`T2 - Round 2/3: Active = ${r2.currentPlayerPseudo}`);
      if (r2.currentPlayerPseudo === r1.currentPlayerPseudo) {
        throw new Error("T2: Expected different player for Round 2");
      }
      const s2 = r2.currentPlayerPseudo === "Alice" ? host2 : guest2;
      const g2 = s2 === host2 ? guest2 : host2;
      s2.emit("select-topic", { topicId: null, topic: "Sujet 2" });
      await new Promise((r) => s2.on("fill-top5", r));
      s2.emit("submit-top5", { items: ["1","2","3","4","5"] });
      await new Promise((r) => g2.on("guess-top5", r));
      g2.emit("submit-guess", { guessedOrder: ["1","2","3","4","5"] });
      await new Promise((r) => host2.on("round-results", r));

      // Round 3 (both have played, new cycle should start!)
      host2.emit("next-round");
      const r3 = await new Promise((r) => host2.once("new-round", r));
      console.log(`T2 - Round 3/3: Active = ${r3.currentPlayerPseudo}`);
      if (r3.roundNumber !== 3 || r3.totalRounds !== 3) {
        throw new Error(`T2: Round 3 numbers wrong: ${r3.roundNumber}/${r3.totalRounds}`);
      }
      // Since s2 just played, s1 should be picked for round 3 to avoid back-to-back turns!
      if (r3.currentPlayerPseudo === r2.currentPlayerPseudo) {
        throw new Error("T2: Expected rotation reset to pick the other player, avoiding consecutive turns");
      }
      const s3 = r3.currentPlayerPseudo === "Alice" ? host2 : guest2;
      const g3 = s3 === host2 ? guest2 : host2;
      s3.emit("select-topic", { topicId: null, topic: "Sujet 3" });
      await new Promise((r) => s3.on("fill-top5", r));
      s3.emit("submit-top5", { items: ["1","2","3","4","5"] });
      await new Promise((r) => g3.on("guess-top5", r));
      g3.emit("submit-guess", { guessedOrder: ["1","2","3","4","5"] });
      await new Promise((r) => host2.on("round-results", r));

      // Next round -> should end the game
      host2.emit("next-round");
      const gameOver2 = await new Promise((r) => host2.on("game-over", r));
      console.log("T2 - Game over received after 3 rounds!");

      host2.disconnect();
      guest2.disconnect();

      console.log("\n✅ ALL TESTS (INCLUDING ROTATION RESET) PASSED SUCCESSFULLY!");
    } catch (err) {
      console.error("\n❌ TEST FAILED:", err);
      testPassed = false;
    } finally {
      srv.kill();
      process.exit(testPassed ? 0 : 1);
    }
  });
});
