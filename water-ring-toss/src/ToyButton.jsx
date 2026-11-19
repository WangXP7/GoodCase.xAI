import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGame } from "./GameContext";

const PRESS_DURATION = 0.12;
const RELEASE_DURATION = 0.22;
const MAX_FORCE_DURATION = 0.35;

function easeOutCubic(t) {
    const x = Math.min(Math.max(t, 0), 1);
    return 1 - (1 - x) ** 3;
}

export default function ToyButton({
    side,
    geometry,
    color,
    restPosition,
    restRotation = [0, 0, 0],
    pressOffset = [0.03, 0, 0],
    normalMap,
    roughnessMap,
    hotkey,
}) {
    const meshRef = useRef();
    const { setPumpLevel, triggerBurst, pumpsRef } = useGame();
    const controls = useThree((state) => state.controls);
    const anim = useRef({
        from: 0,
        to: 0,
        start: 0,
        duration: PRESS_DURATION,
        holding: false,
        pressedAt: 0,
    });

    const sampleLevel = () => {
        const current = anim.current;
        const elapsed =
            current.duration <= 0
                ? 1
                : (performance.now() * 0.001 - current.start) /
                  current.duration;
        return (
            current.from + (current.to - current.from) * easeOutCubic(elapsed)
        );
    };

    const startAnim = (to, duration) => {
        anim.current.from = sampleLevel();
        anim.current.to = to;
        anim.current.start = performance.now() * 0.001;
        anim.current.duration = duration;
    };

    const press = useCallback(() => {
        anim.current.holding = true;
        anim.current.pressedAt = performance.now() * 0.001;
        if (controls) controls.enabled = false;
        startAnim(1, PRESS_DURATION);
        triggerBurst(side);
    }, [controls, side, triggerBurst]);

    const release = useCallback(() => {
        if (!anim.current.holding) return;
        anim.current.holding = false;
        if (controls) controls.enabled = true;
        startAnim(0, RELEASE_DURATION);
        document.body.style.cursor = "auto";
    }, [controls]);

    useFrame((_, delta) => {
        if (
            anim.current.holding &&
            performance.now() * 0.001 - anim.current.pressedAt >=
                MAX_FORCE_DURATION
        ) {
            release();
        }
        const level = sampleLevel();
        const burstKey = `${side}Burst`;
        let burst = pumpsRef.current[burstKey] || 0;
        if (burst > 0) {
            burst = Math.max(0, burst - delta * 4.2);
            pumpsRef.current[burstKey] = burst;
        }
        setPumpLevel(side, Math.max(level, burst));
        const mesh = meshRef.current;
        if (!mesh) return;
        mesh.position.set(
            restPosition[0] + pressOffset[0] * level,
            restPosition[1] + pressOffset[1] * level,
            restPosition[2] + pressOffset[2] * level,
        );
    });

    useEffect(() => {
        const onUp = () => release();
        const onKeyDown = (event) => {
            if (event.repeat) return;
            const matchesCode = event.code === hotkey;
            const matchesKey =
                (side === "plus" && event.key.toLowerCase() === "e") ||
                (side === "cross" && event.key.toLowerCase() === "q");
            if (!matchesCode && !matchesKey) return;
            press();
        };
        const onKeyUp = (event) => {
            const matchesCode = event.code === hotkey;
            const matchesKey =
                (side === "plus" && event.key.toLowerCase() === "e") ||
                (side === "cross" && event.key.toLowerCase() === "q");
            if (!matchesCode && !matchesKey) return;
            release();
        };
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            setPumpLevel(side, 0);
            document.body.style.cursor = "auto";
        };
    }, [hotkey, press, release, setPumpLevel, side]);

    const pointerDown = (event) => {
        event.stopPropagation();
        press();
    };

    return (
        <group>
            <mesh
                ref={meshRef}
                castShadow
                receiveShadow
                geometry={geometry}
                position={restPosition}
                rotation={restRotation}
            >
                <meshStandardMaterial
                    color={color}
                    roughness={1}
                    metalness={0.1}
                    normalMap={normalMap}
                    roughnessMap={roughnessMap}
                />
            </mesh>
            <mesh
                position={[
                    restPosition[0] - 0.04,
                    restPosition[1],
                    restPosition[2],
                ]}
                onPointerOver={(event) => {
                    event.stopPropagation();
                    document.body.style.cursor = "pointer";
                }}
                onPointerOut={() => {
                    if (!anim.current.holding) {
                        document.body.style.cursor = "auto";
                    }
                }}
                onPointerDown={pointerDown}
                onContextMenu={(event) => event.nativeEvent.preventDefault()}
            >
                <sphereGeometry args={[0.15, 12, 12]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
        </group>
    );
}
