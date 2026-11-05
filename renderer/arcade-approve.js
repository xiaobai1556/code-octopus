// 批准还是拒绝：Claude 一条一条地请你批准它要做的事（题库在 src/arcade-cards.js）。
// 没问题的允许，危险的拒绝；每条都有倒计时，越到后面越快，等太久也算错。错三次结束，结算时告诉你错在哪。
(() => {
  const START_LIMIT = 6.5; // 第一条有几秒
  const MIN_LIMIT = 2.4;
  const STEP = 0.15; // 每答对一条少几秒
  const LIVES = 3;

  // 版面
  const CARD = { x: 106, y: 26, w: 244, h: 182 };
  const TERM = { x: CARD.x + 10, y: CARD.y + 28, w: CARD.w - 20, h: 62 };
  const BAR = { x: TERM.x, y: TERM.y + TERM.h + 7, w: TERM.w, h: 4 };
  const BTN_ALLOW = { x: TERM.x, y: BAR.y + 10, w: TERM.w / 2 - 4, h: 22 };
  const BTN_DENY = { x: TERM.x + TERM.w / 2 + 4, y: BAR.y + 10, w: TERM.w / 2 - 4, h: 22 };

  const isShell = (tool) => tool === 'Bash' || tool === 'PowerShell';

  class Approve {
    constructor(env) {
      this.env = env;
      this.draw_ = ARCADE_CARDS.deck();
      this.score = 0;
      this.lives = LIVES;
      this.streak = 0;
      this.bestStreak = 0;
      this.correct = 0;
      this.mistakes = [];
      this.limit = START_LIMIT;
      this.t = 0;
      this.dying = 0;
      this.over = false;
      this.floats = [];
      this.next();
    }

    next() {
      this.card = this.draw_();
      this.left = this.limit;
      this.phase = 'ask';
      this.fb = null; // 答完以后的反馈 { right, timeout, pts, t, shown }
    }

    answer(allow, timeout = false) {
      if (this.phase !== 'ask') return;
      const right = !timeout && allow === this.card.ok;
      this.phase = 'feedback';
      if (right) {
        this.correct++;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        // 基础 10 分 + 答得快（剩下的时间）+ 连对奖励
        const pts = 10 + Math.round((10 * this.left) / this.limit) + (this.streak >= 3 ? Math.min(10, this.streak) : 0);
        this.score += pts;
        this.limit = Math.max(MIN_LIMIT, this.limit - STEP);
        this.fb = { right, pts, t: 0.55, shown: 0 };
        this.floats.push({ text: `+${pts}`, x: allow ? BTN_ALLOW.x + BTN_ALLOW.w / 2 : BTN_DENY.x + BTN_DENY.w / 2, y: BTN_ALLOW.y, life: 0.8 });
        this.env.sound('right');
      } else {
        this.lives--;
        this.streak = 0;
        this.mistakes.push({ card: this.card, timeout });
        this.fb = { right, timeout, t: 2.6, shown: 0 };
        this.env.sound('wrong');
      }
    }

    update(dt, input) {
      this.t += dt;
      for (const f of this.floats) {
        f.y -= 24 * dt;
        f.life -= dt;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      if (this.phase === 'ask') {
        this.left -= dt;
        if (input.hit('left', 'yes') || input.takeClick(BTN_ALLOW)) this.answer(true);
        else if (input.hit('right', 'no') || input.takeClick(BTN_DENY)) this.answer(false);
        else if (this.left <= 0) this.answer(false, true);
        return;
      }
      // 反馈：答错了停久一点让你看清为什么，按 Enter / 空格 / 点一下可以跳过
      this.fb.t -= dt;
      this.fb.shown += dt;
      const skip = !this.fb.right && this.fb.shown > 0.5 && (input.hit('enter', 'space') || input.clicks.length > 0);
      if (this.fb.t <= 0 || skip) {
        input.clicks.length = 0;
        if (this.lives <= 0) this.over = true;
        else this.next();
      }
    }

    draw(g, t) {
      g.rect(-4, -4, W + 8, H + 8, '#1D2130');
      // 桌面上淡淡的格子
      for (let x = 0; x < W; x += 20) g.rect(x, 17, 0.5, H, '#242940');
      for (let y = 17; y < H; y += 20) g.rect(0, y, W, 0.5, '#242940');

      // 左边：举着牌子的小章鱼
      const fb = this.fb;
      const urgent = this.phase === 'ask' && this.left < this.limit * 0.3;
      let pose;
      if (fb && fb.right) pose = { eyes: 'happy', armL: 'high', armR: 'high', blush: true, t };
      else if (fb) pose = { eyes: 'down', top: 1, armL: 6, armR: 6, props: ['tear'], t };
      else pose = { eyes: urgent ? 'wide' : 'open', armL: 'high', armR: 'high', props: ['sign!'], flash: urgent && Math.floor(t * 6) % 2 === 0, t };
      const hop = fb && fb.right ? Math.abs(Math.sin(fb.shown * 12)) * 5 : 0;
      g.pet(56, 196 - hop, 2.6, pose, false);
      g.rect(18, 197, 76, 2, '#2E3450');

      // 右边：Claude Code 的权限请求
      g.round(CARD.x, CARD.y, CARD.w, CARD.h, 8, C.card, fb ? (fb.right ? C.green : C.red) : C.accent, 1.5);
      g.text(tr('approve.ask'), CARD.x + 10, CARD.y + 13, { size: 8, weight: 700, color: C.accent });
      const tool = this.card.tool;
      const tw = g.measure(tool, { size: 6.5, mono: true, weight: 700 }) + 10;
      g.round(CARD.x + CARD.w - 10 - tw, CARD.y + 7, tw, 12, 6, '#F1E7DA', null);
      g.text(tool, CARD.x + CARD.w - 10 - tw / 2, CARD.y + 13.5, { size: 6.5, mono: true, weight: 700, color: '#6B5B4E', align: 'center' });

      g.round(TERM.x, TERM.y, TERM.w, TERM.h, 4, '#2B2620', null);
      const text = isShell(tool) ? `$ ${this.card.text}` : this.card.text;
      g.wrap(text, TERM.w - 14, { size: 7.5, mono: true }, 5).forEach((line, i) => g.text(line, TERM.x + 7, TERM.y + 10 + i * 10.5, { size: 7.5, mono: true, color: '#F4EFE6' }));

      // 倒计时条：绿 → 黄 → 红
      const k = this.phase === 'ask' ? clamp(this.left / this.limit, 0, 1) : 0;
      g.round(BAR.x, BAR.y, BAR.w, BAR.h, 2, '#E9E1D3', null);
      if (k > 0) g.round(BAR.x, BAR.y, BAR.w * k, BAR.h, 2, k > 0.5 ? C.green : k > 0.25 ? C.gold : C.red, null);

      if (!fb) {
        this.drawButton(g, BTN_ALLOW, `← ${tr('approve.allow')}`, C.green, '#FFFFFF');
        this.drawButton(g, BTN_DENY, `${tr('approve.deny')} →`, '#FFFFFF', C.red);
      } else {
        // 答完：亮出正确答案和理由
        const ok = this.card.ok;
        const head = fb.right ? `${tr('approve.right')}  +${fb.pts}` : fb.timeout ? `${tr('approve.timeout')}${tr('punct.colon')}${tr(ok ? 'approve.shouldAllow' : 'approve.shouldDeny')}` : `${tr('approve.wrong')}${tr('punct.colon')}${tr(ok ? 'approve.shouldAllow' : 'approve.shouldDeny')}`;
        g.text(head, CARD.x + 10, BTN_ALLOW.y + 6, { size: 8.5, weight: 800, color: fb.right ? C.green : C.red });
        g.wrap(tr(`approve.why.${this.card.why}`), CARD.w - 20, { size: 7.5 }, 2).forEach((line, i) => g.text(line, CARD.x + 10, BTN_ALLOW.y + 19 + i * 10, { size: 7.5, color: C.ink }));
        if (!fb.right) g.text(tr('approve.skip'), CARD.x + CARD.w - 10, CARD.y + CARD.h - 8, { size: 6, color: C.muted, align: 'right' });
      }
      for (const f of this.floats) g.alpha(f.life / 0.5, () => g.text(f.text, f.x, f.y, { size: 9, weight: 800, color: C.green, align: 'center' }));
      if (this.streak >= 3 && !fb) g.text(tr('approve.streak', { n: this.streak }), 56, 108, { size: 7.5, weight: 800, color: C.gold, align: 'center' });
    }

    drawButton(g, r, label, fill, ink) {
      const over = g.hover(r);
      g.round(r.x, r.y, r.w, r.h, r.h / 2, over ? shade(fill === '#FFFFFF' ? '#FFFFFF' : fill, fill === '#FFFFFF' ? 0.95 : 1.1) : fill, fill === '#FFFFFF' ? '#E3A69C' : null, 1);
      g.text(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, { size: 8.5, weight: 800, color: ink, align: 'center' });
    }

    hud() {
      return { score: this.score, lives: this.lives, label: this.streak >= 2 ? tr('approve.streak', { n: this.streak }) : tr('approve.count', { n: this.correct + this.mistakes.length }) };
    }

    metrics() {
      return { streak: this.bestStreak };
    }

    // 结算：对了几条、最长连对，以及每一条错在哪
    summary() {
      const lines = [{ text: tr('approve.correct', { n: this.correct, streak: this.bestStreak }) }];
      if (this.mistakes.length) lines.push({ text: tr('approve.mistakes'), bold: true });
      for (const { card } of this.mistakes.slice(-3)) {
        const full = isShell(card.tool) ? card.text : `${card.tool} ${card.text}`;
        const cmd = full.length > 34 ? full.slice(0, 33) + '…' : full;
        lines.push({ text: `${card.ok ? '✓' : '✗'} ${cmd}`, mono: true, size: 6.6, color: card.ok ? C.green : C.red });
        lines.push({ text: tr(`approve.why.${card.why}`), size: 6.6, color: C.muted, indent: 9 });
      }
      return lines;
    }
  }

  ARCADE.register({
    id: 'approve',
    icon(g, x, y, w, h, t) {
      g.rect(x, y, w, h, '#1D2130');
      const cx = x + 30;
      g.round(cx, y + 8, w - 36, h - 16, 4, C.card, C.accent, 1);
      g.round(cx + 4, y + 14, w - 44, 20, 2, '#2B2620', null);
      const cmds = ['$ rm -rf ~', '$ npm test', '$ curl … | sh', '$ git status'];
      g.text(cmds[Math.floor(t / 1.2) % cmds.length], cx + 7, y + 24, { size: 5.5, mono: true, color: '#F4EFE6' });
      g.round(cx + 4, y + 40, (w - 48) / 2, 10, 5, C.green, null);
      g.round(cx + 8 + (w - 48) / 2, y + 40, (w - 48) / 2, 10, 5, '#FFFFFF', '#E3A69C', 0.8);
      g.pet(x + 15, y + h - 6, 1.1, { eyes: 'wide', armL: 'high', armR: 'high', props: ['sign!'], flash: Math.floor(t * 3) % 2 === 0, t });
    },
    create: (env) => new Approve(env),
  });
})();
