const B=[51.36,71.52,167.04,311.16,356.88,404.16,453.60,503.04,552.48];
const item=(page,text,x,y,width=20,height=7)=>({page,text,x,y,width,height});

function header(page,items){
  if(page===1){
    "BẢNG GIÁ NIÊM YẾT GẠCH INDONESIA".split(" ").forEach((text,index)=>items.push(item(page,text,80+index*30,18)));
    "CÔNG TY TNHH SẢN XUẤT VÀ XUẤT NHẬP KHẨU ISTONE".split(" ").forEach((text,index)=>items.push(item(page,text,40+index*27,32)));
  }else items.push(item(page,"03.09.2099",430,25));
  [["STT",B[0]+4],["MÃ",B[1]+3],["HÀNG",B[1]+22],["TÊN",B[2]+3],["HÀNG",B[2]+22],["QUY",B[3]+2],["CÁCH",B[3]+20],["ĐÓNG",B[4]+2],["GÓI",B[4]+24],["ĐƠN",B[5]+2],["GIÁ",B[5]+22]].forEach(([text,x])=>items.push(item(page,text,x,50)));
  items.push(item(page,"(cm)",B[3]+12,62),item(page,"(Viên/Hộp)",B[4]+3,62),item(page,"Vnđ/m2",B[5]+4,62));
}

function addRows(items,page,rows){
  rows.forEach((row,index)=>{
    const y=90+index*14;
    items.push(item(page,String(row.stt),B[0]+5,y),item(page,row.code,B[1]+3,y),item(page,row.name,B[2]+3,y));
  });
}

function addGroup(items,page,rows,first,last,values){
  const start=rows.findIndex(row=>row.stt===first),end=rows.findIndex(row=>row.stt===last);
  const y=(90+start*14+90+end*14)/2;
  items.push(item(page,values.size,B[3]+4,y),item(page,values.packaging,B[4]+4,y),item(page,values.m2,B[5]+4,y),item(page,values.box,B[6]+4,y),item(page,values.piece,B[7]+4,y));
}

export function createSyntheticIstoneGeometry(){
  const items=[];
  const page1=[
    {stt:2,code:"SYN-A",name:"CERAMIC MATT A"},
    {stt:3,code:"SYN-DUP",name:"SERIES GLOSSY A, B"},
    {stt:4,code:" syn-dup ",name:"SERIES GLOSSY A,B"},
    {stt:5,code:"SYN-MM",name:"SMALL SATIN"}
  ];
  const page2=[{stt:6,code:"SYN-P2",name:"PAGE TWO"}];
  header(1,items);header(2,items);addRows(items,1,page1);addRows(items,2,page2);
  addGroup(items,1,page1,2,4,{size:"30x60",packaging:"2v = 0,36m2",m2:"100.000",box:"36.000",piece:"18.000"});
  addGroup(items,1,page1,5,5,{size:"75x300 mm",packaging:"4v = 0,09m2",m2:"200.000",box:"18.000",piece:"4.500"});
  addGroup(items,2,page2,6,6,{size:"600 × 1200mm",packaging:"2v = 1,44m2",m2:"300.000",box:"432.000",piece:"216.000"});
  return {pages:[{page:1,width_pt:"612",height_pt:"792"},{page:2,width_pt:"612",height_pt:"792"}],items};
}

export function createUnknownGeometry(){return {pages:[{page:1}],items:[item(1,"NOT",10,10),item(1,"A",30,10),item(1,"PRICE",50,10),item(1,"LIST",80,10)]};}

export function createPageResetFailureGeometry(){
  const geometry=createSyntheticIstoneGeometry();
  geometry.items=geometry.items.filter(entry=>!(entry.page===2&&entry.x>=B[3]&&entry.y>70));
  return geometry;
}

export function createWrappedNameAmbiguityGeometry(){
  const geometry=createSyntheticIstoneGeometry();
  geometry.items.push(item(1,"AMBIGUOUS-WRAP",B[2]+5,97));
  return geometry;
}
