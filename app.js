// 画面と操作。ルールは rules.js、問題データは lessons.js にある
(function () {
  'use strict';

  var R = window.GoRules, L = window.GoLessons, Game = window.GoGame;
  var env = {
    setTimeout: function (f, ms) { return setTimeout(f, ms); },
    clearTimeout: function (t) { clearTimeout(t); },
    random: Math.random
  };
  var BLACK = R.BLACK, WHITE = R.WHITE;
  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var modalBody = document.getElementById('modal-body');

  // ---------- 保存（進み具合） ----------
  var KEY = 'go-trainer-v1';
  var store = { lessons: {}, practice: {}, seen: {}, game: null };
  try { Object.assign(store, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* 読めなければ最初から */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても遊べる */ } }

  // ---------- 文字 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // 用語の名前 → レッスン（またはレッスンにしない用語）の id
  var termIndex = {}, allTerms = L.lessons.concat(L.terms || []);
  allTerms.forEach(function (l) {
    termIndex[l.name] = l.id;
    l.aliases.forEach(function (a) { termIndex[a] = l.id; });
  });
  function lessonById(id) { return allTerms.filter(function (l) { return l.id === id; })[0]; }

  // {用語} をタップできる言葉にする
  function rich(text) {
    return esc(text).replace(/\{([^}]+)\}/g, function (all, word) {
      var id = termIndex[word];
      return id ? '<button type="button" class="term" data-term="' + id + '">' + word + '</button>' : word;
    });
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  var CHEERS = ['おみごと！', 'すばらしい！', 'いいですね！', 'その調子！'];

  var REASON = {
    suicide: 'そこは{着手禁止点}です。打つと自分の石の{呼吸点}が0になるので、打てません。',
    ko: 'いまは{コウ}です。取られた直後なので、すぐには取り返せません。ほかに1手打ってからね。',
    occupied: 'そこには、もう石があります。',
    over: '対局はもう終わっています。'
  };

  // ---------- 碁盤（SVG） ----------
  // MARGIN：端の交点の輪（半径50＋線の太さの半分＝53.5）が盤の外で欠けない幅
  var CELL = 100, MARGIN = 54, seq = 0;
  function boardWidth(n) { return MARGIN * 2 + CELL * (n - 1); }

  // o: size, board, ghost, ghostColor, ghostBad, marks:[{i,type}], last, atari:[i], owner:[], dim:[i]
  function boardSVG(o) {
    var n = o.size, W = boardWidth(n), id = 'g' + (++seq), s = [];
    function px(k) { return MARGIN + k * CELL; }
    function pos(i) { return { x: px(i % n), y: px(Math.floor(i / n)) }; }
    s.push('<svg viewBox="0 0 ' + W + ' ' + W + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="碁盤">');
    s.push('<defs>' +
      '<radialGradient id="' + id + 'b" cx="35%" cy="32%" r="70%"><stop offset="0" stop-color="#6b6b6b"/><stop offset="0.55" stop-color="#222"/><stop offset="1" stop-color="#0b0b0b"/></radialGradient>' +
      '<radialGradient id="' + id + 'w" cx="35%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#f1efea"/><stop offset="1" stop-color="#c9c5bc"/></radialGradient>' +
      '</defs>');
    s.push('<rect width="' + W + '" height="' + W + '" rx="18" fill="#e3b873"/>');
    for (var k = 0; k < n; k++) {
      var w = (k === 0 || k === n - 1) ? 5 : 3;
      s.push('<line x1="' + px(0) + '" y1="' + px(k) + '" x2="' + px(n - 1) + '" y2="' + px(k) + '" stroke="#5a3e1b" stroke-width="' + w + '" stroke-linecap="square"/>');
      s.push('<line x1="' + px(k) + '" y1="' + px(0) + '" x2="' + px(k) + '" y2="' + px(n - 1) + '" stroke="#5a3e1b" stroke-width="' + w + '" stroke-linecap="square"/>');
    }
    if (n === 9) {
      [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]].forEach(function (p) {
        s.push('<circle cx="' + px(p[1]) + '" cy="' + px(p[0]) + '" r="10" fill="#5a3e1b"/>');
      });
    }
    // 地の印
    if (o.owner) {
      o.owner.forEach(function (who, i) {
        if (!who || o.board[i]) return;
        var p = pos(i);
        s.push('<rect x="' + (p.x - 17) + '" y="' + (p.y - 17) + '" width="34" height="34" rx="4" fill="' + (who === BLACK ? '#1a1a1a' : '#ffffff') + '" stroke="#1a1a1a" stroke-width="' + (who === WHITE ? 3 : 0) + '"/>');
      });
    }
    // 石
    o.board.forEach(function (c, i) {
      if (!c) return;
      var p = pos(i);
      var dim = o.dim && o.dim.indexOf(i) >= 0;
      s.push('<circle cx="' + (p.x + 3) + '" cy="' + (p.y + 5) + '" r="46" fill="rgba(60,35,10,.28)"/>');
      s.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="47" fill="url(#' + id + (c === BLACK ? 'b' : 'w') + ')"' + (dim ? ' opacity=".45"' : '') + '/>');
    });
    // アタリの石（オレンジの輪）
    (o.atari || []).forEach(function (i) {
      var p = pos(i);
      s.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="50" fill="none" stroke="#f08a1c" stroke-width="7"/>');
    });
    // 直前の手
    if (o.last != null && o.board[o.last]) {
      var lp = pos(o.last);
      s.push('<circle cx="' + lp.x + '" cy="' + lp.y + '" r="14" fill="none" stroke="' + (o.board[o.last] === BLACK ? '#fff' : '#222') + '" stroke-width="6"/>');
    }
    // 印
    (o.marks || []).forEach(function (m) {
      var p = pos(m.i), x = p.x, y = p.y, onStone = !!o.board[m.i];
      if (m.type === 'triangle') {
        s.push('<polygon points="' + x + ',' + (y - 26) + ' ' + (x + 24) + ',' + (y + 16) + ' ' + (x - 24) + ',' + (y + 16) + '" fill="none" stroke="#c4432b" stroke-width="7" stroke-linejoin="round"/>');
      } else if (m.type === 'cross') {
        s.push('<path d="M' + (x - 22) + ' ' + (y - 22) + 'L' + (x + 22) + ' ' + (y + 22) + 'M' + (x + 22) + ' ' + (y - 22) + 'L' + (x - 22) + ' ' + (y + 22) + '" stroke="#c4432b" stroke-width="9" stroke-linecap="round"/>');
      } else if (m.type === 'square') {
        s.push('<rect x="' + (x - 18) + '" y="' + (y - 18) + '" width="36" height="36" rx="4" fill="#1a1a1a"/>');
      } else if (m.type === 'found') {
        s.push('<circle cx="' + x + '" cy="' + y + '" r="26" fill="#c4432b"/>');
      } else if (m.type === 'ring') {
        s.push('<circle cx="' + x + '" cy="' + y + '" r="' + (onStone ? 50 : 30) + '" fill="none" stroke="#c4432b" stroke-width="7"/>');
      } else if (m.type === 'hint') {
        // 爺の指南：緑の二重丸（点滅しない）
        s.push('<circle cx="' + x + '" cy="' + y + '" r="36" fill="none" stroke="#2f7d4f" stroke-width="7"/>');
        s.push('<circle cx="' + x + '" cy="' + y + '" r="17" fill="none" stroke="#2f7d4f" stroke-width="7"/>');
      }
    });
    // 仮の石（半透明）。打てない点なら赤
    if (o.ghost != null && o.ghostBad) {
      var bp = pos(o.ghost);
      if (!o.board[o.ghost]) s.push('<circle cx="' + bp.x + '" cy="' + bp.y + '" r="47" fill="#c4432b" opacity=".5"/>');
      s.push('<circle cx="' + bp.x + '" cy="' + bp.y + '" r="50" fill="none" stroke="#c4432b" stroke-width="7"/>');
    } else if (o.ghost != null) {
      var gp = pos(o.ghost);
      s.push('<circle cx="' + gp.x + '" cy="' + gp.y + '" r="47" fill="url(#' + id + ((o.ghostColor || BLACK) === BLACK ? 'b' : 'w') + ')" opacity=".5"/>');
      s.push('<circle cx="' + gp.x + '" cy="' + gp.y + '" r="50" fill="none" stroke="#c4432b" stroke-width="5" stroke-dasharray="14 10"/>');
    }
    s.push('</svg>');
    return s.join('');
  }

  // 盤のタップ → 交点の番号
  function bindBoard(el, size, onTap) {
    el.addEventListener('click', function (e) {
      var rect = el.getBoundingClientRect(), W = boardWidth(size);
      var x = (e.clientX - rect.left) / rect.width * W;
      var y = (e.clientY - rect.top) / rect.height * W;
      var c = Math.round((x - MARGIN) / CELL), r = Math.round((y - MARGIN) / CELL);
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      onTap(R.toIndex(r, c, size));
    });
  }

  function rcList(list, size) { return list.map(function (rc) { return R.toIndex(rc[0], rc[1], size); }); }
  function atariStones(board, size) {
    var out = [];
    R.atariGroups(board, size).forEach(function (g) { out = out.concat(g.stones); });
    return out;
  }

  // 図（レッスンの説明・用語の説明で使う）
  function diagramHTML(lesson) {
    var p = R.parseRows(lesson.diagram.rows);
    return '<div class="board diagram">' + boardSVG({
      size: p.size, board: p.board,
      marks: p.marks.map(function (i) { return { i: i, type: lesson.diagram.mark }; })
    }) + '</div><p class="caption">' + rich(lesson.caption) + '</p>';
  }

  // ---------- 小窓（用語の説明・確認） ----------
  function openModal(html) {
    modalBody.innerHTML = html;
    modal.hidden = false;
    modal.querySelector('.sheet').scrollTop = 0;
  }
  function closeModal() { modal.hidden = true; modalBody.innerHTML = ''; }
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  function openTerm(id) {
    var l = lessonById(id);
    if (!l) return;
    openModal('<h2>' + esc(l.title) + '</h2>' + (l.diagram ? diagramHTML(l) : '') +
      l.text.map(function (t) { return '<p>' + rich(t) + '</p>'; }).join('') +
      '<button type="button" class="btn primary wide" data-act="close">わかった！</button>');
  }

  // ---------- 画面の切り替え ----------
  var leaveGame = null;
  function show(html) {
    if (leaveGame) { leaveGame(); leaveGame = null; }
    closeModal();
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }
  function topBar(backAct, label, right) {
    return '<header class="bar"><button type="button" class="back" data-act="' + backAct + '">‹ ' + label + '</button>' +
      '<span class="bar-right">' + (right || '') + '</span></header>';
  }
  function count(obj) { return Object.keys(obj).filter(function (k) { return obj[k]; }).length; }

  // メニュー
  function showMenu() {
    var ld = count(store.lessons), pd = count(store.practice);
    show(
      '<section class="menu">' +
      '<div class="hero">' + heroStones() + '<h1>はじめての囲碁</h1><p class="sub">遊びながら、ゆっくり覚えましょう。</p></div>' +
      '<button type="button" class="menu-item" data-act="lessons"><span class="num">1</span><span class="mi-text"><b>はじめての囲碁</b><small>用語レッスン　' + ld + ' / ' + L.lessons.length + ' クリア</small></span><span class="chev">›</span></button>' +
      '<button type="button" class="menu-item" data-act="practices"><span class="num">2</span><span class="mi-text"><b>石を取る練習</b><small>' + pd + ' / ' + L.practice.length + ' クリア</small></span><span class="chev">›</span></button>' +
      '<button type="button" class="menu-item" data-act="game"><span class="num">3</span><span class="mi-text"><b>対局する</b><small>9路盤でコンピュータと</small></span><span class="chev">›</span></button>' +
      '<button type="button" class="link" data-act="reset-ask">進み具合をリセット</button>' +
      '</section>');
  }
  function heroStones() {
    return '<svg class="hero-stones" viewBox="0 0 120 64" aria-hidden="true">' +
      '<defs><radialGradient id="hb" cx="35%" cy="32%" r="70%"><stop offset="0" stop-color="#6b6b6b"/><stop offset="1" stop-color="#0b0b0b"/></radialGradient>' +
      '<radialGradient id="hw" cx="35%" cy="32%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfcbc2"/></radialGradient></defs>' +
      '<circle cx="42" cy="34" r="26" fill="url(#hb)"/><circle cx="80" cy="30" r="26" fill="url(#hw)"/></svg>';
  }

  // 一覧（レッスン・練習）
  function showList(kind) {
    var items = kind === 'lesson' ? L.lessons : L.practice;
    var done = kind === 'lesson' ? store.lessons : store.practice;
    var title = kind === 'lesson' ? 'はじめての囲碁' : '石を取る練習';
    var sub = kind === 'lesson' ? '覚える言葉は6つだけ。順番にどうぞ。' : 'アタリの石を見つけて、取ってみよう。';
    show(topBar('menu', 'メニュー') + '<h1>' + title + '</h1><p class="sub">' + sub + '</p><div class="list">' +
      items.map(function (it, k) {
        return '<button type="button" class="list-item' + (done[it.id] ? ' done' : '') + '" data-act="' + kind + '" data-k="' + k + '">' +
          '<span class="num">' + (k + 1) + '</span><span class="li-text">' + esc(it.title) + '</span>' +
          '<span class="check">' + (done[it.id] ? '✓' : '›') + '</span></button>';
      }).join('') + '</div>');
  }

  // レッスン：説明
  function showLessonLearn(k) {
    var l = L.lessons[k];
    show(topBar('lessons', 'もくじ', (k + 1) + ' / ' + L.lessons.length) +
      '<h1>' + esc(l.title) + '</h1>' +
      '<div class="card">' + diagramHTML(l) + l.text.map(function (t) { return '<p>' + rich(t) + '</p>'; }).join('') + '</div>' +
      '<button type="button" class="btn primary wide" data-act="lesson-try" data-k="' + k + '">問題にチャレンジ ›</button>');
  }

  // レッスン：問題
  function showLessonTry(k) {
    var l = L.lessons[k], last = k === L.lessons.length - 1;
    show(topBar('lessons', 'もくじ', (k + 1) + ' / ' + L.lessons.length) +
      '<h1>' + esc(l.title) + '<span class="tag">問題</span></h1>' + problemHTML(l.problem) +
      '<div class="row">' +
      '<button type="button" class="btn" data-act="lesson" data-k="' + k + '">説明を見る</button>' +
      '<button type="button" class="btn primary next" hidden data-act="' + (last ? 'lessons-done' : 'lesson') + '" data-k="' + (k + 1) + '">' + (last ? 'おわり ›' : '次へ ›') + '</button>' +
      '</div>');
    mountProblem(app, l.problem, function () {
      store.lessons[l.id] = true; save();
      app.querySelector('.next').hidden = false;
    });
  }

  function showLessonsDone() {
    show(topBar('menu', 'メニュー') + '<div class="done-box"><div class="big-emoji">🎉</div><h1>6つの言葉、ぜんぶクリア！</h1>' +
      '<p>これで囲碁の基本のルールはばっちりです。次は石を取る練習か、対局をしてみましょう。</p>' +
      '<button type="button" class="btn primary wide" data-act="practices">石を取る練習へ ›</button>' +
      '<button type="button" class="btn wide" data-act="game">対局する ›</button></div>');
  }

  // 練習問題
  function showPractice(k) {
    var p = L.practice[k], last = k === L.practice.length - 1;
    var pr = { type: 'place', goal: 'capture', rows: p.rows, minCaptured: p.minCaptured, question: p.question, hint: p.hint };
    show(topBar('practices', 'もくじ', (k + 1) + ' / ' + L.practice.length) +
      '<h1>' + esc(p.title) + '</h1>' + problemHTML(pr) +
      '<div class="row">' +
      '<button type="button" class="btn" data-act="practice" data-k="' + k + '">やり直す</button>' +
      '<button type="button" class="btn primary next" hidden data-act="' + (last ? 'practices' : 'practice') + '" data-k="' + (k + 1) + '">' + (last ? 'もくじへ ›' : '次の問題 ›') + '</button>' +
      '</div>');
    mountProblem(app, pr, function () {
      store.practice[p.id] = true; save();
      app.querySelector('.next').hidden = false;
    });
  }

  // ---------- 問題のしくみ ----------
  function problemHTML(pr) {
    var opts = pr.type === 'choice'
      ? '<div class="options">' + pr.options.map(function (v) {
        return '<button type="button" class="btn option" data-v="' + v + '">' + v + '目</button>';
      }).join('') + '</div>'
      : '';
    return '<p class="question">' + rich(pr.question) + '</p>' +
      '<div class="board play"></div>' + opts +
      '<p class="feedback" role="status"></p>';
  }

  function mountProblem(root, pr, onSolved) {
    var boardEl = root.querySelector('.board.play');
    var fb = root.querySelector('.feedback');
    var qEl = root.querySelector('.question');
    var parsed = R.parseRows(pr.rows), size = parsed.size;
    var st = R.createGame(size, { board: parsed.board, toPlay: BLACK });
    var ghost = null, solved = false, marks = [], owner = null, timer = null;
    var found = {}, step = 0, koIdx = null;

    if (pr.type === 'ko') {
      st = R.createGame(size, { board: parsed.board, toPlay: WHITE });
      st = R.playMove(st, R.toIndex(pr.setupMove[0], pr.setupMove[1], size)).state;
      koIdx = R.toIndex(pr.koPoint[0], pr.koPoint[1], size);
      qEl.innerHTML = rich(pr.steps[0]);
    }

    function draw(board, last) {
      var m = marks.slice();
      if (pr.type === 'ko' && !solved) m.push({ i: koIdx, type: 'triangle' });
      boardEl.innerHTML = boardSVG({
        size: size, board: board || st.board, ghost: ghost, marks: m, owner: owner,
        last: last !== undefined ? last : st.lastMove
      });
    }
    function say(text, kind) { fb.className = 'feedback ' + (kind || ''); fb.innerHTML = rich(text); }
    function win(text) {
      solved = true; ghost = null;
      say(text, 'good');
      onSolved();
    }

    // 二度触れて置く：1回目で仮の石、同じ点をもう一度で確定
    function twoTap(i, confirm) {
      if (st.board[i] !== R.EMPTY) { ghost = null; draw(); say(REASON.occupied); return; }
      if (ghost === i) { ghost = null; confirm(i); return; }
      ghost = i; draw();
      say('もう一度タップすると、ここに置きます。', 'info');
    }

    var handlers = {
      findAll: function (i) {
        var key = String(i), targets = rcList(pr.targets, size);
        if (targets.indexOf(i) < 0) { say('おしい！ ' + pr.hint, 'bad'); return; }
        if (found[key]) return;
        found[key] = true;
        marks.push({ i: i, type: 'found' });
        draw();
        var left = targets.length - count(found);
        if (left === 0) win(pr.success);
        else say('そう！あと ' + left + ' つ。', 'info');
      },
      place: function (i) {
        twoTap(i, function (p) {
          var res = R.playMove(st, p);
          if (!res.ok) { draw(); say(REASON[res.reason], 'bad'); return; }
          var ok = pr.goal === 'atari'
            ? R.atariGroups(res.state.board, size).some(function (g) { return g.color === WHITE; })
            : res.captured.length >= (pr.minCaptured || 1);
          if (ok) {
            st = res.state;
            if (pr.goal === 'atari') marks = atariStones(st.board, size).map(function (s) { return { i: s, type: 'ring' }; });
            draw();
            win(pr.success || (pick(CHEERS) + ' 白石を ' + res.captured.length + ' つ{取る}ことができました。'));
            return;
          }
          // ちがう点：いったん置いて見せてから戻す
          draw(res.state.board, p);
          say('おしい！ ' + pr.hint, 'bad');
          clearTimeout(timer);
          timer = setTimeout(function () { if (!solved) draw(); }, 1300);
        });
      },
      forbidden: function (i) {
        twoTap(i, function (p) {
          var res = R.playMove(st, p);
          if (!res.ok && res.reason === 'suicide' && rcList(pr.answers, size).indexOf(p) >= 0) {
            marks.push({ i: p, type: 'cross' });
            draw();
            win(pr.success);
            return;
          }
          var rc = R.toRC(p, size);
          draw();
          say('おしい！ ' + ((pr.pointHints || {})[rc[0] + ',' + rc[1]] || pr.hint), 'bad');
        });
      },
      ko: function (i) {
        twoTap(i, function (p) {
          if (step === 0) {
            if (p !== koIdx) { draw(); say(pr.stepHints[0], 'info'); return; }
            var r0 = R.playMove(st, p);
            draw();
            say(r0.reason === 'ko' ? pr.blocked + ' これが{コウ}の決まりです。' : REASON[r0.reason], 'bad');
            step = 1;
            qEl.innerHTML = rich(pr.steps[1]);
            return;
          }
          if (step === 1) {
            if (p === koIdx) { draw(); say(pr.stepHints[1], 'bad'); return; }
            var r1 = R.playMove(st, p);
            if (!r1.ok) { draw(); say(REASON[r1.reason], 'bad'); return; }
            st = r1.state; draw();
            say('白の番です…', 'info');
            setTimeout(function () {
              var reply = rcList(pr.whiteReplies, size).filter(function (w) { return R.playMove(st, w).ok; })[0];
              st = R.playMove(st, reply).state;
              step = 2;
              draw();
              qEl.innerHTML = rich(pr.steps[2]);
              say('白もほかの場所に打ちました。', 'info');
            }, 600);
            return;
          }
          if (p !== koIdx) { draw(); say(pr.stepHints[2], 'info'); return; }
          var r2 = R.playMove(st, p);
          if (!r2.ok) { draw(); say(REASON[r2.reason], 'bad'); return; }
          st = r2.state;
          solved = true; // △の印を消して描く
          draw();
          win(pr.success);
        });
      }
    };

    if (pr.type === 'choice') {
      root.querySelectorAll('.option').forEach(function (b) {
        b.addEventListener('click', function () {
          if (solved) return;
          if (Number(b.dataset.v) === pr.answer) {
            b.classList.add('right');
            var sc = R.score(st.board, size);
            owner = sc.owner.map(function (o) { return o === BLACK ? BLACK : 0; });
            draw();
            win(pr.success);
          } else {
            b.classList.add('wrong');
            say('おしい！ ' + pr.hint, 'bad');
          }
        });
      });
    } else {
      bindBoard(boardEl, size, function (i) {
        if (solved) return;
        if (pr.type === 'ko' && step === 1 && st.toPlay !== BLACK) return; // 白が打つのを待つ
        handlers[pr.type](i);
      });
    }
    draw();
    if (pr.type === 'findAll') say('タップすると印がつきます。', 'info');
  }

  // ---------- 対局 ----------
  var G = null;

  function newGame() {
    if (G) Game.cancel(G, env);
    G = Game.create(9);
    store.game = null; save();
  }
  function saveGame() { store.game = Game.toSaved(G); save(); }

  function showGame() {
    if (!G) {
      G = Game.restore(store.game);
      if (!G) newGame();
    }
    show(topBar('menu', 'メニュー', '対局') +
      '<div class="players">' +
      '<div class="pl" data-c="1"><span class="stone b"></span><span><b>あなた</b>（黒）<small>取った石 <span class="num-cap" data-cap="1">0</span></small></span></div>' +
      '<div class="pl" data-c="2"><span class="stone w"></span><span><b>コンピュータ</b>（白）<small>取った石 <span class="num-cap" data-cap="2">0</span></small></span></div>' +
      '</div>' +
      '<p class="status" role="status"></p>' +
      '<div class="board play game"></div>' +
      '<div class="toast" hidden></div>' +
      '<div class="controls">' +
      '<button type="button" class="btn" data-act="undo">待った</button>' +
      '<button type="button" class="btn" data-act="pass-ask">パス</button>' +
      '<button type="button" class="btn primary" data-act="score" hidden>数える</button>' +
      '<button type="button" class="btn hint" data-act="hint">爺の指南</button>' +
      '<button type="button" class="btn" data-act="restart-ask">最初から</button>' +
      '</div>' +
      '<p class="note">石は「二度タップ」で置きます。オレンジの輪は{アタリ}の石です。</p>' +
      '<p class="note">困ったら「爺の指南」で、爺やが1手教えます（正解とはかぎりません）。</p>');
    var boardEl = app.querySelector('.board.game');
    bindBoard(boardEl, 9, onGameTap);
    // 画面を離れたら、コンピュータの手番のタイマーを止める
    var g = G;
    leaveGame = function () { Game.cancel(g, env); };
    drawGame();
    if (Game.computerToPlay(G)) runComputer(); // 考え中に画面を離れていた
  }

  // コンピュータの手番を少し待ってから打つ（タイマーは G.timer。画面を離れる・待った・新しい対局で止める）
  function runComputer() {
    var g = G;
    Game.schedule(g, env, function (out) {
      if (g !== G) return;
      if (out.res) events(out.res, WHITE);
      saveGame();
      if (G.st.over) startScoring(); else drawGame();
    });
  }

  function drawGame() {
    var boardEl = app.querySelector('.board.game');
    if (!boardEl) return;
    var st = G.st, thinking = Game.computerToPlay(G), marking = st.over && !G.result;
    var dead = marking ? (G.dead || []) : [];
    boardEl.innerHTML = boardSVG({
      size: 9, board: G.result ? G.result.board : st.board,
      ghost: G.ghost, ghostColor: BLACK, ghostBad: G.ghostBad, last: st.lastMove,
      atari: st.over ? [] : atariStones(st.board, 9),
      owner: G.result ? G.result.owner : null,
      dim: dead,
      marks: marking
        ? dead.map(function (i) { return { i: i, type: 'cross' }; })
        : G.hl.map(function (i) { return { i: i, type: 'triangle' }; })
          .concat(G.hint && G.hint.i != null ? [{ i: G.hint.i, type: 'hint' }] : [])
    });
    app.querySelector('[data-cap="1"]').textContent = st.captures[BLACK];
    app.querySelector('[data-cap="2"]').textContent = st.captures[WHITE];
    app.querySelectorAll('.pl').forEach(function (el) {
      el.classList.toggle('turn', !st.over && Number(el.dataset.c) === st.toPlay);
    });
    var msg;
    if (G.result) msg = '終局しました。';
    else if (marking) msg = '死に石をタップして×の印を付け、「数える」を押してください。';
    else if (thinking) msg = 'コンピュータが考えています…';
    else if (G.ghostBad) msg = REASON[G.ghostBad];
    else if (G.ghost != null) msg = 'もう一度タップすると、ここに置きます。';
    else if (G.hint) msg = G.hint.msg;
    else msg = (G.info ? G.info + ' ' : '') + 'あなたの番です。';
    app.querySelector('.status').innerHTML = rich(msg);
    app.querySelector('[data-act="undo"]').disabled = G.hist.length === 0;
    var passBtn = app.querySelector('[data-act="pass-ask"]');
    passBtn.hidden = st.over;
    passBtn.disabled = thinking;
    app.querySelector('[data-act="hint"]').disabled = thinking || st.over;
    app.querySelector('[data-act="score"]').hidden = !marking;
  }

  function onGameTap(i) {
    if (G.st.over) {
      var r = Game.toggleDead(G, i);
      if (r === 'confirm') {
        openModal('<h2>自分（黒）の石を死に石にしますか？</h2>' +
          '<p>印を付けると、この石は数えるときに取り除かれ、白のアゲハマになります。</p>' +
          '<div class="row"><button type="button" class="btn" data-act="close">やめる</button>' +
          '<button type="button" class="btn primary" data-act="dead-black" data-k="' + i + '">印を付ける</button></div>');
      } else if (r) { saveGame(); drawGame(); }
      return;
    }
    var out = Game.tap(G, i);
    if (out.kind === 'ignore') return;
    if (out.kind !== 'played') { drawGame(); return; }
    hideToast();
    events(out.res, BLACK);
    drawGame(); saveGame();
    runComputer();
  }

  // その場面が初めて起きたときだけ、一言だけ出す
  function events(res, color) {
    var st = res.state, list = [];
    if (res.captured.length === 1) {
      var g = R.groupAt(st.board, 9, st.lastMove);
      if (g.stones.length === 1 && g.liberties.length === 1 && g.liberties[0] === res.captured[0]) {
        list.push({ id: 'ko', text: 'これが{コウ}！ 取られた石は、すぐには取り返せません。' });
      }
    }
    if (res.captured.length) {
      list.push({ id: 'toru', text: color === BLACK ? 'これが「{取る}」！ 白石を取りました。' : 'これが「{取る}」… 石を取られちゃった。' });
    }
    if (R.atariGroups(st.board, 9).length) {
      list.push({ id: 'atari', text: 'これが{アタリ}！ オレンジの輪の石は、呼吸点が残り1つです。' });
    }
    if (color === BLACK) {
      list.push({ id: 'kokyuten', text: '△が、置いた石の{呼吸点}。たて・よこの空き点です。', hl: R.groupAt(st.board, 9, st.lastMove).liberties });
    }
    var first = list.filter(function (e) { return !store.seen[e.id]; })[0];
    if (!first) return;
    store.seen[first.id] = true; save();
    if (first.hl) G.hl = first.hl;
    toast(first.text, first.id);
  }

  function toast(text, termId) {
    var t = app.querySelector('.toast');
    if (!t) return;
    t.innerHTML = '<p>' + rich(text) + '</p><button type="button" class="more" data-term="' + termId + '">くわしく ›</button>';
    t.hidden = false;
  }
  function hideToast() { var t = app.querySelector('.toast'); if (t) t.hidden = true; }

  // 終局：数える前に、死に石をタップで取り除いてもらう
  function startScoring() {
    drawGame();
    hideToast();
    openModal('<h2>終局！</h2><p>パスが2回続いたので、対局はおしまいです。</p>' +
      '<p>' + rich('数える前に、相手の囲いの中に取り残されて、もう助からない石（死に石）をタップしてください。つながった石ごと×の印が付きます。もう一度タップすると外れます。') + '</p>' +
      '<p>' + rich('印を付けた石は盤から取り除いて、取った石（{アゲハマ}）に入れます。死に石がなければ、そのまま「数える」を押してください。') + '</p>' +
      '<p>' + rich('※セキ（どちらも相手の石を取れないまま、両方とも生きている形）の数え方には対応していません。') + '</p>' +
      '<button type="button" class="btn primary wide" data-act="close">わかった！</button>');
  }

  function showResult() {
    var sc = G.result;
    drawGame();
    hideToast();
    var first = !store.seen.ji;
    store.seen.ji = true; save();
    var head = sc.winner === BLACK ? 'あなたの勝ち！' : sc.winner === WHITE ? 'コンピュータの勝ち' : '引き分け（持碁）';
    var diff = sc.winner ? '<span class="diff">' + sc.diff + '目差</span>' : '';
    openModal(
      '<h2>' + (first ? 'これが「地」の数え方！' : '結果') + '</h2>' +
      '<div class="result">' + head + diff + '</div>' +
      '<table class="score"><thead><tr><th></th><th>地</th><th>アゲハマ</th><th>合計</th></tr></thead><tbody>' +
      '<tr><th>あなた（黒）</th><td>' + sc.black.territory + '</td><td>' + sc.black.agehama + '</td><td><b>' + sc.black.total + '</b></td></tr>' +
      '<tr><th>コンピュータ（白）</th><td>' + sc.white.territory + '</td><td>' + sc.white.agehama + '</td><td><b>' + sc.white.total + '</b></td></tr>' +
      '</tbody></table>' +
      '<div class="howto"><h3>数え方</h3>' +
      '<p>' + rich('点数＝自分の石だけで囲んだ空き点（{地}）＋取った石（{アゲハマ}）。これが日本のルールの数え方です。盤の■と□が、それぞれの地です。') + '</p>' +
      '<p>' + rich('アゲハマには、対局中に取った石と、終局のときに取り除いた死に石の両方が入ります。') + '</p>' +
      '<p>' + rich('黒と白の両方に接している空き点は、どちらの地にもなりません（これを{ダメ}といいます）。コミ（あとから打つ白へのおまけ）はありません。') + '</p></div>' +
      '<div class="row"><button type="button" class="btn" data-act="close">盤を見る</button>' +
      '<button type="button" class="btn primary" data-act="restart">もう一局 ›</button></div>');
  }

  // ---------- ボタン ----------
  var actions = {
    menu: showMenu,
    lessons: function () { showList('lesson'); },
    practices: function () { showList('practice'); },
    lesson: function (k) { k < L.lessons.length ? showLessonLearn(k) : showLessonsDone(); },
    'lesson-try': showLessonTry,
    'lessons-done': showLessonsDone,
    practice: function (k) { k < L.practice.length ? showPractice(k) : showList('practice'); },
    game: function () { showGame(); },
    close: closeModal,
    undo: function () {
      if (!Game.undo(G, env)) return;
      hideToast(); closeModal(); saveGame(); drawGame();
    },
    'pass-ask': function () {
      if (Game.computerToPlay(G) || G.st.over) return;
      openModal('<h2>パスしますか？</h2><p>パスは「今回は打たない」ということ。2人続けてパスすると対局は終わり、点数を数えます。</p>' +
        '<p>自分の囲いの中に相手の石が残っていたら、取ってからパスしよう。</p>' +
        '<div class="row"><button type="button" class="btn" data-act="close">やめる</button><button type="button" class="btn primary" data-act="pass">パスする</button></div>');
    },
    pass: function () {
      closeModal();
      if (!Game.passBlack(G)) return;
      hideToast(); drawGame(); saveGame();
      if (G.st.over) startScoring(); else runComputer();
    },
    // 爺の指南：押すと1手すすめる。もう一度押すと消す
    hint: function () {
      if (Game.computerToPlay(G) || G.st.over) return;
      // 出すときは仮の石を消す（仮の石の文が先に出て、爺の文が隠れるため）
      if (G.hint) G.hint = null; else { G.ghost = null; G.ghostBad = null; Game.hint(G); }
      drawGame();
    },
    'dead-black': function (k) {
      closeModal();
      if (Game.toggleDead(G, k, true) === true) { saveGame(); drawGame(); }
    },
    score: function (sure) {
      if (!G.st.over || G.result) return;
      if (!Game.finish(G, sure === 1)) {
        openModal('<h2>黒の石に印が ' + Game.blackMarked(G) + ' 子あります</h2>' +
          '<p>あなた（黒）の石に死に石の印が付いています。このまま数えると、その石は白のアゲハマになります。</p>' +
          '<div class="row"><button type="button" class="btn" data-act="close">戻る</button>' +
          '<button type="button" class="btn primary" data-act="score" data-k="1">そのまま数える</button></div>');
        return;
      }
      saveGame();
      showResult();
    },
    'restart-ask': function () {
      if (!G.hist.length && !G.st.over) { actions.restart(); return; }
      openModal('<h2>最初からやり直しますか？</h2><p>いまの対局は消えて、新しい対局になります。</p>' +
        '<div class="row"><button type="button" class="btn" data-act="close">やめる</button><button type="button" class="btn primary" data-act="restart">最初から</button></div>');
    },
    restart: function () { closeModal(); newGame(); showGame(); },
    'reset-ask': function () {
      openModal('<h2>進み具合をリセットしますか？</h2><p>クリアの印と、対局中の説明の「初めて」がすべて最初に戻ります。</p>' +
        '<div class="row"><button type="button" class="btn" data-act="close">やめる</button><button type="button" class="btn primary" data-act="reset">リセット</button></div>');
    },
    reset: function () {
      if (G) Game.cancel(G, env);
      store = { lessons: {}, practice: {}, seen: {}, game: null }; save(); G = null; showMenu();
    }
  };

  document.addEventListener('click', function (e) {
    var term = e.target.closest('[data-term]');
    if (term) { openTerm(term.dataset.term); return; }
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var fn = actions[b.dataset.act];
    if (fn) fn(b.dataset.k != null ? Number(b.dataset.k) : undefined);
  });

  // ダブルタップでの拡大を防ぐ（CSS の touch-action と二重にしておく）
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

  showMenu();
})();
