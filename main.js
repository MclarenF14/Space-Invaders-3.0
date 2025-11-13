// Enhanced Space Invaders with 100 Levels, Purchasable Upgrades, per-level HP for invaders,
// and points-per-kill that increase by 5 each level.
// Controls: Left/Right or A/D, Space to shoot, 1 = Shield, 2 = Slow, R to restart

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const stateEl = document.getElementById('state');
  const levelEl = document.getElementById('level');
  const upgradesEl = document.getElementById('upgrades');

  const W = canvas.width;
  const H = canvas.height;

  let keys = {};
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });

  // Game state
  let game = null;

  function resetGame() {
    game = {
      score: 0,
      lives: 3,
      state: 'playing', // 'playing' | 'won' | 'over'
      player: new Player(W / 2, H - 60),
      bullets: [],
      invaderBullets: [],
      invaders: [],
      invaderDirection: 1,

      // Leveling
      level: 1,
      maxLevel: 100,

      // Base parameters (used to compute per-level speeds)
      baseInvaderStepInterval: 600, // ms baseline
      invaderStepInterval: 600,
      baseInvaderBulletSpeed: 180,
      invaderBulletSpeed: 180,
      invaderMoveStep: 18, // pixels per step baseline
      invaderShootProbabilityBase: 0.35,
      invaderShootProbability: 0.35,

      // HP per invader (computed in applyLevelScaling)
      hpPerInvader: 1,

      // Points per kill (computed in applyLevelScaling). Base 10 at level 1, +5 per level.
      killScore: 10,

      // shooting
      lastShotAt: 0,
      shootCooldown: 300, // ms

      // stepping
      lastInvaderStep: 0,

      // Upgrades
      shieldActive: false,
      shieldExpires: 0,
      slowActive: false,
      slowExpires: 0,
      shieldDurationMs: 15000,
      slowDurationMs: 15000,
      upgradePrice: 100,
      slowMultiplier: 1.8, // movement interval multiplied by this when slowed (slower)
      slowShootFactor: 0.5, // shooting probability multiplier when slowed

      // visual hit flash
      hitFlash: [], // {x,y,ttl}

      lastTimestamp: performance.now()
    };

    applyLevelScaling(game.level);
    createInvaders();
    updateHUD();
    stateEl.textContent = '';
  }

  function applyLevelScaling(level) {
    // Calculate per-level parameters (invader movement interval, bullet speed, shoot probability, move step)
    const lvl = Math.max(1, level);
    // invaderStepInterval decreases per level, bounded
    const interval = Math.max(120, game.baseInvaderStepInterval * Math.pow(0.96, lvl - 1));
    game.invaderStepInterval = interval;

    // bullet speed increases slightly per level
    game.invaderBulletSpeed = game.baseInvaderBulletSpeed * (1 + (lvl - 1) * 0.03);

    // invader move step increases slightly
    game.invaderMoveStep = 18 * (1 + (lvl - 1) * 0.02);

    // shooting probability increases slightly per level, capped
    game.invaderShootProbability = Math.min(0.9, game.invaderShootProbabilityBase + (lvl - 1) * 0.01);

    // HP scaling for invaders:
    // Configurable: change hpGrowthDivisor to change how fast HP ramps up.
    // Current formula: hp = 1 + floor((level - 1) / hpGrowthDivisor)
    // Example: hpGrowthDivisor = 3 => +1 HP every 3 levels.
    const hpGrowthDivisor = 3;
    game.hpPerInvader = 1 + Math.floor((lvl - 1) / hpGrowthDivisor);
    if (game.hpPerInvader < 1) game.hpPerInvader = 1;

    // Points-per-kill scaling: baseKill + (level - 1) * incrementPerLevel
    const baseKill = 10;
    const incrementPerLevel = 5;
    game.killScore = baseKill + (lvl - 1) * incrementPerLevel;

    // Ensure numeric types
    game.invaderStepInterval = Number(game.invaderStepInterval);
    game.invaderBulletSpeed = Number(game.invaderBulletSpeed);
    game.invaderMoveStep = Number(game.invaderMoveStep);
    game.killScore = Math.max(0, Math.floor(game.killScore));
  }

  // Player
  function Player(x, y) {
    return {
      x,
      y,
      w: 60,
      h: 18,
      speed: 320,
      color: '#7afcff',
      canShoot: true
    };
  }

  // Invader
  function Invader(x, y, row, col, hp) {
    return {
      x, y, w: 36, h: 20, row, col,
      alive: true,
      color: '#ffdd55',
      hp: hp,
      maxHp: hp
    };
  }

  function createInvaders() {
    const rows = 4;
    const cols = 8;
    const marginX = 60;
    const marginY = 60;
    const spacingX = 70;
    const spacingY = 50;
    const startX = (W - (cols - 1) * spacingX) / 2;
    const startY = marginY;

    // Use the hpPerInvader computed in applyLevelScaling to ensure consistency
    const hpPerInvader = Math.max(1, Math.floor(game.hpPerInvader));

    game.invaders = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * spacingX;
        const y = startY + r * spacingY;
        game.invaders.push(Invader(x, y, r, c, hpPerInvader));
      }
    }
  }

  // Bullets
  function Bullet(x, y, vy, owner) {
    return { x, y, r: 4, vy, owner }; // owner: 'player' | 'invader'
  }

  // Utilities
  function rectsCollide(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

  function circleRectCollide(c, r) {
    // c: {x,y,r}, r: {x,y,w,h}
    const cx = c.x;
    const cy = c.y;
    const rx = r.x, ry = r.y, rw = r.w, rh = r.h;
    const nearestX = Math.max(rx, Math.min(cx, rx + rw));
    const nearestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return dx * dx + dy * dy <= c.r * c.r;
  }

  function updateHUD() {
    scoreEl.textContent = `Score: ${Math.max(0, Math.floor(game.score))}`;
    livesEl.textContent = `Lives: ${game.lives}`;
    levelEl.textContent = `Level: ${game.level} / ${game.maxLevel}`;
    // update upgrade availability text
    const canBuy = game.score >= game.upgradePrice;
    upgradesEl.innerHTML = `Upgrades: [1] Shield (${game.upgradePrice}) — lasts ${game.shieldDurationMs/1000}s (${game.shieldActive ? 'ACTIVE' : 'ready'}) | ` +
                           `[2] Slow (${game.upgradePrice}) — lasts ${game.slowDurationMs/1000}s (${game.slowActive ? 'ACTIVE' : 'ready'})` +
                           ` ${canBuy ? '' : '<span style="opacity:0.6"> — Need 100 score to buy</span>'}`;
  }

  function playerShoot() {
    const now = performance.now();
    if (now - game.lastShotAt < game.shootCooldown) return;
    game.lastShotAt = now;
    const p = game.player;
    game.bullets.push(Bullet(p.x + p.w/2, p.y - 12, -520, 'player'));
  }

  function invaderShoot() {
    if (game.invaderBullets.length > 4) return; // limit simultaneous invader bullets
    // pick a random alive invader from the bottom-most in a column
    const columns = {};
    game.invaders.forEach(inv => {
      if (!inv.alive) return;
      if (!columns[inv.col] || inv.y > columns[inv.col].y) columns[inv.col] = inv;
    });
    const arr = Object.values(columns);
    if (!arr.length) return;
    const shooter = arr[Math.floor(Math.random() * arr.length)];
    // fire using per-level bullet speed
    const vy = game.invaderBulletSpeed * (1 + (game.level - 1) * 0.003);
    game.invaderBullets.push(Bullet(shooter.x + shooter.w / 2, shooter.y + shooter.h + 8, vy, 'invader'));
  }

  // Purchase shield
  function buyShield() {
    if (game.state !== 'playing') return;
    if (game.score < game.upgradePrice) {
      // not enough score
      return;
    }
    // subtract immediately
    game.score -= game.upgradePrice;
    // activate shield
    const now = performance.now();
    game.shieldActive = true;
    game.shieldExpires = now + game.shieldDurationMs;
    updateHUD();
  }

  // Purchase slow
  function buySlow() {
    if (game.state !== 'playing') return;
    if (game.score < game.upgradePrice) {
      return;
    }
    game.score -= game.upgradePrice;
    const now = performance.now();
    game.slowActive = true;
    game.slowExpires = now + game.slowDurationMs;
    updateHUD();
  }

  // Update loop
  function update(dt) {
    if (game.state !== 'playing') return;

    const now = performance.now();

    // update upgrade expirations
    if (game.shieldActive && now >= game.shieldExpires) {
      game.shieldActive = false;
    }
    if (game.slowActive && now >= game.slowExpires) {
      game.slowActive = false;
    }

    const p = game.player;

    // Player movement
    let move = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) move -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) move += 1;
    p.x += move * p.speed * dt;
    p.x = Math.max(8, Math.min(W - p.w - 8, p.x));

    // Player shoot
    if ((keys['Space'] || keys['KeyW'] || keys['ArrowUp']) ) {
      playerShoot();
    }

    // Move bullets
    for (let b of game.bullets) b.y += b.vy * dt;
    for (let b of game.invaderBullets) b.y += b.vy * dt;

    // Remove off-screen bullets
    game.bullets = game.bullets.filter(b => b.y > -20);
    game.invaderBullets = game.invaderBullets.filter(b => b.y < H + 20);

    // Invader stepping movement (discrete steps)
    const effectiveStepInterval = game.invaderStepInterval * (game.slowActive ? game.slowMultiplier : 1);
    if (now - game.lastInvaderStep > effectiveStepInterval) {
      // compute bounds for alive invaders
      const alive = game.invaders.filter(i => i.alive);
      if (alive.length === 0) {
        // level cleared
        if (game.level >= game.maxLevel) {
          game.state = 'won';
          stateEl.textContent = 'You completed all levels! Press R to play again.';
          return;
        } else {
          // advance level
          game.level++;
          // recalc per-level parameters (including hpPerInvader and killScore) then create invaders
          applyLevelScaling(game.level);
          createInvaders();
          // clear bullets
          game.bullets = [];
          game.invaderBullets = [];
          // small buffer time so they don't step immediately
          game.lastInvaderStep = now + 250;
          updateHUD();
          return;
        }
      }
      let minX = Infinity, maxX = -Infinity;
      for (let inv of alive) {
        minX = Math.min(minX, inv.x);
        maxX = Math.max(maxX, inv.x + inv.w);
      }

      let moveX = game.invaderMoveStep * game.invaderDirection;
      // hit side?
      if (minX + moveX < 8 || maxX + moveX > W - 8) {
        // move down instead and reverse
        for (let inv of alive) inv.y += 20;
        game.invaderDirection *= -1;
        // speed up slightly on each row descent
        game.invaderStepInterval = Math.max(80, game.invaderStepInterval * 0.97);
      } else {
        for (let inv of alive) inv.x += moveX;
      }
      game.lastInvaderStep = now;

      // shooting chance
      const baseChance = game.invaderShootProbability;
      const shotChance = baseChance * (game.slowActive ? game.slowShootFactor : 1);
      if (Math.random() < shotChance) invaderShoot();
    }

    // Collisions: player bullets vs invaders
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      for (let j = 0; j < game.invaders.length; j++) {
        const inv = game.invaders[j];
        if (!inv.alive) continue;
        if (circleRectCollide(b, inv)) {
          // Add a short hit flash
          game.hitFlash.push({ x: b.x, y: b.y, ttl: 180 });

          // bullet hits invader: reduce HP; invader dies only when hp <= 0
          inv.hp = Math.max(0, (typeof inv.hp === 'number' ? inv.hp : inv.maxHp) - 1);

          // remove bullet on hit
          game.bullets.splice(i, 1);

          if (inv.hp <= 0) {
            inv.alive = false;
            // award points on kill using per-level killScore
            game.score += game.killScore;
          } else {
            // optional: small sound or score for hit can be added here
          }
          updateHUD();
          break;
        }
      }
    }

    // update hit flashes
    for (let k = game.hitFlash.length - 1; k >= 0; k--) {
      game.hitFlash[k].ttl -= dt * 1000;
      if (game.hitFlash[k].ttl <= 0) game.hitFlash.splice(k, 1);
    }

    // Collisions: invader bullets vs player (shield blocks)
    for (let i = game.invaderBullets.length - 1; i >= 0; i--) {
      const b = game.invaderBullets[i];
      const playerRect = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (circleRectCollide(b, playerRect)) {
        // if shield active, consume bullet but do not damage player
        if (game.shieldActive) {
          game.invaderBullets.splice(i, 1);
          // optionally create a little effect here
        } else {
          game.invaderBullets.splice(i, 1);
          game.lives -= 1;
          updateHUD();
          if (game.lives <= 0) {
            game.state = 'over';
            stateEl.textContent = 'Game Over — Press R to restart';
          }
        }
      }
    }

    // Invaders reaching player
    for (let inv of game.invaders) {
      if (!inv.alive) continue;
      if (inv.y + inv.h >= p.y) {
        game.state = 'over';
        stateEl.textContent = 'Game Over — Press R to restart';
        break;
      }
    }
  }

  function draw() {
    // clear
    ctx.clearRect(0, 0, W, H);

    // stars background
    drawStars();

    // draw player
    const p = game.player;
    ctx.fillStyle = p.color;
    // simple ship: triangle on top of rectangle
    ctx.beginPath();
    ctx.moveTo(p.x + p.w / 2, p.y - 10);
    ctx.lineTo(p.x + p.w - 8, p.y + p.h / 2);
    ctx.lineTo(p.x + 8, p.y + p.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(p.x + 10, p.y + p.h / 2 - 2, p.w - 20, p.h / 2);

    // draw shield around player if active
    if (game.shieldActive) {
      const remaining = Math.max(0, game.shieldExpires - performance.now());
      const alpha = 0.28 + 0.72 * (remaining / game.shieldDurationMs);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(122,252,255,${alpha})`;
      ctx.lineWidth = 4;
      ctx.arc(p.x + p.w/2, p.y + p.h/2, 48, 0, Math.PI * 2);
      ctx.stroke();
    }

    // draw invaders
    for (let inv of game.invaders) {
      if (!inv.alive) continue;
      ctx.fillStyle = inv.color;
      // draw simple alien shape
      ctx.save();
      ctx.translate(inv.x, inv.y);
      ctx.fillRect(0, 8, inv.w, 8);
      ctx.fillRect(6, 0, inv.w - 12, 8);
      ctx.fillRect(0, 16, 8, 8);
      ctx.fillRect(inv.w - 8, 16, 8, 8);
      // eyes
      ctx.fillStyle = '#061127';
      ctx.fillRect(10, 6, 6, 4);
      ctx.fillRect(inv.w - 18, 6, 6, 4);

      // draw HP bar above invader when > 1 HP
      if (typeof inv.maxHp === 'number' && inv.maxHp > 1) {
        const barW = inv.w;
        const barH = 6;
        const ratio = (typeof inv.hp === 'number' ? inv.hp : inv.maxHp) / Math.max(1, inv.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, -barH - 6, barW, barH);
        ctx.fillStyle = '#e25f5f';
        ctx.fillRect(1, -barH - 5, Math.max(2, (barW - 2) * ratio), barH - 2);
        // small hp number
        ctx.fillStyle = '#fff';
        ctx.font = '10px system-ui, Arial';
        ctx.fillText((typeof inv.hp === 'number' ? inv.hp : inv.maxHp).toString(), barW - 12, -barH - 0);
      }
      ctx.restore();
    }

    // draw hit flashes
    for (let f of game.hitFlash) {
      ctx.beginPath();
      const alpha = Math.max(0, f.ttl / 180);
      ctx.fillStyle = `rgba(255,220,100,${alpha})`;
      ctx.arc(f.x, f.y, 8 * (0.8 + alpha), 0, Math.PI * 2);
      ctx.fill();
    }

    // bullets
    ctx.fillStyle = '#fff';
    for (let b of game.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff8a8a';
    for (let b of game.invaderBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // HUD minimal overlays
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(6, 6, 360, 72);
    ctx.fillStyle = '#9fb6c7';
    ctx.font = '14px system-ui, Arial';
    ctx.fillText(`Score: ${Math.max(0, Math.floor(game.score))}`, 16, 26);
    ctx.fillText(`Lives: ${game.lives}`, 160, 26);
    ctx.fillText(`Level: ${game.level} / ${game.maxLevel}`, 260, 26);
    ctx.fillText(`Enemy HP: ${game.hpPerInvader}`, 16, 48);
    ctx.fillText(`Kill Points: ${game.killScore}`, 160, 48);

    // active upgrade timers
    const now = performance.now();
    if (game.shieldActive || game.slowActive) {
      ctx.fillStyle = '#7afcff';
      ctx.font = '12px system-ui, Arial';
      let y = 52;
      if (game.shieldActive) {
        const t = Math.max(0, Math.ceil((game.shieldExpires - now) / 1000));
        ctx.fillText(`Shield: ${t}s`, 300, y);
        y += 16;
      }
      if (game.slowActive) {
        const t = Math.max(0, Math.ceil((game.slowExpires - now) / 1000));
        ctx.fillText(`Slow: ${t}s`, 300, y);
      }
    }

    if (game.state === 'over' || game.state === 'won') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, H / 2 - 60, W, 120);
      ctx.fillStyle = '#7afcff';
      ctx.font = '36px system-ui, Arial';
      ctx.textAlign = 'center';
      ctx.fillText(game.state === 'won' ? 'YOU WIN!' : 'GAME OVER', W / 2, H / 2 - 8);
      ctx.font = '18px system-ui, Arial';
      ctx.fillText('Press R to play again', W / 2, H / 2 + 28);
      ctx.textAlign = 'start';
    }
  }

  // simple starfield
  let stars = [];
  function initStars() {
    stars = [];
    for (let i = 0; i < 60; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.2 });
    }
  }
  function drawStars() {
    ctx.fillStyle = '#071a2a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8df3ff';
    for (let s of stars) {
      ctx.globalAlpha = Math.min(1, 0.3 + (s.r / 2));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  // Main loop
  function loop(ts) {
    const dt = Math.min(0.05, (ts - game.lastTimestamp) / 1000);
    game.lastTimestamp = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // restart handler & purchase keys handler
  addEventListener('keydown', e => {
    if (e.code === 'KeyR') {
      resetGame();
    }
    // Only purchase on keydown to avoid multiple buys from held key
    if (e.code === 'Digit1') {
      if (game.score >= game.upgradePrice) {
        buyShield();
      } else {
        // can show quick feedback in state area
        stateEl.textContent = 'Not enough score for Shield';
        setTimeout(() => { if (game.state === 'playing') stateEl.textContent = ''; }, 900);
      }
    }
    if (e.code === 'Digit2') {
      if (game.score >= game.upgradePrice) {
        buySlow();
      } else {
        stateEl.textContent = 'Not enough score for Slow';
        setTimeout(() => { if (game.state === 'playing') stateEl.textContent = ''; }, 900);
      }
    }
  });

  // Start
  initStars();
  resetGame();
  requestAnimationFrame(loop);

  // ensure HUD updates when score changes via other means (like immediate subtraction)
  // The game updates HUD inside relevant functions; to be safe, periodically refresh small UI pieces
  setInterval(() => {
    if (game) updateHUD();
  }, 300);

})();
