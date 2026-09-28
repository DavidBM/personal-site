/** CPU broadphase over moving body spheres. Exact clearance stays in the selector. */
const LEAF_SIZE=8;
function allocate(count) {
  const leaves=2**Math.ceil(Math.log2(Math.max(1,Math.ceil(count/LEAF_SIZE)))),nodes=leaves*2-1;
  return {order:Uint32Array.from({length:count},(_,i)=>i),bounds:new Float64Array(nodes*6),
    left:new Int32Array(nodes).fill(-1),right:new Int32Array(nodes).fill(-1),
    begin:new Uint32Array(nodes),end:new Uint32Array(nodes),stack:new Int32Array(nodes),stackDistance:new Float64Array(nodes),nodes:0};
}
function leafBounds(tree,node,bodies) {
  const at=node*6,b=tree.bounds;
  b.fill(Infinity,at,at+3);b.fill(-Infinity,at+3,at+6);
  for(let i=tree.begin[node];i<tree.end[node];i++) {
    const body=bodies[tree.order[i]],r=Math.max(0,body.radius);
    for(let axis=0;axis<3;axis++) {
      b[at+axis]=Math.min(b[at+axis],body.p[axis]-r);
      b[at+axis+3]=Math.max(b[at+axis+3],body.p[axis]+r);
    }
  }
}
function mergeBounds(tree,node) {
  const at=node*6,a=tree.left[node]*6,c=tree.right[node]*6,b=tree.bounds;
  for(let axis=0;axis<3;axis++) {
    b[at+axis]=Math.min(b[a+axis],b[c+axis]);b[at+axis+3]=Math.max(b[a+axis+3],b[c+axis+3]);
  }
}
function splitNode(tree,begin,end,bodies) {
  const node=tree.nodes++;tree.begin[node]=begin;tree.end[node]=end;leafBounds(tree,node,bodies);
  if(end-begin<=LEAF_SIZE)return node;
  const at=node*6,b=tree.bounds;let axis=0;
  for(let d=1;d<3;d++)if(b[at+d+3]-b[at+d]>b[at+axis+3]-b[at+axis])axis=d;
  tree.order.subarray(begin,end).sort((a,c)=>bodies[a].p[axis]-bodies[c].p[axis]||a-c);
  const mid=(begin+end)>>>1;
  tree.left[node]=splitNode(tree,begin,mid,bodies);tree.right[node]=splitNode(tree,mid,end,bodies);return node;
}
function surfaceCost(tree) {
  let cost=0;
  for(let n=0;n<tree.nodes;n++) {
    if(tree.left[n]<0)continue;
    const at=n*6,b=tree.bounds,x=b[at+3]-b[at],y=b[at+4]-b[at+1],z=b[at+5]-b[at+2];cost+=x*y+y*z+z*x;
  }
  return cost;
}
function distanceSquared(bounds,at,point) {
  let sum=0;
  for(let d=0;d<3;d++){const delta=Math.max(bounds[at+d]-point[d],0,point[d]-bounds[at+d+3]);sum+=delta*delta;}
  return sum;
}
function pushChildren(tree,n,point,length) {
  const a=tree.left[n],b=tree.right[n],da=distanceSquared(tree.bounds,a*6,point),db=distanceSquared(tree.bounds,b*6,point);
  const near=da<=db?a:b,far=da<=db?b:a;
  tree.stack[length]=far;tree.stackDistance[length++]=Math.max(da,db);
  tree.stack[length]=near;tree.stackDistance[length++]=Math.min(da,db);return length;
}
function visitTree(tree,point,queryRadius,visit,stats) {
  let length=1;tree.stack[0]=0;tree.stackDistance[0]=distanceSquared(tree.bounds,0,point);
  while(length) {
    const n=tree.stack[--length],radius=Math.max(0,queryRadius());stats.nodeTests++;
    // Top-four distance tightens during near-first traversal. Negative clearance
    // still visits every sphere box containing the point; their lower bound is 0.
    const limit=radius*radius+1e-10*Math.max(1,radius*radius);
    if(tree.stackDistance[length]>limit)continue;
    if(tree.left[n]>=0)length=pushChildren(tree,n,point,length);
    else for(let i=tree.begin[n];i<tree.end[n];i++)visit(tree.order[i]);
  }
}
export function createNearbyBodyIndex() {
  let tree=null,bodies=[],builtCost=0,age=0;const stats={rebuilds:0,nodeTests:0};
  function rebuild() {
    tree=allocate(bodies.length);if(bodies.length)splitNode(tree,0,bodies.length,bodies);
    builtCost=surfaceCost(tree);age=0;stats.rebuilds++;
  }
  function update(next) {
    bodies=next;stats.nodeTests=0;
    if(!tree||tree.order.length!==bodies.length){rebuild();return;}
    for(let n=tree.nodes-1;n>=0;n--){if(tree.left[n]<0)leafBounds(tree,n,bodies);else mergeBounds(tree,n);}
    age++;
    // Refit remains correct after arbitrary movement; rebuild only restores pruning.
    if(age>=32&&surfaceCost(tree)>Math.max(1,builtCost)*2)rebuild();
  }
  function query(point,queryRadius,visit) {
    if(bodies.length)visitTree(tree,point,queryRadius,visit,stats);
  }
  return {update,query,stats};
}
