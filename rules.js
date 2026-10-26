// 囲碁のルール（DOMに依存しない純粋関数だけを置く）
// 盤は長さ size*size の配列。0=空き点 1=黒 2=白。
// ブラウザでは window.GoRules、Node では require('./rules.js') で使う。
(function (root) {
  'use strict';

  var EMPTY = 0, BLACK = 1, WHITE = 2;

  function other(color) { return color === BLACK ? WHITE : BLACK; }
  function toIndex(r, c, size) { return r * size + c; }
  function toRC(i, size) { return [Math.floor(i / size), i % size]; }

  // たて・よこにとなり合う点
  function neighbors(size, i) {
    var r = Math.floor(i / size), c = i % size, out = [];
    if (r > 0) out.push(i - size);
    if (r < size - 1) out.push(i + size);
    if (c > 0) out.push(i - 1);
    if (c < size - 1) out.push(i + 1);
    return out;
  }

  // i を含む連（たて・よこにつながった同じ色の石）と、その呼吸点
  function groupAt(board, size, i) {
    var color = board[i];
    if (color === EMPTY) return null;
    var stones = [], libs = {}, seen = {}, stack = [i];
    seen[i] = true;
    while (stack.length) {
      var p = stack.pop();
      stones.push(p);
      var ns = neighbors(size, p);
      for (var k = 0; k < ns.length; k++) {
        var n = ns[k];
        if (board[n] === EMPTY) libs[n] = true;
        else if (board[n] === color && !seen[n]) { seen[n] = true; stack.push(n); }
      }
    }
    return {
      color: color,
      stones: stones.sort(function (a, b) { return a - b; }),
      liberties: Object.keys(libs).map(Number).sort(function (a, b) { return a - b; })
    };
  }

  // 盤上のすべての連
  function allGroups(board, size) {
    var done = {}, groups = [];
    for (var i = 0; i < board.length; i++) {
      if (board[i] === EMPTY || done[i]) continue;
      var g = groupAt(board, size, i);
      g.stones.forEach(function (s) { done[s] = true; });
      groups.push(g);
    }
    return groups;
  }

  // 呼吸点が1つだけの連（アタリ）
  function atariGroups(board, size) {
    return allGroups(board, size).filter(function (g) { return g.liberties.length === 1; });
  }

  function sameBoard(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 文字の図から盤を作る。X=黒 O=白 .=空き点 +=印つきの空き点
  function parseRows(rows) {
    var size = rows.length, board = [], marks = [];
    for (var r = 0; r < size; r++) {
      if (rows[r].length !== size) throw new Error('盤の図の行の長さが違います: ' + rows[r]);
      for (var c = 0; c < size; c++) {
        var ch = rows[r][c];
        board.push(ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY);
        if (ch === '+') marks.push(toIndex(r, c, size));
      }
    }
    return { size: size, board: board, marks: marks };
  }

  // 対局の状態
  // prevBoard＝直前の手を打つ前の盤（コウの判定に使う）
  // captures[色]＝その色が取った石の数（アゲハマ）
  function createGame(size, opts) {
    opts = opts || {};
    size = size || 9;
    var board = opts.board ? opts.board.slice() : new Array(size * size).fill(EMPTY);
    var captures = {};
    captures[BLACK] = 0;
    captures[WHITE] = 0;
    return {
      size: size,
      board: board,
      toPlay: opts.toPlay || BLACK,
      prevBoard: null,
      captures: captures,
      passes: 0,
      over: false,
      lastMove: null,
      moveNumber: 0
    };
  }

  // 着手。成功なら {ok:true, state, captured:[取った石の位置]}、
  // 打てない手なら {ok:false, reason:'over'|'occupied'|'suicide'|'ko'}
  function playMove(state, i) {
    if (state.over) return { ok: false, reason: 'over' };
    if (i < 0 || i >= state.board.length) return { ok: false, reason: 'occupied' };
    if (state.board[i] !== EMPTY) return { ok: false, reason: 'occupied' };

    var size = state.size, color = state.toPlay, opp = other(color);
    var b = state.board.slice();
    b[i] = color;

    // 相手の連で呼吸点が0になったものを取る
    var captured = [];
    neighbors(size, i).forEach(function (n) {
      if (b[n] !== opp) return;
      var g = groupAt(b, size, n);
      if (g.liberties.length === 0) {
        g.stones.forEach(function (s) { b[s] = EMPTY; captured.push(s); });
      }
    });

    // 自殺手：相手を取れず、自分の連の呼吸点が0
    if (captured.length === 0 && groupAt(b, size, i).liberties.length === 0) {
      return { ok: false, reason: 'suicide' };
    }

    // コウ：直前の局面（相手が打つ前の盤）に戻る手は禁止
    if (state.prevBoard && sameBoard(b, state.prevBoard)) {
      return { ok: false, reason: 'ko' };
    }

    var captures = {};
    captures[BLACK] = state.captures[BLACK];
    captures[WHITE] = state.captures[WHITE];
    captures[color] += captured.length;

    return {
      ok: true,
      captured: captured.sort(function (x, y) { return x - y; }),
      state: {
        size: size,
        board: b,
        toPlay: opp,
        prevBoard: state.board.slice(),
        captures: captures,
        passes: 0,
        over: false,
        lastMove: i,
        moveNumber: state.moveNumber + 1
      }
    };
  }

  // パス。2回続くと終局
  function pass(state) {
    if (state.over) return state;
    var passes = state.passes + 1;
    return {
      size: state.size,
      board: state.board.slice(),
      toPlay: other(state.toPlay),
      // パスの後は盤が変わらないので、次の手はどれも直前の局面に戻らない（コウは解ける）
      prevBoard: state.board.slice(),
      captures: { 1: state.captures[BLACK], 2: state.captures[WHITE] },
      passes: passes,
      over: passes >= 2,
      lastMove: null,
      moveNumber: state.moveNumber + 1
    };
  }

  // 打てる点の一覧
  function legalMoves(state) {
    var out = [];
    for (var i = 0; i < state.board.length; i++) {
      if (state.board[i] === EMPTY && playMove(state, i).ok) out.push(i);
    }
    return out;
  }

  // 終局で死に石の印を付け外しする。i の連をまるごと dead に足す（すでに入っていれば外す）
  function toggleDead(board, size, dead, i) {
    if (board[i] === EMPTY) return dead.slice();
    var stones = groupAt(board, size, i).stones;
    var out = dead.indexOf(i) >= 0
      ? dead.filter(function (d) { return stones.indexOf(d) < 0; })
      : dead.concat(stones.filter(function (s) { return dead.indexOf(s) < 0; }));
    return out.sort(function (a, b) { return a - b; });
  }

  // 死に石の一覧を確かめる（保存データ由来でも安全に使えるように）
  // 盤の範囲内の整数で、そこに石があり、重複しないものだけを残す
  function cleanDead(board, dead) {
    if (!Array.isArray(dead)) return [];
    var out = [];
    dead.forEach(function (i) {
      if (typeof i !== 'number' || i % 1 !== 0 || i < 0 || i >= board.length) return;
      if (board[i] === EMPTY || out.indexOf(i) >= 0) return;
      out.push(i);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // 終局の数え方（日本ルール）
  // 点数＝自分の石だけで囲んだ空き点（地）＋取った石（アゲハマ）。コミなし。
  // captures＝対局中のアゲハマ。dead＝死に石の位置。死に石は盤から取り除き、相手のアゲハマに加える。
  // owner[i]：死に石を取り除いた後の空き点の持ち主（0=どちらのものでもない＝ダメ）。石のある点は 0。
  function score(board, size, captures, dead) {
    var b = board.slice();
    captures = captures || {};
    var agehama = {};
    agehama[BLACK] = captures[BLACK] || 0;
    agehama[WHITE] = captures[WHITE] || 0;
    cleanDead(board, dead).forEach(function (i) {
      agehama[other(b[i])]++;
      b[i] = EMPTY;
    });
    board = b;
    var owner = new Array(board.length).fill(EMPTY), seen = {};
    var res = { black: { territory: 0 }, white: { territory: 0 }, neutral: 0 };
    for (var i = 0; i < board.length; i++) {
      if (board[i] !== EMPTY || seen[i]) continue;
      // 空き点のかたまりを調べ、接している石の色を集める
      var region = [], touch = {}, stack = [i];
      seen[i] = true;
      while (stack.length) {
        var p = stack.pop();
        region.push(p);
        neighbors(size, p).forEach(function (n) {
          if (board[n] === EMPTY) { if (!seen[n]) { seen[n] = true; stack.push(n); } }
          else touch[board[n]] = true;
        });
      }
      var who = (touch[BLACK] && !touch[WHITE]) ? BLACK : (touch[WHITE] && !touch[BLACK]) ? WHITE : EMPTY;
      region.forEach(function (p) { owner[p] = who; });
      if (who === BLACK) res.black.territory += region.length;
      else if (who === WHITE) res.white.territory += region.length;
      else res.neutral += region.length;
    }
    res.black.agehama = agehama[BLACK];
    res.white.agehama = agehama[WHITE];
    res.black.total = res.black.territory + res.black.agehama;
    res.white.total = res.white.territory + res.white.agehama;
    res.winner = res.black.total > res.white.total ? BLACK : res.white.total > res.black.total ? WHITE : EMPTY;
    res.diff = Math.abs(res.black.total - res.white.total);
    res.owner = owner;
    res.board = board;
    return res;
  }

  var api = {
    EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    other: other, toIndex: toIndex, toRC: toRC, neighbors: neighbors,
    groupAt: groupAt, allGroups: allGroups, atariGroups: atariGroups, sameBoard: sameBoard,
    parseRows: parseRows, createGame: createGame, playMove: playMove, pass: pass,
    legalMoves: legalMoves, toggleDead: toggleDead, cleanDead: cleanDead, score: score
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoRules = api;
})(typeof window !== 'undefined' ? window : this);
