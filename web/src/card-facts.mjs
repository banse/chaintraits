// Renderer display limits are not limits on Registry credentials.
export function communityDisplay(ids, families) {
  const accepted=[...new Set(ids.filter(id=>Number.isInteger(id)&&id>=10001&&id<=65535))];
  return {
    count:accepted.length,
    metadataCount:Math.min(32,accepted.length),
    ringCount:Math.min(39,accepted.length),
    frameCount:Math.max(0,accepted.length-39),
    positions:accepted.map((id,index)=>({id,family:index<39?families[index%13]:null,ring:index<39?Math.floor(index/13)+1:null})),
  };
}
