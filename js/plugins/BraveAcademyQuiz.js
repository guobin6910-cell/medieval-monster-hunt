//=============================================================================
// BraveAcademyQuiz.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc 勇者學院問答系統（資料驅動） v1.2
 * @author RPG遊戲製作家
 *
 * @param QuizPath
 * @text 題庫路徑
 * @default data/quiz/grade1.json
 *
 * @command StartQuiz
 * @text 開始考試
 * @arg teacherId
 * @type string
 * @text 老師ID
 *
 * @command ContinueQuiz
 * @text 繼續考試
 *
 * @command GiveHint
 * @text 使用提示
 *
 * @help
 * 老師事件：插件指令 StartQuiz，teacherId 例如 G1_CH
 * 題庫欄位對應 grade1.json：troopIdCorrect / troopIdWrong / wrongHpRate / correctMsg / wrongMsg
 */
(() => {
  const PLUGIN = "BraveAcademyQuiz";
  const params = PluginManager.parameters(PLUGIN);
  const QUIZ_PATH = String(params.QuizPath || "data/quiz/grade1.json");
  const V = {
    grade: 21, qIndex: 24, playerAns: 25, correctAns: 26, wrongCount: 27,
    gradeTeacherCount: 29, badgeCount: 30, troopId: 32
  };
  const S = { exam: 23, grade1BossOpen: 30 };

  window.BraveAcademy = window.BraveAcademy || {};
  const BA = window.BraveAcademy;
  BA._data = null;
  BA._teacher = null;
  BA._q = null;
  BA._advanceOnWin = false;
  BA._battlePending = false;
  BA._queuedTroop = null;
  BA._queuedAdvance = false;

  BA.load = function (cb) {
    if (BA._data) { if (cb) cb(); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("GET", QUIZ_PATH);
    xhr.overrideMimeType("application/json");
    xhr.onload = function () {
      if (xhr.status < 400) {
        BA._data = JSON.parse(xhr.responseText);
        if (cb) cb();
      } else {
        alert("題庫載入失敗: " + QUIZ_PATH);
      }
    };
    xhr.onerror = function () { alert("題庫載入失敗: " + QUIZ_PATH); };
    xhr.send();
  };

  BA.findTeacher = function (id) {
    return (BA._data.teachers || []).find(t => t.teacherId === id);
  };

  BA.start = function (teacherId) {
    BA.load(function () {
      const t = BA.findTeacher(teacherId);
      if (!t) { $gameMessage.add("找不到老師：" + teacherId); return; }
      if ($gameSwitches.value(t.clearSwitchId)) {
        $gameMessage.add(t.name + "：你已經取得本學科認證了。");
        return;
      }
      BA._teacher = t;
      let idx = $gameVariables.value(t.progressVarId) || 0;
      if (idx < 0) idx = 0;
      if (idx >= t.questions.length) idx = t.questions.length - 1;
      $gameVariables.setValue(V.qIndex, idx);
      $gameVariables.setValue(V.wrongCount, 0);
      $gameVariables.setValue(V.grade, BA._data.grade || 1);
      $gameSwitches.setValue(S.exam, true);
      BA.showQuestion();
    });
  };

  BA.currentQuestion = function () {
    const t = BA._teacher;
    if (!t) return null;
    return t.questions[$gameVariables.value(V.qIndex) || 0];
  };

  BA.showQuestion = function () {
    const t = BA._teacher;
    const q = BA.currentQuestion();
    if (!t || !q) return;
    BA._q = q;
    const n = ($gameVariables.value(V.qIndex) || 0) + 1;
    $gameVariables.setValue(V.correctAns, q.answer);
    const abcd = ["A", "B", "C", "D"];
    const choiceTexts = q.options.map((op, i) => abcd[i] + ". " + op);
    $gameMessage.add("【" + t.subject + " " + n + "／" + t.questions.length + "】");
    $gameMessage.add(q.question);
    $gameMessage.setChoices(choiceTexts, 0, -1);
    $gameMessage.setChoiceCallback(function (i) { BA.onChoose(i); });
  };

  BA.onChoose = function (i) {
    const q = BA._q;
    if (!q) return;
    $gameVariables.setValue(V.playerAns, i);
    if (i === q.answer) BA.onCorrect();
    else BA.onWrong();
  };

  BA.applyHpPenalty = function (rate) {
    $gameParty.members().forEach(function (a) {
      const dmg = Math.max(1, Math.floor(a.mhp * rate / 100));
      a.gainHp(-dmg);
      if (a.hp < 1) a.setHp(1);
    });
  };

  BA.startTroop = function (troopId, advanceOnWin) {
    BA._advanceOnWin = !!advanceOnWin;
    BA._battlePending = true;
    $gameVariables.setValue(V.troopId, troopId);
    BattleManager.setup(troopId, false, false);
    BattleManager.saveBgmAndBgs();
    BattleManager.playBattleBgm();
    SceneManager.push(Scene_Battle);
  };

  BA.onCorrect = function () {
    const q = BA._q;
    $gameMessage.add(q.correctMsg || "回答正確！");
    $gameMessage.add("解析：" + (q.explain || ""));
    $gameVariables.setValue(V.wrongCount, 0);
    BA._queuedTroop = q.troopIdCorrect || 1;
    BA._queuedAdvance = true;
  };

  BA.onWrong = function () {
    const q = BA._q;
    let wc = ($gameVariables.value(V.wrongCount) || 0) + 1;
    $gameVariables.setValue(V.wrongCount, wc);
    const rates = q.wrongHpRate || [10, 15, 20, 10];
    const rate = rates[Math.min(wc - 1, rates.length - 1)];
    BA.applyHpPenalty(rate);
    $gameMessage.add(q.wrongMsg || "回答錯誤！");
    $gameMessage.add("解析：" + (q.explain || ""));
    $gameMessage.add("（HP -" + rate + "%）必須重答本題！");
    BA._queuedTroop = q.troopIdWrong || 1;
    BA._queuedAdvance = false;
  };

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.call(this);
    if (BA._queuedTroop && !$gameMessage.isBusy() && !BA._battlePending) {
      const troopId = BA._queuedTroop;
      const adv = BA._queuedAdvance;
      BA._queuedTroop = null;
      BA.startTroop(troopId, adv);
    }
  };

  BA.afterBattle = function () {
    BA._battlePending = false;
    if (!$gameParty.isAlive()) return;
    if (BA._advanceOnWin) {
      const t = BA._teacher;
      let idx = ($gameVariables.value(V.qIndex) || 0) + 1;
      $gameVariables.setValue(t.progressVarId, idx);
      $gameVariables.setValue(V.qIndex, idx);
      const q = BA._q;
      if (q && q.reward && q.reward.type === "item" && q.reward.id) {
        $gameParty.gainItem($dataItems[q.reward.id], q.reward.amount || 1);
      }
      if (idx >= t.questions.length) BA.completeTeacher();
      else {
        $gameMessage.add("繼續下一題！");
        BA.showQuestion();
      }
    } else {
      $gameMessage.add("再試一次同一題！");
      BA.showQuestion();
    }
  };

  BA.completeTeacher = function () {
    const t = BA._teacher;
    $gameSwitches.setValue(t.clearSwitchId, true);
    $gameSwitches.setValue(S.exam, false);
    if (t.badgeItemId) $gameParty.gainItem($dataItems[t.badgeItemId], 1);
    const badges = ($gameVariables.value(V.badgeCount) || 0) + 1;
    $gameVariables.setValue(V.badgeCount, badges);
    const done = ($gameVariables.value(V.gradeTeacherCount) || 0) + 1;
    $gameVariables.setValue(V.gradeTeacherCount, done);
    $gameMessage.add("恭喜！完成【" + t.subject + "】課程！");
    $gameMessage.add("獲得學科徽章：" + t.subject + "徽章");
    if (done >= 6) {
      $gameSwitches.setValue(S.grade1BossOpen, true);
      $gameMessage.add("六枚徽章齊全！綜合考場的門打開了！");
    }
    BA._teacher = null;
    BA._q = null;
  };

  const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function () {
    _Scene_Battle_terminate.call(this);
    if (BA._battlePending) {
      if ($gameParty.isAlive()) BA.afterBattle();
      else BA._battlePending = false;
    }
  };

  PluginManager.registerCommand(PLUGIN, "StartQuiz", args => {
    BA.start(String(args.teacherId || ""));
  });
  PluginManager.registerCommand(PLUGIN, "ContinueQuiz", () => {
    if (BA._teacher) BA.showQuestion();
  });
  PluginManager.registerCommand(PLUGIN, "GiveHint", () => {
    const q = BA.currentQuestion();
    if (!q) return;
    const wrong = [0, 1, 2, 3].filter(i => i !== q.answer);
    const hide = wrong[Math.floor(Math.random() * wrong.length)];
    $gameMessage.add("提示：可以先排除選項 " + "ABCD"[hide] + "。");
  });
})();
