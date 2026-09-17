//=============================================================================
// BraveAcademyQuiz.js  v2.0
//=============================================================================
/*:
 * @target MZ
 * @plugindesc 勇者學院問答 v2.0（一老師一題／答對勝利後消失）
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
 * @default G1_CH_01
 *
 * @help
 * 題庫：data/quiz/grade1.json
 * 每位老師一題。
 * 答對 → 戰鬥勝利 → 老師消失（獨立開關 A）
 * 答錯 → 扣血 → 戰鬥 → 老師留下，須再挑戰到答對勝利
 * 同科 10 位全過 → 科目徽章＋開關
 *
 * v2.0：修正連戰／多題回調造成的閃退
 */

(() => {
  "use strict";

  const PLUGIN = "BraveAcademyQuiz";
  const FOLDER = String(
    (PluginManager.parameters(PLUGIN) || {}).quizFolder || "quiz"
  );

  const V = {
    grade: 31,
    subject: 32,
    teacher: 33,
    qNo: 34,
    playerAns: 35,
    correctAns: 36,
    wrongCount: 37,
    subjectProgress: 38,
    teachersCleared: 39,
    badgeCount: 40,
    troopTemp: 41,
    rewardTemp: 42
  };
  const S = {
    examActive: 23,
    examOpen: 30
  };
  const SUBJECT_CODE = {
    "國文": 1,
    "數學": 2,
    "歷史": 3,
    "地理": 4,
    "自然": 5,
    "魔法常識": 6
  };

  const BA = (window.BraveAcademy = window.BraveAcademy || {});
  BA.db = null;
  BA.byTeacher = {};
  BA.subjects = [];
  BA.state = null;
  BA.busy = false;

  const setV = (id, val) => $gameVariables.setValue(id, val | 0);
  const setS = (id, val) => $gameSwitches.setValue(id, !!val);
  const getS = (id) => !!$gameSwitches.value(id);

  function clearedStore() {
    if (!$gameSystem._baClearedTeachers) $gameSystem._baClearedTeachers = {};
    return $gameSystem._baClearedTeachers;
  }
  function isTeacherCleared(tid) {
    return !!clearedStore()[String(tid)];
  }
  function markTeacherCleared(tid) {
    clearedStore()[String(tid)] = true;
  }

  function ensureHpFloor() {
    $gameParty.members().forEach((a) => {
      if (a.hp < 1) a.setHp(1);
    });
  }
  function applyWrongHpPenalty() {
    $gameParty.members().forEach((a) => {
      const loss = Math.max(1, Math.floor(a.mhp * 0.1));
      a.setHp(Math.max(1, a.hp - loss));
    });
  }

  function finishIdle() {
    BA.busy = false;
    setS(S.examActive, false);
    BA.state = null;
  }

  function waitMessageThen(fn) {
    const tick = () => {
      if ($gameMessage.isBusy()) {
        setTimeout(tick, 16);
        return;
      }
      try {
        fn();
      } catch (e) {
        console.error("[BraveAcademyQuiz]", e);
        finishIdle();
      }
    };
    setTimeout(tick, 16);
  }

  function whenOnMap(fn) {
    const tick = () => {
      if ($gameMessage.isBusy()) {
        setTimeout(tick, 16);
        return;
      }
      if (!(SceneManager._scene instanceof Scene_Map)) {
        setTimeout(tick, 16);
        return;
      }
      try {
        fn();
      } catch (e) {
        console.error("[BraveAcademyQuiz]", e);
        finishIdle();
      }
    };
    setTimeout(tick, 16);
  }

  function loadQuiz() {
    if (BA.db) return Promise.resolve(BA.db);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "data/" + FOLDER + "/grade1.json");
      xhr.overrideMimeType("application/json");
      xhr.onload = () => {
        if (xhr.status < 400) {
          const db = JSON.parse(xhr.responseText);
          BA.db = db;
          BA.subjects = db.subjects || [];
          BA.byTeacher = {};
          (db.questions || []).forEach((q) => {
            BA.byTeacher[q.teacherId] = q;
          });
          resolve(db);
        } else reject(new Error("quiz HTTP " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("quiz XHR error"));
      xhr.send();
    });
  }

  function teacherMeta(tid) {
    return ((BA.db && BA.db.teachers) || []).find((t) => t.teacherId === tid);
  }
  function subjectMetaById(id) {
    return BA.subjects.find((s) => s.id === id);
  }
  function subjectMetaByName(name) {
    return BA.subjects.find((s) => s.name === name);
  }

  function countSubjectCleared(subjectId) {
    const prefix = "G1_" + subjectId + "_";
    let n = 0;
    const store = clearedStore();
    Object.keys(store).forEach((tid) => {
      if (store[tid] && tid.indexOf(prefix) === 0) n++;
    });
    return n;
  }

  function countBadges() {
    let n = 0;
    BA.subjects.forEach((s) => {
      const sw = s.clearSwitchId;
      if (sw && getS(sw)) n++;
    });
    setV(V.badgeCount, n);
    setV(V.teachersCleared, n);
    if (n >= 6) setS(S.examOpen, true);
    return n;
  }

  function grantReward(q) {
    if (!q) return;
    const id = (q.rewardId || 0) | 0;
    if (!id) return;
    const t = String(q.rewardType || "item");
    if (t === "weapon" && $dataWeapons[id]) $gameParty.gainItem($dataWeapons[id], 1);
    else if (t === "armor" && $dataArmors[id]) $gameParty.gainItem($dataArmors[id], 1);
    else if ($dataItems[id]) $gameParty.gainItem($dataItems[id], 1);
  }

  function eraseTeacherEvent(eventId) {
    if (!eventId) return;
    $gameSelfSwitches.setValue([$gameMap.mapId(), eventId, "A"], true);
    const ev = $gameMap.event(eventId);
    if (ev) ev.refresh();
  }

  function maybeGrantSubjectBadge(subjectId) {
    const sub = subjectMetaById(subjectId);
    if (!sub) return;
    const cleared = countSubjectCleared(subjectId);
    setV(V.subjectProgress, cleared);
    if (cleared < 10) {
      $gameMessage.add(sub.name + "進度：" + cleared + "／10 位老師。");
      return;
    }
    const sw = sub.clearSwitchId;
    if (sw && !getS(sw)) {
      setS(sw, true);
      const badgeId = sub.badgeItemId;
      if (badgeId && $dataItems[badgeId]) {
        $gameParty.gainItem($dataItems[badgeId], 1);
      }
      $gameMessage.add(sub.name + "十位老師全數通過！獲得徽章！");
      countBadges();
      if (getS(S.examOpen)) {
        $gameMessage.add("六枚徽章集齊，綜合考場開放了！");
      }
    }
  }

  function syncVars(q, wrong) {
    setV(V.grade, 1);
    setV(V.subject, SUBJECT_CODE[q.subject] || 0);
    setV(V.teacher, 0);
    setV(V.qNo, 1);
    setV(V.correctAns, q.answer | 0);
    setV(V.wrongCount, wrong | 0);
    setV(V.rewardTemp, (q.rewardId || 0) | 0);
  }

  function askQuestion() {
    const st = BA.state;
    if (!st) return;
    const q = BA.byTeacher[st.teacherId];
    if (!q) {
      $gameMessage.add("找不到題目：" + st.teacherId);
      finishIdle();
      return;
    }
    st.question = q;
    syncVars(q, st.wrongCount);
    setS(S.examActive, true);
    const meta = teacherMeta(st.teacherId);
    const name = (meta && meta.name) || "老師";
    $gameMessage.add("【" + name + "】挑戰題");
    $gameMessage.add(String(q.question));
    const opts = (q.options || []).slice(0, 4);
    while (opts.length < 4) opts.push("—");
    $gameMessage.setChoices(opts, 0, -1);
    $gameMessage.setChoiceCallback((i) => onAnswer(i));
  }

  function onAnswer(choiceIndex) {
    const st = BA.state;
    if (!st || !st.question) return;
    const q = st.question;
    setV(V.playerAns, choiceIndex | 0);
    const correct = (choiceIndex | 0) === (q.answer | 0);
    st.pendingClear = correct;
    if (correct) {
      st.wrongCount = 0;
      setV(V.wrongCount, 0);
      $gameMessage.add(String(q.correctMsg || "答對了！"));
      if (q.explain) $gameMessage.add(String(q.explain));
      setV(V.troopTemp, (q.troopIdCorrect || 21) | 0);
      waitMessageThen(() => startBattle(q.troopIdCorrect || 21));
    } else {
      st.wrongCount = (st.wrongCount | 0) + 1;
      setV(V.wrongCount, st.wrongCount);
      applyWrongHpPenalty();
      $gameMessage.add(String(q.wrongMsg || "答錯了！"));
      const ans = (q.options || [])[q.answer];
      if (ans != null) $gameMessage.add("正解：" + ans);
      if (q.explain) $gameMessage.add(String(q.explain));
      setV(V.troopTemp, (q.troopIdWrong || 22) | 0);
      waitMessageThen(() => startBattle(q.troopIdWrong || 22));
    }
  }

  function startBattle(troopId) {
    const tid = Math.max(1, troopId | 0);
    BA.busy = true;
    whenOnMap(() => {
      BattleManager.setup(tid, false, true);
      BattleManager.setEventCallback((result) => {
        whenOnMap(() => afterBattle(result === 0));
      });
      SceneManager.push(Scene_Battle);
    });
  }

  function afterBattle(won) {
    const st = BA.state;
    ensureHpFloor();
    if (!st) {
      finishIdle();
      return;
    }
    if (!won) {
      $gameMessage.add("學院結界保住了你……準備好後再挑戰同一題吧。");
      finishIdle();
      return;
    }
    if (st.pendingClear) {
      grantReward(st.question);
      markTeacherCleared(st.teacherId);
      eraseTeacherEvent(st.eventId);
      $gameMessage.add("挑戰成功！這位老師離開教室了。");
      const meta = teacherMeta(st.teacherId);
      let sid = meta && meta.subjectId;
      if (!sid && st.question) {
        const sub = subjectMetaByName(st.question.subject);
        if (sub) sid = sub.id;
      }
      if (sid) maybeGrantSubjectBadge(sid);
      finishIdle();
      return;
    }
    $gameMessage.add("戰鬥結束。要讓老師離開，必須答對才行。再挑戰一次吧！");
    finishIdle();
  }

  BA.startExam = function (teacherId, eventId) {
    const tid = String(teacherId || "");
    if (BA.busy) {
      $gameMessage.add("挑戰進行中……");
      return;
    }
    if (isTeacherCleared(tid)) {
      $gameMessage.add("這位老師已經通過了。");
      if (eventId) eraseTeacherEvent(eventId);
      return;
    }
    loadQuiz()
      .then(() => {
        if (!BA.byTeacher[tid]) {
          $gameMessage.add("找不到題庫：" + tid);
          return;
        }
        const meta = teacherMeta(tid);
        const name = (meta && meta.name) || "老師";
        BA.state = {
          teacherId: tid,
          eventId: eventId | 0,
          wrongCount: 0,
          pendingClear: false,
          question: null
        };
        BA.busy = true;
        setS(S.examActive, true);
        $gameMessage.add(name + "：一題挑戰開始！");
        $gameMessage.add("答對並戰鬥勝利後我就會離開；答錯還能再試。");
        waitMessageThen(askQuestion);
      })
      .catch((err) => {
        console.error(err);
        $gameMessage.add("題庫讀取失敗：data/" + FOLDER + "/grade1.json");
        finishIdle();
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
    let eventId = 0;
    try {
      if ($gameMap && $gameMap._interpreter) {
        eventId = $gameMap._interpreter.eventId();
      }
    } catch (e) {}
    BA.startExam(String(args.teacherId || "G1_CH_01"), eventId);
  });
})();
