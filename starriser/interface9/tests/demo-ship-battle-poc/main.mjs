import {createEngine} from './engine.mjs';
const canvas=document.querySelector('canvas'),status=document.querySelector('#status');
if(new URLSearchParams(location.search).get('test')==='1') {
  const [{createHarness},{validate}]=await Promise.all([import('../common/harness.mjs'),import('./validate.mjs')]);
  createHarness({name:'demo-ship-battle-poc',run:ctx=>validate(ctx,canvas)});
}else{
  const destination=new URL('../demo-ship-flight-poc/',location.href);
  destination.searchParams.set('scenario','2');
  const count=new URLSearchParams(location.search).get('count');
  if(count)destination.searchParams.set('count',count);
  location.replace(destination);
}
