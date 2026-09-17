/*:
 * @target MZ
 * @plugindesc v1.2 敵人戰鬥配置：預設縮小、靠左、攻擊踏步前衝
 * @author RPG遊戲製作家
 * @help
 * 【縮放】
 * 插件參數 Default Scale 預設 70（縮小30%）。
 * 也可在敵人備註覆寫：<Scale: 70%> 或 <Scale: 0.7>
 *
 * 【位置】
 * 側視戰鬥時，敵人主場位置靠左（參數 Home X / Home Y）。
 * 敵群資料庫的 X 仍可微調相對位置。
 *
 * 【攻擊動作】
 * 本包 META 側視圖是「單張立繪」不是主角那種九宮格動作表，
 * 因此用「踏步前衝＋後退」模擬攻擊動作，並搭配資料庫技能動畫。
 * 若要完整揮刀多幀，需換成 Actor 規格 SV 動作表＋專用插件。
 *
 * @param defaultScale
 * @text Default Scale (%)
 * @type number
 * @min 5
 * @max 200
 * @default 70
 *
 * @param homeX
 * @text Home X (左側)
 * @type number
 * @min 0
 * @max 816
 * @default 200
 *
 * @param homeY
 * @text Home Y
 * @type number
 * @min 0
 * @max 624
 * @default 360
 *
 * @param attackStep
 * @text 攻擊前衝距離
 * @type number
 * @min 0
 * @max 300
 * @default 48
 *
 * @param useHomeOverride
 * @text 強制使用 Home 座標
 * @type boolean
 * @default true
 */

(() => {
  const pluginName = 'EnemyBattleLayout';
  const params = PluginManager.parameters(pluginName);
  const defaultScale = Math.max(0.05, (Number(params.defaultScale || 70) / 100));
  const homeX = Number(params.homeX || 200);
  const homeY = Number(params.homeY || 360);
  const attackStep = Number(params.attackStep || 48);
  const useHomeOverride = String(params.useHomeOverride || 'true') === 'true';

  function noteScale(note) {
    if (!note) return null;
    let m = note.match(/<\s*Scale\s*:\s*(\d+)\s*%?\s*>/i);
    if (m) {
      const v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    m = note.match(/<\s*Scale\s*:\s*([\d.]+)\s*>/i);
    if (m) {
      const v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    return null;
  }

  function enemyScale(battler) {
    try {
      const n = noteScale(battler.enemy().note);
      return n !== null ? n : defaultScale;
    } catch (e) {
      return defaultScale;
    }
  }

  // Scale every frame (keep compatible with old EnemyScale notes)
  const _Sprite_Enemy_update = Sprite_Enemy.prototype.update;
  Sprite_Enemy.prototype.update = function () {
    _Sprite_Enemy_update.call(this);
    if (this._battler && this._battler.isEnemy && this._battler.isEnemy()) {
      const s = enemyScale(this._battler);
      if (this.scale.x !== s || this.scale.y !== s) {
        this.scale.x = s;
        this.scale.y = s;
      }
    }
  };

  // Place enemies on the left in side-view
  const _Sprite_Enemy_setHome = Sprite_Enemy.prototype.setHome;
  Sprite_Enemy.prototype.setHome = function (x, y) {
    if (.isSideView() && useHomeOverride) {
      // troop x is used as slight horizontal offset from base homeX
      const offset = (Number(x) || 0) - 408; // relative to old centerish default
      const nx = homeX + offset * 0.35;
      const ny = homeY + ((Number(y) || 400) - 400) * 0.4;
      _Sprite_Enemy_setHome.call(this, nx, ny);
      return;
    }
    _Sprite_Enemy_setHome.call(this, x, y);
  };

  // Attack step-forward like actors (motion substitute for single-frame SV art)
  const _Sprite_Enemy_initMembers = Sprite_Enemy.prototype.initMembers;
  Sprite_Enemy.prototype.initMembers = function () {
    _Sprite_Enemy_initMembers.call(this);
    this._attackStepMoving = false;
  };

  const _Sprite_Enemy_updateMove = Sprite_Enemy.prototype.updateMove;
  Sprite_Enemy.prototype.updateMove = function () {
    _Sprite_Enemy_updateMove.call(this);
  };

  const _Game_Enemy_performActionStart = Game_Enemy.prototype.performActionStart;
  Game_Enemy.prototype.performActionStart = function (action) {
    _Game_Enemy_performActionStart.call(this, action);
    if (.isSideView() && action && action.isAttack && (action.isAttack() || action.isSkill())) {
      const sprite = findEnemySprite(this);
      if (sprite) {
        // step toward actors (to the right)
        sprite.startMove(attackStep, 0, 8);
      }
    }
  };

  const _Game_Enemy_performActionEnd = Game_Enemy.prototype.performActionEnd;
  Game_Enemy.prototype.performActionEnd = function () {
    _Game_Enemy_performActionEnd.call(this);
    if (.isSideView()) {
      const sprite = findEnemySprite(this);
      if (sprite) {
        sprite.startMove(0, 0, 12);
      }
    }
  };

  function findEnemySprite(battler) {
    if (!SceneManager._scene || !SceneManager._scene._spriteset) return null;
    const sprites = SceneManager._scene._spriteset._enemySprites || [];
    return sprites.find(s => s && s._battler === battler) || null;
  }
})();
