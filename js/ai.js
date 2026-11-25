const aiMemory = new WeakMap();

const VALID_CPU_LEVELS = new Set(['easy', 'normal', 'hard', 'expert', 'insane']);

const CPU_PROFILES = {
  easy: {
    thinkInterval: 0.36,
    attackCooldownBase: 0.56,
    jumpCooldownBase: 0.48,
    guardChance: 0.08,
    guardDuration: 0.24,
    guardCooldown: 1.25,
    projectileEvadeChance: 0.06,
    grabShieldChance: 0.12,
    smashHighDmgChance: 0.2,
    specialChance: 0.14,
    rangedSpecialChance: 0.06,
    recoveryMissChance: 0.28,
    itemPriorityScale: 0.55,
    itemRange: 280,
    predictiveLead: 0,
    aerialChase: false,
    edgeguard: false,
    comboFollowup: false,
    fastFallAmbush: false,
    spacingSlack: 1.22,
    hesitationChance: 0.36,
  },
  normal: {
    thinkInterval: 0.18,
    attackCooldownBase: 0.28,
    jumpCooldownBase: 0.34,
    guardChance: 0.26,
    guardDuration: 0.25,
    guardCooldown: 0.9,
    projectileEvadeChance: 0.22,
    grabShieldChance: 0.55,
    smashHighDmgChance: 0.44,
    specialChance: 0.28,
    rangedSpecialChance: 0.14,
    recoveryMissChance: 0.04,
    itemPriorityScale: 1.0,
    itemRange: 440,
    predictiveLead: 0.05,
    aerialChase: false,
    edgeguard: false,
    comboFollowup: false,
    fastFallAmbush: false,
    spacingSlack: 0.85,
    hesitationChance: 0.14,
  },
  hard: {
    thinkInterval: 0.1,
    attackCooldownBase: 0.16,
    jumpCooldownBase: 0.25,
    guardChance: 0.44,
    guardDuration: 0.18,
    guardCooldown: 0.65,
    projectileEvadeChance: 0.48,
    grabShieldChance: 0.8,
    smashHighDmgChance: 0.66,
    specialChance: 0.44,
    rangedSpecialChance: 0.28,
    recoveryMissChance: 0,
    itemPriorityScale: 1.28,
    itemRange: 540,
    predictiveLead: 0.11,
    aerialChase: true,
    edgeguard: false,
    comboFollowup: true,
    fastFallAmbush: false,
    spacingSlack: 0.72,
    hesitationChance: 0.04,
  },
  expert: {
    thinkInterval: 0.045,
    attackCooldownBase: 0.06,
    jumpCooldownBase: 0.18,
    guardChance: 0.65,
    guardDuration: 0.16,
    guardCooldown: 0.42,
    projectileEvadeChance: 0.8,
    grabShieldChance: 0.92,
    smashHighDmgChance: 0.82,
    specialChance: 0.55,
    rangedSpecialChance: 0.55,
    recoveryMissChance: 0,
    itemPriorityScale: 1.55,
    itemRange: 680,
    predictiveLead: 0.16,
    aerialChase: true,
    edgeguard: true,
    comboFollowup: true,
    fastFallAmbush: true,
    spacingSlack: 0.7,
    hesitationChance: 0,
  },
  insane: {
    thinkInterval: 0.02,
    attackCooldownBase: 0.01,
    jumpCooldownBase: 0.13,
    guardChance: 0.88,
    guardDuration: 0.16,
    guardCooldown: 0.24,
    projectileEvadeChance: 0.95,
    grabShieldChance: 0.98,
    smashHighDmgChance: 0.92,
    specialChance: 0.68,
    rangedSpecialChance: 0.8,
    recoveryMissChance: 0,
    itemPriorityScale: 1.9,
    itemRange: 880,
    predictiveLead: 0.2,
    aerialChase: true,
    edgeguard: true,
    comboFollowup: true,
    fastFallAmbush: true,
    spacingSlack: 0.68,
    hesitationChance: 0,
  },
};

function getProfile(fighter) {
  const lvl = fighter?.cpuLevel;
  if (lvl && VALID_CPU_LEVELS.has(lvl)) {
    return CPU_PROFILES[lvl];
  }
  return CPU_PROFILES.normal;
}

function getMemory(fighter) {
  let mem = aiMemory.get(fighter);
  if (!mem) {
    mem = {
      thinkTimer: 0,
      jumpCooldown: 0,
      guardTimer: 0,
      guardCooldown: 0,
      attackCooldown: 0,
      dropTimer: 0,
      punishAfterGuard: false,
    };
    aiMemory.set(fighter, mem);
  }
  return mem;
}

function createEmptyInput() {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    jumpPressed: false,
    attackPressed: false,
    strongPressed: false,
    specialPressed: false,
    guard: false,
    grabPressed: false,
  };
}

function getMainPlatform(stage) {
  if (!stage || !Array.isArray(stage.platforms) || stage.platforms.length === 0) {
    return { x: 200, y: 520, w: 800, h: 36 };
  }
  const solid = stage.platforms.find((p) => !p.passThrough);
  return solid || stage.platforms[0];
}

function isRangedSpecial(specialId) {
  return (
    specialId === 'fire' ||
    specialId === 'ice' ||
    specialId === 'star' ||
    specialId === 'ink_wave' ||
    specialId === 'lightning'
  );
}

function isLungingSpecial(specialId) {
  return specialId === 'slash' || specialId === 'rapid' || specialId === 'strike' || specialId === 'wing_dash';
}

function findIncomingProjectileThreat(fighter, battleState, profile) {
  const projectiles = battleState.projectiles;
  if (!Array.isArray(projectiles) || projectiles.length === 0) return null;

  const fcy = fighter.y - (fighter.height || 76) * 0.5;
  let nearestThreat = null;
  let nearestTime = Infinity;

  for (const p of projectiles) {
    if (!p || p.ownerId === fighter.id) continue;
    if (battleState.teamMode && p.team && fighter.team && p.team === fighter.team) continue;

    const dx = fighter.x - p.x;
    const dy = fcy - p.y;
    const speedSq = p.vx * p.vx + p.vy * p.vy;
    if (speedSq < 100) continue;

    const t = Math.max(0, Math.min(0.38, (dx * p.vx + dy * p.vy) / speedSq));
    if (t <= 0.001) continue;

    const closestX = p.x + p.vx * t;
    const closestY = p.y + p.vy * t + 0.5 * (p.gravity || 0) * t * t;
    const missDist = Math.hypot(fighter.x - closestX, fcy - closestY);
    const dangerRadius = (p.radius || 20) + (fighter.width || 56) * 0.6 + (p.kind === 'bomb' ? 54 : 10);

    const reactionWindow = profile.thinkInterval <= 0.06 ? 0.28 : 0.2;
    if (missDist < dangerRadius && t < reactionWindow && t < nearestTime) {
      nearestTime = t;
      nearestThreat = { proj: p, t };
    }
  }

  return nearestThreat;
}

export function computeCPUInput(fighter, battleState, dt = 1 / 60) {
  const input = createEmptyInput();
  if (!fighter || fighter.isOut || fighter.respawnTimer > 0) {
    return input;
  }

  const level = VALID_CPU_LEVELS.has(fighter.cpuLevel) ? fighter.cpuLevel : 'normal';
  const profile = getProfile(fighter);
  const isInsane = level === 'insane';
  const isHighTier = isInsane || level === 'expert';

  const mem = getMemory(fighter);
  mem.thinkTimer = Math.max(0, mem.thinkTimer - dt);
  mem.jumpCooldown = Math.max(0, mem.jumpCooldown - dt);
  mem.guardTimer = Math.max(0, mem.guardTimer - dt);
  mem.guardCooldown = Math.max(0, mem.guardCooldown - dt);
  mem.attackCooldown = Math.max(0, mem.attackCooldown - dt);
  mem.dropTimer = Math.max(0, mem.dropTimer - dt);

  const stage = battleState.stage;
  const mainPlat = getMainPlatform(stage);
  const stageCenterX = mainPlat.x + mainPlat.w * 0.5;
  const leftEdge = mainPlat.x + 24;
  const rightEdge = mainPlat.x + mainPlat.w - 24;
  const safeFloorY = mainPlat.y;

  const specialId = fighter.stats?.specialMove?.id || 'ink_wave';
  const specialReady = (fighter.specialCooldown || 0) <= 0;
  const jumpsLeft = fighter.jumpsRemaining || 0;
  const canUpSpecial = !fighter.upSpecialUsed && (fighter.upSpecialLockout || 0) <= 0;
  const hasWingDash = specialId === 'wing_dash' && specialReady;

  // 0. PRIORITY: Hanging on Ledge (崖つかまり) -> climb or ledge-jump cleanly onto stage!
  if (fighter.ledgeSide && fighter.ledgeSide !== 0) {
    const inwardDir = -fighter.ledgeSide;
    if ((fighter.ledgeTimer || 0) > (isInsane ? 0.14 : 0.22)) {
      if (inwardDir > 0) input.right = true;
      else input.left = true;
      // Mix ledge jump vs ledge climb on higher difficulties
      if (isHighTier && Math.random() < 0.45) {
        input.jump = true;
        input.jumpPressed = true;
        input.up = true;
      }
    }
    return input;
  }

  // 1. PRIORITY: Stage recovery when offstage or falling below main platform
  const offLeft = fighter.x < leftEdge;
  const offRight = fighter.x > rightEdge;
  const offStage = offLeft || offRight;
  const belowMain = fighter.y > safeFloorY + 6;

  if (offStage || belowMain) {
    // Always steer decisively inward toward stage center (never press down so ledge grab triggers!)
    if (fighter.x < stageCenterX - 10) {
      input.right = true;
    } else if (fighter.x > stageCenterX + 10) {
      input.left = true;
    }

    const needHeight = fighter.y > safeFloorY - (isInsane ? 36 : 22) || fighter.vy > (isInsane ? 40 : 80);
    if (needHeight && mem.jumpCooldown <= 0) {
      const missJump = profile.recoveryMissChance > 0 && Math.random() < profile.recoveryMissChance;
      if (jumpsLeft > 0 && !missJump) {
        input.jump = true;
        input.jumpPressed = true;
        input.up = true;
        mem.jumpCooldown = isInsane ? 0.2 : 0.28;
      } else if (canUpSpecial && (fighter.y > safeFloorY - 25 || fighter.vy > 60)) {
        // Universal Up+Special Recovery Boost (↑ + L/C)!
        input.up = true;
        input.specialPressed = true;
        mem.jumpCooldown = 0.35;
      } else if (hasWingDash && fighter.y > safeFloorY - 35) {
        input.specialPressed = true;
        mem.jumpCooldown = 0.32;
      } else if (missJump) {
        mem.jumpCooldown = 0.34;
      }
    }

    // Emergency Up+Special recovery when deep below main stage
    if (fighter.y > safeFloorY + 45 && canUpSpecial && jumpsLeft === 0) {
      input.up = true;
      input.specialPressed = true;
    }

    return input;
  }

  // 2. Find highest-priority living opponent (respecting teamMode)
  const fighters = battleState.fighters || [];
  let target = null;
  let bestTargetScore = Infinity;
  let bestDist = Infinity;

  for (const other of fighters) {
    if (!other || other.id === fighter.id) continue;
    if (other.isOut || other.respawnTimer > 0) continue;
    if (battleState.teamMode && other.team && other.team === fighter.team) continue;

    const dx = other.x - fighter.x;
    const dy = other.y - fighter.y;
    const dist = Math.hypot(dx, dy);

    let score = dist;
    if (level === 'hard' || isHighTier) {
      score -= Math.min(180, (other.damage || 0) * (isInsane ? 1.4 : 0.8));
      if ((other.hitstunTimer || 0) > 0 || other.action === 'dizzy') score -= 130;
      if ((other.invulnTimer || 0) > 0.35) score += 300;
    }
    if (score < bestTargetScore) {
      bestTargetScore = score;
      bestDist = dist;
      target = other;
    }
  }

  // 3. Continue active guard ONLY during enemy active hitbox frames; drop immediately on recovery to counter-punish!
  if (mem.guardTimer > 0 && (fighter.shieldHp ?? 100) > 28 && fighter.onGround) {
    const enemyActiveFrames =
      target &&
      bestDist < 135 &&
      ((target.action === 'attack' && (target.actionTimer || 0) < 0.16) ||
        (target.action === 'strong' && (target.actionTimer || 0) < 0.31) ||
        (target.action === 'special' && (target.actionTimer || 0) < 0.26));
    const projStillClose = Boolean(findIncomingProjectileThreat(fighter, battleState, profile));

    if (enemyActiveFrames || projStillClose) {
      input.guard = true;
      input.down = true;
      return input;
    }
    mem.guardTimer = 0;
    mem.punishAfterGuard = isHighTier || level === 'hard';
  }

  // 4. Incoming projectile defense (guard non-bombs cleanly on ground to keep stage control, jump bombs!)
  if (!(fighter.hammerTimer > 0) && mem.thinkTimer <= 0) {
    const projThreat = findIncomingProjectileThreat(fighter, battleState, profile);
    if (projThreat && Math.random() < profile.projectileEvadeChance) {
      const p = projThreat.proj;
      const canGuardProj =
        fighter.onGround &&
        mem.guardCooldown <= 0 &&
        (fighter.shieldHp ?? 100) > 42 &&
        p.kind !== 'bomb';

      if (canGuardProj) {
        mem.guardTimer = Math.max(0.08, projThreat.t + 0.04);
        mem.guardCooldown = profile.guardCooldown;
        mem.thinkTimer = profile.thinkInterval;
        input.guard = true;
        input.down = true;
        return input;
      } else if ((fighter.onGround || jumpsLeft > 0) && mem.jumpCooldown <= 0) {
        input.jump = true;
        input.jumpPressed = true;
        input.up = true;
        if (target) {
          if (target.x > fighter.x && fighter.x < rightEdge - 25) input.right = true;
          else if (target.x < fighter.x && fighter.x > leftEdge + 25) input.left = true;
        }
        mem.jumpCooldown = profile.jumpCooldownBase;
        mem.thinkTimer = profile.thinkInterval;
        return input;
      }
    }
  }

  // 5. Reactive frame-tight guard against close-range enemy attacks (blocks active frames -> instant counter-punish!)
  if (
    target &&
    fighter.onGround &&
    !(fighter.hammerTimer > 0) &&
    mem.guardCooldown <= 0 &&
    bestDist < (isInsane ? 132 : 122) &&
    (fighter.shieldHp ?? 100) > 38 &&
    ((target.action === 'attack' && (target.actionTimer || 0) < 0.14) ||
      (target.action === 'strong' && (target.actionTimer || 0) < 0.29) ||
      (target.action === 'special' && (target.actionTimer || 0) < 0.22))
  ) {
    const enemyFacingUs =
      (target.facing > 0 && fighter.x >= target.x - 16) ||
      (target.facing < 0 && fighter.x <= target.x + 16);
    if (enemyFacingUs && mem.thinkTimer <= 0) {
      mem.thinkTimer = profile.thinkInterval;
      if (Math.random() < profile.guardChance) {
        mem.guardTimer = target.action === 'strong' ? 0.32 : profile.guardDuration;
        mem.guardCooldown = profile.guardCooldown;
        mem.punishAfterGuard = isHighTier || level === 'hard';
        input.guard = true;
        input.down = true;
        return input;
      }
    }
  }

  // 6. Item seeking (aggressive sniping on expert/insane, accurate bomb aiming)
  const items = battleState.items || [];
  let desiredItem = null;
  let bestItemScore = -Infinity;

  for (const item of items) {
    if (!item || item.collected) continue;
    const dist = Math.hypot(item.x - fighter.x, item.y - fighter.y);
    if (dist > profile.itemRange) continue;

    let priority = 180;
    if (item.type === 'heal') {
      priority = (fighter.damage || 0) >= 22 ? 390 + fighter.damage * 2.5 : 55;
    } else if (item.type === 'hammer') {
      priority = 460;
    } else if (item.type === 'giant') {
      priority = 415;
    } else if (item.type === 'bomb') {
      priority = isInsane ? 340 : 215;
    }

    const score = priority * profile.itemPriorityScale - dist;
    if (score > bestItemScore) {
      bestItemScore = score;
      desiredItem = item;
    }
  }

  const seekItem = Boolean(desiredItem) && !(fighter.hammerTimer > 0) && bestItemScore > 0;

  // Goal calculation
  let goalX = stageCenterX;
  let goalY = safeFloorY - 40;
  let edgeguardingTarget = false;

  if (seekItem) {
    goalX = desiredItem.x;
    goalY = desiredItem.y;
  } else if (target) {
    const targetInvuln = (target.invulnTimer || 0) > 0.25 && isHighTier;
    const targetOffLeft = target.x < mainPlat.x + 16;
    const targetOffRight = target.x > mainPlat.x + mainPlat.w - 16;

    if (targetInvuln) {
      // Hold strong stage center control while opponent is respawning invulnerably
      goalX = stageCenterX;
      goalY = safeFloorY;
    } else if (profile.edgeguard && (targetOffLeft || targetOffRight)) {
      edgeguardingTarget = true;
      goalX = targetOffLeft ? leftEdge + 22 : rightEdge - 22;
      goalY = safeFloorY;
    } else {
      const lead = profile.predictiveLead * 0.55;
      const predX = target.x + (target.vx || 0) * lead;
      const predY = target.y + (target.vy || 0) * lead * 0.45;
      goalX = Math.max(leftEdge + 12, Math.min(rightEdge - 12, predX));
      goalY = Math.min(safeFloorY, predY);
    }
  }

  // Snap facing toward opponent right before bomb pickup so thrown bomb hits!
  if (seekItem && desiredItem.type === 'bomb' && target && isHighTier) {
    const itemDist = Math.hypot(desiredItem.x - fighter.x, desiredItem.y - (fighter.y - (fighter.height || 76) * 0.5));
    if (itemDist < 58) {
      const enemyDir = target.x >= fighter.x ? 1 : -1;
      if (enemyDir !== fighter.facing) {
        input.right = enemyDir > 0;
        input.left = enemyDir < 0;
        return input;
      }
    }
  }

  const dxGoal = goalX - fighter.x;
  const dyGoal = goalY - fighter.y;

  // 7. Horizontal navigation toward goal
  const reachBonus = ((fighter.stats?.reach || 55) - 50) * 0.65;
  const attackRange = 76 + reachBonus + (fighter.giantTimer > 0 ? 30 : 0);
  const desiredSpacing =
    seekItem || fighter.hammerTimer > 0 || edgeguardingTarget
      ? 14
      : Math.max(40, attackRange * profile.spacingSlack);

  if (Math.abs(dxGoal) > desiredSpacing) {
    if (dxGoal > 0 && fighter.x < rightEdge) {
      input.right = true;
    } else if (dxGoal < 0 && fighter.x > leftEdge) {
      input.left = true;
    }
  } else if (target && !seekItem) {
    const dxEnemy = target.x - fighter.x;
    if (dxEnemy > 4 && fighter.facing < 0) input.right = true;
    else if (dxEnemy < -4 && fighter.facing > 0) input.left = true;
  }

  // 8. Vertical navigation: jump to platforms, aerial chase, drop-through ambush, fast-fall
  const shouldAerialChase =
    profile.aerialChase &&
    target &&
    !seekItem &&
    !edgeguardingTarget &&
    ((target.hitstunTimer || 0) > 0 || !target.onGround) &&
    dyGoal < -46 &&
    Math.abs(dxGoal) < 155;

  if ((dyGoal < -74 || shouldAerialChase) && mem.jumpCooldown <= 0) {
    if (fighter.onGround || jumpsLeft > 0) {
      input.jump = true;
      input.jumpPressed = true;
      input.up = true;
      mem.jumpCooldown = profile.jumpCooldownBase;
    }
  } else if (dyGoal > 78 && fighter.onGround && fighter.onPassThrough && mem.dropTimer <= 0) {
    input.down = true;
    input.jump = true;
    input.jumpPressed = true;
    mem.dropTimer = profile.fastFallAmbush ? 0.24 : 0.45;
  }

  if (
    profile.fastFallAmbush &&
    !fighter.onGround &&
    fighter.vy > 75 &&
    dyGoal > 28 &&
    Math.abs(dxGoal) < 120
  ) {
    input.down = true;
  }

  // 9. Combat decisions — exact coordinates for crisp melee hit confirms, predictive lead for ranged specials!
  if (target && !seekItem && !(fighter.hammerTimer > 0) && mem.attackCooldown <= 0) {
    if (profile.hesitationChance > 0 && mem.thinkTimer <= 0 && Math.random() < profile.hesitationChance) {
      mem.thinkTimer = profile.thinkInterval;
      return input;
    }

    if ((target.invulnTimer || 0) > 0.2 && (isHighTier || level === 'hard')) {
      return input;
    }

    // Exact relative distance for melee (never whiff due to over-prediction!)
    const rawDx = target.x - fighter.x;
    const rawDy = target.y - fighter.y;
    const absDx = Math.abs(rawDx);
    const absDy = Math.abs(rawDy);
    const facingTarget = (rawDx >= 0 && fighter.facing > 0) || (rawDx <= 0 && fighter.facing < 0);

    const lungeRiskOffLedge =
      (fighter.facing < 0 && fighter.x < leftEdge + 90) ||
      (fighter.facing > 0 && fighter.x > rightEdge - 90);
    const safeToUseSpecial = specialReady && !(isLungingSpecial(specialId) && lungeRiskOffLedge);

    // Grab shielding opponents!
    if (target.shieldActive && absDx < 100 && absDy < 68) {
      if (!facingTarget) {
        input.left = rawDx < 0;
        input.right = rawDx > 0;
        return input;
      }
      if (Math.random() < profile.grabShieldChance) {
        input.grabPressed = true;
        mem.attackCooldown = profile.attackCooldownBase + 0.08;
        mem.punishAfterGuard = false;
        return input;
      }
    }

    // Immediate post-guard punish!
    if (mem.punishAfterGuard && absDx <= attackRange + 22 && absDy < 76) {
      mem.punishAfterGuard = false;
      if (!facingTarget) {
        input.left = rawDx < 0;
        input.right = rawDx > 0;
      } else {
        if ((target.damage || 0) >= 65) {
          input.strongPressed = true;
        } else if (safeToUseSpecial && !isRangedSpecial(specialId) && specialId !== 'wing_dash') {
          input.specialPressed = true;
        } else {
          input.attackPressed = true;
        }
        mem.attackCooldown = profile.attackCooldownBase;
        return input;
      }
    }

    // Combo follow-up on hitstun / dizzy targets!
    if (
      profile.comboFollowup &&
      ((target.hitstunTimer || 0) > 0 || target.action === 'dizzy') &&
      absDx <= attackRange + 26 &&
      absDy < 90
    ) {
      if (!facingTarget) {
        input.left = rawDx < 0;
        input.right = rawDx > 0;
      } else {
        if ((target.damage || 0) >= 62 || target.action === 'dizzy') {
          input.strongPressed = true;
        } else if (safeToUseSpecial && specialId !== 'wing_dash' && Math.random() < profile.specialChance) {
          input.specialPressed = true;
        } else {
          input.attackPressed = true;
        }
        mem.attackCooldown = profile.attackCooldownBase;
        return input;
      }
    }

    // Close-range combat
    if (absDx <= attackRange + 14 && absDy < 76) {
      if (!facingTarget) {
        input.left = rawDx < 0;
        input.right = rawDx > 0;
        if (isInsane && safeToUseSpecial && specialId === 'quake') {
          input.specialPressed = true;
          mem.attackCooldown = profile.attackCooldownBase;
        }
      } else {
        const roll = Math.random();
        const targetDmg = target.damage || 0;
        const enemyRecovering =
          (target.action === 'strong' && (target.actionTimer || 0) > 0.28) ||
          (target.action === 'grab' && (target.actionTimer || 0) > 0.16) ||
          (target.action === 'attack' && (target.actionTimer || 0) > 0.16);
        const koReady = targetDmg >= (isInsane ? 64 : 78) || edgeguardingTarget || enemyRecovering;
        const enemySwingingFast = target.action === 'attack' && (target.actionTimer || 0) <= 0.16;

        if (koReady && !enemySwingingFast && roll < profile.smashHighDmgChance) {
          input.strongPressed = true;
          mem.attackCooldown = profile.attackCooldownBase + 0.04;
        } else if (
          safeToUseSpecial &&
          specialId !== 'wing_dash' &&
          !isRangedSpecial(specialId) &&
          roll < profile.specialChance
        ) {
          input.specialPressed = true;
          mem.attackCooldown = profile.attackCooldownBase + 0.05;
        } else if (
          safeToUseSpecial &&
          isRangedSpecial(specialId) &&
          absDx >= 68 &&
          roll < profile.specialChance * 0.65
        ) {
          input.specialPressed = true;
          mem.attackCooldown = profile.attackCooldownBase + 0.05;
        } else if (roll < (isInsane ? 0.14 : 0.12)) {
          input.grabPressed = true;
          mem.attackCooldown = profile.attackCooldownBase + 0.05;
        } else if (!isHighTier && roll < 0.34) {
          input.strongPressed = true;
          mem.attackCooldown = profile.attackCooldownBase + 0.06;
        } else {
          // Fast jab pressure beats slow windups and starts hitstun combos!
          input.attackPressed = true;
          mem.attackCooldown = profile.attackCooldownBase;
        }
      }
      return input;
    }

    // Mid-range / predictive ranged & dash specials
    const leadX = target.x + (target.vx || 0) * profile.predictiveLead - fighter.x;
    const leadY = target.y + (target.vy || 0) * (profile.predictiveLead * 0.5) - fighter.y;
    const absLeadDx = Math.abs(leadX);
    const absLeadDy = Math.abs(leadY);
    const facingLead = (leadX >= 0 && fighter.facing > 0) || (leadX <= 0 && fighter.facing < 0);

    if (safeToUseSpecial && absLeadDx > 95 && absLeadDx < (isInsane ? 560 : 460) && absLeadDy < (isInsane ? 130 : 105)) {
      if (isRangedSpecial(specialId) || specialId === 'rapid' || specialId === 'slash') {
        if (!facingLead) {
          input.left = leadX < 0;
          input.right = leadX > 0;
        } else if (mem.thinkTimer <= 0) {
          mem.thinkTimer = profile.thinkInterval;
          if (Math.random() < profile.rangedSpecialChance) {
            input.specialPressed = true;
            mem.attackCooldown = profile.attackCooldownBase + 0.1;
          }
        }
      }
    }
  }

  return input;
}
