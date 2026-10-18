const fs=require('fs');let s=fs.readFileSync('src/game.ts','utf8');
s=s.replace('this.combat?.resetLayer(0.5)','this.combat?.resetLayer(CHARGE_FLOOR_START_RATIO)');
fs.writeFileSync('src/game.ts',s);console.log(s.includes('resetLayer(CHARGE_FLOOR_START_RATIO)')?'ok':'miss');
