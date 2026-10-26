// 対局の進め方（DOMに依存しない。画面は app.js、テストは game.test.js）
// G＝対局の状態。st＝盤の状態（rules.js）、hist＝待ったで戻る先、ghost＝仮の石の位置、
// ghostBad＝仮の石の点に打てない理由、timer＝コンピュータの手番のタイマー、
// dead＝終局後に死に石の印を付けた石（終局前は null）、result＝数えた結果
// env＝{ setTimeout, clearTimeout, random }。テストでは偽物を渡して時間を進める。
(function (root) {
  'use strict';

  var R = (typeof module !== 'undefined' && module.exports) ? require('./rules.js') : root.GoRules;
  var BLACK = R.BLACK, WHITE = R.WHITE;
  var THINK_MS = 700;

  function create(size) {
    return {
      st: R.createGame(size || 9), hist: [], ghost: null, ghostBad: null,
      timer: null, dead: null, result: null, hl: [], info: ''
    };
  }

  // 保存した対局から再開する。数え終わった対局は再開しない
  function restore(saved) {
    if (!saved || !saved.st || saved.done) return null;
    var G = create(saved.st.size);
    G.st = saved.st;
    G.hist = saved.hist || [];
    G.info = saved.info || '';
    if (G.st.over) G.dead = R.cleanDead(G.st.board, saved.dead);
    return G;
  }
  function toSaved(G) {
    return { st: G.st, hist: G.hist.slice(-120), info: G.info, dead: G.dead, done: !!G.result };
  }

  function computerToPlay(G) { return !G.st.over && G.st.toPlay === WHITE; }
  function clearGhost(G) { G.ghost = null; G.ghostBad = null; }

  // あなた（黒）が盤をタップした
  // 1回目で仮の石。打てない点なら仮の石を赤くして理由を返す。同じ点をもう一度で打つ
  function tap(G, i) {
    if (G.st.over || G.st.toPlay !== BLACK) return { kind: 'ignore' };
    var res = R.playMove(G.st, i);
    if (!res.ok) { G.ghost = i; G.ghostBad = res.reason; return { kind: 'bad', reason: res.reason }; }
    if (G.ghost !== i) { G.ghost = i; G.ghostBad = null; return { kind: 'ghost' }; }
    G.hist.push(G.st);
    G.st = res.state;
    clearGhost(G);
    G.info = '';
    G.hl = [];
    return { kind: 'played', res: res };
  }

  function passBlack(G) {
    if (G.st.over || G.st.toPlay !== BLACK) return false;
    G.hist.push(G.st);
    G.st = R.pass(G.st);
    clearGhost(G);
    G.hl = [];
    G.info = '';
    if (G.st.over) G.dead = [];
    return true;
  }

  // コンピュータ（弱い）：ほぼでたらめ。1手で取れるときは、ときどき取る
  function pick(list, random) { return list[Math.floor(random() * list.length)]; }
  function chooseMove(st, afterPass, random) {
    var cands = [], caps = [];
    for (var i = 0; i < st.board.length; i++) {
      if (st.board[i] !== R.EMPTY) continue;
      // 自分の石だけに囲まれた点（自分の目）は埋めない
      var ownEye = R.neighbors(st.size, i).every(function (n) { return st.board[n] === st.toPlay; });
      if (ownEye) continue;
      var res = R.playMove(st, i);
      if (!res.ok) continue;
      cands.push(i);
      if (res.captured.length) caps.push(i);
    }
    if (afterPass) return caps.length && random() < 0.5 ? pick(caps, random) : null;
    if (caps.length && random() < 0.35) return pick(caps, random);
    return cands.length ? pick(cands, random) : null;
  }

  // コンピュータが1手打つ。白番でなければ何もしない（タイマーが重なっても2回打たない）
  function computerTurn(G, random) {
    if (G.st.toPlay !== WHITE || G.st.over) return null;
    var move = chooseMove(G.st, G.st.passes > 0, random);
    if (move === null) {
      G.st = R.pass(G.st);
      G.info = G.st.over ? '' : 'コンピュータはパスしました。あなたもパスすると終局です。';
      if (G.st.over) G.dead = [];
      return { passed: true };
    }
    var res = R.playMove(G.st, move);
    G.st = res.state;
    G.info = res.captured.length ? '白に石を ' + res.captured.length + ' つ{取られ}ました。' : '';
    return { res: res };
  }

  // コンピュータの手番を少し待ってから打つ。前のタイマーは止めてから付け直す
  function schedule(G, env, after) {
    cancel(G, env);
    if (!computerToPlay(G)) return;
    G.timer = env.setTimeout(function () {
      G.timer = null;
      var out = computerTurn(G, env.random);
      if (out && after) after(out);
    }, THINK_MS);
  }
  function cancel(G, env) {
    if (G.timer != null) env.clearTimeout(G.timer);
    G.timer = null;
  }

  // 待った：あなたの直前の手（またはパス）の前に戻る。コンピュータが考え中でも戻せる
  function undo(G, env) {
    cancel(G, env);
    if (!G.hist.length) return false;
    G.st = G.hist.pop();
    clearGhost(G);
    G.dead = null;
    G.result = null;
    G.hl = [];
    G.info = '1手戻しました。';
    return true;
  }

  // 終局後：石をタップして死に石の印を付け外しする（連ごと）
  // 自分（黒）の石に新しく印を付けるときは、sure が無ければ印を付けずに 'confirm' を返す（画面で確かめてもらう）
  function toggleDead(G, i, sure) {
    if (!G.st.over || G.result || G.st.board[i] === R.EMPTY) return false;
    var dead = G.dead || [];
    if (G.st.board[i] === BLACK && dead.indexOf(i) < 0 && !sure) return 'confirm';
    G.dead = R.toggleDead(G.st.board, G.st.size, dead, i);
    return true;
  }
  // 印の付いた黒の石の数
  function blackMarked(G) {
    return R.cleanDead(G.st.board, G.dead).filter(function (i) { return G.st.board[i] === BLACK; }).length;
  }
  // 死に石を取り除いて数える。黒の石に印があれば、sure が無ければ数えずに null を返す
  function finish(G, sure) {
    if (blackMarked(G) && !sure) return null;
    G.result = R.score(G.st.board, G.st.size, G.st.captures, G.dead || []);
    return G.result;
  }

  var api = {
    THINK_MS: THINK_MS,
    create: create, restore: restore, toSaved: toSaved, computerToPlay: computerToPlay,
    tap: tap, passBlack: passBlack, chooseMove: chooseMove, computerTurn: computerTurn,
    schedule: schedule, cancel: cancel, undo: undo, toggleDead: toggleDead, blackMarked: blackMarked, finish: finish
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoGame = api;
})(typeof window !== 'undefined' ? window : this);
