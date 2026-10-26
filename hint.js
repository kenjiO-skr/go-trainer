// 爺の指南（ヒント）。DOMに依存しない純粋な関数だけを置く
// suggest(st)：黒番のときに1手すすめる。st は書き換えない（rules.js の playMove は盤をコピーして調べる）
// 戻り値 { i: 点の番号 or null, kind: 'capture'|'escape'|'press'|'wide'|'defend'|'pass'|'none'|'notyet', msg, stones: 関係する石 }
// 乱数は使わない（同じ局面なら必ず同じ答え）。
// ブラウザでは window.GoHint、Node では require('./hint.js') で使う。
(function (root) {
  'use strict';

  var R = (typeof module !== 'undefined' && module.exports) ? require('./rules.js') : root.GoRules;
  var BLACK = R.BLACK, WHITE = R.WHITE, EMPTY = R.EMPTY;
  var LADDER_DEPTH = 60;     // シチョウの読みの深さの上限（手数）
  var LADDER_NODES = 3000;   // シチョウの読みで調べる局面の数の上限（読み切れなければ「取られない」とみなす）
  var DAME_MAX = 3;          // 境界点を除いた空き点のつながりが両方の色に接するとき、この点数以下ならダメとみなす
  var BORDER_SIDES = 2;      // 終盤とみなす：境界点（両方の色に接する空き点）が盤の辺この本数ぶん（9路で18点）以下

  // 数の言い方。1〜9 は「つ」、10以上は「個」
  function count(n) { return n + (n >= 10 ? '個' : 'つ'); }

  // 候補 {i, key:[...], d} のうち key が辞書順で一番小さいもの。
  // 同じなら天元に近い点（d が小さい）、それでも同じなら番号の小さい点
  function best(cands) {
    var out = null;
    cands.forEach(function (c) {
      if (!out) { out = c; return; }
      for (var k = 0; k < c.key.length; k++) {
        if (c.key[k] !== out.key[k]) { if (c.key[k] < out.key[k]) out = c; return; }
      }
      if (c.d !== out.d) { if (c.d < out.d) out = c; return; }
      if (c.i < out.i) out = c;
    });
    return out;
  }

  function result(i, kind, msg, stones) {
    return { i: i, kind: kind, msg: msg, stones: stones || [] };
  }

  // シチョウの読み。state は白番で、p を含む黒の連の呼吸点が2つのとき、白に取られるなら true。
  // 白は呼吸点のどちらかにアタリをかける（自分からアタリになる手は除く）。
  // 黒は残りの呼吸点へ伸びるか、黒の連に接するアタリの白を取って逃げる。
  // 呼吸点が3つ以上になれば逃げ切り。深さ・局面数の上限を超えたら「取られない」とみなす。
  function ladderCaptured(state, p) {
    var budget = { n: 0 };
    return whiteWins(state, p, 0, budget);
  }
  function whiteWins(state, p, depth, budget) {
    if (depth > LADDER_DEPTH || ++budget.n > LADDER_NODES) return false;
    var size = state.size, g = R.groupAt(state.board, size, p);
    if (!g || g.color !== BLACK) return true;
    if (g.liberties.length >= 3) return false;
    for (var k = 0; k < g.liberties.length; k++) {
      var L = g.liberties[k], r = R.playMove(state, L);
      if (!r.ok) continue;
      if (R.groupAt(r.state.board, size, L).liberties.length <= 1) continue;
      var bg = R.groupAt(r.state.board, size, p);
      if (!bg) return true;
      if (bg.liberties.length !== 1) continue;
      if (!blackEscapes(r.state, p, depth + 1, budget)) return true;
    }
    return false;
  }
  function blackEscapes(state, p, depth, budget) {
    if (depth > LADDER_DEPTH || ++budget.n > LADDER_NODES) return true;
    var size = state.size, g = R.groupAt(state.board, size, p);
    var moves = [g.liberties[0]];
    g.stones.forEach(function (s) {
      R.neighbors(size, s).forEach(function (n) {
        if (state.board[n] !== WHITE) return;
        var w = R.groupAt(state.board, size, n);
        if (w.liberties.length === 1 && moves.indexOf(w.liberties[0]) < 0) moves.push(w.liberties[0]);
      });
    });
    for (var k = 0; k < moves.length; k++) {
      var r = R.playMove(state, moves[k]);
      if (!r.ok) continue;
      var n = R.groupAt(r.state.board, size, p).liberties.length;
      if (n >= 3) return true;
      if (n === 2 && !whiteWins(r.state, p, depth + 1, budget)) return true;
    }
    return false;
  }

  // 空き点のつながり（allow に入る点だけをたどる）。戻り値 [{ pts: 点, touch: {色: true} }]
  function flood(board, size, allow) {
    var seen = {}, out = [];
    allow.forEach(function (i) {
      if (seen[i]) return;
      var pts = [], touch = {}, stack = [i];
      seen[i] = true;
      while (stack.length) {
        var q = stack.pop();
        pts.push(q);
        R.neighbors(size, q).forEach(function (n) {
          if (board[n] !== EMPTY) touch[board[n]] = true;
          else if (!seen[n] && allow.indexOf(n) >= 0) { seen[n] = true; stack.push(n); }
        });
      }
      out.push({ pts: pts, touch: touch });
    });
    return out;
  }

  // 空き点を調べる。
  // 境界点：黒と白の両方の石に（上下左右で）接する空き点。境目のダメ。終盤では1線でもダメ詰めの候補になる。
  // まず空き点のつながりを作る。
  //  ・片方の色にしか接しないつながりは地（terr。大きさは問わない）。
  //    ただし盤上に黒と白の両方の石があるときだけ（黒しか無い序盤の広い所を地にしないため）
  //  ・両方の色に接するつながりは、DAME_MAX 点以下ならダメ。
  //  ・それより大きいつながりは、境界点を除いて分け直す。分けた所がどれも片方の色にだけ接し、
  //    しかも境界点に接する石の連がどれも「自分の色の地」に呼吸点2つ以上で接しているなら
  //    （1点の目だけでは生きているとは限らないので2つ以上）、境目の境界点が開いているだけ
  //    （1線の境目が1か所開いている等）。分けた所をそれぞれの色の地、境界点をダメとする。
  //    そうならない（両方に接する所・どちらにも接しない所が残る、地を持たない石が境目にいる）なら、
  //    まだ打てる広い所（open）。地を持たない石の例：隅の黒1子の隣が境界点で、残りの盤全体が白にだけ接する序盤。
  // terr の値は地の色（BLACK / WHITE）。
  // dame：ダメの数（境界点＋小さいダメのつながりの点）。
  // endgame：終盤か。両方の色の石があり、広い所（open）が無く、境界点が BORDER_SIDES×盤の路数 以下のとき
  //   （境界点が多すぎる局面は、まだ石がぶつかり合っている最中とみなす）
  function regions(board, size) {
    var terr = {}, dame = 0, nBorder = 0, open = false, empties = [], big = [];
    var both = board.indexOf(BLACK) >= 0 && board.indexOf(WHITE) >= 0;
    for (var i = 0; i < board.length; i++) if (board[i] === EMPTY) empties.push(i);
    function color(s) { return s.touch[BLACK] ? BLACK : WHITE; }
    function mark(s) { s.pts.forEach(function (q) { terr[q] = color(s); }); }
    function isBorder(q) {
      var t = {};
      R.neighbors(size, q).forEach(function (n) { if (board[n] !== EMPTY) t[board[n]] = true; });
      return t[BLACK] && t[WHITE];
    }
    // 先に、片方の色にだけ接するつながり（地）と小さいダメを決める
    flood(board, size, empties).forEach(function (rg) {
      if (!(rg.touch[BLACK] && rg.touch[WHITE])) { if (both) mark(rg); }
      else if (rg.pts.length <= DAME_MAX) dame += rg.pts.length;
      else big.push(rg);
    });
    big.forEach(function (rg) {
      var inner = rg.pts.filter(function (q) { return !isBorder(q); });
      var bpts = rg.pts.filter(isBorder), subs = flood(board, size, inner);
      var clean = bpts.length > 0 && subs.every(function (s) { return !s.touch[BLACK] !== !s.touch[WHITE]; });
      if (clean) {
        var t2 = {};
        for (var k in terr) t2[k] = terr[k];
        subs.forEach(function (s) { s.pts.forEach(function (q) { t2[q] = color(s); }); });
        clean = bpts.every(function (q) {
          return R.neighbors(size, q).every(function (n) {
            if (board[n] === EMPTY) return true;
            var g = R.groupAt(board, size, n);
            return g.liberties.filter(function (l) { return t2[l] === g.color; }).length >= 2;
          });
        });
      }
      if (!clean) { open = true; return; }
      subs.forEach(mark);
      dame += bpts.length; nBorder += bpts.length;
    });
    return { terr: terr, dame: dame, endgame: both && !open && nBorder <= BORDER_SIDES * size };
  }

  // 黒がパスしたとして、白の打てる手のうち「脅威」になるものを全部挙げる（コウの禁止は state のとおり）。
  // 脅威＝黒の石を取れる手、または今は呼吸点2つ以上の黒の連を呼吸点1つ以下にする手。
  // ただし取る手でない脅しのうち、打った白の連が呼吸点1つになり、黒がすぐ取れて、
  // その取りがウッテガエシにならない（取った数より多く取り返されない）ものは脅威に数えない（手入れは要らない）
  // 戻り値 [{ i: 白の点, cap: 取れるか, stones: 脅かされる黒の石 }]
  function threats(state) {
    var size = state.size, s = {}, out = [];
    for (var key in state) s[key] = state[key];
    s.toPlay = WHITE;
    for (var w = 0; w < s.board.length; w++) {
      if (s.board[w] !== EMPTY) continue;
      var r = R.playMove(s, w);
      if (!r.ok) continue;
      if (r.captured.length) { out.push({ i: w, cap: true, stones: r.captured }); continue; }
      var hit = [];
      R.neighbors(size, w).forEach(function (n) {
        if (s.board[n] !== BLACK || hit.indexOf(n) >= 0) return;
        var g = R.groupAt(s.board, size, n);
        if (g.liberties.length >= 2 && R.groupAt(r.state.board, size, n).liberties.length <= 1) hit = hit.concat(g.stones);
      });
      if (hit.length && !blackTakesBack(r.state, w)) out.push({ i: w, cap: false, stones: hit });
    }
    return out;
  }
  // state は黒番。w の白の連が呼吸点1つで、黒がすぐ取れ、取った黒がそれより多く取り返されないなら true
  function blackTakesBack(state, w) {
    var size = state.size, g = R.groupAt(state.board, size, w);
    if (g.liberties.length !== 1) return false;
    var L = g.liberties[0], res = R.playMove(state, L);
    if (!res.ok || res.captured.indexOf(w) < 0) return false;
    var mine = R.groupAt(res.state.board, size, L);
    if (mine.liberties.length !== 1) return true;
    var noKo = {}; for (var key in res.state) noKo[key] = res.state[key];
    noKo.prevBoard = null;
    var back = R.playMove(noKo, mine.liberties[0]);
    return !(back.ok && back.captured.length > res.captured.length);
  }

  function suggest(st) {
    if (st.over) return result(null, 'notyet', '殿、対局はもう終わっております。爺めの指南はここまででございます。');
    if (st.toPlay !== BLACK) return result(null, 'notyet', '殿、いまは白の番でございます。爺めは殿の番にお教えいたしますぞ。');

    var size = st.size, groups = R.allGroups(st.board, size);
    var whites = groups.filter(function (g) { return g.color === WHITE; });
    var blacks = groups.filter(function (g) { return g.color === BLACK; });
    var ataris = blacks.filter(function (g) { return g.liberties.length === 1; });
    var mid = Math.floor(size / 2);
    function dist(i) { var r = Math.floor(i / size) - mid, c = i % size - mid; return r * r + c * c; }
    // 打てるかどうかは必ず playMove で決める（自殺手・コウの点は出さない）
    var tried = {};
    function play(i) {
      if (!(i in tried)) { var r = R.playMove(st, i); tried[i] = r.ok ? r : null; }
      return tried[i];
    }
    function libsAt(res, i) { return R.groupAt(res.state.board, size, i).liberties.length; }
    // 打った後、p を含む黒の連が助かるか（呼吸点が3つ以上、または2つでシチョウにならない）
    var ladderHit = false;
    function safe(res, p) {
      var n = R.groupAt(res.state.board, size, p).liberties.length;
      if (n >= 3) return true;
      if (n <= 1) return false;
      if (ladderCaptured(res.state, p)) { ladderHit = true; return false; }
      return true;
    }

    // 1・2. 「取る」と「逃げる」を1つの候補表で比べる
    // 取る手の値＝取れる白の数＋その手で助かるアタリの黒の数。逃げる手の値＝助かる黒の連の石の数。
    // 値の大きい手。同じ値なら取る手。
    var cands = [];
    whites.forEach(function (g) {
      if (g.liberties.length !== 1) return;
      var p = g.liberties[0], res = play(p);
      if (!res || cands.some(function (c) { return c.kind === 'capture' && c.i === p; })) return;
      // 取った直後に取り返されるか（ウッテガエシ・コウ）
      // 1子どうしのコウは、すぐには取り返せない（playMove が 'ko' で止める）が、白がほかに1手打った後に
      // 取り返せるので「恐れ」として知らせる。そのためここではコウの禁止を外して調べる
      // コウと言うのは、1子を取り・打った黒が1子だけの連で・取り返されるのも1子のときだけ。
      // それ以外で取り返される（取り返す数が取った数以下）なら retake（「取り返される恐れ」と添える）
      var ko = false, retake = false, mine = R.groupAt(res.state.board, size, p);
      if (mine.liberties.length === 1) {
        var noKo = {}; for (var key in res.state) noKo[key] = res.state[key];
        noKo.prevBoard = null;
        var back = R.playMove(noKo, mine.liberties[0]);
        if (back.ok && back.captured.length) {
          if (back.captured.length > res.captured.length) return;
          if (res.captured.length === 1 && mine.stones.length === 1 && back.captured.length === 1) ko = true;
          else retake = true;
        }
      }
      var saved = [];
      ataris.forEach(function (b) { if (safe(res, b.stones[0])) saved = saved.concat(b.stones); });
      cands.push({ i: p, kind: 'capture', key: [-(res.captured.length + saved.length), 0, -res.captured.length],
        d: dist(p), stones: res.captured, saved: saved.length, ko: ko, retake: retake });
    });
    var escByPoint = {};
    ataris.forEach(function (g) {
      var p = g.liberties[0], res = play(p);
      if (!res || !safe(res, p)) return;
      var e = escByPoint[p] = escByPoint[p] || { i: p, kind: 'escape', stones: [], biggest: 0, d: dist(p) };
      e.stones = e.stones.concat(g.stones);
      e.biggest = Math.max(e.biggest, g.stones.length);
      e.libs = libsAt(res, p);
      e.after = R.groupAt(res.state.board, size, p).stones.length;
    });
    Object.keys(escByPoint).forEach(function (k) {
      var e = escByPoint[k];
      e.key = [-e.stones.length, 1, -e.libs];
      cands.push(e);
    });
    var c = best(cands);
    if (c && c.kind === 'capture') {
      return result(c.i, 'capture', '殿、その白は{アタリ}でございます。{呼吸点}が残り1つですぞ。ここに打てば、白の石を' +
        count(c.stones.length) + '取れますぞ。' + (c.saved && !c.retake ? 'これで殿の黒も助かりますぞ。' : '') +
        (c.ko ? 'ただし{コウ}で取り返される恐れがございます。' : '') +
        (c.retake ? 'ただし取り返される恐れがありますぞ。' : ''), c.stones);
    }
    if (c) {
      var how = c.after > c.biggest + 1
        ? 'ここへつないでお逃げなされ。つなげば{呼吸点}が'
        : 'ここへ伸びてお逃げなされ。伸びれば{呼吸点}が';
      return result(c.i, 'escape', 'おっと、殿の黒が{アタリ}ですぞ。{呼吸点}が残り1つでございます。' + how +
        count(c.libs) + 'になりますぞ。', c.stones.sort(function (a, b) { return a - b; }));
    }

    // ここまで来て黒のアタリが残っていれば、逃げても助からない
    var warn = '';
    if (ataris.length) {
      warn = ladderHit
        ? '殿の黒が{アタリ}でございますが、逃げてもシチョウで取られる恐れがございます。'
        : '殿の黒が{アタリ}でございますが、逃げても助かりませぬ。';
    }

    // 1線（盤の端）と地の点は勧めない。
    // 終盤（regions の endgame）は、白の石に接している点（ダメ詰め・境目）だけを勧める。この点は1線でもよい
    var rg = regions(st.board, size), terr = rg.terr;
    function edge(i) { var r = Math.floor(i / size), col = i % size; return r === 0 || col === 0 || r === size - 1 || col === size - 1; }
    function touchWhite(i) { return R.neighbors(size, i).some(function (n) { return st.board[n] === WHITE; }); }
    function skip(i) { return terr[i] || (rg.endgame ? !touchWhite(i) : edge(i)); }
    function ownEye(i) { return R.neighbors(size, i).every(function (n) { return st.board[n] === BLACK; }); }

    // 手入れ：黒がパスしたら白に取られる・アタリにされる所（脅威）があれば、それを消す手（defend）
    // 候補は脅威の点と、脅かされる黒の連の呼吸点。脅威の数が減り、打った黒が助かる手だけ。
    // 順位：残る脅威が少ない手 → 黒地の外の点（境界点・脅しの点） → 天元に近い点。
    // 終盤では press・wide（ダメ詰め）より先に調べ、それ以外ではパスを勧める前に調べる
    function defendHint() {
      var th = threats(st);
      if (!th.length) return null;
      var pts = [];
      th.forEach(function (t) {
        pts = pts.concat([t.i], R.groupAt(st.board, size, t.stones[0]).liberties);
      });
      var defend = [];
      pts.forEach(function (p) {
        if (defend.some(function (d) { return d.i === p; })) return;
        // 打った黒が助かる手だけ（逃げると同じ基準。シチョウで取られる伸びを手入れと言わない）
        var res = play(p);
        if (!res || !safe(res, p)) return;
        var left = threats(res.state);
        if (left.length >= th.length) return;
        // 消えた脅威（文と印の石に使う）
        var removed = th.filter(function (t) {
          return !left.some(function (u) { return u.i === t.i; });
        });
        // 同じ数なら、ダメ（境界点）や脅しの点そのものを、自陣（黒地）の中の点より先に
        defend.push({ i: p, key: [left.length, terr[p] === BLACK ? 1 : 0], d: dist(p), gone: removed });
      });
      var c = best(defend);
      if (!c) return null;
      var gone = c.gone.length ? c.gone : th, stones = [];
      gone.forEach(function (t) { t.stones.forEach(function (s) { if (stones.indexOf(s) < 0) stones.push(s); }); });
      var where = gone.some(function (t) { return t.i === c.i; }) ? '白にここへ打たれると' : '白に先に打たれると';
      var what = gone.some(function (t) { return t.cap; }) ? '殿の黒が取られますぞ。' : '殿の黒が{アタリ}になりますぞ。';
      return result(c.i, 'defend', warn + '殿、ここは手入れが要りますぞ。' + where + what + '目安でございます。',
        stones.sort(function (a, b) { return a - b; }));
    }
    if (rg.endgame) { c = defendHint(); if (c) return c; }

    // 3. 白の呼吸点を減らす。打った黒の呼吸点が3つ以上残る手だけ
    var press = [];
    whites.forEach(function (g) {
      g.liberties.forEach(function (p) {
        if (skip(p)) return;
        var res = play(p);
        if (!res || libsAt(res, p) < 3) return;
        var after = R.groupAt(res.state.board, size, g.stones[0]);
        if (!after || after.color !== WHITE) return;
        press.push({ i: p, key: [after.liberties.length, -g.stones.length], d: dist(p), stones: g.stones, libs: after.liberties.length });
      });
    });
    c = best(press);
    if (c) {
      var pm = c.libs === 1
        ? '殿、ここに打てばその白の{呼吸点}が残り1つ、{アタリ}になりますぞ。次に取れるかもしれませぬ。'
        : '殿、ここに打てばその白の{呼吸点}を減らせますぞ。{呼吸点}が' + count(c.libs) + 'になります。';
      return result(c.i, 'press', warn + pm + '目安でございます。決まった正解ではございませぬぞ。', c.stones);
    }

    // 4. 広い所：自分の目を埋めず、打った後の呼吸点が2つ以上。周りの石が少なく、天元に近い点
    var wide = [];
    for (var i = 0; i < st.board.length; i++) {
      if (st.board[i] !== EMPTY || skip(i)) continue;
      if (ownEye(i)) continue;
      var res = play(i);
      if (!res || libsAt(res, i) < 2) continue;
      var r = Math.floor(i / size), col = i % size, near = 0;
      for (var j = 0; j < st.board.length; j++) {
        if (st.board[j] === EMPTY) continue;
        if (Math.abs(Math.floor(j / size) - r) + Math.abs(j % size - col) <= 2) near++;
      }
      wide.push({ i: i, key: [near], d: dist(i) });
    }
    c = best(wide);
    if (c) {
      var whiteAtari = whites.some(function (g) { return g.liberties.length === 1; });
      var head = warn ? warn + '取れる石はございませぬ。'
        : whiteAtari ? '殿、取れる石はございませぬ。' : '殿、{アタリ}の石はございませぬ。';
      return result(c.i, 'wide', head + (rg.endgame
        ? 'ここで境目を閉じなされ。{ダメ}を詰める手でございます。'
        : 'ここは広い所に構えるのがよろしいかと。') + '決まった正解ではございませぬぞ。');
    }

    if (!rg.endgame) { c = defendHint(); if (c) return c; }

    // 5. 打てる点が全部 地・勧めない点・自分の目・打つと自分がアタリになる点ならパスをすすめる。打てる点が無ければ none
    var legal = R.legalMoves(st);
    if (legal.length && legal.every(function (i) { return skip(i) || ownEye(i) || libsAt(play(i), i) < 2; })) {
      return result(null, 'pass', warn + (rg.dame
        ? '殿、残りは{ダメ}と{地}ばかりでございます。ここは{パス}をお考えなされ。'
        : '殿、空いている所は、もうどちらかの{地}ばかりでございます。ここは{パス}をお考えなされ。'));
    }
    return result(null, 'none', warn + '殿、爺めが見ても、よい打ち場所がございませぬ。ここは{パス}をお考えなされ。');
  }

  var api = { suggest: suggest, regions: regions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoHint = api;
})(typeof window !== 'undefined' ? window : this);
