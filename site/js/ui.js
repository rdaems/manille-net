// The table: you sit at the bottom (seat 0), Michele opposite is your partner, Pauline on
// your left and Ben on your right play against you (the names of Hartenjagen '98).
import { Deal, cards, bit, teamOf, suitMask, rng, NOTRUMP, RANKS, POINTS } from './manille.js';
import { playDeal } from './game.js';
import * as sound from './sound.js';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
const WHO = ['Jij', 'Pauline', 'Michele', 'Ben'];
const SUIT = ['schoppen', 'harten', 'klaveren', 'ruiten'];
const TARGET = 121;
const OFFER_MS = 5000;                                   // how long the doubling button stays
const THINK_MS = 320;                                    // an opponent never answers faster than this
const SHADOW = '0 1px 0 rgba(0,0,0,.25), 0 2px 5px rgba(0,0,0,.4)';

const isRed = s => s === 1 || s === 3;
const suitSvg = s => `<svg viewBox="0 0 32 32" aria-hidden="true"${isRed(s) ? ' class="red"' : ''}><use href="#s${s}"/></svg>`;
function cardEl(c, tag = 'div') {
  const el = document.createElement(tag);
  el.className = 'card';
  el.dataset.c = c;
  el.innerHTML = `<img src="cards/${c}.webp" alt="${SUIT[c >> 3]} ${RANKS[c & 7]}" draggable="false">`;
  return el;
}
for (let c = 0; c < 32; c++) new Image().src = `cards/${c}.webp`;   // have the faces ready before they fly

// ---- the AI, in a worker ----------------------------------------------------------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const waiting = new Map(); let nextId = 1;
worker.onmessage = e => { waiting.get(e.data.id)(e.data.result); waiting.delete(e.data.id); };
worker.onerror = e => { $('#status').textContent = 'De computer is vastgelopen. Herlaad de pagina.'; console.error(e); };
const think = (what, view) => new Promise(resolve => {
  waiting.set(nextId, resolve);
  worker.postMessage({ id: nextId++, what, view: { ...view, plays: view.plays.slice() } });
});

// ---- what is kept between visits -----------------------------------------------------------
const KEY = 'manillen-1';
const fresh = games => ({ score: [0, 0], deals: [], dealer: Math.floor(Math.random() * 4), carry: 1, games });
let game = fresh([]);
try { const g = JSON.parse(localStorage.getItem(KEY)); if (g && g.score) game = { games: [], ...g }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(game)); } catch {} };

// ---- drawing -------------------------------------------------------------------------------
let deal = null, mult = 1, trumpKnown = false;
const seatEl = seat => document.querySelector(`.seat[data-seat="${seat}"]`);
const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

function drawScore() {
  $('#us').textContent = game.score[0];
  $('#them').textContent = game.score[1];
}
// The dealer's plate carries what the dealer named, and what the deal counts.
function drawSeats(pop = false) {
  document.querySelectorAll('.seat').forEach(el => {
    const seat = +el.dataset.seat, dealer = seat === deal.dealer, badge = el.querySelector('.badge');
    el.classList.toggle('dealer', dealer);
    el.classList.toggle('turn', trumpKnown && !deal.done && seat === deal.turn);
    if (!dealer) return;
    const x = mult > 1 ? ` ×${mult}` : '';
    badge.innerHTML = !trumpKnown ? `deelt${x}` : deal.trump === NOTRUMP ? `zonder troef${x}` : `${suitSvg(deal.trump)}troef${x}`;
    if (pop) { badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
  });
}
function sortHand(mask) {
  // trumps first, then the suits with black and red taking turns; strongest card left
  const order = [0, 1, 2, 3];
  if (trumpKnown && deal.trump < 4) { const t = deal.trump; order.sort((a, b) => ((a - t + 4) % 4) - ((b - t + 4) % 4)); }
  return cards(mask).sort((a, b) => order.indexOf(a >> 3) - order.indexOf(b >> 3) || b - a);
}
function drawHand(dealt = false) {
  const el = $('#hand');
  el.classList.toggle('still', !dealt);
  el.replaceChildren(...sortHand(deal.hands[0]).map((c, i) => { const b = cardEl(c, 'button'); b.style.setProperty('--i', i); return b; }));
  markPre();
}
function drawBacks() {
  for (const seat of [1, 2, 3]) {
    const n = cards(deal.hands[seat]).length;
    seatEl(seat).querySelector('.backs').replaceChildren(...Array.from({ length: n }, () => Object.assign(document.createElement('div'), { className: 'back' })));
  }
}
const status = t => { $('#status').textContent = t; };

async function say(seat, html, ms = 1150) {
  const el = seatEl(seat).querySelector('.say');
  el.innerHTML = html; el.classList.add('on');
  await sleep(ms);
  el.classList.remove('on');
}

// ---- cards in motion -----------------------------------------------------------------------
// Where a seat's card lies in the trick: a step toward its player, a little askew.
const SLOT = [[0, 0.3, 0], [-0.66, 0, -7], [0, -0.3, 0], [0.66, 0, 7]];
function slot(seat) {
  const [x, y, r] = SLOT[seat];
  return `translate(calc(var(--cw) * ${x}), calc(var(--ch) * ${y})) rotate(${(r + (Math.random() * 8 - 4)).toFixed(1)}deg)`;
}
// A card comes from `from` (a point on the page) and drops on its place in the trick: it
// starts a little larger with a wide shadow, as if held above the table, and lands.
async function drop(el, from) {
  const here = center(el), end = el.style.transform;
  if (quick) { sound.play('card'); return; }
  const move = `translate(${(from.x - here.x).toFixed(1)}px, ${(from.y - here.y).toFixed(1)}px) `;
  setTimeout(() => sound.play('card'), 150);
  await el.animate([
    { transform: `${move}${end} scale(1.22)`, boxShadow: '0 22px 30px rgba(0,0,0,.30)' },
    { transform: `${end} scale(1.06)`, boxShadow: '0 8px 14px rgba(0,0,0,.36)', offset: 0.72 },
    { transform: `${end} scale(.985)`, boxShadow: SHADOW, offset: 0.9 },
    { transform: end, boxShadow: SHADOW },
  ], { duration: 240, easing: 'cubic-bezier(.3,.7,.4,1)' }).finished;
}
// The four cards are swept together and off to whoever took the trick.
async function sweep(winner) {
  const box = $('#trick'), mid = center(box), to = center(winner === 0 ? $('#hand') : seatEl(winner).querySelector('.backs'));
  sound.play('sweep');
  if (!quick) await Promise.all([...box.children].map(el => el.animate([
    { transform: el.style.transform, opacity: 1 },
    { transform: 'translate(0px, 0px) rotate(0deg) scale(.92)', opacity: 1, offset: 0.3 },
    { transform: `translate(${(to.x - mid.x).toFixed(1)}px, ${(to.y - mid.y).toFixed(1)}px) scale(.5)`, opacity: 0 },
  ], { duration: 320, easing: 'cubic-bezier(.4,0,.7,.5)', fill: 'forwards' }).finished));
  box.replaceChildren();
}

// ---- asking you ------------------------------------------------------------------------------
function askDialog(html) {
  const dlg = $('#ask');
  dlg.firstElementChild.innerHTML = html;
  dlg.showModal();
  return new Promise(resolve => {
    dlg.onclick = e => {
      const b = e.target.closest('[data-v]');
      if (b) { dlg.close(); resolve(b.dataset.v); }
    };
    dlg.oncancel = e => e.preventDefault();               // a question, not a notice: no Escape
  });
}

async function yourTrump() {
  status('');
  const v = await askDialog(`<h2>Jij deelt. Wat wordt troef?</h2>
    <div class="row">${[0, 1, 2, 3].map(s => `<button class="btn${isRed(s) ? ' red' : ''}" data-v="${s}" aria-label="${SUIT[s]}">${suitSvg(s)}</button>`).join('')}
    <button class="btn" data-v="4">Zonder troef <small>telt dubbel</small></button></div>`);
  return +v;
}

// Meegaan or tegengaan: a button that is there for a few seconds. Not pressing it is the answer
// no; the cross (or Escape) says no at once; while the pointer rests on it the clock stands still.
function yourDouble(view) {
  const el = $('#offer'), back = teamOf(view.dealer) === 0;
  el.querySelector('.go').textContent = back ? 'Ga tegen (dubbel)' : 'Ga mee (dubbel)';
  el.style.setProperty('--ms', OFFER_MS + 'ms');
  el.classList.remove('paused');
  status(''); el.hidden = false;
  return new Promise(resolve => {
    let left = OFFER_MS, since = performance.now(), timer = setTimeout(() => done(false), left);
    const done = v => {
      clearTimeout(timer); el.hidden = true;
      el.onclick = el.onpointerenter = el.onpointerleave = null; removeEventListener('keydown', key);
      resolve(v);
    };
    const key = e => { if (e.key === 'Escape') done(false); };
    el.onpointerenter = e => {
      if (e.pointerType === 'touch') return;             // a finger means a tap, not a rest
      clearTimeout(timer); left -= performance.now() - since; el.classList.add('paused');
    };
    el.onpointerleave = e => {
      if (e.pointerType === 'touch' || !el.classList.contains('paused')) return;
      since = performance.now(); timer = setTimeout(() => done(false), Math.max(300, left)); el.classList.remove('paused');
    };
    el.onclick = e => { if (e.target.closest('button')) done(!!e.target.closest('.go')); };
    addEventListener('keydown', key);
  });
}

// Why a card may not be played, in the words of the rule.
function why(card) {
  const hand = deal.hands[0], led = deal.led, win = deal.win;
  const partner = teamOf(deal.winSeat) === 0;
  if (hand & suitMask(led)) {
    if ((card >> 3) !== led) return `Je moet ${SUIT[led]} volgen.`;
    return 'Je moet erboven als je kan.';
  }
  if ((card >> 3) === deal.trump) return 'Lager troeven mag niet.';
  if ((win >> 3) === deal.trump && !partner) return 'Je moet erboven troeven.';
  return 'Je moet troef spelen.';
}

// Your cards. On your turn a tap plays the card. Before your turn a tap sets a card ready
// (a pre-move): it is played the moment the turn comes, if the rules allow it by then.
let pre = -1, choosing = null, from = null;
function markPre() {
  for (const c of $('#hand').children) c.classList.toggle('pre', +c.dataset.c === pre);
}
$('#hand').onclick = e => {
  const b = e.target.closest('.card');
  if (!b || !deal || !trumpKnown) return;
  const c = +b.dataset.c;
  if (!choosing) { pre = pre === c ? -1 : c; markPre(); if (pre >= 0) sound.play('ready'); return; }
  if (!(choosing.ok & bit(c))) {
    status(why(c)); sound.play('no'); b.classList.remove('no'); void b.offsetWidth; b.classList.add('no');
    return;
  }
  const { resolve } = choosing;
  choosing = null; from = center(b);
  $('#hand').classList.remove('choose');
  for (const x of $('#hand').children) x.classList.remove('ok');
  resolve(c);
};

async function yourCard() {
  const el = $('#hand'), ok = deal.legal(0);
  if (pre >= 0) {
    const c = pre; pre = -1;
    if (ok & bit(c)) {
      await sleep(quick ? 80 : 160);
      from = center(el.querySelector(`[data-c="${c}"]`));
      return c;
    }
    markPre(); status(why(c)); sound.play('no');
  } else status(deal.n === 0 ? 'Jij komt uit.' : 'Jouw beurt.');
  el.classList.add('choose');
  for (const c of el.children) c.classList.toggle('ok', !!(ok & bit(+c.dataset.c)));
  return new Promise(resolve => { choosing = { ok, resolve }; });
}

// ---- one deal ----------------------------------------------------------------------------------
async function ask(seat, what, view) {
  if (seat === 0) {
    if (what === 'trump') return yourTrump();
    if (what === 'double') return yourDouble(view);
    return yourCard();
  }
  if (what === 'card') { drawSeats(); if ($('#status').textContent.startsWith('J')) status(''); }
  const [r] = await Promise.all([think(what, view), sleep(what === 'card' ? THINK_MS : 420)]);
  return what === 'card' ? r.card : what === 'trump' ? r.trump : r.go;
}

const events = {
  async trump({ seat, trump, mult: m }) {
    mult = m; trumpKnown = true;
    drawHand(); drawSeats(true);
    if (seat !== 0) await say(seat, trump === NOTRUMP ? 'Zonder troef' : `${suitSvg(trump)} ${SUIT[trump]} troef`, 1300);
  },
  async mee({ seat, mult: m }) { mult = m; sound.play('knock'); drawSeats(true); if (seat !== 0) await say(seat, 'Ik ga mee'); },
  async tegen({ seat, mult: m }) { mult = m; sound.play('knock'); drawSeats(true); if (seat !== 0) await say(seat, 'Ik ga tegen'); },
  async card({ seat, card }) {
    const el = cardEl(card);
    el.dataset.seat = seat; el.style.transform = slot(seat); el.style.zIndex = deal.n === 0 ? 4 : deal.n;
    $('#trick').append(el);
    const start = seat === 0 ? from : center(seatEl(seat).querySelector('.backs'));
    if (seat === 0) drawHand(); else drawBacks();
    drawSeats();
    await drop(el, start);
  },
  async trick(t) {
    const win = t.cards.find(x => x.seat === t.winner).card;
    for (const el of $('#trick').children) el.classList.toggle('winning', +el.dataset.c === win);
    status(`${WHO[t.winner]} haalt de slag${t.points ? ` (${t.points})` : ''}.`);
    await sleep(quick ? 700 : 780);
    await sweep(t.winner);
    drawSeats();
    $('#lastBtn').hidden = false;
  },
};

async function oneDeal() {
  deal = Deal.random(rng((Math.random() * 2 ** 32) >>> 0), game.dealer);
  mult = game.carry; trumpKnown = false; pre = -1;
  $('#trick').replaceChildren(); $('#lastBtn').hidden = true; status('');
  drawScore(); drawHand(true); drawBacks(); drawSeats();
  const r = await playDeal(deal, ask, { carry: game.carry, on: (what, data) => events[what](data) });
  game.deals.push({ dealer: r.dealer, trump: r.trump, mult: r.mult, points: r.points, team: r.team, score: r.score });
  if (r.team >= 0) game.score[r.team] += r.score;
  game.carry = r.team < 0 ? 2 : 1;                        // 30-30: the next deal counts double
  game.dealer = (game.dealer + 1) & 3;
  save(); drawScore();
  return r;
}

async function afterDeal(r) {
  status('');
  const over = Math.max(...game.score) >= TARGET, ours = game.score[0] >= TARGET;
  sound.play(over ? (ours ? 'game' : 'lost') : r.team === 0 ? 'won' : r.team === 1 ? 'lost' : 'ready');
  const line = r.team < 0
    ? '<p>Dertig tegen dertig: niemand scoort. Het volgende spel telt dubbel.</p>'
    : `<p class="gain">${r.team === 0 ? 'Wij' : 'Zij'} krijgen ${r.score}${r.mult > 1 || r.tricks[r.team] === 8
        ? ` <span class="dim">(${r.tricks[r.team] === 8 ? 'alle slagen: 60' : r.points[r.team] - 30}${r.mult > 1 ? ` × ${r.mult}` : ''})</span>` : ''}.</p>`;
  const end = !over ? '' : `<h2>${ours ? 'De boom is voor ons.' : 'De boom is voor hen.'}</h2>`;
  await askDialog(`${end}<div class="big"><span><small>wij</small> ${r.points[0]}</span><span><small>zij</small> ${r.points[1]}</span></div>${line}
    <p class="dim">Stand: wij ${game.score[0]}, zij ${game.score[1]}.</p>
    <div class="row"><button class="btn main" data-v="1">${over ? 'Nieuwe boom' : 'Volgend spel'}</button></div>`);
  if (over) {
    game.games.push({ day: new Date().toISOString().slice(0, 10), score: game.score });
    game = fresh(game.games); save();
  }
}

// ---- the sheets --------------------------------------------------------------------------------
function sheet(html) {
  const dlg = $('#sheet');
  dlg.firstElementChild.innerHTML = html + '<div class="row"><button class="btn" data-close>Sluiten</button></div>';
  if (!dlg.open) dlg.showModal();
  dlg.onclick = e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };
  return dlg;
}

const record = () => {
  const won = game.games.filter(g => g.score[0] > g.score[1]).length, lost = game.games.length - won;
  return game.games.length ? `${won} ${won === 1 ? 'boom' : 'bomen'} gewonnen, ${lost} verloren` : '';
};

function showScore() {
  let a = 0, b = 0;
  const rows = game.deals.map(d => {
    if (d.team === 0) a += d.score; else if (d.team === 1) b += d.score;
    return `<tr><td>${WHO[d.dealer]} ${d.trump === NOTRUMP ? 'zonder' : suitSvg(d.trump)}${d.mult > 1 ? ` ×${d.mult}` : ''}</td>
      <td class="dim">${d.points[0]}–${d.points[1]}</td><td>${d.team === 0 ? d.score : ''}</td><td>${d.team === 1 ? d.score : ''}</td></tr>`;
  }).join('');
  sheet(`<h2>Boom tot ${TARGET}</h2>
    <table><thead><tr><th>deler, troef</th><th>punten</th><th>wij</th><th>zij</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="dim">Nog geen spel gespeeld.</td></tr>'}</tbody>
    <tfoot><tr><td></td><td></td><td>${a}</td><td>${b}</td></tr></tfoot></table>
    ${game.games.length ? `<h3>Gespeelde bomen</h3><p>${record()}</p>
    <table class="past"><tbody>${game.games.slice(-8).reverse().map(g => `<tr><td class="dim">${g.day.split('-').reverse().join('/')}</td><td>${g.score[0]}</td><td>${g.score[1]}</td></tr>`).join('')}</tbody></table>` : ''}`);
}

function showLast() {
  const t = deal && deal.last; if (!t) return;
  const dlg = sheet('<h2>Vorige slag</h2><div class="lasttrick"></div>');
  dlg.querySelector('.lasttrick').append(...t.cards.map(({ seat, card }) => {
    const f = document.createElement('figure');
    f.append(cardEl(card), Object.assign(document.createElement('figcaption'), { textContent: WHO[seat], className: seat === t.winner ? 'win' : '' }));
    return f;
  }));
}

function showRules() {
  const dlg = sheet(`<h2>Regels</h2><div class="rules">
    <p>Vier spelers, twee tegen twee, 32 kaarten. Jij speelt met Michele, tegenover je, tegen Pauline en Ben. Wie deelt kiest troef, of speelt zonder troef (dan telt het spel dubbel). De speler links van de deler komt uit.</p>
    <h3>De kaarten</h3>
    <div class="mini"></div>
    <p>Van sterk naar zwak, met de punten eronder. De 10 (de manille) is de hoogste kaart. Samen 60 punten per spel.</p>
    <h3>Wat je moet spelen</h3>
    <p>Je moet volgen. Ligt de slag bij de tegenpartij, dan moet je erboven als je kan.</p>
    <p>Kan je niet volgen en ligt de slag bij de tegenpartij, dan moet je troeven, en boven een troef die er al ligt. Lager troeven mag niet, tenzij je niets anders hebt.</p>
    <p>Ligt de slag bij je maat, dan ben je vrij (maar je volgt altijd).</p>
    <h3>Tellen</h3>
    <p>De ploeg met meer dan 30 krijgt wat ze boven 30 heeft. Alle slagen halen is 60. Bij 30 tegen 30 scoort niemand en telt het volgende spel dubbel. Wie eerst ${TARGET} heeft wint de boom.</p>
    <p>De tegenpartij van de deler mag meegaan (het spel telt dubbel), de ploeg van de deler mag dan tegengaan (nog eens dubbel). De knop daarvoor staat enkele seconden boven je kaarten.</p>
    <p>Je mag een kaart al klaarleggen voor je aan de beurt bent: tik erop, en ze wordt gespeeld zodra het mag.</p>
    <h3>De computer</h3>
    <p>Pauline, Michele en Ben zien alleen hun eigen kaarten en wat er gevallen is. Ze leiden daaruit af wat de anderen kunnen hebben, wegen de mogelijke verdelingen met wat ze van duizenden eerdere spellen geleerd hebben, en spelen de kaart die gemiddeld het meeste opbrengt.</p>
  </div>`);
  dlg.querySelector('.mini').append(...[7, 6, 5, 4, 3, 2, 1, 0].map(r => {
    const f = document.createElement('figure');
    f.append(cardEl(8 + r), Object.assign(document.createElement('figcaption'), { textContent: POINTS[r] }));
    return f;
  }));
}

$('#score').onclick = showScore;
$('#lastBtn').onclick = showLast;
$('#menuBtn').onclick = () => {
  const dlg = sheet(`<h2>Menu</h2><div class="menu">
    <button class="btn" id="mScore">Scorebord</button>
    <button class="btn" id="mRules">Regels</button>
    <button class="btn" id="mSound"></button>
    <button class="btn" id="mStop">Stoppen <small>de stand blijft bewaard</small></button></div>`);
  const label = () => { dlg.querySelector('#mSound').textContent = sound.isMuted() ? 'Geluid aanzetten' : 'Geluid uitzetten'; };
  label();
  dlg.querySelector('#mScore').onclick = showScore;
  dlg.querySelector('#mRules').onclick = showRules;
  dlg.querySelector('#mSound').onclick = () => { sound.setMuted(!sound.isMuted()); sound.wake(); sound.play('card'); label(); };
  dlg.querySelector('#mStop').onclick = () => location.reload();     // a deal in progress is dealt again
};

// ---- the start screen --------------------------------------------------------------------------
const fan = [15, 14, 13, 12, 11, 10, 9, 8];              // hearts, in the order of manillen: 10 first
$('#home .fan').append(...fan.map((c, i) => {
  const el = cardEl(c);
  el.style.transform = `rotate(${(i - 3.5) * 9}deg)`; el.style.animationDelay = `${i * 35}ms`;
  return el;
}));
const going = game.deals.length > 0 || game.score[0] + game.score[1] > 0;
if (going) {
  $('#continue').hidden = false;
  $('#continue small').textContent = `wij ${game.score[0]}, zij ${game.score[1]}`;
  $('#new').classList.remove('main');
}
$('#record').textContent = record();

async function start(anew) {
  sound.wake();
  if (anew) { game = fresh(game.games); save(); }
  $('#home').hidden = true; $('#table').hidden = false;
  for (;;) await afterDeal(await oneDeal());
}
$('#continue').onclick = () => start(false);
$('#new').onclick = () => start(true);
$('#homeRules').onclick = showRules;

// Installing: Chrome and Android offer it through this event; on an iPhone it is a menu in Safari.
let installer = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installer = e; $('#install').hidden = false; });
addEventListener('appinstalled', () => { $('#install').hidden = true; });
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iphone && !standalone) $('#install').hidden = false;
$('#install').onclick = async () => {
  if (installer) { installer.prompt(); await installer.userChoice; installer = null; $('#install').hidden = true; return; }
  sheet('<h2>Op je startscherm</h2><p>Tik in Safari onderaan op het deel-icoon (het vierkant met de pijl) en kies <b>Zet op beginscherm</b>. Manillen staat dan als app tussen je andere apps en werkt ook zonder verbinding.</p>');
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
