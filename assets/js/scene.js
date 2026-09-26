// Floating glass / chrome / gloss objects lit by an environment map.
// `state` is tweened by main.js on scroll; the render loop only reads it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BG = 0x07080a;
const ACCENT = 0x7df9ff;

export function createScene(canvas, { lowPower = false, reduceMotion = false } = {}) {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !lowPower,
        powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.25 : 1.75));
    renderer.setClearColor(BG, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);

    // Studio-style reflections without shipping an HDR file.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 14);

    // Coloured rim lights give the glass its tint and the chrome its edges.
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 6, 6);
    const rimA = new THREE.PointLight(ACCENT, 60, 30);
    rimA.position.set(-6, 3, 2);
    const rimB = new THREE.PointLight(0x8a5cff, 50, 30);
    rimB.position.set(6, -4, 1);
    scene.add(key, rimA, rimB);

    // A soft glowing backdrop the glass can refract — this is what sells "real glass".
    const glow = makeGlowTexture();
    const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 26),
        new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, toneMapped: false }),
    );
    backdrop.position.z = -8;
    scene.add(backdrop);

    const mats = {
        glass: new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0,
            roughness: 0.06,
            transmission: 1,
            thickness: 1.6,
            ior: 1.45,
            iridescence: 0.7,
            iridescenceIOR: 1.35,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
            attenuationColor: new THREE.Color(0xbff9ff),
            attenuationDistance: 3,
            envMapIntensity: 1.2,
        }),
        chrome: new THREE.MeshPhysicalMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.14, envMapIntensity: 1.3 }),
        accent: new THREE.MeshPhysicalMaterial({
            color: ACCENT, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5,
        }),
        ink: new THREE.MeshPhysicalMaterial({ color: 0x0d0f13, metalness: 0.5, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 }),
    };

    // [geometry, material, position, scale, keep on low-power devices]
    const defs = [
        [new THREE.TorusKnotGeometry(1, 0.34, 220, 36), mats.glass, [0.2, 0.3, 0], 1.05, true],
        [new THREE.SphereGeometry(1, 64, 64), mats.chrome, [-2.1, 1.6, -1.2], 0.62, true],
        [new RoundedBoxGeometry(1.4, 1.4, 1.4, 6, 0.28), mats.accent, [2.3, -1.4, 0.6], 0.72, true],
        [new THREE.TorusGeometry(0.9, 0.3, 48, 120), mats.ink, [-1.8, -1.7, 0.9], 0.8, true],
        [new THREE.IcosahedronGeometry(1, 0), mats.glass, [2.4, 1.9, -0.8], 0.6, false],
        [new THREE.CapsuleGeometry(0.4, 1.1, 12, 32), mats.chrome, [-3.1, -0.1, -2], 0.7, false],
        [new THREE.SphereGeometry(1, 48, 48), mats.accent, [0.9, -2.5, -1.6], 0.32, false],
        [new THREE.OctahedronGeometry(1, 0), mats.ink, [3.4, 0.2, -2.4], 0.45, false],
    ];

    const group = new THREE.Group();
    scene.add(group);
    const items = defs
        .filter((d) => !lowPower || d[4])
        .map(([geo, mat, pos, s], i) => {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(...pos);
            mesh.scale.setScalar(s);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            group.add(mesh);
            return {
                mesh,
                base: new THREE.Vector3(...pos),
                phase: i * 1.37,
                speed: 0.35 + (i % 3) * 0.12,
                spin: new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.2),
                push: new THREE.Vector3(),
            };
        });

    // Scroll-driven values (tweened from main.js)
    const state = { x: 2.4, y: 0, z: 0, scale: 1, rotY: 0, rotX: 0, spread: 1, glow: 1 };

    const pointer = new THREE.Vector2(0, 0);
    const smooth = new THREE.Vector2(0, 0);
    const ndc = new THREE.Vector2(-10, -10);
    const raycaster = new THREE.Raycaster();
    const tmp = new THREE.Vector3();

    window.addEventListener('pointermove', (e) => {
        pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        ndc.copy(pointer);
    }, { passive: true });

    let layoutX = 1;
    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // narrow screens: pull the cluster towards the centre and shrink it
        layoutX = Math.min(1, camera.aspect / 1.4);
        camera.position.z = camera.aspect < 0.8 ? 19 : 14;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    const motion = reduceMotion ? 0.25 : 1;

    function tick() {
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime * motion;

        smooth.lerp(pointer, 1 - Math.pow(0.001, dt));

        // narrow screens get explicit x values from main.js, so don't squash them again
        group.position.set(camera.aspect < 0.8 ? state.x : state.x * layoutX, state.y, state.z);
        group.scale.setScalar(state.scale * (0.75 + 0.25 * layoutX));
        group.rotation.y = state.rotY + smooth.x * 0.35;
        group.rotation.x = state.rotX - smooth.y * 0.2;

        // Nudge objects away from the cursor like they're floating in liquid.
        raycaster.setFromCamera(ndc, camera);

        for (const it of items) {
            const { mesh, base } = it;
            const bob = Math.sin(t * it.speed + it.phase);
            const target = tmp.copy(base).multiplyScalar(state.spread);
            target.y += bob * 0.22;
            target.x += Math.cos(t * it.speed * 0.7 + it.phase) * 0.12;

            if (!reduceMotion) {
                const world = mesh.getWorldPosition(new THREE.Vector3());
                const d = raycaster.ray.distanceToPoint(world);
                const force = Math.max(0, 1.6 - d) * 0.9;
                if (force > 0) {
                    const away = world.sub(raycaster.ray.closestPointToPoint(world, new THREE.Vector3())).normalize();
                    it.push.lerp(away.multiplyScalar(force), 0.08);
                } else {
                    it.push.multiplyScalar(0.94);
                }
            }
            target.add(it.push);
            mesh.position.lerp(target, 1 - Math.pow(0.02, dt));

            mesh.rotation.x += it.spin.x * dt * motion;
            mesh.rotation.y += it.spin.y * dt * motion;
            mesh.rotation.z += it.spin.z * dt * motion;
        }

        rimA.position.x = -6 + smooth.x * 3;
        rimB.position.y = -4 + smooth.y * 3;
        backdrop.material.opacity = state.glow;
        backdrop.position.x = group.position.x * 0.6;

        camera.position.x = smooth.x * 0.4;
        camera.position.y = smooth.y * 0.3;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
    }

    renderer.setAnimationLoop(tick);
    return { state, renderer };
}

function makeGlowTexture() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const blob = (x, y, r, color) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
    };
    ctx.globalCompositeOperation = 'lighter';
    blob(size * 0.42, size * 0.45, size * 0.34, 'rgba(60, 200, 230, 0.42)');
    blob(size * 0.62, size * 0.58, size * 0.3, 'rgba(120, 80, 255, 0.36)');
    blob(size * 0.5, size * 0.5, size * 0.12, 'rgba(255, 255, 255, 0.10)');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
