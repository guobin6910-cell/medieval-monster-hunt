//=============================================================================
// BraveAcademyQuiz.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc 勇者學院問答系統（JSON題庫／教師ID）v1.3
 * @author BraveAcademy
 *
 * @param quizFolder
 * @text 題庫資料夾
 * @default quiz
 *
 * @command startExam
 * @text 開始考試
 * @arg teacherId
 * @type string
 * @default G1_CH
 *
 * @command readProgress
 * @text 讀取進度
 * @arg teacherId
 * @type string
 * @default G1_CH
 *
 * @command applyCorrectBattle
 * @text 套用答對戰鬥修正
 *
 * @command applyWrongBattle
 * @text 套用答錯戰鬥修正
 *
 * @command grantReward
 * @text 發放本題獎勵
 *
 * @command markTeacherComplete
 * @text 標記老師完成
 * @arg teacherId
 * @type string
 * @default G1_CH
 *
 * @help
 * 題庫：data/quiz/grade1.json
 * 教師事件：插件指令 startExam + teacherId（例 G1_SC）
 *
 * v1.3：
 * - 戰鬥結果用 result===0 判定勝利（不用 !!result）
 * - 不用 $gameParty.isAlive（改 aliveMembers）
 * - 獎勵用 gainItem($dataWeapons/$dataArmors/$dataItems)
 */

(() => {
  "use strict";

  const PLUGIN = "BraveAcademyQuiz";
  const FOLDER = String(PluginManager.parameters(PLUGIN).quizFolder || "quiz");

  const V = {
    grade: 31,
    subject: 32,
    teacher: 33,
    qNo: 34,
    playerAns: 35,
    correctAns: 36,
    wrongCount: 37,
    teacherProgress: 38,
    teachersCleared: 39,
    badgeCount: 40,
    troopTemp: 41,
    rewardTemp: 42
  };
  const S = {
    prologue: 21,
    enrolled: 22,
    examActive: 23,
    teacherBase: 24,
    examOpen: 30,
    grade1Clear: 31,
    bossDown: 32
  };
  const TEACHER_ORDER = ["G1_CH", "G1_MA", "G1_HI", "G1_GE", "G1_SC", "G1_MG"];
  const SUBJECT_CODE = {
    "國文": 1,
    "數學": 2,
    "歷史": 3,
    "地理": 4,
    "自然": 5,
    "魔法常識": 6
  };

  const BA = (window.BraveAcademy = window.BraveAcademy || {});
  BA._db = null;
  BA._byTeacher = {};
  BA._state = null;
  BA._busy = false;

  function setV(id, val) { $gameVariables.setValue(id, val | 0); }
  function getV(id) { return $gameVariables.value(id) | 0; }
  function setS(id, val) { $gameSwitches.setValue(id, !!val); }
  function getS(id) { return !!$gameSwitches.value(id); }

  function partyAlive() {
    return $gameParty.aliveMembers().length > 0;
  }

  function loadQuiz() {
    if (BA._db) return Promise.resolve(BA._db);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "data/" + FOLDER + "/grade1.json");
      xhr.overrideMimeType("application/json");
      xhr.onload = () => {
        if (xhr.status < 400) {
          BA._db = JSON.parse(xhr.responseText);
          BA._byTeacher = {};
          (BA._db.questions || []).forEach((q) => {
            (BA._byTeacher[q.teacherId] = BA._byTeacher[q.teacherId] || []).push(q);
          });
          resolve(BA._db);
        } else {
          reject(new Error("quiz HTTP " + xhr.status));
        }
      };
      xhr.onerror = () => reject(new Error("quiz XHR error"));
      xhr.send();
    });
  }

  function teacherMeta(tid) {
    return ((BA._db && BA._db.teachers) || []).find((t) => t.teacherId === tid) || null;
  }

  function teacherSwitch(tid) {
    const i = TEACHER_ORDER.indexOf(tid);
    return i >= 0 ? S.teacherBase + i : 0;
  }

  function countBadges() {
    let n = 0;
    for (let i = 0; i < 6; i++) if (getS(S.teacherBase + i)) n++;
    setV(V.badgeCount, n);
    setV(V.teachersCleared, n);
    if (n >= 6) setS(S.examOpen, true);
    return n;
  }

  function ensureHpFloor() {
    $gameParty.members().forEach((a) => {
      if (a.hp < 1) a.setHp(1);
    });
  }

  function applyWrongHpPenalty(wrongCount) {
    const rates = [0.1, 0.15, 0.2, 0.1];
    const rate = rates[Math.min(Math.max(wrongCount, 1) - 1, rates.length - 1)];
    $gameParty.members().forEach((a) => {
      const loss = Math.max(1, Math.floor(a.mhp * rate));
      a.setHp(Math.max(1, a.hp - loss));
    });
    ensureHpFloor();
  }

  function waitMessageThen(fn) {
    const iv = setInterval(() => {
      if (!$gameMessage.isBusy()) {
        clearInterval(iv);
        try {
          fn();
        } catch (e) {
          console.error("[BraveAcademyQuiz]", e);
        }
      }
    }, 16);
  }

  BA.applyCorrectBattleMods = function () {
    $gameParty.members().forEach((a) => {
      a.gainMp(Math.max(1, Math.floor(a.mmp * 0.1)));
    });
    if (BA._state && BA._state.question) {
      setV(V.troopTemp, BA._state.question.troopIdCorrect | 0);
    }
  };

  BA.applyWrongBattleMods = function () {
    ensureHpFloor();
    if (BA._state && BA._state.question) {
      setV(V.troopTemp, BA._state.question.troopIdWrong | 0);
    }
  };

  BA.grantCurrentReward = function () {
    const q = BA._state && BA._state.question;
    if (!q || !q.rewardId) return;
    const id = q.rewardId | 0;
    const t = String(q.rewardType || "item");
    if (t === "weapon" && $dataWeapons[id]) $gameParty.gainItem($dataWeapons[id], 1);
    else if (t === "armor" && $dataArmors[id]) $gameParty.gainItem($dataArmors[id], 1);
    else if ($dataItems[id]) $gameParty.gainItem($dataItems[id], 1);
  };

  BA.markTeacherComplete = function (tid) {
    const sw = teacherSwitch(tid);
    if (sw) setS(sw, true);
    const meta = teacherMeta(tid);
    if (meta && meta.badgeItemId && $dataItems[meta.badgeItemId]) {
      $gameParty.gainItem($dataItems[meta.badgeItemId], 1);
    }
    countBadges();
    setS(S.examActive, false);
    BA._state = null;
    BA._busy = false;
  };

  BA.readProgress = function (tid) {
    const list = BA._byTeacher[tid] || [];
    const sw = teacherSwitch(tid);
    const cleared = !!(sw && getS(sw));
    const progress = cleared
      ? list.length
      : Math.max(0, Math.min(getV(V.teacherProgress), list.length));
    return { cleared: cleared, progress: progress, total: list.length };
  };

  function syncVars(tid, q, qNo1, wrong) {
    const meta = teacherMeta(tid) || {};
    setV(V.grade, 1);
    setV(V.subject, SUBJECT_CODE[q.subject] || SUBJECT_CODE[meta.subject] || 0);
    setV(V.teacher, TEACHER_ORDER.indexOf(tid) + 1);
    setV(V.qNo, qNo1);
    setV(V.correctAns, q.answer | 0);
    setV(V.wrongCount, wrong | 0);
    setV(V.teacherProgress, Math.max(0, qNo1 - 1));
    setV(V.rewardTemp, q.rewardId | 0);
  }

  function askQuestion() {
    const st = BA._state;
    if (!st) return;
    const list = BA._byTeacher[st.teacherId];
    if (!list || st.index >= list.length) {
      BA.markTeacherComplete(st.teacherId);
      $gameMessage.add("恭喜通過本科考試，獲得徽章！");
      return;
    }
    const q = list[st.index];
    st.question = q;
    syncVars(st.teacherId, q, st.index + 1, st.wrongCount);
    setS(S.examActive, true);
    $gameMessage.add("【" + q.subject + "】第 " + (st.index + 1) + "／" + list.length + " 題");
    $gameMessage.add(String(q.question));
    $gameMessage.setChoices(q.options.slice(0, 4), 0, -1);
    $gameMessage.setChoiceCallback((i) => onAnswer(i));
  }

  function onAnswer(choiceIndex) {
    const st = BA._state;
    if (!st || !st.question) return;
    const q = st.question;
    setV(V.playerAns, choiceIndex | 0);
    const correct = (choiceIndex | 0) === (q.answer | 0);
    if (correct) {
      st.wrongCount = 0;
      setV(V.wrongCount, 0);
      $gameMessage.add(String(q.correctMsg || "答對了！"));
      if (q.explain) $gameMessage.add(String(q.explain));
      BA.applyCorrectBattleMods();
      st.pendingAdvance = true;
      waitMessageThen(() => startBattle(q.troopIdCorrect || 21));
    } else {
      st.wrongCount = (st.wrongCount | 0) + 1;
      setV(V.wrongCount, st.wrongCount);
      applyWrongHpPenalty(st.wrongCount);
      $gameMessage.add(String(q.wrongMsg || "答錯了！"));
      $gameMessage.add("正解：" + q.options[q.answer]);
      if (q.explain) $gameMessage.add(String(q.explain));
      BA.applyWrongBattleMods();
      st.pendingAdvance = false;
      waitMessageThen(() => startBattle(q.troopIdWrong || 22));
    }
  }

  function startBattle(troopId) {
    const tid = Math.max(1, troopId | 0);
    setV(V.troopTemp, tid);
    BA._busy = true;
    // canEscape=false, canLose=true（學院結界）
    BattleManager.setup(tid, false, true);
    BattleManager.setEventCallback((result) => {
      // MZ：0=勝、1=逃、2=敗
      afterBattle(result === 0);
    });
    SceneManager.push(Scene_Battle);
  }

  function afterBattle(won) {
    const st = BA._state;
    BA._busy = false;
    ensureHpFloor();
    if (!st) return;
    if (!partyAlive()) ensureHpFloor();
    if (!won) {
      ensureHpFloor();
      $gameMessage.add("學院結界保住了你……準備好後再挑戰同一題吧。");
      setS(S.examActive, false);
      return;
    }
    if (st.pendingAdvance) {
      BA.grantCurrentReward();
      st.index += 1;
      st.wrongCount = 0;
      setV(V.wrongCount, 0);
      setV(V.teacherProgress, st.index);
      st.pendingAdvance = false;
      const list = BA._byTeacher[st.teacherId] || [];
      if (st.index >= list.length) {
        $gameMessage.add("十題全對！本科合格！");
        waitMessageThen(() => {
          BA.markTeacherComplete(st.teacherId);
          $gameMessage.add("獲得學科徽章。集齊六枚可挑戰綜合考。");
        });
        return;
      }
    }
    waitMessageThen(askQuestion);
  }

  BA.startExam = function (teacherId) {
    const tid = String(teacherId || "G1_CH");
    if (BA._busy) {
      $gameMessage.add("考試進行中……");
      return;
    }
    loadQuiz()
      .then(() => {
        const list = BA._byTeacher[tid];
        if (!list || !list.length) {
          $gameMessage.add("找不到題庫：" + tid);
          return;
        }
        const sw = teacherSwitch(tid);
        if (sw && getS(sw)) {
          $gameMessage.add("你已經通過這位老師的考試了。");
          return;
        }
        let startIndex = 0;
        if (getV(V.teacher) === TEACHER_ORDER.indexOf(tid) + 1) {
          startIndex = Math.max(0, Math.min(getV(V.teacherProgress), list.length - 1));
        }
        BA._state = {
          teacherId: tid,
          index: startIndex,
          wrongCount: 0,
          pendingAdvance: false,
          question: null
        };
        const meta = teacherMeta(tid);
        const name = (meta && meta.name) || "老師";
        $gameMessage.add(name + "：考試開始！共 " + list.length + " 題。");
        $gameMessage.add("答錯扣血（至少留1）並重考同題；答對後戰鬥勝利才進下一題。");
        waitMessageThen(askQuestion);
      })
      .catch((err) => {
        console.error(err);
        $gameMessage.add("題庫讀取失敗：data/" + FOLDER + "/grade1.json");
      });
  };

  const _boot = Scene_Boot.prototype.onDatabaseLoaded;
  Scene_Boot.prototype.onDatabaseLoaded = function () {
    _boot.call(this);
    loadQuiz().catch(() => {});
  };

  const _bmEnd = BattleManager.endBattle;
  BattleManager.endBattle = function (result) {
    ensureHpFloor();
    _bmEnd.call(this, result);
    ensureHpFloor();
  };

  PluginManager.registerCommand(PLUGIN, "startExam", (args) => {
    BA.startExam(String(args.teacherId || "G1_CH"));
  });
  PluginManager.registerCommand(PLUGIN, "readProgress", (args) => {
    loadQuiz().then(() => {
      const p = BA.readProgress(String(args.teacherId || "G1_CH"));
      setV(V.teacherProgress, p.progress);
      $gameMessage.add(p.cleared ? "已完成此科。" : "進度 " + p.progress + "/" + p.total);
    });
  });
  PluginManager.registerCommand(PLUGIN, "applyCorrectBattle", () => BA.applyCorrectBattleMods());
  PluginManager.registerCommand(PLUGIN, "applyWrongBattle", () => BA.applyWrongBattleMods());
  PluginManager.registerCommand(PLUGIN, "grantReward", () => BA.grantCurrentReward());
  PluginManager.registerCommand(PLUGIN, "markTeacherComplete", (args) => {
    BA.markTeacherComplete(String(args.teacherId || "G1_CH"));
  });
})();
