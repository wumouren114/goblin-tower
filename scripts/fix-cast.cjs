const fs=require('fs');let s=fs.readFileSync('src/game.ts','utf8');
s=s.replace('const item = makeCardItem(card.stat, 1)','const item = makeCardItem(card.stat as CardStat, 1)');
fs.writeFileSync('src/game.ts',s);console.log('ok');
