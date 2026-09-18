//=============================================================================
// CacheBust.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc 強制插件重新下載（避免手機快取）v1.2
 * @author BraveAcademy
 *
 * @help
 * 必須放在插件列表最上方。
 * 正確沿用 makeUrl()（會加 .js），只附加 ?v= 版本號。
 */
(() => {
  const VER = "20260918g2";
  const _makeUrl = PluginManager.makeUrl;
  PluginManager.makeUrl = function (filename) {
    return _makeUrl.call(this, filename) + "?v=" + VER;
  };
})();
