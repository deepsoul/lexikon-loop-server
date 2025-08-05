const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      'https://lexikon-loop.vercel.app',
      'https://lexikon-loop-git-main.vercel.app',
      'https://lexikon-loop-git-dev.vercel.app',
      'https://lexikon-loop-git-feature-*.vercel.app',
      'https://lexikon-loop-*.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:4173',
      'http://localhost:8080',
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Enable CORS
app.use(cors());

// Game rooms storage
const gameRooms = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 New connection:', socket.id);
  console.log('🌐 Origin:', socket.handshake.headers.origin);

  // Log all events for debugging
  socket.onAny((eventName, ...args) => {
    console.log(`📡 Event '${eventName}' from ${socket.id}:`, args);
  });

  // Join a game room
  socket.on('joinRoom', (data) => {
    const {roomId, playerName, isHost} = data;

    console.log(
      `👥 Player ${playerName} joining room ${roomId} as ${
        isHost ? 'host' : 'client'
      }`,
    );
    console.log('📊 Room data:', data);

    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!gameRooms.has(roomId)) {
      gameRooms.set(roomId, {
        host: null,
        players: [],
        gameState: {
          category: '',
          currentLetter: '-',
          currentPlayer: 0,
          rolling: false,
          resultText: 'Bereit zum Würfeln!',
          subResult: 'Klicke auf den Würfeln-Button',
          isJackpot: false,
        },
      });
    }

    const room = gameRooms.get(roomId);

    // Check if player already exists in room
    const existingPlayer = room.players.find((p) => p.name === playerName);
    let player;

    if (existingPlayer) {
      console.log(
        `👤 Player ${playerName} already exists in room ${roomId}, updating socket ID`,
      );
      existingPlayer.id = socket.id;
      player = existingPlayer;
    } else {
      // Add new player to room
      player = {
        id: socket.id,
        name: playerName,
        score: 0,
        isHost: isHost,
      };
      room.players.push(player);
      console.log(`👤 Added new player ${playerName} to room ${roomId}`);
    }

    if (isHost) {
      room.host = socket.id;
    }

    // Notify all players in the room
    io.to(roomId).emit('playerJoined', {
      player: player,
      allPlayers: room.players,
      gameState: room.gameState,
    });

    console.log(`Room ${roomId} now has ${room.players.length} players`);
  });

  // Handle dice roll
  socket.on('rollDice', (data) => {
    const {roomId} = data;
    const room = gameRooms.get(roomId);

    console.log('🎲 Dice roll requested for room:', roomId);

    if (room) {
      // Simulate dice roll result
      const categories = ['STADT', 'LAND', 'FLUSS', 'NAME', 'TIER', 'JACKPOT'];
      const result = Math.floor(Math.random() * categories.length);
      const category = categories[result];

      console.log('🎯 Dice result:', category);

      room.gameState = {
        category: category,
        currentLetter:
          category === 'JACKPOT'
            ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]
            : '-',
        currentPlayer: room.gameState.currentPlayer,
        rolling: true,
        resultText: category === 'JACKPOT' ? '🎰 JACKPOT 🎰' : category,
        subResult: getCategoryDescription(category),
        isJackpot: category === 'JACKPOT',
      };

      console.log('📡 Broadcasting dice roll to all players in room:', roomId);
      console.log(
        '📊 Room players:',
        room.players.map((p) => p.name),
      );
      console.log('🎯 Game state being sent:', room.gameState);
      // Broadcast to all players in the room
      io.to(roomId).emit('diceRolled', room.gameState);

      // Stop rolling after animation
      setTimeout(() => {
        room.gameState.rolling = false;
        console.log('🛑 Stopping dice roll animation');
        io.to(roomId).emit('diceStopped', room.gameState);
      }, 1500);
    } else {
      console.log('❌ Room not found:', roomId);
    }
  });

  // Handle adding new player
  socket.on('addPlayer', (data) => {
    const {roomId, playerName, playerId} = data;
    const room = gameRooms.get(roomId);

    console.log('👥 Adding player to room:', roomId, playerName);

    if (room) {
      const newPlayer = {
        id: playerId,
        name: playerName,
        score: 0,
        isHost: false,
      };

      room.players.push(newPlayer);

      console.log('✅ Player added:', newPlayer);
      console.log(
        '📊 All players in room:',
        room.players.map((p) => p.name),
      );

      io.to(roomId).emit('playerAdded', {
        playerId: playerId,
        playerName: playerName,
        allPlayers: room.players,
      });
    } else {
      console.log('❌ Room not found for adding player:', roomId);
    }
  });

  // Handle player score update
  socket.on('updateScore', (data) => {
    const {roomId, playerId, points} = data;
    const room = gameRooms.get(roomId);

    if (room) {
      const player = room.players.find((p) => p.id === playerId);
      if (player) {
        player.score += points;
        console.log(
          '📊 Score updated for player:',
          player.name,
          'New score:',
          player.score,
        );
        io.to(roomId).emit('scoreUpdated', {
          playerId: playerId,
          playerName: player.name,
          newScore: player.score,
          allPlayers: room.players,
        });
      }
    }
  });

  // Handle player turn change
  socket.on('switchPlayer', (data) => {
    const {roomId, direction} = data;
    const room = gameRooms.get(roomId);

    console.log('🔄 Player switch requested:', direction, 'for room:', roomId);

    if (room && room.players.length > 0) {
      const oldPlayer = room.gameState.currentPlayer;

      if (direction === 'next') {
        room.gameState.currentPlayer =
          (room.gameState.currentPlayer + 1) % room.players.length;
      } else {
        room.gameState.currentPlayer =
          room.gameState.currentPlayer === 0
            ? room.players.length - 1
            : room.gameState.currentPlayer - 1;
      }

      const newPlayer = room.gameState.currentPlayer;
      const playerName = room.players[newPlayer]?.name || 'Unknown';

      console.log(
        '🔄 Player turn changed from',
        oldPlayer,
        'to',
        newPlayer,
        '(',
        playerName,
        ')',
      );
      console.log('📊 Broadcasting to all players in room:', roomId);

      io.to(roomId).emit('playerTurnChanged', {
        currentPlayer: room.gameState.currentPlayer,
        gameState: room.gameState,
      });
    } else {
      console.log('❌ Room not found or no players for switch:', roomId);
    }
  });

  // Handle speech recognition result
  socket.on('speechResult', (data) => {
    const {roomId, word, lastLetter} = data;
    const room = gameRooms.get(roomId);

    if (room) {
      room.gameState.currentLetter = lastLetter;
      io.to(roomId).emit('speechRecognized', {
        word: word,
        lastLetter: lastLetter,
        gameState: room.gameState,
      });
    }
  });

  // Handle timer updates
  socket.on('timerUpdate', (data) => {
    const {roomId, timeLeft, timerActive} = data;
    const room = gameRooms.get(roomId);

    if (room) {
      room.gameState.timeLeft = timeLeft;
      room.gameState.timerActive = timerActive;
      io.to(roomId).emit('timerUpdated', {
        timeLeft: timeLeft,
        timerActive: timerActive,
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove player from all rooms
    for (const [roomId, room] of gameRooms.entries()) {
      const playerIndex = room.players.findIndex((p) => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players.splice(playerIndex, 1);

        // If host disconnected, assign new host
        if (player.isHost && room.players.length > 0) {
          room.players[0].isHost = true;
          room.host = room.players[0].id;
        }

        // Notify remaining players
        io.to(roomId).emit('playerLeft', {
          playerId: socket.id,
          allPlayers: room.players,
          newHost: room.host,
        });

        // Remove room if empty
        if (room.players.length === 0) {
          gameRooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }

        break;
      }
    }
  });
});

// Helper function to get category description
function getCategoryDescription(category) {
  const descriptions = {
    STADT: 'Nenne eine Stadt (z.B. Berlin)',
    LAND: 'Nenne ein Land (z.B. Frankreich)',
    FLUSS: 'Nenne einen Fluss (z.B. Rhein)',
    NAME: 'Nenne einen Vornamen (z.B. Anna)',
    TIER: 'Nenne ein Tier (z.B. Elefant)',
    JACKPOT: 'Wähle KATEGORIE & BUCHSTABEN frei!',
  };
  return descriptions[category] || '';
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: gameRooms.size,
    connections: io.engine.clientsCount,
  });
});

// Get room info endpoint
app.get('/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = gameRooms.get(roomId);

  if (room) {
    res.json({
      roomId: roomId,
      players: room.players,
      gameState: room.gameState,
    });
  } else {
    res.status(404).json({error: 'Room not found'});
  }
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Multiplayer server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
