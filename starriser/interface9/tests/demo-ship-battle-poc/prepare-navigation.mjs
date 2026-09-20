import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const index=process.argv.indexOf('--dist-dir');
if(index<0||!process.argv[index+1])throw new Error('Usage: prepare-navigation.mjs --dist-dir OWNED_BUILD');
const output=path.resolve(process.argv[index+1]),marker=JSON.parse(fs.readFileSync(path.join(output,'.galaxy-build.json'),'utf8'));
if(marker.repository!==root||!marker.generated)throw new Error('Navigation vectors require an owned build');
fs.mkdirSync(path.join(output,'test-fixtures'),{recursive:true});
for(const name of ['ephemeris','navigation']) {
  const bytes=execFileSync('cargo',['run','--locked','-q','-p','galaxy-game-core','--example',`${name}-vectors`],{cwd:root,env:{...process.env,CARGO_TARGET_DIR:process.env.CARGO_TARGET_DIR??path.join(root,'target')},maxBuffer:1024*1024});
  fs.writeFileSync(path.join(output,'test-fixtures',`${name}.json`),bytes);
}
console.log('Prepared native planetary and local-route vectors');
