const fs=require('fs');let s=fs.readFileSync('scripts/tune-sim.cjs','utf8');
s=s.replace("const CHARGE_PER_KILL = 10","const CHARGE_PER_KILL = 8");
fs.writeFileSync('scripts/tune-sim.cjs',s);console.log('ok');
