import {parseDimensions,parsePackaging,parseVnd} from "./field-parsers.js";

const number=value=>Number(value);
const byPosition=(a,b)=>number(a.y)-number(b.y)||number(a.x)-number(b.x);
const inside=(item,left,right,tolerance=0)=>number(item.x)>=left-tolerance&&number(item.x)<right+tolerance;

export function clusterByY(items,tolerance=2.5){
  const clusters=[];
  for(const item of [...items].sort(byPosition)){
    let cluster=clusters.find(entry=>Math.abs(entry.y-number(item.y))<=tolerance);
    if(!cluster){cluster={y:number(item.y),items:[]};clusters.push(cluster);}
    cluster.items.push(item);
    cluster.y=cluster.items.reduce((sum,current)=>sum+number(current.y),0)/cluster.items.length;
  }
  return clusters.map(cluster=>({...cluster,text:cluster.items.sort((a,b)=>number(a.x)-number(b.x)).map(item=>String(item.text).trim()).filter(Boolean).join(" ")}));
}

export function extractRowAnchors(items,config){
  const [left,right]=config.columnBoundaries;
  return items.filter(item=>inside(item,left,right,config.columnTolerance)&&/^\d{1,4}$/.test(String(item.text).trim()))
    .map(item=>({page:item.page,stt:Number(item.text),y:number(item.y)})).sort((a,b)=>a.page-b.page||a.y-b.y);
}

export function extractRowText(items,row,left,right,config){
  return items.filter(item=>item.page===row.page&&inside(item,left,right,0)&&Math.abs(number(item.y)-row.y)<=config.rowYTolerance)
    .sort((a,b)=>number(a.x)-number(b.x)).map(item=>String(item.text).trim()).filter(Boolean).join(" ");
}

export function findUnanchoredRowText(pageItems,pageRows,config){
  if(!pageRows.length) return [];
  const b=config.columnBoundaries,minY=pageRows[0].y-config.rowYTolerance,maxY=pageRows.at(-1).y+config.rowYTolerance;
  return pageItems.filter(item=>number(item.y)>=minY&&number(item.y)<=maxY&&(inside(item,b[1],b[2],0)||inside(item,b[2],b[3],0))&&!pageRows.some(row=>Math.abs(number(item.y)-row.y)<=config.rowYTolerance));
}

function columnClusters(pageItems,left,right,config){
  return clusterByY(pageItems.filter(item=>inside(item,left,right,0)),config.bandYTolerance);
}

function nearestCluster(clusters,y,tolerance){
  const candidates=clusters.map(cluster=>({cluster,distance:Math.abs(cluster.y-y)})).filter(entry=>entry.distance<=tolerance).sort((a,b)=>a.distance-b.distance);
  if(candidates.length>1&&Math.abs(candidates[0].distance-candidates[1].distance)<0.1) return null;
  return candidates[0]?.cluster||null;
}

export function extractExplicitGroups(pageItems,pageRows,config){
  const b=config.columnBoundaries;
  const sizes=columnClusters(pageItems,b[3],b[4],config).map(cluster=>({...cluster,parsed:parseDimensions(cluster.text,{defaultUnit:config.sizeUnit})})).filter(cluster=>cluster.parsed.ok);
  const packages=columnClusters(pageItems,b[4],b[5],config);
  const priceM2=columnClusters(pageItems,b[5],b[6],config);
  const priceBox=columnClusters(pageItems,b[6],b[7],config);
  const pricePiece=columnClusters(pageItems,b[7],b[8],config);
  return sizes.map(size=>{
    const packaging=nearestCluster(packages,size.y,config.bandYTolerance);
    const m2=nearestCluster(priceM2,size.y,config.bandYTolerance);
    const box=nearestCluster(priceBox,size.y,config.bandYTolerance);
    const piece=nearestCluster(pricePiece,size.y,config.bandYTolerance);
    const packageParsed=parsePackaging(packaging?.text);
    return {page:pageRows[0]?.page,y:size.y,...size.parsed,
      source_packaging_text:packageParsed.ok?packageParsed.source_packaging_text:(packaging?.text||null),
      pieces_per_box:packageParsed.ok?packageParsed.pieces_per_box:null,
      sqm_per_box:packageParsed.ok?packageParsed.sqm_per_box:null,
      price_per_m2:parseVnd(m2?.text),price_per_box:parseVnd(box?.text),price_per_piece:parseVnd(piece?.text),
      parse_errors:[!packageParsed.ok&&"INVALID_PACKAGING",!parseVnd(m2?.text)&&"INVALID_PRICE_M2",!parseVnd(box?.text)&&"INVALID_PRICE_BOX",!parseVnd(piece?.text)&&"INVALID_PRICE_PIECE"].filter(Boolean)
    };
  }).sort((a,b)=>a.y-b.y);
}

export function assignGroupRanges(rows,groups,config){
  if(!rows.length||!groups.length) return {ok:false,code:"ROW_AMBIGUOUS",groups:[]};
  let start=0;
  const ranged=[];
  for(let index=0;index<groups.length;index++){
    const group=groups[index],remaining=groups.length-index-1,maxEnd=rows.length-remaining-1;
    let best=null;
    for(let end=start;end<=maxEnd;end++){
      const center=(rows[start].y+rows[end].y)/2;
      const error=Math.abs(center-group.y);
      if(!best||error<best.error) best={end,error};
    }
    if(!best||best.error>config.groupCenterTolerance) return {ok:false,code:"ROW_AMBIGUOUS",page:rows[0].page,groups:[]};
    ranged.push({...group,first_stt:rows[start].stt,last_stt:rows[best.end].stt,row_count:best.end-start+1,visually_merged:best.end>start});
    start=best.end+1;
  }
  if(start!==rows.length) return {ok:false,code:"ROW_AMBIGUOUS",page:rows[0].page,groups:[]};
  return {ok:true,groups:ranged};
}
