const fs=require('fs');let s=fs.readFileSync('src/main.ts','utf8');
s=s.replace("    if (params.get('pickbonus') === '1') game.debugPickFirstBonus()\n    if (params.get('autoattack') === '1') game.debugAutoAttack(true)","    if (params.get('autoattack') === '1') game.debugAutoAttack(true)");
s=s.replace("    if (warmup > 0) game.debugAdvance(warmup)","    if (warmup > 0) game.debugAdvance(warmup)\n    if (params.get('pickbonus') === '1') game.debugPickFirstBonus()");
fs.writeFileSync('src/main.ts',s);console.log('ok');
