// --- Game Constants ---
const SPEED = 0.8;
const TURN_SPEED = 0.05;

// --- Init Three.js ---
const scene = new THREE.Scene();

// --- 1. FIXED SKY SPHERE ---
// We use a giant sphere with the image on the *inside*
const loader = new THREE.TextureLoader();
const skyGeo = new THREE.SphereGeometry(1500, 32, 32);
const skyMat = new THREE.MeshBasicMaterial({ 
    map: loader.load('sky.jpg'), // Make sure 'sky.jpg' exists!
    side: THREE.BackSide // Draw texture on the inside of the sphere
});
const skySphere = new THREE.Mesh(skyGeo, skyMat);
scene.add(skySphere);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const cityLight = new THREE.DirectionalLight(0xffaa00, 0.8);
cityLight.position.set(100, 200, 50);
cityLight.castShadow = true;
scene.add(cityLight);

// --- Ground ---
const groundGeo = new THREE.PlaneGeometry(3000, 3000); 
const groundMat = new THREE.MeshStandardMaterial({ color: 0x050505, flatShading: true });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Networking Setup ---
const socket = io();
const infoDiv = document.getElementById('info');
let otherPlayers = {};
let aiCarMeshes = {}; 
let myCar;
let myId;
let walls = []; // Collidable objects (buildings + fence)

// --- Helper: Build a Polygon Car ---
function createPolyCar(colorHex, isAI = false) {
    const carGroup = new THREE.Group();

    // Chassis
    const chassisGeo = new THREE.BoxGeometry(2.2, 1, 4.5);
    const chassisMat = new THREE.MeshLambertMaterial({ color: colorHex, flatShading: true });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.8;
    carGroup.add(chassis);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.8, 0.8, 2.5);
    const cabinMat = new THREE.MeshLambertMaterial({ color: isAI ? 0x004400 : 0x333333, flatShading: true }); 
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.6, -0.2);
    carGroup.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.5, 8); 
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x000000, flatShading: true });
    
    const positions = [
        { x: 1.2, z: 1.4 }, { x: -1.2, z: 1.4 },
        { x: 1.2, z: -1.4 }, { x: -1.2, z: -1.4 }
    ];

    positions.forEach(p => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(p.x, 0.6, p.z);
        carGroup.add(w);
    });

    if (isAI) {
        carGroup.scale.set(3, 3, 3); 
    }

    return carGroup;
}

// --- CITY & ROAD GENERATION ---

// 2. URBAN FENCE GENERATOR
function createFence(rows, cols, blockSize) {
    const totalWidth = rows * blockSize;
    const totalDepth = cols * blockSize;
    const fenceHeight = 15;
    
    // Wireframe material to look like a chain-link fence
    const fenceMat = new THREE.MeshBasicMaterial({ 
        color: 0x555555, 
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });

    const halfW = totalWidth / 2;
    const halfD = totalDepth / 2;

    const fenceConfigs = [
        { w: totalWidth, d: 1, x: 0, z: -halfD }, // North Wall
        { w: totalWidth, d: 1, x: 0, z: halfD },  // South Wall
        { w: 1, d: totalDepth, x: -halfW, z: 0 }, // West Wall
        { w: 1, d: totalDepth, x: halfW, z: 0 }   // East Wall
    ];

    fenceConfigs.forEach(cfg => {
        const geo = new THREE.BoxGeometry(cfg.w, fenceHeight, cfg.d, Math.floor(cfg.w/20), 2, Math.floor(cfg.d/20));
        const fence = new THREE.Mesh(geo, fenceMat);
        fence.position.set(cfg.x, fenceHeight/2, cfg.z);
        scene.add(fence);
        walls.push(fence);
    });
}

function createRoads(rows, cols, blockSize) {
    const roadWidth = 14; 
    const totalWidth = rows * blockSize;
    const totalDepth = cols * blockSize;
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x333333 }); 
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); 

    for(let c = 0; c < cols; c++) {
        const xPos = (c * blockSize) - (totalWidth / 2);
        const roadGeo = new THREE.PlaneGeometry(roadWidth, totalDepth);
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.rotation.x = -Math.PI/2;
        road.position.set(xPos, 0.05, 0); 
        scene.add(road);

        for(let i=0; i<rows; i++) {
             const zPos = (i * blockSize) - (totalDepth / 2);
             const lineGeo = new THREE.PlaneGeometry(0.5, blockSize * 0.6);
             const line = new THREE.Mesh(lineGeo, lineMat);
             line.rotation.x = -Math.PI/2;
             line.position.set(xPos, 0.08, zPos); 
             scene.add(line);
        }
    }

    for(let r = 0; r < rows; r++) {
        const zPos = (r * blockSize) - (totalDepth / 2);
        const roadGeo = new THREE.PlaneGeometry(totalWidth, roadWidth);
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.rotation.x = -Math.PI/2;
        road.position.set(0, 0.06, zPos); 
        scene.add(road);

        for(let i=0; i<cols; i++) {
             const xPos = (i * blockSize) - (totalWidth / 2);
             const lineGeo = new THREE.PlaneGeometry(blockSize * 0.6, 0.5);
             const line = new THREE.Mesh(lineGeo, lineMat);
             line.rotation.x = -Math.PI/2;
             line.position.set(xPos, 0.09, zPos);
             scene.add(line);
        }
    }
}

function createBuilding(data) {
    const geo = new THREE.BoxGeometry(data.width, data.height, data.depth);
    const mat = new THREE.MeshStandardMaterial({ color: data.color, flatShading: true });
    const building = new THREE.Mesh(geo, mat);
    
    building.position.set(data.x, data.height / 2, data.z);
    scene.add(building);
    walls.push(building); 
}

// --- Socket Handlers ---

socket.on('cityMap', (data) => {
    walls.forEach(w => scene.remove(w));
    walls.length = 0;

    createRoads(data.rows, data.cols, data.blockSize);
    createFence(data.rows, data.cols, data.blockSize); 

    data.layout.forEach(buildingData => {
        createBuilding(buildingData);
    });
});

socket.on('updateAI', (aiData) => {
    aiData.forEach(ai => {
        if (!aiCarMeshes[ai.id]) {
            const car = createPolyCar(0x00FF00, true); 
            scene.add(car);
            aiCarMeshes[ai.id] = car;
        }

        const mesh = aiCarMeshes[ai.id];
        mesh.position.set(ai.x, 0, ai.z);
        
        if (ai.dir === 1) mesh.rotation.y = Math.PI / 2;
        if (ai.dir === -1) mesh.rotation.y = -Math.PI / 2;
        if (ai.dir === 2) mesh.rotation.y = 0;
        if (ai.dir === -2) mesh.rotation.y = Math.PI;
    });
});

socket.on('currentPlayers', (serverPlayers) => {
    infoDiv.innerText = "WATCH OUT FOR GIANT AI CARS!";
    Object.keys(serverPlayers).forEach((id) => {
        if (id === socket.id) {
            myId = id;
            myCar = createPolyCar(serverPlayers[id].color);
            myCar.position.set(serverPlayers[id].x, 0, serverPlayers[id].z);
            myCar.rotation.y = serverPlayers[id].rot;
            scene.add(myCar);
        } else {
            const p = serverPlayers[id];
            const opCar = createPolyCar(p.color);
            opCar.position.set(p.x, 0, p.z);
            opCar.rotation.y = p.rot;
            scene.add(opCar);
            otherPlayers[id] = opCar;
        }
    });
});

socket.on('newPlayer', (data) => {
    const opCar = createPolyCar(data.player.color);
    opCar.position.set(data.player.x, 0, data.player.z);
    opCar.rotation.y = data.player.rot;
    scene.add(opCar);
    otherPlayers[data.id] = opCar;
});

socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) {
        otherPlayers[data.id].position.x = data.x;
        otherPlayers[data.id].position.z = data.z;
        otherPlayers[data.id].rotation.y = data.rot;
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

// --- Inputs ---
const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
});

// --- Physics Check (UPDATED) ---

// Pre-allocate Box3 objects to avoid garbage collection lag
const tempCarBox = new THREE.Box3();
const tempObstacleBox = new THREE.Box3();

function checkCollision(x, z) {
    // 1. Create a hypothetical box for where the player wants to go
    tempCarBox.setFromCenterAndSize(
        new THREE.Vector3(x, 1, z),
        new THREE.Vector3(2.2, 2, 4.5) // Player Car Size
    );

    // 2. Check Static Walls (Buildings + Fence)
    for (let wall of walls) {
        tempObstacleBox.setFromObject(wall);
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    // 3. Check AI Cars
    for (const id in aiCarMeshes) {
        const aiCar = aiCarMeshes[id];
        // We use setFromObject because AI cars are scaled x3
        tempObstacleBox.setFromObject(aiCar);
        // Shrink hitbox slightly for gameplay forgiveness
        tempObstacleBox.expandByScalar(-1.0); 
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    // 4. Check Other Players
    for (const id in otherPlayers) {
        const otherCar = otherPlayers[id];
        tempObstacleBox.setFromObject(otherCar);
        // Shrink hitbox slightly
        tempObstacleBox.expandByScalar(-0.5); 
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    return false;
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (myCar) {
        let move = 0;
        let turn = 0;

        if (keys.w) move = SPEED;
        if (keys.s) move = -SPEED;
        if (keys.a) turn = TURN_SPEED;
        if (keys.d) turn = -TURN_SPEED;

        myCar.rotation.y += turn;

        const dx = Math.sin(myCar.rotation.y) * move;
        const dz = Math.cos(myCar.rotation.y) * move;

        const nextX = myCar.position.x + dx;
        const nextZ = myCar.position.z + dz;

        // If no collision, move freely
        if (!checkCollision(nextX, nextZ)) {
            myCar.position.x = nextX;
            myCar.position.z = nextZ;
        } else {
            // Collision detected! "Bounce" back slightly.
            // This prevents sticking to walls/cars.
            myCar.position.x -= dx * 0.5;
            myCar.position.z -= dz * 0.5;
        }

        // Camera Logic
        const camDist = 20; 
        const camHeight = 8;
        
        const targetX = myCar.position.x - Math.sin(myCar.rotation.y) * camDist;
        const targetZ = myCar.position.z - Math.cos(myCar.rotation.y) * camDist;

        camera.position.x += (targetX - camera.position.x) * 0.1;
        camera.position.z += (targetZ - camera.position.z) * 0.1;
        camera.position.y = myCar.position.y + camHeight;
        camera.lookAt(myCar.position);

        if (move !== 0 || turn !== 0) {
            socket.emit('playerMovement', {
                x: myCar.position.x,
                z: myCar.position.z,
                rot: myCar.rotation.y
            });
        }
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
