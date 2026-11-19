import { CROSS_ORIGIN, PLUS_ORIGIN } from "./GameContext";

export const PUMP_SOURCES = [
    { side: "plus", origin: PLUS_ORIGIN },
    { side: "cross", origin: CROSS_ORIGIN },
];

export function samplePumpForce(pos, pumps, params) {
    let impulseX = 0;
    let impulseY = 0;

    for (const { side, origin } of PUMP_SOURCES) {
        const level = pumps[side];
        if (level < 0.001) continue;

        const dx = pos.x - origin[0];
        const dz = pos.z - origin[2];
        const radial = Math.hypot(dx, dz * 0.35);
        const { radius: pumpRadius, strength } = params;
        if (radial > pumpRadius) continue;

        const radialFalloff = (1 - radial / pumpRadius) ** 2;
        const height = pos.y - origin[1];
        const heightFalloff =
            height < -0.1 ? 0.4 : Math.exp(-Math.max(height, 0) * 0.85);
        const topFade = pos.y > 0.88 ? Math.max(0, 1.2 - pos.y) : 1;
        const sideGate =
            origin[0] > 0 ? (pos.x < -0.12 ? 0 : 1) : pos.x > 0.12 ? 0 : 1;
        const force =
            strength *
            level *
            radialFalloff *
            heightFalloff *
            topFade *
            sideGate;

        impulseY += force;
        impulseX += (origin[0] > 0 ? -0.18 : 0.18) * force;
        impulseX += Math.sin(pos.y * 14 + origin[0] * 9) * 0.06 * force;
    }

    return { x: impulseX, y: impulseY, z: 0 };
}
