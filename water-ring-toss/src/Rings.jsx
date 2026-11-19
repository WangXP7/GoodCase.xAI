import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import { button, useControls } from "leva";
import { TorusGeometry } from "three";
import { useGame } from "./GameContext";
import { samplePumpForce } from "./pump";

const COLLIDER_SEGMENTS = 10;
const RING_RADIAL_SEGMENTS = 8;
const RING_TUBULAR_SEGMENTS = 12;

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function makeRingConfigs(count, seed) {
    const rand = mulberry32(seed);
    const cols = Math.ceil(Math.sqrt(count * 1.8));
    const rows = Math.ceil(count / cols);
    const width = 1.2;
    const height = 0.3;
    const configs = [];

    for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x =
            -width / 2 + ((c + 0.5) * width) / cols + (rand() - 0.5) * 0.05;
        const y = -0.28 + ((r + 0.5) * height) / rows + (rand() - 0.5) * 0.04;
        const z = (rand() - 0.5) * 0.04;

        configs.push({
            id: `${seed}-${i}`,
            colorIndex: Math.floor(rand() * 4),
            position: [x, y, z],
            rotation: [
                Math.PI * 0.5,
                (rand() - 0.5) * 0.45,
                rand() * Math.PI * 2,
            ],
        });
    }

    return configs;
}

function RingColliders({ radius, tube }) {
    const colliders = useMemo(() => {
        return Array.from({ length: COLLIDER_SEGMENTS }, (_, i) => {
            const angle = (i / COLLIDER_SEGMENTS) * Math.PI * 2;
            return {
                key: i,
                position: [
                    Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                    0,
                ],
            };
        });
    }, [radius]);

    return colliders.map((collider) => (
        <BallCollider
            key={collider.key}
            args={[tube]}
            position={collider.position}
            friction={0.05}
            restitution={0.12}
            density={400}
        />
    ));
}

function TossRing({ position, rotation, color, radius, tube, geometry }) {
    const bodyRef = useRef();
    const { pumpsRef, paramsRef } = useGame();

    useFrame((_, delta) => {
        const body = bodyRef.current;
        if (!body) return;

        const plusLevel = pumpsRef.current.plus;
        const crossLevel = pumpsRef.current.cross;
        if (plusLevel < 0.001 && crossLevel < 0.001) return;

        const force = samplePumpForce(
            body.translation(),
            pumpsRef.current,
            paramsRef.current,
        );
        if (force.x === 0 && force.y === 0) return;

        const dt = Math.min(delta, 1 / 30);
        body.wakeUp();
        body.applyImpulse({ x: force.x * dt, y: force.y * dt, z: 0 }, true);
    });

    return (
        <RigidBody
            ref={bodyRef}
            colliders={false}
            position={position}
            rotation={rotation}
            mass={0.06}
            linearDamping={0.35}
            angularDamping={0.28}
            ccd
            canSleep
        >
            <mesh castShadow receiveShadow geometry={geometry}>
                <meshStandardMaterial
                    color={color}
                    roughness={0.38}
                    metalness={0.08}
                />
            </mesh>
            <RingColliders radius={radius} tube={tube} />
        </RigidBody>
    );
}

export default function Rings() {
    const [seed, setSeed] = useState(1);
    const { count, radius, tube } = useControls("Rings", {
        count: { value: 16, min: 10, max: 20, step: 1 },
        radius: { value: 0.06, min: 0.032, max: 0.07, step: 0.001 },
        tube: { value: 0.014, min: 0.008, max: 0.022, step: 0.001 },
        reshuffle: button(() => setSeed((value) => value + 1)),
    });
    const palette = useControls("Ring Palette", {
        A: "#49cfff",
        B: "#08ac41",
        C: "#ffe017",
        D: "#2f32e5",
    });

    const paletteColors = [palette.A, palette.B, palette.C, palette.D];
    const configs = useMemo(() => makeRingConfigs(count, seed), [count, seed]);
    const geometry = useMemo(
        () =>
            new TorusGeometry(
                radius,
                tube,
                RING_RADIAL_SEGMENTS,
                RING_TUBULAR_SEGMENTS,
            ),
        [radius, tube],
    );

    useEffect(() => {
        return () => geometry.dispose();
    }, [geometry]);

    return (
        <group key={`${seed}-${count}-${radius}-${tube}`}>
            {configs.map((ring) => (
                <TossRing
                    key={ring.id}
                    position={ring.position}
                    rotation={ring.rotation}
                    color={paletteColors[ring.colorIndex]}
                    radius={radius}
                    tube={tube}
                    geometry={geometry}
                />
            ))}
        </group>
    );
}
