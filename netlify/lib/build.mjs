// Builds the props dataset: lines (The Odds API) + game logs (NHL API, nflverse) + injuries (ESPN, unofficial).
const ODDS = 'https://api.the-odds-api.com/v4';
const NHLAPI = 'https://api-web.nhle.com/v1';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const MARKETS = {
  nhl: { key: 'icehockey_nhl', espn: 'hockey/nhl', list: {
    player_shots_on_goal: ['Shots on goal', 'shots'], player_points: ['Points', 'points'], player_assists: ['Assists', 'assists'] } },
  nfl: { key: 'americanfootball_nfl', espn: 'football/nfl', list: {
    player_rush_yds: ['Rushing yards', 'rushing_yards'], player_reception_yds: ['Receiving yards', 'receiving_yards'], player_receptions: ['Receptions', 'receptions'] } },
};
const NFL = { 'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LA','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS' };
const ab = (t) => (t === 'LAR' ? 'LA' : t);

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const md = (d) => { const [, m, x] = d.split('-'); return `${+m}/${+x}`; };
const getText = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status} ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}`); return r.text(); };
const getJson = async (url) => JSON.parse(await getText(url));
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}
function csv(t) {
  const split = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
  const lines = t.split(/\r?\n/), h = split(lines[0]);
  return lines.slice(1).filter(Boolean).map((l) => { const v = split(l), r = {}; h.forEach((k, i) => (r[k] = v[i])); return r; });
}

// Over lines from every bookmaker, grouped by player and market
async function oddsProps(cfg) {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY is not set');
  const regions = process.env.ODDS_REGIONS || 'us', horizon = Number(process.env.HORIZON_HOURS || 36);
  const events = await getJson(`${ODDS}/sports/${cfg.key}/events?apiKey=${key}`);
  const soon = events.filter((e) => { const h = (new Date(e.commence_time) - Date.now()) / 36e5; return h > -1 && h < horizon; });
  const markets = Object.keys(cfg.list).join(',');
  const res = await pool(soon, 3, async (e) => ({ e, o: await getJson(`${ODDS}/sports/${cfg.key}/events/${e.id}/odds?apiKey=${key}&regions=${regions}&markets=${markets}&oddsFormat=american`) }));
  const map = new Map();
  for (const r of res) {
    if (!r) continue;
    for (const b of r.o.bookmakers || []) for (const m of b.markets || []) for (const x of m.outcomes || []) {
      if (x.name !== 'Over' || !cfg.list[m.key]) continue;
      const k = `${norm(x.description)}|${m.key}`;
      if (!map.has(k)) map.set(k, { player: x.description, mkey: m.key, event: r.e, books: [] });
      map.get(k).books.push({ book: b.title, line: x.point, odds: x.price });
    }
  }
  return [...map.values()];
}

async function injuries(path) {
  try {
    const d = await getJson(`${ESPN}/${path}/injuries`), m = {};
    for (const t of d.injuries || []) m[norm(t.displayName)] = (t.injuries || []).map((i) => ({ name: norm(i.athlete?.displayName), disp: i.athlete?.displayName || '', status: i.status || '', detail: (i.shortComment || '').slice(0, 90) }));
    return m;
  } catch { return {}; }
}
function inj(m, player, team, opp) {
  const bad = (x) => /out|injured|doubtful/i.test(x.status), list = (k) => m[norm(k)] || [];
  const self = list(team).find((x) => x.name === norm(player)), fmt = (x) => `${x.disp} (${x.status})`;
  return { self: self ? self.status + (self.detail ? ': ' + self.detail : '') : null, team: list(team).filter(bad).slice(0, 4).map(fmt), opp: list(opp).filter(bad).slice(0, 4).map(fmt) };
}

function assemble(sport, r, games, team, opp, home, injMap, teamFull, oppFull) {
  const cnt = {}; r.books.forEach((b) => (cnt[b.line] = (cnt[b.line] || 0) + 1));
  const line = +Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const books = r.books.slice().sort((a, b) => b.odds - a.odds);
  return { id: `${sport}-${norm(r.player).replace(/ /g, '_')}-${r.mkey}`, sport, player: r.player, team, opp, home, start: r.event.commence_time,
    market: MARKETS[sport].list[r.mkey][0], line, odds: books.find((b) => b.line === line).odds, books, games, injury: inj(injMap, r.player, teamFull, oppFull) };
}

async function nhl() {
  const cfg = MARKETS.nhl, raw = await oddsProps(cfg);
  if (!raw.length) return [];
  const st = await getJson(`${NHLAPI}/standings/now`);
  const teams = st.standings.map((t) => ({ abbr: t.teamAbbrev.default, common: t.teamCommonName.default }));
  const abbr = (full) => teams.find((t) => full.endsWith(t.common))?.abbr;
  const need = new Set(); raw.forEach((r) => [r.event.home_team, r.event.away_team].forEach((t) => need.add(abbr(t)))); need.delete(undefined);
  const rosters = {};
  await pool([...need], 6, async (a) => { const d = await getJson(`${NHLAPI}/roster/${a}/current`); rosters[a] = new Map([...d.forwards, ...d.defensemen].map((p) => [norm(`${p.firstName.default} ${p.lastName.default}`), p.id])); });
  const injMap = await injuries(cfg.espn);
  const now = new Date(), y = now.getFullYear(), s = now.getMonth() >= 8 ? y : y - 1, seasons = [`${s}${s + 1}`, `${s - 1}${s}`];
  const cache = new Map();
  const logs = (id) => { if (!cache.has(id)) cache.set(id, (async () => { let all = []; for (const se of seasons) { try { all = all.concat((await getJson(`${NHLAPI}/player/${id}/game-log/${se}/2`)).gameLog || []); } catch {} if (all.length >= 20) break; } return all.sort((a, b) => b.gameDate.localeCompare(a.gameDate)); })()); return cache.get(id); };
  const res = await pool(raw, 8, async (r) => {
    const e = r.event, h = abbr(e.home_team), a = abbr(e.away_team), n = norm(r.player);
    const side = rosters[h]?.has(n) ? 'home' : rosters[a]?.has(n) ? 'away' : null;
    if (!side) return null;
    const stat = cfg.list[r.mkey][1];
    const g = (await logs(rosters[side === 'home' ? h : a].get(n))).slice(0, 20).map((x) => ({ v: x[stat] ?? 0, opp: x.opponentAbbrev, home: x.homeRoadFlag === 'H', date: md(x.gameDate) }));
    if (g.length < 5) return null;
    return side === 'home' ? assemble('nhl', r, g, h, a, true, injMap, e.home_team, e.away_team) : assemble('nhl', r, g, a, h, false, injMap, e.away_team, e.home_team);
  });
  return res.filter(Boolean);
}

async function nfl(errors) {
  const cfg = MARKETS.nfl, raw = await oddsProps(cfg);
  if (!raw.length) return [];
  const now = new Date(), y = now.getFullYear(), s = now.getMonth() >= 8 ? y : y - 1, rows = [];
  for (const yr of [s, s - 1]) {
    let ok = false;
    for (const u of [`stats_player/stats_player_week_${yr}.csv`, `player_stats/player_stats_${yr}.csv`]) {
      try { rows.push(...csv(await getText(`https://github.com/nflverse/nflverse-data/releases/download/${u}`))); ok = true; break; } catch {}
    }
    if (!ok) errors.push(`nfl: could not load ${yr} player stats`);
  }
  const sched = {};
  try { for (const g of csv(await getText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'))) { sched[`${g.season}|${g.week}|${g.home_team}`] = { home: true, date: g.gameday }; sched[`${g.season}|${g.week}|${g.away_team}`] = { home: false, date: g.gameday }; } }
  catch { errors.push('nfl: schedule file unavailable, home/away splits disabled'); }
  const by = new Map();
  for (const r of rows) { if (r.season_type && r.season_type !== 'REG') continue; const k = norm(r.player_display_name); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  for (const v of by.values()) v.sort((a, b) => b.season - a.season || b.week - a.week);
  const injMap = await injuries(cfg.espn);
  return raw.map((r) => {
    const e = r.event, h = ab(NFL[e.home_team]), a = ab(NFL[e.away_team]), list = by.get(norm(r.player));
    if (!list || !h || !a) return null;
    const t = ab(list[0].team || list[0].recent_team), stat = cfg.list[r.mkey][1];
    if (t !== h && t !== a) return null;
    const g = list.slice(0, 20).map((x) => { const i = sched[`${x.season}|${x.week}|${x.team || x.recent_team}`]; return { v: +x[stat] || 0, opp: x.opponent_team, home: i ? i.home : null, date: i ? md(i.date) : `W${x.week}` }; });
    if (g.length < 5) return null;
    const home = t === h;
    return assemble('nfl', r, g, t, home ? a : h, home, injMap, home ? e.home_team : e.away_team, home ? e.away_team : e.home_team);
  }).filter(Boolean);
}

export async function build() {
  const out = { updated: new Date().toISOString(), props: [], errors: [] };
  for (const [sport, fn] of [['nhl', nhl], ['nfl', nfl]]) {
    try { out.props.push(...(await fn(out.errors))); } catch (e) { out.errors.push(`${sport}: ${e.message}`); }
  }
  return out;
}
