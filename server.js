const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

// --- 1. CITY GENERATION ---
const cityLayout = [];
const ROWS = 20;
const COLS = 20;
const BLOCK_SIZE = 80; 

// Generate Map
for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
        // Skip center plaza (2x2)
        if ((r === 9 || r === 10) && (c === 9 || c === 10)) continue;

        const x = (r * BLOCK_SIZE) - ((ROWS * BLOCK_SIZE) / 2) + (BLOCK_SIZE / 2);
        const z = (c * BLOCK_SIZE) - ((COLS * BLOCK_SIZE) / 2) + (BLOCK_SIZE / 2);

        // Buildings are smaller than block size to leave room for roads
        const width = 20 + Math.random() * 40; 
        const depth = 20 + Math.random() * 40;
        const height = 30 + Math.random() * 120;

        // Color generation
        const grayScale = Math.random() * 0.5 + 0.1;
        const rVal = Math.floor(grayScale * 255);
        const gVal = Math.floor(grayScale * 255);
        const bVal = Math.floor((grayScale + 0.1) * 255);
        const color = (rVal << 16) | (gVal << 8) | bVal;

        cityLayout.push({ x, z, width, depth, height, color });
    }
}

// --- 2. AI TRAFFIC LOGIC ---
const aiCars = [];
const AI_COUNT = 15;
const AI_SPEED = 1.5;

// Initialize AI Cars
for (let i = 0; i < AI_COUNT; i++) {
    // Pick a random row or col to drive on
    const isHorizontal = Math.random() > 0.5;
    const laneIndex = Math.floor(Math.random() * ROWS);
    
    // Calculate position based on grid lines (streets are between blocks)
    // We snap them exactly to the grid lines
    let startX = 0, startZ = 0;
    
    if (isHorizontal) {
        // Moving along X axis, fixed on a Z row
        startX = (Math.random() * ROWS * BLOCK_SIZE) - (ROWS * BLOCK_SIZE / 2);
        startZ = (laneIndex * BLOCK_SIZE) - (COLS * BLOCK_SIZE / 2); 
    } else {
        // Moving along Z axis, fixed on an X col
        startX = (laneIndex * BLOCK_SIZE) - (ROWS * BLOCK_SIZE / 2);
        startZ = (Math.random() * COLS * BLOCK_SIZE) - (COLS * BLOCK_SIZE / 2);
    }

    aiCars.push({
        id: i,
        x: startX,
        z: startZ,
        dir: isHorizontal ? (Math.random() > 0.5 ? 1 : -1) : (Math.random() > 0.5 ? 2 : -2), 
        // 1=East, -1=West, 2=South, -2=North
    });
}

// AI Game Loop (30 TPS)
setInterval(() => {
    const boundary = (ROWS * BLOCK_SIZE) / 2;

    aiCars.forEach(car => {
        // Move
        if (car.dir === 1) car.x += AI_SPEED;
        else if (car.dir === -1) car.x -= AI_SPEED;
        else if (car.dir === 2) car.z += AI_SPEED;
        else if (car.dir === -2) car.z -= AI_SPEED;

        // Wrap around world edges
        if (car.x > boundary) car.x = -boundary;
        if (car.x < -boundary) car.x = boundary;
        if (car.z > boundary) car.z = -boundary;
        if (car.z < -boundary) car.z = boundary;
    });

    // Send AI data to everyone
    io.emit('updateAI', aiCars);
}, 1000 / 30);


// --- 3. PLAYER LOGIC ---
let players = {};

io.on('connection', (socket) => {
    console.log('Driver connected:', socket.id);

    // Send Map
    socket.emit('cityMap', { layout: cityLayout, blockSize: BLOCK_SIZE, rows: ROWS, cols: COLS });

    // Spawn Player
    players[socket.id] = {
        x: 0, 
        z: 0, 
        rot: 0, 
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].z = movementData.z;
            players[socket.id].rot = movementData.rot;
            
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: movementData.x,
                z: movementData.z,
                rot: movementData.rot
            });
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
