const VERSION = 5;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS = 26;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let value = 1;
for (let index=0; index<255; index++) {
  EXP[index]=value; LOG[value]=index;
  value<<=1;
  if (value & 0x100) value^=0x11d;
}
for (let index=255; index<512; index++) EXP[index]=EXP[index-255];

function multiply(a,b){return a&&b?EXP[LOG[a]+LOG[b]]:0;}
function polyMultiply(left,right){
  const result=new Uint8Array(left.length+right.length-1);
  for(let i=0;i<left.length;i++)for(let j=0;j<right.length;j++)result[i+j]^=multiply(left[i],right[j]);
  return [...result];
}
function errorCorrection(data){
  let generator=[1];
  for(let index=0;index<EC_CODEWORDS;index++)generator=polyMultiply(generator,[1,EXP[index]]);
  const message=[...data,...new Array(EC_CODEWORDS).fill(0)];
  for(let index=0;index<data.length;index++){
    const factor=message[index];
    if(!factor)continue;
    for(let offset=0;offset<generator.length;offset++)message[index+offset]^=multiply(generator[offset],factor);
  }
  return message.slice(data.length);
}
function appendBits(target,input,length){for(let bit=length-1;bit>=0;bit--)target.push((input>>>bit)&1);}
function dataCodewords(text){
  const bytes=[...new TextEncoder().encode(text)];
  if(bytes.length>106)throw new Error("QR_URL_TOO_LONG");
  const bits=[];appendBits(bits,4,4);appendBits(bits,bytes.length,8);for(const byte of bytes)appendBits(bits,byte,8);
  for(let index=0;index<Math.min(4,DATA_CODEWORDS*8-bits.length);index++)bits.push(0);
  while(bits.length%8)bits.push(0);
  const result=[];
  for(let index=0;index<bits.length;index+=8)result.push(parseInt(bits.slice(index,index+8).join(""),2));
  for(let index=0;result.length<DATA_CODEWORDS;index++)result.push(index%2?0x11:0xec);
  return result;
}
function bchTypeInfo(input){
  let value=input<<10;
  const degree=number=>31-Math.clz32(number);
  while(degree(value)>=10)value^=0x537<<(degree(value)-10);
  return ((input<<10)|value)^0x5412;
}
function setFinder(matrix,row,column){
  for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){
    const y=row+r,x=column+c;if(y<0||y>=SIZE||x<0||x>=SIZE)continue;
    matrix[y][x]=(r>=0&&r<=6&&(c===0||c===6)||c>=0&&c<=6&&(r===0||r===6)||r>=2&&r<=4&&c>=2&&c<=4);
  }
}
function createMatrix(codewords){
  const matrix=Array.from({length:SIZE},()=>Array(SIZE).fill(null));
  setFinder(matrix,0,0);setFinder(matrix,SIZE-7,0);setFinder(matrix,0,SIZE-7);
  for(let index=8;index<SIZE-8;index++){
    if(matrix[index][6]===null)matrix[index][6]=index%2===0;
    if(matrix[6][index]===null)matrix[6][index]=index%2===0;
  }
  const center=30;
  if(matrix[center][center]===null)for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++)matrix[center+r][center+c]=Math.max(Math.abs(r),Math.abs(c))!==1;
  const format=bchTypeInfo(1<<3);
  for(let index=0;index<15;index++){
    const dark=((format>>index)&1)===1;
    if(index<6)matrix[index][8]=dark;else if(index<8)matrix[index+1][8]=dark;else matrix[SIZE-15+index][8]=dark;
    if(index<8)matrix[8][SIZE-index-1]=dark;else if(index===8)matrix[8][7]=dark;else matrix[8][15-index-1]=dark;
  }
  matrix[SIZE-8][8]=true;
  let row=SIZE-1,direction=-1,byteIndex=0,bitIndex=7;
  for(let column=SIZE-1;column>0;column-=2){
    if(column===6)column--;
    while(true){
      for(let offset=0;offset<2;offset++)if(matrix[row][column-offset]===null){
        let dark=byteIndex<codewords.length&&((codewords[byteIndex]>>>bitIndex)&1)===1;
        if((row+column-offset)%2===0)dark=!dark;
        matrix[row][column-offset]=dark;
        if(--bitIndex<0){byteIndex++;bitIndex=7;}
      }
      row+=direction;
      if(row<0||row>=SIZE){row-=direction;direction=-direction;break;}
    }
  }
  return matrix;
}

export function createQrSvg(text, documentRef=document){
  const data=dataCodewords(String(text));
  const matrix=createMatrix([...data,...errorCorrection(data)]);
  const namespace="http://www.w3.org/2000/svg";
  const svg=documentRef.createElementNS(namespace,"svg");
  svg.setAttribute("viewBox",`0 0 ${SIZE+8} ${SIZE+8}`);svg.setAttribute("role","img");svg.setAttribute("aria-label","Mã QR sản phẩm");svg.setAttribute("shape-rendering","crispEdges");
  const background=documentRef.createElementNS(namespace,"rect");background.setAttribute("width","100%");background.setAttribute("height","100%");background.setAttribute("fill","#fff");svg.append(background);
  let path="";
  for(let row=0;row<SIZE;row++)for(let column=0;column<SIZE;column++)if(matrix[row][column])path+=`M${column+4} ${row+4}h1v1h-1z`;
  const modules=documentRef.createElementNS(namespace,"path");modules.setAttribute("d",path);modules.setAttribute("fill","#18211d");svg.append(modules);
  return svg;
}
