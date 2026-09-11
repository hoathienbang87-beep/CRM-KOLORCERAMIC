function core(row){
  return [row.name_normalized,row.width_cm,row.height_cm,row.price_per_m2,row.price_per_box,row.price_per_piece,row.pieces_per_box,row.sqm_per_box].map(value=>value??null);
}

export function detectDuplicates(rows){
  const byCode=new Map();
  for(const row of rows){if(!row.code_normalized) continue;const group=byCode.get(row.code_normalized)||[];group.push(row);byCode.set(row.code_normalized,group);}
  const duplicates=[];
  for(const [normalizedCode,members] of byCode){
    if(members.length<2) continue;
    const first=JSON.stringify(core(members[0]));
    const kind=members.every(row=>JSON.stringify(core(row))===first)?"IDENTICAL":"CONFLICTING";
    const id=`DUPLICATE-${duplicates.length+1}`;
    for(const row of members){row.duplicate_group_id=id;row.duplicate_kind=kind;row.classification="DUPLICATE_IN_FILE";row.warnings.push({code:"DUPLICATE_CODE",page:row.source_page,stt:row.stt,field:"code",message:"Mã chuẩn hóa xuất hiện nhiều hơn một lần trong file."});}
    duplicates.push({id,normalized_code:normalizedCode,kind,stt:members.map(row=>row.stt),pages:[...new Set(members.map(row=>row.source_page))],rows:members.map(row=>row.source_row_number)});
  }
  return duplicates;
}
