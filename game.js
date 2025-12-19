// --- Game Constants ---
const SPEED = 1.0;
const TURN_SPEED = 0.04;

// --- Init Three.js ---
const scene = new THREE.Scene();
// Add some fog to obscure the tops of buildings (The Scale: obscure by mist)
scene.fog = new THREE.FogExp2(0x051015, 0.0015);

// --- 1. SKY & LIGHTING (Night Aesthetic: Bioluminescence) ---
const loader = new THREE.TextureLoader();
const skyGeo = new THREE.SphereGeometry(2000, 32, 32);
const skyMat = new THREE.MeshBasicMaterial({ 
    color: 0x001133, // Deep night blue
    side: THREE.BackSide 
});
const skySphere = new THREE.Mesh(skyGeo, skyMat);
scene.add(skySphere);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // Enable shadows
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.5); // Soft moonlight
scene.add(ambientLight);

// The Moon / City Glow
const moonLight = new THREE.DirectionalLight(0xaaccff, 0.6);
moonLight.position.set(200, 500, 100);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
scene.add(moonLight);

// --- Ground (Magnetic Rails Transition) ---
//
const groundGeo = new THREE.PlaneGeometry(5000, 5000); 
const groundMat = new THREE.MeshStandardMaterial({ 
    color: 0x050505, 
    roughness: 0.4,
    metalness: 0.8
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Networking ---
const socket = io();
const infoDiv = document.getElementById('info');
let otherPlayers = {};
let aiCarMeshes = {}; 
let myCar;
let myId;
let walls = []; 
let pulsingMaterials = []; // Array to store mats for animation

// --- HELPER: Procedural Texture Generation ---
// Creates the "Chameleon Glass" or "Algae" patterns without external files
function createProceduralTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    if (type === 'algae') {
        //
        ctx.fillStyle = '#002200';
        ctx.fillRect(0,0,64,64);
        ctx.strokeStyle = '#00ff44';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for(let i=0; i<10; i++) {
            ctx.moveTo(Math.random()*64, 0);
            ctx.lineTo(Math.random()*64, 64);
        }
        ctx.stroke();
    } else if (type === 'kinetic') {
        //
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#334455';
        ctx.beginPath();
        ctx.moveTo(32, 0); ctx.lineTo(64, 32); ctx.lineTo(32, 64); ctx.lineTo(0, 32);
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

const algaeTex = createProceduralTexture('algae');
const kineticTex = createProceduralTexture('kinetic');

// --- BUILDINGS: The Organic Skyscrapers ---

function createFuturistBuilding(data) {
    const buildingGroup = new THREE.Group();

    // 1. THE BASE: The Porous Foundation
    // We lift the main tower off the ground
    const baseHeight = 25;
    const pillarGeo = new THREE.CylinderGeometry(2, 4, baseHeight, 6);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    
    // Create 4 Pillars at the corners
    const px = data.width / 2 - 2;
    const pz = data.depth / 2 - 2;
    
    [[px, pz], [-px, pz], [px, -pz], [-px, -pz]].forEach(pos => {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(pos[0], baseHeight/2, pos[1]);
        buildingGroup.add(pillar);
    });

    // 2. THE SILHOUETTE: Organic and Kinetic
    // We use a segmented approach to simulate twisting geometry
    const segments = 10;
    const segHeight = data.height / segments;
    
    // Material Selection based on Type
    let mainMat;
    if (data.type === 1) {
        //
        mainMat = new THREE.MeshPhysicalMaterial({ 
            map: algaeTex,
            color: 0x002200,
            emissive: 0x00aa44,
            emissiveIntensity: 0.5,
            metalness: 0.2,
            roughness: 0.2,
            transmission: 0.2
        });
        pulsingMaterials.push(mainMat); // Add to animation loop
    } else {
        //
        mainMat = new THREE.MeshPhysicalMaterial({ 
            map: kineticTex,
            color: 0x111111,
            metalness: 0.9,
            roughness: 0.1, // Reflective
            envMapIntensity: 1.0
        });
    }

    // Generate Twisted Segments
    for(let i=0; i<segments; i++) {
        // Tapering width slightly towards top
        const taper = 1 - (i / segments) * 0.3; 
        const w = data.width * taper;
        const d = data.depth * taper;

        const geo = new THREE.BoxGeometry(w, segHeight, d);
        const mesh = new THREE.Mesh(geo, mainMat);
        
        mesh.position.y = baseHeight + (i * segHeight) + (segHeight/2);
        
        // APPLY THE TWIST
        mesh.rotation.y = i * data.twist * 0.2; 
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        buildingGroup.add(mesh);

        // 3. THE GREENERY: Cascading Terraces
        // Only on some segments, add green protruding blocks (vines/bushes)
        if (Math.random() > 0.4) {
            const vineGeo = new THREE.DodecahedronGeometry(Math.random() * 5 + 2);
            const vineMat = new THREE.MeshLambertMaterial({ color: 0x228822 });
            const vine = new THREE.Mesh(vineGeo, vineMat);
            
            // Stick it to the side
            const side = Math.random() > 0.5 ? 1 : -1;
            vine.position.set((w/2) * side, mesh.position.y, (d/2) * side);
            vine.position.x += (Math.random()-0.5)*10;
            buildingGroup.add(vine);
        }
    }

    // 4. THE CROWN: Crystalline Dome
    const crownGeo = new THREE.ConeGeometry(data.width/2, 40, 4);
    const crownMat = new THREE.MeshBasicMaterial({ 
        color: 0xccffcc, 
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.y = baseHeight + data.height + 20;
    crown.rotation.y = Math.PI/4;
    buildingGroup.add(crown);

    // 5. NIGHT AESTHETIC: Holographic Projection
    if (data.height > 200) {
        const holoGeo = new THREE.PlaneGeometry(40, 40);
        const holoMat = new THREE.MeshBasicMaterial({ 
            color: 0x00ffff, 
            side: THREE.DoubleSide, 
            transparent: true, 
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        const holo = new THREE.Mesh(holoGeo, holoMat);
        holo.position.set(data.width, baseHeight + 100, 0);
        holo.rotation.y = Math.PI / 2;
        buildingGroup.add(holo);
    }

    // Position entire group
    buildingGroup.position.set(data.x, 0, data.z);
    
    // Add simple invisible box for physics collision
    const colBox = new THREE.Mesh(
        new THREE.BoxGeometry(data.width, 10, data.depth),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    colBox.position.set(data.x, 5, data.z);
    scene.add(buildingGroup);
    scene.add(colBox);
    walls.push(colBox);
}

// --- ROADS & INFRASTRUCTURE ---
function createInfrastructure(rows, cols, blockSize) {
    const roadWidth = 20; 
    const totalW = rows * blockSize;
    const totalD = cols * blockSize;

    // Dark pavement
    const roadMat = new THREE.MeshStandardMaterial({ 
        color: 0x111111, 
        roughness: 0.8 
    }); 
    
    // Glowing lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x00ccff }); 

    // Create a grid of roads
    for(let r=0; r<rows; r++) {
        // Horizontal Roads
        const z = (r * blockSize) - (totalD/2);
        const road = new THREE.Mesh(new THREE.PlaneGeometry(totalW, roadWidth), roadMat);
        road.rotation.x = -Math.PI/2;
        road.position.set(0, 0.1, z);
        road.receiveShadow = true;
        scene.add(road);
        
        // Center line
        const line = new THREE.Mesh(new THREE.PlaneGeometry(totalW, 1), lineMat);
        line.rotation.x = -Math.PI/2;
        line.position.set(0, 0.2, z);
        scene.add(line);
    }

    for(let c=0; c<cols; c++) {
        // Vertical Roads
        const x = (c * blockSize) - (totalW/2);
        const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, totalD), roadMat);
        road.rotation.x = -Math.PI/2;
        road.position.set(x, 0.15, 0); // Slightly higher to avoid z-fighting
        road.receiveShadow = true;
        scene.add(road);
    }
}

// --- CAR GENERATION (Updated to look sleeker) ---
function createPolyCar(colorHex, isAI = false) {
    const carGroup = new THREE.Group();

    // Body - Sleeker, wedge shape
    const bodyGeo = new THREE.BoxGeometry(2, 0.8, 4.5);
    // Adjust vertices for wedge shape
    const positions = bodyGeo.attributes.position.array;
    // Lower front vertices (indices need check, simplified approach here is visual scaling)
    const bodyMat = new THREE.MeshPhongMaterial({ 
        color: colorHex, 
        emissive: colorHex,
        emissiveIntensity: 0.3,
        shininess: 100 
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    carGroup.add(body);

    // Neon Strips (Tron style)
    const stripGeo = new THREE.BoxGeometry(2.1, 0.1, 4.6);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.y = 0.5;
    carGroup.add(strip);

    if (isAI) carGroup.scale.set(2,2,2); // AI are buses/trucks
    return carGroup;
}

// --- SOCKET HANDLERS ---
socket.on('cityMap', (data) => {
    walls.forEach(w => scene.remove(w)); // Clear old physics boxes
    walls = [];

    createInfrastructure(data.rows, data.cols, data.blockSize);

    data.layout.forEach(bData => {
        createFuturistBuilding(bData);
    });
});

socket.on('updateAI', (aiData) => {
    aiData.forEach(ai => {
        if (!aiCarMeshes[ai.id]) {
            const car = createPolyCar(0xFF0000, true); 
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
    Object.keys(serverPlayers).forEach((id) => {
        if (id === socket.id) {
            myId = id;
            myCar = createPolyCar(serverPlayers[id].color);
            scene.add(myCar);
        } else {
            const opCar = createPolyCar(serverPlayers[id].color);
            otherPlayers[id] = opCar;
            scene.add(opCar);
        }
    });
});

socket.on('newPlayer', (data) => {
    const opCar = createPolyCar(data.player.color);
    otherPlayers[data.id] = opCar;
    scene.add(opCar);
});

socket.on('playerMoved', (data) => {
    if (otherPlayers[data.id]) {
        otherPlayers[data.id].position.set(data.x, 0, data.z);
        otherPlayers[data.id].rotation.y = data.rot;
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

// --- INPUTS ---
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => {
    if (e.key === 'w') keys.w = true;
    if (e.key === 's') keys.s = true;
    if (e.key === 'a') keys.a = true;
    if (e.key === 'd') keys.d = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'w') keys.w = false;
    if (e.key === 's') keys.s = false;
    if (e.key === 'a') keys.a = false;
    if (e.key === 'd') keys.d = false;
});

// --- PHYSICS ---
function checkCollision(x, z) {
    const carBox = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 1, z), new THREE.Vector3(2, 2, 4));
    for (let wall of walls) {
        const wallBox = new THREE.Box3().setFromObject(wall);
        if (carBox.intersectsBox(wallBox)) return true;
    }
    return false;
}

// --- ANIMATION LOOP ---
let time = 0;
function animate() {
    requestAnimationFrame(animate);
    time += 0.05;

    // Pulse the Living Buildings
    pulsingMaterials.forEach(mat => {
        mat.emissiveIntensity = 0.5 + Math.sin(time) * 0.3;
    });

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

        if (!checkCollision(nextX, nextZ)) {
            myCar.position.x = nextX;
            myCar.position.z = nextZ;
        }

        // Camera Logic: Dynamic Follow
        const camDist = 25; 
        const camHeight = 12;
        const targetX = myCar.position.x - Math.sin(myCar.rotation.y) * camDist;
        const targetZ = myCar.position.z - Math.cos(myCar.rotation.y) * camDist;
        
        camera.position.x += (targetX - camera.position.x) * 0.1;
        camera.position.z += (targetZ - camera.position.z) * 0.1;
        camera.position.y = camHeight;
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
