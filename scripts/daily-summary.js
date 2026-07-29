const { TEAM_ID, getAbbr, sendPush, fetchTodayGame } = require('./lib');

async function main(){
  if(process.env.TEST_MESSAGE){
    await sendPush({ title: process.env.TEST_TITLE || "Today's Game", body: process.env.TEST_MESSAGE });
    console.log('Test notification sent.');
    return;
  }

  const todayGame = await fetchTodayGame();

  if(!todayGame){
    await sendPush({ title: 'No Game Today', body: 'The Pirates are off today.' });
    console.log('No game today - sent off-day notification.');
    return;
  }

  const piratesHome = todayGame.teams.home.team.id === TEAM_ID;
  const oppTeam = piratesHome ? todayGame.teams.away : todayGame.teams.home;
  const oppAbbr = getAbbr(oppTeam);
  const vsAt = piratesHome ? 'vs' : '@';
  const venueName = todayGame.venue?.name ?? 'TBD';
  const timeStr = new Date(todayGame.gameDate).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
  });

  const body = `PIT ${vsAt} ${oppAbbr}\n${timeStr} ET · ${venueName}`;
  await sendPush({ title: "Today's Game ⚾", body });
  console.log(`Sent daily summary: ${body.replace('\n', ' | ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
