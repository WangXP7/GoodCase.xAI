import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";

const MODEL_YAW = [0, Math.PI / 2, 0];

export default function TankColliders() {
    const { nodes } = useGLTF("./WaterRingGame3.glb");

    return (
        <>
            <RigidBody
                type="fixed"
                colliders="trimesh"
                includeInvisible
                rotation={MODEL_YAW}
            >
                <mesh
                    visible={false}
                    geometry={nodes.WaterContainer.geometry}
                />
            </RigidBody>
            <RigidBody
                type="fixed"
                colliders="trimesh"
                includeInvisible
                rotation={MODEL_YAW}
                friction={0.01}
            >
                <mesh
                    visible={false}
                    geometry={nodes.Fixtures.geometry}
                    position={[0, -0.473, 0]}
                />
            </RigidBody>
            <RigidBody type="fixed" colliders={false}>
                <CuboidCollider
                    args={[0.84, 0.05, 0.12]}
                    position={[0, -0.65, 0]}
                    friction={0.4}
                />
                <CuboidCollider
                    args={[0.84, 0.05, 0.12]}
                    position={[0, 1.14, 0]}
                    friction={0.2}
                />
                <CuboidCollider
                    args={[0.84, 0.9, 0.012]}
                    position={[0, 0.245, 0.112]}
                    friction={0.35}
                />
                <CuboidCollider
                    args={[0.84, 0.9, 0.012]}
                    position={[0, 0.245, -0.112]}
                    friction={0.35}
                />
                <CuboidCollider
                    args={[0.02, 0.9, 0.12]}
                    position={[-0.81, 0.245, 0]}
                    friction={0.35}
                />
                <CuboidCollider
                    args={[0.02, 0.9, 0.12]}
                    position={[0.81, 0.245, 0]}
                    friction={0.35}
                />
            </RigidBody>
        </>
    );
}

useGLTF.preload("/WaterRingGame3.glb");
