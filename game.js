// --- Game Constants ---
// We use "Units Per Second" now instead of "Units Per Frame" for smoothness
const MOVEMENT_SPEED = 50.0; 
const ROTATION_SPEED = 3.0; 
const LERP_FACTOR = 10.0; // How fast remote cars smooth to their target (Higher = snappier, Lower = smoother)

// --- Init Three.js ---
const scene = new THREE.Scene();
const clock = new THREE.Clock(); // Tracks time between frames

// --- 1. FIXED SKY SPHERE ---
const loader = new THREE.TextureLoader();
const skyGeo = new THREE.SphereGeometry(1500, 32, 32);
const skyMat = new THREE.MeshBasicMaterial({ 
    map: loader.load('sky.jpg'), 
    side: THREE.BackSide 
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

// We now store state objects: { mesh: THREE.Group, targetX: number, targetZ: number, targetRot: number }
let otherPlayers = {}; 
let aiCarMeshes = {}; 

let myCar;
let myId;
let walls = []; 

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
function createFence(rows, cols, blockSize) {
    const totalWidth = rows * blockSize;
    const totalDepth = cols * blockSize;
    const fenceHeight = 15;
    
    const fenceMat = new THREE.MeshBasicMaterial({ 
        color: 0x555555, 
        wireframe: true,
        transparent: true,
        opacity: 0.8
    });

    const halfW = totalWidth / 2;
    const halfD = totalDepth / 2;

    const fenceConfigs = [
        { w: totalWidth, d: 1, x: 0, z: -halfD }, 
        { w: totalWidth, d: 1, x: 0, z: halfD },  
        { w: 1, d: totalDepth, x: -halfW, z: 0 }, 
        { w: 1, d: totalDepth, x: halfW, z: 0 }   
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
        // If this is a new AI car, create it
        if (!aiCarMeshes[ai.id]) {
            const car = createPolyCar(0x00FF00, true); 
            // Start at the correct position immediately
            car.position.set(ai.x, 0, ai.z);
            scene.add(car);
            
            // Store the mesh AND the target coordinates
            aiCarMeshes[ai.id] = { 
                mesh: car, 
                targetX: ai.x, 
                targetZ: ai.z, 
                targetRot: 0 // Will determine below
            };
        }

        // Update the TARGET position, do not move mesh yet (we smooth it in animate)
        const aiObj = aiCarMeshes[ai.id];
        aiObj.targetX = ai.x;
        aiObj.targetZ = ai.z;
        
        // Determine rotation based on direction
        if (ai.dir === 1) aiObj.targetRot = Math.PI / 2;
        if (ai.dir === -1) aiObj.targetRot = -Math.PI / 2;
        if (ai.dir === 2) aiObj.targetRot = 0;
        if (ai.dir === -2) aiObj.targetRot = Math.PI;
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
            
            // Store as object for interpolation
            otherPlayers[id] = {
                mesh: opCar,
                targetX: p.x,
                targetZ: p.z,
                targetRot: p.rot
            };
        }
    });
});

socket.on('newPlayer', (data) => {
    const opCar = createPolyCar(data.player.color);
    opCar.position.set(data.player.x, 0, data.player.z);
    opCar.rotation.y = data.player.rot;
    scene.add(opCar);
    
    otherPlayers[data.id] = {
        mesh: opCar,
        targetX: data.player.x,
        targetZ: data.player.z,
        targetRot: data.player.rot
    };
});

socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) {
        // Just update the target, don't teleport!
        otherPlayers[data.id].targetX = data.x;
        otherPlayers[data.id].targetZ = data.z;
        otherPlayers[data.id].targetRot = data.rot;
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id].mesh); // Remove the mesh from scene
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

// --- Physics Check ---
const tempCarBox = new THREE.Box3();
const tempObstacleBox = new THREE.Box3();

function checkCollision(x, z) {
    tempCarBox.setFromCenterAndSize(
        new THREE.Vector3(x, 1, z),
        new THREE.Vector3(2.2, 2, 4.5) 
    );

    // Walls
    for (let wall of walls) {
        tempObstacleBox.setFromObject(wall);
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    // AI Cars (Access the .mesh property now)
    for (const id in aiCarMeshes) {
        const aiCar = aiCarMeshes[id].mesh; 
        tempObstacleBox.setFromObject(aiCar);
        tempObstacleBox.expandByScalar(-1.0); 
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    // Other Players (Access the .mesh property now)
    for (const id in otherPlayers) {
        const otherCar = otherPlayers[id].mesh;
        tempObstacleBox.setFromObject(otherCar);
        tempObstacleBox.expandByScalar(-0.5); 
        if (tempCarBox.intersectsBox(tempObstacleBox)) return true;
    }

    return false;
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);

    // 1. Get the time passed since last frame (in seconds)
    // This ensures consistency across 30fps, 60fps, 144fps
    const delta = clock.getDelta(); 

    if (myCar) {
        let moveDist = 0;
        let turnAngle = 0;

        // Apply Delta Time to movement
        if (keys.w) moveDist = MOVEMENT_SPEED * delta;
        if (keys.s) moveDist = -MOVEMENT_SPEED * delta;
        if (keys.a) turnAngle = ROTATION_SPEED * delta;
        if (keys.d) turnAngle = -ROTATION_SPEED * delta;

        myCar.rotation.y += turnAngle;

        const dx = Math.sin(myCar.rotation.y) * moveDist;
        const dz = Math.cos(myCar.rotation.y) * moveDist;

        const nextX = myCar.position.x + dx;
        const nextZ = myCar.position.z + dz;

        if (!checkCollision(nextX, nextZ)) {
            myCar.position.x = nextX;
            myCar.position.z = nextZ;
        } else {
            // "Bounce" logic
            myCar.position.x -= dx * 0.5;
            myCar.position.z -= dz * 0.5;
        }

        // Smooth Camera Logic (Time-based Lerp)
        const camDist = 20; 
        const camHeight = 8;
        
        const targetX = myCar.position.x - Math.sin(myCar.rotation.y) * camDist;
        const targetZ = myCar.position.z - Math.cos(myCar.rotation.y) * camDist;

        // Using delta in lerp makes camera speed consistent
        const smoothing = 5.0 * delta; 
        camera.position.x += (targetX - camera.position.x) * smoothing;
        camera.position.z += (targetZ - camera.position.z) * smoothing;
        camera.position.y = myCar.position.y + camHeight;
        camera.lookAt(myCar.position);

        if (moveDist !== 0 || turnAngle !== 0) {
            socket.emit('playerMovement', {
                x: myCar.position.x,
                z: myCar.position.z,
                rot: myCar.rotation.y
            });
        }
    }

    // --- INTERPOLATION (Smoothing) FOR OTHERS ---
    
    // Smooth AI Cars
    for (const id in aiCarMeshes) {
        const obj = aiCarMeshes[id];
        if (obj.mesh && obj.targetX !== undefined) {
            // Linearly Interpolate (Lerp) positions
            const lerpSpeed = LERP_FACTOR * delta;
            obj.mesh.position.x += (obj.targetX - obj.mesh.position.x) * lerpSpeed;
            obj.mesh.position.z += (obj.targetZ - obj.mesh.position.z) * lerpSpeed;
            
            // For rotation, we can snap or lerp. Snapping is cleaner for grid-AI.
            obj.mesh.rotation.y = obj.targetRot;
        }
    }

    // Smooth Other Players
    for (const id in otherPlayers) {
        const obj = otherPlayers[id];
        if (obj.mesh && obj.targetX !== undefined) {
            const lerpSpeed = LERP_FACTOR * delta;
            obj.mesh.position.x += (obj.targetX - obj.mesh.position.x) * lerpSpeed;
            obj.mesh.position.z += (obj.targetZ - obj.mesh.position.z) * lerpSpeed;
            
            // Simple rotation lerp
            obj.mesh.rotation.y += (obj.targetRot - obj.mesh.rotation.y) * lerpSpeed;
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
