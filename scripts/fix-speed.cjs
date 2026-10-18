const fs=require('fs');let s=fs.readFileSync('src/data/characters.ts','utf8');
s=s.replace('projectileSpeed: 18','projectileSpeed: 22').replace('projectileSpeed: 13','projectileSpeed: 17');
fs.writeFileSync('src/data/characters.ts',s);console.log('ok');
