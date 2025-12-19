const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

// --- 1. CITY GENERATION ---
const cityLayout = [];
const ROWS = 16; // Slightly reduced count for performance due to high-detail geometry
const COLS = 16;
const BLOCK_SIZE = 100; // Wider blocks for massive towers

// Generate Map
for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
        // Skip center plaza (2x2)
        if ((r >= 7 && r <= 8) && (c >= 7 && c <= 8)) continue;

        const x = (r * BLOCK_SIZE) - ((ROWS * BLOCK_SIZE) / 2) + (BLOCK_SIZE / 2);
        const z = (c * BLOCK_SIZE) - ((COLS * BLOCK_SIZE) / 2) + (BLOCK_SIZE / 2);

        // 1. The Scale: Colossal
        // Buildings are much taller now
        const width = 30 + Math.random() * 30; 
        const depth = 30 + Math.random() * 30;
        const height = 100 + Math.random() * 300; // Piercing the cloud layer

        // Generate a random "Twist Factor" for the DNA shape
        const twist = (Math.random() - 0.5) * 2.0; 

        // Aesthetic Type: 0=Glass, 1=Algae/Green, 2=Kinetic
        const type = Math.floor(Math.random() * 3);

        cityLayout.push({ x, z, width, depth, height, twist, type });
    }
}

// --- 2. AI TRAFFIC LOGIC ---
const aiCars = [];
const AI_COUNT = 10;
const AI_SPEED = 2.0;

for (let i = 0; i < AI_COUNT; i++) {
    const isHorizontal = Math.random() > 0.5;
    const laneIndex = Math.floor(Math.random() * ROWS);
    let startX = 0, startZ = 0;
    
    if (isHorizontal) {
        startX = (Math.random() * ROWS * BLOCK_SIZE) - (ROWS * BLOCK_SIZE / 2);
        startZ = (laneIndex * BLOCK_SIZE) - (COLS * BLOCK_SIZE / 2); 
    } else {
        startX = (laneIndex * BLOCK_SIZE) - (ROWS * BLOCK_SIZE / 2);
        startZ = (Math.random() * COLS * BLOCK_SIZE) - (COLS * BLOCK_SIZE / 2);
    }

    aiCars.push({
        id: i,
        x: startX,
        z: startZ,
        dir: isHorizontal ? (Math.random() > 0.5 ? 1 : -1) : (Math.random() > 0.5 ? 2 : -2), 
    });
}

setInterval(() => {
    const boundary = (ROWS * BLOCK_SIZE) / 2;
    aiCars.forEach(car => {
        if (car.dir === 1) car.x += AI_SPEED;
        else if (car.dir === -1) car.x -= AI_SPEED;
        else if (car.dir === 2) car.z += AI_SPEED;
        else if (car.dir === -2) car.z -= AI_SPEED;

        if (car.x > boundary) car.x = -boundary;
        if (car.x < -boundary) car.x = boundary;
        if (car.z > boundary) car.z = -boundary;
        if (car.z < -boundary) car.z = boundary;
    });
    io.emit('updateAI', aiCars);
}, 1000 / 30);

// --- 3. PLAYER LOGIC ---
let players = {};

io.on('connection', (socket) => {
    console.log('Driver connected:', socket.id);
    socket.emit('cityMap', { layout: cityLayout, blockSize: BLOCK_SIZE, rows: ROWS, cols: COLS });
    
    // Assign a neon color
    const neonColors = [0xFF00FF, 0x00FFFF, 0x00FF00, 0xFF0099, 0xFFFF00];
    const pColor = neonColors[Math.floor(Math.random()*neonColors.length)];

    players[socket.id] = { x: 0, z: 0, rot: 0, color: pColor };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].z = movementData.z;
            players[socket.id].rot = movementData.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, ...movementData });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
