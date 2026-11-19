import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { Color, FrontSide, Object3D } from "three";
import { useGame } from "./GameContext";
import { PUMP_SOURCES, samplePumpForce } from "./pump";

const TANK = {
    minX: -0.78,
    maxX: 0.78,
    minY: -0.6,
    maxY: 1.02,
    minZ: -0.08,
    maxZ: 0.08,
};

const SPECK_RESPONSE = 40;
const FAN_SPREAD = 1.2;
const SETTLE_DURATION = 0.5;
const BACK_SHADE = 0.28;
const EDGE_MARGIN = 0.1;
const EDGE_REACTION = 5;
const _dummy = new Object3D();
const _color = new Color();

function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function makeSpecks(count) {
    const rand = mulberry32(count * 997 + 17);
    const specks = [];

    for (let i = 0; i < count; i++) {
        specks.push({
            x: (rand() - 0.5) * 1.52,
            y: -0.48 + rand() * 1.5,
            z: (rand() - 0.5) * 0.12,
            vx: (rand() - 0.5) * 0.05,
            vy: (rand() - 0.5) * 0.04,
            vz: (rand() - 0.5) * 0.02,
            rx: rand() * Math.PI * 2,
            ry: rand() * Math.PI * 2,
            rz: rand() * Math.PI * 2,
            rvx: (rand() - 0.5) * 3.8,
            rvy: (rand() - 0.5) * 4.6,
            rvz: (rand() - 0.5) * 3.8,
            sizeJitter: 0.55 + rand() * 0.9,
            aspect: 0.62 + rand() * 0.38,
            colorIndex: Math.floor(rand() * 4),
            phase: rand() * Math.PI * 2,
            weight: 0.5 + rand() * 0.5,
            spreadAngle: (rand() - 0.5) * Math.PI * 0.25,
            fan: 0.55 + rand() * 1.25,
            floorTimer: 0,
        });
    }

    return specks;
}

function bounce(value, min, max, vel, restitution) {
    if (value < min) return [min, Math.abs(vel) * restitution];
    if (value > max) return [max, -Math.abs(vel) * restitution];
    return [value, vel];
}

function writeColors(mesh, specks, paletteColors, shade = 1) {
    if (!mesh) return;
    for (let i = 0; i < specks.length; i++) {
        _color.set(paletteColors[specks[i].colorIndex]).multiplyScalar(shade);
        mesh.setColorAt(i, _color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export default function Specks() {
    const { pumpsRef, paramsRef } = useGame();
    const frontRef = useRef();
    const backRef = useRef();
    const paletteKeyRef = useRef("");

    const { count, size } = useControls("Specks", {
        count: { value: 400, min: 40, max: 500, step: 1 },
        size: { value: 0.02, min: 0.004, max: 0.06, step: 0.001 },
    });
    const palette = useControls("Speck Palette", {
        A: "#fff6dc",
        B: "#5eefff",
        C: "#ff6ec7",
        D: "#ffe14a",
    });

    const paletteColors = [palette.A, palette.B, palette.C, palette.D];
    const paletteKey = `${palette.A}|${palette.B}|${palette.C}|${palette.D}`;
    const specks = useMemo(() => makeSpecks(count), [count]);

    useLayoutEffect(() => {
        writeColors(frontRef.current, specks, paletteColors);
        writeColors(backRef.current, specks, paletteColors, BACK_SHADE);
        paletteKeyRef.current = paletteKey;
    }, [specks, paletteKey]);

    useFrame((state, delta) => {
        const fronts = frontRef.current;
        const backs = backRef.current;
        if (!fronts || !backs) return;

        if (paletteKeyRef.current !== paletteKey) {
            writeColors(fronts, specks, paletteColors);
            writeColors(backs, specks, paletteColors, BACK_SHADE);
            paletteKeyRef.current = paletteKey;
        }

        const dt = Math.min(delta, 1 / 30);
        const time = state.clock.elapsedTime;
        const pumps = pumpsRef.current;
        const params = paramsRef.current;
        const gravity = params.gravity ?? -1.2;
        const buoyancy = 0.4;
        const plusLevel = pumps.plus;
        const crossLevel = pumps.cross;
        const pumping = plusLevel > 0.001 || crossLevel > 0.001;

        for (let i = 0; i < specks.length; i++) {
            const p = specks[i];
            const invMass = 1 / p.weight;
            const settle = easeOutCubic(
                Math.min(1, p.floorTimer / SETTLE_DURATION),
            );
            const live = 1 - settle;
            const dampBoost = 1 + settle * 5;

            p.vy += (gravity + buoyancy) * dt * live;
            p.vx += Math.sin(time * 1.15 + p.phase) * 0.1 * dt * live;
            p.vy += Math.sin(time * 0.82 + p.phase * 1.7) * 0.08 * dt * live;
            p.vz += Math.sin(time * 1.4 + p.phase * 0.6) * 0.045 * dt * live;

            let jetLift = 0;
            if (pumping) {
                const force = samplePumpForce(p, pumps, params);
                const response = SPECK_RESPONSE * invMass;
                p.vx += force.x * response * dt;
                p.vy += force.y * response * dt;
                p.vx +=
                    Math.sin(p.spreadAngle) *
                    p.fan *
                    force.y *
                    response *
                    FAN_SPREAD *
                    dt;
                p.vz +=
                    Math.cos(p.spreadAngle) *
                    p.fan *
                    force.y *
                    response *
                    FAN_SPREAD *
                    0.48 *
                    dt;
                jetLift = force.y * response;

                for (const { side, origin } of PUMP_SOURCES) {
                    const level = pumps[side];
                    if (level < 0.001) continue;
                    const dx = p.x - origin[0];
                    const dz = p.z - origin[2];
                    const radial = Math.hypot(dx, dz * 0.35);
                    if (radial > params.radius) continue;
                    const falloff = (1 - radial / params.radius) ** 2;
                    const swirl =
                        params.strength * level * falloff * response * 0.22;
                    p.vx += -dz * swirl * dt;
                    p.vz += dx * swirl * dt;
                }

                for (const edge of [
                    { depth: TANK.minX + EDGE_MARGIN - p.x, dir: 1 },
                    { depth: p.x - (TANK.maxX - EDGE_MARGIN), dir: -1 },
                ]) {
                    if (edge.depth <= 0) continue;
                    const contact = Math.min(1, edge.depth / EDGE_MARGIN) ** 2;
                    const intoWall = -p.vx * edge.dir;
                    if (intoWall > 0) p.vx += intoWall * contact * 0.45 * edge.dir;
                    p.vx += EDGE_REACTION * contact * invMass * dt * edge.dir;
                    p.vy += EDGE_REACTION * contact * invMass * 0.18 * dt;
                }
            }

            p.vx *= Math.exp(-2.05 * dampBoost * dt);
            p.vy *= Math.exp(-1.45 * dampBoost * dt);
            p.vz *= Math.exp(-3.2 * dampBoost * dt);

            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            [p.x, p.vx] = bounce(p.x, TANK.minX, TANK.maxX, p.vx, 0.42);
            [p.z, p.vz] = bounce(p.z, TANK.minZ, TANK.maxZ, p.vz, 0.55);

            if (p.y > TANK.maxY) {
                p.y = TANK.maxY;
                p.vy = -Math.abs(p.vy) * 0.28;
            }

            if (p.y <= TANK.minY) {
                p.y = TANK.minY;
                if (p.vy < 0) p.vy = 0;
                if (jetLift > 0.4) {
                    p.floorTimer = 0;
                } else {
                    p.floorTimer = Math.min(SETTLE_DURATION, p.floorTimer + dt);
                    if (p.floorTimer >= SETTLE_DURATION) {
                        p.vx = 0;
                        p.vy = 0;
                        p.vz = 0;
                    }
                }
            } else {
                p.floorTimer = 0;
            }

            const spin = (1 + Math.hypot(p.vx, p.vy) * 1.6) * live;
            p.rx += p.rvx * spin * dt;
            p.ry += p.rvy * spin * dt;
            p.rz += p.rvz * spin * dt;

            const flakeScale = size * p.sizeJitter;
            _dummy.position.set(p.x, p.y, p.z);
            _dummy.scale.set(flakeScale, flakeScale * p.aspect, 1);

            _dummy.rotation.set(p.rx, p.ry, p.rz);
            _dummy.updateMatrix();
            fronts.setMatrixAt(i, _dummy.matrix);

            _dummy.rotation.set(p.rx, p.ry + Math.PI, p.rz);
            _dummy.updateMatrix();
            backs.setMatrixAt(i, _dummy.matrix);
        }

        fronts.instanceMatrix.needsUpdate = true;
        backs.instanceMatrix.needsUpdate = true;
    });

    return (
        <group key={count} raycast={() => null}>
            <instancedMesh
                ref={frontRef}
                args={[undefined, undefined, count]}
                frustumCulled={false}
                raycast={() => null}
            >
                <planeGeometry args={[1, 1]} />
                <meshStandardMaterial
                    side={FrontSide}
                    roughness={0.42}
                    metalness={0.08}
                />
            </instancedMesh>
            <instancedMesh
                ref={backRef}
                args={[undefined, undefined, count]}
                frustumCulled={false}
                raycast={() => null}
            >
                <planeGeometry args={[1, 1]} />
                <meshStandardMaterial
                    side={FrontSide}
                    roughness={0.55}
                    metalness={0.04}
                />
            </instancedMesh>
        </group>
    );
}
