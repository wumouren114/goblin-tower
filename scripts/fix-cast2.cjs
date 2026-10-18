const fs=require('fs');let s=fs.readFileSync('src/game.ts','utf8');
s=s.replace('private cardIcon(stat: CardStat): string','private cardIcon(stat: string): string');
fs.writeFileSync('src/game.ts',s);console.log('ok');
