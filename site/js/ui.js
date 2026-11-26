// The table: you sit at the bottom (seat 0), your partner opposite, an AI on every other chair.
import { Deal, cards, bit, teamOf, suitMask, rng, NOTRUMP, RANKS, POINTS } from './manille.js';
import { playDeal } from './game.js';

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
const WHO = ['Jij', 'Links', 'Maat', 'Rechts'];
const SUIT = ['schoppen', 'harten', 'klaveren', 'ruiten'];
const TARGET = 121;
const OFFER_MS = 5000;                                  // how long the doubling button stays
const THINK = {                                          // how long and how wide the AI may think
  card: { worlds: 60, ms: 900, min: 8 },
  trump: { worlds: 24, ms: 1500, min: 6, stop: 16 },
  double: { worlds: 40, ms: 900, min: 10, stop: 16 },
};

const suitSvg = s => `<svg viewBox="0 0 32 32" aria-hidden="true"><use href="#s${s}"/></svg>`;
function cardEl(c, tag = 'div') {
  const el = document.createElement(tag), s = c >> 3, r = c & 7;
  el.className = 'card' + (s === 1 || s === 3 ? ' red' : '');
  el.dataset.c = c;
  el.setAttribute('aria-label', `${SUIT[s]} ${RANKS[r]}`);
  el.innerHTML = `<span class="idx">${RANKS[r]}${suitSvg(s)}</span>${suitSvg(s).replace('<svg', '<svg class="pip"')}`;
  return el;
}

// ---- the AI, in a worker ----------------------------------------------------------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const waiting = new Map(); let nextId = 1;
worker.onmessage = e => { waiting.get(e.data.id)(e.data.result); waiting.delete(e.data.id); };
worker.onerror = e => { $('#status').textContent = 'De computer is vastgelopen. Herlaad de pagina.'; console.error(e); };
const think = (what, view) => new Promise(resolve => {
  waiting.set(nextId, resolve);
  worker.postMessage({ id: nextId++, what, view: { ...view, hand: view.hand, plays: view.plays.slice() }, opts: THINK[what] });
});

// ---- what is kept between visits -----------------------------------------------------------
const KEY = 'manillen-1';
let game = { score: [0, 0], deals: [], dealer: Math.floor(Math.random() * 4), carry: 1, games: [] };
try { const g = JSON.parse(localStorage.getItem(KEY)); if (g && g.score) game = { games: [], ...g }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(game)); } catch {} };

// ---- drawing -------------------------------------------------------------------------------
let deal = null, mult = 1, trumpKnown = false;

function drawScore() {
  $('#us').textContent = game.score[0];
  $('#them').textContent = game.score[1];
}
function drawContract() {
  const el = $('#contract');
  if (!trumpKnown) { el.innerHTML = game.carry > 1 ? `<span class="mult">×${game.carry}</span>` : ''; return; }
  el.innerHTML = (deal.trump === NOTRUMP ? 'zonder troef' : `${suitSvg(deal.trump)}<span>troef</span>`) +
    (mult > 1 ? `<span class="mult">×${mult}</span>` : '');
}
function sortHand(mask) {
  // trumps first, then the suits with black and red taking turns; strongest card left
  const order = [0, 1, 2, 3];
  if (trumpKnown && deal.trump < 4) { const t = deal.trump; order.sort((a, b) => ((a - t + 4) % 4) - ((b - t + 4) % 4)); }
  return cards(mask).sort((a, b) => order.indexOf(a >> 3) - order.indexOf(b >> 3) || b - a);
}
function drawHand() {
  const el = $('#hand');
  el.replaceChildren(...sortHand(deal.hands[0]).map(c => cardEl(c, 'button')));
  markPre();
}
function drawBacks() {
  for (const seat of [1, 2, 3]) {
    const el = document.querySelector(`.seat[data-seat="${seat}"] .backs`);
    const n = cards(deal.hands[seat]).length;
    el.replaceChildren(...Array.from({ length: n }, () => Object.assign(document.createElement('div'), { className: 'back' })));
  }
}
function drawSeats() {
  document.querySelectorAll('.seat').forEach(el => {
    el.classList.toggle('dealer', +el.dataset.seat === deal.dealer && el.dataset.seat !== '0');
    el.classList.toggle('turn', trumpKnown && !deal.done && +el.dataset.seat === deal.turn);
  });
}
const status = t => { $('#status').textContent = t; };

async function say(seat, text, ms = 1500) {
  const el = document.querySelector(`.seat[data-seat="${seat}"] .say`);
  el.innerHTML = text; el.classList.add('on');
  await sleep(quick ? ms * 0.7 : ms);
  el.classList.remove('on');
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
    <div class="row">${[0, 1, 2, 3].map(s => `<button class="btn${s % 2 ? ' red' : ''}" data-v="${s}" aria-label="${SUIT[s]}">${suitSvg(s)}</button>`).join('')}
    <button class="btn" data-v="4">Zonder troef <small>telt dubbel</small></button></div>`);
  return +v;
}

// Meegaan or tegengaan: a button that is there for a few seconds. Not pressing it is the answer
// no; the cross (or Escape) says no at once.
function yourDouble(view) {
  const el = $('#offer'), back = teamOf(view.dealer) === 0;
  el.querySelector('.go').textContent = back ? 'Ga tegen (dubbel)' : 'Ga mee (dubbel)';
  el.style.setProperty('--ms', OFFER_MS + 'ms');
  status(''); el.hidden = false;
  return new Promise(resolve => {
    const done = v => { clearTimeout(timer); el.hidden = true; el.onclick = null; removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') done(false); };
    const timer = setTimeout(() => done(false), OFFER_MS);
    el.onclick = e => { if (e.target.closest('button')) done(!!e.target.closest('.go')); };
    addEventListener('keydown', key);
  });
}

// Why a card may not be played, in the words of the rule.
function why(card) {
  const hand = deal.hands[0], led = deal.led, win = deal.win, T = suitMask(deal.trump);
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
let pre = -1, choosing = null;
function markPre() {
  for (const c of $('#hand').children) c.classList.toggle('pre', +c.dataset.c === pre);
}
$('#hand').onclick = e => {
  const b = e.target.closest('.card');
  if (!b || !deal || !trumpKnown) return;
  const c = +b.dataset.c;
  if (!choosing) { pre = pre === c ? -1 : c; markPre(); return; }
  if (!(choosing.ok & bit(c))) {
    status(why(c)); b.classList.remove('no'); void b.offsetWidth; b.classList.add('no');
    return;
  }
  const { resolve } = choosing;
  choosing = null;
  $('#hand').classList.remove('choose');
  for (const x of $('#hand').children) x.classList.remove('ok');
  resolve(c);
};

async function yourCard() {
  const el = $('#hand'), ok = deal.legal(0);
  if (pre >= 0) {
    const c = pre; pre = -1;
    if (ok & bit(c)) { await sleep(quick ? 120 : 260); markPre(); return c; }
    markPre(); status(why(c));
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
  if (what === 'card') { drawSeats(); status(`${WHO[seat]} is aan zet.`); }
  else status(what === 'trump' ? `${WHO[seat]} deelt en kiest troef.` : '');
  const [r] = await Promise.all([think(what, view), sleep(what === 'card' ? (quick ? 350 : 650) : 500)]);
  return what === 'card' ? r.card : what === 'trump' ? r.trump : r.go;
}

const events = {
  async trump({ seat, trump, mult: m }) {
    mult = m; trumpKnown = true;
    drawContract(); drawHand(); drawSeats();
    if (seat !== 0) await say(seat, trump === NOTRUMP ? 'Zonder troef' : `${suitSvg(trump).replace('<svg', '<svg width="20" height="20" style="vertical-align:-2px"')} ${SUIT[trump]} troef`, 1700);
  },
  async mee({ seat, mult: m }) { mult = m; drawContract(); if (seat !== 0) await say(seat, 'Ik ga mee'); },
  async tegen({ seat, mult: m }) { mult = m; drawContract(); if (seat !== 0) await say(seat, 'Ik ga tegen'); },
  async card({ seat, card }) {
    const el = cardEl(card); el.dataset.seat = seat;
    $('#trick').append(el);
    if (seat === 0) drawHand(); else drawBacks();
    drawSeats();
    if (deal.n !== 0) await sleep(quick ? 60 : 180);
  },
  async trick(t) {
    const box = $('#trick');
    for (const el of box.children) el.classList.toggle('winning', +el.dataset.c === t.cards.find(x => x.seat === t.winner).card);
    box.classList.add('best');
    status(`${WHO[t.winner]} haalt de slag${t.points ? ` (${t.points})` : ''}.`);
    await sleep(quick ? 900 : 1250);
    box.dataset.to = t.winner; box.classList.add('gone');
    await sleep(quick ? 150 : 380);
    box.replaceChildren(); box.classList.remove('best', 'gone');
    drawSeats();
    $('#lastBtn').hidden = false;
  },
};

async function oneDeal() {
  deal = Deal.random(rng((Math.random() * 2 ** 32) >>> 0), game.dealer);
  mult = game.carry; trumpKnown = false; pre = -1;
  $('#trick').replaceChildren(); $('#lastBtn').hidden = true;
  drawScore(); drawContract(); drawHand(); drawBacks(); drawSeats();
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
  const over = Math.max(...game.score) >= TARGET;
  const line = r.team < 0
    ? '<p>Dertig tegen dertig: niemand scoort. Het volgende spel telt dubbel.</p>'
    : `<p class="yellow">${r.team === 0 ? 'Wij' : 'Zij'} krijgen ${r.score}${r.mult > 1 || r.tricks[r.team] === 8
        ? ` <span class="dim">(${r.tricks[r.team] === 8 ? 'alle slagen: 60' : r.points[r.team] - 30}${r.mult > 1 ? ` × ${r.mult}` : ''})</span>` : ''}.</p>`;
  const end = !over ? '' : `<h2>${game.score[0] >= TARGET ? 'De boom is voor ons.' : 'De boom is voor hen.'}</h2>`;
  await askDialog(`${end}<div class="big"><span><small>wij</small> ${r.points[0]}</span><span><small>zij</small> ${r.points[1]}</span></div>${line}
    <p class="dim">Stand: wij ${game.score[0]}, zij ${game.score[1]}.</p>
    <div class="row"><button class="btn main" data-v="1">${over ? 'Nieuwe boom' : 'Volgend spel'}</button></div>`);
  if (over) {
    game.games.push({ day: new Date().toISOString().slice(0, 10), score: game.score });
    game = { score: [0, 0], deals: [], dealer: game.dealer, carry: 1, games: game.games }; save();
  }
}

// ---- the sheets --------------------------------------------------------------------------------
function sheet(html) {
  const dlg = $('#sheet');
  dlg.firstElementChild.innerHTML = html + '<div class="row"><button class="btn" data-close>Sluiten</button></div>';
  dlg.showModal();
  dlg.onclick = e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };
}

$('#score').onclick = () => {
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
    ${game.games.length ? `<h3>Gespeelde bomen</h3>
    <p>${game.games.filter(g => g.score[0] > g.score[1]).length} gewonnen, ${game.games.filter(g => g.score[0] < g.score[1]).length} verloren</p>
    <table class="past"><tbody>${game.games.slice(-8).reverse().map(g => `<tr><td class="dim">${g.day.split('-').reverse().join('/')}</td><td>${g.score[0]}</td><td>${g.score[1]}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="row"><button class="btn" id="fresh">Deze boom opnieuw beginnen</button></div>`);
  $('#fresh').onclick = () => {
    game = { score: [0, 0], deals: [], dealer: game.dealer, carry: 1, games: game.games }; save(); location.reload();
  };
};

$('#lastBtn').onclick = () => {
  const t = deal && deal.last; if (!t) return;
  const dlg = $('#sheet');
  sheet(`<h2>Vorige slag</h2><div class="lasttrick"></div>`);
  dlg.querySelector('.lasttrick').append(...t.cards.map(({ seat, card }) => {
    const f = document.createElement('figure');
    f.append(cardEl(card), Object.assign(document.createElement('figcaption'), { textContent: WHO[seat], className: seat === t.winner ? 'win' : '' }));
    return f;
  }));
};

$('#rulesBtn').onclick = () => {
  const dlg = $('#sheet');
  sheet(`<h2>Regels</h2><div class="rules">
    <p>Vier spelers, twee tegen twee, 32 kaarten. Je speelt met de speler tegenover je. Wie deelt kiest troef, of speelt zonder troef (dan telt het spel dubbel). De speler links van de deler komt uit.</p>
    <h3>De kaarten</h3>
    <div class="mini"></div>
    <p>Van sterk naar zwak. De 10 (de manille) is 5 punten waard, de aas 4, de heer (R) 3, de dame (D) 2, de boer (V) 1. Samen 60 per spel.</p>
    <h3>Wat je moet spelen</h3>
    <p>Je moet volgen. Ligt de slag bij de tegenpartij, dan moet je erboven als je kan.</p>
    <p>Kan je niet volgen en ligt de slag bij de tegenpartij, dan moet je troeven, en boven een troef die er al ligt. Lager troeven mag niet, tenzij je niets anders hebt.</p>
    <p>Ligt de slag bij je maat, dan ben je vrij (maar je volgt altijd).</p>
    <h3>Tellen</h3>
    <p>De ploeg met meer dan 30 krijgt wat ze boven 30 heeft. Alle slagen halen is 60. Bij 30 tegen 30 scoort niemand en telt het volgende spel dubbel. Wie eerst ${TARGET} heeft wint de boom.</p>
    <p>De tegenpartij van de deler mag meegaan (het spel telt dubbel), de ploeg van de deler mag dan tegengaan (nog eens dubbel). De knop daarvoor staat enkele seconden boven je kaarten.</p>
    <p>Je mag een kaart al klaarleggen voor je aan de beurt bent: tik erop, en ze wordt gespeeld zodra het mag.</p>
    <h3>De computer</h3>
    <p>De drie anderen zien alleen hun eigen kaarten en wat er gevallen is. Ze leiden daaruit af wat de anderen niet kunnen hebben, delen de overige kaarten op alle manieren die dan nog kunnen, en spelen de kaart die gemiddeld het meeste opbrengt.</p>
  </div>`);
  dlg.querySelector('.mini').append(...[7, 6, 5, 4, 3, 2, 1, 0].map(r => {
    const el = cardEl(8 + r);
    if (POINTS[r]) el.insertAdjacentHTML('beforeend', `<span class="pts">${POINTS[r]}</span>`);
    return el;
  }));
};

// ---- go --------------------------------------------------------------------------------------
(async () => {
  for (;;) await afterDeal(await oneDeal());
})();
