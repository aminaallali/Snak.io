const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory storage (replace with database in production)
let gameRooms = new Map();
let globalLeaderboard = [];

// Load leaderboard from file
const leaderboardFile = 'leaderboard.json';
try {
    if (fs.existsSync(leaderboardFile)) {
        globalLeaderboard = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8'));
    }
} catch (error) {
    console.log('No existing leaderboard found, starting fresh');
}

// Save leaderboard to file
function saveLeaderboard() {
    fs.writeFileSync(leaderboardFile, JSON.stringify(globalLeaderboard, null, 2));
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/leaderboard', (req, res) => {
    res.json(globalLeaderboard.slice(0, 10)); // Top 10 scores
});

app.post('/api/submit-score', (req, res) => {
    const { playerName, score } = req.body;
    
    if (!playerName || !score) {
        return res.status(400).json({ error: 'Player name and score required' });
    }
    
    globalLeaderboard.push({
        playerName,
        score,
        timestamp: new Date().toISOString()
    });
    
    // Sort by score descending
    globalLeaderboard.sort((a, b) => b.score - a.score);
    
    // Keep only top 100
    globalLeaderboard = globalLeaderboard.slice(0, 100);
    
    saveLeaderboard();
    
    res.json({ 
        success: true, 
        rank: globalLeaderboard.findIndex(entry => 
            entry.playerName === playerName && entry.score === score
        ) + 1
    });
});

// Socket.io for real-time multiplayer
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        
        if (!gameRooms.has(roomId)) {
            gameRooms.set(roomId, {
                players: new Map(),
                gameState: 'waiting'
            });
        }
        
        const room = gameRooms.get(roomId);
        room.players.set(socket.id, {
            id: socket.id,
            ready: false,
            score: 0
        });
        
        socket.emit('room-joined', roomId);
        io.to(roomId).emit('room-update', {
            players: Array.from(room.players.values()),
            gameState: room.gameState
        });
    });
    
    socket.on('player-ready', (roomId) => {
        const room = gameRooms.get(roomId);
        if (room && room.players.has(socket.id)) {
            room.players.get(socket.id).ready = true;
            
            // Check if all players are ready
            const allReady = Array.from(room.players.values()).every(player => player.ready);
            if (allReady && room.players.size >= 2) {
                room.gameState = 'playing';
                io.to(roomId).emit('game-start');
            }
            
            io.to(roomId).emit('room-update', {
                players: Array.from(room.players.values()),
                gameState: room.gameState
            });
        }
    });
    
    socket.on('game-move', (data) => {
        // Broadcast player movement to other players in the room
        socket.to(data.roomId).emit('player-moved', {
            playerId: socket.id,
            direction: data.direction,
            position: data.position
        });
    });
    
    socket.on('game-over', (data) => {
        const room = gameRooms.get(data.roomId);
        if (room && room.players.has(socket.id)) {
            room.players.get(socket.id).score = data.score;
            
            socket.to(data.roomId).emit('player-eliminated', {
                playerId: socket.id,
                score: data.score
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        // Remove player from all rooms
        for (let [roomId, room] of gameRooms) {
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                
                if (room.players.size === 0) {
                    gameRooms.delete(roomId);
                } else {
                    io.to(roomId).emit('room-update', {
                        players: Array.from(room.players.values()),
                        gameState: room.gameState
                    });
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`🐍 Snake Game Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to play!`);
});