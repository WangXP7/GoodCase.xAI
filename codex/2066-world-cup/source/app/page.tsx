"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ThreeArena, type EngineState } from "./game/ThreeArena";

type Team = "home" | "away";
type Phase = "ready" | "playing" | "paused" | "goal" | "ended";
type Difficulty = "新秀" | "职业" | "传奇";
type Formation = "2-2" | "1-2-1" | "3-1";
type View = "match" | "report" | "leaderboard";

type Player = {
  id: string;
  team: Team;
  number: number;
  name: string;
  role: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  facing: number;
};

type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  lastTouch: Team | null;
};

type MatchStats = {
  homeShots: number;
  awayShots: number;
  homeSaves: number;
  awaySaves: number;
  homePasses: number;
  awayPasses: number;
  homePossession: number;
};

type MatchRecord = {
  id: string;
  date: string;
  score: string;
  result: "胜" | "平" | "负";
  difficulty: Difficulty;
  formation: Formation;
  possession: number;
  shots: string;
  rating: number;
};

const FIELD = { width: 960, height: 560, left: 30, right: 930, top: 30, bottom: 530 };
const GOAL_TOP = 205;
const GOAL_BOTTOM = 355;
const PLAYER_NAMES = ["岳风", "凌川", "周野", "陆星", "江澈"];
const PLAYER_ROLES = ["门将", "后卫", "中场", "边锋", "前锋"];

const FORMATIONS: Record<Formation, Array<[number, number]>> = {
  "2-2": [
    [82, 280],
    [280, 175],
    [280, 385],
    [510, 190],
    [510, 370],
  ],
  "1-2-1": [
    [82, 280],
    [250, 280],
    [410, 170],
    [410, 390],
    [565, 280],
  ],
  "3-1": [
    [82, 280],
    [250, 145],
    [250, 280],
    [250, 415],
    [535, 280],
  ],
};

const initialStats = (): MatchStats => ({
  homeShots: 0,
  awayShots: 0,
  homeSaves: 0,
  awaySaves: 0,
  homePasses: 0,
  awayPasses: 0,
  homePossession: 50,
});

const seededRecords: MatchRecord[] = [
  {
    id: "seed-1",
    date: "07.09 · 22:18",
    score: "4 : 2",
    result: "胜",
    difficulty: "职业",
    formation: "1-2-1",
    possession: 57,
    shots: "9 / 6",
    rating: 8.7,
  },
  {
    id: "seed-2",
    date: "07.08 · 19:42",
    score: "2 : 3",
    result: "负",
    difficulty: "传奇",
    formation: "2-2",
    possession: 48,
    shots: "7 / 8",
    rating: 7.3,
  },
  {
    id: "seed-3",
    date: "07.07 · 20:06",
    score: "3 : 1",
    result: "胜",
    difficulty: "新秀",
    formation: "3-1",
    possession: 63,
    shots: "10 / 4",
    rating: 9.1,
  },
];

const leaderboardBase = [
  ["NOVA_7", "巴西", 2184, "12 连胜"],
  ["北境之光", "法国", 2116, "8 连胜"],
  ["KICKOFF", "阿根廷", 2079, "6 连胜"],
  ["夜航星", "葡萄牙", 2012, "4 连胜"],
  ["白鹿青崖", "德国", 1976, "3 连胜"],
  ["R9-2066", "西班牙", 1928, "2 连胜"],
  ["橙色风暴", "荷兰", 1884, "1 连胜"],
  ["千山", "日本", 1842, "3 胜 1 负"],
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makePlayers(formation: Formation): Player[] {
  const home = FORMATIONS[formation].map(([x, y], index) => ({
    id: `home-${index}`,
    team: "home" as const,
    number: [1, 4, 8, 11, 9][index],
    name: PLAYER_NAMES[index],
    role: PLAYER_ROLES[index],
    x,
    y,
    vx: 0,
    vy: 0,
    baseX: x,
    baseY: y,
    radius: index === 0 ? 16 : 17,
    facing: 0,
  }));
  const away = FORMATIONS[formation].map(([x, y], index) => {
    const mirrorX = FIELD.width - x;
    return {
      id: `away-${index}`,
      team: "away" as const,
      number: [1, 3, 6, 10, 9][index],
      name: ["Vega", "Orion", "Atlas", "Neo", "Rex"][index],
      role: PLAYER_ROLES[index],
      x: mirrorX,
      y,
      vx: 0,
      vy: 0,
      baseX: mirrorX,
      baseY: y,
      radius: index === 0 ? 16 : 17,
      facing: Math.PI,
    };
  });
  return [...home, ...away];
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playersRef = useRef<Player[]>(makePlayers("1-2-1"));
  const ballRef = useRef<Ball>({ x: 480, y: 280, vx: 0, vy: 0, radius: 9, lastTouch: null });
  const keysRef = useRef(new Set<string>());
  const aimRef = useRef({ x: 760, y: 280 });
  const shootRef = useRef(false);
  const passRef = useRef(false);
  const phaseRef = useRef<Phase>("ready");
  const timeRef = useRef(180);
  const scoreRef = useRef({ home: 0, away: 0 });
  const goalPauseRef = useRef(0);
  const selectedRef = useRef(2);
  const possessionTimeRef = useRef({ home: 0, away: 0 });
  const statsRef = useRef<MatchStats>(initialStats());
  const lastFrameRef = useRef(0);
  const lastUiSyncRef = useRef(0);
  const savedMatchRef = useRef(false);
  const difficultyRef = useRef<Difficulty>("职业");
  const audioContextRef = useRef<AudioContext | null>(null);

  const [view, setView] = useState<View>("match");
  const [phase, setPhase] = useState<Phase>("ready");
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [timeLeft, setTimeLeft] = useState(180);
  const [selected, setSelected] = useState(2);
  const [difficulty, setDifficulty] = useState<Difficulty>("职业");
  const [formation, setFormation] = useState<Formation>("1-2-1");
  const [duration, setDuration] = useState(3);
  const [teamColor, setTeamColor] = useState("#19e7b0");
  const [stats, setStats] = useState<MatchStats>(initialStats());
  const [records, setRecords] = useState<MatchRecord[]>(seededRecords);
  const [userName, setUserName] = useState("新星教练");
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState("");
  const [toast, setToast] = useState("锁定你的 5 人阵容，准备开球");
  const [commentary, setCommentary] = useState("世界在看。下一脚，决定历史。");
  const [goalFlash, setGoalFlash] = useState<Team | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [engineState, setEngineState] = useState<EngineState>("loading");
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const storedName = localStorage.getItem("wc2066-user");
        const storedRecords = localStorage.getItem("wc2066-records");
        if (storedName) {
          setUserName(storedName);
          setIsSignedIn(true);
        }
        if (storedRecords) {
          const parsed = JSON.parse(storedRecords) as MatchRecord[];
          if (Array.isArray(parsed) && parsed.length) setRecords(parsed);
        }
      } catch {
        // Local play remains available when browser storage is restricted.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  const playTone = useCallback(
    (kind: "tap" | "kick" | "goal" | "whistle") => {
      if (!soundOn || typeof window === "undefined") return;
      const AudioCtor = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = audioContextRef.current ?? new AudioCtor();
      audioContextRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const frequencies = { tap: 420, kick: 110, goal: 680, whistle: 920 };
      osc.frequency.setValueAtTime(frequencies[kind], now);
      if (kind === "goal") osc.frequency.exponentialRampToValueAtTime(980, now + 0.28);
      if (kind === "whistle") osc.frequency.exponentialRampToValueAtTime(620, now + 0.18);
      gain.gain.setValueAtTime(kind === "tap" ? 0.035 : 0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (kind === "goal" ? 0.45 : 0.18));
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (kind === "goal" ? 0.46 : 0.2));
    },
    [soundOn],
  );

  const resetPositions = useCallback(
    (nextFormation = formation) => {
      playersRef.current = makePlayers(nextFormation);
      ballRef.current = { x: 480, y: 280, vx: 0, vy: 0, radius: 9, lastTouch: null };
      aimRef.current = { x: 760, y: 280 };
      selectedRef.current = 2;
      setSelected(2);
    },
    [formation],
  );

  const finishMatch = useCallback(() => {
    phaseRef.current = "ended";
    setPhase("ended");
    playTone("whistle");
    const home = scoreRef.current.home;
    const away = scoreRef.current.away;
    const result: MatchRecord["result"] = home > away ? "胜" : home < away ? "负" : "平";
    setCommentary(home > away ? "终场！你把名字写进了 2066。" : home < away ? "终场。记住这一刻，然后卷土重来。" : "终场平局。胜负留给下一次交锋。 ");
    if (!savedMatchRef.current) {
      savedMatchRef.current = true;
      const next: MatchRecord = {
        id: `${Date.now()}`,
        date: new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          .format(new Date())
          .replace("/", ".")
          .replace(" ", " · "),
        score: `${home} : ${away}`,
        result,
        difficulty: difficultyRef.current,
        formation,
        possession: statsRef.current.homePossession,
        shots: `${statsRef.current.homeShots} / ${statsRef.current.awayShots}`,
        rating: Number(
          clamp(
            6.2 + (home - away) * 0.45 + statsRef.current.homeShots * 0.09 + statsRef.current.homePossession * 0.012,
            5.8,
            9.9,
          ).toFixed(1),
        ),
      };
      setRecords((current) => {
        const updated = [next, ...current].slice(0, 12);
        try {
          localStorage.setItem("wc2066-records", JSON.stringify(updated));
        } catch {
          // Keep the in-memory record if storage is unavailable.
        }
        return updated;
      });
    }
  }, [formation, playTone]);

  const startMatch = useCallback(() => {
    if (engineState !== "ready") {
      setToast(engineState === "error" ? "3D 引擎未能启动，请刷新页面重试" : "3D 引擎正在同步，请稍候");
      return;
    }
    scoreRef.current = { home: 0, away: 0 };
    statsRef.current = initialStats();
    possessionTimeRef.current = { home: 0, away: 0 };
    timeRef.current = duration * 60;
    savedMatchRef.current = false;
    setScore({ home: 0, away: 0 });
    setStats(initialStats());
    setTimeLeft(duration * 60);
    resetPositions();
    setResetSignal((value) => value + 1);
    phaseRef.current = "playing";
    setPhase("playing");
    setView("match");
    setToast("开球！WASD 移动 · 空格射门 · E 传球");
    setCommentary("哨响！中国 2066 向世界之巅发起冲击。");
    playTone("whistle");
  }, [duration, engineState, playTone, resetPositions]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === "playing") {
      phaseRef.current = "paused";
      setPhase("paused");
      setToast("比赛已暂停");
    } else if (phaseRef.current === "paused") {
      phaseRef.current = "playing";
      setPhase("playing");
      setToast("比赛继续");
    }
    playTone("tap");
  }, [playTone]);

  const cyclePlayer = useCallback(() => {
    const next = (selectedRef.current + 1) % 5;
    selectedRef.current = next;
    setSelected(next);
    setToast(`已切换：${PLAYER_NAMES[next]} · ${PLAYER_ROLES[next]}`);
    playTone("tap");
  }, [playTone]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab", "e", "q", "p"].includes(key)) {
        event.preventDefault();
      }
      keysRef.current.add(key);
      if (event.repeat) return;
      if (key === " " || key === "enter") shootRef.current = true;
      if (key === "e") passRef.current = true;
      if (key === "tab" || key === "q") cyclePlayer();
      if (key === "p") togglePause();
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [cyclePlayer, togglePause]);

  const kickBall = useCallback(
    (team: Team, player: Player, targetX: number, targetY: number, power: number, isPass = false) => {
      const ball = ballRef.current;
      const d = distance(player, ball);
      if (d > player.radius + ball.radius + 22) return false;
      const angle = Math.atan2(targetY - ball.y, targetX - ball.x);
      ball.vx = Math.cos(angle) * power + player.vx * 0.35;
      ball.vy = Math.sin(angle) * power + player.vy * 0.35;
      ball.lastTouch = team;
      player.facing = angle;
      if (isPass) {
        if (team === "home") statsRef.current.homePasses += 1;
        else statsRef.current.awayPasses += 1;
      } else {
        if (team === "home") statsRef.current.homeShots += 1;
        else statsRef.current.awayShots += 1;
      }
      playTone("kick");
      return true;
    },
    [playTone],
  );

  const scoreGoal = useCallback(
    (team: Team) => {
      if (phaseRef.current !== "playing") return;
      phaseRef.current = "goal";
      setPhase("goal");
      goalPauseRef.current = 1.55;
      scoreRef.current = {
        home: scoreRef.current.home + (team === "home" ? 1 : 0),
        away: scoreRef.current.away + (team === "away" ? 1 : 0),
      };
      setScore({ ...scoreRef.current });
      setGoalFlash(team);
      setToast(team === "home" ? "GOAL！这一脚穿越了 2066 的夜空" : "失球。稳住阵脚，马上反击");
      setCommentary(team === "home" ? "球进了！全场沸腾，中国队改写比分！" : "对手抓住了空隙。比赛还没有结束。 ");
      playTone("goal");
      window.setTimeout(() => setGoalFlash(null), 1200);
    },
    [playTone],
  );

  const syncArenaTime = useCallback((seconds: number) => {
    timeRef.current = seconds;
    setTimeLeft(seconds);
  }, []);

  const syncArenaStats = useCallback((nextStats: MatchStats) => {
    statsRef.current = nextStats;
    setStats(nextStats);
  }, []);

  const selectArenaPlayer = useCallback((index: number) => {
    selectedRef.current = index;
    setSelected(index);
  }, []);

  const resumeAfterGoal = useCallback(() => {
    if (timeRef.current <= 0) {
      finishMatch();
      return;
    }
    phaseRef.current = "playing";
    setPhase("playing");
  }, [finishMatch]);

  const updateGame = useCallback(
    (dt: number) => {
      if (phaseRef.current === "goal") {
        goalPauseRef.current -= dt;
        if (goalPauseRef.current <= 0) {
          resetPositions();
          if (timeRef.current <= 0) finishMatch();
          else {
            phaseRef.current = "playing";
            setPhase("playing");
          }
        }
        return;
      }
      if (phaseRef.current !== "playing") return;

      timeRef.current = Math.max(0, timeRef.current - dt);
      if (timeRef.current <= 0) {
        finishMatch();
        return;
      }

      const players = playersRef.current;
      const ball = ballRef.current;
      const selectedPlayer = players[selectedRef.current];
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) dy += 1;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;
      if (dx || dy) {
        const norm = Math.hypot(dx, dy);
        dx /= norm;
        dy /= norm;
        const speed = selectedPlayer.role === "门将" ? 180 : 218;
        selectedPlayer.vx += dx * speed * dt * 8.5;
        selectedPlayer.vy += dy * speed * dt * 8.5;
        selectedPlayer.facing = Math.atan2(dy, dx);
      }

      if (shootRef.current) {
        const target = aimRef.current;
        kickBall("home", selectedPlayer, target.x, target.y, 660, false);
        shootRef.current = false;
      }
      if (passRef.current) {
        const mates = players.slice(0, 5).filter((player) => player.id !== selectedPlayer.id);
        const target = mates.reduce((best, player) => {
          const forwardBias = Math.max(0, player.x - selectedPlayer.x) * 0.65;
          const metric = distance(player, selectedPlayer) - forwardBias;
          return metric < best.metric ? { player, metric } : best;
        }, { player: mates[0], metric: Number.POSITIVE_INFINITY }).player;
        kickBall("home", selectedPlayer, target.x + target.vx * 0.35, target.y + target.vy * 0.35, 430, true);
        passRef.current = false;
      }

      const aiTuning = {
        新秀: { speed: 118, reaction: 0.55, shot: 390 },
        职业: { speed: 158, reaction: 0.76, shot: 495 },
        传奇: { speed: 192, reaction: 0.96, shot: 580 },
      }[difficultyRef.current];

      players.forEach((player, index) => {
        if (index === selectedRef.current) return;
        const isAway = player.team === "away";
        const teamStart = isAway ? 5 : 0;
        const teamEnd = isAway ? 10 : 5;
        const teamPlayers = players.slice(teamStart, teamEnd);
        const closestToBall = teamPlayers.reduce((closest, candidate) =>
          distance(candidate, ball) < distance(closest, ball) ? candidate : closest,
        );
        let targetX = player.baseX;
        let targetY = player.baseY;

        if (player.role === "门将") {
          targetX = isAway ? 902 : 58;
          targetY = clamp(ball.y, GOAL_TOP + 24, GOAL_BOTTOM - 24);
          if (distance(player, ball) < 86) {
            targetX = ball.x;
            targetY = ball.y;
          }
        } else if (closestToBall.id === player.id) {
          const lead = aiTuning.reaction * 0.22;
          targetX = ball.x + ball.vx * lead;
          targetY = ball.y + ball.vy * lead;
        } else {
          const possessionPush = ball.lastTouch === player.team ? (isAway ? -72 : 72) : 0;
          targetX = clamp(player.baseX + (ball.x - 480) * 0.16 + possessionPush, 80, 880);
          targetY = clamp(player.baseY + (ball.y - 280) * 0.22, 70, 490);
        }

        const towardX = targetX - player.x;
        const towardY = targetY - player.y;
        const len = Math.hypot(towardX, towardY) || 1;
        const teammateAssist = isAway ? aiTuning.speed : 132;
        const speed = player.role === "门将" ? teammateAssist * 0.85 : teammateAssist;
        player.vx += (towardX / len) * speed * dt * 5.2;
        player.vy += (towardY / len) * speed * dt * 5.2;
        if (len > 5) player.facing = Math.atan2(towardY, towardX);

        if (isAway && distance(player, ball) < player.radius + ball.radius + 17) {
          if (player.role === "门将") {
            kickBall("away", player, 655, clamp(280 + (Math.random() - 0.5) * 220, 100, 460), 455, true);
            statsRef.current.awaySaves += 1;
          } else if (player.x < 245 || Math.random() < 0.014 * aiTuning.reaction) {
            kickBall("away", player, 0, clamp(280 + (Math.random() - 0.5) * 116, GOAL_TOP + 14, GOAL_BOTTOM - 14), aiTuning.shot, false);
          } else {
            ball.vx -= aiTuning.speed * dt * 5;
            ball.vy += (280 - ball.y) * dt * 1.1;
            ball.lastTouch = "away";
          }
        }
        if (!isAway && player.role === "门将" && distance(player, ball) < player.radius + ball.radius + 18) {
          kickBall("home", player, 410, clamp(280 + (Math.random() - 0.5) * 190, 110, 450), 440, true);
          statsRef.current.homeSaves += 1;
        }
      });

      players.forEach((player) => {
        player.vx *= Math.pow(0.0008, dt);
        player.vy *= Math.pow(0.0008, dt);
        const maxSpeed = player.team === "home" && player.id === selectedPlayer.id ? 230 : aiTuning.speed * 1.05;
        const playerSpeed = Math.hypot(player.vx, player.vy);
        if (playerSpeed > maxSpeed) {
          player.vx = (player.vx / playerSpeed) * maxSpeed;
          player.vy = (player.vy / playerSpeed) * maxSpeed;
        }
        player.x = clamp(player.x + player.vx * dt, FIELD.left + player.radius, FIELD.right - player.radius);
        player.y = clamp(player.y + player.vy * dt, FIELD.top + player.radius, FIELD.bottom - player.radius);
      });

      for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
          const a = players[i];
          const b = players[j];
          const d = distance(a, b);
          const min = a.radius + b.radius;
          if (d > 0 && d < min) {
            const nx = (b.x - a.x) / d;
            const ny = (b.y - a.y) / d;
            const overlap = (min - d) * 0.52;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            const impulse = ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny) * 0.45;
            a.vx += impulse * nx;
            a.vy += impulse * ny;
            b.vx -= impulse * nx;
            b.vy -= impulse * ny;
          }
        }
      }

      players.forEach((player) => {
        const d = distance(player, ball);
        const min = player.radius + ball.radius;
        if (d > 0 && d < min) {
          const nx = (ball.x - player.x) / d;
          const ny = (ball.y - player.y) / d;
          ball.x = player.x + nx * (min + 0.5);
          ball.y = player.y + ny * (min + 0.5);
          const relative = (ball.vx - player.vx) * nx + (ball.vy - player.vy) * ny;
          if (relative < 0) {
            ball.vx -= 1.55 * relative * nx;
            ball.vy -= 1.55 * relative * ny;
          }
          ball.vx += player.vx * 0.34;
          ball.vy += player.vy * 0.34;
          ball.lastTouch = player.team;
        }
      });

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.vx *= Math.pow(0.28, dt);
      ball.vy *= Math.pow(0.28, dt);
      if (Math.abs(ball.vx) < 0.5) ball.vx = 0;
      if (Math.abs(ball.vy) < 0.5) ball.vy = 0;

      const inGoalMouth = ball.y > GOAL_TOP && ball.y < GOAL_BOTTOM;
      if (!inGoalMouth) {
        if (ball.x - ball.radius < FIELD.left) {
          ball.x = FIELD.left + ball.radius;
          ball.vx = Math.abs(ball.vx) * 0.78;
        }
        if (ball.x + ball.radius > FIELD.right) {
          ball.x = FIELD.right - ball.radius;
          ball.vx = -Math.abs(ball.vx) * 0.78;
        }
      }
      if (ball.y - ball.radius < FIELD.top) {
        ball.y = FIELD.top + ball.radius;
        ball.vy = Math.abs(ball.vy) * 0.78;
      }
      if (ball.y + ball.radius > FIELD.bottom) {
        ball.y = FIELD.bottom - ball.radius;
        ball.vy = -Math.abs(ball.vy) * 0.78;
      }
      if (ball.x < 8 && inGoalMouth) scoreGoal("away");
      if (ball.x > FIELD.width - 8 && inGoalMouth) scoreGoal("home");

      if (ball.lastTouch) possessionTimeRef.current[ball.lastTouch] += dt;
      const totalPossession = possessionTimeRef.current.home + possessionTimeRef.current.away;
      if (totalPossession > 0) {
        statsRef.current.homePossession = Math.round((possessionTimeRef.current.home / totalPossession) * 100);
      }
    },
    [finishMatch, kickBall, resetPositions, scoreGoal],
  );

  const drawGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = FIELD;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#0c4939");
    gradient.addColorStop(0.5, "#0a342b");
    gradient.addColorStop(1, "#062821");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (let x = FIELD.left; x < FIELD.right; x += 100) {
      ctx.fillStyle = (x / 100) % 2 === 0 ? "rgba(255,255,255,.018)" : "rgba(0,0,0,.035)";
      ctx.fillRect(x, FIELD.top, 100, FIELD.bottom - FIELD.top);
    }

    ctx.strokeStyle = "rgba(193,255,226,.52)";
    ctx.lineWidth = 2;
    ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top);
    ctx.beginPath();
    ctx.moveTo(width / 2, FIELD.top);
    ctx.lineTo(width / 2, FIELD.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(193,255,226,.62)";
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeRect(FIELD.left, 145, 145, 270);
    ctx.strokeRect(FIELD.right - 145, 145, 145, 270);
    ctx.strokeRect(FIELD.left, 220, 58, 120);
    ctx.strokeRect(FIELD.right - 58, 220, 58, 120);
    ctx.beginPath();
    ctx.arc(144, 280, 65, -0.93, 0.93);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(816, 280, 65, Math.PI - 0.93, Math.PI + 0.93);
    ctx.stroke();

    ctx.fillStyle = "rgba(219,255,240,.09)";
    ctx.fillRect(0, GOAL_TOP, FIELD.left, GOAL_BOTTOM - GOAL_TOP);
    ctx.fillRect(FIELD.right, GOAL_TOP, width - FIELD.right, GOAL_BOTTOM - GOAL_TOP);
    ctx.strokeStyle = "rgba(219,255,240,.4)";
    for (let y = GOAL_TOP; y <= GOAL_BOTTOM; y += 15) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(FIELD.left, y);
      ctx.moveTo(FIELD.right, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const selectedPlayer = playersRef.current[selectedRef.current];
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = "rgba(255,220,91,.42)";
    ctx.beginPath();
    ctx.moveTo(selectedPlayer.x, selectedPlayer.y);
    ctx.lineTo(aimRef.current.x, aimRef.current.y);
    ctx.stroke();
    ctx.restore();

    playersRef.current.forEach((player, index) => {
      const isSelected = index === selectedRef.current;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.shadowBlur = isSelected ? 24 : 9;
      ctx.shadowColor = player.team === "home" ? teamColor : "#ff5d78";
      if (isSelected) {
        ctx.strokeStyle = "#ffe16b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#ffe16b";
        ctx.beginPath();
        ctx.moveTo(Math.cos(player.facing) * 28, Math.sin(player.facing) * 28);
        ctx.lineTo(Math.cos(player.facing + 2.55) * 20, Math.sin(player.facing + 2.55) * 20);
        ctx.lineTo(Math.cos(player.facing - 2.55) * 20, Math.sin(player.facing - 2.55) * 20);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = player.team === "home" ? teamColor : "#ff4e70";
      ctx.beginPath();
      ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = player.team === "home" ? "#baffee" : "#ffd1da";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = player.team === "home" ? "#04241d" : "#2c0710";
      ctx.font = "800 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(player.number), 0, 0.5);
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.fillStyle = "rgba(238,255,249,.82)";
      ctx.fillText(player.name, 0, player.radius + 13);
      ctx.restore();
    });

    const ball = ballRef.current;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(255,255,255,.75)";
    ctx.fillStyle = "#f4fff9";
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#17372d";
    ctx.beginPath();
    ctx.arc(1, -1, 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (phaseRef.current === "paused") {
      ctx.fillStyle = "rgba(1,13,10,.62)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#effff8";
      ctx.font = "900 42px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("比赛暂停", width / 2, height / 2 - 8);
      ctx.font = "500 15px system-ui, sans-serif";
      ctx.fillStyle = "rgba(239,255,248,.7)";
      ctx.fillText("按 P 或点击继续比赛", width / 2, height / 2 + 28);
    }
  }, [teamColor]);

  const handleCanvasPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * FIELD.width;
    const y = ((event.clientY - rect.top) / rect.height) * FIELD.height;
    aimRef.current = { x, y };
    const nearest = playersRef.current.slice(0, 5).reduce((best, player, index) => {
      const d = Math.hypot(player.x - x, player.y - y);
      return d < best.distance ? { index, distance: d } : best;
    }, { index: selectedRef.current, distance: Number.POSITIVE_INFINITY });
    if (nearest.distance < 34) {
      selectedRef.current = nearest.index;
      setSelected(nearest.index);
    }
  }, []);

  const holdKey = (key: string, pressed: boolean) => {
    if (pressed) keysRef.current.add(key);
    else keysRef.current.delete(key);
  };

  const saveProfile = () => {
    const trimmed = profileDraft.trim().slice(0, 14);
    if (!trimmed) {
      setToast("请输入你的球场昵称");
      return;
    }
    setUserName(trimmed);
    setIsSignedIn(true);
    setLoginOpen(false);
    setProfileDraft("");
    setToast(`欢迎归队，${trimmed}`);
    try {
      localStorage.setItem("wc2066-user", trimmed);
    } catch {
      // The local session still works without persistence.
    }
    playTone("tap");
  };

  const applyFormation = (next: Formation) => {
    setFormation(next);
    resetPositions(next);
    setToast(`阵型切换为 ${next}`);
  };

  const wins = records.filter((record) => record.result === "胜").length;
  const draws = records.filter((record) => record.result === "平").length;
  const losses = records.filter((record) => record.result === "负").length;
  const winRate = records.length ? Math.round((wins / records.length) * 100) : 0;
  const avgRating = records.length
    ? (records.reduce((sum, record) => sum + record.rating, 0) / records.length).toFixed(1)
    : "0.0";
  const selectedPlayer = { name: PLAYER_NAMES[selected], role: PLAYER_ROLES[selected] };
  const resultLabel = score.home > score.away ? "荣耀加冕" : score.home < score.away ? "遗憾落败" : "势均力敌";
  const ranking = useMemo(() => {
    const personal = [userName, "中国", 1766 + wins * 34 - losses * 9, `${wins} 胜 ${draws} 平`] as const;
    return [...leaderboardBase.slice(0, 7), personal, ...leaderboardBase.slice(7)]
      .sort((a, b) => Number(b[2]) - Number(a[2]))
      .slice(0, 9);
  }, [draws, losses, userName, wins]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <button className="brand" onClick={() => setView("match")} aria-label="返回比赛">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>
            <strong>2066</strong>
            <small>决战世界杯</small>
          </span>
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button className={view === "match" ? "active" : ""} onClick={() => setView("match")}>赛场</button>
          <button className={view === "report" ? "active" : ""} onClick={() => setView("report")}>战绩</button>
          <button className={view === "leaderboard" ? "active" : ""} onClick={() => setView("leaderboard")}>世界榜</button>
        </nav>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setSoundOn((value) => !value)} aria-label={soundOn ? "关闭声音" : "打开声音"}>
            {soundOn ? "◖)))" : "◖×"}
          </button>
          <button className="profile-button" onClick={() => setLoginOpen(true)}>
            <span className="avatar">{userName.slice(0, 1)}</span>
            <span><small>{isSignedIn ? "国家队教练" : "本地游客"}</small><strong>{userName}</strong></span>
          </button>
        </div>
      </header>

      {view === "match" && (
        <section className="match-layout">
          <aside className="side-panel squad-panel">
            <div className="panel-heading">
              <span><small>TEAM 2066</small><strong>首发阵容</strong></span>
              <em>{formation}</em>
            </div>
            <div className="mini-pitch" aria-label={`当前阵型 ${formation}`}>
              {FORMATIONS[formation].map(([x, y], index) => (
                <button
                  key={`${x}-${y}`}
                  className={index === selected ? "mini-player selected" : "mini-player"}
                  style={{ left: `${(x / FIELD.width) * 100}%`, top: `${(y / FIELD.height) * 100}%` }}
                  onClick={() => { selectedRef.current = index; setSelected(index); }}
                  aria-label={`选择 ${PLAYER_NAMES[index]}`}
                >
                  {[1, 4, 8, 11, 9][index]}
                </button>
              ))}
              <span className="mini-half" />
            </div>
            <div className="player-list">
              {PLAYER_NAMES.map((name, index) => (
                <button
                  key={name}
                  className={index === selected ? "player-row active" : "player-row"}
                  onClick={() => { selectedRef.current = index; setSelected(index); playTone("tap"); }}
                >
                  <span className="kit-number">{[1, 4, 8, 11, 9][index]}</span>
                  <span><strong>{name}</strong><small>{PLAYER_ROLES[index]}</small></span>
                  <i>{index === selected ? "操控中" : `${82 + index * 3}`}</i>
                </button>
              ))}
            </div>
            <div className="tactic-card">
              <small>战术指令</small>
              <strong>高位压迫 · 快速出球</strong>
              <div><span>进攻 76</span><span>防守 68</span></div>
            </div>
          </aside>

          <section className="arena-column">
            <div className="scoreboard" data-testid="scoreboard">
              <div className="team home-team"><span className="flag">中</span><strong>中国 2066</strong><small>HOME</small></div>
              <div className="score-center">
                <span className={phase === "playing" ? "live-dot live" : "live-dot"}>{phase === "playing" ? "LIVE" : phase === "paused" ? "PAUSE" : phase === "goal" ? "GOAL" : phase === "ended" ? "FT" : "READY"}</span>
                <div><strong>{score.home}</strong><i>:</i><strong>{score.away}</strong></div>
                <time>{formatTime(timeLeft)}</time>
              </div>
              <div className="team away-team"><span className="flag rival">世</span><strong>世界明星队</strong><small>AWAY</small></div>
            </div>

            <div className="stadium-frame">
              <div className="stadium-lights"><span /><span /><span /><span /><span /></div>
              <ThreeArena
                phase={phase}
                difficulty={difficulty}
                formation={formation}
                teamColor={teamColor}
                duration={duration}
                resetSignal={resetSignal}
                selected={selected}
                keysRef={keysRef}
                shootRef={shootRef}
                passRef={passRef}
                onSelectedChange={selectArenaPlayer}
                onTimeChange={syncArenaTime}
                onStatsChange={syncArenaStats}
                onGoal={scoreGoal}
                onMatchEnd={finishMatch}
                onResumeAfterGoal={resumeAfterGoal}
                onEngineState={setEngineState}
                onKick={() => playTone("kick")}
              />
              {phase === "ready" && (
                <div className="kickoff-overlay">
                  <span>2066 WORLD CUP</span>
                  <h1>决战，从这一脚开始</h1>
                  <p>操控 5 人国家队，对抗会思考、会协防、会反击的世界明星队。</p>
                  <button className="primary-button hero-button" onClick={startMatch} disabled={engineState !== "ready"} data-testid="start-match">
                    {engineState === "ready" ? "进入比赛" : engineState === "error" ? "引擎离线" : "引擎同步中"} <b>→</b>
                  </button>
                  <small>WASD / 方向键移动 · 空格射门 · E 传球 · Q / Tab 切人</small>
                </div>
              )}
              {goalFlash && <div className={`goal-flash ${goalFlash}`}><span>GOAL</span><strong>{goalFlash === "home" ? "中国 2066" : "世界明星队"}</strong></div>}
              {phase === "ended" && (
                <div className="result-overlay" data-testid="result-overlay">
                  <span>FULL TIME</span>
                  <h2>{resultLabel}</h2>
                  <div className="result-score"><strong>{score.home}</strong><i>:</i><strong>{score.away}</strong></div>
                  <p>控球 {stats.homePossession}% · 射门 {stats.homeShots} · 传球 {stats.homePasses}</p>
                  <div><button className="primary-button" onClick={startMatch}>再战一场</button><button className="ghost-button" onClick={() => setView("report")}>查看战报</button></div>
                </div>
              )}
              <div className="canvas-status"><span>{commentary}</span><i>{difficulty} AI</i></div>
            </div>

            <div className="control-deck">
              <div className="control-hint"><span className="key-cluster"><b>W</b><b>A</b><b>S</b><b>D</b></span><span><strong>移动</strong><small>控制 {selectedPlayer.name}</small></span></div>
              <div className="control-hint"><kbd>SPACE</kbd><span><strong>射门</strong><small>鼠标指向瞄准</small></span></div>
              <div className="control-hint"><kbd>E</kbd><span><strong>传球</strong><small>智能寻找队友</small></span></div>
              <div className="control-hint"><kbd>Q</kbd><span><strong>切换</strong><small>轮换操控球员</small></span></div>
              <div className="match-actions">
                {phase === "ready" || phase === "ended" ? (
                  <button className="primary-button compact" onClick={startMatch} disabled={engineState !== "ready"}>{engineState === "ready" ? "开始比赛" : "3D 引擎同步中"}</button>
                ) : (
                  <button className="ghost-button compact" onClick={togglePause}>{phase === "paused" ? "继续" : "暂停"}</button>
                )}
                <button className="icon-button settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="比赛设置">⚙</button>
              </div>
            </div>

            <div className="touch-controls" aria-label="触屏控制">
              <div className="dpad">
                <button onPointerDown={() => holdKey("w", true)} onPointerUp={() => holdKey("w", false)} onPointerLeave={() => holdKey("w", false)}>↑</button>
                <button onPointerDown={() => holdKey("a", true)} onPointerUp={() => holdKey("a", false)} onPointerLeave={() => holdKey("a", false)}>←</button>
                <button onPointerDown={() => holdKey("s", true)} onPointerUp={() => holdKey("s", false)} onPointerLeave={() => holdKey("s", false)}>↓</button>
                <button onPointerDown={() => holdKey("d", true)} onPointerUp={() => holdKey("d", false)} onPointerLeave={() => holdKey("d", false)}>→</button>
              </div>
              <button className="touch-pass" onPointerDown={() => { passRef.current = true; }}>传球</button>
              <button className="touch-shoot" onPointerDown={() => { shootRef.current = true; }}>射门</button>
              <button className="touch-switch" onClick={cyclePlayer}>切人</button>
              {phase !== "ready" && phase !== "ended" && <button className="touch-pause" onClick={togglePause}>{phase === "paused" ? "继续" : "暂停"}</button>}
              <button className="touch-settings" onClick={() => setSettingsOpen(true)} aria-label="比赛设置">⚙</button>
            </div>
          </section>

          <aside className="side-panel intel-panel">
            <div className="panel-heading">
              <span><small>MATCH INTEL</small><strong>实时情报</strong></span>
              <span className="signal"><i /><i /><i /></span>
            </div>
            <div className="momentum-card">
              <span><small>比赛势能</small><strong>{stats.homePossession >= 50 ? "我们掌控节奏" : "对手正在施压"}</strong></span>
              <em>{stats.homePossession >= 50 ? "+" : "−"}{Math.abs(stats.homePossession - 50)}</em>
              <div><i style={{ width: `${stats.homePossession}%` }} /></div>
              <footer><span>中国 {stats.homePossession}%</span><span>{100 - stats.homePossession}% 世界</span></footer>
            </div>
            <div className="stats-grid">
              <div><small>射门</small><strong>{stats.homeShots}</strong><span>{stats.awayShots}</span></div>
              <div><small>传球</small><strong>{stats.homePasses}</strong><span>{stats.awayPasses}</span></div>
              <div><small>扑救</small><strong>{stats.homeSaves}</strong><span>{stats.awaySaves}</span></div>
              <div><small>比分</small><strong>{score.home}</strong><span>{score.away}</span></div>
            </div>
            <div className="ai-readout">
              <div className="ai-orbit"><span>AI</span><i /><i /><i /></div>
              <span><small>对手决策引擎</small><strong>{phase === "playing" ? "实时推演中" : "等待开球"}</strong><em>{difficulty} · {difficulty === "新秀" ? "基础追踪" : difficulty === "职业" ? "区域协防" : "预判拦截"}</em></span>
            </div>
            <div className="event-feed">
              <small>场边播报</small>
              <p><i className="green" />{toast}</p>
              <p><i className="gold" />{selectedPlayer.name} 已锁定 · {selectedPlayer.role}</p>
              <p><i className="red" />世界明星队采用动态压迫</p>
            </div>
            <button className="settings-card" onClick={() => setSettingsOpen(true)}>
              <span><small>比赛设置</small><strong>{duration} 分钟 · {difficulty} · {formation}</strong></span><b>→</b>
            </button>
          </aside>
        </section>
      )}

      {view === "report" && (
        <section className="dashboard-page">
          <div className="page-title"><span><small>CAREER ARCHIVE</small><h1>你的 2066 征途</h1><p>每一场比赛都留下数据，每一次复盘都让下一脚更坚定。</p></span><button className="primary-button" onClick={() => setView("match")}>返回赛场</button></div>
          <div className="career-overview">
            <article className="career-hero"><span className="avatar large">{userName.slice(0, 1)}</span><div><small>中国 2066 · 主教练</small><h2>{userName}</h2><p>{isSignedIn ? "本地生涯档案已保存" : "登录后保存本地生涯档案"}</p></div><em>RATING<strong>{avgRating}</strong></em></article>
            <article><small>总场次</small><strong>{records.length}</strong><span>记录中的比赛</span></article>
            <article><small>胜率</small><strong>{winRate}%</strong><span>{wins} 胜 · {draws} 平 · {losses} 负</span></article>
            <article><small>最佳战绩</small><strong>{records[0]?.score ?? "—"}</strong><span>{records[0]?.difficulty ?? "等待首战"}难度</span></article>
          </div>
          <div className="report-grid">
            <section className="records-card">
              <header><span><small>MATCH HISTORY</small><strong>近期战绩</strong></span><em>最近 {records.length} 场</em></header>
              <div className="record-list">
                {records.map((record) => (
                  <article key={record.id}>
                    <span className={`result-badge result-${record.result}`}>{record.result}</span>
                    <span><small>{record.date}</small><strong>中国 2066 <b>{record.score}</b> 世界明星队</strong></span>
                    <span className="record-meta"><small>{record.difficulty} · {record.formation}</small><em>控球 {record.possession}% · 射门 {record.shots}</em></span>
                    <strong className="rating">{record.rating}</strong>
                  </article>
                ))}
              </div>
            </section>
            <aside className="insight-stack">
              <article className="radar-card"><header><small>PLAYSTYLE DNA</small><strong>战术画像</strong></header><div className="radar"><i /><i /><i /><i /><span>压迫<strong>84</strong></span><span>控球<strong>71</strong></span><span>终结<strong>78</strong></span><span>防守<strong>66</strong></span></div></article>
              <article className="achievement-card"><span>★</span><div><small>下一里程碑</small><strong>世界前 100</strong><p>再获 {Math.max(1, 5 - (wins % 5))} 场胜利即可解锁金色队徽</p><div><i style={{ width: `${(wins % 5) * 20}%` }} /></div></div></article>
            </aside>
          </div>
        </section>
      )}

      {view === "leaderboard" && (
        <section className="dashboard-page leaderboard-page">
          <div className="page-title"><span><small>GLOBAL RANKING</small><h1>世界之巅，只留强者</h1><p>挑战更高难度、扩大净胜球，向 2066 世界冠军发起冲击。</p></span><button className="primary-button" onClick={() => setView("match")}>发起挑战</button></div>
          <div className="podium">
            {[1, 0, 2].map((rankIndex, visualIndex) => {
              const row = ranking[rankIndex];
              return <article key={String(row[0])} className={`podium-${visualIndex}`}><em>#{rankIndex + 1}</em><span className="avatar large">{String(row[0]).slice(0, 1)}</span><strong>{row[0]}</strong><small>{row[1]} · {row[2]} PTS</small><i>{row[3]}</i></article>;
            })}
          </div>
          <section className="ranking-table">
            <header><span>排名</span><span>球员 / 国家</span><span>积分</span><span>状态</span><span>趋势</span></header>
            {ranking.map((row, index) => (
              <article key={String(row[0])} className={row[0] === userName ? "you" : ""}>
                <strong>#{index + 1}</strong>
                <span><i className="avatar">{String(row[0]).slice(0, 1)}</i><b>{row[0]}<small>{row[1]}</small></b></span>
                <em>{row[2]}</em><span className="streak">{row[3]}</span><span className="trend">{index % 3 === 0 ? "↑ 2" : index % 3 === 1 ? "—" : "↓ 1"}</span>
              </article>
            ))}
          </section>
        </section>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="modal-panel settings-modal" role="dialog" aria-modal="true" aria-label="比赛设置" onMouseDown={(event) => event.stopPropagation()} data-testid="settings-modal">
            <header><span><small>MATCH CONFIG</small><h2>比赛设置</h2></span><button onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button></header>
            <div className="setting-group"><label>AI 难度</label><div className="segmented">{(["新秀", "职业", "传奇"] as Difficulty[]).map((item) => <button key={item} className={difficulty === item ? "active" : ""} onClick={() => { setDifficulty(item); setToast(`AI 难度：${item}`); }}>{item}<small>{item === "新秀" ? "放松" : item === "职业" ? "均衡" : "极限"}</small></button>)}</div></div>
            <div className="setting-group"><label>比赛时长</label><div className="segmented simple">{[1, 3, 5].map((item) => <button key={item} className={duration === item ? "active" : ""} onClick={() => { setDuration(item); if (phaseRef.current === "ready") { timeRef.current = item * 60; setTimeLeft(item * 60); } }}>{item} 分钟</button>)}</div></div>
            <div className="setting-group"><label>首发阵型</label><div className="formation-options">{(["2-2", "1-2-1", "3-1"] as Formation[]).map((item) => <button key={item} className={formation === item ? "active" : ""} onClick={() => applyFormation(item)}><span>{FORMATIONS[item].slice(1).map(([x, y]) => <i key={`${x}-${y}`} style={{ left: `${(x / 640) * 100}%`, top: `${(y / 560) * 100}%` }} />)}</span><strong>{item}</strong></button>)}</div></div>
            <div className="setting-group"><label>主场球衣</label><div className="color-options">{["#19e7b0", "#36a8ff", "#ffe16b", "#f3f7f5"].map((color) => <button key={color} className={teamColor === color ? "active" : ""} style={{ background: color }} onClick={() => setTeamColor(color)} aria-label={`选择球衣颜色 ${color}`} />)}</div></div>
            <footer><button className="ghost-button" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary-button" onClick={() => { setSettingsOpen(false); setToast("比赛设置已生效"); playTone("tap"); }}>应用设置</button></footer>
          </section>
        </div>
      )}

      {loginOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setLoginOpen(false)}>
          <section className="modal-panel login-modal" role="dialog" aria-modal="true" aria-label="创建本地球员档案" onMouseDown={(event) => event.stopPropagation()}>
            <header><span><small>PLAYER ID</small><h2>{isSignedIn ? "编辑球员档案" : "加入 2066 国家队"}</h2></span><button onClick={() => setLoginOpen(false)} aria-label="关闭">×</button></header>
            <div className="identity-mark"><span>66</span><i /><i /></div>
            <p>创建本地球员档案，比赛记录与排行榜位置会保存在这台设备。无需邮箱或密码。</p>
            <label htmlFor="nickname">球场昵称</label>
            <input id="nickname" value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder={userName} maxLength={14} autoFocus />
            <button className="primary-button full" onClick={saveProfile}>{isSignedIn ? "保存档案" : "创建本地账号"}</button>
            <small className="privacy-note">仅保存在浏览器本地，不会上传个人信息。</small>
          </section>
        </div>
      )}

      <footer className="site-footer"><span>2066 WORLD CUP // SIMULATION CORE v2.6</span><span>物理引擎在线 · AI 决策在线 · 本地数据已保护</span></footer>
    </main>
  );
}
