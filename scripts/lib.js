const webpush = require('web-push');

const TEAM_ID = 134;

const teamAbbrMap = {
  134: 'PIT', 113: 'CIN', 112: 'CHC', 158: 'MIL', 138: 'STL',
  137: 'SF', 119: 'LAD', 121: 'NYM', 143: 'PHI', 144: 'ATL',
  146: 'MIA', 120: 'WSH', 109: 'ARI', 115: 'COL', 135: 'SD',
  108: 'LAA', 117: 'HOU', 133: 'OAK', 136: 'SEA', 140: 'TEX',
  116: 'DET', 118: 'KC', 142: 'MIN', 145: 'CWS', 114: 'CLE',
  110: 'BAL', 111: 'BOS', 147: 'NYY', 139: 'TB', 141: 'TOR',
};
function getAbbr(teamData){
  return teamData.team?.abbreviation
    || teamAbbrMap[teamData.team?.id]
    || (teamData.team?.name ?? '???').substring(0, 3).toUpperCase();
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@hoist-o-meter.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPush(payload){
  const { PUSH_SUBSCRIPTION } = process.env;
  if(!PUSH_SUBSCRIPTION){
    console.log('No PUSH_SUBSCRIPTION configured, skipping send:', payload.body);
    return;
  }
  let subs;
  try{
    const parsed = JSON.parse(PUSH_SUBSCRIPTION);
    subs = Array.isArray(parsed) ? parsed : [parsed];
  }catch{
    console.error('PUSH_SUBSCRIPTION secret is not valid JSON');
    return;
  }

  for(const sub of subs){
    try{
      await webpush.sendNotification(sub, JSON.stringify(payload));
    }catch(err){
      if(err.statusCode === 404 || err.statusCode === 410){
        console.error(`Subscription expired (endpoint: ${sub.endpoint}) - remove it from PUSH_SUBSCRIPTION or have that person re-subscribe.`);
      }else{
        console.error('Push failed for', sub.endpoint, err.statusCode, err.body);
      }
    }
  }
}

async function fetchTodayGame(){
  const etDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${TEAM_ID}&date=${etDate}&hydrate=linescore,team,venue`;
  const res = await fetch(url);
  const data = await res.json();
  if(!data.dates || data.dates.length === 0) return null;
  return data.dates[0].games[0];
}

module.exports = { TEAM_ID, getAbbr, sendPush, fetchTodayGame };
