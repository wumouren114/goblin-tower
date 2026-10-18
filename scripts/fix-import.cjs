const fs=require('fs');let s=fs.readFileSync('src/game.ts','utf8');
s=s.replace('  bossHpFor,\n} from \'./data/balance\'','  bossHpFor,\n  BALANCE,\n} from \'./data/balance\'');
fs.writeFileSync('src/game.ts',s);console.log(s.includes('  BALANCE,')?'ok':'miss');
