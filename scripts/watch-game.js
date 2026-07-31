const fs = require('fs');
const path = require('path');
const { TEAM_ID, getAbbr, sendPush, fetchTodayGame } = require('./lib');

const SWING_THRESHOLD = 20;
const STATE_FILE = path.join(__dirname, 'state.json');

function loadState(){
  try{
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }catch{
    return {};
  }
}
function saveState(state){
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function setContinue(shouldContinue){
  if(process.env.GITHUB_OUTPUT){
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `continue=${shouldContinue}\n`);
  }
}

function isFinalStatus(status){
  return status.includes('Final') || status === 'Game Over' || status === 'Completed Early';
}

const RE_MATRIX = {
  '000-0': 0.481, '000-1': 0.254, '000-2': 0.098,
  '100-0': 0.859, '100-1': 0.509, '100-2': 0.224,
  '010-0': 1.100, '010-1': 0.664, '010-2': 0.319,
  '110-0': 1.473, '110-1': 0.908, '110-2': 0.429,
  '001-0': 1.350, '001-1': 0.971, '001-2': 0.385,
  '101-0': 1.784, '101-1': 1.130, '101-2': 0.478,
  '011-0': 1.962, '011-1': 1.376, '011-2': 0.580,
  '111-0': 2.282, '111-1': 1.520, '111-2': 0.752,
};
function calcWinProbability(piratesScore, oppScore, inning, halfInning, isPiratesHome, onFirst, onSecond, onThird, outs){
  const scoreDiff = piratesScore - oppScore;
  if(inning >= 10){
    const isLastAtBat = isPiratesHome && halfInning === 'Bottom';
    if(isLastAtBat){
      if(scoreDiff > 0) return 97;
      if(scoreDiff === 0) return 50;
      if(scoreDiff === -1) return 28;
      if(scoreDiff === -2) return 12;
      return 4;
    }
    if(scoreDiff > 0) return 72;
    if(scoreDiff === 0) return 50;
    if(scoreDiff === -1) return 30;
    return 12;
  }
  const inningNum = Math.min(inning, 9);
  const isLastAtBat = isPiratesHome && halfInning === 'Bottom' && inningNum >= 9;
  if(isLastAtBat){
    if(scoreDiff > 0) return 97;
    if(scoreDiff === 0) return 50;
    if(scoreDiff === -1) return 22;
    if(scoreDiff === -2) return 10;
    if(scoreDiff === -3) return 4;
    return 3;
  }
  let halfRemaining = halfInning === 'Top' ? (9 - inningNum) * 2 + 1 : (9 - inningNum) * 2;
  halfRemaining = Math.max(halfRemaining, 0);
  const key = `${onFirst ? 1 : 0}${onSecond ? 1 : 0}${onThird ? 1 : 0}-${Math.min(outs, 2)}`;
  const currentRE = RE_MATRIX[key] ?? 0.25;
  const futureRE = halfRemaining * 0.481;
  const totalRE = currentRE + futureRE;
  const piratesBatting = (isPiratesHome && halfInning === 'Bottom') || (!isPiratesHome && halfInning === 'Top');
  let adj = scoreDiff;
  if(piratesBatting) adj += currentRE * 0.3; else adj -= currentRE * 0.3;
  let prob = 1 / (1 + Math.exp(-(adj / Math.max(totalRE, 0.5)) * 2.8));
  prob = Math.max(0.02, Math.min(0.98, prob));
  return Math.round(prob * 100);
}

async function fetchLiveFeed(gamePk){
  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.liveData?.linescore ?? null;
}
async function fetchEspnEventId(dateStr){
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
  const res = await fetch(url);
  const data = await res.json();
  for(const ev of data.events ?? []){
    const competitors = ev.competitions?.[0]?.competitors ?? [];
    if(competitors.some(c => c.team?.abbreviation === 'PIT')) return ev.id;
  }
  return null;
}
async function fetchEspnWinProb(eventId){
  const base = `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/${eventId}/competitions/${eventId}/probabilities`;
  const countRes = await fetch(`${base}?limit=1`);
  const countData = await countRes.json();
  const count = countData.count ?? 0;
  if(count === 0) return null;
  const lastRes = await fetch(`${base}?limit=1&page=${count}`);
  const lastData = await lastRes.json();
  return lastData.items?.[0]?.homeWinPercentage ?? null;
}

async function main(){
  if(process.env.TEST_MESSAGE){
    await sendPush({ title: process.env.TEST_TITLE || 'The Hoist-O-Meter', body: process.env.TEST_MESSAGE });
    console.log('Test notification sent.');
    setContinue(false);
    return;
  }

  const todayGame = await fetchTodayGame();
  if(!todayGame){
    console.log('No game today.');
    setContinue(false);
    return;
  }

  const status = todayGame.status.detailedState;
  const piratesHome = todayGame.teams.home.team.id === TEAM_ID;
  const pitScore = piratesHome ? (todayGame.teams.home.score ?? 0) : (todayGame.teams.away.score ?? 0);
  const oppScore = piratesHome ? (todayGame.teams.away.score ?? 0) : (todayGame.teams.home.score ?? 0);
  const oppAbbr = getAbbr(piratesHome ? todayGame.teams.away : todayGame.teams.home);

  const isLive = status === 'In Progress' || status === 'Warmup' || status === 'Manager Challenge' || status === 'Delayed';
  const isFinal = isFinalStatus(status);

  const stored = loadState();
  const prev = stored.gamePk === todayGame.gamePk ? stored : null;

  if(isFinal){
    if(!prev?.finalNotified){
      const piratesWon = pitScore > oppScore;
      const scoreLine = `PIT ${pitScore} - ${oppAbbr} ${oppScore}`;
      const text = piratesWon
        ? `\u{1F386} HOIST THE CONE \u{1F386}\nPirates win: ${scoreLine}`
        : `Pirates fall: ${scoreLine}`;
      await sendPush({ title: 'Final', body: text });
      saveState({ ...prev, gamePk: todayGame.gamePk, finalNotified: true });
    }
    console.log('Game final, nothing more to watch.');
    setContinue(false);
    return;
  }

  if(!isLive){
    console.log('Game not live yet.');
    setContinue(true);
    return;
  }

  const liveLS = await fetchLiveFeed(todayGame.gamePk);
  const inning = liveLS?.currentInning ?? 1;
  const half = liveLS?.inningHalf ?? 'Top';
  const onFirst = !!(liveLS?.offense?.first);
  const onSecond = !!(liveLS?.offense?.second);
  const onThird = !!(liveLS?.offense?.third);
  const outs = liveLS?.outs ?? 0;

  let winProb = null;
  try{
    const etDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const eventId = await fetchEspnEventId(etDateStr);
    if(eventId){
      const homeWinPct = await fetchEspnWinProb(eventId);
      if(homeWinPct != null){
        const piratesPct = piratesHome ? homeWinPct : (1 - homeWinPct);
        winProb = Math.round(piratesPct * 100);
      }
    }
  }catch{}
  if(winProb === null){
    winProb = calcWinProbability(pitScore, oppScore, inning, half, piratesHome, onFirst, onSecond, onThird, outs);
  }

  const gameStarted = !prev?.started;
  const scoreChanged = !!prev && (prev.pitScore !== pitScore || prev.oppScore !== oppScore);
  const lastNotifiedWinProb = prev?.lastNotifiedWinProb ?? winProb;
  const swung = Math.abs(winProb - lastNotifiedWinProb) >= SWING_THRESHOLD;

  if(gameStarted){
    await sendPush({ title: 'Game Start ⚾', body: `PIT vs ${oppAbbr}` });
  }

  if(scoreChanged){
    const text = `PIT ${pitScore} - ${oppAbbr} ${oppScore} (${half} ${inning}) · Win probability: ${winProb}%`;
    await sendPush({ title: 'Score Update', body: text });
  }

  if(swung){
    const trendEmoji = winProb > lastNotifiedWinProb ? '\u{1F4C8}' : '\u{1F4C9}';
    const text = `Now ${winProb}% · PIT ${pitScore} - ${oppAbbr} ${oppScore}`;
    await sendPush({ title: `Win Probability Swing ${trendEmoji}`, body: text });
  }

  saveState({
    gamePk: todayGame.gamePk,
    started: true,
    pitScore, oppScore, winProb,
    lastNotifiedWinProb: swung ? winProb : lastNotifiedWinProb,
    finalNotified: false,
  });

  console.log(`Checked: ${half} ${inning}, PIT ${pitScore}-${oppScore}, win% ${winProb}, gameStarted=${gameStarted}, scoreChanged=${scoreChanged}, swung=${swung}`);
  setContinue(true);
}

main().catch((err) => {
  console.error(err);
  setContinue(true);
});
