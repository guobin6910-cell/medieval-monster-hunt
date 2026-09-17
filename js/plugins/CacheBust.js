//=============================================================================
// CacheBust.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc 強制插件重新下載（避免手機快取）v1.1
 * @author BraveAcademy
 */
(() => {
  const VER = "20260917d";
  PluginManager.loadScript = function (filename) {
    const url = this._path + filename + "?v=" + VER;
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;
    script.async = false;
    script._url = url;
    script.addEventListener("load", this.onLoad.bind(this));
    script.addEventListener("error", this.onError.bind(this));
    document.body.appendChild(script);
  };
})();
