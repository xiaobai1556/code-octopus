// 第一次打开时的新手引导：小章鱼从屏幕中间掉下来自我介绍，演示几样本事，最后带你接入 Claude Code。
// 每一步停几秒自动往下走，点它也能下一步；右键菜单可以跳过。看完以后主进程记下来，不会再弹。

const TOUR_STEP_S = 7;

class Tour {
  constructor(world, connected) {
    this.world = world;
    this.steps = ['hello', 'walk', 'work', 'alert', 'touch', connected ? 'ready' : 'connect'];
    this.i = -1;
    this.t = 0;
    this.pet = null;
  }

  get step() {
    return this.steps[this.i];
  }

  start() {
    const w = this.world;
    this.pet = w.pets.find((p) => !p.sessionId && !p.leaving && !p.leaveAt && !p.visitor) || w.spawnPet(w.width / 2);
    const p = this.pet;
    if (p.game) w.games.abort(p.game);
    // 从屏幕中间上方掉下来
    Object.assign(p, { x: w.width / 2, y: -60, vx: 0, vy: 0, ground: null, climb: null, layerId: null, mode: 'air' });
    p.inside.clear();
    this.next();
  }

  next() {
    const w = this.world;
    const p = this.pet;
    this.i++;
    this.t = 0;
    p.clearActivity();
    p.emote = null;
    p.touch();
    if (!this.step) return this.end();
    const hint = this.step === 'connect' ? tr('tour.connectHint') : tr('tour.next', { i: this.i + 1, n: this.steps.length });
    const say = () => p.say(tr(`tour.${this.step}`), Infinity, true, { sub: tr(`tour.${this.step}Sub`), hint });
    const act = (kind, extra = {}) => (p.activity = { kind, since: performance.now(), tour: true, ...extra });
    switch (this.step) {
      case 'hello':
        p.doEmote('wave', 2);
        break;
      case 'walk': {
        const target = p.ground && w.findJumpTarget(p);
        if (target) {
          p.jumpTarget = target;
          p.setMode('crouch', 0.22);
        } else p.setMode('walk', 4);
        break;
      }
      case 'work':
        act('edit');
        break;
      case 'alert':
        act('alert', { sign: '!', urgent: true, goto: true });
        break;
      case 'touch':
        p.doEmote('spin', 1.2);
        w.sparkles(p);
        p.hop(-520);
        break;
      case 'connect':
        act('alert', { sign: '?', urgent: false });
        break;
      case 'ready':
        p.doEmote('cheer', 2);
        w.confetti(p);
        break;
    }
    say();
  }

  update(dt) {
    if (!this.world.pets.includes(this.pet)) return this.end(true); // 被转移到别的屏幕去了
    this.t += dt;
    if (this.step === 'hello' && !this.pet.ground) this.t = 0; // 落地以后才开始计时
    const limit = this.step === 'connect' ? 60 : this.step === 'ready' ? 5 : TOUR_STEP_S;
    if (this.t > limit) this.next();
  }

  click() {
    if (this.step === 'connect') {
      this.world.openSettings('integration');
      this.end();
    } else this.next();
  }

  end(silent) {
    const p = this.pet;
    this.world.tour = null;
    if (p) {
      if (p.activity && p.activity.tour) p.clearActivity();
      p.bubble = null;
      if (!silent) {
        p.say(tr('tour.bye'), 2.2);
        p.doEmote('wave', 1.4);
      }
    }
    this.world.tourDone();
  }
}
