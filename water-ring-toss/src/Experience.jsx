import { OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useControls } from "leva";
import { Suspense } from "react";
import { Perf } from "r3f-perf";
import { CROSS_ORIGIN, GameProvider, PLUS_ORIGIN } from "./GameContext";
import RingTossModel from "./RingTossModel";
import Rings from "./Rings";
import Specks from "./Specks";
import TankColliders from "./TankColliders";

function PumpGizmos({ radius }) {
    return (
        <>
            <mesh position={[PLUS_ORIGIN[0], 0.22, PLUS_ORIGIN[2]]}>
                <cylinderGeometry args={[radius, radius, 1.4, 20, 1, true]} />
                <meshBasicMaterial
                    color="#bac400"
                    transparent
                    opacity={0.22}
                    wireframe
                />
            </mesh>
            <mesh position={[CROSS_ORIGIN[0], 0.22, CROSS_ORIGIN[2]]}>
                <cylinderGeometry args={[radius, radius, 1.4, 20, 1, true]} />
                <meshBasicMaterial
                    color="#1d6fd8"
                    transparent
                    opacity={0.22}
                    wireframe
                />
            </mesh>
        </>
    );
}

export default function Experience() {
    const { debug, gravity } = useControls("Physics", {
        debug: false,
        gravity: { value: -0.6, min: -10, max: 0, step: 0.1 },
    });
    const { jetRadius: radius, jetStrength: strength } = useControls("Pump", {
        jetRadius: {
            value: 0.9,
            min: 0.08,
            max: 1.0,
            step: 0.01,
            label: "radius",
        },
        jetStrength: {
            value: 0.3,
            min: 0.01,
            max: 5,
            step: 0.01,
            label: "strength",
        },
    });

    return (
        <>
            <OrbitControls makeDefault />
            {/* <Perf position="top-left" /> */}

            <directionalLight position={[-1.5, 1, 3]} intensity={4.5} />
            <ambientLight intensity={1.5} />

            <Suspense fallback={null}>
                <GameProvider
                    radius={radius}
                    strength={strength}
                    gravity={gravity}
                >
                    <Specks />
                    <Physics gravity={[0, gravity, 0]} debug={debug}>
                        <RingTossModel rotation-y={Math.PI * 0.5} />
                        <TankColliders />
                        <Rings />
                        {debug && <PumpGizmos radius={radius} />}
                    </Physics>
                </GameProvider>
            </Suspense>
        </>
    );
}
