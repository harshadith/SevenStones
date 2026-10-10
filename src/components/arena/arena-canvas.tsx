"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { gameAudio } from "@/lib/game/audio";
import { MAX_STACK } from "@/lib/game/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GameState, RoomMember, Team } from "@/lib/supabase/database.types";

export type ArenaCanvasProps = {
  roomId: string;
  userId: string;
  myTeam: Team;
  gameState: GameState;
  members: RoomMember[];
  profiles: Record<string, string>;
  onTriggerAction: (actionType: string, payload: Record<string, unknown>) => void;
  isHost: boolean;
};

// Field Constants
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 560;
const CENTER_X = CANVAS_WIDTH / 2;
const CENTER_Y = CANVAS_HEIGHT / 2;
const PEDESTAL_RADIUS = 38;
const BOUNDARY_PADDING = 24;

// Visual Stone Palettes (1 = base / largest, 7 = summit / smallest)
const STONE_COLORS = [
  { fill: "#94a3b8", stroke: "#64748b", text: "#0f172a", radius: 24, name: "Base Rock" },      // 1
  { fill: "#38bdf8", stroke: "#0284c7", text: "#082f49", radius: 22, name: "Aqua Slate" },     // 2
  { fill: "#34d399", stroke: "#059669", text: "#022c22", radius: 20, name: "Jade Pebble" },    // 3
  { fill: "#facc15", stroke: "#ca8a04", text: "#422006", radius: 18, name: "Amber Shale" },    // 4
  { fill: "#fb923c", stroke: "#ea580c", text: "#431407", radius: 16, name: "Terracotta" },     // 5
  { fill: "#f472b6", stroke: "#db2777", text: "#500724", radius: 14, name: "Rose Quartz" },    // 6
  { fill: "#c084fc", stroke: "#9333ea", text: "#3b0764", radius: 12, name: "Crown Gem" },      // 7
];

type StoneEntity = {
  id: number; // 1 to 7
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX?: number;
  targetY?: number;
  rotation: number;
  vRot: number;
  radius: number;
  isStacked: boolean;
  carrierId: string | null;
};

type BallEntity = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  holderId: string | null;
  lastThrowerTeam: Team | null;
  speed: number;
};

type PlayerEntity = {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX?: number;
  targetY?: number;
  radius: number;
  facingAngle: number;
  targetFacingAngle?: number;
  isLocal: boolean;
  isTagged: boolean;
  carryingStoneId: number | null;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  alpha: number;
  decay: number;
};

type FloatingText = {
  id: string;
  text: string;
  x: number;
  y: number;
  vy: number;
  color: string;
  alpha: number;
};

export function ArenaCanvas({
  roomId,
  userId,
  myTeam,
  gameState,
  members,
  profiles,
  onTriggerAction,
  isHost,
}: ArenaCanvasProps) {
  const supabase = useMemo(() => createClient(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isChannelReady = useRef<boolean>(false);

  // Audio & UI state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [chargeProgress, setChargeProgress] = useState(0);
  const [hudMessage, setHudMessage] = useState<string>("Use WASD to move. Aim with mouse.");
  const [nextStoneNeeded, setNextStoneNeeded] = useState<number>(1);
  const [liveSynced, setLiveSynced] = useState<boolean>(false);

  // Win State & Scoreboard
  const [roundWinner, setRoundWinner] = useState<"seekers" | "guardians" | null>(null);
  const [scores, setScores] = useState({
    seekers: gameState.seekers_score,
    guardians: gameState.guardians_score,
  });

  // Entities references
  const playersRef = useRef<Map<string, PlayerEntity>>(new Map());
  const stonesRef = useRef<StoneEntity[]>([]);
  const ballRef = useRef<BallEntity>({
    x: 200,
    y: CENTER_Y,
    vx: 0,
    vy: 0,
    radius: 10,
    holderId: null,
    lastThrowerTeam: null,
    speed: 0,
  });
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);

  // Input tracking
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const mouseRef = useRef<{
    x: number;
    y: number;
    isDown: boolean;
    chargeStart: number;
    currentPower: number;
  }>({
    x: CENTER_X,
    y: CENTER_Y,
    isDown: false,
    chargeStart: 0,
    currentPower: 0,
  });

  const localPhaseRef = useRef<string>(gameState.phase);
  localPhaseRef.current = gameState.phase;

  // Track whether the opening seeker has made the first throw
  const initialThrowDoneRef = useRef<boolean>(false);

  // Broadcast throttles
  const lastPlayerSyncTime = useRef<number>(0);
  const lastWorldSyncTime = useRef<number>(0);

  // Keep scores updated with gameState
  useEffect(() => {
    setScores({
      seekers: gameState.seekers_score,
      guardians: gameState.guardians_score,
    });
    if (gameState.phase === "seekers_win") {
      setRoundWinner("seekers");
    } else if (gameState.phase === "guardians_win") {
      setRoundWinner("guardians");
    } else {
      setRoundWinner(null);
    }
  }, [gameState.seekers_score, gameState.guardians_score, gameState.phase]);

  // Sync Audio Setting
  useEffect(() => {
    gameAudio.enabled = soundEnabled;
  }, [soundEnabled]);

  // Safe Realtime Broadcast Sender
  const sendBroadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!isChannelReady.current || !channelRef.current) return;
    try {
      void channelRef.current.send({
        type: "broadcast",
        event,
        payload,
      });
    } catch {
      // Disconnected catch
    }
  }, []);

  // Spawn Dust / Impact Particles
  const spawnParticles = useCallback((x: number, y: number, color: string, count: number = 8, speed: number = 2) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (Math.random() * 0.7 + 0.3) * speed;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        radius: Math.random() * 3 + 1.5,
        alpha: 1,
        decay: Math.random() * 0.03 + 0.02,
      });
    }
  }, []);

  const addFloatingText = useCallback((text: string, x: number, y: number, color: string = "#facc15") => {
    floatingTextsRef.current.push({
      id: Math.random().toString(),
      text,
      x,
      y,
      vy: -0.8,
      color,
      alpha: 1,
    });
  }, []);

  // Initialize or Reset Stones
  const initStones = useCallback((stacked: boolean = true) => {
    const list: StoneEntity[] = [];
    for (let i = 1; i <= MAX_STACK; i++) {
      const info = STONE_COLORS[i - 1];
      list.push({
        id: i,
        x: CENTER_X,
        y: CENTER_Y,
        vx: 0,
        vy: 0,
        rotation: 0,
        vRot: 0,
        radius: info.radius,
        isStacked: stacked,
        carrierId: null,
      });
    }
    stonesRef.current = list;
    setNextStoneNeeded(stacked ? 8 : 1);
  }, []);

  // Initialize Players (NO BOTS — Real Human Members Only)
  const initPlayers = useCallback(() => {
    const pMap = new Map<string, PlayerEntity>();

    // Self Player
    const selfName = profiles[userId] || "You";
    const selfTeam = myTeam || "seekers";

    pMap.set(userId, {
      id: userId,
      name: selfName,
      team: selfTeam,
      x: selfTeam === "seekers" ? 180 : 700,
      y: CENTER_Y,
      vx: 0,
      vy: 0,
      radius: 18,
      facingAngle: 0,
      isLocal: true,
      isTagged: false,
      carryingStoneId: null,
    });

    // Human Room Members
    members.forEach((m) => {
      if (m.user_id !== userId) {
        const team = m.team || "guardians";
        pMap.set(m.user_id, {
          id: m.user_id,
          name: profiles[m.user_id] || (team === "seekers" ? "Seeker" : "Guardian"),
          team,
          x: team === "seekers" ? 180 + Math.random() * 40 : 680 + Math.random() * 40,
          y: 160 + Math.random() * 240,
          vx: 0,
          vy: 0,
          radius: 18,
          facingAngle: Math.PI,
          isLocal: false,
          isTagged: (gameState.tagged_seekers ?? []).includes(m.user_id),
          carryingStoneId: null,
        });
      }
    });

    playersRef.current = pMap;
  }, [userId, myTeam, profiles, members, gameState.tagged_seekers]);

  // Keep members updated in real-time when someone joins
  useEffect(() => {
    const pMap = playersRef.current;
    members.forEach((m) => {
      if (!pMap.has(m.user_id)) {
        const isLocal = m.user_id === userId;
        const team = m.team || "guardians";
        pMap.set(m.user_id, {
          id: m.user_id,
          name: profiles[m.user_id] || (team === "seekers" ? "Seeker" : "Guardian"),
          team,
          x: team === "seekers" ? 180 + Math.random() * 40 : 680 + Math.random() * 40,
          y: 180 + Math.random() * 200,
          vx: 0,
          vy: 0,
          radius: 18,
          facingAngle: team === "seekers" ? 0 : Math.PI,
          isLocal,
          isTagged: (gameState.tagged_seekers ?? []).includes(m.user_id),
          carryingStoneId: null,
        });
      } else {
        const p = pMap.get(m.user_id)!;
        if (profiles[m.user_id]) p.name = profiles[m.user_id];
        if (m.team) p.team = m.team;
        p.isTagged = (gameState.tagged_seekers ?? []).includes(m.user_id);
      }
    });
  }, [members, profiles, userId, gameState.tagged_seekers]);

  // Setup / Reset round (stable callback, does not recreate on prop changes)
  const resetRound = useCallback((resetPhase: "throwing" | "broken" = "throwing") => {
    initStones(resetPhase === "throwing");

    // Reset player positions to starting boundaries
    playersRef.current.forEach((p) => {
      p.vx = 0;
      p.vy = 0;
      p.isTagged = false;
      p.carryingStoneId = null;
      if (p.team === "seekers") {
        p.x = 180;
        p.y = CENTER_Y;
        p.facingAngle = 0;
      } else {
        p.x = 700;
        p.y = CENTER_Y;
        p.facingAngle = Math.PI;
      }
    });

    const allPlayers = Array.from(playersRef.current.values());
    const seekers = allPlayers.filter((p) => p.team === "seekers" && !p.isTagged);
    const chosenSeeker = seekers.find((s) => s.isLocal) || seekers[0] || allPlayers[0];

    ballRef.current = {
      x: chosenSeeker ? chosenSeeker.x + 20 : 180,
      y: chosenSeeker ? chosenSeeker.y : CENTER_Y,
      vx: 0,
      vy: 0,
      radius: 10,
      holderId: resetPhase === "throwing" && chosenSeeker ? chosenSeeker.id : null,
      lastThrowerTeam: resetPhase === "throwing" ? "seekers" : null,
      speed: 0,
    };

    setRoundWinner(null);
    setChargeProgress(0);
    initialThrowDoneRef.current = false;
    mouseRef.current.isDown = false;
    mouseRef.current.currentPower = 0;

    if (resetPhase === "throwing") {
      setHudMessage(
        chosenSeeker?.isLocal
          ? "🎯 YOU HAVE THE BALL! Aim with mouse, HOLD left click to charge power, and RELEASE to throw at the stones!"
          : `${chosenSeeker?.name ?? "Seeker"} is preparing to throw at the stones stack!`
      );
    } else {
      setHudMessage("⚔️ Stack broken! Guardians: grab ball & throw at seekers! Seekers: stack stones 1→7!");
    }
  }, [initStones]);

  // Initial Mount Only
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      initPlayers();
      const isStackIntact = gameState.phase === "waiting" || gameState.phase === "throwing";
      resetRound(isStackIntact ? "throwing" : "broken");
    }
  }, [initPlayers, resetRound, gameState.phase]);

  // Safe Phase Transition Handler — Only runs when phase ACTUALLY changes
  const prevPhaseRef = useRef<string>(gameState.phase);
  useEffect(() => {
    if (prevPhaseRef.current !== gameState.phase) {
      const prev = prevPhaseRef.current;
      prevPhaseRef.current = gameState.phase;

      // Only reset when explicitly transitioning from a win or waiting phase into a new throwing round
      if (
        (prev === "seekers_win" || prev === "guardians_win" || prev === "waiting") &&
        gameState.phase === "throwing"
      ) {
        resetRound("throwing");
      } else if (gameState.phase === "seekers_win") {
        setRoundWinner("seekers");
      } else if (gameState.phase === "guardians_win") {
        setRoundWinner("guardians");
      }
    }
  }, [gameState.phase, resetRound]);

  // Trigger Play Again
  const handlePlayAgain = useCallback(() => {
    // 1. Reset round locally
    resetRound("throwing");
    setRoundWinner(null);

    // 2. Call Supabase action to restart game in database
    onTriggerAction("start_game", {});

    // 3. Broadcast next_round to all peers
    sendBroadcast("next_round", {});
  }, [resetRound, onTriggerAction, sendBroadcast]);

  // Trigger scatter animation on stones
  const triggerScatter = useCallback((impulseX: number, impulseY: number, broadcast: boolean = true) => {
    initialThrowDoneRef.current = true;
    gameAudio.playScatter();
    spawnParticles(CENTER_X, CENTER_Y, "#f59e0b", 25, 4.5);
    spawnParticles(CENTER_X, CENTER_Y, "#94a3b8", 30, 3.8);
    addFloatingText("💥 STONES SCATTERED!", CENTER_X, CENTER_Y - 40, "#f97316");

    stonesRef.current.forEach((st, idx) => {
      st.isStacked = false;
      st.carrierId = null;
      const spreadAngle = (idx - 3) * (Math.PI / 4) + (Math.random() - 0.5) * 0.4;
      const baseAngle = Math.atan2(impulseY, impulseX) + spreadAngle;
      const speed = Math.random() * 5 + 4.5;
      st.vx = Math.cos(baseAngle) * speed;
      st.vy = Math.sin(baseAngle) * speed;
      st.vRot = (Math.random() - 0.5) * 0.3;
    });

    setNextStoneNeeded(1);
    setHudMessage("🏃 SEEKERS: Stack stones 1 to 7 in order! GUARDIANS: Grab the ball and tag the seekers!");

    if (broadcast) {
      sendBroadcast("stone_scatter", { impulseX, impulseY });
    }
  }, [addFloatingText, spawnParticles, sendBroadcast]);

  // Stack a stone onto the center pedestal
  const stackNextStone = useCallback((stoneId: number, player: PlayerEntity, broadcast: boolean = true) => {
    const stone = stonesRef.current.find((s) => s.id === stoneId);
    if (!stone) return;

    stone.isStacked = true;
    stone.carrierId = null;
    stone.vx = 0;
    stone.vy = 0;
    stone.x = CENTER_X;
    stone.y = CENTER_Y;
    player.carryingStoneId = null;

    gameAudio.playStonePlaced(stoneId - 1);
    spawnParticles(CENTER_X, CENTER_Y, STONE_COLORS[stoneId - 1].fill, 16, 2.5);
    addFloatingText(`Stone #${stoneId} Stacked! [${stoneId}/7]`, CENTER_X, CENTER_Y - 30, STONE_COLORS[stoneId - 1].fill);

    const stackedCount = stonesRef.current.filter((s) => s.isStacked).length;
    setNextStoneNeeded(stackedCount + 1);

    if (broadcast) {
      onTriggerAction("rebuild_stone", {});
      sendBroadcast("stone_stacked", { stoneId, carrierId: player.id });
    }

    if (stackedCount >= MAX_STACK) {
      gameAudio.playWin(true);
      setRoundWinner("seekers");
      setScores((prev) => ({ ...prev, seekers: prev.seekers + 1 }));
      addFloatingText("🏆 PITTHU! SEEKERS WIN!", CENTER_X, CENTER_Y - 60, "#10b981");
      setHudMessage("🎉 PITTHU! Seekers arranged all seven stones and won the match!");
      spawnParticles(CENTER_X, CENTER_Y, "#10b981", 60, 6);
      spawnParticles(CENTER_X, CENTER_Y, "#facc15", 50, 5);
    } else {
      setHudMessage(`✅ Stone #${stoneId} stacked! Bring Stone #${stackedCount + 1} next!`);
    }
  }, [addFloatingText, onTriggerAction, spawnParticles, sendBroadcast]);

  // Seeker hit by ball -> Guardians Win!
  const handleSeekerTagged = useCallback((seeker: PlayerEntity, broadcast: boolean = true) => {
    gameAudio.playTagHit();
    seeker.isTagged = true;
    spawnParticles(seeker.x, seeker.y, "#ef4444", 30, 4.5);
    addFloatingText(`💥 ${seeker.name} HIT!`, seeker.x, seeker.y - 35, "#ef4444");

    if (broadcast) {
      onTriggerAction("tag_player", { targetId: seeker.id });
      sendBroadcast("seeker_tagged", { seekerId: seeker.id });
    }

    gameAudio.playWin(false);
    setRoundWinner("guardians");
    setScores((prev) => ({ ...prev, guardians: prev.guardians + 1 }));
    setHudMessage(`🛡️ GUARDIANS WIN! ${seeker.name} was hit by the ball before stones could be stacked!`);
    spawnParticles(seeker.x, seeker.y, "#f59e0b", 50, 5.5);
  }, [addFloatingText, onTriggerAction, spawnParticles, sendBroadcast]);

  // Throw Ball Function
  const throwBall = useCallback((thrower: PlayerEntity, targetX: number, targetY: number, powerFactor: number, broadcast: boolean = true) => {
    const ball = ballRef.current;
    if (ball.holderId !== thrower.id) return;

    const dx = targetX - thrower.x;
    const dy = targetY - thrower.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;

    const power = Math.max(0.15, Math.min(1, powerFactor));
    const throwSpeed = 5.5 + power * 9.0;

    ball.holderId = null;
    ball.x = thrower.x + dirX * (thrower.radius + ball.radius + 3);
    ball.y = thrower.y + dirY * (thrower.radius + ball.radius + 3);
    ball.vx = dirX * throwSpeed;
    ball.vy = dirY * throwSpeed;
    ball.speed = throwSpeed;
    ball.lastThrowerTeam = thrower.team;

    // The moment the initial seeker throws, mark initial throw as done
    if (thrower.team === "seekers") {
      initialThrowDoneRef.current = true;
    }

    gameAudio.playThrow(power);
    spawnParticles(ball.x, ball.y, "#fb923c", 10, 2);

    if (broadcast) {
      if (thrower.team === "seekers" && localPhaseRef.current === "throwing") {
        onTriggerAction("throw", { hit: false, aim: Math.round(power * 100) });
      }

      sendBroadcast("ball_throw", {
        throwerId: thrower.id,
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
        power,
        initialThrowDone: initialThrowDoneRef.current,
      });
    }
  }, [onTriggerAction, spawnParticles, sendBroadcast]);

  // Callback refs to keep the channel subscription purely persistent
  const throwBallRef = useRef(throwBall);
  throwBallRef.current = throwBall;
  const triggerScatterRef = useRef(triggerScatter);
  triggerScatterRef.current = triggerScatter;
  const stackNextStoneRef = useRef(stackNextStone);
  stackNextStoneRef.current = stackNextStone;
  const handleSeekerTaggedRef = useRef(handleSeekerTagged);
  handleSeekerTaggedRef.current = handleSeekerTagged;
  const resetRoundRef = useRef(resetRound);
  resetRoundRef.current = resetRound;
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  // =========================================================================
  // SUPABASE REALTIME BROADCAST CHANNEL (LIVE MULTIPLAYER)
  // =========================================================================
  useEffect(() => {
    const channel = supabase.channel(`arena_sync:${roomId}`, {
      config: {
        broadcast: { self: false },
      },
    });

    channel
      .on("broadcast", { event: "player_move" }, ({ payload }) => {
        if (!payload || payload.id === userId) return;
        let p = playersRef.current.get(payload.id);
        if (!p) {
          const team = payload.team || "guardians";
          p = {
            id: payload.id,
            name: profilesRef.current[payload.id] || "Player",
            team,
            x: payload.x,
            y: payload.y,
            vx: payload.vx,
            vy: payload.vy,
            radius: 18,
            facingAngle: payload.facingAngle,
            isLocal: false,
            isTagged: Boolean(payload.isTagged),
            carryingStoneId: payload.carryingStoneId ?? null,
          };
          playersRef.current.set(payload.id, p);
        } else {
          p.targetX = payload.x;
          p.targetY = payload.y;
          p.vx = payload.vx;
          p.vy = payload.vy;
          p.targetFacingAngle = payload.facingAngle;
          p.carryingStoneId = payload.carryingStoneId ?? null;
          p.isTagged = Boolean(payload.isTagged);
        }
      })
      .on("broadcast", { event: "world_sync" }, ({ payload }) => {
        if (isHost || !payload) return;

        // Sync Ball (if not held by local player)
        if (payload.ball && ballRef.current.holderId !== userId) {
          ballRef.current.x = payload.ball.x;
          ballRef.current.y = payload.ball.y;
          ballRef.current.vx = payload.ball.vx;
          ballRef.current.vy = payload.ball.vy;
          ballRef.current.holderId = payload.ball.holderId;
          ballRef.current.lastThrowerTeam = payload.ball.lastThrowerTeam;
          ballRef.current.speed = Math.hypot(payload.ball.vx, payload.ball.vy);
        }

        // Sync Stones
        if (Array.isArray(payload.stones)) {
          payload.stones.forEach((stData: { id: number; x: number; y: number; isStacked: boolean; carrierId: string | null }) => {
            const st = stonesRef.current.find((s) => s.id === stData.id);
            if (st && !st.carrierId) {
              st.targetX = stData.x;
              st.targetY = stData.y;
              st.isStacked = Boolean(stData.isStacked);
              st.carrierId = stData.carrierId ?? null;
            }
          });
        }
      })
      .on("broadcast", { event: "ball_throw" }, ({ payload }) => {
        if (!payload) return;
        if (payload.initialThrowDone) {
          initialThrowDoneRef.current = true;
        }
        if (payload.throwerId === userId) return;
        const thrower = playersRef.current.get(payload.throwerId);
        if (thrower) {
          thrower.facingAngle = Math.atan2(payload.vy, payload.vx);
          throwBallRef.current(thrower, payload.x + payload.vx, payload.y + payload.vy, payload.power, false);
        }
      })
      .on("broadcast", { event: "ball_pickup" }, ({ payload }) => {
        if (!payload) return;
        ballRef.current.holderId = payload.holderId;
        ballRef.current.vx = 0;
        ballRef.current.vy = 0;
        ballRef.current.speed = 0;
        const picker = playersRef.current.get(payload.holderId);
        if (picker) {
          spawnParticles(picker.x, picker.y, "#f59e0b", 8, 2);
          if (!picker.isLocal) {
            setHudMessage(`🛡️ ${picker.name} has the ball! Watch out!`);
          }
        }
      })
      .on("broadcast", { event: "stone_scatter" }, ({ payload }) => {
        if (!payload) return;
        initialThrowDoneRef.current = true;
        triggerScatterRef.current(payload.impulseX, payload.impulseY, false);
      })
      .on("broadcast", { event: "stone_stacked" }, ({ payload }) => {
        if (!payload) return;
        const carrier = playersRef.current.get(payload.carrierId);
        if (carrier) {
          stackNextStoneRef.current(payload.stoneId, carrier, false);
        }
      })
      .on("broadcast", { event: "seeker_tagged" }, ({ payload }) => {
        if (!payload) return;
        const seeker = playersRef.current.get(payload.seekerId);
        if (seeker) {
          handleSeekerTaggedRef.current(seeker, false);
        }
      })
      .on("broadcast", { event: "next_round" }, () => {
        initialThrowDoneRef.current = false;
        resetRoundRef.current("throwing");
        setRoundWinner(null);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          isChannelReady.current = true;
          setLiveSynced(true);
        } else {
          isChannelReady.current = false;
          setLiveSynced(false);
        }
      });

    channelRef.current = channel;

    return () => {
      isChannelReady.current = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, userId, isHost, supabase]);

  // Key Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Mouse Handlers for Aiming & Power Charge
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    mouseRef.current.x = (e.clientX - rect.left) * scaleX;
    mouseRef.current.y = (e.clientY - rect.top) * scaleY;

    const localPlayer = playersRef.current.get(userId);
    const ball = ballRef.current;

    if (localPlayer && ball.holderId === localPlayer.id) {
      mouseRef.current.isDown = true;
      mouseRef.current.chargeStart = performance.now();
      mouseRef.current.currentPower = 0;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    mouseRef.current.x = (e.clientX - rect.left) * scaleX;
    mouseRef.current.y = (e.clientY - rect.top) * scaleY;
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (!mouseRef.current.isDown) return;

    mouseRef.current.isDown = false;
    const power = mouseRef.current.currentPower;
    mouseRef.current.currentPower = 0;
    setChargeProgress(0);

    const localPlayer = playersRef.current.get(userId);
    if (localPlayer && ballRef.current.holderId === localPlayer.id) {
      throwBall(localPlayer, mouseRef.current.x, mouseRef.current.y, power, true);
    }
  };

  // Main 60 FPS Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const updateAndRender = () => {
      const now = performance.now();

      // ==========================================
      // 1. UPDATE LOCAL PLAYER MOVEMENT (WASD)
      // ==========================================
      const localPlayer = playersRef.current.get(userId);
      if (localPlayer && !localPlayer.isTagged) {
        let moveX = 0;
        let moveY = 0;

        if (keysRef.current["KeyW"] || keysRef.current["ArrowUp"]) moveY -= 1;
        if (keysRef.current["KeyS"] || keysRef.current["ArrowDown"]) moveY += 1;
        if (keysRef.current["KeyA"] || keysRef.current["ArrowLeft"]) moveX -= 1;
        if (keysRef.current["KeyD"] || keysRef.current["ArrowRight"]) moveX += 1;

        const len = Math.hypot(moveX, moveY);
        const speed = 4.2;
        if (len > 0) {
          localPlayer.vx = (moveX / len) * speed;
          localPlayer.vy = (moveY / len) * speed;
          if (Math.random() < 0.25) {
            spawnParticles(localPlayer.x, localPlayer.y + 10, "rgba(255,255,255,0.2)", 1, 0.5);
          }
        } else {
          localPlayer.vx *= 0.75;
          localPlayer.vy *= 0.75;
        }

        localPlayer.x += localPlayer.vx;
        localPlayer.y += localPlayer.vy;

        // Clamp inside arena bounds
        localPlayer.x = Math.max(BOUNDARY_PADDING + localPlayer.radius, Math.min(CANVAS_WIDTH - BOUNDARY_PADDING - localPlayer.radius, localPlayer.x));
        localPlayer.y = Math.max(BOUNDARY_PADDING + localPlayer.radius, Math.min(CANVAS_HEIGHT - BOUNDARY_PADDING - localPlayer.radius, localPlayer.y));

        // Face mouse cursor
        localPlayer.facingAngle = Math.atan2(mouseRef.current.y - localPlayer.y, mouseRef.current.x - localPlayer.x);

        // Update throw power meter if holding mouse
        if (mouseRef.current.isDown && ballRef.current.holderId === localPlayer.id) {
          const duration = now - mouseRef.current.chargeStart;
          const power = Math.min(1, duration / 900);
          mouseRef.current.currentPower = power;
          setChargeProgress(Math.round(power * 100));
        }

        // Broadcast local player movement ~25 times per second (40ms)
        if (now - lastPlayerSyncTime.current > 40 && isChannelReady.current) {
          lastPlayerSyncTime.current = now;
          sendBroadcast("player_move", {
            id: userId,
            team: localPlayer.team,
            x: Math.round(localPlayer.x * 10) / 10,
            y: Math.round(localPlayer.y * 10) / 10,
            vx: Math.round(localPlayer.vx * 100) / 100,
            vy: Math.round(localPlayer.vy * 100) / 100,
            facingAngle: Math.round(localPlayer.facingAngle * 100) / 100,
            carryingStoneId: localPlayer.carryingStoneId,
            isTagged: localPlayer.isTagged,
          });
        }
      }

      // Smoothly interpolate remote players
      playersRef.current.forEach((p) => {
        if (!p.isLocal) {
          if (p.targetX !== undefined && p.targetY !== undefined) {
            p.x += (p.targetX - p.x) * 0.45;
            p.y += (p.targetY - p.y) * 0.45;
          }
          if (p.targetFacingAngle !== undefined) {
            p.facingAngle = p.targetFacingAngle;
          }
        }
      });

      // Smoothly interpolate stones on non-host clients
      if (!isHost) {
        stonesRef.current.forEach((st) => {
          if (st.targetX !== undefined && st.targetY !== undefined && !st.carrierId) {
            st.x += (st.targetX - st.x) * 0.4;
            st.y += (st.targetY - st.y) * 0.4;
          }
        });
      }

      // ==========================================
      // 2. BALL PHYSICS & INTERACTIONS
      // ==========================================
      const ball = ballRef.current;

      if (ball.holderId) {
        const holder = playersRef.current.get(ball.holderId);
        if (holder) {
          const holdDist = holder.radius + ball.radius - 2;
          ball.x = holder.x + Math.cos(holder.facingAngle) * holdDist;
          ball.y = holder.y + Math.sin(holder.facingAngle) * holdDist;
          ball.vx = 0;
          ball.vy = 0;
          ball.speed = 0;
        } else {
          ball.holderId = null;
        }
      } else {
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.speed = Math.hypot(ball.vx, ball.vy);

        ball.vx *= 0.985;
        ball.vy *= 0.985;

        // Bounce off arena walls
        if (ball.x - ball.radius <= BOUNDARY_PADDING) {
          ball.x = BOUNDARY_PADDING + ball.radius;
          ball.vx = -ball.vx * 0.75;
          spawnParticles(ball.x, ball.y, "#fdba74", 4, 1.5);
        } else if (ball.x + ball.radius >= CANVAS_WIDTH - BOUNDARY_PADDING) {
          ball.x = CANVAS_WIDTH - BOUNDARY_PADDING - ball.radius;
          ball.vx = -ball.vx * 0.75;
          spawnParticles(ball.x, ball.y, "#fdba74", 4, 1.5);
        }
        if (ball.y - ball.radius <= BOUNDARY_PADDING) {
          ball.y = BOUNDARY_PADDING + ball.radius;
          ball.vy = -ball.vy * 0.75;
          spawnParticles(ball.x, ball.y, "#fdba74", 4, 1.5);
        } else if (ball.y + ball.radius >= CANVAS_HEIGHT - BOUNDARY_PADDING) {
          ball.y = CANVAS_HEIGHT - BOUNDARY_PADDING - ball.radius;
          ball.vy = -ball.vy * 0.75;
          spawnParticles(ball.x, ball.y, "#fdba74", 4, 1.5);
        }

        if (ball.speed > 4.5 && Math.random() < 0.6) {
          spawnParticles(ball.x, ball.y, "#f97316", 2, 0.8);
        }

        // --- CHECK COLLISION: BALL WITH STONES (PHASE 1) ---
        const areStonesStacked = stonesRef.current.some((s) => s.isStacked);
        if (areStonesStacked && ball.speed > 2.5) {
          const distToCenter = Math.hypot(ball.x - CENTER_X, ball.y - CENTER_Y);
          if (distToCenter <= PEDESTAL_RADIUS + ball.radius + 6) {
            triggerScatter(ball.vx, ball.vy, true);
            ball.vx = -ball.vx * 0.45 + (Math.random() - 0.5) * 3;
            ball.vy = -ball.vy * 0.45 + (Math.random() - 0.5) * 3;
            onTriggerAction("throw", { hit: true, aim: 80 });
          }
        }

        // --- CHECK COLLISION: BALL WITH ACTIVE SEEKERS ---
        if (ball.speed > 3.2 && ball.lastThrowerTeam === "guardians") {
          playersRef.current.forEach((player) => {
            if (player.team === "seekers" && !player.isTagged) {
              const d = Math.hypot(ball.x - player.x, ball.y - player.y);
              if (d <= player.radius + ball.radius) {
                handleSeekerTagged(player, true);
                ball.vx *= 0.2;
                ball.vy *= 0.2;
              }
            }
          });
        }

        // --- CHECK BALL PICKUP ---
        if (ball.speed < 4.0 && !ball.holderId) {
          playersRef.current.forEach((player) => {
            if (player.isTagged) return;

            // STRICT RULE:
            // - Before the initial throw: the opening seeker already holds the ball.
            // - After the initial throw: SEEKERS CAN NEVER PICK UP THE BALL!
            //   ONLY GUARDIANS CAN RETRIEVE THE BALL AND THROW AT SEEKERS!
            const canPickup = initialThrowDoneRef.current
              ? player.team === "guardians"
              : player.team === "seekers" && !ball.lastThrowerTeam;

            if (canPickup && !ball.holderId) {
              const d = Math.hypot(ball.x - player.x, ball.y - player.y);
              if (d <= player.radius + ball.radius + 14) {
                ball.holderId = player.id;
                ball.vx = 0;
                ball.vy = 0;
                ball.speed = 0;
                spawnParticles(player.x, player.y, "#f59e0b", 8, 2);

                sendBroadcast("ball_pickup", { holderId: player.id });

                if (player.isLocal) {
                  setHudMessage("🎯 YOU HAVE THE BALL! Aim at Seekers with mouse, HOLD click to charge power, and THROW!");
                } else {
                  setHudMessage(`🛡️ ${player.name} grabbed the ball! Watch out!`);
                }
              }
            }
          });
        }
      }

      // Host broadcasts loose ball and stone state ~20 times per second
      if (isHost && now - lastWorldSyncTime.current > 50 && isChannelReady.current) {
        lastWorldSyncTime.current = now;

        const stoneList = stonesRef.current.map((st) => ({
          id: st.id,
          x: Math.round(st.x * 10) / 10,
          y: Math.round(st.y * 10) / 10,
          isStacked: st.isStacked,
          carrierId: st.carrierId,
        }));

        sendBroadcast("world_sync", {
          stones: stoneList,
          ball: {
            x: Math.round(ballRef.current.x * 10) / 10,
            y: Math.round(ballRef.current.y * 10) / 10,
            vx: Math.round(ballRef.current.vx * 100) / 100,
            vy: Math.round(ballRef.current.vy * 100) / 100,
            holderId: ballRef.current.holderId,
            lastThrowerTeam: ballRef.current.lastThrowerTeam,
          },
        });
      }

      // ==========================================
      // 3. UPDATE STONES PHYSICS & STACKING
      // ==========================================
      const stackedStonesCount = stonesRef.current.filter((s) => s.isStacked).length;
      const currentExpectedStoneId = stackedStonesCount + 1;

      stonesRef.current.forEach((st) => {
        if (st.isStacked) {
          st.x = CENTER_X;
          st.y = CENTER_Y;
          st.vx = 0;
          st.vy = 0;
          return;
        }

        if (st.carrierId) {
          const carrier = playersRef.current.get(st.carrierId);
          if (carrier && !carrier.isTagged) {
            st.x = carrier.x;
            st.y = carrier.y - 24;
            st.vx = 0;
            st.vy = 0;

            const distToPedestal = Math.hypot(carrier.x - CENTER_X, carrier.y - CENTER_Y);
            if (distToPedestal <= PEDESTAL_RADIUS + 8) {
              stackNextStone(st.id, carrier, true);
            }
          } else {
            st.carrierId = null;
          }
          return;
        }

        if (isHost) {
          st.x += st.vx;
          st.y += st.vy;
          st.rotation += st.vRot;
          st.vx *= 0.92;
          st.vy *= 0.92;
          st.vRot *= 0.90;

          if (st.x - st.radius <= BOUNDARY_PADDING) {
            st.x = BOUNDARY_PADDING + st.radius;
            st.vx = -st.vx * 0.6;
          } else if (st.x + st.radius >= CANVAS_WIDTH - BOUNDARY_PADDING) {
            st.x = CANVAS_WIDTH - BOUNDARY_PADDING - st.radius;
            st.vx = -st.vx * 0.6;
          }
          if (st.y - st.radius <= BOUNDARY_PADDING) {
            st.y = BOUNDARY_PADDING + st.radius;
            st.vy = -st.vy * 0.6;
          } else if (st.y + st.radius >= CANVAS_HEIGHT - BOUNDARY_PADDING) {
            st.y = CANVAS_HEIGHT - BOUNDARY_PADDING - st.radius;
            st.vy = -st.vy * 0.6;
          }
        }

        // Check if an active Seeker can pick up this stone
        if (st.id === currentExpectedStoneId) {
          playersRef.current.forEach((seeker) => {
            if (seeker.team === "seekers" && !seeker.isTagged && !seeker.carryingStoneId) {
              const d = Math.hypot(st.x - seeker.x, st.y - seeker.y);
              if (d <= seeker.radius + st.radius + 10) {
                st.carrierId = seeker.id;
                seeker.carryingStoneId = st.id;
                spawnParticles(st.x, st.y, STONE_COLORS[st.id - 1].fill, 10, 2);
                if (seeker.isLocal) {
                  addFloatingText(`Carrying Stone #${st.id}! Run to center!`, seeker.x, seeker.y - 40, STONE_COLORS[st.id - 1].fill);
                  setHudMessage(`🧱 You picked up Stone #${st.id}! Run to the center pedestal to stack it!`);
                }
              }
            }
          });
        }
      });

      // ==========================================
      // 4. UPDATE PARTICLES & FLOATING TEXTS
      // ==========================================
      particlesRef.current.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
      });
      particlesRef.current = particlesRef.current.filter((p) => p.alpha > 0);

      floatingTextsRef.current.forEach((ft) => {
        ft.y += ft.vy;
        ft.alpha -= 0.015;
      });
      floatingTextsRef.current = floatingTextsRef.current.filter((ft) => ft.alpha > 0);

      // =========================================================================
      // 5. RENDER EVERYTHING (TOP-DOWN RETINA CANVAS)
      // =========================================================================
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Background Field
      const bgGrad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 40, CENTER_X, CENTER_Y, 450);
      bgGrad.addColorStop(0, "#0f172a");
      bgGrad.addColorStop(1, "#020617");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Arena Border with soft glow
      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(
        BOUNDARY_PADDING,
        BOUNDARY_PADDING,
        CANVAS_WIDTH - BOUNDARY_PADDING * 2,
        CANVAS_HEIGHT - BOUNDARY_PADDING * 2,
        28
      );
      ctx.stroke();

      // Pitch Court Markings
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(CENTER_X, BOUNDARY_PADDING);
      ctx.lineTo(CENTER_X, CANVAS_HEIGHT - BOUNDARY_PADDING);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, 150, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Center Pedestal
      ctx.save();
      const pedGrad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 10, CENTER_X, CENTER_Y, PEDESTAL_RADIUS);
      pedGrad.addColorStop(0, "rgba(56, 189, 248, 0.18)");
      pedGrad.addColorStop(1, "rgba(15, 23, 42, 0.4)");
      ctx.fillStyle = pedGrad;
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, PEDESTAL_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      const pulse = Math.sin(now / 200) * 0.15 + 0.85;
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, PEDESTAL_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Pedestal Stack Counter & Target Indicator
      const stackedCountNow = stonesRef.current.filter((s) => s.isStacked).length;
      ctx.save();
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (stackedCountNow === 0) {
        ctx.fillStyle = "rgba(248, 113, 113, 0.85)";
        ctx.fillText("NEED #1", CENTER_X, CENTER_Y + 44);
      } else if (stackedCountNow < MAX_STACK) {
        ctx.fillStyle = "rgba(56, 189, 248, 0.9)";
        ctx.fillText(`NEED #${stackedCountNow + 1} (${stackedCountNow}/7)`, CENTER_X, CENTER_Y + 44);
      } else {
        ctx.fillStyle = "#10b981";
        ctx.fillText("STACKED! (7/7)", CENTER_X, CENTER_Y + 44);
      }
      ctx.restore();

      // --- RENDER STONES ---
      if (stackedCountNow > 0) {
        for (let i = 1; i <= stackedCountNow; i++) {
          const info = STONE_COLORS[i - 1];
          const offsetY = -((i - 1) * 7);
          const stoneY = CENTER_Y + offsetY;

          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.beginPath();
          ctx.ellipse(CENTER_X, stoneY + 3, info.radius * 1.1, info.radius * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = info.fill;
          ctx.strokeStyle = info.stroke;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(CENTER_X, stoneY, info.radius * 1.1, info.radius * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = info.text;
          ctx.font = `bold ${Math.max(10, Math.round(info.radius * 0.7))}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(i.toString(), CENTER_X, stoneY);
          ctx.restore();
        }
      }

      stonesRef.current.forEach((st) => {
        if (st.isStacked) return;
        const info = STONE_COLORS[st.id - 1];

        ctx.save();
        ctx.translate(st.x, st.y);
        ctx.rotate(st.rotation);

        if (st.id === stackedCountNow + 1 && !st.carrierId) {
          const glow = Math.sin(now / 150) * 0.3 + 0.7;
          ctx.strokeStyle = `rgba(250, 204, 21, ${glow})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, st.radius + 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(2, 4, st.radius * 1.05, st.radius * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = info.fill;
        ctx.strokeStyle = info.stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, st.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = info.text;
        ctx.font = `bold ${Math.max(10, Math.round(st.radius * 0.8))}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(st.id.toString(), 0, 0);

        ctx.restore();
      });

      // --- RENDER PLAYERS ---
      playersRef.current.forEach((p) => {
        ctx.save();
        ctx.translate(p.x, p.y);

        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.beginPath();
        ctx.ellipse(0, p.radius * 0.75, p.radius * 1.1, p.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        if (p.isLocal) {
          ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.radius + 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        const isSeeker = p.team === "seekers";
        const bodyColor = p.isTagged ? "#64748b" : isSeeker ? "#10b981" : "#f59e0b";
        const strokeColor = p.isTagged ? "#334155" : isSeeker ? "#059669" : "#d97706";

        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const noseX = Math.cos(p.facingAngle) * (p.radius + 3);
        const noseY = Math.sin(p.facingAngle) * (p.radius + 3);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(noseX, noseY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const initial = p.isLocal ? "YOU" : p.name.charAt(0).toUpperCase();
        ctx.fillText(initial, 0, 0);

        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = p.isLocal ? "#38bdf8" : "#e2e8f0";
        ctx.fillText(p.name, 0, -p.radius - 8);

        if (p.isTagged) {
          ctx.fillStyle = "#ef4444";
          ctx.fillText("(OUT)", 0, p.radius + 14);
        }

        ctx.restore();
      });

      // --- RENDER BALL ---
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + 4, ball.radius * 1.1, ball.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      const ballGrad = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 2, ball.x, ball.y, ball.radius);
      ballGrad.addColorStop(0, "#fed7aa");
      ballGrad.addColorStop(0.6, "#f97316");
      ballGrad.addColorStop(1, "#c2410c");

      ctx.fillStyle = ballGrad;
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // --- RENDER AIMING RETICLE & POWER GAUGE FOR BALL HOLDER ---
      const ballHolder = ball.holderId ? playersRef.current.get(ball.holderId) : null;
      if (ballHolder) {
        if (ballHolder.isLocal) {
          const mx = mouseRef.current.x;
          const my = mouseRef.current.y;

          ctx.save();
          ctx.strokeStyle = "rgba(249, 115, 22, 0.6)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(ball.x, ball.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx, my, 12, 0, Math.PI * 2);
          ctx.moveTo(mx - 18, my);
          ctx.lineTo(mx + 18, my);
          ctx.moveTo(mx, my - 18);
          ctx.lineTo(mx, my + 18);
          ctx.stroke();

          if (mouseRef.current.isDown) {
            const power = mouseRef.current.currentPower;
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + power * Math.PI * 2;

            ctx.strokeStyle = power > 0.8 ? "#ef4444" : power > 0.4 ? "#f59e0b" : "#10b981";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(mx, my, 19, startAngle, endAngle);
            ctx.stroke();

            ctx.font = "bold 12px monospace";
            ctx.fillStyle = ctx.strokeStyle;
            ctx.textAlign = "center";
            ctx.fillText(`${Math.round(power * 100)}%`, mx, my - 26);
          } else {
            ctx.font = "10px system-ui";
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.textAlign = "center";
            ctx.fillText("HOLD CLICK TO CHARGE", mx, my - 24);
          }
          ctx.restore();
        } else {
          ctx.save();
          ctx.strokeStyle = "rgba(249, 115, 22, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(ballHolder.x, ballHolder.y);
          ctx.lineTo(
            ballHolder.x + Math.cos(ballHolder.facingAngle) * 140,
            ballHolder.y + Math.sin(ballHolder.facingAngle) * 140
          );
          ctx.stroke();
          ctx.restore();
        }
      }

      // --- RENDER PARTICLES ---
      particlesRef.current.forEach((p) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // --- RENDER FLOATING TEXTS ---
      floatingTextsRef.current.forEach((ft) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.alpha);
        ctx.font = "bold 15px system-ui, sans-serif";
        ctx.fillStyle = ft.color;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 6;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      });

      animationId = requestAnimationFrame(updateAndRender);
    };

    animationId = requestAnimationFrame(updateAndRender);
    return () => cancelAnimationFrame(animationId);
  }, [
    userId,
    isHost,
    spawnParticles,
    triggerScatter,
    stackNextStone,
    handleSeekerTagged,
    throwBall,
    onTriggerAction,
    addFloatingText,
    sendBroadcast,
  ]);

  const totalMembers = members.length;

  return (
    <div className="flex flex-col gap-3">
      {/* Top HUD Bar with Live Scoreboard */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/90 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={myTeam === "seekers" ? "default" : "secondary"}>
            You: {myTeam === "seekers" ? "Seeker" : "Guardian"}
          </Badge>

          {/* Live Score Counter */}
          <div className="flex items-center gap-2 rounded-md bg-black/40 px-2.5 py-1 text-xs border border-[var(--border)]">
            <span className="text-[var(--muted)]">Scoreboard:</span>
            <span className="font-bold text-emerald-400">Seekers {scores.seekers}</span>
            <span className="text-[var(--muted)]">—</span>
            <span className="font-bold text-amber-400">Guardians {scores.guardians}</span>
          </div>

          <span className="text-xs text-[var(--muted)]">
            Stacked:{" "}
            <span className="font-semibold text-sky-400">
              {stonesRef.current.filter((s) => s.isStacked).length} / {MAX_STACK}
            </span>
          </span>

          {nextStoneNeeded <= 7 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-300">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: STONE_COLORS[nextStoneNeeded - 1]?.fill }}
              />
              Next: <strong>#{nextStoneNeeded}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Realtime Live Sync Status */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              liveSynced
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${liveSynced ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            {liveSynced ? "Live Synced" : "Connecting…"}
          </span>

          {chargeProgress > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-orange-400 font-mono font-bold">Charge: {chargeProgress}%</span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800 border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500 transition-all duration-75"
                  style={{ width: `${chargeProgress}%` }}
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={() => setSoundEnabled((prev) => !prev)}
          >
            {soundEnabled ? "🔊 Audio" : "🔇 Muted"}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-3 text-xs"
            onClick={handlePlayAgain}
          >
            🔄 Reset Round
          </Button>
        </div>
      </div>

      {/* Main Interactive Canvas Arena */}
      <div className="relative mx-auto w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[#020617] shadow-2xl">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="h-auto w-full cursor-crosshair touch-none select-none"
        />

        {/* Dynamic Center Prompt Overlay */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between rounded-lg bg-black/75 px-4 py-2 text-xs backdrop-blur border border-white/5">
          <p className="font-medium text-slate-200">
            {totalMembers < 2
              ? "👤 Solo Practice Mode — Move with WASD, throw with mouse, stack stones 1→7. (Join from an incognito tab to play 1v1!)"
              : hudMessage}
          </p>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span>
              Move: <kbd className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">W</kbd>{" "}
              <kbd className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">A</kbd>{" "}
              <kbd className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">S</kbd>{" "}
              <kbd className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">D</kbd>
            </span>
            <span>
              Aim: <span className="text-slate-200">Mouse</span>
            </span>
            <span>
              Throw: <span className="text-slate-200">Hold &amp; Release Click</span>
            </span>
          </div>
        </div>

        {/* =========================================================================
            CELEBRATORY WIN MODAL & PLAY AGAIN OVERLAY
           ========================================================================= */}
        {roundWinner && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-6 shadow-2xl text-center space-y-5">
              {/* Win Header */}
              <div className="space-y-2">
                <div className="text-5xl">
                  {roundWinner === "seekers" ? "🏆" : "🛡️"}
                </div>
                <h2
                  className={`text-3xl font-extrabold tracking-tight ${
                    roundWinner === "seekers" ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {roundWinner === "seekers" ? "SEEKERS WIN! PITTHU!" : "GUARDIANS WIN!"}
                </h2>
                <p className="text-sm text-[var(--muted)]">
                  {roundWinner === "seekers"
                    ? "The Seekers successfully stacked all seven stones in order without getting tagged!"
                    : "A Seeker was tagged by the ball before the stones could be assembled!"}
                </p>
              </div>

              {/* Updated Score Board Display */}
              <div className="rounded-xl border border-[var(--border)] bg-black/40 p-4">
                <p className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)] font-semibold">
                  Updated Score Board
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className={`rounded-lg p-3 border transition-all ${
                      roundWinner === "seekers"
                        ? "border-emerald-500/50 bg-emerald-500/10 ring-2 ring-emerald-500/30"
                        : "border-[var(--border)] bg-slate-900/40"
                    }`}
                  >
                    <p className="text-xs font-medium text-emerald-400 uppercase">Seekers</p>
                    <p className="text-3xl font-black text-white mt-1">{scores.seekers}</p>
                    {roundWinner === "seekers" && (
                      <span className="mt-1 inline-block text-[10px] text-emerald-300 font-semibold bg-emerald-500/20 px-1.5 py-0.5 rounded">
                        +1 Round Winner
                      </span>
                    )}
                  </div>

                  <div
                    className={`rounded-lg p-3 border transition-all ${
                      roundWinner === "guardians"
                        ? "border-amber-500/50 bg-amber-500/10 ring-2 ring-amber-500/30"
                        : "border-[var(--border)] bg-slate-900/40"
                    }`}
                  >
                    <p className="text-xs font-medium text-amber-400 uppercase">Guardians</p>
                    <p className="text-3xl font-black text-white mt-1">{scores.guardians}</p>
                    {roundWinner === "guardians" && (
                      <span className="mt-1 inline-block text-[10px] text-amber-300 font-semibold bg-amber-500/20 px-1.5 py-0.5 rounded">
                        +1 Round Winner
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  size="lg"
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 shadow-lg"
                  onClick={handlePlayAgain}
                >
                  🔄 Play Again (Next Round)
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-[var(--muted)]"
                  onClick={() => setRoundWinner(null)}
                >
                  Dismiss Overlay (Inspect Arena)
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
