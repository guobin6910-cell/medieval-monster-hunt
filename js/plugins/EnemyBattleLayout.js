/*:
 * @target MZ
 * @plugindesc v1.3 Enemy layout: scale 70%, left side, attack step
 * @author RPG Game Maker
 * @help
 * Default Scale 70% (shrink 30%). Note tag: <Scale: 70%>
 * Side-view enemies home to the left.
 * Attack uses step-forward motion (META SV art is single-frame).
 *
 * @param defaultScale
 * @text Default Scale (%)
 * @type number
 * @min 5
 * @max 200
 * @default 70
 *
 * @param homeX
 * @text Home X
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
 * @text Attack Step
 * @type number
 * @min 0
 * @max 300
 * @default 48
 *
 * @param useHomeOverride
 * @text Force Home Position
 * @type boolean
 * @default true
 */

(function() {
  var pluginName = "EnemyBattleLayout";
  var params = PluginManager.parameters(pluginName);
  var defaultScale = Math.max(0.05, (Number(params.defaultScale || 70) / 100));
  var homeX = Number(params.homeX || 200);
  var homeY = Number(params.homeY || 360);
  var attackStep = Number(params.attackStep || 48);
  var useHomeOverride = String(params.useHomeOverride || "true") === "true";

  function noteScale(note) {
    if (!note) return null;
    var m = note.match(/<\s*Scale\s*:\s*(\d+)\s*%?\s*>/i);
    if (m) {
      var v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    m = note.match(/<\s*Scale\s*:\s*([\d.]+)\s*>/i);
    if (m) {
      v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    return null;
  }

  function enemyScale(battler) {
    try {
      var n = noteScale(battler.enemy().note);
      return n !== null ? n : defaultScale;
    } catch (e) {
      return defaultScale;
    }
  }

  function isSideView() {
    try {
      return $gameSystem.isSideView();
    } catch (e) {
      return false;
    }
  }

  function findEnemySprite(battler) {
    try {
      if (!SceneManager._scene || !SceneManager._scene._spriteset) return null;
      var sprites = SceneManager._scene._spriteset._enemySprites || [];
      for (var i = 0; i < sprites.length; i++) {
        if (sprites[i] && sprites[i]._battler === battler) return sprites[i];
      }
    } catch (e) {}
    return null;
  }

  var _Sprite_Enemy_update = Sprite_Enemy.prototype.update;
  Sprite_Enemy.prototype.update = function() {
    _Sprite_Enemy_update.call(this);
    if (this._battler && this._battler.isEnemy && this._battler.isEnemy()) {
      var s = enemyScale(this._battler);
      if (this.scale.x !== s || this.scale.y !== s) {
        this.scale.x = s;
        this.scale.y = s;
      }
    }
  };

  var _Sprite_Enemy_setHome = Sprite_Enemy.prototype.setHome;
  Sprite_Enemy.prototype.setHome = function(x, y) {
    if (isSideView() && useHomeOverride) {
      var offset = (Number(x) || 0) - 408;
      var nx = homeX + offset * 0.35;
      var ny = homeY + ((Number(y) || 400) - 400) * 0.4;
      _Sprite_Enemy_setHome.call(this, nx, ny);
      return;
    }
    _Sprite_Enemy_setHome.call(this, x, y);
  };

  var _Game_Enemy_performActionStart = Game_Enemy.prototype.performActionStart;
  Game_Enemy.prototype.performActionStart = function(action) {
    _Game_Enemy_performActionStart.call(this, action);
    if (isSideView() && action && ((action.isAttack && action.isAttack()) || (action.isSkill && action.isSkill()))) {
      var sprite = findEnemySprite(this);
      if (sprite && sprite.startMove) {
        sprite.startMove(attackStep, 0, 8);
      }
    }
  };

  var _Game_Enemy_performActionEnd = Game_Enemy.prototype.performActionEnd;
  Game_Enemy.prototype.performActionEnd = function() {
    _Game_Enemy_performActionEnd.call(this);
    if (isSideView()) {
      var sprite = findEnemySprite(this);
      if (sprite && sprite.startMove) {
        sprite.startMove(0, 0, 12);
      }
    }
  };
})();
