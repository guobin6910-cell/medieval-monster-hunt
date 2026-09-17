/*:
 * @target MZ
 * @plugindesc v1.1 敵人縮放 - 備註 <Scale: 20%> 強制縮放 (支援超大圖)
 * @author MetaAI Fix
 * @help
 * 在敵人備註寫：
 *   <Scale: 15%>  縮到15% (原圖1232用這個)
 *   <Scale: 25%>  縮到25%
 *   <Scale: 0.25> 同上
 * 戰鬥測試才看得到，編輯器預覽不變。
 */

(() => {
  function getScale(note) {
    if (!note) return null;
    let m = note.match(/<\s*Scale\s*:\s*(\d+)\s*%?\s*>/i);
    if (m) {
      let v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    m = note.match(/<\s*Scale\s*:\s*([\d.]+)\s*>/i);
    if (m) {
      let v = parseFloat(m[1]);
      return v > 1 ? v / 100 : v;
    }
    return null;
  }

  const _update = Sprite_Enemy.prototype.update;
  Sprite_Enemy.prototype.update = function() {
    _update.call(this);
    if (this._battler && this._battler.enemy) {
      try {
        const s = getScale(this._battler.enemy().note);
        if (s !== null) {
          if (this.scale.x !== s) {
            this.scale.x = s;
            this.scale.y = s;
          }
        }
      } catch(e) {}
    }
  };
})();
